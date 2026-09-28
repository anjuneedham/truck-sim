// Arcade truck physics: a kinematic "bicycle" model driven by a simple
// engine + automatic gearbox. Deliberately predictable (priority: FUN + CONTROL):
//  - Engine torque curve through 6 auto-shifted gears; each shift briefly cuts
//    drive (the classic truck "pull, pause, pull"). Speed governor at top.
//  - Heavy mass + pedal ramps + air-brake build-up => noticeable inertia.
//  - Heading follows steering through a yaw-inertia lag; steering rate and
//    angle shrink with speed; a lateral grip cap makes the truck run wide
//    rather than snap round. Grass reduces grip and adds rolling resistance.
//  - Explicit Drive/Reverse gear; switching only allowed when (nearly) stopped.
//  - Collisions are resolved in sub-steps (no tunnelling through thin rails),
//    push the truck out, bleed/bounce speed and rotate it on glancing hits.

import { TRUCK, SURFACES } from '../config.js';
import { makeBox, setBoxTransform, boxOverlap } from './collision.js';

const G = 9.81;
const MAX_SUBSTEP_DIST = 0.15; // metres moved per collision sub-step

/** Linear interpolation over [[x, y], ...] points (clamped at the ends). */
function curve(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

export class TruckPhysics {
  /** @param {object} spec truck specification (defaults to config TRUCK) */
  constructor(spec = TRUCK) {
    this.spec = spec;
    this.steerSensitivity = 1; // player setting, scales steering rate
    this.surfaceAt = null; // optional (x, z) => 'road' | 'grass'
    this.box = makeBox(0, 0, spec.width / 2, spec.length / 2, 0);
    this.condition = 100; // % - simple cargo/truck condition
    this.collisionCount = 0;
    this._near = [];
    this.reset(0, 0, 0);
  }

  setSpec(spec) {
    this.spec = spec;
    this.box.halfW = spec.width / 2;
    this.box.halfL = spec.length / 2;
    setBoxTransform(this.box, this.x, this.z, this.heading);
  }

  reset(x, z, heading) {
    this.x = x;
    this.z = z;
    this.heading = heading; // radians; forward = (sin h, cos h)
    this.speed = 0; // signed m/s along forward (negative = moving backwards)
    this.steerAngle = 0; // current front wheel angle (rad), + = right
    this.gear = 'D'; // 'D' | 'R'
    this.gearIndex = 0; // 0-based forward gear
    this.shiftTimer = 0;
    this.engineRpm = this.spec.idleRpm;
    this.accel = 0; // longitudinal accel (for body pitch)
    this.latAccel = 0; // lateral accel (for body roll)
    this.yawRate = 0;
    this.throttle = 0; // smoothed pedal positions 0..1
    this.brake = 0;
    this.surface = 'road';
    this.lastImpact = 0; // m/s of the latest collision (read by game for FX)
    this.scraping = 0; // m/s of sliding contact this step (for scrape audio)
    this.shiftedThisStep = false;
    setBoxTransform(this.box, x, z, heading);
  }

  /** Returns true if the gear changed. */
  toggleGear() {
    if (Math.abs(this.speed) > this.spec.shiftMaxSpeed) return false;
    this.gear = this.gear === 'D' ? 'R' : 'D';
    this.gearIndex = 0;
    this.shiftTimer = 0;
    return true;
  }

  get speedKmh() {
    return Math.abs(this.speed) * 3.6;
  }

  /** Engine RPM normalised 0..1 (for audio / tacho). */
  get rpm() {
    const s = this.spec;
    return Math.max(0, Math.min(1, (this.engineRpm - s.idleRpm * 0.8) / (s.maxRpm - s.idleRpm * 0.8)));
  }

  /** Human-readable gear for the HUD, e.g. "3" or "R". */
  get gearLabel() {
    return this.gear === 'R' ? 'R' : String(this.gearIndex + 1);
  }

  currentRatio() {
    const s = this.spec;
    return this.gear === 'R' ? s.reverseRatio : s.gearRatios[this.gearIndex];
  }

  /** Engine rpm implied by road speed in the current gear. */
  wheelRpm(ratio) {
    const s = this.spec;
    return (Math.abs(this.speed) / (2 * Math.PI * s.wheelRadius)) * 60 * ratio * s.finalDrive;
  }

  updateGearbox(dt) {
    const s = this.spec;
    this.shiftedThisStep = false;
    if (this.shiftTimer > 0) {
      this.shiftTimer = Math.max(0, this.shiftTimer - dt);
      return;
    }
    if (this.gear !== 'D') return;
    const rpm = this.wheelRpm(s.gearRatios[this.gearIndex]);
    if (rpm > s.upshiftRpm && this.gearIndex < s.gearRatios.length - 1 && this.throttle > 0.1) {
      this.gearIndex++;
      this.shiftTimer = s.shiftTime;
      this.shiftedThisStep = true;
    } else if (rpm < s.downshiftRpm && this.gearIndex > 0) {
      this.gearIndex--;
      // Downshifts are quicker and don't need to interrupt drive for long.
      this.shiftTimer = s.shiftTime * 0.5;
      this.shiftedThisStep = true;
    }
  }

  /**
   * Advance the simulation.
   * @param {{steer:number, throttle:number, brake:number}} input
   * @param {number} dt seconds
   * @param {import('./collision.js').CollisionWorld} collisionWorld
   */
  step(input, dt, collisionWorld) {
    const T = this.spec;
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

    this.surface = this.surfaceAt ? this.surfaceAt(this.x, this.z) : 'road';
    const surf = SURFACES[this.surface] || SURFACES.road;

    const dir = this.gear === 'D' ? 1 : -1;
    const v = this.speed;
    const prevSpeed = v;

    // ---- Engine / gearbox ----
    this.updateGearbox(dt);
    const ratio = this.currentRatio();
    const roadRpm = this.wheelRpm(ratio);
    // Below idle the clutch slips: engine sits between idle and a launch rpm.
    const launchRpm = T.idleRpm + throttle * 500;
    const targetRpm = Math.min(T.maxRpm, Math.max(T.idleRpm, this.shiftTimer > 0 ? roadRpm : Math.max(roadRpm, launchRpm)));
    // Engine rpm eases toward target (audible rev drop on shifts).
    this.engineRpm += (targetRpm - this.engineRpm) * (1 - Math.exp(-dt * 10));

    let force = 0;
    const speedInGear = v * dir;
    if (throttle > 0 && this.shiftTimer === 0) {
      const rpmForTorque = Math.max(roadRpm, launchRpm);
      const limiter = rpmForTorque >= T.maxRpm ? 0 : 1;
      const torque = T.peakTorque * curve(T.torqueCurve, rpmForTorque);
      let f = (torque * ratio * T.finalDrive * T.drivetrainEfficiency) / T.wheelRadius;
      // Speed governor (and reverse limit) fade the drive out smoothly.
      const vlim = this.gear === 'D' ? T.governorSpeed : T.maxSpeedReverse;
      f *= Math.max(0, Math.min(1, (vlim - speedInGear) / 1.0));
      // Rolling against the gear direction: engine fights it as a brake would.
      if (speedInGear < 0) f = (T.peakTorque * ratio * T.finalDrive) / T.wheelRadius;
      force += dir * f * throttle * limiter;
    }
    // Drag + rolling resistance always oppose motion.
    const rolling = T.rollingResistance * surf.rolling;
    force -= T.dragCoeff * v * Math.abs(v) + Math.sign(v) * rolling * T.mass * G;

    let newSpeed = v + (force / T.mass) * dt;

    // Brakes / engine braking reduce |speed| without reversing direction.
    let decel = brake * T.brakeDecel;
    if (throttle === 0) decel += T.engineBrakeDecel + this.rpm * T.engineBrakeRpmDecel;
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
    const speedFrac = Math.min(1, Math.abs(this.speed) / T.governorSpeed);
    const steerLimit = T.maxSteerAngle * (1 - (1 - T.highSpeedSteerLimit) * speedFrac);
    const target = Math.max(-1, Math.min(1, input.steer)) * steerLimit;
    const sens = this.steerSensitivity;
    const rateScale = 1 - (1 - T.steerSpeedHighSpeedFactor) * speedFrac;
    const rate = (input.steer === 0 ? T.steerReturnSpeed : T.steerSpeed * rateScale) * sens;
    const diff = target - this.steerAngle;
    const maxStep = rate * dt;
    this.steerAngle += Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;

    // ---- Yaw (bicycle model around the rear axle, with inertia) ----
    const v2 = this.speed * this.speed;
    let curvature = Math.tan(this.steerAngle) / T.wheelbase / (1 + T.understeer * v2);
    // Grip limit: beyond it the truck simply runs wide (understeer) instead of
    // snapping round - predictable, and it teaches slowing for corners.
    const maxCurv = (T.maxLateralAccel * surf.grip) / Math.max(v2, 0.01);
    if (Math.abs(curvature) > maxCurv) curvature = Math.sign(curvature) * maxCurv;
    const targetYaw = -this.speed * curvature; // + steer (right) => heading decreases
    this.yawRate += (targetYaw - this.yawRate) * (1 - Math.exp(-dt / T.yawResponse));
    this.latAccel = this.speed * this.yawRate;

    // ---- Integrate + collide in sub-steps ----
    this.lastImpact = 0;
    this.scraping = 0;
    const steps = Math.max(1, Math.ceil((Math.abs(this.speed) * dt) / MAX_SUBSTEP_DIST));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.integrate(h);
      if (collisionWorld) this.resolveCollisions(collisionWorld);
    }
    if (this.lastImpact > 0.5) {
      this.collisionCount++;
      const over = this.lastImpact - T.damageThreshold;
      if (over > 0) this.condition = Math.max(0, this.condition - over * T.damagePerImpact);
    }
  }

  integrate(h) {
    // Move the rear axle along the heading, then rotate about it: the rear of
    // the truck tracks inside the front on turns like a real truck.
    const ra = this.spec.rearAxleOffset;
    let sinH = Math.sin(this.heading);
    let cosH = Math.cos(this.heading);
    const rx = this.x + sinH * ra + sinH * this.speed * h;
    const rz = this.z + cosH * ra + cosH * this.speed * h;
    this.heading += this.yawRate * h;
    sinH = Math.sin(this.heading);
    cosH = Math.cos(this.heading);
    this.x = rx - sinH * ra;
    this.z = rz - cosH * ra;
  }

  resolveCollisions(world) {
    const T = this.spec;
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

        // Velocity response: component of motion into the obstacle.
        const fx = Math.sin(this.heading);
        const fz = Math.cos(this.heading);
        const dot = fx * res.nx + fz * res.nz;
        const into = -dot * this.speed; // >0 when moving into it
        if (into > 0.05) {
          const facing = Math.abs(dot); // 1 = head-on, 0 = scraping
          // Glancing hits twist the truck around the contact corner.
          const lever = this.contactLever(res.nx, res.nz);
          const twist = Math.max(-0.2, Math.min(0.2, T.impactYaw * into * lever));
          this.heading += twist;
          this.yawRate *= 0.5;
          // Head-on: bounce back slightly. Glancing: keep sliding but scrub speed.
          if (facing > 0.7) this.speed = -this.speed * T.restitution;
          else {
            this.scraping = Math.max(this.scraping, Math.abs(this.speed));
            this.speed *= 1 - 0.6 * facing - 0.05;
          }
          if (into > this.lastImpact) this.lastImpact = into;
        }
        setBoxTransform(this.box, this.x, this.z, this.heading);
      }
      if (!hit) break;
    }
  }

  /**
   * Normalised torque arm of a push along (nx, nz) applied at the truck corner
   * that is buried deepest in the obstacle. Positive => heading increases.
   */
  contactLever(nx, nz) {
    const b = this.box;
    let best = Infinity;
    let rx = 0;
    let rz = 0;
    for (const sw of [-1, 1]) {
      for (const sl of [-1, 1]) {
        const cx = b.ax[0] * b.halfW * sw + b.az[0] * b.halfL * sl;
        const cz = b.ax[1] * b.halfW * sw + b.az[1] * b.halfL * sl;
        const d = cx * nx + cz * nz;
        if (d < best) {
          best = d;
          rx = cx;
          rz = cz;
        }
      }
    }
    return (rz * nx - rx * nz) / b.radius;
  }
}
