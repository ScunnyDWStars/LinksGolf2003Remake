/**
 * The classic 3-click swing meter.
 *  click 1: start the backswing (marker climbs from the snap line)
 *  click 2: set power (100% at the top; you can overswing past it)
 *  click 3: set accuracy as the marker comes back down through the snap line
 * Click early (above the line) to hook, late (below the line) to slice.
 */
export type MeterState = 'idle' | 'backswing' | 'downswing' | 'done';

export interface SwingResult {
  /** 0..maxPower; 1 = full. */
  power: number;
  /** Signed miss in meter units. < 0 = early (hook/pull), > 0 = late (slice/push). */
  accuracy: number;
}

export interface MeterConfig {
  /** Meter units per second climbing (1 unit = 0..100%). */
  backswingSpeed: number;
  /** Meter units per second on the way down. */
  downswingSpeed: number;
  maxPower: number;
  /** How far past the snap line the marker travels before the swing auto-completes. */
  missLimit: number;
}

export const DIFFICULTY: Record<'amateur' | 'pro' | 'champion', MeterConfig> = {
  amateur: { backswingSpeed: 0.75, downswingSpeed: 1.2, maxPower: 1.12, missLimit: 0.15 },
  pro: { backswingSpeed: 0.95, downswingSpeed: 1.6, maxPower: 1.12, missLimit: 0.15 },
  champion: { backswingSpeed: 1.2, downswingSpeed: 2.1, maxPower: 1.12, missLimit: 0.15 },
};

export class SwingMeter {
  state: MeterState = 'idle';
  /** Marker position: 0 = snap line, 1 = 100%. Negative while past the line on the downswing. */
  pos = 0;
  power = 0;
  accuracy = 0;

  constructor(public cfg: MeterConfig) {}

  reset(): void {
    this.state = 'idle';
    this.pos = 0;
    this.power = 0;
    this.accuracy = 0;
  }

  /** Returns the result when the swing completes on this click. */
  click(): SwingResult | null {
    switch (this.state) {
      case 'idle':
        this.state = 'backswing';
        this.pos = 0;
        return null;
      case 'backswing':
        this.power = this.pos;
        this.state = 'downswing';
        return null;
      case 'downswing':
        this.accuracy = -this.pos;
        this.state = 'done';
        return this.result();
      default:
        return null;
    }
  }

  /** Advance the marker. Returns the result if the swing auto-completed this frame. */
  update(dt: number): SwingResult | null {
    if (this.state === 'backswing') {
      this.pos += this.cfg.backswingSpeed * dt;
      if (this.pos >= this.cfg.maxPower) {
        this.pos = this.cfg.maxPower;
        this.power = this.cfg.maxPower;
        this.state = 'downswing';
      }
    } else if (this.state === 'downswing') {
      this.pos -= this.cfg.downswingSpeed * dt;
      if (this.pos <= -this.cfg.missLimit) {
        this.pos = -this.cfg.missLimit;
        this.accuracy = this.cfg.missLimit;
        this.state = 'done';
        return this.result();
      }
    }
    return null;
  }

  result(): SwingResult {
    return { power: this.power, accuracy: this.accuracy };
  }

  /** Golfer animation driver: 0 at address, 1 at the top of a full swing, negative into the follow-through. */
  get clubAngle(): number {
    if (this.state === 'backswing') return this.pos;
    if (this.state === 'downswing') return this.pos;
    return 0;
  }
}

/**
 * Real-time mouse swing: drag down to take the club back, then push up through the ball.
 * Depth of the backswing sets power; sideways wobble on the forward stroke sets accuracy.
 */
export class MouseSwing {
  active = false;
  phase: 'back' | 'forward' = 'back';
  depth = 0; // 0..maxPower
  private startY = 0;
  private startX = 0;
  private maxY = 0;
  private xAtTop = 0;
  private drift = 0;

  constructor(
    public pixelsForFull = 220,
    public maxPower = 1.12,
  ) {}

  begin(x: number, y: number): void {
    this.active = true;
    this.phase = 'back';
    this.startX = x;
    this.startY = y;
    this.maxY = y;
    this.depth = 0;
    this.drift = 0;
  }

  /** Feed pointer movement. Returns a result once the forward stroke passes the start point. */
  move(x: number, y: number): SwingResult | null {
    if (!this.active) return null;
    if (this.phase === 'back') {
      if (y > this.maxY) this.maxY = y;
      this.depth = Math.min(this.maxPower, (this.maxY - this.startY) / this.pixelsForFull);
      // Started coming forward.
      if (this.depth > 0.05 && y < this.maxY - 12) {
        this.phase = 'forward';
        this.xAtTop = x;
      }
      return null;
    }
    this.drift = x - this.xAtTop;
    if (y <= this.startY) {
      this.active = false;
      const straightBias = (this.xAtTop - this.startX) * 0.25;
      return { power: this.depth, accuracy: (this.drift + straightBias) / 900 };
    }
    return null;
  }

  cancel(): void {
    this.active = false;
  }
}
