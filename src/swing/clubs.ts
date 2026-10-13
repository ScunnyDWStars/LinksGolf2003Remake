export interface Club {
  id: string;
  name: string;
  short: string;
  /** Ball speed at 100% power, m/s. */
  ballSpeed: number;
  /** Launch angle, degrees. */
  launchDeg: number;
  /** Backspin, rpm. */
  spinRpm: number;
  isPutter?: boolean;
  isWood?: boolean;
}

/**
 * A full 14-club bag. Numbers are a strong amateur / modest tour player; the driver carries ~250 yd.
 */
export const BAG: readonly Club[] = [
  { id: 'dr', name: 'Driver', short: 'Dr', ballSpeed: 69, launchDeg: 12, spinRpm: 2650, isWood: true },
  { id: '3w', name: '3 Wood', short: '3W', ballSpeed: 62.6, launchDeg: 11.5, spinRpm: 3500, isWood: true },
  { id: '5w', name: '5 Wood', short: '5W', ballSpeed: 58.4, launchDeg: 12.5, spinRpm: 4200, isWood: true },
  { id: '3i', name: '3 Iron', short: '3i', ballSpeed: 55.2, launchDeg: 12, spinRpm: 4500 },
  { id: '4i', name: '4 Iron', short: '4i', ballSpeed: 52.5, launchDeg: 13.5, spinRpm: 4900 },
  { id: '5i', name: '5 Iron', short: '5i', ballSpeed: 50.0, launchDeg: 15, spinRpm: 5400 },
  { id: '6i', name: '6 Iron', short: '6i', ballSpeed: 48.2, launchDeg: 16.5, spinRpm: 6100 },
  { id: '7i', name: '7 Iron', short: '7i', ballSpeed: 45.6, launchDeg: 18.5, spinRpm: 6900 },
  { id: '8i', name: '8 Iron', short: '8i', ballSpeed: 43.0, launchDeg: 20.5, spinRpm: 7700 },
  { id: '9i', name: '9 Iron', short: '9i', ballSpeed: 40.5, launchDeg: 23, spinRpm: 8400 },
  { id: 'pw', name: 'Pitching Wedge', short: 'PW', ballSpeed: 37.7, launchDeg: 26, spinRpm: 9000 },
  { id: 'gw', name: 'Gap Wedge', short: 'GW', ballSpeed: 34.6, launchDeg: 28.5, spinRpm: 9400 },
  { id: 'sw', name: 'Sand Wedge', short: 'SW', ballSpeed: 31.2, launchDeg: 31, spinRpm: 9800 },
  { id: 'lw', name: 'Lob Wedge', short: 'LW', ballSpeed: 27.7, launchDeg: 35, spinRpm: 10000 },
  { id: 'pt', name: 'Putter', short: 'Pt', ballSpeed: 0, launchDeg: 0, spinRpm: 0, isPutter: true },
];

export const PUTTER_INDEX = BAG.length - 1;
export const DRIVER_INDEX = 0;

export function clubIndex(id: string): number {
  return BAG.findIndex((c) => c.id === id);
}
