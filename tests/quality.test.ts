import { describe, expect, it } from 'vitest';
import { autoLevel, FrameGovernor, lowerLevel, presetFor, resolveLevel, type DeviceInfo } from '../src/render/Quality';

const desk: DeviceInfo = { gpu: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)', touch: false, width: 1920, height: 1080, cores: 8 };

describe('graphics presets', () => {
  it('picks a preset from the device', () => {
    expect(autoLevel(desk)).toBe('high');
    expect(autoLevel({ ...desk, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070)' })).toBe('ultra');
    expect(autoLevel({ ...desk, gpu: 'Apple GPU', touch: true, width: 390, height: 844 })).toBe('medium');
    expect(autoLevel({ ...desk, gpu: 'Google SwiftShader' })).toBe('low');
    expect(autoLevel({ ...desk, cores: 2 })).toBe('medium');
  });

  it('lets the URL override the setting, and ignores junk', () => {
    expect(resolveLevel('ultra', 'low', desk)).toBe('low');
    expect(resolveLevel('medium', 'banana', desk)).toBe('medium');
    expect(resolveLevel('auto', null, desk)).toBe('high');
  });

  it('turns more on at each step up', () => {
    const [l, m, h, u] = (['low', 'medium', 'high', 'ultra'] as const).map(presetFor);
    expect(l.post).toBe(false);
    expect(l.grass).toBe(0);
    expect(m.grass).toBeLessThan(h.grass);
    expect(h.grass).toBeLessThan(u.grass);
    expect(m.cascades).toBeLessThanOrEqual(h.cascades);
    expect(u.ao && h.ao).toBe(true);
    expect(lowerLevel('ultra')).toBe('high');
    expect(lowerLevel('low')).toBe('low');
  });
});

describe('FrameGovernor', () => {
  it('asks for less only after frames stay slow, then cools down', () => {
    const g = new FrameGovernor(28, 3);
    let drops = 0;
    // Startup grace period, then 3 s of 40 ms frames.
    for (let i = 0; i < 300; i++) if (g.sample(40)) drops++;
    expect(drops).toBe(1);
  });

  it('ignores the odd slow frame', () => {
    const g = new FrameGovernor(28, 3);
    let drops = 0;
    for (let i = 0; i < 2000; i++) if (g.sample(i % 10 === 0 ? 60 : 16)) drops++;
    expect(drops).toBe(0);
  });
});
