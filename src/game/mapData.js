// Layout data for the small test map. Pure data + small helpers, no three.js.
//
//   Ring road (rounded corners) around a 400 x 400 m area, split by a central
//   cross => one 4-way intersection, four T-junctions, four sweeping curves.
//   Depot (start) and three delivery sites sit in lots next to the roads.

const RING = 200; // ring road centreline distance from origin
const CORNER_R = 40; // ring corner radius

function ringPolyline() {
  const pts = [];
  const s = RING - CORNER_R;
  // Corners in order going around: (+,+) -> (+,-) -> (-,-) -> (-,+)
  const corners = [
    { cx: s, cz: s, a0: 0 }, // arc from +x side towards +z side
    { cx: -s, cz: s, a0: Math.PI / 2 },
    { cx: -s, cz: -s, a0: Math.PI },
    { cx: s, cz: -s, a0: (3 * Math.PI) / 2 },
  ];
  const arcSteps = 10;
  for (const c of corners) {
    for (let i = 0; i <= arcSteps; i++) {
      const a = c.a0 + (i / arcSteps) * (Math.PI / 2);
      pts.push([c.cx + Math.cos(a) * CORNER_R, c.cz + Math.sin(a) * CORNER_R]);
    }
  }
  return pts;
}

/** Road polylines as arrays of [x, z]. `closed` roads loop back to the start. */
export const ROADS = [
  { id: 'ring', points: ringPolyline(), closed: true },
  { id: 'ns', points: [[0, -RING], [0, RING]], closed: false },
  { id: 'ew', points: [[-RING, 0], [RING, 0]], closed: false },
];

/** Junction centres: markings are suppressed inside these squares. */
export const INTERSECTIONS = [
  [0, 0],
  [0, RING],
  [0, -RING],
  [RING, 0],
  [-RING, 0],
];

/** Paved lots (x0, z0, x1, z1). */
export const LOTS = {
  depot: [-150, 130, -70, 192],
  warehouse: [70, -192, 150, -118],
  site: [8, 60, 76, 140],
  market: [-150, -70, -60, -8],
};

export const SPAWN = { x: -110, z: 152, heading: 0, name: 'Northside Depot' };

/**
 * Delivery jobs. The zone is where the truck must stop to unload.
 * `building` is the collidable structure behind the zone.
 */
export const JOBS = [
  {
    id: 'warehouse',
    destination: 'Eastgate Warehouse',
    cargo: 'Canned goods',
    zone: { x: 110, z: -142, w: 14, l: 22 },
    building: { x: 110, z: -108, w: 60, l: 20, h: 12, color: 0x8a9bb0 },
  },
  {
    id: 'site',
    destination: 'Riverside Construction Site',
    cargo: 'Steel beams',
    zone: { x: 42, z: 100, w: 22, l: 14 },
    building: { x: 64, z: 100, w: 14, l: 50, h: 9, color: 0xc9a14a },
  },
  {
    id: 'market',
    destination: 'Westend Market',
    cargo: 'Fresh produce',
    zone: { x: -105, z: -38, w: 16, l: 20 },
    building: { x: -105, z: -60, w: 70, l: 16, h: 8, color: 0xb86b5a },
  },
];

export const DEPOT_BUILDING = { x: -110, z: 116, w: 70, l: 18, h: 10, color: 0x6f8f72 };

/** Deterministic pseudo-random generator so the map is the same every run. */
export function makeRng(seed = 1234) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Shortest distance from a point to any road centreline (used for placement + checks). */
export function distanceToRoad(x, z) {
  let best = Infinity;
  for (const road of ROADS) {
    const pts = road.points;
    const n = road.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[(i + 1) % pts.length];
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz;
      let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < best) best = d;
    }
  }
  return best;
}

export function insideRect(x, z, r, margin = 0) {
  return x > r[0] - margin && x < r[2] + margin && z > r[1] - margin && z < r[3] + margin;
}
