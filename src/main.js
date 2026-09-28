// Entry point + game state machine.
//
//   menu -> offer -> driving <-> paused
//                      |-> complete -> offer (next job) / menu
//                      |-> failed   -> driving (retry)  / menu
//
// Systems are small modules (physics, model, camera, world, mission, UI,
// input, audio, save); this file wires them together and runs the loop.

import * as THREE from 'three';
import { QUALITY, WORLD } from './config.js';
import { SaveSystem } from './core/save.js';
import { Input } from './core/input.js';
import { AudioSystem } from './core/audio.js';
import { World } from './game/world.js';
import { TruckPhysics } from './game/truckPhysics.js';
import { TruckModel } from './game/truckModel.js';
import { CameraRig } from './game/cameraRig.js';
import { Mission } from './game/mission.js';
import { JOBS, SPAWN, LOTS, distanceToRoad, insideRect } from './game/mapData.js';
import { UI } from './ui/ui.js';
import { Minimap } from './ui/minimap.js';

const PHYSICS_DT = 1 / 60;
const SKY = 0xa9cde8;

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
    this.safeSpot = { x: SPAWN.x, z: SPAWN.z, heading: SPAWN.heading };
    this.safeTimer = 0;
    this.lastCollisionTime = -10;
    this.brakeHoldTime = 0;
    this.reverseHintShown = false;

    this.initRenderer();
    this.world = new World(this.scene);
    this.phys = new TruckPhysics();
    this.model = new TruckModel();
    this.scene.add(this.model.root);
    this.cameraRig = new CameraRig(this.camera, this.world.collision);
    this.cameraRig.setPreset(this.save.settings.cameraPreset || 0);
    this.minimap = new Minimap(document.getElementById('minimap'));

    this.ui = new UI({
      click: () => {
        this.audio.unlock();
        this.audio.playClick();
      },
      play: () => this.openJobOffer(),
      acceptJob: () => this.startDriving(),
      resume: () => this.resume(),
      restart: () => this.restartDelivery(),
      nextJob: () => this.openJobOffer(),
      toMenu: () => this.toMenu(),
      fullscreen: () => this.enterFullscreen(),
      setSetting: (k, v) => this.setSetting(k, v),
      resetProgress: () => {
        this.save.resetProgress();
        this.ui.updateMenuStats(this.save.data);
        this.ui.toast('Progress reset');
      },
    });

    this.input.bindTouchControls(document.body);
    this.input.bindLookArea(this.canvas);

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
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 80, 380);
    this.camera = new THREE.PerspectiveCamera(60, 1, 1.0, 600);
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      // Portrait screens get a wider FOV so the road stays visible.
      this.camera.fov = w < h ? 75 : 60;
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
    this.world.setShadows(q.shadows);
    this.model?.setShadowMode(q.shadows);
    this.scene.fog.far = q.fogFar;
    this.camera.far = q.fogFar + 40;
    this.camera.updateProjectionMatrix();
    this.audio.setEnabled(s.audio, s.sfx);
    this.ui?.syncSettings(s);
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

  // ---------------------------------------------------------------- state changes
  resetTruck(x, z, heading) {
    this.phys.reset(x, z, heading);
    this.model.update(this.phys, { brake: 0 }, 0);
    this.cameraRig.snap(this.phys);
  }

  clearMission() {
    if (this.mission) this.mission.dispose(this.scene);
    this.mission = null;
  }

  toMenu() {
    this.state = 'menu';
    this.clearMission();
    this.input.enabled = false;
    this.input.releaseAll();
    this.audio.setEngineRunning(false);
    this.resetTruck(SPAWN.x, SPAWN.z, SPAWN.heading);
    this.phys.condition = 100;
    this.ui.setDrivingUI(false);
    this.ui.updateMenuStats(this.save.data);
    this.ui.showScreen('screen-menu');
  }

  openJobOffer() {
    this.audio.unlock();
    this.clearMission();
    const job = JOBS[this.save.data.nextJobIndex % JOBS.length];
    this.mission = new Mission(this.scene, job);
    this.resetTruck(SPAWN.x, SPAWN.z, SPAWN.heading);
    this.phys.condition = 100;
    this.state = 'offer';
    this.ui.setDrivingUI(false);
    this.audio.setEngineRunning(false);
    this.ui.showOffer(this.mission, SPAWN.name);
  }

  startDriving() {
    this.audio.unlock();
    this.mission.start();
    this.safeSpot = { x: SPAWN.x, z: SPAWN.z, heading: SPAWN.heading };
    this.state = 'driving';
    this.input.enabled = true;
    this.input.clearActions();
    this.ui.showScreen(null);
    this.ui.setDrivingUI(true);
    this.audio.setEngineRunning(true);
    this.ui.toast(`Deliver ${this.mission.job.cargo.toLowerCase()} to ${this.mission.job.destination}`, 2600);
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

  restartDelivery() {
    const job = this.mission ? this.mission.job : JOBS[0];
    this.clearMission();
    this.mission = new Mission(this.scene, job);
    this.resetTruck(SPAWN.x, SPAWN.z, SPAWN.heading);
    this.phys.condition = 100;
    this.startDriving();
  }

  completeDelivery() {
    const r = this.mission.result;
    this.state = 'complete';
    this.input.enabled = false;
    this.input.releaseAll();
    this.audio.setEngineRunning(false);
    this.audio.playSuccess();
    this.save.addDeliveryReward(r.total);
    this.save.advanceJob(JOBS.length);
    this.ui.setDrivingUI(false);
    this.ui.showComplete(r, this.save.data.money);
  }

  failDelivery() {
    this.state = 'failed';
    this.input.enabled = false;
    this.input.releaseAll();
    this.audio.setEngineRunning(false);
    this.audio.playFail();
    this.ui.setDrivingUI(false);
    this.ui.showFailed(this.mission.result.reason);
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
      }
    }
    if (inp.consumeAction('camera')) {
      const p = this.cameraRig.cyclePreset();
      this.save.setSetting('cameraPreset', p);
      this.audio.playClick();
    }
    if (inp.consumeAction('reset')) {
      this.audio.playClick();
      this.recoverTruck();
    }
    inp.consumeAction('confirm');
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
    const input = this.input.read();
    this.accumulator = Math.min(this.accumulator + dt, PHYSICS_DT * 5);
    let impact = 0;
    while (this.accumulator >= PHYSICS_DT) {
      this.phys.step(input, PHYSICS_DT, this.world.collision);
      impact = Math.max(impact, this.phys.lastImpact);
      this.accumulator -= PHYSICS_DT;
    }

    if (impact > 0.5) {
      this.lastCollisionTime = this.time;
      if (impact > 1.5 && this.time - this.lastImpactSound > 0.25) {
        this.lastImpactSound = this.time;
        this.audio.playImpact(impact);
        this.cameraRig.addShake(Math.min(1, impact / 10));
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
      },
      dt
    );
    this.model.update(this.phys, input, dt);

    const event = this.mission.update(this.phys, dt, this.time);
    if (event === 'complete') this.completeDelivery();
    else if (event === 'failed') this.failDelivery();
    return input;
  }

  frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.time += dt;

    this.handleActions();

    if (this.state === 'driving') {
      this.stepDriving(dt);
      this.cameraRig.update(this.phys, dt, this.input.takeLookDelta());
      const m = this.mission;
      this.ui.updateHUD({
        speedKmh: this.phys.speedKmh,
        gear: this.phys.gear,
        condition: this.phys.condition,
        objective: `Deliver to ${m.job.destination}`,
        distance: m.distanceTo(this.phys),
        bearing: m.relativeBearing(this.phys),
        money: this.save.data.money,
        unload: m.state === 'active' ? m.unloadProgress : 0,
        inZone: m.inZone(this.phys),
      });
      this.minimap.draw(this.phys, m.job.zone);
    } else if (this.state === 'menu' || this.state === 'offer') {
      // Slow showcase orbit around the parked truck.
      const a = this.time * 0.15;
      const p = this.phys;
      this.camera.position.set(p.x + Math.sin(a) * 18, 6, p.z + Math.cos(a) * 18);
      this.camera.lookAt(p.x, 1.8, p.z);
      if (this.mission) this.mission.update(this.phys, 0, this.time);
    } else if (this.mission) {
      this.mission.update(this.phys, 0, this.time);
    }

    this.world.followSun(this.phys.x, this.phys.z);
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
