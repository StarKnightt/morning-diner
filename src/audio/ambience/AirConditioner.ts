/**
 * Old window air-conditioner working hard against a Southwest morning.
 *
 * Three parts: the compressor's electrical drone (60 Hz + 120 Hz with a slow
 * 0.3 Hz load wobble), the broadband fan/compressor noise band-passed to
 * 200–900 Hz whose level drifts over tens of seconds, and an occasional soft
 * rattle from a loose grille — a short cluster of filtered noise ticks every
 * 6–20 s. This is the loudest thing in the room and it should still read as
 * background.
 */
import { AudioEngine, type Vec3 } from "../AudioEngine";
import { dbToGain } from "../dsp";
import { AmbientLayer } from "../Layer";

export interface AirConditionerOptions {
  /** Level of the drone+noise at 1 m, dBFS RMS. */
  levelDb?: number;
  reverbDb?: number;
}

/** Measured with the harness: internal RMS is this far below the `out` gain at 1 m. */
const CAL_DB = 11;

export class AirConditioner extends AmbientLayer {
  private readonly rattleGain: GainNode;
  private readonly rattleFilter: BiquadFilterNode;

  constructor(engine: AudioEngine, position: Vec3, opts: AirConditionerOptions = {}) {
    super(engine, "ac", opts.reverbDb ?? -12);
    const ctx = engine.ctx;
    const t0 = engine.now;
    const out = ctx.createGain();
    out.gain.value = dbToGain((opts.levelDb ?? -27) + CAL_DB);

    // ---- drone ----------------------------------------------------------
    const hum = ctx.createOscillator();
    hum.type = "sine";
    hum.frequency.value = 59.7;
    const hum2 = ctx.createOscillator();
    hum2.type = "triangle"; // a little harmonic bite on the 120
    hum2.frequency.value = 119.4;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.26;
    const hum2Gain = ctx.createGain();
    hum2Gain.gain.value = 0.12;
    hum.connect(humGain);
    hum2.connect(hum2Gain);
    const drone = ctx.createGain();
    drone.gain.value = 1;
    humGain.connect(drone);
    hum2Gain.connect(drone);
    // 0.3 Hz load wobble (±22 %), itself slightly irregular via a second LFO on its rate.
    const wobble = ctx.createOscillator();
    wobble.type = "sine";
    wobble.frequency.value = 0.31;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 0.22;
    wobble.connect(wobbleDepth);
    wobbleDepth.connect(drone.gain);
    const wobbleRate = ctx.createOscillator();
    wobbleRate.frequency.value = 0.047;
    const wobbleRateDepth = ctx.createGain();
    wobbleRateDepth.gain.value = 0.05;
    wobbleRate.connect(wobbleRateDepth);
    wobbleRateDepth.connect(wobble.frequency);
    hum.start(t0);
    hum2.start(t0);
    wobble.start(t0);
    wobbleRate.start(t0);
    // The drone shouldn't be perfectly steady: compressor load shifts.
    this.wander(humGain.gain, { min: 0.2, max: 0.32, minHold: 8, maxHold: 25, tau: 4 });
    drone.connect(out);

    // ---- fan / compressor noise --------------------------------------------
    const noise = engine.noiseSource("pink", 1, t0);
    const bp1 = ctx.createBiquadFilter();
    bp1.type = "bandpass";
    bp1.frequency.value = 330;
    bp1.Q.value = 0.8;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = "bandpass";
    bp2.frequency.value = 700;
    bp2.Q.value = 1.1;
    const bp2Gain = ctx.createGain();
    bp2Gain.gain.value = 0.55;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 1.6;
    noise.connect(bp1);
    noise.connect(bp2);
    bp1.connect(noiseGain);
    bp2.connect(bp2Gain);
    bp2Gain.connect(noiseGain);
    // Slow drift in level and in the fan's spectral centre — the sound of a unit
    // cycling between "trying" and "coping".
    this.wander(noiseGain.gain, { min: 1.25, max: 1.95, minHold: 5, maxHold: 16, tau: 3 });
    this.wander(bp2.frequency, { min: 600, max: 860, minHold: 7, maxHold: 20, tau: 4 });
    // A gentle 0.9 Hz breathing (belt slap / fan imbalance) at low depth.
    const breathe = ctx.createOscillator();
    breathe.frequency.value = 0.9;
    const breatheDepth = ctx.createGain();
    breatheDepth.gain.value = 0.12;
    breathe.connect(breatheDepth);
    breatheDepth.connect(noiseGain.gain);
    breathe.start(t0);
    noiseGain.connect(out);

    // ---- rattle -----------------------------------------------------------
    const rattleSrc = engine.noiseSource("white", 1.03, t0);
    this.rattleFilter = ctx.createBiquadFilter();
    this.rattleFilter.type = "bandpass";
    this.rattleFilter.frequency.value = 2200;
    this.rattleFilter.Q.value = 5;
    this.rattleGain = ctx.createGain();
    this.rattleGain.gain.value = 0;
    rattleSrc.connect(this.rattleFilter);
    this.rattleFilter.connect(this.rattleGain);
    this.rattleGain.connect(out);
    this.every(6, 20, (t) => this.scheduleRattle(t), 2);

    engine.attach(out, position, this.bus);
  }

  private scheduleRattle(t: number): void {
    const rng = this.rng;
    const ticks = 3 + Math.floor(rng.range(0, 6));
    const f = rng.range(1700, 3000);
    this.rattleFilter.frequency.setValueAtTime(f, t);
    let time = t;
    const g = this.rattleGain.gain;
    // Decaying cluster of very short ticks, spacing ~30–60 ms (a loose grille buzzing against the frame).
    for (let i = 0; i < ticks; i++) {
      const peak = 0.35 * (1 - i / (ticks + 1)) * rng.range(0.6, 1);
      g.setValueAtTime(0, time);
      g.linearRampToValueAtTime(peak, time + 0.002);
      g.setTargetAtTime(0, time + 0.003, 0.006);
      time += rng.range(0.028, 0.06);
    }
  }
}
