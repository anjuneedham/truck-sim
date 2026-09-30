// One delivery job from pickup facility to drop-off facility.
//
// States:  active -> complete
//                 \-> failed (cargo destroyed, or job abandoned)
//
// Stages while active:
//   rigid truck:  'load'   drive to the pickup loading zone and stop
//   tractor:      'couple' reverse under the trailer parked at the pickup
//   both:         'deliver' get the cargo (trailer / rigid truck) onto the drop pad
//
// The delivery timer (for the time bonus) starts once the cargo is on board.
// Also owns the pickup + drop-off marker visuals.

import * as THREE from 'three';
import { MISSION } from '../config.js';
import { getFacility } from './mapData.js';
import { getCargo } from '../data/cargo.js';
import { computeReward, jobPay, parTimeFor } from './jobs.js';

const DROP_COLOR = 0x55ff99;
const PICKUP_COLOR = 0xffb62e;

export class Mission {
  /**
   * @param {THREE.Scene} scene
   * @param {object} job from jobs.js
   * @param {import('./trailerPhysics.js').TrailerPhysics|null} trailer
   */
  constructor(scene, job, trailer = null) {
    this.scene = scene;
    this.job = job;
    this.trailer = trailer;
    this.cargo = getCargo(job.cargo);
    this.from = getFacility(job.from);
    this.to = getFacility(job.to);
    this.state = 'active';
    this.loaded = false; // rigid trucks: cargo loaded at the pickup
    this.elapsed = 0; // delivery time (starts when the cargo is on board)
    this.stoppedTime = 0;
    this.loadTime = 0;
    this.result = null;

    this.routeKm = job.km;
    this.basePay = jobPay(job, !!trailer);
    this.parTime = parTimeFor(job, !!trailer);

    this.dropMarker = this.buildZoneMarker(this.to.dropZone, DROP_COLOR, 60);
    this.pickupMarker = trailer ? null : this.buildZoneMarker(this.from.loadZone, PICKUP_COLOR, 30);
    this.trailerBeacon = trailer ? this.buildBeacon(PICKUP_COLOR, 30) : null;
  }

  buildZoneMarker(zone, color, beaconHeight) {
    const group = new THREE.Group();
    group.position.set(zone.x, 0, zone.z);
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(zone.w, zone.l),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.08;
    group.add(pad);
    const outlineMat = new THREE.MeshBasicMaterial({ color });
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
    const beacon = this.makeBeaconMesh(color, beaconHeight);
    group.add(beacon);
    group.userData.pad = pad;
    group.userData.beacon = beacon;
    this.scene.add(group);
    return group;
  }

  makeBeaconMesh(color, height) {
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, height, 10, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })
    );
    beacon.position.y = height / 2;
    return beacon;
  }

  buildBeacon(color, height) {
    const g = new THREE.Group();
    g.add(this.makeBeaconMesh(color, height));
    this.scene.add(g);
    return g;
  }

  dispose() {
    for (const m of [this.dropMarker, this.pickupMarker, this.trailerBeacon]) {
      if (!m) continue;
      this.scene.remove(m);
      m.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          o.material.dispose();
        }
      });
    }
  }

  /** Current step: 'load' | 'couple' | 'deliver'. */
  get stage() {
    if (this.trailer) return !this.trailer.attached && !this.cargoInZone(null) ? 'couple' : 'deliver';
    return this.loaded ? 'deliver' : 'load';
  }

  /** Human-readable objective for the HUD. */
  get objective() {
    switch (this.stage) {
      case 'load':
        return `Load ${this.cargo.name.toLowerCase()} at ${this.from.name}`;
      case 'couple':
        return `Couple the ${this.trailer.type.name.toLowerCase()} at ${this.from.name}`;
      default:
        return `Deliver ${this.cargo.name.toLowerCase()} to ${this.to.name}`;
    }
  }

  /** Where the HUD arrow / distance should point right now. */
  target() {
    const st = this.stage;
    if (st === 'couple') return { x: this.trailer.kx, z: this.trailer.kz };
    if (st === 'load') return { x: this.from.loadZone.x, z: this.from.loadZone.z };
    return { x: this.to.dropZone.x, z: this.to.dropZone.z };
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

  static pointInZone(zone, x, z, tol = 2.5) {
    return Math.abs(x - zone.x) < zone.w / 2 + tol && Math.abs(z - zone.z) < zone.l / 2 + tol;
  }

  /** Is the cargo (trailer body, or the loaded rigid truck) on the drop pad? */
  cargoInZone(phys) {
    const zone = this.to.dropZone;
    if (this.trailer) return Mission.pointInZone(zone, this.trailer.cx, this.trailer.cz);
    return !!phys && this.loaded && Mission.pointInZone(zone, phys.x, phys.z);
  }

  /** For the HUD: is the player on the pad that matters right now? */
  inZone(phys) {
    if (this.stage === 'load') return Mission.pointInZone(this.from.loadZone, phys.x, phys.z);
    return this.cargoInZone(phys);
  }

  /**
   * Advance the mission.
   * @returns {'complete'|'failed'|'loaded'|null} event this frame
   */
  update(phys, dt, time) {
    for (const m of [this.dropMarker, this.pickupMarker]) {
      if (!m) continue;
      m.userData.pad.material.opacity = 0.22 + Math.sin(time * 4) * 0.08;
      m.userData.beacon.scale.x = m.userData.beacon.scale.z = 1 + Math.sin(time * 3) * 0.08;
    }
    if (this.trailerBeacon) {
      this.trailerBeacon.visible = this.stage === 'couple';
      this.trailerBeacon.position.set(this.trailer.cx, 0, this.trailer.cz);
    }
    if (this.pickupMarker) this.pickupMarker.visible = this.stage === 'load';

    if (this.state !== 'active') return null;
    if (this.stage === 'deliver') this.elapsed += dt;

    if (phys.condition <= 0) {
      return this.fail('The cargo was destroyed in collisions.');
    }

    const stopped = Math.abs(phys.speed) < MISSION.stopSpeed;
    if (this.stage === 'load') {
      if (stopped && Mission.pointInZone(this.from.loadZone, phys.x, phys.z)) {
        this.loadTime += dt;
        if (this.loadTime >= MISSION.loadTime) {
          this.loaded = true;
          this.loadTime = 0;
          return 'loaded';
        }
      } else {
        this.loadTime = 0;
      }
      return null;
    }

    if (this.cargoInZone(phys) && stopped) {
      this.stoppedTime += dt;
      if (this.stoppedTime >= MISSION.stopTime) {
        this.state = 'complete';
        this.result = computeReward(this.job, {
          withTrailer: !!this.trailer,
          time: this.elapsed,
          damagePct: 100 - phys.condition,
        });
        return 'complete';
      }
    } else {
      this.stoppedTime = 0;
    }
    return null;
  }

  fail(reason) {
    this.state = 'failed';
    this.result = { reason };
    return 'failed';
  }

  /** Progress 0..1 of the current "hold still" timer (loading or unloading). */
  get unloadProgress() {
    if (this.stage === 'load') return Math.min(1, this.loadTime / MISSION.loadTime);
    return Math.min(1, this.stoppedTime / MISSION.stopTime);
  }
}
