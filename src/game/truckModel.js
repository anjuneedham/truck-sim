// Detailed procedural trucks (no model files), driven by a catalogue entry
// (data/trucks.js): body type, cab style, paint, dimensions.
//
// Local space: +Z forward, origin at the centre of the footprint on the ground.
// Parts are merged per material by PartBuilder so a ~200-part truck costs
// ~15 draw calls. PBR materials pick up the sky environment map, so paint is
// glossy, chrome reflects and glass looks like glass.
//
// Exposes hooks to animate wheels, steering, lights and body roll/pitch.

import * as THREE from 'three';
import { SUSPENSION } from '../config.js';
import { TRUCK_CATALOGUE, buildSpec, plateFor } from '../data/trucks.js';
import { PartBuilder, latheX } from '../render/partBuilder.js';
import { grille, textPanel, plate, trailerSide, trailerRear } from '../render/textures.js';

// ---------------------------------------------------------------- shared materials
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  SHARED = {
    chrome: std({ color: 0xf2f4f6, metalness: 1, roughness: 0.12 }),
    alu: std({ color: 0xc9ced3, metalness: 0.9, roughness: 0.3 }),
    trim: std({ color: 0x1b1d20, metalness: 0.2, roughness: 0.55 }),
    frame: std({ color: 0x151618, metalness: 0.4, roughness: 0.6 }),
    rubber: std({ color: 0x141414, metalness: 0, roughness: 0.92 }),
    glass: std({ color: 0x0d1720, metalness: 0.2, roughness: 0.04, envMapIntensity: 1.6 }),
    steel: std({ color: 0x6d7378, metalness: 0.7, roughness: 0.45 }),
    black: std({ color: 0x0b0c0d, metalness: 0.1, roughness: 0.8 }),
    mirror: std({ color: 0xdfe9f2, metalness: 1, roughness: 0.02 }),
    hoseRed: std({ color: 0xb3261e, roughness: 0.5 }),
    hoseBlue: std({ color: 0x1f4fa8, roughness: 0.5 }),
    grilleH: std({ map: grille(false), metalness: 0.8, roughness: 0.3 }),
    grilleV: std({ map: grille(true), metalness: 0.8, roughness: 0.3 }),
    amber: std({ color: 0x5a3200, emissive: 0xff9a1a, emissiveIntensity: 0.9, roughness: 0.3 }),
  };
  return SHARED;
}

// ---------------------------------------------------------------- wheels (shared geometry)
let WHEEL_GEO = null;
export function wheelGeometries() {
  if (WHEEL_GEO) return WHEEL_GEO;
  const R = 0.52;
  // Tyre cross-section as a lathe around X (radius, x).
  const tyre = latheX(
    [
      [0.3, -0.15],
      [0.42, -0.16],
      [0.49, -0.145],
      [R, -0.1],
      [R, 0.1],
      [0.49, 0.145],
      [0.42, 0.16],
      [0.3, 0.15],
    ],
    24
  );
  // Dished rim facing +X with hub and lug nuts.
  const pb = new PartBuilder();
  const tmp = new THREE.MeshBasicMaterial();
  pb.add(
    latheX(
      [
        [0.0, 0.1],
        [0.1, 0.11],
        [0.13, 0.085],
        [0.27, 0.095],
        [0.31, 0.14],
        [0.315, 0.155],
        [0.3, 0.155],
        [0.29, -0.14],
      ],
      20
    ),
    tmp
  );
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    pb.cyl(0.018, 0.05, tmp, [0.125, Math.sin(a) * 0.075, Math.cos(a) * 0.075], 'x', 6);
  }
  pb.cyl(0.05, 0.08, tmp, [0.13, 0, 0], 'x', 10);
  const g = new THREE.Group();
  pb.build(g);
  const rim = g.children[0].geometry;
  WHEEL_GEO = { tyre, rim };
  return WHEEL_GEO;
}

export class TruckModel {
  /** @param {object} entry truck catalogue entry */
  constructor(entry = TRUCK_CATALOGUE[0]) {
    this.entry = entry;
    const spec = buildSpec(entry);
    this.spec = spec;
    this.root = new THREE.Group(); // positioned/rotated by physics
    this.body = new THREE.Group(); // rolls/pitches on the "suspension"
    this.root.add(this.body);
    const M = shared();

    // Per-truck materials (disposed with the model).
    const std = (o) => new THREE.MeshStandardMaterial(o);
    this.paintMat = std({ color: entry.paint, metalness: 0.45, roughness: 0.28, envMapIntensity: 1.1 });
    this.accentMat = std({ color: entry.accent, metalness: 0.4, roughness: 0.35 });
    this.headMat = std({ color: 0xfff6e0, emissive: 0xfff2d0, emissiveIntensity: 1.6, roughness: 0.1 });
    this.tailMat = std({ color: 0x3a0505, emissive: 0xff1a10, emissiveIntensity: 0.35, roughness: 0.3 });
    this.reverseMat = std({ color: 0x777777, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 });
    const badgeMat = std({ map: textPanel(entry.make.toUpperCase(), { bg: 0x16181b, fg: 0xe8ecef, w: 512, h: 96, border: null, font: '900' }), metalness: 0.5, roughness: 0.3 });
    const plateMat = std({ map: plate(plateFor(entry.id)), roughness: 0.5 });
    this.materials = [this.paintMat, this.accentMat, this.headMat, this.tailMat, this.reverseMat, badgeMat, plateMat];

    const L = spec.length;
    const halfL = L / 2;
    const front = halfL;
    const frontAxleZ = spec.rearAxleOffset + spec.wheelbase;
    const rearAxleZ = spec.rearAxleOffset;
    const pb = new PartBuilder();

    // ---- Chassis -------------------------------------------------------
    for (const sx of [-1, 1]) pb.box(0.12, 0.3, L - 0.5, M.frame, [sx * 0.45, 0.95, -0.1]);
    for (const z of [front - 0.6, rearAxleZ, -halfL + 0.3]) pb.box(0.9, 0.12, 0.12, M.frame, [0, 0.95, z]);

    // ---- Cab -------------------------------------------------------------
    let cabBack;
    const exhausts = [];
    if (entry.cab === 'conventional') cabBack = this.buildConventional(pb, M, front, frontAxleZ, exhausts, badgeMat);
    else cabBack = this.buildCabover(pb, M, front, frontAxleZ, exhausts, badgeMat, entry.cab === 'aero', entry.body === 'rigid');
    this.exhausts = exhausts; // local positions of stack outlets (for smoke)

    // Front plate + bumper-mounted details
    pb.box(0.52, 0.13, 0.02, plateMat, [0, 0.98, front + 0.2]);

    // ---- Behind the cab ----------------------------------------------------
    // Fuel tank (right) and battery/air tank (left) under the cab back.
    const tankZ = cabBack - 0.7;
    pb.cyl(0.32, 1.2, M.alu, [-0.98, 0.78, tankZ], 'z', 18);
    for (const dz of [-0.4, 0.4]) pb.cyl(0.335, 0.06, M.trim, [-0.98, 0.78, tankZ + dz], 'z', 18);
    pb.cyl(0.035, 0.05, M.black, [-0.98, 1.12, tankZ + 0.3], 'y', 8); // filler cap
    pb.box(0.55, 0.5, 0.9, M.trim, [0.98, 0.8, tankZ]);
    pb.box(0.56, 0.08, 0.92, M.steel, [0.98, 1.07, tankZ]);
    // Steps
    for (const sx of [-1, 1]) {
      pb.box(0.32, 0.05, 0.55, M.alu, [sx * 1.15, 0.55, frontAxleZ - 1.05]);
      pb.box(0.32, 0.05, 0.55, M.alu, [sx * 1.15, 0.9, frontAxleZ - 1.05]);
    }

    if (entry.body === 'rigid') {
      this.buildBoxBody(M, cabBack, halfL, rearAxleZ);
      // Lateral protection rails between the axles
      for (const sx of [-1, 1]) {
        for (const y of [0.6, 0.9]) pb.box(0.05, 0.08, frontAxleZ - rearAxleZ - 2.6, M.alu, [sx * 1.2, y, (frontAxleZ + rearAxleZ) / 2 - 0.1]);
      }
    } else {
      // Deck plate, air/electric lines and the fifth wheel.
      pb.box(1.1, 0.04, 0.9, M.steel, [0, 1.22, cabBack - 0.55]);
      for (const [mat, x] of [
        [M.hoseRed, -0.2],
        [M.hoseBlue, 0.2],
      ]) {
        for (let k = 0; k < 4; k++) pb.add(new THREE.TorusGeometry(0.16, 0.018, 6, 16), mat, [x, 1.55 + k * 0.05, cabBack - 0.25], [0, Math.PI / 2, 0]);
      }
      this.fifthWheelZ = rearAxleZ + 0.2;
      pb.box(1.3, 0.14, 1.1, M.frame, [0, 1.12, this.fifthWheelZ]);
      pb.cyl(0.66, 0.12, M.steel, [0, 1.25, this.fifthWheelZ], 'y', 24);
      pb.box(0.14, 0.13, 0.7, M.black, [0, 1.27, this.fifthWheelZ - 0.35]); // coupling slot
    }

    // ---- Rear: fenders, mudflaps, light bar ---------------------------------
    for (const sx of [-1, 1]) {
      pb.box(0.85, 0.05, 2.45, M.trim, [sx * 0.95, 1.16, rearAxleZ]);
      pb.box(0.6, 0.62, 0.025, M.rubber, [sx * 0.95, 0.5, rearAxleZ - 1.3]);
    }
    const rear = -halfL;
    if (entry.body !== 'rigid') {
      pb.box(2.3, 0.14, 0.12, M.frame, [0, 0.95, rear + 0.1]);
      for (const sx of [-1, 1]) {
        pb.box(0.34, 0.16, 0.05, this.tailMat, [sx * 0.9, 0.95, rear + 0.04]);
        pb.box(0.14, 0.14, 0.05, this.reverseMat, [sx * 0.55, 0.95, rear + 0.04]);
      }
    }

    // ---- Front wheel arches -------------------------------------------------
    for (const sx of [-1, 1]) {
      pb.add(new THREE.CylinderGeometry(0.62, 0.62, 0.42, 16, 1, true, 0, Math.PI), M.trim, [sx * 1.05, 0.52, frontAxleZ], [0, 0, Math.PI / 2]);
    }

    pb.build(this.body);

    // ---- Wheels -------------------------------------------------------------
    this.buildWheels(M, frontAxleZ, rearAxleZ);

    // ---- Blob shadow (low/medium quality) -----------------------------------
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.width + 0.8, L + 0.8),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.1;
    this.blobShadow = blob;
    this.root.add(blob);
    this.materials.push(blob.material);

    this.wheelSpin = 0;
    this.roll = 0;
    this.rollVel = 0;
    this.pitch = 0;
    this.pitchVel = 0;
    this.heave = 0;
    this.heaveVel = 0;
    this.bumpTimer = 0;
  }

  // ---------------------------------------------------------------- cab styles
  /** Flat-fronted European style cab. Returns z of the cab's rear wall. */
  buildCabover(pb, M, front, frontAxleZ, exhausts, badgeMat, aero, rigid) {
    const P = this.paintMat;
    const cabD = rigid ? 2.35 : 2.3;
    const y0 = 1.12; // cab floor
    const H = aero ? 2.75 : 2.6;
    const cz = front - cabD / 2 - 0.12;
    const back = cz - cabD / 2;
    // Shell
    pb.rbox(2.46, H, cabD, 0.16, P, [0, y0 + H / 2, cz]);
    // Front fascia: lower panel, grille, badge
    pb.rbox(2.3, 0.95, 0.12, P, [0, y0 + 0.55, front - 0.08], [0, 0, 0], 2);
    pb.box(1.55, 0.62, 0.03, M.grilleH, [0, y0 + 0.62, front - 0.005]);
    pb.box(0.95, 0.17, 0.02, badgeMat, [0, y0 + 1.07, front + 0.02]);
    // Windscreen with frame, tilted back slightly
    const wsY = y0 + 1.6;
    pb.rbox(2.3, 1.08, 0.05, M.black, [0, wsY, front - 0.06], [-0.08, 0, 0], 2);
    pb.rbox(2.18, 0.98, 0.04, M.glass, [0, wsY, front - 0.03], [-0.08, 0, 0], 2);
    // Wipers
    for (const x of [-0.55, 0.35]) pb.box(0.8, 0.025, 0.02, M.black, [x, wsY - 0.44, front], [0, 0, 0.18]);
    // Sun visor
    pb.box(2.36, 0.07, 0.36, aero ? P : M.black, [0, y0 + H - 0.28, front + 0.08], [0.18, 0, 0]);
    // Roof marker lights
    for (let i = -2; i <= 2; i++) pb.box(0.12, 0.06, 0.06, M.amber, [i * 0.28, y0 + H - 0.1, front + 0.1]);
    // Headlight clusters with chrome bezels + indicators
    for (const sx of [-1, 1]) {
      pb.rbox(0.6, 0.3, 0.1, M.chrome, [sx * 0.86, y0 + 0.22, front - 0.03], [0, 0, 0], 2);
      pb.box(0.52, 0.22, 0.05, this.headMat, [sx * 0.86, y0 + 0.22, front + 0.02]);
      pb.box(0.14, 0.12, 0.05, M.amber, [sx * 1.08, y0 + 0.42, front - 0.03]);
    }
    // Bumper with fog lamps
    pb.rbox(2.52, 0.42, 0.4, M.trim, [0, 0.98, front - 0.05], [0, 0, 0], 2);
    for (const sx of [-1, 1]) pb.cyl(0.08, 0.05, this.headMat, [sx * 0.9, 0.95, front + 0.16], 'z', 12);
    // Side windows, door seams, handles, mirrors
    for (const sx of [-1, 1]) {
      const x = sx * 1.235;
      pb.box(0.02, 0.8, 1.0, M.glass, [x, y0 + 1.72, front - 0.72]);
      pb.box(0.02, 0.08, 1.02, M.black, [x, y0 + 1.3, front - 0.72]);
      pb.box(0.02, 1.9, 0.03, M.black, [x, y0 + 1.1, front - 1.25]); // door seam
      pb.box(0.03, 0.05, 0.22, M.chrome, [x + sx * 0.01, y0 + 1.05, front - 1.05]);
      // Mirror arm + main mirror + wide-angle mirror
      pb.cyl(0.025, 0.42, M.trim, [sx * 1.42, y0 + 1.95, front - 0.18], 'x', 6);
      pb.cyl(0.025, 0.55, M.trim, [sx * 1.62, y0 + 1.75, front - 0.18], 'y', 6);
      pb.rbox(0.14, 0.48, 0.22, M.black, [sx * 1.66, y0 + 1.72, front - 0.15], [0, 0, 0], 2);
      pb.box(0.02, 0.42, 0.17, M.mirror, [sx * 1.66 - sx * 0.07, y0 + 1.72, front - 0.15], [0, sx * 0.25, 0]);
      pb.rbox(0.12, 0.2, 0.2, M.black, [sx * 1.6, y0 + 1.3, front - 0.15], [0, 0, 0], 2);
    }
    // Side air deflectors / aero roof fairing and chassis skirts
    if (aero) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(cabD * 0.95, 0);
      shape.lineTo(cabD * 0.95, 0.85);
      shape.lineTo(cabD * 0.3, 0.8);
      shape.quadraticCurveTo(0.1, 0.5, 0, 0);
      const fair = new THREE.ExtrudeGeometry(shape, { depth: 2.36, bevelEnabled: false });
      fair.translate(0, 0, -1.18);
      pb.add(fair, P, [0, y0 + H - 0.02, front - 0.35], [0, Math.PI / 2, 0]);
      for (const sx of [-1, 1]) {
        pb.box(0.06, 0.62, frontAxleZ - this.spec.rearAxleOffset - 2.2, P, [sx * 1.22, 0.78, (frontAxleZ + this.spec.rearAxleOffset) / 2 + 0.05]);
        pb.box(0.08, 2.2, 0.35, P, [sx * 1.25, y0 + 1.2, back + 0.1]); // cab side extenders
      }
    } else if (!rigid) {
      // Vertical exhaust stack behind the cab (right side)
      pb.cyl(0.1, 2.9, M.chrome, [1.02, y0 + 1.35, back - 0.2], 'y', 12);
      pb.cyl(0.13, 1.1, M.alu, [1.02, y0 + 1.2, back - 0.2], 'y', 12); // heat shield
      exhausts.push(new THREE.Vector3(1.02, y0 + 2.85, back - 0.2));
    }
    if (rigid || aero) exhausts.push(new THREE.Vector3(1.0, 0.55, back - 1.4)); // under-chassis outlet
    // Roof horns
    if (!aero) for (const sx of [-1, 1]) pb.cyl(0.05, 0.5, M.chrome, [sx * 0.35, y0 + H + 0.05, back + 0.6], 'z', 8, 0.08);
    return back;
  }

  /** American long-hood cab with sleeper. Returns z of the sleeper's rear wall. */
  buildConventional(pb, M, front, frontAxleZ, exhausts, badgeMat) {
    const P = this.paintMat;
    const hoodLen = 2.2;
    // Hood + fenders
    pb.rbox(1.95, 1.05, hoodLen, 0.22, P, [0, 1.72, front - hoodLen / 2 - 0.1]);
    for (const sx of [-1, 1]) {
      pb.rbox(0.52, 0.28, 1.7, 0.12, P, [sx * 1.02, 1.28, frontAxleZ + 0.1]);
      pb.add(new THREE.CylinderGeometry(0.66, 0.66, 0.5, 18, 1, true, 0, Math.PI), P, [sx * 1.02, 0.55, frontAxleZ], [0, 0, Math.PI / 2]);
      // Headlights in the fenders
      pb.rbox(0.42, 0.22, 0.14, M.chrome, [sx * 1.0, 1.35, frontAxleZ + 0.92], [0, 0, 0], 2);
      pb.box(0.36, 0.16, 0.05, this.headMat, [sx * 1.0, 1.35, frontAxleZ + 1.0]);
      // Air cleaner canisters beside the cowl
      pb.cyl(0.24, 1.0, M.chrome, [sx * 1.25, 2.1, front - hoodLen - 0.05], 'y', 16);
      pb.cyl(0.25, 0.08, M.chrome, [sx * 1.25, 2.64, front - hoodLen - 0.05], 'y', 16);
    }
    // Big chrome grille surround + vertical bars + badge
    pb.rbox(1.35, 1.12, 0.14, M.chrome, [0, 1.68, front - 0.02], [0, 0, 0], 2);
    pb.box(1.15, 0.92, 0.03, M.grilleV, [0, 1.68, front + 0.05]);
    pb.box(0.8, 0.14, 0.02, badgeMat, [0, 2.3, front - 0.12], [-0.2, 0, 0]);
    // Chrome bumper
    pb.rbox(2.6, 0.4, 0.38, M.chrome, [0, 0.95, front + 0.02], [0, 0, 0], 3);
    // Cab
    const cabFront = front - hoodLen - 0.15;
    const cabD = 1.75;
    const cz = cabFront - cabD / 2;
    pb.rbox(2.46, 2.1, cabD, 0.14, P, [0, 2.3, cz]);
    pb.rbox(2.3, 0.85, 0.05, M.black, [0, 2.85, cabFront + 0.01], [-0.28, 0, 0], 2);
    for (const sx of [-1, 1]) pb.rbox(1.04, 0.75, 0.04, M.glass, [sx * 0.56, 2.86, cabFront + 0.04], [-0.28, sx * 0.08, 0], 2);
    pb.box(2.4, 0.08, 0.38, M.black, [0, 3.36, cabFront + 0.15], [0.2, 0, 0]); // visor
    for (let i = -2; i <= 2; i++) pb.box(0.12, 0.07, 0.07, M.amber, [i * 0.3, 3.4, cabFront + 0.3]);
    // Sleeper, slightly taller, with a small window + roof fairing
    const sleepD = 1.9;
    const sz = cabFront - cabD - sleepD / 2 + 0.05;
    pb.rbox(2.46, 2.65, sleepD, 0.14, P, [0, 2.57, sz]);
    for (const sx of [-1, 1]) {
      const x = sx * 1.235;
      pb.box(0.02, 0.75, 0.95, M.glass, [x, 2.75, cz + 0.1]);
      pb.box(0.02, 0.3, 0.5, M.glass, [x, 3.1, sz]);
      pb.box(0.02, 0.1, cabD + sleepD, this.accentMat, [x, 1.5, cz - sleepD / 2]); // pinstripe
      pb.box(0.02, 1.9, 0.03, M.black, [x, 2.2, cz - 0.55]);
      // West-coast mirrors on the doors
      pb.cyl(0.022, 0.5, M.chrome, [sx * 1.45, 2.95, cabFront - 0.2], 'x', 6);
      pb.cyl(0.022, 0.5, M.chrome, [sx * 1.45, 2.25, cabFront - 0.2], 'x', 6);
      pb.rbox(0.14, 0.9, 0.24, M.chrome, [sx * 1.72, 2.6, cabFront - 0.2], [0, 0, 0], 2);
      pb.box(0.02, 0.84, 0.19, M.mirror, [sx * 1.72 - sx * 0.07, 2.6, cabFront - 0.2]);
      // Twin chrome stacks with angled tips
      const stackZ = sz - sleepD / 2 - 0.15;
      pb.cyl(0.11, 3.1, M.chrome, [sx * 1.08, 2.85, stackZ], 'y', 14);
      pb.cyl(0.14, 1.2, M.alu, [sx * 1.08, 2.0, stackZ], 'y', 14);
      exhausts.push(new THREE.Vector3(sx * 1.08, 4.45, stackZ));
    }
    return sz - sleepD / 2;
  }

  /** Box body for the rigid truck (textured sides, rear doors). */
  buildBoxBody(M, cabBack, halfL, rearAxleZ) {
    const len = cabBack - -halfL - 0.2;
    const zc = -halfL + len / 2;
    const H = 2.85;
    const sideMat = new THREE.MeshStandardMaterial({ map: trailerSide('Cityline Parcel', 0xf1f1ed, this.entry.accent, { tape: true }), roughness: 0.45, metalness: 0.1 });
    const rearMat = new THREE.MeshStandardMaterial({ map: trailerRear(0xe9e9e4), roughness: 0.5, metalness: 0.1 });
    const plainMat = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.5 });
    this.materials.push(sideMat, rearMat, plainMat);
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.55, H, len), [sideMat, sideMat, plainMat, plainMat, plainMat, rearMat]);
    box.position.set(0, 1.28 + H / 2, zc);
    box.castShadow = box.receiveShadow = true;
    this.body.add(box);
    // Corner posts, roof rails, bumper + lights
    const pb = new PartBuilder();
    for (const sx of [-1, 1]) {
      for (const z of [zc - len / 2, zc + len / 2]) pb.box(0.07, H + 0.04, 0.07, M.alu, [sx * 1.29, 1.28 + H / 2, z]);
      pb.box(0.06, 0.07, len, M.alu, [sx * 1.29, 1.28 + H, zc]);
      pb.box(0.06, 0.1, len, M.alu, [sx * 1.29, 1.3, zc]);
      pb.box(0.34, 0.2, 0.05, this.tailMat, [sx * 0.95, 0.95, -halfL - 0.03]);
      pb.box(0.16, 0.16, 0.05, this.reverseMat, [sx * 0.6, 0.95, -halfL - 0.03]);
      pb.box(0.08, 0.08, 0.04, M.amber, [sx * 1.26, 1.28 + H - 0.1, -halfL - 0.03]);
    }
    pb.box(2.2, 0.12, 0.1, M.alu, [0, 0.62, -halfL + 0.05]); // underride bar
    pb.box(2.46, 0.1, 0.12, M.frame, [0, 1.22, -halfL + 0.05]);
    const rearPlate = new THREE.MeshStandardMaterial({ map: plate(plateFor(this.entry.id, 1)) });
    this.materials.push(rearPlate);
    pb.box(0.52, 0.13, 0.02, rearPlate, [0, 0.82, -halfL - 0.01]);
    pb.build(this.body);
    this.rearAxleZ = rearAxleZ;
  }

  buildWheels(M, frontAxleZ, rearAxleZ) {
    const { tyre, rim } = wheelGeometries();
    this.frontPivots = [];
    this.wheels = [];
    const make = (x, z, dual, steer) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, this.spec.wheelRadius, z);
      const spinner = new THREE.Group();
      const side = Math.sign(x);
      const add = (geo, mat, dx, flip) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.x = dx;
        if (flip) m.rotation.y = Math.PI; // face the rim inward/outward
        m.castShadow = true;
        spinner.add(m);
      };
      // Outer wheel: rim faces outward (+X on the right side, -X on the left).
      const outer = dual ? side * 0.17 : 0;
      add(tyre, M.rubber, outer, false);
      add(rim, M.alu, outer, side < 0);
      if (dual) {
        add(tyre, M.rubber, -side * 0.17, false);
        add(rim, M.steel, -side * 0.17, side < 0);
      }
      pivot.add(spinner);
      this.root.add(pivot); // wheels don't roll with the body
      this.wheels.push(spinner);
      if (steer) this.frontPivots.push(pivot);
    };
    make(-1.03, frontAxleZ, false, true);
    make(1.03, frontAxleZ, false, true);
    for (const dz of [0.65, -0.65]) {
      make(-0.86, rearAxleZ + dz, true, false);
      make(0.86, rearAxleZ + dz, true, false);
    }
  }

  // ---------------------------------------------------------------- per frame
  /** Sync visuals with the physics state. */
  update(phys, input, dt) {
    this.root.position.set(phys.x, 0, phys.z);
    this.root.rotation.y = phys.heading;

    // Wheel spin and steering (visual steer is exaggerated slightly for readability).
    this.wheelSpin += (phys.speed / this.spec.wheelRadius) * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    for (const p of this.frontPivots) p.rotation.y = -phys.steerAngle * 1.1;

    // Suspension: damped springs for pitch, roll and heave. Driven by braking /
    // acceleration, cornering, surface bumps and impacts, so the body visibly
    // carries weight and settles with a little overshoot.
    const S = SUSPENSION;
    const pitchForce = THREE.MathUtils.clamp(-phys.accel * S.pitchPerAccel, -S.maxPitch, S.maxPitch);
    const rollForce = THREE.MathUtils.clamp(phys.latAccel * S.rollPerLat, -S.maxRoll, S.maxRoll);
    const bumpy = phys.surface === 'grass' ? Math.min(1, Math.abs(phys.speed) / 8) : 0;
    this.bumpTimer -= dt;
    if (bumpy > 0 && this.bumpTimer <= 0) {
      this.bumpTimer = 0.08 + Math.random() * 0.15;
      this.heaveVel += (Math.random() - 0.5) * S.bumpStrength * bumpy;
      this.rollVel += (Math.random() - 0.5) * S.bumpStrength * 0.6 * bumpy;
    }
    if (phys.lastImpact > 1) {
      this.pitchVel += Math.min(0.6, phys.lastImpact * 0.03) * Math.sign(phys.speed || 1);
      this.heaveVel += Math.min(0.8, phys.lastImpact * 0.05);
    }
    // Integrate the springs in small fixed steps so a long frame (a stutter,
    // a backgrounded tab) can never make them unstable.
    let remaining = Math.min(dt, 0.5);
    while (remaining > 1e-6) {
      const h = Math.min(remaining, 1 / 120);
      remaining -= h;
      const spring = (pos, vel, target) => {
        vel += (S.stiffness * (target - pos) - S.damping * vel) * h;
        return [pos + vel * h, vel];
      };
      [this.pitch, this.pitchVel] = spring(this.pitch, this.pitchVel, pitchForce);
      [this.roll, this.rollVel] = spring(this.roll, this.rollVel, rollForce);
      [this.heave, this.heaveVel] = spring(this.heave, this.heaveVel, 0);
    }
    this.body.rotation.x = this.pitch;
    this.body.rotation.z = this.roll;
    this.body.position.y = this.heave * 0.25;

    // Lights: brake lamps flare, reverse lamps light in R.
    this.braking = input.brake > 0;
    this.tailMat.emissiveIntensity = this.braking ? 4 : 0.35;
    this.reverseMat.emissiveIntensity = phys.gear === 'R' ? 3 : 0;
  }

  setShadowMode(realShadows) {
    this.blobShadow.visible = !realShadows;
  }

  /** Free GPU resources when swapping trucks (shared materials/wheel geometry stay). */
  dispose() {
    const { tyre, rim } = wheelGeometries();
    this.root.traverse((o) => {
      if (o.isMesh && o.geometry !== tyre && o.geometry !== rim) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}
