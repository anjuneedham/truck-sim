// Third-person chase camera (plus a cab view).
//  - Smoothly follows the truck position, height and heading (lagged yaw feels weighty).
//  - Aim point swings into turns; FOV widens with speed for a sense of pace.
//  - Presets cycle views; drag to look around (springs back); pinch to zoom.
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
    this.zoom = 1; // pinch zoom multiplier on follow distance
    this.distance = CAMERA.presets[0].distance;
    this.height = CAMERA.presets[0].height;
    this.turnOffset = 0;
    this.fov = CAMERA.fov;
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.shake = 0;
    this.initialised = false;
  }

  get preset() {
    return CAMERA.presets[this.presetIndex];
  }

  setPreset(i) {
    const n = CAMERA.presets.length;
    this.presetIndex = ((i % n) + n) % n;
  }

  cyclePreset() {
    this.setPreset(this.presetIndex + 1);
    return this.presetIndex;
  }

  /** factor > 1 zooms out. */
  applyZoom(factor) {
    this.zoom = THREE.MathUtils.clamp(this.zoom * factor, CAMERA.zoomMin, CAMERA.zoomMax);
  }

  addShake(amount) {
    this.shake = Math.min(1, this.shake + amount);
  }

  snap(phys) {
    this.initialised = false;
    this.update(phys, 1 / 60, { dx: 0, dragging: false });
  }

  update(phys, dt, look) {
    const preset = this.preset;
    const k = (lag) => 1 - Math.exp(-lag * dt);

    if (!this.initialised) {
      this.yaw = phys.heading;
      this.distance = (preset.distance || 0) * this.zoom;
      this.height = preset.height;
      this.turnOffset = 0;
    }
    let dy = phys.heading - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * k(preset.hood ? 12 : CAMERA.yawLag);

    // Look-around: drag adds yaw; release springs back to behind the truck.
    this.lookOffset += look.dx * -0.006;
    this.lookOffset = THREE.MathUtils.clamp(this.lookOffset, -Math.PI, Math.PI);
    if (!look.dragging) this.lookOffset *= Math.exp(-2.5 * dt);

    // Sense of speed: widen FOV as the truck goes faster.
    const speed = Math.abs(phys.speed);
    const wantFov = CAMERA.fov + Math.min(CAMERA.maxExtraFov, speed * CAMERA.fovPerSpeed);
    this.fov += (wantFov - this.fov) * k(2);
    this.fovOffset = this.fov - CAMERA.fov;

    // Aim point swings toward where the truck is turning.
    const wantTurn = THREE.MathUtils.clamp(-phys.yawRate * speed * CAMERA.turnLookAhead, -8, 8);
    this.turnOffset += (wantTurn - this.turnOffset) * k(2.5);

    const fx = Math.sin(phys.heading);
    const fz = Math.cos(phys.heading);
    // Right vector of the truck: (-cos h, sin h)
    const rx = -fz;
    const rz = fx;
    const tx = phys.x;
    const tz = phys.z;

    if (preset.hood) {
      // Cab view: rigidly attached above the windscreen, looking down the road.
      const yaw = phys.heading + this.lookOffset;
      this.pos.set(tx + fx * preset.forward, preset.height, tz + fz * preset.forward);
      const ahead = preset.lookAhead;
      this.target.set(this.pos.x + Math.sin(yaw) * ahead, preset.lookHeight, this.pos.z + Math.cos(yaw) * ahead);
      this.initialised = true;
      this.applyToCamera(dt);
      return;
    }

    const yaw = this.yaw + this.lookOffset;
    // Ease distance/height to the preset (slightly further back at speed).
    const wantDist = (preset.distance + Math.min(4, speed * 0.12)) * this.zoom;
    this.distance += (wantDist - this.distance) * k(3);
    this.height += (preset.height * (0.8 + 0.2 * this.zoom) - this.height) * k(CAMERA.heightLag);

    // Anti-clip: shorten the boom if something tall is between truck and camera.
    let bx = tx - Math.sin(yaw) * this.distance;
    let bz = tz - Math.cos(yaw) * this.distance;
    const hit = this.collision.raycast(tx, tz, bx, bz, this.height - 0.5);
    let dist = this.distance;
    if (hit < 1) dist = Math.max(6, this.distance * hit - 1.0);
    bx = tx - Math.sin(yaw) * dist;
    bz = tz - Math.cos(yaw) * dist;

    const desired = new THREE.Vector3(bx, this.height, bz);
    if (!this.initialised) this.pos.copy(desired);
    // Follow faster at speed so the truck doesn't drift out of frame.
    this.pos.lerp(desired, k(CAMERA.positionLag + speed * 0.08));
    const ahead = preset.lookAhead;
    this.target.set(
      tx + fx * ahead + rx * this.turnOffset,
      preset.lookHeight,
      tz + fz * ahead + rz * this.turnOffset
    );
    this.initialised = true;
    this.applyToCamera(dt);
  }

  applyToCamera(dt) {
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
