/**
 * The player's own body sounds (System 9, feature 5).
 *
 * footfall(strength): the landing after a hop — both shoes meeting the quarry
 * tile. A soft 90–140 Hz thump (a filtered noise burst with a fast 6 ms attack
 * and a ~45 ms exponential tail — sole, not heel-strike), a quiet 1.5–3 kHz
 * grit scuff 10–20 ms later (the shoes settling), and nothing that rings: tile
 * on concrete has no resonance to speak of. Mono, un-panned (it is under the
 * listener) into its own bus with a small reverb send so the room answers.
 * ≈ −30 dBFS peak at full strength: audible, never a stomp.
 */
import { AudioEngine } from "../AudioEngine";
import { dbToGain } from "../dsp";

export class PlayerSfx {
  readonly bus: GainNode;
  private readonly engine: AudioEngine;
  private lastAt = -1;

  constructor(engine: AudioEngine, opts: { levelDb?: number; reverbDb?: number } = {}) {
    this.engine = engine;
    this.bus = engine.createBus("sfx-player", opts.reverbDb ?? -18);
    this.bus.gain.value = dbToGain(opts.levelDb ?? -6);
  }

  /** Landing footfall; `strength` 0..1 (impact speed relative to the 0.32 m hop). */
  footfall(strength = 1): void {
    const engine = this.engine;
    const ctx = engine.ctx;
    const rng = engine.rng;
    const t = engine.now + 0.005;
    // Two landings inside 80 ms would be one — the mixer never gets a doubled thump.
    if (t - this.lastAt < 0.08) return;
    this.lastAt = t;
    const s = Math.max(0.25, Math.min(1, strength));
    engine.logEvent("sfx.footfall", t, 0.12);

    const out = ctx.createGain();
    out.gain.value = dbToGain(-20) * (0.55 + 0.45 * s);
    out.connect(this.bus);

    // Thump: brown noise through a low-pass around 120 Hz with a resonant edge.
    const thump = engine.noiseSource("brown", 1, t);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = rng.range(95, 140);
    lp.Q.value = 1.6;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0, t);
    tg.gain.linearRampToValueAtTime(2.2, t + 0.006);
    tg.gain.setTargetAtTime(0, t + 0.008, 0.045 * (0.8 + 0.4 * s));
    thump.connect(lp);
    lp.connect(tg);
    tg.connect(out);
    thump.stop(t + 0.4);

    // Body: a touch of 200–400 Hz so it is a shoe and not a subwoofer test.
    const body = ctx.createBiquadFilter();
    body.type = "bandpass";
    body.frequency.value = rng.range(220, 380);
    body.Q.value = 0.9;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(0.35, t + 0.004);
    bg.gain.setTargetAtTime(0, t + 0.006, 0.02);
    thump.connect(body);
    body.connect(bg);
    bg.connect(out);

    // Scuff: the soles settling — a short 1.5–3 kHz grit 10–20 ms after the thump.
    const t2 = t + rng.range(0.01, 0.02);
    const scuff = engine.noiseSource("white", 1, t2);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = rng.range(1500, 3000);
    bp.Q.value = 0.7;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, t2);
    sg.gain.linearRampToValueAtTime(0.06 * s, t2 + 0.004);
    sg.gain.setTargetAtTime(0, t2 + 0.006, 0.018);
    scuff.connect(bp);
    bp.connect(sg);
    sg.connect(out);
    scuff.stop(t2 + 0.2);

    scuff.addEventListener("ended", () => out.disconnect(), { once: true });
  }
}
