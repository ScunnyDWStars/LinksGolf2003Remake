import * as THREE from 'three';
import { Noise2D } from '../util/noise';
import { addShaderHook } from './shaderHooks';

/**
 * Tiling detail texture, generated once. Channels:
 *  R: fine grass grain   G: sand ripples   B: soil / leaf litter   A: broad patchiness
 */
let detail: THREE.DataTexture | null = null;
function detailTexture(): THREE.DataTexture {
  if (detail) return detail;
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const n1 = new Noise2D(11);
  const n2 = new Noise2D(23);
  const n3 = new Noise2D(37);
  // Periodic noise: sample a torus so the tile wraps seamlessly.
  const tor = (noise: Noise2D, u: number, v: number, freq: number, oct: number) => {
    const a = u * Math.PI * 2;
    const b = v * Math.PI * 2;
    const r = freq / (Math.PI * 2);
    return noise.fbm(Math.cos(a) * r + Math.cos(b) * r * 0.5, Math.sin(a) * r + Math.sin(b) * r * 0.5 + Math.cos(b) * r, oct);
  };
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const v = j / N;
      const k = (j * N + i) * 4;
      const grain = 0.5 + 0.35 * tor(n1, u, v, 40, 3) + (rnd() - 0.5) * 0.35;
      // Wind-blown ripples: a sine across the tile, warped by noise.
      const warp = tor(n2, u, v, 6, 3);
      const ripple = 0.5 + 0.5 * Math.sin((u * 18 + warp * 1.4) * Math.PI * 2);
      const soil = 0.5 + 0.45 * tor(n3, u, v, 22, 4) + (rnd() - 0.5) * 0.2;
      const patch = 0.5 + 0.5 * tor(n1, u + 0.37, v + 0.71, 4, 3);
      data[k] = Math.max(0, Math.min(255, grain * 255));
      data[k + 1] = Math.max(0, Math.min(255, (ripple * 0.75 + warp * 0.25 + 0.15) * 255));
      data[k + 2] = Math.max(0, Math.min(255, soil * 255));
      data[k + 3] = Math.max(0, Math.min(255, patch * 255));
    }
  }
  detail = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.magFilter = THREE.LinearFilter;
  detail.minFilter = THREE.LinearMipmapLinearFilter;
  detail.generateMipmaps = true;
  detail.anisotropy = 8;
  detail.needsUpdate = true;
  return detail;
}

/**
 * Terrain material: the per-vertex colour is the surface's albedo; the shader adds
 *  - fine detail colour and micro-normals by surface (grass grain, sand ripples, soil),
 *  - mowing stripes that brighten or darken with the viewing angle (they flip when you look the other way),
 *  - bare soil on steep banks in the rough.
 * Attributes: aMow = (stripe direction x, z, signed strength); aSurf = (sand, soil, long grass, green).
 */
export function makeTerrainMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const tex = detailTexture();
  addShaderHook(m, 'terrain', (shader) => {
    shader.uniforms.tDetail = { value: tex };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aMow;
        attribute vec4 aSurf;
        varying vec3 vMow;
        varying vec4 vSurf;
        varying vec3 vTWorld;
        varying vec3 vTNormal;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        vTNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vMow = aMow;
        vSurf = aSurf;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tDetail;
        varying vec3 vMow;
        varying vec4 vSurf;
        varying vec3 vTWorld;
        varying vec3 vTNormal;
        float tDist;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        tDist = length(cameraPosition - vTWorld);
        vec2 wp = vTWorld.xz;
        vec4 dFine = texture2D(tDetail, wp * 0.45);
        vec4 dMid = texture2D(tDetail, wp * 0.07);
        vec4 dBroad = texture2D(tDetail, wp * 0.011);
        float sand = vSurf.x, soil = vSurf.y, longGrass = vSurf.z, fine = vSurf.w;
        float grass = clamp(1.0 - sand - soil, 0.0, 1.0);
        // Fade the finest grain with distance so it never shimmers.
        float near = 1.0 - smoothstep(25.0, 90.0, tDist);
        float g = mix(1.0, 0.82 + 0.36 * dFine.r, near * (0.5 + 0.5 * longGrass) * (1.0 - fine * 0.6));
        g *= 0.9 + 0.2 * dMid.r * (0.4 + longGrass);
        g *= 0.92 + 0.16 * dBroad.a;
        vec3 col = diffuseColor.rgb * mix(1.0, g, grass);
        // Sand: ripples and grains.
        col = mix(col, col * (0.88 + 0.22 * mix(dMid.g, dFine.g, 0.5)) * (0.95 + 0.1 * dFine.r), sand);
        // Soil, litter and bare banks.
        float slope = 1.0 - clamp(vTNormal.y, 0.0, 1.0);
        float bank = smoothstep(0.18, 0.4, slope) * longGrass * (1.0 - sand);
        vec3 dirt = vec3(0.24, 0.19, 0.12) * (0.75 + 0.5 * dFine.b);
        col = mix(col, col * (0.7 + 0.6 * dFine.b), soil);
        col = mix(col, dirt, bank * 0.55);
        // Mowing stripes: blades lean with the mower, so a stripe looks light from one side and dark from the other.
        vec3 V = normalize(cameraPosition - vTWorld);
        vec2 vh = normalize(V.xz + vec2(1e-5));
        float lean = dot(vh, normalize(vMow.xy + vec2(1e-5))) * vMow.z;
        float stripeFade = 1.0 - smoothstep(180.0, 420.0, tDist);
        col *= 1.0 + 0.11 * lean * stripeFade;
        diffuseColor.rgb = col;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.78, fine);
        roughnessFactor = mix(roughnessFactor, 1.0, max(sand, soil));`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // Micro-relief from the detail texture: ripples in sand, grain in grass.
          float e = 0.12;
          vec2 q = vTWorld.xz;
          float h0 = texture2D(tDetail, q * 0.45).r * (1.0 - sand) + texture2D(tDetail, q * 0.07).g * sand * 2.0;
          float hx = texture2D(tDetail, (q + vec2(e, 0.0)) * 0.45).r * (1.0 - sand) + texture2D(tDetail, (q + vec2(e, 0.0)) * 0.07).g * sand * 2.0;
          float hz = texture2D(tDetail, (q + vec2(0.0, e)) * 0.45).r * (1.0 - sand) + texture2D(tDetail, (q + vec2(0.0, e)) * 0.07).g * sand * 2.0;
          float k = (0.35 + 0.65 * longGrass) * (1.0 - smoothstep(20.0, 70.0, tDist)) * 0.6 + sand * 0.5;
          vec3 nW = normalize(vec3(-(hx - h0) / e * k * 0.1, 1.0, -(hz - h0) / e * k * 0.1));
          vec3 nV = (viewMatrix * vec4(nW.x, 0.0, nW.z, 0.0)).xyz;
          normal = normalize(normal + nV);
        }`,
      );
  });
  return m;
}
