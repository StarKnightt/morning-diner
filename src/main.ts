/**
 * Bootstrap: loading screen, renderer, staged scene build, player, frame-capped
 * loop, resize.
 *
 * Boot order (see BUILD.md "Startup"): the palette dispatches its canvas
 * textures to the TextureBank workers; the geometry is built stage by stage on
 * the main thread with a paint between stages; every shader variant is linked
 * in parallel; the three reflection probes are baked; the first two frames
 * render; then the overlay offers "Click to enter" (the harness auto-enters).
 *
 * Frame cap: ~120 fps while focused and visible, ~10 fps when the tab is
 * hidden or the window is blurred (the machine is shared with a game on the
 * primary monitor; this page must never free-run).
 */
import * as THREE from "three";
import { createDinerAudio } from "./audio";
import { gpuRendererString, installCaptureApi, installReadyPromise, type PerfReport } from "./capture/pose";
import { hasParallelCompile } from "./core/compile";
import { BootTimeline, Progress, yieldToPaint } from "./core/scheduler";
import { TextureBank } from "./core/textureBank";
import { FirstPerson } from "./player/FirstPerson";
import { Diner } from "./scene/Diner";
import { Loader } from "./ui/Loader";

const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");
/** Capture harness: no user to click, so the overlay is removed the moment the scene is ready. */
const SHOOT = params.has("shoot");

const markReady = installReadyPromise();
const timeline = new BootTimeline();
const loader = new Loader();
// Weights are the measured share of a cold start on the RTX 4060 (BUILD.md "Startup budget").
const progress = new Progress(
  { geometry: 12, textures: 25, shaders: 40, probes: 18, frame: 5 },
  (fraction, label) => loader.set(fraction, label),
);
progress.stage("Opening up…");

const renderer = new THREE.WebGLRenderer({ powerPreference: "high-performance", antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
// r185 deprecated PCFSoftShadowMap (it silently maps to PCF anyway); PCF with
// shadow.radius gives the same soft edge without the console warning.
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

if (DEBUG) console.log(`[gpu] ${gpuRendererString(renderer)}  parallel-compile=${hasParallelCompile(renderer)}`);
timeline.mark("renderer");

const scene = new THREE.Scene();
// Vertical FOV 37° ≈ 61° horizontal at 16:9 — a 32 mm full-frame equivalent.
// Wider lenses skew every near edge into a trapezoid and read as a game.
const camera = new THREE.PerspectiveCamera(37, window.innerWidth / window.innerHeight, 0.05, 200);

// Canvas textures generate in workers; the label only follows them once the
// main thread has nothing of its own to report (after the geometry stages).
let textureLabels = false;
const bank = new TextureBank({
  debug: DEBUG,
  // `?workers=N` overrides the pool size (0 = main-thread fallback) for profiling.
  workers: params.has("workers") ? Number(params.get("workers")) : undefined,
  onProgress: (done, total, label) => progress.set("textures", done / total, textureLabels ? `Generating ${label}…` : undefined),
});
const diner = new Diner(scene, renderer, bank);
timeline.mark("palette");

const audio = createDinerAudio();
let player: FirstPerson | undefined;

const perf = (): PerfReport => ({
  marks: timeline.list(),
  textures: bank.stats(),
  programs: renderer.info.programs?.length ?? 0,
  parallelCompile: hasParallelCompile(renderer),
});

async function boot(): Promise<void> {
  await diner.build({
    camera,
    stage: async (label, done) => {
      progress.set("geometry", done, `${label}…`);
      await yieldToPaint();
    },
    textures: async () => {
      textureLabels = true;
      if (bank.pending > 0) progress.stage("Generating textures…");
      await bank.ready();
      progress.complete("textures");
    },
    shaders: (ready, total) => {
      // Links run alongside the texture workers; the label follows the textures until they are done.
      progress.set("shaders", ready / Math.max(1, total), bank.pending === 0 ? `Compiling shaders (${ready}/${total})…` : undefined);
    },
    probes: async (done) => {
      progress.set("probes", done / 3, `Baking reflections (${done}/3)…`);
      await yieldToPaint();
    },
    mark: (name) => timeline.mark(name),
  });

  player = new FirstPerson(camera, renderer.domElement, diner.colliders);
  installCaptureApi(renderer, scene, camera, player, perf);
  // Pointer lock lives in FirstPerson (canvas click); the AudioContext needs the same gesture.
  renderer.domElement.addEventListener("click", () => void audio.start(), { once: true });
  progress.stage("Opening the blinds…");
  renderer.setAnimationLoop(frame);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------------- loop ---------------- */
let focused = true;
window.addEventListener("blur", () => (focused = false));
window.addEventListener("focus", () => (focused = true));

const MAX_FPS = 120;
const IDLE_FPS = 10;
let last = -Infinity;
let frames = 0;
let lastStats = 0;

function frame(now: number): void {
  const throttled = document.hidden || !focused;
  const minDelta = throttled ? 1000 / IDLE_FPS : 1000 / MAX_FPS - 0.75;
  if (now - last < minDelta) return;
  const dt = Math.min(0.1, last === -Infinity ? 1 / 60 : (now - last) / 1000);
  last = now;

  player!.update(dt);
  diner.update(dt);
  renderer.render(scene, camera);
  audio.update(camera);

  frames++;
  if (frames === 2) void onFirstFrames();
  if (DEBUG && now - lastStats > 5000) {
    lastStats = now;
    const r = renderer.info.render;
    console.log(`[render] calls=${r.calls} tris=${r.triangles} programs=${renderer.info.programs?.length ?? "?"}`);
  }
}

async function onFirstFrames(): Promise<void> {
  timeline.mark("first-frames");
  progress.complete("frame");
  if (DEBUG) {
    const t = bank.stats();
    console.log(`[perf] ready in ${(timeline.elapsedMs / 1000).toFixed(2)} s — ${timeline.list().map((m) => `${m.name} +${m.dt}`).join(" · ")} ms; textures ${t.wallMs} ms wall on ${t.workers} workers; ${renderer.info.programs?.length ?? "?"} programs`);
  }
  if (SHOOT) {
    await loader.dismiss(true);
    markReady();
    return;
  }
  markReady();
  await loader.waitForEnter();
  void loader.dismiss();
  // Forward the gesture to the canvas: FirstPerson requests pointer lock on its click,
  // and the audio starts on the same click (both need a user gesture).
  renderer.domElement.click();
}

boot().catch((err: unknown) => {
  console.error("[boot]", err);
  loader.fail(err instanceof Error ? err.message : String(err));
});
