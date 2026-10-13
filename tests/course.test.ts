import { describe, expect, it } from 'vitest';
import { KESTREL_DUNES } from '../src/course/kestrelDunes';
import { HoleTerrain } from '../src/course/terrain';
import { toYards } from '../src/util/math';

const terrains = KESTREL_DUNES.holes.map((h) => new HoleTerrain(h));

describe('Kestrel Dunes', () => {
  it('has 18 holes numbered in order, totalling par 72 with 36 out and 36 in', () => {
    const holes = KESTREL_DUNES.holes;
    expect(holes).toHaveLength(18);
    holes.forEach((h, i) => expect(h.number).toBe(i + 1));
    const par = (a: number, b: number) => holes.slice(a, b).reduce((s, h) => s + h.par, 0);
    expect(par(0, 9)).toBe(36);
    expect(par(9, 18)).toBe(36);
  });

  it('uses each stroke index 1-18 exactly once', () => {
    const idx = KESTREL_DUNES.holes.map((h) => h.handicap).sort((a, b) => a - b);
    expect(idx).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it.each(terrains.map((t) => [t.spec.number, t] as const))('hole %i: yardage suits its par', (_n, t) => {
    const yds = toYards(t.length);
    const range = { 3: [120, 230], 4: [330, 470], 5: [480, 600] }[t.spec.par];
    expect(yds).toBeGreaterThan(range[0]);
    expect(yds).toBeLessThan(range[1]);
  });

  it.each(terrains.map((t) => [t.spec.number, t] as const))('hole %i: tee, pin and landing zone are on the right surfaces', (_n, t) => {
    expect(t.surfaceAt(t.tee.x, t.tee.z)).toBe('tee');
    expect(t.surfaceAt(t.cup.x, t.cup.z)).toBe('green');
    // The pin should sit comfortably inside the green, not on the edge.
    expect(t.green.field(t.cup.x, t.cup.z)).toBeLessThan(0.8);
    if (t.spec.par > 3) {
      const p = t.centerline.pointAt(210);
      expect(['fairway', 'sand']).toContain(t.surfaceAt(p.x, p.z));
    }
  });

  it.each(terrains.map((t) => [t.spec.number, t] as const))('hole %i: heights are finite and the green is roughly puttable', (_n, t) => {
    for (const h of t.heights) expect(Number.isFinite(h)).toBe(true);
    // Sample the slope around the cup: should be < 6%.
    const e = 1;
    const dx = (t.heightAt(t.cup.x + e, t.cup.z) - t.heightAt(t.cup.x - e, t.cup.z)) / (2 * e);
    const dz = (t.heightAt(t.cup.x, t.cup.z + e) - t.heightAt(t.cup.x, t.cup.z - e)) / (2 * e);
    expect(Math.hypot(dx, dz)).toBeLessThan(0.06);
  });

  it('places trees and gorse only off the fairway', () => {
    for (const t of terrains) {
      for (const o of t.obstacles) expect(['rough', 'deepRough']).toContain(t.surfaceAt(o.x, o.z));
    }
    expect(terrains.reduce((s, t) => s + t.obstacles.length, 0)).toBeGreaterThan(150);
  });

  it('hazards exist where the design says', () => {
    const h2 = terrains[1];
    const burn = h2.centerline.pointAt(266);
    expect(h2.surfaceAt(burn.x, burn.z)).toBe('water');
    const h7 = terrains[6];
    const b = h7.bunkers[0].blob;
    expect(h7.surfaceAt(b.cx, b.cz)).toBe('sand');
    // Bunkers are below the surrounding ground.
    expect(h7.heightAt(b.cx, b.cz)).toBeLessThan(h7.landHeight(b.cx, b.cz) - 0.5);
  });

  it('suggests aiming at the pin when in range, along the fairway otherwise', () => {
    const t = terrains[0];
    const tee = t.teePosition();
    const far = t.suggestedAim(tee, 220);
    expect(Math.hypot(far.x - tee.x, far.z - tee.z)).toBeCloseTo(220, -1);
    const near = t.suggestedAim(t.cupPosition().setZ(t.cup.z + 50), 120);
    expect(near).toEqual({ x: t.cup.x, z: t.cup.z });
  });
});
