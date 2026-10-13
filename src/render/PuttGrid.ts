import * as THREE from 'three';
import type { HoleTerrain } from '../course/terrain';
import { clamp } from '../util/math';

/**
 * The classic putting grid: lines draped over the green so you can read the break, with dots that
 * drift downhill to show which way and how hard it slopes.
 */
export class PuttGrid {
  readonly group = new THREE.Group();
  private dots: THREE.Points | null = null;
  private dotHome: Float32Array = new Float32Array();
  private dotVel: Float32Array = new Float32Array();
  private dotPhase: Float32Array = new Float32Array();

  constructor(
    scene: THREE.Scene,
    private readonly terrain: HoleTerrain,
  ) {
    scene.add(this.group);
    this.build();
    this.group.visible = false;
  }

  private build(): void {
    const t = this.terrain;
    const g = t.green;
    const r = Math.max(g.spec.rx, g.spec.rz) * 1.35;
    const cell = 1;
    const inside = (x: number, z: number) => g.field(x, z) < 1.12;
    const verts: number[] = [];
    const colors: number[] = [];
    const n = new THREE.Vector3();
    const c = new THREE.Color();
    const pushV = (x: number, z: number) => {
      t.normalAt(x, z, n);
      const slope = Math.hypot(n.x, n.z) / n.y;
      // Blue = flat through to red = steep.
      c.setHSL(0.6 - Math.min(slope / 0.05, 1) * 0.6, 0.85, 0.6);
      verts.push(x, t.heightAt(x, z) + 0.02, z);
      colors.push(c.r, c.g, c.b);
    };
    const step = 0.5;
    for (let gx = g.cx - r; gx <= g.cx + r; gx += cell) {
      for (let z = g.cz - r; z < g.cz + r; z += step) {
        if (inside(gx, z) && inside(gx, z + step)) {
          pushV(gx, z);
          pushV(gx, z + step);
        }
      }
    }
    for (let gz = g.cz - r; gz <= g.cz + r; gz += cell) {
      for (let x = g.cx - r; x < g.cx + r; x += step) {
        if (inside(x, gz) && inside(x + step, gz)) {
          pushV(x, gz);
          pushV(x + step, gz);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }));
    this.group.add(lines);

    // Slope dots at every other intersection.
    const home: number[] = [];
    const vel: number[] = [];
    for (let gx = g.cx - r; gx <= g.cx + r; gx += cell * 2) {
      for (let gz = g.cz - r; gz <= g.cz + r; gz += cell * 2) {
        if (!inside(gx, gz)) continue;
        t.normalAt(gx, gz, n);
        home.push(gx, gz);
        // Downhill direction, speed scaled by slope.
        vel.push(clamp(n.x * 30, -1.2, 1.2), clamp(n.z * 30, -1.2, 1.2));
      }
    }
    const count = home.length / 2;
    this.dotHome = new Float32Array(home);
    this.dotVel = new Float32Array(vel);
    this.dotPhase = new Float32Array(count).map((_, i) => (i * 0.37) % 1);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.dots = new THREE.Points(dg, new THREE.PointsMaterial({ color: '#ffffff', size: 0.05, sizeAttenuation: true }));
    this.dots.frustumCulled = false;
    this.group.add(this.dots);
  }

  update(dt: number): void {
    if (!this.group.visible || !this.dots) return;
    const pos = this.dots.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.dotPhase.length; i++) {
      this.dotPhase[i] = (this.dotPhase[i] + dt * 0.6) % 1;
      const p = this.dotPhase[i];
      const x = this.dotHome[i * 2] + this.dotVel[i * 2] * p;
      const z = this.dotHome[i * 2 + 1] + this.dotVel[i * 2 + 1] * p;
      pos.setXYZ(i, x, this.terrain.heightAt(x, z) + 0.04, z);
    }
    pos.needsUpdate = true;
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
  }
}
