/**
 * Ceiling fan on low: a slow, rounded whoosh overhead.
 *
 * Pink noise, low-passed, with both level and filter cutoff modulated at the
 * blade-pass rate (rev/s × blades). The modulator is a sine, not a pulse, so
 * it breathes rather than chops, and its depth and the fan's rate drift very
 * slightly so it never sounds mechanical. Underneath, a tiny 120 Hz motor hum.
 */
import { AudioEngine, type Vec3 } from "../AudioEngine";
import { dbToGain } from "../dsp";
import { AmbientLayer } from "../Layer";

export interface CeilingFanOptions {
  rpm?: number;
  blades?: number;
  /** Level at 1 m, dBFS RMS. */
  levelDb?: number;
  reverbDb?: number;
}

/** Measured with the harness: internal RMS is this far below the `out` gain at 1 m. */
const CAL_DB = 17;

export class CeilingFan extends AmbientLayer {
  constructor(engine: AudioEngine, position: Vec3, opts: CeilingFanOptions = {}) {
    super(engine, "fan", opts.reverbDb ?? -10);
    const ctx = engine.ctx;
    const t0 = engine.now;
    const rpm = opts.rpm ?? 40;
    const blades = opts.blades ?? 4;
    const bladePass = (rpm / 60) * blades;

    const out = ctx.createGain();
    out.gain.value = dbToGain((opts.levelDb ?? -34.5) + CAL_DB);

    // ---- whoosh -----------------------------------------------------------
    const noise = engine.noiseSource("pink", 0.93, t0);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    lp.Q.value = 0.5;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 160;
    hp.Q.value = 0.6;
    const whoosh = ctx.createGain();
    whoosh.gain.value = 0.7;
    noise.connect(hp);
    hp.connect(lp);
    lp.connect(whoosh);

    // Blade-pass modulator: sine into level (±30 %) and cutoff (±350 Hz), with a
    // 90° offset between them so the brightening leads the loudness a touch.
    const mod = ctx.createOscillator();
    mod.type = "sine";
    mod.frequency.value = bladePass;
    const modGain = ctx.createGain();
    modGain.gain.value = 0.3;
    mod.connect(modGain);
    modGain.connect(whoosh.gain);
    const modCut = ctx.createOscillator();
    modCut.type = "sine";
    modCut.frequency.value = bladePass;
    const modCutGain = ctx.createGain();
    modCutGain.gain.value = 350;
    modCut.connect(modCutGain);
    modCutGain.connect(lp.frequency);
    mod.start(t0);
    modCut.start(t0 + 0.25 / bladePass);
    // The fan hunts a little: rate ±1.5 %, depth wanders. Never a metronome.
    this.wander(mod.frequency, { min: bladePass * 0.985, max: bladePass * 1.015, minHold: 6, maxHold: 15, tau: 5 });
    this.wander(modCut.frequency, { min: bladePass * 0.985, max: bladePass * 1.015, minHold: 6, maxHold: 15, tau: 5 });
    this.wander(modGain.gain, { min: 0.22, max: 0.36, minHold: 8, maxHold: 20, tau: 4 });
    this.wander(whoosh.gain, { min: 0.6, max: 0.8, minHold: 10, maxHold: 30, tau: 6 });
    whoosh.connect(out);

    // ---- motor ------------------------------------------------------------
    const motor = ctx.createOscillator();
    motor.type = "sine";
    motor.frequency.value = 120.5;
    const motor2 = ctx.createOscillator();
    motor2.type = "sine";
    motor2.frequency.value = 241.5;
    const motorGain = ctx.createGain();
    motorGain.gain.value = 0.04;
    const motor2Gain = ctx.createGain();
    motor2Gain.gain.value = 0.012;
    motor.connect(motorGain);
    motor2.connect(motor2Gain);
    motorGain.connect(out);
    motor2Gain.connect(out);
    motor.start(t0);
    motor2.start(t0);

    engine.attach(out, position, this.bus);
  }
}
