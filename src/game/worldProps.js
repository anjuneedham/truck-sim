// Roadside and facility props for the world: vegetation, street lighting,
// traffic signals, signs, wind turbines, a tower crane, parked cars and
// stacked containers. Each builder merges its parts per material (or uses
// instancing) and registers simple colliders through ctx.addCollider.

import * as THREE from 'three';
import { WORLD } from '../config.js';
import { FACILITIES, LOTS, insideRect, makeRng } from './mapData.js';
import { PartBuilder } from '../render/partBuilder.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { textPanel, corrugated, trailerRear, concrete } from '../render/textures.js';

const HALF_ROAD = WORLD.roadWidth / 2;
const std = (o) => new THREE.MeshStandardMaterial(o);

const nearBuilding = (buildings, x, z, pad) => buildings.some((b) => Math.abs(b.x - x) < b.w / 2 + pad && Math.abs(b.z - z) < b.l / 2 + pad);
const nearLot = (x, z, pad) => Object.values(LOTS).some((r) => insideRect(x, z, r, pad));

// ---------------------------------------------------------------- vegetation

/** Irregular foliage blob: displaced icosahedron with darker undersides (vertex colours). */
function blob(radius, detail, rng, stretchY = 1) {
  // Welded so the displaced surface gets smooth normals (no faceting).
  let g = new THREE.IcosahedronGeometry(radius, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = 0.84 + rng() * 0.26;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * stretchY, p.getZ(i) * k);
    // Darker underside and inner clumps (fake ambient occlusion) + leafy speckle.
    const up = THREE.MathUtils.clamp((p.getY(i) / (radius * stretchY) + 1) / 2, 0, 1);
    const shade = (0.45 + 0.55 * up) * (0.85 + rng() * 0.3);
    colors.set([shade, shade, shade], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** Keep vertex colours through PartBuilder (it strips unknown attributes). */
function withColors(geos) {
  // Bake each piece's transform then concatenate positions/normals/colors.
  const parts = [];
  for (const [g0, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]] of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0.clone();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(...scale)
    );
    g.applyMatrix4(m);
    parts.push(g);
  }
  const total = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const P = new Float32Array(total * 3);
  const N = new Float32Array(total * 3);
  const C = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    P.set(g.attributes.position.array, o * 3);
    N.set(g.attributes.normal.array, o * 3);
    if (g.attributes.color) C.set(g.attributes.color.array, o * 3);
    else C.fill(1, o * 3, (o + g.attributes.position.count) * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return out;
}

/**
 * Three tree species (conifer, broadleaf, poplar) as instanced meshes with
 * per-instance scale, rotation and colour variation.
 */
export function buildTrees(group, trees, rng) {
  const species = [
    {
      trunk: new THREE.CylinderGeometry(0.18, 0.3, 2.4, 6).translate(0, 1.2, 0),
      trunkColor: 0x5a4030,
      leaves: withColors([
        [new THREE.ConeGeometry(2.4, 3.4, 9, 1), [0, 3.6, 0]],
        [new THREE.ConeGeometry(1.9, 3.0, 9, 1), [0, 5.2, 0]],
        [new THREE.ConeGeometry(1.3, 2.6, 9, 1), [0, 6.7, 0]],
        [new THREE.ConeGeometry(0.7, 1.8, 8, 1), [0, 8.0, 0]],
      ]),
      leafColor: [0.16, 0.27, 0.15],
    },
    {
      trunk: new THREE.CylinderGeometry(0.22, 0.34, 3.2, 6).translate(0, 1.6, 0),
      trunkColor: 0x654a36,
      leaves: withColors([
        [blob(2.2, 1, rng), [0, 4.6, 0]],
        [blob(1.7, 1, rng), [1.4, 4.1, 0.4]],
        [blob(1.7, 1, rng), [-1.2, 4.3, -0.6]],
        [blob(1.5, 1, rng), [0.2, 5.7, 0.9]],
        [blob(1.3, 1, rng), [-0.4, 5.4, -1.2]],
      ]),
      leafColor: [0.3, 0.42, 0.2],
    },
    {
      trunk: new THREE.CylinderGeometry(0.14, 0.2, 3.0, 6).translate(0, 1.5, 0),
      trunkColor: 0xd8d4c8,
      leaves: withColors([
        [blob(1.35, 1, rng, 2.2), [0, 5.4, 0]],
        [blob(0.9, 1, rng, 1.8), [0.5, 4.3, 0.3]],
      ]),
      leafColor: [0.38, 0.48, 0.22],
    },
  ];
  const buckets = species.map(() => []);
  for (const t of trees) buckets[Math.floor(rng() * 3) % 3].push(t);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  species.forEach((sp, si) => {
    const list = buckets[si];
    if (!list.length) return;
    const trunks = new THREE.InstancedMesh(sp.trunk, std({ color: sp.trunkColor, roughness: 0.95 }), list.length);
    const leaves = new THREE.InstancedMesh(sp.leaves, std({ vertexColors: true, roughness: 0.9 }), list.length);
    list.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      const s = t.s;
      m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(s, s * (0.9 + rng() * 0.25), s));
      trunks.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);
      const v = 0.8 + rng() * 0.4;
      col.setRGB(sp.leafColor[0] * v, sp.leafColor[1] * v, sp.leafColor[2] * v * (0.9 + rng() * 0.2), THREE.SRGBColorSpace);
      leaves.setColorAt(i, col);
    });
    trunks.castShadow = true;
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    group.add(trunks, leaves);
  });
}

/** Dense low-cost conifer forests on the hills beyond the boundary wall (no collision). */
export function buildForests(ctx) {
  if (!ctx.heightAt) return;
  const rng = makeRng(404);
  const geo = new THREE.ConeGeometry(2.6, 9, 7, 1).translate(0, 4.5, 0);
  const count = 1600;
  const mesh = new THREE.InstancedMesh(geo, std({ color: 0xffffff, roughness: 0.95 }), count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  // Stands of forest: clusters of trees around random centres on the hills.
  const clusters = Array.from({ length: 36 }, () => {
    const a = rng() * Math.PI * 2;
    const r = WORLD.halfSize + 110 + rng() * 520;
    return [Math.cos(a) * r, Math.sin(a) * r, 35 + rng() * 55];
  });
  let n = 0;
  for (let tries = 0; n < count && tries < 10000; tries++) {
    const [cx, cz, cr] = clusters[Math.floor(rng() * clusters.length)];
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * cr;
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    if (Math.max(Math.abs(x), Math.abs(z)) < WORLD.halfSize + 40) continue;
    const y = ctx.heightAt(x, z);
    const s = 0.8 + rng() * 0.9;
    m.compose(new THREE.Vector3(x, y - 0.3, z), q, new THREE.Vector3(s, s * (0.9 + rng() * 0.5), s));
    mesh.setMatrixAt(n, m);
    const v = 0.75 + rng() * 0.4;
    col.setRGB(0.13 * v, 0.23 * v, 0.13 * v, THREE.SRGBColorSpace);
    mesh.setColorAt(n, col);
    n++;
  }
  mesh.count = n;
  mesh.receiveShadow = false;
  ctx.group.add(mesh);
}

// ---------------------------------------------------------------- street lights

export function buildStreetLights(ctx) {
  const pb = new PartBuilder();
  const pole = std({ color: 0x7c8286, metalness: 0.8, roughness: 0.4 });
  const head = std({ color: 0x2a2d30, metalness: 0.5, roughness: 0.5 });
  const lamp = std({ color: 0xfff4d8, emissive: 0xffe8b0, emissiveIntensity: 0.25, roughness: 0.3 });
  const off = HALF_ROAD + 1.9;
  const place = (x, z, toRoadX, toRoadZ) => {
    if (nearLot(x, z, 5) || nearBuilding(ctx.buildings, x, z, 2)) return;
    pb.cyl(0.1, 8.2, pole, [x, 4.1, z], 'y', 8, 0.16);
    pb.cyl(0.24, 0.4, pole, [x, 0.2, z], 'y', 8); // base
    // Arm reaching over the road
    const ax = x + toRoadX * 1.1;
    const az = z + toRoadZ * 1.1;
    pb.box(Math.abs(toRoadX) * 2.2 + 0.08, 0.08, Math.abs(toRoadZ) * 2.2 + 0.08, pole, [ax, 8.1, az]);
    const hx = x + toRoadX * 2.2;
    const hz = z + toRoadZ * 2.2;
    pb.box(Math.abs(toRoadX) * 0.9 + 0.35, 0.16, Math.abs(toRoadZ) * 0.9 + 0.35, head, [hx, 8.05, hz]);
    pb.box(Math.abs(toRoadX) * 0.7 + 0.25, 0.04, Math.abs(toRoadZ) * 0.7 + 0.25, lamp, [hx, 7.96, hz]);
    ctx.addCollider(x, z, 0.18, 0.18, 0, 8);
  };
  for (let s = 34; s <= 180; s += 32) {
    for (const sign of [-1, 1]) {
      const p = s * sign;
      place(off, p, -1, 0); // NS road, east side
      place(-off, p, 1, 0); // west side
      place(p, off, 0, -1); // EW road, north side
      place(p, -off, 0, 1);
    }
  }
  pb.build(ctx.group);
}

// ---------------------------------------------------------------- traffic lights

/** Signals at the central 4-way junction, cycling N-S / E-W. */
export function buildTrafficLights(ctx) {
  const pb = new PartBuilder();
  const pole = std({ color: 0x3b3f43, metalness: 0.6, roughness: 0.45 });
  const housing = std({ color: 0x17191b, roughness: 0.6 });
  const mk = (c) => std({ color: 0x111111, emissive: c, emissiveIntensity: 0, roughness: 0.3 });
  const groups = {
    ns: { r: mk(0xff2a1a), a: mk(0xffa31a), g: mk(0x2dff6a) },
    ew: { r: mk(0xff2a1a), a: mk(0xffa31a), g: mk(0x2dff6a) },
  };
  const c = HALF_ROAD + 1.6;
  const lampGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.04, 14).rotateX(Math.PI / 2); // disc facing +Z
  // Approach direction (unit vector towards the centre) -> pole on the near-right corner.
  const approaches = [
    { dir: [0, -1], grp: 'ns' }, // coming from +z
    { dir: [0, 1], grp: 'ns' },
    { dir: [-1, 0], grp: 'ew' },
    { dir: [1, 0], grp: 'ew' },
  ];
  for (const { dir, grp } of approaches) {
    const [dx, dz] = dir;
    // Right of travel for a vehicle heading (dx, dz): (-cos h, sin h) = (-dz, dx).
    const rx = -dz;
    const rz = dx;
    // Near-right corner: before the junction, on the vehicle's right.
    const px = -dx * c + rx * c;
    const pz = -dz * c + rz * c;
    const faceY = Math.atan2(-dx, -dz); // signal faces approaching traffic
    pb.cyl(0.12, 6, pole, [px, 3, pz], 'y', 10);
    // Mast arm over the lane
    const armLen = 5.5;
    // Arm reaches left from the pole, over the approaching lanes.
    const ax = px - rx * (armLen / 2);
    const az = pz - rz * (armLen / 2);
    pb.box(Math.abs(rx) * armLen + 0.1, 0.12, Math.abs(rz) * armLen + 0.1, pole, [ax, 5.9, az]);
    for (const [hx, hz, hy] of [
      [px - dx * 0.25, pz - dz * 0.25, 3.2],
      [px - rx * (armLen - 0.6), pz - rz * (armLen - 0.6), 5.2],
    ]) {
      pb.rbox(0.4, 1.15, 0.32, housing, [hx, hy, hz], [0, faceY, 0]);
      const L = groups[grp];
      const fx = -dx * 0.17;
      const fz = -dz * 0.17;
      for (const [lamp, dy] of [
        [L.r, 0.36],
        [L.a, 0],
        [L.g, -0.36],
      ]) {
        pb.add(lampGeo, lamp, [hx + fx, hy + dy, hz + fz], [0, faceY, 0]);
      }
    }
    ctx.addCollider(px, pz, 0.2, 0.2, 0, 6);
  }
  pb.build(ctx.group);

  // Cycle: NS green 12 s, amber 3 s, all red 1 s, EW green 12 s, amber 3 s, all red 1 s.
  const cycle = 32;
  ctx.animated.push({
    update(dt, time) {
      const t = time % cycle;
      const set = (L, state) => {
        L.r.emissiveIntensity = state === 'r' ? 3 : 0;
        L.a.emissiveIntensity = state === 'a' ? 3 : 0;
        L.g.emissiveIntensity = state === 'g' ? 3 : 0;
      };
      const phase = (t0) => (t >= t0 && t < t0 + 12 ? 'g' : t >= t0 + 12 && t < t0 + 15 ? 'a' : 'r');
      set(groups.ns, phase(0));
      set(groups.ew, phase(16));
    },
  });
}

// ---------------------------------------------------------------- signs

function signPost(pb, mat, x, z, h) {
  pb.cyl(0.05, h, mat, [x, h / 2, z], 'y', 8);
}

export function buildSigns(ctx) {
  const pb = new PartBuilder();
  const post = std({ color: 0x9aa0a5, metalness: 0.8, roughness: 0.35 });
  const back = std({ color: 0x8a9095, metalness: 0.7, roughness: 0.5 });

  // Facility entrance signs (two posts + blue panel) facing the road.
  const entrances = {
    depot: { x: -64, z: 186, rot: 0 },
    warehouse: { x: 156, z: -186, rot: Math.PI },
    site: { x: 14, z: 146, rot: -Math.PI / 2 },
    market: { x: -54, z: -14, rot: 0 },
  };
  for (const f of FACILITIES) {
    const e = entrances[f.id];
    if (!e) continue;
    const tex = textPanel(f.name, { bg: 0x1d4f8c, fg: 0xffffff, w: 1024, h: 256 });
    const mat = std({ map: tex, roughness: 0.4, metalness: 0.1 });
    const w = 5;
    const h = 1.25;
    const rx = Math.cos(e.rot);
    const rz = -Math.sin(e.rot);
    for (const s of [-1, 1]) {
      signPost(pb, post, e.x + rx * s * (w / 2 - 0.3), e.z + rz * s * (w / 2 - 0.3), 3.2);
      ctx.addCollider(e.x + rx * s * (w / 2 - 0.3), e.z + rz * s * (w / 2 - 0.3), 0.1, 0.1, 0, 3);
    }
    pb.add(new THREE.PlaneGeometry(w, h), mat, [e.x + Math.sin(e.rot) * 0.03, 2.6, e.z + Math.cos(e.rot) * 0.03], [0, e.rot, 0]);
    pb.box(w, h, 0.04, back, [e.x, 2.6, e.z], [0, e.rot, 0]);
  }

  // Speed limit signs (round, red ring) on the inside verge of the ring road.
  const limit = document.createElement('canvas');
  limit.width = limit.height = 256;
  const g = limit.getContext('2d');
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(128, 128, 124, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#d0201a';
  g.lineWidth = 30;
  g.beginPath();
  g.arc(128, 128, 108, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#111';
  g.font = '900 110px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('90', 128, 134);
  const limitTex = new THREE.CanvasTexture(limit);
  limitTex.colorSpace = THREE.SRGBColorSpace;
  const limitMat = std({ map: limitTex, transparent: true, alphaTest: 0.5, roughness: 0.4 });
  const inner = 200 - HALF_ROAD - 2.6;
  for (const [x, z, rot] of [
    [-120, inner, Math.PI / 2],
    [120, -inner, -Math.PI / 2],
    [inner, 120, 0],
    [-inner, -120, Math.PI],
  ]) {
    signPost(pb, post, x, z, 2.6);
    pb.add(new THREE.CircleGeometry(0.45, 24), limitMat, [x, 2.5, z], [0, rot, 0]);
    ctx.addCollider(x, z, 0.1, 0.1, 0, 3);
  }

  // Chevron boards on the outside of each ring curve.
  const chev = document.createElement('canvas');
  chev.width = 256;
  chev.height = 128;
  const cg = chev.getContext('2d');
  cg.fillStyle = '#f2c230';
  cg.fillRect(0, 0, 256, 128);
  cg.fillStyle = '#111';
  for (const x0 of [40, 130]) {
    cg.beginPath();
    cg.moveTo(x0, 14);
    cg.lineTo(x0 + 60, 64);
    cg.lineTo(x0, 114);
    cg.lineTo(x0 + 26, 114);
    cg.lineTo(x0 + 86, 64);
    cg.lineTo(x0 + 26, 14);
    cg.fill();
  }
  const chevTex = new THREE.CanvasTexture(chev);
  chevTex.colorSpace = THREE.SRGBColorSpace;
  const chevMat = std({ map: chevTex, roughness: 0.5 });
  const R = 160;
  const rOut = 40 + HALF_ROAD + 4.2;
  for (const [cx, cz, a0] of [
    [R, R, 0],
    [-R, R, Math.PI / 2],
    [-R, -R, Math.PI],
    [R, -R, (3 * Math.PI) / 2],
  ]) {
    for (let k = 1; k <= 3; k++) {
      const a = a0 + (k / 4) * (Math.PI / 2);
      const x = cx + Math.cos(a) * rOut;
      const z = cz + Math.sin(a) * rOut;
      // Face the road centre of the curve (towards the arc centre).
      const face = Math.atan2(cx - x, cz - z);
      signPost(pb, post, x, z, 1.6);
      pb.add(new THREE.PlaneGeometry(1.1, 0.55), chevMat, [x + Math.sin(face) * 0.03, 1.5, z + Math.cos(face) * 0.03], [0, face, 0]);
    }
  }
  pb.build(ctx.group);
}

// ---------------------------------------------------------------- wind turbines

export function buildWindTurbines(ctx) {
  const white = std({ color: 0xf1f3f4, roughness: 0.5, metalness: 0.1 });
  const pb = new PartBuilder();
  const rotors = [];
  const spots = [
    [620, 180],
    [700, -40],
    [560, -380],
    [-640, 260],
    [-520, -520],
    [120, 720],
    [-240, 760],
  ];
  const bladeGeo = new THREE.BoxGeometry(1.4, 26, 0.3).translate(0, 13, 0);
  for (const [x, z] of spots) {
    const baseY = ctx.heightAt ? ctx.heightAt(x, z) : 20;
    pb.add(new THREE.CylinderGeometry(1.1, 2.0, 62, 12), white, [x, baseY + 31, z]);
    pb.rbox(3.2, 3, 7, white, [x, baseY + 63, z]);
    const rotor = new THREE.Group();
    rotor.position.set(x, baseY + 63, z + 3.8);
    const face = Math.atan2(-x, -z);
    const hubPb = new PartBuilder();
    hubPb.add(new THREE.SphereGeometry(1.4, 12, 8), white, [0, 0, 0]);
    for (let i = 0; i < 3; i++) hubPb.add(bladeGeo, white, [0, 0, 0], [0, 0, (i * Math.PI * 2) / 3]);
    hubPb.build(rotor, { castShadow: false });
    const holder = new THREE.Group();
    holder.position.set(x, 0, z);
    holder.rotation.y = face;
    rotor.position.set(0, baseY + 63, 3.8);
    holder.add(rotor);
    ctx.group.add(holder);
    rotors.push({ rotor, speed: 0.6 + (Math.abs(x + z) % 7) * 0.05 });
  }
  pb.build(ctx.group, { castShadow: false });
  ctx.animated.push({
    update(dt) {
      for (const r of rotors) r.rotor.rotation.z += r.speed * dt;
    },
  });
}

// ---------------------------------------------------------------- tower crane

export function buildCrane(ctx, site) {
  if (!site) return;
  const yellow = std({ color: 0xf2b705, metalness: 0.4, roughness: 0.45 });
  const grey = std({ color: 0x70767a, metalness: 0.5, roughness: 0.5 });
  const cable = std({ color: 0x222222 });
  const mx = site.lot[2] + 8; // just outside the lot, behind the site building
  const mz = site.building.z;
  const H = 42;
  const s = 1.1; // mast half-width
  const mast = new PartBuilder();
  for (const [dx, dz] of [[-s, -s], [s, -s], [s, s], [-s, s]]) mast.box(0.16, H, 0.16, yellow, [mx + dx, H / 2, mz + dz]);
  for (let y = 1.5; y < H; y += 2.2) {
    for (const [a, b] of [
      [[-s, -s], [s, -s]],
      [[s, -s], [s, s]],
      [[s, s], [-s, s]],
      [[-s, s], [-s, -s]],
    ]) {
      const cx = mx + (a[0] + b[0]) / 2;
      const cz = mz + (a[1] + b[1]) / 2;
      const horizontal = a[1] === b[1];
      mast.box(horizontal ? 2 * s : 0.1, 0.1, horizontal ? 0.1 : 2 * s, yellow, [cx, y, cz]);
      // Diagonal brace
      mast.box(horizontal ? 2.9 : 0.08, 0.08, horizontal ? 0.08 : 2.9, yellow, [cx, y + 1.1, cz], horizontal ? [0, 0, 0.75] : [0.75, 0, 0]);
    }
  }
  mast.box(4, 1, 4, std({ map: concrete(0xbdb8ae).map, roughness: 0.9 }), [mx, 0.5, mz]);
  mast.build(ctx.group);
  ctx.addCollider(mx, mz, 2, 2, 0, H, false);

  // Slewing top: jib, counter-jib, cab, counterweights, trolley + hook.
  const top = new THREE.Group();
  top.position.set(mx, H, mz);
  const t = new PartBuilder();
  const jibLen = 45;
  for (const dz of [-0.6, 0.6]) t.box(jibLen, 0.14, 0.14, yellow, [-jibLen / 2, 0.3, dz]);
  t.box(jibLen, 0.14, 0.14, yellow, [-jibLen / 2, 1.5, 0]);
  for (let x = -1; x > -jibLen; x -= 2) {
    t.box(0.08, 1.3, 0.08, yellow, [x, 0.9, 0.3], [0.4, 0, 0]);
    t.box(0.08, 1.3, 0.08, yellow, [x, 0.9, -0.3], [-0.4, 0, 0]);
  }
  t.box(14, 0.5, 1.5, yellow, [6, 0.4, 0]);
  t.box(3, 2.4, 2.2, grey, [11, 1.6, 0]); // counterweights
  t.box(1.8, 2, 1.8, grey, [0.5, -1, 1.6]); // cab
  t.box(1.6, 0.9, 0.05, std({ color: 0x10171e, metalness: 0.3, roughness: 0.05 }), [0.5, -0.8, 2.52]);
  t.cyl(0.5, 7, yellow, [0, 3.7, 0], 'y', 4, 0.1); // apex
  t.box(1, 0.4, 1.4, grey, [-26, 0, 0]); // trolley
  t.cyl(0.03, 22, cable, [-26, -11, 0], 'y', 4);
  t.box(0.6, 0.8, 0.4, std({ color: 0xd92e1c, roughness: 0.5 }), [-26, -22.4, 0]); // hook block
  t.build(top);
  top.rotation.y = 0.3;
  ctx.group.add(top);
  ctx.animated.push({
    update(dt, time) {
      top.rotation.y = 0.3 + Math.sin(time * 0.05) * 0.6;
    },
  });
}

/** Pallets, rebar and a site cabin near the construction site edges. */
export function buildSiteProps(ctx, site) {
  if (!site) return;
  const pb = new PartBuilder();
  const wood = std({ color: 0xa47a4c, roughness: 0.9 });
  const block = std({ map: concrete(0x9d9a92).map, roughness: 0.95 });
  const rebar = std({ color: 0x6b3f22, metalness: 0.6, roughness: 0.6 });
  const cabin = std({ map: corrugated(0x2f6db3, 'cabin').map, roughness: 0.5, metalness: 0.4 });
  const cone = std({ color: 0xff5a14, roughness: 0.6 });
  const [x0, z0, x1, z1] = site.lot;
  // Pallet stacks with blocks (NE corner, clear of zones)
  for (let i = 0; i < 4; i++) {
    const x = x1 - 4 - i * 2.4;
    const z = z1 - 4;
    pb.box(2.2, 0.15, 1.2, wood, [x, 0.12, z]);
    pb.box(2, 0.9, 1.1, block, [x, 0.65, z]);
    ctx.addCollider(x, z, 1.1, 0.6, 0, 1.2);
  }
  // Rebar bundle
  for (let i = 0; i < 12; i++) pb.cyl(0.04, 8, rebar, [x1 - 6 + (i % 6) * 0.12, 0.3 + Math.floor(i / 6) * 0.1, z1 - 8], 'x', 5);
  ctx.addCollider(x1 - 6, z1 - 8, 4, 0.5, 0, 0.6);
  // Site cabin (SE corner, outside the lot)
  pb.box(6, 2.6, 2.5, cabin, [x1 + 4, 1.35, z0 + 4]);
  pb.box(1, 2, 0.05, std({ color: 0x223344 }), [x1 + 4, 1.1, z0 + 5.26]);
  ctx.addCollider(x1 + 4, z0 + 4, 3, 1.25, 0, 2.6);
  // Traffic cones along the lot edge
  for (let i = 0; i < 6; i++) pb.add(new THREE.ConeGeometry(0.18, 0.7, 10), cone, [x1 - 1, 0.35, z0 + 12 + i * 3]);
  pb.build(ctx.group);
}

// ---------------------------------------------------------------- parked cars

function addCar(pb, mats, x, z, heading, colorMat) {
  const f = [Math.sin(heading), Math.cos(heading)];
  const at = (lx, ly, lz) => [x + f[0] * lz + f[1] * lx, ly, z + f[1] * lz - f[0] * lx];
  pb.rbox(1.82, 0.72, 4.4, 0.2, colorMat, at(0, 0.62, 0), [0, heading, 0]);
  pb.rbox(1.6, 0.62, 2.3, 0.22, colorMat, at(0, 1.22, -0.25), [0, heading, 0]);
  pb.box(1.62, 0.46, 2.1, mats.glass, at(0, 1.22, -0.25), [0, heading, 0]);
  for (const [lx, lz] of [[-0.8, 1.35], [0.8, 1.35], [-0.8, -1.35], [0.8, -1.35]]) {
    pb.cyl(0.33, 0.24, mats.tyre, at(lx, 0.33, lz), 'x', 12);
  }
  for (const lx of [-0.6, 0.6]) {
    pb.box(0.35, 0.12, 0.04, mats.head, at(lx, 0.72, 2.2), [0, heading, 0]);
    pb.box(0.35, 0.12, 0.04, mats.tail, at(lx, 0.78, -2.2), [0, heading, 0]);
  }
}

export function buildParkedCars(ctx) {
  const pb = new PartBuilder();
  const mats = {
    glass: std({ color: 0x0f1820, metalness: 0.2, roughness: 0.05 }),
    tyre: std({ color: 0x151515, roughness: 0.9 }),
    head: std({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 0.3 }),
    tail: std({ color: 0x5a0a0a, emissive: 0xff2010, emissiveIntensity: 0.2 }),
  };
  const paints = [0xb8bdc2, 0x1f2328, 0x8a1c1c, 0x2d4f7c, 0xe8e6e1, 0x3c5a3c].map((c) => std({ color: c, metalness: 0.55, roughness: 0.3 }));
  const rng = makeRng(31);
  const spots = [
    // Market: customer parking in front of the shop
    ...[-88, -82, -76, -70].map((x) => [x, -45, Math.PI]),
    // Warehouse staff parking beside the lot
    ...[-176, -170, -164, -158, -140].map((z) => [157, z, Math.PI / 2]),
  ];
  for (const [x, z, h] of spots) {
    if (nearBuilding(ctx.buildings, x, z, 1.5)) continue;
    addCar(pb, mats, x, z, h, paints[Math.floor(rng() * paints.length)]);
    const hw = Math.abs(Math.sin(h)) > 0.5 ? 2.2 : 0.95;
    const hl = Math.abs(Math.sin(h)) > 0.5 ? 0.95 : 2.2;
    ctx.addCollider(x, z, hw, hl, 0, 1.5);
  }
  pb.build(ctx.group);
}

// ---------------------------------------------------------------- containers

export function buildContainerStack(ctx) {
  const colors = [0xb4402f, 0x3a78b0, 0x3c9460, 0xd8801f, 0x8d9398];
  const rng = makeRng(17);
  const ends = std({ map: trailerRear(0x7a7f84), roughness: 0.6, metalness: 0.3 });
  const x0 = -165;
  let placed = 0;
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 3; i++) {
      const x = x0 - row * 3;
      const z = 140 + i * 13;
      if (nearBuilding(ctx.buildings, x, z, 7)) continue;
      const levels = 1 + Math.floor(rng() * 2);
      for (let lv = 0; lv < levels; lv++) {
        const c = colors[Math.floor(rng() * colors.length)];
        const C = corrugated(c, 'ctr' + c);
        const side = std({ map: C.map, normalMap: C.normalMap, roughness: 0.55, metalness: 0.4 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.44, 2.59, 12.2), [side, side, side, side, ends, ends]);
        mesh.position.set(x, 1.3 + lv * 2.6, z);
        mesh.castShadow = mesh.receiveShadow = true;
        ctx.group.add(mesh);
      }
      ctx.addCollider(x, z, 1.22, 6.1, 0, 2.6 * levels, false);
      placed++;
    }
  }
  return placed;
}
