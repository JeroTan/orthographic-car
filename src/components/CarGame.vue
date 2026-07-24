<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";

import type { GameScene } from "../game/scene";
import {
  DEFAULT_PORSCHE_COLOR,
  PORSCHE_COLORS,
  type PorscheColor,
} from "../game/porsche-colors";
import { toSpeedometerKmh, type VehicleInput } from "../game/vehicle";
import { WORLD_GRID_SIZE } from "../game/world";

type Control = keyof VehicleInput;

const gameHost = ref<HTMLElement>();
const speed = ref(0);
const surface = ref<"road" | "meadow">("meadow");
const drawCalls = ref(0);
const seed = ref(6767);
const loadError = ref("");
const carColor = ref<PorscheColor>(DEFAULT_PORSCHE_COLOR);
const controls = reactive<VehicleInput>({
  accelerate: false,
  brake: false,
  left: false,
  right: false,
  handbrake: false,
});
const keyMap: Readonly<Record<string, Control>> = {
  ArrowUp: "accelerate",
  KeyW: "accelerate",
  ArrowDown: "brake",
  KeyS: "brake",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  Space: "handbrake",
};
const controlButtons: ReadonlyArray<{
  control: Control;
  className: string;
  key: string;
  arrow: string;
  label: string;
}> = [
  {
    control: "accelerate",
    className: "key-up",
    key: "W",
    arrow: "↑",
    label: "Accelerate",
  },
  {
    control: "left",
    className: "key-left",
    key: "A",
    arrow: "←",
    label: "Steer left",
  },
  {
    control: "brake",
    className: "key-down",
    key: "S",
    arrow: "↓",
    label: "Brake or reverse",
  },
  {
    control: "right",
    className: "key-right",
    key: "D",
    arrow: "→",
    label: "Steer right",
  },
  {
    control: "handbrake",
    className: "key-drift",
    key: "SPACE",
    arrow: "DRIFT",
    label: "Handbrake drift",
  },
];

let game: GameScene | undefined;
let startToken = 0;

const displaySpeed = computed(() => toSpeedometerKmh(speed.value));
const surfaceLabel = computed(() =>
  surface.value === "road" ? "Old road" : "Wild meadow",
);

function setControl(control: Control, pressed: boolean): void {
  controls[control] = pressed;
  if (pressed) game?.wake();
}

function handleKey(event: KeyboardEvent, pressed: boolean): void {
  const control = keyMap[event.code];
  if (!control) return;
  event.preventDefault();
  setControl(control, pressed);
}

function handleKeyDown(event: KeyboardEvent): void {
  handleKey(event, true);
}

function handleKeyUp(event: KeyboardEvent): void {
  handleKey(event, false);
}

function releaseControls(): void {
  for (const control of Object.keys(controls) as Control[])
    controls[control] = false;
}

async function startGame(): Promise<void> {
  if (!gameHost.value) return;
  const token = ++startToken;
  game?.destroy();
  loadError.value = "";

  try {
    const { createGameScene } = await import("../game/scene");
    if (token !== startToken || !gameHost.value) return;
    game = createGameScene(gameHost.value, {
      seed: seed.value,
      carColor: carColor.value,
      readInput: () => controls,
      onTelemetry(telemetry) {
        speed.value = telemetry.speed;
        surface.value = telemetry.surface;
        drawCalls.value = telemetry.drawCalls;
      },
    });
  } catch (error) {
    loadError.value =
      error instanceof Error
        ? error.message
        : "WebGL could not start on this browser.";
  }
}

function setCarColor(color: PorscheColor): void {
  carColor.value = color;
  game?.setCarColor(color);
}

function generateNewWorld(): void {
  const randomSeed = new Uint32Array(1);
  window.crypto.getRandomValues(randomSeed);
  seed.value = randomSeed[0] % 1_000_000;
  releaseControls();
  startGame();
}

function handlePointerStart(event: PointerEvent, control: Control): void {
  const button = event.currentTarget as HTMLButtonElement;
  button.setPointerCapture(event.pointerId);
  setControl(control, true);
}

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown, { passive: false });
  window.addEventListener("keyup", handleKeyUp, { passive: false });
  window.addEventListener("blur", releaseControls);
  startGame();
});

onUnmounted(() => {
  startToken += 1;
  window.removeEventListener("keydown", handleKeyDown);
  window.removeEventListener("keyup", handleKeyUp);
  window.removeEventListener("blur", releaseControls);
  game?.destroy();
});
</script>

<template>
  <main class="game-shell">
    <div ref="gameHost" class="game-canvas" />

    <header class="topbar">
      <div class="brand-panel">
        <p class="eyebrow"><span /> Pocket overworld</p>
        <h1>Tiny Touring</h1>
        <p>One little road. No final edge.</p>
      </div>

      <div class="world-panel">
        <div>
          <span class="world-label">World seed</span>
          <strong>{{ String(seed).padStart(6, "0") }}</strong>
        </div>
        <button type="button" @click="generateNewWorld">
          <span aria-hidden="true">↻</span
          ><span class="button-label">New map</span>
        </button>
      </div>
    </header>

    <div class="status-cluster">
      <section class="color-panel" aria-label="Porsche color">
        <span>Car color</span>
        <div class="color-options">
          <button
            v-for="color in PORSCHE_COLORS"
            :key="color.id"
            type="button"
            class="color-choice"
            :class="{ active: carColor === color.id }"
            :style="{ '--car-swatch': color.swatch }"
            :aria-label="color.label"
            :aria-pressed="carColor === color.id"
            :title="color.label"
            @click="setCarColor(color.id)"
          />
        </div>
        <strong>{{
          PORSCHE_COLORS.find((color) => color.id === carColor)?.label
        }}</strong>
      </section>

      <section class="status-panel" aria-label="Driving status">
        <div class="speed-readout">
          <strong>{{ displaySpeed }}</strong>
          <span>km/h</span>
        </div>
        <div class="status-copy">
          <span>Now crossing</span>
          <strong>{{ surfaceLabel }}</strong>
        </div>
        <div class="eco-chip" :title="`${drawCalls} scene draw calls`">
          <i /> Eco renderer
        </div>
      </section>
    </div>

    <section class="controls-panel" aria-label="Driving controls">
      <div class="controls-copy">
        <span>How to drive</span>
        <strong>WASD <em>or</em> arrows</strong>
      </div>
      <div class="control-grid">
        <button
          v-for="button in controlButtons"
          :key="button.control"
          class="control-key"
          :class="[button.className, { active: controls[button.control] }]"
          type="button"
          :aria-label="button.label"
          @pointerdown="handlePointerStart($event, button.control)"
          @pointerup="setControl(button.control, false)"
          @pointercancel="setControl(button.control, false)"
        >
          <kbd>{{ button.key }}</kbd
          ><span>{{ button.arrow }}</span>
        </button>
      </div>
    </section>

    <p class="world-note">
      <span>{{ WORLD_GRID_SIZE }} × {{ WORLD_GRID_SIZE }}</span> tiles · wraps north, south, east &amp; west
    </p>

    <div v-if="loadError" class="error-panel" role="alert">
      <strong>Could not start 3D view</strong>
      <span>{{ loadError }}</span>
    </div>
  </main>
</template>

<style scoped>
.game-shell {
  position: relative;
  isolation: isolate;
  width: 100%;
  height: 100svh;
  min-height: 560px;
  overflow: hidden;
  background: #c8ddd1;
  color: #243128;
}

.game-canvas,
.game-canvas :deep(canvas) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
}

.topbar {
  position: absolute;
  top: clamp(1rem, 3vw, 2rem);
  left: clamp(1rem, 3vw, 2.25rem);
  right: clamp(1rem, 3vw, 2.25rem);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  pointer-events: none;
}

.brand-panel,
.world-panel,
.color-panel,
.status-panel,
.controls-panel {
  border: 1px solid rgb(255 255 255 / 55%);
  background: rgb(250 247 233 / 94%);
  box-shadow:
    0 16px 40px rgb(55 71 58 / 13%),
    inset 0 1px 0 #fff;
}

.brand-panel {
  padding: 1rem 1.2rem 1.05rem;
  border-radius: 1.25rem 1.25rem 1.25rem 0.35rem;
}

.eyebrow,
.world-label,
.status-copy span,
.controls-copy span {
  margin: 0;
  font-size: 0.63rem;
  font-weight: 800;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: #6a755f;
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.eyebrow span {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: #e66548;
  box-shadow: 0 0 0 4px rgb(230 101 72 / 15%);
}

h1 {
  margin: 0.16rem 0 0;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(1.75rem, 3vw, 2.75rem);
  font-weight: 700;
  line-height: 0.95;
  letter-spacing: -0.055em;
  color: #2b3c31;
}

.brand-panel > p:last-child {
  margin: 0.48rem 0 0;
  font-size: 0.75rem;
  color: #687064;
}

.world-panel {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.65rem 0.7rem 0.65rem 1rem;
  border-radius: 1rem 1rem 0.35rem 1rem;
  pointer-events: auto;
}

.world-panel > div {
  display: grid;
  gap: 0.12rem;
}

.world-panel strong {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 1rem;
  letter-spacing: 0.08em;
}

.world-panel button {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  border-radius: 0.7rem;
  padding: 0.72rem 0.85rem;
  background: #385742;
  color: #fff9e9;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 800;
  cursor: pointer;
  transition:
    transform 140ms ease,
    background 140ms ease;
}

.world-panel button:hover {
  background: #294934;
  transform: translateY(-1px);
}

.world-panel button:focus-visible,
.control-key:focus-visible {
  outline: 3px solid #f19164;
  outline-offset: 3px;
}

.status-cluster {
  position: absolute;
  left: clamp(1rem, 3vw, 2.25rem);
  bottom: clamp(1rem, 3vw, 2rem);
  display: grid;
  justify-items: start;
  gap: 0.45rem;
}

.color-panel {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.48rem 0.65rem;
  border-radius: 0.8rem 0.8rem 0.8rem 0.25rem;
}

.color-panel > span {
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #6a755f;
}

.color-panel > strong {
  min-width: 3.2rem;
  font-size: 0.65rem;
  color: #3d4c41;
}

.color-options {
  display: flex;
  gap: 0.3rem;
}

.color-choice {
  width: 1rem;
  height: 1rem;
  padding: 0;
  border: 2px solid #fffdf4;
  border-radius: 50%;
  background: var(--car-swatch);
  box-shadow: 0 0 0 1px #bcb9aa;
  cursor: pointer;
}

.color-choice.active {
  box-shadow: 0 0 0 2px #385742;
}

.color-choice:focus-visible {
  outline: 3px solid #f19164;
  outline-offset: 3px;
}

.status-panel {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.72rem 0.9rem;
  border-radius: 0.35rem 1.2rem 1.2rem 1.2rem;
}

.speed-readout {
  display: flex;
  align-items: baseline;
  gap: 0.28rem;
  min-width: 5.6rem;
  padding-right: 1rem;
  border-right: 1px solid #d4d2c4;
}

.speed-readout strong {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 2.1rem;
  line-height: 1;
  letter-spacing: -0.08em;
}

.speed-readout span {
  font-size: 0.64rem;
  font-weight: 800;
  color: #6d7568;
}

.status-copy {
  display: grid;
  gap: 0.15rem;
}

.status-copy strong {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1rem;
}

.eco-chip {
  display: flex;
  align-items: center;
  gap: 0.42rem;
  margin-left: 0.4rem;
  padding: 0.45rem 0.58rem;
  border-radius: 999px;
  background: #e4ead9;
  font-size: 0.62rem;
  font-weight: 800;
  color: #486044;
}

.eco-chip i {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: #70a457;
  box-shadow: 0 0 0 3px rgb(112 164 87 / 16%);
}

.controls-panel {
  position: absolute;
  right: clamp(1rem, 3vw, 2.25rem);
  bottom: clamp(1rem, 3vw, 2rem);
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 0.8rem 0.75rem 1rem;
  border-radius: 1.2rem 0.35rem 1.2rem 1.2rem;
}

.controls-copy {
  display: grid;
  gap: 0.18rem;
}

.controls-copy strong {
  font-size: 0.78rem;
}

.controls-copy em {
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 400;
  color: #788073;
}

.control-grid {
  display: grid;
  grid-template: repeat(3, 2.1rem) / repeat(3, 2.1rem);
  gap: 0.28rem;
}

.control-key {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.22rem;
  border: 1px solid #d1cbb9;
  border-bottom-width: 3px;
  border-radius: 0.48rem;
  background: #fffdf4;
  color: #3d4c41;
  cursor: pointer;
  touch-action: none;
  user-select: none;
}

.control-key kbd {
  font:
    800 0.65rem/1 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}

.control-key span {
  font-size: 0.65rem;
  color: #818878;
}

.control-key.active,
.control-key:active {
  transform: translateY(2px);
  border-bottom-width: 1px;
  background: #e9edda;
}

.key-up {
  grid-area: 1 / 2;
}
.key-left {
  grid-area: 2 / 1;
}
.key-down {
  grid-area: 2 / 2;
}
.key-right {
  grid-area: 2 / 3;
}
.key-drift {
  grid-area: 3 / 1 / 4 / 4;
}

.key-drift kbd,
.key-drift span {
  font-size: 0.55rem;
}

.world-note {
  position: absolute;
  left: 50%;
  bottom: 1.2rem;
  margin: 0;
  transform: translateX(-50%);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: rgb(42 59 48 / 65%);
  text-shadow: 0 1px 0 rgb(255 255 255 / 60%);
  white-space: nowrap;
}

.world-note span {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #d25f43;
}

.error-panel {
  position: absolute;
  inset: 50% auto auto 50%;
  display: grid;
  gap: 0.35rem;
  width: min(28rem, calc(100% - 2rem));
  padding: 1.25rem;
  transform: translate(-50%, -50%);
  border: 1px solid #e7b7a2;
  border-radius: 1rem;
  background: #fff4e8;
  box-shadow: 0 20px 60px rgb(55 40 30 / 20%);
}

.error-panel span {
  font-size: 0.8rem;
  color: #765e51;
}

@media (max-width: 760px) {
  .game-shell {
    min-height: 620px;
  }
  .brand-panel > p:last-child,
  .controls-copy,
  .eco-chip,
  .world-note {
    display: none;
  }
  .brand-panel {
    padding: 0.8rem 0.9rem;
  }
  h1 {
    font-size: 1.65rem;
  }
  .world-panel {
    gap: 0.55rem;
    padding-left: 0.75rem;
  }
  .world-panel .world-label {
    display: none;
  }
  .world-panel button {
    width: 2.35rem;
    height: 2.35rem;
    padding: 0;
    justify-content: center;
  }
  .world-panel .button-label {
    display: none;
  }
  .status-cluster {
    bottom: 1rem;
  }
  .color-panel {
    padding: 0.42rem 0.55rem;
  }
  .color-panel > span,
  .color-panel > strong {
    display: none;
  }
  .color-choice {
    width: 1.15rem;
    height: 1.15rem;
  }
  .status-panel {
    padding: 0.65rem 0.75rem;
  }
  .status-copy {
    display: none;
  }
  .speed-readout {
    min-width: 0;
    padding-right: 0;
    border-right: 0;
  }
  .controls-panel {
    bottom: 1rem;
    padding: 0.6rem;
  }
  .control-grid {
    grid-template: repeat(3, 2.5rem) / repeat(3, 2.5rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .world-panel button {
    transition: none;
  }
}
</style>
