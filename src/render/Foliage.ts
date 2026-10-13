import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addShaderHook } from './shaderHooks';

/** Shared by every swaying plant; Game updates the wind, the scene updates time. */
export const foliageUniforms = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0.3, 0) },
};

let leafTex: THREE.CanvasTexture | null = null;

/** A sprig of leaves on a transparent background, drawn once. */
function leafTexture(): THREE.CanvasTexture {
  if (leafTex) return leafTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.clearRect(0, 0, S, S);
  for (let k = 0; k < 70; k++) {
    const r = Math.sqrt(rnd()) * S * 0.42;
    const a = rnd() * Math.PI * 2;
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    const len = 18 + rnd() * 16;
    const shade = 150 + rnd() * 105;
    g.save();
    g.translate(x, y);
    g.rotate(a + (rnd() - 0.5) * 1.2);
    g.fillStyle = `rgb(${shade * 0.9},${shade},${shade * 0.8})`;
    g.beginPath();
    g.ellipse(0, 0, len, len * 0.42, 0, 0, Math.PI * 2);
    g.fill();
    // Midrib.
    g.strokeStyle = `rgba(0,0,0,0.18)`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(-len, 0);
    g.lineTo(len, 0);
    g.stroke();
    g.restore();
  }
  leafTex = new THREE.CanvasTexture(c);
  leafTex.colorSpace = THREE.SRGBColorSpace;
  leafTex.anisotropy = 4;
  return leafTex;
}

/**
 * A broadleaf crown made of leaf cards scattered over an ellipsoid shell (unit radius/height, base at 0).
 * Normals point out from the crown centre, the usual trick for soft, volumetric foliage lighting.
 */
export function crownGeometry(cards = 46, seed = 5): THREE.BufferGeometry {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const parts: THREE.BufferGeometry[] = [];
  const center = new THREE.Vector3(0, 0.55, 0);
  for (let i = 0; i < cards; i++) {
    // Fibonacci-ish spread over the shell, with depth so it isn't hollow.
    const y = 1 - (i + 0.5) / cards * 1.6;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * 2.399963 + rnd() * 0.4;
    const depth = 0.65 + rnd() * 0.4;
    const p = new THREE.Vector3(Math.cos(phi) * r * depth, center.y + y * 0.48 * depth, Math.sin(phi) * r * depth);
    const size = 0.55 + rnd() * 0.35;
    const q = new THREE.PlaneGeometry(size, size);
    const out = p.clone().sub(center).normalize();
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), out, new THREE.Vector3(0, 1, 0));
    q.applyMatrix4(m);
    q.rotateY(rnd() * 0.6);
    q.translate(p.x, p.y, p.z);
    // Spherical normals.
    const pos = q.attributes.position as THREE.BufferAttribute;
    const nrm = q.attributes.normal as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const n = new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(center).normalize();
      nrm.setXYZ(k, n.x, n.y, n.z);
    }
    parts.push(q);
  }
  return mergeGeometries(parts)!;
}

/** Leaf-card crown material: alpha-tested, two-sided, swaying with the wind, slightly translucent toward the sun. */
export function makeCrownMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: leafTexture(),
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.8,
    envMapIntensity: 0.55,
  });
  addSway(m, 0.18);
  return m;
}

/** Sway: tops move more than bottoms, each plant on its own phase. `amp` in metres at the crown top. */
export function addSway(m: THREE.Material, amp: number): void {
  addShaderHook(m, 'sway', (shader) => {
    shader.uniforms.uTime = foliageUniforms.uTime;
    shader.uniforms.uWind = foliageUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec2 root = instanceMatrix[3].xz;
          #else
            vec2 root = vec2(0.0);
          #endif
          float ph = dot(root, vec2(0.37, 0.71));
          float h = clamp(position.y, 0.0, 1.2);
          float gust = 0.6 + 0.4 * sin(uTime * 0.7 + ph * 0.3);
          float sway = sin(uTime * 1.6 + ph) * gust;
          float flutter = sin(uTime * 7.0 + ph * 3.0 + position.x * 9.0 + position.z * 7.0) * 0.18;
          transformed.xz += (uWind * sway + vec2(flutter) * length(uWind)) * h * h * ${amp.toFixed(3)};
        }`,
      );
  });
}

/** Trunk with a few limbs, unit height. */
export function trunkGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.11, 0.24, 1, 7).translate(0, 0.5, 0)];
  for (let i = 0; i < 3; i++) {
    const limb = new THREE.CylinderGeometry(0.04, 0.08, 0.55, 5).translate(0, 0.27, 0);
    limb.rotateZ(0.9 + i * 0.15);
    limb.rotateY((i / 3) * Math.PI * 2 + 0.4);
    limb.translate(0, 0.72 + i * 0.08, 0);
    parts.push(limb);
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

/** A pine: stacked, ragged branch tiers (unit radius and height). */
export function pineGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tiers = 5;
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const r = 1 - t * 0.78;
    const h = 0.34 - t * 0.04;
    const cone = new THREE.ConeGeometry(r, h, 11, 1, true).translate(0, t * 0.82 + h / 2, 0);
    const pos = cone.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      // Droop and jag the skirt edge.
      if (pos.getY(k) < t * 0.82 + h * 0.2) {
        const j = 0.82 + rnd() * 0.3;
        pos.setXYZ(k, pos.getX(k) * j, pos.getY(k) - rnd() * 0.04, pos.getZ(k) * j);
      }
    }
    cone.computeVertexNormals();
    parts.push(cone.toNonIndexed());
  }
  return mergeGeometries(parts)!;
}
