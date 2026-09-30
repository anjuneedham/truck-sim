// Builds the static map: terrain, roads, markings, lots, buildings, barriers,
// vegetation and roadside props, and fills the CollisionWorld with boxes.
//
// Visuals use PBR materials with procedural textures (render/textures.js).
// Static geometry is merged per material (PartBuilder / strip builders) or
// instanced, so the whole map is ~60 draw calls.
//
// The collision layout (building/barrier/tree positions) is deterministic and
// independent of the visuals, so gameplay and tests are unaffected by art.

import * as THREE from 'three';
import { WORLD } from '../config.js';
import { ROADS, INTERSECTIONS, LOTS, FACILITIES, makeRng, distanceToRoad, insideRect } from './mapData.js';
import { CollisionWorld, makeBox } from './collision.js';
import { asphalt, grass, concrete, gravel, wornPaint, facade, corrugated, dockWall, textPanel } from '../render/textures.js';
import { PartBuilder } from '../render/partBuilder.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  buildTrees,
  buildStreetLights,
  buildTrafficLights,
  buildSigns,
  buildWindTurbines,
  buildCrane,
  buildParkedCars,
  buildContainerStack,
  buildSiteProps,
  buildForests,
} from './worldProps.js';

const HALF_ROAD = WORLD.roadWidth / 2;
const Y_GROUND = -0.05;
const Y_SHOULDER = 0.012;
const Y_LOT = 0.035;
const Y_ROAD = 0.05;
const Y_MARK = 0.075;
const SHOULDER = 1.6; // gravel strip width beyond the road edge

const std = (o) => new THREE.MeshStandardMaterial(o);

/** Accumulates flat, upward-facing quads (with UVs) into one geometry. */
class QuadBatch {
  constructor(uvScale = 1) {
    this.pos = [];
    this.uv = [];
    this.idx = [];
    this.uvScale = uvScale;
  }
  /** corners: four [x, z] points; uvs: optional four [u, v] (default world-space) */
  add(corners, y, uvs = null) {
    const base = this.pos.length / 3;
    corners.forEach(([x, z], i) => {
      this.pos.push(x, y, z);
      if (uvs) this.uv.push(uvs[i][0], uvs[i][1]);
      else this.uv.push(x * this.uvScale, z * this.uvScale);
    });
    const [c0, c1, c2] = corners;
    const ny = (c2[1] - c0[1]) * (c1[0] - c0[0]) - (c2[0] - c0[0]) * (c1[1] - c0[1]);
    if (ny > 0) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  addSegment(ax, az, bx, bz, width, y) {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (width / 2);
    const nz = (dx / len) * (width / 2);
    // u along the segment, v across - suits paint textures.
    this.add(
      [
        [ax + nx, az + nz],
        [bx + nx, bz + nz],
        [bx - nx, bz - nz],
        [ax - nx, az - nz],
      ],
      y,
      [
        [ax * this.uvScale, az * this.uvScale],
        [ax * this.uvScale + len * this.uvScale, az * this.uvScale],
        [ax * this.uvScale + len * this.uvScale, az * this.uvScale + width * this.uvScale],
        [ax * this.uvScale, az * this.uvScale + width * this.uvScale],
      ]
    );
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    const normals = new Float32Array(this.pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  }
}

/**
 * Continuous ribbon along a polyline (mitred joints, no overlaps) with
 * u = distance / uLen along the road and v = v0..v1 across it.
 * `offset` shifts the ribbon sideways (left positive) - used for shoulders.
 */
function stripGeometry(points, closed, halfWidth, y, uLen, v0 = 0, v1 = 1, offset = 0) {
  const n = points.length;
  const pos = [];
  const uv = [];
  const idx = [];
  let dist = 0;
  const count = closed ? n + 1 : n;
  for (let i = 0; i < count; i++) {
    const p = points[i % n];
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    let tx;
    let tz;
    if (!closed && i === 0) [tx, tz] = [next[0] - p[0], next[1] - p[1]];
    else if (!closed && i === n - 1) [tx, tz] = [p[0] - prev[0], p[1] - prev[1]];
    else {
      const a = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      const b = Math.hypot(next[0] - p[0], next[1] - p[1]);
      tx = (p[0] - prev[0]) / a + (next[0] - p[0]) / b;
      tz = (p[1] - prev[1]) / a + (next[1] - p[1]) / b;
    }
    const tl = Math.hypot(tx, tz);
    tx /= tl;
    tz /= tl;
    if (i > 0) {
      const q = points[(i - 1) % n];
      dist += Math.hypot(p[0] - q[0], p[1] - q[1]);
    }
    const lx = -tz;
    const lz = tx;
    const w0 = offset - halfWidth;
    const w1 = offset + halfWidth;
    pos.push(p[0] + lx * w0, y, p[1] + lz * w0, p[0] + lx * w1, y, p[1] + lz * w1);
    uv.push(dist / uLen, v0, dist / uLen, v1);
    if (i > 0) {
      const b = (i - 1) * 2;
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // Make every triangle face up (+Y) regardless of polyline direction.
  const P = g.attributes.position;
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) {
    const [a, b, c] = [ix[i], ix[i + 1], ix[i + 2]];
    const ux = P.getX(b) - P.getX(a);
    const uz = P.getZ(b) - P.getZ(a);
    const vx = P.getX(c) - P.getX(a);
    const vz = P.getZ(c) - P.getZ(a);
    if (uz * vx - ux * vz < 0) [ix[i + 1], ix[i + 2]] = [c, b];
  }
  const normals = new Float32Array(pos.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return g;
}

/** Walk a polyline by arc length, calling fn(x, z, tx, tz) every `step` metres. */
function samplePolyline(points, closed, step, fn) {
  const n = closed ? points.length : points.length - 1;
  let carry = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[(i + 1) % points.length];
    const len = Math.hypot(bx - ax, bz - az);
    const tx = (bx - ax) / len;
    const tz = (bz - az) / len;
    let s = carry;
    while (s <= len) {
      fn(ax + tx * s, az + tz * s, tx, tz);
      s += step;
    }
    carry = s - len;
  }
}

/**
 * Should road paint at (x, z) be skipped because it is inside a junction?
 * At T-junctions only the side where the joining road meets is opened up.
 */
function inJunction(x, z, pad = 0.6) {
  for (const [ix, iz] of INTERSECTIONS) {
    const dx = x - ix;
    const dz = z - iz;
    if (Math.max(Math.abs(dx), Math.abs(dz)) >= HALF_ROAD + pad) continue;
    if (ix === 0 && iz === 0) return true;
    // The joining road heads towards the map centre: open that side only.
    const towardCentre = -(dx * Math.sign(ix) + dz * Math.sign(iz));
    if (towardCentre > -1.2) return true;
  }
  return false;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.collision = new CollisionWorld(40);
    this.group = new THREE.Group();
    scene.add(this.group);
    this.animated = []; // objects with update(dt, time)

    this.buildGround();
    this.buildRoads();
    this.buildLots();
    this.buildBuildings();
    this.buildBarriers();
    this.buildVegetation();
    this.buildProps();
  }

  // ---------------------------------------------------------------- terrain
  buildGround() {
    // Subdivided so large-scale colour variation and the outer hills can live
    // in the vertices. The drivable area stays perfectly flat (physics is planar).
    const size = 2000;
    const seg = 140;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const rnd = makeRng(5);
    const bumps = Array.from({ length: 34 }, () => {
      const a = rnd() * Math.PI * 2;
      const r = 520 + rnd() * 420;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, h: 18 + rnd() * 45, s: 80 + rnd() * 120 };
    });
    // Terrain height outside the play area (used to seat distant props).
    this.heightAt = (x, z) => {
      const edge = Math.max(Math.abs(x), Math.abs(z));
      const out = THREE.MathUtils.smoothstep(edge, WORLD.halfSize + 15, WORLD.halfSize + 140);
      let h = 0;
      for (const b of bumps) h += b.h * Math.exp(-((x - b.x) ** 2 + (z - b.z) ** 2) / (b.s * b.s));
      return (h + 6) * out + Y_GROUND;
    };
    const c = new THREE.Color();
    const dry = new THREE.Color(1.12, 1.02, 0.72);
    const rockCol = new THREE.Color(0.95, 0.9, 0.85);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const edge = Math.max(Math.abs(x), Math.abs(z));
      const out = THREE.MathUtils.smoothstep(edge, WORLD.halfSize + 15, WORLD.halfSize + 140);
      let h = 0;
      for (const b of bumps) h += b.h * Math.exp(-((x - b.x) ** 2 + (z - b.z) ** 2) / (b.s * b.s));
      h = (h + 6) * out;
      pos.setY(i, h);
      const patch = Math.sin(x * 0.013 + Math.cos(z * 0.011) * 2) * 0.5 + 0.5;
      const fine = Math.sin(x * 0.07 + z * 0.05) * Math.cos(z * 0.06 - x * 0.03) * 0.5 + 0.5;
      const v = 0.82 + patch * 0.14 + fine * 0.08;
      c.setRGB(v, v * 1.01, v * 0.95);
      if (patch > 0.75) c.lerp(dry, (patch - 0.75) * 1.6);
      // Hills darken (forest floor) with height.
      c.multiplyScalar(1 - THREE.MathUtils.smoothstep(h, 5, 40) * 0.35);
      c.lerp(rockCol, THREE.MathUtils.smoothstep(h, 45, 70) * 0.5);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const tex = grass().map.clone();
    tex.needsUpdate = true;
    tex.repeat.set(size / 9, size / 9);
    const mat = std({
      map: tex,
      vertexColors: true,
      roughness: 0.97,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 4,
      polygonOffsetUnits: 4,
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.position.y = Y_GROUND;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  // ---------------------------------------------------------------- roads
  buildRoads() {
    const A = asphalt();
    const roadMat = std({ map: A.map, normalMap: A.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.9, metalness: 0 });
    const shoulderMat = std({ map: gravel().map, roughness: 1, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });

    // Visual road pieces: the ring is continuous; the centre cross is split
    // so no textured strips overlap (overlaps would flicker).
    const ring = ROADS.find((r) => r.id === 'ring');
    const edge = 200 - HALF_ROAD;
    const pieces = [
      { points: ring.points, closed: true },
      { points: [[0, -edge], [0, -HALF_ROAD]] },
      { points: [[0, HALF_ROAD], [0, edge]] },
      { points: [[-edge, 0], [-HALF_ROAD, 0]] },
      { points: [[HALF_ROAD, 0], [edge, 0]] },
    ];
    const roadGeos = [];
    const shoulderGeos = [];
    const add = (geos, mat) => {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    for (const p of pieces) {
      roadGeos.push(stripGeometry(p.points, !!p.closed, HALF_ROAD, Y_ROAD, WORLD.roadWidth));
      for (const side of [-1, 1]) {
        shoulderGeos.push(stripGeometry(p.points, !!p.closed, SHOULDER / 2, Y_SHOULDER, 4, 0, 0.4, side * (HALF_ROAD + SHOULDER / 2 - 0.2)));
      }
    }
    // Centre junction square (world-space UVs, same asphalt).
    const junction = new QuadBatch(1 / WORLD.roadWidth);
    junction.add(
      [
        [-HALF_ROAD, -HALF_ROAD],
        [HALF_ROAD, -HALF_ROAD],
        [HALF_ROAD, HALF_ROAD],
        [-HALF_ROAD, HALF_ROAD],
      ],
      Y_ROAD
    );
    roadGeos.push(junction.build());
    add(roadGeos, roadMat);
    add(shoulderGeos, shoulderMat);

    // ---- Markings (worn paint) ------------------------------------------
    const paint = wornPaint();
    const markMat = (color) =>
      std({ map: paint, color, roughness: 0.6, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const white = new QuadBatch(0.25);
    const yellow = new QuadBatch(0.25);
    for (const road of ROADS) {
      const pts = road.points;
      let k = 0;
      samplePolyline(pts, road.closed, 5, (x, z, tx, tz) => {
        if (k++ % 2 === 0 && !inJunction(x, z, 1) && !inJunction(x + tx * 4, z + tz * 4, 1)) {
          yellow.addSegment(x, z, x + tx * 4, z + tz * 4, 0.28, Y_MARK);
        }
      });
      for (const side of [-1, 1]) {
        const off = (HALF_ROAD - 0.55) * side;
        samplePolyline(pts, road.closed, 2, (x, z, tx, tz) => {
          const ox = x - tz * off;
          const oz = z + tx * off;
          if (!inJunction(ox, oz, 0.3) && !inJunction(ox + tx * 2, oz + tz * 2, 0.3)) {
            white.addSegment(ox, oz, ox + tx * 2.05, oz + tz * 2.05, 0.22, Y_MARK);
          }
        });
      }
    }
    // Zebra crossings + stop lines around the 4-way junction.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const dist = HALF_ROAD + 2.5;
      for (let s = -HALF_ROAD + 1; s <= HALF_ROAD - 1; s += 1.6) {
        const px = dx * dist + dz * s;
        const pz = dz * dist + dx * s;
        white.addSegment(px - dx * 1.5, pz - dz * 1.5, px + dx * 1.5, pz + dz * 1.5, 0.7, Y_MARK);
      }
      // Stop line across the approaching lane (vehicles drive on the right).
      const sd = HALF_ROAD + 5;
      const rx = -dz;
      const rz = dx;
      white.addSegment(dx * sd, dz * sd, dx * sd + rx * (HALF_ROAD - 0.6), dz * sd + rz * (HALF_ROAD - 0.6), 0.5, Y_MARK);
    }
    // Give-way lines where the cross roads join the ring.
    for (const [ix, iz] of INTERSECTIONS.slice(1)) {
      const ux = -Math.sign(ix);
      const uz = -Math.sign(iz);
      const sx = ix + ux * (HALF_ROAD + 2);
      const sz = iz + uz * (HALF_ROAD + 2);
      const rx = uz;
      const rz = -ux;
      white.addSegment(sx, sz, sx + rx * (HALF_ROAD - 0.6), sz + rz * (HALF_ROAD - 0.6), 0.5, Y_MARK);
    }
    this.group.add(new THREE.Mesh(white.build(), markMat(0xf2f2ee)));
    this.group.add(new THREE.Mesh(yellow.build(), markMat(0xf0bb28)));
  }

  // ---------------------------------------------------------------- lots
  buildLots() {
    const C = concrete(0xb9b6ae);
    const lotMat = std({ map: C.map, normalMap: C.normalMap, roughness: 0.88, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const lots = new QuadBatch(1 / 10);
    for (const r of Object.values(LOTS)) lots.add([[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], Y_LOT);
    const lotMesh = new THREE.Mesh(lots.build(), lotMat);
    lotMesh.receiveShadow = true;
    this.group.add(lotMesh);

    // Painted bays: a trailer bay at every facility + depot stalls, and a
    // yellow hazard line along each facility's loading wall.
    const lines = new QuadBatch(0.25);
    const hazard = new QuadBatch(0.25);
    for (const f of FACILITIES) {
      const t = f.trailerSpot;
      const fx = Math.sin(t.heading);
      const fz = Math.cos(t.heading);
      const rx = -fz;
      const rz = fx;
      const a = 1.5;
      const b = -11;
      for (const side of [-1.8, 1.8]) {
        lines.addSegment(t.x + fx * a + rx * side, t.z + fz * a + rz * side, t.x + fx * b + rx * side, t.z + fz * b + rz * side, 0.18, Y_MARK);
      }
      lines.addSegment(t.x + fx * b - rx * 1.8, t.z + fz * b - rz * 1.8, t.x + fx * b + rx * 1.8, t.z + fz * b + rz * 1.8, 0.18, Y_MARK);
      const bl = f.building;
      const lot = f.lot;
      const toX = (lot[0] + lot[2]) / 2 - bl.x;
      const toZ = (lot[1] + lot[3]) / 2 - bl.z;
      if (Math.abs(toZ) > Math.abs(toX)) {
        const z = bl.z + Math.sign(toZ) * (bl.l / 2 + 1.2);
        hazard.addSegment(bl.x - bl.w / 2 + 1, z, bl.x + bl.w / 2 - 1, z, 0.35, Y_MARK);
      } else {
        const x = bl.x + Math.sign(toX) * (bl.w / 2 + 1.2);
        hazard.addSegment(x, bl.z - bl.l / 2 + 1, x, bl.z + bl.l / 2 - 1, 0.35, Y_MARK);
      }
    }
    const d = LOTS.depot;
    for (let x = d[0] + 8; x < -100; x += 8) {
      if (Math.abs(x - -110) < 9) continue;
      lines.addSegment(x, d[1] + 2, x, d[1] + 16, 0.16, Y_MARK);
    }
    const paint = wornPaint();
    const mk = (color) => std({ map: paint, color, roughness: 0.6, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.group.add(new THREE.Mesh(lines.build(), mk(0xf0f0ea)));
    this.group.add(new THREE.Mesh(hazard.build(), mk(0xf2c230)));
  }

  /** Is (x,z) a bad spot for scenery (road, lot, near buildings)? */
  blocked(x, z, clearance) {
    if (Math.abs(x) > WORLD.halfSize - 6 || Math.abs(z) > WORLD.halfSize - 6) return true;
    if (distanceToRoad(x, z) < HALF_ROAD + clearance) return true;
    for (const r of Object.values(LOTS)) if (insideRect(x, z, r, clearance)) return true;
    return false;
  }

  // ---------------------------------------------------------------- buildings
  buildBuildings() {
    const rng = makeRng(42);
    const list = FACILITIES.map((f) => ({ ...f.building, facility: f }));

    // Scatter generic buildings in the blocks, avoiding roads and lots.
    // (Same algorithm and seed as the original build => same collision layout.)
    let attempts = 0;
    while (list.length < 34 && attempts++ < 2000) {
      const w = 12 + rng() * 22;
      const l = 12 + rng() * 22;
      const x = (rng() * 2 - 1) * 185;
      const z = (rng() * 2 - 1) * 185;
      const clearance = Math.max(w, l) / 2 + 10;
      if (this.blocked(x, z, clearance)) continue;
      if (list.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + 6 && Math.abs(b.z - z) < (b.l + l) / 2 + 6)) continue;
      list.push({ x, z, w, l, h: 6 + rng() * 18 });
      rng(); // the original consumed one number for a colour; keep the sequence
    }
    for (const b of list) {
      const box = makeBox(b.x, b.z, b.w / 2, b.l / 2, 0);
      box.height = b.h;
      this.collision.add(box);
    }
    this.buildings = list;

    // ---- Visuals: walls grouped by facade material -----------------------
    const indus = corrugated(0x9ea7ad, 'b');
    const kinds = {
      office: std({ map: facade('office').map, roughness: 0.3, metalness: 0.35 }),
      brick: std({ map: facade('brick').map, roughness: 0.85 }),
      plaster: std({ map: facade('plaster').map, roughness: 0.85 }),
      industrial: std({ map: indus.map, normalMap: indus.normalMap, roughness: 0.55, metalness: 0.4 }),
    };
    const walls = new Map();
    const pushWall = (mat, geo) => {
      if (!walls.has(mat)) walls.set(mat, []);
      walls.get(mat).push(geo);
    };
    const roofPB = new PartBuilder();
    const R = std({ color: 0x55585c, roughness: 0.95 });
    const Rtrim = std({ color: 0x8b8f93, roughness: 0.7, metalness: 0.3 });
    const unitMat = std({ color: 0xc4c8cb, roughness: 0.45, metalness: 0.6 });
    const krng = makeRng(77);
    for (const b of list) {
      if (b.facility) continue;
      const kind = b.h > 16 ? 'office' : b.h > 10 ? (krng() < 0.6 ? 'brick' : 'plaster') : krng() < 0.5 ? 'industrial' : 'plaster';
      const bay = kind === 'industrial' ? 8 : 3.6;
      const floor = kind === 'industrial' ? b.h : 3.6;
      for (const g of wallGeometries(b, bay, floor)) pushWall(kinds[kind], g);
      roofPB.box(b.w, 0.3, b.l, R, [b.x, b.h + 0.1, b.z]);
      for (const [w, l, x, z] of [
        [b.w + 0.3, 0.3, b.x, b.z - b.l / 2],
        [b.w + 0.3, 0.3, b.x, b.z + b.l / 2],
        [0.3, b.l, b.x - b.w / 2, b.z],
        [0.3, b.l, b.x + b.w / 2, b.z],
      ]) {
        roofPB.box(w, 0.7, l, Rtrim, [x, b.h + 0.35, z]);
      }
      const units = 1 + Math.floor(krng() * 3);
      for (let u = 0; u < units; u++) {
        roofPB.box(2 + krng() * 2, 1.2, 1.5 + krng() * 2, unitMat, [b.x + (krng() - 0.5) * (b.w - 6), b.h + 0.8, b.z + (krng() - 0.5) * (b.l - 6)]);
      }
    }
    for (const b of list.filter((x) => x.facility)) this.buildFacility(b, pushWall, roofPB, R, Rtrim, unitMat);

    // One mesh per facade material (instead of one per wall).
    for (const [mat, geos] of walls) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    roofPB.build(this.group);
  }

  /** Facility building: cladding, a loading-dock wall facing its lot, a big sign. */
  buildFacility(b, pushWall, roofPB, R, Rtrim, unitMat) {
    const f = b.facility;
    const lot = f.lot;
    const toX = (lot[0] + lot[2]) / 2 - b.x;
    const toZ = (lot[1] + lot[3]) / 2 - b.z;
    // Wall facing the lot: 0:+z 1:-z 2:+x 3:-x (wallGeometries order)
    const face = Math.abs(toZ) > Math.abs(toX) ? (toZ > 0 ? 0 : 1) : toX > 0 ? 2 : 3;
    const clad = new THREE.Color(b.color).lerp(new THREE.Color(0xffffff), 0.15).getHex();
    const C = corrugated(clad, f.id);
    const cladMat = std({ map: C.map, normalMap: C.normalMap, roughness: 0.5, metalness: 0.45 });
    const frontMat =
      f.id === 'market' ? std({ map: facade('plaster').map, roughness: 0.85 }) : std({ map: dockWall(clad).map, roughness: 0.55, metalness: 0.35 });
    wallGeometries(b, 10, b.h).forEach((g, i) => pushWall(i === face ? frontMat : cladMat, g));
    roofPB.box(b.w + 0.6, 0.5, b.l + 0.6, R, [b.x, b.h + 0.2, b.z]);
    roofPB.box(b.w + 0.8, 0.25, b.l + 0.8, Rtrim, [b.x, b.h + 0.5, b.z]);
    roofPB.box(3, 1.5, 2, unitMat, [b.x - b.w / 4, b.h + 1.2, b.z]);
    roofPB.box(3, 1.5, 2, unitMat, [b.x + b.w / 4, b.h + 1.2, b.z]);

    // Big sign above the doors.
    const signTex = textPanel(f.name.toUpperCase(), { bg: 0x1f2b3a, fg: 0xffffff, border: 0xf2c230 });
    const signMat = std({ map: signTex, roughness: 0.4, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.2 });
    const along = face < 2 ? b.w : b.l;
    const sw = Math.min(along * 0.7, 26);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw / 4), signMat);
    const off = 0.1;
    const y = Math.max(5.5, b.h - 2.4);
    if (face === 0) sign.position.set(b.x, y, b.z + b.l / 2 + off);
    if (face === 1) {
      sign.position.set(b.x, y, b.z - b.l / 2 - off);
      sign.rotation.y = Math.PI;
    }
    if (face === 2) {
      sign.position.set(b.x + b.w / 2 + off, y, b.z);
      sign.rotation.y = Math.PI / 2;
    }
    if (face === 3) {
      sign.position.set(b.x - b.w / 2 - off, y, b.z);
      sign.rotation.y = -Math.PI / 2;
    }
    this.group.add(sign);
    if (f.id === 'market') {
      // Striped awning over the shop front.
      const stripes = document.createElement('canvas');
      stripes.width = 64;
      stripes.height = 8;
      const g = stripes.getContext('2d');
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#f4f1ea' : '#c0392b';
        g.fillRect(i * 8, 0, 8, 8);
      }
      const t = new THREE.CanvasTexture(stripes);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      t.repeat.set(b.w / 6, 1);
      const awn = new THREE.Mesh(new THREE.BoxGeometry(b.w - 4, 0.12, 2.6), std({ map: t, roughness: 0.8 }));
      awn.position.set(b.x, 3.6, b.z + b.l / 2 + 1.25);
      awn.rotation.x = 0.22;
      awn.castShadow = true;
      this.group.add(awn);
    }
  }

  // ---------------------------------------------------------------- barriers
  buildBarriers() {
    const segments = [];
    const ring = ROADS.find((r) => r.id === 'ring');
    const off = HALF_ROAD + 3;
    const railPts = [];
    samplePolyline(ring.points, true, 6, (x, z, tx, tz) => railPts.push([x + tz * off, z - tx * off]));
    for (let i = 0; i < railPts.length; i++) {
      const [ax, az] = railPts[i];
      const [bx, bz] = railPts[(i + 1) % railPts.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      segments.push({ x: (ax + bx) / 2, z: (az + bz) / 2, len: len + 0.2, angle: Math.atan2(bx - ax, bz - az), kind: 'rail' });
    }
    const d = LOTS.depot;
    for (let z = d[1] + 3; z < d[3] - 2; z += 4.2) {
      segments.push({ x: d[0] - 1, z, len: 4, angle: 0, kind: 'jersey' });
      segments.push({ x: d[2] + 1, z, len: 4, angle: 0, kind: 'jersey' });
    }
    for (const [x, z] of [[-140, 142], [-140, 160], [-140, 178]]) segments.push({ x, z, len: 4, angle: Math.PI / 2, kind: 'jersey' });

    // Colliders (sizes unchanged from the original build).
    for (const s of segments) {
      const [w, h] = s.kind === 'rail' ? [0.4, 0.9] : [0.8, 1.0];
      const box = makeBox(s.x, s.z, w / 2, s.len / 2, s.angle);
      box.height = h;
      this.collision.add(box);
    }

    // Visuals: W-beam rail on posts; shaped concrete jersey barriers.
    const steel = std({ color: 0xc3c9ce, metalness: 0.85, roughness: 0.32 });
    const postMat = std({ color: 0x8c9296, metalness: 0.7, roughness: 0.5 });
    const conc = std({ map: concrete(0xcfc9bd).map, roughness: 0.9 });
    const stripe = std({ color: 0xf2c230, roughness: 0.6 });
    const pb = new PartBuilder();
    const wShape = new THREE.Shape();
    [[0, 0], [0.07, 0.05], [0.07, 0.13], [0.01, 0.16], [0.07, 0.19], [0.07, 0.27], [0, 0.32], [-0.02, 0.32], [-0.02, 0]].forEach(([x, y], i) =>
      i ? wShape.lineTo(x, y) : wShape.moveTo(x, y)
    );
    const jShape = new THREE.Shape();
    [[-0.4, 0], [0.4, 0], [0.4, 0.08], [0.27, 0.3], [0.12, 1.0], [-0.12, 1.0], [-0.27, 0.3], [-0.4, 0.08]].forEach(([x, y], i) =>
      i ? jShape.lineTo(x, y) : jShape.moveTo(x, y)
    );
    for (const s of segments) {
      const fx = Math.sin(s.angle);
      const fz = Math.cos(s.angle);
      if (s.kind === 'rail') {
        const g = new THREE.ExtrudeGeometry(wShape, { depth: s.len, bevelEnabled: false });
        g.translate(0, 0, -s.len / 2);
        // Profile +x must face the road (towards the map centre).
        const rightX = -fz;
        const rightZ = fx;
        const towardCentre = -(s.x * rightX + s.z * rightZ) > 0;
        pb.add(g, steel, [s.x, 0.46, s.z], [0, s.angle + (towardCentre ? Math.PI : 0), 0]);
        pb.box(0.1, 0.78, 0.15, postMat, [s.x - fx * (s.len / 2), 0.39, s.z - fz * (s.len / 2)], [0, s.angle, 0]);
      } else {
        const g = new THREE.ExtrudeGeometry(jShape, { depth: s.len - 0.12, bevelEnabled: false });
        g.translate(0, 0, -(s.len - 0.12) / 2);
        pb.add(g, conc, [s.x, 0, s.z], [0, s.angle, 0]);
        pb.box(0.26, 0.12, s.len - 0.3, stripe, [s.x, 0.8, s.z], [0, s.angle, 0]);
      }
    }
    pb.build(this.group);

    // Perimeter noise wall - the hard boundary of the map.
    const H = WORLD.halfSize;
    const wallTex = concrete(0xa9a49a).map.clone();
    wallTex.needsUpdate = true;
    wallTex.repeat.set(80, 0.7);
    const wallMat = std({ map: wallTex, roughness: 0.95 });
    for (const [x, z, w, l] of [
      [0, H, 2 * H + 4, 2],
      [0, -H, 2 * H + 4, 2],
      [H, 0, 2, 2 * H + 4],
      [-H, 0, 2, 2 * H + 4],
    ]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 3.5, l), wallMat);
      wall.position.set(x, 1.75, z);
      wall.receiveShadow = true;
      this.group.add(wall);
      const box = makeBox(x, z, w / 2, l / 2, 0);
      box.height = 3;
      this.collision.add(box);
    }
  }

  // ---------------------------------------------------------------- vegetation
  buildVegetation() {
    // Same placement algorithm and seed as before so tree colliders don't move.
    const rng = makeRng(7);
    const trees = [];
    let attempts = 0;
    while (trees.length < 220 && attempts++ < 6000) {
      const x = (rng() * 2 - 1) * (WORLD.halfSize - 8);
      const z = (rng() * 2 - 1) * (WORLD.halfSize - 8);
      if (this.blocked(x, z, 5)) continue;
      if (this.buildings.some((b) => Math.abs(b.x - x) < b.w / 2 + 3 && Math.abs(b.z - z) < b.l / 2 + 3)) continue;
      trees.push({ x, z, s: 0.8 + rng() * 0.7 });
    }
    for (const t of trees) {
      const box = makeBox(t.x, t.z, 0.4 * t.s, 0.4 * t.s, 0);
      box.height = 6;
      box.cameraIgnore = true;
      this.collision.add(box);
    }
    buildTrees(this.group, trees, makeRng(8));
  }

  // ---------------------------------------------------------------- props
  buildProps() {
    const addCollider = (x, z, hw, hl, angle = 0, height = 5, cameraIgnore = true) => {
      const box = makeBox(x, z, hw, hl, angle);
      box.height = height;
      box.cameraIgnore = cameraIgnore;
      this.collision.add(box);
    };
    const ctx = {
      group: this.group,
      addCollider,
      blocked: (x, z, c) => this.blocked(x, z, c),
      buildings: this.buildings,
      animated: this.animated,
      heightAt: this.heightAt,
    };
    buildStreetLights(ctx);
    buildTrafficLights(ctx);
    buildSigns(ctx);
    buildWindTurbines(ctx);
    buildForests(ctx);
    const site = FACILITIES.find((f) => f.id === 'site');
    buildCrane(ctx, site);
    buildSiteProps(ctx, site);
    buildParkedCars(ctx);
    buildContainerStack(ctx);
  }

  /** Animate traffic lights, turbines etc. */
  update(dt, time) {
    for (const a of this.animated) a.update(dt, time);
  }

  /** Driving surface under a point: paved road/lot or grass. */
  surfaceAt(x, z) {
    if (distanceToRoad(x, z) < HALF_ROAD + 0.5) return 'road';
    for (const r of Object.values(LOTS)) if (insideRect(x, z, r)) return 'road';
    return 'grass';
  }

  /** Is the point outside the drivable area (used for out-of-bounds recovery)? */
  isOutOfBounds(x, z) {
    const H = WORLD.halfSize - 1;
    return Math.abs(x) > H || Math.abs(z) > H || !Number.isFinite(x) || !Number.isFinite(z);
  }
}

/**
 * Four textured walls for a box building. UVs repeat one texture tile per
 * `bay` metres across and `floor` metres up so windows keep real proportions.
 * Returned in order +z, -z, +x, -x.
 */
function wallGeometries(b, bay, floor) {
  const out = [];
  const hw = b.w / 2;
  const hl = b.l / 2;
  const walls = [
    [b.x - hw, b.z + hl, b.x + hw, b.z + hl, 0, 1],
    [b.x + hw, b.z - hl, b.x - hw, b.z - hl, 0, -1],
    [b.x + hw, b.z + hl, b.x + hw, b.z - hl, 1, 0],
    [b.x - hw, b.z - hl, b.x - hw, b.z + hl, -1, 0],
  ];
  for (const [x0, z0, x1, z1, nx, nz] of walls) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const u = Math.max(1, Math.round(len / bay));
    const v = Math.max(1, Math.round(b.h / floor));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([x0, 0, z0, x1, 0, z1, x1, b.h, z1, x0, b.h, z0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, u, 0, u, v, 0, v], 2));
    // Counter-clockwise when seen from outside.
    g.setIndex([0, 1, 2, 0, 2, 3]);
    out.push(g);
  }
  return out;
}
