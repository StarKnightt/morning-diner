/**
 * The coffee pot on the back-bar warmer: mostly silent, then a short hiss as a
 * drop hits the hot plate, or a cluster of bubbly gurgles as the last of the
 * brew settles. Random events every 8–25 s. Very quiet — you notice it only
 * because the room is so still.
 */
import { AudioEngine, type Vec3 } from "../AudioEngine";
import { dbToGain, envelope } from "../dsp";
import { AmbientLayer } from "../Layer";

export interface CoffeeWarmerOptions {
  /** Peak level of a hiss at 1 m, dBFS. */
  levelDb?: number;
  reverbDb?: number;
}

/** Measured with the harness: a hiss peaks this far below the `out` gain at 1 m. */
const CAL_DB = 17.6;

export class CoffeeWarmer extends AmbientLayer {
  private readonly hissGain: GainNode;
  private readonly hissBp: BiquadFilterNode;
  private readonly pingGain: GainNode;
  private readonly pingBp: BiquadFilterNode;
  private readonly plateGain: GainNode;

  constructor(engine: AudioEngine, position: Vec3, opts: CoffeeWarmerOptions = {}) {
    super(engine, "coffee", opts.reverbDb ?? -14);
    const ctx = engine.ctx;
    const t0 = engine.now;
    const out = ctx.createGain();
    out.gain.value = dbToGain((opts.levelDb ?? -35) + CAL_DB);

    // ---- hiss: water flashing on the hot plate --------------------------------
    const noise = engine.noiseSource("white", 1.01, t0);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2000;
    hp.Q.value = 0.7;
    this.hissBp = ctx.createBiquadFilter();
    this.hissBp.type = "bandpass";
    this.hissBp.frequency.value = 4200;
    this.hissBp.Q.value = 0.9;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    noise.connect(hp);
    hp.connect(this.hissBp);
    this.hissBp.connect(this.hissGain);
    this.hissGain.connect(out);

    // ---- gurgle: resonant pings from the pot ----------------------------------
    const pingSrc = engine.noiseSource("white", 0.99, t0);
    this.pingBp = ctx.createBiquadFilter();
    this.pingBp.type = "bandpass";
    this.pingBp.frequency.value = 600;
    this.pingBp.Q.value = 14;
    this.pingGain = ctx.createGain();
    this.pingGain.gain.value = 0;
    pingSrc.connect(this.pingBp);
    this.pingBp.connect(this.pingGain);
    this.pingGain.connect(out);

    // ---- the plate itself: faint steady sizzle under everything -----------------
    const plate = engine.noiseSource("white", 0.95, t0);
    const plateBp = ctx.createBiquadFilter();
    plateBp.type = "bandpass";
    plateBp.frequency.value = 5200;
    plateBp.Q.value = 1.4;
    this.plateGain = ctx.createGain();
    this.plateGain.gain.value = 0.06;
    plate.connect(plateBp);
    plateBp.connect(this.plateGain);
    this.plateGain.connect(out);
    this.wander(this.plateGain.gain, { min: 0.02, max: 0.1, minHold: 4, maxHold: 12, tau: 2.5 });

    this.every(8, 25, (t) => this.scheduleEvent(t), 3);

    engine.attach(out, position, this.bus);
  }

  private scheduleEvent(t: number): void {
    const rng = this.rng;
    const roll = rng.next();
    if (roll < 0.45) this.scheduleHiss(t);
    else if (roll < 0.8) this.scheduleGurgle(t);
    else {
      // Both: a gurgle that ends in a hiss as the surge hits the plate.
      const end = this.scheduleGurgle(t);
      this.scheduleHiss(end + rng.range(0.05, 0.25), 0.7);
    }
  }

  private scheduleHiss(t: number, scale = 1): void {
    const rng = this.rng;
    const dur = rng.range(0.45, 0.8);
    const f = rng.range(3200, 5200);
    this.hissBp.frequency.setValueAtTime(f, t);
    // Falls in pitch slightly as the drop boils away.
    this.hissBp.frequency.setTargetAtTime(f * 0.8, t + 0.05, dur * 0.5);
    envelope(this.hissGain.gain, t, rng.range(0.5, 0.9) * scale, 0.012, 0.04, dur);
  }

  /** Returns the time the last ping starts. */
  private scheduleGurgle(t: number): number {
    const rng = this.rng;
    const n = 3 + Math.floor(rng.range(0, 6));
    let time = t;
    let f = rng.range(300, 600);
    for (let i = 0; i < n; i++) {
      // Each bubble a little higher and quicker than the last, on average.
      f = Math.min(900, f * rng.range(0.95, 1.22));
      this.pingBp.frequency.setValueAtTime(f, time);
      const g = this.pingGain.gain;
      const peak = rng.range(0.35, 0.8);
      g.setValueAtTime(0, time);
      g.linearRampToValueAtTime(peak, time + 0.004);
      g.setTargetAtTime(0, time + 0.006, rng.range(0.02, 0.05));
      time += rng.range(0.06, 0.2);
    }
    return time;
  }
}
