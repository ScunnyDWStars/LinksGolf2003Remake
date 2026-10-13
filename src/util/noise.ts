import { makeRng } from './rng';

/** Seeded 2D gradient (Perlin-style) noise with fractal sum. Returns roughly [-1, 1]. */
export class Noise2D {
  private readonly perm = new Uint8Array(512);
  private readonly gx = new Float32Array(256);
  private readonly gy = new Float32Array(256);

  constructor(seed: number) {
    const rng = makeRng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = i;
      const a = rng() * Math.PI * 2;
      this.gx[i] = Math.cos(a);
      this.gy[i] = Math.sin(a);
    }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  noise(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const xi = x0 & 255;
    const yi = y0 & 255;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const g = (ix: number, iy: number, dx: number, dy: number) => {
      const h = this.perm[ix + this.perm[iy]];
      return this.gx[h] * dx + this.gy[h] * dy;
    };
    const n00 = g(xi, yi, fx, fy);
    const n10 = g(xi + 1, yi, fx - 1, fy);
    const n01 = g(xi, yi + 1, fx, fy - 1);
    const n11 = g(xi + 1, yi + 1, fx - 1, fy - 1);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.414;
  }

  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}
