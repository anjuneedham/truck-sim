// Central tuning values. Keep gameplay numbers here so driving feel can be
// iterated on without digging through system code.

export const TRUCK = {
  // Dimensions (metres). The collision box matches the visual body.
  length: 9.0,
  width: 2.55,
  wheelbase: 5.2, // front axle -> rear axle
  rearAxleOffset: -2.6, // rear axle position relative to body centre (along forward axis)

  // Mass / forces
  mass: 9000, // kg
  engineForce: 26000, // N at standstill, tapers towards top speed
  maxSpeedForward: 26, // m/s  (~94 km/h)
  maxSpeedReverse: 5.5, // m/s (~20 km/h)
  brakeDecel: 5.8, // m/s^2 at full brake (loaded truck, not a car)
  brakeRise: 3.0, // brake pressure build-up per second (air brakes aren't instant)
  throttleRise: 3.5, // throttle response per second
  engineBrakeDecel: 0.6, // m/s^2 when coasting in gear
  rollingResistance: 0.012, // * g
  dragCoeff: 3.2, // N per (m/s)^2

  // Steering
  maxSteerAngle: 0.56, // rad (~32 deg) -> ~8.4m turning radius at low speed
  steerSpeed: 1.6, // rad/s the wheels turn towards the target
  steerReturnSpeed: 2.4, // rad/s the wheels self-centre when released
  highSpeedSteerLimit: 0.35, // fraction of max steer left at top speed
  understeer: 0.0012, // curvature reduction factor * v^2 (adds weight at speed)
  maxLateralAccel: 5.0, // m/s^2 grip limit; caps how hard the truck can turn at speed

  // Gear change only allowed below this speed (m/s)
  shiftMaxSpeed: 1.5,

  // Collisions
  restitution: 0.18, // fraction of speed bounced back on head-on hits
  damagePerImpact: 2.2, // % condition lost per m/s of impact speed above threshold
  damageThreshold: 2.5, // m/s impacts below this are free
};

export const CAMERA = {
  // Preset follow distances cycled with the camera button.
  presets: [
    { distance: 15, height: 6.5, lookHeight: 2.0, lookAhead: 7 },
    { distance: 22, height: 9.5, lookHeight: 1.5, lookAhead: 9 },
    { distance: 10, height: 4.5, lookHeight: 2.4, lookAhead: 5 },
  ],
  positionLag: 4.5, // higher = snappier
  yawLag: 3.0,
  fov: 60,
};

export const MISSION = {
  stopSpeed: 1.0, // m/s: must be slower than this inside the zone
  stopTime: 1.2, // seconds stationary in zone to unload
  payPerKm: 900, // $ per km of route
  basePay: 250,
  timeBonusMax: 300,
};

export const WORLD = {
  halfSize: 330, // play area is [-halfSize, halfSize] on X and Z
  roadWidth: 16,
};

// Graphics presets selected in Settings.
export const QUALITY = {
  low: { pixelRatio: 0.75, shadows: false, fogFar: 260, antialias: false },
  medium: { pixelRatio: 1.0, shadows: false, fogFar: 380, antialias: false },
  high: { pixelRatio: 2.0, shadows: true, fogFar: 520, antialias: true },
};
