import type { SwingMeter } from '../swing/SwingMeter';
import { el } from './dom';

/**
 * The arc swing meter. The snap line sits at the lower right; the marker climbs counter-clockwise
 * to 100% on the left, then sweeps back down through the snap line.
 */
export class SwingMeterView {
  readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly label: HTMLDivElement;
  private lastResult: { power: number; accuracy: number } | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'meter', undefined, parent);
    this.canvas = el('canvas', 'meter-canvas', undefined, this.root);
    this.canvas.width = 520;
    this.canvas.height = 300;
    this.ctx = this.canvas.getContext('2d')!;
    this.label = el('div', 'meter-label', '', this.root);
  }

  private angle(pos: number): number {
    // Canvas angles: 0 = +x, increasing clockwise (y down).
    const snap = Math.PI * 0.2;
    return snap - pos * Math.PI * 1.25;
  }

  setResult(r: { power: number; accuracy: number } | null): void {
    this.lastResult = r;
  }

  setLabel(text: string): void {
    this.label.textContent = text;
  }

  draw(meter: SwingMeter, opts: { mouse?: boolean; mouseDepth?: number; snapZone: number; boost: boolean }): void {
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H * 0.56;
    const R = 120;
    const thick = 30;
    const max = meter.cfg.maxPower;
    const a = (p: number) => this.angle(p);

    // Track.
    c.lineCap = 'butt';
    c.lineWidth = thick;
    c.strokeStyle = 'rgba(10,20,14,0.75)';
    c.beginPath();
    c.arc(cx, cy, R, a(max), a(-meter.cfg.missLimit));
    c.stroke();

    // Power band gradient.
    const grad = c.createLinearGradient(cx - R, cy, cx + R, cy);
    grad.addColorStop(0, '#f2c14e');
    grad.addColorStop(1, '#4fa36b');
    c.lineWidth = thick - 8;
    c.strokeStyle = grad;
    c.beginPath();
    c.arc(cx, cy, R, a(1), a(0));
    c.stroke();
    // Overswing zone.
    c.strokeStyle = '#d0453b';
    c.beginPath();
    c.arc(cx, cy, R, a(max), a(1));
    c.stroke();
    // Snap zone around the line.
    c.strokeStyle = opts.boost ? '#ffe680' : '#bff5c9';
    c.beginPath();
    c.arc(cx, cy, R, a(opts.snapZone), a(-opts.snapZone));
    c.stroke();
    // Miss zone past the line.
    c.strokeStyle = '#7a2b26';
    c.beginPath();
    c.arc(cx, cy, R, a(-opts.snapZone), a(-meter.cfg.missLimit));
    c.stroke();

    // Ticks every 10%.
    c.lineWidth = 2;
    for (let p = 0; p <= 1.001; p += 0.1) {
      const ang = a(p);
      const major = Math.abs(p - 0.5) < 0.01 || Math.abs(p - 1) < 0.01;
      c.strokeStyle = major ? '#fff' : 'rgba(255,255,255,0.55)';
      c.beginPath();
      c.moveTo(cx + Math.cos(ang) * (R - thick / 2 - (major ? 6 : 2)), cy + Math.sin(ang) * (R - thick / 2 - (major ? 6 : 2)));
      c.lineTo(cx + Math.cos(ang) * (R + thick / 2), cy + Math.sin(ang) * (R + thick / 2));
      c.stroke();
    }
    c.fillStyle = '#fff';
    c.font = 'bold 15px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const p of [0.5, 1]) {
      const ang = a(p);
      c.fillText(`${Math.round(p * 100)}`, cx + Math.cos(ang) * (R + thick + 2), cy + Math.sin(ang) * (R + thick + 2));
    }
    // Snap line.
    const sa = a(0);
    c.lineWidth = 4;
    c.strokeStyle = '#ffffff';
    c.beginPath();
    c.moveTo(cx + Math.cos(sa) * (R - thick / 2 - 8), cy + Math.sin(sa) * (R - thick / 2 - 8));
    c.lineTo(cx + Math.cos(sa) * (R + thick / 2 + 8), cy + Math.sin(sa) * (R + thick / 2 + 8));
    c.stroke();

    const needle = (p: number, color: string, width: number, len = 10) => {
      const ang = a(p);
      c.lineWidth = width;
      c.strokeStyle = color;
      c.beginPath();
      c.moveTo(cx + Math.cos(ang) * (R - thick / 2 - len), cy + Math.sin(ang) * (R - thick / 2 - len));
      c.lineTo(cx + Math.cos(ang) * (R + thick / 2 + len), cy + Math.sin(ang) * (R + thick / 2 + len));
      c.stroke();
    };

    if (opts.mouse) {
      if ((opts.mouseDepth ?? 0) > 0) needle(opts.mouseDepth!, '#ffffff', 5);
    } else {
      if (meter.state === 'downswing' || meter.state === 'done') needle(meter.power, '#ffd23f', 4, 6);
      if (meter.state === 'backswing' || meter.state === 'downswing') needle(meter.pos, '#ffffff', 5);
    }
    if (this.lastResult && meter.state !== 'backswing' && meter.state !== 'downswing') {
      needle(this.lastResult.power, '#ffd23f', 4, 6);
      needle(-this.lastResult.accuracy, '#ff5a36', 4, 6);
    }

    // Centre readout.
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.font = 'bold 30px system-ui, sans-serif';
    const shown =
      opts.mouse ? (opts.mouseDepth ?? 0) : meter.state === 'backswing' ? meter.pos : meter.state === 'idle' ? (this.lastResult?.power ?? 0) : meter.power;
    c.fillText(`${Math.round(shown * 100)}%`, cx, cy - 6);
  }
}
