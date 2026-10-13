import type { Game } from '../game/Game';

/** Keyboard, mouse and touch. Continuous keys (aiming) are exposed via `held`; everything else calls the game. */
export class Input {
  readonly held = new Set<string>();
  private touchTimer = 0;
  private touchStart: { x: number; y: number; t: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly game: Game,
  ) {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.held.delete(norm(e.key)));
    window.addEventListener('blur', () => this.held.clear());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.game.mouseSwingMove(e.clientX, e.clientY));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', () => this.game.mouseSwingEnd());
  }

  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    const k = norm(e.key);
    if (['ArrowLeft', 'ArrowRight', 'a', 'd', 'Shift'].includes(k)) {
      this.held.add(k);
      e.preventDefault();
      return;
    }
    if (e.repeat && k !== 'ArrowUp' && k !== 'ArrowDown') return;
    const g = this.game;
    switch (k) {
      case ' ':
      case 'Enter':
        e.preventDefault();
        g.primary();
        break;
      case 'ArrowUp':
      case 'w':
      case 'q':
        e.preventDefault();
        g.changeClub(-1);
        break;
      case 'ArrowDown':
      case 's':
      case 'e':
        e.preventDefault();
        g.changeClub(1);
        break;
      case 'z':
        g.changePuttRange(-1);
        break;
      case 'x':
        g.changePuttRange(1);
        break;
      case 'f':
        g.cycleShape();
        break;
      case 'c':
        g.cycleCamera();
        break;
      case 'm':
        g.toggleOverview();
        break;
      case 'g':
        g.toggleGrid();
        break;
      case 'r':
        g.replay();
        break;
      case 'h':
        g.toggleHelp();
        break;
      case 'Tab':
        e.preventDefault();
        g.showScorecard();
        break;
      case 'Escape':
        g.escape();
        break;
      default:
        break;
    }
  }

  private ndc(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1];
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button === 2) {
      const [x, y] = this.ndc(e);
      this.game.aimAtScreen(x, y);
      return;
    }
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    if (this.game.mouseSwingStart(e.clientX, e.clientY)) return;
    if (e.pointerType === 'touch') {
      // Tap = swing click; press and hold = aim at that spot.
      this.touchStart = { x: e.clientX, y: e.clientY, t: performance.now() };
      const [nx, ny] = this.ndc(e);
      window.clearTimeout(this.touchTimer);
      this.touchTimer = window.setTimeout(() => {
        this.touchStart = null;
        this.game.aimAtScreen(nx, ny);
      }, 450);
      return;
    }
    this.game.primary();
  }

  private onPointerUp(e: PointerEvent): void {
    this.game.mouseSwingEnd();
    if (e.pointerType === 'touch' && this.touchStart) {
      window.clearTimeout(this.touchTimer);
      this.touchStart = null;
      this.game.primary();
    }
  }
}

function norm(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}
