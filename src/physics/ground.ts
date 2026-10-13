import { Vector3 } from 'three';
import { BALL_RADIUS, GRAVITY } from './constants';
import { SURFACES, type SurfaceType } from './surfaces';

/** A tree or bush the ball can clip in flight. */
export interface Obstacle {
  x: number;
  z: number;
  baseY: number;
  /** Canopy radius. */
  radius: number;
  /** Canopy spans baseY + canopyBottom .. baseY + height. */
  canopyBottom: number;
  height: number;
}

/** What the ball simulation needs to know about the world. Implemented by the course terrain and by test fixtures. */
export interface GroundModel {
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out: Vector3): Vector3;
  surfaceAt(x: number, z: number): SurfaceType;
  /** False once the ball has left the playable patch (counts as out of bounds). */
  inBounds(x: number, z: number): boolean;
  obstacles: readonly Obstacle[];
  cup: { x: number; z: number };
}

/** Flat, uniform ground for tests and the club-distance table. */
export class FlatGround implements GroundModel {
  obstacles: Obstacle[] = [];
  cup = { x: 0, z: -10000 };
  constructor(
    public surface: SurfaceType = 'fairway',
    public slope = { x: 0, z: 0 }, // dh/dx, dh/dz
  ) {}
  heightAt(x: number, z: number) {
    return this.slope.x * x + this.slope.z * z;
  }
  normalAt(_x: number, _z: number, out: Vector3) {
    return out.set(-this.slope.x, 1, -this.slope.z).normalize();
  }
  surfaceAt() {
    return this.surface;
  }
  inBounds() {
    return true;
  }
}

export interface BounceResult {
  vel: Vector3;
  spinRpm: number;
  /** True when the ball no longer has enough normal speed to bounce, so it should roll. */
  settle: boolean;
}

const n = new Vector3();
const vn = new Vector3();
const vt = new Vector3();

/**
 * Resolve a landing. Backspin bites against the direction of travel (and can spin the ball back on a soft green).
 */
export function bounce(
  ground: GroundModel,
  pos: Vector3,
  vel: Vector3,
  spinRpm: number,
  surface: SurfaceType,
): BounceResult {
  const props = SURFACES[surface];
  ground.normalAt(pos.x, pos.z, n);
  const vnMag = vel.dot(n); // negative when moving into the ground
  vn.copy(n).multiplyScalar(vnMag);
  vt.copy(vel).sub(vn);
  const impact = Math.abs(vnMag);

  // Softer landings bounce proportionally less.
  const e = props.restitution * Math.min(1, impact / 6 + 0.35);
  const newVn = impact * e;

  const tSpeed = vt.length();
  // Coulomb friction impulse during the impact, proportional to the normal impulse.
  let newT = tSpeed - props.bounceFriction * (1 + e) * impact;
  // Backspin bite: scales with impact speed and spin; can make tangential speed go negative (spin back).
  const bite = props.spinGrip * (spinRpm / 10000) * impact * 0.3;
  newT -= bite;
  // Limit spin-back to something plausible.
  newT = Math.max(newT, -Math.min(1.6, 0.2 * tSpeed));

  const out = new Vector3();
  if (tSpeed > 1e-6) out.copy(vt).multiplyScalar(newT / tSpeed);
  out.addScaledVector(n, newVn);
  return { vel: out, spinRpm: spinRpm * 0.45, settle: newVn < 0.9 };
}

const g = new Vector3();
const gT = new Vector3();
const vHat = new Vector3();

/**
 * One rolling step along the surface. Returns true when the ball has come to rest.
 * Mutates pos and vel. Position is re-snapped to the terrain each step.
 */
export function stepRoll(ground: GroundModel, pos: Vector3, vel: Vector3, surface: SurfaceType, dt: number): boolean {
  const props = SURFACES[surface];
  ground.normalAt(pos.x, pos.z, n);
  // Gravity component along the slope.
  g.set(0, -GRAVITY, 0);
  gT.copy(g).addScaledVector(n, -g.dot(n));
  // Keep velocity in the tangent plane.
  vel.addScaledVector(n, -vel.dot(n));

  const speed = vel.length();
  const frictionDecel = props.rollResistance * GRAVITY * n.y * (speed < 0.6 ? 1 + (0.6 - speed) * 0.5 : 1);
  const slopeAccel = gT.length();

  if (speed < 0.025 && slopeAccel < frictionDecel * 1.3) {
    vel.set(0, 0, 0);
    return true;
  }

  vel.addScaledVector(gT, dt);
  if (speed > 1e-6) {
    vHat.copy(vel).normalize();
    const before = vel.dot(vHat);
    const dec = frictionDecel * dt;
    if (dec >= before) vel.set(0, 0, 0);
    else vel.addScaledVector(vHat, -dec);
  }
  pos.addScaledVector(vel, dt);
  pos.y = ground.heightAt(pos.x, pos.z) + BALL_RADIUS;
  return false;
}
