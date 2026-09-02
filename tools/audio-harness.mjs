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
 * Live-mix calibration (System 6 rev 3), everything written to tmp/<tag>-*.wav + tmp/<tag>-report.json:
 *   node tools/audio-harness.mjs --poses[=door,aisle,booth3,counter,ac,radio] [--tag=before]
 *       the scene's wired graph (wiring.ts positions) heard from six listener poses, 12 s each:
 *       integrated LUFS (BS.1770-4 K-weighting, absolute −70 / relative −10 LU gating) of the mix
 *       and of every bus tap (= that source solo, post-panner, pre-reverb), spectral centroid,
 *       L/R balance against the geometric direction of each source, crest factor
 *   node tools/audio-harness.mjs --calib
 *       each spatialised source alone at 1 m and along a distance sweep, measured against the
 *       PannerNode inverse model it was given (refDistance / rolloffFactor)
 *   node tools/audio-harness.mjs --scenario=pour|door
 *       System 7's exact timelines (Pour.ts / DoorSwing.ts) with the listener where the player
 *       stands: onset offsets, cavity sweep, click/discontinuity scan, heat-wall rise + hold level,
 *       interior duck, restore on latch, clink peaks
 *
 * Serves the repo with Vite on :5320 (`--port=N` / AUDIO_PORT; the visual harnesses own 5210–5260),
 * opens audio-harness.html?offline=1 in headless Chromium, and asks the page to
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

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", process.env.AUDIO_PORT ?? "5320"));
const SECONDS = Number(arg("seconds", "10"));
const SEED = Number(arg("seed", "20260902"));
const SFX = argv.includes("--sfx");
const MASTER_DB = arg("master", null);
const OUT = arg("out", "audio-mix");
const SOLO = arg("solo", "").split(",").filter(Boolean);
const ANALYZE = arg("analyze", "").split(",").filter(Boolean);
const POSES_FLAG = argv.find((a) => a === "--poses" || a.startsWith("--poses="));
const POSES = POSES_FLAG ? (POSES_FLAG.includes("=") ? POSES_FLAG.split("=")[1].split(",").filter(Boolean) : null) : undefined;
const CALIB = argv.includes("--calib");
const SCENARIO = arg("scenario", null);
const TAG = arg("tag", "mix");
const OUTDIR = arg("outdir", "tmp");
const POSE_SECONDS = Number(arg("pose-seconds", "12"));
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

/* ------------------------------------------------------------------ */
/* loudness (ITU-R BS.1770-4) and the per-pose metrics                 */
/* ------------------------------------------------------------------ */

/** K-weighting biquads for any sample rate (the spec tabulates 48 kHz; these reproduce it to 1e-6). */
function kWeightCoeffs(fs) {
  // Stage 1: high shelf, +4 dB above ~1.5 kHz.
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  // Stage 2: RLB high-pass at ~38 Hz.
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / fs);
  const a01 = 1 + K1 / Q1 + K1 * K1;
  const hp = { b: [1, -2, 1], a: [1, (2 * (K1 * K1 - 1)) / a01, (1 - K1 / Q1 + K1 * K1) / a01] };
  return [shelf, hp];
}

function biquad(x, { b, a }) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

function kWeight(x, fs) {
  const [shelf, hp] = kWeightCoeffs(fs);
  return biquad(biquad(x, shelf), hp);
}

/**
 * Integrated loudness of a stereo pair per BS.1770-4: K-weighted, 400 ms blocks at 75 % overlap,
 * absolute gate −70 LUFS, relative gate −10 LU. Also returns the momentary series (block loudness,
 * 100 ms hop) for envelope questions. `from`/`to` in seconds restrict the window.
 */
function loudness(L, R, fs, from = 0, to = L.length / fs) {
  const i0 = Math.max(0, Math.floor(from * fs)), i1 = Math.min(L.length, Math.ceil(to * fs));
  const zL = kWeight(L.subarray(i0, i1), fs), zR = kWeight(R.subarray(i0, i1), fs);
  const blockN = Math.round(0.4 * fs), hop = Math.round(0.1 * fs);
  const n = zL.length;
  if (n < blockN) return { integrated: -Infinity, momentary: [], times: [], hop: 0.1 };
  const powers = [], times = [];
  for (let s = 0; s + blockN <= n; s += hop) {
    let p = 0;
    for (let i = s; i < s + blockN; i++) p += zL[i] * zL[i] + zR[i] * zR[i];
    powers.push(p / blockN);
    times.push(from + s / fs);
  }
  const lk = (p) => -0.691 + 10 * Math.log10(Math.max(p, 1e-30));
  const momentary = powers.map(lk);
  const abs = powers.filter((p) => lk(p) > -70);
  if (!abs.length) return { integrated: -Infinity, momentary, times, hop: 0.1 };
  const relThreshold = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const kept = abs.filter((p) => lk(p) > relThreshold);
  const integrated = kept.length ? lk(kept.reduce((a, b) => a + b, 0) / kept.length) : -Infinity;
  return { integrated, momentary, times, hop: 0.1 };
}

/** Spectral centroid (Hz) of the mean L/R Welch spectrum, 20 Hz–20 kHz. */
function centroid(L, R, fs) {
  const pL = welch(L, 4096), pR = welch(R, 4096);
  const binHz = fs / 4096;
  let num = 0, den = 0;
  for (let k = 1; k < pL.length; k++) {
    const f = k * binHz;
    if (f < 20 || f > 20000) continue;
    const p = pL[k] + pR[k];
    num += f * p;
    den += p;
  }
  return den > 0 ? num / den : NaN;
}

/** R−L power balance (dB, positive = right louder), crest factor (dB) and peak (dBFS). */
function balanceCrest(L, R, from = 0, to = L.length) {
  let sl = 0, sr = 0, peak = 0;
  for (let i = from; i < to; i++) {
    sl += L[i] * L[i];
    sr += R[i] * R[i];
    const a = Math.abs(L[i]), b = Math.abs(R[i]);
    if (a > peak) peak = a;
    if (b > peak) peak = b;
  }
  const n = Math.max(1, to - from);
  const rms = Math.sqrt((sl + sr) / (2 * n));
  return {
    balanceDb: 10 * Math.log10(Math.max(sr, 1e-30) / Math.max(sl, 1e-30)),
    crestDb: 20 * Math.log10(Math.max(peak, 1e-30) / Math.max(rms, 1e-30)),
    peakDb: 20 * Math.log10(Math.max(peak, 1e-30)),
    rmsDb: 20 * Math.log10(Math.max(rms, 1e-30)),
  };
}

/**
 * Discontinuity scan. `maxStep` is the largest sample-to-sample step in FS (the brief's 0.1 FS
 * bound; note a legitimate 5 kHz component at peak A already steps 0.65·A per sample, so the
 * absolute figure is only meaningful against the peak level). `maxRatio` is the largest step
 * relative to the RMS of the *preceding* 20 ms, which is what a click is: a step the signal's own
 * spectrum cannot produce (band-limited noise at −30 dBFS never exceeds ~4–5×).
 */
function clickScan(L, R, fs, from = 0, to = L.length) {
  const win = Math.round(0.02 * fs);
  from = Math.max(win + 1, from);
  let maxStep = 0, maxStepAt = 0, maxRatio = 0, maxRatioAt = 0;
  for (const ch of [L, R]) {
    let acc = 0;
    for (let i = from - win; i < from; i++) acc += ch[i] * ch[i];
    for (let i = from; i < to; i++) {
      const step = Math.abs(ch[i] - ch[i - 1]);
      if (step > maxStep) (maxStep = step), (maxStepAt = i / fs);
      const local = Math.sqrt(Math.max(acc, 0) / win);
      if (local > 1e-4) {
        const r = step / local;
        if (r > maxRatio) (maxRatio = r), (maxRatioAt = i / fs);
      }
      acc += ch[i] * ch[i] - ch[i - win] * ch[i - win];
    }
  }
  return { maxStep, maxStepAt, maxRatio, maxRatioAt };
}

/** 5 ms RMS envelope in dBFS (louder channel) of a stereo pair. */
function envDb(L, R, fs, hopS = 0.005) {
  const hop = Math.round(hopS * fs);
  const out = new Float64Array(Math.floor(L.length / hop));
  for (let i = 0; i < out.length; i++) {
    let sl = 0, sr = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) (sl += L[j] * L[j]), (sr += R[j] * R[j]);
    out[i] = 10 * Math.log10(Math.max(sl, sr, 1e-30) / hop);
  }
  return { env: out, hopS };
}

/** Peak-frequency (Hz) of a 4096-sample Hann frame at `t` inside [lo, hi] Hz. */
function peakFreqAt(L, R, fs, t, lo, hi) {
  const N = 4096;
  const s = Math.max(0, Math.min(L.length - N, Math.round(t * fs) - N / 2));
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = 0.5 * (L[s + i] + R[s + i]) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  fft(re, im);
  const binHz = fs / N;
  let best = -1, bestP = 0;
  for (let k = Math.ceil(lo / binHz); k <= Math.floor(hi / binHz); k++) {
    const p = re[k] * re[k] + im[k] * im[k];
    if (p > bestP) (bestP = p), (best = k);
  }
  // Parabolic interpolation around the peak bin.
  if (best > 0 && best < N / 2) {
    const pw = (k) => 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-30);
    const a = pw(best - 1), b = pw(best), c = pw(best + 1);
    const d = (0.5 * (a - c)) / (a - 2 * b + c || 1);
    return (best + d) * binHz;
  }
  return best * binHz;
}

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */

const DEG = Math.PI / 180;
/** Listener basis from the scene's yaw (0 → −z, positive turns left toward −x). */
function listenerBasis(pose) {
  const yaw = pose.yawDeg * DEG;
  const forward = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
  const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  return { forward, right };
}
/** Distance and lateral sine (+ = source on the listener's right) of a source from a pose. */
function relative(pose, src) {
  const d = { x: src.x - pose.x, y: src.y - pose.y, z: src.z - pose.z };
  const dist = Math.hypot(d.x, d.y, d.z);
  const { right, forward } = listenerBasis(pose);
  const lateral = (d.x * right.x + d.z * right.z) / (dist || 1);
  const ahead = (d.x * forward.x + d.z * forward.z) / (dist || 1);
  return { dist, lateral, ahead };
}
/** Yaw (deg) that looks from `pose` at `src`. */
const yawTowardDeg = (pose, src) => Math.atan2(-(src.x - pose.x), -(src.z - pose.z)) / DEG;
/** Web Audio "inverse" distance gain, clamped like PannerNode does. */
const inverseGain = (d, ref, roll, max = 18) => ref / (ref + roll * (Math.max(ref, Math.min(d, max)) - ref));

const side = (lateral) => (Math.abs(lateral) < 0.15 ? "centre" : lateral > 0 ? "right" : "left");

/** The six listener poses, built from the page's layout so the numbers track layout.ts. */
function makePoses(LAY) {
  const P = LAY.positions;
  const zMid = (LAY.booth.zInner + LAY.booth.zOuter) / 2;
  const cx3 = LAY.window.centersX[2];
  const S = LAY.seated;
  return {
    door: { x: LAY.door.centerX, y: 1.62, z: LAY.room.zFront - 0.8, yawDeg: 90, label: "inside the door, facing down the room (−x)" },
    aisle: { x: 0, y: 1.62, z: 0.9, yawDeg: 90, label: "aisle centre, facing −x" },
    booth3: { x: cx3 - S.fromCentre, y: S.eye, z: zMid, yawDeg: 180 + S.turnDeg, pitchDeg: S.pitchDeg, label: "seated, booth 3 (−x bench), turned to the window" },
    counter: { x: P.mug.x - 0.14, y: 1.62, z: -1.3, yawDeg: 0, label: "service aisle at the brewer, facing the mug" },
    ac: { x: P.ac.x + 0.75, y: 1.62, z: P.ac.z, yawDeg: 90, label: "under the AC, facing it" },
    radio: { x: P.radio.x, y: 1.62, z: -1.3, yawDeg: 0, label: "back bar at the radio, facing it" },
  };
}

const SOURCE_BUSES = ["ac", "fan", "radio", "coffee", "room"];
const TAPS = ["sum", "interior", ...SOURCE_BUSES, "outside", "sfx-coffee", "sfx-door"];

function decodeTap(b64) {
  const buf = Buffer.from(b64, "base64");
  const frames = buf.length / 4;
  const L = new Float64Array(frames), R = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    L[i] = buf.readInt16LE(i * 4) / 32768;
    R[i] = buf.readInt16LE(i * 4 + 2) / 32768;
  }
  return { L, R };
}

const lu = (v) => (Number.isFinite(v) ? v.toFixed(1) : "  —  ").padStart(6);

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
    // Rev 3 bed: −36 LUFS ≈ −38 dBFS RMS mid-aisle, −41 by the door, −36 at the radio.
    if (mix.rmsDb < -43 || mix.rmsDb > -33) issues.push(`mix RMS ${mix.rmsDb.toFixed(1)} dBFS outside -43..-33`);
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

/* ------------------------------------------------------------------ */
/* rev 3 modes: poses, calibration, scenarios                          */
/* ------------------------------------------------------------------ */

async function renderPose(page, pose, extra = {}) {
  const req = {
    seconds: extra.seconds ?? POSE_SECONDS,
    seed: SEED,
    listener: { x: pose.x, y: pose.y, z: pose.z, yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg ?? 0 },
    taps: TAPS,
    ...extra,
  };
  if (MASTER_DB !== null) req.masterDb = Number(MASTER_DB);
  const result = await page.evaluate((r) => window.__renderOffline(r), req);
  const mix = decodeTap(result.pcm16);
  const taps = Object.fromEntries(Object.entries(result.taps).map(([k, v]) => [k, decodeTap(v)]));
  return { ...result, mix, taps, pcm16: undefined, tapsRaw: undefined };
}

async function writeWav(file, pair, sampleRate) {
  const n = pair.L.length;
  const pcm = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pair.L[i])) * 32767), i * 4);
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pair.R[i])) * 32767), i * 4 + 2);
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, wavFromPcm16(pcm, sampleRate));
}

/** Task 1: the wired mix at six poses — LUFS per bus, centroid, L/R vs geometry, crest. */
async function runPoses(page, LAY) {
  const poses = makePoses(LAY);
  const names = POSES ?? Object.keys(poses);
  const report = {};
  const P = LAY.positions;
  const srcPos = { ac: P.ac, fan: P.fan, radio: P.radio, coffee: P.coffeeWarmer };
  console.log(`\nPOSES  (${POSE_SECONDS} s each, seed ${SEED}; LUFS = BS.1770-4 integrated; taps are post-panner pre-reverb)`);
  for (const name of names) {
    const pose = poses[name];
    if (!pose) throw new Error(`unknown pose ${name}; have ${Object.keys(poses).join(",")}`);
    const t0 = Date.now();
    const r = await renderPose(page, pose);
    const fs_ = r.sampleRate;
    const file = path.join(ROOT, OUTDIR, `${TAG}-pose-${name}.wav`);
    await writeWav(file, r.mix, fs_);
    const rows = [];
    const row = (label, pair, src) => {
      const lufs = loudness(pair.L, pair.R, fs_).integrated;
      const bc = balanceCrest(pair.L, pair.R);
      const rel = src ? relative(pose, src) : null;
      rows.push({ bus: label, lufs, centroid: centroid(pair.L, pair.R, fs_), ...bc, dist: rel?.dist, lateral: rel?.lateral });
    };
    row("mix", r.mix);
    row("sum", r.taps.sum);
    for (const b of SOURCE_BUSES) row(b, r.taps[b], srcPos[b]);
    row("outside", r.taps.outside);
    // Bed without the radio (what could mask its speech rhythm), by subtracting tapped power.
    report[name] = { pose, rows, renderMs: Date.now() - t0 };
    console.log(`\n  ${name.padEnd(8)} ${pose.label}  — x ${pose.x.toFixed(2)} y ${pose.y.toFixed(2)} z ${pose.z.toFixed(2)} yaw ${pose.yawDeg}°${pose.pitchDeg ? ` pitch ${pose.pitchDeg}°` : ""}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    console.log(`    ${"bus".padEnd(8)}  LUFS   RMS dBFS  peak dBFS  crest  centroid   R−L dB  expected   dist m`);
    for (const x of rows) {
      const exp = x.lateral === undefined ? "—" : `${side(x.lateral)} (${x.lateral >= 0 ? "+" : ""}${x.lateral.toFixed(2)})`;
      console.log(
        `    ${x.bus.padEnd(8)} ${lu(x.lufs)} ${fmt(x.rmsDb, 9)} ${fmt(x.peakDb, 10)} ${fmt(x.crestDb, 6)} ${fmt(x.centroid, 8, 0)} Hz ${fmt(x.balanceDb, 7)}  ${exp.padEnd(15)} ${x.dist === undefined ? "" : x.dist.toFixed(2)}`,
      );
    }
    console.log(`    -> ${path.relative(ROOT, file)}`);
  }
  return report;
}

/** Task 1b: each source alone at 1 m and along a distance sweep vs its inverse model. */
async function runCalib(page, LAY) {
  const P = LAY.positions;
  // Listener paths: fixed z (or x) where the player can stand, moving away from the source.
  const sweeps = [
    // AC is high on the −x end wall; walk away along the room at its z.
    { bus: "ac", src: P.ac, ref: 1, roll: 0.55, dists: [1.1, 1.5, 2, 4, 6, 10], place: (d) => ({ x: P.ac.x + Math.sqrt(Math.max(0, d * d - (P.ac.y - 1.62) ** 2)), y: 1.62, z: P.ac.z }) },
    // Radio on the back bar; walk along the service aisle (z −1.6).
    { bus: "radio", src: P.radio, ref: 1, roll: 0.55, dists: [1, 1.5, 2, 4, 6], place: (d) => ({ x: P.radio.x - Math.sqrt(Math.max(0, d * d - (P.radio.y - 1.62) ** 2 - (P.radio.z + 1.6) ** 2)), y: 1.62, z: -1.6 }) },
    // Fan hub overhead; walk away along the aisle at its z.
    { bus: "fan", src: P.fan, ref: 1, roll: 0.55, dists: [1, 1.5, 2, 4], place: (d) => ({ x: P.fan.x + Math.sqrt(Math.max(0, d * d - (P.fan.y - 1.62) ** 2)), y: 1.62, z: P.fan.z }) },
    // Warmer plate on the back bar; walk along the service aisle (z −1.6).
    { bus: "coffee", src: P.coffeeWarmer, ref: 0.7, roll: 1.4, dists: [1, 1.5, 2, 3], place: (d) => ({ x: P.coffeeWarmer.x - Math.sqrt(Math.max(0, d * d - (P.coffeeWarmer.y - 1.62) ** 2 - (P.coffeeWarmer.z + 1.6) ** 2)), y: 1.62, z: -1.6 }) },
  ];
  const report = {};
  console.log(`\nCALIBRATION  (solo bus taps, listener facing the source; predicted = PannerNode inverse model, refDistance/rolloff as attached)`);
  for (const sw of sweeps) {
    console.log(`\n  ${sw.bus}  at (${sw.src.x.toFixed(2)}, ${sw.src.y.toFixed(2)}, ${sw.src.z.toFixed(2)})  ref ${sw.ref} m  rolloff ${sw.roll}`);
    console.log(`    d(m)   listener (x, z)   yaw°    LUFS   RMS dBFS  Δ meas  Δ model  centroid`);
    const rows = [];
    let first = null;
    for (const d of sw.dists) {
      const pos = sw.place(d);
      const pose = { ...pos, yawDeg: yawTowardDeg(pos, sw.src) };
      const r = await renderPose(page, pose, { solo: [sw.bus] });
      const tap = r.taps[sw.bus];
      const lufs = loudness(tap.L, tap.R, r.sampleRate).integrated;
      const bc = balanceCrest(tap.L, tap.R);
      const actual = relative(pose, sw.src).dist;
      const model = 20 * Math.log10(inverseGain(actual, sw.ref, sw.roll));
      if (first === null) first = { lufs, model };
      const rowv = { d: actual, pos, yawDeg: pose.yawDeg, lufs, rmsDb: bc.rmsDb, dMeas: lufs - first.lufs, dModel: model - first.model, centroid: centroid(tap.L, tap.R, r.sampleRate) };
      rows.push(rowv);
      console.log(
        `    ${actual.toFixed(2).padStart(5)}  (${pos.x.toFixed(2).padStart(6)}, ${pos.z.toFixed(2).padStart(6)})  ${pose.yawDeg.toFixed(0).padStart(5)} ${lu(lufs)} ${fmt(bc.rmsDb, 9)} ${fmt(rowv.dMeas, 7)} ${fmt(rowv.dModel, 8)} ${fmt(rowv.centroid, 8, 0)} Hz`,
      );
    }
    report[sw.bus] = rows;
  }
  return report;
}

/** Leaf angle from DoorSwing.ts (mirrors page.ts doorLeafDeg for the analysis side). */
function doorLeafDeg(t, TL) {
  const ph = (a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const easeOutBack = (u, c1 = 0.6) => 1 + (c1 + 1) * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
  const easeInOutSine = (u) => -(Math.cos(Math.PI * u) - 1) / 2;
  const easeIn = (u) => u * u * u;
  if (t < 0 || t >= TL.end) return 0;
  if (t < TL.open[1]) return TL.openDeg * easeOutBack(ph(TL.open[0], TL.open[1]));
  if (t < TL.hold[1]) return TL.openDeg;
  if (t < TL.sweep[1]) return TL.openDeg - (TL.openDeg - TL.sweepToDeg) * easeInOutSine(ph(TL.sweep[0], TL.sweep[1]));
  if (t < TL.latch[1]) return TL.sweepToDeg * (1 - easeIn(ph(TL.latch[0], TL.latch[1])));
  return 0;
}

/** Task 2: the pour and the door with System 7's timelines. */
async function runScenario(page, LAY, which) {
  const poses = makePoses(LAY);
  const t0 = 1.0;
  const report = { scenario: which, t0 };
  if (which === "pour") {
    const pose = poses.counter;
    const r = await renderPose(page, pose, { scenario: "pour", t0, seconds: 8, tickHz: 50 });
    const fs_ = r.sampleRate;
    await writeWav(path.join(ROOT, OUTDIR, `${TAG}-pour.wav`), r.mix, fs_);
    const TL = LAY.pourTimeline;
    const tl = Object.fromEntries(r.timeline.map((e) => [e.name, e.t]));
    const sfx = r.taps["sfx-coffee"];
    const { env, hopS } = envDb(sfx.L, sfx.R, fs_);
    const at = (t) => Math.round(t / hopS);
    // Onset: first 5 ms block after the pour call whose level clears −60 dBFS (the clink has died by then).
    const pourCall = tl.pour;
    let onset = NaN;
    for (let i = at(pourCall - 0.02); i < env.length; i++) if (env[i] > -60) { onset = i * hopS; break; }
    let offset = NaN;
    for (let i = at(tl["clink-set"] - 0.05); i > at(onset); i--) if (env[i] > -60) { offset = (i + 1) * hopS; break; }
    // Where Pour.ts says the stream lands: lip 60 mm over the rim, mug floor 76 mm under it → free fall 136 mm.
    const fall = Math.sqrt((2 * (0.06 + 0.089 - 0.013)) / 9.81);
    const streamDur = TL.stream[1] - TL.stream[0];
    // Cavity sweep: peak frequency in the 600–2600 Hz band across the pour.
    const track = [];
    for (let u = 0.25; u < offset - onset - 0.2; u += 0.5) track.push({ t: u, hz: peakFreqAt(sfx.L, sfx.R, fs_, onset + u, 600, 2600) });
    const pourLufs = loudness(sfx.L, sfx.R, fs_, onset, offset).integrated;
    const mixPourLufs = loudness(r.mix.L, r.mix.R, fs_, onset, offset).integrated;
    const bedLufs = loudness(r.mix.L, r.mix.R, fs_, 0.2, t0 - 0.05).integrated;
    // Peak of the clink itself (sfx tap, pre-master) and of the mix in the same 200 ms.
    const clinkPeak = (t) => ({
      sfx: balanceCrest(sfx.L, sfx.R, Math.round(t * fs_), Math.round((t + 0.2) * fs_)).peakDb,
      mix: balanceCrest(r.mix.L, r.mix.R, Math.round(t * fs_), Math.round((t + 0.2) * fs_)).peakDb,
    });
    const clicks = clickScan(r.mix.L, r.mix.R, fs_);
    const clicksAround = [
      ["clink-lift", tl["clink-lift"]],
      ["pour start", onset],
      ["pour end", offset],
      ["clink-set", tl["clink-set"]],
    ].map(([name, t]) => ({ name, t, ...clickScan(r.mix.L, r.mix.R, fs_, Math.round((t - 0.05) * fs_), Math.round((t + 0.35) * fs_)) }));
    Object.assign(report, {
      pose,
      calls: tl,
      onset,
      onsetOffset: onset - pourCall,
      expectedLanding: fall,
      duration: offset - onset,
      requested: streamDur,
      track,
      pourLufs,
      mixPourLufs,
      bedLufs,
      clinkPeaks: { lift: clinkPeak(tl["clink-lift"]), set: clinkPeak(tl["clink-set"]) },
      clicks,
      clicksAround,
    });
    console.log(`\nPOUR  listener at the counter (${pose.x.toFixed(2)}, ${pose.z.toFixed(2)}, yaw ${pose.yawDeg}°); Pour.ts clock starts at t0 = ${t0} s`);
    console.log(`  calls: clink(lift) ${tl["clink-lift"].toFixed(3)}  pour(${streamDur} s) ${pourCall.toFixed(3)}  clink(set) ${tl["clink-set"].toFixed(3)}`);
    console.log(`  splash onset ${onset.toFixed(3)} s = pour() + ${((onset - pourCall) * 1000).toFixed(0)} ms   (stream reaches the mug at + ${(fall * 1000).toFixed(0)} ms free fall; Pour.ts ripples at +170 ms, fills from +120 ms)`);
    console.log(`  splash ends  ${offset.toFixed(3)} s → audible ${(offset - onset).toFixed(2)} s for a ${streamDur} s stream (tail rings ${((offset - onset - streamDur) * 1000).toFixed(0)} ms)`);
    console.log(`  cavity peak (600–2600 Hz): ${track.map((p) => `+${p.t.toFixed(2)}s ${p.hz.toFixed(0)} Hz`).join("  ")}`);
    const cp = report.clinkPeaks;
    console.log(`  loudness: pour bus ${lu(pourLufs)} LUFS   mix during pour ${lu(mixPourLufs)}   bed before ${lu(bedLufs)}`);
    console.log(`  clink peaks (200 ms window): lift ${fmt(cp.lift.mix, 6)} dBFS in the mix / ${fmt(cp.lift.sfx, 6)} on the sfx tap;  set ${fmt(cp.set.mix, 6)} / ${fmt(cp.set.sfx, 6)}`);
    console.log(`  discontinuities: max step ${clicks.maxStep.toFixed(4)} FS @ ${clicks.maxStepAt.toFixed(3)} s; max step/localRMS ${clicks.maxRatio.toFixed(1)} @ ${clicks.maxRatioAt.toFixed(3)} s`);
    for (const c of clicksAround) console.log(`    ${c.name.padEnd(11)} @ ${c.t.toFixed(3)} s  step ${c.maxStep.toFixed(4)} FS  step/local ${c.maxRatio.toFixed(1)}`);
  } else if (which === "door") {
    const pose = { ...poses.door, yawDeg: 180, label: "inside the door, facing the leaf" };
    const TL = LAY.doorTimeline;
    const seconds = 10.5;
    const r = await renderPose(page, pose, { scenario: "door", t0, seconds, tickHz: 50 });
    const fs_ = r.sampleRate;
    await writeWav(path.join(ROOT, OUTDIR, `${TAG}-door.wav`), r.mix, fs_);
    const tl = Object.fromEntries(r.timeline.map((e) => [e.name, e.t]));
    const tOpen = tl["door-open"];
    const outside = r.taps.outside, interior = r.taps.interior, sfx = r.taps["sfx-door"];
    const { env, hopS } = envDb(outside.L, outside.R, fs_, 0.05);
    const at = (t) => Math.round(t / hopS);
    const holdFrom = tOpen + 1.6, holdTo = tOpen + 5.0;
    const holdSlice = Array.from(env.slice(at(holdFrom), at(holdTo))).sort((a, b) => a - b);
    const holdDb = holdSlice[Math.floor(holdSlice.length / 2)];
    // Rise: first 50 ms block within 0.9 dB (≈ 90 % amplitude) of the hold level, and the
    // half-power (−3 dB) point. The bed itself breathes ±1.5 dB, so read these to ±50 ms.
    let t90 = NaN, t50 = NaN;
    for (let i = at(tOpen); i < at(holdTo); i++) if (env[i] >= holdDb - 0.9) { t90 = i * hopS; break; }
    for (let i = at(tOpen); i < at(holdTo); i++) if (env[i] >= holdDb - 3) { t50 = i * hopS; break; }
    // Leaf passes 30°.
    let t30 = NaN;
    for (let u = 0; u < TL.open[1]; u += 0.001) if (doorLeafDeg(u, TL) >= 30) { t30 = tOpen + u; break; }
    // Crossfade shape: outside envelope (relative to hold) at leaf fractions 0.25 / 0.5 / 0.75 of the opening.
    const shape = [0.25, 0.5, 0.75].map((a) => {
      let u = 0;
      while (u < TL.open[1] && doorLeafDeg(u, TL) / TL.openDeg < a) u += 0.001;
      const i = at(tOpen + u);
      return { a, tLeaf: u, relDb: env[i] - holdDb, equalPowerDb: 20 * Math.log10(Math.sin((Math.PI / 2) * a)), pow06Db: 20 * Math.log10(Math.pow(a, 0.6)) };
    });
    const holdPeak = balanceCrest(r.mix.L, r.mix.R, Math.round(holdFrom * fs_), Math.round(holdTo * fs_));
    const outsideLufs = loudness(outside.L, outside.R, fs_, holdFrom, holdTo).integrated;
    const mixHoldLufs = loudness(r.mix.L, r.mix.R, fs_, holdFrom, holdTo).integrated;
    const intBefore = loudness(interior.L, interior.R, fs_, 0.2, tOpen - 0.05).integrated;
    const intHold = loudness(interior.L, interior.R, fs_, holdFrom, holdTo).integrated;
    const tLatch = tOpen + TL.end;
    const intAfter = loudness(interior.L, interior.R, fs_, tLatch + 0.6, seconds - 0.1).integrated;
    const outAfter = loudness(outside.L, outside.R, fs_, tLatch + 0.6, seconds - 0.1).integrated;
    const mixBefore = loudness(r.mix.L, r.mix.R, fs_, 0.2, tOpen - 0.05).integrated;
    // Sweep: outside level while the closer sweeps (85° → 8°) and at 8° just before the latch.
    const sweepMid = env[at(tOpen + (TL.sweep[0] + TL.sweep[1]) / 2)];
    const at8 = env[at(tOpen + TL.latch[0] + 0.05)];
    // Door one-shots: peaks in the sfx-door tap around open and around latch.
    const peakIn = (pair, a, b) => balanceCrest(pair.L, pair.R, Math.round(a * fs_), Math.round(b * fs_)).peakDb;
    const openClick = peakIn(sfx, tOpen, tOpen + 0.05);
    const openMixPeak = peakIn(r.mix, tOpen, tOpen + 0.1);
    const latchClick = peakIn(sfx, tLatch - 0.05, tLatch + 0.4);
    const clicks = clickScan(r.mix.L, r.mix.R, fs_);
    const clicksAround = [
      ["open", tOpen],
      ["sweep start", tOpen + TL.sweep[0]],
      ["latch", tLatch],
    ].map(([name, t]) => ({ name, t, ...clickScan(r.mix.L, r.mix.R, fs_, Math.round((t - 0.05) * fs_), Math.round((t + 0.45) * fs_)) }));
    Object.assign(report, {
      pose, calls: tl, holdDb, holdPeakDb: holdPeak.peakDb, holdCrestDb: holdPeak.crestDb, t90, t50, t30, riseAfter30: t90 - t30, shape, outsideLufs, mixHoldLufs, mixBefore,
      interior: { before: intBefore, hold: intHold, after: intAfter, duckDb: intHold - intBefore, restoreDb: intAfter - intBefore },
      outsideAfterLufs: outAfter, sweepMidDb: sweepMid - holdDb, at8DegDb: at8 - holdDb, openClick, openMixPeak, latchClick, clicks, clicksAround,
    });
    console.log(`\nDOOR  listener inside the door facing the leaf (${pose.x.toFixed(2)}, ${pose.z.toFixed(2)}, yaw ${pose.yawDeg}°); DoorSwing clock starts at t0 = ${t0} s`);
    console.log(`  doorOpen() at ${tOpen.toFixed(3)} s; leaf 30° at +${((t30 - tOpen) * 1000).toFixed(0)} ms, 85° at +1100 ms; hold to +5100; sweep to 8° by +6900; latch +7150 ms`);
    console.log(`  heat wall: hold ${fmt(holdDb, 6)} dBFS (50 ms env median) = ${lu(outsideLufs)} LUFS on the outside bus; mix during hold ${lu(mixHoldLufs)} LUFS, peak ${fmt(holdPeak.peakDb, 6)} dBFS, crest ${fmt(holdPeak.crestDb, 5)} dB (was ${lu(mixBefore)} LUFS before the door)`);
    console.log(`  rise: half power (−3 dB) at +${((t50 - tOpen) * 1000).toFixed(0)} ms; within 0.9 dB of hold at +${((t90 - tOpen) * 1000).toFixed(0)} ms → ${((t90 - t30) * 1000).toFixed(0)} ms after the leaf passed 30° (±50 ms)`);
    console.log(`  crossfade shape (outside env rel. hold at leaf fraction a): ${shape.map((s) => `a=${s.a}: ${fmt(s.relDb, 5)} dB (equal-power ${fmt(s.equalPowerDb, 5)}, a^0.6 ${fmt(s.pow06Db, 5)})`).join(";  ")}`);
    console.log(`  interior bed: before ${lu(intBefore)}  while open ${lu(intHold)} (duck ${fmt(intHold - intBefore, 5)} dB)  after latch ${lu(intAfter)} (${fmt(intAfter - intBefore, 5)} dB vs before)`);
    console.log(`  closing: outside at mid-sweep ${fmt(sweepMid - holdDb, 5)} dB rel. hold, at 8° ${fmt(at8 - holdDb, 5)} dB; after latch ${lu(outAfter)} LUFS`);
    console.log(`  one-shots: open click peak ${fmt(openClick, 6)} dBFS (mix ${fmt(openMixPeak, 6)}); latch click peak ${fmt(latchClick, 6)} dBFS`);
    console.log(`  discontinuities: max step ${clicks.maxStep.toFixed(4)} FS @ ${clicks.maxStepAt.toFixed(3)} s; max step/localRMS ${clicks.maxRatio.toFixed(1)} @ ${clicks.maxRatioAt.toFixed(3)} s`);
    for (const c of clicksAround) console.log(`    ${c.name.padEnd(11)} @ ${c.t.toFixed(3)} s  step ${c.maxStep.toFixed(4)} FS  step/local ${c.maxRatio.toFixed(1)}`);
  } else {
    throw new Error(`unknown scenario ${which} (pour|door)`);
  }
  return report;
}

async function runRev3(page) {
  const LAY = await page.evaluate(() => window.__HARNESS_LAYOUT);
  const report = { tag: TAG, seed: SEED, when: new Date().toISOString() };
  if (POSES !== undefined) report.poses = await runPoses(page, LAY);
  if (CALIB) report.calib = await runCalib(page, LAY);
  if (SCENARIO) report[SCENARIO] = await runScenario(page, LAY, SCENARIO);
  const file = path.join(ROOT, OUTDIR, `${TAG}-report${SCENARIO ? `-${SCENARIO}` : ""}${CALIB ? "-calib" : ""}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(report, null, 1));
  console.log(`\n[audio] report -> ${path.relative(ROOT, file)}`);
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

  if (POSES !== undefined || CALIB || SCENARIO) {
    await runRev3(page);
    if (problems.length) console.error(`[audio] page problems (${problems.length}):\n    ${problems.slice(0, 8).join("\n    ")}`);
    console.log(`\n[audio] done in ${((Date.now() - tStart) / 1000).toFixed(1)} s`);
    const fatal = problems.filter((p) => p.startsWith("pageerror"));
    return shutdown(fatal.length ? 1 : 0, fatal.length ? fatal.join("; ") : null);
  }

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
