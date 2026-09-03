#!/usr/bin/env node
/**
 * Headless capture harness.
 *
 *   node tools/shoot.mjs --tag=sys1            # build, serve, shoot all poses -> shots/sys1-<pose>.png
 *   node tools/shoot.mjs --tag=sys1 --no-build # reuse dist/
 *   node tools/shoot.mjs --poses=door,aisle    # subset
 *   node tools/shoot.mjs --port=5211            # when another worktree holds 5210
 *   node tools/shoot.mjs --query=debug         # extra URL query
 *
 * Renders on the discrete GPU and fails loudly on SwiftShader or on any shader
 * compile/link error. Teardown (browser + preview server) is wired to every
 * exit path before anything starts, and the process always ends with an
 * explicit process.exit(). Nothing is detached.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { assertSceneGpu, launchOptions, readLaunchRenderer, isSoftwareRenderer } from "./gpu.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIDTH = 1920;
const HEIGHT = 1080;
const READY_TIMEOUT_MS = Number(process.env.SHOOT_READY_MS) || 90_000;
const SETTLE_MS = 600;

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
/**
 * `--port=N` (or the SHOOT_PORT env var): the machine is shared with other worktrees'
 * harnesses and each preview server needs its own port; pick a free one.
 */
const PORT = Number(arg("port", process.env.SHOOT_PORT ?? "5210"));
const TAG = arg("tag", "sys1");
const QUERY = arg("query", "");
const ONLY = arg("poses", "").split(",").filter(Boolean);
const DO_BUILD = !argv.includes("--no-build");

/**
 * Camera poses. Angles in degrees: yaw 0 looks toward -z (the kitchen wall),
 * positive yaw turns left (toward -x); pitch positive looks up. y defaults to
 * eye height (1.65 m).
 *
 * Plan reminder: x runs the length of the room (door at x≈4.6), +z is the
 * window wall (z=3.25), booths z∈[1.85,3.25], counter front z=0.15, kitchen
 * partition z=-2.6.
 */
const POSES = {
  door: { x: 4.7, z: -0.4, yaw: 184, pitch: -8 },
  length: { x: 5.2, z: 2.5, yaw: 82, pitch: -5 },
  aisle: { x: -2.0, z: 0.55, yaw: 210, pitch: -12 },
  counter: { x: 3.6, z: 0.5, yaw: 78, pitch: -11 },
  booth: { x: -4.3, z: 1.2, yaw: 225, pitch: -20 },
  // Low camera (0.62 m) so the pedestal column, spider plate and bell base are all in frame.
  undertable: { x: 3.05, y: 0.62, z: 0.3, yaw: 166, pitch: -5 },
  ceiling: { x: 0.85, z: 0.75, yaw: 104, pitch: 28 },
  // Seated at the third booth, looking across the table at the dispenser and shakers.
  table: { x: -0.52, y: 1.15, z: 2.55, yaw: 130, pitch: -21 },
  // Behind the counter in the service aisle, looking at the brewer, decanter and the mug ledge.
  warmer: { x: -2.35, z: -1.0, yaw: 342, pitch: -16 },
  // Close-ups for prop judgement: 0.6 m from the third booth's caddy set; 0.7 m from the decanter + pour mug.
  "macro-table": { x: -0.68, y: 0.98, z: 2.68, yaw: 136, pitch: -17 },
  "macro-warmer": { x: -1.42, y: 1.22, z: -1.68, yaw: 15, pitch: -18 },
  // fix-backcounter — standing in the service aisle at the door end looking along the work side
  // of the counter (the user's frame), and 0.75 m from the reach-in / plate shelves.
  along: { x: 1.3, z: -1.1, yaw: 95, pitch: -24 },
  close: { x: -2.75, y: 1.2, z: -1.8, yaw: 150, pitch: -18 },
  // System 3 — windows, blinds, exterior. yaw 180 looks straight out through the window wall (+z).
  // Seated at the third booth, eye-line through the slats.
  window: { x: -1.1, y: 1.15, z: 2.35, yaw: 180, pitch: 0 },
  // Standing a metre inside the door, looking out through the door glass at the sedan
  // (fix-sign-car: the sedan moved from stall 6 to stall 7, one stall to +x; the pose turns
  // 12° that way so the car stays in the pane instead of leaving empty asphalt in frame).
  "door-glass": { x: 4.9, z: 2.15, yaw: 193, pitch: -11 },
  // 30 cm from the second window's slats, on the centre ladder.
  "blind-macro": { x: -2.78, y: 1.45, z: 2.97, yaw: 168, pitch: -6 },
  // From the aisle through the third window: pickup, stall row, wall, desert, mesa, sky.
  "lot-wide": { x: -1.35, z: 0.9, yaw: 180, pitch: -2 },
  // Second booth's table where the slat stripes land.
  stripes: { x: -3.35, y: 1.3, z: 1.85, yaw: 158, pitch: -32 },
  // System 5 — surface close-ups. Door glass from 1.2 m (signage, kick plate, push bar wear);
  // the aisle floor from standing height looking down (lane wear, grout, scuffs); the door-end
  // wall at arm's length (stipple, seam, scuff band, cove base).
  "door-dressing": { x: 4.95, y: 1.45, z: 2.0, yaw: 180, pitch: -6 },
  "floor-macro": { x: 1.6, y: 1.35, z: 1.05, yaw: 250, pitch: -48 },
  "wall-macro": { x: 4.85, y: 1.25, z: 0.7, yaw: 270, pitch: -10 },
  // Crouched a metre inside the door: the kick plate (satin grain, bevel, screws) and the saddle.
  "kick-macro": { x: 4.95, y: 0.55, z: 2.3, yaw: 180, pitch: -14 },
  // 0.5 m from the second booth's aisle-side back panel (welt cracking); the stained tile over booth 3.
  "welt-macro": { x: -3.0, y: 1.05, z: 2.55, yaw: 90, pitch: -8 },
  "ceiling-stain": { x: -1.9, y: 1.6, z: 0.35, yaw: 180, pitch: 36 },
  // System 3 debug poses — OUTSIDE the building, for judging the lot dressing at critic distance
  // (never player-reachable; the window wall is between the player and the lot). Shoot with --tag=sys3.
  "dbg-pickup-front34": { x: 3.8, y: 1.6, z: 4.4, yaw: 111, pitch: -8 },
  "dbg-pickup-side": { x: -7.2, y: 1.6, z: 8.5, yaw: 270, pitch: -6 },
  "dbg-pickup-rear34": { x: 3.3, y: 1.6, z: 15, yaw: 35, pitch: -6 },
  // Sedan poses follow the car: fix-sign-car moved it from stall 6 (x 3.97) to stall 7 (x 6.90), +2.93 in x.
  "dbg-sedan-front34": { x: 1.93, y: 1.6, z: 4.4, yaw: 249, pitch: -8 },
  "dbg-sedan-rear34": { x: 2.43, y: 1.6, z: 15, yaw: 325, pitch: -6 },
  // Macro: 1.2 m from the sedan's front-left wheel; the stop bar in front of the sedan with its nose overhang.
  "dbg-wheel": { x: 5.13, y: 0.8, z: 6.95, yaw: 290, pitch: -34 },
  "dbg-wheelstop": { x: 4.63, y: 0.75, z: 5.2, yaw: 248, pitch: -24 },
  // Standing on the lot in the empty stall between the two cars (stall 5; stall 6 is empty too since fix-sign-car): CMU wall, scrub edge, road, ranges.
  "dbg-wall-road": { x: 1.35, y: 1.87, z: 6.5, yaw: 180, pitch: -1 },
  // World layer (World.ts): the user's "from the lot looking out" frame plus three more.
  "world-lot-out": { x: 0.6, y: 1.62, z: 9.0, yaw: 180, pitch: -3 },
  "world-road": { x: -2.5, y: 1.62, z: 27.0, yaw: 100, pitch: -4 },
  "world-facade-wide": { x: 9.0, y: 1.62, z: 29.0, yaw: 14, pitch: -3 },
  "world-door-view": { x: 4.9, y: 1.62, z: 4.2, yaw: 172, pitch: -4 },
  // fix-pole — the lot light standard at x 5.4: the user's look-up at the head from ~3 m on the
  // drive aisle (mast left, arm sweeping right), and the whole standard from 15 m.
  "fix-pole-lookup": { x: 8.0, y: 1.62, z: 10.1, yaw: 84, pitch: 64 },
  "fix-pole-lot": { x: 18.4, y: 1.62, z: 18.9, yaw: 60, pitch: 10 },
  // Crouched 1.6 m from the pier: base plate, anchor bolts, shoe, rust bloom, handhole cover.
  "fix-pole-base": { x: 6.6, y: 1.1, z: 10.2, yaw: 135, pitch: -16 },
  // Signage (Signage.ts) — from the lot, 8–12 m: the pylon at the entrance gap, the parapet
  // letters over the facade, the door's enamel panels. Shoot with --tag=sign.
  "sign-pylon": { x: 10.0, y: 1.62, z: 9.0, yaw: 140, pitch: 12 },
  "sign-facade": { x: 1.6, y: 1.62, z: 13.0, yaw: 0, pitch: 6 },
  "sign-door": { x: 5.6, y: 1.62, z: 11.5, yaw: 0, pitch: 2 },
  // System 7 — interactions. These call window.__interactPose(name) (src/interactions/debug.ts),
  // which resets every interaction, seeks the named one to a fixed time, freezes the animation
  // clocks and places the camera itself (the seated pose IS the camera).
  "sit-seated": { interact: "sit-seated" },
  // Counter stools (feat-stool-sit): prompt up behind stool 5, seated on it, seated with the look turned 60° left.
  "stool-approach": { interact: "stool-approach" },
  "stool-seated": { interact: "stool-seated" },
  "stool-seated-look-left": { interact: "stool-seated-look-left" },
  "pour-mid": { interact: "pour-mid" },
  "pour-full": { interact: "pour-full" },
  "door-open": { interact: "door-open" },
  // System 9 — implied presence props (src/scene/Presence.ts), each from about a metre (the apron pose went with the apron, rev 3).
  "sys9-plate": { x: -1.0, y: 1.35, z: 1.75, yaw: 165, pitch: -35 },
  "sys9-cup": { x: -3.4, y: 1.35, z: 0.7, yaw: 29, pitch: -16 },
  // System 9 — openables at rest and open (Openables.ts; the open poses go through __interactPose).
  "sys9-cabinet": { x: -1.55, y: 1.35, z: -0.7, yaw: 8, pitch: -30 },
  "sys9-cabinet-open": { interact: "cabinet-open" },
  // fix-cabinets — every cabinet door openable: the upper run shut / open, the under-counter pair open.
  "cabinets-closed": { interact: "cabinets-closed" },
  "cabinets-open-upper": { interact: "cabinets-open-upper" },
  "cabinets-open-lower": { interact: "cabinets-open-lower" },
  "sys9-kitchen-door": { x: -4.6, y: 1.5, z: -1.3, yaw: 23, pitch: -18 },
  "sys9-kitchen-door-open": { interact: "kitchen-door-open" },
  "sys9-kitchen-door-back": { interact: "kitchen-door-back" },
  // fix-rear — the enclosed kitchen box from the lot side, ~8 m off: rear quarter (from the −x
  // rear corner), straight on to the back wall, and the −x side; `fix-side` is the user's pose:
  // standing off the −x end looking down the long side wall toward the storefront.
  "fix-rear-quarter": { x: -14.5, y: 1.62, z: -15.0, yaw: 232, pitch: 3 },
  "fix-rear-back": { x: -1.5, y: 1.62, z: -15.5, yaw: 180, pitch: 4 },
  "fix-rear-side": { x: -14.0, y: 1.62, z: -6.0, yaw: 272, pitch: 4 },
  "fix-side": { x: -15.5, y: 1.62, z: -0.5, yaw: 262, pitch: 3 },
  // feat-blinds-f — window 1's blind down / mid-raise / up from the second booth, and the raised
  // blind from the lot (all through __interactPose; the camera is part of the pose).
  "blinds-down": { interact: "blinds-down" },
  "blinds-mid": { interact: "blinds-mid" },
  "blinds-up": { interact: "blinds-up" },
  "blinds-up-exterior": { interact: "blinds-up-exterior" },
  // feat-kitchen — the walkable kitchen (Kitchen.ts). `kitchen-door-open` is the swing door held
  // open from the service aisle; the rest stand inside the kitchen (z < -2.85).
  "kitchen-door-open": { interact: "kitchen-door-open", x: -4.2, y: 1.55, z: -1.0, yaw: 28, pitch: -6 },
  "kitchen-line": { x: -0.2, z: -5.2, yaw: 178, pitch: -8 },
  "kitchen-prep": { x: 2.2, z: -3.6, yaw: 120, pitch: -12 },
  "kitchen-dish": { x: 3.2, z: -4.2, yaw: 255, pitch: -8 },
  "kitchen-back-door": { x: -0.8, z: -3.4, yaw: 30, pitch: -4 },
};
const NAMES = ONLY.length ? Object.keys(POSES).filter((p) => ONLY.includes(p)) : Object.keys(POSES);

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
  if (reason) console.error(`\n[shoot] shutting down: ${reason}`);
  const closers = [
    ["browser", async () => resources.browser && (await resources.browser.close())],
    ["preview server", async () => resources.server && (await resources.server.close())],
  ];
  for (const [label, fn] of closers) {
    try {
      await withTimeout(fn(), 10_000);
    } catch (err) {
      console.error(`[shoot] failed to close ${label}: ${err?.message ?? err}`);
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

async function main() {
  const tStart = Date.now();
  const { build, preview } = await import("vite");
  const { chromium } = await import("playwright");

  let buildMs = 0;
  if (DO_BUILD) {
    console.log("[shoot] building...");
    const t0 = Date.now();
    await build({ root: ROOT, logLevel: "warn" });
    buildMs = Date.now() - t0;
    console.log(`[shoot] build ${buildMs} ms`);
  }

  resources.server = await preview({
    root: ROOT,
    logLevel: "warn",
    preview: { port: PORT, strictPort: true, host: "127.0.0.1", open: false },
  });
  const base = `http://127.0.0.1:${PORT}/`;
  console.log(`[shoot] serving dist/ on ${base}`);

  console.log("[shoot] launching headless chromium (hardware GPU)");
  resources.browser = await chromium.launch(launchOptions());
  const context = await resources.browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

  const url = `${base}?shoot=1${QUERY ? `&${QUERY}` : ""}`;
  const tLoad = Date.now();
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });

  // Launch-time check (throwaway context) — cheap early warning.
  const launchRenderer = await readLaunchRenderer(page);
  if (isSoftwareRenderer(launchRenderer)) {
    throw new Error(`software rasteriser at launch: ${launchRenderer}`);
  }

  try {
    await page.waitForFunction(() => window.__SCENE_READY === true, null, { timeout: READY_TIMEOUT_MS });
  } catch (err) {
    if (problems.length) console.error(`[shoot] scene never became ready. Page said:\n    ${problems.join("\n    ")}`);
    throw err;
  }
  const readyMs = Date.now() - tLoad;

  // The check that covers the pixels: renderer string from three's live context.
  const stats = await assertSceneGpu(page, "shoot");
  console.log(`[shoot] scene ready in ${readyMs} ms  draw calls=${stats.calls}  triangles=${stats.triangles}`);

  // Boot timeline from src/main.ts (window.__perf): where the start-up time went.
  const perf = await page.evaluate(() => (typeof window.__perf === "function" ? window.__perf() : null));
  if (perf) {
    console.log(
      `[shoot] boot: ${perf.marks.map((m) => `${m.name} ${m.ms}`).join(" · ")} ms` +
        `  textures ${perf.textures.wallMs} ms wall on ${perf.textures.workers} workers` +
        `  programs=${perf.programs} parallel-compile=${perf.parallelCompile}`,
    );
  }

  const outDir = path.join(ROOT, "shots");
  await fs.mkdir(outDir, { recursive: true });

  const written = [];
  for (const name of NAMES) {
    const pose = POSES[name];
    const t0 = Date.now();
    await page.evaluate(({ p, name }) => {
      // Interactions back to rest before every frame so an open door or a full mug never leaks into the next pose.
      window.__interact?.("reset");
      // The "E — Sit" hint is part of the System 7 frames; the scene poses (several stand within
      // reach of a bench) and the System 9 prop / openable frames are for the realism critics and
      // must not carry UI.
      const prompt = document.querySelector(".mdn-prompt");
      if (prompt) prompt.style.display = p.interact && !name.startsWith("sys9-") ? "" : "none";
      if (p.interact) {
        if (!window.__interactPose) throw new Error(`pose needs window.__interactPose (System 7) for "${p.interact}"`);
        window.__interactPose(p.interact);
      }
      // A pose with a camera of its own (feat-kitchen: an interact pose shot from elsewhere).
      if (p.x !== undefined) window.__setPose(p);
    }, { p: pose, name });
    await page.waitForTimeout(SETTLE_MS);
    // A few extra frames so shadows and any lazily compiled program have drawn.
    await page.evaluate(
      () =>
        new Promise((res) => {
          let n = 0;
          const tick = () => (++n < 6 ? requestAnimationFrame(tick) : res());
          requestAnimationFrame(tick);
        }),
    );
    const file = path.join(outDir, `${TAG}-${name}.png`);
    await page.screenshot({ path: file, type: "png" });
    written.push(file);
    const s = await page.evaluate(() => window.__stats());
    console.log(`[shoot] ${name.padEnd(8)} -> ${path.relative(ROOT, file)}  calls=${s.calls}  (${Date.now() - t0} ms)`);
  }

  const finalStats = await assertSceneGpu(page, "shoot/final");
  void finalStats;

  // Fatal: console *errors* from the program compiler, or any message that
  // names a failed compile/link. D3D "Program Info Log" precision *warnings*
  // (X4122 etc.) are benign and only reported.
  const shaderFailures = problems.filter(
    (p) =>
      (/^console\.error:/.test(p) && /THREE\.WebGLProgram|Shader Error/i.test(p)) ||
      /not compiled|VALIDATE_STATUS|ERROR: \d+:\d+|link(ing)? failed|Shader Error/i.test(p),
  );
  if (problems.length) {
    console.error(`[shoot] page problems (${problems.length}):\n    ${problems.slice(0, 8).join("\n    ")}`);
  }

  console.log(
    `\n[shoot] ${written.length}/${NAMES.length} frames written to shots/ (tag ${TAG})` +
      `  build ${buildMs} ms  ready ${readyMs} ms  total ${((Date.now() - tStart) / 1000).toFixed(1)} s`,
  );
  const bad = [
    ...NAMES.filter((n) => !written.some((w) => w.endsWith(`${TAG}-${n}.png`))).map((m) => `missing: ${m}`),
    ...shaderFailures.map((f) => `shader: ${f}`),
  ];
  await shutdown(bad.length ? 1 : 0, bad.length ? bad.join("; ") : null);
}

main().catch((err) => void shutdown(1, err?.stack ?? String(err)));
