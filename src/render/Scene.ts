import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { makeCloudMaterial, waterUniforms } from './materials';
import { PostFX } from './PostFX';
import { presetFor, type Quality } from './Quality';
import { addShaderHook, removeShaderHook } from './shaderHooks';

/** Haze colour near the horizon; fog fades distant land into it (aerial perspective). */
const HAZE = new THREE.Color('#a8bfd2');
/** The physical sky is far brighter than the lit scene; scale it so they sit together. */
const SKY_BRIGHTNESS = 0.42;

function makeSky(scale: number): Sky {
  const sky = new Sky();
  sky.scale.setScalar(scale);
  const m = sky.material as THREE.ShaderMaterial;
  m.uniforms.skyBrightness = { value: SKY_BRIGHTNESS };
  m.fragmentShader = m.fragmentShader
    .replace('void main() {', 'uniform float skyBrightness;\nvoid main() {')
    .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * skyBrightness, 1.0 );');
  const u = m.uniforms;
  u.turbidity.value = 3.2;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.85;
  return sky;
}

/**
 * Renderer, sky, sun, shadows, fog and post-processing. Holes add and remove their own meshes and call
 * `prepare()` on them so their materials pick up cascaded shadows.
 */
export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 5000);
  readonly sunDir = new THREE.Vector3(-0.45, 0.62, 0.35).normalize();
  quality: Quality;

  private readonly sky: Sky;
  private readonly clouds: THREE.Mesh;
  private readonly hemi: THREE.HemisphereLight;
  /** Single shadowed sun (Low), or null when cascades are in use. */
  private sun: THREE.DirectionalLight | null = null;
  private csm: CSM | null = null;
  private post: PostFX | null = null;
  private prepared = new WeakSet<THREE.Material>();
  private readonly tracked = new Set<THREE.Material>();

  constructor(
    readonly canvas: HTMLCanvasElement,
    quality: Quality = presetFor('high'),
  ) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !quality.post, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene.background = HAZE.clone();
    this.scene.fog = new THREE.FogExp2(HAZE, 0.00072);

    // Physical sky (atmospheric scattering) and a cloud layer above it.
    this.sky = makeSky(4000);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(3900, 32, 16), makeCloudMaterial(this.sunDir));
    this.clouds.renderOrder = -9;
    this.clouds.frustumCulled = false;
    this.scene.add(this.clouds);

    // Image-based light from the sky: shaded sides pick up its blue, reflections show it.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = makeSky(50);
    envSky.material.uniforms.sunPosition.value.copy(this.sunDir);
    envScene.add(envSky);
    // A ground bounce so the underside of things isn't lit by sky alone.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#4d6a32' }));
    ground.position.y = -2;
    envScene.add(ground);
    this.scene.environment = pmrem.fromScene(envScene, 0, 0.1, 100).texture;
    this.scene.environmentIntensity = 0.7;
    pmrem.dispose();

    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x5d6a35, 0.35);
    this.scene.add(this.hemi);

    this.setupLights();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ---------------------------------------------------------------------------------------------
  // Lights and shadows

  private setupLights(): void {
    const q = this.quality;
    if (q.cascades > 0) {
      this.csm = new CSM({
        maxFar: 900,
        cascades: q.cascades,
        mode: 'practical',
        parent: this.scene,
        shadowMapSize: q.shadowSize,
        lightDirection: this.sunDir.clone().negate(),
        camera: this.camera,
        lightIntensity: 2.6,
        lightMargin: 160,
        lightFar: 1200,
        shadowBias: -0.00015,
      });
      this.csm.fade = true;
      for (const l of this.csm.lights) {
        l.color.set(0xfff0d8);
        l.shadow.normalBias = 0.04;
      }
    } else {
      const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
      sun.castShadow = true;
      sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      const sc = sun.shadow.camera;
      sc.left = -70;
      sc.right = 70;
      sc.top = 70;
      sc.bottom = -70;
      sc.near = 1;
      sc.far = 500;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.04;
      this.scene.add(sun);
      this.scene.add(sun.target);
      this.sun = sun;
    }
  }

  private teardownLights(): void {
    if (this.csm) {
      for (const m of this.tracked) {
        removeShaderHook(m, 'csm');
        const defines = (m as THREE.Material & { defines?: Record<string, unknown> }).defines;
        if (defines) {
          delete defines.USE_CSM;
          delete defines.CSM_CASCADES;
          delete defines.CSM_FADE;
        }
      }
      this.csm.remove();
      this.csm.dispose();
      this.csm = null;
    }
    if (this.sun) {
      this.scene.remove(this.sun, this.sun.target);
      this.sun.dispose();
      this.sun = null;
    }
    this.tracked.clear();
  }

  /** Give every material under `root` cascaded shadows (call after adding new meshes). */
  prepare(root: THREE.Object3D): void {
    if (!this.csm) return;
    const csm = this.csm;
    root.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;
      for (const m of Array.isArray(mat) ? mat : [mat]) {
        if (this.prepared.has(m) || !('isMeshStandardMaterial' in m || 'isMeshLambertMaterial' in m || 'isMeshPhongMaterial' in m)) continue;
        this.prepared.add(m);
        this.tracked.add(m);
        csm.setupMaterial(m);
        // CSM installs its own onBeforeCompile; fold it into the shared hook list.
        const hook = m.onBeforeCompile.bind(m);
        addShaderHook(m, 'csm', (s, r) => hook(s, r));
        m.addEventListener('dispose', () => {
          csm.shaders.delete(m);
          this.tracked.delete(m);
        });
      }
    });
  }

  /** Switch graphics preset at runtime: rebuilds shadows and post-processing, re-prepares materials. */
  applyQuality(q: Quality): void {
    const oldCascades = this.quality.cascades;
    this.quality = q;
    if (oldCascades !== q.cascades || this.sun?.shadow.mapSize.x !== q.shadowSize) {
      this.teardownLights();
      this.setupLights();
      // Forget earlier preparation so every material is set up for the new shadow mode.
      this.prepared = new WeakSet();
      this.prepare(this.scene);
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m && !Array.isArray(m)) m.needsUpdate = true;
      });
    }
    this.post?.dispose();
    this.post = null;
    this.resize();
  }

  /** Keep the single shadow frustum centred on the action (Low preset only; cascades follow the camera). */
  focusShadows(target: THREE.Vector3): void {
    if (!this.sun) return;
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 250);
  }

  /** Depth of field for cinematic shots. */
  setDof(on: boolean, focus = 30): void {
    this.post?.setDof(on, focus);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatio));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep a sensible horizontal view on tall (portrait) screens.
    this.camera.fov = w < h ? Math.min(75, (50 / Math.max(0.55, w / h)) * 0.75) : 50;
    this.camera.updateProjectionMatrix();
    this.csm?.updateFrustums();
    if (this.quality.post) {
      if (!this.post) this.post = new PostFX(this.renderer, this.scene, this.camera, this.quality);
      this.post.setSize(w, h);
    } else if (this.post) {
      this.post.dispose();
      this.post = null;
    }
  }

  render(time: number, dt = 1 / 60): void {
    waterUniforms.uTime.value = time;
    this.sky.position.copy(this.camera.position);
    this.clouds.position.copy(this.camera.position);
    this.camera.updateMatrixWorld();
    this.csm?.update();
    if (this.post) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
