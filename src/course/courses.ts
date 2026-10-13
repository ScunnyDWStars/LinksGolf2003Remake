import catalog from '../mapcourse/catalog.json';
import type { CourseData } from '../mapcourse/types';
import { CEDAR_RIDGE } from './cedarRidge';
import type { HoleInfo, PlayableHole } from './hole';
import { KESTREL_DUNES } from './kestrelDunes';
import { MappedHoleTerrain } from './mappedHole';
import { HoleTerrain, holeInfoFor } from './terrain';
import type { CourseSpec, CourseStyle } from './types';

/** One row of the course picker. */
export interface CourseEntry {
  id: string;
  name: string;
  place: string;
  country: string;
  style: CourseStyle;
  /** 'real': a real course from OpenStreetMap; 'original': designed for this game. */
  kind: 'real' | 'original';
  holes: number;
  par: number;
  yards: number;
  credits: string[];
  /** Course file, relative to the page, for real courses. */
  file?: string;
  spec?: CourseSpec;
}

/** A course ready to play: hole details plus a way to build each hole's terrain. */
export interface LoadedCourse {
  entry: CourseEntry;
  holes: HoleInfo[];
  makeHole(index: number): PlayableHole;
}

export const DEFAULT_COURSE = 'romanby';

const originalEntry = (spec: CourseSpec): CourseEntry => {
  const info = spec.holes.map(holeInfoFor);
  return {
    id: spec.id,
    name: spec.name,
    place: spec.location,
    country: '',
    style: spec.style,
    kind: 'original',
    holes: info.length,
    par: info.reduce((s, h) => s + h.par, 0),
    yards: info.reduce((s, h) => s + h.yards, 0),
    credits: [],
    spec,
  };
};

const realEntries: CourseEntry[] = catalog.courses
  .map((c) => ({
    id: c.id,
    name: c.name,
    place: c.place,
    country: c.country,
    style: (c.style === 'links' ? 'links' : 'parkland') as CourseStyle,
    kind: 'real' as const,
    holes: c.holes,
    par: c.par,
    yards: c.yards,
    credits: c.credits,
    file: c.file,
  }))
  .sort((a, b) => (a.id === DEFAULT_COURSE ? -1 : b.id === DEFAULT_COURSE ? 1 : a.name.localeCompare(b.name)));

export const COURSES: readonly CourseEntry[] = [...realEntries, originalEntry(CEDAR_RIDGE), originalEntry(KESTREL_DUNES)];

export function getCourseEntry(id: string): CourseEntry {
  return COURSES.find((c) => c.id === id) ?? COURSES[0];
}

const TYPICAL_YARDS = { 3: 180, 4: 400, 5: 520 } as const;

/**
 * Map data has no stroke index, so rank holes by how long they play for their par
 * (the usual way clubs set it): hardest = 1.
 */
export function strokeIndexes(holes: { par: number; yards: number }[]): number[] {
  const diff = holes.map((h, i) => ({ i, d: h.yards / TYPICAL_YARDS[(h.par >= 5 ? 5 : h.par <= 3 ? 3 : 4) as 3 | 4 | 5] }));
  diff.sort((a, b) => b.d - a.d);
  const out = new Array<number>(holes.length);
  diff.forEach((x, rank) => (out[x.i] = rank + 1));
  return out;
}

/** Wrap a real course's data so the game can play it. */
export function mappedCourse(entry: CourseEntry, data: CourseData): LoadedCourse {
  const par = (p: number) => (p <= 3 ? 3 : p >= 5 ? 5 : 4) as 3 | 4 | 5;
  const hcp = strokeIndexes(data.holes.map((h) => ({ par: h.par, yards: h.lengthYards })));
  const holes: HoleInfo[] = data.holes.map((h, i) => ({
    number: h.number,
    name: h.name ?? `Hole ${h.number}`,
    par: par(h.par),
    handicap: hcp[i],
    yards: h.lengthYards,
  }));
  return { entry, holes, makeHole: (i) => new MappedHoleTerrain(data, i, entry.style, holes[i]) };
}

const cache = new Map<string, Promise<LoadedCourse>>();

/** Load a course (real courses are fetched the first time they're picked). */
export function loadCourse(entry: CourseEntry): Promise<LoadedCourse> {
  if (entry.spec) {
    const spec = entry.spec;
    return Promise.resolve({ entry, holes: spec.holes.map(holeInfoFor), makeHole: (i) => new HoleTerrain(spec.holes[i], spec.style) });
  }
  let p = cache.get(entry.id);
  if (!p) {
    p = fetch(new URL(entry.file!, document.baseURI).href)
      .then((r) => {
        if (!r.ok) throw new Error(`Couldn't load ${entry.name} (HTTP ${r.status})`);
        return r.json() as Promise<CourseData>;
      })
      .then((data) => mappedCourse(entry, data));
    p.catch(() => cache.delete(entry.id));
    cache.set(entry.id, p);
  }
  return p;
}
