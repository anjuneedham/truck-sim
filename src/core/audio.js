// Placeholder audio, fully synthesised with WebAudio (no asset downloads).
//  - Engine: two detuned oscillators through a low-pass filter, pitch follows RPM.
//  - Brakes: filtered noise while braking at speed + an air-brake hiss on stop.
//  - Reverse beeper, UI click, impact thud, delivery chime.
// The AudioContext is created lazily on the first user gesture (browser rule).

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.masterOn = true;
    this.sfxOn = true;
    this.engineRunning = false;
    this.beepPhase = 0;
    this.lastBrake = 0;
  }

  /** Must be called from a user gesture handler (click/tap). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      this.ctx = new Ctx();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.applyVolumes();

    // Shared white-noise buffer.
    const len = ctx.sampleRate * 1;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.buildEngine();
    this.buildBrake();
    this.buildBeeper();
  }

  setEnabled(master, sfx) {
    this.masterOn = master;
    this.sfxOn = sfx;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.masterOn ? 0.9 : 0, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.sfxOn ? 1 : 0, t, 0.05);
  }

  buildEngine() {
    const ctx = this.ctx;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineFilter.Q.value = 2;
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfx);

    this.engOsc1 = ctx.createOscillator();
    this.engOsc1.type = 'sawtooth';
    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.engOsc1.connect(this.engineFilter);
    this.engOsc2.connect(g2).connect(this.engineFilter);
    this.engOsc1.start();
    this.engOsc2.start();
  }

  buildBrake() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 6;
    this.brakeGain = ctx.createGain();
    this.brakeGain.gain.value = 0;
    src.connect(bp).connect(this.brakeGain).connect(this.sfx);
    src.start();
  }

  buildBeeper() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1150;
    this.beepGain = ctx.createGain();
    this.beepGain.gain.value = 0;
    osc.connect(this.beepGain).connect(this.sfx);
    osc.start();
  }

  setEngineRunning(on) {
    this.engineRunning = on;
    if (!on && this.ctx) {
      const t = this.ctx.currentTime;
      this.engineGain.gain.setTargetAtTime(0, t, 0.15);
      this.brakeGain.gain.setTargetAtTime(0, t, 0.05);
      this.beepGain.gain.setTargetAtTime(0, t, 0.02);
    }
  }

  /**
   * Called every frame while driving.
   * @param {object} s  { rpm (0..1), throttle, brake, speed (m/s abs), reverse }
   */
  updateVehicle(s, dt) {
    if (!this.ctx || !this.engineRunning) return;
    const t = this.ctx.currentTime;

    // Diesel-ish: low fundamental, filter opens with throttle.
    const f = 32 + s.rpm * 70;
    this.engOsc1.frequency.setTargetAtTime(f, t, 0.08);
    this.engOsc2.frequency.setTargetAtTime(f * 2.02, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(260 + s.rpm * 700 + s.throttle * 500, t, 0.1);
    this.engineGain.gain.setTargetAtTime(0.11 + s.throttle * 0.1 + s.rpm * 0.06, t, 0.1);

    // Brake squeal only while actually slowing.
    const brakeLevel = s.brake > 0 && s.speed > 1.5 ? Math.min(1, s.speed / 15) * 0.05 : 0;
    this.brakeGain.gain.setTargetAtTime(brakeLevel, t, 0.05);

    // Air-brake hiss when the truck comes to rest while braking.
    if (s.brake > 0 && this.lastBrakeSpeed > 1.0 && s.speed <= 1.0) this.playHiss();
    this.lastBrakeSpeed = s.speed;

    // Reverse beeper: 0.5s on / 0.5s off.
    if (s.reverse) {
      this.beepPhase = (this.beepPhase + dt) % 1;
      this.beepGain.gain.setTargetAtTime(this.beepPhase < 0.5 ? 0.05 : 0, t, 0.01);
    } else {
      this.beepPhase = 0;
      this.beepGain.gain.setTargetAtTime(0, t, 0.02);
    }
  }

  noiseBurst({ duration, filterType, freq, gain, q = 1 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(g).connect(this.sfx);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  tone(freq, start, duration, gain = 0.15, type = 'sine') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.sfx);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  playHiss() {
    this.noiseBurst({ duration: 0.7, filterType: 'highpass', freq: 3500, gain: 0.12 });
  }

  playClick() {
    this.tone(900, 0, 0.06, 0.12, 'triangle');
  }

  playImpact(strength) {
    const g = Math.min(0.6, 0.15 + strength * 0.04);
    this.noiseBurst({ duration: 0.35, filterType: 'lowpass', freq: 380, gain: g });
    this.tone(55, 0, 0.3, g * 0.8);
  }

  playSuccess() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, i * 0.12, 0.35, 0.12));
  }

  playFail() {
    [392, 311, 233].forEach((f, i) => this.tone(f, i * 0.18, 0.4, 0.12, 'triangle'));
  }
}
