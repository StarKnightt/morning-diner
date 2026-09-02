/**
 * One-shots for pouring coffee (System 7 calls these).
 *
 * pourCoffee(seconds): liquid into ceramic. A 1–5 kHz splash bed with an
 * 8–15 Hz burble, plus the mug's cavity resonance (Q ≈ 10, ~+10 dB) sweeping
 * 800 Hz → 1.8 kHz as the air column shortens. Macro shape: the first splash
 * is ~3 dB louder and brighter, the stream settles 2 dB through the middle and
 * lifts 1 dB before the 300 ms taper; the last resonance rings down. A trace of
 * mug body at 150–400 Hz (≈ -60 dBFS), nothing else below 250 Hz — no thump.
 *
 * mugClink(): a tiny inharmonic ceramic ping over a 10 ms broadband contact
 * "thock" (300 Hz–2 kHz) so it reads as mug-on-saucer, not spoon-on-glass;
 * T20 ≈ 120 ms, ~-30 dBFS at arm's length.
 *
 * Near one-shots use equal-power panning (not HRTF): at arm's length the HRTF's
 * interaural delay decorrelates L/R and reads as phasey. Every call builds a
 * handful of nodes that stop and are garbage collected.
 */
import { AudioEngine, type SpatialHandle, type Vec3 } from "../AudioEngine";
import { dbToGain } from "../dsp";

export interface CoffeeSfxOptions {
  /** Splash bed RMS at 1 m during a pour, dBFS. */
  levelDb?: number;
  reverbDb?: number;
}

export class CoffeeSfx {
  readonly bus: GainNode;
  private readonly engine: AudioEngine;
  private position: Vec3;
  private readonly level: number;

  constructor(engine: AudioEngine, position: Vec3, opts: CoffeeSfxOptions = {}) {
    this.engine = engine;
    this.position = { ...position };
    // Splash bed after HP/LP is ≈ -20 dBFS; this trim lands it at levelDb.
    this.level = dbToGain((opts.levelDb ?? -39) + 20);
    this.bus = engine.createBus("sfx-coffee", opts.reverbDb ?? -14);
  }

  /** Where the mug is (call before a pour if it moved). */
  setPosition(p: Vec3): void {
    this.position = { ...p };
  }

  pourCoffee(durationSeconds = 3.0, at: Vec3 = this.position): void {
    const engine = this.engine;
    const ctx = engine.ctx;
    const rng = engine.rng;
    const t = engine.now + 0.02;
    const dur = Math.max(0.8, durationSeconds);
    const end = t + dur;
    engine.logEvent("sfx.pour", t, dur + 0.3);

    const out = ctx.createGain();
    out.gain.value = this.level;
    // Nothing below 250 Hz leaves a mug: two 2nd-order high-passes at 320 Hz.
    const hpA = ctx.createBiquadFilter();
    hpA.type = "highpass";
    hpA.frequency.value = 320;
    hpA.Q.value = 0.707;
    const hpB = ctx.createBiquadFilter();
    hpB.type = "highpass";
    hpB.frequency.value = 320;
    hpB.Q.value = 0.707;
    out.connect(hpA);
    hpA.connect(hpB);
    const pre = ctx.createGain();
    hpB.connect(pre);
    const spatial = engine.attach(pre, at, this.bus, { model: "equalpower" });

    const noise = engine.noiseSource("white", 1, t);

    // ---- splash bed: 1–5 kHz ----------------------------------------------------------------
    const bedHp = ctx.createBiquadFilter();
    bedHp.type = "highpass";
    // As the mug fills the splash loses its low end: 900 Hz → 1.5 kHz.
    bedHp.frequency.setValueAtTime(900, t);
    bedHp.frequency.linearRampToValueAtTime(1500, end);
    bedHp.Q.value = 0.707;
    // Brighter first splash: 7 kHz → 4.8 kHz over the first half second.
    const bedLp = ctx.createBiquadFilter();
    bedLp.type = "lowpass";
    bedLp.frequency.setValueAtTime(7000, t);
    bedLp.frequency.linearRampToValueAtTime(4800, t + 0.5);
    bedLp.Q.value = 0.707;
    const bed = ctx.createGain();
    bed.gain.value = 1;
    noise.connect(bedHp);
    bedHp.connect(bedLp);
    bedLp.connect(bed);

    // ---- cavity resonance: 800 Hz → 1.8 kHz over the pour, Q 10, ≈ +10 dB -----------------------
    const cavity = ctx.createBiquadFilter();
    cavity.type = "bandpass";
    cavity.Q.value = 10;
    const fStart = 800 * rng.range(0.95, 1.05);
    const fEnd = 1800 * rng.range(0.95, 1.05);
    cavity.frequency.setValueAtTime(fStart, t);
    cavity.frequency.exponentialRampToValueAtTime(fEnd, end);
    const cavityGain = ctx.createGain();
    cavityGain.gain.value = 1.6;
    noise.connect(cavity);
    cavity.connect(cavityGain);

    // ---- envelope + burble ---------------------------------------------------------------------
    const env = ctx.createGain();
    const g = env.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(1.45, t + 0.06); // first splash: +3 dB
    g.setValueAtTime(1.45, t + 0.4);
    g.linearRampToValueAtTime(0.8, t + 1.0); // stream settles: -2 dB
    g.setValueAtTime(0.8, Math.max(t + 1.0, end - 0.5));
    g.linearRampToValueAtTime(0.95, end - 0.3); // lifts ~1.5 dB as the mug nears full
    g.linearRampToValueAtTime(0, end); // 300 ms taper
    const burble = ctx.createOscillator();
    burble.frequency.value = rng.range(8, 15);
    const burbleDepth = ctx.createGain();
    burbleDepth.gain.value = 0.3;
    burble.connect(burbleDepth);
    burbleDepth.connect(env.gain);
    // A second, slower irregularity so the burble isn't a metronome.
    const burble2 = ctx.createOscillator();
    burble2.frequency.value = rng.range(2.5, 4.5);
    const burble2Depth = ctx.createGain();
    burble2Depth.gain.value = 0.12;
    burble2.connect(burble2Depth);
    burble2Depth.connect(env.gain);
    burble.start(t);
    burble2.start(t);
    bed.connect(env);
    env.connect(out);

    // The cavity is also gated, but it rings ~250 ms after the stream stops.
    const ring = ctx.createGain();
    const rg = ring.gain;
    rg.setValueAtTime(0, t);
    rg.linearRampToValueAtTime(1, t + 0.1);
    rg.setValueAtTime(1, end - 0.1);
    rg.setTargetAtTime(0, end - 0.1, 0.09);
    cavityGain.connect(ring);
    ring.connect(out);

    // Mug body: the ceramic hums a little at 150–400 Hz, bypassing the high-pass.
    const bodySrc = engine.noiseSource("pink", 1, t);
    const body = ctx.createBiquadFilter();
    body.type = "bandpass";
    body.frequency.value = 260;
    body.Q.value = 1.0;
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0;
    bodyGain.gain.setValueAtTime(0, t);
    bodyGain.gain.linearRampToValueAtTime(0.019, t + 0.15);
    bodyGain.gain.setValueAtTime(0.019, end - 0.3);
    bodyGain.gain.linearRampToValueAtTime(0, end);
    bodySrc.connect(body);
    body.connect(bodyGain);
    bodyGain.connect(pre);

    const stopAt = end + 0.8;
    noise.stop(stopAt);
    bodySrc.stop(stopAt);
    burble.stop(stopAt);
    burble2.stop(stopAt);
    scheduleCleanup(noise, stopAt, spatial, engine);
  }

  mugClink(at: Vec3 = this.position): void {
    const engine = this.engine;
    const ctx = engine.ctx;
    const rng = engine.rng;
    const t = engine.now + 0.01;
    engine.logEvent("sfx.clink", t, 0.12);
    const out = ctx.createGain();
    // Ring ≈ -36 dBFS peak, thock ≈ -43, contact tick ≈ -33: the clink lands ≈ -32 dBFS.
    out.gain.value = dbToGain(-20);
    const spatial = engine.attach(out, at, this.bus, { model: "equalpower" });

    // Ceramic: a few inharmonic partials, the higher ones dying first.
    const base = rng.range(2500, 3300);
    const partials = [1, 1.51, 2.32, 3.06];
    // τ/4 below: fundamental τ ≈ 33 ms → T20 ≈ 75 ms dry, ≈ 120 ms with the room.
    const decays = [0.13, 0.09, 0.06, 0.04];
    const amps = [0.65, 0.4, 0.25, 0.12];
    let last: OscillatorNode | null = null;
    partials.forEach((ratio, i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = base * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.25 * amps[i], t + 0.0015);
      g.gain.setTargetAtTime(0, t + 0.002, decays[i] / 4);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + 0.5);
      last = o;
    });
    // Contact: a 5 ms high tick plus a ~10 ms broadband "thock" (300 Hz–2 kHz) —
    // the body of the mug meeting the saucer, under the ring.
    const tick = engine.noiseSource("white", 1, t);
    const tickHp = ctx.createBiquadFilter();
    tickHp.type = "highpass";
    tickHp.frequency.value = 3000;
    const tickGain = ctx.createGain();
    tickGain.gain.setValueAtTime(0.18, t);
    tickGain.gain.setTargetAtTime(0, t + 0.002, 0.003);
    tick.connect(tickHp);
    tickHp.connect(tickGain);
    tickGain.connect(out);
    const thockBp = ctx.createBiquadFilter();
    thockBp.type = "bandpass";
    thockBp.frequency.value = 800;
    thockBp.Q.value = 0.55;
    const thock = ctx.createGain();
    thock.gain.setValueAtTime(0, t);
    thock.gain.linearRampToValueAtTime(0.9, t + 0.0012);
    thock.gain.setValueAtTime(0.9, t + 0.004);
    thock.gain.setTargetAtTime(0, t + 0.004, 0.0035);
    tick.connect(thockBp);
    thockBp.connect(thock);
    thock.connect(out);
    tick.stop(t + 0.1);
    if (last) scheduleCleanup(last, t + 0.5, spatial, engine);
  }
}

/** Disconnect the transient panner once the last source has ended. */
export function scheduleCleanup(
  last: AudioScheduledSourceNode,
  stopAt: number,
  spatial: SpatialHandle,
  engine: AudioEngine,
): void {
  // `disconnect` is idempotent. The timer is a belt for the `ended` braces: in
  // an OfflineAudioContext neither may fire before rendering finishes, and the
  // whole graph is discarded with the context anyway.
  const wait = Math.max(0, stopAt - engine.now) * 1000 + 250;
  last.addEventListener("ended", () => spatial.disconnect(), { once: true });
  setTimeout(() => spatial.disconnect(), wait + 500);
}
