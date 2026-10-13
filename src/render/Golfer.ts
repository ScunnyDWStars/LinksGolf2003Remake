import * as THREE from 'three';

export type ClubKind = 'wood' | 'iron' | 'putter';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

/** Two-bone IK: elbow/knee position for a limb from `root` to `end` with bone lengths a, b, bending toward `pole`. */
export function solveTwoBone(root: THREE.Vector3, end: THREE.Vector3, a: number, b: number, pole: THREE.Vector3): THREE.Vector3 {
  const d = end.clone().sub(root);
  const len = Math.min(d.length(), a + b - 1e-4);
  const dir = d.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + len * len - b * b) / (2 * a * len), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const toPole = pole.clone().sub(root);
  const perp = toPole.sub(dir.clone().multiplyScalar(toPole.dot(dir)));
  if (perp.lengthSq() < 1e-8) perp.set(0, -1, 0);
  perp.normalize();
  return root.clone().addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Swing pose for a meter position: arm angle in the swing plane, wrist hinge, shoulder and hip turn. */
export function swingPose(pos: number, putting: boolean): { arm: number; hinge: number; shoulders: number; hips: number; shift: number; finish: number } {
  if (putting) {
    const p = THREE.MathUtils.clamp(pos, -0.8, 1.15);
    return { arm: p * 0.32, hinge: 0, shoulders: 0, hips: 0, shift: 0, finish: 0 };
  }
  if (pos >= 0) {
    const p = Math.min(pos, 1.15);
    return { arm: p * 1.95, hinge: smooth(0.12, 0.85, p) * 1.55, shoulders: -p * 0.95, hips: -p * 0.42, shift: -p * 0.04, finish: 0 };
  }
  const q = Math.min(-pos, 1);
  return { arm: -q * 2.25, hinge: -smooth(0.2, 0.9, q) * 1.45, shoulders: q * 1.5, hips: q * 1.05, shift: q * 0.1, finish: q };
}

/** A capsule mesh stretched between two points. */
class Limb {
  readonly mesh: THREE.Mesh;
  constructor(radius: number, mat: THREE.Material, parent: THREE.Object3D) {
    this.mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, 1, 4, 10), mat);
    this.mesh.castShadow = true;
    parent.add(this.mesh);
  }
  set(a: THREE.Vector3, b: THREE.Vector3, radius: number): void {
    const d = b.clone().sub(a);
    const len = Math.max(0.001, d.length());
    this.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    this.mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    // Capsule body is length 1 plus caps of `radius`; scale only the body.
    this.mesh.scale.set(1, Math.max(0.01, (len - radius * 0.6) / 1), 1);
  }
}

/**
 * A jointed golfer. The backswing follows the swing meter; arms and legs are solved with two-bone IK so
 * hands stay on the grip while the shoulders and hips turn and the wrists hinge.
 * Local frame: facing +Z (the ball), target +X, up +Y.
 */
export class Golfer {
  readonly root = new THREE.Group();
  private putting = false;
  private ballLocal = V(0, 0.02, 0.74);
  private clubLen = 0.86;
  private readonly mats: Record<string, THREE.Material>;
  private readonly limbs: Record<string, Limb> = {};
  private readonly parts: Record<string, THREE.Mesh> = {};
  private readonly club = new THREE.Group();
  private readonly heads: Record<ClubKind, THREE.Object3D>;
  private readonly shaft: THREE.Mesh;

  constructor() {
    this.mats = {
      shirt: new THREE.MeshPhysicalMaterial({ color: '#e9c22c', roughness: 0.72, sheen: 0.6, sheenColor: new THREE.Color('#fff2b8'), sheenRoughness: 0.6 }),
      trousers: new THREE.MeshPhysicalMaterial({ color: '#2b313b', roughness: 0.78, sheen: 0.3, sheenColor: new THREE.Color('#8090a8') }),
      skin: new THREE.MeshStandardMaterial({ color: '#c98c66', roughness: 0.55 }),
      glove: new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.6 }),
      cap: new THREE.MeshStandardMaterial({ color: '#f6f6f2', roughness: 0.7 }),
      shoe: new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.35 }),
      sole: new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.6 }),
      belt: new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.4 }),
      steel: new THREE.MeshStandardMaterial({ color: '#d7dbe0', metalness: 1, roughness: 0.25 }),
      grip: new THREE.MeshStandardMaterial({ color: '#202020', roughness: 0.8 }),
      head: new THREE.MeshStandardMaterial({ color: '#2a2d33', metalness: 0.6, roughness: 0.3 }),
    };
    const m = this.mats;
    const r = this.root;
    for (const side of ['L', 'R']) {
      this.limbs[`thigh${side}`] = new Limb(0.078, m.trousers, r);
      this.limbs[`shin${side}`] = new Limb(0.06, m.trousers, r);
      this.limbs[`upper${side}`] = new Limb(0.048, m.shirt, r);
      this.limbs[`fore${side}`] = new Limb(0.04, m.skin, r);
      const shoe = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.17, 4, 8).rotateX(Math.PI / 2), m.shoe);
      shoe.castShadow = true;
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.27), m.sole);
      sole.position.y = -0.04;
      shoe.add(sole);
      r.add(shoe);
      this.parts[`shoe${side}`] = shoe;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.046, 12, 10), side === 'L' ? m.glove : m.skin);
      hand.scale.set(1, 1.15, 0.9);
      hand.castShadow = true;
      r.add(hand);
      this.parts[`hand${side}`] = hand;
    }
    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.12, 4, 12).rotateZ(Math.PI / 2), m.trousers);
    pelvis.scale.set(1, 1, 0.8);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.04, 16), m.belt);
    belt.scale.set(1.15, 1, 0.85);
    belt.position.y = 0.06;
    pelvis.add(belt);
    this.parts.pelvis = pelvis;
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.3, 6, 14), m.shirt);
    chest.scale.set(1.18, 1, 0.78);
    this.parts.chest = chest;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), m.skin);
    this.parts.neck = neck;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 18, 14), m.skin);
    head.scale.set(0.92, 1.05, 0.98);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.106, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), m.cap);
    cap.position.y = 0.025;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.012, 16, 1, false, -Math.PI / 2, Math.PI), m.cap);
    brim.position.set(0, 0.03, 0.085);
    brim.scale.set(1, 1, 1.25);
    head.add(cap, brim);
    this.parts.head = head;
    for (const k of ['pelvis', 'chest', 'neck', 'head']) {
      this.parts[k].castShadow = true;
      r.add(this.parts[k]);
    }

    // Club: shaft along +Y from the grip end, head at the far end.
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.009, 1, 8).translate(0, 0.5, 0), m.steel);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.0105, 0.27, 10).translate(0, 0.135, 0), m.grip);
    const wood = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), m.head);
    wood.scale.set(1.9, 0.95, 1.35);
    wood.position.set(0.035, 0, 0.02);
    const iron = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.045, 0.014), m.steel);
    iron.position.set(0.03, 0, 0.01);
    iron.rotation.x = -0.35;
    const putter = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.024, 0.026), m.steel);
    putter.position.set(0.045, 0, 0);
    this.heads = { wood, iron, putter };
    this.club.add(this.shaft, grip, wood, iron, putter);
    this.club.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    r.add(this.club);
    this.setClub('wood');
    this.setSwing(0);
  }

  setClub(kind: ClubKind): void {
    for (const [k, o] of Object.entries(this.heads)) o.visible = k === kind;
    this.clubLen = kind === 'putter' ? 0.86 : kind === 'wood' ? 1.1 : 0.94;
  }

  /** Stand at the ball facing it, with the target to the golfer's left. */
  placeAt(ball: THREE.Vector3, aimDir: THREE.Vector3, groundY: (x: number, z: number) => number, putting: boolean): void {
    this.putting = putting;
    const d = new THREE.Vector3(aimDir.x, 0, aimDir.z).normalize();
    const right = new THREE.Vector3(-d.z, 0, d.x);
    const stand = putting ? 0.56 : this.clubLen > 1 ? 0.84 : 0.74;
    const x = ball.x - right.x * stand;
    const z = ball.z - right.z * stand;
    this.root.position.set(x, groundY(x, z), z);
    const m = new THREE.Matrix4().makeBasis(d, new THREE.Vector3(0, 1, 0), right);
    this.root.quaternion.setFromRotationMatrix(m);
    this.ballLocal.set(0, ball.y - this.root.position.y, stand);
    this.setSwing(0);
  }

  /** 0 = address, 1 = top of a full backswing, negative = follow-through to -1 (finish). */
  setSwing(pos: number): void {
    const putt = this.putting;
    const pose = swingPose(pos, putt);
    // Posture: hip hinge and spine tilt toward the ball (more upright for a putt).
    const tilt = putt ? 0.62 : 0.6;
    const hipC = V(pose.shift, putt ? 0.9 : 0.92, -0.06);
    const spine = V(0, Math.cos(tilt), Math.sin(tilt));
    const hipRot = new THREE.Quaternion().setFromAxisAngle(UP, pose.hips);
    const shRot = new THREE.Quaternion().setFromAxisAngle(spine, pose.shoulders);

    this.parts.pelvis.position.copy(hipC);
    this.parts.pelvis.quaternion.copy(hipRot);
    const chestC = hipC.clone().addScaledVector(spine, 0.3);
    this.parts.chest.position.copy(chestC);
    this.parts.chest.quaternion.copy(shRot).multiply(new THREE.Quaternion().setFromUnitVectors(UP, spine));
    const neckBase = hipC.clone().addScaledVector(spine, 0.56);
    this.parts.neck.position.copy(neckBase).addScaledVector(spine, 0.04);
    this.parts.neck.quaternion.setFromUnitVectors(UP, spine);
    // Head stays steady over the ball, then rotates to watch the shot in the finish.
    const headPos = neckBase.clone().addScaledVector(spine, 0.13).add(V(0, 0.02, 0.03));
    this.parts.head.position.copy(headPos);
    const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.75 - pose.finish * 0.9, pose.finish * 1.1, 0, 'YXZ'));
    this.parts.head.quaternion.copy(look);

    // Feet and legs.
    const footL = V(0.17, 0.05, 0.03);
    const footR = V(-0.17, 0.05, 0.03);
    // Trail heel comes up and the knee folds in at the finish.
    footR.y += pose.finish * 0.06;
    this.parts.shoeL.position.copy(footL);
    this.parts.shoeL.rotation.set(0, 0.25 + pose.finish * 0.35, 0);
    this.parts.shoeR.position.copy(footR);
    this.parts.shoeR.rotation.set(pose.finish * 0.7, -0.15 + pose.finish * 0.6, 0);
    for (const [side, foot] of [
      ['L', footL],
      ['R', footR],
    ] as const) {
      const hip = hipC.clone().add(V(side === 'L' ? 0.1 : -0.1, -0.04, 0).applyQuaternion(hipRot));
      const ankle = foot.clone().add(V(0, 0.05, -0.04));
      const knee = solveTwoBone(hip, ankle, 0.45, 0.44, hip.clone().add(V(side === 'L' ? 0.05 : -0.05 - pose.finish * 0.15, 0, 0.6)));
      this.limbs[`thigh${side}`].set(hip, knee, 0.078);
      this.limbs[`shin${side}`].set(knee, ankle, 0.06);
    }

    // Swing plane through the shoulders and the ball; hands ride an arc in it.
    const shC = hipC.clone().addScaledVector(spine, 0.48);
    const toBall = this.ballLocal.clone().sub(shC);
    const reach = toBall.length();
    const d0 = toBall.normalize();
    const axis = V(1, 0, 0).cross(d0).normalize();
    const handR = putt ? 0.55 : 0.58;
    const armDir = d0.clone().applyAxisAngle(axis, pose.arm);
    const hands = shC.clone().addScaledVector(armDir, handR);
    const clubDir = d0.clone().applyAxisAngle(axis, pose.arm + pose.hinge);
    // Club length so the head sits on the ball at address.
    const len = Math.max(0.6, reach - handR);
    // The grip end sits 5 cm above the hands, so the shaft is that much longer.
    this.shaft.scale.set(1, len + 0.05, 1);
    for (const h of Object.values(this.heads)) h.position.y = len + 0.05;
    this.club.position.copy(hands).addScaledVector(clubDir, -0.05);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, clubDir);
    // Keep the clubface square to the target line through the swing.
    this.club.quaternion.copy(q);

    // Arms: shoulders turn with the chest; hands on the grip (lead hand above trail hand).
    const gripL = hands.clone().addScaledVector(clubDir, -0.02);
    const gripR = hands.clone().addScaledVector(clubDir, 0.075);
    this.parts.handL.position.copy(gripL);
    this.parts.handR.position.copy(gripR);
    this.parts.handL.quaternion.copy(q);
    this.parts.handR.quaternion.copy(q);
    for (const [side, grip] of [
      ['L', gripL],
      ['R', gripR],
    ] as const) {
      const shoulder = shC.clone().add(V(side === 'L' ? 0.19 : -0.19, 0.02, -0.02).applyQuaternion(shRot));
      const pole = shoulder.clone().add(V(side === 'L' ? 0.25 : -0.25, -0.6, 0.15));
      const elbow = solveTwoBone(shoulder, grip, 0.33, 0.31, pole);
      this.limbs[`upper${side}`].set(shoulder, elbow, 0.048);
      this.limbs[`fore${side}`].set(elbow, grip, 0.04);
    }
  }

  /** Where the club head is, in the golfer's local frame (for tests). */
  clubHeadLocal(): THREE.Vector3 {
    const len = this.shaft.scale.y;
    return new THREE.Vector3(0, len, 0).applyQuaternion(this.club.quaternion).add(this.club.position);
  }

  get ballInLocal(): THREE.Vector3 {
    return this.ballLocal.clone();
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }
}
