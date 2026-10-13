import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { COURSES, mappedCourse, strokeIndexes } from '../src/course/courses';
import type { PlayableHole } from '../src/course/hole';
import { simulateShot } from '../src/physics/simulator';
import { BAG } from '../src/swing/clubs';
import { buildShot } from '../src/swing/ShotModifiers';
import { makeRng } from '../src/util/rng';

const real = COURSES.filter((c) => c.kind === 'real');
const load = (id: string) => {
  const e = real.find((c) => c.id === id)!;
  return mappedCourse(e, JSON.parse(readFileSync(`public/${e.file}`, 'utf8')));
};

const slopeAt = (h: PlayableHole, x: number, z: number) => {
  const dx = (h.heightAt(x + 1, z) - h.heightAt(x - 1, z)) / 2;
  const dz = (h.heightAt(x, z + 1) - h.heightAt(x, z - 1)) / 2;
  return Math.hypot(dx, dz);
};

describe('real courses from OpenStreetMap', () => {
  it('lists Romanby first, then the other real courses, then the originals', () => {
    expect(COURSES[0].id).toBe('romanby');
    expect(real.map((c) => c.id).sort()).toEqual(['augusta-national', 'romanby', 'st-andrews-old']);
    expect(COURSES.slice(-2).map((c) => c.kind)).toEqual(['original', 'original']);
    for (const c of real) expect(c.credits.join(' ')).toContain('OpenStreetMap');
  });

  it('assigns each stroke index once', () => {
    const idx = strokeIndexes([
      { par: 4, yards: 420 },
      { par: 3, yards: 150 },
      { par: 5, yards: 560 },
    ]);
    expect([...idx].sort()).toEqual([1, 2, 3]);
    expect(idx[1]).toBe(3); // the short par 3 is the easiest
  });

  describe.each(real.map((c) => [c.name, c.id] as const))('%s', (_name, id) => {
    const course = load(id);

    it('has 18 holes and par 72', () => {
      expect(course.holes).toHaveLength(18);
      expect(course.holes.reduce((s, h) => s + h.par, 0)).toBe(72);
      expect([...course.holes.map((h) => h.handicap)].sort((a, b) => a - b)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    });

    it('builds every hole with the tee on a tee, the pin on a puttable green, and clear playing areas', { timeout: 120_000 }, () => {
      for (let i = 0; i < course.holes.length; i++) {
        const h = course.makeHole(i);
        expect(h.surfaceAt(h.tee.x, h.tee.z), `hole ${i + 1} tee`).toBe('tee');
        expect(h.surfaceAt(h.cup.x, h.cup.z), `hole ${i + 1} pin`).toBe('green');
        expect(slopeAt(h, h.cup.x, h.cup.z), `hole ${i + 1} green slope`).toBeLessThan(0.05);
        expect(h.heights.every(Number.isFinite)).toBe(true);
        for (const o of h.obstacles) expect(['rough', 'deepRough']).toContain(h.surfaceAt(o.x, o.z));
        for (const w of h.waterSurfaces()) {
          if (w.kind !== 'grid') continue;
          // The water bed is below the surface, and dry ground next to water is above it.
          for (let k = 0; k < w.level.length; k++) {
            if (Number.isNaN(w.level[k])) continue;
            const x = w.minX + (k % w.nx) * w.step;
            const z = w.minZ + Math.floor(k / w.nx) * w.step;
            if (h.surfaceAt(x, z) === 'water') expect(h.heights[k]).toBeLessThan(w.level[k]);
            else expect(h.heights[k]).toBeGreaterThan(w.level[k]);
          }
        }
      }
    });
  });

  it('plays a drive down Romanby 1 into a sensible spot', () => {
    const h = load('romanby').makeHole(0);
    const ball = h.teePosition();
    const aim = h.suggestedAim(ball, 230);
    const shot = buildShot({
      club: BAG[0],
      swing: { power: 1, accuracy: 0 },
      aimYaw: Math.atan2(aim.x - ball.x, -(aim.z - ball.z)),
      shape: 'normal',
      lie: 'tee',
      ballPos: ball,
      puttRange: 10,
      powerBoost: false,
      accuracySensitivity: 1,
      rng: makeRng(1),
    });
    const r = simulateShot(shot.launch, h, new Vector3(), makeRng(1));
    expect(r.outcome).toBe('rest');
    expect(['fairway', 'rough', 'fringe', 'green']).toContain(r.finalSurface);
    expect(r.finalPos.distanceTo(ball)).toBeGreaterThan(200);
  });
});
