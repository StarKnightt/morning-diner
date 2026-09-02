/**
 * The front door (System 7 drives these).
 *
 * doorOpen(): push-bar click, a short hinge creak (low-passed noise through a
 * resonance whose pitch falls, with stick-slip flutter), then the pneumatic
 * closer drawing breath.
 *
 * setOutside(amount 0..1): the heat wall. As the door opens, a bright, wide
 * exterior bed crossfades in — broadband hiss, cicada shimmer chopped at
 * ~50 Hz, and a very low distant-highway rumble. Emitted from both jambs so it
 * has width at the threshold and still localises to the door from across the
 * room; the rumble is unspatialised (you feel it more than hear it).
 */
import { AudioEngine, type Vec3 } from "../AudioEngine";
import { dbToGain } from "../dsp";
import { scheduleCleanup } from "./Coffee";

export interface DoorSfxOptions {
  /** Peak of the door one-shot at 1 m, dBFS. */
  levelDb?: number;
  /** Level of the exterior bed at the threshold when fully open, dBFS RMS. */
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
    this.level = dbToGain(opts.levelDb ?? -12);
    this.bus = engine.createBus("sfx-door", opts.reverbDb ?? -10);
    this.outsideBus = engine.createBus("outside", -Infinity);

    const ctx = engine.ctx;
    const t0 = engine.now;
    // Control signal: 1 × outside amount × bed level, fed into the gain params
    // of every bed chain so one setTargetAtTime moves all of them together.
    const one = ctx.createConstantSource();
    one.offset.value = 1;
    one.start(t0);
    this.outside = ctx.createGain();
    this.outside.gain.value = 0;
    const bedLevel = ctx.createGain();
    bedLevel.gain.value = dbToGain(opts.outsideDb ?? -30);
    one.connect(this.outside);
    this.outside.connect(bedLevel);

    // Two decorrelated chains, one per jamb.
    const jambs: Vec3[] = [
      { x: position.x - width / 2, y: position.y, z: position.z },
      { x: position.x + width / 2, y: position.y, z: position.z },
    ];
    jambs.forEach((jamb, i) => {
      const noise = engine.noiseSource("white", i === 0 ? 1 : 0.96, t0);
      // Hiss: bright, open.
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 900;
      hp.Q.value = 0.5;
      const shelf = ctx.createBiquadFilter();
      shelf.type = "lowpass";
      shelf.frequency.value = 11000;
      const hissGain = ctx.createGain();
      hissGain.gain.value = 0.32;
      noise.connect(hp);
      hp.connect(shelf);
      shelf.connect(hissGain);
      // Cicadas: 5.5–7.5 kHz band chopped at ~50 Hz.
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = i === 0 ? 6100 : 6900;
      bp.Q.value = 3;
      const chop = ctx.createGain();
      chop.gain.value = 0.5;
      const buzz = ctx.createOscillator();
      buzz.frequency.value = i === 0 ? 47 : 58;
      const buzzDepth = ctx.createGain();
      buzzDepth.gain.value = 0.45;
      buzz.connect(buzzDepth);
      buzzDepth.connect(chop.gain);
      buzz.start(t0);
      const cicadaGain = ctx.createGain();
      cicadaGain.gain.value = 0.9;
      noise.connect(bp);
      bp.connect(chop);
      chop.connect(cicadaGain);
      // Slow swell on the cicadas so the heat has a pulse.
      const swell = ctx.createOscillator();
      swell.frequency.value = i === 0 ? 0.09 : 0.13;
      const swellDepth = ctx.createGain();
      swellDepth.gain.value = 0.4;
      swell.connect(swellDepth);
      swellDepth.connect(cicadaGain.gain);
      swell.start(t0);

      const jambSum = ctx.createGain();
      hissGain.connect(jambSum);
      cicadaGain.connect(jambSum);
      bedLevel.connect(jambSum.gain); // amount × level drives each jamb
      jambSum.gain.value = 0;
      const h = engine.attach(jambSum, jamb, this.outsideBus);
      h.panner.rolloffFactor = 0.7;
      h.panner.refDistance = 1.5;
    });

    // Distant highway: brown noise under 120 Hz, unspatialised, barely there.
    const rumbleSrc = engine.noiseSource("brown", 0.9, t0);
    const rumbleLp = ctx.createBiquadFilter();
    rumbleLp.type = "lowpass";
    rumbleLp.frequency.value = 120;
    rumbleLp.Q.value = 0.7;
    const rumble = ctx.createGain();
    rumble.gain.value = 0;
    const rumbleTrim = ctx.createGain();
    rumbleTrim.gain.value = 0.7;
    bedLevel.connect(rumbleTrim);
    rumbleTrim.connect(rumble.gain);
    rumbleSrc.connect(rumbleLp);
    rumbleLp.connect(rumble);
    rumble.connect(this.outsideBus);
  }

  /** 0 = door shut, 1 = wide open. Smooth; call every frame or on change. */
  setOutside(amount: number): void {
    const a = Math.max(0, Math.min(1, amount));
    if (a === this.outsideAmount) return;
    this.outsideAmount = a;
    // Perceptual-ish curve: the first few degrees let a lot of sound in.
    const g = Math.pow(a, 0.6);
    this.outside.gain.setTargetAtTime(g, this.engine.now, 0.08);
  }

  getOutside(): number {
    return this.outsideAmount;
  }

  doorOpen(at: Vec3 = this.position): void {
    const engine = this.engine;
    const ctx = engine.ctx;
    const rng = engine.rng;
    const t = engine.now + 0.02;
    const out = ctx.createGain();
    out.gain.value = this.level;
    const spatial = engine.attach(out, at, this.bus);
    const noise = engine.noiseSource("white", 1, t);

    // ---- push bar: a click and a short metallic ring ----------------------------
    const clickBp = ctx.createBiquadFilter();
    clickBp.type = "bandpass";
    clickBp.frequency.value = 2400;
    clickBp.Q.value = 2.5;
    const click = ctx.createGain();
    click.gain.setValueAtTime(0, t);
    click.gain.linearRampToValueAtTime(0.9, t + 0.0015);
    click.gain.setTargetAtTime(0, t + 0.003, 0.006);
    noise.connect(clickBp);
    clickBp.connect(click);
    click.connect(out);
    const ringOsc = ctx.createOscillator();
    ringOsc.type = "triangle";
    ringOsc.frequency.value = rng.range(1600, 2000);
    const ringGain = ctx.createGain();
    ringGain.gain.setValueAtTime(0, t);
    ringGain.gain.linearRampToValueAtTime(0.12, t + 0.002);
    ringGain.gain.setTargetAtTime(0, t + 0.004, 0.03);
    ringOsc.connect(ringGain);
    ringGain.connect(out);
    ringOsc.start(t);
    ringOsc.stop(t + 0.4);
    // Latch tongue retracting: a second, duller click.
    const t2 = t + 0.045;
    const latch = ctx.createGain();
    latch.gain.setValueAtTime(0, t2);
    latch.gain.linearRampToValueAtTime(0.45, t2 + 0.002);
    latch.gain.setTargetAtTime(0, t2 + 0.004, 0.01);
    const latchLp = ctx.createBiquadFilter();
    latchLp.type = "lowpass";
    latchLp.frequency.value = 1200;
    noise.connect(latchLp);
    latchLp.connect(latch);
    latch.connect(out);

    // ---- hinge creak -------------------------------------------------------------
    const tc = t + 0.14;
    const creakDur = rng.range(0.45, 0.7);
    const creakLp = ctx.createBiquadFilter();
    creakLp.type = "lowpass";
    creakLp.frequency.value = 900;
    const creakRes = ctx.createBiquadFilter();
    creakRes.type = "bandpass";
    creakRes.Q.value = 11;
    const fStart = rng.range(560, 720);
    creakRes.frequency.setValueAtTime(fStart, tc);
    creakRes.frequency.exponentialRampToValueAtTime(fStart * 0.68, tc + creakDur);
    const creak = ctx.createGain();
    creak.gain.setValueAtTime(0, tc);
    creak.gain.linearRampToValueAtTime(0.55, tc + 0.09);
    creak.gain.setValueAtTime(0.55, tc + creakDur * 0.6);
    creak.gain.setTargetAtTime(0, tc + creakDur * 0.6, creakDur * 0.14);
    // Stick-slip flutter.
    const flutter = ctx.createOscillator();
    flutter.frequency.setValueAtTime(rng.range(16, 22), tc);
    flutter.frequency.linearRampToValueAtTime(rng.range(9, 13), tc + creakDur);
    const flutterDepth = ctx.createGain();
    flutterDepth.gain.value = 0.3;
    flutter.connect(flutterDepth);
    flutterDepth.connect(creak.gain);
    flutter.start(tc);
    flutter.stop(tc + creakDur + 0.3);
    noise.connect(creakLp);
    creakLp.connect(creakRes);
    creakRes.connect(creak);
    creak.connect(out);

    // ---- pneumatic closer: draws breath as the arm extends ---------------------------
    const ts = t + 0.35;
    const sighBp = ctx.createBiquadFilter();
    sighBp.type = "bandpass";
    sighBp.Q.value = 1.2;
    sighBp.frequency.setValueAtTime(1500, ts);
    sighBp.frequency.exponentialRampToValueAtTime(650, ts + 1.6);
    const sigh = ctx.createGain();
    sigh.gain.setValueAtTime(0, ts);
    sigh.gain.linearRampToValueAtTime(0.28, ts + 0.5);
    sigh.gain.setTargetAtTime(0, ts + 0.55, 0.45);
    noise.connect(sighBp);
    sighBp.connect(sigh);
    sigh.connect(out);

    const stopAt = ts + 2.4;
    noise.stop(stopAt);
    scheduleCleanup(noise, stopAt, spatial, engine);
  }
}
