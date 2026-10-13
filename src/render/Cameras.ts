import * as THREE from 'three';
import type { HoleTerrain } from '../course/terrain';

export type CameraMode = 'address' | 'flight' | 'overview' | 'flyover' | 'green' | 'holed';
/** How the camera behaves while the ball is in the air. */
export type FlightCamStyle = 'auto' | 'chase' | 'stay';

/**
 * Drives the camera. Every mode produces a desired position and look target; the actual camera eases
 * toward them so cuts feel smooth (except deliberate hard cuts like the landing cam).
 */
export class CameraDirector {
  mode: CameraMode = 'address';
  flightStyle: FlightCamStyle = 'auto';
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly wantPos = new THREE.Vector3();
  private readonly wantLook = new THREE.Vector3();
  private flightT = 0;
  private landingCam: { pos: THREE.Vector3; at: THREE.Vector3 } | null = null;
  private flyoverT = 0;
  private flyoverPath: THREE.CatmullRomCurve3 | null = null;
  private flyoverLook: THREE.CatmullRomCurve3 | null = null;
  overviewZoom = 1;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private terrain: HoleTerrain,
  ) {}

  setTerrain(t: HoleTerrain): void {
    this.terrain = t;
  }

  private ground(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  /** Behind the ball, looking down the aim line. */
  address(ball: THREE.Vector3, aim: THREE.Vector3, putting: boolean, snap = false): void {
    this.mode = putting ? 'green' : 'address';
    const d = new THREE.Vector3(aim.x - ball.x, 0, aim.z - ball.z);
    const dist = d.length();
    d.normalize();
    if (putting) {
      const back = THREE.MathUtils.clamp(5.5 + dist * 0.3, 6, 12);
      this.wantPos.copy(ball).addScaledVector(d, -back);
      this.wantPos.x += -d.z * 0.8;
      this.wantPos.z += d.x * 0.8;
      this.wantPos.y = Math.max(this.ground(this.wantPos.x, this.wantPos.z), ball.y) + 2.3 + dist * 0.08;
      this.wantLook.copy(ball).addScaledVector(d, Math.min(dist, 12) * 0.55);
      this.wantLook.y = this.ground(this.wantLook.x, this.wantLook.z);
    } else {
      // Behind the ball and a touch right, so the golfer (who stands left of the ball) frames the shot.
      // Classic broadcast framing: well behind and above, golfer small in the lower middle, hole laid out ahead.
      this.wantPos.copy(ball).addScaledVector(d, -9.5);
      this.wantPos.x += -d.z * 1.1;
      this.wantPos.z += d.x * 1.1;
      this.wantPos.y = Math.max(this.ground(this.wantPos.x, this.wantPos.z), ball.y) + 3.4;
      const ahead = Math.min(Math.max(dist, 40), 170);
      this.wantLook.copy(ball).addScaledVector(d, ahead);
      this.wantLook.y = Math.min(this.ground(this.wantLook.x, this.wantLook.z), ball.y + ahead * 0.08) - 2;
      // Don't stare into the ground on downhill or up into the sky on uphill shots.
      const minLook = ball.y - ahead * 0.12;
      if (this.wantLook.y < minLook) this.wantLook.y = minLook;
    }
    if (snap) this.snap();
  }

  beginFlight(ball: THREE.Vector3, landing: THREE.Vector3 | null, finalPos: THREE.Vector3, aimDir: THREE.Vector3, putting: boolean): void {
    this.mode = 'flight';
    this.flightT = 0;
    this.landingCam = null;
    const target = landing ?? finalPos;
    const carry = Math.hypot(target.x - ball.x, target.z - ball.z);
    if (!putting && carry > 70) {
      // Off to the side and beyond the landing spot, looking back up the line of flight.
      const d = new THREE.Vector3(aimDir.x, 0, aimDir.z).normalize();
      const side = new THREE.Vector3(-d.z, 0, d.x);
      const p = target.clone().addScaledVector(d, 28).addScaledVector(side, 16);
      p.y = Math.max(this.ground(p.x, p.z), target.y) + 7;
      this.landingCam = { pos: p, at: target.clone() };
    }
  }

  /** Called each frame of ball playback. */
  updateFlight(ball: THREE.Vector3, vel: THREE.Vector3, dt: number): void {
    this.flightT += dt;
    const style = this.flightStyle;
    if (style === 'chase') {
      const d = vel.clone().setY(0);
      if (d.lengthSq() < 0.01) d.subVectors(ball, this.pos).setY(0);
      d.normalize();
      this.wantPos.copy(ball).addScaledVector(d, -9);
      this.wantPos.y = Math.max(ball.y + 2.5, this.ground(this.wantPos.x, this.wantPos.z) + 1.5);
      this.wantLook.copy(ball);
      return;
    }
    if (style === 'auto' && this.landingCam && this.flightT > 1.1) {
      this.wantPos.copy(this.landingCam.pos);
      this.wantLook.copy(ball);
      if (this.flightT - dt <= 1.1) this.pos.copy(this.landingCam.pos); // hard cut, TV style
      return;
    }
    // Stay put and track the ball.
    this.wantLook.copy(ball);
  }

  overview(ball: THREE.Vector3, cup: THREE.Vector3): void {
    this.mode = 'overview';
    const mid = ball.clone().lerp(cup, 0.55);
    const span = ball.distanceTo(cup);
    const d = new THREE.Vector3(cup.x - ball.x, 0, cup.z - ball.z).normalize();
    const h = (60 + span * 0.65) * this.overviewZoom;
    this.wantPos.copy(mid).addScaledVector(d, -span * 0.35 * this.overviewZoom);
    this.wantPos.y = mid.y + h;
    this.wantLook.copy(mid);
  }

  startFlyover(): void {
    const t = this.terrain;
    const pts: THREE.Vector3[] = [];
    const looks: THREE.Vector3[] = [];
    const L = t.length;
    for (let i = 0; i <= 6; i++) {
      const s = (L * i) / 6;
      const p = t.centerline.pointAt(s - 30);
      const ahead = t.centerline.pointAt(s + 60);
      const hy = t.heightAt(p.x, p.z);
      pts.push(new THREE.Vector3(p.x, hy + 38 - i * 3, p.z));
      looks.push(new THREE.Vector3(ahead.x, t.heightAt(ahead.x, ahead.z), ahead.z));
    }
    const cup = t.cupPosition();
    const last = pts[pts.length - 1];
    pts.push(new THREE.Vector3((last.x + cup.x) / 2, cup.y + 14, (last.z + cup.z) / 2 + 0));
    looks.push(cup.clone());
    this.flyoverPath = new THREE.CatmullRomCurve3(pts);
    this.flyoverLook = new THREE.CatmullRomCurve3(looks);
    this.flyoverT = 0;
    this.mode = 'flyover';
    this.pos.copy(pts[0]);
    this.look.copy(looks[0]);
  }

  /** Returns true when the flyover has finished. */
  updateFlyover(dt: number, duration = 6): boolean {
    if (!this.flyoverPath || !this.flyoverLook) return true;
    this.flyoverT = Math.min(1, this.flyoverT + dt / duration);
    const e = this.flyoverT < 0.5 ? 2 * this.flyoverT * this.flyoverT : 1 - Math.pow(-2 * this.flyoverT + 2, 2) / 2;
    this.flyoverPath.getPoint(e, this.wantPos);
    this.flyoverLook.getPoint(e, this.wantLook);
    this.pos.copy(this.wantPos);
    this.look.lerp(this.wantLook, 0.2);
    return this.flyoverT >= 1;
  }

  holed(cup: THREE.Vector3, from: THREE.Vector3): void {
    this.mode = 'holed';
    const d = new THREE.Vector3(cup.x - from.x, 0, cup.z - from.z);
    if (d.lengthSq() < 0.01) d.set(0, 0, -1);
    d.normalize();
    this.wantPos.copy(cup).addScaledVector(d, -2.2);
    this.wantPos.y = cup.y + 0.8;
    this.wantLook.copy(cup);
  }

  snap(): void {
    this.pos.copy(this.wantPos);
    this.look.copy(this.wantLook);
  }

  update(dt: number): void {
    if (this.mode !== 'flyover') {
      const k = this.mode === 'flight' ? 6 : 3.5;
      const a = 1 - Math.exp(-k * dt);
      this.pos.lerp(this.wantPos, a);
      this.look.lerp(this.wantLook, this.mode === 'flight' ? 1 - Math.exp(-14 * dt) : a);
    }
    // Never go underground.
    const gy = this.ground(this.pos.x, this.pos.z) + 0.4;
    if (this.pos.y < gy) this.pos.y = gy;
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  get lookTarget(): THREE.Vector3 {
    return this.look;
  }
}
