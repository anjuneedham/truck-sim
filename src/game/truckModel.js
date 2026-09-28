// Placeholder low-poly box truck built from primitives (no model files).
// Local space: +Z is forward, origin at the centre of the footprint on the ground.
// Exposes hooks to animate wheels, steering, lights and body roll/pitch.

import * as THREE from 'three';
import { TRUCK } from '../config.js';

const WHEEL_R = 0.52;

function box(w, h, l, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

export class TruckModel {
  constructor() {
    this.root = new THREE.Group(); // positioned/rotated by physics
    this.body = new THREE.Group(); // rolls/pitches on the "suspension"
    this.root.add(this.body);

    const halfL = TRUCK.length / 2;
    const frontAxleZ = TRUCK.rearAxleOffset + TRUCK.wheelbase;
    const rearAxleZ = TRUCK.rearAxleOffset;

    const cabMat = new THREE.MeshLambertMaterial({ color: 0xd8342c });
    const trimMat = new THREE.MeshLambertMaterial({ color: 0x2a2d31 });
    const chromeMat = new THREE.MeshLambertMaterial({ color: 0xb9bec4 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x223344 });
    const cargoMat = new THREE.MeshLambertMaterial({ color: 0xeeeeea });
    const stripeMat = new THREE.MeshLambertMaterial({ color: 0x2c6fb8 });

    // Chassis rail
    this.body.add(box(1.6, 0.35, TRUCK.length - 0.6, trimMat, 0, 0.85, 0));

    // Cab
    const cabLen = 2.7;
    const cabZ = halfL - cabLen / 2 - 0.35;
    this.body.add(box(2.45, 1.7, cabLen, cabMat, 0, 2.05, cabZ)); // main cab
    this.body.add(box(2.45, 0.9, 1.0, cabMat, 0, 1.5, halfL - 0.5)); // nose / hood
    this.body.add(box(2.2, 0.8, 0.08, glassMat, 0, 2.45, cabZ + cabLen / 2 + 0.01)); // windscreen
    this.body.add(box(2.47, 0.55, 1.2, glassMat, 0, 2.45, cabZ + 0.5)); // side windows
    this.body.add(box(2.5, 0.35, 0.3, chromeMat, 0, 0.95, halfL - 0.1)); // bumper
    this.body.add(box(1.4, 0.6, 0.06, chromeMat, 0, 1.55, halfL + 0.01)); // grille
    // Exhaust stack
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.8, 6), chromeMat);
    stack.position.set(1.05, 3.0, cabZ - cabLen / 2 + 0.2);
    this.body.add(stack);

    // Cargo box
    const cargoLen = TRUCK.length - cabLen - 0.7;
    const cargoZ = -halfL + cargoLen / 2 + 0.05;
    this.body.add(box(2.55, 2.7, cargoLen, cargoMat, 0, 2.5, cargoZ));
    this.body.add(box(2.57, 0.35, cargoLen, stripeMat, 0, 2.0, cargoZ)); // livery stripe
    this.body.add(box(2.5, 0.2, 0.1, trimMat, 0, 0.9, -halfL)); // rear bumper

    // Lights (emissive so they read at night / in fog; brightness toggled at runtime)
    this.headMat = new THREE.MeshBasicMaterial({ color: 0xfff6d0 });
    this.tailMat = new THREE.MeshBasicMaterial({ color: 0x661111 });
    this.reverseMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
    for (const s of [-1, 1]) {
      this.body.add(box(0.45, 0.22, 0.06, this.headMat, s * 0.95, 1.2, halfL + 0.02));
      this.body.add(box(0.3, 0.35, 0.06, this.tailMat, s * 1.05, 1.3, -halfL - 0.05));
      this.body.add(box(0.22, 0.2, 0.06, this.reverseMat, s * 0.7, 1.3, -halfL - 0.05));
    }

    // Wheels: steerable front pair + dual rear pair (rendered as wide single wheels).
    const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.45, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const rearGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.75, 10);
    rearGeo.rotateZ(Math.PI / 2);
    const tyreMat = new THREE.MeshLambertMaterial({ color: 0x1b1b1b });
    const hubMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a6 });
    const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.47, 6);
    hubGeo.rotateZ(Math.PI / 2);

    this.frontPivots = [];
    this.wheels = [];
    const addWheel = (x, z, geo, steer) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, WHEEL_R, z);
      const wheel = new THREE.Mesh(geo, tyreMat);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.position.x = Math.sign(x) * 0.02;
      wheel.add(hub);
      pivot.add(wheel);
      this.root.add(pivot); // wheels don't roll with the body
      this.wheels.push(wheel);
      if (steer) this.frontPivots.push(pivot);
    };
    addWheel(-1.05, frontAxleZ, wheelGeo, true);
    addWheel(1.05, frontAxleZ, wheelGeo, true);
    addWheel(-0.95, rearAxleZ, rearGeo, false);
    addWheel(0.95, rearAxleZ, rearGeo, false);
    addWheel(-0.95, rearAxleZ - 1.3, rearGeo, false);
    addWheel(0.95, rearAxleZ - 1.3, rearGeo, false);

    // Cheap blob shadow for low/medium quality (no shadow maps).
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(TRUCK.width + 0.8, TRUCK.length + 0.8),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.1;
    this.blobShadow = blob;
    this.root.add(blob);

    this.body.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });

    this.wheelSpin = 0;
    this.roll = 0;
    this.pitch = 0;
  }

  /** Sync visuals with the physics state. */
  update(phys, input, dt) {
    this.root.position.set(phys.x, 0, phys.z);
    this.root.rotation.y = phys.heading;

    // Wheel spin and steering (visual steer is exaggerated slightly for readability).
    this.wheelSpin += (phys.speed / WHEEL_R) * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    for (const p of this.frontPivots) p.rotation.y = -phys.steerAngle * 1.1;

    // Suspension feel: body leans against acceleration and cornering.
    const targetPitch = THREE.MathUtils.clamp(-phys.accel * 0.006, -0.04, 0.04);
    const targetRoll = THREE.MathUtils.clamp(phys.latAccel * 0.007, -0.06, 0.06);
    const k = 1 - Math.exp(-6 * dt);
    this.pitch += (targetPitch - this.pitch) * k;
    this.roll += (targetRoll - this.roll) * k;
    this.body.rotation.x = this.pitch;
    this.body.rotation.z = this.roll;

    // Lights
    this.tailMat.color.setHex(input.brake > 0 ? 0xff2020 : 0x661111);
    this.reverseMat.color.setHex(phys.gear === 'R' ? 0xffffff : 0x555555);
  }

  setShadowMode(realShadows) {
    this.blobShadow.visible = !realShadows;
  }
}
