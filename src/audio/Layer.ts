/**
 * Base class for the ambient layers plus two tiny scheduling helpers.
 *
 * Every layer owns a bus (post-spatialisation) so the harness can solo, mute
 * and meter it, and a forked PRNG so its decisions never disturb another
 * layer's stream. Layers schedule audio-param automation ahead of the clock
 * from `tick()`; nothing is timed with setTimeout, so the same code renders
 * identically into an OfflineAudioContext.
 */
import type { AudioEngine, Tickable } from "./AudioEngine";
import type { Rng } from "./dsp";

export abstract class AmbientLayer implements Tickable {
  readonly name: string;
  readonly bus: GainNode;
  protected readonly engine: AudioEngine;
  protected readonly rng: Rng;
  protected readonly wanders: Wander[] = [];
  protected readonly clocks: EventClock[] = [];

  protected constructor(engine: AudioEngine, name: string, reverbDb: number) {
    this.engine = engine;
    this.name = name;
    this.rng = engine.rng.fork();
    this.bus = engine.createBus(name, reverbDb);
    engine.register(this);
  }

  /** Harness-only: mute/unmute the whole layer. The shipped scene never calls this. */
  setEnabled(on: boolean): void {
    this.bus.gain.setTargetAtTime(on ? 1 : 0, this.engine.now, 0.03);
  }

  tick(now: number, lookahead: number): void {
    for (const w of this.wanders) w.tick(now, lookahead);
    for (const c of this.clocks) c.tick(now, lookahead);
  }

  protected wander(param: AudioParam, opts: WanderOptions): Wander {
    const w = new Wander(param, opts, this.rng.fork());
    this.wanders.push(w);
    return w;
  }

  protected every(minGap: number, maxGap: number, fire: (t: number) => void, firstDelay = 0): EventClock {
    const c = new EventClock(minGap, maxGap, fire, this.rng.fork(), firstDelay);
    this.clocks.push(c);
    return c;
  }
}

export interface WanderOptions {
  min: number;
  max: number;
  /** Seconds between new targets. */
  minHold: number;
  maxHold: number;
  /** Time constant of the glide to each new target. */
  tau: number;
}

/**
 * Aperiodic slow modulation: glide an AudioParam to a fresh random target
 * every few seconds. Two of these on different parameters is enough to make
 * a loop never repeat.
 */
export class Wander {
  private next = 0;

  constructor(
    private readonly param: AudioParam,
    private readonly o: WanderOptions,
    private readonly rng: Rng,
  ) {}

  tick(now: number, lookahead: number): void {
    if (this.next === 0) this.next = now;
    while (this.next < now + lookahead) {
      const v = this.rng.range(this.o.min, this.o.max);
      this.param.setTargetAtTime(v, this.next, this.o.tau);
      this.next += this.rng.range(this.o.minHold, this.o.maxHold);
    }
  }
}

/** Fires `fire(t)` at random intervals in [minGap, maxGap]. */
export class EventClock {
  private next = -1;

  constructor(
    private readonly minGap: number,
    private readonly maxGap: number,
    private readonly fire: (t: number) => void,
    private readonly rng: Rng,
    private readonly firstDelay: number,
  ) {}

  tick(now: number, lookahead: number): void {
    if (this.next < 0) this.next = now + this.firstDelay + this.rng.range(0, this.minGap);
    while (this.next < now + lookahead) {
      this.fire(this.next);
      this.next += this.rng.range(this.minGap, this.maxGap);
    }
  }
}
