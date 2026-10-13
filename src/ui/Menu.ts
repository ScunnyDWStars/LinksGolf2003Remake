import type { CourseSpec } from '../course/types';
import { loadBest, type Settings } from '../game/Settings';
import { el } from './dom';

export type RoundKind = '18' | 'front' | 'back' | 'practice';

export interface StartOptions {
  kind: RoundKind;
  practiceHole: number;
}

type Choice<T> = { value: T; label: string };

/** Segmented control bound to one settings key. */
function segmented<K extends keyof Settings>(
  parent: HTMLElement,
  label: string,
  settings: Settings,
  key: K,
  choices: Choice<Settings[K]>[],
  onChange: () => void,
): void {
  const row = el('div', 'set-row', undefined, parent);
  el('div', 'set-label', label, row);
  const seg = el('div', 'seg', undefined, row);
  const buttons: HTMLButtonElement[] = [];
  for (const c of choices) {
    const b = el('button', 'seg-btn', c.label, seg);
    b.type = 'button';
    buttons.push(b);
    b.addEventListener('click', () => {
      settings[key] = c.value;
      buttons.forEach((x, i) => x.classList.toggle('on', choices[i].value === settings[key]));
      onChange();
    });
    b.classList.toggle('on', c.value === settings[key]);
  }
}

export function buildSettingsForm(parent: HTMLElement, s: Settings, onChange: () => void): void {
  const on = <T,>(v: T, label: string): Choice<T> => ({ value: v, label });
  segmented(parent, 'Swing', s, 'swingType', [on('classic', '3-Click'), on('mouse', 'Mouse Swing')], onChange);
  segmented(parent, 'Skill', s, 'difficulty', [on('amateur', 'Amateur'), on('pro', 'Pro'), on('champion', 'Champion')], onChange);
  segmented(parent, 'Power stroke', s, 'powerBoost', [on(false, 'Off'), on(true, 'On (+6%, harder)')], onChange);
  segmented(parent, 'Wind', s, 'wind', [on('calm', 'Calm'), on('breezy', 'Breezy'), on('windy', 'Windy')], onChange);
  segmented(parent, 'Ball cam', s, 'flightCam', [on('auto', 'TV'), on('chase', 'Chase'), on('stay', 'Tee')], onChange);
  segmented(parent, 'Flyovers', s, 'flyovers', [on(true, 'On'), on(false, 'Off')], onChange);
  segmented(parent, 'Gimmes', s, 'gimmes', [on(true, 'Inside 2 ft'), on(false, 'Off')], onChange);
  segmented(parent, 'Units', s, 'units', [on('yards', 'Yards'), on('meters', 'Metres')], onChange);
  segmented(parent, 'Sound', s, 'sound', [on(true, 'On'), on(false, 'Off')], onChange);
}

export class MainMenu {
  readonly root: HTMLDivElement;
  private readonly best: HTMLDivElement;

  constructor(parent: HTMLElement, course: CourseSpec, settings: Settings, onSettings: () => void, onStart: (o: StartOptions) => void) {
    this.root = el('div', 'overlay menu', undefined, parent);
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    const card = el('div', 'card menu-card', undefined, this.root);
    const head = el('div', 'menu-head', undefined, card);
    el('div', 'title', 'Greenside Classic', head);
    el('div', 'subtitle', `${course.name} · Par ${course.holes.reduce((s, h) => s + h.par, 0)}`, head);

    const cols = el('div', 'menu-cols', undefined, card);
    const left = el('div', 'menu-col', undefined, cols);
    el('h3', '', 'Golfer', left);
    const name = el('input', 'name-input', undefined, left);
    name.value = settings.playerName;
    name.maxLength = 18;
    name.addEventListener('input', () => {
      settings.playerName = name.value.trim() || 'Player 1';
      onSettings();
    });

    el('h3', '', 'Round', left);
    const kinds: { kind: RoundKind; label: string }[] = [
      { kind: '18', label: '18 Holes' },
      { kind: 'front', label: 'Front 9' },
      { kind: 'back', label: 'Back 9' },
      { kind: 'practice', label: 'Practice Hole' },
    ];
    let chosen: RoundKind = '18';
    const seg = el('div', 'seg wrap', undefined, left);
    const holeSel = el('select', 'hole-select hidden', undefined, left);
    for (const h of course.holes) {
      const o = el('option', '', `${h.number}. ${h.name} (Par ${h.par})`, holeSel);
      o.value = String(h.number);
    }
    const kindButtons = kinds.map((k) => {
      const b = el('button', 'seg-btn', k.label, seg);
      b.type = 'button';
      b.addEventListener('click', () => {
        chosen = k.kind;
        kindButtons.forEach((x, i) => x.classList.toggle('on', kinds[i].kind === chosen));
        holeSel.classList.toggle('hidden', chosen !== 'practice');
      });
      return b;
    });
    kindButtons[0].classList.add('on');

    const start = el('button', 'btn primary big', 'Tee Off', left);
    start.dataset.testid = 'tee-off';
    start.addEventListener('click', () => onStart({ kind: chosen, practiceHole: Number(holeSel.value) || 1 }));
    this.best = el('div', 'best', '', left);

    el('h3', '', 'How to play', left);
    const how = el('div', 'how', undefined, left);
    how.innerHTML =
      '<p><b>3-Click swing:</b> click (or Space) to start the backswing, click again to set power, and click a third time as the marker returns to the white snap line. Early = hook, late = slice.</p>' +
      '<p><b>Mouse swing:</b> press and drag down to take the club back, then push up smoothly. Keep it straight!</p>' +
      '<p>Aim with ← → or right-click the ground. Change club ↑ ↓. Press <b>H</b> in-game for all keys.</p>';

    const right = el('div', 'menu-col', undefined, cols);
    el('h3', '', 'Options', right);
    buildSettingsForm(right, settings, onSettings);
    this.refreshBest();
  }

  refreshBest(): void {
    const b = loadBest();
    const parts = [
      b['18'] !== undefined ? `18 holes: ${b['18']}` : '',
      b.front !== undefined ? `Front 9: ${b.front}` : '',
      b.back !== undefined ? `Back 9: ${b.back}` : '',
    ].filter(Boolean);
    this.best.textContent = parts.length ? `Best — ${parts.join(' · ')}` : '';
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
    if (v) this.refreshBest();
  }
}

export class PauseMenu {
  readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, settings: Settings, onSettings: () => void, actions: { resume: () => void; scorecard: () => void; quit: () => void }) {
    this.root = el('div', 'overlay pause hidden', undefined, parent);
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    const card = el('div', 'card', undefined, this.root);
    el('div', 'card-title', 'Paused', card);
    buildSettingsForm(card, settings, onSettings);
    const row = el('div', 'btn-row', undefined, card);
    el('button', 'btn primary', 'Resume', row).addEventListener('click', actions.resume);
    el('button', 'btn', 'Scorecard', row).addEventListener('click', actions.scorecard);
    el('button', 'btn danger', 'Quit Round', row).addEventListener('click', actions.quit);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }
}
