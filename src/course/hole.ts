import { Vector3 } from 'three';
import { BALL_RADIUS } from '../physics/constants';
import type { GroundModel, Obstacle } from '../physics/ground';
import type { SurfaceType } from '../physics/surfaces';
import { clamp, type Vec2 } from '../util/math';
import type { Noise2D } from '../util/noise';
import type { Polyline } from './geometry';
import type { CourseStyle } from './types';

export const GRID_STEP = 1; // metres between height samples

/** What the scorecard, menus and round need to know about a hole. */
export interface HoleInfo {
  number: number;
  name: string;
  par: 3 | 4 | 5;
  handicap: number;
  yards: number;
}

export interface Tree extends Obstacle {
  kind: 'pine' | 'gorse' | 'birch' | 'oak';
  /** Visual-only rotation jitter. */
  rot: number;
  /** Deep in the woods: rendered with a cheaper mesh and no shadow. */
  deep?: boolean;
}

/** The putting surface: centre, rough size, and a field that is < 1 inside and ~1 at the edge. */
export interface GreenShape {
  readonly cx: number;
  readonly cz: number;
  readonly radius: number;
  field(x: number, z: number): number;
}

/** Water to draw: a flat polygon, or a ribbon whose level follows a stream. */
export type WaterSurface =
  | { kind: 'polygon'; outline: Vec2[]; level: number }
  | { kind: 'ribbon'; points: { x: number; z: number; level: number }[]; halfWidth: number }
  /** A sheet over grid cells; NaN where there is no water. */
  | { kind: 'grid'; minX: number; minZ: number; step: number; nx: number; nz: number; level: Float32Array };

/**
 * One playable hole: a 1 m heightfield patch shared by the renderer and the physics, plus surface
 * lookup and the hole's layout. Subclasses build it from authored data (HoleTerrain) or from a real
 * course mapped in OpenStreetMap (MappedHoleTerrain).
 */
export abstract class PlayableHole implements GroundModel {
  abstract readonly info: HoleInfo;
  abstract readonly style: CourseStyle;
  abstract readonly noise: Noise2D;
  abstract readonly centerline: Polyline;
  abstract readonly green: GreenShape;
  abstract readonly tee: Vec2;
  abstract readonly teeDir: Vec2;
  abstract readonly cup: { x: number; z: number };
  /** Typical fairway width, for framing the hole map. */
  abstract readonly corridorWidth: number;

  readonly obstacles: Tree[] = [];
  private readonly obstacleGrid = new Map<number, Tree[]>();

  minX = 0;
  maxX = 0;
  minZ = 0;
  maxZ = 0;
  nx = 0;
  nz = 0;
  heights = new Float32Array(0);
  /** Height the patch fades to at its edge, where the low-detail surroundings take over. */
  edgeHeight = 0;

  abstract surfaceAt(x: number, z: number): SurfaceType;
  abstract waterSurfaces(): WaterSurface[];
  /** Positions of white out-of-bounds stakes. */
  abstract obStakes(): Vec2[];
  /** Under trees (parkland woodland floor rather than grass). */
  abstract inWoods(x: number, z: number): boolean;

  /** Height of the land beyond the patch, if this course knows it (real courses do). */
  farHeight(_x: number, _z: number): number | null {
    return null;
  }

  get length(): number {
    return this.centerline.length;
  }

  /** Allocate the grid and fill it from a height function. */
  protected buildGrid(minX: number, maxX: number, minZ: number, maxZ: number, height: (x: number, z: number) => number): void {
    this.minX = minX;
    this.maxX = maxX;
    this.minZ = minZ;
    this.maxZ = maxZ;
    this.nx = Math.round((maxX - minX) / GRID_STEP) + 1;
    this.nz = Math.round((maxZ - minZ) / GRID_STEP) + 1;
    this.heights = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      const z = minZ + j * GRID_STEP;
      for (let i = 0; i < this.nx; i++) this.heights[j * this.nx + i] = height(minX + i * GRID_STEP, z);
    }
  }

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

  /** Obstacles near a point (3x3 cells of 20 m). */
  obstaclesNear(x: number, z: number): readonly Tree[] {
    const cx = Math.floor(x / 20);
    const cz = Math.floor(z / 20);
    const out: Tree[] = [];
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const cell = this.obstacleGrid.get(((cx + i) * 73856093) ^ ((cz + j) * 19349663));
        if (cell) for (const t of cell) out.push(t);
      }
    }
    return out;
  }

  protected addTree(t: Tree): void {
    this.obstacles.push(t);
    const key = (Math.floor(t.x / 20) * 73856093) ^ (Math.floor(t.z / 20) * 19349663);
    let cell = this.obstacleGrid.get(key);
    if (!cell) this.obstacleGrid.set(key, (cell = []));
    cell.push(t);
  }

  protected makeTree(x: number, z: number, kind: Tree['kind'], rng: () => number): Tree {
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
}
