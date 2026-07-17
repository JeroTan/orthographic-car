# Tiny Touring

Small procedural orthographic driving world. Built with Astro, Vue 3, and Three.js; tuned for low-end hardware.

## Play

- `W` or `ArrowUp`: accelerate
- `S` or `ArrowDown`: brake; keep holding after stopping to reverse
- `A`/`D` or `ArrowLeft`/`ArrowRight`: steer
- On-screen buttons support pointer/touch controls.
- Drive through any edge; 18×18 map repeats seamlessly.
- **New map** regenerates roads and scenery from another seed.

## Local development

Requires Node.js 22.12.0 or newer.

```powershell
npm ci
npm run dev -- --background
```

Use Astro background server commands:

```powershell
npm run astro -- dev status
npm run astro -- dev logs
npm run astro -- dev stop
```

## Verification

```powershell
npm run check
npm test
npm run build
```

Production build lands in `dist/`.

## Architecture

- `src/pages/index.astro`: static page shell.
- `src/components/CarGame.vue`: Vue island, HUD, keyboard/pointer input.
- `src/game/scene.ts`: optimized Three.js renderer and low-poly scene.
- `src/game/vehicle.ts`: tested movement model.
- `src/game/world.ts`: tested seeded world generator.

Performance choices: instanced repeated scenery/roads, shared geometry/materials, low-poly meshes, no shadows, no postprocessing, low-power WebGL preference, 1× pixel-ratio cap, lazy Three.js loading, and full render-loop pause while idle or hidden.

## Guides

- [Deploy to Azure Static Web Apps](docs/deploy-to-azure.md)
- [Vue for React developers](docs/vue-for-react-developers.md)
- [Implementation audit](docs/implementation-audit.md)

No Cloudflare adapter, Worker, Wrangler config, or Cloudflare deployment path exists in this project.
