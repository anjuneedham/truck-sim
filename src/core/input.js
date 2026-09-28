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
  Escape: 'pause',
  KeyP: 'pause',
  Enter: 'confirm',
};

export class Input {
  constructor() {
    this.keys = new Set(); // held logical controls from keyboard
    this.touchHeld = new Map(); // pointerId -> control name
    this.actions = new Set();
    this.enabled = false;

    // Camera look-around from dragging on the 3D view.
    this.lookDrag = { active: false, pointerId: null, lastX: 0, dx: 0 };

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
    if (action && down && !e.repeat) this.actions.add(action);
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
        this.actions.add(el.dataset.action);
      });
    });
  }

  /** Drag on the canvas to look around the truck. */
  bindLookArea(el) {
    el.addEventListener('pointerdown', (e) => {
      if (this.lookDrag.active) return;
      this.lookDrag = { active: true, pointerId: e.pointerId, lastX: e.clientX, dx: 0 };
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.lookDrag.active || e.pointerId !== this.lookDrag.pointerId) return;
      this.lookDrag.dx += e.clientX - this.lookDrag.lastX;
      this.lookDrag.lastX = e.clientX;
    });
    const end = (e) => {
      if (e.pointerId === this.lookDrag.pointerId) this.lookDrag.active = false;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
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
    return {
      steer: (right ? 1 : 0) - (left ? 1 : 0),
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

  consumeAction(name) {
    if (this.actions.has(name)) {
      this.actions.delete(name);
      return true;
    }
    return false;
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
