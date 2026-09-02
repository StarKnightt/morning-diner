/**
 * The coffee pot on the back-bar warmer.
 *
 * A constant faint hiss from the hot plate (2.8–4.5 kHz), and 2–4 discrete events
 * per 30 s drawn from a shuffled bag so no two in a row are alike (a gurgle or
 * steam is usually followed by the thermostat a couple of seconds later):
 *   tick    thermostat relay, 3–8 kHz, ~5 ms
 *   gurgle  the last of the brew settling: 200–800 Hz with an 8–15 Hz burble, 0.3–0.8 s
 *   steam   a drop flashing on the plate: 3–8 kHz swell, 1–2 s
 * Very quiet — you notice it only because the room is so still.
 */
import { AudioEngine, type Vec3 } from "../AudioEngine";
import { dbToGain } from "../dsp";
import { AmbientLayer } from "../Layer";

/** Measured with the harness: a tick peaks this far below the `out` gain at 1 m. */
const CAL_DB = 7.5;

export interface CoffeeWarmerOptions {
  /** Peak level of a thermostat tick at 1 m, dBFS. */
  levelDb?: number;
  reverbDb?: number;
}

type EventKind = "tick" | "gurgle" | "steam";

export class CoffeeWarmer extends AmbientLayer {
  private readonly out: GainNode;
  private readonly tickGain: GainNode;
  private readonly tickBp: BiquadFilterNode;
  private readonly steamGain: GainNode;
  private readonly steamBp: BiquadFilterNode;
  private readonly gurgleGain: GainNode;
  private readonly gurgleBp: BiquadFilterNode;
  private readonly burble: OscillatorNode;
  private readonly burbleDepth: GainNode;
  private bag: EventKind[] = [];

  constructor(engine: AudioEngine, position: Vec3, opts: CoffeeWarmerOptions = {}) {
    super(engine, "coffee", opts.reverbDb ?? -14);
    const ctx = engine.ctx;
    const t0 = engine.now;
    this.out = ctx.createGain();
    this.out.gain.value = dbToGain((opts.levelDb ?? -27) + CAL_DB);

    // ---- constant plate hiss, 2–6 kHz ------------------------------------------------
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
    plateGain.gain.value = 0.7;
    plate.connect(plateHp);
    plateHp.connect(plateHp2);
    plateHp2.connect(plateLp);
    plateLp.connect(plateLp2);
    plateLp2.connect(plateGain);
    plateGain.connect(this.out);
    this.wander(plateGain.gain, { min: 0.55, max: 0.85, minHold: 4, maxHold: 12, tau: 2.5 });

    // ---- tick: 3–8 kHz, 5 ms ---------------------------------------------------------------
    const tickSrc = engine.noiseSource("white", 1.01, t0);
    this.tickBp = ctx.createBiquadFilter();
    this.tickBp.type = "bandpass";
    this.tickBp.frequency.value = 5000;
    this.tickBp.Q.value = 0.9;
    this.tickGain = ctx.createGain();
    this.tickGain.gain.value = 0;
    tickSrc.connect(this.tickBp);
    this.tickBp.connect(this.tickGain);
    this.tickGain.connect(this.out);

    // ---- steam swell: 3–8 kHz, 1–2 s ------------------------------------------------------
    const steamSrc = engine.noiseSource("white", 0.98, t0);
    this.steamBp = ctx.createBiquadFilter();
    this.steamBp.type = "bandpass";
    this.steamBp.frequency.value = 5000;
    this.steamBp.Q.value = 0.7;
    this.steamGain = ctx.createGain();
    this.steamGain.gain.value = 0;
    steamSrc.connect(this.steamBp);
    this.steamBp.connect(this.steamGain);
    this.steamGain.connect(this.out);

    // ---- gurgle: 200–800 Hz with 8–15 Hz burble AM ------------------------------------------
    const gurgleSrc = engine.noiseSource("pink", 0.99, t0);
    this.gurgleBp = ctx.createBiquadFilter();
    this.gurgleBp.type = "bandpass";
    this.gurgleBp.frequency.value = 400;
    this.gurgleBp.Q.value = 2.5;
    const gurgleHp = ctx.createBiquadFilter();
    gurgleHp.type = "highpass";
    gurgleHp.frequency.value = 200;
    gurgleHp.Q.value = 0.7;
    const burbled = ctx.createGain();
    burbled.gain.value = 1;
    this.burble = ctx.createOscillator();
    this.burble.frequency.value = 11;
    this.burbleDepth = ctx.createGain();
    this.burbleDepth.gain.value = 0.7;
    this.burble.connect(this.burbleDepth);
    this.burbleDepth.connect(burbled.gain);
    this.burble.start(t0);
    this.gurgleGain = ctx.createGain();
    this.gurgleGain.gain.value = 0;
    gurgleSrc.connect(gurgleHp);
    gurgleHp.connect(this.gurgleBp);
    this.gurgleBp.connect(burbled);
    burbled.connect(this.gurgleGain);
    this.gurgleGain.connect(this.out);

    // 2–4 events per 30 s.
    this.every(7, 15, (t) => this.scheduleEvent(t), 1.5);

    engine.attach(this.out, position, this.bus);
  }

  private nextKind(): EventKind {
    if (this.bag.length === 0) {
      const kinds: EventKind[] = ["tick", "gurgle", "steam", "tick", "gurgle"];
      // Fisher–Yates.
      for (let i = kinds.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng.range(0, i + 1));
        [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
      }
      this.bag = kinds;
    }
    return this.bag.pop()!;
  }

  private scheduleEvent(t: number): void {
    const kind = this.nextKind();
    if (kind === "tick") {
      this.scheduleTick(t);
      return;
    }
    if (kind === "gurgle") this.scheduleGurgle(t);
    else this.scheduleSteam(t);
    // Water on the plate cools it; the thermostat usually clicks back in a moment later.
    if (this.rng.chance(0.65)) this.scheduleTick(t + this.rng.range(1.2, 3.0));
  }

  private scheduleTick(t: number): void {
    const rng = this.rng;
    this.tickBp.frequency.setValueAtTime(rng.range(3800, 6500), t);
    const g = this.tickGain.gain;
    const peak = rng.range(1.0, 1.3);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + 0.0007);
    g.setTargetAtTime(0, t + 0.0015, 0.0012);
    // Relay arms often double-bounce.
    if (rng.chance(0.4)) {
      const t2 = t + rng.range(0.03, 0.07);
      g.setValueAtTime(0, t2);
      g.linearRampToValueAtTime(peak * 0.5, t2 + 0.0006);
      g.setTargetAtTime(0, t2 + 0.0012, 0.001);
    }
    this.engine.logEvent("coffee.tick", t, 0.08);
  }

  private scheduleGurgle(t: number): void {
    const rng = this.rng;
    const dur = rng.range(0.3, 0.8);
    const f0 = rng.range(250, 450);
    // The bubble column rises in pitch as it empties.
    this.gurgleBp.frequency.setValueAtTime(f0, t);
    this.gurgleBp.frequency.exponentialRampToValueAtTime(Math.min(800, f0 * rng.range(1.4, 2.0)), t + dur);
    this.burble.frequency.setValueAtTime(rng.range(8, 15), t);
    this.burbleDepth.gain.setValueAtTime(rng.range(0.55, 0.85), t);
    const g = this.gurgleGain.gain;
    // Pink noise through a Q-2.5 band-pass keeps ~6 % of its power: make it up here.
    const peak = rng.range(1.6, 2.4);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + 0.05);
    g.setValueAtTime(peak, t + dur * 0.7);
    g.setTargetAtTime(0, t + dur * 0.7, dur * 0.1);
    this.engine.logEvent("coffee.gurgle", t, dur);
  }

  private scheduleSteam(t: number): void {
    const rng = this.rng;
    const dur = rng.range(1.0, 2.0);
    const f = rng.range(4000, 6500);
    this.steamBp.frequency.setValueAtTime(f, t);
    this.steamBp.frequency.setTargetAtTime(f * 0.75, t + dur * 0.3, dur * 0.4);
    const g = this.steamGain.gain;
    const peak = rng.range(2.0, 2.9);
    g.setValueAtTime(0, t);
    g.setTargetAtTime(peak, t, dur * 0.18);
    g.setTargetAtTime(0, t + dur * 0.45, dur * 0.18);
    this.engine.logEvent("coffee.steam", t, dur);
  }
}
