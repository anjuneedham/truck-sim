import { ECONOMY } from '../data/economy.js';

// Lightweight persistent save using localStorage.
// Stores money, completed deliveries and settings. All access is wrapped in
// try/catch so the game still runs in private mode / blocked storage.

const SAVE_KEY = 'truckSim.save.v1';

export const DEFAULT_SETTINGS = {
  audio: true, // master audio
  sfx: true, // vehicle + UI sound effects
  quality: 'medium', // low | medium | high
  showFps: false,
  cameraPreset: 0,
  steeringMode: 'buttons', // buttons | wheel | tilt
  steerSensitivity: 1.0, // 0.5 .. 1.5
  controlSize: 'medium', // small | medium | large
  vibration: true,
};

function defaultSave() {
  return {
    version: 1,
    money: ECONOMY.startingMoney,
    deliveriesCompleted: 0,
    selectedTruck: 'mercer-mbox9',
    location: 'depot', // facility the player is based at (last drop-off)
    jobMarket: null, // { location, jobs } persisted so the market survives reloads
    stats: { failed: 0, distanceKm: 0 },
    settings: { ...DEFAULT_SETTINGS },
  };
}

export class SaveSystem {
  constructor() {
    this.data = this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultSave();
      const parsed = JSON.parse(raw);
      const base = defaultSave();
      // Merge so saves from older builds pick up new fields.
      return {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings || {}) },
        stats: { ...base.stats, ...(parsed.stats || {}) },
      };
    } catch (err) {
      console.warn('[save] load failed, using defaults', err);
      return defaultSave();
    }
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
      return true;
    } catch (err) {
      console.warn('[save] write failed', err);
      return false;
    }
  }

  get settings() {
    return this.data.settings;
  }

  setSetting(key, value) {
    this.data.settings[key] = value;
    this.save();
  }

  addDeliveryReward(amount) {
    this.data.money += amount;
    this.data.deliveriesCompleted += 1;
    this.save();
  }

  resetProgress() {
    const settings = this.data.settings;
    this.data = defaultSave();
    this.data.settings = settings;
    this.save();
  }
}
