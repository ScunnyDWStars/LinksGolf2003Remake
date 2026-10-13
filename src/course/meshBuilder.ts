import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CUP_RADIUS } from '../physics/constants';
import type { SurfaceType } from '../physics/surfaces';
import { buildGallery } from '../render/Gallery';
import { makeDetailTexture, makeWaterMaterial } from '../render/materials';
import { clamp, smoothstep } from '../util/math';
import { makeRng } from '../util/rng';
import { GRID_STEP, type PlayableHole } from './hole';

type Palette = Record<SurfaceType, THREE.Color>;

const LINKS: Palette = {
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

/** Lush, watered parkland greens with a dark woodland floor under the trees. */
const PARKLAND: Palette = {
  tee: new THREE.Color('#6fb441'),
  fairway: new THREE.Color('#69b03d'),
  fringe: new THREE.Color('#62ad3e'),
  green: new THREE.Color('#79c94f'),
  rough: new THREE.Color('#4f8c2e'),
  deepRough: new THREE.Color('#3e6a24'),
  sand: new THREE.Color('#ece0bd'),
  water: new THREE.Color('#3f5a46'),
  path: new THREE.Color('#c9c4b8'),
  ob: new THREE.Color('#3e6a24'),
};

const paletteFor = (t: PlayableHole): Palette => (t.style === 'parkland' ? PARKLAND : LINKS);

let detailTex: THREE.CanvasTexture | null = null;

export interface HoleMeshes {
  group: THREE.Group;
  flag: THREE.Mesh;
  flagBaseY: number;
  dispose(): void;
}

/** Build every visual for one hole. */
export function buildHoleMeshes(t: PlayableHole): HoleMeshes {
  const group = new THREE.Group();
  group.name = `hole-${t.info.number}`;
  detailTex ??= makeDetailTexture();

  group.add(buildTerrainMesh(t));
  group.add(buildSurroundings(t));
  for (const w of buildWater(t)) group.add(w);
  group.add(buildTrees(t));
  group.add(buildTeeMarkers(t));
  group.add(buildGallery(t));
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

function colorFor(t: PlayableHole, x: number, z: number, out: THREE.Color): THREE.Color {
  const surf = t.surfaceAt(x, z);
  const BASE = paletteFor(t);
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
      if (t.style === 'parkland' && !t.inWoods(x, z)) {
        // Longer grass beyond the first cut.
        out.copy(BASE.rough).multiplyScalar(0.86 * (1 + n * 0.1));
        break;
      }
      if (t.style === 'parkland') {
        // Woodland floor: mossy greens with brown leaf litter.
        const patch = t.noise.fbm(x / 14, z / 14, 3);
        out.lerp(new THREE.Color('#5a5230'), clamp(0.25 + patch * 0.7, 0, 0.6));
        out.multiplyScalar(1 + n * 0.12);
        break;
      }
      // Fescue: golden with green patches.
      const patch = t.noise.fbm(x / 25, z / 25, 3);
      out.lerp(BASE.rough, clamp(0.45 + patch * 0.9, 0, 1));
      out.multiplyScalar(1 + n * 0.15);
      break;
    }
    case 'sand':
      out.multiplyScalar(1 + n * 0.05);
      break;
    case 'path':
      out.multiplyScalar(1 + n * 0.06);
      break;
    default:
      break;
  }
  return out;
}

function buildTerrainMesh(t: PlayableHole): THREE.Mesh {
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
function buildSurroundings(t: PlayableHole): THREE.Group {
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
  const parkland = t.style === 'parkland';
  const canopyDark = new THREE.Color('#284d1d');
  const canopyLight = new THREE.Color('#4a7a2e');
  for (let k = 0; k < pos.count; k++) {
    if (parkland) {
      const x = pos.getX(k);
      const z = pos.getZ(k);
      const ox = Math.max(t.minX - x, 0, x - t.maxX);
      const oz = Math.max(t.minZ - z, 0, z - t.maxZ);
      const out = Math.hypot(ox, oz);
      // Wooded hills rolling away to the horizon (or the real land around a mapped course).
      const n = t.noise.fbm(x / 160 + 300, z / 160, 4);
      const real = t.farHeight(x, z);
      let h = real !== null ? real - 0.4 : t.edgeHeight + 2 + (n * 22 + 12) * smoothstep(0, 400, out) + 8 * smoothstep(0, 60, out);
      if (out < 1) h = Math.min(h, t.edgeHeight) - 1.2;
      pos.setY(k, h);
      const lumpy = t.noise.noise(x / 11, z / 11);
      c.copy(canopyDark).lerp(canopyLight, clamp(0.45 + lumpy * 0.7 + n * 0.3, 0, 1));
      colors.set([c.r, c.g, c.b], k * 3);
      continue;
    }
    const x = pos.getX(k);
    const z = pos.getZ(k);
    // Distance outside the playable patch.
    const ox = Math.max(t.minX - x, 0, x - t.maxX);
    const oz = Math.max(t.minZ - z, 0, z - t.maxZ);
    const out = Math.hypot(ox, oz);
    const n = t.noise.fbm(x / 70 + 300, z / 70, 4);
    const real = t.farHeight(x, z);
    let h = real !== null ? real - 0.4 : t.edgeHeight - 0.6 + (Math.abs(n) * 9 + n * 3) * smoothstep(0, 120, out);
    // Toward the sea the land drops to a beach.
    const seaDist = (x - t.maxX) * seaSide - 260;
    if (real === null) h -= smoothstep(-40, 140, seaDist) * (h + 3.5);
    if (out < 1) h = t.edgeHeight - 1.2;
    pos.setY(k, h);
    c.copy(fescue).lerp(grass, clamp(0.5 + n, 0, 1));
    if (real === null && seaDist > -20) c.lerp(duneSand, smoothstep(-20, 60, seaDist));
    c.multiplyScalar(1 + t.noise.noise(x / 9, z / 9) * 0.08);
    colors.set([c.r, c.g, c.b], k * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const land = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTex }));
  land.receiveShadow = true;
  g.add(land);

  if (parkland) return g;
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), makeWaterMaterial(new THREE.Color('#1d4e66'), new THREE.Color('#3b7f93')));
  sea.position.set(cx, -1.6, cz);
  sea.renderOrder = -1;
  g.add(sea);
  return g;
}

function buildWater(t: PlayableHole): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  const mat = makeWaterMaterial();
  mat.side = THREE.DoubleSide;
  for (const w of t.waterSurfaces()) {
    if (w.kind === 'grid') {
      const pos: number[] = [];
      const idx: number[] = [];
      const vid = new Int32Array(w.nx * w.nz).fill(-1);
      const vert = (i: number, j: number) => {
        const k = j * w.nx + i;
        if (vid[k] < 0) {
          vid[k] = pos.length / 3;
          pos.push(w.minX + i * w.step, w.level[k], w.minZ + j * w.step);
        }
        return vid[k];
      };
      for (let j = 0; j < w.nz - 1; j++) {
        for (let i = 0; i < w.nx - 1; i++) {
          const k = j * w.nx + i;
          if (Number.isNaN(w.level[k]) || Number.isNaN(w.level[k + 1]) || Number.isNaN(w.level[k + w.nx]) || Number.isNaN(w.level[k + w.nx + 1])) continue;
          const a = vert(i, j);
          const b = vert(i + 1, j);
          const c = vert(i, j + 1);
          const d = vert(i + 1, j + 1);
          idx.push(a, c, b, b, c, d);
        }
      }
      if (!idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      meshes.push(new THREE.Mesh(geo, mat));
      continue;
    }
    if (w.kind === 'polygon') {
      if (w.outline.length < 3) continue;
      // Shape works in x/y; map world z to -y so rotating -90° about X lands it back on z.
      const shape = new THREE.Shape(w.outline.map((p) => new THREE.Vector2(p.x, -p.z)));
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, w.level, 0);
      meshes.push(new THREE.Mesh(geo, mat));
      continue;
    }
    const verts: number[] = [];
    const idx: number[] = [];
    let row = 0;
    for (let k = 0; k < w.points.length; k++) {
      const pt = w.points[k];
      // Only inside the playable patch; beyond it the outer land sits lower and the ribbon would float.
      if (pt.x < t.minX + 2 || pt.x > t.maxX - 2 || pt.z < t.minZ + 2 || pt.z > t.maxZ - 2) continue;
      const a = w.points[Math.max(0, k - 1)];
      const b = w.points[Math.min(w.points.length - 1, k + 1)];
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const dx = (b.x - a.x) / len;
      const dz = (b.z - a.z) / len;
      const hw = w.halfWidth;
      verts.push(pt.x - dz * hw, pt.level, pt.z + dx * hw, pt.x + dz * hw, pt.level, pt.z - dx * hw);
      if (row > 0) {
        const i = (row - 1) * 2;
        idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
      row++;
    }
    if (row < 2) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    meshes.push(new THREE.Mesh(geo, mat));
  }
  return meshes;
}

/** Rounded deciduous canopy: a few merged blobs, darker underneath. Unit size: radius 1, height 1. */
function canopyGeometry(detail: number): THREE.BufferGeometry {
  const blobs: [number, number, number, number][] = [
    [0, 0.55, 0, 0.58],
    [0.42, 0.42, 0.12, 0.45],
    [-0.4, 0.45, -0.1, 0.47],
    [0.05, 0.78, -0.3, 0.42],
    [-0.08, 0.5, 0.42, 0.44],
  ];
  const parts = blobs.map(([x, y, z, r]) => {
    const g = new THREE.IcosahedronGeometry(1, detail);
    g.scale(r * 1.15, r, r * 1.15).translate(x, y, z);
    g.deleteAttribute('uv');
    return g;
  });
  const geo = mergeGeometries(parts)!;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let k = 0; k < pos.count; k++) {
    const shade = 0.55 + 0.6 * clamp(pos.getY(k), 0, 1);
    colors.set([shade, shade, shade], k * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function buildTrees(t: PlayableHole): THREE.Group {
  const g = new THREE.Group();
  const pines = t.obstacles.filter((o) => o.kind === 'pine');
  const broadleaf = t.obstacles.filter((o) => o.kind === 'oak' || o.kind === 'birch');
  const gorse = t.obstacles.filter((o) => o.kind === 'gorse');
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const rng = makeRng(t.info.number * 17);

  if (broadleaf.length) {
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 1, 6).translate(0, 0.5, 0);
    const near = broadleaf.filter((o) => !o.deep);
    const deep = broadleaf.filter((o) => o.deep);
    const trunkMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, broadleaf.length);
    const col = new THREE.Color();
    broadleaf.forEach((o, i) => {
      q.setFromAxisAngle(up, o.rot);
      m4.compose(new THREE.Vector3(o.x, o.baseY - 0.2, o.z), q, new THREE.Vector3(o.kind === 'birch' ? 0.7 : 1.1, o.canopyBottom + 1.6, o.kind === 'birch' ? 0.7 : 1.1));
      trunks.setMatrixAt(i, m4);
      trunks.setColorAt(i, col.set(o.kind === 'birch' ? '#e6e1d6' : '#5a4330'));
    });
    trunks.castShadow = true;
    g.add(trunks);
    const canopyMat = new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true });
    for (const [list, detail, shadows] of [
      [near, 1, true],
      [deep, 0, false],
    ] as const) {
      if (!list.length) continue;
      const crowns = new THREE.InstancedMesh(canopyGeometry(detail), canopyMat, list.length);
      list.forEach((o, i) => {
        q.setFromAxisAngle(up, o.rot);
        const h = o.height - o.canopyBottom + 0.6;
        const r = o.kind === 'birch' ? o.radius * 0.8 : o.radius;
        m4.compose(new THREE.Vector3(o.x, o.baseY + o.canopyBottom - 0.6, o.z), q, new THREE.Vector3(r, h, r));
        crowns.setMatrixAt(i, m4);
        if (o.kind === 'birch') col.setHSL(0.2 + rng() * 0.04, 0.5, 0.36 + rng() * 0.06);
        else col.setHSL(0.24 + rng() * 0.07, 0.42 + rng() * 0.15, 0.24 + rng() * 0.08);
        crowns.setColorAt(i, col);
      });
      crowns.castShadow = shadows;
      crowns.receiveShadow = shadows;
      g.add(crowns);
    }
  }

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

function buildTeeMarkers(t: PlayableHole): THREE.Group {
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

function buildObStakes(t: PlayableHole): THREE.InstancedMesh | null {
  const pts = t.obStakes();
  if (!pts.length) return null;
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

function buildPin(t: PlayableHole): { pin: THREE.Group; flag: THREE.Mesh; flagBaseY: number } {
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
