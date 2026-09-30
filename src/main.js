// Entry point + game state machine.
//
//   menu -> offer -> driving <-> paused
//                      |-> complete -> offer (next job) / menu
//                      |-> failed   -> driving (retry)  / menu
//
// Systems are small modules (physics, model, camera, world, mission, UI,
// input, audio, save); this file wires them together and runs the loop.

import * as THREE from 'three';
import { QUALITY, WORLD, MISSION } from './config.js';
import { SaveSystem } from './core/save.js';
import { Input } from './core/input.js';
import { AudioSystem } from './core/audio.js';
import { World } from './game/world.js';
import { Environment } from './render/environment.js';
import { Effects } from './render/effects.js';
import { setAnisotropy } from './render/textures.js';
import { TruckPhysics } from './game/truckPhysics.js';
import { TruckModel } from './game/truckModel.js';
import { CameraRig } from './game/cameraRig.js';
import { Mission } from './game/mission.js';
import { TrailerPhysics, JACKKNIFE_WARN, wrapAngle } from './game/trailerPhysics.js';
import { TrailerModel } from './game/trailerModel.js';
import { getTrailerType } from './data/trailers.js';
import { SPAWN, LOTS, getFacility, distanceToRoad, insideRect } from './game/mapData.js';
import { generateJobs, jobCompatible, jobPay, makeJob } from './game/jobs.js';
import { getCargo } from './data/cargo.js';
import { TRAILER_TYPES } from './data/trailers.js';
import { ECONOMY } from './data/economy.js';
import { UI } from './ui/ui.js';
import { TRUCK_CATALOGUE, getTruck, buildSpec, truckStats, plateFor } from './data/trucks.js';
import { Minimap } from './ui/minimap.js';

const PHYSICS_DT = 1 / 60;

class Game {
  constructor() {
    this.save = new SaveSystem();
    this.audio = new AudioSystem();
    this.input = new Input();
    this.state = 'menu';
    this.mission = null;
    this.time = 0;
    this.accumulator = 0;
    this.lastImpactSound = 0;
    this.safeSpot = { ...SPAWN };
    this.safeTimer = 0;
    this.lastCollisionTime = -10;
    this.brakeHoldTime = 0;
    this.reverseHintShown = false;
    // Safety limits for slow frames (avoid a physics "spiral of death" on weak
    // devices). Automated tests raise them so simulation stays real-time.
    this.maxPhysicsSteps = 5;
    this.maxFrameDt = 0.1;

    this.initRenderer();
    this.world = new World(this.scene);
    this.truckEntry = getTruck(this.save.data.selectedTruck);
    this.phys = new TruckPhysics(buildSpec(this.truckEntry));
    this.phys.surfaceAt = (x, z) => this.world.surfaceAt(x, z);
    this.model = new TruckModel(this.truckEntry);
    this.scene.add(this.model.root);
    this.garageIndex = 0;
    this.cameraRig = new CameraRig(this.camera, this.world.collision);
    this.cameraRig.setPreset(this.save.settings.cameraPreset || 0);
    this.minimap = new Minimap(document.getElementById('minimap'));
    this.effects = new Effects(this.scene);

    this.ui = new UI({
      click: () => {
        this.audio.unlock();
        this.audio.playClick();
      },
      play: () => this.openJobMarket(),
      acceptJob: (i) => this.acceptJob(i),
      abandonJob: () => this.abandonJob(),
      resume: () => this.resume(),
      restart: () => this.restartDelivery(),
      nextJob: () => this.openJobMarket(),
      toMenu: () => this.toMenu(),
      fullscreen: () => this.enterFullscreen(),
      openGarage: () => this.openGarage(),
      garageStep: (d) => this.garageStep(d),
      garageSelect: () => this.garageSelect(),
      garageBack: () => this.garageBack(),
      setSetting: (k, v) => this.setSetting(k, v),
      resetProgress: () => {
        this.save.resetProgress();
        this.ui.updateMenuStats(this.save.data);
        this.ui.toast('Progress reset');
      },
    });

    this.input.bindTouchControls(document.body);
    this.input.bindLookArea(this.canvas);
    this.input.bindSteeringWheel(document.getElementById('ctrl-wheel'));

    this.applySettings();
    this.resetTruck(SPAWN.x, SPAWN.z, SPAWN.heading);
    this.toMenu();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'driving') this.pause();
    });

    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.lastFrame = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------------------------------------------------------- setup
  initRenderer() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.scene = new THREE.Scene();
    // Sky, sun, reflections, fog and tone mapping.
    this.env = new Environment(this.renderer, this.scene);
    setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    this.camera = new THREE.PerspectiveCamera(60, 1, 1.0, 600);
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      // Portrait screens get a wider FOV so the road stays visible.
      this.baseFov = w < h ? 75 : 60;
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    onResize();
  }

  applySettings() {
    const s = this.save.settings;
    const q = QUALITY[s.quality] || QUALITY.medium;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    if (this.renderer.shadowMap.enabled !== q.shadows) {
      this.renderer.shadowMap.enabled = q.shadows;
      this.scene.traverse((o) => {
        if (o.material) o.material.needsUpdate = true;
      });
    }
    this.env.setShadows(q.shadows, q.shadowMap);
    this.model?.setShadowMode(q.shadows);
    this.env.setFogFar(q.fogFar);
    this.camera.far = q.fogFar + 40;
    this.camera.updateProjectionMatrix();
    this.audio.setEnabled(s.audio, s.sfx);
    this.phys.steerSensitivity = s.steerSensitivity;
    if (this.input.steerMode !== s.steeringMode) {
      this.input.steerMode = s.steeringMode;
      // Tilt needs a permission prompt on some browsers; this runs from the settings tap.
      this.input.setTiltEnabled(s.steeringMode === 'tilt').then((ok) => {
        if (!ok && s.steeringMode === 'tilt') this.ui?.toast('Tilt steering is not available on this device');
      });
    }
    this.ui?.syncSettings(s);
  }

  /** Short haptic pulse (Android browsers; silently ignored elsewhere). */
  vibrate(ms) {
    if (this.save.settings.vibration && navigator.vibrate) {
      try {
        navigator.vibrate(ms);
      } catch {
        /* not allowed in this context */
      }
    }
  }

  setSetting(key, value) {
    this.save.setSetting(key, value);
    this.applySettings();
  }

  enterFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) {
      this.ui.toast('Fullscreen not supported here');
      return;
    }
    Promise.resolve(req.call(el))
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {});
  }

  // ---------------------------------------------------------------- trucks / garage
  /** Swap the visible + simulated truck to a catalogue entry. */
  setTruck(entry) {
    if (this.model && this.model.entry === entry) return;
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.dispose();
    }
    this.truckEntry = entry;
    this.model = new TruckModel(entry);
    this.model.setShadowMode(this.renderer.shadowMap.enabled);
    this.scene.add(this.model.root);
    this.phys.setSpec(buildSpec(entry));
    const p = getFacility(this.save.data.location).parking;
    this.resetTruck(p.x, p.z, p.heading);
  }

  openGarage() {
    this.state = 'garage';
    this.garageIndex = Math.max(0, TRUCK_CATALOGUE.indexOf(this.truckEntry));
    this.showGarageCard();
  }

  showGarageCard() {
    const entry = TRUCK_CATALOGUE[this.garageIndex];
    this.setTruck(entry); // preview in the 3D view
    this.ui.showGarage({
      entry,
      index: this.garageIndex,
      total: TRUCK_CATALOGUE.length,
      plate: plateFor(entry.id),
      stats: truckStats(entry),
      selected: entry.id === this.save.data.selectedTruck,
    });
  }

  garageStep(d) {
    const n = TRUCK_CATALOGUE.length;
    this.garageIndex = (this.garageIndex + d + n) % n;
    this.showGarageCard();
  }

  garageSelect() {
    const entry = TRUCK_CATALOGUE[this.garageIndex];
    this.save.data.selectedTruck = entry.id;
    this.save.save();
    this.ui.toast(`${entry.make} ${entry.model} selected`);
    this.showGarageCard();
  }

  garageBack() {
    // Leaving without selecting restores the truck in use.
    this.setTruck(getTruck(this.save.data.selectedTruck));
    this.toMenu();
  }

  // ---------------------------------------------------------------- state changes
  resetTruck(x, z, heading) {
    this.phys.reset(x, z, heading);
    const t = this.phys.trailer;
    if (t) {
      t.place(this.phys.hitchX, this.phys.hitchZ, heading);
      this.phys.attachTrailer(t);
    }
    this.model.update(this.phys, { brake: 0 }, 0);
    this.trailerModel?.update(this.trailer, 0, false, 0);
    this.cameraRig.snap(this.phys);
  }

  // ---------------------------------------------------------------- trailers
  /**
   * Create a job's trailer parked at its pickup facility (tractor units only).
   * `job` needs { from, cargo, mass } or a debug { trailer, cargoMass }.
   */
  spawnTrailer(job) {
    this.removeTrailer();
    if (this.truckEntry.body !== 'tractor') return null;
    const typeId = job.trailer || getCargo(job.cargo).trailer;
    const type = getTrailerType(typeId);
    const t = new TrailerPhysics(type, job.mass ?? job.cargoMass ?? 0);
    const spot = getFacility(job.from || 'depot').trailerSpot;
    t.place(spot.x, spot.z, spot.heading);
    this.world.collision.addDynamic(t.parkedBox);
    this.trailer = t;
    this.trailerModel = new TrailerModel(type, job.cargo || null);
    this.trailerModel.setShadowMode(this.renderer.shadowMap.enabled);
    this.trailerModel.update(t, 0, false, 0);
    this.scene.add(this.trailerModel.root);
    return t;
  }

  removeTrailer() {
    if (this.phys.trailer) this.phys.detachTrailer();
    if (this.trailer) this.world.collision.removeDynamic(this.trailer.parkedBox);
    if (this.trailerModel) {
      this.scene.remove(this.trailerModel.root);
      this.trailerModel.dispose();
    }
    this.trailer = null;
    this.trailerModel = null;
  }

  /** Fifth wheel lined up under the kingpin, slow enough to couple? */
  canCouple() {
    const t = this.trailer;
    const p = this.phys;
    if (!t || t.attached) return false;
    return (
      Math.abs(p.speed) < MISSION.coupleSpeed &&
      Math.hypot(p.hitchX - t.kx, p.hitchZ - t.kz) < MISSION.coupleDistance &&
      Math.abs(wrapAngle(p.heading - t.heading)) < MISSION.coupleAngle
    );
  }

  toggleHitch() {
    const t = this.trailer;
    if (!t) return;
    if (t.attached) {
      if (Math.abs(this.phys.speed) > MISSION.coupleSpeed) {
        this.ui.toast('Stop to uncouple the trailer');
        return;
      }
      this.phys.detachTrailer();
      this.world.collision.addDynamic(t.parkedBox);
      this.audio.playHitch(false);
      this.ui.toast('Trailer uncoupled');
    } else if (this.canCouple()) {
      this.world.collision.removeDynamic(t.parkedBox);
      this.phys.attachTrailer(t);
      this.audio.playHitch(true);
      this.vibrate(60);
      this.ui.toast('Trailer coupled');
    } else {
      this.ui.toast('Reverse the fifth wheel under the trailer kingpin');
    }
  }

  clearMission() {
    if (this.mission) this.mission.dispose(this.scene);
    this.mission = null;
    this.removeTrailer();
  }

  /** Where the player is based (last delivery destination). */
  get location() {
    return getFacility(this.save.data.location);
  }

  /** Park the truck at the current facility's parking spot. */
  parkAtLocation() {
    const p = this.location.parking;
    this.resetTruck(p.x, p.z, p.heading);
  }

  toMenu() {
    this.state = 'menu';
    this.setTruck(getTruck(this.save.data.selectedTruck));
    this.clearMission();
    this.input.enabled = false;
    this.input.releaseAll();
    this.audio.setEngineRunning(false);
    this.parkAtLocation();
    this.phys.condition = 100;
    this.ui.setDrivingUI(false);
    this.ui.updateMenuStats(this.save.data);
    this.ui.showScreen('screen-menu');
  }

  // ---------------------------------------------------------------- jobs
  /** Current job market (regenerated after each delivery or when moving base). */
  getJobMarket() {
    const d = this.save.data;
    if (!d.jobMarket || d.jobMarket.location !== d.location || !d.jobMarket.jobs?.length) {
      d.jobMarket = { location: d.location, jobs: generateJobs(d.location, this.truckEntry) };
      this.save.save();
    }
    return d.jobMarket.jobs;
  }

  /** Card data for the job market UI. */
  jobView(job) {
    const cargo = getCargo(job.cargo);
    const tractor = this.truckEntry.body === 'tractor';
    const compatible = jobCompatible(job, this.truckEntry);
    const trailer = TRAILER_TYPES[cargo.trailer];
    return {
      cargoName: cargo.name,
      trailerName: tractor || !compatible ? trailer.name : 'Box truck',
      trailerColor: '#' + trailer.accent.toString(16).padStart(6, '0'),
      from: getFacility(job.from).name,
      to: getFacility(job.to).name,
      km: job.km,
      mass: job.mass,
      difficulty: job.difficulty,
      pay: jobPay(job, tractor),
      compatible,
      reason: cargo.trailer !== 'box' ? 'Needs a tractor unit' : 'Too heavy for a box truck',
    };
  }

  openJobMarket() {
    this.audio.unlock();
    // Clears the last job; the truck stays where it is (it may have just delivered).
    this.clearMission();
    this.state = 'jobs';
    this.input.enabled = false;
    this.ui.setDrivingUI(false);
    this.audio.setEngineRunning(false);
    // Jobs this truck can take first; `index` maps back to the market list.
    const views = this.getJobMarket()
      .map((j, index) => ({ ...this.jobView(j), index }))
      .sort((a, b) => b.compatible - a.compatible);
    this.ui.showJobMarket({ location: this.location.name, jobs: views });
  }

  /** Accept job i from the market and start driving from where the truck is. */
  acceptJob(i) {
    const job = this.getJobMarket()[i];
    if (!job || !jobCompatible(job, this.truckEntry)) return false;
    this.startJob(job);
    return true;
  }

  /** Build a specific job (debug/tests, and future scripted jobs). */
  createJob(cargoId, fromId, toId) {
    return makeJob(cargoId, fromId, toId);
  }

  startJob(job) {
    this.clearMission();
    this.jobStart = { x: this.phys.x, z: this.phys.z, heading: this.phys.heading };
    this.phys.condition = 100;
    this.mission = new Mission(this.scene, job, this.spawnTrailer(job));
    this.startDriving();
  }

  startDriving() {
    this.audio.unlock();
    this.safeSpot = { x: this.phys.x, z: this.phys.z, heading: this.phys.heading };
    this.state = 'driving';
    this.input.enabled = true;
    this.input.clearActions();
    this.ui.showScreen(null);
    this.ui.setDrivingUI(true);
    this.audio.setEngineRunning(true);
    this.ui.toast(this.mission.objective, 2600);
  }

  pause() {
    if (this.state !== 'driving') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.releaseAll();
    this.audio.setEngineRunning(false);
    this.ui.showScreen('screen-pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'driving';
    this.input.enabled = true;
    this.input.clearActions();
    this.ui.showScreen(null);
    this.audio.setEngineRunning(true);
  }

  /** Start the same job again from where it was accepted. */
  restartDelivery() {
    const job = this.mission?.job;
    if (!job) return this.openJobMarket();
    const start = this.jobStart || this.location.parking;
    this.clearMission();
    this.resetTruck(start.x, start.z, start.heading);
    this.startJob(job);
  }

  completeDelivery() {
    const r = this.mission.result;
    const job = this.mission.job;
    this.state = 'complete';
    this.input.enabled = false;
    this.input.releaseAll();
    this.audio.setEngineRunning(false);
    this.audio.playSuccess();
    const d = this.save.data;
    d.stats.distanceKm += job.km;
    d.location = job.to; // the career continues from here
    d.jobMarket = null; // fresh jobs at the new location
    this.save.addDeliveryReward(r.total);
    this.ui.setDrivingUI(false);
    const route = `${getCargo(job.cargo).name}: ${getFacility(job.from).name} → ${getFacility(job.to).name}`;
    this.ui.showComplete(r, d.money, route);
  }

  /** Give up on the current job (costs a fee). */
  abandonJob() {
    if (!this.mission) return;
    this.mission.fail('You abandoned the job.');
    this.failDelivery();
  }

  failDelivery() {
    this.state = 'failed';
    this.input.enabled = false;
    this.input.releaseAll();
    this.audio.setEngineRunning(false);
    this.audio.playFail();
    const d = this.save.data;
    const fee = Math.min(d.money, ECONOMY.delivery.abandonFee);
    d.money -= fee;
    d.stats.failed += 1;
    this.save.save();
    this.ui.setDrivingUI(false);
    this.ui.showFailed(`${this.mission.result.reason} Cancellation fee: $${fee}.`);
  }

  /** Put the truck back at the last known good spot on the road. */
  recoverTruck(message = 'Truck recovered') {
    const s = this.safeSpot;
    this.resetTruck(s.x, s.z, s.heading);
    this.phys.resolveCollisions(this.world.collision);
    this.ui.toast(message);
  }

  // ---------------------------------------------------------------- per-frame
  handleActions() {
    const inp = this.input;
    if (inp.consumeAction('pause')) {
      this.audio.playClick();
      if (this.state === 'driving') this.pause();
      else if (this.state === 'paused') this.resume();
    }
    if (this.state !== 'driving') {
      inp.clearActions();
      return;
    }
    if (inp.consumeAction('gear')) {
      if (this.phys.toggleGear()) {
        this.audio.playClick();
        this.ui.toast(this.phys.gear === 'R' ? 'Reverse' : 'Drive', 700);
      } else {
        this.ui.toast('Stop the truck to change gear');
        this.vibrate(40);
      }
    }
    while (inp.consumeAction('camera')) {
      const p = this.cameraRig.cyclePreset();
      this.save.setSetting('cameraPreset', p);
      this.audio.playClick();
      this.ui.toast(`Camera: ${this.cameraRig.preset.name}`, 800);
    }
    if (inp.consumeAction('recenter')) {
      this.input.recalibrateTilt();
      this.audio.playClick();
      this.ui.toast('Tilt centred', 800);
    }
    if (inp.consumeAction('hitch')) {
      this.audio.playClick();
      this.toggleHitch();
    }
    if (inp.consumeAction('reset')) {
      this.audio.playClick();
      this.recoverTruck();
    }
    inp.consumeAction('confirm');
  }

  /** Hitch button, coupling guidance and jackknife warning. */
  updateTrailerHUD() {
    const t = this.trailer;
    const p = this.phys;
    let hint = '';
    let hitch = null; // null = hidden, else button label
    if (t) {
      if (t.attached) {
        if (Math.abs(p.speed) < MISSION.coupleSpeed) hitch = 'UNHITCH';
        if (Math.abs(p.articulation) > JACKKNIFE_WARN) hint = p.speed < 0 ? 'Jackknife! Drive forward to straighten' : 'Sharp trailer angle';
      } else {
        const d = Math.hypot(p.hitchX - t.kx, p.hitchZ - t.kz);
        if (this.canCouple()) {
          hitch = 'HITCH';
          hint = 'Tap HITCH to couple';
        } else if (d < 15) {
          const ang = Math.abs(wrapAngle(p.heading - t.heading)) * 57.3;
          hint = `Reverse under the trailer: ${d.toFixed(1)} m` + (ang > 20 ? ` · straighten ${ang.toFixed(0)}°` : '');
        }
      }
    }
    this.ui.setTrailerHUD(hint, hitch);
    // Pull the chase camera back when towing so the trailer stays in view.
    this.cameraRig.extraDistance = t && t.attached ? t.type.length * 0.55 : 0;
  }

  updateSafeSpot(dt) {
    this.safeTimer += dt;
    if (this.safeTimer < 0.5) return;
    this.safeTimer = 0;
    const p = this.phys;
    if (this.time - this.lastCollisionTime < 1.5) return;
    const onRoad = distanceToRoad(p.x, p.z) < WORLD.roadWidth / 2 - 1;
    const inLot = Object.values(LOTS).some((r) => insideRect(p.x, p.z, r, -3));
    if (onRoad || inLot) this.safeSpot = { x: p.x, z: p.z, heading: p.heading };
  }

  stepDriving(dt) {
    this.input.updateWheel(dt);
    const input = this.input.read();
    // Sensitivity also scales how far tilt has to go for full lock.
    if (this.input.steerMode === 'tilt' && input.steer !== 0) {
      input.steer = Math.max(-1, Math.min(1, input.steer * this.phys.steerSensitivity));
    }
    this.accumulator = Math.min(this.accumulator + dt, PHYSICS_DT * this.maxPhysicsSteps);
    let impact = 0;
    let shifted = false;
    let scraping = 0;
    while (this.accumulator >= PHYSICS_DT) {
      this.phys.step(input, PHYSICS_DT, this.world.collision);
      impact = Math.max(impact, this.phys.lastImpact);
      scraping = Math.max(scraping, this.phys.scraping);
      shifted = shifted || this.phys.shiftedThisStep;
      this.accumulator -= PHYSICS_DT;
    }
    if (shifted) this.audio.playShift();
    this.effects.update(dt, { truckModel: this.model, phys: this.phys, throttle: input.throttle, shifted });

    if (impact > 0.5) {
      this.lastCollisionTime = this.time;
      if (impact > 1.5 && this.time - this.lastImpactSound > 0.25) {
        this.lastImpactSound = this.time;
        this.audio.playImpact(impact);
        this.cameraRig.addShake(Math.min(1, impact / 10));
        this.vibrate(Math.min(200, 30 + impact * 12));
      }
    }

    // One-time hint: players often hold brake at a standstill expecting reverse.
    if (input.brake && this.phys.speed === 0 && this.phys.gear === 'D') {
      this.brakeHoldTime += dt;
      if (this.brakeHoldTime > 1.2 && !this.reverseHintShown) {
        this.reverseHintShown = true;
        this.ui.toast('Tap D|R (or press R) to reverse', 2500);
      }
    } else {
      this.brakeHoldTime = 0;
    }

    if (this.world.isOutOfBounds(this.phys.x, this.phys.z)) this.recoverTruck('Out of bounds - truck recovered');
    this.updateSafeSpot(dt);

    this.audio.updateVehicle(
      {
        rpm: this.phys.rpm,
        throttle: input.throttle,
        brake: input.brake,
        speed: Math.abs(this.phys.speed),
        reverse: this.phys.gear === 'R',
        scraping,
        offroad: this.phys.surface === 'grass',
      },
      dt
    );
    this.model.update(this.phys, input, dt);
    if (this.trailerModel) this.trailerModel.update(this.trailer, this.phys.trailer ? this.phys.speed : 0, input.brake > 0 && !!this.phys.trailer, dt);

    const event = this.mission.update(this.phys, dt, this.time);
    if (event === 'loaded') {
      this.audio.playHitch(true);
      this.ui.toast(`${this.mission.cargo.name} loaded`);
    }
    if (event === 'complete') this.completeDelivery();
    else if (event === 'failed') this.failDelivery();
    return input;
  }

  frame() {
    const now = performance.now();
    const dt = Math.min(this.maxFrameDt, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.time += dt;
    this.frameCount = (this.frameCount || 0) + 1;

    this.handleActions();

    if (this.state === 'driving') {
      this.stepDriving(dt);
      this.cameraRig.applyZoom(this.input.takeZoom());
      this.cameraRig.update(this.phys, dt, this.input.takeLookDelta());
      const fov = this.baseFov + this.cameraRig.fovOffset;
      if (Math.abs(this.camera.fov - fov) > 0.05) {
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
      }
      this.effects.setViewport(this.renderer.domElement.height, this.camera.fov);
      const m = this.mission;
      this.ui.updateHUD({
        speedKmh: this.phys.speedKmh,
        gear: this.phys.gear,
        gearLabel: this.phys.gearLabel,
        rpm: this.phys.rpm,
        engineRpm: this.phys.engineRpm,
        tilt: this.input.steerMode === 'tilt' ? this.input.tiltSteer : undefined,
        condition: this.phys.condition,
        objective: m.objective,
        distance: m.distanceTo(this.phys),
        bearing: m.relativeBearing(this.phys),
        money: this.save.data.money,
        unload: m.state === 'active' ? m.unloadProgress : 0,
        inZone: m.inZone(this.phys),
      });
      this.minimap.draw(this.phys, m.target(), this.trailer);
      this.updateTrailerHUD();
    } else if (this.state === 'menu' || this.state === 'jobs' || this.state === 'garage') {
      this.effects.update(dt, { truckModel: this.model, phys: this.phys, throttle: 0, shifted: false });
      // Slow showcase orbit around the parked truck.
      if (this.camera.fov !== this.baseFov) {
        this.camera.fov = this.baseFov;
        this.camera.updateProjectionMatrix();
      }
      const a = this.time * 0.15;
      const p = this.phys;
      const r = this.state === 'garage' ? 15 : 18;
      const cx = p.x + Math.sin(a) * r;
      const cz = p.z + Math.cos(a) * r;
      this.camera.position.set(cx, 6, cz);
      // In the garage the card covers the right side, so aim right of the
      // truck to frame it in the free left part of the screen.
      const side = this.state === 'garage' && this.camera.aspect > 1.2 ? 5 : 0;
      const vx = (p.x - cx) / r;
      const vz = (p.z - cz) / r;
      this.camera.lookAt(p.x - vz * side, 1.8, p.z + vx * side);
      if (this.mission) this.mission.update(this.phys, 0, this.time);
    } else if (this.mission) {
      this.mission.update(this.phys, 0, this.time);
    }

    this.world.update(dt, this.time);
    this.env.update(this.camera, this.phys.x, this.phys.z);
    this.renderer.render(this.scene, this.camera);

    // FPS counter
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      if (this.save.settings.showFps) this.ui.setFps(this.fps);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }
}

// Exposed for debugging and the automated smoke test.
window.__game = new Game();
window.__trucks = TRUCK_CATALOGUE;
