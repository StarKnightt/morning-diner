/**
 * System 6 — sound design for the Morning Diner.
 *
 *   const audio = createDinerAudio();          // nothing is created yet
 *   canvas.addEventListener("click", () => audio.start(), { once: true });
 *   ... per frame: audio.update(camera);
 *   ... System 7: audio.sfx.pourCoffee(3), audio.sfx.doorOpen(), audio.sfx.setOutside(angle / maxAngle)
 *
 * Everything is synthesised; there is no UI and the ambience is not
 * interactive. `start()` must be called from a user gesture (browsers refuse
 * to run an AudioContext otherwise) — the visual side calls it on pointer lock.
 */
import { Quaternion, Vector3, type Camera } from "three";
import { BACK_BAR, COUNTER, DOOR, FAN, PASS_THROUGH, REGISTER, ROOM, WINDOW } from "../scene/layout";
import { AudioEngine, type Vec3 } from "./AudioEngine";
import { AirConditioner } from "./ambience/AirConditioner";
import { CeilingFan } from "./ambience/CeilingFan";
import { CoffeeWarmer } from "./ambience/CoffeeWarmer";
import { Kitchen } from "./ambience/Kitchen";
import { Radio } from "./ambience/Radio";
import { RoomTone } from "./ambience/RoomTone";
import type { AmbientLayer } from "./Layer";
import { CoffeeSfx } from "./sfx/Coffee";
import { DoorSfx } from "./sfx/Door";
import { OpenablesSfx } from "./sfx/Openables";
import { PlayerSfx } from "./sfx/Player";

export type { Vec3 } from "./AudioEngine";
export { AudioEngine } from "./AudioEngine";
export type { AmbientLayer } from "./Layer";

export interface DinerAudioPositions {
  /** Radio on the back bar, behind the counter. */
  radio?: Vec3;
  /** Window air-conditioner. */
  ac?: Vec3;
  /** Ceiling fan hub. */
  fan?: Vec3;
  fanRpm?: number;
  fanBlades?: number;
  /** Coffee pot on the back-bar warmer. */
  coffeeWarmer?: Vec3;
  /** Centre of the front door leaf. */
  door?: Vec3;
  doorWidth?: number;
  /** Where the outside leaks in: window centres and the door. */
  openings?: Vec3[];
  /** Default mug position for pourCoffee / mugClink. */
  mug?: Vec3;
  /** System 9: the kitchen behind the pass-through — sink (dishes, tap) and radio (murmur) emitters. */
  kitchenSink?: Vec3;
  kitchenRadio?: Vec3;
}

export interface DinerAudioOptions {
  /** Supply a context (the offline harness does); otherwise created lazily in start(). */
  context?: BaseAudioContext;
  seed?: number;
  /** Master trim in dB. Calibrated with tools/audio-harness.mjs. */
  masterDb?: number;
}

export interface DinerSfx {
  pourCoffee(durationSeconds?: number, at?: Vec3): void;
  mugClink(at?: Vec3): void;
  doorOpen(): void;
  /** The leaf meeting the frame (latch). setOutside(0) after an opening fires it by itself. */
  doorClose(): void;
  /**
   * 0 = shut, 1 = wide open. Equal-power crossfade: the exterior heat wall in, the interior bed
   * down 3 dB. Per-frame calls (no `rampSeconds`) follow the leaf through a 0.25 s swell /
   * 0.07 s cut; with `rampSeconds` it is a linear ramp. Holds.
   */
  setOutside(amount: number, rampSeconds?: number): void;
  /** System 9: the player's landing after a hop; `strength` 0..1 from the impact speed. */
  footfall(strength?: number): void;
  /** System 9: drinking from the mug (liquid draw + swallow, at the listener). */
  sip(): void;
  /** Seats: vinyl taking / releasing the weight (`strength` 0..1) and a stool's swivel bearing (`amount` 0..1). */
  seatCreak(strength?: number): void;
  stoolSqueak(amount?: number): void;
  /** System 9 openables: cabinet magnetic catch (release / close) and its soft stop, at the door. */
  cabinetCatch(at: Vec3, phase: "release" | "close"): void;
  cabinetStop(at: Vec3): void;
  /** System 9 kitchen swing door: palm push, each pass through the frame (`speed` 0..1), the settle. */
  kitchenDoorPush(at: Vec3): void;
  kitchenDoorPass(at: Vec3, speed?: number): void;
  kitchenDoorSettle(at: Vec3): void;
}

export interface DinerAudio {
  /** Create/resume the context and build the graph. Idempotent. Call from a user gesture. */
  start(): Promise<void>;
  /** Per frame: moves the listener to the camera. Cheap; no-op before start(). */
  update(camera: Camera): void;
  readonly sfx: DinerSfx;
  setMasterVolume(v: number): void;
  readonly started: boolean;
  /** Present after start(). Exposed for the harness (solo/mute/meter). */
  readonly engine: AudioEngine | null;
  readonly layers: readonly AmbientLayer[];
  readonly door: DoorSfx | null;
  readonly coffee: CoffeeSfx | null;
  readonly playerSfx: PlayerSfx | null;
  readonly openablesSfx: OpenablesSfx | null;
}

/** Emitter positions derived from the floor plan (metres). */
export function defaultPositions(): Required<DinerAudioPositions> {
  const windowY = (WINDOW.sill + WINDOW.head) / 2;
  const door: Vec3 = { x: DOOR.centerX, y: 1.1, z: ROOM.zFront };
  return {
    radio: { x: 1.7, y: BACK_BAR.height + 0.15, z: BACK_BAR.zFront - 0.3 },
    ac: { x: -ROOM.halfX + 0.15, y: REGISTER.top - REGISTER.h / 2, z: REGISTER.z },
    fan: { x: FAN.x, y: ROOM.height - FAN.downrod - 0.08, z: FAN.z },
    fanRpm: FAN.rpm,
    fanBlades: 4,
    coffeeWarmer: { x: BACK_BAR.coffeeX, y: BACK_BAR.height + 0.2, z: BACK_BAR.zFront - BACK_BAR.depth / 2 },
    door,
    doorWidth: DOOR.width - 2 * DOOR.jamb,
    openings: [...WINDOW.centersX.map((x) => ({ x, y: windowY, z: ROOM.zFront })), door],
    mug: { x: 0.5, y: COUNTER.height + 0.05, z: COUNTER.topFrontZ - 0.2 },
    // feat-kitchen: the kitchen is walkable now (scene/Kitchen.ts), so the emitters sit where the
    // work is — the dishes at the 3-compartment sink on the +x wall, the radio on the line's
    // shelf under the hood (a few dm behind the pass, so the dining room still hears it there).
    kitchenSink: { x: ROOM.halfX - 0.4, y: 1.0, z: ROOM.zBack - ROOM.wallThickness - 1.6 },
    kitchenRadio: { x: PASS_THROUGH.centerX + 0.9, y: 1.4, z: ROOM.zBack - ROOM.wallThickness - 0.6 },
  };
}

class DinerAudioImpl implements DinerAudio {
  engine: AudioEngine | null = null;
  layers: AmbientLayer[] = [];
  door: DoorSfx | null = null;
  coffee: CoffeeSfx | null = null;
  playerSfx: PlayerSfx | null = null;
  openablesSfx: OpenablesSfx | null = null;
  readonly sfx: DinerSfx;
  private readonly pos: Required<DinerAudioPositions>;
  private readonly opts: DinerAudioOptions;
  private volume = 1;
  private pendingOutside = 0;
  private readonly tmpPos = new Vector3();
  private readonly tmpFwd = new Vector3();
  private readonly tmpUp = new Vector3();
  private readonly tmpQ = new Quaternion();

  constructor(positions: DinerAudioPositions, opts: DinerAudioOptions) {
    this.pos = { ...defaultPositions(), ...positions };
    this.opts = opts;
    this.sfx = {
      pourCoffee: (d = 3.5, at) => this.coffee?.pourCoffee(d, at),
      mugClink: (at) => this.coffee?.mugClink(at),
      doorOpen: () => this.door?.doorOpen(),
      doorClose: () => this.door?.doorClose(),
      setOutside: (a, ramp) => {
        this.pendingOutside = a;
        this.door?.setOutside(a, ramp);
      },
      footfall: (s) => this.playerSfx?.footfall(s),
      sip: () => this.playerSfx?.sip(),
      seatCreak: (s) => this.playerSfx?.seatCreak(s),
      stoolSqueak: (a) => this.playerSfx?.stoolSqueak(a),
      cabinetCatch: (at, phase) => this.openablesSfx?.cabinetCatch(at, phase),
      cabinetStop: (at) => this.openablesSfx?.cabinetStop(at),
      kitchenDoorPush: (at) => this.openablesSfx?.kitchenDoorPush(at),
      kitchenDoorPass: (at, s) => this.openablesSfx?.kitchenDoorPass(at, s),
      kitchenDoorSettle: (at) => this.openablesSfx?.kitchenDoorSettle(at),
    };
  }

  get started(): boolean {
    return this.engine !== null;
  }

  /**
   * Idempotent. The graph is built synchronously on the first call (whether or
   * not that call came from a gesture — a context created early simply sits
   * suspended with its schedulers primed at t = 0); every call, first or later,
   * then asks the context to resume, which the browser honours as soon as the
   * page has had a real gesture. Rev 3: the build used to wait on the first
   * resume() — in Chromium that promise pends until a gesture arrives, so a
   * premature first call postponed the whole build.
   */
  start(): Promise<void> {
    if (!this.engine) {
      const engine = new AudioEngine({
        context: this.opts.context,
        seed: this.opts.seed,
        masterDb: this.opts.masterDb ?? DEFAULT_MASTER_DB,
      });
      const p = this.pos;
      this.layers = [
        new AirConditioner(engine, p.ac),
        new CeilingFan(engine, p.fan, { rpm: p.fanRpm, blades: p.fanBlades }),
        new Radio(engine, p.radio),
        new CoffeeWarmer(engine, p.coffeeWarmer),
        new RoomTone(engine, { openings: p.openings }),
        new Kitchen(engine, p.kitchenSink, p.kitchenRadio),
      ];
      this.coffee = new CoffeeSfx(engine, p.mug);
      this.door = new DoorSfx(engine, p.door, p.doorWidth);
      this.door.setOutside(this.pendingOutside);
      this.playerSfx = new PlayerSfx(engine);
      this.openablesSfx = new OpenablesSfx(engine);
      engine.setMasterVolume(this.volume);
      // Prime the schedulers so the first second isn't empty.
      engine.tick();
      this.engine = engine;
    }
    // Non-fatal: a rejected/pending resume just means the next call (the next gesture) retries.
    return this.engine.resume().catch(() => undefined);
  }

  update(camera: Camera): void {
    const engine = this.engine;
    if (!engine) return;
    camera.getWorldPosition(this.tmpPos);
    camera.getWorldDirection(this.tmpFwd);
    camera.getWorldQuaternion(this.tmpQ);
    this.tmpUp.set(0, 1, 0).applyQuaternion(this.tmpQ);
    engine.setListener(this.tmpPos, this.tmpFwd, this.tmpUp);
    engine.tick();
  }

  setMasterVolume(v: number): void {
    this.volume = v;
    this.engine?.setMasterVolume(v);
  }
}

/**
 * Chromium's DynamicsCompressorNode applies automatic make-up gain (+4.0 dB
 * measured for the settings in AudioEngine). This trim cancels it so the mix
 * equals the layer sum whenever the limiter is idle, which is always, in the
 * ambience. Measured with tools/audio-harness.mjs.
 */
export const DEFAULT_MASTER_DB = -4;

export function createDinerAudio(positions: DinerAudioPositions = {}, opts: DinerAudioOptions = {}): DinerAudio {
  return new DinerAudioImpl(positions, opts);
}

/**
 * Convenience: start on the first click or keydown anywhere. The visual side
 * may instead call `audio.start()` from its own pointer-lock handler.
 */
export function startAudioOnGesture(audio: DinerAudio, target: EventTarget = window): () => void {
  const fire = (): void => {
    void audio.start();
    off();
  };
  const off = (): void => {
    target.removeEventListener("click", fire);
    target.removeEventListener("keydown", fire);
    target.removeEventListener("pointerdown", fire);
  };
  target.addEventListener("click", fire);
  target.addEventListener("keydown", fire);
  target.addEventListener("pointerdown", fire);
  return off;
}
