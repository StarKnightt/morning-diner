/**
 * AudioEngine — the diner's audio backbone.
 *
 *   sources → PannerNode (HRTF, inverse distance) → layer bus → sum bus
 *             layer bus → reverb send → ConvolverNode (procedural IR) → sum bus
 *   sum bus → gentle compressor/limiter → master gain → destination
 *
 * Works on a real-time AudioContext (created lazily on the first user gesture)
 * or on an OfflineAudioContext (the harness renders the same graph to a WAV).
 * Nothing here runs per-sample JavaScript; the graph is a few dozen native nodes.
 *
 * Coordinates are the scene's: +x along the room, +y up, +z toward the windows,
 * metres. Interior is 11 × 5.85 × 2.9 m, so distances are 0.5–12 m and the
 * distance model is tuned for that range.
 */
import { Rng, dbToGain, makeNoiseBuffer, makeRoomImpulse, type NoiseColor } from "./dsp";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Anything the engine advances once per frame. */
export interface Tickable {
  /** Schedule events up to `now + lookahead` seconds of context time. */
  tick(now: number, lookahead: number): void;
}

export interface SpatialHandle {
  readonly panner: PannerNode;
  setPosition(p: Vec3): void;
  disconnect(): void;
}

export interface LayerBus {
  /** Post-spatialisation output of one ambient layer (harness solo/mute and metering). */
  readonly bus: GainNode;
  readonly name: string;
}

export interface AttachOptions {
  /** "HRTF" for fixed emitters across the room; "equalpower" for near one-shots (keeps L/R in phase). */
  model?: PanningModelType;
  refDistance?: number;
  rolloffFactor?: number;
}

/** A scheduled sound event, for the harness's timeline and level checks. */
export interface AudioEvent {
  name: string;
  t: number;
  dur: number;
}

export interface AudioEngineOptions {
  /** Provide an existing (possibly offline) context; otherwise one is created. */
  context?: BaseAudioContext;
  /** Seed for every random decision: event timing, noise buffers, impulse response. */
  seed?: number;
  /** Master trim in dB applied after the limiter. */
  masterDb?: number;
}

/** How far ahead of the clock event schedulers may place automation. */
export const LOOKAHEAD_S = 0.6;

const DISTANCE = {
  refDistance: 1.0,
  maxDistance: 18,
  rolloffFactor: 0.55,
} as const;

export class AudioEngine implements Tickable {
  readonly ctx: BaseAudioContext;
  readonly rng: Rng;
  /** Pre-compressor sum of every layer. */
  readonly input: GainNode;
  readonly compressor: DynamicsCompressorNode;
  readonly master: GainNode;
  readonly reverb: ConvolverNode;
  private readonly reverbReturn: GainNode;
  private readonly noise = new Map<NoiseColor, AudioBuffer>();
  private readonly layers: Tickable[] = [];
  /** Every discrete event any layer scheduled (context time). Harness only reads it. */
  readonly events: AudioEvent[] = [];
  private masterDb: number;
  private volume = 1;

  constructor(opts: AudioEngineOptions = {}) {
    this.ctx =
      opts.context ??
      new AudioContext({ latencyHint: "playback", sampleRate: 48000 });
    this.rng = new Rng(opts.seed ?? 20260902);
    this.masterDb = opts.masterDb ?? 0;

    const ctx = this.ctx;
    this.input = ctx.createGain();

    // Gentle safety limiter. Ambience lives 30–40 dB under the threshold, so
    // this only ever touches the door and the coffee pour. (Chromium's
    // compressor applies automatic make-up gain, which is why the master trim
    // below is calibrated with the harness rather than assumed.)
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -10;
    this.compressor.knee.value = 6;
    this.compressor.ratio.value = 8;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.18;

    this.master = ctx.createGain();
    this.master.gain.value = dbToGain(this.masterDb);

    this.reverb = ctx.createConvolver();
    this.reverb.normalize = false;
    this.reverb.buffer = makeRoomImpulse(ctx, this.rng.fork(), {
      seconds: 0.78,
      lowCutHz: 240,
      highCutHz: 7000,
    });
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 1;

    this.input.connect(this.compressor);
    this.compressor.connect(this.master);
    this.master.connect(ctx.destination);
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.input);

    this.setListener({ x: 0, y: 1.62, z: 0.9 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  /** Resume a suspended real-time context (call from a user gesture). */
  async resume(): Promise<void> {
    if (typeof OfflineAudioContext !== "undefined" && this.ctx instanceof OfflineAudioContext) return;
    const ctx = this.ctx as AudioContext;
    if (ctx.state !== "running") await ctx.resume();
  }

  /** 0..1 user volume, multiplied with the calibrated master trim. */
  setMasterVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    const g = dbToGain(this.masterDb) * this.volume;
    this.master.gain.setTargetAtTime(g, this.now, 0.05);
  }

  /** A cached coloured-noise buffer shared by every consumer of that colour. */
  noiseBuffer(color: NoiseColor): AudioBuffer {
    let b = this.noise.get(color);
    if (!b) {
      const seconds = color === "white" ? 7.31 : color === "pink" ? 9.17 : 11.03;
      b = makeNoiseBuffer(this.ctx, seconds, color, this.rng.fork());
      this.noise.set(color, b);
    }
    return b;
  }

  /**
   * Looping noise source, started at a random offset so two consumers of the
   * same buffer are decorrelated. `rate` detunes the loop length as well.
   */
  noiseSource(color: NoiseColor, rate = 1, when = this.now): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(color);
    src.loop = true;
    src.playbackRate.value = rate;
    src.start(when, this.rng.next() * src.buffer.duration);
    return src;
  }

  /** Create a named layer bus feeding the sum, with an optional reverb send. */
  createBus(name: string, reverbDb = -Infinity): GainNode & { layerName: string } {
    const bus = this.ctx.createGain() as GainNode & { layerName: string };
    bus.layerName = name;
    bus.connect(this.input);
    if (Number.isFinite(reverbDb)) {
      const send = this.ctx.createGain();
      send.gain.value = dbToGain(reverbDb);
      bus.connect(send);
      send.connect(this.reverb);
    }
    return bus;
  }

  /**
   * Spatialise `source` at a world position. Output goes to `into` (a layer
   * bus, or the sum bus by default). HRTF, inverse distance model, tuned so a
   * source across the 11 m room is roughly -18 dB and one beside you is 0 dB.
   */
  attach(source: AudioNode, position: Vec3, into: AudioNode = this.input, opts: AttachOptions = {}): SpatialHandle {
    const p = this.ctx.createPanner();
    p.panningModel = opts.model ?? "HRTF";
    p.distanceModel = "inverse";
    p.refDistance = opts.refDistance ?? DISTANCE.refDistance;
    p.maxDistance = DISTANCE.maxDistance;
    p.rolloffFactor = opts.rolloffFactor ?? DISTANCE.rolloffFactor;
    p.coneInnerAngle = 360;
    p.coneOuterAngle = 360;
    setPannerPosition(p, position, this.now);
    source.connect(p);
    p.connect(into);
    let connected = true;
    return {
      panner: p,
      setPosition: (np) => setPannerPosition(p, np, this.now),
      disconnect: () => {
        if (!connected) return;
        connected = false;
        try {
          source.disconnect(p);
        } catch {
          /* source already gone */
        }
        p.disconnect();
      },
    };
  }

  /** Listener pose, updated per frame from the camera. */
  setListener(position: Vec3, forward: Vec3, up: Vec3): void {
    const l = this.ctx.listener;
    const t = this.now;
    if (l.positionX) {
      // Short time constant: smooth enough to avoid zipper noise in HRTF, fast
      // enough that head turns feel immediate.
      const tau = 0.025;
      l.positionX.setTargetAtTime(position.x, t, tau);
      l.positionY.setTargetAtTime(position.y, t, tau);
      l.positionZ.setTargetAtTime(position.z, t, tau);
      l.forwardX.setTargetAtTime(forward.x, t, tau);
      l.forwardY.setTargetAtTime(forward.y, t, tau);
      l.forwardZ.setTargetAtTime(forward.z, t, tau);
      l.upX.setTargetAtTime(up.x, t, tau);
      l.upY.setTargetAtTime(up.y, t, tau);
      l.upZ.setTargetAtTime(up.z, t, tau);
    } else {
      // Legacy API (Safari).
      const legacy = l as AudioListener & {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void;
      };
      legacy.setPosition(position.x, position.y, position.z);
      legacy.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  /** Immediately pin the listener (no smoothing) — used by the offline harness. */
  setListenerImmediate(position: Vec3, forward: Vec3, up: Vec3): void {
    const l = this.ctx.listener;
    if (!l.positionX) return this.setListener(position, forward, up);
    l.positionX.value = position.x;
    l.positionY.value = position.y;
    l.positionZ.value = position.z;
    l.forwardX.value = forward.x;
    l.forwardY.value = forward.y;
    l.forwardZ.value = forward.z;
    l.upX.value = up.x;
    l.upY.value = up.y;
    l.upZ.value = up.z;
  }

  register(layer: Tickable): void {
    this.layers.push(layer);
  }

  /** Record a discrete event (kept bounded; the harness reads it after rendering). */
  logEvent(name: string, t: number, dur: number): void {
    if (this.events.length > 2000) this.events.splice(0, 1000);
    this.events.push({ name, t, dur });
  }

  /** Advance every event scheduler. Call once per frame (or per offline suspend). */
  tick(now = this.now, lookahead = LOOKAHEAD_S): void {
    for (const l of this.layers) l.tick(now, lookahead);
  }
}

function setPannerPosition(p: PannerNode, pos: Vec3, t: number): void {
  if (p.positionX) {
    p.positionX.setValueAtTime(pos.x, t);
    p.positionY.setValueAtTime(pos.y, t);
    p.positionZ.setValueAtTime(pos.z, t);
  } else {
    (p as PannerNode & { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
  }
}
