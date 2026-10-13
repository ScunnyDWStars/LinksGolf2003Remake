import * as THREE from 'three';
import { CUP_RADIUS } from '../physics/constants';
import type { SurfaceType } from '../physics/surfaces';
import { makeDetailTexture, makeWaterMaterial } from '../render/materials';
import { clamp, smoothstep } from '../util/math';
import { makeRng } from '../util/rng';
import { GRID_STEP, type HoleTerrain } from './terrain';

const BASE: Record<SurfaceType, THREE.Color> = {
  tee: new THREE.Color('#6aa844'),
  fairway: new THREE.Color('#62a23c'),
  fringe: new THREE.Color('#5aa63c'),
  green: new THREE.Color('#6cc04a'),
  rough: new THREE.Color('#41702a'),
  deepRough: new THREE.Color('#9a9452'),
  sand: new THREE.Color('#e6d5a6'),
  water: new THREE.Color('#41594a'),
  path: new THREE.Color('#b8ad96'),
  ob: new THREE.Color('#8f8a4e'),
};

let detailTex: THREE.CanvasTexture | null = null;

export interface HoleMeshes {
  group: THREE.Group;
  flag: THREE.Mesh;
  flagBaseY: number;
  dispose(): void;
}

/** Build every visual for one hole. */
export function buildHoleMeshes(t: HoleTerrain): HoleMeshes {
  const group = new THREE.Group();
  group.name = `hole-${t.spec.number}`;
  detailTex ??= makeDetailTexture();

  group.add(buildTerrainMesh(t));
  group.add(buildSurroundings(t));
  for (const w of buildWater(t)) group.add(w);
  group.add(buildTrees(t));
  group.add(buildTeeMarkers(t));
  const obStakes = buildObStakes(t);
  if (obStakes) group.add(obStakes);
  const { pin, flag, flagBaseY } = buildPin(t);
  group.add(pin);

  return {
    group,
    flag,
    flagBaseY,
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    },
  };
}

function colorFor(t: HoleTerrain, x: number, z: number, out: THREE.Color): THREE.Color {
  const surf = t.surfaceAt(x, z);
  out.copy(BASE[surf]);
  const n = t.noise.noise(x / 6 + 11, z / 6 - 4);
  switch (surf) {
    case 'fairway':
    case 'tee': {
      // Mowing stripes across the line of play.
      const s = t.progress(x, z);
      const stripe = Math.floor(s / 9) % 2 === 0 ? 1.06 : 0.95;
      out.multiplyScalar(stripe * (1 + n * 0.04));
      break;
    }
    case 'green': {
      const a = Math.floor((x + z) / 3.2) % 2 === 0;
      const b = Math.floor((x - z) / 3.2) % 2 === 0;
      out.multiplyScalar((a !== b ? 1.05 : 0.96) * (1 + n * 0.02));
      break;
    }
    case 'rough':
      out.multiplyScalar(1 + n * 0.12);
      break;
    case 'deepRough':
    case 'ob': {
      // Fescue: golden with green patches.
      const patch = t.noise.fbm(x / 25, z / 25, 3);
      out.lerp(BASE.rough, clamp(0.45 + patch * 0.9, 0, 1));
      out.multiplyScalar(1 + n * 0.15);
      break;
    }
    case 'sand':
      out.multiplyScalar(1 + n * 0.05);
      break;
    default:
      break;
  }
  return out;
}

function buildTerrainMesh(t: HoleTerrain): THREE.Mesh {
  const { nx, nz } = t;
  const positions = new Float32Array(nx * nz * 3);
  const colors = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = t.minX + i * GRID_STEP;
      const z = t.minZ + j * GRID_STEP;
      positions[k * 3] = x;
      positions[k * 3 + 1] = t.heights[k];
      positions[k * 3 + 2] = z;
      colorFor(t, x, z, c);
      colors[k * 3] = c.r;
      colors[k * 3 + 1] = c.g;
      colors[k * 3 + 2] = c.b;
      uvs[k * 2] = x / 3;
      uvs[k * 2 + 1] = z / 3;
    }
  }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v00 = j * nx + i;
      const v10 = v00 + 1;
      const v01 = v00 + nx;
      const v11 = v01 + 1;
      index[p++] = v00;
      index[p++] = v01;
      index[p++] = v10;
      index[p++] = v10;
      index[p++] = v01;
      index[p++] = v11;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTex });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/** Low-detail dunes and sea out to the horizon so the hole doesn't float in space. */
function buildSurroundings(t: HoleTerrain): THREE.Group {
  const g = new THREE.Group();
  const size = 3200;
  const seg = 200;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const cx = (t.minX + t.maxX) / 2;
  const cz = (t.minZ + t.maxZ) / 2;
  geo.translate(cx, 0, cz);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const fescue = new THREE.Color('#9a9452');
  const grass = new THREE.Color('#577f33');
  const duneSand = new THREE.Color('#d9c99a');
  const seaSide = 1; // sea lies off to the right (+x)
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const z = pos.getZ(k);
    // Distance outside the playable patch.
    const ox = Math.max(t.minX - x, 0, x - t.maxX);
    const oz = Math.max(t.minZ - z, 0, z - t.maxZ);
    const out = Math.hypot(ox, oz);
    const n = t.noise.fbm(x / 70 + 300, z / 70, 4);
    let h = t.edgeHeight - 0.6 + (Math.abs(n) * 9 + n * 3) * smoothstep(0, 120, out);
    // Toward the sea the land drops to a beach.
    const seaDist = (x - t.maxX) * seaSide - 260;
    h -= smoothstep(-40, 140, seaDist) * (h + 3.5);
    if (out < 1) h = t.edgeHeight - 1.2;
    pos.setY(k, h);
    c.copy(fescue).lerp(grass, clamp(0.5 + n, 0, 1));
    if (seaDist > -20) c.lerp(duneSand, smoothstep(-20, 60, seaDist));
    c.multiplyScalar(1 + t.noise.noise(x / 9, z / 9) * 0.08);
    colors.set([c.r, c.g, c.b], k * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const land = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTex }));
  land.receiveShadow = true;
  g.add(land);

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), makeWaterMaterial(new THREE.Color('#1d4e66'), new THREE.Color('#3b7f93')));
  sea.position.set(cx, -1.6, cz);
  sea.renderOrder = -1;
  g.add(sea);
  return g;
}

function buildWater(t: HoleTerrain): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  const mat = makeWaterMaterial();
  mat.side = THREE.DoubleSide;
  for (const p of t.ponds) {
    const s = p.blob.spec;
    const geo = new THREE.CircleGeometry(1, 64);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(s.rx * 1.35, 1, s.rz * 1.35);
    m.rotation.y = -((s.rot ?? 0) * Math.PI) / 180;
    m.position.set(p.blob.cx, p.level, p.blob.cz);
    meshes.push(m);
  }
  for (const b of t.burns) {
    const verts: number[] = [];
    const idx: number[] = [];
    const step = 2;
    let row = 0;
    for (let s = 0; s <= b.line.length; s += step) {
      const pt = b.line.pointAt(s);
      // Only inside the playable patch; beyond it the outer land sits lower and the ribbon would float.
      if (pt.x < t.minX + 2 || pt.x > t.maxX - 2 || pt.z < t.minZ + 2 || pt.z > t.maxZ - 2) continue;
      const d = b.line.dirAt(s);
      const k = clamp(s / 4, 0, b.levels.length - 1);
      const k0 = Math.floor(k);
      const lv = b.levels[k0] + (b.levels[Math.min(k0 + 1, b.levels.length - 1)] - b.levels[k0]) * (k - k0);
      const w = b.halfWidth * 1.6;
      verts.push(pt.x - d.z * w, lv, pt.z + d.x * w, pt.x + d.z * w, lv, pt.z - d.x * w);
      if (row > 0) {
        const a = (row - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      row++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    meshes.push(new THREE.Mesh(geo, mat));
  }
  return meshes;
}

function buildTrees(t: HoleTerrain): THREE.Group {
  const g = new THREE.Group();
  const pines = t.obstacles.filter((o) => o.kind !== 'gorse');
  const gorse = t.obstacles.filter((o) => o.kind === 'gorse');
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const rng = makeRng(t.spec.number * 17);

  if (pines.length) {
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.22, 1, 6).translate(0, 0.5, 0);
    const coneGeo = new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#5b4330' }), pines.length);
    const foliageMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const lower = new THREE.InstancedMesh(coneGeo, foliageMat, pines.length);
    const upper = new THREE.InstancedMesh(coneGeo, foliageMat, pines.length);
    const col = new THREE.Color();
    pines.forEach((o, i) => {
      q.setFromAxisAngle(up, o.rot);
      m4.compose(new THREE.Vector3(o.x, o.baseY - 0.2, o.z), q, new THREE.Vector3(1, o.canopyBottom + 1.2, 1));
      trunks.setMatrixAt(i, m4);
      const h = o.height - o.canopyBottom;
      m4.compose(new THREE.Vector3(o.x, o.baseY + o.canopyBottom, o.z), q, new THREE.Vector3(o.radius, h * 0.65, o.radius));
      lower.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(o.x, o.baseY + o.canopyBottom + h * 0.42, o.z), q, new THREE.Vector3(o.radius * 0.7, h * 0.58, o.radius * 0.7));
      upper.setMatrixAt(i, m4);
      col.setHSL(0.3 + rng() * 0.05, 0.4, 0.2 + rng() * 0.06);
      lower.setColorAt(i, col);
      upper.setColorAt(i, col.multiplyScalar(1.1));
    });
    for (const m of [trunks, lower, upper]) {
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
  }

  if (gorse.length) {
    const geo = new THREE.IcosahedronGeometry(1, 1).translate(0, 0.55, 0);
    // Jitter vertices for a scrubby silhouette.
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const s = 0.85 + ((Math.sin(k * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.3;
      pos.setXYZ(k, pos.getX(k) * s, pos.getY(k) * s, pos.getZ(k) * s);
    }
    geo.computeVertexNormals();
    const bushes = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), gorse.length);
    const col = new THREE.Color();
    gorse.forEach((o, i) => {
      q.setFromAxisAngle(up, o.rot);
      m4.compose(new THREE.Vector3(o.x, o.baseY - 0.25, o.z), q, new THREE.Vector3(o.radius, o.height, o.radius));
      bushes.setMatrixAt(i, m4);
      // Some bushes in yellow bloom.
      if (rng() < 0.35) col.setHSL(0.13, 0.75, 0.45 + rng() * 0.08);
      else col.setHSL(0.25 + rng() * 0.04, 0.45, 0.2 + rng() * 0.05);
      bushes.setColorAt(i, col);
    });
    bushes.castShadow = true;
    bushes.receiveShadow = true;
    g.add(bushes);
  }
  return g;
}

function buildTeeMarkers(t: HoleTerrain): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.12, 12, 8);
  const mat = new THREE.MeshLambertMaterial({ color: '#2a62c9' });
  const right = { x: -t.teeDir.z, z: t.teeDir.x };
  for (const side of [-1, 1]) {
    const x = t.tee.x + right.x * 3 * side + t.teeDir.x * 1.5;
    const z = t.tee.z + right.z * 3 * side + t.teeDir.z * 1.5;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, t.heightAt(x, z) + 0.1, z);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

function buildObStakes(t: HoleTerrain): THREE.InstancedMesh | null {
  const ob = t.spec.ob;
  if (!ob) return null;
  const pts: { x: number; z: number }[] = [];
  for (const [side, dist] of [
    [1, ob.right],
    [-1, ob.left],
  ] as const) {
    if (dist === undefined) continue;
    for (let s = 0; s < t.length + 30; s += 12) {
      const p = t.centerline.pointAt(s);
      const d = t.centerline.dirAt(s);
      pts.push({ x: p.x - d.z * dist * side, z: p.z + d.x * dist * side });
    }
  }
  const geo = new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6).translate(0, 0.6, 0);
  const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#f4f4f4' }), pts.length);
  const m4 = new THREE.Matrix4();
  pts.forEach((p, i) => {
    m4.makeTranslation(p.x, t.heightAt(p.x, p.z), p.z);
    m.setMatrixAt(i, m4);
  });
  m.castShadow = true;
  return m;
}

function buildPin(t: HoleTerrain): { pin: THREE.Group; flag: THREE.Mesh; flagBaseY: number } {
  const g = new THREE.Group();
  const y = t.heightAt(t.cup.x, t.cup.z);
  // Cup: dark hole with a white liner ring.
  const cup = new THREE.Mesh(new THREE.CircleGeometry(CUP_RADIUS, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#111' }));
  cup.position.set(t.cup.x, y + 0.004, t.cup.z);
  g.add(cup);
  const liner = new THREE.Mesh(
    new THREE.RingGeometry(CUP_RADIUS, CUP_RADIUS + 0.012, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#f2f2f2' }),
  );
  liner.position.copy(cup.position);
  g.add(liner);

  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.3, 8).translate(0, 1.15, 0), new THREE.MeshLambertMaterial({ color: '#f5f5f0' }));
  stick.position.set(t.cup.x, y, t.cup.z);
  stick.castShadow = true;
  g.add(stick);

  const flagGeo = new THREE.PlaneGeometry(0.62, 0.42, 12, 4).translate(0.31, 0, 0);
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshLambertMaterial({ color: '#d42a2a', side: THREE.DoubleSide }));
  flag.position.set(t.cup.x, y + 2.05, t.cup.z);
  flag.castShadow = true;
  flag.userData.base = (flagGeo.attributes.position.array as Float32Array).slice();
  g.add(flag);
  return { pin: g, flag, flagBaseY: y };
}

/** Wave the flag in the wind. Call each frame. */
export function animateFlag(flag: THREE.Mesh, time: number, windX: number, windZ: number): void {
  const speed = Math.hypot(windX, windZ);
  flag.rotation.y = Math.atan2(-windZ, windX);
  const base = flag.userData.base as Float32Array;
  const pos = flag.geometry.attributes.position as THREE.BufferAttribute;
  const amp = 0.03 + Math.min(speed, 12) * 0.008;
  const droop = Math.max(0, 1 - speed / 4);
  for (let k = 0; k < pos.count; k++) {
    const x = base[k * 3];
    const y = base[k * 3 + 1];
    const wave = Math.sin(x * 9 - time * (4 + speed * 0.6)) * amp * (x / 0.62);
    // In still air the flag hangs down along the pole.
    const hang = droop * x;
    pos.setXYZ(k, x * (1 - droop * 0.75), y - hang * 0.6, wave);
  }
  pos.needsUpdate = true;
  flag.geometry.computeVertexNormals();
}
