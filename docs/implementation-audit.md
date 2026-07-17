# Implementation audit

Audit date: 2026-07-17. Scope: original orthographic driving-world request.

## Requirement coverage

| Requirement | Implementation evidence | Verification |
| --- | --- | --- |
| Three.js orthographic view | [`scene.ts`](../src/game/scene.ts) creates `THREE.OrthographicCamera`, renderer, car, terrain, lighting, and fixed isometric-style camera offset. | Desktop and narrow-screen headless Edge captures rendered car/world successfully. |
| Movable car | [`vehicle.ts`](../src/game/vehicle.ts) exposes controller state and `step()` movement. `scene.ts` applies state to car group every frame. | Vehicle test suite passes movement and steering behavior. |
| Arrow keys, WASD, and handbrake | [`CarGame.vue`](../src/components/CarGame.vue) maps `Arrow*` plus `KeyW/A/S/D`; `Space` and on-screen control engage handbrake drift. | Typecheck validates mapping; keyboard and pointer controls use same `VehicleInput` seam. |
| Up/W accelerates | Controller adds forward acceleration using road/meadow handling profiles and capped maximum speeds. | Vehicle tests verify baseline acceleration plus different road and meadow acceleration/top speeds. |
| Down/S decelerates, then reverses | Brake reduces forward speed to zero; keeping it held accelerates backward at a lower capped speed. | Vehicle tests verify braking rate and reverse movement after stopping. |
| Random living environment | Seeded generator places trees, rocks, flowers, and cottages. Renderer adds road lamps. | `world.test.ts` verifies scenery exists and changes with seed. Visual capture confirms all prop types used by seed when present. |
| Roads | Generator creates two-tile-wide looping routes. Renderer builds one shared-vertex asphalt surface, removes internal tile gaps/borders, and adds diagonal joins where three road tiles meet around one corner, including across wrapped map seams. Road terrain queries reuse those joins, so visible asphalt retains road handling. One geometry is instanced across nine repeating maps. Road lamps choose adjacent meadow positions and skip intersections without a safe roadside tile. | Road-surface tests verify shared 2×2 topology, diagonal three-tile joins, matching terrain classification, and wrapped seam joins. World tests verify road presence, seed variation, and safe lamp placement. Headless render confirms continuous charcoal-gray asphalt without brown tile outlines. |
| Procedural small map | [`world.ts`](../src/game/world.ts) generates 18×18 layout from seed. “New map” advances seed and rebuilds scene. | Tests verify 18×18/144-unit contract and different seeded outputs. |
| Repeating overworld | Vehicle coordinates wrap inside world span. Scene instantiates 3×3 copies around playable map so camera never sees empty edge. | `vehicle.test.ts`: “wraps travel inside repeating world bounds.” Visual scene shows neighboring repeated content around camera. |
| Environment collision | Vehicle uses two-circle footprint against toroidal collision index. Trees, rocks, cottages, and road lamps block movement; flowers remain pass-through. Collision stops penetration while steering and reverse remain available. | Vehicle test proves sustained acceleration cannot pass through tree. World test proves rendered roadside lamps share collision placement. |
| Terrain and cornering speed | Road travel accelerates to 26 world units/s; meadow travel accelerates more slowly and tops out at 14. Reverse is capped at 12 on roads and 7 on meadow. Leaving road preserves momentum while meadow resistance reduces excess speed. Speed-proportional cornering drag slows sustained turns. | Vehicle tests compare road/meadow forward acceleration, forward/reverse top speeds, smooth road-to-meadow transition, and turning versus equivalent straight travel. |
| Vehicle physics and animation | Controller separates velocity direction from chassis heading, reduces powered rear grip during launch slip, lowers rear grip modestly during hard braking, applies much lower rear grip under handbrake, and exposes longitudinal load, lateral load, steering angle, slip angle, rear-wheel slip, and skid intensity. Renderer maps those values to chassis pitch/roll/squash/stretch, front-wheel steering, rear-wheel burnout, fading tire trails, and smoke. HUD converts signed longitudinal chassis motion to scalar km/h; visual wheel spin never feeds speedometer. | Vehicle tests verify modest brake-turn skid while ground speed continues falling, distinctly stronger Space-handbrake drift, opposing acceleration/braking loads, steering/lateral-force direction, rear-drive launch slip, hard-braking skid, and positive speedometer readings in either travel direction. |
| Potato-hardware optimization | Static instancing, shared low-poly geometry/materials, no shadows, no postprocessing, low-power renderer, 1× pixel-ratio cap, full idle/hidden render-loop pause, telemetry throttling, and lazy Three.js import. | Production build separates 6.4 kB Vue game shell from ~537 kB raw / ~134 kB gzip scene chunk. Headless Edge with software WebGL rendered scene successfully. Runtime HUD exposes scene draw-call count. |
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
- Vitest: 3 files, 25 tests, all passing.
- Astro: one static page built into `dist/`.
- Cloudflare runtime dependencies/config: none.

## Intentional limits

- Map starts small at 18×18 tiles, per request.
- Driving is lightweight arcade movement, not full rigid-body physics.
- Handling uses deterministic surface and cornering profiles, not tire-by-tire simulation.
- Drift uses a lightweight bicycle-style velocity/slip model; effects use bounded GPU-instanced pools (48 trail marks, 24 smoke puffs).
- Collision uses lightweight circles rather than rigid-body physics; flowers remain decorative/pass-through.
- Reverse speed is deliberately capped below forward speed for controllable arcade handling.
- Azure target is static hosting. Adding server routes later requires new architecture/deployment decision.
