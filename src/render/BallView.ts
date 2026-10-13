import * as THREE from 'three';
import { BALL_RADIUS } from '../physics/constants';

const TRAIL_MAX = 900;

let dimples: THREE.CanvasTexture | null = null;

/** Normal map of a dimpled golf ball, drawn once. */
function dimpleNormalMap(): THREE.CanvasTexture {
  if (dimples) return dimples;
  const W = 256;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(128,128,255)';
  g.fillRect(0, 0, W, H);
  // Rows of dimples; each is a small bowl shaded as a normal-map gradient.
  for (let row = 0; row < 14; row++) {
    const y = ((row + 0.5) / 14) * H;
    const lat = Math.abs(row - 6.5) / 7;
    const count = Math.max(6, Math.round(28 * Math.cos(lat * 1.35)));
    for (let i = 0; i < count; i++) {
      const x = ((i + (row % 2) * 0.5) / count) * W;
      const r = (W / count) * 0.42;
      const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      grd.addColorStop(0, 'rgb(150,150,240)');
      grd.addColorStop(0.7, 'rgb(110,110,245)');
      grd.addColorStop(1, 'rgb(128,128,255)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  dimples = new THREE.CanvasTexture(c);
  dimples.wrapS = THREE.RepeatWrapping;
  return dimples;
}

/** The ball, its contact shadow and a broadcast-style tracer ribbon. */
export class BallView {
  readonly ball: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  readonly trail: THREE.Mesh;
  private readonly points: THREE.Vector3[] = [];
  private readonly ribbonPos = new Float32Array(TRAIL_MAX * 2 * 3);
  private readonly ribbonCol = new Float32Array(TRAIL_MAX * 2 * 4);

  constructor(scene: THREE.Scene) {
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 24, 16),
      new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.15, normalMap: dimpleNormalMap(), normalScale: new THREE.Vector2(0.6, 0.6), emissive: '#2a2a2a' }),
    );
    this.ball.castShadow = true;
    scene.add(this.ball);

    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.65)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(BALL_RADIUS * 3.2, BALL_RADIUS * 3.2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
    );
    scene.add(this.shadow);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.ribbonPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.ribbonCol, 4));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_MAX - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    this.trail = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }),
    );
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 5;
    scene.add(this.trail);
  }

  /** Place the ball; scale it up with camera distance so it never vanishes. Rebuild the tracer facing the camera. */
  update(pos: THREE.Vector3, groundY: number, camera: THREE.Camera): void {
    this.ball.position.copy(pos);
    const dist = camera.position.distanceTo(pos);
    const s = Math.max(1, (dist * 0.0028) / BALL_RADIUS);
    this.ball.scale.setScalar(s);
    const above = Math.max(0, pos.y - BALL_RADIUS - groundY);
    this.shadow.position.set(pos.x, groundY + 0.012, pos.z);
    this.shadow.scale.setScalar(s * (1 + above * 0.06));
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.1, 1 - above * 0.03);
    this.rebuildRibbon(camera);
  }

  private rebuildRibbon(camera: THREE.Camera): void {
    const n = this.points.length;
    const geo = this.trail.geometry;
    if (n < 2 || !this.trail.visible) {
      geo.setDrawRange(0, 0);
      return;
    }
    const tangent = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    const side = new THREE.Vector3();
    let maxY = -Infinity;
    let minY = Infinity;
    for (const p of this.points) (maxY = Math.max(maxY, p.y)), (minY = Math.min(minY, p.y));
    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      tangent.subVectors(this.points[Math.min(n - 1, i + 1)], this.points[Math.max(0, i - 1)]).normalize();
      toCam.subVectors(camera.position, p).normalize();
      side.crossVectors(tangent, toCam).normalize();
      // A constant on-screen width: thicker the further away it is.
      const w = Math.max(0.03, camera.position.distanceTo(p) * 0.0022);
      this.ribbonPos.set([p.x - side.x * w, p.y - side.y * w, p.z - side.z * w, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w], i * 6);
      // Fade in from the tail; warm gold low down to white at the apex. Values over 1 feed the bloom.
      const age = i / (n - 1);
      const a = Math.min(1, age * 2.5) * 0.85;
      const hgt = maxY > minY ? (p.y - minY) / (maxY - minY) : 0;
      const r = 1.3;
      const gr = 1.05 + 0.25 * hgt;
      const b = 0.55 + 0.75 * hgt;
      this.ribbonCol.set([r * a, gr * a, b * a, a, r * a, gr * a, b * a, a], i * 8);
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    geo.setDrawRange(0, (n - 1) * 6);
  }

  clearTrail(): void {
    this.points.length = 0;
    this.trail.geometry.setDrawRange(0, 0);
  }

  pushTrail(p: THREE.Vector3): void {
    const last = this.points[this.points.length - 1];
    if (this.points.length >= TRAIL_MAX || (last && last.distanceToSquared(p) < 0.04)) return;
    this.points.push(p.clone());
  }

  set trailVisible(v: boolean) {
    this.trail.visible = v;
  }
}
