// Builds the static test map: ground, roads, markings, lots, buildings,
// trees, barriers, hills. Everything static is batched (merged quads or
// InstancedMesh) to keep draw calls low on mobile GPUs. Also fills the
// CollisionWorld with simple boxes.

import * as THREE from 'three';
import { WORLD } from '../config.js';
import {
  ROADS,
  INTERSECTIONS,
  LOTS,
  JOBS,
  DEPOT_BUILDING,
  makeRng,
  distanceToRoad,
  insideRect,
} from './mapData.js';
import { CollisionWorld, makeBox } from './collision.js';

const HALF_ROAD = WORLD.roadWidth / 2;
const Y_ROAD = 0.05;
const Y_LOT = 0.03;
const Y_MARK = 0.08;

/** Accumulates flat, upward-facing quads into one BufferGeometry. */
class QuadBatch {
  constructor() {
    this.pos = [];
    this.idx = [];
  }
  /** corners: four [x, z] points in winding order */
  add(corners, y) {
    const base = this.pos.length / 3;
    for (const [x, z] of corners) this.pos.push(x, y, z);
    // Pick the winding that makes the quad face up (+Y) so lighting is correct
    // and single-sided rendering works: y of (c2 - c0) x (c1 - c0).
    const [c0, c1, c2] = corners;
    const ny = (c2[1] - c0[1]) * (c1[0] - c0[0]) - (c2[0] - c0[0]) * (c1[1] - c0[1]);
    if (ny > 0) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** Segment quad from a to b with the given width. */
  addSegment(ax, az, bx, bz, width, y) {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (width / 2);
    const nz = (dx / len) * (width / 2);
    this.add(
      [
        [ax + nx, az + nz],
        [bx + nx, bz + nz],
        [bx - nx, bz - nz],
        [ax - nx, az - nz],
      ],
      y
    );
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    const normals = new Float32Array(this.pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setIndex(this.idx);
    return g;
  }
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

function inIntersection(x, z, pad = 0.5) {
  for (const [ix, iz] of INTERSECTIONS) {
    if (Math.max(Math.abs(x - ix), Math.abs(z - iz)) < HALF_ROAD + pad) return true;
  }
  return false;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.collision = new CollisionWorld(40);
    this.group = new THREE.Group();
    scene.add(this.group);
    this.shadowCasters = [];

    this.buildLights();
    this.buildGround();
    this.buildRoads();
    this.buildLots();
    this.buildBuildings();
    this.buildBarriers();
    this.buildTrees();
    this.buildHills();
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a6b45, 1.25);
    this.group.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(60, 120, 40);
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -45;
    sc.right = 45;
    sc.top = 45;
    sc.bottom = -45;
    sc.near = 10;
    sc.far = 300;
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  /** Keep the shadow frustum centred on the truck. */
  followSun(x, z) {
    this.sun.position.set(x + 60, 120, z + 40);
    this.sun.target.position.set(x, 0, z);
  }

  buildGround() {
    const geo = new THREE.PlaneGeometry(1800, 1800, 1, 1);
    geo.rotateX(-Math.PI / 2);
    // Pushed back in depth so paved surfaces never z-fight with it on
    // low-precision mobile depth buffers.
    const mat = new THREE.MeshLambertMaterial({
      color: 0x74a55c,
      polygonOffset: true,
      polygonOffsetFactor: 4,
      polygonOffsetUnits: 4,
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  buildRoads() {
    const asphalt = new QuadBatch();
    const white = new QuadBatch();
    const yellow = new QuadBatch();

    for (const road of ROADS) {
      const pts = road.points;
      const n = road.closed ? pts.length : pts.length - 1;
      // Road surface: one quad per segment, plus round-ish joints via extra overlap.
      for (let i = 0; i < n; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[(i + 1) % pts.length];
        const len = Math.hypot(bx - ax, bz - az);
        const ex = ((bx - ax) / len) * 1.5; // extend to close gaps on curves
        const ez = ((bz - az) / len) * 1.5;
        asphalt.addSegment(ax - ex, az - ez, bx + ex, bz + ez, WORLD.roadWidth, Y_ROAD);
      }

      // Centre dashes (yellow): 4m dash, 6m gap.
      let k = 0;
      samplePolyline(pts, road.closed, 5, (x, z, tx, tz) => {
        if (k++ % 2 === 0 && !inIntersection(x, z, 1)) {
          yellow.addSegment(x, z, x + tx * 4, z + tz * 4, 0.3, Y_MARK);
        }
      });
      // Edge lines (white, solid) as short segments so they follow curves.
      for (const side of [-1, 1]) {
        const off = (HALF_ROAD - 0.6) * side;
        samplePolyline(pts, road.closed, 2, (x, z, tx, tz) => {
          const ox = x - tz * off;
          const oz = z + tx * off;
          if (!inIntersection(ox, oz, 0.3)) {
            white.addSegment(ox, oz, ox + tx * 2.05, oz + tz * 2.05, 0.25, Y_MARK);
          }
        });
      }
    }

    // Zebra crossings around the central 4-way intersection.
    const [cx, cz] = INTERSECTIONS[0];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const dist = HALF_ROAD + 2.5;
      for (let s = -HALF_ROAD + 1; s <= HALF_ROAD - 1; s += 1.6) {
        const px = cx + dx * dist + dz * s;
        const pz = cz + dz * dist + dx * s;
        yellow.addSegment(px - dx * 1.5, pz - dz * 1.5, px + dx * 1.5, pz + dz * 1.5, 0.7, Y_MARK);
      }
    }

    const roadMat = new THREE.MeshLambertMaterial({ color: 0x3b3e44 });
    const roadMesh = new THREE.Mesh(asphalt.build(), roadMat);
    roadMesh.receiveShadow = true;
    this.group.add(roadMesh);

    const markOpts = { polygonOffset: true, polygonOffsetFactor: -2 };
    this.group.add(
      new THREE.Mesh(white.build(), new THREE.MeshBasicMaterial({ color: 0xe8e8e8, ...markOpts }))
    );
    this.group.add(
      new THREE.Mesh(yellow.build(), new THREE.MeshBasicMaterial({ color: 0xf2c230, ...markOpts }))
    );
  }

  buildLots() {
    const lots = new QuadBatch();
    const lines = new QuadBatch();
    for (const r of Object.values(LOTS)) {
      lots.add([[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], Y_LOT);
    }
    // Parking bay lines in the depot for visual reference.
    const d = LOTS.depot;
    for (let x = d[0] + 8; x < d[2]; x += 8) {
      if (Math.abs(x - -110) < 9) continue; // leave the spawn bay open
      lines.addSegment(x, d[1] + 2, x, d[1] + 16, 0.2, Y_MARK);
    }
    const lotMat = new THREE.MeshLambertMaterial({ color: 0x55585e, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    const lotMesh = new THREE.Mesh(lots.build(), lotMat);
    lotMesh.receiveShadow = true;
    this.group.add(lotMesh);
    this.group.add(
      new THREE.Mesh(
        lines.build(),
        new THREE.MeshBasicMaterial({ color: 0xdddddd, polygonOffset: true, polygonOffsetFactor: -2 })
      )
    );
  }

  /** Is (x,z) a bad spot for scenery (road, lot, near buildings)? */
  blocked(x, z, clearance) {
    if (Math.abs(x) > WORLD.halfSize - 6 || Math.abs(z) > WORLD.halfSize - 6) return true;
    if (distanceToRoad(x, z) < HALF_ROAD + clearance) return true;
    for (const r of Object.values(LOTS)) if (insideRect(x, z, r, clearance)) return true;
    return false;
  }

  buildBuildings() {
    const rng = makeRng(42);
    const list = [DEPOT_BUILDING, ...JOBS.map((j) => j.building)];
    const palette = [0xc2b8a3, 0x9aa7b4, 0xb07d62, 0xd9d2c5, 0x7d8c7a, 0xa3a09a];

    // Scatter generic buildings in the blocks, avoiding roads and lots.
    let attempts = 0;
    while (list.length < 34 && attempts++ < 2000) {
      const w = 12 + rng() * 22;
      const l = 12 + rng() * 22;
      const x = (rng() * 2 - 1) * 185;
      const z = (rng() * 2 - 1) * 185;
      const clearance = Math.max(w, l) / 2 + 10;
      if (this.blocked(x, z, clearance)) continue;
      if (list.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + 6 && Math.abs(b.z - z) < (b.l + l) / 2 + 6)) continue;
      list.push({ x, z, w, l, h: 6 + rng() * 18, color: palette[Math.floor(rng() * palette.length)] });
    }

    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial();
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    list.forEach((b, i) => {
      m.makeScale(b.w, b.h, b.l).setPosition(b.x, 0, b.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.setHex(b.color));
      const box = makeBox(b.x, b.z, b.w / 2, b.l / 2, 0);
      box.height = b.h;
      this.collision.add(box);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Flat roofs in a darker tone make the boxes read as buildings.
    const roofGeo = new THREE.BoxGeometry(1, 0.6, 1);
    const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ color: 0x4b4f55 }), list.length);
    list.forEach((b, i) => {
      m.makeScale(b.w + 0.6, 1, b.l + 0.6).setPosition(b.x, b.h + 0.3, b.z);
      roofs.setMatrixAt(i, m);
    });
    this.group.add(roofs);
    this.buildings = list;
  }

  buildBarriers() {
    const segments = []; // {x, z, len, angle, kind}

    // Guardrail along the outside of the ring road.
    const ring = ROADS.find((r) => r.id === 'ring');
    const off = HALF_ROAD + 3;
    const railPts = [];
    samplePolyline(ring.points, true, 6, (x, z, tx, tz) => {
      // Outward normal: ring is counter-clockwise around origin, outside is (tz, -tx)
      railPts.push([x + tz * off, z - tx * off]);
    });
    for (let i = 0; i < railPts.length; i++) {
      const [ax, az] = railPts[i];
      const [bx, bz] = railPts[(i + 1) % railPts.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      segments.push({ x: (ax + bx) / 2, z: (az + bz) / 2, len: len + 0.2, angle: Math.atan2(bx - ax, bz - az), kind: 'rail' });
    }

    // Concrete barriers along the depot lot sides (useful for collision testing).
    const d = LOTS.depot;
    for (let z = d[1] + 3; z < d[3] - 2; z += 4.2) {
      segments.push({ x: d[0] - 1, z, len: 4, angle: 0, kind: 'jersey' });
      segments.push({ x: d[2] + 1, z, len: 4, angle: 0, kind: 'jersey' });
    }
    // A short chicane of blocks in the depot for practice.
    for (const [x, z] of [[-86, 150], [-86, 170], [-134, 160]]) {
      segments.push({ x, z, len: 4, angle: Math.PI / 2, kind: 'jersey' });
    }

    const rails = segments.filter((s) => s.kind === 'rail');
    const jerseys = segments.filter((s) => s.kind === 'jersey');

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const place = (mesh, list, w, h) => {
      list.forEach((s, i) => {
        q.setFromAxisAngle(up, s.angle);
        m.compose(new THREE.Vector3(s.x, h / 2, s.z), q, new THREE.Vector3(w, h, s.len));
        mesh.setMatrixAt(i, m);
        const box = makeBox(s.x, s.z, w / 2, s.len / 2, s.angle);
        box.height = h;
        this.collision.add(box);
      });
      mesh.castShadow = true;
      this.group.add(mesh);
    };
    const unit = new THREE.BoxGeometry(1, 1, 1);
    place(new THREE.InstancedMesh(unit, new THREE.MeshLambertMaterial({ color: 0xc7ccd1 }), rails.length), rails, 0.4, 0.9);
    place(new THREE.InstancedMesh(unit, new THREE.MeshLambertMaterial({ color: 0xd8d3c8 }), jerseys.length), jerseys, 0.8, 1.0);

    // Perimeter wall: the hard boundary of the test map.
    const H = WORLD.halfSize;
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x9c9486 });
    for (const [x, z, w, l] of [
      [0, H, 2 * H + 4, 2],
      [0, -H, 2 * H + 4, 2],
      [H, 0, 2, 2 * H + 4],
      [-H, 0, 2, 2 * H + 4],
    ]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 3, l), wallMat);
      wall.position.set(x, 1.5, z);
      this.group.add(wall);
      const box = makeBox(x, z, w / 2, l / 2, 0);
      box.height = 3;
      this.collision.add(box);
    }
  }

  buildTrees() {
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
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 5);
    trunkGeo.translate(0, 1.2, 0);
    const leafGeo = new THREE.ConeGeometry(2.2, 6, 6);
    leafGeo.translate(0, 5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6b4a2f }), trees.length);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0x3f7a3a }), trees.length);
    const m = new THREE.Matrix4();
    trees.forEach((t, i) => {
      m.makeScale(t.s, t.s, t.s).setPosition(t.x, 0, t.z);
      trunks.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);
      const box = makeBox(t.x, t.z, 0.4 * t.s, 0.4 * t.s, 0);
      box.height = 6;
      box.cameraIgnore = true; // thin trunks shouldn't yank the camera in
      this.collision.add(box);
    });
    leaves.castShadow = true;
    this.group.add(trunks, leaves);
  }

  buildHills() {
    // Low-poly hills outside the perimeter wall - pure scenery, no collision.
    const rng = makeRng(99);
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const count = 26;
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x5f8f4e, flatShading: true }), count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng() * 0.2;
      const r = 420 + rng() * 120;
      const s = 60 + rng() * 70;
      m.makeScale(s, s * (0.35 + rng() * 0.3), s).setPosition(Math.cos(a) * r, -s * 0.1, Math.sin(a) * r);
      mesh.setMatrixAt(i, m);
    }
    this.group.add(mesh);
  }

  /** Is the point outside the drivable area (used for out-of-bounds recovery)? */
  isOutOfBounds(x, z) {
    const H = WORLD.halfSize - 1;
    return Math.abs(x) > H || Math.abs(z) > H || !Number.isFinite(x) || !Number.isFinite(z);
  }

  /** Update shadow settings when graphics quality changes. */
  setShadows(enabled) {
    this.sun.castShadow = enabled;
  }
}
