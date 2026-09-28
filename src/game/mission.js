// Single delivery mission: drive from the depot to a destination zone and stop.
//
// States:  offer -> active -> complete
//                        \-> failed (only if the truck's condition hits 0%)
//
// Also owns the destination marker visuals (zone pad + beacon).

import * as THREE from 'three';
import { MISSION } from '../config.js';
import { SPAWN } from './mapData.js';

export class Mission {
  constructor(scene, job) {
    this.job = job;
    this.state = 'offer';
    this.elapsed = 0;
    this.stoppedTime = 0;
    this.result = null;

    // Route estimate: straight line * 1.35 approximates following the road grid.
    const straight = Math.hypot(job.zone.x - SPAWN.x, job.zone.z - SPAWN.z);
    this.routeKm = (straight * 1.35) / 1000;
    this.basePay = Math.round((MISSION.basePay + this.routeKm * MISSION.payPerKm) / 10) * 10;
    // Par time: average 35 km/h on the route.
    this.parTime = (this.routeKm / 35) * 3600;

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

  distanceTo(phys) {
    return Math.hypot(this.job.zone.x - phys.x, this.job.zone.z - phys.z);
  }

  /** Bearing to the destination relative to the truck heading (rad, + = to the right). */
  relativeBearing(phys) {
    const dx = this.job.zone.x - phys.x;
    const dz = this.job.zone.z - phys.z;
    const target = Math.atan2(dx, dz);
    const d = phys.heading - target;
    return Math.atan2(Math.sin(d), Math.cos(d));
  }

  /** Truck counts as "in" when its centre is on (or within 2.5 m of) the pad. */
  inZone(phys) {
    const z = this.job.zone;
    const tol = 2.5;
    return Math.abs(phys.x - z.x) < z.w / 2 + tol && Math.abs(phys.z - z.z) < z.l / 2 + tol;
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

    if (this.inZone(phys) && Math.abs(phys.speed) < MISSION.stopSpeed) {
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
