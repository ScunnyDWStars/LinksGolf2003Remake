import { Vector3 } from 'three';
import { CUP_RADIUS, GRAVITY } from './constants';
import { SURFACES } from './surfaces';

/** Fastest a ball can be moving and still drop, given how far off-centre it crosses the cup. */
export function captureSpeed(offset: number): number {
  const r = Math.min(1, Math.abs(offset) / CUP_RADIUS);
  return 1.63 * Math.sqrt(Math.max(0, 1 - r * r));
}

export type CupResult = 'none' | 'holed' | 'lipout';

/**
 * Decide what happens when a rolling ball reaches the cup. `offset` is the perpendicular distance of the
 * ball's path from the cup centre.
 */
export function cupInteraction(speed: number, offset: number): CupResult {
  if (Math.abs(offset) >= CUP_RADIUS) return 'none';
  if (speed <= captureSpeed(offset)) return 'holed';
  return Math.abs(offset) < CUP_RADIUS * 0.85 ? 'lipout' : 'none';
}

/** Deflect a lip-out: spin the direction away from the side it caught and scrub some speed. */
export function applyLipOut(vel: Vector3, offsetSigned: number): void {
  const angle = (offsetSigned >= 0 ? 1 : -1) * (0.35 + 0.6 * (1 - Math.abs(offsetSigned) / CUP_RADIUS));
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = vel.x * c - vel.z * s;
  const z = vel.x * s + vel.z * c;
  vel.x = x * 0.7;
  vel.z = z * 0.7;
}

/** Launch speed needed to roll `distance` metres on a flat green. */
export function puttSpeedForDistance(distance: number): number {
  return Math.sqrt(2 * SURFACES.green.rollResistance * GRAVITY * Math.max(0, distance));
}
