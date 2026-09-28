// Low-poly trucks built from primitives (no model files), driven by a
// catalogue entry (data/trucks.js): body type, cab style, paint, dimensions.
// Local space: +Z is forward, origin at the centre of the footprint on the ground.
// Exposes hooks to animate wheels, steering, lights and body roll/pitch.

import * as THREE from 'three';
import { SUSPENSION } from '../config.js';
import { TRUCK_CATALOGUE, buildSpec } from '../data/trucks.js';

function box(w, h, l, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

export class TruckModel {
  /** @param {object} entry truck catalogue entry */
  constructor(entry = TRUCK_CATALOGUE[0]) {
    this.entry = entry;
    const spec = buildSpec(entry);
    this.spec = spec;
    this.root = new THREE.Group(); // positioned/rotated by physics
    this.body = new THREE.Group(); // rolls/pitches on the "suspension"
    this.root.add(this.body);

    const L = spec.length;
    const halfL = L / 2;
    const W = spec.width;
    const WHEEL_R = spec.wheelRadius;
    const frontAxleZ = spec.rearAxleOffset + spec.wheelbase;
    const rearAxleZ = spec.rearAxleOffset;

    this.paintMat = new THREE.MeshLambertMaterial({ color: entry.paint });
    this.accentMat = new THREE.MeshLambertMaterial({ color: entry.accent });
    const paint = this.paintMat;
    const trimMat = new THREE.MeshLambertMaterial({ color: 0x2a2d31 });
    const chromeMat = new THREE.MeshLambertMaterial({ color: 0xb9bec4 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x223344 });
    const cargoMat = new THREE.MeshLambertMaterial({ color: 0xeeeeea });
    this.materials = [paint, this.accentMat, trimMat, chromeMat, glassMat, cargoMat];

    // Chassis rails
    this.body.add(box(1.2, 0.3, L - 0.4, trimMat, 0, 0.85, 0));

    // ---- Cab ----
    const front = halfL; // front face z
    let cabBack; // z of the cab's rear wall
    if (entry.cab === 'conventional') {
      // Long hood in front, tall sleeper cab behind it.
      const hoodLen = 2.0;
      const cabLen = 2.5;
      this.body.add(box(2.1, 1.0, hoodLen, paint, 0, 1.55, front - hoodLen / 2)); // hood
      this.body.add(box(1.5, 0.8, 0.06, chromeMat, 0, 1.5, front + 0.01)); // grille
      this.body.add(box(2.5, 0.35, 0.3, chromeMat, 0, 0.9, front - 0.1)); // bumper
      const cz = front - hoodLen - cabLen / 2;
      this.body.add(box(2.45, 2.0, cabLen, paint, 0, 2.2, cz));
      this.body.add(box(2.2, 0.75, 0.08, glassMat, 0, 2.6, cz + cabLen / 2 + 0.01)); // windscreen
      this.body.add(box(2.47, 0.5, 0.9, glassMat, 0, 2.6, cz + 0.6));
      this.body.add(box(2.46, 0.15, cabLen, this.accentMat, 0, 1.35, cz)); // stripe
      for (const sx of [-1, 1]) {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.6, 6), chromeMat);
        stack.position.set(sx * 1.3, 2.6, cz - cabLen / 2 + 0.15);
        this.body.add(stack);
      }
      cabBack = cz - cabLen / 2;
    } else {
      // Cabover (flat front). 'aero' adds a roof fairing and side skirts.
      const cabLen = entry.body === 'rigid' ? 2.7 : 2.4;
      const cz = front - cabLen / 2 - 0.1;
      this.body.add(box(2.45, 2.0, cabLen, paint, 0, 2.2, cz));
      this.body.add(box(2.2, 0.9, 0.08, glassMat, 0, 2.6, front + 0.0)); // windscreen
      this.body.add(box(2.47, 0.55, 1.1, glassMat, 0, 2.6, cz + 0.5));
      this.body.add(box(2.5, 0.35, 0.3, chromeMat, 0, 0.95, front - 0.1)); // bumper
      this.body.add(box(1.5, 0.5, 0.06, chromeMat, 0, 1.6, front + 0.02)); // grille
      this.body.add(box(2.46, 0.2, cabLen, this.accentMat, 0, 1.45, cz)); // stripe
      if (entry.cab === 'aero') {
        const fair = box(2.4, 0.9, cabLen * 0.9, paint, 0, 3.6, cz - 0.1);
        fair.rotation.x = -0.12;
        this.body.add(fair);
        for (const sx of [-1, 1]) this.body.add(box(0.08, 0.6, L * 0.35, this.accentMat, sx * 1.22, 0.8, cz - cabLen / 2 - L * 0.17));
      } else {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.8, 6), chromeMat);
        stack.position.set(1.05, 3.1, cz - cabLen / 2 + 0.2);
        this.body.add(stack);
      }
      cabBack = cz - cabLen / 2;
    }

    // ---- Rear: cargo body (rigid) or fifth wheel deck (tractor) ----
    if (entry.body === 'rigid') {
      const cargoLen = cabBack - (-halfL) - 0.25;
      const cargoZ = -halfL + cargoLen / 2;
      this.body.add(box(2.55, 2.7, cargoLen, cargoMat, 0, 2.5, cargoZ));
      this.body.add(box(2.57, 0.35, cargoLen, this.accentMat, 0, 2.0, cargoZ)); // livery stripe
      this.body.add(box(2.5, 0.2, 0.1, trimMat, 0, 0.9, -halfL));
    } else {
      // Fuel tanks, deck and fifth-wheel coupling plate.
      for (const sx of [-1, 1]) {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.1, 8), chromeMat);
        tank.rotation.x = Math.PI / 2;
        tank.position.set(sx * 0.95, 0.85, cabBack - 0.6);
        this.body.add(tank);
      }
      this.fifthWheelZ = rearAxleZ + 0.2;
      this.body.add(box(1.6, 0.12, 1.3, trimMat, 0, 1.18, this.fifthWheelZ));
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 12), chromeMat);
      plate.position.set(0, 1.28, this.fifthWheelZ);
      this.body.add(plate);
      this.body.add(box(2.4, 0.5, 0.15, trimMat, 0, 1.0, -halfL + 0.05)); // rear mudguard bar
    }

    // Lights (emissive so they read at night / in fog; brightness toggled at runtime)
    this.headMat = new THREE.MeshBasicMaterial({ color: 0xfff6d0 });
    this.tailMat = new THREE.MeshBasicMaterial({ color: 0x661111 });
    this.reverseMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
    for (const sx of [-1, 1]) {
      this.body.add(box(0.45, 0.22, 0.06, this.headMat, sx * 0.95, 1.2, halfL + 0.03));
      this.body.add(box(0.3, 0.3, 0.06, this.tailMat, sx * (W / 2 - 0.2), 1.1, -halfL - 0.05));
      this.body.add(box(0.2, 0.2, 0.06, this.reverseMat, sx * (W / 2 - 0.55), 1.1, -halfL - 0.05));
    }

    // Wheels: steerable front pair + tandem dual rear axles (wide single wheels).
    const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.45, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const rearGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.75, 10);
    rearGeo.rotateZ(Math.PI / 2);
    const tyreMat = new THREE.MeshLambertMaterial({ color: 0x1b1b1b });
    this.hubMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a6 });
    const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.47, 6);
    hubGeo.rotateZ(Math.PI / 2);
    this.materials.push(tyreMat, this.hubMat);

    this.frontPivots = [];
    this.wheels = [];
    const addWheel = (x, z, geo, steer) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, WHEEL_R, z);
      const wheel = new THREE.Mesh(geo, tyreMat);
      const hub = new THREE.Mesh(hubGeo, this.hubMat);
      hub.position.x = Math.sign(x) * 0.02;
      wheel.add(hub);
      pivot.add(wheel);
      this.root.add(pivot); // wheels don't roll with the body
      this.wheels.push(wheel);
      if (steer) this.frontPivots.push(pivot);
    };
    addWheel(-1.05, frontAxleZ, wheelGeo, true);
    addWheel(1.05, frontAxleZ, wheelGeo, true);
    for (const dz of [0.65, -0.65]) {
      addWheel(-0.95, rearAxleZ + dz, rearGeo, false);
      addWheel(0.95, rearAxleZ + dz, rearGeo, false);
    }

    // Cheap blob shadow for low/medium quality (no shadow maps).
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 0.8, L + 0.8),
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
    this.rollVel = 0;
    this.pitch = 0;
    this.pitchVel = 0;
    this.heave = 0;
    this.heaveVel = 0;
    this.bumpTimer = 0;
  }

  /** Sync visuals with the physics state. */
  update(phys, input, dt) {
    this.root.position.set(phys.x, 0, phys.z);
    this.root.rotation.y = phys.heading;

    // Wheel spin and steering (visual steer is exaggerated slightly for readability).
    this.wheelSpin += (phys.speed / this.spec.wheelRadius) * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    for (const p of this.frontPivots) p.rotation.y = -phys.steerAngle * 1.1;

    // Suspension: damped springs for pitch, roll and heave. Driven by braking /
    // acceleration, cornering, surface bumps and impacts, so the body visibly
    // carries weight and settles with a little overshoot.
    const S = SUSPENSION;
    const pitchForce = THREE.MathUtils.clamp(-phys.accel * S.pitchPerAccel, -S.maxPitch, S.maxPitch);
    const rollForce = THREE.MathUtils.clamp(phys.latAccel * S.rollPerLat, -S.maxRoll, S.maxRoll);
    const bumpy = phys.surface === 'grass' ? Math.min(1, Math.abs(phys.speed) / 8) : 0;
    this.bumpTimer -= dt;
    if (bumpy > 0 && this.bumpTimer <= 0) {
      this.bumpTimer = 0.08 + Math.random() * 0.15;
      this.heaveVel += (Math.random() - 0.5) * S.bumpStrength * bumpy;
      this.rollVel += (Math.random() - 0.5) * S.bumpStrength * 0.6 * bumpy;
    }
    if (phys.lastImpact > 1) {
      this.pitchVel += Math.min(0.6, phys.lastImpact * 0.03) * Math.sign(phys.speed || 1);
      this.heaveVel += Math.min(0.8, phys.lastImpact * 0.05);
    }
    if (dt > 0) {
      const spring = (pos, vel, target) => {
        vel += (S.stiffness * (target - pos) - S.damping * vel) * dt;
        return [pos + vel * dt, vel];
      };
      [this.pitch, this.pitchVel] = spring(this.pitch, this.pitchVel, pitchForce);
      [this.roll, this.rollVel] = spring(this.roll, this.rollVel, rollForce);
      [this.heave, this.heaveVel] = spring(this.heave, this.heaveVel, 0);
    }
    this.body.rotation.x = this.pitch;
    this.body.rotation.z = this.roll;
    this.body.position.y = this.heave * 0.25;

    // Lights
    this.tailMat.color.setHex(input.brake > 0 ? 0xff2020 : 0x661111);
    this.reverseMat.color.setHex(phys.gear === 'R' ? 0xffffff : 0x555555);
  }

  setShadowMode(realShadows) {
    this.blobShadow.visible = !realShadows;
  }

  /** Free GPU resources when swapping trucks. */
  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        if (!this.materials.includes(o.material)) o.material.dispose();
      }
    });
    for (const m of this.materials) m.dispose();
  }
}
