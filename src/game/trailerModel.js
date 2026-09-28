// Low-poly trailer models built from primitives, one builder per trailer type.
// Local space: origin at the kingpin, +Z forward. Operator branding is drawn on
// a small canvas texture (fictional names only).

import * as THREE from 'three';

const WHEEL_R = 0.5;
const brandCache = new Map();

/** Canvas texture with the operator name, shared per type. */
function brandTexture(text, bg, fg) {
  const key = text + bg + fg;
  if (brandCache.has(key)) return brandCache.get(key);
  // Wide canvas (about the panel's aspect ratio); text is sized to fit.
  const W = 1024;
  const H = 160;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#' + bg.toString(16).padStart(6, '0');
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#' + fg.toString(16).padStart(6, '0');
  const label = text.toUpperCase();
  let size = 110;
  g.font = `italic 900 ${size}px system-ui, sans-serif`;
  const width = g.measureText(label).width;
  if (width > W * 0.9) {
    size = Math.floor((size * W * 0.9) / width);
    g.font = `italic 900 ${size}px system-ui, sans-serif`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, W / 2, H / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  brandCache.set(key, tex);
  return tex;
}

export class TrailerModel {
  constructor(type) {
    this.type = type;
    this.root = new THREE.Group();
    this.disposables = [];
    const T = type;
    const front = T.kingpin; // front face z
    const rear = -(T.length - T.kingpin); // rear face z
    const midZ = (front + rear) / 2;
    const len = T.length;
    const deckY = 1.35;

    const mat = (color) => {
      const m = new THREE.MeshLambertMaterial({ color });
      this.disposables.push(m);
      return m;
    };
    const add = (geo, m, x, y, z, parent = this.root) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      this.disposables.push(geo);
      return mesh;
    };
    const box = (w, h, l, m, x, y, z) => add(new THREE.BoxGeometry(w, h, l), m, x, y, z);

    const bodyMat = mat(T.color);
    const accentMat = mat(T.accent);
    const darkMat = mat(0x2a2d31);
    const chromeMat = mat(0xb9bec4);

    // Chassis rails + landing legs
    box(1.1, 0.3, len - 0.3, darkMat, 0, deckY - 0.3, midZ);
    for (const sx of [-1, 1]) box(0.12, deckY - 0.2, 0.12, darkMat, sx * 0.9, (deckY - 0.2) / 2, -2.2);

    const sideBrand = (y, h, w) => {
      // Branded panels on both sides.
      const tex = brandTexture(T.operator, T.color, T.accent);
      const m = new THREE.MeshLambertMaterial({ map: tex });
      this.disposables.push(m);
      for (const sx of [-1, 1]) {
        const geo = new THREE.PlaneGeometry(len * 0.6, h);
        const p = add(geo, m, sx * (w / 2 + 0.01), y, midZ);
        p.rotation.y = sx * (Math.PI / 2);
        p.castShadow = false;
      }
    };

    if (T.id === 'box' || T.id === 'reefer') {
      const h = T.height - deckY;
      box(T.width, h, len, bodyMat, 0, deckY + h / 2, midZ);
      box(T.width + 0.02, 0.25, len, accentMat, 0, deckY + 0.2, midZ);
      sideBrand(deckY + h * 0.55, h * 0.4, T.width);
      if (T.id === 'reefer') {
        // Refrigeration unit on the front wall.
        box(1.9, 1.3, 0.55, mat(0xdfe3e8), 0, T.height - 0.9, front + 0.27);
        box(1.2, 0.7, 0.05, darkMat, 0, T.height - 0.9, front + 0.56);
      }
      box(T.width - 0.1, h - 0.1, 0.05, mat(0xd6d6d0), 0, deckY + h / 2, rear - 0.02); // rear doors
    } else if (T.id === 'flatbed') {
      box(T.width, 0.18, len, bodyMat, 0, deckY, midZ);
      // Load: bundled steel beams with straps.
      const steel = mat(0x7d858c);
      for (let i = 0; i < 3; i++) {
        box(0.6, 0.45, len - 2.2, steel, -0.75 + i * 0.75, deckY + 0.32, midZ);
        box(0.6, 0.45, len - 3.2, steel, -0.4 + (i % 2) * 0.75, deckY + 0.77, midZ);
      }
      for (let z = rear + 1.5; z < front - 1; z += 2.4) box(T.width + 0.04, 1.2, 0.08, accentMat, 0, deckY + 0.55, z);
    } else if (T.id === 'tanker') {
      const r = (T.height - deckY) / 2 + 0.25;
      const geo = new THREE.CylinderGeometry(r, r, len - 0.6, 14);
      geo.rotateX(Math.PI / 2);
      add(geo, mat(T.color), 0, deckY + r - 0.15, midZ - 0.1);
      box(0.3, 0.12, len - 1.5, accentMat, r - 0.05, deckY + r - 0.1, midZ); // stripe
      box(0.3, 0.12, len - 1.5, accentMat, -(r - 0.05), deckY + r - 0.1, midZ);
      box(0.8, 0.1, len * 0.5, darkMat, 0, deckY + 2 * r - 0.1, midZ); // walkway
      sideBrand(deckY + r - 0.15, 0.45, 2 * r + 0.02);
    } else {
      // Container on a skeletal chassis.
      const h = T.height - deckY - 0.05;
      const clen = len - 0.4;
      box(T.width, h, clen, bodyMat, 0, deckY + 0.05 + h / 2, midZ);
      const rib = mat(new THREE.Color(T.color).multiplyScalar(0.75).getHex());
      for (let z = midZ - clen / 2 + 0.5; z < midZ + clen / 2; z += 0.9) box(T.width + 0.04, h - 0.1, 0.12, rib, 0, deckY + 0.05 + h / 2, z);
      sideBrand(deckY + h * 0.6, h * 0.35, T.width + 0.1);
    }

    // Rear bumper + lights
    box(T.width - 0.1, 0.18, 0.12, darkMat, 0, 0.75, rear - 0.05);
    this.tailMat = new THREE.MeshBasicMaterial({ color: 0x661111 });
    this.disposables.push(this.tailMat);
    for (const sx of [-1, 1]) box(0.3, 0.2, 0.06, this.tailMat, sx * (T.width / 2 - 0.25), 0.95, rear - 0.12);

    // Tandem axle wheels
    const wgeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.7, 10);
    wgeo.rotateZ(Math.PI / 2);
    const tyre = mat(0x1b1b1b);
    this.wheels = [];
    for (const dz of [0.65, -0.65]) {
      for (const sx of [-1, 1]) {
        const w = add(wgeo, tyre, sx * 0.95, WHEEL_R, -T.kingpinToAxle + dz);
        this.wheels.push(w);
        box(0.05, 0.25, 0.05, chromeMat, sx * 1.3, WHEEL_R, -T.kingpinToAxle + dz); // hub cap
      }
    }

    // Blob shadow for low/medium quality.
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(T.width + 0.6, len + 0.6),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(0, 0.1, midZ);
    this.disposables.push(blob.geometry, blob.material);
    this.blobShadow = blob;
    this.root.add(blob);
    this.spin = 0;
  }

  /** Sync with physics. speed = rig speed (m/s), braking lights the tail lamps. */
  update(tp, speed, braking, dt) {
    this.root.position.set(tp.kx, 0, tp.kz);
    this.root.rotation.y = tp.heading;
    this.spin += (speed / WHEEL_R) * dt;
    for (const w of this.wheels) w.rotation.x = this.spin;
    this.tailMat.color.setHex(braking ? 0xff2020 : 0x661111);
  }

  setShadowMode(realShadows) {
    this.blobShadow.visible = !realShadows;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}
