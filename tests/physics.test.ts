import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { BALL_RADIUS } from '../src/physics/constants';
import { spinAxisFor } from '../src/physics/flight';
import { FlatGround } from '../src/physics/ground';
import { captureSpeed, cupInteraction, puttSpeedForDistance } from '../src/physics/putting';
import { simulateShot, type Launch } from '../src/physics/simulator';
import { BAG, clubIndex } from '../src/swing/clubs';
import { fullCarry } from '../src/swing/distances';
import { M_PER_YD } from '../src/util/math';
import { makeRng } from '../src/util/rng';

function launchFor(clubId: string, speedMul = 1, tilt = 0): Launch {
  const c = BAG[clubIndex(clubId)];
  const a = (c.launchDeg * Math.PI) / 180;
  const dir = new Vector3(0, Math.sin(a), -Math.cos(a));
  return {
    pos: new Vector3(0, 0.03, 0),
    vel: dir.clone().multiplyScalar(c.ballSpeed * speedMul),
    spinAxis: spinAxisFor(dir, tilt),
    spinRpm: c.spinRpm,
  };
}

const carryYds = (r: ReturnType<typeof simulateShot>) => -(r.carryPos?.z ?? 0) / M_PER_YD;

describe('ball flight', () => {
  const flat = new FlatGround('fairway');
  const still = new Vector3();

  it('driver carries about 250 yards', () => {
    const r = simulateShot(launchFor('dr'), flat, still, makeRng(1));
    expect(carryYds(r)).toBeGreaterThan(235);
    expect(carryYds(r)).toBeLessThan(270);
    expect(r.outcome).toBe('rest');
  });

  it('pitching wedge carries about 120 yards and stops quickly', () => {
    const r = simulateShot(launchFor('pw'), flat, still, makeRng(1));
    expect(carryYds(r)).toBeGreaterThan(110);
    expect(carryYds(r)).toBeLessThan(130);
    const rollYds = (r.carryPos!.z - r.finalPos.z) / M_PER_YD;
    expect(rollYds).toBeLessThan(15);
  });

  it('clubs get progressively shorter through the bag', () => {
    const carries = BAG.filter((c) => !c.isPutter).map((c) => fullCarry(c));
    for (let i = 1; i < carries.length; i++) expect(carries[i]).toBeLessThan(carries[i - 1]);
  });

  it('headwind shortens and tailwind lengthens the carry', () => {
    const base = carryYds(simulateShot(launchFor('7i'), flat, still, makeRng(1)));
    const head = carryYds(simulateShot(launchFor('7i'), flat, new Vector3(0, 0, 6), makeRng(1)));
    const tail = carryYds(simulateShot(launchFor('7i'), flat, new Vector3(0, 0, -6), makeRng(1)));
    expect(head).toBeLessThan(base - 5);
    expect(tail).toBeGreaterThan(base + 3);
  });

  it('crosswind pushes the ball downwind', () => {
    const r = simulateShot(launchFor('7i'), flat, new Vector3(6, 0, 0), makeRng(1));
    expect(r.finalPos.x).toBeGreaterThan(3);
  });

  it('positive spin-axis tilt curves the ball right, negative curves left', () => {
    const fade = simulateShot(launchFor('7i', 1, 0.2), flat, still, makeRng(1));
    const draw = simulateShot(launchFor('7i', 1, -0.2), flat, still, makeRng(1));
    expect(fade.carryPos!.x).toBeGreaterThan(5);
    expect(draw.carryPos!.x).toBeLessThan(-5);
  });

  it('rough stops the ball sooner than fairway', () => {
    const fw = simulateShot(launchFor('5i'), flat, still, makeRng(1));
    const rough = simulateShot(launchFor('5i'), new FlatGround('rough'), still, makeRng(1));
    const roll = (r: typeof fw) => r.carryPos!.z - r.finalPos.z;
    expect(roll(rough)).toBeLessThan(roll(fw));
  });

  it('landing in water ends the shot with a splash', () => {
    const r = simulateShot(launchFor('7i'), new FlatGround('water'), still, makeRng(1));
    expect(r.outcome).toBe('water');
    expect(r.waterEntry).toBeDefined();
  });
});

describe('rolling', () => {
  it('a rolling ball stops on flat ground', () => {
    const g = new FlatGround('green');
    const r = simulateShot(
      { pos: new Vector3(0, BALL_RADIUS, 0), vel: new Vector3(0, 0, -2), spinAxis: new Vector3(1, 0, 0), spinRpm: 0, rolling: true },
      g,
      new Vector3(),
      makeRng(1),
    );
    expect(r.outcome).toBe('rest');
    expect(r.duration).toBeLessThan(10);
  });

  it('a ball placed on a steep slope rolls downhill', () => {
    const g = new FlatGround('fairway', { x: 0.3, z: 0 }); // rises toward +x
    const r = simulateShot(
      { pos: new Vector3(0, 0, 0), vel: new Vector3(0, 0, 0), spinAxis: new Vector3(1, 0, 0), spinRpm: 0, rolling: true },
      g,
      new Vector3(),
      makeRng(1),
    );
    expect(r.finalPos.x).toBeLessThan(-0.5);
  });

  it('putts roll close to the distance they were struck for on a flat green', () => {
    const g = new FlatGround('green');
    for (const d of [2, 5, 10]) {
      const r = simulateShot(
        { pos: new Vector3(0, 0, 0), vel: new Vector3(0, 0, -puttSpeedForDistance(d)), spinAxis: new Vector3(1, 0, 0), spinRpm: 0, rolling: true },
        g,
        new Vector3(),
        makeRng(1),
      );
      expect(Math.abs(-r.finalPos.z - d)).toBeLessThan(d * 0.15 + 0.15);
    }
  });
});

describe('cup', () => {
  it('captures slow balls near the centre and rejects fast ones', () => {
    expect(cupInteraction(1.0, 0)).toBe('holed');
    expect(cupInteraction(2.5, 0)).toBe('lipout');
    expect(cupInteraction(1.0, 0.06)).toBe('none');
    expect(captureSpeed(0.05)).toBeLessThan(captureSpeed(0));
  });

  it('a well-paced putt at the hole drops', () => {
    const g = new FlatGround('green');
    g.cup = { x: 0, z: -4 };
    const r = simulateShot(
      { pos: new Vector3(0, 0, 0), vel: new Vector3(0, 0, -puttSpeedForDistance(4.4)), spinAxis: new Vector3(1, 0, 0), spinRpm: 0, rolling: true },
      g,
      new Vector3(),
      makeRng(1),
    );
    expect(r.outcome).toBe('holed');
  });

  it('a putt rammed far too hard does not drop', () => {
    const g = new FlatGround('green');
    g.cup = { x: 0, z: -2 };
    const r = simulateShot(
      { pos: new Vector3(0, 0, 0), vel: new Vector3(0, 0, -puttSpeedForDistance(12)), spinAxis: new Vector3(1, 0, 0), spinRpm: 0, rolling: true },
      g,
      new Vector3(),
      makeRng(1),
    );
    expect(r.outcome).not.toBe('holed');
  });
});
