import * as THREE from 'three';
import { Sfx } from '../audio/Sfx';
import { COURSES, getCourse } from '../course/courses';
import { animateFlag, buildHoleMeshes, type HoleMeshes } from '../course/meshBuilder';
import { HoleTerrain } from '../course/terrain';
import type { CourseSpec, HoleSpec } from '../course/types';
import { Input } from '../input/Input';
import { FRAME_DT } from '../physics/constants';
import { simulateShot, type ShotResult } from '../physics/simulator';
import { SURFACES, type SurfaceType } from '../physics/surfaces';
import { AimMarker } from '../render/AimMarker';
import { BallView } from '../render/BallView';
import { CameraDirector } from '../render/Cameras';
import { Golfer } from '../render/Golfer';
import { PuttGrid } from '../render/PuttGrid';
import type { GameScene } from '../render/Scene';
import { BAG, DRIVER_INDEX, PUTTER_INDEX, type Club } from '../swing/clubs';
import { fullCarry } from '../swing/distances';
import { buildShot, dirFromYaw, SHAPE_LABEL, SHOT_SHAPES, type ShotShape } from '../swing/ShotModifiers';
import { DIFFICULTY, MouseSwing, SwingMeter, type SwingResult } from '../swing/SwingMeter';
import { Hud } from '../ui/Hud';
import { MainMenu, PauseMenu, type StartOptions } from '../ui/Menu';
import { Scorecard } from '../ui/Scorecard';
import { SwingMeterView } from '../ui/SwingMeterView';
import { M_PER_FT, MPS_PER_MPH, toFeet, toYards, wrapAngle } from '../util/math';
import { hashSeed, makeRng, type Rng } from '../util/rng';
import { formatToPar, GIMME_DISTANCE, MAX_STROKES, resolveShot, scoreName } from './Rules';
import { Round } from './Round';
import { loadSettings, saveBest, saveSettings, type Settings } from './Settings';

type Phase = 'menu' | 'flyover' | 'aiming' | 'swinging' | 'flight' | 'settling' | 'holeOver' | 'roundOver' | 'replay';

const PUTT_RANGES = [3, 6, 10, 15, 22, 32]; // metres a 100% putt rolls on a flat green
const ACCURACY_SENSITIVITY = { amateur: 0.6, pro: 1, champion: 1.3 } as const;
const WIND_MPH = { calm: [0, 4], breezy: [3, 12], windy: [10, 22] } as const;

interface ActiveShot {
  result: ShotResult;
  t: number;
  start: THREE.Vector3;
  nextEvent: number;
  club: Club;
  putt: boolean;
  replay: boolean;
}

export class Game {
  readonly settings: Settings = loadSettings();
  readonly sfx = new Sfx();
  private readonly ui: HTMLElement;
  private readonly hud: Hud;
  private readonly meterView: SwingMeterView;
  private readonly scorecard: Scorecard;
  private readonly menu: MainMenu;
  private readonly pause: PauseMenu;
  private readonly input: Input;

  private readonly ballView: BallView;
  private readonly golfer = new Golfer();
  private readonly aim: AimMarker;
  private cams: CameraDirector | null = null;

  private terrain: HoleTerrain | null = null;
  private meshes: HoleMeshes | null = null;
  private grid: PuttGrid | null = null;

  private phase: Phase = 'menu';
  private course: CourseSpec = getCourse(this.settings.courseId);
  private round: Round | null = null;
  private roundKind: StartOptions['kind'] = '18';
  private holeIdx = 0;
  private time = 0;
  private rng: Rng = makeRng(Date.now() & 0xffff);

  // Per-hole state.
  private ballPos = new THREE.Vector3();
  private lie: SurfaceType = 'tee';
  private strokes = 0;
  private putts = 0;
  private penalties = 0;
  private wind = new THREE.Vector3();

  // Per-shot setup.
  private clubIdx = DRIVER_INDEX;
  private shape: ShotShape = 'normal';
  private aimYaw = 0;
  private aimDist = 200;
  private puttRangeIdx = 2;
  private readonly aimPoint = new THREE.Vector3();
  private meter = new SwingMeter(DIFFICULTY.pro);
  private readonly mouseSwing = new MouseSwing();
  private shot: ActiveShot | null = null;
  private lastShot: { result: ShotResult; start: THREE.Vector3; club: Club } | null = null;
  private followThrough = -1;
  private settleTimer = 0;
  private afterSettle: (() => void) | null = null;
  private gridOn = true;
  private overviewOn = false;
  private paused = false;
  /** Wall-clock time of the last meter advance, so clicks are judged at the exact moment they happen. */
  private meterClock = 0;

  constructor(private readonly gs: GameScene) {
    this.ui = document.getElementById('ui')!;
    this.hud = new Hud(this.ui);
    this.meterView = new SwingMeterView(this.hud.meterSlot);
    this.scorecard = new Scorecard(this.ui);
    const onSettings = () => this.applySettings();
    this.menu = new MainMenu(this.ui, COURSES, this.settings, onSettings, (o) => this.startRound(o), () => this.showIdleBackdrop());
    this.pause = new PauseMenu(this.ui, this.settings, onSettings, {
      resume: () => this.setPaused(false),
      scorecard: () => this.showScorecard(),
      quit: () => this.quitToMenu(),
    });
    this.ballView = new BallView(gs.scene);
    this.aim = new AimMarker(gs.scene);
    gs.scene.add(this.golfer.root);
    this.buildButtons();
    this.input = new Input(gs.canvas, this);
    this.applySettings();
    this.showIdleBackdrop();
  }

  // ---------------------------------------------------------------------------------------------
  // Setup

  private buildButtons(): void {
    const h = this.hud;
    const holdable = (label: string, title: string, key: string) => {
      const b = h.addButton(label, title, () => {});
      b.addEventListener('pointerdown', () => this.input.held.add(key));
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => this.input.held.delete(key));
    };
    holdable('◀', 'Aim left (←)', 'ArrowLeft');
    holdable('▶', 'Aim right (→)', 'ArrowRight');
    h.addButton('Club −', 'Shorter club (↓)', () => this.changeClub(1));
    h.addButton('Club +', 'Longer club (↑)', () => this.changeClub(-1));
    h.addButton('Shape', 'Shot shape (F)', () => this.cycleShape());
    h.addButton('Cam', 'Ball camera (C)', () => this.cycleCamera());
    h.addButton('Map', 'Overview (M)', () => this.toggleOverview());
    h.addButton('Grid', 'Putting grid (G)', () => this.toggleGrid());
    h.addButton('Replay', 'Replay last shot (R)', () => this.replay());
    h.addButton('Card', 'Scorecard (Tab)', () => this.showScorecard());
    h.addButton('?', 'Help (H)', () => this.hud.toggleHelp());
    h.addButton('Menu', 'Menu (Esc)', () => this.setPaused(!this.paused), 'menu-btn');
    // Click or tap the hole map to aim there.
    h.minimap.root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const p = h.minimap.screenToWorld(e.clientX, e.clientY);
      if (p) this.aimAtWorld(p[0], p[1]);
    });
  }

  private applySettings(): void {
    saveSettings(this.settings);
    this.meter = new SwingMeter(DIFFICULTY[this.settings.difficulty]);
    this.sfx.setEnabled(this.settings.sound);
    if (this.cams) this.cams.flightStyle = this.settings.flightCam;
    if (this.phase === 'aiming') this.refreshHud();
  }

  /** A pretty hole behind the main menu. */
  private showIdleBackdrop(): void {
    this.course = getCourse(this.settings.courseId);
    this.loadTerrain(this.course.holes[this.course.style === 'parkland' ? 0 : 17]);
    this.cams!.startFlyover();
    this.ballView.ball.visible = false;
    this.golfer.visible = false;
    this.aim.visible = false;
  }

  private loadTerrain(spec: HoleSpec): void {
    if (this.meshes) {
      this.gs.scene.remove(this.meshes.group);
      this.meshes.dispose();
    }
    this.grid?.dispose();
    this.terrain = new HoleTerrain(spec, this.course.style);
    this.meshes = buildHoleMeshes(this.terrain);
    this.gs.scene.add(this.meshes.group);
    this.grid = new PuttGrid(this.gs.scene, this.terrain);
    if (!this.cams) this.cams = new CameraDirector(this.gs.camera, this.terrain);
    else this.cams.setTerrain(this.terrain);
    this.cams.flightStyle = this.settings.flightCam;
  }

  startRound(o: StartOptions): void {
    this.sfx.unlock();
    this.roundKind = o.kind;
    this.course = getCourse(this.settings.courseId);
    const all = this.course.holes;
    const holes =
      o.kind === 'front' ? all.slice(0, 9) : o.kind === 'back' ? all.slice(9) : o.kind === 'practice' ? [all[o.practiceHole - 1]] : all;
    this.round = new Round(this.settings.playerName, holes);
    this.menu.show(false);
    this.hud.show(true);
    this.loadHole(0);
  }

  private quitToMenu(): void {
    this.setPaused(false);
    this.scorecard.hide();
    this.round = null;
    this.phase = 'menu';
    this.hud.show(false);
    this.menu.show(true);
    this.showIdleBackdrop();
    this.publishState();
  }

  private loadHole(i: number): void {
    const round = this.round!;
    this.holeIdx = i;
    const spec = round.holes[i];
    this.loadTerrain(spec);
    const t = this.terrain!;
    this.rng = makeRng(hashSeed(`${Date.now()}-${spec.number}`));
    const [lo, hi] = WIND_MPH[this.settings.wind];
    const mph = lo + this.rng() * (hi - lo);
    const dir = this.rng() * Math.PI * 2;
    this.wind.set(Math.sin(dir), 0, -Math.cos(dir)).multiplyScalar(mph * MPS_PER_MPH);
    this.sfx.startAmbience(this.wind.length());

    this.strokes = 0;
    this.putts = 0;
    this.penalties = 0;
    this.lastShot = null;
    this.ballPos.copy(t.teePosition());
    this.ballView.clearTrail();
    this.ballView.ball.visible = true;
    this.overviewOn = false;

    const yards = Math.round(this.dist(t.length));
    this.hud.setHole(this.course.name, `Hole ${spec.number}, Par ${spec.par}`, `${spec.name} · ${yards} ${this.unit()}`);
    this.hud.minimap.setHole(t);
    this.updateScoreLine();
    this.hud.showToast(`Hole ${spec.number}`, `${spec.name} · Par ${spec.par} · ${yards} ${this.unit()}`, 2600, true);

    if (this.settings.flyovers) {
      this.phase = 'flyover';
      this.hud.root.classList.add('cinematic');
      this.golfer.visible = false;
      this.aim.visible = false;
      this.cams!.startFlyover();
    } else {
      this.prepareShot(true);
    }
    this.publishState();
  }

  // ---------------------------------------------------------------------------------------------
  // Shot setup

  private get club(): Club {
    return BAG[this.clubIdx];
  }

  private lieFactor(): number {
    return Math.max(0.3, SURFACES[this.lie].lie.power);
  }

  private clubCarry(c: Club = this.club): number {
    return fullCarry(c) * this.lieFactor() * (this.settings.powerBoost ? 1.06 : 1);
  }

  private distToPin(): number {
    const t = this.terrain!;
    return Math.hypot(t.cup.x - this.ballPos.x, t.cup.z - this.ballPos.z);
  }

  private autoClub(): number {
    const d = this.distToPin();
    if (this.lie === 'green' || (this.lie === 'fringe' && d < 20)) return PUTTER_INDEX;
    if (this.lie === 'sand' && d < 55) return BAG.findIndex((c) => c.id === 'sw');
    for (let i = PUTTER_INDEX - 1; i >= 0; i--) {
      if (i === DRIVER_INDEX && this.lie !== 'tee') continue;
      if (this.clubCarry(BAG[i]) >= d - 3) return i;
    }
    return this.lie === 'tee' ? DRIVER_INDEX : 1;
  }

  private prepareShot(first = false): void {
    const t = this.terrain!;
    this.phase = 'aiming';
    this.lie = first ? 'tee' : t.surfaceAt(this.ballPos.x, this.ballPos.z);
    this.shape = 'normal';
    this.clubIdx = this.autoClub();
    this.meter.reset();
    this.meterView.setResult(null);
    this.followThrough = -1;
    this.aimAuto();
    this.golfer.visible = true;
    this.aim.visible = true;
    this.placeGolfer();
    // Cut straight to the new lie, like a TV broadcast.
    this.cams!.address(this.ballPos, this.aimPoint, this.club.isPutter === true, true);
    this.grid!.visible = this.gridOn && this.club.isPutter === true;
    this.hud.root.classList.remove('cinematic');
    this.refreshHud();
    this.publishState();
  }

  private aimAuto(): void {
    const t = this.terrain!;
    if (this.club.isPutter) {
      const d = this.distToPin();
      this.aimYaw = Math.atan2(t.cup.x - this.ballPos.x, -(t.cup.z - this.ballPos.z));
      this.aimDist = d;
      this.puttRangeIdx = PUTT_RANGES.findIndex((r) => r >= d * 1.25);
      if (this.puttRangeIdx < 0) this.puttRangeIdx = PUTT_RANGES.length - 1;
    } else {
      const carry = this.clubCarry();
      const p = t.suggestedAim(this.ballPos, carry);
      this.aimYaw = Math.atan2(p.x - this.ballPos.x, -(p.z - this.ballPos.z));
      this.aimDist = Math.min(carry, Math.hypot(p.x - this.ballPos.x, p.z - this.ballPos.z) + 0.01);
      if (Math.hypot(p.x - t.cup.x, p.z - t.cup.z) > 1) this.aimDist = carry;
    }
    this.updateAimPoint();
  }

  private updateAimPoint(): void {
    const d = dirFromYaw(this.aimYaw);
    const x = this.ballPos.x + d.x * this.aimDist;
    const z = this.ballPos.z + d.z * this.aimDist;
    this.aimPoint.set(x, this.terrain!.heightAt(x, z), z);
  }

  private placeGolfer(): void {
    const t = this.terrain!;
    this.golfer.placeAt(this.ballPos, dirFromYaw(this.aimYaw), (x, z) => t.heightAt(x, z), this.club.isPutter === true);
  }

  changeClub(delta: number): void {
    if (this.phase !== 'aiming') return;
    let i = this.clubIdx + delta;
    i = Math.max(0, Math.min(PUTTER_INDEX, i));
    this.clubIdx = i;
    if (this.club.isPutter) {
      this.aimAuto();
    } else {
      this.aimDist = this.clubCarry();
      this.updateAimPoint();
    }
    this.placeGolfer();
    this.grid!.visible = this.gridOn && this.club.isPutter === true;
    if (!this.overviewOn) this.cams!.address(this.ballPos, this.aimPoint, this.club.isPutter === true);
    this.refreshHud();
  }

  changePuttRange(delta: number): void {
    if (this.phase !== 'aiming' || !this.club.isPutter) return;
    this.puttRangeIdx = Math.max(0, Math.min(PUTT_RANGES.length - 1, this.puttRangeIdx + delta));
    this.refreshHud();
  }

  cycleShape(): void {
    if (this.phase !== 'aiming' || this.club.isPutter) return;
    this.shape = SHOT_SHAPES[(SHOT_SHAPES.indexOf(this.shape) + 1) % SHOT_SHAPES.length];
    this.refreshHud();
  }

  cycleCamera(): void {
    const order = ['auto', 'chase', 'stay'] as const;
    this.settings.flightCam = order[(order.indexOf(this.settings.flightCam) + 1) % order.length];
    this.applySettings();
    const names = { auto: 'TV camera', chase: 'Chase camera', stay: 'Tee camera' };
    this.hud.showToast(names[this.settings.flightCam], '', 1200);
  }

  toggleOverview(): void {
    if (this.phase !== 'aiming') return;
    this.overviewOn = !this.overviewOn;
    if (this.overviewOn) this.cams!.overview(this.ballPos, this.terrain!.cupPosition());
    else this.cams!.address(this.ballPos, this.aimPoint, this.club.isPutter === true);
  }

  toggleGrid(): void {
    this.gridOn = !this.gridOn;
    this.grid!.visible = this.gridOn && (this.club.isPutter === true || this.phase !== 'aiming');
  }

  rotateAim(delta: number): void {
    if (this.phase !== 'aiming') return;
    this.aimYaw = wrapAngle(this.aimYaw + delta);
    this.updateAimPoint();
    this.placeGolfer();
    if (!this.overviewOn) this.cams!.address(this.ballPos, this.aimPoint, this.club.isPutter === true);
    this.refreshHud();
  }

  /** Right-click / tap-and-hold: aim at a point on the ground. */
  aimAtScreen(ndcX: number, ndcY: number): void {
    if (this.phase !== 'aiming' || !this.terrain) return;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.gs.camera);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    const t = this.terrain;
    let prev = 0;
    for (let s = 1; s < 2500; s += 1.5) {
      const x = o.x + d.x * s;
      const z = o.z + d.z * s;
      if (o.y + d.y * s < t.heightAt(x, z)) {
        // Refine.
        let lo = prev;
        let hi = s;
        for (let k = 0; k < 12; k++) {
          const m = (lo + hi) / 2;
          if (o.y + d.y * m < t.heightAt(o.x + d.x * m, o.z + d.z * m)) hi = m;
          else lo = m;
        }
        this.aimAtWorld(o.x + d.x * hi, o.z + d.z * hi);
        return;
      }
      prev = s;
    }
  }

  /** Turn to face a point on the ground (keeps the club's distance unless putting). */
  aimAtWorld(hx: number, hz: number): void {
    if (this.phase !== 'aiming') return;
    const dx = hx - this.ballPos.x;
    const dz = hz - this.ballPos.z;
    if (Math.hypot(dx, dz) < 0.5) return;
    this.aimYaw = Math.atan2(dx, -dz);
    if (this.club.isPutter) this.aimDist = Math.hypot(dx, dz);
    this.updateAimPoint();
    this.placeGolfer();
    if (!this.overviewOn) this.cams!.address(this.ballPos, this.aimPoint, this.club.isPutter === true);
    this.refreshHud();
  }

  // ---------------------------------------------------------------------------------------------
  // Swinging

  /** Space / click. */
  primary(): void {
    this.sfx.unlock();
    if (this.paused || this.scorecard.visible) {
      if (this.scorecard.visible) this.scorecard.continue();
      return;
    }
    switch (this.phase) {
      case 'flyover':
        this.prepareShot(true);
        return;
      case 'aiming':
        if (this.overviewOn) this.toggleOverview();
        this.phase = 'swinging';
        this.meterView.setResult(null);
        this.meter.reset();
        this.meter.tempo = this.club.tempo;
        this.meter.click();
        this.meterClock = performance.now();
        this.publishState();
        return;
      case 'swinging': {
        const auto = this.advanceMeter();
        if (auto) return this.hit(auto);
        const r = this.meter.click();
        if (r) this.hit(r);
        return;
      }
      case 'settling':
        // Skip the wait.
        this.settleTimer = 0;
        return;
      case 'flight':
      case 'replay':
        // Fast-forward.
        if (this.shot) this.shot.t = Math.max(this.shot.t, this.shot.result.duration - 0.05);
        return;
      default:
        return;
    }
  }

  /** Bring the meter up to the current instant. Returns a result if it auto-completed. */
  private advanceMeter(): SwingResult | null {
    const now = performance.now();
    const dt = Math.min(0.5, (now - this.meterClock) / 1000);
    this.meterClock = now;
    return this.meter.update(dt);
  }

  cancelSwing(): boolean {
    if (this.phase === 'swinging' && this.meter.state === 'backswing') {
      this.meter.reset();
      this.phase = 'aiming';
      this.golfer.setSwing(0);
      this.publishState();
      return true;
    }
    return false;
  }

  mouseSwingStart(x: number, y: number): boolean {
    if (this.settings.swingType !== 'mouse' || this.phase !== 'aiming' || this.paused) return false;
    this.sfx.unlock();
    if (this.overviewOn) this.toggleOverview();
    this.mouseSwing.begin(x, y);
    return true;
  }

  mouseSwingMove(x: number, y: number): void {
    if (!this.mouseSwing.active) return;
    const r = this.mouseSwing.move(x, y);
    if (r) this.hit(r);
  }

  mouseSwingEnd(): void {
    if (this.mouseSwing.active) {
      this.mouseSwing.cancel();
      this.golfer.setSwing(0);
    }
  }

  private hit(swing: SwingResult): void {
    const t = this.terrain!;
    const club = this.club;
    const putt = club.isPutter === true;
    const built = buildShot({
      club,
      swing,
      aimYaw: this.aimYaw,
      shape: this.shape,
      lie: this.lie,
      ballPos: this.ballPos,
      puttRange: PUTT_RANGES[this.puttRangeIdx],
      powerBoost: this.settings.powerBoost && !putt,
      accuracySensitivity: ACCURACY_SENSITIVITY[this.settings.difficulty],
      rng: this.rng,
    });
    // A touch of gust variation each shot.
    const gust = this.wind.clone().multiplyScalar(0.9 + this.rng() * 0.2);
    const result = simulateShot(built.launch, t, putt ? new THREE.Vector3() : gust, this.rng);
    this.strokes++;
    if (putt) this.putts++;

    this.meterView.setResult(swing);
    this.meterView.setLabel(this.describeSwing(swing, built.flyer));
    this.sfx.swing(Math.min(1, swing.power));
    this.sfx.impact(putt ? 'putter' : this.lie === 'sand' ? 'sand' : club.isWood ? 'wood' : 'iron', swing.power);

    this.shot = { result, t: 0, start: this.ballPos.clone(), nextEvent: 0, club, putt, replay: false };
    this.lastShot = { result, start: this.ballPos.clone(), club };
    this.phase = 'flight';
    this.followThrough = 0;
    this.aim.visible = false;
    this.ballView.clearTrail();
    this.ballView.trailVisible = !putt;
    this.grid!.visible = this.gridOn && putt;
    this.cams!.beginFlight(this.ballPos, result.carryPos, result.finalPos, dirFromYaw(this.aimYaw), putt);
    this.refreshHud();
    this.publishState();
  }

  private describeSwing(s: SwingResult, flyer: boolean): string {
    const pow = `Power ${Math.round(s.power * 100)}%`;
    const a = s.accuracy;
    const n = Math.round(Math.abs(a) * 200);
    const acc = n === 0 ? 'Perfect' : a < 0 ? `Hook ${n}` : `Slice ${n}`;
    return `${pow} · ${acc}${flyer ? ' · Flyer!' : ''}`;
  }

  replay(): void {
    if (this.phase !== 'aiming' || !this.lastShot) return;
    const ls = this.lastShot;
    this.replayReturn.copy(this.ballPos);
    this.shot = { result: ls.result, t: 0, start: ls.start.clone(), nextEvent: 0, club: ls.club, putt: ls.club.isPutter === true, replay: true };
    this.phase = 'replay';
    this.aim.visible = false;
    this.golfer.visible = false;
    this.ballView.clearTrail();
    const d = new THREE.Vector3().subVectors(ls.result.finalPos, ls.start).setY(0).normalize();
    this.cams!.address(ls.start, ls.start.clone().add(d.clone().multiplyScalar(50)), this.shot.putt, true);
    this.cams!.beginFlight(ls.start, ls.result.carryPos, ls.result.finalPos, d, this.shot.putt);
    this.hud.showToast('Replay', '', 1200);
  }

  // ---------------------------------------------------------------------------------------------
  // Shot playback and outcome

  private sampleShot(s: ActiveShot, out: THREE.Vector3, vel: THREE.Vector3): void {
    const frames = s.result.frames;
    const f = s.t / FRAME_DT;
    const i = Math.min(frames.length - 1, Math.floor(f));
    const j = Math.min(frames.length - 1, i + 1);
    out.lerpVectors(frames[i], frames[j], f - i);
    vel.subVectors(frames[j], frames[i]).divideScalar(FRAME_DT);
  }

  private updateShot(dt: number): void {
    const s = this.shot!;
    s.t = Math.min(s.result.duration, s.t + dt);
    const pos = new THREE.Vector3();
    const vel = new THREE.Vector3();
    this.sampleShot(s, pos, vel);
    this.ballPos.copy(pos);
    if (!s.putt) this.ballView.pushTrail(pos);
    if (!s.replay) this.hud.minimap.addTrail(pos.x, pos.z);
    this.cams!.updateFlight(pos, vel, dt);

    // Fire sounds for events we've passed.
    const ev = s.result.events;
    while (s.nextEvent < ev.length && ev[s.nextEvent].t <= s.t + 1e-6) {
      const e = ev[s.nextEvent++];
      if (e.type === 'land' || e.type === 'bounce') this.sfx.land(e.surface ?? 'fairway', vel.length());
      else if (e.type === 'tree') this.sfx.tree();
      else if (e.type === 'splash') this.sfx.land('water', 10);
      else if (e.type === 'lipout') this.sfx.groan();
      else if (e.type === 'holed') this.sfx.cup();
    }

    if (s.t >= s.result.duration) {
      if (s.replay) {
        this.shot = null;
        this.ballPos.copy(this.replayReturn);
        this.ballView.clearTrail();
        this.prepareShotKeepingSetup();
      } else {
        this.finishShot();
      }
    }
  }

  private readonly replayReturn = new THREE.Vector3();

  private prepareShotKeepingSetup(): void {
    this.phase = 'aiming';
    this.golfer.visible = true;
    this.aim.visible = true;
    this.updateAimPoint();
    this.placeGolfer();
    this.cams!.address(this.ballPos, this.aimPoint, this.club.isPutter === true);
    this.publishState();
  }

  private finishShot(): void {
    const s = this.shot!;
    const t = this.terrain!;
    const r = s.result;
    const res = resolveShot(r, s.start, t);
    this.strokes += res.penalty;
    this.penalties += res.penalty;
    let holed = res.holed;
    let headline = '';
    let detail = '';
    const surf = SURFACES[r.finalSurface].label;

    if (holed) {
      headline = scoreName(this.strokes, this.round!.holes[this.holeIdx].par);
    } else if (res.penalty) {
      headline = r.outcome === 'water' ? 'Splash!' : 'Out of Bounds';
      detail = res.message;
      this.sfx.groan();
    } else {
      const left = Math.hypot(t.cup.x - res.nextPos.x, t.cup.z - res.nextPos.z);
      if (s.putt) {
        headline = left < 3 ? `${toFeet(left).toFixed(0)} ft left` : `${this.fmtDist(left)} left`;
      } else {
        const carry = r.carryPos ? Math.hypot(r.carryPos.x - s.start.x, r.carryPos.z - s.start.z) : 0;
        const total = Math.hypot(r.finalPos.x - s.start.x, r.finalPos.z - s.start.z);
        headline = surf;
        detail = `${this.fmtDist(carry)} carry · ${this.fmtDist(total)} total · ${this.fmtDist(left)} to pin`;
        if (r.events.some((e) => e.type === 'tree')) detail = `Hit a tree! · ${detail}`;
      }
      // Concede short putts.
      if (this.settings.gimmes && (r.finalSurface === 'green' || r.finalSurface === 'fringe') && left < GIMME_DISTANCE) {
        this.strokes++;
        this.putts++;
        holed = true;
        headline = `Gimme — ${scoreName(this.strokes, this.round!.holes[this.holeIdx].par)}`;
      }
    }
    if (!holed && this.strokes >= MAX_STROKES) {
      holed = true;
      headline = 'Picked up';
      detail = `Maximum ${MAX_STROKES} strokes`;
    }

    this.shot = null;
    this.phase = 'settling';
    this.hud.showToast(headline, detail, holed ? 3000 : 2200, holed);

    if (holed) {
      this.recordHole();
      this.cams!.holed(t.cupPosition(), s.start);
      const d = this.strokes - this.round!.holes[this.holeIdx].par;
      this.sfx.applause(this.strokes === 1 ? 1 : d <= -2 ? 0.95 : d === -1 ? 0.7 : d === 0 ? 0.35 : 0.12);
      this.settleTimer = 2.8;
      this.afterSettle = () => this.holeComplete();
    } else {
      if (r.outcome === 'rest' && r.finalSurface !== 'water') {
        // Small cheer for a close approach.
        const left = Math.hypot(t.cup.x - res.nextPos.x, t.cup.z - res.nextPos.z);
        if (!s.putt && left < 4) this.sfx.applause(0.4);
      }
      this.settleTimer = 1.8;
      this.afterSettle = () => {
        this.ballPos.copy(res.nextPos);
        this.ballView.clearTrail();
        if (res.penalty) this.hud.minimap.clearTrail();
        this.prepareShot();
      };
    }
    this.publishState();
  }

  private recordHole(): void {
    this.round!.record(this.holeIdx, {
      strokes: this.strokes,
      putts: this.putts,
      penalties: this.penalties,
      pickedUp: this.strokes >= MAX_STROKES,
    });
    this.updateScoreLine();
  }

  private holeComplete(): void {
    const round = this.round!;
    this.phase = 'holeOver';
    const last = this.holeIdx >= round.holes.length - 1;
    if (last) {
      this.roundOver();
      return;
    }
    this.showScorecard({ button: `Next: Hole ${round.holes[this.holeIdx + 1].number}`, onContinue: () => this.loadHole(this.holeIdx + 1) });
    this.publishState();
  }

  private roundOver(): void {
    const round = this.round!;
    this.phase = 'roundOver';
    const kind = this.roundKind === 'practice' ? '' : `${this.course.id}:${this.roundKind}`;
    const best = kind ? saveBest(kind, round.totalStrokes) : false;
    this.showScorecard({
      title: `Round complete — ${round.playerName}`,
      footer: `Final score ${round.totalStrokes} (${formatToPar(round.toPar)})${best ? ' · New personal best!' : ''}`,
      button: 'Main Menu',
      onContinue: () => this.quitToMenu(),
    });
    this.publishState();
  }

  showScorecard(opts: { title?: string; footer?: string; button?: string; onContinue?: () => void } = {}): void {
    if (!this.round) return;
    if (this.scorecard.visible && !opts.onContinue) {
      this.scorecard.hide();
      return;
    }
    this.pause.show(false);
    this.scorecard.show(this.round, this.course.name, (h) => Math.round(toYards(new HoleTerrainLength(h).length)), opts);
  }

  setPaused(p: boolean): void {
    if (!this.round) return;
    this.paused = p;
    this.pause.show(p);
  }

  /** Escape key: back out of whatever is open. */
  escape(): void {
    if (this.scorecard.visible && this.phase !== 'holeOver' && this.phase !== 'roundOver') return this.scorecard.hide();
    if (this.cancelSwing()) return;
    if (this.overviewOn) return this.toggleOverview();
    if (this.phase === 'flyover') return this.prepareShot(true);
    this.setPaused(!this.paused);
  }

  toggleHelp(): void {
    this.hud.toggleHelp();
  }

  // ---------------------------------------------------------------------------------------------
  // HUD

  private unit(): string {
    return this.settings.units === 'yards' ? 'yds' : 'm';
  }

  private dist(m: number): number {
    return this.settings.units === 'yards' ? toYards(m) : m;
  }

  private fmtDist(m: number): string {
    if (m < 20 && this.terrain && this.lie === 'green') return `${toFeet(m).toFixed(0)} ft`;
    return `${Math.round(this.dist(m))} ${this.unit()}`;
  }

  private updateScoreLine(): void {
    const r = this.round;
    if (!r) return;
    const thru = r.played;
    this.hud.setPlayer(r.playerName, `${thru ? formatToPar(r.toPar) : 'E'}  thru ${thru}`);
  }

  private refreshHud(): void {
    const t = this.terrain;
    if (!t || !this.round) return;
    const c = this.club;
    const toPin = this.distToPin();
    if (c.isPutter) {
      const range = PUTT_RANGES[this.puttRangeIdx];
      const need = Math.round((toPin / range) * 100);
      this.hud.setClub(`Putter ${toFeet(range).toFixed(0)}ft`, `Flat-green power ${need}%`, 'Z / X: range');
    } else {
      const lie = SURFACES[this.lie].lie.power;
      const carry = this.clubCarry();
      this.hud.setClub(
        `${c.name} ${Math.round(this.dist(carry))}${this.settings.units === 'yards' ? 'y' : 'm'}`,
        lie < 1 ? `Lie ${Math.round(lie * 100)}%` : '',
        this.shape === 'normal' && !this.settings.powerBoost ? '' : `${SHAPE_LABEL[this.shape]}${this.settings.powerBoost ? ' · Power' : ''}`,
      );
    }
    const pinTxt = toPin < 20 && (this.lie === 'green' || this.lie === 'fringe') ? `${toFeet(toPin).toFixed(0)} ft` : `${Math.round(this.dist(toPin))} ${this.unit()}`;
    const elev = t.heightAt(t.cup.x, t.cup.z) - (this.ballPos.y - 0.021);
    const elevTxt = Math.abs(elev) < 0.3 ? 'Level' : `${elev > 0 ? '▲' : '▼'} ${Math.abs(elev / M_PER_FT).toFixed(0)} ft`;
    const n = this.phase === 'aiming' ? this.strokes + 1 : this.strokes;
    const ord = n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
    this.hud.setShot(`${ord} Shot · ${pinTxt}`, `${SURFACES[this.lie].label} · ${elevTxt === 'Level' ? 'Level' : elevTxt}`);
  }

  private updateWindHud(): void {
    const cam = this.gs.camera;
    const f = new THREE.Vector3();
    cam.getWorldDirection(f);
    const camYaw = Math.atan2(f.x, -f.z);
    const w = this.wind;
    const mph = w.length() / MPS_PER_MPH;
    const windYaw = Math.atan2(w.x, -w.z);
    const val = this.settings.units === 'yards' ? `${mph.toFixed(0)} mph` : `${(w.length()).toFixed(1)} m/s`;
    this.hud.setWind(windYaw - camYaw, mph < 0.5 ? '' : val, mph / 20);
  }

  /** Automation hook (only installed with ?test in the URL): hit a shot with an exact power/accuracy. */
  testSwing(power: number, accuracy = 0): void {
    if (this.phase === 'flyover') this.prepareShot(true);
    if (this.phase !== 'aiming') return;
    this.hit({ power, accuracy });
  }

  /** Automation hook: jump to the end of the current shot and any settle delay. */
  testFastForward(): void {
    if (this.shot) this.shot.t = this.shot.result.duration;
    if (this.phase === 'settling') this.settleTimer = 0;
  }

  /** Expose state for automated tests. */
  private publishState(): void {
    const b = document.body.dataset;
    b.phase = this.phase;
    b.strokes = String(this.strokes);
    b.hole = this.round ? String(this.round.holes[this.holeIdx].number) : '';
    b.toPin = this.terrain ? this.distToPin().toFixed(2) : '';
    b.lie = this.lie;
    b.club = this.club.id;
    b.played = this.round ? String(this.round.played) : '0';
    b.carry = this.terrain ? (this.club.isPutter ? PUTT_RANGES[this.puttRangeIdx] : this.clubCarry()).toFixed(2) : '';
    b.totalStrokes = this.round ? String(this.round.totalStrokes) : '0';
  }

  // ---------------------------------------------------------------------------------------------
  // Frame update

  update(dt: number): void {
    this.time += dt;
    const cams = this.cams!;

    // Held keys: continuous aiming.
    const held = this.input.held;
    if (this.phase === 'aiming' && !this.paused) {
      const rate = (held.has('Shift') ? 0.08 : 0.45) * (this.club.isPutter ? 0.35 : 1);
      if (held.has('ArrowLeft') || held.has('a')) this.rotateAim(-rate * dt);
      if (held.has('ArrowRight') || held.has('d')) this.rotateAim(rate * dt);
    }

    switch (this.phase) {
      case 'menu':
        if (cams.updateFlyover(dt, 22)) cams.startFlyover();
        break;
      case 'flyover':
        if (cams.updateFlyover(dt)) this.prepareShot(true);
        break;
      case 'swinging': {
        if (!this.paused) {
          const r = this.advanceMeter();
          this.golfer.setSwing(this.meter.clubAngle);
          if (r) this.hit(r);
        }
        break;
      }
      case 'flight':
      case 'replay':
        this.updateShot(dt);
        break;
      case 'settling':
        this.settleTimer -= dt;
        if (this.settleTimer <= 0 && this.afterSettle) {
          const f = this.afterSettle;
          this.afterSettle = null;
          f();
        }
        break;
      default:
        break;
    }

    if (this.mouseSwing.active) {
      this.golfer.setSwing(this.mouseSwing.phase === 'back' ? this.mouseSwing.depth : this.mouseSwing.depth * 0.5);
    }
    if (this.followThrough >= 0 && this.followThrough < 1) {
      this.followThrough = Math.min(1, this.followThrough + dt / 0.35);
      const e = 1 - Math.pow(1 - this.followThrough, 2);
      this.golfer.setSwing(-e);
    }

    if (this.phase !== 'menu' && this.phase !== 'flyover') cams.update(dt);
    else cams.update(0);

    const t = this.terrain;
    if (t) {
      const gy = t.heightAt(this.ballPos.x, this.ballPos.z);
      this.ballView.update(this.ballPos, gy, this.gs.camera);
      if (this.aim.group.visible) {
        this.aim.update(this.aimPoint, this.ballPos, this.gs.camera, this.time, (x, z) => t.heightAt(x, z), this.club.isPutter === true);
      }
      if (this.meshes) animateFlag(this.meshes.flag, this.time, this.wind.x, this.wind.z);
      this.grid?.update(dt);
      this.gs.focusShadows(this.phase === 'flight' ? this.ballPos : cams.lookTarget.clone().lerp(this.gs.camera.position, 0.5));
    }

    if (this.round && t) {
      const aiming = this.phase === 'aiming' || this.phase === 'swinging';
      this.hud.minimap.draw(this.ballPos, aiming ? this.aimPoint : null);
      // Club tag floats to the right of the golfer, as in the classic games.
      const cam = this.gs.camera;
      const d = dirFromYaw(this.aimYaw);
      const p = this.ballPos.clone().add(new THREE.Vector3(-d.z * 1.3, 1.5, d.x * 1.3)).project(cam);
      const onScreen = p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1;
      const w = this.gs.canvas.clientWidth;
      const h = this.gs.canvas.clientHeight;
      this.hud.placeClubTag(((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h, aiming && onScreen && !this.overviewOn);
      this.updateWindHud();
      this.meterView.draw(this.meter, {
        mouse: this.settings.swingType === 'mouse' && this.phase !== 'swinging',
        mouseDepth: this.mouseSwing.active ? this.mouseSwing.depth : 0,
        snapZone: (0.022 / ACCURACY_SENSITIVITY[this.settings.difficulty]) * (this.settings.powerBoost ? 0.55 : 1),
        boost: this.settings.powerBoost,
      });
    }
  }
}

/** Lightweight length calculation for scorecard yardages without building terrain. */
class HoleTerrainLength {
  readonly length: number;
  constructor(h: HoleSpec) {
    let L = 0;
    for (let i = 1; i < h.centerline.length; i++) {
      const a = h.centerline[i - 1];
      const b = h.centerline[i];
      L += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    this.length = L;
  }
}
