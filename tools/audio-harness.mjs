#!/usr/bin/env node
/**
 * Offline audio render + level / spectral report.
 *
 *   node tools/audio-harness.mjs                  # 10 s of ambience -> shots/audio-mix.wav
 *   node tools/audio-harness.mjs --sfx            # also fire the one-shots -> shots/audio-sfx.wav
 *   node tools/audio-harness.mjs --seconds=30 --seed=7 --listener=3.15,0.8,62
 *   node tools/audio-harness.mjs --solo=radio --out=radio   # one layer alone -> shots/radio.wav
 *   node tools/audio-harness.mjs --analyze=shots/audio-mix.wav[,shots/audio-sfx.wav]
 *                                                 # analysis only, no render (optionally --events=name:t:dur,...)
 *
 * Serves the repo with Vite on :5220 (the visual harness owns :5210), opens
 * audio-harness.html?offline=1 in headless Chromium, and asks the page to
 * render the whole graph through an OfflineAudioContext with every bus tapped
 * to its own channel pair. Writes the stereo mix as 16-bit WAV, then analyses
 * it here in Node: per-bus RMS/peak/DC, band energies, envelope-modulation
 * shares (fan blade-pass vs speech syllables), L/R correlation around every
 * scheduled event, tonal-line detection, and the event list with timestamps.
 *
 * Teardown (browser + server) is wired to every exit path before anything
 * starts and the process always ends with an explicit exit.
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
const ANALYZE = arg("analyze", "").split(",").filter(Boolean);
const MANUAL_EVENTS = arg("events", "")
  .split(",")
  .filter(Boolean)
  .map((e) => {
    const [name, t, dur] = e.split(":");
    return { name, t: Number(t), dur: Number(dur ?? 0.5) };
  });
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

/** Reads a 16-bit stereo WAV written by this tool. Returns { L, R, sampleRate }. */
async function readWav(file) {
  const buf = await fs.readFile(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error(`${file}: not a WAV`);
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  if (bits !== 16) throw new Error(`${file}: expected 16-bit PCM`);
  // Find the data chunk.
  let off = 12;
  while (off < buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") {
      off += 8;
      const frames = Math.floor(size / (2 * channels));
      const L = new Float64Array(frames);
      const R = new Float64Array(frames);
      for (let i = 0; i < frames; i++) {
        L[i] = buf.readInt16LE(off + i * 2 * channels) / 32768;
        R[i] = channels > 1 ? buf.readInt16LE(off + i * 2 * channels + 2) / 32768 : L[i];
      }
      return { L, R, sampleRate };
    }
    off += 8 + size;
  }
  throw new Error(`${file}: no data chunk`);
}

/* ------------------------------------------------------------------ */
/* analysis                                                            */
/* ------------------------------------------------------------------ */

const db = (x) => 10 * Math.log10(Math.max(x, 1e-24));
const fmt = (v, w = 7, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "-inf").padStart(w);

/** In-place iterative radix-2 complex FFT (re, im are Float64Array of length 2^k). */
function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = i + j + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n);
}

const nextPow2 = (n) => 1 << Math.ceil(Math.log2(Math.max(2, n)));

/** Welch one-sided power spectrum (mean-square per bin) of x, Hann, 50 % overlap. */
function welch(x, N = 8192) {
  const win = new Float64Array(N);
  let wsum = 0;
  for (let i = 0; i < N; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    wsum += win[i] * win[i];
  }
  const acc = new Float64Array(N / 2 + 1);
  const re = new Float64Array(N), im = new Float64Array(N);
  let frames = 0;
  for (let s = 0; s + N <= x.length; s += N / 2) {
    for (let i = 0; i < N; i++) (re[i] = x[s + i] * win[i]), (im[i] = 0);
    fft(re, im);
    for (let k = 0; k <= N / 2; k++) acc[k] += (re[k] * re[k] + im[k] * im[k]) * (k === 0 || k === N / 2 ? 1 : 2);
    frames++;
  }
  const scale = 1 / (Math.max(1, frames) * N * wsum);
  for (let k = 0; k <= N / 2; k++) acc[k] *= scale;
  return acc; // Σ acc ≈ mean-square of x
}

/** Band-limit x to [lo, hi] Hz via FFT brick-wall (fine for analysis). */
function bandpassFFT(x, sampleRate, lo, hi) {
  const n = nextPow2(x.length);
  const re = new Float64Array(n), im = new Float64Array(n);
  re.set(x);
  fft(re, im);
  const binHz = sampleRate / n;
  for (let k = 0; k <= n / 2; k++) {
    const f = k * binHz;
    if (f < lo || f > hi) {
      re[k] = im[k] = 0;
      if (k > 0 && k < n / 2) re[n - k] = im[n - k] = 0;
    }
  }
  fft(re, im, true);
  return re.subarray(0, x.length);
}

/** RMS envelope in hops of `hop` samples. */
function envelope(x, hop) {
  const out = new Float64Array(Math.floor(x.length / hop));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) s += x[j] * x[j];
    out[i] = Math.sqrt(s / hop);
  }
  return out;
}

function percentile(arr, p) {
  const a = Array.from(arr).sort((a, b) => a - b);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
}

/** Share of envelope-modulation energy in [a,b] Hz relative to 0.5–20 Hz. */
function modulationShares(env, envRate, ranges) {
  const n = nextPow2(env.length);
  const re = new Float64Array(n), im = new Float64Array(n);
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;
  for (let i = 0; i < env.length; i++) re[i] = (env[i] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / env.length));
  fft(re, im);
  const binHz = envRate / n;
  const power = (lo, hi) => {
    let s = 0;
    for (let k = 1; k <= n / 2; k++) {
      const f = k * binHz;
      if (f >= lo && f <= hi) s += re[k] * re[k] + im[k] * im[k];
    }
    return s;
  };
  const total = power(0.5, 20) || 1e-30;
  return ranges.map(([lo, hi]) => power(lo, hi) / total);
}

const BANDS = [
  [20, 80],
  [80, 250],
  [250, 900],
  [900, 3000],
  [2000, 6000],
  [5000, 8000],
  [8000, 20000],
];

function pearson(a, b, from, to) {
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
  for (let i = from; i < to; i++) {
    sa += a[i];
    sb += b[i];
    saa += a[i] * a[i];
    sbb += b[i] * b[i];
    sab += a[i] * b[i];
    n++;
  }
  if (n < 2) return NaN;
  const cov = sab / n - (sa / n) * (sb / n);
  const va = saa / n - (sa / n) ** 2;
  const vb = sbb / n - (sb / n) ** 2;
  return cov / Math.sqrt(Math.max(va * vb, 1e-30));
}

function analyse({ L, R, sampleRate }, events) {
  const n = L.length;
  const mono = new Float64Array(n);
  for (let i = 0; i < n; i++) mono[i] = 0.5 * (L[i] + R[i]);

  // --- band energies (average of both channels' power) ------------------
  const pL = welch(L), pR = welch(R);
  const binHz = sampleRate / ((pL.length - 1) * 2);
  const bands = BANDS.map(([lo, hi]) => {
    let s = 0;
    for (let k = 0; k < pL.length; k++) {
      const f = k * binHz;
      if (f >= lo && f < hi) s += 0.5 * (pL[k] + pR[k]);
    }
    return { lo, hi, dbfs: db(s) };
  });

  // --- tonal lines: bins > 6 dB over the local median (±250 Hz), 150–8000 Hz ----
  const psd = pL.map((v, k) => db(0.5 * (v + pR[k])));
  const half = Math.round(250 / binHz);
  const tonal = [];
  for (let k = Math.round(150 / binHz); k < Math.round(8000 / binHz); k++) {
    const win = Array.from(psd.subarray(Math.max(0, k - half), k + half)).sort((a, b) => a - b);
    const med = win[Math.floor(win.length / 2)];
    if (psd[k] - med > 6 && psd[k] >= psd[k - 1] && psd[k] >= psd[k + 1]) tonal.push({ hz: Math.round(k * binHz), excess: psd[k] - med });
  }

  // --- envelope modulation per band -----------------------------------------------
  const hop = Math.round(sampleRate * 0.01); // 100 Hz envelope
  const envRate = sampleRate / hop;
  const modulation = [
    [900, 3000],
    [250, 900],
    [2000, 6000],
    [5000, 8000],
  ].map(([lo, hi]) => {
    const band = bandpassFFT(mono, sampleRate, lo, hi);
    const env = envelope(band, hop);
    const [fan, speech] = modulationShares(env, envRate, [
      [2.3, 3.1],
      [3.2, 6.0],
    ]);
    // AM depth as p90/p10 of a 50 ms envelope (fan blade-pass metric).
    const env20 = envelope(band, Math.round(sampleRate * 0.05));
    const depth = 20 * Math.log10(percentile(env20, 0.9) / Math.max(percentile(env20, 0.1), 1e-9));
    // Bursts: 50 ms envelope segments rising > 6 dB above the floor (p10);
    // pauses: ≥ 250 ms sitting > 6 dB below the loud level (p90).
    const env50 = envelope(band, Math.round(sampleRate * 0.05));
    const floorDb = 20 * Math.log10(percentile(env50, 0.1) + 1e-9);
    const loudDb = 20 * Math.log10(percentile(env50, 0.9) + 1e-9);
    let bursts = 0, pauses = 0, run = 0, above = false;
    for (const v of env50) {
      const d = 20 * Math.log10(v + 1e-9);
      if (d > floorDb + 6) {
        if (!above) bursts++;
        above = true;
      } else above = false;
      if (d < loudDb - 6) {
        run++;
        if (run === 5) pauses++;
      } else run = 0;
    }
    // Coherent AM index m at the blade-pass rate: scan 2.3–3.1 Hz for the
    // strongest envelope component, m = 2|E(f)| / N / mean(env).
    let mean = 0;
    for (const v of env) mean += v;
    mean /= env.length;
    let best = 0;
    for (let f = 2.3; f <= 3.1; f += 0.02) {
      let re = 0, im = 0;
      for (let i = 0; i < env.length; i++) {
        const ph = (-2 * Math.PI * f * i) / envRate;
        re += (env[i] - mean) * Math.cos(ph);
        im += (env[i] - mean) * Math.sin(ph);
      }
      best = Math.max(best, Math.hypot(re, im));
    }
    const m = (2 * best) / env.length / Math.max(mean, 1e-9);
    return { lo, hi, fan, speech, depth, bursts, pauses, m };
  });

  // --- transients: band envelope (10 ms, louder ear) > 6 dB over its 1 s rolling median ---
  const transients = [];
  for (const [lo, hi, label] of [
    [80, 600, "gurgle"],
    [250, 2000, "thock"],
    [3000, 8000, "hiss"],
    [4000, 8000, "tick"],
  ]) {
    const envL = envelope(bandpassFFT(L, sampleRate, lo, hi), hop);
    const envR = envelope(bandpassFFT(R, sampleRate, lo, hi), hop);
    const env = envL.map((v, i) => Math.max(v, envR[i]));
    const envDb = Array.from(env, (v) => 20 * Math.log10(v + 1e-9));
    const half = 50; // ±0.5 s
    let run = null;
    for (let i = 0; i < envDb.length; i++) {
      const win = envDb.slice(Math.max(0, i - half), Math.min(envDb.length, i + half + 1)).sort((a, b) => a - b);
      const med = win[Math.floor(win.length / 2)];
      const excess = envDb[i] - med;
      if (excess > 6) {
        if (!run) run = { band: label, lo, hi, t: i / envRate, end: i, excess, level: envDb[i], gap: 0 };
        else {
          run.end = i;
          run.gap = 0;
          if (excess > run.excess) (run.excess = excess), (run.level = envDb[i]);
        }
      } else if (run && ++run.gap > 2) {
        transients.push({ ...run, dur: (run.end + 1) / envRate - run.t });
        run = null;
      }
    }
    if (run) transients.push({ ...run, dur: (run.end + 1) / envRate - run.t });
  }
  transients.sort((a, b) => a.t - b.t);

  // --- events: peak, RMS and L/R correlation over each region ------------------------
  // Correlation is taken on the 800 Hz–6 kHz band (where the one-shots live)
  // so the correlated LF bed can't mask an anti-phase one-shot, nor the HRTF
  // emitters' decorrelated highs dilute it.
  const corrL = events.length ? bandpassFFT(L, sampleRate, 800, 6000) : L;
  const corrR = events.length ? bandpassFFT(R, sampleRate, 800, 6000) : R;
  const eventRows = events.map((e) => {
    const from = Math.max(0, Math.floor(e.t * sampleRate));
    const to = Math.min(n, Math.ceil((e.t + Math.max(0.03, e.dur)) * sampleRate));
    let peak = 0, sq = 0;
    for (let i = from; i < to; i++) {
      const a = Math.abs(L[i]), b = Math.abs(R[i]);
      if (a > peak) peak = a;
      if (b > peak) peak = b;
      sq += L[i] * L[i] + R[i] * R[i];
    }
    const rms = Math.sqrt(sq / Math.max(1, 2 * (to - from)));
    const lDb = db(sq > 0 ? sumSq(L, from, to) / (to - from) : 0);
    const rDb = db(sq > 0 ? sumSq(R, from, to) / (to - from) : 0);
    return { ...e, peakDb: 20 * Math.log10(peak + 1e-9), rmsDb: 20 * Math.log10(rms + 1e-9), corr: pearson(corrL, corrR, from, to), lrDiff: rDb - lDb };
  });

  // --- whole-file L/R correlation of the 5–8 kHz air ---------------------------------------
  const airL = bandpassFFT(L, sampleRate, 5000, 8000);
  const airR = bandpassFFT(R, sampleRate, 5000, 8000);
  const airCorr = pearson(airL, airR, 0, n);

  return { bands, tonal, modulation, events: eventRows, airCorr, transients };
}

function sumSq(x, from, to) {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return s;
}

function printAnalysis(a) {
  console.log(`  bands (dBFS)  ${a.bands.map((b) => `${b.lo}-${b.hi}`.padStart(10)).join("")}`);
  console.log(`                ${a.bands.map((b) => fmt(b.dbfs, 10)).join("")}`);
  console.log(`  modulation     band        fan 2.3-3.1  speech 3.2-6   AM p90-p10   bursts  pauses(>=250ms)  coherent m @2.3-3.1Hz   [50 ms env; burst > p10+6 dB, pause < p90-6 dB]`);
  for (const m of a.modulation) {
    console.log(
      `                 ${`${m.lo}-${m.hi}`.padEnd(11)} ${fmt(m.fan * 100, 9, 0)}% ${fmt(m.speech * 100, 12, 0)}% ${fmt(m.depth, 11)} dB ${String(m.bursts).padStart(6)} ${String(m.pauses).padStart(7)} ${fmt(m.m, 14, 3)} (${fmt(20 * Math.log10((1 + m.m) / (1 - m.m)), 4)} dB p-t)`,
    );
  }
  console.log(`  transients (band env, louder ear, > 6 dB over 1 s rolling median): ${a.transients.length}`);
  for (const tr of a.transients) {
    console.log(
      `    ${tr.band.padEnd(10)} ${`${tr.lo}-${tr.hi}`.padEnd(10)} t=${fmt(tr.t, 5, 2)} s  dur ${fmt(tr.dur * 1000, 4, 0)} ms  +${fmt(tr.excess, 4)} dB  in-band ${fmt(tr.level, 6)} dBFS`,
    );
  }
  console.log(`  5-8 kHz L/R correlation (whole file): ${fmt(a.airCorr, 5, 2)}`);
  console.log(
    `  tonal lines (>6 dB over ±250 Hz median): ${a.tonal.length ? a.tonal.map((t) => `${t.hz} Hz (+${t.excess.toFixed(1)})`).join(", ") : "none"}`,
  );
  if (a.events.length) {
    console.log(`  events         t(s)   dur    peak dBFS  RMS dBFS  L/R corr  R-L dB   (corr on 0.8-6 kHz band)`);
    for (const e of a.events) {
      console.log(
        `    ${e.name.padEnd(12)} ${fmt(e.t, 5, 2)} ${fmt(e.dur, 5, 2)} ${fmt(e.peakDb, 10)} ${fmt(e.rmsDb, 9)} ${fmt(e.corr, 9, 2)} ${fmt(e.lrDiff, 7)}`,
      );
    }
  }
}

/* ------------------------------------------------------------------ */

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

async function analyzeOnly() {
  for (const file of ANALYZE) {
    const abs = path.resolve(ROOT, file);
    const wav = await readWav(abs);
    console.log(`\nANALYSIS ${path.relative(ROOT, abs)}  (${(wav.L.length / wav.sampleRate).toFixed(1)} s @ ${wav.sampleRate} Hz)`);
    printAnalysis(analyse(wav, MANUAL_EVENTS));
  }
  process.exit(0);
}

async function main() {
  if (ANALYZE.length) return analyzeOnly();
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
    const events = [...(result.events ?? []), ...MANUAL_EVENTS].sort((a, b) => a.t - b.t);
    printAnalysis(analyse(await readWav(file), events));
    if (issues.length) {
      console.log(`  ISSUES: ${issues.join("; ")}`);
      allIssues.push(...issues.map((i) => `${run.name}: ${i}`));
    } else {
      console.log("  OK: within level targets");
    }
  }

  if (problems.length) console.error(`[audio] page problems (${problems.length}):\n    ${problems.slice(0, 8).join("\n    ")}`);
  console.log(`\n[audio] done in ${((Date.now() - tStart) / 1000).toFixed(1)} s`);
  const fatal = problems.filter((p) => p.startsWith("pageerror"));
  await shutdown(fatal.length ? 1 : 0, fatal.length ? fatal.join("; ") : null);
}

main().catch((err) => void shutdown(1, err?.stack ?? String(err)));
