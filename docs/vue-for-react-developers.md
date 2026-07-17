# Vue in this codebase, for React developers

This project uses Astro for page composition, Vue for interactive UI, and Three.js for rendering. Vue does not replace Astro or Three.js:

```text
src/pages/index.astro
  -> creates static document shell
  -> hydrates CarGame.vue in browser
       -> owns controls and HUD state
       -> starts scene.ts
            -> owns Three.js render loop and game simulation
```

Start with these files:

- [`src/pages/index.astro`](../src/pages/index.astro): Astro page and Vue island boundary.
- [`src/components/CarGame.vue`](../src/components/CarGame.vue): Vue Single-File Component (SFC), keyboard/pointer input, and HUD.
- [`src/game/scene.ts`](../src/game/scene.ts): Three.js runtime called from Vue.
- [`src/game/vehicle.ts`](../src/game/vehicle.ts): framework-independent movement model.
- [`src/game/world.ts`](../src/game/world.ts): framework-independent procedural map model.

Astro supports Vue through its official integration. Framework components need a `client:*` directive to become interactive in-browser; otherwise Astro renders static HTML only ([Astro framework components](https://docs.astro.build/en/guides/framework-components/), [`@astrojs/vue`](https://docs.astro.build/en/guides/integrations-guide/vue/)).

## Fast React-to-Vue map

| React idea | Vue 3 Composition API | This repo |
| --- | --- | --- |
| Function component | Vue SFC with `<script setup>` + `<template>` | `CarGame.vue` |
| `useState(0)` | `const value = ref(0)` | `const speed = ref(0)` |
| One state object | `reactive({ ... })` | `const controls = reactive<VehicleInput>(...)` |
| Derived value / `useMemo` | `computed(() => ...)` | `displaySpeed`, `surfaceLabel` |
| `useEffect(..., [])` | `onMounted(() => ...)` | listeners + `startGame()` |
| Effect cleanup | `onUnmounted(() => ...)` | listeners + Three.js disposal |
| `useRef(null)` DOM ref | `const gameHost = ref()` + `ref="gameHost"` | Three.js container |
| JSX event `onClick={fn}` | Template event `@click="fn"` | New-map button |
| Conditional `{error && ...}` | `v-if="loadError"` | WebGL error panel |
| `className` expression | `:class="{ active: condition }"` | pressed controls |
| Custom hook | Composable named `useSomething()` | Not needed yet |
| CSS Module / CSS-in-JS | `<style scoped>` | `CarGame.vue` styles |

Vue supports Options API and Composition API. This code uses Composition API plus `<script setup>`, Vue's common SFC style. Composition API groups logic by feature and uses normal imported functions such as `ref`, `computed`, `onMounted`, and `onUnmounted` ([Vue Composition API FAQ](https://vuejs.org/guide/extras/composition-api-faq), [SFC `<script setup>`](https://vuejs.org/api/sfc-script-setup.html)).

## Single-File Components versus JSX

React commonly puts render markup inside a JavaScript return value. Vue SFCs keep three languages in one file with explicit sections:

```vue
<script setup lang="ts">
// state, functions, lifecycle
</script>

<template>
  <!-- declarative HTML-like UI -->
</template>

<style scoped>
/* styles compiled to affect this component only */
</style>
```

Top-level names declared or imported in `<script setup>` are directly available in template. No return object, `export default`, or `this` is needed. Vue compiles template into a render function ([Vue SFC syntax](https://vuejs.org/api/sfc-spec.html), [`<script setup>`](https://vuejs.org/api/sfc-script-setup.html)).

In [`CarGame.vue`](../src/components/CarGame.vue), `displaySpeed`, `generateNewWorld`, and `controls` are used directly by template.

## Reactivity: `ref`, `reactive`, and `computed`

Vue tracks reads and writes to reactive values. A `ref` wraps one value:

```ts
const speed = ref(0);
speed.value = telemetry.speed;
```

Use `.value` in TypeScript. Vue automatically unwraps refs in template, so template uses `{{ displaySpeed }}`, not `{{ displaySpeed.value }}`. `reactive()` wraps an object; its properties are read and written normally:

```ts
const controls = reactive({
  accelerate: false,
  brake: false,
  left: false,
  right: false,
});

controls.accelerate = true;
```

`computed()` creates cached derived state and automatically tracks reactive values read by callback:

```ts
const displaySpeed = computed(() => Math.round(speed.value * 5.2));
```

Unlike `useMemo`, there is no dependency array. Vue discovers `speed.value` dependency while computed getter runs. See [Vue reactivity fundamentals](https://vuejs.org/guide/essentials/reactivity-fundamentals.html) and [`computed()`](https://vuejs.org/guide/essentials/computed.html).

## Lifecycle versus `useEffect`

`CarGame.vue` starts browser-only work in `onMounted()`:

```ts
onMounted(() => {
  window.addEventListener('keydown', handleKeyDown, { passive: false });
  window.addEventListener('keyup', handleKeyUp, { passive: false });
  window.addEventListener('blur', releaseControls);
  startGame();
});
```

Cleanup lives in matching `onUnmounted()` hook. This resembles mount-only `useEffect` plus returned cleanup, but component setup does not rerun on every state update. `<script setup>` executes once per component instance; Vue then updates affected template nodes through tracked reactivity. Lifecycle hooks must be registered synchronously during setup ([Vue lifecycle hooks](https://vuejs.org/guide/essentials/lifecycle.html)).

Vue also has `watch()` and `watchEffect()` for reactive side effects. Neither is needed here because game emits telemetry through callback and UI derives labels with `computed()`. Prefer `computed()` when producing a value; use watcher only for an effect such as persistence, logging, or external synchronization ([Vue watchers](https://vuejs.org/guide/essentials/watchers.html)).

## DOM refs and Three.js boundary

Template declares host element:

```vue
<div ref="gameHost" class="game-canvas" />
```

Script declares matching ref:

```ts
const gameHost = ref<HTMLElement>();
```

After mount, `gameHost.value` is DOM element. `startGame()` passes it to `createGameScene()`. This is same role as React DOM ref, without `ref={gameHost}` JSX syntax.

Three.js runtime stays outside Vue reactivity on purpose:

- `scene.ts` runs animation loop and mutates Three.js objects directly.
- `CarGame.vue` does not store `Scene`, meshes, or per-frame coordinates in reactive state.
- Runtime sends small telemetry update about eight times per second for speed/surface HUD.
- `let game` remains plain non-reactive variable because template never renders it.

This separation avoids forcing Vue component updates at display frame rate. Vue manages UI; Three.js manages GPU scene.

## Events and bindings

Vue template directives use short prefixes:

- `@click="generateNewWorld"` means `v-on:click`.
- `:class="{ active: controls.left }"` means `v-bind:class`.
- `v-if="loadError"` conditionally creates error panel.
- `{{ surfaceLabel }}` interpolates text and escapes it.

Event handlers receive native events. `$event` passes current event explicitly:

```vue
@pointerdown="handlePointerStart($event, 'accelerate')"
```

Vue documents event modifiers such as `.prevent`, `.stop`, and keyboard aliases; this code calls `preventDefault()` in shared keyboard handler because WASD and arrow keys use same lookup path ([Vue event handling](https://vuejs.org/guide/essentials/event-handling.html), [class bindings](https://vuejs.org/guide/essentials/class-and-style.html)).

## Astro island: why `client:only="vue"`

[`index.astro`](../src/pages/index.astro) renders:

```astro
<CarGame client:only="vue" />
```

`client:only="vue"` skips server/build rendering of this component and starts it in browser. This fits game because Three.js needs `window`, WebGL, canvas size, `ResizeObserver`, and animation loop immediately. A mostly static Vue widget could use `client:load`, `client:idle`, or `client:visible` and still have Astro-generated initial HTML. Astro documents these hydration strategies in its [client directives reference](https://docs.astro.build/en/reference/directives-reference/#client-directives).

Vue integration is registered in [`astro.config.mjs`](../astro.config.mjs):

```js
integrations: [vue()],
```

This enables Vue compilation/hydration. `output: 'static'` means Azure receives built HTML/CSS/JS; no Vue or Astro server runs in production.

## Props, emits, and children when adding components

This game currently keeps HUD in one component. If splitting it, React props map to Vue `defineProps`, callbacks often map to typed `defineEmits`, and `children` maps to slots:

```vue
<script setup lang="ts">
const props = defineProps<{ speed: number }>();
const emit = defineEmits<{ reset: [] }>();
</script>

<template>
  <button @click="emit('reset')">{{ props.speed }}</button>
</template>
```

Vue automatically exposes props in template; props remain one-way/read-only. See [Vue props](https://vuejs.org/guide/components/props.html), [component events](https://vuejs.org/guide/components/events.html), and [slots](https://vuejs.org/guide/components/slots.html).

## React habits to unlearn

1. Do not add dependency arrays. `computed`, `watch`, and `watchEffect` track reactive dependencies according to their APIs.
2. Remember `.value` for refs in TypeScript, but omit it in template.
3. Do not expect component body to rerun after each state change. Setup runs once per instance.
4. Do not destructure properties from `reactive()` casually; plain destructured primitives lose reactive connection. Use original object or `toRefs()` when needed.
5. Do not put high-frequency Three.js objects into reactive state. Keep imperative runtime behind narrow callbacks.
6. Do not mutate props. Emit event or pass callback/controlled state from parent.
7. In Astro, choose hydration directive deliberately. Vue component without `client:*` has no browser interactivity.

## Suggested learning exercises

1. Change `surfaceLabel` computed text in `CarGame.vue` and watch template update.
2. Add reactive `distance` ref, update it in telemetry callback, and render it in status panel.
3. Extract status panel into `DrivingStatus.vue` using typed props.
4. Emit `regenerate` event from child control and handle it in `CarGame.vue`.
5. Extract keyboard state into `useDrivingControls.ts` composable once reuse justifies new seam.

Run after each exercise:

```powershell
npm run check
npm test
```

## Primary references

- [Vue guide](https://vuejs.org/guide/introduction.html)
- [Vue reactivity fundamentals](https://vuejs.org/guide/essentials/reactivity-fundamentals.html)
- [Vue Composition API FAQ, including React Hooks comparison](https://vuejs.org/guide/extras/composition-api-faq)
- [Vue Single-File Component specification](https://vuejs.org/api/sfc-spec.html)
- [Astro framework components and hydration](https://docs.astro.build/en/guides/framework-components/)
- [Astro Vue integration](https://docs.astro.build/en/guides/integrations-guide/vue/)
