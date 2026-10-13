export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const degToRad = (d: number) => (d * Math.PI) / 180;
export const radToDeg = (r: number) => (r * 180) / Math.PI;

export const M_PER_YD = 0.9144;
export const M_PER_FT = 0.3048;
export const MPS_PER_MPH = 0.44704;
export const toYards = (m: number) => m / M_PER_YD;
export const toFeet = (m: number) => m / M_PER_FT;

export interface Vec2 {
  x: number;
  z: number;
}

/** Angle wrapped into (-PI, PI]. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}
