// Single delivery mission: drive from the depot to a destination zone and stop.
//
// States:  offer -> active -> complete
//                        \-> failed (only if the truck's condition hits 0%)
//
// With a tractor unit the cargo is in a trailer: the objective is first to
// couple the parked trailer, then to park the *trailer* inside the zone.
// Rigid trucks carry the cargo themselves.
//
// Also owns the destination marker visuals (zone pad + beacon).

import * as THREE from 'three';
import { MISSION } from '../config.js';
import { SPAWN } from './mapData.js';

export class Mission {
  /** @param {import('./trailerPhysics.js').TrailerPhysics|null} trailer */
  constructor(scene, job, trailer = null) {
    this.job = job;
    this.trailer = trailer;
    this.state = 'offer';
    this.elapsed = 0;
    this.stoppedTime = 0;
    this.result = null;

    // Route estimate: straight line * 1.35 approximates following the road grid.
    const straight = Math.hypot(job.zone.x - SPAWN.x, job.zone.z - SPAWN.z);
    this.routeKm = (straight * 1.35) / 1000;
    const trailerBonus = trailer ? MISSION.trailerPayMultiplier : 1;
    this.basePay = Math.round(((MISSION.basePay + this.routeKm * MISSION.payPerKm) * trailerBonus) / 10) * 10;
    // Par time from an average route speed (loaded rigs are slower).
    const parSpeed = trailer ? MISSION.parSpeedTrailerKmh : MISSION.parSpeedKmh;
    this.parTime = (this.routeKm / parSpeed) * 3600;

    this.marker = this.buildMarker(scene, job.zone);
  }

  buildMarker(scene, zone) {
    const group = new THREE.Group();
    group.position.set(zone.x, 0, zone.z);

    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(zone.w, zone.l),
      new THREE.MeshBasicMaterial({ color: 0x33dd77, transparent: true, opacity: 0.28, depthWrite: false })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.08;
    group.add(pad);
    this.padMat = pad.material;

    // Outline
    const outlineMat = new THREE.MeshBasicMaterial({ color: 0x55ff99 });
    const t = 0.35;
    for (const [w, l, x, z] of [
      [zone.w, t, 0, zone.l / 2],
      [zone.w, t, 0, -zone.l / 2],
      [t, zone.l, zone.w / 2, 0],
      [t, zone.l, -zone.w / 2, 0],
    ]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), outlineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.09, z);
      group.add(m);
    }

    // Tall beacon visible from across the map.
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 60, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x55ff99, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })
    );
    beacon.position.y = 30;
    group.add(beacon);
    this.beacon = beacon;

    scene.add(group);
    return group;
  }

  dispose(scene) {
    scene.remove(this.marker);
    this.marker.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
  }

  start() {
    this.state = 'active';
    this.elapsed = 0;
    this.stoppedTime = 0;
  }

  /** Current step: 'couple' (go get the trailer) or 'deliver'. */
  get stage() {
    return this.trailer && !this.trailer.attached && !this.cargoInZone(null) ? 'couple' : 'deliver';
  }

  /** Where the HUD arrow / distance should point right now. */
  target() {
    if (this.stage === 'couple') return { x: this.trailer.kx, z: this.trailer.kz };
    return { x: this.job.zone.x, z: this.job.zone.z };
  }

  distanceTo(phys) {
    const t = this.target();
    return Math.hypot(t.x - phys.x, t.z - phys.z);
  }

  /** Bearing to the current target relative to the truck heading (rad, + = to the right). */
  relativeBearing(phys) {
    const t = this.target();
    const d = phys.heading - Math.atan2(t.x - phys.x, t.z - phys.z);
    return Math.atan2(Math.sin(d), Math.cos(d));
  }

  pointInZone(x, z) {
    const zone = this.job.zone;
    const tol = 2.5;
    return Math.abs(x - zone.x) < zone.w / 2 + tol && Math.abs(z - zone.z) < zone.l / 2 + tol;
  }

  /** Is the cargo (trailer body, or the rigid truck itself) on the pad? */
  cargoInZone(phys) {
    if (this.trailer) return this.pointInZone(this.trailer.cx, this.trailer.cz);
    return phys ? this.pointInZone(phys.x, phys.z) : false;
  }

  /** Kept for the HUD: true when the cargo is on the pad. */
  inZone(phys) {
    return this.cargoInZone(phys);
  }

  /** Returns 'complete' | 'failed' | null when the state changes this frame. */
  update(phys, dt, time) {
    // Pulse the marker.
    this.padMat.opacity = 0.22 + Math.sin(time * 4) * 0.08;
    this.beacon.scale.x = this.beacon.scale.z = 1 + Math.sin(time * 3) * 0.08;

    if (this.state !== 'active') return null;
    this.elapsed += dt;

    if (phys.condition <= 0) {
      this.state = 'failed';
      this.result = { reason: 'The cargo was destroyed in collisions.' };
      return 'failed';
    }

    if (this.cargoInZone(phys) && Math.abs(phys.speed) < MISSION.stopSpeed) {
      this.stoppedTime += dt;
      if (this.stoppedTime >= MISSION.stopTime) {
        this.state = 'complete';
        this.result = this.computeReward(phys);
        return 'complete';
      }
    } else {
      this.stoppedTime = 0;
    }
    return null;
  }

  /** Progress 0..1 of the "hold still to unload" timer (for the HUD). */
  get unloadProgress() {
    return Math.min(1, this.stoppedTime / MISSION.stopTime);
  }

  computeReward(phys) {
    const damagePct = 100 - phys.condition;
    const damagePenalty = Math.round((this.basePay * damagePct) / 100);
    const timeBonus =
      this.elapsed < this.parTime
        ? Math.round((MISSION.timeBonusMax * (this.parTime - this.elapsed)) / this.parTime)
        : 0;
    const total = Math.max(0, this.basePay - damagePenalty + timeBonus);
    return { basePay: this.basePay, damagePenalty, timeBonus, total, time: this.elapsed, damagePct };
  }
}
