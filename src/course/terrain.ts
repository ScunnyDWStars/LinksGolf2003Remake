import { Vector3 } from 'three';
import { BALL_RADIUS } from '../physics/constants';
import type { GroundModel, Obstacle } from '../physics/ground';
import type { SurfaceType } from '../physics/surfaces';
import { clamp, lerp, smoothstep, type Vec2 } from '../util/math';
import { Noise2D } from '../util/noise';
import { makeRng } from '../util/rng';
import { Blob, Polyline, toWorld } from './geometry';
import type { CourseStyle, HoleSpec, TreeCluster } from './types';

export const GRID_STEP = 1; // metres between height samples
const MARGIN = 90; // metres of land around the hole's features
const EDGE_FADE = 45;
const ROUGH_BAND = 11; // first cut beyond the fairway edge
const FRINGE = 1.6; // metres of fringe around the green

export interface Pond {
  blob: Blob;
  level: number;
}

export interface Burn {
  line: Polyline;
  halfWidth: number;
  /** Water level sampled along the burn's arc length every BURN_STEP metres. */
  levels: number[];
}
const BURN_STEP = 4;

export interface Tree extends Obstacle {
  kind: TreeCluster['kind'];
  /** Visual-only rotation/scale jitter. */
  rot: number;
  /** Deep in the woods: rendered with a cheaper mesh and no shadow. */
  deep?: boolean;
}

/**
 * Terrain for one hole: a heightfield on a regular grid, plus analytic surface classification.
 * Heights between grid samples use the same triangle split as the rendered mesh so the ball sits exactly
 * on what you see.
 */
export class HoleTerrain implements GroundModel {
  readonly spec: HoleSpec;
  readonly noise: Noise2D;
  readonly centerline: Polyline;
  readonly green: Blob;
  readonly bunkers: { blob: Blob; depth: number }[];
  readonly ponds: Pond[] = [];
  readonly burns: Burn[] = [];
  readonly mounds: { blob: Blob; height: number }[];
  readonly tee: Vec2;
  readonly teeDir: Vec2;
  readonly cup: { x: number; z: number };
  readonly obstacles: Tree[] = [];
  readonly style: CourseStyle;
  /** Parkland cart path, if any. */
  readonly path: Polyline | null = null;
  private obstacleGrid = new Map<number, Tree[]>();

  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly nx: number;
  readonly nz: number;
  readonly heights: Float32Array;
  readonly edgeHeight: number;

  constructor(spec: HoleSpec, style: CourseStyle = 'links', seed = 1000) {
    this.spec = spec;
    this.style = style;
    this.noise = new Noise2D(seed + spec.number * 101);
    this.centerline = new Polyline(spec.centerline);
    this.green = new Blob(spec.green, this.noise, 0.09, 1);
    this.bunkers = spec.bunkers.map((b, i) => ({ blob: new Blob(b, this.noise, 0.16, 10 + i), depth: b.depth ?? 1.1 }));
    this.mounds = (spec.mounds ?? []).map((m, i) => ({ blob: new Blob(m, this.noise, 0.15, 40 + i), height: m.height }));
    this.tee = toWorld(spec.tee);
    this.teeDir = this.centerline.dirAt(0);
    const g = toWorld(spec.green.at);
    this.cup = { x: g.x + spec.pin[0], z: g.z - spec.pin[1] };
    this.edgeHeight = Math.min(spec.elevation.tee, spec.elevation.green) - 0.5;
    if (style === 'parkland') this.path = this.makeCartPath();

    // Bounds from every feature.
    const xs: number[] = [];
    const zs: number[] = [];
    const add = (p: Vec2, r = 0) => {
      xs.push(p.x - r, p.x + r);
      zs.push(p.z - r, p.z + r);
    };
    this.centerline.pts.forEach((p) => add(p, spec.fairwayWidth / 2 + 25));
    add(g, Math.max(spec.green.rx, spec.green.rz) + 20);
    spec.bunkers.forEach((b) => add(toWorld(b.at), Math.max(b.rx, b.rz)));
    spec.trees.forEach((t) => add(toWorld(t.at), t.radius));
    for (const w of spec.water) {
      if (w.kind === 'pond') add(toWorld(w.at), Math.max(w.rx, w.rz));
    }
    // Burns run edge to edge, so they are left out of the bounds and simply clipped by the patch.
    this.minX = Math.floor(Math.min(...xs) - MARGIN);
    this.maxX = Math.ceil(Math.max(...xs) + MARGIN);
    this.minZ = Math.floor(Math.min(...zs) - MARGIN);
    this.maxZ = Math.ceil(Math.max(...zs) + MARGIN);
    this.nx = Math.round((this.maxX - this.minX) / GRID_STEP) + 1;
    this.nz = Math.round((this.maxZ - this.minZ) / GRID_STEP) + 1;

    // Water bodies need the dry landform to pick their levels.
    spec.water.forEach((w, i) => {
      if (w.kind === 'pond') {
        const blob = new Blob(w, this.noise, 0.12, 20 + i);
        let lo = Infinity;
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          const r = 1.15;
          const lx = Math.cos(a) * w.rx * r;
          const lz = Math.sin(a) * w.rz * r;
          lo = Math.min(lo, this.landHeight(blob.cx + lx, blob.cz + lz));
        }
        this.ponds.push({ blob, level: lo - 0.35 });
      } else {
        const line = new Polyline(w.points, false);
        const levels: number[] = [];
        for (let s = 0; s <= line.length + BURN_STEP; s += BURN_STEP) {
          const p = line.pointAt(s);
          levels.push(this.landHeight(p.x, p.z) - 0.8);
        }
        // Smooth the levels so the water surface doesn't zig-zag.
        for (let pass = 0; pass < 4; pass++) {
          for (let k = 1; k < levels.length - 1; k++) levels[k] = (levels[k - 1] + levels[k] * 2 + levels[k + 1]) / 4;
        }
        this.burns.push({ line, halfWidth: w.width / 2, levels });
      }
    });

    this.heights = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      const z = this.minZ + j * GRID_STEP;
      for (let i = 0; i < this.nx; i++) {
        this.heights[j * this.nx + i] = this.fullHeight(this.minX + i * GRID_STEP, z);
      }
    }

    this.placeTrees();
  }

  // ---------------------------------------------------------------------------------------------
  // Shape helpers

  get length(): number {
    return this.centerline.length;
  }

  fairwayHalfWidth(s: number, side: number): number {
    const base = this.spec.fairwayWidth / 2;
    const w = this.noise.noise(s / 35 + (side > 0 ? 50 : 0), 7.7);
    // Narrow a little toward the green approach and widen in landing zones.
    return base * (1 + 0.16 * w);
  }

  private teeField(x: number, z: number): number {
    const dx = x - this.tee.x;
    const dz = z - this.tee.z;
    const along = dx * this.teeDir.x + dz * this.teeDir.z;
    const across = dx * -this.teeDir.z + dz * this.teeDir.x;
    return Math.max(Math.abs(along + 2) / 8, Math.abs(across) / 4.5);
  }

  private burnInfo(x: number, z: number): { q: number; level: number } | null {
    let best: { q: number; level: number } | null = null;
    for (const b of this.burns) {
      const pr = b.line.project(x, z);
      const q = pr.dist / b.halfWidth;
      if (q < 3 && (!best || q < best.q)) {
        const k = clamp(pr.s / BURN_STEP, 0, b.levels.length - 1);
        const k0 = Math.floor(k);
        const k1 = Math.min(b.levels.length - 1, k0 + 1);
        best = { q, level: lerp(b.levels[k0], b.levels[k1], k - k0) };
      }
    }
    return best;
  }

  /** Natural landform (dunes, fairway roll, tee and green pads, mounds) before hazards are cut in. */
  landHeight(x: number, z: number): number {
    const sp = this.spec;
    const pr = this.centerline.project(x, z);
    const t = clamp(pr.s / this.centerline.length, 0, 1);
    let h = lerp(sp.elevation.tee, sp.elevation.green, smoothstep(0, 1, t));
    const hw = this.fairwayHalfWidth(pr.s, pr.lateral);

    const duneMask = smoothstep(hw - 2, hw + 28, pr.dist);
    const far = smoothstep(hw + 30, hw + 130, pr.dist);
    if (this.style === 'parkland') {
      // Broad rolling hills that carry right through the fairways, with the land rising into the woods.
      const hills = sp.elevation.dunes * this.noise.fbm(x / 120 + 40, z / 120 - 20, 3);
      const swales = 0.9 * this.noise.fbm(x / 45, z / 45, 3);
      h += hills + swales * (1 - duneMask * 0.3) + duneMask * (1.5 + far * 4) * (0.6 + 0.4 * this.noise.fbm(x / 70, z / 70, 2));
    } else {
      const roll = 0.8 * this.noise.fbm(x / 60, z / 60, 3);
      const ridge = 1 - Math.abs(this.noise.fbm(x / 42 + 100, z / 42 - 50, 4));
      const dunes = sp.elevation.dunes * (ridge * ridge * 1.2 - 0.25) * (1 + far * 0.8);
      h += roll * (1 - duneMask * 0.4) + dunes * duneMask;
    }

    for (const m of this.mounds) {
      const q = m.blob.field(x, z);
      if (q < 1) h += m.height * 0.5 * (1 + Math.cos(Math.PI * q));
    }

    // Green pad.
    const gq = this.green.field(x, z);
    if (gq < 2.2) {
      const gc = toWorld(sp.green.at);
      const gh =
        sp.elevation.green +
        0.3 +
        sp.green.slope[0] * (x - gc.x) +
        sp.green.slope[1] * -(z - gc.z) +
        (sp.green.undulation ?? 0.12) * this.noise.fbm(x / 9 + 30, z / 9, 2);
      h = lerp(h, gh, 1 - smoothstep(1.0, 2.0, gq));
    }

    // Tee box.
    const tq = this.teeField(x, z);
    if (tq < 3) h = lerp(h, sp.elevation.tee + 0.4, 1 - smoothstep(1.0, 2.4, tq));

    // Fade to a common height at the patch edge.
    const e = Math.min(x - this.minX, this.maxX - x, z - this.minZ, this.maxZ - z);
    h = lerp(this.edgeHeight, h, smoothstep(0, EDGE_FADE, e));
    return h;
  }

  /** Landform with bunkers and water cut in. */
  fullHeight(x: number, z: number): number {
    let h = this.landHeight(x, z);
    for (const b of this.bunkers) {
      const q = b.blob.field(x, z);
      if (q > 1.4) continue;
      const lip = 0.3 * smoothstep(0.92, 1.05, q) * (1 - smoothstep(1.05, 1.4, q));
      h += lip - b.depth * (1 - smoothstep(0.62, 1.0, q));
    }
    for (const p of this.ponds) {
      const q = p.blob.field(x, z);
      if (q < 1) h = p.level - 0.3 - 1.2 * smoothstep(1, 0.45, q);
      else if (q < 1.45) h = lerp(p.level + 0.08, Math.max(h, p.level + 0.08), smoothstep(1, 1.45, q));
    }
    const bi = this.burnInfo(x, z);
    if (bi) {
      if (bi.q < 1) h = bi.level - 0.25 - 0.6 * (1 - bi.q);
      else if (bi.q < 2.2) h = lerp(bi.level + 0.1, Math.max(h, bi.level + 0.1), smoothstep(1, 2.2, bi.q));
    }
    return h;
  }

  // ---------------------------------------------------------------------------------------------
  // GroundModel

  private sample(i: number, j: number): number {
    i = clamp(i, 0, this.nx - 1);
    j = clamp(j, 0, this.nz - 1);
    return this.heights[j * this.nx + i];
  }

  heightAt(x: number, z: number): number {
    const gx = (x - this.minX) / GRID_STEP;
    const gz = (z - this.minZ) / GRID_STEP;
    const i = clamp(Math.floor(gx), 0, this.nx - 2);
    const j = clamp(Math.floor(gz), 0, this.nz - 2);
    const u = clamp(gx - i, 0, 1);
    const v = clamp(gz - j, 0, 1);
    const h00 = this.sample(i, j);
    const h10 = this.sample(i + 1, j);
    const h01 = this.sample(i, j + 1);
    const h11 = this.sample(i + 1, j + 1);
    // Same diagonal (v10 - v01) as the mesh in meshBuilder.
    if (u + v <= 1) return h00 + u * (h10 - h00) + v * (h01 - h00);
    return h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
  }

  normalAt(x: number, z: number, out: Vector3): Vector3 {
    const e = 0.5;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-dx / (2 * e), 1, -dz / (2 * e)).normalize();
  }

  inBounds(x: number, z: number): boolean {
    return x > this.minX + 4 && x < this.maxX - 4 && z > this.minZ + 4 && z < this.maxZ - 4;
  }

  surfaceAt(x: number, z: number): SurfaceType {
    if (!this.inBounds(x, z)) return 'ob';
    const pr = this.centerline.project(x, z);
    const ob = this.spec.ob;
    if (ob) {
      if (ob.right !== undefined && pr.lateral > ob.right) return 'ob';
      if (ob.left !== undefined && pr.lateral < -ob.left) return 'ob';
    }
    for (const p of this.ponds) if (p.blob.field(x, z) < 1) return 'water';
    const bi = this.burnInfo(x, z);
    if (bi && bi.q < 1) return 'water';
    for (const b of this.bunkers) if (b.blob.field(x, z) < 0.93) return 'sand';
    const gq = this.green.field(x, z);
    if (gq < 1) return 'green';
    const gr = Math.max(this.spec.green.rx, this.spec.green.rz);
    if (gq < 1 + FRINGE / gr) return 'fringe';
    if (this.teeField(x, z) < 1) return 'tee';
    if (this.path && this.path.project(x, z).dist < 1.3) return 'path';
    const hw = this.fairwayHalfWidth(pr.s, pr.lateral);
    if (pr.dist < hw && pr.s >= this.spec.fairwayStart && pr.s <= this.centerline.length + 4) return 'fairway';
    // Short approach apron in front of the green.
    if (gq < 1.6 && pr.s < this.centerline.length && pr.dist < hw) return 'fairway';
    if (pr.dist < hw + ROUGH_BAND && pr.s > -10 && pr.s < this.centerline.length + 25) return 'rough';
    return 'deepRough';
  }

  // ---------------------------------------------------------------------------------------------
  // Gameplay helpers

  teePosition(): Vector3 {
    return new Vector3(this.tee.x, this.heightAt(this.tee.x, this.tee.z) + BALL_RADIUS, this.tee.z);
  }

  cupPosition(): Vector3 {
    return new Vector3(this.cup.x, this.heightAt(this.cup.x, this.cup.z), this.cup.z);
  }

  /** Arc length of the closest centerline point. */
  progress(x: number, z: number): number {
    return this.centerline.project(x, z).s;
  }

  /** Where the caddie suggests aiming for a shot that carries `carry` metres from `from`. */
  suggestedAim(from: Vector3, carry: number): Vec2 {
    const toPin = Math.hypot(this.cup.x - from.x, this.cup.z - from.z);
    if (toPin <= carry * 1.08) return { x: this.cup.x, z: this.cup.z };
    const s0 = this.progress(from.x, from.z);
    // Walk along the centerline until we're `carry` away in a straight line.
    let s = s0;
    for (; s < this.centerline.length; s += 2) {
      const p = this.centerline.pointAt(s);
      if (Math.hypot(p.x - from.x, p.z - from.z) >= carry) break;
    }
    return this.centerline.pointAt(s);
  }

  /** Cart path: from beside the tee, down one side of the hole, to the side of the green. */
  private makeCartPath(): Polyline {
    const side = this.spec.pathSide ?? 1;
    const off = this.spec.fairwayWidth / 2 + 13;
    const pts: Vec2[] = [];
    const L = this.centerline.length;
    const gr = Math.max(this.spec.green.rx, this.spec.green.rz);
    for (let s = 0; s <= L + 6; s += 10) {
      const p = this.centerline.pointAt(Math.max(0, s));
      const d = this.centerline.dirAt(Math.max(0, s));
      // Swing wider past the green so the path stays clear of it.
      const o = s > L - gr - 20 ? Math.max(off, gr + 14) : off;
      const wiggle = 4 * this.noise.noise(s / 60, 3.3);
      pts.push({ x: p.x - d.z * (o + wiggle) * side, z: p.z + d.x * (o + wiggle) * side });
    }
    // Start the path level with the back of the tee box.
    const t0 = pts[0];
    pts.unshift({ x: t0.x - this.teeDir.x * 14, z: t0.z - this.teeDir.z * 14 });
    return new Polyline(pts, false);
  }

  /** Obstacles near a point (3x3 cells of 20 m). */
  obstaclesNear(x: number, z: number): readonly Tree[] {
    const cx = Math.floor(x / 20);
    const cz = Math.floor(z / 20);
    const out: Tree[] = [];
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const cell = this.obstacleGrid.get((cx + i) * 73856093 ^ (cz + j) * 19349663);
        if (cell) for (const t of cell) out.push(t);
      }
    }
    return out;
  }

  private addTree(t: Tree): void {
    this.obstacles.push(t);
    const key = Math.floor(t.x / 20) * 73856093 ^ Math.floor(t.z / 20) * 19349663;
    let cell = this.obstacleGrid.get(key);
    if (!cell) this.obstacleGrid.set(key, (cell = []));
    cell.push(t);
  }

  /** Line the hole with woods (parkland). */
  private plantForest(rng: () => number): void {
    const f = this.spec.forest ?? {};
    const gap = f.gap ?? 6;
    const depth = f.depth ?? 160;
    const density = f.density ?? 1.4; // trees per 100 m²
    const cell = Math.sqrt(100 / density);
    for (let z = this.minZ + 6; z < this.maxZ - 6; z += cell) {
      for (let x = this.minX + 6; x < this.maxX - 6; x += cell) {
        const px = x + (rng() - 0.5) * cell * 0.9;
        const pz = z + (rng() - 0.5) * cell * 0.9;
        const pr = this.centerline.project(px, pz);
        const hw = this.fairwayHalfWidth(pr.s, pr.lateral) + ROUGH_BAND + gap;
        const into = pr.dist - hw;
        if (into < 0 || into > depth + 30 * this.noise.noise(px / 50, pz / 50)) continue;
        // Thin out the edge so the tree line is ragged rather than a wall.
        if (into < 8 && rng() > 0.45 + into * 0.07) continue;
        const surf = this.surfaceAt(px, pz);
        if (surf !== 'deepRough' && surf !== 'rough') continue;
        if (this.path && this.path.project(px, pz).dist < 4) continue;
        if (this.green.field(px, pz) < 2.2 || this.teeField(px, pz) < 2.5) continue;
        if (this.bunkers.some((b) => b.blob.field(px, pz) < 1.5)) continue;
        if (this.ponds.some((p) => p.blob.field(px, pz) < 1.3)) continue;
        if ((this.burnInfo(px, pz)?.q ?? 9) < 2.5) continue;
        const r = rng();
        const kind: Tree['kind'] = r < 0.68 ? 'oak' : r < 0.9 ? 'pine' : 'birch';
        const tree = this.makeTree(px, pz, kind, rng);
        tree.deep = into > 30;
        this.addTree(tree);
      }
    }
  }

  private makeTree(x: number, z: number, kind: Tree['kind'], rng: () => number): Tree {
    const baseY = this.heightAt(x, z);
    switch (kind) {
      case 'gorse':
        return { x, z, baseY, radius: 1.0 + rng() * 0.9, canopyBottom: 0, height: 0.9 + rng() * 0.8, kind, rot: rng() * 6.28 };
      case 'oak':
        return { x, z, baseY, radius: 3.6 + rng() * 2.4, canopyBottom: 2.6 + rng(), height: 11 + rng() * 7, kind, rot: rng() * 6.28 };
      case 'birch':
        return { x, z, baseY, radius: 2.2 + rng(), canopyBottom: 3, height: 10 + rng() * 5, kind, rot: rng() * 6.28 };
      default:
        return { x, z, baseY, radius: 2.4 + rng() * 1.3, canopyBottom: 1.8, height: 9 + rng() * 9, kind, rot: rng() * 6.28 };
    }
  }

  private placeTrees(): void {
    const rng = makeRng(7000 + this.spec.number * 31);
    if (this.style === 'parkland') this.plantForest(rng);
    for (const c of this.spec.trees) {
      const center = toWorld(c.at);
      let placed = 0;
      for (let attempt = 0; attempt < c.count * 6 && placed < c.count; attempt++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * c.radius;
        const x = center.x + Math.cos(a) * r;
        const z = center.z + Math.sin(a) * r;
        const surf = this.surfaceAt(x, z);
        if (surf !== 'deepRough' && surf !== 'rough') continue;
        // Keep a clear corridor around the fairway.
        const pr = this.centerline.project(x, z);
        if (pr.dist < this.spec.fairwayWidth / 2 + 3) continue;
        if (this.path && this.path.project(x, z).dist < 3) continue;
        this.addTree(this.makeTree(x, z, c.kind, rng));
        placed++;
      }
    }
  }
}
