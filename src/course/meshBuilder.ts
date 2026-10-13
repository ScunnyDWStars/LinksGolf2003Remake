import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CUP_RADIUS } from '../physics/constants';
import type { SurfaceType } from '../physics/surfaces';
import { addSway, crownGeometry, makeCrownMaterial, pineGeometry, trunkGeometry } from '../render/Foliage';
import { buildGallery } from '../render/Gallery';
import { makeTerrainMaterial } from '../render/TerrainMaterial';
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
export function buildHoleMeshes(t: PlayableHole, opts: { leafCards?: boolean } = {}): HoleMeshes {
  const group = new THREE.Group();
  group.name = `hole-${t.info.number}`;
  detailTex ??= makeDetailTexture();

  group.add(buildTerrainMesh(t));
  group.add(buildSurroundings(t));
  for (const w of buildWater(t)) group.add(w);
  group.add(buildTrees(t, opts.leafCards ?? true));
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
    case 'tee':
      // Mowing stripes are drawn by the terrain shader (they depend on the viewing angle).
      out.multiplyScalar(1 + n * 0.04);
      break;
    case 'green':
      out.multiplyScalar(1 + n * 0.02);
      break;
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

/** Mowing direction and signed stripe strength, plus surface weights (sand, soil, long grass, fine turf). */
function turfFor(t: PlayableHole, x: number, z: number, mow: Float32Array, surf: Float32Array, k: number): void {
  const s = t.surfaceAt(x, z);
  let mx = 0;
  let mz = 0;
  let ms = 0;
  if (s === 'fairway' || s === 'tee') {
    const along = t.progress(x, z);
    const d = t.centerline.dirAt(along);
    mx = d.x;
    mz = d.z;
    ms = Math.floor(along / 9) % 2 === 0 ? 1 : -1;
  } else if (s === 'green' || s === 'fringe') {
    // Greens are cut in a criss-cross: alternate squares lean opposite ways.
    const a = Math.floor((x + z) / 3.2) % 2 === 0;
    const b = Math.floor((x - z) / 3.2) % 2 === 0;
    mx = Math.SQRT1_2;
    mz = Math.SQRT1_2;
    ms = (a !== b ? 1 : -1) * (s === 'green' ? 0.75 : 0.35);
  }
  mow[k * 3] = mx;
  mow[k * 3 + 1] = mz;
  mow[k * 3 + 2] = ms;
  const sand = s === 'sand' ? 1 : 0;
  const soil = s === 'path' ? 1 : (s === 'deepRough' || s === 'ob') && t.inWoods(x, z) ? 0.8 : 0;
  const longGrass = s === 'rough' ? 0.6 : s === 'deepRough' || s === 'ob' ? 1 : s === 'fringe' ? 0.25 : 0;
  const fine = s === 'green' ? 1 : s === 'fringe' ? 0.5 : s === 'fairway' || s === 'tee' ? 0.2 : 0;
  surf.set([sand, soil, longGrass, fine], k * 4);
}

function buildTerrainMesh(t: PlayableHole): THREE.Mesh {
  const { nx, nz } = t;
  const positions = new Float32Array(nx * nz * 3);
  const colors = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);
  const mow = new Float32Array(nx * nz * 3);
  const surf = new Float32Array(nx * nz * 4);
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
      turfFor(t, x, z, mow, surf, k);
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
  geo.setAttribute('aMow', new THREE.BufferAttribute(mow, 3));
  geo.setAttribute('aSurf', new THREE.BufferAttribute(surf, 4));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  const mat = makeTerrainMaterial();
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
  const land = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: detailTex }));
  land.receiveShadow = true;
  g.add(land);

  if (parkland) return g;
  const seaGeo = new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2);
  seaGeo.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(seaGeo.attributes.position.count).fill(12), 1));
  const sea = new THREE.Mesh(seaGeo, makeWaterMaterial(new THREE.Color('#0e3a52'), new THREE.Color('#2d6f82'), 3));
  sea.position.set(cx, -1.6, cz);
  sea.renderOrder = -1;
  g.add(sea);
  return g;
}

/** Per-vertex water depth (surface minus ground), which drives colour, see-through shallows and foam. */
function withDepth(t: PlayableHole, geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const depth = new Float32Array(pos.count);
  for (let k = 0; k < pos.count; k++) depth[k] = pos.getY(k) - t.heightAt(pos.getX(k), pos.getZ(k));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  return geo;
}

/** Quads of a regular grid where `level(i, j)` is defined at all four corners. */
function gridMesh(nx: number, nz: number, x0: number, z0: number, step: number, level: (i: number, j: number) => number): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const idx: number[] = [];
  const vid = new Int32Array(nx * nz).fill(-1);
  const vert = (i: number, j: number) => {
    const k = j * nx + i;
    if (vid[k] < 0) {
      vid[k] = pos.length / 3;
      pos.push(x0 + i * step, level(i, j), z0 + j * step);
    }
    return vid[k];
  };
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      if ([level(i, j), level(i + 1, j), level(i, j + 1), level(i + 1, j + 1)].some(Number.isNaN)) continue;
      const a = vert(i, j);
      const b = vert(i + 1, j);
      const c = vert(i, j + 1);
      const d = vert(i + 1, j + 1);
      idx.push(a, c, b, b, c, d);
    }
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

function insidePolygon(x: number, z: number, poly: { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function buildWater(t: PlayableHole): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  const mat = makeWaterMaterial();
  mat.side = THREE.DoubleSide;
  for (const w of t.waterSurfaces()) {
    let geo: THREE.BufferGeometry | null = null;
    if (w.kind === 'grid') {
      geo = gridMesh(w.nx, w.nz, w.minX, w.minZ, w.step, (i, j) => w.level[j * w.nx + i]);
    } else if (w.kind === 'polygon') {
      if (w.outline.length < 3) continue;
      // A 1 m grid clipped to the outline, so depth (and foam) varies across the pond.
      const xs = w.outline.map((p) => p.x);
      const zs = w.outline.map((p) => p.z);
      const x0 = Math.floor(Math.min(...xs)) - 1;
      const z0 = Math.floor(Math.min(...zs)) - 1;
      const nx = Math.ceil(Math.max(...xs) - x0) + 2;
      const nz = Math.ceil(Math.max(...zs) - z0) + 2;
      geo = gridMesh(nx, nz, x0, z0, 1, (i, j) => (insidePolygon(x0 + i, z0 + j, w.outline) ? w.level : NaN));
    } else {
      // Streams: a ribbon five vertices across, following the bed's level.
      const verts: number[] = [];
      const idx: number[] = [];
      const COLS = 5;
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
        for (let c = 0; c < COLS; c++) {
          const u = (c / (COLS - 1)) * 2 - 1;
          verts.push(pt.x - dz * w.halfWidth * u, pt.level, pt.z + dx * w.halfWidth * u);
        }
        if (row > 0) {
          const r0 = (row - 1) * COLS;
          const r1 = row * COLS;
          for (let c = 0; c < COLS - 1; c++) idx.push(r0 + c, r0 + c + 1, r1 + c, r0 + c + 1, r1 + c + 1, r1 + c);
        }
        row++;
      }
      if (row < 2) continue;
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(idx);
    }
    if (geo) meshes.push(new THREE.Mesh(withDepth(t, geo), mat));
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

function buildTrees(t: PlayableHole, leafCards: boolean): THREE.Group {
  const g = new THREE.Group();
  const pines = t.obstacles.filter((o) => o.kind === 'pine');
  const broadleaf = t.obstacles.filter((o) => o.kind === 'oak' || o.kind === 'birch');
  const gorse = t.obstacles.filter((o) => o.kind === 'gorse');
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const rng = makeRng(t.info.number * 17);
  const col = new THREE.Color();
  const crownColor = (birch: boolean) =>
    birch ? col.setHSL(0.19 + rng() * 0.04, 0.5, 0.28 + rng() * 0.05) : col.setHSL(0.22 + rng() * 0.07, 0.45 + rng() * 0.18, 0.17 + rng() * 0.07);

  if (broadleaf.length) {
    const trunks = new THREE.InstancedMesh(trunkGeometry(), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 }), broadleaf.length);
    broadleaf.forEach((o, i) => {
      q.setFromAxisAngle(up, o.rot);
      const w = o.kind === 'birch' ? 0.7 : 1.15;
      m4.compose(new THREE.Vector3(o.x, o.baseY - 0.2, o.z), q, new THREE.Vector3(w, o.canopyBottom + 2.2, w));
      trunks.setMatrixAt(i, m4);
      trunks.setColorAt(i, col.set(o.kind === 'birch' ? '#d9d4c8' : '#4a3626'));
    });
    trunks.castShadow = true;
    trunks.receiveShadow = true;
    g.add(trunks);

    const near = broadleaf.filter((o) => !o.deep);
    const deep = broadleaf.filter((o) => o.deep);
    const place = (o: (typeof broadleaf)[number], scale: number) => {
      q.setFromAxisAngle(up, o.rot);
      const r0 = o.kind === 'birch' ? o.radius * 0.8 : o.radius;
      // Rounded crowns (about as tall as they are wide), topping out at the tree's height.
      const h = Math.min(o.height - o.canopyBottom + 0.6, r0 * (o.kind === 'birch' ? 2.6 : 2.1));
      const base = o.baseY + o.height - h;
      m4.compose(new THREE.Vector3(o.x, base + (h * (1 - scale)) / 2, o.z), q, new THREE.Vector3(r0 * scale, h * scale, r0 * scale));
    };
    // Dense core so crowns aren't see-through, then leaf cards for the ragged, airy outline.
    const coreMat = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.9, envMapIntensity: 0.5 });
    addSway(coreMat, 0.12);
    for (const [list, detail, shadows] of [
      [near, 1, true],
      [deep, 0, false],
    ] as const) {
      if (!list.length) continue;
      const cores = new THREE.InstancedMesh(canopyGeometry(detail), coreMat, list.length);
      const colors: THREE.Color[] = [];
      list.forEach((o, i) => {
        place(o, leafCards && !o.deep ? 0.82 : 1);
        cores.setMatrixAt(i, m4);
        const c = crownColor(o.kind === 'birch').clone();
        colors.push(c);
        cores.setColorAt(i, c.clone().multiplyScalar(0.8));
      });
      cores.castShadow = shadows;
      cores.receiveShadow = true;
      g.add(cores);
      if (leafCards && detail === 1) {
        const cards = new THREE.InstancedMesh(crownGeometry(), makeCrownMaterial(), list.length);
        list.forEach((o, i) => {
          place(o, 1.08);
          cards.setMatrixAt(i, m4);
          cards.setColorAt(i, colors[i]);
        });
        cards.castShadow = true;
        cards.receiveShadow = true;
        cards.userData.noAO = true;
        g.add(cards);
      }
    }
  }

  if (pines.length) {
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.22, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#4d3826', roughness: 0.95 }), pines.length);
    const needleMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, side: THREE.DoubleSide, envMapIntensity: 0.5 });
    addSway(needleMat, 0.08);
    const crowns = new THREE.InstancedMesh(pineGeometry(), needleMat, pines.length);
    pines.forEach((o, i) => {
      q.setFromAxisAngle(up, o.rot);
      m4.compose(new THREE.Vector3(o.x, o.baseY - 0.2, o.z), q, new THREE.Vector3(1, o.canopyBottom + 1.6, 1));
      trunks.setMatrixAt(i, m4);
      const h = o.height - o.canopyBottom + 0.4;
      m4.compose(new THREE.Vector3(o.x, o.baseY + o.canopyBottom - 0.4, o.z), q, new THREE.Vector3(o.radius, h, o.radius));
      crowns.setMatrixAt(i, m4);
      crowns.setColorAt(i, col.setHSL(0.33 + rng() * 0.05, 0.42, 0.11 + rng() * 0.05));
    });
    for (const m of [trunks, crowns]) {
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
  }

  if (gorse.length) {
    const geo = new THREE.IcosahedronGeometry(1, 2).translate(0, 0.55, 0);
    // Jitter vertices for a scrubby silhouette.
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const s = 0.82 + ((Math.sin(k * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.36;
      pos.setXYZ(k, pos.getX(k) * s, pos.getY(k) * s, pos.getZ(k) * s);
    }
    geo.computeVertexNormals();
    const bushMat = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.9 });
    addSway(bushMat, 0.05);
    const bushes = new THREE.InstancedMesh(geo, bushMat, gorse.length);
    gorse.forEach((o, i) => {
      q.setFromAxisAngle(up, o.rot);
      m4.compose(new THREE.Vector3(o.x, o.baseY - 0.25, o.z), q, new THREE.Vector3(o.radius, o.height, o.radius));
      bushes.setMatrixAt(i, m4);
      // Some bushes in yellow bloom.
      if (rng() < 0.35) col.setHSL(0.13, 0.78, 0.38 + rng() * 0.08);
      else col.setHSL(0.25 + rng() * 0.04, 0.45, 0.13 + rng() * 0.05);
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
  const mat = new THREE.MeshStandardMaterial({ color: '#2a62c9' });
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
  const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#f4f4f4' }), pts.length);
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

  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.3, 8).translate(0, 1.15, 0), new THREE.MeshStandardMaterial({ color: '#f5f5f0' }));
  stick.position.set(t.cup.x, y, t.cup.z);
  stick.castShadow = true;
  g.add(stick);

  const flagGeo = new THREE.PlaneGeometry(0.62, 0.42, 12, 4).translate(0.31, 0, 0);
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: '#d42a2a', side: THREE.DoubleSide }));
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
