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

## Gameplay loop

Main menu → **Play** → job offer (destination, cargo, distance, pay) →
**Accept & Drive** → follow the green arrow, minimap and beacon → stop inside
the green pad → unloading → **Delivery Complete** (pay, time bonus, damage
penalty) → **Next delivery** or **Menu**. There are 3 destinations and they
rotate. Money, completed deliveries and settings are saved in the browser.

The mission fails only if the truck's condition reaches 0% from crashes.

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

## Performance notes

- No physics engine: the world is flat, so collisions are 2D oriented boxes
  in a spatial grid.
- Static scenery is merged into a few meshes or drawn as `InstancedMesh`
  (about 25 draw calls for the whole map).
- No textures or model files. All audio is synthesized at runtime.
- Graphics: **Low** (0.75x resolution), **Medium** (1x, the default),
  **High** (up to 2x resolution plus real-time shadows). Low and Medium use a
  cheap blob shadow under the truck.
