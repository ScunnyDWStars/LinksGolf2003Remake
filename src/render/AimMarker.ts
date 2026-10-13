import * as THREE from 'three';

/** Target ring on the ground plus a bobbing pointer, like the classic aim cursor. */
export class AimMarker {
  readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly pointer: THREE.Mesh;
  private readonly line: THREE.Line;
  private readonly linePos = new Float32Array(64 * 3);

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 40).rotateX(-Math.PI / 2), mat);
    this.ring.renderOrder = 2;
    this.group.add(this.ring);
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.3, 24).rotateX(-Math.PI / 2), mat);
    this.ring.add(inner);
    this.pointer = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 0.9, 4).rotateX(Math.PI),
      new THREE.MeshBasicMaterial({ color: '#ff5a36' }),
    );
    this.group.add(this.pointer);
    scene.add(this.group);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    this.line = new THREE.Line(
      geo,
      new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.85, depthTest: false }),
    );
    this.line.frustumCulled = false;
    this.line.renderOrder = 3;
    scene.add(this.line);
  }

  update(target: THREE.Vector3, from: THREE.Vector3, camera: THREE.Camera, time: number, groundY: (x: number, z: number) => number, showLine: boolean): void {
    const dist = camera.position.distanceTo(target);
    const s = Math.max(0.4, dist / 40);
    this.ring.position.copy(target).setY(target.y + 0.05);
    this.ring.scale.setScalar(s);
    this.ring.rotation.y = time * 0.8;
    this.pointer.position.copy(target).setY(target.y + s * (1.6 + Math.sin(time * 3) * 0.25));
    this.pointer.scale.setScalar(s);

    // Putting: the ring around the cup is enough; the floating pointer just gets in the way.
    this.pointer.visible = !showLine;
    this.line.visible = showLine;
    if (showLine) {
      const n = 64;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const x = from.x + (target.x - from.x) * t;
        const z = from.z + (target.z - from.z) * t;
        this.linePos.set([x, groundY(x, z) + 0.03, z], i * 3);
      }
      (this.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      this.line.computeLineDistances();
    }
  }

  set visible(v: boolean) {
    this.group.visible = v;
    if (!v) this.line.visible = false;
  }
}
