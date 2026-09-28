// Minimal 2D (top-down X/Z) collision using oriented boxes and the
// Separating Axis Theorem. The world is flat, so 2D is enough and far cheaper
// than a full physics engine on mobile.

/**
 * Create an oriented box.
 * @param {number} x centre X
 * @param {number} z centre Z
 * @param {number} halfW half size along the box's local X
 * @param {number} halfL half size along the box's local Z
 * @param {number} angle rotation around Y (same convention as three.js rotation.y)
 */
export function makeBox(x, z, halfW, halfL, angle = 0) {
  const box = { x, z, halfW, halfL, angle, ax: [0, 0], az: [0, 0], radius: 0 };
  setBoxTransform(box, x, z, angle);
  return box;
}

export function setBoxTransform(box, x, z, angle) {
  box.x = x;
  box.z = z;
  box.angle = angle;
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  // Local +Z axis (forward) and local +X axis, matching three.js rotation.y.
  box.az[0] = s;
  box.az[1] = c;
  box.ax[0] = c;
  box.ax[1] = -s;
  box.radius = Math.hypot(box.halfW, box.halfL);
}

function projectRadius(box, axis) {
  return (
    box.halfW * Math.abs(box.ax[0] * axis[0] + box.ax[1] * axis[1]) +
    box.halfL * Math.abs(box.az[0] * axis[0] + box.az[1] * axis[1])
  );
}

/**
 * Returns null if no overlap, otherwise { nx, nz, depth } where (nx, nz) is the
 * unit direction to push box A out of box B.
 */
export function boxOverlap(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const rr = a.radius + b.radius;
  if (dx * dx + dz * dz > rr * rr) return null; // broad phase

  let best = null;
  for (const axis of [a.ax, a.az, b.ax, b.az]) {
    const dist = dx * axis[0] + dz * axis[1];
    const overlap = projectRadius(a, axis) + projectRadius(b, axis) - Math.abs(dist);
    if (overlap <= 0) return null; // separating axis found
    if (!best || overlap < best.depth) {
      const sign = dist >= 0 ? 1 : -1;
      best = { nx: axis[0] * sign, nz: axis[1] * sign, depth: overlap };
    }
  }
  return best;
}

/** Simple uniform grid so each frame only tests nearby static colliders. */
export class CollisionWorld {
  constructor(cellSize = 40) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.all = [];
    this.dynamic = new Set(); // movable colliders (e.g. parked trailers), always tested
  }

  addDynamic(box) {
    this.dynamic.add(box);
  }

  removeDynamic(box) {
    this.dynamic.delete(box);
  }

  key(ix, iz) {
    return ix * 73856093 + iz * 19349663;
  }

  add(box) {
    this.all.push(box);
    const r = box.radius;
    const cs = this.cellSize;
    for (let ix = Math.floor((box.x - r) / cs); ix <= Math.floor((box.x + r) / cs); ix++) {
      for (let iz = Math.floor((box.z - r) / cs); iz <= Math.floor((box.z + r) / cs); iz++) {
        const k = this.key(ix, iz);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(box);
      }
    }
  }

  /** Boxes that might touch a circle at (x,z) with radius r. */
  query(x, z, r, out = []) {
    out.length = 0;
    const cs = this.cellSize;
    const seen = new Set();
    for (let ix = Math.floor((x - r) / cs); ix <= Math.floor((x + r) / cs); ix++) {
      for (let iz = Math.floor((z - r) / cs); iz <= Math.floor((z + r) / cs); iz++) {
        const list = this.cells.get(this.key(ix, iz));
        if (!list) continue;
        for (const b of list) {
          if (!seen.has(b)) {
            seen.add(b);
            out.push(b);
          }
        }
      }
    }
    for (const b of this.dynamic) {
      const dx = b.x - x;
      const dz = b.z - z;
      const rr = b.radius + r;
      if (dx * dx + dz * dz <= rr * rr) out.push(b);
    }
    return out;
  }

  /** Does the segment (x0,z0)->(x1,z1) pass through any collider? Returns hit fraction or 1. */
  raycast(x0, z0, x1, z1, maxHeightFilter = 0) {
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const len = Math.hypot(x1 - x0, z1 - z0);
    let tMin = 1;
    for (const b of this.query(mx, mz, len / 2 + 1)) {
      if (b.cameraIgnore || (b.height !== undefined && b.height < maxHeightFilter)) continue;
      // Transform segment into box local space (slab test).
      const lx0 = (x0 - b.x) * b.ax[0] + (z0 - b.z) * b.ax[1];
      const lz0 = (x0 - b.x) * b.az[0] + (z0 - b.z) * b.az[1];
      const lx1 = (x1 - b.x) * b.ax[0] + (z1 - b.z) * b.ax[1];
      const lz1 = (x1 - b.x) * b.az[0] + (z1 - b.z) * b.az[1];
      let t0 = 0;
      let t1 = 1;
      const slab = (p0, p1, h) => {
        const d = p1 - p0;
        if (Math.abs(d) < 1e-9) return Math.abs(p0) <= h;
        let ta = (-h - p0) / d;
        let tb = (h - p0) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        return t0 <= t1;
      };
      if (slab(lx0, lx1, b.halfW) && slab(lz0, lz1, b.halfL)) tMin = Math.min(tMin, t0);
    }
    return tMin;
  }
}
