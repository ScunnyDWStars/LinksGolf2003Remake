import type { Vec2 } from '../util/math';
import type { Noise2D } from '../util/noise';
import type { EllipseSpec, P } from './types';

/** Plan coordinates [x, f] to world (x, z = -f). */
export const toWorld = (p: P): Vec2 => ({ x: p[0], z: -p[1] });

export interface Projection {
  /** Arc length along the line to the closest point. */
  s: number;
  /** Signed distance; positive is to the right of travel. */
  lateral: number;
  dist: number;
}

/** A polyline with arc-length parameterisation. */
export class Polyline {
  readonly pts: Vec2[];
  readonly cum: number[] = [0];
  readonly length: number;

  constructor(points: readonly P[] | Vec2[]) {
    this.pts = (points as (P | Vec2)[]).map((p) => (Array.isArray(p) ? toWorld(p as P) : (p as Vec2)));
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1];
      const b = this.pts[i];
      this.cum.push(this.cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    this.length = this.cum[this.cum.length - 1];
  }

  project(x: number, z: number): Projection {
    let best: Projection = { s: 0, lateral: 0, dist: Infinity };
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1];
      const b = this.pts[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
      // Let the ends extend so points beyond the tee/green still get a sensible lateral.
      if (i > 1) t = Math.max(t, 0);
      if (i < this.pts.length - 1) t = Math.min(t, 1);
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best.dist) {
        const len = Math.sqrt(len2);
        // Right of travel direction (dx,dz) is (-dz, dx).
        const lateral = ((x - a.x) * -dz + (z - a.z) * dx) / len;
        best = { s: this.cum[i - 1] + t * len, lateral, dist: d };
      }
    }
    return best;
  }

  pointAt(s: number): Vec2 {
    const c = Math.max(0, Math.min(this.length, s));
    for (let i = 1; i < this.pts.length; i++) {
      if (c <= this.cum[i] || i === this.pts.length - 1) {
        const a = this.pts[i - 1];
        const b = this.pts[i];
        const seg = this.cum[i] - this.cum[i - 1] || 1;
        const t = (c - this.cum[i - 1]) / seg;
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      }
    }
    return { ...this.pts[this.pts.length - 1] };
  }

  /** Unit direction of travel at arc length s. */
  dirAt(s: number): Vec2 {
    for (let i = 1; i < this.pts.length; i++) {
      if (s <= this.cum[i] || i === this.pts.length - 1) {
        const a = this.pts[i - 1];
        const b = this.pts[i];
        const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
      }
    }
    return { x: 0, z: -1 };
  }
}

/** Organic ellipse: field value < 1 inside, scaled so ~1 is the edge. */
export class Blob {
  readonly cx: number;
  readonly cz: number;
  private readonly cos: number;
  private readonly sin: number;

  constructor(
    public readonly spec: EllipseSpec,
    private readonly noise: Noise2D,
    private readonly wobble = 0.1,
    private readonly seed = 0,
  ) {
    const c = toWorld(spec.at);
    this.cx = c.x;
    this.cz = c.z;
    const r = ((spec.rot ?? 0) * Math.PI) / 180;
    this.cos = Math.cos(r);
    this.sin = Math.sin(r);
  }

  field(x: number, z: number): number {
    const dx = x - this.cx;
    const dz = z - this.cz;
    // Rotate into the blob's frame (clockwise from above = rotating plan coords).
    const lx = dx * this.cos + dz * this.sin;
    const lz = -dx * this.sin + dz * this.cos;
    const q = Math.hypot(lx / this.spec.rx, lz / this.spec.rz);
    if (this.wobble === 0 || q > 3) return q;
    const ang = Math.atan2(lz, lx);
    const w = this.noise.noise(Math.cos(ang) * 1.3 + this.seed * 7.31, Math.sin(ang) * 1.3 + this.seed * 3.17);
    return q / (1 + this.wobble * w);
  }

  /** Rough bounding radius. */
  get radius(): number {
    return Math.max(this.spec.rx, this.spec.rz) * (1 + this.wobble);
  }
}
