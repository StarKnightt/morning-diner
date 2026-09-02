/**
 * Shared DSP helpers for the procedural sound design. Everything audible in the
 * diner is built from these: a seeded PRNG (so the offline harness renders the
 * same mix twice), dB conversions, coloured-noise buffers filled with math, and
 * the procedurally generated room impulse response.
 *
 * No audio files, no fetch. All buffers are computed once per engine.
 */

/** Small, fast, seedable PRNG (mulberry32). */
export class Rng {
  private s: number;

  constructor(seed = 0x9e3779b9) {
    this.s = seed >>> 0 || 1;
  }

  /** Uniform [0, 1). */
  next(): number {
    let t = (this.s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Symmetric [-1, 1). */
  signed(): number {
    return this.next() * 2 - 1;
  }

  /** Approximately normal, mean 0, sd 1 (sum of 4 uniforms). */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * Math.SQRT2 * 1.2247;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))];
  }

  /** Fork a child generator so subsystems don't perturb each other's streams. */
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 0xffffffff) ^ 0x5bd1e995);
  }
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(g, 1e-12));
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export type NoiseColor = "white" | "pink" | "brown";

/**
 * Mono noise buffer, normalised to a fixed RMS of 0.25 (-12 dBFS) so gain math
 * downstream is predictable regardless of colour. Lengths are odd fractions of
 * a second so two looping sources never realign.
 */
export function makeNoiseBuffer(ctx: BaseAudioContext, seconds: number, color: NoiseColor, rng: Rng): AudioBuffer {
  const n = Math.max(1, Math.floor(seconds * ctx.sampleRate));
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  if (color === "white") {
    for (let i = 0; i < n; i++) data[i] = rng.signed();
  } else if (color === "pink") {
    // Paul Kellet's economy pink filter (-3 dB/oct, accurate to ±0.5 dB over the audible band).
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = rng.signed();
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  } else {
    // Brown: leaky integrator of white (-6 dB/oct above ~30 Hz). The leak keeps
    // it bounded and stops sub-audio wander from reading as DC in short windows.
    const leak = Math.exp((-2 * Math.PI * 30) / ctx.sampleRate);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc = acc * leak + rng.signed() * 0.02;
      data[i] = acc;
    }
  }

  // Remove residual DC and normalise RMS. Loop seams are masked by the
  // modulation every consumer applies, and buffers are 7-13 s long.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += data[i];
  mean /= n;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    data[i] -= mean;
    sq += data[i] * data[i];
  }
  const rms = Math.sqrt(sq / n) || 1;
  const k = 0.25 / rms;
  for (let i = 0; i < n; i++) data[i] *= k;
  return buffer;
}

export interface RoomImpulseOptions {
  /** Tail length in seconds (roughly the RT60). */
  seconds?: number;
  /** Early reflection delays in seconds (hard surfaces a few metres away). */
  earlyTaps?: readonly number[];
  /** One-pole high-pass on the tail: hard tile and glass keep highs, thin walls leak lows. */
  lowCutHz?: number;
  /** One-pole low-pass to keep the tail from fizzing. */
  highCutHz?: number;
}

/**
 * Stereo impulse response of a small hard room: sparse early reflections, then
 * exponentially decaying noise with a brighter-than-neutral spectrum. Each
 * channel is normalised to unit energy so a stationary signal through the
 * convolver comes out at the same RMS it went in; the send gain sets the wet level.
 */
export function makeRoomImpulse(ctx: BaseAudioContext, rng: Rng, opts: RoomImpulseOptions = {}): AudioBuffer {
  const seconds = opts.seconds ?? 0.75;
  const taps = opts.earlyTaps ?? [0.0061, 0.0094, 0.0137, 0.0183, 0.0242, 0.0311, 0.0397, 0.0486];
  const lowCut = opts.lowCutHz ?? 220;
  const highCut = opts.highCutHz ?? 6500;
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const ir = ctx.createBuffer(2, n, sr);

  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    const decay = 6.9078 / seconds; // ln(1000): -60 dB at `seconds`
    // Tail: decorrelated noise, bright, with a short build so the tail doesn't start as a click.
    const hpK = Math.exp((-2 * Math.PI * lowCut) / sr);
    const lpK = Math.exp((-2 * Math.PI * highCut) / sr);
    let hpPrevIn = 0, hpPrevOut = 0, lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const w = rng.signed();
      hpPrevOut = hpK * (hpPrevOut + w - hpPrevIn);
      hpPrevIn = w;
      lp += (1 - lpK) * (hpPrevOut - lp);
      const build = Math.min(1, t / 0.012);
      d[i] = lp * build * Math.exp(-decay * t);
    }
    // Early reflections: discrete taps with slightly different timing per ear.
    for (let k = 0; k < taps.length; k++) {
      const t = taps[k] * (1 + rng.range(-0.08, 0.08)) + (ch === 1 ? 0.0004 : 0);
      const idx = Math.floor(t * sr);
      if (idx < n) {
        const g = 0.9 * Math.pow(0.78, k) * (rng.chance(0.5) ? 1 : -1);
        d[idx] += g;
        if (idx + 1 < n) d[idx + 1] += g * 0.35; // one-sample smear so the tap isn't a pure Dirac
      }
    }
    let e = 0;
    for (let i = 0; i < n; i++) e += d[i] * d[i];
    const k = 1 / Math.sqrt(e || 1);
    for (let i = 0; i < n; i++) d[i] *= k;
  }
  return ir;
}

/** Soft-saturation curve for a WaveShaperNode (tanh-ish, unity gain at small signal). */
export function makeSaturationCurve(drive = 1.5, samples = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  const norm = Math.tanh(drive);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
}

/** Cancel pending automation and pin the param at a value from time `t`. */
export function holdParam(param: AudioParam, value: number, t: number): void {
  param.cancelScheduledValues(t);
  param.setValueAtTime(value, t);
}

/**
 * Schedules a simple attack/hold/release envelope on a gain param.
 * Returns the time at which the envelope has fully closed.
 */
export function envelope(
  param: AudioParam,
  t: number,
  peak: number,
  attack: number,
  hold: number,
  release: number,
  floor = 0,
): number {
  param.setValueAtTime(floor, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setValueAtTime(peak, t + attack + hold);
  // Exponential-ish release: setTargetAtTime reaches ~-40 dB after 4.6 tau.
  param.setTargetAtTime(floor, t + attack + hold, release / 4.6);
  return t + attack + hold + release;
}
