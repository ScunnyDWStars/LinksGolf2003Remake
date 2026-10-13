import * as THREE from 'three';

/**
 * A simple low-poly golfer. The arms and club rotate in a tilted swing plane around the shoulders;
 * `setSwing` takes the same 0..1 (+overswing) position the swing meter shows, so the backswing tracks the meter.
 */
export class Golfer {
  readonly root = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly axis: THREE.Vector3;
  private readonly club: THREE.Mesh;
  private putting = false;

  constructor() {
    const shirt = new THREE.MeshLambertMaterial({ color: '#e9c22c' });
    const trousers = new THREE.MeshLambertMaterial({ color: '#2f3640' });
    const skin = new THREE.MeshLambertMaterial({ color: '#d9a47e' });
    const white = new THREE.MeshLambertMaterial({ color: '#f2f2f2' });
    const shoe = new THREE.MeshLambertMaterial({ color: '#3a2a20' });
    const steel = new THREE.MeshLambertMaterial({ color: '#c8ccd2' });
    const grip = new THREE.MeshLambertMaterial({ color: '#222' });

    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // Legs, slightly flexed.
    for (const side of [-1, 1]) {
      const leg = add(this.root, new THREE.CylinderGeometry(0.075, 0.065, 0.86, 8), trousers, side * 0.14, 0.45, 0.02);
      leg.rotation.x = 0.08;
      add(this.root, new THREE.BoxGeometry(0.11, 0.07, 0.27), shoe, side * 0.14, 0.035, 0.07);
    }
    // Torso tilts forward toward the ball.
    this.torso.position.set(0, 0.88, 0);
    this.root.add(this.torso);
    const chest = add(this.torso, new THREE.CylinderGeometry(0.17, 0.15, 0.6, 10).translate(0, 0.3, 0), shirt, 0, 0, 0);
    chest.rotation.x = 0.42;
    add(this.torso, new THREE.SphereGeometry(0.16, 10, 8), trousers, 0, 0.02, 0);
    const head = add(this.torso, new THREE.SphereGeometry(0.105, 12, 10), skin, 0, 0.72, 0.3);
    const cap = add(head, new THREE.SphereGeometry(0.11, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), white, 0, 0.02, 0);
    add(cap, new THREE.BoxGeometry(0.16, 0.015, 0.1), white, 0, 0.0, 0.1);

    // Swing assembly: shoulders -> hands -> club head at the ball.
    this.pivot.position.set(0, 1.38, 0.2);
    this.root.add(this.pivot);
    const toHead = new THREE.Vector3(0, -1.35, 0.55);
    const dir = toHead.clone().normalize();
    this.axis = new THREE.Vector3(1, 0, 0).cross(dir).normalize();
    const hands = dir.clone().multiplyScalar(0.62);
    // Arms: two cylinders from shoulders to hands.
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Vector3(side * 0.17, 0, 0);
      const len = shoulder.distanceTo(hands);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, len, 6), shirt);
      arm.position.copy(shoulder).add(hands).multiplyScalar(0.5);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hands.clone().sub(shoulder).normalize());
      arm.castShadow = true;
      this.pivot.add(arm);
    }
    add(this.pivot, new THREE.SphereGeometry(0.05, 8, 6), white, hands.x, hands.y, hands.z); // glove
    const clubLen = toHead.length() - 0.62;
    this.club = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, clubLen, 6), steel);
    this.club.position.copy(dir).multiplyScalar(0.62 + clubLen / 2);
    this.club.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.club.castShadow = true;
    this.pivot.add(this.club);
    const gripMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.25, 6), grip);
    gripMesh.position.copy(dir).multiplyScalar(0.7);
    gripMesh.quaternion.copy(this.club.quaternion);
    this.pivot.add(gripMesh);
    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.05), steel);
    headMesh.position.copy(dir).multiplyScalar(toHead.length());
    headMesh.position.x += 0.02;
    this.pivot.add(headMesh);
  }

  /** Stand at the ball facing it, with the target to the golfer's left. */
  placeAt(ball: THREE.Vector3, aimDir: THREE.Vector3, groundY: (x: number, z: number) => number, putting: boolean): void {
    this.putting = putting;
    const d = new THREE.Vector3(aimDir.x, 0, aimDir.z).normalize();
    const right = new THREE.Vector3(-d.z, 0, d.x);
    const stand = putting ? 0.62 : 0.74;
    const x = ball.x - right.x * stand;
    const z = ball.z - right.z * stand;
    this.root.position.set(x, groundY(x, z), z);
    const m = new THREE.Matrix4().makeBasis(d, new THREE.Vector3(0, 1, 0), right);
    this.root.quaternion.setFromRotationMatrix(m);
    this.root.scale.setScalar(putting ? 0.92 : 1);
    this.setSwing(0);
  }

  /** 0 = address, 1 = top of a full backswing, negative = follow-through. */
  setSwing(pos: number): void {
    const range = this.putting ? 0.45 : 2.55;
    const angle = pos >= 0 ? pos * range : pos * (this.putting ? 0.5 : 2.4);
    this.pivot.quaternion.setFromAxisAngle(this.axis, angle);
    this.torso.rotation.y = -angle * 0.18;
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }
}
