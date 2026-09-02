/**
 * Drinking the coffee (System 9). Press E at the `pourMug` once it holds more than
 * `EMPTY_FILL`: the mug comes up off the bar on an arc toward the lens, tips to the
 * lips while the head tilts back a little, a third of a full mug goes, and it is set
 * back down. Hand-less, like the pour; 1.6 s from the E press; camera-attached, so
 * looking around carries the mug with the head (the feet are planted for the sip).
 *
 * Timeline (seconds from E) — see TL:
 *   reach   0 → 0.22   nothing moves; the hint fades
 *   lift    0.22 → 0.72 the mug rises from its rest on a quadratic arc (up first, then in) to a
 *                      point low-right of the lens, 0.30 m out; the handle turns to the right hand
 *   sip     0.72 → 1.15 the mug closes to 0.21 m and tips 38° toward the lens (rim to the lips);
 *                      the head tilts back 4° with 1.5° of roll; from 0.82 to 1.08 the level drops
 *                      by a third of the mug (volume-true through the same LUT as the pour), the
 *                      steam scales down with it; sip SFX at 0.78
 *   set     1.15 → 1.60 untilt, arc back down, decelerating landing (no slam); the head straightens;
 *                      a quiet clink as the foot meets the bar
 *
 * The liquid disc is a child of the mug: while the mug tilts it is counter-rotated to stay
 * world-horizontal and slid up toward the low side so the surface reads as liquid, not a lid.
 * The rim steam rides on the mug and is put back on the bar with it. Everything runs off one
 * clock so `seek(t)` is deterministic (the camera is wherever the caller put it).
 */
import * as THREE from "three";
import type { FirstPerson } from "../player/FirstPerson";
import { EMPTY_FILL, MUG_H, type PourInteraction } from "./Pour";
import { clamp01, easeInOut, easeOut, lerp, phase, type Interactable } from "./util";

const TL = {
  reach: [0, 0.22],
  lift: [0.22, 0.72],
  sip: [0.72, 1.15],
  drink: [0.82, 1.08],
  set: [1.15, 1.6],
  end: 1.6,
  sipSfx: 0.78,
} as const;
export const DRINK_END = TL.end;
/** Fraction of a full mug per sip. */
const SIP = 1 / 3;
/**
 * Mug tilt at the sip: enough to bring the surface to the rim for the level it starts at (a full
 * mug tips ~24°, a third-full one ~45°), plus a few degrees to drink; the head's answer.
 */
const TILT_MIN = THREE.MathUtils.degToRad(20);
const TILT_MAX = THREE.MathUtils.degToRad(45);
const TILT_EXTRA = THREE.MathUtils.degToRad(6);
const MUG_R = 0.032;
const HEAD_PITCH = THREE.MathUtils.degToRad(4);
const HEAD_ROLL = THREE.MathUtils.degToRad(1.5);
/**
 * Mug foot in camera space (37° vertical FOV, ±18.5°): held low-right after the lift with the rim
 * just under the centre line; at the lips 0.22 m out so the tipped rim sits in the lower frame and
 * the surface is seen through the tilt.
 */
const HOLD = new THREE.Vector3(0.075, -0.11, -0.36);
const LIPS = new THREE.Vector3(0.03, -0.1, -0.22);
/** Handle yaw in the hand: the C-handle (local +x) turns toward the right hand, a little forward. */
const HANDLE_YAW = THREE.MathUtils.degToRad(-35);

export interface DrinkAudio {
  sip(): void;
  clink(at: THREE.Vector3): void;
}

type State = "idle" | "drinking";

export class DrinkInteraction {
  readonly interactable: Interactable;
  state: State = "idle";
  private t = 0;
  private moved = false;
  private fillFrom = 1;
  private fillTo = 1;
  /** Full tilt for this drink (from the level it starts at). */
  private tiltMax = TILT_MIN;

  private readonly mug: THREE.Mesh;
  /** Rest pose in the mug's parent frame (restored after the drink) and in the world (animated from). */
  private readonly mugRest = new THREE.Vector3();
  private readonly mugRestQ = new THREE.Quaternion();
  private readonly restW = new THREE.Vector3();
  private readonly yawRest: number;
  private readonly steamRest = new THREE.Vector3();
  private readonly focusPoint = new THREE.Vector3();

  private readonly camPos = new THREE.Vector3();
  private readonly camQ = new THREE.Quaternion();
  private readonly camRight = new THREE.Vector3();
  private readonly hold = new THREE.Vector3();
  private readonly lips = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly ctrl = new THREE.Vector3();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();
  private readonly worldQ = new THREE.Quaternion();
  private readonly axisY = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly pour: PourInteraction,
    mug: THREE.Mesh,
    private readonly player: FirstPerson,
    private readonly audio: DrinkAudio,
  ) {
    this.mug = mug;
    this.mugRest.copy(mug.position);
    this.mugRestQ.copy(mug.quaternion);
    mug.updateWorldMatrix(true, false);
    mug.getWorldPosition(this.restW);
    this.yawRest = new THREE.Euler().setFromQuaternion(mug.getWorldQuaternion(this.tmpQ), "YXZ").y;
    this.steamRest.copy(pour.steamObject.position);
    this.focusPoint.set(mug.position.x, mug.position.y + 0.06, mug.position.z);
    this.interactable = {
      name: "drink",
      label: () => "Drink",
      focus: (out) => out.copy(this.focusPoint),
      reach: 1.25,
      halfAngleDeg: 22,
      available: () => this.state === "idle" && pour.state !== "pouring" && pour.fill >= EMPTY_FILL && !player.inAir,
      interact: () => this.start(),
    };
  }

  /** True once if the mug moved since the last call (index.ts → shadow-once invalidation). */
  consumeMoved(): boolean {
    const m = this.moved;
    this.moved = false;
    return m;
  }

  /** Mug contents 0..1 as drawn this frame. */
  get fill(): number {
    return this.state === "drinking" ? this.fillAt(this.t) : this.pour.fill;
  }

  start(): void {
    if (this.state !== "idle" || this.pour.state === "pouring") return;
    this.state = "drinking";
    this.t = 0;
    this.fillFrom = this.pour.fill;
    this.fillTo = Math.max(0, this.fillFrom - SIP);
    const level = this.pour.levelFor(this.fillFrom);
    this.tiltMax = THREE.MathUtils.clamp(Math.atan((MUG_H - level) / MUG_R) + TILT_EXTRA, TILT_MIN, TILT_MAX);
    this.player.movementLocked = true;
    this.update(0);
  }

  /** Jump to `seconds` into the drink from the current fill (silent). Deterministic given the camera. */
  seek(seconds: number): void {
    this.reset();
    if (seconds >= TL.end) {
      this.pour.setFill(Math.max(0, this.pour.fill - SIP));
      return;
    }
    this.start();
    this.t = seconds;
    // The head tilt is read back through the camera: pose, bake the lean, pose again.
    this.applyFrame(seconds);
    this.player.update(0);
    this.applyFrame(seconds);
  }

  reset(): void {
    if (this.state === "idle") return;
    this.state = "idle";
    this.t = 0;
    this.moved = true;
    this.mug.position.copy(this.mugRest);
    this.mug.quaternion.copy(this.mugRestQ);
    this.pour.liquid.quaternion.identity();
    this.pour.steamObject.position.copy(this.steamRest);
    this.player.lean.pitch = 0;
    this.player.lean.roll = 0;
    this.player.movementLocked = false;
    this.pour.setFill(this.fillFrom);
  }

  update(dt: number): void {
    if (this.state !== "drinking") return;
    const before = this.t;
    this.t += dt;
    if (dt > 0) {
      this.moved = true;
      if (before < TL.sipSfx && this.t >= TL.sipSfx) this.audio.sip();
      if (before < TL.end && this.t >= TL.end) this.audio.clink(this.pour.rim);
    }
    if (this.t >= TL.end) {
      this.finish();
      return;
    }
    this.applyFrame(this.t);
  }

  private finish(): void {
    const to = this.fillTo;
    this.state = "idle";
    this.moved = true;
    this.mug.position.copy(this.mugRest);
    this.mug.quaternion.copy(this.mugRestQ);
    this.pour.liquid.quaternion.identity();
    this.pour.steamObject.position.copy(this.steamRest);
    this.player.lean.pitch = 0;
    this.player.lean.roll = 0;
    this.player.movementLocked = false;
    this.pour.setFill(to);
  }

  private fillAt(t: number): number {
    return lerp(this.fillFrom, this.fillTo, easeInOut(phase(t, TL.drink[0], TL.drink[1])));
  }

  /** Pose the mug, its liquid, the steam and the head for drink-time `t`. */
  private applyFrame(t: number): void {
    const cam = this.player.camera;
    cam.getWorldPosition(this.camPos);
    cam.getWorldQuaternion(this.camQ);
    this.camRight.set(1, 0, 0).applyQuaternion(this.camQ);
    // The two hand points, in the world, for this frame's head pose.
    this.hold.copy(HOLD).applyQuaternion(this.camQ).add(this.camPos);
    this.lips.copy(LIPS).applyQuaternion(this.camQ).add(this.camPos);

    // Where the mug is and how far it has tipped (0..1), by beat.
    let tilt = 0;
    let head = 0;
    const P = this.target;
    const rest = this.restW;
    if (t < TL.lift[0]) {
      P.copy(rest);
    } else if (t < TL.lift[1]) {
      // Up off the bar first, then in toward the body: a quadratic arc with its control point over the rest.
      const u = easeInOut(phase(t, TL.lift[0], TL.lift[1]));
      this.ctrl.copy(rest).lerp(this.hold, 0.4);
      this.ctrl.y = 0.5 * (rest.y + this.hold.y) + 0.08;
      bezier2(rest, this.ctrl, this.hold, u, P);
    } else if (t < TL.sip[1]) {
      const u = easeInOut(phase(t, TL.sip[0], TL.sip[1]));
      // Closing to the lips and tipping happen together; the tip leads a little so the rim arrives first.
      P.lerpVectors(this.hold, this.lips, u);
      tilt = easeInOut(clamp01(u * 1.15));
      head = u;
    } else if (t < TL.set[1]) {
      const u = phase(t, TL.set[0], TL.set[1]);
      // Untilt fast (ease-out), then the arc down with a decelerating landing.
      tilt = 1 - easeOut(clamp01(u * 1.8));
      head = 1 - easeInOut(clamp01(u * 1.6));
      const a = easeInOut(u);
      this.ctrl.copy(rest).lerp(this.lips, 0.4);
      this.ctrl.y = 0.5 * (rest.y + this.lips.y) + 0.06;
      bezier2(this.lips, this.ctrl, rest, a, P);
      // Landing: quadratic ease-out on y over the last 30 % so the foot settles, no slam.
      if (u > 0.7) {
        const v = phase(u, 0.7, 1);
        P.y = lerp(P.y, rest.y, 1 - (1 - v) * (1 - v));
      }
    } else {
      P.copy(rest);
    }

    // Orientation: rest yaw → handle to the right hand over the lift, then tip about the camera's
    // right axis so the rim comes to the lens (+angle about camRight tips the top toward the camera).
    const grip = t < TL.lift[0] ? 0 : t < TL.lift[1] ? easeInOut(phase(t, TL.lift[0], TL.lift[1])) : t < TL.set[0] ? 1 : 1 - easeInOut(phase(t, TL.set[0] + 0.12, TL.set[1]));
    // Yaw that points the mug's local +x (the handle) along the camera's right: RotY(ψ)·x̂ = (cos ψ, 0, −sin ψ).
    const yawHand = Math.atan2(-this.camRight.z, this.camRight.x) + HANDLE_YAW;
    const yaw = this.yawRest + wrapAngle(yawHand - this.yawRest) * grip;
    this.tmpQ.setFromAxisAngle(this.axisY, yaw);
    const tiltRad = this.tiltMax * tilt;
    this.tmpQ2.setFromAxisAngle(this.camRight, tiltRad);
    this.worldQ.copy(this.tmpQ2).multiply(this.tmpQ);
    const parent = this.mug.parent;
    this.mug.quaternion.copy(this.worldQ);
    if (parent) {
      parent.getWorldQuaternion(this.tmpQ2);
      this.mug.quaternion.premultiply(this.tmpQ2.invert());
      parent.worldToLocal(P);
    }
    this.mug.position.copy(P);
    this.mug.updateMatrixWorld(true);

    // Liquid: horizontal in the world, level for this frame's fill, slid toward the low side.
    const fill = this.fillAt(t);
    this.pour.setFillVisual(fill);
    const liquid = this.pour.liquid;
    liquid.quaternion.copy(this.mug.getWorldQuaternion(this.tmpQ).invert()); // world-horizontal
    if (tilt > 0) {
      // A horizontal surface in a tilted cup meets the wall higher on the low side: keep the disc
      // centred on the axis but raise it by ~half the wall rise so it reaches the lip side.
      liquid.position.y = Math.min(MUG_H - 0.006, liquid.position.y + 0.5 * MUG_R * Math.tan(tiltRad));
    }

    // Steam: on the rim, in the world, level with the mug's tilt.
    this.tmpV.set(0, MUG_H - 0.004, 0).applyQuaternion(this.worldQ);
    this.mug.getWorldPosition(this.pour.steamObject.position).add(this.tmpV);

    // Head: a small tilt back and a hint of roll at the sip.
    this.player.lean.pitch = HEAD_PITCH * head;
    this.player.lean.roll = HEAD_ROLL * head;
  }
}

function bezier2(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, u: number, out: THREE.Vector3): THREE.Vector3 {
  const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
  return out.set(a * p0.x + b * p1.x + c * p2.x, a * p0.y + b * p1.y + c * p2.y, a * p0.z + b * p1.z + c * p2.z);
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
