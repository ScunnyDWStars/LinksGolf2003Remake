import { Vector3 } from 'three';
import { BALL_RADIUS, CUP_RADIUS, FRAME_DT, MAX_SHOT_TIME, PHYSICS_DT } from './constants';
import { stepFlight, windAtHeight, type FlightState } from './flight';
import { bounce, stepRoll, type GroundModel, type Obstacle } from './ground';
import { applyLipOut, cupInteraction } from './putting';
import type { SurfaceType } from './surfaces';
import type { Rng } from '../util/rng';

export interface Launch {
  pos: Vector3;
  vel: Vector3;
  spinAxis: Vector3;
  spinRpm: number;
  /** Start rolling immediately (putts). */
  rolling?: boolean;
}

export type ShotOutcome = 'rest' | 'holed' | 'water' | 'ob';

export interface ShotEvent {
  t: number;
  type: 'land' | 'bounce' | 'tree' | 'lipout' | 'holed' | 'splash' | 'ob' | 'rest';
  pos: Vector3;
  surface?: SurfaceType;
}

export interface ShotResult {
  /** Ball positions sampled every FRAME_DT seconds. */
  frames: Vector3[];
  duration: number;
  outcome: ShotOutcome;
  finalPos: Vector3;
  finalSurface: SurfaceType;
  /** First ground contact (null for putts / if it never landed). */
  carryPos: Vector3 | null;
  maxHeight: number;
  events: ShotEvent[];
  /** For water balls: last dry point along the line of flight. */
  waterEntry?: Vector3;
}

const windHere = new Vector3();

/**
 * Simulate a whole shot up front. The game then plays the recorded frames back, so cameras know where the
 * ball will land before it gets there (the landing cam relies on this).
 */
export function simulateShot(launch: Launch, ground: GroundModel, wind: Vector3, rng: Rng): ShotResult {
  const s: FlightState = {
    pos: launch.pos.clone(),
    vel: launch.vel.clone(),
    spinAxis: launch.spinAxis.clone().normalize(),
    spinRpm: launch.spinRpm,
  };
  const frames: Vector3[] = [s.pos.clone()];
  const events: ShotEvent[] = [];
  let phase: 'air' | 'roll' = launch.rolling ? 'roll' : 'air';
  let t = 0;
  let nextFrame = FRAME_DT;
  let carryPos: Vector3 | null = null;
  let maxHeight = s.pos.y;
  let outcome: ShotOutcome = 'rest';
  let waterEntry: Vector3 | undefined;
  const hitTrees = new Set<Obstacle>();
  let cupDecided = false;
  let lastDry = s.pos.clone();

  if (phase === 'roll') s.pos.y = ground.heightAt(s.pos.x, s.pos.z) + BALL_RADIUS;

  const finish = (o: ShotOutcome, type: ShotEvent['type']) => {
    outcome = o;
    events.push({ t, type, pos: s.pos.clone(), surface: ground.surfaceAt(s.pos.x, s.pos.z) });
  };

  while (t < MAX_SHOT_TIME) {
    t += PHYSICS_DT;
    if (!ground.inBounds(s.pos.x, s.pos.z)) {
      finish('ob', 'ob');
      break;
    }

    if (phase === 'air') {
      const groundY = ground.heightAt(s.pos.x, s.pos.z);
      windAtHeight(wind, s.pos.y - groundY, windHere);
      stepFlight(s, windHere, PHYSICS_DT);
      if (s.pos.y > maxHeight) maxHeight = s.pos.y;

      const surfHere = ground.surfaceAt(s.pos.x, s.pos.z);
      if (surfHere !== 'water') lastDry.set(s.pos.x, ground.heightAt(s.pos.x, s.pos.z), s.pos.z);

      // Trees.
      const nearby = ground.obstaclesNear ? ground.obstaclesNear(s.pos.x, s.pos.z) : ground.obstacles;
      for (const o of nearby) {
        if (hitTrees.has(o)) continue;
        const dx = s.pos.x - o.x;
        const dz = s.pos.z - o.z;
        if (dx * dx + dz * dz > o.radius * o.radius) continue;
        const rel = s.pos.y - o.baseY;
        if (rel < o.canopyBottom || rel > o.height) continue;
        hitTrees.add(o);
        const keep = 0.12 + rng() * 0.25;
        s.vel.multiplyScalar(keep);
        s.vel.x += (rng() - 0.5) * 3;
        s.vel.z += (rng() - 0.5) * 3;
        s.spinRpm *= 0.3;
        events.push({ t, type: 'tree', pos: s.pos.clone() });
      }

      const gy = ground.heightAt(s.pos.x, s.pos.z);
      if (s.pos.y - BALL_RADIUS <= gy && s.vel.y < 0) {
        s.pos.y = gy + BALL_RADIUS;
        const surface = ground.surfaceAt(s.pos.x, s.pos.z);
        if (!carryPos) {
          carryPos = s.pos.clone();
          events.push({ t, type: 'land', pos: s.pos.clone(), surface });
        } else {
          events.push({ t, type: 'bounce', pos: s.pos.clone(), surface });
        }
        if (surface === 'water') {
          waterEntry = lastDry.clone();
          finish('water', 'splash');
          break;
        }
        // Dunk straight into the cup.
        const dxc = s.pos.x - ground.cup.x;
        const dzc = s.pos.z - ground.cup.z;
        if (dxc * dxc + dzc * dzc < CUP_RADIUS * CUP_RADIUS && Math.hypot(s.vel.x, s.vel.z) < 4) {
          finish('holed', 'holed');
          break;
        }
        const b = bounce(ground, s.pos, s.vel, s.spinRpm, surface);
        s.vel.copy(b.vel);
        s.spinRpm = b.spinRpm;
        if (b.settle) phase = 'roll';
      }
    } else {
      const surface = ground.surfaceAt(s.pos.x, s.pos.z);
      if (surface === 'water') {
        waterEntry = lastDry.clone();
        finish('water', 'splash');
        break;
      }
      lastDry.copy(s.pos);
      const prevX = s.pos.x;
      const prevZ = s.pos.z;
      const atRest = stepRoll(ground, s.pos, s.vel, surface, PHYSICS_DT);

      // Cup: decide once each time the ball enters the cup radius.
      const dx = s.pos.x - ground.cup.x;
      const dz = s.pos.z - ground.cup.z;
      const inside = dx * dx + dz * dz < CUP_RADIUS * CUP_RADIUS;
      if (inside && !cupDecided) {
        cupDecided = true;
        const sp = Math.hypot(s.vel.x, s.vel.z);
        // Signed perpendicular offset of the path from the cup centre.
        const mx = s.pos.x - prevX;
        const mz = s.pos.z - prevZ;
        const ml = Math.hypot(mx, mz) || 1;
        const offset = ((ground.cup.x - prevX) * mz - (ground.cup.z - prevZ) * mx) / ml;
        const r = cupInteraction(sp, atRest ? 0 : offset);
        if (r === 'holed') {
          s.pos.set(ground.cup.x, ground.heightAt(ground.cup.x, ground.cup.z) - 0.06, ground.cup.z);
          finish('holed', 'holed');
          frames.push(s.pos.clone());
          break;
        }
        if (r === 'lipout') {
          applyLipOut(s.vel, offset);
          events.push({ t, type: 'lipout', pos: s.pos.clone() });
        }
      } else if (!inside) {
        cupDecided = false;
      }

      if (atRest) {
        if (ground.surfaceAt(s.pos.x, s.pos.z) === 'ob') finish('ob', 'ob');
        else finish('rest', 'rest');
        break;
      }
    }

    if (t >= nextFrame) {
      frames.push(s.pos.clone());
      nextFrame += FRAME_DT;
    }
  }

  if (t >= MAX_SHOT_TIME) finish('rest', 'rest');
  const last = frames[frames.length - 1];
  if (!last.equals(s.pos)) frames.push(s.pos.clone());

  return {
    frames,
    duration: (frames.length - 1) * FRAME_DT,
    outcome,
    finalPos: s.pos.clone(),
    finalSurface: ground.surfaceAt(s.pos.x, s.pos.z),
    carryPos,
    maxHeight,
    events,
    waterEntry,
  };
}
