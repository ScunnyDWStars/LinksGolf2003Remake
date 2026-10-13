import { Vector3 } from 'three';
import { spinAxisFor } from '../physics/flight';
import { FlatGround } from '../physics/ground';
import { simulateShot } from '../physics/simulator';
import { makeRng } from '../util/rng';
import type { Club } from './clubs';

/**
 * Power on the meter maps to distance, not raw ball speed: 50% power should carry about half as far.
 * We simulate each club at a range of speeds once, then invert carry(speed) by interpolation.
 */
const SAMPLE_FACTORS = [0.12, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.08, 1.16];
const tables = new Map<string, { factor: number; carry: number }[]>();

export function simulateCarry(club: Club, speedFactor: number): { carry: number; total: number } {
  const ground = new FlatGround('fairway');
  const a = (club.launchDeg * Math.PI) / 180;
  const dir = new Vector3(0, Math.sin(a), -Math.cos(a));
  const r = simulateShot(
    {
      pos: new Vector3(0, 0.03, 0),
      vel: dir.clone().multiplyScalar(club.ballSpeed * speedFactor),
      spinAxis: spinAxisFor(dir, 0),
      spinRpm: club.spinRpm,
    },
    ground,
    new Vector3(),
    makeRng(1),
  );
  return { carry: r.carryPos ? -r.carryPos.z : 0, total: -r.finalPos.z };
}

function tableFor(club: Club) {
  let t = tables.get(club.id);
  if (!t) {
    t = SAMPLE_FACTORS.map((f) => ({ factor: f, carry: simulateCarry(club, f).carry }));
    tables.set(club.id, t);
  }
  return t;
}

/** Full-power carry in metres on flat ground, no wind. */
export function fullCarry(club: Club): number {
  if (club.isPutter) return 0;
  return carryForSpeedFactor(club, 1);
}

function carryForSpeedFactor(club: Club, f: number): number {
  const t = tableFor(club);
  for (let i = 1; i < t.length; i++) {
    if (f <= t[i].factor || i === t.length - 1) {
      const a = t[i - 1];
      const b = t[i];
      const u = (f - a.factor) / (b.factor - a.factor);
      return a.carry + (b.carry - a.carry) * u;
    }
  }
  return t[t.length - 1].carry;
}

/** Speed multiplier that makes the carry equal power * full carry. */
export function speedFactorForPower(club: Club, power: number): number {
  const t = tableFor(club);
  const target = power * carryForSpeedFactor(club, 1);
  if (target <= t[0].carry) return t[0].factor * Math.max(0.05, target / Math.max(t[0].carry, 0.01));
  for (let i = 1; i < t.length; i++) {
    if (target <= t[i].carry || i === t.length - 1) {
      const a = t[i - 1];
      const b = t[i];
      const u = (target - a.carry) / (b.carry - a.carry);
      return a.factor + (b.factor - a.factor) * u;
    }
  }
  return 1;
}
