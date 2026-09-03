/**
 * Quality tiers — one place that decides how much of the diner a device gets.
 *
 * Ported from jungle-trail (`TIERS` + `_adapt` in its main.js: boot on a tier, step down one
 * at a time only after seconds of evidence, never oscillate) and dawn-station
 * (`core/capability.ts`: classify from a throw-away 1×1 context — limits and extensions, the
 * renderer string only for the categorical facts — and record the reasons so a wrong tier is
 * debuggable). What is new here is that the tier drives the knobs this project already has
 * instead of a second copy of them:
 *
 *   - URL knobs the lighting / post modules read at call time (`?txscale`, `?nopcss`,
 *     `?nobounce`, `?haze.steps`, `?dust.count`, `?steam.count`, `?bloom`, `?aa`) are injected
 *     into `location.search` before `configureRenderer` / `createPostPipeline` run, and the
 *     original URL is restored once the post pipeline exists (`restoreUrl`). An explicit
 *     parameter in the user's URL always wins over the tier's value.
 *   - Shadow map sizes, the transmission → alpha-glass fallback and the anisotropy / clearcoat
 *     cuts are applied to the built scene at Diner.build's `geometry` mark — after every
 *     material exists, before anything has compiled or rendered (`applyToScene`).
 *   - World.ts asks for `scatterMul` / `scatterRadius`; the TextureBank asks for `maxTexture`.
 *   - The renderer's DPR cap and the dynamic-resolution stepper (`tick`) live here; main.ts
 *     calls `applyDpr` after `setSize` and `tick` once per frame.
 *
 * `ultra` is the RTX-class desktop look exactly as it was before this file existed: every knob
 * there is the value the code already used, so a machine that classifies as ultra renders
 * pixel-identically to origin/main (verified with post-bench at length/booth/kitchen-line/
 * lot-wide).
 *
 *   ?q=ultra|high|medium|low|mobile   force a tier (persisted in localStorage `morning-diner.q`)
 *   ?q=auto                            forget the persisted choice and classify again
 *   ?dynres=0                          freeze the dynamic-resolution stepper (`?shoot` implies it)
 *   window.__quality                   { tier, auto, reasons, settings, dpr, renderer, set(tier) }
 */
import type * as THREE from "three";

export type Tier = "ultra" | "high" | "medium" | "low" | "mobile";
export const TIER_ORDER: readonly Tier[] = ["mobile", "low", "medium", "high", "ultra"];

export interface TierSettings {
  /** Renderer pixel-ratio cap (main.ts used 1.5 before tiers). */
  dprCap: number;
  /** Interior sun / lot sun / sun-beam depth maps (square edge). Lighting.ts builds 4096². */
  shadowMap: number;
  /** PCSS blocker search + 37-tap disc; false → Lighting.ts's fixed 4-tap kernel (`?nopcss`). */
  pcss: boolean;
  /** three's transmission buffer scale (Lighting.ts default 0.5); 0 → alpha glass, no transmission pass. */
  txScale: number;
  /** Haze single-scatter march steps (post default 24). */
  hazeSteps: number;
  /** Beam dust motes (post default 5000). */
  dustCount: number;
  /** Decanter steam strands (post default 4). */
  steamCount: number;
  bloom: boolean;
  aa: "msaa4" | "none";
  /** Bounce-rectangle irradiance loop (43 quads per lit fragment); false → `?nobounce`. */
  bounce: boolean;
  /** Multiplier on every World.ts scatter species count (1 = the 120 m cap's 71 %). */
  scatterMul: number;
  /** World.ts scatter radius cap, metres (120 on ultra). */
  scatterRadius: number;
  /** Cap on the procedural textures' pixel edge (Infinity = as authored, up to 2048). */
  maxTexture: number;
  /** MeshPhysicalMaterial anisotropy / clearcoat kept (each is a shader variant family). */
  anisotropy: boolean;
  clearcoat: boolean;
}

export const TIERS: Record<Tier, TierSettings> = {
  // Exactly what the code did before quality.ts: nothing here may change without re-verifying ultra.
  ultra: { dprCap: 1.5, shadowMap: 4096, pcss: true, txScale: 0.5, hazeSteps: 24, dustCount: 5000, steamCount: 4, bloom: true, aa: "msaa4", bounce: true, scatterMul: 1, scatterRadius: 120, maxTexture: Infinity, anisotropy: true, clearcoat: true },
  // Mid discrete / Apple M-class: same look, native pixels at most, the far scrub thinned.
  high: { dprCap: 1.0, shadowMap: 4096, pcss: true, txScale: 0.5, hazeSteps: 16, dustCount: 3500, steamCount: 4, bloom: true, aa: "msaa4", bounce: true, scatterMul: 0.8, scatterRadius: 110, maxTexture: 2048, anisotropy: true, clearcoat: true },
  // Older discrete / strong iGPU: 85 % resolution, 2048² maps, quarter-res glass, 1024 textures.
  medium: { dprCap: 0.85, shadowMap: 2048, pcss: true, txScale: 0.25, hazeSteps: 12, dustCount: 2000, steamCount: 3, bloom: true, aa: "msaa4", bounce: true, scatterMul: 0.5, scatterRadius: 90, maxTexture: 1024, anisotropy: true, clearcoat: true },
  // Integrated graphics: plain PCF, alpha glass, no bounce loop, no MSAA, 512 textures.
  low: { dprCap: 0.65, shadowMap: 1024, pcss: false, txScale: 0, hazeSteps: 8, dustCount: 800, steamCount: 2, bloom: false, aa: "none", bounce: false, scatterMul: 0.25, scatterRadius: 70, maxTexture: 512, anisotropy: false, clearcoat: false },
  // Phones: low, smaller still.
  mobile: { dprCap: 1.0, shadowMap: 1024, pcss: false, txScale: 0, hazeSteps: 6, dustCount: 400, steamCount: 2, bloom: false, aa: "none", bounce: false, scatterMul: 0.2, scatterRadius: 60, maxTexture: 512, anisotropy: false, clearcoat: false },
};

const STORAGE_KEY = "morning-diner.q";
const isTier = (s: unknown): s is Tier => typeof s === "string" && (TIER_ORDER as readonly string[]).includes(s);

/* ---------------- capability probe (dawn-station's shape) ---------------- */

export interface Capability {
  renderer: string;
  software: boolean;
  webgl2: boolean;
  maxTextureSize: number;
  maxSamples: number;
  parallelShaderCompile: boolean;
  timerQuery: boolean;
  deviceMemoryGb: number;
  cpuThreads: number;
  devicePixelRatio: number;
  screenPx: number;
  touch: boolean;
  mobileUa: boolean;
}

const SOFTWARE = ["swiftshader", "llvmpipe", "softpipe", "microsoft basic", "software rasterizer"];

export const isTouchPrimary = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches && (navigator.maxTouchPoints || 0) > 0;

export function detectCapability(): Capability {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const base = {
    deviceMemoryGb: nav.deviceMemory ?? 0,
    cpuThreads: navigator.hardwareConcurrency || 0,
    devicePixelRatio: window.devicePixelRatio || 1,
    screenPx: (screen.width || 0) * (screen.height || 0),
    touch: isTouchPrimary(),
    mobileUa: /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent),
  };
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
  if (!gl) return { ...base, renderer: "unavailable", software: true, webgl2: false, maxTextureSize: 0, maxSamples: 0, parallelShaderCompile: false, timerQuery: false };
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) ?? "");
  const cap: Capability = {
    ...base,
    renderer,
    software: SOFTWARE.some((m) => renderer.toLowerCase().includes(m)),
    webgl2: true,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    maxSamples: (gl.getParameter(gl.MAX_SAMPLES) as number) || 0,
    parallelShaderCompile: !!gl.getExtension("KHR_parallel_shader_compile"),
    timerQuery: !!gl.getExtension("EXT_disjoint_timer_query_webgl2"),
  };
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return cap;
}

/**
 * Renderer-string heuristics. The string is a weak classifier (ANGLE rewrites it, one name
 * spans a 10× range), so it only ever moves the guess by one or two tiers and the limits /
 * extensions decide the rest. Demotion wins over promotion: a wrong `low` is a softer picture,
 * a wrong `ultra` is a 4-minute compile on a machine that then cannot hold 20 fps.
 */
export function classify(cap: Capability): { tier: Tier; reasons: string[] } {
  const reasons: string[] = [];
  const idx = (t: Tier) => TIER_ORDER.indexOf(t);
  let tier: Tier = "ultra";
  const capAt = (to: Tier, why: string) => {
    if (idx(to) < idx(tier)) { tier = to; reasons.push(why); }
  };
  const r = cap.renderer.toLowerCase();

  if (cap.touch || cap.mobileUa) capAt("mobile", cap.touch ? "coarse primary pointer" : `mobile UA`);
  if (!cap.webgl2) capAt("mobile", "no WebGL2");
  if (cap.software) capAt("mobile", `software rasteriser: ${cap.renderer}`);

  // Discrete-class names. RTX 20/30/40/50, RX 5000+/6000+/7000+, Arc → ultra stays.
  const rtx = /rtx\s*(\d{4})/.exec(r);
  const gtx = /gtx\s*(\d{3,4})/.exec(r);
  const radeon = /radeon\s*(?:rx\s*)?(\d{3,4})/.exec(r);
  const apple = /apple\s*(m\d)|apple gpu/.exec(r);
  if (rtx) {
    const n = Number(rtx[1]);
    if (n % 100 < 60 && n < 3000) capAt("high", `${cap.renderer}: entry RTX`); // 2050 / 2060 class
  } else if (gtx) {
    const n = Number(gtx[1]);
    capAt(n >= 1660 || n >= 1070 ? "high" : "medium", `${cap.renderer}: GTX class`);
  } else if (/intel/.test(r)) {
    if (/arc/.test(r)) capAt("high", `${cap.renderer}: Intel Arc`);
    else if (/iris|xe/.test(r)) capAt("medium", `${cap.renderer}: Intel Iris / Xe iGPU`);
    else capAt("low", `${cap.renderer}: Intel UHD / HD iGPU`);
  } else if (radeon) {
    const n = Number(radeon[1]);
    if (/vega|graphics|680m|780m|890m/.test(r) && !/rx/.test(r)) capAt("medium", `${cap.renderer}: AMD APU`);
    else if (n < 5000 && n >= 400) capAt("high", `${cap.renderer}: Polaris / Vega class`);
  } else if (apple) {
    capAt(/m1\b|m2\b/.test(r) ? "high" : "high", `${cap.renderer}: Apple silicon`);
  } else if (/adreno|mali|powervr|xclipse|immortalis/.test(r)) {
    capAt("mobile", `${cap.renderer}: mobile GPU`);
  } else if (/nvidia|geforce|quadro|tesla/.test(r) && !/rtx/.test(r)) {
    capAt("high", `${cap.renderer}: pre-Turing NVIDIA`);
  } else if (!/nvidia|geforce|rtx|radeon|amd|arc/.test(r) && r !== "unavailable") {
    capAt("medium", `${cap.renderer}: unrecognised renderer`);
  }

  // Limits and extensions (dawn-station): what the driver will actually honour.
  if (!cap.parallelShaderCompile) capAt("medium", "no KHR_parallel_shader_compile: serial links");
  if (cap.maxTextureSize > 0 && cap.maxTextureSize < 8192) capAt("low", `MAX_TEXTURE_SIZE ${cap.maxTextureSize}`);
  if (cap.maxSamples > 0 && cap.maxSamples < 4) capAt("low", `MAX_SAMPLES ${cap.maxSamples}`);
  if (cap.deviceMemoryGb > 0 && cap.deviceMemoryGb <= 4) capAt("low", `deviceMemory ${cap.deviceMemoryGb} GB`);
  if (cap.cpuThreads > 0 && cap.cpuThreads <= 4) capAt("medium", `${cap.cpuThreads} CPU threads`);
  // A 4K panel in front of anything below ultra is the quadratic case; the DPR cap handles ultra.
  if (cap.screenPx >= 3840 * 2160 && tier !== "ultra") capAt("medium", `4K-class panel (${cap.screenPx} px)`);

  if (reasons.length === 0) reasons.push("all signals clear");
  return { tier, reasons };
}

/* ---------------- the resolved quality ---------------- */

export interface Quality {
  tier: Tier;
  /** true when the tier came from classification (not `?q=` or localStorage). */
  auto: boolean;
  reasons: string[];
  settings: TierSettings;
  capability: Capability;
  /** Current renderer pixel ratio (tier cap × dynamic-resolution step). */
  dpr: number;
  /** Switch tier for the next load (persists, reloads). */
  set(tier: Tier | "auto"): void;
}

let quality: Quality | null = null;
let originalUrl: string | null = null;
let dynresEnabled = true;

/** Resolve the tier once, before the renderer exists. Idempotent. */
export function initQuality(search: string = location.search): Quality {
  if (quality) return quality;
  const params = new URLSearchParams(search);
  const capability = detectCapability();
  const forced = params.get("q");
  let stored: string | null = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* private mode */ }
  let tier: Tier, auto = false, reasons: string[];
  if (isTier(forced)) {
    tier = forced; reasons = [`?q=${forced}`];
    try { localStorage.setItem(STORAGE_KEY, forced); } catch { /* ignore */ }
  } else if (forced === "auto" || !isTier(stored)) {
    if (forced === "auto") try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    const c = classify(capability);
    tier = c.tier; reasons = c.reasons; auto = true;
  } else {
    tier = stored; reasons = [`localStorage ${STORAGE_KEY}=${stored}`];
  }
  dynresEnabled = !params.has("shoot") && params.get("dynres") !== "0";
  const settings = TIERS[tier];
  const q: Quality = {
    tier, auto, reasons, settings, capability,
    dpr: Math.min(window.devicePixelRatio || 1, settings.dprCap),
    set(next) {
      try { next === "auto" ? localStorage.removeItem(STORAGE_KEY) : localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
      const u = new URL(location.href);
      u.searchParams.delete("q");
      if (next === "auto") u.searchParams.set("q", "auto");
      location.href = u.toString();
    },
  };
  quality = q;
  (window as unknown as { __quality: Quality }).__quality = q;
  injectUrlKnobs(params);
  if (params.has("debug") || !auto || tier !== "ultra") console.log(`[quality] ${tier}${auto ? " (auto)" : ""} — ${reasons.join("; ")}`);
  return q;
}

export function getQuality(): Quality {
  return quality ?? initQuality();
}

/**
 * Drive the URL-read knobs from the tier: only parameters the user did not set, only when the
 * tier's value differs from the module default (so ultra leaves the URL alone).
 */
function injectUrlKnobs(params: URLSearchParams): void {
  const s = quality!.settings, u = TIERS.ultra;
  const add: Array<[string, string]> = [];
  const want = (key: string, value: string, differs: boolean) => { if (differs && !params.has(key)) add.push([key, value]); };
  want("txscale", String(s.txScale > 0 ? s.txScale : u.txScale), s.txScale > 0 && s.txScale !== u.txScale);
  want("nopcss", "", !s.pcss);
  want("nobounce", "", !s.bounce);
  want("haze.steps", String(s.hazeSteps), s.hazeSteps !== u.hazeSteps);
  want("dust.count", String(s.dustCount), s.dustCount !== u.dustCount);
  want("steam.count", String(s.steamCount), s.steamCount !== u.steamCount);
  want("bloom", "0", !s.bloom);
  want("aa", s.aa, s.aa !== u.aa);
  if (!add.length) return;
  originalUrl = location.href;
  const url = new URL(location.href);
  for (const [k, v] of add) url.searchParams.set(k, v);
  history.replaceState(history.state, "", url.toString());
}

/** Put the address bar back once every URL-reading module has run (after createPostPipeline). */
export function restoreUrl(): void {
  if (originalUrl === null) return;
  history.replaceState(history.state, "", originalUrl);
  originalUrl = null;
}

/* ---------------- scene-side application (Diner.build's `geometry` mark) ---------------- */

interface SceneLights {
  sun: THREE.SpotLight;
  sunLot: THREE.DirectionalLight;
  sunBeam: THREE.SpotLight;
}

/**
 * Called once after `buildLighting` + `buildWorld`, before the compile batch and the first
 * shadow render: shrink the three depth maps, swap transmission for alpha glass, and drop the
 * anisotropy / clearcoat variant families on the tiers that asked for it. On ultra this is a
 * no-op by construction (every comparison is against the authored value).
 */
export function applyToScene(root: THREE.Object3D, lights: SceneLights, maxAnisotropy: number): void {
  const s = getQuality().settings;
  const size = Math.min(s.shadowMap, getQuality().capability.maxTextureSize || s.shadowMap);
  for (const light of [lights.sun, lights.sunLot, lights.sunBeam]) {
    if (light.shadow.mapSize.x === size) continue;
    light.shadow.mapSize.set(size, size);
    // buildSunBeam pre-allocates the compare-mode map (its depth texture is bound by name in
    // every lit program): resize it in place so the bound texture object stays the same.
    light.shadow.map?.setSize(size, size);
  }
  if (s.txScale > 0 && s.anisotropy && s.clearcoat) return;
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      const p = m as THREE.MeshPhysicalMaterial;
      if (!p.isMeshPhysicalMaterial) continue;
      if (s.txScale === 0 && p.transmission > 0) {
        // Alpha glass: the tabletop carafe / sugar / mug / clock lens as a tinted, transparent
        // dielectric — no second scene pass behind it.
        p.transmission = 0;
        p.transparent = true;
        p.opacity = Math.min(p.opacity, 0.3);
        p.depthWrite = false;
        p.needsUpdate = true;
      }
      if (!s.anisotropy && p.anisotropy > 0) { p.anisotropy = 0; p.anisotropyMap = null; p.needsUpdate = true; }
      if (!s.clearcoat && (p.clearcoat > 0 || p.clearcoatMap)) { p.clearcoat = 0; p.clearcoatMap = null; p.clearcoatRoughnessMap = null; p.clearcoatNormalMap = null; p.needsUpdate = true; }
      if (!s.anisotropy) {
        // Texture anisotropy is the cheap one; halve it rather than drop it.
        for (const key of ["map", "roughnessMap", "normalMap"] as const) {
          const t = p[key];
          if (t && t.anisotropy > 2) t.anisotropy = Math.min(t.anisotropy, Math.max(2, maxAnisotropy >> 2));
        }
      }
    }
  });
}

/** Cap a procedural texture's requested pixel edge (TextureBank / World scatter read these). */
export function capTextureSize(px: number): number {
  const max = getQuality().settings.maxTexture;
  if (!Number.isFinite(max) || px <= max) return px;
  let out = max;
  while (out * 2 <= px && out * 2 <= max) out *= 2;
  return out;
}

/* ---------------- renderer DPR + dynamic resolution ---------------- */

const DOWN_MS = 20, UP_MS = 10, DOWN_HOLD = 3000, UP_HOLD = 10000, MIN_DPR = 0.5, STEP = 0.85;
const window_: number[] = [];
let overSince = 0, underSince = 0, scale = 1, dprApplied = 0;

/** Set the renderer's pixel ratio to the tier cap × the dynamic step. Call after setSize on resize. */
export function applyDpr(renderer: THREE.WebGLRenderer): void {
  const q = getQuality();
  const target = Math.max(MIN_DPR, Math.min(window.devicePixelRatio || 1, q.settings.dprCap) * scale);
  q.dpr = target;
  if (Math.abs(renderer.getPixelRatio() - target) < 1e-4 && dprApplied === target) return;
  dprApplied = target;
  renderer.setPixelRatio(target);
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/**
 * Per-frame frame-time sample (ms; the loop's own delta, or the GPU sum when the timer
 * extension reports one). Median over a 60-frame window, as in dawn-station's AdaptiveQuality:
 * one GC hitch does not demote. Down after 3 s over 20 ms, up after 10 s under 10 ms, one
 * 0.85× step at a time between 0.5 and the tier cap.
 */
export function tick(renderer: THREE.WebGLRenderer, frameMs: number, now: number): void {
  if (!dynresEnabled) return;
  window_.push(frameMs);
  if (window_.length > 60) window_.shift();
  if (window_.length < 30) return;
  const sorted = [...window_].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  if (median > DOWN_MS) {
    underSince = 0;
    if (!overSince) overSince = now;
    else if (now - overSince > DOWN_HOLD && scale * getQuality().settings.dprCap > MIN_DPR + 1e-3) {
      scale *= STEP;
      overSince = 0; window_.length = 0;
      applyDpr(renderer);
      console.log(`[quality] frame ${median.toFixed(1)} ms — resolution down to ${getQuality().dpr.toFixed(2)}×`);
    }
  } else if (median < UP_MS) {
    overSince = 0;
    if (!underSince) underSince = now;
    else if (now - underSince > UP_HOLD && scale < 1) {
      scale = Math.min(1, scale / STEP);
      underSince = 0; window_.length = 0;
      applyDpr(renderer);
      console.log(`[quality] frame ${median.toFixed(1)} ms — resolution up to ${getQuality().dpr.toFixed(2)}×`);
    }
  } else {
    overSince = 0; underSince = 0;
  }
}

/* ---------------- loader badge ---------------- */

/** Small tier readout inside the loader overlay (`#loader`), so it leaves with it. `?debug` keeps a copy. */
export function showBadge(debug = false): void {
  const q = getQuality();
  const text = `quality: ${q.tier}${q.auto ? " (auto)" : ""}`;
  const make = () => {
    const el = document.createElement("div");
    el.className = "quality-badge";
    el.style.cssText = "position:fixed;right:12px;bottom:10px;font:11px/1.3 system-ui,sans-serif;letter-spacing:.06em;color:rgba(255,255,255,.55);pointer-events:none;z-index:30";
    el.textContent = text;
    el.title = q.reasons.join("; ");
    return el;
  };
  document.getElementById("loader")?.appendChild(make());
  if (debug) {
    const el = make();
    el.textContent += ` · ${q.capability.renderer}`;
    document.body.appendChild(el);
    setInterval(() => { el.textContent = `${text} · ${q.dpr.toFixed(2)}× · ${q.capability.renderer}`; }, 1000);
  }
}
