import { formatToPar } from '../game/Rules';
import type { Round } from '../game/Round';
import { el } from './dom';

/** The classic two-row (Out / In) scorecard. */
export class Scorecard {
  readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly footer: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private onContinue: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'overlay scorecard hidden', undefined, parent);
    const card = el('div', 'card', undefined, this.root);
    this.title = el('div', 'card-title', 'Scorecard', card);
    this.body = el('div', 'card-body', undefined, card);
    this.footer = el('div', 'card-footer', '', card);
    this.button = el('button', 'btn primary', 'Continue', card);
    this.button.addEventListener('click', () => this.continue());
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  continue(): void {
    const cb = this.onContinue;
    this.hide();
    cb?.();
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.onContinue = null;
  }

  show(round: Round, courseName: string, opts: { title?: string; footer?: string; button?: string; onContinue?: () => void } = {}): void {
    this.title.textContent = opts.title ?? `${courseName} — ${round.playerName}`;
    this.footer.textContent = opts.footer ?? '';
    this.button.textContent = opts.button ?? 'Close';
    this.onContinue = opts.onContinue ?? null;
    this.body.innerHTML = '';
    const holes = round.holes;
    const yards = (h: (typeof holes)[number]) => h.yards;
    const halves: number[][] = [];
    const front = holes.map((h, i) => (h.number <= 9 ? i : -1)).filter((i) => i >= 0);
    const back = holes.map((h, i) => (h.number > 9 ? i : -1)).filter((i) => i >= 0);
    if (front.length) halves.push(front);
    if (back.length) halves.push(back);

    for (const idxs of halves) {
      const table = el('table', 'sc', undefined, this.body);
      const label = holes[idxs[0]].number <= 9 ? 'Out' : 'In';
      const row = (name: string, cells: (string | HTMLElement)[], total: string, cls = '') => {
        const tr = el('tr', cls, undefined, table);
        el('th', '', name, tr);
        for (const c of cells) {
          const td = el('td', '', undefined, tr);
          if (typeof c === 'string') td.textContent = c;
          else td.appendChild(c);
        }
        el('td', 'tot', total, tr);
      };
      row('Hole', idxs.map((i) => String(holes[i].number)), label, 'head');
      row('Yards', idxs.map((i) => String(yards(holes[i]))), String(idxs.reduce((s, i) => s + yards(holes[i]), 0)), 'dim');
      row('Par', idxs.map((i) => String(holes[i].par)), String(idxs.reduce((s, i) => s + holes[i].par, 0)));
      row('Hcp', idxs.map((i) => String(holes[i].handicap)), '', 'dim');
      let sum = 0;
      let any = false;
      row(
        round.playerName,
        idxs.map((i) => {
          const s = round.scores[i];
          const span = el('span', 'mark');
          if (!s) return span;
          any = true;
          sum += s.strokes;
          span.textContent = String(s.strokes);
          const d = s.strokes - holes[i].par;
          span.classList.add(d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : 'dbl');
          return span;
        }),
        any ? String(sum) : '',
        'player',
      );
      row('Putts', idxs.map((i) => (round.scores[i] ? String(round.scores[i]!.putts) : '')), '', 'dim');
    }
    const summary = el('div', 'sc-summary', undefined, this.body);
    summary.textContent = round.played
      ? `Total ${round.totalStrokes} (${formatToPar(round.toPar)}) · Putts ${round.totalPutts} · Thru ${round.played}`
      : 'No holes played yet';
    this.root.classList.remove('hidden');
  }
}
