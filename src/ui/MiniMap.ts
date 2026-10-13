import type { PlayableHole } from '../course/hole';
import type { SurfaceType } from '../physics/surfaces';
import { el } from './dom';

const COLORS: Record<'links' | 'parkland', Record<SurfaceType, [number, number, number]>> = {
  parkland: {
    tee: [120, 190, 80],
    fairway: [112, 186, 70],
    fringe: [104, 182, 72],
    green: [140, 214, 100],
    rough: [70, 128, 44],
    deepRough: [44, 84, 32],
    sand: [240, 228, 190],
    water: [52, 108, 150],
    path: [210, 206, 196],
    ob: [44, 84, 32],
  },
  links: {
    tee: [118, 182, 78],
    fairway: [108, 176, 70],
    fringe: [100, 176, 72],
    green: [130, 206, 92],
    rough: [72, 120, 48],
    deepRough: [160, 152, 92],
    sand: [236, 220, 176],
    water: [52, 108, 150],
    path: [200, 190, 170],
    ob: [140, 132, 80],
  },
};

const RES = 4; // canvas pixels per surface sample (backing store)

/**
 * Top-down hole map, rotated so the tee is at the bottom and the green at the top. The terrain is rendered
 * once per hole; the ball, aim line, pin and shot trail are drawn over it every frame.
 */
export class MiniMap {
  readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private t: PlayableHole | null = null;
  private fx = 0;
  private fz = -1;
  private ox = 0;
  private oz = 0;
  private scale = 1;
  private vMin = 0;
  private uMid = 0;
  private trail: { x: number; z: number }[] = [];
  private readonly W = 200;
  private readonly H = 260;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'minimap', undefined, parent);
    this.canvas = el('canvas', 'minimap-canvas', undefined, this.root);
    this.canvas.width = this.W * 2;
    this.canvas.height = this.H * 2;
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** World (x, z) to canvas pixels (backing-store resolution). */
  private toCanvas(x: number, z: number): [number, number] {
    const rx = x - this.ox;
    const rz = z - this.oz;
    const v = rx * this.fx + rz * this.fz;
    const u = rx * -this.fz + rz * this.fx;
    return [this.W + (u - this.uMid) * this.scale, this.H * 2 - 14 - (v - this.vMin) * this.scale];
  }

  private toWorld(cx: number, cy: number): [number, number] {
    const u = (cx - this.W) / this.scale + this.uMid;
    const v = (this.H * 2 - 14 - cy) / this.scale + this.vMin;
    // Inverse of the rotation in toCanvas.
    return [this.ox + v * this.fx - u * this.fz, this.oz + v * this.fz + u * this.fx];
  }

  /** Client pixel coordinates to world (x, z), or null if off the map. */
  screenToWorld(clientX: number, clientY: number): [number, number] | null {
    if (!this.t) return null;
    const r = this.canvas.getBoundingClientRect();
    const cx = ((clientX - r.left) / r.width) * this.canvas.width;
    const cy = ((clientY - r.top) / r.height) * this.canvas.height;
    if (cx < 0 || cy < 0 || cx > this.canvas.width || cy > this.canvas.height) return null;
    return this.toWorld(cx, cy);
  }

  setHole(t: PlayableHole): void {
    this.t = t;
    this.trail = [];
    const g = { x: t.green.cx, z: t.green.cz };
    const dx = g.x - t.tee.x;
    const dz = g.z - t.tee.z;
    const L = Math.hypot(dx, dz) || 1;
    this.fx = dx / L;
    this.fz = dz / L;
    this.ox = t.tee.x;
    this.oz = t.tee.z;
    // Extent of the hole in (u, v).
    let uLo = -20;
    let uHi = 20;
    for (const p of t.centerline.pts) {
      const rx = p.x - this.ox;
      const rz = p.z - this.oz;
      const u = rx * -this.fz + rz * this.fx;
      uLo = Math.min(uLo, u - t.corridorWidth);
      uHi = Math.max(uHi, u + t.corridorWidth);
    }
    this.vMin = -18;
    const vMax = L + t.green.radius + 22;
    this.uMid = (uLo + uHi) / 2;
    this.scale = Math.min((this.W * 2 - 16) / (uHi - uLo), (this.H * 2 - 28) / (vMax - this.vMin));
    this.renderBase();
  }

  private renderBase(): void {
    const t = this.t!;
    const w = (this.W * 2) / RES;
    const h = (this.H * 2) / RES;
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const octx = off.getContext('2d')!;
    const img = octx.createImageData(w, h);
    const pal = COLORS[t.style];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const [x, z] = this.toWorld((i + 0.5) * RES, (j + 0.5) * RES);
        const surf = t.inBounds(x, z) ? t.surfaceAt(x, z) : 'deepRough';
        const c = pal[surf];
        // Light hill-shading from the slope.
        const e = 1.5;
        const shade = 1 + ((t.heightAt(x - e, z) - t.heightAt(x + e, z)) * 0.6 + (t.heightAt(x, z - e) - t.heightAt(x, z + e)) * 0.4) * 0.35;
        const k = (j * w + i) * 4;
        img.data[k] = Math.min(255, c[0] * shade);
        img.data[k + 1] = Math.min(255, c[1] * shade);
        img.data[k + 2] = Math.min(255, c[2] * shade);
        img.data[k + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    const base = document.createElement('canvas');
    base.width = this.W * 2;
    base.height = this.H * 2;
    const b = base.getContext('2d')!;
    b.imageSmoothingEnabled = true;
    b.drawImage(off, 0, 0, base.width, base.height);
    // Trees as canopy dots.
    for (const o of t.obstacles) {
      const [cx, cy] = this.toCanvas(o.x, o.z);
      if (cx < -10 || cy < -10 || cx > base.width + 10 || cy > base.height + 10) continue;
      b.fillStyle = o.kind === 'gorse' ? 'rgba(70,90,40,0.85)' : 'rgba(22,52,18,0.8)';
      b.beginPath();
      b.arc(cx, cy, Math.max(1.5, o.radius * this.scale), 0, Math.PI * 2);
      b.fill();
    }
    this.base = base;
  }

  addTrail(x: number, z: number): void {
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(last.x - x, last.z - z) > 1.5) this.trail.push({ x, z });
  }

  clearTrail(): void {
    this.trail = [];
  }

  draw(ball: { x: number; z: number }, aim: { x: number; z: number } | null): void {
    const t = this.t;
    if (!t || !this.base) return;
    const c = this.ctx;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.base, 0, 0);

    if (this.trail.length > 1) {
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.lineWidth = 2;
      c.beginPath();
      this.trail.forEach((p, i) => {
        const [x, y] = this.toCanvas(p.x, p.z);
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      });
      c.stroke();
    }
    const [bx, by] = this.toCanvas(ball.x, ball.z);
    if (aim) {
      const [ax, ay] = this.toCanvas(aim.x, aim.z);
      c.strokeStyle = '#ffd23f';
      c.lineWidth = 2.5;
      c.setLineDash([7, 5]);
      c.beginPath();
      c.moveTo(bx, by);
      c.lineTo(ax, ay);
      c.stroke();
      c.setLineDash([]);
      c.beginPath();
      c.arc(ax, ay, 7, 0, Math.PI * 2);
      c.stroke();
    }
    // Pin.
    const [px, py] = this.toCanvas(t.cup.x, t.cup.z);
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(px, py - 22);
    c.stroke();
    c.fillStyle = '#e02a2a';
    c.beginPath();
    c.moveTo(px, py - 22);
    c.lineTo(px + 13, py - 17);
    c.lineTo(px, py - 12);
    c.fill();
    // Ball.
    c.fillStyle = '#fff';
    c.strokeStyle = '#000';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(bx, by, 5, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }

  set visible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }
}
