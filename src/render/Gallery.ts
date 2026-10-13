import * as THREE from 'three';
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

  const ok = (x: number, z: number) => {
    const s = t.surfaceAt(x, z);
    if (s !== 'rough' && s !== 'deepRough' && s !== 'path') return false;
    return !t.obstaclesNear(x, z).some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + 0.6);
  };
  const add = (x: number, z: number) => {
    if (ok(x, z)) spots.push(new THREE.Vector3(x, t.heightAt(x, z), z));
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
  const legs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.13, 0.86, 6).translate(0, 0.43, 0), new THREE.MeshLambertMaterial(), n);
  const torso = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.17, 0.62, 7).translate(0, 1.17, 0), new THREE.MeshLambertMaterial(), n);
  const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.115, 8, 6).translate(0, 1.6, 0), new THREE.MeshLambertMaterial(), n);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const pick = (arr: string[]) => arr[Math.floor(rng() * arr.length)];
  spots.forEach((p, i) => {
    const s = 0.9 + rng() * 0.2;
    m.makeScale(s, s, s).setPosition(p);
    legs.setMatrixAt(i, m);
    torso.setMatrixAt(i, m);
    head.setMatrixAt(i, m);
    legs.setColorAt(i, c.set(pick(TROUSERS)));
    torso.setColorAt(i, c.set(pick(SHIRTS)));
    head.setColorAt(i, c.set(pick(SKIN)));
  });
  for (const mesh of [legs, torso, head]) {
    mesh.castShadow = true;
    g.add(mesh);
  }
  return g;
}
