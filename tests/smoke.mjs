// End-to-end smoke test of the playable build using headless Chromium.
// Run: npm run build && npm test
// Screenshots are written to test-results/.
//
// Drives the real game through keyboard + touch-button input and checks every
// major system: menu, settings, save/load, driving, steering, braking, reverse,
// camera, collision, recovery, delivery completion, reward, restart, failure.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const pageUrl = new URL('dist/truck-sim-standalone.html', root).href;
const outDir = fileURLToPath(new URL('test-results/', root));
mkdirSync(outDir, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
// Landscape phone-sized viewport with touch.
const context = await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const wait = (ms) => page.waitForTimeout(ms);
const g = (expr) => page.evaluate(`(() => { const game = window.__game; return ${expr}; })()`);
const visible = (sel) => page.locator(sel).isVisible();
const shot = (name) => page.screenshot({ path: `${outDir}${name}.png` });

async function holdKeys(keys, ms) {
  for (const k of keys) await page.keyboard.down(k);
  await wait(ms);
  for (const k of keys) await page.keyboard.up(k);
}

async function waitStopped(timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (Math.abs(await g('game.phys.speed')) < 0.01) return true;
    await wait(100);
  }
  return false;
}

try {
  await page.goto(pageUrl);
  await page.waitForFunction(() => window.__game && window.__game.fps > 0, null, { timeout: 20000 });

  // ---- Launch / menu
  check('Game launches (no startup errors)', errors.length === 0, errors.join(' | '));
  check('Main menu visible', await visible('#screen-menu'));
  await shot('01-menu');

  // ---- Settings + save
  await page.click('#btn-settings');
  check('Settings opens', await visible('#screen-settings'));
  await page.click('#set-sfx');
  await page.click('#set-quality button[data-q="low"]');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('truckSim.save.v1')));
  check('Settings saved to storage', saved.settings.sfx === false && saved.settings.quality === 'low');
  check('Graphics quality applied', (await g('game.renderer.getPixelRatio()')) === 0.75);
  await shot('02-settings');
  await page.click('#btn-settings-back');
  check('Settings back returns to menu', await visible('#screen-menu'));

  // Reload -> settings persisted
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.fps > 0);
  check('Settings persist after reload', !(await page.isChecked('#set-sfx')) && (await g('game.save.settings.quality')) === 'low');
  await page.evaluate(() => {
    window.__game.setSetting('sfx', true);
    window.__game.setSetting('quality', 'medium');
  });

  // ---- Play -> job offer -> drive
  await page.click('#btn-play');
  check('Play opens job offer', await visible('#screen-offer'));
  await shot('03-offer');
  await page.click('#btn-offer-accept');
  check('Accept starts driving', (await g('game.state')) === 'driving' && (await visible('#hud')) && (await visible('#controls')));
  const spawn = await g('({x: game.phys.x, z: game.phys.z, h: game.phys.heading})');
  check('Truck spawns at depot', Math.abs(spawn.x - -110) < 0.1 && Math.abs(spawn.z - 152) < 0.1);

  // ---- Accelerate (keyboard)
  await holdKeys(['ArrowUp'], 2500);
  const afterAccel = await g('({x: game.phys.x, z: game.phys.z, v: game.phys.speed, kmh: game.phys.speedKmh})');
  check('Truck accelerates forward', afterAccel.v > 3 && afterAccel.z > spawn.z + 3, `v=${afterAccel.v.toFixed(2)} m/s`);
  const hudSpeed = await page.textContent('#hud-speed');
  check('HUD shows speed', Number(hudSpeed) > 5, `hud=${hudSpeed} km/h`);
  await shot('04-driving');

  // ---- Brake
  const brakeStart = Date.now();
  await page.keyboard.down('ArrowDown');
  const stopped = await waitStopped();
  await page.keyboard.up('ArrowDown');
  check('Brake stops the truck', stopped, `${Date.now() - brakeStart} ms`);

  // Put truck on an open straight road for handling tests (ring road north side).
  await g('(game.resetTruck(-60, 200, Math.PI / 2), game.safeSpot = {x: -60, z: 200, heading: Math.PI / 2}, true)');

  // ---- Steering (touch buttons)
  const h0 = await g('game.phys.heading');
  const gas = await page.locator('[data-hold="throttle"]').boundingBox();
  const right = await page.locator('[data-hold="right"]').boundingBox();
  // Two simultaneous touches: gas + right steer.
  const cdp = await context.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const pGas = { x: gas.x + gas.width / 2, y: gas.y + gas.height / 2, id: 1 };
  const pRight = { x: right.x + right.width / 2, y: right.y + right.height / 2, id: 2 };
  await touch('touchStart', [pGas]);
  await wait(800);
  check('Touch GAS pedal accelerates', (await g('game.phys.speed')) > 0.5);
  await touch('touchStart', [pGas, pRight]);
  await wait(1500);
  const h1 = await g('game.phys.heading');
  const steerAngle = await g('game.phys.steerAngle');
  await touch('touchEnd', []);
  check('Touch steering turns right', steerAngle > 0.1 && h1 < h0 - 0.1, `heading ${h0.toFixed(2)} -> ${h1.toFixed(2)}`);
  await wait(600);
  check('Steering self-centres on release', Math.abs(await g('game.phys.steerAngle')) < 0.05);
  await page.keyboard.down('Space');
  await waitStopped();
  await page.keyboard.up('Space');

  // Keyboard left steer
  await g('(game.resetTruck(-60, 200, Math.PI / 2), true)');
  await holdKeys(['ArrowUp', 'ArrowLeft'], 1500);
  check('Keyboard steering turns left', (await g('game.phys.heading')) > Math.PI / 2 + 0.1);
  await page.keyboard.down('ArrowDown');
  await waitStopped();
  await page.keyboard.up('ArrowDown');

  // ---- Gear lock while moving, then reverse
  await g('(game.resetTruck(-60, 200, Math.PI / 2), true)');
  await holdKeys(['ArrowUp'], 1200);
  await page.keyboard.press('KeyR');
  await wait(100);
  check('Cannot shift to reverse while moving', (await g('game.phys.gear')) === 'D');
  await page.keyboard.down('ArrowDown');
  await waitStopped();
  await page.keyboard.up('ArrowDown');
  const gearBtn = await page.locator('#ctrl-gear').boundingBox();
  await touch('touchStart', [{ x: gearBtn.x + 20, y: gearBtn.y + 20, id: 3 }]);
  await touch('touchEnd', []);
  await wait(100);
  check('Gear button switches to Reverse', (await g('game.phys.gear')) === 'R' && (await page.textContent('#hud-gear')) === 'R');
  const beforeRev = await g('({x: game.phys.x, z: game.phys.z, h: game.phys.heading})');
  await holdKeys(['ArrowUp'], 1500);
  const rev = await g('({x: game.phys.x, z: game.phys.z, v: game.phys.speed})');
  // Heading PI/2 => forward is +X, so reversing should reduce X.
  check('Truck reverses', rev.v < -1 && rev.x < beforeRev.x - 1, `v=${rev.v.toFixed(2)}`);
  check('Reverse speed is limited', rev.v > -5.6);
  await shot('05-reverse');
  await page.keyboard.down('ArrowDown');
  await waitStopped();
  await page.keyboard.up('ArrowDown');
  await page.keyboard.press('KeyR');
  await wait(50);
  check('Shift back to Drive', (await g('game.phys.gear')) === 'D');

  // ---- Camera
  const cam = await g('({cx: game.camera.position.x, cy: game.camera.position.y, cz: game.camera.position.z, tx: game.phys.x, tz: game.phys.z, h: game.phys.heading})');
  const back = { x: -Math.sin(cam.h), z: -Math.cos(cam.h) };
  const rel = { x: cam.cx - cam.tx, z: cam.cz - cam.tz };
  const behind = (rel.x * back.x + rel.z * back.z) / Math.hypot(rel.x, rel.z);
  check('Chase camera sits behind truck', behind > 0.8 && cam.cy > 3, `dot=${behind.toFixed(2)} y=${cam.cy.toFixed(1)}`);
  await page.keyboard.press('KeyC');
  await wait(1500);
  const camDist2 = await g('Math.hypot(game.camera.position.x - game.phys.x, game.camera.position.z - game.phys.z)');
  check('Camera preset cycles distance', (await g('game.cameraRig.presetIndex')) === 1 && camDist2 > 18, `dist=${camDist2.toFixed(1)}`);
  await page.keyboard.press('KeyC');
  await page.keyboard.press('KeyC');
  await wait(1200);
  const cab = await g('({cx: game.camera.position.x, cz: game.camera.position.z, cy: game.camera.position.y, x: game.phys.x, z: game.phys.z, h: game.phys.heading, p: game.cameraRig.preset.name})');
  const cabFwd = (cab.cx - cab.x) * Math.sin(cab.h) + (cab.cz - cab.z) * Math.cos(cab.h);
  check('Cab camera preset sits on the cab', cab.p === 'Cab' && cabFwd > 1 && cab.cy > 2.5 && cab.cy < 4, `fwd=${cabFwd.toFixed(1)}`);
  await shot('05b-cab-view');
  await page.keyboard.press('KeyC');
  await wait(300);
  check('Camera cycles back to chase', (await g('game.cameraRig.presetIndex')) === 0);

  // ---- Phase 1: driving polish
  // Gearbox: accelerate hard on the straight and confirm upshifts + HUD gear/tacho.
  await g('(game.resetTruck(-120, 200, Math.PI / 2), true)');
  await holdKeys(['ArrowUp'], 5000);
  const gb = await g('({gi: game.phys.gearIndex, rpm: game.phys.engineRpm, v: game.phys.speedKmh})');
  const hudGear = await page.textContent('#hud-gear');
  check('Gearbox upshifts under acceleration', gb.gi >= 1 && hudGear === String(gb.gi + 1), `gear ${gb.gi + 1} @ ${gb.v.toFixed(0)} km/h, ${gb.rpm.toFixed(0)} rpm`);
  check('Tacho shows engine rpm', parseFloat(await page.evaluate(() => document.getElementById('hud-rpm').style.width)) > 10);
  // Suspension: hard braking pitches the body forward.
  await page.keyboard.down('ArrowDown');
  await wait(500);
  const pitch = await g('game.model.pitch');
  await waitStopped();
  await page.keyboard.up('ArrowDown');
  check('Suspension pitches under braking', pitch > 0.005, `pitch=${pitch.toFixed(3)} rad`);
  check('Gearbox downshifts back to 1st when stopped', (await g('game.phys.gearIndex')) === 0);

  // Surface: grass is slower than tarmac for the same throttle time.
  await g('(game.resetTruck(-120, 200, Math.PI / 2), true)');
  await holdKeys(['ArrowUp'], 2500);
  const roadV = await g('game.phys.speed');
  await g('(game.resetTruck(-40, 120, Math.PI / 2), true)');
  check('Surface detection finds grass off-road', (await g('game.world.surfaceAt(-40, 120)')) === 'grass');
  await holdKeys(['ArrowUp'], 2500);
  const grassV = await g('game.phys.speed');
  check('Grass slows the truck', grassV < roadV * 0.9, `road ${roadV.toFixed(1)} vs grass ${grassV.toFixed(1)} m/s`);

  // High-speed guardrail hit must not tunnel through the thin rail.
  // North ring road at z=200, rail at z=211. Aim at it at 25 m/s, 30 deg.
  await g('(game.resetTruck(-60, 204, Math.PI / 2 - 0.5), game.phys.speed = 25, game.phys.gearIndex = 5, true)');
  await wait(1500);
  const rail = await g('({z: game.phys.z, h: game.phys.heading})');
  check('No tunnelling through guardrail at speed', rail.z < 211, `z=${rail.z.toFixed(2)}`);
  check('Glancing hit turns the truck along the rail', Math.abs(rail.h - (Math.PI / 2 - 0.5)) > 0.05, `heading ${rail.h.toFixed(2)}`);

  // Steering sensitivity setting reaches the physics and persists.
  await page.evaluate(() => window.__game.setSetting('steerSensitivity', 1.4));
  check('Steering sensitivity applied', (await g('game.phys.steerSensitivity')) === 1.4);
  await page.evaluate(() => window.__game.setSetting('steerSensitivity', 1.0));

  // Steering wheel mode: drag the on-screen wheel clockwise.
  await page.evaluate(() => window.__game.setSetting('steeringMode', 'wheel'));
  check('Wheel mode shows the steering wheel', (await visible('#ctrl-wheel')) && !(await visible('[data-hold="left"]')));
  await g('(game.resetTruck(-60, 200, Math.PI / 2), true)');
  const wb = await page.locator('#ctrl-wheel').boundingBox();
  const wcx = wb.x + wb.width / 2;
  const wcy = wb.y + wb.height / 2;
  const R = wb.width * 0.42;
  // Start at the top of the rim and sweep clockwise ~90 degrees to the right.
  await touch('touchStart', [{ x: wcx, y: wcy - R, id: 5 }]);
  for (let a = 0; a <= 90; a += 15) {
    const rad = (a * Math.PI) / 180;
    await touch('touchMove', [{ x: wcx + Math.sin(rad) * R, y: wcy - Math.cos(rad) * R, id: 5 }]);
  }
  await wait(50);
  const wheelIn = await g('game.input.read().steer');
  await touch('touchStart', [{ x: wcx + R, y: wcy, id: 5 }, pGas]);
  await wait(900);
  const wheelSteer = await g('game.phys.steerAngle');
  await touch('touchEnd', []);
  check('Steering wheel drag steers right', wheelIn > 0.5 && wheelSteer > 0.1, `input=${wheelIn.toFixed(2)} angle=${wheelSteer.toFixed(2)}`);
  await wait(800);
  check('Steering wheel springs back to centre', Math.abs(await g('game.input.wheelSteer')) < 0.01);
  await shot('05c-wheel-mode');
  await page.keyboard.down('Space');
  await waitStopped();
  await page.keyboard.up('Space');

  // Tilt mode: synthetic device orientation (phone held in landscape).
  await page.evaluate(() => window.__game.setSetting('steeringMode', 'tilt'));
  await wait(100);
  check('Tilt mode shows re-centre control', await visible('#steer-tilt'));
  const tiltEvent = (beta) =>
    page.evaluate((b) => window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: b, gamma: b })), beta);
  await tiltEvent(0); // calibrates zero
  await tiltEvent(-20);
  const tiltSteer = await g('game.input.read().steer');
  check('Tilting the phone steers', Math.abs(tiltSteer) > 0.4, `steer=${tiltSteer.toFixed(2)}`);
  await tiltEvent(0);
  check('Level phone = straight', Math.abs(await g('game.input.read().steer')) < 0.01);
  await page.evaluate(() => window.__game.setSetting('steeringMode', 'buttons'));
  check('Buttons mode restores arrow buttons', await visible('[data-hold="left"]'));

  // Control size setting scales the on-screen controls.
  const gasW1 = (await page.locator('[data-hold="throttle"]').boundingBox()).width;
  await page.evaluate(() => window.__game.setSetting('controlSize', 'large'));
  const gasW2 = (await page.locator('[data-hold="throttle"]').boundingBox()).width;
  check('Control size setting enlarges controls', gasW2 > gasW1 * 1.1, `${gasW1.toFixed(0)} -> ${gasW2.toFixed(0)} px`);
  await page.evaluate(() => window.__game.setSetting('controlSize', 'medium'));

  // Pinch zoom (two fingers spreading on the 3D view) and mouse wheel.
  const z0 = await g('game.cameraRig.zoom');
  await touch('touchStart', [{ x: 400, y: 200, id: 7 }, { x: 440, y: 200, id: 8 }]);
  await touch('touchMove', [{ x: 360, y: 200, id: 7 }, { x: 480, y: 200, id: 8 }]);
  await touch('touchEnd', []);
  await wait(100);
  const z1 = await g('game.cameraRig.zoom');
  check('Pinch out zooms the camera in', z1 < z0 * 0.8, `${z0.toFixed(2)} -> ${z1.toFixed(2)}`);
  await page.mouse.move(450, 150);
  await page.mouse.wheel(0, 600);
  await wait(100);
  check('Mouse wheel zooms out', (await g('game.cameraRig.zoom')) > z1, `${(await g('game.cameraRig.zoom')).toFixed(2)}`);
  await g('(game.cameraRig.zoom = 1, true)');

  // ---- Collision: drive into a jersey barrier in the depot (at x=-86, z=150, 4m long along X)
  await g('(game.resetTruck(-86, 140, 0), game.phys.condition = 100, true)');
  await holdKeys(['ArrowUp'], 3500);
  const col = await g('({z: game.phys.z, v: game.phys.speed, c: game.phys.condition, n: game.phys.collisionCount})');
  // Barrier near face at z=149.6; truck front = z + 4.5 must not pass it by more than a small tolerance.
  check('Collision blocks the truck', col.z + 4.5 < 149.7 && col.n > 0, `front z=${(col.z + 4.5).toFixed(2)} hits=${col.n}`);
  await shot('06-collision');
  // Hard hit into a building wall to test damage
  await g('(game.resetTruck(-110, 60, Math.PI), game.phys.speed = -0, true)');
  await g('(game.phys.gear = "D", game.phys.speed = 14, true)');
  await wait(1500);
  const dmg = await g('game.phys.condition');
  check('Hard impact reduces condition', dmg < 100, `condition=${dmg.toFixed(1)}%`);

  // ---- Recover / reset
  await g('(game.safeSpot = {x: -60, z: 200, heading: Math.PI / 2}, true)');
  await page.keyboard.press('KeyT');
  await wait(100);
  const rec = await g('({x: game.phys.x, z: game.phys.z, v: game.phys.speed})');
  check('Reset recovers truck to safe spot', Math.abs(rec.x - -60) < 0.5 && Math.abs(rec.z - 200) < 0.5 && rec.v === 0);

  // ---- Out of bounds
  await g('(game.phys.x = 500, true)');
  await wait(200);
  check('Out-of-bounds auto-recovers', Math.abs(await g('game.phys.x')) < 330);

  // ---- Pause / resume via on-screen button
  await page.click('#btn-pause');
  await wait(100);
  check('Pause button pauses', (await g('game.state')) === 'paused' && (await visible('#screen-pause')));
  await page.click('#btn-resume');
  check('Resume works', (await g('game.state')) === 'driving');

  // ---- Destination: teleport next to the zone and drive in, then stop
  const job = await g('game.mission.job');
  const money0 = await g('game.save.data.money');
  const deliveries0 = await g('game.save.data.deliveriesCompleted');
  const dist0 = await g('game.mission.distanceTo(game.phys)');
  await g(`(game.resetTruck(${job.zone.x}, ${job.zone.z}, 0), true)`);
  await wait(300);
  const hudDistText = await page.textContent('#hud-distance');
  check('HUD distance updates / in-zone prompt', hudDistText === 'Stop inside the marker', `before=${dist0.toFixed(0)}m`);
  await wait(400);
  check('Unloading progress shows', await visible('#hud-unload'));
  await page.waitForFunction(() => window.__game.state === 'complete', null, { timeout: 5000 });
  check('Delivery completes when stopped in zone', (await g('game.state')) === 'complete' && (await visible('#screen-complete')));
  const money1 = await g('game.save.data.money');
  const earned = await page.textContent('#res-total');
  check('Reward added to money', money1 > money0, `earned ${earned}, balance ${money1}`);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('truckSim.save.v1')));
  check('Money + deliveries saved', stored.money === money1 && stored.deliveriesCompleted === deliveries0 + 1);
  await shot('07-complete');

  // ---- Next delivery (restart loop)
  await page.click('#btn-next');
  check('Next delivery offers a new job', (await visible('#screen-offer')) && (await g('game.mission.job.id')) !== job.id);
  await page.click('#btn-offer-accept');
  await holdKeys(['ArrowUp'], 800);
  await page.keyboard.press('Escape');
  await wait(100);
  await page.click('#btn-restart');
  await wait(100);
  const rs = await g('({s: game.state, x: game.phys.x, z: game.phys.z, v: game.phys.speed})');
  check('Restart delivery resets truck', rs.s === 'driving' && Math.abs(rs.x - -110) < 0.1 && Math.abs(rs.z - 152) < 0.1 && rs.v === 0);

  // ---- Failure path
  await g('(game.phys.condition = 0, true)');
  await wait(200);
  check('Mission fails when condition reaches 0', (await g('game.state')) === 'failed' && (await visible('#screen-failed')));
  await page.click('#btn-retry');
  check('Retry after failure', (await g('game.state')) === 'driving' && (await g('game.phys.condition')) === 100);

  // ---- Back to menu, reload, progress loaded
  await page.keyboard.press('Escape');
  await page.click('#btn-pause-menu');
  check('Return to main menu', await visible('#screen-menu'));
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.fps > 0);
  const menuMoney = await page.textContent('#menu-money');
  check('Progress loads after reload', menuMoney === '$' + money1.toLocaleString('en-US'), menuMoney);

  // ---- Full route drive: an autopilot feeds the same input interface the
  // player uses and drives depot -> Eastgate Warehouse through real junctions.
  await page.evaluate(() => {
    window.__game.save.data.nextJobIndex = 0;
  });
  await page.click('#btn-play');
  await page.click('#btn-offer-accept');
  await page.evaluate(() => {
    const game = window.__game;
    const wps = [[-110, 185], [-95, 200], [-12, 200], [0, 188], [0, -186], [12, -200], [98, -200], [110, -188], [110, -142]];
    let i = 0;
    game.input.read = () => {
      const ph = game.phys;
      if (i < wps.length - 1 && Math.hypot(wps[i][0] - ph.x, wps[i][1] - ph.z) < 7) i++;
      const [tx, tz] = wps[i];
      const d = ph.heading - Math.atan2(tx - ph.x, tz - ph.z);
      const bearing = Math.atan2(Math.sin(d), Math.cos(d));
      const dist = Math.hypot(tx - ph.x, tz - ph.z);
      let target = Math.abs(bearing) > 0.3 || dist < 25 ? 6 : 16;
      if (i === wps.length - 1 && dist < 10) target = 0;
      const v = ph.speed;
      return { steer: Math.max(-1, Math.min(1, bearing * 2.5)), throttle: v < target ? 1 : 0, brake: v > target + 1.5 || target === 0 ? 1 : 0 };
    };
  });
  await wait(4000);
  await shot('08-road');
  await page.waitForFunction(() => window.__game.state !== 'driving', null, { timeout: 180000 });
  const drive = await g('({s: game.state, hits: game.phys.collisionCount, t: game.mission.elapsed})');
  check('Full route driven to destination and delivered', drive.s === 'complete', `time ${drive.t.toFixed(0)}s, collisions ${drive.hits}`);
  await shot('09-route-complete');

  console.log(`(headless software-rendered fps: ${await g('game.fps')})`);
  check('No runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
  check('Test run completed without exceptions', false, String(err));
  await shot('error').catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
