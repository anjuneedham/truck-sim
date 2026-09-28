// Third-person chase camera.
//  - Smoothly follows the truck position and heading (lagged yaw feels weighty).
//  - Presets cycle follow distance; drag on the screen to look around (springs back).
//  - Pulls in when a building/wall is between the truck and the camera.
//  - Brief shake on impacts.

import * as THREE from 'three';
import { CAMERA } from '../config.js';

export class CameraRig {
  constructor(camera, collisionWorld) {
    this.camera = camera;
    this.collision = collisionWorld;
    this.presetIndex = 0;
    this.yaw = 0; // smoothed follow yaw
    this.lookOffset = 0; // user look-around yaw offset
    this.distance = CAMERA.presets[0].distance;
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.shake = 0;
    this.initialised = false;
  }

  setPreset(i) {
    this.presetIndex = ((i % CAMERA.presets.length) + CAMERA.presets.length) % CAMERA.presets.length;
  }

  cyclePreset() {
    this.setPreset(this.presetIndex + 1);
    return this.presetIndex;
  }

  addShake(amount) {
    this.shake = Math.min(1, this.shake + amount);
  }

  snap(phys) {
    this.initialised = false;
    this.update(phys, 1 / 60, { dx: 0, dragging: false });
  }

  update(phys, dt, look) {
    const preset = CAMERA.presets[this.presetIndex];

    // When reversing, keep looking forward over the truck (standard in truck games):
    // the chase yaw simply follows the truck heading.
    if (!this.initialised) {
      this.yaw = phys.heading;
      this.distance = preset.distance;
    }
    let dy = phys.heading - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * (1 - Math.exp(-CAMERA.yawLag * dt));

    // Look-around: drag adds yaw; release springs back to behind the truck.
    this.lookOffset += look.dx * -0.006;
    this.lookOffset = THREE.MathUtils.clamp(this.lookOffset, -Math.PI, Math.PI);
    if (!look.dragging) this.lookOffset *= Math.exp(-2.5 * dt);

    const yaw = this.yaw + this.lookOffset;
    // Ease distance to preset (and slightly further at speed for visibility).
    const wantDist = preset.distance + Math.min(4, Math.abs(phys.speed) * 0.12);
    this.distance += (wantDist - this.distance) * (1 - Math.exp(-3 * dt));

    // Anti-clip: shorten the boom if something tall is between truck and camera.
    const tx = phys.x;
    const tz = phys.z;
    let bx = tx - Math.sin(yaw) * this.distance;
    let bz = tz - Math.cos(yaw) * this.distance;
    const hit = this.collision.raycast(tx, tz, bx, bz, preset.height - 0.5);
    let dist = this.distance;
    if (hit < 1) dist = Math.max(6, this.distance * hit - 1.0);
    bx = tx - Math.sin(yaw) * dist;
    bz = tz - Math.cos(yaw) * dist;

    const desired = new THREE.Vector3(bx, preset.height, bz);
    if (!this.initialised) this.pos.copy(desired);
    this.pos.lerp(desired, 1 - Math.exp(-CAMERA.positionLag * dt));
    const ahead = preset.lookAhead;
    this.target.set(tx + Math.sin(phys.heading) * ahead, preset.lookHeight, tz + Math.cos(phys.heading) * ahead);
    this.initialised = true;

    this.camera.position.copy(this.pos);
    if (this.shake > 0.001) {
      const s = this.shake * 0.35;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-6 * dt);
    }
    this.camera.lookAt(this.target);
  }
}
