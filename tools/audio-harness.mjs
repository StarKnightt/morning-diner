#!/usr/bin/env node
/**
 * Offline audio render + level report.
 *
 *   node tools/audio-harness.mjs                  # 10 s of ambience -> shots/audio-mix.wav
 *   node tools/audio-harness.mjs --sfx            # also fire the one-shots -> shots/audio-sfx.wav
 *   node tools/audio-harness.mjs --seconds=30 --seed=7 --listener=3.15,0.8,62
 *   node tools/audio-harness.mjs --solo=radio --out=radio   # one layer alone -> shots/radio.wav
 *
 * Serves the repo with Vite on :5220 (the visual harness owns :5210), opens
 * audio-harness.html?offline=1 in headless Chromium, and asks the page to
 * render the whole graph through an OfflineAudioContext with every bus tapped
 * to its own channel pair. Prints RMS/peak/DC per bus and writes the stereo mix
 * as 16-bit WAV. Teardown (browser + server) is wired to every exit path before
 * anything starts and the process always ends with an explicit exit.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5220;

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const SECONDS = Number(arg("seconds", "10"));
const SEED = Number(arg("seed", "20260902"));
const SFX = argv.includes("--sfx");
const MASTER_DB = arg("master", null);
const OUT = arg("out", "audio-mix");
const SOLO = arg("solo", "").split(",").filter(Boolean);
// --listener=x,z[,yawDeg[,y]]  (yaw 0 looks toward -z, positive turns left, as in the scene)
const listenerArg = arg("listener", "0,0.9,90").split(",").map(Number);
const LISTENER = { x: listenerArg[0], y: listenerArg[3] ?? 1.62, z: listenerArg[1], yawDeg: listenerArg[2] ?? 90 };

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
  if (reason) console.error(`\n[audio] shutting down: ${reason}`);
  const closers = [
    ["browser", async () => resources.browser && (await resources.browser.close())],
    ["dev server", async () => resources.server && (await resources.server.close())],
  ];
  for (const [label, fn] of closers) {
    try {
      await withTimeout(fn(), 10_000);
    } catch (err) {
      console.error(`[audio] failed to close ${label}: ${err?.message ?? err}`);
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
/* WAV                                                                 */
/* ------------------------------------------------------------------ */

/** Minimal RIFF/WAVE writer: 16-bit PCM, interleaved stereo. */
function wavFromPcm16(pcm, sampleRate, channels = 2) {
  const header = Buffer.alloc(44);
  const blockAlign = channels * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/* ------------------------------------------------------------------ */

const fmt = (v, w = 7) => (Number.isFinite(v) ? v.toFixed(1) : "-inf").padStart(w);

function printReport(title, result) {
  console.log(`\n${title}  (${result.seconds} s @ ${result.sampleRate} Hz, listener x=${LISTENER.x} z=${LISTENER.z} yaw=${LISTENER.yawDeg}°)`);
  console.log(`  ${"bus".padEnd(11)} ${"RMS dBFS".padStart(9)} ${"peak dBFS".padStart(10)} ${"DC".padStart(9)}  clipped  per-second RMS`);
  for (const s of result.stats) {
    const secs = s.perSecondDb.map((d) => (Number.isFinite(d) ? d.toFixed(0) : "-inf").padStart(4)).join("");
    console.log(
      `  ${s.name.padEnd(11)} ${fmt(s.rmsDb, 9)} ${fmt(s.peakDb, 10)} ${s.dc.toExponential(1).padStart(9)}  ${String(s.clipped).padStart(7)}  ${secs}`,
    );
  }
}

function verdict(result, { sfx }) {
  const mix = result.stats.find((s) => s.name === "mix");
  const issues = [];
  if (!sfx && !SOLO.length) {
    if (mix.rmsDb < -38 || mix.rmsDb > -30) issues.push(`mix RMS ${mix.rmsDb.toFixed(1)} dBFS outside -38..-30`);
  }
  if (mix.peakDb > -6) issues.push(`mix peak ${mix.peakDb.toFixed(1)} dBFS above -6`);
  if (mix.clipped > 0) issues.push(`${mix.clipped} clipped samples`);
  if (Math.abs(mix.dc) > 1e-4) issues.push(`DC offset ${mix.dc.toExponential(2)}`);
  return issues;
}

async function main() {
  const tStart = Date.now();
  const { createServer } = await import("vite");
  const { chromium } = await import("playwright");

  resources.server = await createServer({
    root: ROOT,
    logLevel: "warn",
    server: { port: PORT, strictPort: true, host: "127.0.0.1", open: false },
  });
  await resources.server.listen();
  const url = `http://127.0.0.1:${PORT}/audio-harness.html?offline=1`;
  console.log(`[audio] serving on ${url}`);

  resources.browser = await chromium.launch({
    headless: true,
    args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required", "--disable-gpu"],
  });
  const page = await resources.browser.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForFunction(() => window.__HARNESS_READY === true, null, { timeout: 60_000 });

  const outDir = path.join(ROOT, "shots");
  await fs.mkdir(outDir, { recursive: true });
  const allIssues = [];

  const runs = [{ name: OUT, sfx: false }];
  if (SFX) runs.push({ name: `${OUT.replace(/-mix$/, "")}-sfx`, sfx: true });

  for (const run of runs) {
    const t0 = Date.now();
    const req = { seconds: SECONDS, seed: SEED, listener: LISTENER, sfx: run.sfx, solo: SOLO };
    if (MASTER_DB !== null) req.masterDb = Number(MASTER_DB);
    const result = await page.evaluate((r) => window.__renderOffline(r), req);
    const pcm = Buffer.from(result.pcm16, "base64");
    const file = path.join(outDir, `${run.name}.wav`);
    await fs.writeFile(file, wavFromPcm16(pcm, result.sampleRate));
    printReport(run.sfx ? "AMBIENCE + ONE-SHOTS" : "AMBIENCE", result);
    const issues = verdict(result, run);
    console.log(`  -> ${path.relative(ROOT, file)}  (${((Date.now() - t0) / 1000).toFixed(1)} s render)`);
    if (issues.length) {
      console.log(`  ISSUES: ${issues.join("; ")}`);
      allIssues.push(...issues.map((i) => `${run.name}: ${i}`));
    } else {
      console.log("  OK: within targets");
    }
  }

  if (problems.length) console.error(`[audio] page problems (${problems.length}):\n    ${problems.slice(0, 8).join("\n    ")}`);
  console.log(`\n[audio] done in ${((Date.now() - tStart) / 1000).toFixed(1)} s`);
  const fatal = problems.filter((p) => p.startsWith("pageerror"));
  await shutdown(fatal.length ? 1 : 0, fatal.length ? fatal.join("; ") : null);
}

main().catch((err) => void shutdown(1, err?.stack ?? String(err)));
