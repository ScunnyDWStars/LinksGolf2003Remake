/**
 * One table for everything a surface does: bounce, roll, how it affects the next shot, and how the HUD names it.
 * Physics, the lie panel and the shot modifiers all read from here.
 */
export type SurfaceType =
  | 'tee'
  | 'fairway'
  | 'fringe'
  | 'green'
  | 'rough'
  | 'deepRough'
  | 'sand'
  | 'water'
  | 'path'
  | 'ob';

export interface SurfaceProps {
  label: string;
  /** Normal restitution on landing. */
  restitution: number;
  /** Coulomb friction coefficient against the surface on each bounce. */
  bounceFriction: number;
  /** How strongly backspin bites on landing (m/s per 10k rpm per m/s of impact speed). */
  spinGrip: number;
  /** Rolling resistance coefficient (deceleration = mu * g). */
  rollResistance: number;
  /** Lie effects on the next shot from this surface. */
  lie: {
    power: number; // ball speed multiplier
    spin: number; // backspin multiplier
    /** Random extra accuracy error (meter units), applied as +/- spread. */
    scatter: number;
    /** Chance of a "flyer" (less spin, a little extra distance). */
    flyerChance: number;
  };
}

export const SURFACES: Record<SurfaceType, SurfaceProps> = {
  tee: {
    label: 'Tee',
    restitution: 0.32,
    bounceFriction: 0.45,
    spinGrip: 0.55,
    rollResistance: 0.11,
    lie: { power: 1, spin: 1, scatter: 0, flyerChance: 0 },
  },
  fairway: {
    label: 'Fairway',
    restitution: 0.3,
    bounceFriction: 0.45,
    spinGrip: 0.6,
    rollResistance: 0.15,
    lie: { power: 1, spin: 1, scatter: 0, flyerChance: 0 },
  },
  fringe: {
    label: 'Fringe',
    restitution: 0.26,
    bounceFriction: 0.6,
    spinGrip: 0.8,
    rollResistance: 0.16,
    lie: { power: 0.98, spin: 0.95, scatter: 0.004, flyerChance: 0 },
  },
  green: {
    label: 'Green',
    restitution: 0.22,
    bounceFriction: 0.75,
    spinGrip: 1.2,
    rollResistance: 0.058, // ~ stimp 10
    lie: { power: 1, spin: 1, scatter: 0, flyerChance: 0 },
  },
  rough: {
    label: 'Rough',
    restitution: 0.2,
    bounceFriction: 0.7,
    spinGrip: 0.25,
    rollResistance: 0.32,
    lie: { power: 0.9, spin: 0.65, scatter: 0.012, flyerChance: 0.15 },
  },
  deepRough: {
    label: 'Deep Rough',
    restitution: 0.12,
    bounceFriction: 0.9,
    spinGrip: 0.1,
    rollResistance: 0.6,
    lie: { power: 0.72, spin: 0.45, scatter: 0.03, flyerChance: 0.05 },
  },
  sand: {
    label: 'Bunker',
    restitution: 0.06,
    bounceFriction: 1.0,
    spinGrip: 0.1,
    rollResistance: 1.2,
    lie: { power: 0.7, spin: 0.6, scatter: 0.02, flyerChance: 0 },
  },
  path: {
    label: 'Path',
    restitution: 0.5,
    bounceFriction: 0.15,
    spinGrip: 0.2,
    rollResistance: 0.08,
    lie: { power: 0.95, spin: 0.8, scatter: 0.01, flyerChance: 0 },
  },
  water: {
    label: 'Water',
    restitution: 0,
    bounceFriction: 1,
    spinGrip: 0,
    rollResistance: 10,
    lie: { power: 0, spin: 0, scatter: 0, flyerChance: 0 },
  },
  ob: {
    label: 'Out of Bounds',
    restitution: 0.15,
    bounceFriction: 0.7,
    spinGrip: 0.1,
    rollResistance: 0.6,
    lie: { power: 0, spin: 0, scatter: 0, flyerChance: 0 },
  },
};
