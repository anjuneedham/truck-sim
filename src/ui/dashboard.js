// Analog instrument cluster: tachometer + speedometer dials drawn on canvas.
// Dial faces (ticks, numbers, zones) are rendered once to offscreen canvases;
// each frame only the needles are drawn, and only when the value changed.

const TAU = Math.PI * 2;
const START = Math.PI * 0.75; // dial sweep: 135deg -> 405deg (270deg)
const SWEEP = Math.PI * 1.5;

function dialFace(size, { max, step, labelStep, label, redFrom, unit, dpr }) {
  const c = document.createElement('canvas');
  c.width = c.height = size * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const r = size / 2;
  g.translate(r, r);
  // Bezel + face
  const bez = g.createRadialGradient(0, 0, r * 0.6, 0, 0, r);
  bez.addColorStop(0, '#15191e');
  bez.addColorStop(0.92, '#1c2127');
  bez.addColorStop(1, '#4a525c');
  g.fillStyle = bez;
  g.beginPath();
  g.arc(0, 0, r - 1, 0, TAU);
  g.fill();
  // Red zone
  if (redFrom !== undefined) {
    g.strokeStyle = 'rgba(255,70,55,0.85)';
    g.lineWidth = r * 0.07;
    g.beginPath();
    g.arc(0, 0, r * 0.8, START + (redFrom / max) * SWEEP, START + SWEEP);
    g.stroke();
  }
  // Ticks
  for (let v = 0; v <= max + 1e-6; v += step) {
    const a = START + (v / max) * SWEEP;
    const major = Math.abs(v / labelStep - Math.round(v / labelStep)) < 1e-6;
    const r0 = r * (major ? 0.7 : 0.76);
    g.strokeStyle = major ? '#f2f4f7' : 'rgba(242,244,247,0.55)';
    g.lineWidth = major ? 2 : 1;
    g.beginPath();
    g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    g.lineTo(Math.cos(a) * r * 0.84, Math.sin(a) * r * 0.84);
    g.stroke();
    if (major) {
      g.fillStyle = '#f2f4f7';
      g.font = `600 ${r * 0.17}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label(v), Math.cos(a) * r * 0.54, Math.sin(a) * r * 0.54);
    }
  }
  g.fillStyle = 'rgba(242,244,247,0.6)';
  g.font = `600 ${r * 0.13}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillText(unit, 0, r * 0.6);
  return c;
}

export class Dashboard {
  constructor(tachoCanvas, speedoCanvas) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.tacho = this.setup(tachoCanvas, { max: 2500, step: 100, labelStep: 500, label: (v) => String(v / 1000), redFrom: 2100, unit: 'x1000 rpm' });
    this.speedo = this.setup(speedoCanvas, { max: 120, step: 5, labelStep: 20, label: (v) => String(v), unit: 'km/h' });
    this.last = { rpm: -1, kmh: -1 };
  }

  setup(canvas, opts) {
    const size = canvas.clientWidth || 110;
    canvas.width = canvas.height = size * this.dpr;
    const face = dialFace(size, { ...opts, dpr: this.dpr });
    return { canvas, ctx: canvas.getContext('2d'), face, size, max: opts.max };
  }

  drawDial(d, value) {
    const { ctx, face, size, max } = d;
    const r = size / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, d.canvas.width, d.canvas.height);
    ctx.drawImage(face, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, r * this.dpr, r * this.dpr);
    const a = START + Math.min(1.02, Math.max(0, value / max)) * SWEEP;
    ctx.strokeStyle = '#ff5a3c';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-Math.cos(a) * r * 0.12, -Math.sin(a) * r * 0.12);
    ctx.lineTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
    ctx.stroke();
    ctx.fillStyle = '#2a3038';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.1, 0, TAU);
    ctx.fill();
  }

  /** @param {number} rpm engine rpm @param {number} kmh road speed */
  update(rpm, kmh) {
    if (Math.abs(rpm - this.last.rpm) > 8) {
      this.drawDial(this.tacho, rpm);
      this.last.rpm = rpm;
    }
    if (Math.abs(kmh - this.last.kmh) > 0.2) {
      this.drawDial(this.speedo, kmh);
      this.last.kmh = kmh;
    }
  }
}
