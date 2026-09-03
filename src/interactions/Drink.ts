/**
 * Drinking the coffee (System 9). Press E at the `pourMug` once it holds more than
 * `EMPTY_FILL`: the mug comes up off the bar on an arc toward the lens, tips to the
 * lips while the head tilts back a little, a third of a full mug goes, and it is set
 * back down. Hand-less, like the pour; 2.8 s from the E press (rev 2); camera-attached, so
 * looking around carries the mug with the head (the feet are planted for the sip).
 *
 * Timeline (seconds from E) — see TL:
 *   reach   0 → 0.25   the mug is still; the hint fades; the gaze starts to drop to it
 *   lift    0.25 → 0.95 the mug rises from rest (smootherstep: zero velocity and acceleration at
 *                      the start — nothing jumps) on a quadratic arc (up first, then in) to a point
 *                      low-right of the lens, 0.36 m out; the handle turns to the right hand
 *   sip     0.95 → 1.55 the mug closes to 0.22 m and tips 26–51° toward the lens (rim to the lips);
 *                      the head tilts back 5° with 1.5° of roll and the gaze drifts ~1° left; from
 *                      1.10 to 1.45 the level drops by a third of the mug (volume-true through the
 *                      same LUT as the pour), the steam scales down with it; sip SFX at 1.05
 *   lower   1.55 → 1.85 untilt (ease-out) and back out to the hold point; the head straightens
 *   set     1.85 → 2.55 arc back down to the bar, smootherstep so the foot decelerates to contact
 *                      (no slam); a quiet clink as it lands
 *   release 2.55 → 2.80 the mug is down; the head and gaze return to neutral
 *
 * The head never holds still: `HEAD_KEYS` is a Catmull-Rom spline of small pitch / yaw / roll
 * offsets (FirstPerson.lean) through the whole 2.8 s, zero only at the two ends, so no two frames
 * of the sequence are alike anywhere in the picture — the way a head behaves when its owner drinks.
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
  reach: [0, 0.25],
  lift: [0.25, 0.95],
  sip: [0.95, 1.55],
  drink: [0.95, 1.55],
  lower: [1.55, 1.85],
  set: [1.85, 2.55],
  release: [2.55, 2.8],
  end: 2.8,
  sipSfx: 1.05,
} as const;
export const DRINK_END = TL.end;
/** Fraction of a full mug per sip (rev 3: a quarter — four sips, each a 25 % drain over the whole 0.6 s sip). */
const SIP = 0.25;
/** The contact disc under the mug is gone by this lift (m). */
const DISC_FADE_LIFT = 0.03;
/**
 * Mug tilt at the sip: enough to bring the surface to the rim for the level it starts at (a full
 * mug tips ~24°, a third-full one ~45°), plus a few degrees to drink; the head's answer.
 */
const TILT_MIN = THREE.MathUtils.degToRad(20);
const TILT_MAX = THREE.MathUtils.degToRad(45);
const TILT_EXTRA = THREE.MathUtils.degToRad(6);
const MUG_R = 0.032;
/**
 * Head offsets through the drink, degrees [t, pitch (+ = back), yaw (+ = left), roll]. A glance
 * down-right at the mug as it lifts, 5° back with a 1.2° gaze drift left at the sip, a glance down
 * again to set it, neutral at both ends. Sampled with a Catmull-Rom spline (`headAt`).
 */
const HEAD_KEYS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.0, 0, 0, 0],
  [0.5, -0.8, 0.5, 0.2],
  [0.95, 0.6, 0.3, 0.4],
  [1.35, 5.0, -0.9, 1.5],
  [1.55, 4.6, -1.2, 1.3],
  [1.85, 1.0, -0.6, 0.5],
  [2.3, -0.9, 0.4, 0.0],
  [2.55, -0.5, 0.3, 0.0],
  [2.8, 0, 0, 0],
];
/** Quintic smoothstep: zero velocity and acceleration at both ends. */
const smoother = (t: number): number => {
  t = clamp01(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
/** Catmull-Rom through HEAD_KEYS at time `t` → [pitch, yaw, roll] in radians. */
function headAt(t: number, out: number[]): number[] {
  const K = HEAD_KEYS;
  const n = K.length;
  if (t <= K[0][0] || t >= K[n - 1][0]) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  let i = 0;
  while (i < n - 2 && K[i + 1][0] <= t) i++;
  const p0 = K[Math.max(0, i - 1)], p1 = K[i], p2 = K[i + 1], p3 = K[Math.min(n - 1, i + 2)];
  const h = p2[0] - p1[0], u = (t - p1[0]) / h;
  const u2 = u * u, u3 = u2 * u;
  for (let c = 0; c < 3; c++) {
    const y0 = p0[c + 1], y1 = p1[c + 1], y2 = p2[c + 1], y3 = p3[c + 1];
    // Non-uniform Catmull-Rom tangents (finite differences scaled to this segment's length).
    const m1 = i === 0 ? y2 - y1 : ((y2 - y0) / (p2[0] - p0[0])) * h;
    const m2 = i === n - 2 ? y2 - y1 : ((y3 - y1) / (p3[0] - p1[0])) * h;
    const v = (2 * u3 - 3 * u2 + 1) * y1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * y2 + (u3 - u2) * m2;
    out[c] = THREE.MathUtils.degToRad(v);
  }
  return out;
}
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
  private readonly nextP = new THREE.Vector3();
  private readonly nextQ = new THREE.Quaternion();
  private readonly rimOff = new THREE.Vector3();
  private readonly rimNow = new THREE.Vector3();
  private readonly rimNext = new THREE.Vector3();
  private readonly axisY = new THREE.Vector3(0, 1, 0);
  private readonly head = [0, 0, 0];

  constructor(
    private readonly pour: PourInteraction,
    mug: THREE.Mesh,
    private readonly player: FirstPerson,
    private readonly audio: DrinkAudio,
    /** The mug's contact disc on the bar (Props.ts), faded out as the mug lifts. */
    private readonly shadow?: THREE.Mesh,
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
    this.restore();
    this.pour.setFill(this.fillFrom);
  }

  update(dt: number): void {
    if (this.state !== "drinking") return;
    const before = this.t;
    this.t += dt;
    if (dt > 0) {
      this.moved = true;
      if (before < TL.sipSfx && this.t >= TL.sipSfx) this.audio.sip();
      if (before < TL.set[1] && this.t >= TL.set[1]) this.audio.clink(this.pour.rim);
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
    this.restore();
    this.pour.setFill(to);
  }

  /** Mug, liquid, steam and head back to rest. */
  private restore(): void {
    this.mug.position.copy(this.mugRest);
    this.mug.quaternion.copy(this.mugRestQ);
    this.pour.liquid.quaternion.identity();
    this.pour.steamObject.position.copy(this.steamRest);
    this.pour.steamVelocity.set(0, 0, 0);
    this.player.lean.pitch = 0;
    this.player.lean.roll = 0;
    this.player.lean.yaw = 0;
    this.player.movementLocked = false;
    this.setDisc(0);
  }

  /**
   * Fill through the drink: the level falls over the WHOLE sip (0.95 → 1.55), nearly linearly —
   * a swallow is a steady draw, and rev 2's 0.35 s ease-in-out dropped 97 → 67 % in 0.2 s.
   */
  private fillAt(t: number): number {
    const u = phase(t, TL.drink[0], TL.drink[1]);
    return lerp(this.fillFrom, this.fillTo, 0.75 * u + 0.25 * easeInOut(u));
  }

  /** Contact disc opacity for a mug `lift` m off the bar: full at rest, gone by DISC_FADE_LIFT. */
  private setDisc(lift: number): void {
    if (!this.shadow) return;
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 1 - clamp01(lift / DISC_FADE_LIFT);
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

    const P = this.target;
    const tiltRad = this.poseAt(t, P, this.worldQ);
    // The rim's world velocity (a 1/120 s forward difference on the same path, so seeks get it
    // too): the steam's older parcels stay where the rim was when they left it.
    this.rimOff.set(0, MUG_H - 0.004, 0);
    this.rimNow.copy(this.rimOff).applyQuaternion(this.worldQ).add(P);
    this.poseAt(t + VEL_DT, this.nextP, this.nextQ);
    this.rimNext.copy(this.rimOff).applyQuaternion(this.nextQ).add(this.nextP);
    this.pour.steamVelocity.subVectors(this.rimNext, this.rimNow).multiplyScalar(1 / VEL_DT);
    const parent = this.mug.parent;
    this.mug.quaternion.copy(this.worldQ);
    if (parent) {
      parent.getWorldQuaternion(this.tmpQ2);
      this.mug.quaternion.premultiply(this.tmpQ2.invert());
      parent.worldToLocal(P);
    }
    this.mug.position.copy(P);
    this.mug.updateMatrixWorld(true);
    // The disc on the bar fades with the lift (multiply → 1): nothing dense under a mug in the air.
    this.setDisc(this.mug.getWorldPosition(this.tmpV).y - this.restW.y);

    // Liquid: horizontal in the world, level for this frame's fill, slid toward the low side.
    const fill = this.fillAt(t);
    this.pour.setFillVisual(fill);
    const liquid = this.pour.liquid;
    liquid.quaternion.copy(this.mug.getWorldQuaternion(this.tmpQ).invert()); // world-horizontal
    if (tiltRad > 0) {
      // A horizontal surface in a tilted cup meets the wall higher on the low side: keep the disc
      // centred on the axis but raise it by ~half the wall rise so it reaches the lip side.
      liquid.position.y = Math.min(MUG_H - 0.006, liquid.position.y + 0.5 * MUG_R * Math.tan(tiltRad));
    }

    // Steam: its source rides on the rim (world); the strands rise in the world and trail the carry.
    this.pour.steamObject.position.copy(this.rimNow);

    // Head: the spline of small pitch / yaw / roll offsets — 5° back at the sip, never still.
    const h = headAt(t, this.head);
    this.player.lean.pitch = h[0];
    this.player.lean.yaw = h[1];
    this.player.lean.roll = h[2];
  }

  /**
   * The mug's world position and orientation at drink-time `t` for the current head pose
   * (`hold` / `lips` / `camRight` already set). Returns the tilt in radians. No side effects
   * beyond the `ctrl` / `tmpQ` / `tmpQ2` scratch, so it can be evaluated twice per frame.
   */
  private poseAt(t: number, P: THREE.Vector3, outQ: THREE.Quaternion): number {
    // Where the mug is and how far it has tipped (0..1), by beat.
    let tilt = 0;
    const rest = this.restW;
    if (t < TL.lift[0]) {
      P.copy(rest);
    } else if (t < TL.lift[1]) {
      // Up off the bar first, then in toward the body: a quadratic arc with its control point over
      // the rest. Smootherstep — the mug leaves the bar from rest, no kick.
      const u = smoother(phase(t, TL.lift[0], TL.lift[1]));
      this.ctrl.copy(rest).lerp(this.hold, 0.4);
      this.ctrl.y = 0.5 * (rest.y + this.hold.y) + 0.08;
      bezier2(rest, this.ctrl, this.hold, u, P);
    } else if (t < TL.sip[1]) {
      const u = easeInOut(phase(t, TL.sip[0], TL.sip[1]));
      // Closing to the lips and tipping happen together; the tip leads a little so the rim arrives first.
      P.lerpVectors(this.hold, this.lips, u);
      tilt = easeInOut(clamp01(u * 1.15));
    } else if (t < TL.lower[1]) {
      // Untilt fast (ease-out) while the mug comes back out to the hold point.
      const u = phase(t, TL.lower[0], TL.lower[1]);
      tilt = 1 - easeOut(clamp01(u * 1.3));
      P.lerpVectors(this.lips, this.hold, easeInOut(u));
    } else if (t < TL.set[1]) {
      // The arc down, smootherstep: the foot decelerates to the bar and lands from ~zero speed.
      const u = phase(t, TL.set[0], TL.set[1]);
      const a = smoother(u);
      this.ctrl.copy(rest).lerp(this.hold, 0.4);
      this.ctrl.y = 0.5 * (rest.y + this.hold.y) + 0.06;
      bezier2(this.hold, this.ctrl, rest, a, P);
    } else {
      P.copy(rest);
    }

    // Orientation: rest yaw → handle to the right hand over the lift, then tip about the camera's
    // right axis so the rim comes to the lens (+angle about camRight tips the top toward the camera).
    const grip = t < TL.lift[0] ? 0 : t < TL.lift[1] ? smoother(phase(t, TL.lift[0], TL.lift[1])) : t < TL.set[0] ? 1 : 1 - smoother(phase(t, TL.set[0] + 0.1, TL.set[1]));
    // Yaw that points the mug's local +x (the handle) along the camera's right: RotY(ψ)·x̂ = (cos ψ, 0, −sin ψ).
    const yawHand = Math.atan2(-this.camRight.z, this.camRight.x) + HANDLE_YAW;
    const yaw = this.yawRest + wrapAngle(yawHand - this.yawRest) * grip;
    this.tmpQ.setFromAxisAngle(this.axisY, yaw);
    const tiltRad = this.tiltMax * tilt;
    this.tmpQ2.setFromAxisAngle(this.camRight, tiltRad);
    outQ.copy(this.tmpQ2).multiply(this.tmpQ);
    return tiltRad;
  }
}

/** Forward-difference step for the rim velocity (s). */
const VEL_DT = 1 / 120;

function bezier2(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, u: number, out: THREE.Vector3): THREE.Vector3 {
  const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
  return out.set(a * p0.x + b * p1.x + c * p2.x, a * p0.y + b * p1.y + c * p2.y, a * p0.z + b * p1.z + c * p2.z);
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
