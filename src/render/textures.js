// Procedural textures drawn on canvases at startup (no image downloads).
// Everything is seeded, so the world looks the same every run.
//
// Colour maps are sRGB; normal maps are derived from a height field so
// asphalt, concrete, corrugated metal etc. catch the low sun.

import * as THREE from 'three';

const cache = new Map();
const allTextures = [];

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Tileable fractal value noise into a Float32Array (0..1). */
function fractalNoise(size, seed, octaves = 4, baseCells = 4, persistence = 0.5) {
  const out = new Float32Array(size * size);
  const r = rng(seed);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells << o;
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = r();
    const scale = cells / size;
    for (let y = 0; y < size; y++) {
      const gy = y * scale;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      const y1 = (y0 + 1) % cells;
      for (let x = 0; x < size; x++) {
        const gx = x * scale;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const x1 = (x0 + 1) % cells;
        const a = grid[y0 * cells + x0];
        const b = grid[y0 * cells + x1];
        const c = grid[y1 * cells + x0];
        const d = grid[y1 * cells + x1];
        out[y * size + x] += (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * amp;
      }
    }
    total += amp;
    amp *= persistence;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, { srgb = true, repeat = [1, 1], wrap = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  allTextures.push(t);
  return t;
}

/** Normal map from a height field (strength = bump height in pixels). */
function normalFromHeight(h, w, hgt, strength = 2) {
  const c = canvas(w, hgt);
  const g = c.getContext('2d');
  const img = g.createImageData(w, hgt);
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const l = h[y * w + ((x - 1 + w) % w)];
      const r = h[y * w + ((x + 1) % w)];
      const u = h[((y - 1 + hgt) % hgt) * w + x];
      const d = h[((y + 1) % hgt) * w + x];
      let nx = (l - r) * strength;
      let ny = (u - d) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function memo(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/** Apply GPU anisotropic filtering to every generated texture (sharper roads at grazing angles). */
export function setAnisotropy(n) {
  for (const t of allTextures) {
    t.anisotropy = n;
    t.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- ground

/**
 * Asphalt for a two-lane road. u runs along the road (tiles), v spans the full
 * width: darker tyre-wear bands in each lane, fine aggregate speckle, patches.
 */
export function asphalt() {
  return memo('asphalt', () => {
    const W = 512;
    const H = 512;
    const n1 = fractalNoise(W, 11, 5, 4, 0.55);
    const n2 = fractalNoise(W, 12, 3, 16, 0.5);
    const c = canvas(W, H);
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const r = rng(99);
    const height = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const v = y / H; // across the road
      // Tyre tracks at lane centres +- ~1 m (road 16 m => 1 m = 1/16).
      let wear = 0;
      for (const lc of [0.25, 0.75]) {
        for (const off of [-0.07, 0.07]) {
          const d = (v - (lc + off)) / 0.035;
          wear += Math.exp(-d * d);
        }
      }
      // Slightly lighter, dustier edges.
      const edge = Math.max(0, 1 - Math.min(v, 1 - v) / 0.06);
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const speck = r();
        let l = 58 + (n1[i] - 0.5) * 26 + (n2[i] - 0.5) * 18 - wear * 7 + edge * 10;
        if (speck > 0.93) l += 22 * (speck - 0.93) / 0.07;
        if (speck < 0.04) l -= 14;
        const p = i * 4;
        img.data[p] = l * 0.98;
        img.data[p + 1] = l;
        img.data[p + 2] = l * 1.04;
        img.data[p + 3] = 255;
        height[i] = n2[i] * 0.6 + speck * 0.4;
      }
    }
    g.putImageData(img, 0, 0);
    return { map: finish(c), normalMap: finish(normalFromHeight(height, W, H, 2.2), { srgb: false }) };
  });
}

export function grass() {
  return memo('grass', () => {
    const W = 512;
    const n = fractalNoise(W, 21, 5, 4, 0.6);
    const m = fractalNoise(W, 22, 3, 32, 0.5);
    const c = canvas(W);
    const g = c.getContext('2d');
    const img = g.createImageData(W, W);
    for (let i = 0; i < W * W; i++) {
      const t = n[i];
      const d = m[i];
      const p = i * 4;
      img.data[p] = 78 + t * 34 + d * 16;
      img.data[p + 1] = 96 + t * 36 + d * 16;
      img.data[p + 2] = 52 + t * 16;
      img.data[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // Blades: short strokes of lighter/darker green.
    const r = rng(23);
    for (let k = 0; k < 9000; k++) {
      const x = r() * W;
      const y = r() * W;
      const lum = r();
      g.strokeStyle = `rgba(${70 + lum * 60},${90 + lum * 60},${45 + lum * 25},0.35)`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4);
      g.stroke();
    }
    return { map: finish(c) };
  });
}

/** Concrete slab with expansion joints every `slab` pixels, stains and pores. */
export function concrete(tint = 0xb8b6b0) {
  return memo('concrete' + tint, () => {
    const W = 512;
    const n = fractalNoise(W, 31, 5, 4, 0.55);
    const s = fractalNoise(W, 32, 2, 3, 0.5);
    const c = canvas(W);
    const g = c.getContext('2d');
    const img = g.createImageData(W, W);
    const base = new THREE.Color(tint);
    const r = rng(33);
    const height = new Float32Array(W * W);
    for (let i = 0; i < W * W; i++) {
      const x = i % W;
      const y = (i / W) | 0;
      const joint = x % 256 < 2 || y % 256 < 2 ? 0.55 : 1;
      const stain = 0.94 + s[i] * 0.1;
      const pore = r() < 0.006 ? 0.88 : 1;
      const l = (0.82 + n[i] * 0.3) * joint * stain * pore;
      const p = i * 4;
      img.data[p] = base.r * 255 * l;
      img.data[p + 1] = base.g * 255 * l;
      img.data[p + 2] = base.b * 255 * l;
      img.data[p + 3] = 255;
      height[i] = joint < 1 ? 0 : 0.5 + n[i] * 0.3 + (pore < 1 ? -0.4 : 0);
    }
    g.putImageData(img, 0, 0);
    return { map: finish(c), normalMap: finish(normalFromHeight(height, W, W, 1.5), { srgb: false }) };
  });
}

export function gravel() {
  return memo('gravel', () => {
    const W = 256;
    const n = fractalNoise(W, 41, 4, 8, 0.6);
    const c = canvas(W);
    const g = c.getContext('2d');
    const img = g.createImageData(W, W);
    const r = rng(42);
    for (let i = 0; i < W * W; i++) {
      const l = 0.6 + n[i] * 0.35 + (r() - 0.5) * 0.25;
      const p = i * 4;
      img.data[p] = 150 * l;
      img.data[p + 1] = 138 * l;
      img.data[p + 2] = 118 * l;
      img.data[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return { map: finish(c) };
  });
}

/** Worn road paint: white with noisy alpha (use as alphaMap-like colour map). */
export function wornPaint() {
  return memo('paint', () => {
    const W = 256;
    const n = fractalNoise(W, 51, 4, 8, 0.6);
    const c = canvas(W);
    const g = c.getContext('2d');
    const img = g.createImageData(W, W);
    for (let i = 0; i < W * W; i++) {
      const a = n[i] > 0.28 ? 255 : 90;
      const p = i * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = 235 + n[i] * 20;
      img.data[p + 3] = a;
    }
    g.putImageData(img, 0, 0);
    return finish(c);
  });
}

// ---------------------------------------------------------------- buildings

/**
 * Facade with a grid of windows. One texture tile = one bay (3.5 m wide,
 * 3.5 m floor). Kinds: office (glass), brick (apartments), industrial.
 */
export function facade(kind) {
  return memo('facade-' + kind, () => {
    const W = 256;
    const H = 256;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    const r = rng(kind.length * 97);
    const n = fractalNoise(W, kind.length * 13, 4, 4, 0.55);
    // Wall
    const wall = { office: [150, 158, 166], brick: [150, 78, 58], industrial: [176, 170, 158], plaster: [214, 204, 186] }[kind];
    const img = g.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const x = i % W;
      const y = (i / W) | 0;
      let l = 0.9 + n[i] * 0.2;
      if (kind === 'brick') {
        const row = (y / 12) | 0;
        const off = row % 2 ? 12 : 0;
        if (y % 12 < 2 || (x + off) % 24 < 2) l *= 0.72;
      }
      const p = i * 4;
      img.data[p] = wall[0] * l;
      img.data[p + 1] = wall[1] * l;
      img.data[p + 2] = wall[2] * l;
      img.data[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // Window
    const wx = kind === 'office' ? 14 : 48;
    const wy = kind === 'office' ? 30 : 60;
    const ww = W - wx * 2;
    const wh = H - wy * 2 + (kind === 'office' ? 30 : 0);
    const sky = g.createLinearGradient(0, wy, 0, wy + wh);
    const lit = r() < 0.2;
    sky.addColorStop(0, lit ? '#e8d6a0' : '#8fb3cf');
    sky.addColorStop(0.55, lit ? '#b89660' : '#3d5670');
    sky.addColorStop(1, lit ? '#8a6a40' : '#1c2a38');
    g.fillStyle = '#2b2f33';
    g.fillRect(wx - 5, wy - 5, ww + 10, wh + 10); // frame
    g.fillStyle = sky;
    g.fillRect(wx, wy, ww, wh);
    g.fillStyle = 'rgba(40,44,48,0.9)';
    g.fillRect(W / 2 - 3, wy, 6, wh); // mullion
    if (kind !== 'office') g.fillRect(wx, wy + wh * 0.45, ww, 5); // transom
    // Sill
    g.fillStyle = kind === 'brick' ? '#c9c2b4' : '#6d7277';
    g.fillRect(wx - 8, wy + wh + 5, ww + 16, 7);
    if (kind === 'office') {
      g.fillStyle = 'rgba(120,130,140,0.9)';
      g.fillRect(0, H - 22, W, 22); // spandrel band
    }
    return { map: finish(c) };
  });
}

/** Vertical corrugated metal cladding (industrial buildings, containers). */
export function corrugated(color, key = '') {
  return memo('corr' + color + key, () => {
    const W = 256;
    const n = fractalNoise(W, 61, 4, 4, 0.55);
    const c = canvas(W);
    const g = c.getContext('2d');
    const img = g.createImageData(W, W);
    const base = new THREE.Color(color);
    const height = new Float32Array(W * W);
    for (let i = 0; i < W * W; i++) {
      const x = i % W;
      const wave = Math.sin((x / W) * Math.PI * 2 * 16);
      const l = (0.86 + wave * 0.1 + (n[i] - 0.5) * 0.18) * (n[i] < 0.3 ? 0.9 : 1);
      const p = i * 4;
      img.data[p] = Math.min(255, base.r * 255 * l);
      img.data[p + 1] = Math.min(255, base.g * 255 * l);
      img.data[p + 2] = Math.min(255, base.b * 255 * l);
      img.data[p + 3] = 255;
      height[i] = wave * 0.5 + 0.5;
    }
    g.putImageData(img, 0, 0);
    return { map: finish(c), normalMap: finish(normalFromHeight(height, W, W, 3), { srgb: false }) };
  });
}

/** Loading dock wall: corrugated cladding with roller doors along the bottom. */
export function dockWall(color) {
  return memo('dock' + color, () => {
    const W = 512;
    const H = 256;
    const base = corrugated(color).map.image;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.drawImage(base, 0, 0, W / 2, H);
    g.drawImage(base, W / 2, 0, W / 2, H);
    // Two roller doors per tile.
    for (const x0 of [40, 296]) {
      g.fillStyle = '#3a3d40';
      g.fillRect(x0 - 6, 70, 188, 186);
      for (let y = 76; y < H; y += 9) {
        g.fillStyle = y % 18 ? '#9aa0a5' : '#8a9095';
        g.fillRect(x0, y, 176, 8);
      }
      g.fillStyle = '#f2c230';
      g.fillRect(x0 - 6, 64, 188, 6); // warning strip
    }
    return { map: finish(c) };
  });
}

/** Flat sign with text (facility names, road signs). */
export function textPanel(text, { bg = 0x1d4f8c, fg = 0xffffff, w = 1024, h = 256, border = 0xffffff, font = 'bold' } = {}) {
  return memo(`text:${text}:${bg}:${fg}:${w}x${h}`, () => {
    const c = canvas(w, h);
    const g = c.getContext('2d');
    g.fillStyle = hex(bg);
    g.fillRect(0, 0, w, h);
    if (border !== null) {
      g.strokeStyle = hex(border);
      g.lineWidth = h * 0.05;
      g.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12);
    }
    g.fillStyle = hex(fg);
    let size = h * 0.5;
    g.font = `${font} ${size}px system-ui, sans-serif`;
    const tw = g.measureText(text).width;
    if (tw > w * 0.86) {
      size *= (w * 0.86) / tw;
      g.font = `${font} ${size}px system-ui, sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + size * 0.05);
    return finish(c, { wrap: false });
  });
}

// ---------------------------------------------------------------- vehicles

/**
 * Semi-trailer side panel: white panels with seams and rivets, the operator
 * logo, and red/white reflective tape along the bottom.
 */
export function trailerSide(operator, bg, accent, { tape = true, panels = true } = {}) {
  return memo(`tside:${operator}:${bg}:${accent}:${tape}:${panels}`, () => {
    const W = 1024;
    const H = 256;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    const n = fractalNoise(256, 71, 3, 4, 0.5);
    const base = new THREE.Color(bg);
    // Base with faint dirt towards the bottom
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const dirt = Math.max(0, (y / H - 0.6) / 0.4) * 0.12;
      for (let x = 0; x < W; x++) {
        const l = 1 - dirt - (n[(y % 256) * 256 + (x % 256)] - 0.5) * 0.05;
        const p = (y * W + x) * 4;
        img.data[p] = base.r * 255 * l;
        img.data[p + 1] = base.g * 255 * l;
        img.data[p + 2] = base.b * 255 * l;
        img.data[p + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    if (panels) {
      // Panel seams + rivet lines
      for (let x = 0; x <= W; x += 64) {
        g.fillStyle = 'rgba(0,0,0,0.16)';
        g.fillRect(x, 0, 2, H);
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(x + 2, 0, 1, H);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        for (let y = 6; y < H; y += 12) g.fillRect(x + 5, y, 2, 2);
      }
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, 0, W, 5);
      g.fillRect(0, H - 8, W, 8);
    }
    // Logo band
    g.fillStyle = hex(accent);
    g.fillRect(0, H * 0.62, W, H * 0.07);
    g.font = `italic 900 ${H * 0.3}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = H * 0.3;
    const tw = g.measureText(operator.toUpperCase()).width;
    if (tw > W * 0.8) {
      size *= (W * 0.8) / tw;
      g.font = `italic 900 ${size}px system-ui, sans-serif`;
    }
    g.fillStyle = hex(accent);
    g.fillText(operator.toUpperCase(), W / 2, H * 0.36);
    if (tape) {
      // Conspicuity tape: alternating red/white
      for (let x = 0; x < W; x += 36) {
        g.fillStyle = (x / 36) % 2 ? '#f4f4f4' : '#d8262a';
        g.fillRect(x, H - 22, 36, 10);
      }
    }
    return finish(c, { wrap: false });
  });
}

/** Shipping container side: corrugated steel with the line's name stencilled on. */
export function containerSide(operator, color) {
  return memo(`cside:${operator}:${color}`, () => {
    const W = 1024;
    const H = 256;
    const base = corrugated(color).map.image;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    for (let x = 0; x < W; x += 256) g.drawImage(base, x, 0, 256, H);
    g.fillStyle = 'rgba(255,255,255,0.88)';
    let size = H * 0.26;
    g.font = `900 ${size}px system-ui, sans-serif`;
    const tw = g.measureText(operator.toUpperCase()).width;
    if (tw > W * 0.7) {
      size *= (W * 0.7) / tw;
      g.font = `900 ${size}px system-ui, sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(operator.toUpperCase(), W / 2, H * 0.42);
    g.font = `700 ${H * 0.07}px ui-monospace, monospace`;
    g.textAlign = 'left';
    g.fillText('HRLU 204817 4   45G1', W * 0.05, H * 0.12);
    return finish(c, { wrap: false });
  });
}

/** Rear doors of a box trailer: two leaves, hinges, lock rods, tape. */
export function trailerRear(bg) {
  return memo('trear' + bg, () => {
    const W = 256;
    const H = 256;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = hex(bg);
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(W / 2 - 2, 0, 4, H); // door split
    g.fillRect(0, 0, W, 6);
    g.fillRect(0, 0, 6, H);
    g.fillRect(W - 6, 0, 6, H);
    // Lock rods
    g.fillStyle = '#9ba1a6';
    for (const x of [40, 96, 160, 216]) g.fillRect(x - 3, 8, 6, H - 16);
    g.fillStyle = '#6f757a';
    for (const x of [40, 96, 160, 216]) {
      g.fillRect(x - 10, H * 0.55, 20, 8); // handles
    }
    // Hinges
    for (const y of [30, 110, 190]) {
      g.fillRect(6, y, 16, 10);
      g.fillRect(W - 22, y, 16, 10);
    }
    // Tape
    for (let x = 0; x < W; x += 32) {
      g.fillStyle = (x / 32) % 2 ? '#f4f4f4' : '#d8262a';
      g.fillRect(x, H - 18, 32, 10);
      g.fillRect(x, 12, 32, 6);
    }
    return finish(c, { wrap: false });
  });
}

/** Horizontal wooden planks (flatbed decks, pallets, lumber). */
export function wood() {
  return memo('wood', () => {
    const W = 256;
    const n = fractalNoise(W, 81, 4, 4, 0.5);
    const c = canvas(W);
    const g = c.getContext('2d');
    const img = g.createImageData(W, W);
    for (let i = 0; i < W * W; i++) {
      const x = i % W;
      const y = (i / W) | 0;
      const plank = (y / 32) | 0;
      const grain = Math.sin((x / W) * 40 + n[i] * 8 + plank * 3) * 0.08;
      const gap = y % 32 < 2 ? 0.45 : 1;
      const l = (0.8 + grain + (plank % 3) * 0.05) * gap;
      const p = i * 4;
      img.data[p] = 150 * l;
      img.data[p + 1] = 108 * l;
      img.data[p + 2] = 70 * l;
      img.data[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return { map: finish(c) };
  });
}

/** Radiator grille: horizontal or vertical slats over a dark core. */
export function grille(vertical = false) {
  return memo('grille' + vertical, () => {
    const W = 256;
    const c = canvas(W);
    const g = c.getContext('2d');
    g.fillStyle = '#101214';
    g.fillRect(0, 0, W, W);
    const grad = g.createLinearGradient(0, 0, vertical ? 12 : 0, vertical ? 0 : 12);
    grad.addColorStop(0, '#f0f3f5');
    grad.addColorStop(0.5, '#9aa2a8');
    grad.addColorStop(1, '#e2e6e9');
    for (let k = 8; k < W; k += 22) {
      g.fillStyle = '#d9dee2';
      if (vertical) g.fillRect(k, 0, 10, W);
      else g.fillRect(0, k, W, 10);
    }
    return finish(c, { wrap: false });
  });
}

/** Licence plate. */
export function plate(text) {
  return textPanel(text, { bg: 0xf4d23c, fg: 0x141414, w: 512, h: 128, border: 0x141414, font: '800' });
}

/** Soft round sprite for smoke/dust particles. */
export function softDot() {
  return memo('softdot', () => {
    const W = 64;
    const c = canvas(W);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, W);
    return finish(c, { wrap: false });
  });
}

/** Soft radial glow (light halos). */
export function glow() {
  return softDot();
}
