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
};

function defaultSave() {
  return {
    version: 1,
    money: 0,
    deliveriesCompleted: 0,
    nextJobIndex: 0,
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

  advanceJob(jobCount) {
    this.data.nextJobIndex = (this.data.nextJobIndex + 1) % jobCount;
    this.save();
  }

  resetProgress() {
    const settings = this.data.settings;
    this.data = defaultSave();
    this.data.settings = settings;
    this.save();
  }
}
