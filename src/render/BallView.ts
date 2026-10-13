import * as THREE from 'three';
import { BALL_RADIUS } from '../physics/constants';

const TRAIL_MAX = 900;

/** The ball, its contact shadow and the flight tracer. */
export class BallView {
  readonly ball: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  readonly trail: THREE.Line;
  private readonly trailPos = new Float32Array(TRAIL_MAX * 3);
  private trailCount = 0;

  constructor(scene: THREE.Scene) {
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 16, 12),
      new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#555555' }),
    );
    this.ball.castShadow = true;
    scene.add(this.ball);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(BALL_RADIUS, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }),
    );
    scene.add(this.shadow);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    geo.setDrawRange(0, 0);
    this.trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75 }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);
  }

  /** Place the ball; scale it up with camera distance so it never vanishes. */
  update(pos: THREE.Vector3, groundY: number, camera: THREE.Camera): void {
    this.ball.position.copy(pos);
    const dist = camera.position.distanceTo(pos);
    const s = Math.max(1, (dist * 0.0028) / BALL_RADIUS);
    this.ball.scale.setScalar(s);
    const above = Math.max(0, pos.y - BALL_RADIUS - groundY);
    this.shadow.position.set(pos.x, groundY + 0.01, pos.z);
    const ss = s * (1 + above * 0.05);
    this.shadow.scale.setScalar(ss);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.35 - above * 0.01);
  }

  clearTrail(): void {
    this.trailCount = 0;
    this.trail.geometry.setDrawRange(0, 0);
  }

  pushTrail(p: THREE.Vector3): void {
    if (this.trailCount >= TRAIL_MAX) return;
    this.trailPos.set([p.x, p.y, p.z], this.trailCount * 3);
    this.trailCount++;
    const attr = this.trail.geometry.attributes.position as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, this.trailCount);
  }

  set trailVisible(v: boolean) {
    this.trail.visible = v;
  }
}
