import { el } from './dom';
import { MiniMap } from './MiniMap';

/**
 * Heads-up display in the classic layout: hole banner and player card top-left, hole map top-right,
 * a small club tag floating beside the golfer, the swing meter at the bottom and a slim button bar.
 */
export class Hud {
  readonly root: HTMLDivElement;
  readonly meterSlot: HTMLDivElement;
  readonly buttons: HTMLDivElement;
  readonly minimap: MiniMap;
  private readonly course: HTMLDivElement;
  private readonly holeTitle: HTMLDivElement;
  private readonly holeInfo: HTMLDivElement;
  private readonly playerName: HTMLSpanElement;
  private readonly playerScore: HTMLSpanElement;
  private readonly shotLine: HTMLDivElement;
  private readonly lieLine: HTMLDivElement;
  private readonly tag: HTMLDivElement;
  private readonly tagClub: HTMLDivElement;
  private readonly tagInfo: HTMLDivElement;
  private readonly tagShape: HTMLDivElement;
  private readonly windCanvas: HTMLCanvasElement;
  private readonly windText: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private toastTimer = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud hidden', undefined, parent);

    const tl = el('div', 'panel hud-tl', undefined, this.root);
    const banner = el('div', 'banner', undefined, tl);
    this.course = el('div', 'banner-course', '', banner);
    this.holeTitle = el('div', 'hole-title', '', banner);
    this.holeInfo = el('div', 'hole-info', '', banner);
    const player = el('div', 'player-card', undefined, tl);
    const row = el('div', 'player-row', undefined, player);
    el('span', 'player-dot', '', row);
    this.playerName = el('span', 'player-name', '', row);
    this.playerScore = el('span', 'player-score', '', row);
    this.shotLine = el('div', 'shot-line', '', player);
    this.lieLine = el('div', 'lie-line', '', player);

    const tr = el('div', 'hud-tr', undefined, this.root);
    this.minimap = new MiniMap(tr);
    const wind = el('div', 'panel wind', undefined, tr);
    this.windCanvas = el('canvas', 'wind-canvas', undefined, wind);
    this.windCanvas.width = 96;
    this.windCanvas.height = 96;
    this.windText = el('div', 'wind-text', '', wind);

    this.tag = el('div', 'club-tag', undefined, this.root);
    this.tagClub = el('div', 'tag-club', '', this.tag);
    this.tagInfo = el('div', 'tag-info', '', this.tag);
    this.tagShape = el('div', 'tag-shape', '', this.tag);

    const bottom = el('div', 'hud-bottom', undefined, this.root);
    this.meterSlot = el('div', 'meter-slot', undefined, bottom);

    this.buttons = el('div', 'hud-buttons', undefined, this.root);
    this.toast = el('div', 'toast', '', this.root);
    this.sub = el('div', 'subtoast', '', this.root);
    this.help = el('div', 'help hidden', '', this.root);
    this.help.innerHTML = [
      '<b>Swing</b> Space / click (3 clicks: start, power, accuracy)',
      '<b>Aim</b> ← → (hold Shift for fine) · right-click the ground or the map',
      '<b>Club</b> ↑ ↓ or Q / E · <b>Shot shape</b> F · <b>Putter range</b> Z / X',
      '<b>Camera</b> C · <b>Overview</b> M · <b>Putt grid</b> G',
      '<b>Replay</b> R · <b>Scorecard</b> Tab · <b>Menu</b> Esc · <b>Help</b> H',
    ].join('<br>');
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  toggleHelp(force?: boolean): void {
    this.help.classList.toggle('hidden', force === undefined ? undefined : !force);
  }

  addButton(label: string, title: string, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = el('button', `hud-btn ${cls}`.trim(), label, this.buttons);
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    return b;
  }

  setHole(course: string, title: string, info: string): void {
    this.course.textContent = course;
    this.holeTitle.textContent = title;
    this.holeInfo.textContent = info;
  }

  setPlayer(name: string, score: string): void {
    this.playerName.textContent = name;
    this.playerScore.textContent = score;
  }

  setShot(shot: string, lie: string): void {
    this.shotLine.textContent = shot;
    this.lieLine.textContent = lie;
  }

  setClub(name: string, info: string, shape: string): void {
    this.tagClub.textContent = name;
    this.tagInfo.textContent = info;
    this.tagShape.textContent = shape;
  }

  /** Float the club tag beside the golfer (screen pixels). */
  placeClubTag(x: number, y: number, visible: boolean): void {
    this.tag.style.display = visible ? '' : 'none';
    if (visible) this.tag.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  /** Wind arrow drawn relative to the camera's heading so "up" means straight away from you. */
  setWind(relAngle: number, text: string, strength: number): void {
    this.windText.textContent = text || 'Calm';
    const c = this.windCanvas.getContext('2d')!;
    const W = this.windCanvas.width;
    c.clearRect(0, 0, W, W);
    const cx = W / 2;
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx, cx, W * 0.42, 0, Math.PI * 2);
    c.stroke();
    if (strength < 0.05) return;
    c.save();
    c.translate(cx, cx);
    c.rotate(relAngle);
    const len = W * 0.16 + Math.min(1, strength) * W * 0.2;
    c.fillStyle = strength > 0.6 ? '#ff7a59' : strength > 0.3 ? '#ffd23f' : '#9be7a9';
    c.beginPath();
    c.moveTo(0, -len);
    c.lineTo(10, -len + 16);
    c.lineTo(3.5, -len + 16);
    c.lineTo(3.5, len * 0.7);
    c.lineTo(-3.5, len * 0.7);
    c.lineTo(-3.5, -len + 16);
    c.lineTo(-10, -len + 16);
    c.closePath();
    c.fill();
    c.restore();
  }

  showToast(text: string, sub = '', ms = 2200, big = false): void {
    this.toast.textContent = text;
    this.sub.textContent = sub;
    this.toast.classList.toggle('big', big);
    this.toast.classList.add('on');
    this.sub.classList.toggle('on', !!sub);
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.classList.remove('on');
      this.sub.classList.remove('on');
    }, ms);
  }
}
