export type SwingType = 'classic' | 'mouse';
export type Difficulty = 'amateur' | 'pro' | 'champion';
export type WindSetting = 'calm' | 'breezy' | 'windy';
export type Units = 'yards' | 'meters';
export type { GfxSetting } from '../render/Quality';
import type { GfxSetting } from '../render/Quality';

export interface Settings {
  playerName: string;
  courseId: string;
  swingType: SwingType;
  difficulty: Difficulty;
  powerBoost: boolean;
  wind: WindSetting;
  units: Units;
  flightCam: 'auto' | 'chase' | 'stay';
  flyovers: boolean;
  gimmes: boolean;
  sound: boolean;
  graphics: GfxSetting;
}

export const DEFAULT_SETTINGS: Settings = {
  playerName: 'Player 1',
  courseId: 'romanby',
  swingType: 'classic',
  difficulty: 'pro',
  powerBoost: false,
  wind: 'breezy',
  units: 'yards',
  flightCam: 'auto',
  flyovers: true,
  gimmes: true,
  sound: true,
  graphics: 'auto',
};

const KEY = 'greenside-classic.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* storage unavailable: use defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const BEST_KEY = 'greenside-classic.best.v1';

/** Best (lowest) score per course and round type, e.g. "cedar:18", "kestrel:front". */
export function loadBest(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

export function saveBest(kind: string, strokes: number): boolean {
  const best = loadBest();
  if (best[kind] !== undefined && best[kind] <= strokes) return false;
  best[kind] = strokes;
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    /* ignore */
  }
  return true;
}
