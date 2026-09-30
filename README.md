# HaulRun: Truck Simulator (Test Build)

A mobile-first 3D truck driving prototype built with **Three.js + Vite**.
It runs in any modern mobile or desktop browser, so you can test it on an
Android phone without an app build. Later it can be wrapped as an Android app
with Capacitor.

The goal of this build is to answer one question: **does driving the truck feel good?**

## Run it

```bash
npm install
npm run dev        # dev server on http://localhost:5173 and your LAN IP
```

To test on a phone, connect it to the same Wi-Fi and open the `Network:` URL
that Vite prints (for example `http://192.168.1.20:5173`). Rotate to landscape
and tap **Fullscreen** in the menu.

```bash
npm run build      # production build -> dist/ (+ dist/truck-sim-standalone.html)
npm run preview    # serve the production build
npm test           # automated end-to-end smoke test (needs a build first)
```

`dist/truck-sim-standalone.html` is a single self-contained file (about 580 KB)
that you can open directly or host anywhere.

## Controls

| Action | Touch | Keyboard |
| --- | --- | --- |
| Accelerate | **GAS** pedal (bottom right) | `W` / `↑` |
| Brake | **BRAKE** pedal | `S` / `↓` / `Space` |
| Steer | **◀ ▶** buttons, drag **steering wheel**, or **tilt** (Settings → Steering) | `A` `D` / `←` `→` |
| Drive / Reverse | **D \| R** switch above the pedals (only when stopped) | `R` |
| Camera view (Chase / Far / Close / Cab) | **CAM** | `C` |
| Look around | Drag anywhere on the 3D view | n/a |
| Zoom | Pinch on the 3D view | Mouse wheel |
| Re-centre tilt | **RE-CENTRE** (tilt mode) | n/a |
| Recover truck | **RESET** | `T` |
| Couple / uncouple trailer | **HITCH** / **UNHITCH** (appears when possible) | `H` |
| Pause | **❚❚** (top right) | `Esc` / `P` |

In Reverse, **GAS** drives backwards. Hold **BRAKE** to stop and stay stopped.

## Trucks and trailers

Pick a truck in the **Garage**. The Mercer box truck carries cargo itself.
The three tractor units (Kestrel, Ridgeline, Vanta) haul semi-trailers: each
job parks the right trailer behind you (box, refrigerated, flatbed, tanker or
container). Reverse the fifth wheel under the trailer's kingpin, tap
**HITCH**, then park the *trailer* on the green pad to deliver. Reversing
with steering jackknifes the trailer; drive forward to straighten it.

Truck data lives in `src/data/trucks.js`; trailer types live in `src/data/trailers.js`.

## Gameplay loop (career)

Main menu → **Play** → **Job Market** (6 jobs: cargo, route, distance, weight,
reward, difficulty stars) → pick a job → **Accept job** → drive to the pickup
(orange marker) → load the box truck, or couple the trailer → drive to the
drop-off (green marker) → stop on the pad → **Delivery Complete** (pay, time
bonus, damage penalty) → **Job market** at your new location.

- Four facilities (depot, warehouse, construction site, market) each produce and accept different cargo.
- The truck stays where it delivered, and the next job market is generated there.
- The delivery timer starts once the cargo is on board. Perishables pay a bigger time bonus, and fragile or hazardous cargo loses more pay per % of damage.
- A job fails if the condition reaches 0%, or if you abandon it from the pause menu. Failing costs a cancellation fee.

Data: `src/data/cargo.js` (13 cargo types), `src/data/economy.js` (all pay
values), facilities in `src/game/mapData.js`, and job generation and reward
maths in `src/game/jobs.js`.

## Project layout

```
src/
  main.js              game state machine + main loop (fixed 60 Hz physics step)
  config.js            ALL tuning values (truck, camera, mission, graphics)
  core/
    input.js           keyboard + multi-touch buttons + look-drag
    audio.js           synthesized WebAudio (engine, brakes, beeper, UI, impacts)
    save.js            localStorage save (money, deliveries, settings)
  game/
    truckPhysics.js    arcade bicycle-model truck physics + collision response
    truckModel.js      low-poly placeholder truck built from primitives
    cameraRig.js       smoothed chase camera, presets, anti-clip, shake
    collision.js       2D oriented-box SAT + spatial grid + raycast
    mapData.js         map layout: roads, junctions, lots, jobs, spawn
    world.js           builds batched/instanced map meshes + colliders
    mission.js         delivery mission states, zone marker, reward calc
  ui/
    ui.js              menus, HUD, settings panel, toasts
    minimap.js         rotating canvas minimap
  styles.css           mobile-first UI styles
tests/smoke.mjs        Playwright end-to-end test (43 checks)
scripts/inline-build.mjs  builds the single-file standalone HTML
```

### Tuning the driving feel

Everything is in `src/config.js`:

- `TRUCK`: engine torque curve, 6-speed auto gearbox (ratios, shift points,
  shift time), governor, brakes and air-brake build-up, steering rate and
  limits, grip cap, yaw inertia, collision response.
- `SURFACES`: grip and rolling resistance for road vs grass.
- `SUSPENSION`: body spring stiffness and damping, lean amounts, bumpiness.
- `CAMERA`: presets, lag, speed FOV, turn look-ahead, zoom range.

Current feel: 0 to 60 km/h in about 13 s with five audible gear changes, a
governed top speed of 90 km/h, a 60 to 0 km/h stop in about 23 m, and a
turning radius of about 8.4 m at low speed.

## Graphics

Everything is generated in code, so there are no model or texture downloads.

- **Lighting:** a physically based atmospheric sky baked into an environment
  map, so paint, chrome and glass reflect the sky. ACES filmic tone mapping,
  a warm sun with shadows that follow the truck, and horizon-coloured haze.
- **Textures** (`src/render/textures.js`): asphalt with tyre-wear lanes and
  a normal map, worn road paint, grass, concrete slabs, gravel shoulders,
  office, brick and plaster facades, corrugated cladding, loading-dock doors,
  branded trailer sides, container steel, wood decks and signs.
- **Trucks** (`src/game/truckModel.js`): detailed cabs (cabover, long hood,
  aero), grilles, mirrors, visors, marker lights, fuel tanks, stacks, fifth
  wheel, air lines, and dual wheels with rims and lug nuts. Parts are merged
  per material, so a truck costs about 15 draw calls.
- **Trailers** (`src/game/trailerModel.js`): ribbed vans with rear doors and
  reflective tape, a reefer unit, a flatbed whose load matches the cargo
  (I-beams, lumber or a machine), a polished tanker with a walkway, and a
  container chassis.
- **World** (`src/game/world.js`, `src/game/worldProps.js`): shoulders,
  stop lines, crossings, animated traffic lights, street lights, W-beam
  guardrails, jersey barriers, facility buildings with signs, a tower crane,
  wind turbines, forested hills, parked cars and stacked containers.
- **Effects** (`src/render/effects.js`): diesel exhaust (heavier under load
  and on gear changes) and dust on grass, all in one particle draw call.
- **HUD:** an analog instrument cluster (rev counter and speedometer).

`node tests/visual.mjs [low|medium|high]` renders review shots of every truck,
every trailer and the world into `test-results/visual/`.

## Performance notes

- No physics engine: the world is flat, so collisions are 2D oriented boxes
  in a spatial grid.
- Static scenery is merged into a few meshes or drawn as `InstancedMesh`
  (about 25 draw calls for the whole map).
- No textures or model files. All audio is synthesized at runtime.
- Graphics presets:
  - **Low:** 0.8x resolution, no shadow maps (the truck uses a blob shadow), about 110 draw calls.
  - **Medium** (the default): 1.25x resolution, 1024 px shadows.
  - **High:** up to 2x resolution, 2048 px shadows.
