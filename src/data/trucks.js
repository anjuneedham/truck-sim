// Truck catalogue (fictional makes and models). Each entry overrides the base
// physics spec in config.js TRUCK, plus presentation data for the garage.
//
//   body:  'rigid'   - box truck, carries its own cargo body
//          'tractor' - semi tractor unit with a fifth wheel (tows trailers)
//   cab:   'cabover' | 'conventional' | 'aero'
//
// To add a truck: copy an entry, give it a unique id, adjust numbers. Prices
// and unlocks are used by the economy (see data/economy.js).

import { TRUCK } from '../config.js';

export const TRUCK_CATALOGUE = [
  {
    id: 'mercer-mbox9',
    make: 'Mercer',
    model: 'M-Box 9',
    description: 'Dependable rigid box truck. Easy to drive and cheap to run.',
    engineLabel: '7.7 L straight-6',
    body: 'rigid',
    cab: 'cabover',
    paint: 0xd8342c,
    accent: 0x2c6fb8,
    price: 0,
    fuelCapacity: 300, // litres
    fuelUse: 26, // litres / 100 km (used by the fuel system)
    spec: {},
  },
  {
    id: 'kestrel-c400',
    make: 'Kestrel',
    model: 'C400 Cabover',
    description: 'Short, nimble tractor unit. Tight turning for city work.',
    engineLabel: '10.8 L straight-6',
    body: 'tractor',
    cab: 'cabover',
    paint: 0x2e7dd1,
    accent: 0xf0f0f0,
    price: 18000,
    fuelCapacity: 400,
    fuelUse: 30,
    spec: {
      length: 6.2,
      wheelbase: 3.9,
      rearAxleOffset: -1.55,
      mass: 7600,
      peakTorque: 1000,
      maxSteerAngle: 0.6,
      maxLateralAccel: 5.3,
      brakeDecel: 6.1,
    },
  },
  {
    id: 'ridgeline-l560',
    make: 'Ridgeline',
    model: 'L560 Longnose',
    description: 'Classic long-hood hauler. Big torque for heavy loads.',
    engineLabel: '15 L straight-6',
    body: 'tractor',
    cab: 'conventional',
    paint: 0x1f1f24,
    accent: 0xd8a531,
    price: 42000,
    fuelCapacity: 700,
    fuelUse: 36,
    spec: {
      length: 7.6,
      wheelbase: 5.1,
      rearAxleOffset: -2.0,
      mass: 9400,
      peakTorque: 1450,
      maxSteerAngle: 0.52,
      maxLateralAccel: 4.8,
      brakeDecel: 5.6,
      yawResponse: 0.18,
    },
  },
  {
    id: 'vanta-aero480',
    make: 'Vanta',
    model: 'Aero 480',
    description: 'Streamlined long-distance tractor. Fast, frugal, huge tanks.',
    engineLabel: '12.9 L straight-6',
    body: 'tractor',
    cab: 'aero',
    paint: 0xe9e9ec,
    accent: 0x19a974,
    price: 65000,
    fuelCapacity: 900,
    fuelUse: 27,
    spec: {
      length: 6.8,
      wheelbase: 4.3,
      rearAxleOffset: -1.7,
      mass: 8200,
      peakTorque: 1250,
      dragCoeff: 2.4,
      governorSpeed: 26.4, // 95 km/h
      gearRatios: [7.0, 4.6, 3.1, 2.15, 1.5, 1.0],
      maxLateralAccel: 5.2,
      brakeDecel: 6.0,
    },
  },
];

/** Full physics spec for a catalogue entry (base TRUCK + overrides + width). */
export function buildSpec(entry) {
  return { ...TRUCK, ...entry.spec };
}

export function getTruck(id) {
  return TRUCK_CATALOGUE.find((t) => t.id === id) || TRUCK_CATALOGUE[0];
}

/**
 * Normalised 0..1 stat bars for the garage, derived from the physics so the
 * bars always match how the truck actually drives.
 */
export function truckStats(entry) {
  const s = buildSpec(entry);
  const clamp = (v) => Math.max(0.05, Math.min(1, v));
  const powerToWeight = (s.peakTorque * s.gearRatios[0]) / s.mass; // launch pull
  const handling = (s.maxLateralAccel / 5.5) * 0.6 + (s.maxSteerAngle / 0.6) * 0.25 + (4 / s.wheelbase) * 0.15;
  return {
    power: { bar: clamp(powerToWeight / 1.3), label: entry.engineLabel },
    topSpeed: { bar: clamp((s.governorSpeed * 3.6 - 60) / 40), label: `${Math.round(s.governorSpeed * 3.6)} km/h` },
    braking: { bar: clamp((s.brakeDecel - 4) / 2.5), label: `${s.brakeDecel.toFixed(1)} m/s²` },
    weight: { bar: clamp(s.mass / 10000), label: `${(s.mass / 1000).toFixed(1)} t` },
    handling: { bar: clamp(handling), label: `${(s.wheelbase).toFixed(1)} m wheelbase` },
    fuel: { bar: clamp(entry.fuelCapacity / 900), label: `${entry.fuelCapacity} L` },
  };
}

/** Fictional licence plate generated from the truck id (stable per truck). */
export function plateFor(id, serial = 0) {
  let h = 2166136261;
  for (const c of id + serial) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const L = (n) => letters[Math.abs(n) % letters.length];
  return `HR ${L(h)}${L(h >> 5)} ${String(Math.abs(h) % 9000 + 1000)}`;
}
