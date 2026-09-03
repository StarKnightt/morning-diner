/**
 * Bootstrap: loading screen, renderer, staged scene build, player, frame-capped
 * loop, resize.
 *
 * Boot order (see BUILD.md "Startup"): the palette dispatches its canvas
 * textures to the TextureBank workers; the geometry is built stage by stage on
 * the main thread with a paint between stages; every shader variant is linked
 * in parallel; the three reflection probes are baked (both shadow maps render once
 * inside the first probe face); the System 8 post pipeline is created; the first two
 * frames render through it; then the overlay offers "Click to enter" (the harness
 * auto-enters).
 *
 * Frame cap: ~120 fps while focused and visible, ~10 fps when the tab is
 * hidden or the window is blurred (the machine is shared with a game on the
 * primary monitor; this page must never free-run).
 */
import * as THREE from "three";
import { gpuRendererString, installCaptureApi, installReadyPromise, type PerfReport } from "./capture/pose";
import { hasParallelCompile, issueCompile } from "./core/compile";
import { BootTimeline, Progress, yieldToPaint } from "./core/scheduler";
import { TextureBank } from "./core/textureBank";
import { initInteractions, type Interactions } from "./interactions";
import { FirstPerson } from "./player/FirstPerson";
import { createPostPipeline, type PostPipeline } from "./post/PostPipeline";
import { Diner } from "./scene/Diner";
import { configureRenderer } from "./scene/Lighting";
import { Loader } from "./ui/Loader";
import { applyDpr, applyToScene, initQuality, isTouchPrimary, restoreUrl, showBadge, tick } from "./core/quality";

const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");
/** Capture harness: no user to click, so the overlay is removed the moment the scene is ready. */
const SHOOT = params.has("shoot");

// Quality tier first: it injects the tier's URL knobs (`?txscale`, `?nopcss`, `?nobounce`, the
// post counts) before Lighting.ts / post/settings.ts read `location.search` (core/quality.ts).
const quality = initQuality();
const markReady = installReadyPromise();
const timeline = new BootTimeline();
const loader = new Loader();
showBadge(DEBUG);
// Weights are the measured share of a cold start on the RTX 4060 (BUILD.md "Startup budget").
const progress = new Progress(
  { geometry: 12, textures: 25, shaders: 40, probes: 18, frame: 5 },
  (fraction, label) => loader.set(fraction, label),
);
progress.stage("Opening up…");

const renderer = new THREE.WebGLRenderer({ powerPreference: "high-performance", antialias: true });
renderer.setPixelRatio(quality.dpr); // tier cap (ultra: min(devicePixelRatio, 1.5), as before)
renderer.setSize(window.innerWidth, window.innerHeight);
// Tone mapping, exposure (a camera setting: ISO 100 · f/5.6 · 1/160 s) and the shadow
// filter live with the light rig (System 4, scene/Lighting.ts): the camera curve (white at
// +3.5 EV over grey), exposure = 1 / L_sat, BasicShadowMap depth textures filtered by the
// PCSS chunk. `?tm=camera|aces|agx|neutral` and `?ev=±n` override them for side-by-side captures.
configureRenderer(renderer);
{
  const tm = params.get("tm");
  if (tm === "aces") renderer.toneMapping = THREE.ACESFilmicToneMapping;
  else if (tm === "agx") renderer.toneMapping = THREE.AgXToneMapping;
  else if (tm === "neutral") renderer.toneMapping = THREE.NeutralToneMapping;
  else if (tm === "camera") renderer.toneMapping = THREE.CustomToneMapping;
  // Exposure dial (rev 7): `?ev=<stops>` (default 0) or the last value the player set with
  // `[` / `]` (±0.25 EV, persisted in localStorage `morning-diner.ev`, shown as a toast).
  const baseExposure = renderer.toneMappingExposure;
  // fix-dining-light: the key is versioned with the preset — a `]`-stepped +EV that the player
  // left in localStorage under rev 7 (the live frames were ≈ +1.5 EV over the shipped exposure)
  // must not carry over onto a re-metered rig. Bump the suffix whenever CAMERA changes.
  const EV_KEY = "morning-diner.ev.fdl";
  let ev = params.has("ev") ? Number(params.get("ev")) : Number(localStorage.getItem(EV_KEY) ?? 0);
  if (!Number.isFinite(ev)) ev = 0;
  const applyEv = () => { renderer.toneMappingExposure = baseExposure * Math.pow(2, ev); };
  applyEv();
  let toast: HTMLDivElement | null = null, toastTimer = 0;
  const showEv = () => {
    if (!toast) {
      toast = document.createElement("div");
      toast.style.cssText = "position:fixed;left:50%;bottom:12%;transform:translateX(-50%);padding:6px 12px;border-radius:6px;background:rgba(0,0,0,.55);color:#fff;font:13px/1.2 system-ui,sans-serif;letter-spacing:.04em;pointer-events:none;opacity:0;transition:opacity .2s;z-index:20";
      document.body.appendChild(toast);
    }
    toast.textContent = `EV ${ev >= 0 ? "+" : "−"}${Math.abs(ev).toFixed(2)}`;
    toast.style.opacity = "1";
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { if (toast) toast.style.opacity = "0"; }, 1200);
  };
  window.addEventListener("keydown", (e) => {
    if (e.code !== "BracketLeft" && e.code !== "BracketRight") return;
    ev = Math.round((ev + (e.code === "BracketRight" ? 0.25 : -0.25)) * 4) / 4;
    ev = Math.max(-4, Math.min(4, ev));
    localStorage.setItem(EV_KEY, String(ev));
    applyEv();
    showEv();
  });
}
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

let player: FirstPerson | undefined;
// System 7 (sit / pour / door) + the System 6 audio wiring; owns the audio engine
// (`interactions.audio`) and its listener update. Built after `diner.build()` resolves:
// it needs `diner.door`, `diner.coffeePot`, `diner.pourMug` and the palette.
let interactions: Interactions | undefined;
/** System 8 pipeline; built after `diner.build()` because its dust/haze read the sun's shadow map. */
let post: PostPipeline | undefined;

/** Shader-link progress samples: (ms since boot, programs linked, programs issued), one per change. */
const linkSamples: Array<[number, number, number]> = [];
const perf = (): PerfReport => {
  const programs = (renderer.info.programs ?? []) as unknown as Array<{ name: string; cacheKey: string; usedTimes: number }>;
  const byName: Record<string, number> = {};
  for (const p of programs) byName[p.name] = (byName[p.name] ?? 0) + 1;
  const lights: Record<string, number> = {};
  scene.traverse((o) => {
    if ((o as THREE.Light).isLight) {
      const k = `${o.type}${(o as THREE.Light).castShadow ? "+shadow" : ""}`;
      lights[k] = (lights[k] ?? 0) + 1;
    }
  });
  return {
    marks: timeline.list(),
    textures: bank.stats(),
    programs: programs.length,
    parallelCompile: hasParallelCompile(renderer),
    extra: {
      byName,
      lights,
      memory: { ...renderer.info.memory },
      linkSamples,
      cacheKeys: programs.map((p) => `${p.name}|${p.usedTimes}|${p.cacheKey}`),
    },
  };
};

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
      const last = linkSamples[linkSamples.length - 1];
      if (!last || last[1] !== ready || last[2] !== total) linkSamples.push([Math.round(timeline.elapsedMs), ready, total]);
      // Links run alongside the texture workers; the label follows the textures until they are done.
      progress.set("shaders", ready / Math.max(1, total), bank.pending === 0 ? `Compiling shaders (${ready}/${total})…` : undefined);
    },
    probes: async (done) => {
      progress.set("probes", done / 3, `Baking reflections (${done}/3)…`);
      await yieldToPaint();
    },
    mark: (name) => {
      timeline.mark(name);
      // Lights and every material exist, nothing has compiled or rendered: the tier shrinks the
      // shadow maps, swaps transmission for alpha glass and drops variant families here.
      if (name === "geometry") applyToScene(scene, diner, renderer.capabilities.getMaxAnisotropy());
    },
  });

  // Capture A/B switches: `?hide=a,b` hides every object whose name contains a token,
  // `?nocast=a,b` stops those objects casting shadows (ownership tests for floor artefacts).
  {
    const tokens = (k: string) => (params.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const hide = tokens("hide"), nocast = tokens("nocast");
    if (hide.length || nocast.length) {
      scene.traverse((o) => {
        if (hide.some((t) => o.name.includes(t))) o.visible = false;
        if (nocast.some((t) => o.name.includes(t))) o.castShadow = false;
      });
      diner.invalidateShadows();
    }
  }
  player = new FirstPerson(camera, renderer.domElement, diner.colliders);
  // Phones / tablets: a virtual stick and a look-drag instead of pointer lock (player/Touch.ts).
  if (isTouchPrimary()) void import("./player/Touch").then(({ attachTouch }) => attachTouch(player!, renderer.domElement)).catch((e: unknown) => console.warn("[touch]", e));
  installCaptureApi(renderer, scene, camera, player, perf);
  interactions = initInteractions({ renderer, scene, camera, player, diner });
  // System 8: dust, haze, shimmer, steam, photographic finish. `?post=0` → plain renderer.render.
  // Created here, after build(): the lights exist, both shadow maps have rendered once (inside the
  // first probe face) and the sun-beam dust samples its spawn volume from the live sun. It gets
  // `diner.sunBeam`, the sun's twin whose map is a compare-mode depth texture (System 4 filters
  // `diner.sun`'s own map with PCSS from a raw depth texture, which `sampler2DShadow` cannot read).
  post = createPostPipeline(renderer, scene, camera, { sun: diner.sunBeam });
  restoreUrl(); // every `location.search` reader has run; put the tier's injected knobs away
  timeline.mark("post");
  // The pour's four materials (clipped decanter coffee, rippled mug surface, stream, steam)
  // and the post pipeline's scene objects (dust motes, decanter steam) enter the scene here,
  // after Diner.build()'s compile batch. Issue their programs now, in both output variants
  // (canvas, and render target — the transmission pass behind the decanter glass, and the
  // MSAA scene target the post pipeline draws into), so they link in the driver's background
  // threads instead of on the first E at the mug — measured 3.7 s of synchronous links on
  // ANGLE/D3D11 otherwise. The screen passes' own materials (full-screen quads, not scene
  // objects) still link on the first frame.
  issueCompile(renderer, scene, camera, null);
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  issueCompile(renderer, scene, camera, rt);
  rt.dispose();
  // Pointer lock lives in FirstPerson (canvas click); the AudioContext needs the same gesture.
  // `startAudio` is idempotent — the loader's "Click to enter" calls it too (onFirstFrames).
  const startAudio = interactions.startAudio;
  renderer.domElement.addEventListener("click", () => void startAudio(), { once: true });
  progress.stage("Opening the blinds…");
  renderer.setAnimationLoop(frame);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  applyDpr(renderer);
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
  const prev = last;
  last = now;

  player!.update(dt);
  diner.update(dt);
  // Interactions first: a moved door/decanter calls diner.invalidateShadows(), and the post
  // pipeline's scene pass (renderer.render inside post.render) is what re-renders the maps.
  interactions!.update(dt); // also moves the audio listener with the camera
  post!.render();
  // Dynamic resolution (core/quality.ts): GPU ms when the timer extension reports, else the loop delta.
  if (!throttled && frames > 60) {
    const t = post!.timings();
    let gpu = 0;
    if (t) for (const v of Object.values(t)) gpu += v.ema;
    tick(renderer, gpu > 0 ? gpu : (now - prev), now);
  }

  frames++;
  if (frames <= 2) timeline.mark(`frame-${frames}(p${renderer.info.programs?.length ?? 0})`);
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
  // The enter click is the user gesture the AudioContext needs (idempotent; the canvas
  // click below and the wiring's window-gesture fallback call the same thing).
  void interactions?.startAudio();
  void loader.dismiss();
  // Forward the gesture to the canvas: FirstPerson requests pointer lock on its click.
  renderer.domElement.click();
}

boot().catch((err: unknown) => {
  console.error("[boot]", err);
  loader.fail(err instanceof Error ? err.message : String(err));
});
