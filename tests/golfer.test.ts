import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Golfer, solveTwoBone, swingPose } from '../src/render/Golfer';

describe('golfer rig', () => {
  it('keeps both bones at their lengths when solving a limb', () => {
    const s = new Vector3(0, 1.4, 0);
    const h = new Vector3(0.1, 1.0, 0.3); // within reach (0.51 m < 0.59 m)
    const e = solveTwoBone(s, h, 0.3, 0.29, new Vector3(0, 0, 1));
    expect(e.distanceTo(s)).toBeCloseTo(0.3, 5);
    expect(e.distanceTo(h)).toBeCloseTo(0.29, 5);
  });

  it.each(['wood', 'iron', 'putter'] as const)('puts the %s head on the ball at address and impact', (kind) => {
    const g = new Golfer();
    g.setClub(kind);
    g.placeAt(new Vector3(10, 0.02, 5), new Vector3(0, 0, -1), () => 0, kind === 'putter');
    for (const p of [0, 1, 0]) g.setSwing(p);
    expect(g.clubHeadLocal().distanceTo(g.ballInLocal)).toBeLessThan(0.03);
  });

  it('takes the club up and away from the target, then through to the finish', () => {
    const g = new Golfer();
    g.placeAt(new Vector3(), new Vector3(0, 0, -1), () => 0, false);
    g.setSwing(1);
    const top = g.clubHeadLocal();
    expect(top.y).toBeGreaterThan(1.4); // club head above the shoulders
    g.setSwing(-1);
    const finish = g.clubHeadLocal();
    expect(finish.y).toBeGreaterThan(1.0);
    expect(swingPose(1, false).shoulders).toBeLessThan(0);
    expect(swingPose(-1, false).shoulders).toBeGreaterThan(0);
    expect(swingPose(1, true).hinge).toBe(0); // putting stroke has no wrist hinge
  });
});
