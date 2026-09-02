/**
 * Ceiling fan on low: a slow, rounded whoosh overhead.
 *
 * Pink noise confined to 200 Hz–1 kHz (24 dB/oct each side, so the AC's drone
 * below 150 Hz, the radio's speech band and the room air above 2 kHz are untouched), with level and a
 * little cutoff modulated at the blade-pass rate (rev/s × blades). The
 * modulator is a sine, not a pulse — m ≈ 0.27, 4–5 dB peak-to-peak — so it breathes
 * rather than chops, and the rate wanders ±3 % over 5–10 s so it never sounds
 * mechanical. Underneath, a tiny unmodulated 120 Hz motor hum.
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
const CAL_DB = 14;

export class CeilingFan extends AmbientLayer {
  constructor(engine: AudioEngine, position: Vec3, opts: CeilingFanOptions = {}) {
    super(engine, "fan", opts.reverbDb ?? -10);
    const ctx = engine.ctx;
    const t0 = engine.now;
    const rpm = opts.rpm ?? 40;
    const blades = opts.blades ?? 4;
    const bladePass = (rpm / 60) * blades;

    const out = ctx.createGain();
    // Rev 3 live-mix calibration: −41 dBFS ⇒ ≈ −39 LUFS under the hub. Was −34.5.
    out.gain.value = dbToGain((opts.levelDb ?? -41) + CAL_DB);

    // ---- whoosh -----------------------------------------------------------
    const noise = engine.noiseSource("pink", 0.93, t0);
    // 200 Hz–2 kHz, two 2nd-order stages each side (24 dB/oct).
    const hp1 = ctx.createBiquadFilter();
    hp1.type = "highpass";
    hp1.frequency.value = 220;
    hp1.Q.value = 0.707;
    const hp2 = ctx.createBiquadFilter();
    hp2.type = "highpass";
    hp2.frequency.value = 220;
    hp2.Q.value = 0.707;
    const lp1 = ctx.createBiquadFilter();
    lp1.type = "lowpass";
    lp1.frequency.value = 850;
    lp1.Q.value = 0.707;
    const lp2 = ctx.createBiquadFilter();
    lp2.type = "lowpass";
    lp2.frequency.value = 1000;
    lp2.Q.value = 0.707;
    // Body of the whoosh sits 300–700 Hz.
    const tilt = ctx.createBiquadFilter();
    tilt.type = "lowshelf";
    tilt.frequency.value = 700;
    tilt.gain.value = 4;
    const whoosh = ctx.createGain();
    whoosh.gain.value = 0.75;
    noise.connect(hp1);
    hp1.connect(hp2);
    hp2.connect(tilt);
    tilt.connect(lp1);
    lp1.connect(lp2);
    lp2.connect(whoosh);

    // Blade-pass modulator: sine into level (±0.26 on a 0.75 carrier, m ≈ 0.35 alone, ≈ 0.25 once the AC shares the band) and a touch
    // of cutoff (±80 Hz), 90° apart so the brightening leads the loudness.
    const mod = ctx.createOscillator();
    mod.type = "sine";
    mod.frequency.value = bladePass;
    const modGain = ctx.createGain();
    modGain.gain.value = 0.26;
    mod.connect(modGain);
    modGain.connect(whoosh.gain);
    const modCut = ctx.createOscillator();
    modCut.type = "sine";
    modCut.frequency.value = bladePass;
    const modCutGain = ctx.createGain();
    modCutGain.gain.value = 80;
    modCut.connect(modCutGain);
    modCutGain.connect(lp1.frequency);
    mod.start(t0);
    modCut.start(t0 + 0.25 / bladePass);
    // The fan hunts: rate ±3 % over 5–10 s, depth wanders. Never a metronome.
    this.wander(mod.frequency, { min: bladePass * 0.97, max: bladePass * 1.03, minHold: 5, maxHold: 10, tau: 3 });
    this.wander(modCut.frequency, { min: bladePass * 0.97, max: bladePass * 1.03, minHold: 5, maxHold: 10, tau: 3 });
    this.wander(modGain.gain, { min: 0.22, max: 0.3, minHold: 8, maxHold: 20, tau: 4 });
    this.wander(whoosh.gain, { min: 0.7, max: 0.8, minHold: 10, maxHold: 30, tau: 6 });
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
