import type { SurfaceType } from '../physics/surfaces';
import { clamp, smoothstep, type Vec2 } from '../util/math';
import { Noise2D } from '../util/noise';
import { hashSeed, makeRng } from '../util/rng';
import { boundingBox, pointInPolygon } from '../mapcourse/courseModel';
import type { Area, CourseData, Lie, Polygon2 } from '../mapcourse/types';
import { Polyline } from './geometry';
import { GRID_STEP, PlayableHole, type GreenShape, type HoleInfo, type Tree, type WaterSurface } from './hole';
import type { CourseStyle } from './types';

const MARGIN = 90; // metres of land around the hole
const SG = 0.5; // surface grid resolution, metres
const ROUGH_BAND = 9; // first cut beside fairways, tees and greens
const FRINGE = 1.6;

// Surface codes in the raster, in paint order (later wins).
const OB = 0;
const DEEP = 1;
const ROUGH = 2;
const FAIRWAY = 3;
const TEE = 4;
const GREEN = 5;
const SAND = 6;
const WATER = 7;
const FRINGE_CODE = 8;
const CODE_SURFACE: SurfaceType[] = ['ob', 'deepRough', 'rough', 'fairway', 'tee', 'green', 'sand', 'water', 'fringe'];
const LIE_CODE: Record<Lie, number> = { rough: ROUGH, fairway: FAIRWAY, tee: TEE, green: GREEN, bunker: SAND, water: WATER, 'out-of-bounds': OB };

/** Fill polygons (even-odd, so inner rings cut holes) into a raster. */
function fillRings(
  rings: Polygon2[],
  w: number,
  h: number,
  x0: number,
  z0: number,
  cell: number,
  paint: (index: number) => void,
): void {
  const xs: number[] = [];
  let zLo = Infinity;
  let zHi = -Infinity;
  for (const r of rings) for (const [, z] of r) (zLo = Math.min(zLo, z)), (zHi = Math.max(zHi, z));
  const j0 = Math.max(0, Math.floor((zLo - z0) / cell));
  const j1 = Math.min(h - 1, Math.ceil((zHi - z0) / cell));
  for (let j = j0; j <= j1; j++) {
    const z = z0 + j * cell;
    xs.length = 0;
    for (const r of rings) {
      for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
        const [xa, za] = r[a];
        const [xb, zb] = r[b];
        if (za > z !== zb > z) xs.push(xa + ((z - za) / (zb - za)) * (xb - xa));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / cell));
      const i1 = Math.min(w - 1, Math.floor((xs[k + 1] - x0) / cell));
      for (let i = i0; i <= i1; i++) paint(j * w + i);
    }
  }
}

/** Approximate Euclidean distance (in cells) to the nearest cell where `isSource` holds. Two-pass chamfer. */
function distanceField(w: number, h: number, isSource: (i: number) => boolean, cap = 1e9): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = isSource(i) ? 0 : cap;
  const D = Math.SQRT2;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + 1);
      if (j > 0) {
        v = Math.min(v, d[k - w] + 1);
        if (i > 0) v = Math.min(v, d[k - w - 1] + D);
        if (i < w - 1) v = Math.min(v, d[k - w + 1] + D);
      }
      d[k] = v;
    }
  }
  for (let j = h - 1; j >= 0; j--) {
    for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i;
      let v = d[k];
      if (i < w - 1) v = Math.min(v, d[k + 1] + 1);
      if (j < h - 1) {
        v = Math.min(v, d[k + w] + 1);
        if (i < w - 1) v = Math.min(v, d[k + w + 1] + D);
        if (i > 0) v = Math.min(v, d[k + w - 1] + D);
      }
      d[k] = v;
    }
  }
  return d;
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function polygonArea(poly: Polygon2): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return a / 2;
}

/** A polygon green: signed distance to its outline drives `field`. */
class PolygonGreen implements GreenShape {
  readonly cx: number;
  readonly cz: number;
  readonly radius: number;
  private readonly box: [number, number, number, number];

  constructor(private readonly poly: Polygon2) {
    let sx = 0;
    let sz = 0;
    for (const [x, z] of poly) (sx += x), (sz += z);
    this.cx = sx / poly.length;
    this.cz = sz / poly.length;
    this.radius = Math.max(6, Math.sqrt(Math.abs(polygonArea(poly)) / Math.PI));
    this.box = boundingBox(poly);
  }

  field(x: number, z: number): number {
    const b = this.box;
    // Far away: a cheap approximation is plenty.
    if (x < b[0] - 40 || x > b[2] + 40 || z < b[1] - 40 || z > b[3] + 40) return 1 + Math.hypot(x - this.cx, z - this.cz) / this.radius;
    let d = Infinity;
    const p = this.poly;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) d = Math.min(d, distToSegment(x, z, p[j][0], p[j][1], p[i][0], p[i][1]));
    const inside = pointInPolygon(x, z, p);
    return 1 + ((inside ? -d : d) / this.radius);
  }
}

class CircleGreen implements GreenShape {
  constructor(
    readonly cx: number,
    readonly cz: number,
    readonly radius: number,
  ) {}
  field(x: number, z: number): number {
    return Math.hypot(x - this.cx, z - this.cz) / this.radius;
  }
}

/**
 * One hole of a real course baked from OpenStreetMap + elevation data (the BackyardGolf course format),
 * rebuilt as a 1 m patch so it renders and plays exactly like the authored holes.
 */
export class MappedHoleTerrain extends PlayableHole {
  readonly info: HoleInfo;
  readonly style: CourseStyle;
  readonly noise: Noise2D;
  readonly centerline: Polyline;
  readonly green: GreenShape;
  readonly tee: Vec2;
  readonly teeDir: Vec2;
  readonly cup: { x: number; z: number };
  readonly corridorWidth = 40;

  private readonly course: CourseData;
  private readonly sw: number;
  private readonly sh: number;
  private readonly codes: Uint8Array;
  private readonly woods: Uint8Array;
  private readonly playDist: Float32Array;
  /** Water surface height per 1 m vertex (NaN where dry), one ring wider than the water so banks hide its edge. */
  private waterLevel = new Float32Array(0);

  constructor(course: CourseData, holeIndex: number, style: CourseStyle, info: HoleInfo) {
    super();
    this.course = course;
    this.style = style;
    this.info = info;
    const hole = course.holes[holeIndex];
    this.noise = new Noise2D(hashSeed(course.name) + hole.number * 101);
    this.tee = { x: hole.tee.x, z: hole.tee.z };
    this.cup = { x: hole.pin.x, z: hole.pin.z };
    const line = hole.centerline.length >= 2 ? hole.centerline.map(([x, z]) => ({ x, z })) : [this.tee, this.cup];
    this.centerline = new Polyline(line);
    this.teeDir = this.centerline.dirAt(0);

    // Patch bounds around the hole, kept inside the course's height grid.
    const hf = course.heightfield;
    const pts = [this.tee, this.cup, ...line];
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    const hx0 = hf.originX + hf.cellSize * 2;
    const hz0 = hf.originZ + hf.cellSize * 2;
    const hx1 = hf.originX + (hf.cols - 3) * hf.cellSize;
    const hz1 = hf.originZ + (hf.rows - 3) * hf.cellSize;
    const minX = Math.floor(Math.max(hx0, Math.min(...xs) - MARGIN));
    const maxX = Math.ceil(Math.min(hx1, Math.max(...xs) + MARGIN));
    const minZ = Math.floor(Math.max(hz0, Math.min(...zs) - MARGIN));
    const maxZ = Math.ceil(Math.min(hz1, Math.max(...zs) + MARGIN));
    this.minX = minX;
    this.maxX = maxX;
    this.minZ = minZ;
    this.maxZ = maxZ;

    // --- Surfaces, rasterised once from the map outlines.
    this.sw = Math.ceil((maxX - minX) / SG) + 1;
    this.sh = Math.ceil((maxZ - minZ) / SG) + 1;
    const n = this.sw * this.sh;
    this.codes = new Uint8Array(n); // OB by default
    this.woods = new Uint8Array(n);
    const raster = (rings: Polygon2[], paint: (i: number) => void) => fillRings(rings, this.sw, this.sh, minX, minZ, SG, paint);
    raster([course.bounds], (i) => (this.codes[i] = DEEP));

    const box: [number, number, number, number] = [minX - 5, minZ - 5, maxX + 5, maxZ + 5];
    const overlaps = (p: Polygon2) => {
      const b = boundingBox(p);
      return b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1];
    };
    const areas: Area[] = [...(course.areas ?? []), ...hole.areas].filter((a) => overlaps(a.polygon));
    const waterBodies = areas.filter((a) => a.lie === 'water');
    const waterLabel = new Int16Array(n);
    const order = [ROUGH, FAIRWAY, TEE, GREEN, SAND, WATER];
    for (const code of order) {
      for (const a of areas) {
        if (LIE_CODE[a.lie] !== code) continue;
        const label = code === WATER ? waterBodies.indexOf(a) + 1 : 0;
        raster([a.polygon, ...(a.holes ?? [])], (i) => {
          if (this.codes[i] !== OB || code === WATER) this.codes[i] = code;
          if (label) waterLabel[i] = label;
        });
      }
    }
    for (const w of course.features?.woods ?? []) {
      if (!overlaps(w.polygon)) continue;
      const v = w.kind === 'scrub' ? 2 : 1;
      raster([w.polygon], (i) => (this.woods[i] = v));
    }

    // First cut beside the playing areas, and the fringe around greens.
    const c = this.codes;
    const isPlay = (i: number) => c[i] === FAIRWAY || c[i] === GREEN || c[i] === TEE;
    this.playDist = distanceField(this.sw, this.sh, isPlay, 400);
    const greenDist = distanceField(this.sw, this.sh, (i) => c[i] === GREEN, 40);
    for (let i = 0; i < n; i++) {
      if ((c[i] === DEEP || c[i] === ROUGH || c[i] === FAIRWAY) && greenDist[i] > 0 && greenDist[i] * SG < FRINGE) c[i] = FRINGE_CODE;
      else if (c[i] === DEEP && this.playDist[i] * SG < ROUGH_BAND) c[i] = ROUGH;
    }

    // Green: the mapped green the pin sits on (or the nearest one).
    const greens = areas.filter((a) => a.lie === 'green');
    let greenPoly = greens.find((a) => pointInPolygon(this.cup.x, this.cup.z, a.polygon))?.polygon;
    if (!greenPoly && greens.length) {
      greenPoly = greens
        .map((a) => ({ a, d: Math.min(...a.polygon.map(([x, z]) => Math.hypot(x - this.cup.x, z - this.cup.z))) }))
        .sort((p, q) => p.d - q.d)[0].a.polygon;
    }
    this.green = greenPoly ? new PolygonGreen(greenPoly) : new CircleGreen(this.cup.x, this.cup.z, 12);

    // --- Heights: smooth resample of the course grid, then course shaping at 1 m.
    const sandDepth = distanceField(this.sw, this.sh, (i) => c[i] !== SAND, 20);
    this.buildGrid(minX, maxX, minZ, maxZ, (x, z) => {
      const h = this.courseHeight(x, z);
      const k = this.cellIndex(x, z);
      return c[k] === SAND ? h - 0.6 * smoothstep(0, 2.2, sandDepth[k] * SG) : h;
    });
    this.smoothGreens(greenDist);
    this.shapeWater(waterBodies, waterLabel);
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i < this.nx; i++) (sum += this.heights[i] + this.heights[(this.nz - 1) * this.nx + i]), (cnt += 2);
    this.edgeHeight = sum / cnt;

    this.placeTrees();
  }

  // ---------------------------------------------------------------------------------------------

  private cellIndex(x: number, z: number): number {
    const i = clamp(Math.round((x - this.minX) / SG), 0, this.sw - 1);
    const j = clamp(Math.round((z - this.minZ) / SG), 0, this.sh - 1);
    return j * this.sw + i;
  }

  /** Catmull-Rom sample of the course's 4 m height grid. */
  private courseHeight(x: number, z: number): number {
    const { originX, originZ, cellSize, cols, rows, heights } = this.course.heightfield;
    const gx = clamp((x - originX) / cellSize, 0, cols - 1.000001);
    const gz = clamp((z - originZ) / cellSize, 0, rows - 1.000001);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const at = (c: number, r: number) => heights[clamp(r, 0, rows - 1) * cols + clamp(c, 0, cols - 1)];
    const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
      p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    const row = (r: number) => cr(at(i - 1, r), at(i, r), at(i + 1, r), at(i + 2, r), fx);
    return cr(row(j - 1), row(j), row(j + 1), row(j + 2), fz);
  }

  /**
   * Still water (a pond whose shore is roughly level) sits at one level below its lowest bank. Water on a
   * slope (a creek or burn) follows the ground instead. The bed is dug below the surface and the banks
   * are kept just above it.
   */
  private shapeWater(bodies: Area[], label: Int16Array): void {
    const levels = bodies.map((a) => {
      let lo = Infinity;
      let hi = -Infinity;
      const p = a.polygon;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const L = Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1]);
        for (let t = 0; t < L; t += 2) {
          const u = t / L;
          const h = this.courseHeight(p[j][0] + (p[i][0] - p[j][0]) * u, p[j][1] + (p[i][1] - p[j][1]) * u);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      }
      return { flat: hi - lo < 1.5, level: lo - 0.3 };
    });
    const { nx, nz } = this;
    const level = new Float32Array(nx * nz).fill(NaN);
    const inside = distanceField(this.sw, this.sh, (i) => this.codes[i] !== WATER, 60);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = this.minX + i * GRID_STEP;
        const z = this.minZ + j * GRID_STEP;
        const k = this.cellIndex(x, z);
        if (this.codes[k] !== WATER) continue;
        const v = j * nx + i;
        const body = levels[label[k] - 1];
        const lv = !body ? this.heights[v] - 0.3 : body.flat ? body.level : this.heights[v] - 0.3;
        level[v] = lv;
        this.heights[v] = Math.min(this.heights[v], lv - 0.35 - Math.min(1.2, inside[k] * SG * 0.25));
      }
    }
    // Spread the level a few rings onto the banks: the banks rise above it, and the drawn surface
    // extends one ring under them so the shoreline has no gap.
    let ring = level;
    for (let pass = 0; pass < 3; pass++) {
      const next = ring.slice();
      for (let j = 1; j < nz - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          const v = j * nx + i;
          if (!Number.isNaN(ring[v])) continue;
          let m = -Infinity;
          for (const d of [-1, 1, -nx, nx]) if (!Number.isNaN(ring[v + d])) m = Math.max(m, ring[v + d]);
          if (m > -Infinity) {
            next[v] = m;
            this.heights[v] = Math.max(this.heights[v], m + 0.08 + pass * 0.08);
          }
        }
      }
      ring = next;
      if (pass === 0) this.waterLevel = next.slice();
    }
  }

  /** Map data at grazing DEM resolution leaves greens lumpy; blur them toward a smooth putting surface. */
  private smoothGreens(greenDist: Float32Array): void {
    const { nx, nz } = this;
    const weight = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = this.cellIndex(this.minX + i * GRID_STEP, this.minZ + j * GRID_STEP);
        const d = greenDist[k] * SG;
        weight[j * nx + i] = 1 - smoothstep(1, 5, d);
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      const src = this.heights.slice();
      for (let j = 2; j < nz - 2; j++) {
        for (let i = 2; i < nx - 2; i++) {
          const w = weight[j * nx + i];
          if (w <= 0) continue;
          let s = 0;
          for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) s += src[(j + dj) * nx + i + di];
          this.heights[j * nx + i] = src[j * nx + i] * (1 - w) + (s / 25) * w;
        }
      }
    }
    // Fit a plane through the putting surface and cap its tilt at 3%, keeping a little of the
    // natural contour so greens still break.
    let sw = 0, sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const w = weight[j * nx + i];
        if (w < 0.99) continue;
        const x = i * GRID_STEP;
        const z = j * GRID_STEP;
        const h = this.heights[j * nx + i];
        sw += 1; sx += x; sz += z; sh += h; sxx += x * x; szz += z * z; sxz += x * z; sxh += x * h; szh += z * h;
      }
    }
    if (sw < 12) return;
    const mx = sx / sw, mz = sz / sw, mh = sh / sw;
    const cxx = sxx / sw - mx * mx, czz = szz / sw - mz * mz, cxz = sxz / sw - mx * mz;
    const cxh = sxh / sw - mx * mh, czh = szh / sw - mz * mh;
    const det = cxx * czz - cxz * cxz;
    if (Math.abs(det) < 1e-9) return;
    let gx = (cxh * czz - czh * cxz) / det;
    let gz = (czh * cxx - cxh * cxz) / det;
    const g = Math.hypot(gx, gz);
    const MAX = 0.03;
    if (g > MAX) (gx *= MAX / g), (gz *= MAX / g);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const w = weight[j * nx + i];
        if (w <= 0) continue;
        const k = j * nx + i;
        const plane = mh + gx * (i * GRID_STEP - mx) + gz * (j * GRID_STEP - mz);
        const target = plane + (this.heights[k] - plane) * 0.3;
        this.heights[k] += (target - this.heights[k]) * w;
      }
    }
  }

  private placeTrees(): void {
    const rng = makeRng(hashSeed(`${this.course.name}-${this.info.number}`));
    const f = this.course.features;
    const box = (x: number, z: number) => x > this.minX + 3 && x < this.maxX - 3 && z > this.minZ + 3 && z < this.maxZ - 3;
    const clear = (x: number, z: number) => {
      const s = this.surfaceAt(x, z);
      if (s !== 'deepRough' && s !== 'rough') return false;
      return this.playDist[this.cellIndex(x, z)] * SG > 3;
    };
    const deep = (x: number, z: number) => this.playDist[this.cellIndex(x, z)] * SG > 30;
    const broadleaf = (): Tree['kind'] => {
      const r = rng();
      if (this.style === 'links') return r < 0.75 ? 'pine' : 'birch';
      return r < 0.62 ? 'oak' : r < 0.9 ? 'pine' : 'birch';
    };
    const plant = (x: number, z: number, kind: Tree['kind']) => {
      if (!box(x, z) || !clear(x, z)) return;
      const t = this.makeTree(x, z, kind, rng);
      t.deep = deep(x, z);
      this.addTree(t);
    };
    for (const [x, z] of f?.trees ?? []) plant(x, z, broadleaf());
    for (const row of f?.treeRows ?? []) {
      for (let k = 1; k < row.length; k++) {
        const [ax, az] = row[k - 1];
        const [bx, bz] = row[k];
        const L = Math.hypot(bx - ax, bz - az);
        for (let t = 0; t < L; t += 7) plant(ax + ((bx - ax) * t) / L, az + ((bz - az) * t) / L, broadleaf());
      }
    }
    // Fill woods and scrub on a jittered grid.
    for (const [kind, cell] of [
      [1, 8.5],
      [2, 6.5],
    ] as const) {
      for (let z = this.minZ + 4; z < this.maxZ - 4; z += cell) {
        for (let x = this.minX + 4; x < this.maxX - 4; x += cell) {
          const px = x + (rng() - 0.5) * cell * 0.9;
          const pz = z + (rng() - 0.5) * cell * 0.9;
          if (this.woods[this.cellIndex(px, pz)] !== kind) continue;
          plant(px, pz, kind === 2 ? 'gorse' : broadleaf());
        }
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // PlayableHole

  surfaceAt(x: number, z: number): SurfaceType {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return 'ob';
    return CODE_SURFACE[this.codes[this.cellIndex(x, z)]];
  }

  inWoods(x: number, z: number): boolean {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return false;
    return this.woods[this.cellIndex(x, z)] === 1;
  }

  waterSurfaces(): WaterSurface[] {
    if (!this.waterLevel.some((v) => !Number.isNaN(v))) return [];
    return [{ kind: 'grid', minX: this.minX, minZ: this.minZ, step: GRID_STEP, nx: this.nx, nz: this.nz, level: this.waterLevel }];
  }

  obStakes(): Vec2[] {
    const out: Vec2[] = [];
    const b = this.course.bounds;
    for (let i = 0, j = b.length - 1; i < b.length; j = i++) {
      const L = Math.hypot(b[i][0] - b[j][0], b[i][1] - b[j][1]);
      for (let t = 0; t < L; t += 14) {
        const x = b[j][0] + ((b[i][0] - b[j][0]) * t) / L;
        const z = b[j][1] + ((b[i][1] - b[j][1]) * t) / L;
        if (this.inBounds(x, z)) out.push({ x, z });
      }
    }
    return out;
  }

  farHeight(x: number, z: number): number | null {
    const hf = this.course.heightfield;
    if (x < hf.originX || z < hf.originZ || x > hf.originX + (hf.cols - 1) * hf.cellSize || z > hf.originZ + (hf.rows - 1) * hf.cellSize) {
      return null;
    }
    return this.courseHeight(x, z);
  }
}
