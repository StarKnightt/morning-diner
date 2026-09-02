/**
 * The front door (System 7 drives these).
 *
 * doorOpen(): latch click (2–5 kHz, ~10 ms), the hinge/pressure whoosh
 * (200 Hz–2 kHz, ~300 ms, with a small falling stick-slip resonance), then the
 * pneumatic closer drawing breath.
 *
 * setOutside(amount 0..1, rampSeconds): the heat wall. As the door opens a
 * bright exterior bed crossfades in and HOLDS while the door stays open:
 * cicadas (4.5–6 kHz, chopped at 100–170 Hz, a gentle 0.2–0.5 Hz swell),
 * exterior air (2–8 kHz), a distant highway / condenser layer at 60–250 Hz and
 * a wind-over-scrub texture at 300 Hz–1 kHz. Everything is emitted from both
 * jambs with independent noise so it has width at the threshold and still
 * localises to the door from across the room. The spectrum of the room tilts
 * UP when the door opens — that's the heat.
 *
 * Rev 3 (live-mix calibration, tools/audio-harness.mjs --scenario=door):
 *   - the crossfade is equal-power in shape: exterior gain sin(π/2·a), and the
 *     room (engine.interior) ducks along the complementary curve to −3 dB at
 *     full open, so the wall replaces the room instead of stacking on it;
 *   - per-frame calls are smoothed with a 0.22 s time constant on the way open
 *     (the wall arrives ~0.6 s after the leaf clears 30°, as a swell) and
 *     0.07 s on the way shut, so the latch cuts it;
 *   - when the amount returns to 0 after having been open, the latch clicks
 *     (`doorClose()`; DoorSwing.ts only calls open() + outside(p), and the
 *     leaf reaching 0° *is* the latch);
 *   - the bed sits ≈ −26 LUFS at the threshold when fully open (was −22).
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
    // Neither the leaf's own sounds nor the exterior bed are part of the room the door ducks.
    this.bus = engine.createBus("sfx-door", opts.reverbDb ?? -12, { interior: false });
    this.outsideBus = engine.createBus("outside", -Infinity, { interior: false });

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
    // −40 ⇒ ≈ −26 LUFS at the threshold, fully open (rev 3; was −36 ⇒ −22).
    bedLevel.gain.value = dbToGain((opts.outsideDb ?? -40) + 26);
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
      swellDepth.gain.value = 0.12; // ±1.5 dB: a breath, not a sag
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

      // Distant highway + a condenser unit next door: 60–250 Hz, decorrelated per jamb.
      const lowSrc = engine.noiseSource("brown", i === 0 ? 0.91 : 1.07, t0);
      const lowHp = ctx.createBiquadFilter();
      lowHp.type = "highpass";
      lowHp.frequency.value = 60;
      lowHp.Q.value = 0.707;
      const lowLp = ctx.createBiquadFilter();
      lowLp.type = "lowpass";
      lowLp.frequency.value = 230;
      lowLp.Q.value = 0.707;
      const low = ctx.createGain();
      low.gain.value = 0.1;
      lowSrc.connect(lowHp);
      lowHp.connect(lowLp);
      lowLp.connect(low);
      // Condenser hum inside it, wobbling slowly.
      const condenser = ctx.createOscillator();
      condenser.frequency.value = i === 0 ? 118 : 121;
      const condenserGain = ctx.createGain();
      condenserGain.gain.value = 0.006;
      const wobble = ctx.createOscillator();
      wobble.frequency.value = i === 0 ? 0.37 : 0.29;
      const wobbleDepth = ctx.createGain();
      wobbleDepth.gain.value = 0.0025;
      wobble.connect(wobbleDepth);
      wobbleDepth.connect(condenserGain.gain);
      condenser.connect(condenserGain);
      condenser.start(t0);
      wobble.start(t0);

      // Wind over scrub, 300 Hz–1 kHz, slowly gusting. No birds with pitch.
      const midSrc = engine.noiseSource("pink", i === 0 ? 1.13 : 0.89, t0);
      const midHp = ctx.createBiquadFilter();
      midHp.type = "highpass";
      midHp.frequency.value = 300;
      midHp.Q.value = 0.707;
      const midLp = ctx.createBiquadFilter();
      midLp.type = "lowpass";
      midLp.frequency.value = 1000;
      midLp.Q.value = 0.707;
      const mid = ctx.createGain();
      mid.gain.value = 0.066;
      midSrc.connect(midHp);
      midHp.connect(midLp);
      midLp.connect(mid);
      const gust = ctx.createOscillator();
      gust.frequency.value = i === 0 ? 0.19 : 0.23;
      const gustDepth = ctx.createGain();
      gustDepth.gain.value = 0.02;
      gust.connect(gustDepth);
      gustDepth.connect(mid.gain);
      gust.start(t0);

      const jambSum = ctx.createGain();
      cicada.connect(jambSum);
      air.connect(jambSum);
      low.connect(jambSum);
      condenserGain.connect(jambSum);
      mid.connect(jambSum);
      jambSum.gain.value = 0;
      bedLevel.connect(jambSum.gain); // amount × level drives each jamb
      engine.attach(jambSum, jamb, this.outsideBus, { model: "HRTF", refDistance: 1.5, rolloffFactor: 0.55 });
    });

  }

  /**
   * 0 = door shut, 1 = wide open, holds at whatever it is given. Equal-power
   * crossfade against the room: exterior gain sin(π/2·a), interior gain
   * √(1 − ½·sin²(π/2·a)) (−3 dB at full open).
   *
   * Without `rampSeconds` (the per-frame DoorSwing call) the params follow the
   * leaf through a first-order lag: τ = 0.22 s opening — the wall arrives as a
   * swell ≈ 0.6 s after the leaf clears 30° — and τ = 0.07 s closing, so the
   * latch cuts it. With `rampSeconds` it is a linear ramp (scripted use).
   *
   * Returning to 0 after having been open plays the latch (`doorClose()`).
   */
  setOutside(amount: number, rampSeconds?: number): void {
    const a = Math.max(0, Math.min(1, amount));
    if (a === this.outsideAmount) return;
    const wasOpen = this.outsideAmount > 0;
    const opening = a > this.outsideAmount;
    this.outsideAmount = a;
    const s = Math.sin((Math.PI / 2) * a);
    const outsideTarget = s;
    const interiorTarget = Math.sqrt(1 - 0.5 * s * s);
    const now = this.engine.now;
    const drive = (g: AudioParam, target: number): void => {
      const current = g.value;
      g.cancelScheduledValues(now);
      g.setValueAtTime(current, now);
      if (rampSeconds !== undefined) g.linearRampToValueAtTime(target, now + Math.max(0.02, rampSeconds));
      else g.setTargetAtTime(target, now, opening ? DoorSfx.SWELL_TAU : DoorSfx.SHUT_TAU);
    };
    drive(this.outside.gain, outsideTarget);
    drive(this.engine.interior.gain, interiorTarget);
    if (a === 0 && wasOpen) this.doorClose();
  }

  /** Opening swell / closing cut time constants (seconds) for per-frame setOutside(). */
  static readonly SWELL_TAU = 0.22;
  static readonly SHUT_TAU = 0.07;

  getOutside(): number {
    return this.outsideAmount;
  }

  /**
   * The leaf meeting the frame: strike-plate click, the tongue dropping into
   * the keeper a few ms later, and a short body thud from the leaf. Peaks
   * ≈ 4 dB under the opening latch. Fired by setOutside(0) after an opening;
   * public for scripted use.
   */
  doorClose(at: Vec3 = this.position): void {
    const engine = this.engine;
    const ctx = engine.ctx;
    const rng = engine.rng;
    const t = engine.now + 0.01;
    engine.logEvent("sfx.door-close", t, 0.4);
    const out = ctx.createGain();
    out.gain.value = this.level * dbToGain(-4);
    const spatial = engine.attach(out, at, this.bus, { model: "equalpower" });
    const noise = engine.noiseSource("white", 1, t);

    // Leaf meets the stop: a dull 300–900 Hz thump.
    const thudBp = ctx.createBiquadFilter();
    thudBp.type = "bandpass";
    thudBp.frequency.value = rng.range(420, 560);
    thudBp.Q.value = 1.1;
    const thud = ctx.createGain();
    thud.gain.setValueAtTime(0, t);
    thud.gain.linearRampToValueAtTime(0.9, t + 0.003);
    thud.gain.setTargetAtTime(0, t + 0.006, 0.02);
    noise.connect(thudBp);
    thudBp.connect(thud);
    thud.connect(out);

    // Strike plate: 2.5–3.5 kHz, ~8 ms.
    const clickBp = ctx.createBiquadFilter();
    clickBp.type = "bandpass";
    clickBp.frequency.value = rng.range(2600, 3400);
    clickBp.Q.value = 0.9;
    const click = ctx.createGain();
    click.gain.setValueAtTime(0, t);
    click.gain.linearRampToValueAtTime(0.7, t + 0.001);
    click.gain.setTargetAtTime(0, t + 0.002, 0.0025);
    noise.connect(clickBp);
    clickBp.connect(click);
    click.connect(out);

    // Tongue into the keeper: brighter, later, smaller.
    const t2 = t + rng.range(0.03, 0.045);
    const tongueBp = ctx.createBiquadFilter();
    tongueBp.type = "bandpass";
    tongueBp.frequency.value = rng.range(3800, 4600);
    tongueBp.Q.value = 1.4;
    const tongue = ctx.createGain();
    tongue.gain.setValueAtTime(0, t2);
    tongue.gain.linearRampToValueAtTime(0.45, t2 + 0.001);
    tongue.gain.setTargetAtTime(0, t2 + 0.002, 0.003);
    noise.connect(tongueBp);
    tongueBp.connect(tongue);
    tongue.connect(out);

    const stopAt = t + 0.4;
    noise.stop(stopAt);
    scheduleCleanup(noise, stopAt, spatial, engine);
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
