#!/usr/bin/env node
/**
 * System 7 time-series capture: shoots each interaction as a deterministic
 * sequence of frozen frames via `window.__interact(name, t)` and assembles a
 * labelled contact sheet per interaction (pngjs), plus a handful of full-size
 * key frames.
 *
 *   node tools/sequence.mjs                       # build, serve, shoot sit + pour + door + door-ext
 *   node tools/sequence.mjs --seqs=pour,door      # subset
 *   node tools/sequence.mjs --no-build            # reuse dist/
 *   node tools/sequence.mjs --port=5261           # another worktree holds the default
 *   node tools/sequence.mjs --tag=sys7-seq        # → shots/<tag>-<seq>.png (sheet) + shots/<tag>-<seq>-k<i>-<t>s.png (keys)
 *   node tools/sequence.mjs --out=DIR             # write somewhere other than shots/ (before/after comparisons)
 *   node tools/sequence.mjs --query=post=0        # extra URL query (default: post ON — the user sees it with post)
 *   node tools/sequence.mjs --seqs=pour --t0=4.3 --t1=4.9 --step=0.1 --keys=all   # zoom into a window; every frame full-size
 *
 * Every frame is a seek (`__interact(name, t)` freezes the clocks), so the sheet is
 * reproducible frame for frame. Cameras: the sit sequence IS the camera path; pour and
 * door use the System 7 capture cameras from src/interactions/debug.ts, and `door-ext`
 * adds an exterior 3/4 view so the leaf angle can be read against the frame.
 *
 * GPU: same flags + assertion as shoot.mjs (fails on SwiftShader / shader errors).
 * Teardown is wired to every exit path before anything starts.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { PNG } from "pngjs";
import { assertSceneGpu, launchOptions, readLaunchRenderer, isSoftwareRenderer } from "./gpu.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIDTH = 1920;
const HEIGHT = 1080;
const READY_TIMEOUT_MS = 90_000;

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", process.env.SHOOT_PORT ?? "5260"));
const TAG = arg("tag", "sys7-seq");
const QUERY = arg("query", "");
const OUT = path.resolve(ROOT, arg("out", "shots"));
const ONLY = arg("seqs", "").split(",").filter(Boolean);
const DO_BUILD = !argv.includes("--no-build");

/* ------------------------------------------------------------------ */
/* sequences                                                           */
/* ------------------------------------------------------------------ */

// Same cameras as src/interactions/debug.ts (POUR_CAMERA / DOOR_CAMERA).
const POUR_CAMERA = { x: -0.55, y: 1.42, z: -2.15, yaw: 83, pitch: -28 };
const DOOR_CAMERA = { x: 5.5, y: 1.62, z: 1.7, yaw: 156, pitch: -12 };
// Outside on the sidewalk, 3/4 view back at the door: the leaf swings toward the camera so its angle reads.
const DOOR_EXT_CAMERA = { x: 6.3, y: 1.62, z: 4.7, yaw: 46, pitch: -8 };
// System 9 (DRINK_CAMERA in debug.ts): first person in the service aisle at the mug.
const DRINK_CAMERA = { x: -1.25, y: 1.62, z: -1.5, yaw: 8, pitch: -28 };
// System 9 openables (CABINET_CAMERA / KITCHEN_DOOR_CAMERA in debug.ts).
const CABINET_CAMERA = { x: -1.35, y: 1.25, z: -0.7, yaw: 22, pitch: -30 };
const KITCHEN_DOOR_CAMERA = { x: -4.0, y: 1.55, z: -0.9, yaw: 34, pitch: -8 };

/**
 * name → { interact, opts, camera, t0, t1, step, keys, cols, title }
 *   interact: the __interact name; opts: 3rd arg (sit picks a bench)
 *   camera:   __setPose before each seek (null = the interaction places the camera)
 *   keys:     times kept as full-size PNGs
 */
const SEQUENCES = {
  sit: {
    interact: "sit",
    opts: { booth: 2, side: 1 },
    camera: null,
    t0: 0,
    t1: 1.8,
    step: 0.1,
    keys: [0, 0.3, 0.6, 0.9, 1.2, 1.8],
    cols: 5,
    title: "SIT  booth 2 +x  first person  0-1.8 s @ 0.1 s",
  },
  pour: {
    interact: "pour",
    camera: POUR_CAMERA,
    t0: 0,
    t1: 6.0,
    step: 0.25,
    keys: [0, 0.75, 1.5, 2.5, 4.0, 6.0],
    cols: 5,
    title: "POUR  back-bar camera  0-6 s @ 0.25 s",
  },
  door: {
    interact: "door",
    camera: DOOR_CAMERA,
    t0: 0,
    t1: 7.25,
    step: 0.25,
    keys: [0, 0.5, 1.25, 3.0, 5.5, 7.25],
    cols: 6,
    title: "DOOR  vestibule camera  0-7.25 s @ 0.25 s",
  },
  "door-ext": {
    interact: "door",
    camera: DOOR_EXT_CAMERA,
    t0: 0,
    t1: 7.25,
    step: 0.25,
    keys: [],
    cols: 6,
    title: "DOOR  exterior 3/4 camera  0-7.25 s @ 0.25 s",
  },
  drink: {
    interact: "drink",
    camera: DRINK_CAMERA,
    t0: 0,
    t1: 2.8,
    step: 0.1,
    keys: [0, 0.6, 0.95, 1.35, 1.7, 2.55],
    cols: 6,
    title: "DRINK  first person at the mug (full)  0-2.8 s @ 0.1 s",
  },
  cabinet: {
    interact: "cabinet",
    camera: CABINET_CAMERA,
    t0: 0,
    t1: 0.8,
    step: 0.05,
    keys: [0, 0.25, 0.35, 0.5, 0.65, 0.8],
    cols: 6,
    title: "CABINET  left door opens, aisle camera  0-0.8 s @ 0.05 s",
  },
  "cabinet-close": {
    interact: "cabinet-close",
    camera: CABINET_CAMERA,
    t0: 0,
    t1: 0.75,
    step: 0.05,
    keys: [],
    cols: 6,
    title: "CABINET  left door closes  0-0.75 s @ 0.05 s",
  },
  "kitchen-door": {
    interact: "kitchen-door",
    camera: KITCHEN_DOOR_CAMERA,
    t0: 0,
    t1: 2.8,
    step: 0.1,
    keys: [0, 0.4, 0.7, 1.1, 1.4, 2.1],
    cols: 6,
    title: "KITCHEN DOOR  push + spring return, aisle camera  0-2.8 s @ 0.1 s",
  },
};
const NAMES = ONLY.length ? Object.keys(SEQUENCES).filter((s) => ONLY.includes(s)) : Object.keys(SEQUENCES);
// Optional window override (applies to every selected sequence): --t0 --t1 --step, --keys=all|none|t,t,t
for (const name of NAMES) {
  const seq = SEQUENCES[name];
  if (arg("t0")) seq.t0 = Number(arg("t0"));
  if (arg("t1")) seq.t1 = Number(arg("t1"));
  if (arg("step")) seq.step = Number(arg("step"));
  const keys = arg("keys");
  if (keys === "all") seq.keys = "all";
  else if (keys === "none") seq.keys = [];
  else if (keys) seq.keys = keys.split(",").map(Number);
  if (arg("t0") || arg("t1") || arg("step")) seq.title = `${seq.title.split("  ")[0]}  ${seq.t0}-${seq.t1} s @ ${seq.step} s`;
}

/* ------------------------------------------------------------------ */
/* teardown, wired before anything starts                              */
/* ------------------------------------------------------------------ */

const resources = { server: null, browser: null };
let shuttingDown = false;

function withTimeout(promise, ms) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms).unref?.()),
  ]);
}

async function shutdown(code, reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (reason) console.error(`\n[sequence] shutting down: ${reason}`);
  const closers = [
    ["browser", async () => resources.browser && (await resources.browser.close())],
    ["preview server", async () => resources.server && (await resources.server.close())],
  ];
  for (const [label, fn] of closers) {
    try {
      await withTimeout(fn(), 10_000);
    } catch (err) {
      console.error(`[sequence] failed to close ${label}: ${err?.message ?? err}`);
    }
  }
  resources.browser = null;
  resources.server = null;
  process.exit(code);
}

process.on("SIGINT", () => void shutdown(130, "SIGINT"));
process.on("SIGTERM", () => void shutdown(143, "SIGTERM"));
process.on("uncaughtException", (err) => void shutdown(1, `uncaughtException: ${err?.stack ?? err}`));
process.on("unhandledRejection", (err) => void shutdown(1, `unhandledRejection: ${err?.stack ?? err}`));

/* ------------------------------------------------------------------ */
/* tiny bitmap font for the labels (5 × 7, scaled ×2)                   */
/* ------------------------------------------------------------------ */

const GLYPHS = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  "@": ["01110", "10001", "00001", "01101", "10101", "10101", "01110"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11100", "10010", "10001", "10001", "10001", "10010", "11100"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

function drawText(png, text, x0, y0, scale = 2, rgb = [235, 235, 235]) {
  let x = x0;
  for (const chRaw of text.toUpperCase()) {
    const g = GLYPHS[chRaw] ?? GLYPHS[" "];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (g[r][c] !== "1") continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) setPx(png, x + c * scale + dx, y0 + r * scale + dy, rgb);
        }
      }
    }
    x += 6 * scale;
  }
  return x;
}

function setPx(png, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (y * png.width + x) * 4;
  png.data[i] = r;
  png.data[i + 1] = g;
  png.data[i + 2] = b;
  png.data[i + 3] = 255;
}

function fillRect(png, x0, y0, w, h, rgb) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setPx(png, x, y, rgb);
}

/** Box-filter downscale by an integer factor (sRGB bytes; fine for a proof sheet). */
function downscale(src, f) {
  const w = Math.floor(src.width / f), h = Math.floor(src.height / f);
  const out = new PNG({ width: w, height: h });
  const n = f * f;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < f; dy++) {
        let i = ((y * f + dy) * src.width + x * f) * 4;
        for (let dx = 0; dx < f; dx++, i += 4) {
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = r / n;
      out.data[o + 1] = g / n;
      out.data[o + 2] = b / n;
      out.data[o + 3] = 255;
    }
  }
  return out;
}

function blit(dst, src, x0, y0) {
  for (let y = 0; y < src.height; y++) {
    const dy = y0 + y;
    if (dy < 0 || dy >= dst.height) continue;
    const si = y * src.width * 4;
    const di = (dy * dst.width + x0) * 4;
    src.data.copy(dst.data, di, si, si + src.width * 4);
  }
}

/** Assemble the sheet: header strip, then a grid of thumbnails with a timestamp strip under each. */
function buildSheet(frames, cols, title, note) {
  const f = cols === 6 ? 6 : 5; // 1920/6 = 320, 1920/5 = 384
  const tw = WIDTH / f, th = HEIGHT / f;
  const label = 22, gap = 4, header = 40;
  const rows = Math.ceil(frames.length / cols);
  const sheet = new PNG({ width: cols * tw + (cols - 1) * gap, height: header + rows * (th + label + gap) });
  fillRect(sheet, 0, 0, sheet.width, sheet.height, [18, 18, 20]);
  drawText(sheet, title, 8, 8, 2, [250, 250, 250]);
  if (note) drawText(sheet, note, 8, 26, 1, [170, 170, 170]);
  frames.forEach((fr, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const x = c * (tw + gap), y = header + r * (th + label + gap);
    blit(sheet, downscale(fr.png, f), x, y);
    fillRect(sheet, x, y + th, tw, label, [32, 32, 36]);
    drawText(sheet, `T=${fr.t.toFixed(2)}S`, x + 6, y + th + 4, 2, fr.key ? [255, 214, 120] : [230, 230, 230]);
    if (fr.info) drawText(sheet, fr.info, x + 6 + 10 * 12, y + th + 4, 2, [150, 190, 255]);
  });
  return sheet;
}

/* ------------------------------------------------------------------ */

async function main() {
  const tStart = Date.now();
  const { build, preview } = await import("vite");
  const { chromium } = await import("playwright");

  if (DO_BUILD) {
    console.log("[sequence] building...");
    const t0 = Date.now();
    await build({ root: ROOT, logLevel: "warn" });
    console.log(`[sequence] build ${Date.now() - t0} ms`);
  }

  resources.server = await preview({
    root: ROOT,
    logLevel: "warn",
    preview: { port: PORT, strictPort: true, host: "127.0.0.1", open: false },
  });
  const base = `http://127.0.0.1:${PORT}/`;
  console.log(`[sequence] serving dist/ on ${base}`);

  console.log("[sequence] launching headless chromium (hardware GPU)");
  resources.browser = await chromium.launch(launchOptions());
  const context = await resources.browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

  const url = `${base}?shoot=1${QUERY ? `&${QUERY}` : ""}`;
  const tLoad = Date.now();
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  const launchRenderer = await readLaunchRenderer(page);
  if (isSoftwareRenderer(launchRenderer)) throw new Error(`software rasteriser at launch: ${launchRenderer}`);

  try {
    await page.waitForFunction(() => window.__SCENE_READY === true, null, { timeout: READY_TIMEOUT_MS });
  } catch (err) {
    if (problems.length) console.error(`[sequence] scene never became ready. Page said:\n    ${problems.join("\n    ")}`);
    throw err;
  }
  const stats = await assertSceneGpu(page, "sequence");
  console.log(`[sequence] scene ready in ${Date.now() - tLoad} ms  draw calls=${stats.calls}`);
  const hasApi = await page.evaluate(() => typeof window.__interact === "function" && !!window.__interactions);
  if (!hasApi) throw new Error("window.__interact / __interactions missing (System 7 not installed)");

  await fs.mkdir(OUT, { recursive: true });
  const written = [];

  for (const name of NAMES) {
    const seq = SEQUENCES[name];
    const times = [];
    for (let t = seq.t0; t <= seq.t1 + 1e-6; t += seq.step) times.push(Number(t.toFixed(3)));
    const frames = [];
    const tSeq = Date.now();
    for (const t of times) {
      const info = await page.evaluate(
        ({ s, t, cam }) => {
          window.__interact("reset");
          if (cam) window.__setPose(cam);
          window.__interact(s.interact, t, s.opts ?? {});
          const ix = window.__interactions;
          ix.update(0);
          // Per-frame state for the label strip.
          if (s.interact === "door") return `${(ix.door.angleDeg ?? ix.door.progress * 85).toFixed(1)}DEG`;
          if (s.interact === "pour") return ix.pour.state.toUpperCase().slice(0, 7);
          if (s.interact === "sit") return ix.sit.state.toUpperCase().replace("-", " ").slice(0, 12);
          if (s.interact === "drink") return `FILL ${(ix.drink.fill * 100).toFixed(0)}%`;
          if (s.interact === "cabinet" || s.interact === "cabinet-close") return `${ix.cabinet[0].angleDeg.toFixed(1)}DEG`;
          if (s.interact === "kitchen-door") return `${ix.kitchenDoor.angleDeg.toFixed(1)}DEG`;
          return "";
        },
        { s: seq, t, cam: seq.camera },
      );
      // Frozen clocks: a few frames so the shadow maps re-render and the prompt settles.
      await page.evaluate(
        () =>
          new Promise((res) => {
            let n = 0;
            const tick = () => (++n < 5 ? requestAnimationFrame(tick) : res());
            requestAnimationFrame(tick);
          }),
      );
      const buf = await page.screenshot({ type: "png" });
      const png = PNG.sync.read(buf);
          const keyIdx = seq.keys === "all" ? times.indexOf(t) : seq.keys.findIndex((k) => Math.abs(k - t) < 1e-6);
          const key = keyIdx >= 0;
          frames.push({ t, png, key, info });
          if (key) {
            const kf = path.join(OUT, `${TAG}-${name}-k${keyIdx}-${t.toFixed(2)}s.png`);
        await fs.writeFile(kf, buf);
        written.push(kf);
      }
    }
    const sheet = buildSheet(frames, seq.cols, seq.title, `${TAG}  post ${QUERY.includes("post=0") ? "OFF" : "ON"}  key frames in amber  ${new Date().toISOString().slice(0, 10)}`);
    const file = path.join(OUT, `${TAG}-${name}.png`);
    await fs.writeFile(file, PNG.sync.write(sheet));
    written.push(file);
    console.log(`[sequence] ${name.padEnd(9)} ${frames.length} frames -> ${path.relative(ROOT, file)}  (${((Date.now() - tSeq) / 1000).toFixed(1)} s)`);
  }

  await page.evaluate(() => window.__interact("reset"));
  await assertSceneGpu(page, "sequence/final");

  const shaderFailures = problems.filter(
    (p) =>
      (/^console\.error:/.test(p) && /THREE\.WebGLProgram|Shader Error/i.test(p)) ||
      /not compiled|VALIDATE_STATUS|ERROR: \d+:\d+|link(ing)? failed|Shader Error/i.test(p),
  );
  if (problems.length) console.error(`[sequence] page problems (${problems.length}):\n    ${problems.slice(0, 8).join("\n    ")}`);
  console.log(`\n[sequence] ${written.length} files written to ${path.relative(ROOT, OUT) || "."} (tag ${TAG})  total ${((Date.now() - tStart) / 1000).toFixed(1)} s`);
  await shutdown(shaderFailures.length ? 1 : 0, shaderFailures.length ? shaderFailures.map((f) => `shader: ${f}`).join("; ") : null);
}

main().catch((err) => void shutdown(1, err?.stack ?? String(err)));
