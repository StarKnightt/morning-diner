/**
 * System 9 openables: the two under-counter cabinet doors and the kitchen swing door
 * (geometry + hinge Groups from scene/Openables.ts). Both follow the System 7 rev 2
 * grammar: an anticipation beat before anything moves, SFX cued on the visual, seekable
 * and silent under a seek, and shadow-once — `consumeSettled()` reports true exactly once
 * when a leaf comes to rest so index.ts re-renders the shadow maps then, not per frame.
 *
 * Cabinet door (a 35 mm cup hinge with a magnetic catch), one press toggles:
 *   open   reach 0 → 0.20  hand to the pull; the catch lets go at 0.20 (release tick)
 *          swing 0.20 → 0.80  0° → 95°: 0.15 s ease-in from rest (rev 2 — the first
 *          frame used to jump to 29°), then the soft stop — the hinge's damper takes the
 *          rest of the arc decelerating and the leaf settles from a 1.5° overshoot
 *   close  reach 0 → 0.15, swing 0.15 → 0.75  95° → 0°: a shove, the damper slows the
 *          last 20°, the magnetic catch pulls the last 3° home with a click (close)
 *
 * Kitchen door (double-acting spring pivots with a hold-open stop at 90°; fix-counter-door made
 * it a toggle like the front door — it used to spring shut the moment it was pushed). One
 * press opens and it stays open; the next press releases it and the spring brings it home:
 *   open   reach  0 → 0.20     palm to the plate
 *          push   0.20 → 0.70  0° → 90° into the kitchen (ease-out; push thud at 0.20, the
 *                              first frame-pass whoosh at 0.20 too — the leaf leaves the frame)
 *          settle 0.70 → 1.50  against the hold-open: θ = 90° + 3°·e^(−4τ)·sin 9τ, a short
 *                              wobble (bumper thud at 0.70), then it rests OPEN at 90°.
 *   close  reach  0 → 0.15     palm to the plate (the hold-open lets go: push thud at 0.15)
 *          swing  0.15 → 2.25  released from rest: θ = 90°·e^(−2.0τ)·(cos 4.6τ + 0.43 sin 4.6τ)
 *                              — through the frame at τ 0.43 s to −23° into the dining room
 *                              (0.68), through again (1.11) to +6° (1.37), once more (1.79),
 *                              then the pivots' check blends the last 0.3 s to rest and it
 *                              seats with a bumper thud. Whoosh on every frame pass, scaled
 *                              by the angular speed.
 */
import * as THREE from "three";
import type { HingedLeaf } from "../scene/Openables";
import { clamp01, easeOut, phase, smooth, type Interactable } from "./util";

/* ------------------------------------------------------------------------------------ */
/* Cabinet door                                                                           */
/* ------------------------------------------------------------------------------------ */

const CAB_OPEN_DEG = 95;
const CAB_TL = {
  open: { reach: [0, 0.2], swing: [0.2, 0.8], end: 0.8 },
  close: { reach: [0, 0.15], swing: [0.15, 0.75], end: 0.75 },
} as const;
export const CABINET_OPEN_END = CAB_TL.open.end;
export const CABINET_CLOSE_END = CAB_TL.close.end;

export interface CabinetAudio {
  /** Magnetic catch: "release" as the door leaves it, "close" as it snaps home. */
  catch(at: THREE.Vector3, phase: "release" | "close"): void;
}

/**
 * Opening curve 0..1 (rev 2): from rest, the hand accelerates the leaf for 0.15 s (velocity ramps
 * linearly — a quadratic ease-in, no 0 → 29° step on the first frame), then the damper takes
 * over and it decelerates linearly to 95° at u = 0.72; a 1.5° overshoot bump settles after.
 */
const CAB_EASE_IN = 0.15 / ((CAB_TL.open.swing[1] - CAB_TL.open.swing[0]) * 0.72);
function cabinetOpenCurve(u: number): number {
  u = clamp01(u);
  if (u < 0.72) {
    const v = u / 0.72, a = CAB_EASE_IN;
    // Triangular velocity profile: ∫ = 1. Position v²/a on the ramp, 1 − (1 − v)²/(1 − a) after.
    return v < a ? (v * v) / a : 1 - ((1 - v) * (1 - v)) / (1 - a);
  }
  const v = (u - 0.72) / 0.28;
  return 1 + (1.5 / CAB_OPEN_DEG) * Math.sin(Math.PI * v) * (1 - v * 0.4);
}
/** Closing curve 1..0: shove (ease-in-out to 20°), damper slows, the catch pulls the last 3° in a snap. */
function cabinetCloseCurve(u: number): number {
  u = clamp01(u);
  const catchDeg = 3 / CAB_OPEN_DEG;
  if (u < 0.55) {
    // Shove: 95° → 20°, smooth acceleration then a steady swing.
    const t = u / 0.55;
    const s = t * t * (3 - 2 * t);
    return 1 - (1 - 20 / CAB_OPEN_DEG) * s;
  }
  if (u < 0.92) {
    // Damper: 20° → 3°, decelerating.
    const t = (u - 0.55) / 0.37;
    return 20 / CAB_OPEN_DEG - (20 / CAB_OPEN_DEG - catchDeg) * (1 - Math.pow(1 - t, 2));
  }
  // Catch: the last 3° accelerate home.
  const t = (u - 0.92) / 0.08;
  return catchDeg * (1 - t * t);
}

export class CabinetDoorInteraction {
  readonly interactable: Interactable;
  /** Degrees open (0 shut … 95). */
  angleDeg = 0;
  /** "closed" | "opening" | "open" | "closing" */
  state: "closed" | "opening" | "open" | "closing" = "closed";
  private t = -1;
  private settled = false;

  constructor(readonly leaf: HingedLeaf, readonly name: string, private readonly audio: CabinetAudio, label: string) {
    this.interactable = {
      name,
      label: () => (this.state === "open" ? `Close ${label}` : `Open ${label}`),
      focus: (out) => out.copy(this.leaf.focus),
      reach: 1.5,
      halfAngleDeg: 24,
      available: () => this.state === "closed" || this.state === "open",
      interact: () => this.toggle(),
    };
  }

  get busy(): boolean {
    return this.t >= 0;
  }

  /** True once when the leaf has just come to rest (shadow-once). */
  consumeSettled(): boolean {
    const s = this.settled;
    this.settled = false;
    return s;
  }

  toggle(): void {
    if (this.t >= 0) return;
    this.state = this.state === "open" ? "closing" : "opening";
    this.t = 0;
    this.update(0);
  }

  /** Jump to `seconds` into the opening cycle from closed (silent); past the end = open at rest. */
  seek(seconds: number, from: "closed" | "open" = "closed"): void {
    const tl = from === "closed" ? CAB_TL.open : CAB_TL.close;
    if (seconds >= tl.end) {
      this.state = from === "closed" ? "open" : "closed";
      this.t = -1;
    } else {
      this.state = from === "closed" ? "opening" : "closing";
      this.t = Math.max(0, seconds);
    }
    this.apply(this.t);
  }

  reset(): void {
    this.state = "closed";
    this.t = -1;
    this.apply(-1);
  }

  update(dt: number): void {
    if (this.t < 0) return;
    const before = this.t;
    const tl = this.state === "opening" ? CAB_TL.open : CAB_TL.close;
    const t = before + dt;
    if (dt > 0) {
      if (this.state === "opening" && before < tl.swing[0] && t >= tl.swing[0]) this.audio.catch(this.leaf.voice, "release");
      if (this.state === "closing" && before < tl.end && t >= tl.end) this.audio.catch(this.leaf.voice, "close");
    }
    if (t >= tl.end) {
      this.state = this.state === "opening" ? "open" : "closed";
      this.t = -1;
      this.apply(-1);
      this.settled = true;
      return;
    }
    this.t = t;
    this.apply(t);
  }

  /** Degrees open at cycle time `t` for the current state; −1 = at rest. */
  angleAt(t: number): number {
    if (t < 0) return this.state === "open" ? CAB_OPEN_DEG : 0;
    if (this.state === "opening") return CAB_OPEN_DEG * cabinetOpenCurve(phase(t, CAB_TL.open.swing[0], CAB_TL.open.swing[1]));
    if (this.state === "closing") return CAB_OPEN_DEG * cabinetCloseCurve(phase(t, CAB_TL.close.swing[0], CAB_TL.close.swing[1]));
    return this.state === "open" ? CAB_OPEN_DEG : 0;
  }

  private apply(t: number): void {
    const deg = this.angleAt(t);
    this.angleDeg = deg;
    this.leaf.hinge.rotation.y = this.leaf.sign * THREE.MathUtils.degToRad(deg);
  }
}

/* ------------------------------------------------------------------------------------ */
/* Kitchen swing door                                                                     */
/* ------------------------------------------------------------------------------------ */

const KD_OPEN_DEG = 90;
/** Spring pivots: decay rate (1/s) and angular frequency (rad/s) of the free swing. */
const KD_LAMBDA = 2.0;
const KD_OMEGA = 4.6;
/** Free swing until the envelope is under ~1.5° (ln(90·1.09/1.5)/λ ≈ 2.1 s); the check seats it there. */
const KD_FREE_S = 2.1;
/** Hold-open wobble: amplitude (°), decay (1/s), frequency (rad/s), duration (3°·e^(−3.2) ≈ 0.1°). */
const KD_WOBBLE_DEG = 3;
const KD_WOBBLE_LAMBDA = 4.0;
const KD_WOBBLE_OMEGA = 9.0;
const KD_WOBBLE_S = 0.8;
const KD_TL = {
  open: { reach: [0, 0.2], push: [0.2, 0.7], settle: [0.7, 0.7 + KD_WOBBLE_S], end: 0.7 + KD_WOBBLE_S },
  close: { reach: [0, 0.15], swing: [0.15, 0.15 + KD_FREE_S], end: 0.15 + KD_FREE_S },
} as const;
export const KITCHEN_DOOR_OPEN_END = KD_TL.open.end;
export const KITCHEN_DOOR_CLOSE_END = KD_TL.close.end;

export interface KitchenDoorAudio {
  /** A palm on the push plate (as the leaf starts moving / as the hold-open lets go). */
  push(at: THREE.Vector3): void;
  /** The leaf sweeping through the frame; `speed` 0..1 relative to the first pass. */
  pass(at: THREE.Vector3, speed: number): void;
  /** A bumper thud: the leaf meets the hold-open stop, or the check seats it in the frame. */
  settle(at: THREE.Vector3): void;
}

export type KitchenDoorState = "closed" | "opening" | "open" | "closing";

export class KitchenDoorInteraction {
  readonly interactable: Interactable;
  /** Signed degrees: positive into the kitchen, negative toward the dining room. */
  angleDeg = 0;
  state: KitchenDoorState = "closed";
  private t = -1;
  private settled = false;

  constructor(readonly leaf: HingedLeaf, private readonly audio: KitchenDoorAudio) {
    this.interactable = {
      name: "kitchen-door",
      label: () => (this.state === "open" ? "Close kitchen door" : "Open kitchen door"),
      focus: (out) => out.copy(this.leaf.focus),
      reach: 1.6,
      halfAngleDeg: 26,
      available: () => this.state === "closed" || this.state === "open",
      interact: () => this.toggle(),
    };
  }

  get busy(): boolean {
    return this.t >= 0;
  }

  consumeSettled(): boolean {
    const s = this.settled;
    this.settled = false;
    return s;
  }

  /** One press: open (and hold) from closed, release from open. Ignored mid-motion. */
  toggle(): void {
    if (this.t >= 0) return;
    this.state = this.state === "open" ? "closing" : "opening";
    this.t = 0;
    this.update(0);
  }

  /** Jump to `seconds` into the opening cycle from closed (or the closing cycle from open), silent. */
  seek(seconds: number, from: "closed" | "open" = "closed"): void {
    const tl = from === "closed" ? KD_TL.open : KD_TL.close;
    if (seconds >= tl.end) {
      this.state = from === "closed" ? "open" : "closed";
      this.t = -1;
    } else {
      this.state = from === "closed" ? "opening" : "closing";
      this.t = Math.max(0, seconds);
    }
    this.apply(this.t);
  }

  reset(): void {
    this.state = "closed";
    this.t = -1;
    this.apply(-1);
  }

  update(dt: number): void {
    if (this.t < 0) return;
    const before = this.t;
    const t = before + dt;
    const opening = this.state === "opening";
    const end = opening ? KD_TL.open.end : KD_TL.close.end;
    if (dt > 0) {
      if (opening) {
        if (before < KD_TL.open.push[0] && t >= KD_TL.open.push[0]) {
          this.audio.push(this.leaf.voice);
          this.audio.pass(this.leaf.voice, 1);
        }
        if (before < KD_TL.open.settle[0] && t >= KD_TL.open.settle[0]) this.audio.settle(this.leaf.voice);
      } else {
        if (before < KD_TL.close.swing[0] && t >= KD_TL.close.swing[0]) this.audio.push(this.leaf.voice);
        // Frame passes during the free swing: sign changes of the angle.
        const a0 = this.angleAt(before), a1 = this.angleAt(t);
        if (before >= KD_TL.close.swing[0] && Math.sign(a0) !== Math.sign(a1) && a1 !== 0) {
          const speed = Math.abs(this.angularSpeedAt(t)) / (KD_OPEN_DEG * KD_OMEGA);
          this.audio.pass(this.leaf.voice, clamp01(speed * 1.6));
        }
        if (before < end && t >= end) this.audio.settle(this.leaf.voice);
      }
    }
    if (t >= end) {
      this.state = opening ? "open" : "closed";
      this.t = -1;
      this.apply(-1);
      this.settled = true;
      return;
    }
    this.t = t;
    this.apply(t);
  }

  /** Signed degrees at cycle time `t` for the current state; −1 = at rest. */
  angleAt(t: number): number {
    if (t < 0) return this.state === "open" ? KD_OPEN_DEG : 0;
    if (this.state === "opening") {
      const { push, settle } = KD_TL.open;
      if (t < push[0]) return 0;
      if (t < push[1]) return KD_OPEN_DEG * easeOut(phase(t, push[0], push[1]));
      const tau = t - settle[0];
      if (tau >= KD_WOBBLE_S) return KD_OPEN_DEG;
      // The leaf meets the hold-open stop and shivers against it: a small damped sine.
      return KD_OPEN_DEG + KD_WOBBLE_DEG * Math.exp(-KD_WOBBLE_LAMBDA * tau) * Math.sin(KD_WOBBLE_OMEGA * tau);
    }
    if (this.state === "closing") {
      const { swing } = KD_TL.close;
      if (t < swing[0]) return KD_OPEN_DEG;
      const tau = t - swing[0];
      if (tau >= KD_FREE_S) return 0;
      // Released from rest at 90°: the (cos + λ/ω·sin) form has zero initial velocity, so the
      // hand-over from the hold is velocity-continuous. The check blends the last 0.3 s to 0.
      const free = KD_OPEN_DEG * Math.exp(-KD_LAMBDA * tau) * (Math.cos(KD_OMEGA * tau) + (KD_LAMBDA / KD_OMEGA) * Math.sin(KD_OMEGA * tau));
      return free * (1 - smooth((tau - (KD_FREE_S - 0.3)) / 0.3));
    }
    return this.state === "open" ? KD_OPEN_DEG : 0;
  }

  /** dθ/dt in deg/s during the closing free swing (0 elsewhere). */
  private angularSpeedAt(t: number): number {
    const tau = t - KD_TL.close.swing[0];
    if (this.state !== "closing" || tau < 0 || tau >= KD_FREE_S) return 0;
    return -KD_OPEN_DEG * Math.exp(-KD_LAMBDA * tau) * (KD_OMEGA + (KD_LAMBDA * KD_LAMBDA) / KD_OMEGA) * Math.sin(KD_OMEGA * tau);
  }

  private apply(t: number): void {
    const deg = this.angleAt(t);
    this.angleDeg = deg;
    this.leaf.hinge.rotation.y = this.leaf.sign * THREE.MathUtils.degToRad(deg);
  }
}
