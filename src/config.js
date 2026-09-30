// Central tuning values. Keep gameplay numbers here so driving feel can be
// iterated on without digging through system code.

export const TRUCK = {
  // Dimensions (metres). The collision box matches the visual body.
  length: 9.0,
  width: 2.55,
  wheelbase: 5.2, // front axle -> rear axle
  rearAxleOffset: -2.6, // rear axle position relative to body centre (along forward axis)
  wheelRadius: 0.52,

  // Mass
  mass: 9000, // kg

  // Engine + gearbox. Tractive force = torque(rpm) * gear * finalDrive * eff / wheelRadius.
  idleRpm: 650,
  maxRpm: 2200, // rev limiter
  peakTorque: 1000, // Nm (scaled for the arcade mass)
  // Torque curve as fraction of peak at [rpm, fraction] points (linear between).
  torqueCurve: [[600, 0.7], [1000, 1.0], [1500, 1.0], [1900, 0.85], [2200, 0.6]],
  gearRatios: [7.0, 4.6, 3.1, 2.15, 1.5, 1.05],
  reverseRatio: 6.6,
  finalDrive: 4.1,
  drivetrainEfficiency: 0.9,
  upshiftRpm: 1850,
  downshiftRpm: 1050,
  shiftTime: 0.35, // s of no drive force during a gear change
  governorSpeed: 25, // m/s (90 km/h) speed limiter
  maxSpeedReverse: 5.5, // m/s (~20 km/h)

  // Pedals and brakes
  throttleRise: 3.5, // throttle response per second
  brakeRise: 3.0, // brake pressure build-up per second (air brakes aren't instant)
  brakeDecel: 5.8, // m/s^2 at full brake (loaded truck, not a car)
  engineBrakeDecel: 0.35, // m/s^2 base coasting drag in gear
  engineBrakeRpmDecel: 0.5, // extra m/s^2 at max rpm (engine braking grows with rpm)

  // Resistance
  rollingResistance: 0.012, // * g on tarmac
  dragCoeff: 3.2, // N per (m/s)^2

  // Steering
  maxSteerAngle: 0.56, // rad (~32 deg) -> ~8.4m turning radius at low speed
  steerSpeed: 1.6, // rad/s the wheels turn towards the target (at standstill)
  steerSpeedHighSpeedFactor: 0.45, // steering rate multiplier at top speed (calmer on highways)
  steerReturnSpeed: 2.4, // rad/s the wheels self-centre when released
  highSpeedSteerLimit: 0.35, // fraction of max steer left at top speed
  understeer: 0.0012, // curvature reduction factor * v^2 (adds weight at speed)
  maxLateralAccel: 5.0, // m/s^2 grip limit; caps how hard the truck can turn at speed
  yawResponse: 0.14, // s time constant for the body to follow the steering (yaw inertia)

  // Gear change only allowed below this speed (m/s)
  shiftMaxSpeed: 1.5,

  // Collisions
  restitution: 0.18, // fraction of speed bounced back on head-on hits
  impactYaw: 0.035, // how much glancing hits rotate the truck
  damagePerImpact: 2.2, // % condition lost per m/s of impact speed above threshold
  damageThreshold: 2.5, // m/s impacts below this are free
};

/** Driving surfaces: grip and resistance multipliers + suspension bumpiness. */
export const SURFACES = {
  road: { rolling: 1, grip: 1, bump: 0 },
  grass: { rolling: 4.5, grip: 0.7, bump: 1 },
};

/** Visual suspension (body motion only; physics stays planar). */
export const SUSPENSION = {
  stiffness: 55, // spring rate (higher = stiffer, quicker)
  damping: 9, // lower = more bounce/overshoot
  pitchPerAccel: 0.009, // rad of pitch per m/s^2
  rollPerLat: 0.011, // rad of roll per m/s^2 lateral
  maxPitch: 0.06,
  maxRoll: 0.09,
  bumpStrength: 0.9, // grass bumpiness
};

export const CAMERA = {
  // Presets cycled with the camera button. 'hood' sits on the cab looking ahead.
  presets: [
    { name: 'Chase', distance: 15, height: 6.8, lookHeight: 1.2, lookAhead: 8 },
    { name: 'Far', distance: 22, height: 9.5, lookHeight: 1.5, lookAhead: 9 },
    { name: 'Close', distance: 10, height: 4.5, lookHeight: 2.4, lookAhead: 5 },
    { name: 'Cab', hood: true, height: 3.3, forward: 3.2, lookAhead: 30, lookHeight: 2.2 },
  ],
  positionLag: 4.5, // higher = snappier
  yawLag: 3.0,
  heightLag: 3.0,
  fov: 60,
  fovPerSpeed: 0.35, // extra degrees of FOV per m/s (sense of speed)
  maxExtraFov: 9,
  turnLookAhead: 1.6, // how far the aim point swings into a turn (m per rad/s * m/s)
  zoomMin: 0.65, // pinch-zoom multiplier range on follow distance
  zoomMax: 1.7,
};

export const MISSION = {
  stopSpeed: 1.0, // m/s: must be slower than this inside a zone
  stopTime: 1.2, // seconds stationary on the drop pad to unload
  loadTime: 2.0, // seconds stationary in the loading zone (rigid trucks)
  coupleDistance: 1.0, // m between fifth wheel and kingpin to allow coupling
  coupleAngle: 0.35, // rad max misalignment for coupling
  coupleSpeed: 1.5, // m/s max speed for coupling/uncoupling
  // (Pay, bonuses and penalties live in data/economy.js.)
};

export const WORLD = {
  halfSize: 330, // play area is [-halfSize, halfSize] on X and Z
  roadWidth: 16,
};

// Graphics presets selected in Settings.
export const QUALITY = {
  low: { pixelRatio: 0.8, shadows: false, shadowMap: 0, fogFar: 320 },
  medium: { pixelRatio: 1.25, shadows: true, shadowMap: 1024, fogFar: 450 },
  high: { pixelRatio: 2.0, shadows: true, shadowMap: 2048, fogFar: 600 },
};
