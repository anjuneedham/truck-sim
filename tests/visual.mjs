// Visual review: renders fixed camera shots of trucks, trailers and the world
// into test-results/visual/. Run after `npm run build`:
//   node tests/visual.mjs [quality]
// Not an assertion test - it exists so visual changes can be reviewed quickly.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const pageUrl = new URL('dist/truck-sim-standalone.html', root).href;
const outDir = fileURLToPath(new URL('test-results/visual/', root));
mkdirSync(outDir, { recursive: true });
const quality = process.argv[2] || 'high';
const only = process.argv[3] || '';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(pageUrl);
await page.waitForFunction(() => window.__game && window.__game.fps > 0, null, { timeout: 30000 });
await page.evaluate((q) => {
  localStorage.clear();
  window.__game.setSetting('quality', q);
}, quality);

/** Freeze the game loop's camera logic and place the camera manually. */
async function shot(name, setup) {
  if (only && !name.includes(only)) return;
  await page.evaluate(setup);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}${name}.png` });
  console.log('shot', name);
}

const hideUI = () => {
  for (const id of ['screen-menu', 'screen-jobs', 'screen-garage', 'hud', 'controls', 'toast']) document.getElementById(id)?.classList.add('hidden');
};

// Truck close-ups (3/4 front) for each catalogue truck.
for (const id of ['mercer-mbox9', 'kestrel-c400', 'ridgeline-l560', 'vanta-aero480']) {
  await shot(`truck-${id}`, `(() => {
    const g = window.__game;
    (${hideUI})();
    g.setTruck(window.__trucks.find((t) => t.id === '${id}'));
    g.state = 'shot';
    const p = g.phys;
    g.camera.position.set(p.x + 8.5, 3.2, p.z + 9);
    g.camera.lookAt(p.x, 1.7, p.z + 0.5);
  })()`);
  await shot(`truck-rear-${id}`, `(() => {
    const g = window.__game;
    const p = g.phys;
    g.camera.position.set(p.x - 7, 3.5, p.z - 10);
    g.camera.lookAt(p.x, 1.6, p.z);
  })()`);
}

// Rig with each trailer type, 3/4 rear view.
for (const t of ['box', 'reefer', 'flatbed', 'tanker', 'container']) {
  await shot(`rig-${t}`, `(() => {
    const g = window.__game;
    (${hideUI})();
    g.setTruck(window.__trucks.find((x) => x.id === 'kestrel-c400'));
    g.spawnTrailer({ trailer: '${t}', cargo: '${t === 'flatbed' ? 'steel' : 'canned'}', from: 'depot', cargoMass: 0 });
    g.world.collision.removeDynamic(g.trailer.parkedBox);
    g.phys.attachTrailer(g.trailer);
    g.resetTruck(g.phys.x, g.phys.z, g.phys.heading);
    g.state = 'shot';
    const p = g.phys;
    g.camera.position.set(p.x + 11, 4.5, p.z - 18);
    g.camera.lookAt(p.x, 1.8, p.z - 6);
  })()`);
}

// Chase camera while driving on the ring road with a box trailer.
await shot('chase-road', `(() => {
  const g = window.__game;
  g.removeTrailer();
  g.toMenu();
  g.startJob(g.createJob('canned', 'depot', 'warehouse'));
  g.resetTruck(-60, 200, Math.PI / 2);
  g.state = 'driving';
  document.getElementById('toast').classList.add('hidden');
})()`);
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(3000);
await page.keyboard.up('ArrowUp');
await page.screenshot({ path: `${outDir}chase-road-driving.png` });

// Wide views of the world.
await shot('world-junction', `(() => {
  const g = window.__game;
  (${hideUI})();
  g.state = 'shot';
  g.camera.position.set(30, 22, 40);
  g.camera.lookAt(0, 0, 0);
})()`);
await shot('world-depot', `(() => {
  const g = window.__game;
  g.camera.position.set(-40, 25, 205);
  g.camera.lookAt(-110, 2, 150);
})()`);
await shot('world-highway', `(() => {
  const g = window.__game;
  g.camera.position.set(150, 6, 214);
  g.camera.lookAt(0, 2, 196);
})()`);
await shot('world-site', `(() => {
  const g = window.__game;
  g.camera.position.set(-5, 14, 60);
  g.camera.lookAt(45, 4, 110);
})()`);

const info = await page.evaluate(() => window.__game.renderer.info.render);
console.log('draw calls', info.calls, 'triangles', info.triangles);
console.log('errors', errors);
await browser.close();
