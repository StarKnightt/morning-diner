/**
 * One-shots for pouring coffee (System 7 calls these).
 *
 * pourCoffee(seconds): liquid into ceramic. Band-passed noise whose resonance
 * climbs 400 → 1400 Hz as the mug fills (a shorter air column rings higher),
 * with a burbling 6–11 Hz modulation, a soft "glug" as the pot tips, and a
 * decaying ring when the stream stops.
 *
 * mugClink(): a tiny inharmonic ceramic ping, 150 ms.
 *
 * Every call builds a handful of nodes that stop and are garbage collected.
 */
import { AudioEngine, type SpatialHandle, type Vec3 } from "../AudioEngine";
import { dbToGain } from "../dsp";

export interface CoffeeSfxOptions {
  /** Peak of a pour at 1 m, dBFS. */
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
    this.level = dbToGain(opts.levelDb ?? -12);
    this.bus = engine.createBus("sfx-coffee", opts.reverbDb ?? -12);
  }

  /** Where the mug is (call before a pour if it moved). */
  setPosition(p: Vec3): void {
    this.position = { ...p };
  }

  pourCoffee(durationSeconds = 3.5, at: Vec3 = this.position): void {
    const engine = this.engine;
    const ctx = engine.ctx;
    const rng = engine.rng;
    const t = engine.now + 0.02;
    const dur = Math.max(0.6, durationSeconds);
    const end = t + dur;
    const out = ctx.createGain();
    out.gain.value = this.level;
    const spatial = engine.attach(out, at, this.bus);

    // ---- stream: noise through a resonance that rises as the mug fills ----------------
    const noise = engine.noiseSource("white", 1, t);
    const body = ctx.createBiquadFilter();
    body.type = "bandpass";
    body.frequency.setValueAtTime(400, t);
    body.frequency.exponentialRampToValueAtTime(1400, end);
    body.Q.value = 3.5;
    const splash = ctx.createBiquadFilter();
    splash.type = "bandpass";
    splash.frequency.value = 3200;
    splash.Q.value = 0.8;
    const splashGain = ctx.createGain();
    splashGain.gain.value = 0.25;
    const stream = ctx.createGain();
    stream.gain.setValueAtTime(0, t);
    stream.gain.linearRampToValueAtTime(0.9, t + 0.12);
    stream.gain.setValueAtTime(0.9, end - 0.15);
    stream.gain.linearRampToValueAtTime(0, end + 0.02);
    noise.connect(body);
    noise.connect(splash);
    splash.connect(splashGain);
    body.connect(stream);
    splashGain.connect(stream);

    // Burble: irregular AM. Two LFOs at non-related rates beat against each other.
    const lfo1 = ctx.createOscillator();
    lfo1.frequency.value = rng.range(6, 8);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = rng.range(9, 11.5);
    const lfoDepth1 = ctx.createGain();
    lfoDepth1.gain.value = 0.25;
    const lfoDepth2 = ctx.createGain();
    lfoDepth2.gain.value = 0.15;
    lfo1.connect(lfoDepth1);
    lfo2.connect(lfoDepth2);
    lfoDepth1.connect(stream.gain);
    lfoDepth2.connect(stream.gain);
    lfo1.start(t);
    lfo2.start(t);
    stream.connect(out);

    // ---- glug: the pot tips and air gets back in ---------------------------------------------
    const glug = ctx.createOscillator();
    glug.type = "sine";
    glug.frequency.setValueAtTime(190, t);
    glug.frequency.exponentialRampToValueAtTime(85, t + 0.14);
    const glugGain = ctx.createGain();
    glugGain.gain.setValueAtTime(0, t);
    glugGain.gain.linearRampToValueAtTime(0.5, t + 0.02);
    glugGain.gain.setTargetAtTime(0, t + 0.06, 0.05);
    glug.connect(glugGain);
    glugGain.connect(out);
    glug.start(t);
    glug.stop(t + 0.4);
    // A second, smaller glug partway through on longer pours.
    if (dur > 2) {
      const t2 = t + dur * rng.range(0.35, 0.6);
      const g2 = ctx.createOscillator();
      g2.type = "sine";
      g2.frequency.setValueAtTime(160, t2);
      g2.frequency.exponentialRampToValueAtTime(95, t2 + 0.1);
      const g2Gain = ctx.createGain();
      g2Gain.gain.setValueAtTime(0, t2);
      g2Gain.gain.linearRampToValueAtTime(0.28, t2 + 0.015);
      g2Gain.gain.setTargetAtTime(0, t2 + 0.04, 0.04);
      g2.connect(g2Gain);
      g2Gain.connect(out);
      g2.start(t2);
      g2.stop(t2 + 0.3);
    }

    // ---- tail: the full mug rings as the last drops land ------------------------------------
    const ring = ctx.createBiquadFilter();
    ring.type = "bandpass";
    ring.frequency.value = 1400 * rng.range(0.95, 1.05);
    ring.Q.value = 18;
    const ringGain = ctx.createGain();
    ringGain.gain.setValueAtTime(0, end - 0.05);
    ringGain.gain.linearRampToValueAtTime(0.6, end);
    ringGain.gain.setTargetAtTime(0, end + 0.02, 0.18);
    noise.connect(ring);
    ring.connect(ringGain);
    ringGain.connect(out);

    const stopAt = end + 1.2;
    noise.stop(stopAt);
    lfo1.stop(stopAt);
    lfo2.stop(stopAt);
    scheduleCleanup(noise, stopAt, spatial, engine);
  }

  mugClink(at: Vec3 = this.position): void {
    const engine = this.engine;
    const ctx = engine.ctx;
    const rng = engine.rng;
    const t = engine.now + 0.01;
    const out = ctx.createGain();
    out.gain.value = this.level * 0.7;
    const spatial = engine.attach(out, at, this.bus);

    // Ceramic: a few inharmonic partials, the higher ones dying first.
    const base = rng.range(2500, 3300);
    const partials = [1, 1.51, 2.32, 3.06];
    const decays = [0.16, 0.09, 0.06, 0.04];
    const amps = [1, 0.5, 0.3, 0.15];
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
    // Contact noise: a 5 ms tick.
    const tick = engine.noiseSource("white", 1, t);
    const tickHp = ctx.createBiquadFilter();
    tickHp.type = "highpass";
    tickHp.frequency.value = 3000;
    const tickGain = ctx.createGain();
    tickGain.gain.setValueAtTime(0.35, t);
    tickGain.gain.setTargetAtTime(0, t + 0.002, 0.003);
    tick.connect(tickHp);
    tickHp.connect(tickGain);
    tickGain.connect(out);
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
