import * as THREE from 'three';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Quality } from './Quality';

/** Final look: a little warmth, saturation and contrast, and a soft broadcast vignette. Runs in display space. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    saturation: { value: 1.08 },
    contrast: { value: 1.04 },
    warmth: { value: 0.025 },
    vignette: { value: 0.28 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation, contrast, warmth, vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.5) * contrast + 0.5;
      col += vec3(warmth, warmth * 0.4, -warmth);
      vec2 d = vUv - 0.5;
      col *= 1.0 - vignette * smoothstep(0.35, 0.85, length(d * vec2(1.25, 1.0)));
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

export class PostFX {
  readonly composer: EffectComposer;
  private readonly bokeh: BokehPass | null = null;
  private dofOn = false;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, q: Quality) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    if (q.ao) {
      const ao = new GTAOPass(scene, camera, size.x, size.y);
      ao.blendIntensity = 0.7;
      ao.updateGtaoMaterial({ radius: 1.1, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: q.level === 'ultra' ? 16 : 10 });
      // The AO pass draws its own depth/normals with a plain override material, which would turn
      // alpha-cut leaf cards into solid squares and lose the grass shader. Leave those out of it.
      const pass = ao as unknown as { _renderOverride: (...a: unknown[]) => void };
      const original = pass._renderOverride.bind(ao);
      pass._renderOverride = (...args: unknown[]) => {
        const hidden: THREE.Object3D[] = [];
        scene.traverse((o) => {
          if (o.userData.noAO && o.visible) {
            o.visible = false;
            hidden.push(o);
          }
        });
        original(...args);
        for (const o of hidden) o.visible = true;
      };
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
      this.composer.addPass(ao);
    }
    if (q.dof) {
      const b = new BokehPass(scene, camera, { focus: 30, aperture: 0.00012, maxblur: 0.006 });
      b.enabled = false;
      this.composer.addPass(b);
      this.bokeh = b;
    }
    if (q.bloom) this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.5, 1.05));
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(GradeShader));
    if (!q.msaa) this.composer.addPass(new SMAAPass());
  }

  /** Depth of field for cinematic shots; focus in metres from the camera. */
  setDof(on: boolean, focus = 30): void {
    if (!this.bokeh) return;
    this.dofOn = on;
    this.bokeh.enabled = on;
    const u = this.bokeh.uniforms as Record<string, THREE.IUniform>;
    u.focus.value = focus;
  }

  get dof(): boolean {
    return this.dofOn;
  }

  setSize(w: number, h: number): void {
    // The composer resizes every pass (ambient occlusion included).
    this.composer.setSize(w, h);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
