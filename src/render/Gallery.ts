import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addShaderHook } from './shaderHooks';
import type { PlayableHole } from '../course/hole';
import { makeRng } from '../util/rng';

const SHIRTS = ['#d63b3b', '#f2f2f2', '#2f5fb3', '#f0c419', '#3a9a5b', '#7a3fa0', '#ff8a3d', '#1e2a44', '#9fd3f0', '#e86fa3'];
const TROUSERS = ['#cbbd94', '#1e2a44', '#2b2b2b', '#e9e6dc', '#6b5a43'];
const SKIN = ['#f1c9a5', '#d9a47e', '#b57a55', '#8a5a3c', '#5e3b26'];

/** Low-poly spectators lining the tee and ringing the green, like a tournament gallery. */
export function buildGallery(t: PlayableHole): THREE.Group {
  const g = new THREE.Group();
  const rng = makeRng(900 + t.info.number * 13);
  const spots: THREE.Vector3[] = [];
  const faces: THREE.Vector2[] = [];

  const ok = (x: number, z: number) => {
    const s = t.surfaceAt(x, z);
    if (s !== 'rough' && s !== 'deepRough' && s !== 'path') return false;
    return !t.obstaclesNear(x, z).some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + 0.6);
  };
  let faceX = t.tee.x;
  let faceZ = t.tee.z;
  const add = (x: number, z: number) => {
    if (!ok(x, z)) return;
    spots.push(new THREE.Vector3(x, t.heightAt(x, z), z));
    faces.push(new THREE.Vector2(faceX, faceZ));
  };

  // Tee: a line of fans down the right side, plus a few behind.
  const d = t.teeDir;
  const right = { x: -d.z, z: d.x };
  for (let i = 0; i < 16; i++) {
    const along = -6 + i * 1.4 + (rng() - 0.5) * 0.6;
    const side = 9 + (rng() - 0.5) * 2.4 + (i % 2) * 1.2;
    add(t.tee.x + d.x * along + right.x * side, t.tee.z + d.z * along + right.z * side);
  }
  for (let i = 0; i < 7; i++) {
    const across = -5 + i * 1.6;
    add(t.tee.x - d.x * 13 + right.x * across, t.tee.z - d.z * 13 + right.z * across);
  }

  // Green: an arc around the back and sides.
  const gb = t.green;
  faceX = gb.cx;
  faceZ = gb.cz;
  const gr = gb.radius;
  const approach = t.centerline.dirAt(t.length);
  const baseAng = Math.atan2(approach.z, approach.x);
  for (let i = 0; i < 34; i++) {
    const a = baseAng + (-1.9 + (3.8 * i) / 33) + (rng() - 0.5) * 0.05;
    const r = gr + 9 + (i % 2) * 1.3 + rng();
    add(gb.cx + Math.cos(a) * r, gb.cz + Math.sin(a) * r);
  }

  const n = spots.length;
  if (!n) return g;
  const geo = personGeometry();
  const shirt = new Float32Array(n * 3);
  const pants = new Float32Array(n * 3);
  const skin = new Float32Array(n * 3);
  const extra = new Float32Array(n * 2); // phase, has cap
  const c = new THREE.Color();
  const pick = (arr: string[]) => arr[Math.floor(rng() * arr.length)];
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  addShaderHook(mat, 'gallery', (shader) => {
    shader.uniforms.uTime = galleryUniforms.uTime;
    shader.uniforms.uClap = galleryUniforms.uClap;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aPart;
        attribute vec4 aArm;
        attribute vec3 aShirt, aPants, aSkin;
        attribute vec2 aExtra;
        uniform float uTime, uClap;
        varying vec3 vPerson;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float ph = aExtra.x * 6.2831;
          // Arms: hanging by default, raised and clapping when the crowd reacts (each person a bit out of step).
          float clap = clamp(uClap * (0.7 + 0.6 * fract(aExtra.x * 7.0)), 0.0, 1.0);
          vec3 clapPos = aArm.xyz;
          clapPos.x += sign(aArm.x) * aArm.w * (0.5 + 0.5 * sin(uTime * 17.0 + ph)) * 0.09;
          transformed = mix(transformed, clapPos, clap * step(0.5, abs(aArm.x) + abs(aArm.y) + abs(aArm.z)));
          // Idle sway: weight shifts and the odd glance around.
          float sway = sin(uTime * 0.6 + ph) * 0.03 * transformed.y;
          transformed.x += sway;
          float turn = sin(uTime * 0.25 + ph * 1.7) * 0.2 * step(1.5, transformed.y);
          transformed.xz = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * transformed.xz;
          vPerson = aPart < 0.5 ? aSkin : aPart < 1.5 ? aShirt : aPart < 2.5 ? aPants : aPart < 3.5 ? aShirt * 0.92 : vec3(0.92);
          if (aPart > 3.5 && aExtra.y < 0.5) transformed *= 0.0; // no cap
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPerson;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vPerson;');
  });
  const people = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spots.forEach((p, i) => {
    const s = 0.9 + rng() * 0.2;
    const f = faces[i];
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(f.x - p.x, f.y - p.z));
    m.compose(p, q, new THREE.Vector3(s, s, s));
    people.setMatrixAt(i, m);
    c.set(pick(SHIRTS)).toArray(shirt, i * 3);
    c.set(pick(TROUSERS)).toArray(pants, i * 3);
    c.set(pick(SKIN)).toArray(skin, i * 3);
    extra[i * 2] = rng();
    extra[i * 2 + 1] = rng() < 0.35 ? 1 : 0;
  });
  geo.setAttribute('aShirt', new THREE.InstancedBufferAttribute(shirt, 3));
  geo.setAttribute('aPants', new THREE.InstancedBufferAttribute(pants, 3));
  geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skin, 3));
  geo.setAttribute('aExtra', new THREE.InstancedBufferAttribute(extra, 2));
  people.castShadow = true;
  people.receiveShadow = true;
  g.add(people);
  return g;
}

/** Shared crowd animation: time, and how hard they're applauding (0..1, decays). */
export const galleryUniforms = { uTime: { value: 0 }, uClap: { value: 0 } };

/** One spectator, facing +Z: legs, body, arms (with a clapping pose per vertex), head and an optional cap. */
function personGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tag = (geo: THREE.BufferGeometry, part: number, clap?: (v: THREE.Vector3) => THREE.Vector3 | null) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    const count = g.attributes.position.count;
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(count).fill(part), 1));
    const arm = new Float32Array(count * 4);
    if (clap) {
      const pos = g.attributes.position as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      for (let k = 0; k < count; k++) {
        v.fromBufferAttribute(pos, k);
        const cp = clap(v);
        if (cp) arm.set([cp.x, cp.y, cp.z, Math.max(0, (1.38 - v.y) / 0.55)], k * 4);
      }
    }
    g.setAttribute('aArm', new THREE.BufferAttribute(arm, 4));
    parts.push(g);
  };
  for (const side of [-1, 1]) {
    tag(new THREE.CapsuleGeometry(0.07, 0.72, 3, 8).translate(side * 0.09, 0.45, 0), 2);
    tag(new THREE.CapsuleGeometry(0.05, 0.12, 2, 6).rotateX(Math.PI / 2).translate(side * 0.09, 0.05, 0.05), 2);
    // Arm hanging at the side; in the clapping pose it swings forward to meet the other hand.
    const shoulder = new THREE.Vector3(side * 0.21, 1.38, 0);
    const armGeo = new THREE.CapsuleGeometry(0.048, 0.5, 3, 8).translate(side * 0.23, 1.1, 0);
    tag(armGeo, 3, (v) => {
      const rel = v.clone().sub(shoulder);
      // Rotate the arm forward and in about the shoulder.
      const fwd = rel.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), -1.25).applyAxisAngle(new THREE.Vector3(0, 0, 1), side * 0.55);
      return shoulder.clone().add(fwd);
    });
  }
  const body = new THREE.CapsuleGeometry(0.17, 0.42, 4, 10).translate(0, 1.15, 0);
  body.scale(1.12, 1, 0.72);
  tag(body, 1);
  tag(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 8).translate(0, 1.48, 0), 0);
  tag(new THREE.SphereGeometry(0.105, 12, 10).translate(0, 1.6, 0.01), 0);
  tag(new THREE.SphereGeometry(0.11, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(0, 1.63, 0.01), 4);
  tag(new THREE.CylinderGeometry(0.07, 0.07, 0.012, 12, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.3).translate(0, 1.64, 0.09), 4);
  return mergeGeometries(parts.map((p) => {
    const keep = p;
    for (const k of Object.keys(keep.attributes)) if (!['position', 'normal', 'aPart', 'aArm'].includes(k)) keep.deleteAttribute(k);
    return keep;
  }))!;
}
