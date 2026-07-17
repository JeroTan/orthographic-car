# Implementation audit

Audit date: 2026-07-17. Scope: original orthographic driving-world request.

## Requirement coverage

| Requirement | Implementation evidence | Verification |
| --- | --- | --- |
| Three.js orthographic view | [`scene.ts`](../src/game/scene.ts) creates `THREE.OrthographicCamera`, renderer, car, terrain, lighting, and fixed isometric-style camera offset. | Desktop and narrow-screen headless Edge captures rendered car/world successfully. |
| Movable car | [`vehicle.ts`](../src/game/vehicle.ts) exposes controller state and `step()` movement. `scene.ts` applies state to car group every frame. | Vehicle test suite passes movement and steering behavior. |
| Arrow keys and WASD | [`CarGame.vue`](../src/components/CarGame.vue) maps `Arrow*` plus `KeyW/A/S/D` to same four controls. | Typecheck validates mapping; on-screen pointer controls use same state seam. |
| Up/W accelerates | Controller adds forward acceleration and caps maximum speed. | `vehicle.test.ts`: “accelerates forward and slows when braking.” |
| Down/S decelerates, then reverses | Brake reduces forward speed to zero; keeping it held accelerates backward at a lower capped speed. | Vehicle tests verify braking rate and reverse movement after stopping. |
| Random living environment | Seeded generator places trees, rocks, flowers, and cottages. Renderer adds road lamps. | `world.test.ts` verifies scenery exists and changes with seed. Visual capture confirms all prop types used by seed when present. |
| Roads | Generator creates two-tile-wide looping road routes; renderer batches shoulders and surfaces. | World tests verify road presence and seed variation. Visual capture confirms readable road network. |
| Procedural small map | [`world.ts`](../src/game/world.ts) generates 18×18 layout from seed. “New map” advances seed and rebuilds scene. | Tests verify 18×18/144-unit contract and different seeded outputs. |
| Repeating overworld | Vehicle coordinates wrap inside world span. Scene instantiates 3×3 copies around playable map so camera never sees empty edge. | `vehicle.test.ts`: “wraps travel inside repeating world bounds.” Visual scene shows neighboring repeated content around camera. |
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
- Vitest: 2 files, 7 tests, all passing.
- Astro: one static page built into `dist/`.
- Cloudflare runtime dependencies/config: none.

## Intentional limits

- Map starts small at 18×18 tiles, per request.
- Driving is lightweight arcade movement, not full rigid-body physics.
- Environment props are visual; car does not collide with them.
- Reverse speed is deliberately capped below forward speed for controllable arcade handling.
- Azure target is static hosting. Adding server routes later requires new architecture/deployment decision.
