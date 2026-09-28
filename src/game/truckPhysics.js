// Arcade truck physics: a kinematic "bicycle" model with longitudinal forces.
// Deliberately simple and predictable (priority: FUN + CONTROL):
//  - Speed changes from engine force, brakes, rolling resistance and drag,
//    divided by a heavy mass => noticeable inertia.
//  - Heading changes from steering angle and wheelbase (real turning radius),
//    with speed-sensitive steering and mild understeer at speed.
//  - Explicit Drive/Reverse gear; switching only allowed when (nearly) stopped.
//  - Collisions push the truck out of static boxes and bleed/bounce speed.

import { TRUCK } from '../config.js';
import { makeBox, setBoxTransform, boxOverlap } from './collision.js';

const G = 9.81;

export class TruckPhysics {
  constructor() {
    this.x = 0;
    this.z = 0;
    this.heading = 0; // radians; forward = (sin h, cos h)
    this.speed = 0; // signed m/s along forward (negative = moving backwards)
    this.steerAngle = 0; // current front wheel angle (rad), + = right
    this.gear = 'D'; // 'D' | 'R'
    this.accel = 0; // longitudinal accel (for body pitch / audio)
    this.latAccel = 0; // lateral accel (for body roll)
    this.yawRate = 0;
    this.throttle = 0; // smoothed pedal positions 0..1
    this.brake = 0;
    this.condition = 100; // % - simple cargo/truck condition
    this.box = makeBox(0, 0, TRUCK.width / 2, TRUCK.length / 2, 0);
    this.lastImpact = 0; // m/s of the latest collision (read by game for FX)
    this.collisionCount = 0;
    this._near = [];
  }

  reset(x, z, heading) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.steerAngle = 0;
    this.gear = 'D';
    this.accel = 0;
    this.latAccel = 0;
    this.yawRate = 0;
    this.throttle = 0;
    this.brake = 0;
    setBoxTransform(this.box, x, z, heading);
  }

  /** Returns true if the gear changed. */
  toggleGear() {
    if (Math.abs(this.speed) > TRUCK.shiftMaxSpeed) return false;
    this.gear = this.gear === 'D' ? 'R' : 'D';
    return true;
  }

  get speedKmh() {
    return Math.abs(this.speed) * 3.6;
  }

  /** Engine RPM normalised 0..1 with a fake 6-speed gearbox, for audio/HUD. */
  get rpm() {
    const v = Math.abs(this.speed);
    if (this.gear === 'R') return Math.min(1, 0.15 + v / TRUCK.maxSpeedReverse * 0.75);
    const gearTop = [0, 4, 8, 12.5, 17, 21.5, 27];
    let g = 1;
    while (g < 6 && v > gearTop[g]) g++;
    const lo = gearTop[g - 1];
    const hi = gearTop[g];
    return 0.15 + Math.min(1, (v - lo) / (hi - lo)) * 0.8;
  }

  /**
   * Advance the simulation.
   * @param {{steer:number, throttle:number, brake:number}} input
   * @param {number} dt seconds
   * @param {import('./collision.js').CollisionWorld} collisionWorld
   */
  step(input, dt, collisionWorld) {
    const T = TRUCK;
    // Pedals ramp rather than switch instantly: gives weight and makes
    // digital (button/key) input feel analogue. Releasing is quicker.
    const ramp = (cur, target, rise) => {
      const rate = target > cur ? rise : rise * 2.5;
      const d = target - cur;
      return Math.abs(d) <= rate * dt ? target : cur + Math.sign(d) * rate * dt;
    };
    this.throttle = ramp(this.throttle, input.throttle, T.throttleRise);
    this.brake = ramp(this.brake, input.brake, T.brakeRise);
    const throttle = this.throttle;
    const brake = this.brake;

    const dir = this.gear === 'D' ? 1 : -1;
    const vmax = this.gear === 'D' ? T.maxSpeedForward : T.maxSpeedReverse;
    const v = this.speed;
    const prevSpeed = v;

    // ---- Longitudinal ----
    let force = 0;
    // Engine: drives in gear direction, tapering to zero at top speed.
    const speedInGear = v * dir;
    if (throttle > 0) {
      const taper = Math.max(0, 1 - Math.max(0, speedInGear) / vmax);
      // If the truck is rolling against the gear direction, the engine fights it hard.
      const f = speedInGear < 0 ? T.engineForce * 1.3 : T.engineForce * taper;
      force += dir * f * throttle;
    }
    // Drag + rolling resistance always oppose motion.
    const resist = T.dragCoeff * v * Math.abs(v) + Math.sign(v) * T.rollingResistance * T.mass * G;
    force -= resist;

    let newSpeed = v + (force / T.mass) * dt;

    // Brakes / engine braking reduce |speed| without reversing direction.
    let decel = brake * T.brakeDecel;
    if (throttle === 0) decel += T.engineBrakeDecel;
    if (decel > 0) {
      const dv = decel * dt;
      if (Math.abs(newSpeed) <= dv) newSpeed = 0;
      else newSpeed -= Math.sign(newSpeed) * dv;
    }
    // Hold still when parked with brake / no throttle (avoid creeping).
    if (throttle === 0 && Math.abs(newSpeed) < 0.05) newSpeed = 0;

    this.speed = newSpeed;
    this.accel = (newSpeed - prevSpeed) / dt;

    // ---- Steering ----
    const speedFrac = Math.min(1, Math.abs(this.speed) / T.maxSpeedForward);
    const steerLimit = T.maxSteerAngle * (1 - (1 - T.highSpeedSteerLimit) * speedFrac);
    const target = input.steer * steerLimit;
    const rate = input.steer === 0 ? T.steerReturnSpeed : T.steerSpeed;
    const diff = target - this.steerAngle;
    const maxStep = rate * dt;
    this.steerAngle += Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;

    // ---- Heading (bicycle model around the rear axle) ----
    const v2 = this.speed * this.speed;
    let curvature = Math.tan(this.steerAngle) / T.wheelbase / (1 + T.understeer * v2);
    // Grip limit: beyond it the truck simply runs wide (understeer) instead of
    // snapping round - predictable, and it teaches slowing for corners.
    const maxCurv = T.maxLateralAccel / Math.max(v2, 0.01);
    if (Math.abs(curvature) > maxCurv) curvature = Math.sign(curvature) * maxCurv;
    const yawRate = -this.speed * curvature; // + steer (right) => heading decreases
    this.yawRate = yawRate;
    this.latAccel = this.speed * yawRate;

    // Integrate around the rear axle so the rear of the truck tracks like a real truck.
    const ra = T.rearAxleOffset;
    let sinH = Math.sin(this.heading);
    let cosH = Math.cos(this.heading);
    let rx = this.x + sinH * ra;
    let rz = this.z + cosH * ra;
    rx += sinH * this.speed * dt;
    rz += cosH * this.speed * dt;
    this.heading += yawRate * dt;
    sinH = Math.sin(this.heading);
    cosH = Math.cos(this.heading);
    this.x = rx - sinH * ra;
    this.z = rz - cosH * ra;

    // ---- Collisions ----
    this.lastImpact = 0;
    if (collisionWorld) this.resolveCollisions(collisionWorld);
  }

  resolveCollisions(world) {
    setBoxTransform(this.box, this.x, this.z, this.heading);
    const near = world.query(this.x, this.z, this.box.radius + 2, this._near);
    // A couple of passes resolve being wedged between two objects.
    for (let pass = 0; pass < 3; pass++) {
      let hit = false;
      for (const other of near) {
        const res = boxOverlap(this.box, other);
        if (!res) continue;
        hit = true;
        this.x += res.nx * res.depth;
        this.z += res.nz * res.depth;
        setBoxTransform(this.box, this.x, this.z, this.heading);

        // Velocity response: component of motion into the obstacle.
        const fx = Math.sin(this.heading);
        const fz = Math.cos(this.heading);
        const into = -(fx * res.nx + fz * res.nz) * this.speed; // >0 when moving into it
        if (into > 0.05) {
          const facing = Math.abs(fx * res.nx + fz * res.nz); // 1 = head-on, 0 = scraping
          const impactSpeed = into;
          // Head-on: bounce back slightly. Glancing: keep sliding but scrub speed.
          if (facing > 0.7) this.speed = -this.speed * TRUCK.restitution;
          else this.speed *= 1 - 0.6 * facing - 0.1;
          if (impactSpeed > this.lastImpact) this.lastImpact = impactSpeed;
        }
      }
      if (!hit) break;
    }
    if (this.lastImpact > 0.5) {
      this.collisionCount++;
      const over = this.lastImpact - TRUCK.damageThreshold;
      if (over > 0) this.condition = Math.max(0, this.condition - over * TRUCK.damagePerImpact);
    }
  }
}
