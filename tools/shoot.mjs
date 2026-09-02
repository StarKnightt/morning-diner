#!/usr/bin/env node
/**
 * Headless capture harness.
 *
 *   node tools/shoot.mjs --tag=sys1            # build, serve, shoot all poses -> shots/sys1-<pose>.png
 *   node tools/shoot.mjs --tag=sys1 --no-build # reuse dist/
 *   node tools/shoot.mjs --poses=door,aisle    # subset
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
const PORT = 5210;
const READY_TIMEOUT_MS = 90_000;
const SETTLE_MS = 600;

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
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
  undertable: { x: 3.0, y: 1.0, z: 0.65, yaw: 166, pitch: -14 },
  ceiling: { x: 0.85, z: 0.75, yaw: 104, pitch: 28 },
  // Seated at the third booth, looking across the table at the dispenser and shakers.
  table: { x: -0.52, y: 1.15, z: 2.55, yaw: 130, pitch: -21 },
  // Behind the counter in the service aisle, looking at the brewer, decanter and the mug ledge.
  warmer: { x: -2.35, z: -1.0, yaw: 342, pitch: -16 },
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

  const outDir = path.join(ROOT, "shots");
  await fs.mkdir(outDir, { recursive: true });

  const written = [];
  for (const name of NAMES) {
    const pose = POSES[name];
    const t0 = Date.now();
    await page.evaluate((p) => window.__setPose(p), pose);
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
