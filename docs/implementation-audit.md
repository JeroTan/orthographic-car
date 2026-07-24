# Implementation audit

Audit date: 2026-07-20. Scope: original orthographic driving-world request.

## Requirement coverage

| Requirement | Implementation evidence | Verification |
| --- | --- | --- |
| Three.js orthographic view | [`scene.ts`](../src/game/scene.ts) creates `THREE.OrthographicCamera`, renderer, car, terrain, lighting, and fixed isometric-style camera offset. | Desktop and narrow-screen headless Edge captures rendered car/world successfully. |
| Movable car | [`vehicle.ts`](../src/game/vehicle.ts) exposes controller state and `step()` movement. `scene.ts` applies state to car group every frame. | Vehicle test suite passes movement and steering behavior. |
| Arrow keys, WASD, and handbrake | [`CarGame.vue`](../src/components/CarGame.vue) maps `Arrow*` plus `KeyW/A/S/D`; `Space` and on-screen control engage handbrake drift. | Typecheck validates mapping; keyboard and pointer controls use same `VehicleInput` seam. |
| Up/W accelerates | Controller adds forward acceleration using road/meadow handling profiles and capped maximum speeds. | Vehicle tests verify baseline acceleration plus different road and meadow acceleration/top speeds. |
| Down/S decelerates, then reverses | Brake reduces forward speed to zero; keeping it held accelerates backward at a lower capped speed. | Vehicle tests verify braking rate and reverse movement after stopping. |
| Random living environment | Seeded generator places trees, rocks, flowers, and cottages. Renderer adds road lamps. | `world.test.ts` verifies scenery exists and changes with seed. Visual capture confirms all prop types used by seed when present. |
| Roads | Seeded urban grammar selects collector-loop, parallel-grid, or staggered-block family. Every family starts with straight east-west and north-south arterials across wrapped map seams, then adds only whole orthogonal segments: no sine sampling or staircase roads. Same seed reproduces same plan; “New map” can change both family and dimensions. Renderer uses supplied [`RoadTexture2.jpg`](../src/assets/roads/RoadTexture2.jpg) as actual asphalt map with an unlit material that preserves its neutral-gray color, one shared road geometry instanced across nine repeating maps, and compact eight-segment quarter-circle joins with an 18%-tile curb radius. Road terrain queries reuse same rounded footprint. | World test exercises one seed per grammar family and verifies three unique yet reproducible layouts, full connectivity, central arterials, readable junctions, no more than four intentional corners, zero 2×2 asphalt blocks, and bounded road counts. Road-surface tests verify compact rounded joins, terrain classification, and wrapped seams. Production build emits supplied 68,560-byte asphalt asset; headless render confirms neutral-gray textured asphalt. |
| Procedural small map | [`world.ts`](../src/game/world.ts) generates 18×18 layout from seed. “New map” advances seed and rebuilds scene. | Tests verify 18×18/144-unit contract and different seeded outputs. |
| Repeating overworld | Vehicle coordinates wrap inside world span. Scene instantiates 3×3 copies around playable map so camera never sees empty edge. | `vehicle.test.ts`: “wraps travel inside repeating world bounds.” Visual scene shows neighboring repeated content around camera. |
| Environment collision | Vehicle uses two-circle footprint against toroidal collision index. Trees, rocks, cottages, and road lamps block movement; flowers remain pass-through. Collision stops penetration while steering and reverse remain available. | Vehicle test proves sustained acceleration cannot pass through tree. World test proves rendered roadside lamps share collision placement. |
| Terrain and cornering speed | Porsche asset is calibrated against 4.469 m length and 1.852 m width. One world unit is 0.9104 m along travel; width scale feeds the collision footprint. At 20 km/h, controller moves 6.102 world units/s (1.24 packed-car lengths/s). Road travel tops out at 100.383 world units/s (329 displayed km/h); meadow travel accelerates more slowly and tops out at 54.006 (177 displayed km/h). Reverse is capped at 46.378 on roads and 27.155 on meadow. Forward acceleration tapers with speed to model gearing and aerodynamic load. Leaving road preserves momentum while meadow resistance reduces excess speed. Speed-proportional cornering drag slows sustained turns. | Vehicle tests compare calibrated dimensions, 20 km/h integration travel, road/meadow forward acceleration, Porsche-scale 0–100 timing, forward/reverse top speeds, smooth road-to-meadow transition, and turning versus equivalent straight travel. |
| Vehicle physics and animation | Controller separates velocity direction from chassis heading, tapers drive acceleration at high speed, reduces powered rear grip during launch slip, lowers rear grip modestly during hard braking, applies much lower rear grip under handbrake, cuts throttle to 25% during handbrake drift, and exposes longitudinal load, lateral load, steering angle, slip angle, rear-wheel slip, and skid intensity. Renderer maps those values to chassis pitch/roll/squash/stretch, front-wheel steering, rear-wheel burnout, fading tire trails, and smoke. HUD converts signed longitudinal chassis motion to scalar km/h; visual wheel spin never feeds speedometer. | Vehicle tests verify Porsche-scale top speed and 0–100 timing, handbrake speed loss with throttle held, modest brake-turn skid while ground speed continues falling, distinctly stronger Space-handbrake drift, opposing acceleration/braking loads, steering/lateral-force direction, rear-drive launch slip, hard-braking skid, and positive speedometer readings in either travel direction. |
| Porsche vehicle model | [`porsche-model.ts`](../src/game/porsche-model.ts) loads supplied Porsche 911 GT2 geometry and textures only after main scene starts. [`build-porsche-model.mjs`](../scripts/build-porsche-model.mjs) rotates the source model from its native −Z forward axis to game +Z, merges fifteen body parts, and quantizes source OBJ attributes into a 0.86 MB runtime binary, down from 2.98 MB. Four wheel meshes remain separate for front steering and wheel spin. Existing chassis lean/stretch, rear-drive slip, trails, smoke, collision, and fallback car remain active. BMP source textures become compact WebP runtime assets. | Porsche model test verifies narrow steering axle faces +Z while wider rear-driven axle stays at −Z. Production typecheck/build succeeds. Software-WebGL capture shows textured body and aligned wheels in world. |
| Potato-hardware optimization | Static instancing, shared low-poly geometry/materials, no shadows, no postprocessing, low-power renderer, 1× pixel-ratio cap, full idle/hidden render-loop pause, telemetry throttling, and lazy Three.js/Porsche imports. | Production build separates 4.9 kB Vue game shell, ~547 kB raw scene/Three code, and lazy 0.86 MB quantized Porsche geometry plus 48 kB WebP textures. Source 2.98 MB OBJ is absent from `dist/`. Software-WebGL capture renders scene successfully. Runtime HUD exposes draw-call count. |
| Astro + Vue | Astro page hydrates `CarGame.vue` as client-only Vue island; Vue owns HUD/input; Three.js stays imperative. | `astro check`: 0 errors, warnings, or hints. Static production build succeeds. |
| Azure, not Cloudflare | Astro uses `output: 'static'`; no Cloudflare adapter, Wrangler file, binding, or Worker entry exists. | [`deploy-to-azure.md`](deploy-to-azure.md) documents Azure Static Web Apps workflow and Cloudflare mental-model mapping. |
| Vue learning guide | React-to-Vue mappings point to actual component, state, lifecycle, Astro island, and Three.js boundary. | [`vue-for-react-developers.md`](vue-for-react-developers.md). |

## Automated verification

Final verification command:

```powershell
npm run build
```

`build` runs:

1. `astro check`
2. `vitest run`
3. `astro build`

Audit result:

- Astro diagnostics: 0 errors, 0 warnings, 0 hints.
- Vitest: 6 files, 45 tests, all passing.
- Astro: one static page built into `dist/`.
- Cloudflare runtime dependencies/config: none.

## Intentional limits

- Map starts small at 18×18 tiles, per request.
- Driving is lightweight arcade movement, not full rigid-body physics.
- Handling uses deterministic surface and cornering profiles, not tire-by-tire simulation.
- Drift uses a lightweight bicycle-style velocity/slip model; effects use bounded GPU-instanced pools (48 trail marks, 24 smoke puffs).
- Collision uses lightweight circles rather than rigid-body physics; flowers remain decorative/pass-through.
- Reverse speed is deliberately capped below forward speed for controllable arcade handling.
- Supplied Porsche asset contains no license metadata. Confirm redistribution rights before public deployment.
- Azure target is static hosting. Adding server routes later requires new architecture/deployment decision.
