// Lightweight particle effects in a single draw call: diesel exhaust from
// the stacks (heavier under load and on gear changes) and dust thrown up by
// the wheels when driving on grass. A fixed pool is recycled, so there is
// no allocation while driving.

import * as THREE from 'three';
import { softDot } from './textures.js';

const MAX = 220;

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    float a = t.a * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }
`;

export class Effects {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.color = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.grow = new Float32Array(MAX);
    this.startAlpha = new Float32Array(MAX);
    this.next = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: softDot() }, uScale: { value: 400 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);

    this._v = new THREE.Vector3();
    this.exhaustAcc = 0;
    this.dustAcc = 0;
    this.enabled = true;
  }

  /** Match point sizes to the viewport (call on resize / FOV change). */
  setViewport(heightPx, fovDeg) {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  spawn(x, y, z, vx, vy, vz, size, grow, life, alpha, r, g, b) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.size[i] = size;
    this.grow[i] = grow;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.startAlpha[i] = alpha;
    this.alpha[i] = alpha;
    this.color.set([r, g, b], i * 3);
  }

  /**
   * @param {number} dt
   * @param {object} s { truckModel, phys, throttle, shifted }
   */
  update(dt, s) {
    if (this.enabled && s) this.emit(dt, s);
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const k = i * 3;
      // Drag + gentle rise
      this.vel[k] *= 1 - 1.5 * dt;
      this.vel[k + 2] *= 1 - 1.5 * dt;
      this.vel[k + 1] = this.vel[k + 1] * (1 - 0.8 * dt) + 0.25 * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.startAlpha[i] * (1 - t) * Math.min(1, t * 8);
    }
    const a = this.geometry.attributes;
    a.position.needsUpdate = true;
    a.aSize.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
    a.aColor.needsUpdate = true;
  }

  emit(dt, { truckModel, phys, throttle, shifted }) {
    const speed = Math.abs(phys.speed);
    const v = this._v;
    truckModel.body.updateMatrixWorld();
    // Exhaust: idle trickle, heavy under load, a puff on each gear change.
    const load = throttle * (0.4 + phys.rpm);
    const rate = 5 + load * 28 + (shifted ? 40 : 0);
    this.exhaustAcc += rate * dt;
    const fx = Math.sin(phys.heading);
    const fz = Math.cos(phys.heading);
    while (this.exhaustAcc >= 1) {
      this.exhaustAcc -= 1;
      for (const e of truckModel.exhausts) {
        v.copy(e).applyMatrix4(truckModel.body.matrixWorld);
        const dark = 0.18 + (1 - load) * 0.25;
        const up = e.y > 1.5; // stack vs under-chassis outlet
        this.spawn(
          v.x,
          v.y,
          v.z,
          -fx * speed * 0.3 + (Math.random() - 0.5) * 0.4,
          up ? 1.4 + load : 0.2,
          -fz * speed * 0.3 + (Math.random() - 0.5) * 0.4,
          0.35,
          1.6 + load,
          1.2 + Math.random() * 0.6,
          0.25 + load * 0.3,
          dark,
          dark,
          dark * 1.05
        );
      }
    }
    // Dust from the rear wheels on grass.
    if (phys.surface === 'grass' && speed > 2.5) {
      this.dustAcc += Math.min(40, speed * 3) * dt;
      const rz = phys.spec.rearAxleOffset;
      while (this.dustAcc >= 1) {
        this.dustAcc -= 1;
        const side = Math.random() < 0.5 ? -1 : 1;
        const rx = -fz * side * 1.1;
        const rzz = fx * side * 1.1;
        this.spawn(
          phys.x + fx * rz + rx,
          0.3,
          phys.z + fz * rz + rzz,
          -fx * speed * 0.2 + (Math.random() - 0.5) * 1.5,
          0.6 + Math.random() * 0.6,
          -fz * speed * 0.2 + (Math.random() - 0.5) * 1.5,
          0.8,
          2.2,
          1.0 + Math.random() * 0.5,
          0.35,
          0.55,
          0.47,
          0.36
        );
      }
    }
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
  }
}
