import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FlatGround } from '../src/physics/ground';
import { simulateShot } from '../src/physics/simulator';
import { BAG, clubIndex } from '../src/swing/clubs';
import { fullCarry } from '../src/swing/distances';
import { buildShot, type ShotSetup } from '../src/swing/ShotModifiers';
import { DIFFICULTY, MouseSwing, SwingMeter } from '../src/swing/SwingMeter';
import { makeRng } from '../src/util/rng';

describe('SwingMeter (3-click)', () => {
  it('sets power on click 2 and accuracy on click 3', () => {
    const m = new SwingMeter({ backswingSpeed: 1, downswingSpeed: 2, maxPower: 1.12, missLimit: 0.15 });
    m.click();
    expect(m.state).toBe('backswing');
    m.update(0.8);
    m.click();
    expect(m.state).toBe('downswing');
    expect(m.power).toBeCloseTo(0.8);
    m.update(0.8 / m.downswingRate); // exactly back to the line
    const r = m.click();
    expect(r).not.toBeNull();
    expect(r!.power).toBeCloseTo(0.8);
    expect(Math.abs(r!.accuracy)).toBeLessThan(1e-9);
  });

  it('early third click is a hook (negative), late is a slice (positive)', () => {
    const early = new SwingMeter(DIFFICULTY.pro);
    early.click();
    early.update(0.5);
    early.click();
    early.update(0.2 / early.downswingRate);
    expect(early.click()!.accuracy).toBeLessThan(0);

    const late = new SwingMeter({ backswingSpeed: 1, downswingSpeed: 1, maxPower: 1.12, missLimit: 0.15 });
    late.click();
    late.update(0.5);
    late.click();
    late.update(0.55 / late.downswingRate);
    expect(late.click()!.accuracy).toBeGreaterThan(0);
  });

  it('overswings to max power if the second click never comes, and auto-completes as a big miss', () => {
    const m = new SwingMeter({ backswingSpeed: 1, downswingSpeed: 1, maxPower: 1.12, missLimit: 0.15 });
    m.click();
    m.update(2);
    expect(m.state).toBe('downswing');
    expect(m.power).toBeCloseTo(1.12);
    let r = null;
    for (let i = 0; i < 200 && !r; i++) r = m.update(0.02);
    expect(r).not.toBeNull();
    expect(r!.accuracy).toBeCloseTo(0.15);
  });
});

describe('swing tempo', () => {
  /** Seconds from setting power to the marker reaching the snap line. */
  const downswingTime = (clubId: string, power: number) => {
    const m = new SwingMeter(DIFFICULTY.pro);
    m.tempo = BAG[clubIndex(clubId)].tempo;
    m.click();
    m.update(power / (m.cfg.backswingSpeed * m.tempo));
    m.click();
    return power / m.downswingRate;
  };

  it('gives a short wedge shot time to find the snap line', () => {
    expect(downswingTime('pw', 0.3)).toBeGreaterThan(0.4);
    expect(downswingTime('pt', 0.2)).toBeGreaterThan(0.4);
  });

  it('keeps a full driver at about the old tempo', () => {
    expect(downswingTime('dr', 1)).toBeGreaterThan(0.55);
    expect(downswingTime('dr', 1)).toBeLessThan(0.7);
  });

  it('never makes a shorter club come down faster than a longer one', () => {
    const clubs = BAG.map((c) => c.id);
    for (const p of [0.3, 0.6, 1]) {
      for (let i = 1; i < clubs.length; i++) expect(downswingTime(clubs[i], p)).toBeGreaterThanOrEqual(downswingTime(clubs[i - 1], p) - 1e-9);
    }
  });

  it('slows the backswing for short clubs too', () => {
    expect(BAG[clubIndex('pt')].tempo).toBeLessThan(BAG[clubIndex('dr')].tempo);
  });
});

describe('MouseSwing', () => {
  it('turns drag depth into power and finishes when the stroke returns', () => {
    const s = new MouseSwing(200);
    s.begin(100, 100);
    s.move(100, 200);
    s.move(100, 300);
    s.move(100, 250);
    const r = s.move(100, 90);
    expect(r).not.toBeNull();
    expect(r!.power).toBeCloseTo(1, 1);
    expect(Math.abs(r!.accuracy)).toBeLessThan(0.01);
  });
});

describe('buildShot', () => {
  const base = (over: Partial<ShotSetup> = {}): ShotSetup => ({
    club: BAG[clubIndex('7i')],
    swing: { power: 1, accuracy: 0 },
    aimYaw: 0,
    shape: 'normal',
    lie: 'fairway',
    ballPos: new Vector3(0, 0.0213, 0),
    puttRange: 10,
    powerBoost: false,
    accuracySensitivity: 1,
    rng: makeRng(3),
    ...over,
  });
  const run = (s: ShotSetup) => simulateShot(buildShot(s).launch, new FlatGround('fairway'), new Vector3(), makeRng(1));

  it('half power carries about half the distance', () => {
    const full = -run(base()).carryPos!.z;
    const half = -run(base({ swing: { power: 0.5, accuracy: 0 } })).carryPos!.z;
    expect(half / full).toBeGreaterThan(0.42);
    expect(half / full).toBeLessThan(0.58);
  });

  it('a full shot matches the advertised club carry', () => {
    const c = BAG[clubIndex('7i')];
    const carry = -run(base()).carryPos!.z;
    expect(Math.abs(carry - fullCarry(c))).toBeLessThan(2);
  });

  it('a late click finishes right of target, an early click left', () => {
    expect(run(base({ swing: { power: 1, accuracy: 0.04 } })).finalPos.x).toBeGreaterThan(5);
    expect(run(base({ swing: { power: 1, accuracy: -0.04 } })).finalPos.x).toBeLessThan(-5);
  });

  it('draw curves left, fade curves right', () => {
    expect(run(base({ shape: 'draw' })).finalPos.x).toBeLessThan(-2);
    expect(run(base({ shape: 'fade' })).finalPos.x).toBeGreaterThan(2);
  });

  it('a bunker lie loses distance', () => {
    const fw = -run(base()).carryPos!.z;
    const sand = -run(base({ lie: 'sand' })).carryPos!.z;
    expect(sand).toBeLessThan(fw * 0.85);
  });

  it('putter rolls the ball for power * range', () => {
    const r = simulateShot(
      buildShot(base({ club: BAG[clubIndex('pt')], swing: { power: 0.6, accuracy: 0 }, puttRange: 10 })).launch,
      new FlatGround('green'),
      new Vector3(),
      makeRng(1),
    );
    expect(-r.finalPos.z).toBeGreaterThan(5);
    expect(-r.finalPos.z).toBeLessThan(7);
  });

  it('aim yaw rotates the shot to the right', () => {
    const r = run(base({ aimYaw: 0.3 }));
    expect(r.finalPos.x).toBeGreaterThan(20);
  });
});
