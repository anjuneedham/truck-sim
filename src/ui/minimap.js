// Small top-down minimap drawn on a 2D canvas. Roads are pre-rendered once to
// an offscreen canvas; each frame only blits it and draws the truck + target.
// The map rotates so "up" is always the truck's forward direction.

import { ROADS, LOTS } from '../game/mapData.js';
import { WORLD } from '../config.js';

const VIEW_RADIUS = 150; // metres shown from centre to edge

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = canvas.width;
    this.worldSize = WORLD.halfSize * 2;
    this.scale = this.size / 2 / VIEW_RADIUS; // px per metre

    // Pre-render the whole map at the display scale.
    const full = document.createElement('canvas');
    full.width = full.height = Math.ceil(this.worldSize * this.scale);
    const c = full.getContext('2d');
    const s = this.scale;
    const toPx = (v) => (v + WORLD.halfSize) * s;
    c.fillStyle = '#3d5a34';
    c.fillRect(0, 0, full.width, full.height);
    c.fillStyle = '#6a6d73';
    for (const r of Object.values(LOTS)) {
      c.fillRect(toPx(r[0]), toPx(r[1]), (r[2] - r[0]) * s, (r[3] - r[1]) * s);
    }
    c.strokeStyle = '#d7d9dc';
    c.lineWidth = WORLD.roadWidth * s;
    c.lineJoin = 'round';
    for (const road of ROADS) {
      c.beginPath();
      road.points.forEach(([x, z], i) => (i ? c.lineTo(toPx(x), toPx(z)) : c.moveTo(toPx(x), toPx(z))));
      if (road.closed) c.closePath();
      c.stroke();
    }
    this.mapImage = full;
  }

  draw(phys, target) {
    const { ctx, size, scale } = this;
    const half = size / 2;
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#2c3f27';
    ctx.fillRect(0, 0, size, size);

    // World -> minimap so the truck's forward (sin h, cos h) points up the
    // screen and its right side (-cos h, sin h) points right.
    ctx.translate(half, half);
    ctx.rotate(phys.heading);
    ctx.scale(-1, -1);
    ctx.translate(-phys.x * scale, -phys.z * scale);

    ctx.drawImage(this.mapImage, -WORLD.halfSize * scale, -WORLD.halfSize * scale);

    if (target) {
      ctx.fillStyle = '#44ff88';
      ctx.beginPath();
      ctx.arc(target.x * scale, target.z * scale, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Target direction indicator on the rim when off-screen.
    if (target) {
      const dx = target.x - phys.x;
      const dz = target.z - phys.z;
      const dist = Math.hypot(dx, dz);
      if (dist * scale > half - 8) {
        const h = phys.heading;
        const sx = (-dx * Math.cos(h) + dz * Math.sin(h)) / dist;
        const sy = -(dx * Math.sin(h) + dz * Math.cos(h)) / dist;
        const px = half + sx * (half - 8);
        const py = half + sy * (half - 8);
        ctx.fillStyle = '#44ff88';
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Truck arrow at the centre.
    ctx.fillStyle = '#ff5a4a';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(half, half - 9);
    ctx.lineTo(half + 6, half + 7);
    ctx.lineTo(half, half + 3);
    ctx.lineTo(half - 6, half + 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
