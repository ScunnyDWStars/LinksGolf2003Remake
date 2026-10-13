import type { CourseEntry } from '../course/courses';
import { holeInfoFor } from '../course/terrain';
import { loadBest, type Settings } from '../game/Settings';
import { el } from './dom';

export type RoundKind = '18' | 'front' | 'back' | 'practice';

export interface StartOptions {
  kind: RoundKind;
  /** Index into the course's holes for a practice round. */
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
  private best: HTMLDivElement | null = null;
  private start: HTMLButtonElement | null = null;
  private status: HTMLDivElement | null = null;

  constructor(
    parent: HTMLElement,
    private readonly courses: readonly CourseEntry[],
    private readonly settings: Settings,
    onSettings: () => void,
    onStart: (o: StartOptions) => void,
    onCourse: () => void,
  ) {
    this.root = el('div', 'overlay menu', undefined, parent);
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    const card = el('div', 'card menu-card', undefined, this.root);
    const head = el('div', 'menu-head', undefined, card);
    el('div', 'title', 'Greenside Classic', head);
    const subtitle = el('div', 'subtitle', '', head);
    const course = () => courses.find((c) => c.id === settings.courseId) ?? courses[0];

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

    el('h3', '', 'Course', left);
    const list = el('div', 'course-list', undefined, left);
    const courseButtons: { id: string; b: HTMLButtonElement }[] = [];
    for (const [kind, label] of [
      ['real', 'Real courses'],
      ['original', 'Original courses'],
    ] as const) {
      const group = courses.filter((c) => c.kind === kind);
      if (!group.length) continue;
      el('div', 'course-group', label, list);
      for (const c of group) {
        const b = el('button', 'course-card', undefined, list);
        b.type = 'button';
        b.dataset.course = c.id;
        el('span', 'course-name', c.name, b);
        el('span', 'course-meta', [c.place, c.country].filter(Boolean).join(', ') || 'Designed for this game', b);
        el('span', 'course-stats', `${c.holes} holes · Par ${c.par} · ${c.yards.toLocaleString()} yds · ${c.style === 'links' ? 'Links' : 'Parkland'}`, b);
        b.addEventListener('click', () => {
          settings.courseId = c.id;
          refreshCourse();
          onSettings();
          onCourse();
        });
        courseButtons.push({ id: c.id, b });
      }
    }
    const credit = el('div', 'course-credit', '', left);

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
    const refreshCourse = () => {
      const c = course();
      subtitle.textContent = `${c.name} · Par ${c.par}`;
      courseButtons.forEach(({ id, b }) => b.classList.toggle('on', id === c.id));
      credit.textContent = c.credits.join(' · ');
      holeSel.innerHTML = '';
      const names = c.spec ? c.spec.holes.map((h) => { const i = holeInfoFor(h); return `${i.number}. ${i.name} (Par ${i.par})`; }) : Array.from({ length: c.holes }, (_, i) => `Hole ${i + 1}`);
      names.forEach((label, i) => {
        const o = el('option', '', label, holeSel);
        o.value = String(i);
      });
      this.refreshBest();
    };
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
    start.addEventListener('click', () => onStart({ kind: chosen, practiceHole: Number(holeSel.value) || 0 }));
    this.start = start;
    this.status = el('div', 'menu-status', '', left);
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
    refreshCourse();
  }

  refreshBest(): void {
    if (!this.best) return;
    const b = loadBest();
    const id = this.settings.courseId;
    const parts = [
      b[`${id}:18`] !== undefined ? `18 holes: ${b[`${id}:18`]}` : '',
      b[`${id}:front`] !== undefined ? `Front 9: ${b[`${id}:front`]}` : '',
      b[`${id}:back`] !== undefined ? `Back 9: ${b[`${id}:back`]}` : '',
    ].filter(Boolean);
    this.best.textContent = parts.length ? `Best — ${parts.join(' · ')}` : '';
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
    if (v) this.refreshBest();
  }

  /** While a course file downloads. */
  setBusy(busy: boolean, message = ''): void {
    if (this.start) {
      this.start.disabled = busy;
      this.start.textContent = busy ? 'Loading course…' : 'Tee Off';
    }
    if (this.status) this.status.textContent = message;
  }

  get courseCount(): number {
    return this.courses.length;
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
