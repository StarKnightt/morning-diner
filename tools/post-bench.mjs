#!/usr/bin/env node
/**
 * System 8 bench: per-pass GPU timings (EXT_disjoint_timer_query_webgl2 via
 * window.__post.timings()) and optional frames for a list of URL configurations.
 *
 *   node tools/post-bench.mjs --configs="aa=msaa4;aa=msaa8;aa=smaa;aa=none" --poses=length,window
 *   node tools/post-bench.mjs --configs="post=1;dust=0;haze=0;bloom=0" --poses=length --frames=240
 *   node tools/post-bench.mjs --shot --tag=aa --configs="aa=msaa4;aa=smaa" --poses=blind-macro
 *   node tools/post-bench.mjs --eval="window.__post.probeHDR(960,540)" --poses=length
 *
 * Same GPU assertion and teardown discipline as shoot.mjs. Port: BENCH_PORT (default 5218).
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { assertSceneGpu, launchOptions, readLaunchRenderer, isSoftwareRenderer } from "./gpu.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIDTH = 1920, HEIGHT = 1080;
const PORT = Number(process.env.BENCH_PORT ?? 5218);
const READY_TIMEOUT_MS = 120_000;

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const CONFIGS = arg("configs", "post=1").split(";").filter(Boolean);
const POSE_NAMES = arg("poses", "length").split(",").filter(Boolean);
const FRAMES = Number(arg("frames", "180"));
const TAG = arg("tag", "bench");
const EVAL = arg("eval", "");
const DO_SHOT = argv.includes("--shot");
const DO_BUILD = !argv.includes("--no-build");

// Mirror of tools/shoot.mjs POSES (kept in sync by hand; the bench only needs a few).
const POSES = {
  door: { x: 4.7, z: -0.4, yaw: 184, pitch: -8 },
  length: { x: 5.2, z: 2.5, yaw: 82, pitch: -5 },
  aisle: { x: -2.0, z: 0.55, yaw: 210, pitch: -12 },
  counter: { x: 3.6, z: 0.5, yaw: 78, pitch: -11 },
  booth: { x: -4.3, z: 1.2, yaw: 225, pitch: -20 },
  warmer: { x: -2.35, z: -1.0, yaw: 342, pitch: -16 },
  "macro-warmer": { x: -1.42, y: 1.22, z: -1.68, yaw: 15, pitch: -18 },
  window: { x: -1.1, y: 1.15, z: 2.35, yaw: 180, pitch: 0 },
  "door-glass": { x: 4.9, z: 2.15, yaw: 181, pitch: -11 },
  "blind-macro": { x: -2.78, y: 1.45, z: 2.97, yaw: 168, pitch: -6 },
  "lot-wide": { x: -1.35, z: 0.9, yaw: 180, pitch: -2 },
  stripes: { x: -3.35, y: 1.3, z: 1.85, yaw: 158, pitch: -32 },
  // System 8: standing in the aisle looking toward the sun through booth 2's window (forward scatter).
  beam: { x: -1.6, y: 1.5, z: 0.4, yaw: 215, pitch: -3 },
  // Low in the aisle, toward the sun, booth backs and dividers behind the beams.
  "beam-low": { x: 0.2, y: 1.0, z: 1.2, yaw: 205, pitch: -10 },
};

/* ---------------- teardown first ---------------- */
const resources = { server: null, browser: null };
let shuttingDown = false;
const withTimeout = (p, ms) => Promise.race([Promise.resolve(p), new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms).unref?.())]);
async function shutdown(code, reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (reason) console.error(`\n[bench] shutting down: ${reason}`);
  for (const [label, fn] of [
    ["browser", async () => resources.browser && (await resources.browser.close())],
    ["preview server", async () => resources.server && (await resources.server.close())],
  ]) {
    try {
      await withTimeout(fn(), 10_000);
    } catch (err) {
      console.error(`[bench] failed to close ${label}: ${err?.message ?? err}`);
    }
  }
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(130, "SIGINT"));
process.on("SIGTERM", () => void shutdown(143, "SIGTERM"));
process.on("uncaughtException", (err) => void shutdown(1, `uncaughtException: ${err?.stack ?? err}`));
process.on("unhandledRejection", (err) => void shutdown(1, `unhandledRejection: ${err?.stack ?? err}`));

const waitFrames = (page, n) =>
  page.evaluate(
    (n) =>
      new Promise((res) => {
        let k = 0;
        const tick = () => (++k < n ? requestAnimationFrame(tick) : res());
        requestAnimationFrame(tick);
      }),
    n,
  );

async function main() {
  const { build, preview } = await import("vite");
  const { chromium } = await import("playwright");
  if (DO_BUILD) {
    const t0 = Date.now();
    await build({ root: ROOT, logLevel: "warn" });
    console.log(`[bench] build ${Date.now() - t0} ms`);
  }
  resources.server = await preview({ root: ROOT, logLevel: "warn", preview: { port: PORT, strictPort: true, host: "127.0.0.1", open: false } });
  const base = `http://127.0.0.1:${PORT}/`;
  resources.browser = await chromium.launch(launchOptions());
  const context = await resources.browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
    if (/\[post\]/.test(m.text())) console.log(`  page: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  const outDir = path.join(ROOT, "shots");
  await fs.mkdir(outDir, { recursive: true });

  const rows = [];
  for (const cfg of CONFIGS) {
    const url = `${base}?shoot=1&${cfg}`;
    await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    const launchRenderer = await readLaunchRenderer(page);
    if (isSoftwareRenderer(launchRenderer)) throw new Error(`software rasteriser at launch: ${launchRenderer}`);
    await page.waitForFunction(() => window.__SCENE_READY === true, null, { timeout: READY_TIMEOUT_MS });
    const stats = await assertSceneGpu(page, "bench");
    for (const name of POSE_NAMES) {
      const pose = POSES[name];
      if (!pose) throw new Error(`unknown pose ${name}`);
      await page.evaluate((p) => window.__setPose(p), pose);
      await waitFrames(page, 30);
      // Reset the EMA so the number reflects this pose only, then let it settle.
      await page.evaluate(() => window.__post?.resetTimers?.());
      await waitFrames(page, FRAMES);
      const t = await page.evaluate(() => (window.__post ? window.__post.timings() : null));
      const calls = await page.evaluate(() => window.__stats().calls);
      let evalOut = "";
      if (EVAL) evalOut = JSON.stringify(await page.evaluate(EVAL));
      const row = { cfg, pose: name, calls, timings: t, evalOut };
      rows.push(row);
      const tstr = t
        ? Object.entries(t)
            .map(([k, v]) => `${k}=${v.ema.toFixed(3)}`)
            .join("  ")
        : "(no timer ext)";
      const post = t ? Object.entries(t).filter(([k]) => k !== "scene").reduce((a, [, v]) => a + v.ema, 0) : 0;
      console.log(`[bench] ${cfg.padEnd(28)} ${name.padEnd(12)} calls=${String(calls).padStart(4)}  ${tstr}  | post=${post.toFixed(3)} ms${evalOut ? `  eval=${evalOut}` : ""}`);
      if (DO_SHOT) {
        const file = path.join(outDir, `${TAG}-${cfg.replace(/[^a-z0-9]+/gi, "_")}-${name}.png`);
        await page.screenshot({ path: file, type: "png" });
        console.log(`        -> ${path.relative(ROOT, file)}`);
      }
    }
    void stats;
  }
  const shaderFailures = problems.filter((p) => /THREE\.WebGLProgram|Shader Error|not compiled|VALIDATE_STATUS|ERROR: \d+:\d+|link(ing)? failed/i.test(p));
  if (problems.length) console.error(`[bench] page problems (${problems.length}):\n    ${problems.slice(0, 8).join("\n    ")}`);
  await shutdown(shaderFailures.length ? 1 : 0, shaderFailures.length ? shaderFailures.join("; ") : null);
}

main().catch((err) => void shutdown(1, err?.stack ?? String(err)));
