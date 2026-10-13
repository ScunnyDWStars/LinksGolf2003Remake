import { Vector3 } from 'three';
import { spinAxisFor } from '../physics/flight';
import { puttSpeedForDistance } from '../physics/putting';
import type { Launch } from '../physics/simulator';
import { SURFACES, type SurfaceType } from '../physics/surfaces';
import { clamp, degToRad } from '../util/math';
import type { Rng } from '../util/rng';
import type { Club } from './clubs';
import { speedFactorForPower } from './distances';
import type { SwingResult } from './SwingMeter';

export type ShotShape = 'normal' | 'draw' | 'fade' | 'high' | 'low' | 'punch';
export const SHOT_SHAPES: readonly ShotShape[] = ['normal', 'draw', 'fade', 'high', 'low', 'punch'];
export const SHAPE_LABEL: Record<ShotShape, string> = {
  normal: 'Normal',
  draw: 'Draw',
  fade: 'Fade',
  high: 'High',
  low: 'Low',
  punch: 'Punch',
};

interface ShapeMod {
  tilt: number; // rad, + curves right
  startOffset: number; // rad, + starts right
  launchAdd: number; // deg
  launchMul: number;
  speedMul: number;
  spinMul: number;
}

const SHAPES: Record<ShotShape, ShapeMod> = {
  normal: { tilt: 0, startOffset: 0, launchAdd: 0, launchMul: 1, speedMul: 1, spinMul: 1 },
  draw: { tilt: -0.14, startOffset: 0.04, launchAdd: -0.5, launchMul: 1, speedMul: 1.0, spinMul: 0.93 },
  fade: { tilt: 0.14, startOffset: -0.04, launchAdd: 0.5, launchMul: 1, speedMul: 0.98, spinMul: 1.07 },
  high: { tilt: 0, startOffset: 0, launchAdd: 4, launchMul: 1, speedMul: 0.97, spinMul: 1.12 },
  low: { tilt: 0, startOffset: 0, launchAdd: -3, launchMul: 1, speedMul: 1.0, spinMul: 0.85 },
  punch: { tilt: 0, startOffset: 0, launchAdd: 0, launchMul: 0.5, speedMul: 0.8, spinMul: 0.65 },
};

export interface ShotSetup {
  club: Club;
  swing: SwingResult;
  /** Aim heading in radians; 0 = toward -Z, positive turns right (+X). */
  aimYaw: number;
  shape: ShotShape;
  lie: SurfaceType;
  ballPos: Vector3;
  /** Distance a 100% putt rolls on a flat green, metres. */
  puttRange: number;
  /** Extra distance and tighter accuracy window, like the classic "power" swing option. */
  powerBoost: boolean;
  /** Multiplier on how much a mistimed click costs. */
  accuracySensitivity: number;
  rng: Rng;
}

export interface BuiltShot {
  launch: Launch;
  flyer: boolean;
  /** Effective accuracy after lie scatter and overswing (for HUD feedback). */
  accuracy: number;
}

export function dirFromYaw(yaw: number, out = new Vector3()): Vector3 {
  return out.set(Math.sin(yaw), 0, -Math.cos(yaw));
}

export function buildShot(s: ShotSetup): BuiltShot {
  const lie = SURFACES[s.lie].lie;
  let acc = s.swing.accuracy * s.accuracySensitivity;
  // Overswing makes misses wilder.
  if (s.swing.power > 1) acc += (s.rng() - 0.5) * 0.06 * ((s.swing.power - 1) / 0.12);
  // A bad lie adds scatter.
  if (lie.scatter > 0) acc += (s.rng() * 2 - 1) * lie.scatter;
  if (s.powerBoost) acc *= 1.8;

  if (s.club.isPutter) {
    const speed = puttSpeedForDistance(Math.max(0, s.swing.power) * s.puttRange);
    const yaw = s.aimYaw + clamp(acc, -0.2, 0.2) * 0.5;
    const dir = dirFromYaw(yaw);
    const pos = s.ballPos.clone();
    return {
      launch: { pos, vel: dir.multiplyScalar(speed), spinAxis: spinAxisFor(dir, 0), spinRpm: 0, rolling: true },
      flyer: false,
      accuracy: acc,
    };
  }

  const shape = SHAPES[s.shape];
  const flyer = lie.flyerChance > 0 && s.rng() < lie.flyerChance;
  let speed =
    s.club.ballSpeed * speedFactorForPower(s.club, Math.max(0.02, s.swing.power)) * shape.speedMul * lie.power;
  let spin = s.club.spinRpm * shape.spinMul * lie.spin;
  if (flyer) {
    speed *= 1.04;
    spin *= 0.55;
  }
  if (s.powerBoost) {
    speed *= 1.06;
    spin *= 0.95;
  }
  // Short shots launch a little higher relative to their speed (more of a pitch).
  const launchDeg = Math.max(2, s.club.launchDeg * shape.launchMul + shape.launchAdd);

  const tilt = clamp(shape.tilt + acc * 7, -0.75, 0.75);
  const yaw = s.aimYaw + shape.startOffset + clamp(acc, -0.2, 0.2) * 1.0;
  const flat = dirFromYaw(yaw);
  const la = degToRad(launchDeg);
  const dir = new Vector3(flat.x * Math.cos(la), Math.sin(la), flat.z * Math.cos(la));
  const pos = s.ballPos.clone();
  if (s.lie === 'tee') pos.y += 0.03; // on a peg
  pos.y = Math.max(pos.y, s.ballPos.y) + 0.001;
  return {
    launch: { pos, vel: dir.clone().multiplyScalar(speed), spinAxis: spinAxisFor(dir, tilt), spinRpm: spin },
    flyer,
    accuracy: acc,
  };
}

