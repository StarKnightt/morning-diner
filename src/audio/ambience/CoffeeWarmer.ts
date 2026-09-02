/**
 * The coffee pot on the back-bar warmer.
 *
 * A constant faint hiss from the hot plate (2.8–4.5 kHz) and three kinds of
 * small event, each on its own randomised clock:
 *   gurgle   1–2 per 10 s: two to four "blups" — a bubble's resonance gliding
 *            down 450 → 200 Hz over 40–120 ms — as the last of the brew settles
 *   crackle  every 3–8 s: 0.3–1 s of extra sizzle in 3–8 kHz (a drop on the plate),
 *            now and then a longer steam sigh
 *   tick     thermostat relay, 3–8 kHz, 6–9 ms; also tends to follow a gurgle
 * Quiet — you notice it only because the room is so still — but each event is
 * long and loud enough to read as an event rather than a fluctuation.
 */
import { AudioEngine, type Vec3 } from "../AudioEngine";
import { dbToGain } from "../dsp";
import { AmbientLayer } from "../Layer";

/** Measured with the harness: a tick peaks this far below the `out` gain at 1 m. */
const CAL_DB = 8;

export interface CoffeeWarmerOptions {
  /** Peak level of a thermostat tick at 1 m, dBFS. */
  levelDb?: number;
  reverbDb?: number;
}

export class CoffeeWarmer extends AmbientLayer {
  private readonly out: GainNode;
  private readonly tickGain: GainNode;
  private readonly tickBp: BiquadFilterNode;
  private readonly tickRing: BiquadFilterNode;
  private readonly crackleGain: GainNode;
  private readonly crackleBp: BiquadFilterNode;
  private readonly crackleAm: OscillatorNode;
  private readonly crackleAmDepth: GainNode;
  private readonly blup: OscillatorNode;
  private readonly blupGain: GainNode;
  private readonly blupRes: BiquadFilterNode;
  private readonly blupResGain: GainNode;

  constructor(engine: AudioEngine, position: Vec3, opts: CoffeeWarmerOptions = {}) {
    super(engine, "coffee", opts.reverbDb ?? -14);
    const ctx = engine.ctx;
    const t0 = engine.now;
    this.out = ctx.createGain();
    // Rev 3 live-mix calibration: louder at the plate (−27, was −32) and — see attach() below —
    // a much steeper rolloff, so it is a near-field detail: ticks poke through the bed at the
    // brewer (1.2 m), 20 dB under it by the aisle (3.7 m).
    this.out.gain.value = dbToGain((opts.levelDb ?? -27) + CAL_DB);

    // ---- constant plate hiss, 2.8–4.5 kHz ------------------------------------------------
    const plate = engine.noiseSource("white", 0.95, t0);
    // Two-stage high-pass: keep the hiss out of the radio's 900 Hz–3 kHz band.
    const plateHp = ctx.createBiquadFilter();
    plateHp.type = "highpass";
    plateHp.frequency.value = 2800;
    plateHp.Q.value = 0.707;
    const plateHp2 = ctx.createBiquadFilter();
    plateHp2.type = "highpass";
    plateHp2.frequency.value = 2800;
    plateHp2.Q.value = 0.707;
    // Two-stage low-pass: the hiss must stay out of the 5–8 kHz room-air band.
    const plateLp = ctx.createBiquadFilter();
    plateLp.type = "lowpass";
    plateLp.frequency.value = 4200;
    plateLp.Q.value = 0.707;
    const plateLp2 = ctx.createBiquadFilter();
    plateLp2.type = "lowpass";
    plateLp2.frequency.value = 4200;
    plateLp2.Q.value = 0.707;
    const plateGain = ctx.createGain();
    plateGain.gain.value = 0.3; // 3–8 kHz floor ≈ -62 dBFS at the listener: the events must clear it
    plate.connect(plateHp);
    plateHp.connect(plateHp2);
    plateHp2.connect(plateLp);
    plateLp.connect(plateLp2);
    plateLp2.connect(plateGain);
    plateGain.connect(this.out);
    this.wander(plateGain.gain, { min: 0.24, max: 0.36, minHold: 4, maxHold: 12, tau: 2.5 });

    // ---- tick: 3–8 kHz burst through a light resonance, 6–9 ms -------------------------------
    const tickSrc = engine.noiseSource("white", 1.01, t0);
    this.tickBp = ctx.createBiquadFilter();
    this.tickBp.type = "bandpass";
    this.tickBp.frequency.value = 5000;
    this.tickBp.Q.value = 0.9;
    this.tickRing = ctx.createBiquadFilter();
    this.tickRing.type = "peaking";
    this.tickRing.frequency.value = 5200;
    this.tickRing.Q.value = 6;
    this.tickRing.gain.value = 6;
    this.tickGain = ctx.createGain();
    this.tickGain.gain.value = 0;
    tickSrc.connect(this.tickBp);
    this.tickBp.connect(this.tickRing);
    this.tickRing.connect(this.tickGain);
    this.tickGain.connect(this.out);

    // ---- crackle / steam: 3–8 kHz, fast irregular AM ----------------------------------------
    const crackleSrc = engine.noiseSource("white", 0.98, t0);
    this.crackleBp = ctx.createBiquadFilter();
    this.crackleBp.type = "bandpass";
    this.crackleBp.frequency.value = 5200;
    this.crackleBp.Q.value = 0.6;
    const crackleAmGain = ctx.createGain();
    crackleAmGain.gain.value = 0.6;
    this.crackleAm = ctx.createOscillator();
    this.crackleAm.frequency.value = 41;
    this.crackleAmDepth = ctx.createGain();
    this.crackleAmDepth.gain.value = 0.4;
    this.crackleAm.connect(this.crackleAmDepth);
    this.crackleAmDepth.connect(crackleAmGain.gain);
    this.crackleAm.start(t0);
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0;
    crackleSrc.connect(this.crackleBp);
    this.crackleBp.connect(crackleAmGain);
    crackleAmGain.connect(this.crackleGain);
    this.crackleGain.connect(this.out);

    // ---- blup: a bubble — sine gliding down, plus a resonant sliver of noise ----------------
    this.blup = ctx.createOscillator();
    this.blup.type = "sine";
    this.blup.frequency.value = 300;
    this.blup.start(t0);
    this.blupGain = ctx.createGain();
    this.blupGain.gain.value = 0;
    this.blup.connect(this.blupGain);
    this.blupGain.connect(this.out);
    const blupNoise = engine.noiseSource("pink", 0.99, t0);
    this.blupRes = ctx.createBiquadFilter();
    this.blupRes.type = "bandpass";
    this.blupRes.frequency.value = 300;
    this.blupRes.Q.value = 8;
    this.blupResGain = ctx.createGain();
    this.blupResGain.gain.value = 0;
    blupNoise.connect(this.blupRes);
    this.blupRes.connect(this.blupResGain);
    this.blupResGain.connect(this.out);

    // Clocks. Gurgles 1–2 per 10 s, crackle every 3–8 s, an independent tick every 6–12 s.
    this.every(5, 9, (t) => this.scheduleGurgle(t), 1.0);
    this.every(3, 8, (t) => this.scheduleCrackle(t), 0.5);
    this.every(6, 12, (t) => this.scheduleTick(t), 2.0);

    // Near-field: −8 dB at 1.5 m, −15 dB at 3 m (the shared 1 m / 0.55 model gives −2 / −6).
    engine.attach(this.out, position, this.bus, { refDistance: 0.7, rolloffFactor: 1.4 });
  }

  private scheduleTick(t: number): void {
    const rng = this.rng;
    const f = rng.range(3800, 6500);
    this.tickBp.frequency.setValueAtTime(f, t);
    this.tickRing.frequency.setValueAtTime(f * rng.range(0.9, 1.1), t);
    const g = this.tickGain.gain;
    const peak = rng.range(1.2, 1.45);
    // 0.5 ms attack, ~6 ms body, 1.5 ms decay constant: 8–10 ms above -20 dB, a
    // solid little click rather than a spike.
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + 0.0005);
    g.setValueAtTime(peak, t + rng.range(0.005, 0.0065));
    g.setTargetAtTime(0, t + 0.0065, 0.0015);
    // Relay arms often double-bounce.
    if (rng.chance(0.4)) {
      const t2 = t + rng.range(0.03, 0.07);
      g.setValueAtTime(0, t2);
      g.linearRampToValueAtTime(peak * 0.5, t2 + 0.0008);
      g.setTargetAtTime(0, t2 + 0.002, 0.0015);
    }
    this.engine.logEvent("coffee.tick", t, 0.08);
  }

  /** Two to four blups; the thermostat usually answers a couple of seconds later. */
  private scheduleGurgle(t: number): void {
    const rng = this.rng;
    const n = 2 + Math.floor(rng.range(0, 3));
    let time = t;
    for (let i = 0; i < n; i++) {
      const dur = rng.range(0.04, 0.12);
      this.scheduleBlup(time, dur, rng.range(0.7, 1.0) * (i === 0 ? 1 : rng.range(0.6, 1.0)));
      time += dur + rng.range(0.07, 0.2);
    }
    this.engine.logEvent("coffee.gurgle", t, time - t);
    if (rng.chance(0.65)) this.scheduleTick(time + rng.range(1.2, 3.0));
  }

  private scheduleBlup(t: number, dur: number, level: number): void {
    const rng = this.rng;
    const fStart = rng.range(380, 480);
    const fEnd = rng.range(180, 240);
    const f = this.blup.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(fStart, t);
    f.exponentialRampToValueAtTime(fEnd, t + dur);
    const g = this.blupGain.gain;
    const peak = 0.34 * level;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + 0.005);
    g.setValueAtTime(peak, t + dur * 0.35);
    g.linearRampToValueAtTime(0, t + dur);
    // The noisy sliver follows the same glide.
    const rf = this.blupRes.frequency;
    rf.cancelScheduledValues(t);
    rf.setValueAtTime(fStart, t);
    rf.exponentialRampToValueAtTime(fEnd, t + dur);
    const rg = this.blupResGain.gain;
    rg.setValueAtTime(0, t);
    rg.linearRampToValueAtTime(1.45 * level, t + 0.004);
    rg.linearRampToValueAtTime(0, t + dur);
  }

  private scheduleCrackle(t: number): void {
    const rng = this.rng;
    const long = rng.chance(0.2);
    const dur = long ? rng.range(1.0, 2.0) : rng.range(0.3, 1.0);
    const f = rng.range(4200, 6500);
    this.crackleBp.frequency.setValueAtTime(f, t);
    this.crackleBp.frequency.setTargetAtTime(f * 0.8, t + dur * 0.3, dur * 0.4);
    this.crackleAm.frequency.setValueAtTime(rng.range(29, 53), t);
    this.crackleAmDepth.gain.setValueAtTime(long ? 0.15 : rng.range(0.35, 0.5), t);
    const g = this.crackleGain.gain;
    const peak = rng.range(0.8, 1.1);
    g.setValueAtTime(0, t);
    g.setTargetAtTime(peak, t, dur * 0.12);
    g.setTargetAtTime(0, t + dur * 0.55, dur * 0.15);
    this.engine.logEvent(long ? "coffee.steam" : "coffee.crackle", t, dur);
  }
}
