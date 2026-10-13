import { el } from './dom';

/** Heads-up display: hole info, score, club, lie, distance, wind and the message toast. */
export class Hud {
  readonly root: HTMLDivElement;
  readonly meterSlot: HTMLDivElement;
  readonly buttons: HTMLDivElement;
  private readonly holeTitle: HTMLDivElement;
  private readonly holeInfo: HTMLDivElement;
  private readonly score: HTMLDivElement;
  private readonly clubName: HTMLDivElement;
  private readonly clubInfo: HTMLDivElement;
  private readonly shape: HTMLDivElement;
  private readonly lie: HTMLDivElement;
  private readonly toPin: HTMLDivElement;
  private readonly shot: HTMLDivElement;
  private readonly elev: HTMLDivElement;
  private readonly windCanvas: HTMLCanvasElement;
  private readonly windText: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private toastTimer = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud hidden', undefined, parent);

    const tl = el('div', 'panel hud-tl', undefined, this.root);
    this.holeTitle = el('div', 'hole-title', '', tl);
    this.holeInfo = el('div', 'hole-info', '', tl);
    this.score = el('div', 'score-line', '', tl);

    const tr = el('div', 'panel hud-tr', undefined, this.root);
    this.windCanvas = el('canvas', 'wind-canvas', undefined, tr);
    this.windCanvas.width = 120;
    this.windCanvas.height = 120;
    this.windText = el('div', 'wind-text', '', tr);

    const bottom = el('div', 'hud-bottom', undefined, this.root);
    const left = el('div', 'panel club-panel', undefined, bottom);
    el('div', 'panel-label', 'Club', left);
    this.clubName = el('div', 'club-name', '', left);
    this.clubInfo = el('div', 'club-info', '', left);
    this.shape = el('div', 'club-shape', '', left);
    this.meterSlot = el('div', 'meter-slot', undefined, bottom);
    const right = el('div', 'panel shot-panel', undefined, bottom);
    el('div', 'panel-label', 'Shot', right);
    this.toPin = el('div', 'to-pin', '', right);
    this.lie = el('div', 'lie', '', right);
    this.elev = el('div', 'elev', '', right);
    this.shot = el('div', 'shot-num', '', right);

    this.buttons = el('div', 'hud-buttons', undefined, this.root);
    this.toast = el('div', 'toast', '', this.root);
    this.sub = el('div', 'subtoast', '', this.root);
    this.help = el('div', 'help hidden', '', this.root);
    this.help.innerHTML = [
      '<b>Swing</b> Space / click (3 clicks: start, power, accuracy)',
      '<b>Aim</b> ← → (hold Shift for fine) · right-click the ground',
      '<b>Club</b> ↑ ↓ or Q / E · <b>Shot shape</b> F',
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

  addButton(label: string, title: string, onClick: () => void, id?: string): HTMLButtonElement {
    const b = el('button', 'hud-btn', label, this.buttons);
    b.title = title;
    if (id) b.dataset.id = id;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    return b;
  }

  setHole(title: string, info: string): void {
    this.holeTitle.textContent = title;
    this.holeInfo.textContent = info;
  }

  setScore(text: string): void {
    this.score.textContent = text;
  }

  setClub(name: string, info: string, shape: string): void {
    this.clubName.textContent = name;
    this.clubInfo.textContent = info;
    this.shape.textContent = shape;
  }

  setShot(toPin: string, lie: string, elev: string, shot: string): void {
    this.toPin.textContent = toPin;
    this.lie.textContent = lie;
    this.elev.textContent = elev;
    this.shot.textContent = shot;
  }

  /** Wind arrow drawn relative to the camera's heading so "up" means straight away from you. */
  setWind(relAngle: number, text: string, strength: number): void {
    this.windText.textContent = text;
    const c = this.windCanvas.getContext('2d')!;
    const W = this.windCanvas.width;
    c.clearRect(0, 0, W, W);
    const cx = W / 2;
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx, cx, W * 0.42, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = '12px system-ui';
    c.textAlign = 'center';
    c.fillText('▲', cx, 12);
    if (strength < 0.05) {
      c.fillStyle = '#fff';
      c.font = 'bold 16px system-ui';
      c.fillText('Calm', cx, cx + 5);
      return;
    }
    c.save();
    c.translate(cx, cx);
    c.rotate(relAngle);
    const len = W * 0.18 + Math.min(1, strength) * W * 0.18;
    c.fillStyle = strength > 0.6 ? '#ff7a59' : strength > 0.3 ? '#ffd23f' : '#9be7a9';
    c.beginPath();
    c.moveTo(0, -len);
    c.lineTo(11, -len + 18);
    c.lineTo(4, -len + 18);
    c.lineTo(4, len * 0.7);
    c.lineTo(-4, len * 0.7);
    c.lineTo(-4, -len + 18);
    c.lineTo(-11, -len + 18);
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
