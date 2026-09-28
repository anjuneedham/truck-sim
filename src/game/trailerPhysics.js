// Semi-trailer kinematics.
//
// The trailer is defined by its kingpin position K and heading. When coupled,
// K is pinned to the truck's fifth wheel. The tandem axle A (kingpinToAxle
// behind K) can only roll along the trailer's heading, which is modelled by
// dragging the axle behind the kingpin like a rod ("tractrix"):
//     heading_new = direction from A_old to K_new
// This single rule gives realistic off-tracking in turns and the classic
// unstable, counter-steering behaviour when reversing - including jackknifing,
// which is limited by a maximum articulation angle.

import { makeBox, setBoxTransform, boxOverlap } from './collision.js';

export const MAX_ARTICULATION = 1.35; // rad (~77 deg) - physical jackknife stop
export const JACKKNIFE_WARN = 1.0; // rad (~57 deg) - HUD warning threshold
const PARKED_FRONT_CLEAR = 2.4; // m behind kingpin where the parked collider starts

export class TrailerPhysics {
  /**
   * @param {object} type trailer type from data/trailers.js
   * @param {number} cargoMass kg of cargo loaded
   */
  constructor(type, cargoMass = 0) {
    this.type = type;
    this.cargoMass = cargoMass;
    this.kx = 0; // kingpin
    this.kz = 0;
    this.heading = 0;
    this.attached = false;
    this.condition = 100;
    // Full body box (used when coupled) and shortened box (when parked, so a
    // tractor can reverse under the front overhang to couple).
    this.box = makeBox(0, 0, type.width / 2, type.length / 2, 0);
    const parkedLen = type.length - type.kingpin - PARKED_FRONT_CLEAR;
    this.parkedBox = makeBox(0, 0, type.width / 2, parkedLen / 2, 0);
    this.parkedBox.height = type.height;
    this._near = [];
  }

  get mass() {
    return this.type.emptyMass + this.cargoMass;
  }

  /** Centre of the full trailer body. */
  get cx() {
    return this.kx - Math.sin(this.heading) * (this.type.length / 2 - this.type.kingpin);
  }

  get cz() {
    return this.kz - Math.cos(this.heading) * (this.type.length / 2 - this.type.kingpin);
  }

  /** Place the trailer with its kingpin at (x, z). */
  place(kx, kz, heading) {
    this.kx = kx;
    this.kz = kz;
    this.heading = heading;
    this.updateBoxes();
  }

  updateBoxes() {
    setBoxTransform(this.box, this.cx, this.cz, this.heading);
    const back = PARKED_FRONT_CLEAR + this.parkedBox.halfL;
    setBoxTransform(
      this.parkedBox,
      this.kx - Math.sin(this.heading) * back,
      this.kz - Math.cos(this.heading) * back,
      this.heading
    );
  }

  /**
   * Move the kingpin to the truck's fifth wheel and drag the axle behind it.
   * @returns {number} articulation angle (truck heading - trailer heading)
   */
  follow(hx, hz, truckHeading) {
    const L = this.type.kingpinToAxle;
    const ax = this.kx - Math.sin(this.heading) * L;
    const az = this.kz - Math.cos(this.heading) * L;
    const dx = hx - ax;
    const dz = hz - az;
    if (dx * dx + dz * dz > 1e-8) this.heading = Math.atan2(dx, dz);
    this.kx = hx;
    this.kz = hz;
    // Jackknife stop: the trailer front physically hits the cab.
    let art = wrapAngle(truckHeading - this.heading);
    this.jackknifed = false;
    if (Math.abs(art) > MAX_ARTICULATION) {
      art = Math.sign(art) * MAX_ARTICULATION;
      this.heading = truckHeading - art;
      this.jackknifed = true;
    }
    this.updateBoxes();
    return art;
  }

  /**
   * Resolve overlaps of the (coupled) trailer against the world.
   * @returns {{px:number, pz:number, into:number} | null} total push to apply to the rig
   *   and the trailer's speed into the obstacle (m/s) given the rig speed.
   */
  collide(world, rigSpeed, truckHeading) {
    const near = world.query(this.box.x, this.box.z, this.box.radius + 2, this._near);
    let px = 0;
    let pz = 0;
    let into = 0;
    // Trailer moves along its own heading at roughly rig speed * cos(articulation).
    const art = wrapAngle(truckHeading - this.heading);
    const vt = rigSpeed * Math.cos(art);
    for (const other of near) {
      if (other === this.parkedBox) continue;
      const res = boxOverlap(this.box, other);
      if (!res) continue;
      px += res.nx * res.depth;
      pz += res.nz * res.depth;
      this.kx += res.nx * res.depth;
      this.kz += res.nz * res.depth;
      this.updateBoxes();
      const i = -(Math.sin(this.heading) * res.nx + Math.cos(this.heading) * res.nz) * vt;
      if (i > into) into = i;
    }
    return px || pz ? { px, pz, into } : null;
  }
}

export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
