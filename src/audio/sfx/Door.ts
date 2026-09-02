/**
 * The front door (System 7 drives these).
 *
 * doorOpen(): latch click (2–5 kHz, ~10 ms), the hinge/pressure whoosh
 * (200 Hz–2 kHz, ~300 ms, with a small falling stick-slip resonance), then the
 * pneumatic closer drawing breath.
 *
 * setOutside(amount 0..1, rampSeconds): the heat wall. As the door opens a
 * bright exterior bed crossfades in and HOLDS while the door stays open:
 * cicadas (4.5–6 kHz, chopped at 100–170 Hz, swelling at 0.2–0.5 Hz), exterior
 * air (2–10 kHz), and a very low, very quiet highway rumble. Emitted from both
 * jambs so it has width at the threshold and still localises to the door from
 * across the room; the rumble is unspatialised. The spectrum of the room tilts
 * UP when the door opens — that's the heat.
 */
import { AudioEngine, type Vec3 } from "../AudioEngine";
import { dbToGain } from "../dsp";
import { scheduleCleanup } from "./Coffee";

export interface DoorSfxOptions {
  /** Peak of the latch click at 1 m, dBFS. */
  levelDb?: number;
  /** Cicada layer at the threshold (1.5 m) when fully open, dBFS RMS. */
  outsideDb?: number;
  reverbDb?: number;
}

export class DoorSfx {
  readonly bus: GainNode;
  readonly outsideBus: GainNode;
  private readonly engine: AudioEngine;
  private readonly position: Vec3;
  private readonly level: number;
  private readonly outside: GainNode;
  private outsideAmount = 0;

  /**
   * @param position centre of the door leaf (hinge-side x is `position.x - width/2`).
   */
  constructor(engine: AudioEngine, position: Vec3, width = 0.9, opts: DoorSfxOptions = {}) {
    this.engine = engine;
    this.position = { ...position };
    // The click below peaks ≈ -10 dBFS before this trim.
    this.level = dbToGain((opts.levelDb ?? -20) + 10);
    this.bus = engine.createBus("sfx-door", opts.reverbDb ?? -12);
    this.outsideBus = engine.createBus("outside", -Infinity);

    const ctx = engine.ctx;
    const t0 = engine.now;

    // Control signal: 1 × outside amount × bed level, fed into the gain params
    // of every bed chain so one ramp moves all of them together.
    const one = ctx.createConstantSource();
    one.offset.value = 1;
    one.start(t0);
    this.outside = ctx.createGain();
    this.outside.gain.value = 0;
    const bedLevel = ctx.createGain();
    // Cicada chain below sits ≈ -26 dBFS per jamb at full swell before this trim.
    bedLevel.gain.value = dbToGain((opts.outsideDb ?? -36) + 26);
    one.connect(this.outside);
    this.outside.connect(bedLevel);

    // Two decorrelated chains, one per jamb.
    const jambs: Vec3[] = [
      { x: position.x - width / 2, y: position.y, z: position.z },
      { x: position.x + width / 2, y: position.y, z: position.z },
    ];
    jambs.forEach((jamb, i) => {
      const noise = engine.noiseSource("white", i === 0 ? 1 : 0.96, t0);

      // Cicadas: 4.5–6 kHz, pulse-buzzed at 100–170 Hz, swelling at 0.2–0.5 Hz.
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = i === 0 ? 5000 : 5500;
      bp.Q.value = 2.5;
      const chop = ctx.createGain();
      chop.gain.value = 0.55;
      const buzz = ctx.createOscillator();
      buzz.frequency.value = i === 0 ? 118 : 152;
      const buzzDepth = ctx.createGain();
      buzzDepth.gain.value = 0.45;
      buzz.connect(buzzDepth);
      buzzDepth.connect(chop.gain);
      buzz.start(t0);
      const swellGain = ctx.createGain();
      swellGain.gain.value = 0.65;
      const swell = ctx.createOscillator();
      swell.frequency.value = i === 0 ? 0.27 : 0.41;
      const swellDepth = ctx.createGain();
      swellDepth.gain.value = 0.35;
      swell.connect(swellDepth);
      swellDepth.connect(swellGain.gain);
      swell.start(t0);
      const cicada = ctx.createGain();
      cicada.gain.value = 4.0;
      noise.connect(bp);
      bp.connect(chop);
      chop.connect(swellGain);
      swellGain.connect(cicada);

      // Exterior air: 2–8 kHz, ≈ 8 dB under the cicadas.
      const airHp = ctx.createBiquadFilter();
      airHp.type = "highpass";
      airHp.frequency.value = 2000;
      airHp.Q.value = 0.6;
      const airLp = ctx.createBiquadFilter();
      airLp.type = "lowpass";
      airLp.frequency.value = 8000;
      airLp.Q.value = 0.5;
      const air = ctx.createGain();
      air.gain.value = 0.18;
      noise.connect(airHp);
      airHp.connect(airLp);
      airLp.connect(air);

      const jambSum = ctx.createGain();
      cicada.connect(jambSum);
      air.connect(jambSum);
      jambSum.gain.value = 0;
      bedLevel.connect(jambSum.gain); // amount × level drives each jamb
      engine.attach(jambSum, jamb, this.outsideBus, { model: "HRTF", refDistance: 1.5, rolloffFactor: 0.55 });
    });

    // Distant highway: brown noise under 120 Hz, unspatialised, barely there (≥ 20 dB under the cicadas).
    const rumbleSrc = engine.noiseSource("brown", 0.9, t0);
    const rumbleLp = ctx.createBiquadFilter();
    rumbleLp.type = "lowpass";
    rumbleLp.frequency.value = 120;
    rumbleLp.Q.value = 0.7;
    const rumble = ctx.createGain();
    rumble.gain.value = 0;
    const rumbleTrim = ctx.createGain();
    rumbleTrim.gain.value = 0.02;
    bedLevel.connect(rumbleTrim);
    rumbleTrim.connect(rumble.gain);
    rumbleSrc.connect(rumbleLp);
    rumbleLp.connect(rumble);
    rumble.connect(this.outsideBus);
  }

  /**
   * 0 = door shut, 1 = wide open. Ramps over `rampSeconds` (default 0.1 s for
   * per-frame calls) and holds. The critic's ear: fade in over ~1.5 s when the
   * door swings, and stay there while it is open.
   */
  setOutside(amount: number, rampSeconds = 0.1): void {
    const a = Math.max(0, Math.min(1, amount));
    if (a === this.outsideAmount) return;
    this.outsideAmount = a;
    // Perceptual-ish curve: the first few degrees let a lot of sound in.
    const target = Math.pow(a, 0.6);
    const g = this.outside.gain;
    const now = this.engine.now;
    const current = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(current, now);
    g.linearRampToValueAtTime(target, now + Math.max(0.02, rampSeconds));
  }

  getOutside(): number {
    return this.outsideAmount;
  }

  doorOpen(at: Vec3 = this.position): void {
    const engine = this.engine;
    const ctx = engine.ctx;
    const rng = engine.rng;
    const t = engine.now + 0.02;
    engine.logEvent("sfx.door", t, 2.2);
    const out = ctx.createGain();
    out.gain.value = this.level;
    const spatial = engine.attach(out, at, this.bus, { model: "equalpower" });
    const noise = engine.noiseSource("white", 1, t);

    // ---- latch click: 2–5 kHz, ~10 ms -------------------------------------------------------
    const clickBp = ctx.createBiquadFilter();
    clickBp.type = "bandpass";
    clickBp.frequency.value = rng.range(3000, 3600);
    clickBp.Q.value = 0.8;
    const click = ctx.createGain();
    click.gain.setValueAtTime(0, t);
    click.gain.linearRampToValueAtTime(1.0, t + 0.001);
    click.gain.setTargetAtTime(0, t + 0.002, 0.003);
    noise.connect(clickBp);
    clickBp.connect(click);
    click.connect(out);
    // Latch tongue retracting: a second, duller click.
    const t2 = t + 0.04;
    const latchLp = ctx.createBiquadFilter();
    latchLp.type = "bandpass";
    latchLp.frequency.value = 1800;
    latchLp.Q.value = 1.2;
    const latch = ctx.createGain();
    latch.gain.setValueAtTime(0, t2);
    latch.gain.linearRampToValueAtTime(0.5, t2 + 0.0015);
    latch.gain.setTargetAtTime(0, t2 + 0.003, 0.004);
    noise.connect(latchLp);
    latchLp.connect(latch);
    latch.connect(out);

    // ---- hinge / pressure whoosh: 200 Hz–2 kHz, ~300 ms ---------------------------------------
    const tw = t + 0.06;
    const whooshHp = ctx.createBiquadFilter();
    whooshHp.type = "highpass";
    whooshHp.frequency.value = 200;
    whooshHp.Q.value = 0.707;
    const whooshLp = ctx.createBiquadFilter();
    whooshLp.type = "lowpass";
    whooshLp.frequency.value = 2000;
    whooshLp.Q.value = 0.707;
    const whoosh = ctx.createGain();
    whoosh.gain.setValueAtTime(0, tw);
    whoosh.gain.linearRampToValueAtTime(0.4, tw + 0.07);
    whoosh.gain.setTargetAtTime(0, tw + 0.1, 0.09);
    noise.connect(whooshHp);
    whooshHp.connect(whooshLp);
    whooshLp.connect(whoosh);
    whoosh.connect(out);
    // Stick-slip in the hinge: a small falling resonance inside the whoosh.
    const creakRes = ctx.createBiquadFilter();
    creakRes.type = "bandpass";
    creakRes.Q.value = 9;
    const fStart = rng.range(600, 760);
    creakRes.frequency.setValueAtTime(fStart, tw);
    creakRes.frequency.exponentialRampToValueAtTime(fStart * 0.7, tw + 0.35);
    const creak = ctx.createGain();
    creak.gain.setValueAtTime(0, tw);
    creak.gain.linearRampToValueAtTime(0.9, tw + 0.08);
    creak.gain.setTargetAtTime(0, tw + 0.2, 0.07);
    const flutter = ctx.createOscillator();
    flutter.frequency.value = rng.range(14, 22);
    const flutterDepth = ctx.createGain();
    flutterDepth.gain.value = 0.35;
    flutter.connect(flutterDepth);
    flutterDepth.connect(creak.gain);
    flutter.start(tw);
    flutter.stop(tw + 0.6);
    whooshLp.connect(creakRes);
    creakRes.connect(creak);
    creak.connect(out);

    // ---- pneumatic closer: draws breath as the arm extends ----------------------------------
    const ts = t + 0.3;
    const sighBp = ctx.createBiquadFilter();
    sighBp.type = "bandpass";
    sighBp.Q.value = 1.2;
    sighBp.frequency.setValueAtTime(1500, ts);
    sighBp.frequency.exponentialRampToValueAtTime(650, ts + 1.6);
    const sigh = ctx.createGain();
    sigh.gain.setValueAtTime(0, ts);
    sigh.gain.linearRampToValueAtTime(0.3, ts + 0.5);
    sigh.gain.setTargetAtTime(0, ts + 0.55, 0.4);
    noise.connect(sighBp);
    sighBp.connect(sigh);
    sigh.connect(out);

    const stopAt = ts + 2.2;
    noise.stop(stopAt);
    scheduleCleanup(noise, stopAt, spatial, engine);
  }
}
