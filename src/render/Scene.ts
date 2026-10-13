import * as THREE from 'three';
import { makeSkyMaterial, waterUniforms } from './materials';

/** Renderer, lights, sky and fog. Holes add and remove their own meshes. */
export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 5000);
  readonly sun: THREE.DirectionalLight;
  readonly sunDir = new THREE.Vector3(-0.45, 0.75, 0.35).normalize();
  private readonly sky: THREE.Mesh;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.fog = new THREE.Fog(0xcfdde6, 350, 1700);
    this.scene.background = new THREE.Color(0xcfdde6);

    const hemi = new THREE.HemisphereLight(0xdfeeff, 0x6b6a3a, 1.1);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 70;
    sc.bottom = -70;
    sc.near = 1;
    sc.far = 500;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), makeSkyMaterial(this.sunDir));
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep a sensible horizontal view on tall (portrait) screens.
    this.camera.fov = w < h ? Math.min(75, 50 / Math.max(0.55, w / h) * 0.75) : 50;
    this.camera.updateProjectionMatrix();
  }

  /** Keep the shadow frustum centred on what the camera is looking at. */
  focusShadows(target: THREE.Vector3): void {
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 250);
  }

  render(time: number): void {
    waterUniforms.uTime.value = time;
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
