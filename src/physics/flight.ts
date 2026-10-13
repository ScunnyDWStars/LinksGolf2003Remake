import { Vector3 } from 'three';
import { AIR_DENSITY, BALL_AREA, BALL_MASS, BALL_RADIUS, GRAVITY, RPM_TO_RADS } from './constants';

/** State of a ball in the air. Spin is stored as a unit axis plus a rate so it can decay simply. */
export interface FlightState {
  pos: Vector3;
  vel: Vector3;
  spinAxis: Vector3; // unit vector; backspin axis points to the right of travel
  spinRpm: number;
}

/** Drag coefficient as a function of spin ratio S = r*omega/v. */
export function dragCoefficient(spinRatio: number): number {
  return 0.21 + 0.22 * Math.min(spinRatio, 0.4);
}

/** Lift coefficient as a function of spin ratio. */
export function liftCoefficient(spinRatio: number): number {
  if (spinRatio <= 0) return 0;
  return Math.min(0.38, 0.6 * Math.pow(spinRatio, 0.55));
}

/** Wind gets weaker close to the ground (simple boundary-layer profile). */
export function windAtHeight(wind: Vector3, heightAboveGround: number, out: Vector3): Vector3 {
  const f = Math.min(1, 0.45 + Math.max(0, heightAboveGround) / 25);
  return out.copy(wind).multiplyScalar(f);
}

const tmpRel = new Vector3();
const tmpLift = new Vector3();

/** Acceleration on the ball from gravity, drag and Magnus lift. */
export function aeroAcceleration(
  vel: Vector3,
  spinAxis: Vector3,
  spinRpm: number,
  windHere: Vector3,
  out: Vector3,
): Vector3 {
  tmpRel.copy(vel).sub(windHere);
  const speed = tmpRel.length();
  out.set(0, -GRAVITY, 0);
  if (speed < 1e-6) return out;
  const omega = spinRpm * RPM_TO_RADS;
  const spinRatio = (BALL_RADIUS * omega) / speed;
  const k = (0.5 * AIR_DENSITY * BALL_AREA * speed) / BALL_MASS;
  // Drag opposes relative velocity.
  out.addScaledVector(tmpRel, -k * dragCoefficient(spinRatio));
  // Magnus lift along (spin axis x relative velocity), scaled to |v|^2.
  if (omega > 0) {
    tmpLift.copy(spinAxis).cross(tmpRel);
    const len = tmpLift.length();
    if (len > 1e-9) {
      tmpLift.multiplyScalar((k * speed * liftCoefficient(spinRatio)) / len);
      out.add(tmpLift);
    }
  }
  return out;
}

/** Spin decays roughly 4% per second in flight. */
export const SPIN_DECAY_PER_S = 0.04;

const k1v = new Vector3();
const k2v = new Vector3();
const k3v = new Vector3();
const k4v = new Vector3();
const k1a = new Vector3();
const k2a = new Vector3();
const k3a = new Vector3();
const k4a = new Vector3();
const vTmp = new Vector3();

/** One RK4 step of free flight. `windHere` is the wind already scaled for the ball's height. */
export function stepFlight(s: FlightState, windHere: Vector3, dt: number): void {
  const { vel, spinAxis, spinRpm } = s;
  k1v.copy(vel);
  aeroAcceleration(vel, spinAxis, spinRpm, windHere, k1a);

  k2v.copy(vel).addScaledVector(k1a, dt / 2);
  aeroAcceleration(k2v, spinAxis, spinRpm, windHere, k2a);

  k3v.copy(vel).addScaledVector(k2a, dt / 2);
  aeroAcceleration(k3v, spinAxis, spinRpm, windHere, k3a);

  k4v.copy(vel).addScaledVector(k3a, dt);
  aeroAcceleration(k4v, spinAxis, spinRpm, windHere, k4a);

  vTmp.copy(k1v).addScaledVector(k2v, 2).addScaledVector(k3v, 2).add(k4v);
  s.pos.addScaledVector(vTmp, dt / 6);
  vTmp.copy(k1a).addScaledVector(k2a, 2).addScaledVector(k3a, 2).add(k4a);
  s.vel.addScaledVector(vTmp, dt / 6);
  s.spinRpm *= Math.exp(-SPIN_DECAY_PER_S * dt);
}

/**
 * Build the spin axis for a shot travelling along `dir`.
 * tiltRad > 0 tilts the axis so the ball curves right (fade/slice); < 0 curves left (draw/hook).
 */
export function spinAxisFor(dir: Vector3, tiltRad: number, out = new Vector3()): Vector3 {
  const up = new Vector3(0, 1, 0);
  const flat = new Vector3(dir.x, 0, dir.z);
  if (flat.lengthSq() < 1e-9) flat.set(0, 0, -1);
  flat.normalize();
  const right = new Vector3().crossVectors(flat, up).normalize();
  return out.copy(right).multiplyScalar(Math.cos(tiltRad)).addScaledVector(up, -Math.sin(tiltRad)).normalize();
}
