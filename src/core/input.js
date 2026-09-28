// Unified input: keyboard (desktop testing) + on-screen touch controls.
// Produces a simple per-frame state the truck and camera read from:
//   steer    -1 (left) .. +1 (right)
//   throttle  0 .. 1
//   brake     0 .. 1
// plus one-shot actions (gear toggle, camera cycle, reset, pause) consumed via
// consumeAction().

const KEY_MAP = {
  ArrowUp: 'throttle',
  KeyW: 'throttle',
  ArrowDown: 'brake',
  KeyS: 'brake',
  Space: 'brake',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

const ACTION_KEYS = {
  KeyR: 'gear',
  KeyC: 'camera',
  KeyT: 'reset',
  KeyH: 'hitch',
  Escape: 'pause',
  KeyP: 'pause',
  Enter: 'confirm',
};

export class Input {
  constructor() {
    this.keys = new Set(); // held logical controls from keyboard
    this.touchHeld = new Map(); // pointerId -> control name
    this.actions = new Map(); // action -> pending count (taps are never merged)
    this.enabled = false;

    // Camera look-around from dragging on the 3D view, pinch/wheel to zoom.
    this.lookDrag = { active: false, pointerId: null, lastX: 0, dx: 0 };
    this.lookPointers = new Map(); // pointerId -> {x, y}
    this.pinchDist = 0;
    this.zoomFactor = 1; // accumulated since last takeZoom()

    // Analog steering sources (-1..1). Mode chooses which on-screen control is used.
    this.steerMode = 'buttons'; // 'buttons' | 'wheel' | 'tilt'
    this.wheelSteer = 0;
    this.tiltSteer = 0;
    this.tiltZero = null; // calibration angle captured when tilt starts
    this.onTilt = (e) => this.handleTilt(e);

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
  }

  onKey(e, down) {
    const control = KEY_MAP[e.code];
    if (control) {
      if (down) this.keys.add(control);
      else this.keys.delete(control);
      if (this.enabled) e.preventDefault();
      return;
    }
    const action = ACTION_KEYS[e.code];
    if (action && down && !e.repeat) this.queueAction(action);
  }

  /** Bind every element with data-hold="throttle|brake|left|right" and data-action="...". */
  bindTouchControls(root) {
    root.querySelectorAll('[data-hold]').forEach((el) => {
      const control = el.dataset.hold;
      const press = (e) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        this.touchHeld.set(e.pointerId, control);
        el.classList.add('pressed');
      };
      const release = (e) => {
        if (this.touchHeld.get(e.pointerId) === control) this.touchHeld.delete(e.pointerId);
        if (![...this.touchHeld.values()].includes(control)) el.classList.remove('pressed');
      };
      el.addEventListener('pointerdown', press);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    root.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.queueAction(el.dataset.action);
      });
    });
  }

  /** Drag on the canvas to look around the truck; two fingers pinch-zoom; mouse wheel zooms. */
  bindLookArea(el) {
    const pinchDistance = () => {
      const [p1, p2] = [...this.lookPointers.values()];
      return Math.hypot(p1.x - p2.x, p1.y - p2.y);
    };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture?.(e.pointerId);
      this.lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.lookPointers.size === 1) {
        this.lookDrag = { active: true, pointerId: e.pointerId, lastX: e.clientX, dx: 0 };
      } else if (this.lookPointers.size === 2) {
        this.lookDrag.active = false; // pinch replaces look-drag
        this.pinchDist = pinchDistance();
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.lookPointers.has(e.pointerId)) return;
      this.lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.lookPointers.size === 2) {
        const d = pinchDistance();
        if (this.pinchDist > 0 && d > 0) this.zoomFactor *= this.pinchDist / d; // fingers apart => zoom in
        this.pinchDist = d;
      } else if (this.lookDrag.active && e.pointerId === this.lookDrag.pointerId) {
        this.lookDrag.dx += e.clientX - this.lookDrag.lastX;
        this.lookDrag.lastX = e.clientX;
      }
    });
    const end = (e) => {
      this.lookPointers.delete(e.pointerId);
      if (e.pointerId === this.lookDrag.pointerId || this.lookPointers.size === 0) this.lookDrag.active = false;
      if (this.lookPointers.size < 2) this.pinchDist = 0;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomFactor *= Math.exp(e.deltaY * 0.001);
      },
      { passive: false }
    );
  }

  /** Returns and resets the accumulated zoom multiplier (>1 = zoom out). */
  takeZoom() {
    const z = this.zoomFactor;
    this.zoomFactor = 1;
    return z;
  }

  /**
   * On-screen steering wheel: drag around its centre to turn it. Up to
   * +-maxDeg of rotation maps to full lock; releasing lets it spin back.
   */
  bindSteeringWheel(el, maxDeg = 120) {
    let pointerId = null;
    let startAngle = 0;
    let startRot = 0;
    this.wheelRot = 0; // degrees, for rendering
    const angleOf = (e) => {
      const r = el.getBoundingClientRect();
      return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      pointerId = e.pointerId;
      startAngle = angleOf(e);
      startRot = this.wheelRot;
      this.wheelHeld = true;
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointerId) return;
      let d = angleOf(e) - startAngle;
      d = ((d + 540) % 360) - 180; // wrap to -180..180
      this.wheelRot = Math.max(-maxDeg, Math.min(maxDeg, startRot + d));
      this.wheelSteer = this.wheelRot / maxDeg;
    });
    const release = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      this.wheelHeld = false;
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
    this.wheelEl = el;
    this.wheelMaxDeg = maxDeg;
  }

  /** Self-centre the on-screen wheel when released; call once per frame. */
  updateWheel(dt) {
    if (!this.wheelEl) return;
    if (!this.wheelHeld && this.wheelRot !== 0) {
      const step = 360 * dt;
      this.wheelRot = Math.abs(this.wheelRot) <= step ? 0 : this.wheelRot - Math.sign(this.wheelRot) * step;
      this.wheelSteer = this.wheelRot / this.wheelMaxDeg;
    }
    this.wheelEl.style.transform = `rotate(${this.wheelRot}deg)`;
  }

  /** Start/stop listening to device tilt. Must be called from a user gesture on iOS. */
  async setTiltEnabled(on) {
    window.removeEventListener('deviceorientation', this.onTilt);
    this.tiltSteer = 0;
    this.tiltZero = null;
    if (!on) return true;
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    window.addEventListener('deviceorientation', this.onTilt);
    return true;
  }

  /** Re-centre tilt on the current phone angle. */
  recalibrateTilt() {
    this.tiltZero = null;
  }

  handleTilt(e) {
    if (e.beta == null || e.gamma == null) return;
    // Rotation like a steering wheel depends on how the phone is held.
    const angle = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
    let a;
    if (angle === 90) a = e.beta;
    else if (angle === 270 || angle === -90) a = -e.beta;
    else a = e.gamma;
    if (this.tiltZero === null) this.tiltZero = a;
    const d = a - this.tiltZero;
    const dead = 2;
    const range = 28; // degrees of tilt for full lock
    const v = Math.abs(d) < dead ? 0 : (d - Math.sign(d) * dead) / range;
    this.tiltSteer = Math.max(-1, Math.min(1, v));
  }

  isHeld(control) {
    if (this.keys.has(control)) return true;
    for (const c of this.touchHeld.values()) if (c === control) return true;
    return false;
  }

  /** Snapshot for this frame. */
  read() {
    if (!this.enabled) return { steer: 0, throttle: 0, brake: 0 };
    const left = this.isHeld('left');
    const right = this.isHeld('right');
    // Digital (keys/buttons) wins when pressed; otherwise the analog source.
    let steer = (right ? 1 : 0) - (left ? 1 : 0);
    if (steer === 0) {
      if (this.steerMode === 'wheel') steer = this.wheelSteer;
      else if (this.steerMode === 'tilt') steer = this.tiltSteer;
    }
    return {
      steer,
      throttle: this.isHeld('throttle') ? 1 : 0,
      brake: this.isHeld('brake') ? 1 : 0,
    };
  }

  /** Returns and clears the accumulated horizontal look-drag in pixels. */
  takeLookDelta() {
    const dx = this.lookDrag.dx;
    this.lookDrag.dx = 0;
    return { dx, dragging: this.lookDrag.active };
  }

  queueAction(name) {
    this.actions.set(name, (this.actions.get(name) || 0) + 1);
  }

  /** Consumes one pending tap of `name`; returns true if there was one. */
  consumeAction(name) {
    const n = this.actions.get(name) || 0;
    if (n <= 0) return false;
    if (n === 1) this.actions.delete(name);
    else this.actions.set(name, n - 1);
    return true;
  }

  clearActions() {
    this.actions.clear();
  }

  releaseAll() {
    this.keys.clear();
    this.touchHeld.clear();
    document.querySelectorAll('.pressed').forEach((el) => el.classList.remove('pressed'));
  }
}
