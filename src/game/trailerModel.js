// Detailed procedural semi-trailers, one builder per trailer type:
// box van, refrigerated van, flatbed (with a load that matches the cargo),
// tanker and container chassis. Operator branding is painted onto canvas
// textures (fictional names only).
//
// Local space: origin at the kingpin, +Z forward. Parts are merged per
// material so each trailer costs roughly a dozen draw calls.

import * as THREE from 'three';
import { PartBuilder, latheX } from '../render/partBuilder.js';
import { trailerSide, trailerRear, containerSide, wood, grille, textPanel, plate } from '../render/textures.js';
import { wheelGeometries } from './truckModel.js';

const WHEEL_R = 0.52;
const std = (o) => new THREE.MeshStandardMaterial(o);

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  SHARED = {
    frame: std({ color: 0x17181a, metalness: 0.4, roughness: 0.6 }),
    alu: std({ color: 0xc9ced3, metalness: 0.9, roughness: 0.3 }),
    steel: std({ color: 0x6d7378, metalness: 0.7, roughness: 0.45 }),
    polished: std({ color: 0xe9edf0, metalness: 1, roughness: 0.14 }),
    rubber: std({ color: 0x141414, roughness: 0.92 }),
    black: std({ color: 0x0b0c0d, roughness: 0.8 }),
    amber: std({ color: 0x5a3200, emissive: 0xff9a1a, emissiveIntensity: 0.9, roughness: 0.3 }),
    strap: std({ color: 0xf2c230, roughness: 0.7 }),
    tapeRed: std({ color: 0xc81e24, roughness: 0.4, emissive: 0x400000, emissiveIntensity: 0.3 }),
    tapeWhite: std({ color: 0xf4f4f4, roughness: 0.4 }),
    ibeam: std({ color: 0x5f666c, metalness: 0.75, roughness: 0.4 }),
    machine: std({ color: 0xf0b20f, metalness: 0.3, roughness: 0.45 }),
    grille: std({ map: grille(false), metalness: 0.7, roughness: 0.35 }),
  };
  return SHARED;
}

export class TrailerModel {
  /**
   * @param {object} type trailer type (data/trailers.js)
   * @param {string} [cargoId] cargo carried (chooses the flatbed load)
   */
  constructor(type, cargoId = null) {
    this.type = type;
    this.root = new THREE.Group();
    this.disposables = [];
    const S = shared();
    const T = type;
    const front = T.kingpin;
    const rear = -(T.length - T.kingpin);
    const midZ = (front + rear) / 2;
    const len = T.length;
    const deckY = 1.35;
    const axleZ = -T.kingpinToAxle;

    const mat = (o) => {
      const m = std(o);
      this.disposables.push(m);
      return m;
    };
    this.tailMat = mat({ color: 0x3a0505, emissive: 0xff1a10, emissiveIntensity: 0.35, roughness: 0.3 });
    const bodyMat = mat({ color: T.color, metalness: 0.2, roughness: 0.45 });
    const accentMat = mat({ color: T.accent, metalness: 0.3, roughness: 0.4 });
    const plateMat = mat({ map: plate(`TR ${T.id.slice(0, 2).toUpperCase()} ${1000 + T.length * 97}`.slice(0, 11)) });
    const pb = new PartBuilder();

    // ---- Chassis: main beams, cross members, kingpin plate -----------------
    for (const sx of [-0.5, 0.5]) pb.box(0.14, 0.34, len - 0.4, S.frame, [sx, deckY - 0.3, midZ]);
    for (let z = rear + 0.6; z < front - 0.4; z += 1.2) pb.box(2.3, 0.08, 0.1, S.frame, [0, deckY - 0.13, z]);
    pb.box(2.2, 0.08, 2.2, S.steel, [0, deckY - 0.1, front - 1.1]);
    pb.cyl(0.05, 0.12, S.steel, [0, deckY - 0.2, 0], 'y', 8); // kingpin

    // ---- Landing gear ------------------------------------------------------
    const legZ = -2.3;
    for (const sx of [-0.9, 0.9]) {
      pb.box(0.14, deckY - 0.2, 0.14, S.steel, [sx, (deckY - 0.2) / 2 + 0.12, legZ]);
      pb.box(0.35, 0.05, 0.35, S.frame, [sx, 0.1, legZ]);
    }
    pb.box(1.8, 0.07, 0.07, S.steel, [0, 0.8, legZ], [0, 0, 0]);
    pb.box(0.05, 0.05, 0.4, S.alu, [1.08, 0.95, legZ + 0.1]); // crank

    // ---- Running gear: tandem axle housings, fenders, mudflaps -------------
    for (const dz of [0.65, -0.65]) pb.cyl(0.09, 2.0, S.steel, [0, WHEEL_R, axleZ + dz], 'x', 8);
    pb.box(1.6, 0.25, 2.4, S.frame, [0, deckY - 0.45, axleZ]); // suspension subframe
    for (const sx of [-1, 1]) pb.box(0.62, 0.62, 0.025, S.rubber, [sx * 0.95, 0.5, axleZ - 1.35]);

    // ---- Rear: underride bar, light bar, plate, tape -----------------------
    pb.box(2.3, 0.14, 0.12, S.alu, [0, 0.6, rear + 0.25]);
    for (const sx of [-0.8, 0.8]) pb.box(0.1, 0.7, 0.1, S.alu, [sx, 0.95, rear + 0.3]);
    for (let i = 0; i < 6; i++) pb.box(0.37, 0.1, 0.02, i % 2 ? S.tapeWhite : S.tapeRed, [-0.93 + i * 0.37, 0.6, rear + 0.18]);
    pb.box(2.46, 0.2, 0.12, S.frame, [0, deckY - 0.2, rear + 0.05]);
    for (const sx of [-1, 1]) {
      pb.box(0.3, 0.16, 0.05, this.tailMat, [sx * 0.95, deckY - 0.2, rear - 0.02]);
      pb.box(0.12, 0.12, 0.05, S.amber, [sx * 0.62, deckY - 0.2, rear - 0.02]);
    }
    pb.box(0.52, 0.13, 0.02, plateMat, [0, deckY - 0.45, rear + 0.04]);

    // ---- Body per type -----------------------------------------------------
    if (T.id === 'box' || T.id === 'reefer') this.buildVan(pb, S, bodyMat, T, front, rear, midZ, deckY, legZ, axleZ);
    else if (T.id === 'flatbed') this.buildFlatbed(pb, S, bodyMat, accentMat, T, front, rear, midZ, deckY, cargoId);
    else if (T.id === 'tanker') this.buildTanker(pb, S, accentMat, T, front, rear, midZ, deckY);
    else this.buildContainer(pb, S, T, front, rear, midZ, deckY);

    // Side marker lights along the bottom rail
    for (const sx of [-1, 1]) for (const z of [front - 0.4, midZ, rear + 0.4]) pb.box(0.03, 0.07, 0.12, S.amber, [sx * (T.width / 2 + 0.01), deckY - 0.05, z]);

    pb.build(this.root);

    // ---- Wheels (dual, tandem) ---------------------------------------------
    const { tyre, rim } = wheelGeometries();
    this.wheels = [];
    for (const dz of [0.65, -0.65]) {
      for (const side of [-1, 1]) {
        const spinner = new THREE.Group();
        spinner.position.set(side * 0.86, WHEEL_R, axleZ + dz);
        for (const [dx, m] of [
          [side * 0.17, S.alu],
          [-side * 0.17, S.steel],
        ]) {
          const t = new THREE.Mesh(tyre, S.rubber);
          t.position.x = dx;
          t.castShadow = true;
          const r = new THREE.Mesh(rim, m);
          r.position.x = dx;
          if (side < 0) r.rotation.y = Math.PI;
          spinner.add(t, r);
        }
        this.root.add(spinner);
        this.wheels.push(spinner);
      }
    }

    // Blob shadow for low quality.
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(T.width + 0.6, len + 0.6),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(0, 0.1, midZ);
    this.disposables.push(blob.geometry, blob.material);
    this.blobShadow = blob;
    this.root.add(blob);
    this.spin = 0;
  }

  /** Dry van / reefer: branded ribbed box, rear doors, skirts, reefer unit. */
  buildVan(pb, S, bodyMat, T, front, rear, midZ, deckY, legZ, axleZ) {
    const h = T.height - deckY;
    const sideMat = std({ map: trailerSide(T.operator, T.color, T.accent), roughness: 0.4, metalness: 0.15 });
    const rearMat = std({ map: trailerRear(T.color), roughness: 0.45, metalness: 0.15 });
    this.disposables.push(sideMat, rearMat);
    const box = new THREE.Mesh(new THREE.BoxGeometry(T.width, h, T.length), [sideMat, sideMat, bodyMat, S.frame, bodyMat, rearMat]);
    box.position.set(0, deckY + h / 2, midZ);
    box.castShadow = box.receiveShadow = true;
    this.root.add(box);
    this.disposables.push(box.geometry);
    // Aluminium rails and corner posts
    for (const sx of [-1, 1]) {
      pb.box(0.05, 0.1, T.length, S.alu, [sx * (T.width / 2 + 0.01), T.height - 0.05, midZ]);
      pb.box(0.05, 0.14, T.length, S.alu, [sx * (T.width / 2 + 0.01), deckY + 0.07, midZ]);
      for (const z of [front, rear]) pb.box(0.08, h, 0.08, S.alu, [sx * (T.width / 2), deckY + h / 2, z]);
      // Aero side skirts between landing gear and the axles
      const skL = legZ - (axleZ + 1.1);
      pb.box(0.03, 0.62, skL - 0.3, bodyMat, [sx * (T.width / 2 - 0.05), deckY - 0.45, (legZ + axleZ + 1.1) / 2]);
    }
    if (T.id === 'reefer') {
      // Refrigeration unit on the front wall with grille and fuel tank below.
      const unitMat = std({ color: 0xe4e8ec, roughness: 0.4, metalness: 0.3 });
      const badge = std({ map: textPanel('POLAR', { bg: 0x3bb4e6, fg: 0xffffff, w: 256, h: 64, border: null }) });
      this.disposables.push(unitMat, badge);
      pb.rbox(2.05, 1.5, 0.55, 0.08, unitMat, [0, T.height - 1.0, front + 0.28]);
      pb.box(1.4, 0.8, 0.03, S.grille, [0, T.height - 1.0, front + 0.56]);
      pb.box(0.6, 0.15, 0.02, badge, [0, T.height - 0.4, front + 0.56]);
      pb.box(0.6, 0.35, 0.4, S.alu, [-0.7, deckY - 0.45, -3.4]);
    }
  }

  /** Flatbed: timber deck, stake pockets and a strapped load chosen by cargo. */
  buildFlatbed(pb, S, bodyMat, accentMat, T, front, rear, midZ, deckY, cargoId) {
    const deckTex = wood().map.clone();
    deckTex.needsUpdate = true;
    deckTex.repeat.set(1, T.length / 2);
    const deckMat = std({ map: deckTex, roughness: 0.85 });
    this.disposables.push(deckMat, deckTex);
    pb.box(T.width, 0.1, T.length, deckMat, [0, deckY + 0.05, midZ]);
    for (const sx of [-1, 1]) {
      pb.box(0.08, 0.26, T.length, bodyMat, [sx * (T.width / 2), deckY - 0.03, midZ]);
      for (let z = rear + 0.6; z < front; z += 0.9) pb.box(0.1, 0.1, 0.08, S.steel, [sx * (T.width / 2 + 0.04), deckY - 0.02, z]);
    }
    pb.box(T.width, 1.0, 0.12, bodyMat, [0, deckY + 0.55, front - 0.1]); // headboard
    const top = deckY + 0.1;
    const loadLen = T.length - 1.6;
    const loadZ = midZ - 0.2;
    let loadH = 0.9;
    if (cargoId === 'lumber') {
      const woodMat = std({ map: wood().map, roughness: 0.9 });
      this.disposables.push(woodMat);
      for (const [x, y] of [[-0.62, 0], [0.62, 0], [-0.62, 0.62], [0.62, 0.62]]) pb.box(1.2, 0.58, loadLen, woodMat, [x, top + 0.3 + y, loadZ]);
      loadH = 1.25;
    } else if (cargoId === 'machinery') {
      // A tracked machine chained down.
      const m = S.machine;
      pb.box(2.2, 0.55, 4.2, S.black, [0, top + 0.28, loadZ]); // tracks
      pb.rbox(2.0, 1.1, 3.0, 0.12, m, [0, top + 1.1, loadZ - 0.3]);
      pb.rbox(1.1, 1.4, 1.3, 0.1, m, [-0.35, top + 2.3, loadZ + 0.3]);
      const cabGlass = std({ color: 0x10171e, metalness: 0.3, roughness: 0.05 });
      this.disposables.push(cabGlass);
      pb.box(1.02, 0.9, 1.22, cabGlass, [-0.35, top + 2.45, loadZ + 0.3]);
      pb.rbox(0.45, 0.45, 3.6, 0.08, m, [0.45, top + 1.9, loadZ + 2.0], [-0.35, 0, 0]);
      loadH = 3;
    } else {
      // Steel I-beams in two bundled layers.
      const I = new THREE.Shape();
      const w = 0.3;
      const h = 0.36;
      const t = 0.04;
      [[-w / 2, 0], [w / 2, 0], [w / 2, t], [t / 2, t], [t / 2, h - t], [w / 2, h - t], [w / 2, h], [-w / 2, h], [-w / 2, h - t], [-t / 2, h - t], [-t / 2, t], [-w / 2, t]].forEach(
        ([x, y], i) => (i ? I.lineTo(x, y) : I.moveTo(x, y))
      );
      const beam = new THREE.ExtrudeGeometry(I, { depth: loadLen, bevelEnabled: false }).translate(0, 0, -loadLen / 2);
      for (let layer = 0; layer < 2; layer++) {
        for (let i = 0; i < 6; i++) pb.add(beam, S.ibeam, [-0.8 + i * 0.32, top + 0.08 + layer * 0.42, loadZ]);
        pb.box(2.0, 0.07, loadLen, S.frame, [0, top + 0.03 + layer * 0.42, loadZ]); // dunnage
      }
      loadH = 0.92;
    }
    // Ratchet straps over the load
    for (let z = rear + 1.4; z < front - 1; z += 2.2) pb.box(T.width + 0.06, loadH + 0.04, 0.06, S.strap, [0, top + loadH / 2, z], [0, 0, 0]);
  }

  /** Tanker: polished oval barrel with domed ends, walkway, ladder, placard. */
  buildTanker(pb, S, accentMat, T, front, rear, midZ, deckY) {
    const r = 1.05;
    const L = T.length - 0.5;
    const half = L / 2;
    // Profile along X (then rotated to Z): domed ends.
    const prof = [];
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      prof.push([Math.sin(a) * r, -half + (1 - Math.cos(a)) * 0.45]);
    }
    for (let i = 6; i >= 0; i--) {
      const a = (i / 6) * (Math.PI / 2);
      prof.push([Math.sin(a) * r, half - (1 - Math.cos(a)) * 0.45]);
    }
    const tank = latheX(prof, 28);
    pb.add(tank, S.polished, [0, deckY + r * 0.88 - 0.05, midZ - 0.1], [0, Math.PI / 2, 0], [1, 0.88, 1]);
    // Accent bands + walkway + handrail + ladder
    for (const z of [midZ - half + 1.2, midZ, midZ + half - 1.2]) pb.cyl(r + 0.02, 0.12, accentMat, [0, deckY + r * 0.88 - 0.05, z], 'z', 28);
    const topY = deckY + r * 1.76 - 0.05;
    pb.box(0.6, 0.05, L * 0.7, S.alu, [0, topY + 0.03, midZ]);
    for (const sx of [-0.35, 0.35]) {
      pb.box(0.04, 0.04, L * 0.7, S.alu, [sx, topY + 0.8, midZ]);
      for (let z = midZ - L * 0.33; z <= midZ + L * 0.34; z += 1.4) pb.box(0.04, 0.8, 0.04, S.alu, [sx, topY + 0.4, z]);
    }
    for (let i = 0; i < 3; i++) pb.cyl(0.25, 0.18, S.steel, [0, topY + 0.1, midZ - 2 + i * 2], 'y', 12); // manholes
    for (const sx of [-0.3, 0.3]) pb.box(0.05, topY - deckY + 0.2, 0.05, S.alu, [sx, deckY + (topY - deckY) / 2, rear + 0.2]);
    for (let y = deckY + 0.2; y < topY; y += 0.35) pb.box(0.62, 0.04, 0.05, S.alu, [0, y, rear + 0.2]);
    // Hazmat placard + valve box
    const placard = std({ map: textPanel('1202', { bg: 0xf08a24, fg: 0x111111, w: 256, h: 128, border: 0x111111, font: '900' }) });
    this.disposables.push(placard);
    for (const sx of [-1, 1]) pb.box(0.02, 0.35, 0.7, placard, [sx * (r + 0.03), deckY + 0.9, midZ + 1.5]);
    pb.box(0.5, 0.35, 0.02, placard, [0, deckY + 0.9, rear + 0.33]);
    pb.box(1.4, 0.4, 0.6, S.steel, [0, deckY - 0.3, midZ]);
  }

  /** Container on a skeletal chassis: corrugated box, corner castings, doors. */
  buildContainer(pb, S, T, front, rear, midZ, deckY) {
    const h = T.height - deckY - 0.05;
    const clen = T.length - 0.3;
    const sideMat = std({ map: containerSide(T.operator, T.color), roughness: 0.55, metalness: 0.4 });
    const endMat = std({ map: trailerRear(new THREE.Color(T.color).multiplyScalar(0.85).getHex()), roughness: 0.55, metalness: 0.4 });
    const topMat = std({ color: T.color, roughness: 0.6, metalness: 0.4 });
    this.disposables.push(sideMat, endMat, topMat);
    const box = new THREE.Mesh(new THREE.BoxGeometry(T.width, h, clen), [sideMat, sideMat, topMat, S.frame, topMat, endMat]);
    box.position.set(0, deckY + 0.05 + h / 2, midZ);
    box.castShadow = box.receiveShadow = true;
    this.root.add(box);
    this.disposables.push(box.geometry);
    // Corner castings
    for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const z of [midZ - clen / 2, midZ + clen / 2]) pb.box(0.2, 0.14, 0.2, S.frame, [sx * (T.width / 2 - 0.05), deckY + 0.12 + sy * (h - 0.12), z]);
    // Twist locks on the skeletal frame
    for (const sx of [-1, 1]) for (const z of [midZ - clen / 2 + 0.2, midZ + clen / 2 - 0.2]) pb.box(0.14, 0.1, 0.14, S.steel, [sx * 1.1, deckY, z]);
  }

  /** Sync with physics. speed = rig speed (m/s), braking lights the tail lamps. */
  update(tp, speed, braking, dt) {
    this.root.position.set(tp.kx, 0, tp.kz);
    this.root.rotation.y = tp.heading;
    this.spin += (speed / WHEEL_R) * dt;
    for (const w of this.wheels) w.rotation.x = this.spin;
    this.tailMat.emissiveIntensity = braking ? 4 : 0.35;
  }

  setShadowMode(realShadows) {
    this.blobShadow.visible = !realShadows;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh && !this.disposables.includes(o.geometry) && o.geometry !== wheelGeometries().tyre && o.geometry !== wheelGeometries().rim) o.geometry.dispose();
    });
    for (const d of this.disposables) d.dispose();
  }
}
