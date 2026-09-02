/**
 * The silence. Two things:
 *
 * 1. A near-inaudible noise floor (~-55 dBFS): brown/pink noise, decorrelated
 *    left/right, not spatialised — it's the room's own hush and the ear's.
 * 2. The outside pressing on the glass: a very sparse, very quiet insect
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
    floorGain.gain.value = dbToGain(opts.floorDb ?? -55) / 0.25; // buffers are -12 dBFS RMS
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
      min: (dbToGain(opts.floorDb ?? -55) / 0.25) * 0.8,
      max: (dbToGain(opts.floorDb ?? -55) / 0.25) * 1.2,
      minHold: 10,
      maxHold: 30,
      tau: 8,
    });

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
