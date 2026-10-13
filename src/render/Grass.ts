import * as THREE from 'three';
import type { PlayableHole } from '../course/hole';
import { addShaderHook } from './shaderHooks';

/** Blade height (metres) at full mask, by surface. */
function maskFor(t: PlayableHole, x: number, z: number): [height: number, golden: number, flowers: number] {
  const s = t.surfaceAt(x, z);
  const links = t.style === 'links';
  switch (s) {
    case 'fringe':
      return [0.035, 0, 0];
    case 'rough':
      return [links ? 0.1 : 0.085, 0, 0];
    case 'deepRough':
    case 'ob':
      if (t.inWoods(x, z)) return [0.12, 0.25, 0];
      return links ? [0.3, 1, 0.04] : [0.2, 0.1, 0.18];
    default:
      return [0, 0, 0];
  }
}

/**
 * Instanced grass blades in a square around the camera's focus. Each instance keeps a fixed offset and is
 * wrapped toroidally around the moving centre, so blades stay put in the world as the view moves. The vertex
 * shader reads the hole's heightfield and a grass mask (height / colour / flowers) from textures and sways
 * blades with the wind.
 */
export class Grass {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    tHeight: { value: null as THREE.DataTexture | null },
    tMask: { value: null as THREE.DataTexture | null },
    uOrigin: { value: new THREE.Vector2() },
    uGrid: { value: new THREE.Vector2(1, 1) },
    uCenter: { value: new THREE.Vector2() },
    uRadius: { value: 30 },
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(0.5, 0) },
  };

  constructor(count: number, radius: number) {
    const side = Math.ceil(Math.sqrt(count));
    this.uniforms.uRadius.value = radius;
    // One clump = three tapered blades.
    const blade = new THREE.BufferGeometry();
    const pos: number[] = [];
    const tip: number[] = [];
    const idx: number[] = [];
    const SEG = 4;
    for (let b = 0; b < 3; b++) {
      const a = (b / 3) * Math.PI * 2 + 0.3;
      const ox = Math.cos(a) * 0.035;
      const oz = Math.sin(a) * 0.035;
      const dx = Math.cos(a + 1.7);
      const dz = Math.sin(a + 1.7);
      const lean = 0.25 + b * 0.12;
      const base = pos.length / 3;
      for (let k = 0; k <= SEG; k++) {
        const v = k / SEG;
        const w = 0.022 * (1 - v * 0.85);
        const lx = ox + Math.cos(a) * lean * v * v * 0.35;
        const lz = oz + Math.sin(a) * lean * v * v * 0.35;
        if (k < SEG) {
          pos.push(lx - dx * w, v, lz - dz * w, lx + dx * w, v, lz + dz * w);
          tip.push(v, v);
        } else {
          pos.push(lx, v, lz);
          tip.push(1);
        }
      }
      for (let k = 0; k < SEG - 1; k++) {
        const i = base + k * 2;
        idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
      const l = base + (SEG - 1) * 2;
      idx.push(l, l + 1, l + 2);
    }
    blade.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    blade.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 1));
    blade.setIndex(idx);
    const normals = new Float32Array(pos.length).fill(0);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    blade.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

    const geo = new THREE.InstancedBufferGeometry();
    geo.index = blade.index;
    geo.setAttribute('position', blade.getAttribute('position'));
    geo.setAttribute('normal', blade.getAttribute('normal'));
    geo.setAttribute('aTip', blade.getAttribute('aTip'));
    const offsets = new Float32Array(side * side * 3);
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const cell = (2 * radius) / side;
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        const k = (j * side + i) * 3;
        offsets[k] = -radius + (i + rnd()) * cell;
        offsets[k + 1] = -radius + (j + rnd()) * cell;
        offsets[k + 2] = rnd();
      }
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.instanceCount = side * side;

    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide, envMapIntensity: 0.6 });
    const U = this.uniforms;
    addShaderHook(mat, 'grass', (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec3 aOffset;
          attribute float aTip;
          uniform sampler2D tHeight;
          uniform sampler2D tMask;
          uniform vec2 uOrigin, uGrid, uCenter, uWind;
          uniform float uRadius, uTime;
          varying vec3 vGrass;
          float gHeight(vec2 p) {
            vec2 g = clamp(p - uOrigin, vec2(0.0), uGrid - 1.001);
            vec2 i = floor(g); vec2 f = g - i;
            vec2 px = 1.0 / uGrid;
            float h00 = texture2D(tHeight, (i + 0.5) * px).r;
            float h10 = texture2D(tHeight, (i + vec2(1.5, 0.5)) * px).r;
            float h01 = texture2D(tHeight, (i + vec2(0.5, 1.5)) * px).r;
            float h11 = texture2D(tHeight, (i + 1.5) * px).r;
            // Same triangle split as the terrain mesh.
            return (f.x + f.y <= 1.0) ? h00 + f.x * (h10 - h00) + f.y * (h01 - h00)
                                       : h11 + (1.0 - f.x) * (h01 - h11) + (1.0 - f.y) * (h10 - h11);
          }`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec2 span = vec2(2.0 * uRadius);
          vec2 world = uCenter + mod(aOffset.xy - uCenter + uRadius, span) - uRadius;
          vec4 mask = texture2D(tMask, (world - uOrigin + 0.5) / uGrid);
          float r = length(world - uCenter) / uRadius;
          float h = mask.r * 0.5 * (0.35 + 0.95 * fract(aOffset.z * 7.31)) * (1.0 - smoothstep(0.7, 1.0, r));
          float ang = aOffset.z * 6.2831;
          vec3 p = position;
          p = vec3(p.x * cos(ang) - p.z * sin(ang), p.y, p.x * sin(ang) + p.z * cos(ang));
          // Fescue is wispier and taller; short rough is a tight tuft.
          p.xz *= 0.7 + mask.g * 0.6;
          p.y *= h;
          float sway = sin(uTime * 2.1 + dot(world, vec2(0.21, 0.17)) + aOffset.z * 6.0) * 0.5 + 0.5;
          vec2 bend = uWind * (0.35 + 0.65 * sway) * aTip * aTip * h * 0.9;
          p.xz += bend;
          p.y -= length(bend) * 0.35;
          vec3 transformed = vec3(world.x + p.x, gHeight(world) + p.y - 0.01, world.y + p.z);
          // Colour: darker at the base, golden fescue, the odd flower head.
          float flower = step(1.0 - mask.b * 0.25, fract(aOffset.z * 91.7)) * step(0.97, aTip);
          vec3 green = mix(vec3(0.16, 0.30, 0.07), vec3(0.42, 0.55, 0.16), aTip);
          vec3 gold = mix(vec3(0.20, 0.20, 0.08), vec3(0.55, 0.49, 0.24), aTip);
          vGrass = mix(green, gold, mask.g * (0.6 + 0.4 * fract(aOffset.z * 13.1))) * (0.8 + 0.3 * fract(aOffset.z * 3.7));
          vGrass = mix(vGrass, vec3(0.95, 0.85, 0.25), flower);`,
        )
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(vec3(0.0, 1.0, 0.0) + vec3(uWind.x, 0.0, uWind.y) * 0.2);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrass;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vGrass;');
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.name = 'grass';
    this.mesh.userData.noAO = true;
  }

  /** Bake the hole's heights and grass mask into textures. */
  setHole(t: PlayableHole): void {
    this.uniforms.tHeight.value?.dispose();
    this.uniforms.tMask.value?.dispose();
    const ht = new THREE.DataTexture(new Float32Array(t.heights), t.nx, t.nz, THREE.RedFormat, THREE.FloatType);
    ht.magFilter = ht.minFilter = THREE.NearestFilter;
    ht.needsUpdate = true;
    const mask = new Uint8Array(t.nx * t.nz * 4);
    for (let j = 0; j < t.nz; j++) {
      for (let i = 0; i < t.nx; i++) {
        const [h, g, f] = maskFor(t, t.minX + i, t.minZ + j);
        const k = (j * t.nx + i) * 4;
        mask[k] = Math.min(255, (h / 0.5) * 255);
        mask[k + 1] = g * 255;
        mask[k + 2] = f * 255;
        mask[k + 3] = 255;
      }
    }
    const mt = new THREE.DataTexture(mask, t.nx, t.nz, THREE.RGBAFormat);
    mt.magFilter = mt.minFilter = THREE.LinearFilter;
    mt.needsUpdate = true;
    this.uniforms.tHeight.value = ht;
    this.uniforms.tMask.value = mt;
    this.uniforms.uOrigin.value.set(t.minX, t.minZ);
    this.uniforms.uGrid.value.set(t.nx, t.nz);
  }

  /** Follow the camera: centre the patch a little ahead of it. */
  update(time: number, camera: THREE.Camera, windX: number, windZ: number): void {
    const f = new THREE.Vector3();
    camera.getWorldDirection(f);
    f.y = 0;
    if (f.lengthSq() > 1e-6) f.normalize();
    const r = this.uniforms.uRadius.value;
    this.uniforms.uCenter.value.set(camera.position.x + f.x * r * 0.55, camera.position.z + f.z * r * 0.55);
    this.uniforms.uTime.value = time;
    // Wind as a lean, capped so a gale doesn't flatten everything.
    const s = Math.min(1, Math.hypot(windX, windZ) / 10);
    const d = Math.hypot(windX, windZ) || 1;
    this.uniforms.uWind.value.set((windX / d) * (0.15 + s * 0.5), (windZ / d) * (0.15 + s * 0.5));
  }

  dispose(): void {
    this.uniforms.tHeight.value?.dispose();
    this.uniforms.tMask.value?.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
