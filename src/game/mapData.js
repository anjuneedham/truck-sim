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

/**
 * Facilities: every lot is a place with a gameplay purpose.
 *   lot         paved area (x0, z0, x1, z1)
 *   parking     where a truck is placed when a session starts here
 *   trailerSpot kingpin position/heading where pickup trailers wait
 *   loadZone    where a rigid truck stops to be loaded
 *   dropZone    where cargo (the trailer, or a rigid truck) is delivered
 *   building    the facility building (collidable)
 *   produces / accepts  cargo ids for job generation
 *   parking difficulty 0..1 (tight lots make jobs harder)
 */
export const FACILITIES = [
  {
    id: 'depot',
    name: 'Northside Depot',
    kind: 'Freight depot',
    lot: [-150, 130, -70, 192],
    parking: { x: -110, z: 152, heading: 0 },
    trailerSpot: { x: -110, z: 144.5, heading: 0 },
    loadZone: { x: -110, z: 150, w: 12, l: 20 },
    dropZone: { x: -84, z: 152, w: 14, l: 24 },
    building: { x: -110, z: 116, w: 70, l: 18, h: 10, color: 0x6f8f72 },
    produces: ['canned', 'furniture', 'electronics', 'consumer', 'autoparts'],
    accepts: ['produce', 'frozen', 'steel', 'lumber', 'fuel', 'machinery', 'cookingoil'],
    difficulty: 0.1,
  },
  {
    id: 'warehouse',
    name: 'Eastgate Warehouse',
    kind: 'Warehouse',
    lot: [70, -192, 150, -118],
    parking: { x: 135, z: -150, heading: Math.PI },
    trailerSpot: { x: 84, z: -163, heading: 0 },
    loadZone: { x: 86, z: -160, w: 12, l: 22 },
    dropZone: { x: 110, z: -142, w: 14, l: 22 },
    building: { x: 110, z: -108, w: 60, l: 20, h: 12, color: 0x8a9bb0 },
    produces: ['canned', 'electronics', 'consumer', 'furniture', 'dairy'],
    accepts: ['canned', 'autoparts', 'consumer', 'electronics', 'frozen', 'cookingoil'],
    difficulty: 0.15,
  },
  {
    id: 'site',
    name: 'Riverside Construction',
    kind: 'Construction site',
    lot: [8, 60, 76, 140],
    parking: { x: 30, z: 72, heading: -Math.PI / 2 },
    trailerSpot: { x: 24, z: 128, heading: Math.PI / 2 },
    loadZone: { x: 22, z: 126, w: 20, l: 12 },
    dropZone: { x: 42, z: 100, w: 22, l: 14 },
    building: { x: 64, z: 100, w: 14, l: 50, h: 9, color: 0xc9a14a },
    produces: ['lumber', 'machinery'],
    accepts: ['steel', 'lumber', 'machinery', 'fuel'],
    difficulty: 0.35,
  },
  {
    id: 'market',
    name: 'Westend Market',
    kind: 'Market',
    lot: [-150, -70, -60, -8],
    parking: { x: -80, z: -20, heading: 0 },
    trailerSpot: { x: -135, z: -26, heading: 0 },
    loadZone: { x: -135, z: -28, w: 12, l: 20 },
    dropZone: { x: -105, z: -38, w: 16, l: 20 },
    building: { x: -105, z: -60, w: 70, l: 16, h: 8, color: 0xb86b5a },
    produces: ['produce', 'frozen', 'dairy', 'cookingoil'],
    accepts: ['produce', 'frozen', 'canned', 'consumer', 'dairy', 'fuel', 'furniture'],
    difficulty: 0.25,
  },
];

export function getFacility(id) {
  return FACILITIES.find((f) => f.id === id) || FACILITIES[0];
}

/** Paved lots keyed by facility id (used by world building + surface checks). */
export const LOTS = Object.fromEntries(FACILITIES.map((f) => [f.id, f.lot]));

/** Default start: the depot's parking spot. */
export const SPAWN = { ...FACILITIES[0].parking, name: FACILITIES[0].name };

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
