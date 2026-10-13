import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { KESTREL_DUNES } from '../src/course/kestrelDunes';
import { HoleTerrain } from '../src/course/terrain';
import { FlatGround } from '../src/physics/ground';
import type { ShotResult } from '../src/physics/simulator';
import { formatToPar, resolveShot, scoreName } from '../src/game/Rules';
import { Round } from '../src/game/Round';

const result = (over: Partial<ShotResult>): ShotResult => ({
  frames: [],
  duration: 0,
  outcome: 'rest',
  finalPos: new Vector3(0, 0, -100),
  finalSurface: 'fairway',
  carryPos: null,
  maxHeight: 0,
  events: [],
  ...over,
});

describe('resolveShot', () => {
  const prev = new Vector3(0, 0, 0);

  it('plays the ball where it lies', () => {
    const r = resolveShot(result({}), prev, new FlatGround());
    expect(r.penalty).toBe(0);
    expect(r.nextPos.z).toBe(-100);
  });

  it('out of bounds costs a stroke and replays from the previous spot', () => {
    const r = resolveShot(result({ outcome: 'ob' }), prev, new FlatGround());
    expect(r.penalty).toBe(1);
    expect(r.nextPos.equals(prev)).toBe(true);
  });

  it('water costs a stroke and drops behind the hazard on the line of entry', () => {
    // Hole 6 has a long pond down the right.
    const t = new HoleTerrain(KESTREL_DUNES.holes[5]);
    const pond = t.ponds[0].blob;
    const tee = t.teePosition();
    const r = resolveShot(
      result({ outcome: 'water', finalPos: new Vector3(pond.cx, 0, pond.cz), waterEntry: new Vector3(pond.cx - 20, 0, pond.cz + 5) }),
      tee,
      t,
    );
    expect(r.penalty).toBe(1);
    expect(t.surfaceAt(r.nextPos.x, r.nextPos.z)).not.toBe('water');
    // The drop is no further from the tee than the entry point.
    expect(r.nextPos.distanceTo(tee)).toBeLessThan(new Vector3(pond.cx - 20, tee.y, pond.cz + 5).distanceTo(tee));
  });

  it('holed balls finish the hole', () => {
    expect(resolveShot(result({ outcome: 'holed' }), prev, new FlatGround()).holed).toBe(true);
  });
});

describe('scoring', () => {
  it('names scores', () => {
    expect(scoreName(1, 3)).toBe('Hole in One!');
    expect(scoreName(3, 5)).toBe('Eagle!');
    expect(scoreName(3, 4)).toBe('Birdie!');
    expect(scoreName(4, 4)).toBe('Par');
    expect(scoreName(6, 4)).toBe('Double Bogey');
    expect(formatToPar(0)).toBe('E');
    expect(formatToPar(-2)).toBe('-2');
    expect(formatToPar(3)).toBe('+3');
  });

  it('totals a round relative to par', () => {
    const r = new Round('Test', KESTREL_DUNES.holes.slice(0, 3)); // pars 4, 4, 3
    r.record(0, { strokes: 3, putts: 1, penalties: 0, pickedUp: false });
    r.record(1, { strokes: 6, putts: 2, penalties: 1, pickedUp: false });
    expect(r.toPar).toBe(1);
    expect(r.totalStrokes).toBe(9);
    expect(r.complete).toBe(false);
    r.record(2, { strokes: 3, putts: 2, penalties: 0, pickedUp: false });
    expect(r.complete).toBe(true);
    expect(r.parTotal).toBe(11);
  });
});
