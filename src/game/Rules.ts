import { Vector3 } from 'three';
import { BALL_RADIUS } from '../physics/constants';
import type { GroundModel } from '../physics/ground';
import type { ShotResult } from '../physics/simulator';

/** Strokes after which a player picks up (net double-bogey style cap keeps rounds moving). */
export const MAX_STROKES = 10;
/** Putts this close are conceded when gimmes are on. */
export const GIMME_DISTANCE = 0.6;

export interface Resolution {
  /** Where the next shot is played from. */
  nextPos: Vector3;
  penalty: number;
  holed: boolean;
  message: string;
}

/**
 * Apply the rules to a finished shot.
 * - Water: one-stroke penalty, drop on the line of entry, behind the hazard.
 * - Out of bounds: stroke and distance (one-stroke penalty, replay from where you last played).
 */
export function resolveShot(result: ShotResult, prevPos: Vector3, ground: GroundModel): Resolution {
  if (result.outcome === 'holed') {
    return { nextPos: result.finalPos.clone(), penalty: 0, holed: true, message: 'In the hole!' };
  }
  if (result.outcome === 'ob') {
    return { nextPos: prevPos.clone(), penalty: 1, holed: false, message: 'Out of bounds — stroke and distance' };
  }
  if (result.outcome === 'water') {
    const drop = findDrop(result.waterEntry ?? prevPos, prevPos, ground);
    if (!drop) return { nextPos: prevPos.clone(), penalty: 1, holed: false, message: 'Water hazard — replay from previous spot' };
    return { nextPos: drop, penalty: 1, holed: false, message: 'Water hazard — one stroke penalty, take a drop' };
  }
  return { nextPos: result.finalPos.clone(), penalty: 0, holed: false, message: '' };
}

/** Walk back from the hazard's edge toward where the shot was played until we find dry, in-bounds ground. */
export function findDrop(entry: Vector3, prevPos: Vector3, ground: GroundModel): Vector3 | null {
  const dx = prevPos.x - entry.x;
  const dz = prevPos.z - entry.z;
  const len = Math.hypot(dx, dz);
  const ux = len > 1e-6 ? dx / len : 0;
  const uz = len > 1e-6 ? dz / len : 1;
  for (let back = 2; back < Math.max(len, 3) + 0.01; back += 1) {
    const x = entry.x + ux * back;
    const z = entry.z + uz * back;
    const s = ground.surfaceAt(x, z);
    if (s === 'water' || s === 'ob' || s === 'sand' || !ground.inBounds(x, z)) continue;
    // Make sure there's a little dry land behind it too.
    const s2 = ground.surfaceAt(x + ux, z + uz);
    if (s2 === 'water') continue;
    return new Vector3(x, ground.heightAt(x, z) + BALL_RADIUS, z);
  }
  return null;
}

export function scoreName(strokes: number, par: number): string {
  if (strokes === 1) return 'Hole in One!';
  const d = strokes - par;
  switch (d) {
    case -3:
      return 'Albatross!';
    case -2:
      return 'Eagle!';
    case -1:
      return 'Birdie!';
    case 0:
      return 'Par';
    case 1:
      return 'Bogey';
    case 2:
      return 'Double Bogey';
    case 3:
      return 'Triple Bogey';
    default:
      return d < -3 ? 'Incredible!' : `+${d}`;
  }
}

export function formatToPar(n: number): string {
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}
