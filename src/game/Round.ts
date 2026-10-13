import type { HoleSpec } from '../course/types';

export interface HoleScore {
  strokes: number;
  putts: number;
  penalties: number;
  pickedUp: boolean;
}

/** Scores for one player over a selection of holes. */
export class Round {
  readonly scores: (HoleScore | null)[];

  constructor(
    readonly playerName: string,
    readonly holes: readonly HoleSpec[],
  ) {
    this.scores = holes.map(() => null);
  }

  record(index: number, score: HoleScore): void {
    this.scores[index] = score;
  }

  get played(): number {
    return this.scores.filter(Boolean).length;
  }

  get complete(): boolean {
    return this.played === this.holes.length;
  }

  get totalStrokes(): number {
    return this.scores.reduce((s, h) => s + (h?.strokes ?? 0), 0);
  }

  /** Relative to par over the holes played so far. */
  get toPar(): number {
    return this.scores.reduce((s, h, i) => s + (h ? h.strokes - this.holes[i].par : 0), 0);
  }

  get totalPutts(): number {
    return this.scores.reduce((s, h) => s + (h?.putts ?? 0), 0);
  }

  get parTotal(): number {
    return this.holes.reduce((s, h) => s + h.par, 0);
  }
}
