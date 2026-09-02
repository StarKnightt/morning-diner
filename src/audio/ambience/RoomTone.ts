/**
 * The silence. Two things:
 *
 * 1. A near-inaudible noise floor (~-55 dBFS): brown/pink noise, decorrelated
 *    left/right, not spatialised — it's the room's own hush and the ear's.
 * 2. Room air: the hiss of a large quiet room — 4–16 kHz noise, partially
 *    correlated left/right (≈0.3), drifting 0.1–0.3 Hz. Without it the bed
 *    ends at 5 kHz and reads as a closed box.
 * 3. The outside pressing on the glass: a very sparse, very quiet insect
 *    shimmer in the 5–8 kHz band, amplitude-modulated at a cicada-ish 40–70 Hz
 *    buzz inside slow swells that come and go every 10–30 s. It is emitted at
 *    the windows and the door so it gets louder as you approach the glass.
 */
import { AudioEngine, type Vec3 } from "../AudioEngine";
import { dbToGain } from "../dsp";
import { AmbientLayer } from "../Layer";

export interface RoomToneOptions {
  /** Noise floor, dBFS RMS. */
  floorDb?: number;
  /** Shimmer at 1 m from a window during a swell, dBFS RMS. */
  shimmerDb?: number;
  /** Room air (4–16 kHz hiss), dBFS RMS. */
  airDb?: number;
  /** Where the outside leaks in (window centres, the door). */
  openings: Vec3[];
}

export class RoomTone extends AmbientLayer {
  private readonly swellGain: GainNode;
  private readonly buzz: OscillatorNode;

  constructor(engine: AudioEngine, opts: RoomToneOptions) {
    super(engine, "room", -Infinity);
    const ctx = engine.ctx;
    const t0 = engine.now;

    // ---- floor ------------------------------------------------------------------
    const floorGain = ctx.createGain();
    // Rev 3 live-mix calibration: floor −47 / air −49 ⇒ ≈ −44 LUFS (was −55 / −56 ⇒ −52; the
    // brief's "silence" is ≈ −45, and the bed the spatial sources sit on has to be audible as a room).
    const floorDb = opts.floorDb ?? -47;
    floorGain.gain.value = dbToGain(floorDb) / 0.25; // buffers are -12 dBFS RMS
    const merger = ctx.createChannelMerger(2);
    for (let ch = 0; ch < 2; ch++) {
      const brown = engine.noiseSource("brown", ch === 0 ? 1 : 0.94, t0);
      const pink = engine.noiseSource("pink", ch === 0 ? 1.06 : 1, t0);
      const pinkGain = ctx.createGain();
      pinkGain.gain.value = 0.35;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2400;
      lp.Q.value = 0.4;
      brown.connect(lp);
      pink.connect(pinkGain);
      pinkGain.connect(lp);
      lp.connect(merger, 0, ch);
    }
    merger.connect(floorGain);
    floorGain.connect(this.bus);
    this.wander(floorGain.gain, {
      min: (dbToGain(floorDb) / 0.25) * 0.8,
      max: (dbToGain(floorDb) / 0.25) * 1.2,
      minHold: 10,
      maxHold: 30,
      tau: 8,
    });

    // ---- room air: 4–16 kHz, L/R correlation ≈ 0.3 -----------------------------------
    // L = c·common + s·own, R = c·common + s·own' with c² = 0.65 (the other
    // decorrelated HF sources pull the band's total correlation down to ≈ 0.3).
    const airBase = dbToGain(opts.airDb ?? -49) / 0.25;
    const airLevel = ctx.createGain();
    airLevel.gain.value = airBase;
    const airMerger = ctx.createChannelMerger(2);
    const common = engine.noiseSource("white", 1.03, t0);
    for (let ch = 0; ch < 2; ch++) {
      const own = engine.noiseSource("white", ch === 0 ? 0.97 : 1.09, t0);
      const mixIn = ctx.createGain();
      const cg = ctx.createGain();
      cg.gain.value = Math.sqrt(0.65);
      const sg = ctx.createGain();
      sg.gain.value = Math.sqrt(0.35);
      common.connect(cg);
      own.connect(sg);
      cg.connect(mixIn);
      sg.connect(mixIn);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 3800;
      hp.Q.value = 0.6;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 9500;
      lp.Q.value = 0.5;
      mixIn.connect(hp);
      hp.connect(lp);
      lp.connect(airMerger, 0, ch);
    }
    airMerger.connect(airLevel);
    airLevel.connect(this.bus);
    // 0.1–0.3 Hz drift: a slow sine ±1 dB plus a random wander.
    const airLfo = ctx.createOscillator();
    airLfo.frequency.value = 0.17;
    const airLfoDepth = ctx.createGain();
    airLfoDepth.gain.value = airBase * 0.12;
    airLfo.connect(airLfoDepth);
    airLfoDepth.connect(airLevel.gain);
    airLfo.start(t0);
    this.wander(airLevel.gain, { min: airBase * 0.8, max: airBase * 1.2, minHold: 4, maxHold: 9, tau: 3 });

    // ---- outside: insect shimmer at the glass ------------------------------------------
    const noise = engine.noiseSource("white", 1.02, t0);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 6400;
    bp.Q.value = 2.2;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = "bandpass";
    bp2.frequency.value = 6400;
    bp2.Q.value = 1.6;
    noise.connect(bp);
    bp.connect(bp2);
    this.wander(bp.frequency, { min: 5200, max: 7800, minHold: 3, maxHold: 9, tau: 2 });
    this.wander(bp2.frequency, { min: 5400, max: 7600, minHold: 4, maxHold: 11, tau: 2.5 });

    // Cicada buzz: the shimmer is chopped at 40–70 Hz (depth ~70 %).
    const buzzed = ctx.createGain();
    buzzed.gain.value = 0.35;
    this.buzz = ctx.createOscillator();
    this.buzz.type = "sine";
    this.buzz.frequency.value = 52;
    const buzzDepth = ctx.createGain();
    buzzDepth.gain.value = 0.3;
    this.buzz.connect(buzzDepth);
    buzzDepth.connect(buzzed.gain);
    this.buzz.start(t0);
    bp2.connect(buzzed);
    this.wander(this.buzz.frequency, { min: 40, max: 70, minHold: 2, maxHold: 6, tau: 1.5 });

    // Slow swells, mostly off. Level is the swell envelope; a faint bed remains between.
    this.swellGain = ctx.createGain();
    this.swellGain.gain.value = 0.06;
    buzzed.connect(this.swellGain);
    this.every(10, 30, (t) => this.scheduleSwell(t), 4);

    const shimmerLevel = ctx.createGain();
    shimmerLevel.gain.value = dbToGain(opts.shimmerDb ?? -44);
    this.swellGain.connect(shimmerLevel);

    // Emit from every opening. One generator, several panners: the outside is one
    // sound, heard through several panes.
    for (const p of opts.openings) {
      const tap = ctx.createGain();
      tap.gain.value = 1 / Math.sqrt(opts.openings.length);
      shimmerLevel.connect(tap);
      const h = engine.attach(tap, p, this.bus);
      // Windows are a wall, not a point: gentler distance falloff than the point sources.
      h.panner.rolloffFactor = 0.6;
      h.panner.refDistance = 1.2;
    }
  }

  private scheduleSwell(t: number): void {
    const rng = this.rng;
    const g = this.swellGain.gain;
    const dur = rng.range(3, 8);
    const peak = rng.range(0.5, 1.0);
    // Rise over a third of the swell, hang, fall over the rest: heat, not an event.
    g.setTargetAtTime(peak, t, dur * 0.18);
    g.setTargetAtTime(peak * 0.7, t + dur * 0.45, dur * 0.12);
    g.setTargetAtTime(0.06, t + dur * 0.6, dur * 0.16);
  }
}
