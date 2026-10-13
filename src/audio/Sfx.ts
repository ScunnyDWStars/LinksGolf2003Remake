import type { SurfaceType } from '../physics/surfaces';

/**
 * Every sound is synthesised with WebAudio — no audio files. The context is created lazily on the first
 * user gesture (browsers require that).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private ambience: { wind: GainNode; birdsTimer: number } | null = null;
  enabled = true;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Call from a user gesture to unlock audio. */
  unlock(): void {
    this.ensure();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.7 : 0;
    if (on) this.ensure();
  }

  private noise(ctx: AudioContext, dur: number): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.loopEnd = 2;
    src.start(ctx.currentTime, Math.random() * 1.5, dur + 0.1);
    return src;
  }

  private env(ctx: AudioContext, peak: number, attack: number, decay: number, t0 = ctx.currentTime): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    g.connect(this.master!);
    return g;
  }

  swing(power: number): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const src = this.noise(ctx, 0.4);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(300, ctx.currentTime);
    bp.frequency.exponentialRampToValueAtTime(1600 + power * 1400, ctx.currentTime + 0.22);
    src.connect(bp).connect(this.env(ctx, 0.25 + power * 0.25, 0.15, 0.2));
  }

  impact(kind: 'wood' | 'iron' | 'putter' | 'sand', power: number): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (kind === 'putter') {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(900, t);
      o.frequency.exponentialRampToValueAtTime(500, t + 0.05);
      o.connect(this.env(ctx, 0.35 * Math.max(0.3, power), 0.002, 0.08));
      o.start(t);
      o.stop(t + 0.15);
      return;
    }
    // Click transient.
    const src = this.noise(ctx, 0.1);
    const hp = ctx.createBiquadFilter();
    hp.type = kind === 'sand' ? 'lowpass' : 'highpass';
    hp.frequency.value = kind === 'sand' ? 1800 : 2500;
    src.connect(hp).connect(this.env(ctx, kind === 'sand' ? 0.6 : 0.8, 0.001, kind === 'sand' ? 0.3 : 0.06));
    if (kind === 'sand') return;
    // Tonal body: drivers "ping", irons "click".
    const o = ctx.createOscillator();
    o.type = kind === 'wood' ? 'triangle' : 'sine';
    o.frequency.value = kind === 'wood' ? 1850 : 3200;
    o.connect(this.env(ctx, kind === 'wood' ? 0.25 : 0.12, 0.001, kind === 'wood' ? 0.22 : 0.05));
    o.start(t);
    o.stop(t + 0.3);
  }

  land(surface: SurfaceType, speed: number): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const vol = Math.min(0.5, 0.05 + speed * 0.02);
    const src = this.noise(ctx, 0.3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    if (surface === 'water') {
      lp.frequency.setValueAtTime(3000, ctx.currentTime);
      lp.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.5);
      src.connect(lp).connect(this.env(ctx, 0.5, 0.005, 0.6));
      return;
    }
    lp.frequency.value = surface === 'sand' ? 900 : surface === 'green' ? 500 : 350;
    src.connect(lp).connect(this.env(ctx, vol, 0.003, surface === 'sand' ? 0.18 : 0.09));
  }

  tree(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const src = this.noise(ctx, 0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.7;
    src.connect(bp).connect(this.env(ctx, 0.35, 0.01, 0.45));
    const o = ctx.createOscillator();
    o.frequency.value = 600;
    o.connect(this.env(ctx, 0.15, 0.001, 0.04));
    o.start();
    o.stop(ctx.currentTime + 0.1);
  }

  cup(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    [0, 0.07, 0.12, 0.22].forEach((dt, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 1300 - i * 180;
      o.connect(this.env(ctx, 0.22 - i * 0.04, 0.001, 0.06, t + dt));
      o.start(t + dt);
      o.stop(t + dt + 0.12);
    });
  }

  /** Crowd reaction; intensity 0..1. */
  applause(intensity: number): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const dur = 1.6 + intensity * 2.4;
    const claps = Math.floor(60 + intensity * 260);
    for (let i = 0; i < claps; i++) {
      const t = t0 + Math.random() * dur * (0.4 + 0.6 * Math.random());
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900 + Math.random() * 1800;
      bp.Q.value = 1.2;
      const fade = 1 - (t - t0) / dur;
      src.connect(bp).connect(this.env(ctx, (0.04 + intensity * 0.05) * Math.max(0.1, fade), 0.002, 0.05, t));
      src.start(t, Math.random(), 0.08);
    }
    // A cheer swell for the big moments.
    if (intensity > 0.6) {
      const src = this.noise(ctx, dur);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 700;
      bp.Q.value = 0.8;
      src.connect(bp).connect(this.env(ctx, 0.12 * intensity, 0.4, dur));
    }
  }

  /** Disappointed "ooh" for a lip-out or a ball in the water. */
  groan(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const src = this.noise(ctx, 1.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(520, ctx.currentTime);
    bp.frequency.exponentialRampToValueAtTime(260, ctx.currentTime + 1.0);
    src.connect(bp).connect(this.env(ctx, 0.25, 0.15, 0.9));
  }

  /** Looping seaside wind with the odd bird call. */
  startAmbience(windMps: number): void {
    const ctx = this.ensure();
    if (!ctx) return;
    if (!this.ambience) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(lp).connect(g).connect(this.master!);
      src.start();
      const birdsTimer = window.setInterval(() => this.bird(), 5200);
      this.ambience = { wind: g, birdsTimer };
    }
    this.ambience.wind.gain.setTargetAtTime(0.03 + Math.min(windMps, 10) * 0.012, ctx.currentTime, 1.5);
  }

  private bird(): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || Math.random() > 0.55) return;
    const t = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const st = t + i * 0.16;
      const f = 2600 + Math.random() * 1500;
      o.frequency.setValueAtTime(f, st);
      o.frequency.exponentialRampToValueAtTime(f * 1.35, st + 0.08);
      o.connect(this.env(ctx, 0.025, 0.01, 0.09, st));
      o.start(st);
      o.stop(st + 0.12);
    }
  }
}
