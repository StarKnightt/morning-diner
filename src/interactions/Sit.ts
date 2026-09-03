/**
 * Sitting down — in a window booth or on a counter stool. Every seat is a `Seat`
 * descriptor (where the eye ends up, which way it faces, how far the look may
 * roam, where the body turns before it lowers, where you stand back up) driven by
 * one state machine; the booth benches (5 booths × 2) and the nine stools share it.
 *
 * Booth (1.8 s; stand-to-sit in the biomechanics literature runs 1.2–1.8 s: trunk
 * flexes forward, hips drop, head settles). Phases, seconds from the E press:
 *
 *   0    → 0.15  anticipation: nothing moves but a 4 mm weight shift; the hint fades out (0.18 s)
 *   0.15 → 0.75  step & turn: to the cushion's front edge, most of the yaw toward the seated
 *                heading, eyes drop to the seat (pitch −25° → −32°), only 7 cm of height lost
 *   0.75 → 1.45  lower & slide: hips drop 1.55 → 1.15 m (ease in-out), the body slides into the
 *                booth, the head leans 8 cm toward the table and comes back as the hips land,
 *                the remaining yaw completes and the eyes lift toward the window
 *   1.45 → 1.80  settle: the cushion takes the weight — a 14 mm dip, a 4 mm rebound, rest
 *
 * Seated eye: 1.15 m, centred on the bench, turned 35° toward the window so the glass fills
 * the frame and the slat stripes on the table sit at the bottom edge. Movement is locked
 * while seated; mouse look is clamped to ±70° yaw / ±40° pitch about that view. E again
 * stands back up (1.0 s: lean, rise, slide out) to where the player was.
 *
 * Stool (1.0 s, the same phases scaled): a perch, not a drop — the cushion is at 0.73 m, so
 * the eye only comes down from 1.62 to 1.45 m (seat + 0.72 m sitting eye height). You turn
 * to face the counter (−z), the head leans 5 cm over the counter while the hips land, then
 * the vinyl takes the weight (10 mm dip). Seated look is ±70° yaw / ±40° pitch; the seat
 * top (Counter.ts `stoolSeats[i]`, pivoted on the column) swivels after the look with a
 * little lag (critically damped, ~0.12 s), the chrome base stays put; looking down at the
 * counter leans the head up to 6 cm forward. Standing up (0.8 s) puts you just behind the
 * stool in the aisle, still facing where you looked.
 */
import * as THREE from "three";
import type { FirstPerson } from "../player/FirstPerson";
import { BOOTH, PLAYER, STOOL, WINDOW } from "../scene/layout";
import { easeInOut, lerp, phase, smooth, yawToward, type Interactable } from "./util";

/** Booth timeline (seconds). A seat's `duration` scales it. */
const TL = { antic: [0, 0.15], step: [0.15, 0.75], lower: [0.75, 1.45], settle: [1.45, 1.8], end: 1.8 } as const;
export const SIT_END = TL.end;
export const STOOL_SIT_END = 1.0;
/** Height at the end of the step phase (the body has only bent a little). */
const EYE_STEP = 1.55;
const EYE_SEATED = 1.15;
/** Sitting eye height above a seat cushion (anthropometric 50th percentile ≈ 0.72–0.79 m). */
const STOOL_EYE_ABOVE_SEAT = 0.72;
/** Eye sits 0.6 m from the booth centre — 0.16 m in front of the wedge back. */
const EYE_FROM_CENTRE = 0.6;
/** Turn toward the window from straight-ahead (+z), degrees. */
const WINDOW_TURN_DEG = 35;
const SEATED_PITCH_DEG = -9;
const STOOL_SEATED_PITCH_DEG = -12;
/** Looking down at the seat while stepping in. */
const STEP_PITCH_DEG = -32;
const SETTLE_DIP = 0.014;
const SETTLE_REBOUND = 0.004;
const YAW_LIMIT = THREE.MathUtils.degToRad(70);
const PITCH_LIMIT = THREE.MathUtils.degToRad(40);
/** Seat-top swivel follow: first-order lag time constant (s) and the squeak gate. */
const SWIVEL_LAG = 0.12;
const SQUEAK_TURN = THREE.MathUtils.degToRad(28);
const SQUEAK_COOLDOWN = 0.7;
/** Stool: how far the head leans over the counter when looking down (m) and the pitch range it maps. */
const STOOL_LEAN_MAX = 0.06;

type State = "standing" | "sitting-down" | "seated" | "standing-up";

export interface PoseRec {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface SeatSfx {
  /** Vinyl taking the weight (sit) / releasing it (stand). `strength` 0..1. */
  creak?: (at: THREE.Vector3, strength: number) => void;
  /** Stool seat swivelling under the player. */
  squeak?: (at: THREE.Vector3, amount: number) => void;
}

export interface Seat {
  name: string;
  kind: "bench" | "stool";
  /** Eye pose when seated (yaw/pitch are the centre of the seated look). */
  seated: PoseRec;
  /** Point the player has to look at to pick this seat. */
  focus: THREE.Vector3;
  reach: number;
  halfAngleDeg: number;
  /** Where the body turns before it lowers (cushion front edge / just off the stool). */
  edge: { x: number; z: number };
  /** Unit xz direction the trunk leans while lowering (toward the table / counter). */
  lean: { x: number; z: number };
  leanAmount: number;
  settleDip: number;
  /** Sit-down length; the booth timeline is scaled to it. */
  duration: number;
  standDuration: number;
  yawLimit: number;
  pitchLimit: number;
  /** Standing pose to rise to; null → back to where the player sat down from. */
  exit: ((yaw: number, pitch: number) => PoseRec) | null;
  /** Stool seat top that swivels with the look (rotation.y about the column). */
  swivel: THREE.Object3D | null;
  /** Booth extras (debug API picks by booth/side). */
  booth?: number;
  side?: -1 | 1;
  /** Stool index (debug API). */
  index?: number;
}

/** @deprecated name kept for the booth callers: a booth Seat. */
export type Bench = Seat;

export class SitInteraction {
  /** Booth benches (5 × 2), then the stools; `seats` is both. */
  readonly benches: Seat[] = [];
  readonly stools: Seat[] = [];
  readonly seats: Seat[] = [];
  readonly interactables: Interactable[] = [];
  /** The "stand up" pseudo-interactable, offered while seated. */
  readonly stand: Interactable;
  state: State = "standing";
  private seat: Seat | null = null;
  private t = 0;
  private from: PoseRec = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private to: PoseRec = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private standing: PoseRec = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  /** Current swivel angle of the occupied stool's seat and the squeak bookkeeping. */
  private swivelYaw = 0;
  private squeakTurn = 0;
  private squeakCooldown = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly player: FirstPerson,
    stoolSeats: readonly THREE.Object3D[] = [],
    private readonly sfx: SeatSfx = {},
  ) {
    const zMid = (BOOTH.zInner + BOOTH.zOuter) / 2;
    WINDOW.centersX.forEach((cx, booth) => {
      for (const side of [-1, 1] as const) {
        const ex = cx + side * EYE_FROM_CENTRE;
        // Straight ahead is +z (yaw π). The window centre is toward −side·x; forward is (−sin yaw, −cos yaw),
        // so yaw = π − side·turn swings the view that way.
        const yaw = Math.PI - side * THREE.MathUtils.degToRad(WINDOW_TURN_DEG);
        const seat: Seat = {
          name: `sit:${booth}:${side > 0 ? "+" : "-"}`,
          kind: "bench",
          booth,
          side,
          seated: { x: ex, y: EYE_SEATED, z: zMid, yaw, pitch: THREE.MathUtils.degToRad(SEATED_PITCH_DEG) },
          // Aisle end of the bench at back-cushion height: what you look at when you pick a seat.
          focus: new THREE.Vector3(ex, 0.8, BOOTH.zInner + 0.3),
          reach: 1.4,
          halfAngleDeg: 30,
          // Cushion front edge, where the body turns and starts to lower.
          edge: { x: ex, z: BOOTH.zInner + 0.25 },
          // "Forward" for the lean: toward the table (−side·x), the way the trunk faces while lowering.
          lean: { x: -side, z: 0 },
          leanAmount: 0.08,
          settleDip: SETTLE_DIP,
          duration: TL.end,
          standDuration: 1.0,
          yawLimit: YAW_LIMIT,
          pitchLimit: PITCH_LIMIT,
          exit: null,
          swivel: null,
        };
        this.benches.push(seat);
      }
    });
    STOOL.centersX.forEach((cx, index) => {
      const top = stoolSeats[index] ?? null;
      // The built stool may be nudged off its layout centre (Counter.ts); sit where it really is.
      const x = top ? top.position.x : cx;
      const z = top ? top.position.z : STOOL.z;
      const seatHeight: number = (top?.userData.seatHeight as number | undefined) ?? STOOL.seatHeight;
      const seat: Seat = {
        name: `sit-stool:${index}`,
        kind: "stool",
        index,
        // Facing the counter (−z is yaw 0); the eye sits a little ahead of the column, hips on the cushion.
        seated: { x, y: seatHeight + STOOL_EYE_ABOVE_SEAT, z: z - 0.04, yaw: 0, pitch: THREE.MathUtils.degToRad(STOOL_SEATED_PITCH_DEG) },
        focus: new THREE.Vector3(x, seatHeight, z),
        reach: 2.0,
        halfAngleDeg: 30,
        // Turn on the aisle side of the seat, then slide onto it.
        edge: { x, z: z + 0.22 },
        lean: { x: 0, z: -1 },
        leanAmount: 0.05,
        settleDip: 0.01,
        duration: STOOL_SIT_END,
        standDuration: 0.8,
        yawLimit: YAW_LIMIT,
        pitchLimit: PITCH_LIMIT,
        // Stand up just behind the stool in the aisle, keeping the heading you were looking in.
        exit: (yaw, pitch) => ({ x, y: PLAYER.eyeHeight, z: z + 0.45, yaw, pitch }),
        swivel: top,
      };
      this.stools.push(seat);
    });
    this.seats.push(...this.benches, ...this.stools);
    for (const seat of this.seats) {
      this.interactables.push({
        name: seat.name,
        label: () => "Sit",
        focus: (out) => out.copy(seat.focus),
        reach: seat.reach,
        halfAngleDeg: seat.halfAngleDeg,
        available: () => this.state === "standing",
        interact: () => this.sitDown(seat),
      });
    }
    this.stand = {
      name: "stand",
      label: () => "Stand",
      focus: (out) => out.copy(this.player.camera.position),
      reach: Infinity,
      halfAngleDeg: 180,
      available: () => this.state === "seated",
      interact: () => this.standUp(),
    };
  }

  get seated(): boolean {
    return this.state !== "standing";
  }

  /** The seat being used (any state but standing), or null. */
  get current(): Seat | null {
    return this.seat;
  }

  sitDown(seat: Seat, standingFrom?: PoseRec): void {
    if (this.state !== "standing") return;
    const p = this.player;
    const s = standingFrom ?? { x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.yaw, pitch: p.pitch };
    this.standing = { ...s };
    this.from = { ...s };
    // Take the short way round for the yaw.
    const to = { ...seat.seated };
    to.yaw = s.yaw + wrapAngle(to.yaw - s.yaw);
    this.to = to;
    this.seat = seat;
    this.t = 0;
    this.state = "sitting-down";
    this.swivelYaw = seat.swivel ? seat.swivel.rotation.y : 0;
    this.squeakTurn = 0;
    this.squeakCooldown = 0;
    p.enabled = false;
    this.apply(0);
  }

  standUp(): void {
    if (this.state !== "seated" || !this.seat) return;
    const p = this.player;
    // Leave from wherever the head is looking now; keep that heading on the way up.
    this.from = { x: p.camera.position.x, y: p.camera.position.y, z: p.camera.position.z, yaw: p.yaw, pitch: p.pitch };
    this.to = this.seat.exit ? this.seat.exit(p.yaw, p.pitch) : { ...this.standing, yaw: p.yaw, pitch: p.pitch };
    this.t = 0;
    this.state = "standing-up";
    this.sfx.creak?.(this.tmp.copy(this.seat.focus), 0.6);
  }

  /** Jump to `seconds` into the sit-down (deterministic captures). */
  seek(seat: Seat, seconds: number, standingFrom: PoseRec): void {
    if (this.state !== "standing") this.reset();
    this.sitDown(seat, standingFrom);
    this.t = seconds;
    this.update(0);
  }

  /**
   * Seated only: turn the look `yawDeg` (positive = left) off the seat's heading and snap the
   * stool swivel to it (captures — the live follow has a lag).
   */
  look(yawDeg: number, pitchDeg?: number): void {
    if (this.state !== "seated" || !this.seat) return;
    const p = this.player;
    p.yaw = this.to.yaw + THREE.MathUtils.degToRad(yawDeg);
    if (pitchDeg !== undefined) p.pitch = THREE.MathUtils.degToRad(pitchDeg);
    this.update(0);
    if (this.seat.swivel) {
      this.swivelYaw = wrapAngle(p.yaw - this.to.yaw);
      this.seat.swivel.rotation.y = this.swivelYaw;
      this.seat.swivel.updateMatrixWorld();
    }
  }

  reset(): void {
    if (this.seat?.swivel) {
      this.seat.swivel.rotation.y = 0;
      this.seat.swivel.updateMatrixWorld();
    }
    if (this.state === "standing") return;
    const p = this.player;
    p.position.set(this.standing.x, this.standing.y, this.standing.z);
    p.yaw = this.standing.yaw;
    p.pitch = this.standing.pitch;
    p.enabled = true;
    this.state = "standing";
    this.seat = null;
    p.update(0);
  }

  update(dt: number): void {
    const p = this.player;
    switch (this.state) {
      case "standing":
        return;
      case "sitting-down": {
        const seat = this.seat!;
        const wasSettling = this.t >= this.scaled(TL.settle[0], seat);
        this.t += dt;
        this.apply(this.t);
        if (!wasSettling && this.t >= this.scaled(TL.settle[0], seat)) this.sfx.creak?.(this.tmp.copy(seat.focus), 1);
        if (this.t >= seat.duration) {
          this.state = "seated";
          p.yaw = this.to.yaw;
          p.pitch = this.to.pitch;
        }
        return;
      }
      case "seated": {
        const seat = this.seat!;
        // Mouse look keeps writing player.yaw/pitch; clamp about the seated view.
        const base = this.to;
        const off = THREE.MathUtils.clamp(wrapAngle(p.yaw - base.yaw), -seat.yawLimit, seat.yawLimit);
        p.yaw = base.yaw + off;
        p.pitch = THREE.MathUtils.clamp(p.pitch, -seat.pitchLimit, seat.pitchLimit);
        let x = base.x, y = base.y, z = base.z;
        if (seat.kind === "stool") {
          // Looking down at the counter: the trunk leans over it a little.
          const k = smooth((-p.pitch - THREE.MathUtils.degToRad(15)) / THREE.MathUtils.degToRad(25));
          const lean = STOOL_LEAN_MAX * k;
          x += -Math.sin(p.yaw) * lean;
          z += -Math.cos(p.yaw) * lean;
          y -= lean * 0.25;
        }
        this.setCamera(x, y, z, p.yaw, p.pitch);
        this.followSwivel(seat, off, dt);
        return;
      }
      case "standing-up": {
        const seat = this.seat!;
        this.t += dt;
        const u = this.t / seat.standDuration;
        const f = this.from, to = this.to;
        // Trunk leans toward the table first, then the hips rise and the body slides out to the aisle.
        const lean = seat.leanAmount * 0.7 * Math.sin(Math.PI * Math.min(1, u / 0.7));
        const uy = easeInOut(phase(u, 0.05, 0.85));
        const uxz = easeInOut(phase(u, 0.2, 1));
        const lx = seat.lean.x * lean * (1 - uxz), lz = seat.lean.z * lean * (1 - uxz);
        this.setCamera(lerp(f.x, to.x, uxz) + lx, lerp(f.y, to.y, uy), lerp(f.z, to.z, uxz) + lz, p.yaw, p.pitch);
        if (this.t >= seat.standDuration) {
          p.position.set(to.x, to.y, to.z);
          p.enabled = true;
          this.state = "standing";
          this.seat = null;
          p.update(0);
        }
        return;
      }
    }
  }

  /** The stool seat top turns after the look with a lag; a big turn squeaks. */
  private followSwivel(seat: Seat, target: number, dt: number): void {
    const top = seat.swivel;
    if (!top) return;
    const k = dt > 0 ? 1 - Math.exp(-dt / SWIVEL_LAG) : 0;
    const prev = this.swivelYaw;
    this.swivelYaw += (target - this.swivelYaw) * k;
    top.rotation.y = this.swivelYaw;
    top.updateMatrixWorld();
    // Squeak: once the seat has turned SQUEAK_TURN since the last one (sign changes reset the count).
    const d = this.swivelYaw - prev;
    this.squeakCooldown = Math.max(0, this.squeakCooldown - dt);
    this.squeakTurn = Math.sign(d) === Math.sign(this.squeakTurn) ? this.squeakTurn + d : d;
    if (Math.abs(this.squeakTurn) >= SQUEAK_TURN && this.squeakCooldown === 0) {
      this.sfx.squeak?.(this.tmp.copy(seat.focus), Math.min(1, Math.abs(d) / dt / 4));
      this.squeakTurn = 0;
      this.squeakCooldown = SQUEAK_COOLDOWN;
    }
  }

  private scaled(t: number, seat: Seat): number {
    return (t * seat.duration) / TL.end;
  }

  /** Camera along the sit-down path at time `t` (seconds). */
  private apply(t: number): void {
    const f = this.from, to = this.to;
    const seat = this.seat!;
    const T = (v: number) => this.scaled(v, seat);
    const zEdge = seat.edge.z, xEdge = seat.edge.x;
    const stepPitch = THREE.MathUtils.degToRad(STEP_PITCH_DEG);
    // The stool only comes down 17 cm; step height stays above the seated eye either way.
    const eyeStep = Math.max(EYE_STEP, to.y + 0.07);

    let x: number, y: number, z: number, yaw: number, pitch: number;
    if (t < T(TL.step[0])) {
      // Anticipation: weight shift, nothing else.
      const v = phase(t, T(TL.antic[0]), T(TL.antic[1]));
      x = f.x;
      y = f.y + 0.004 * Math.sin(Math.PI * v);
      z = f.z;
      yaw = f.yaw;
      pitch = f.pitch;
    } else if (t < T(TL.step[1])) {
      const u = easeInOut(phase(t, T(TL.step[0]), T(TL.step[1])));
      x = lerp(f.x, xEdge, u);
      y = lerp(f.y, eyeStep, u);
      z = lerp(f.z, zEdge, u);
      yaw = lerp(f.yaw, to.yaw, 0.7 * u);
      pitch = lerp(f.pitch, stepPitch, u);
    } else if (t < T(TL.lower[1])) {
      const v = phase(t, T(TL.lower[0]), T(TL.lower[1]));
      const u = easeInOut(v);
      const lean = seat.leanAmount * Math.sin(Math.PI * v);
      x = lerp(xEdge, to.x, u) + seat.lean.x * lean;
      y = lerp(eyeStep, to.y, u);
      z = lerp(zEdge, to.z, u) + seat.lean.z * lean;
      yaw = lerp(f.yaw, to.yaw, 0.7 + 0.3 * u);
      // Eyes stay on the seat through the first half of the drop, then lift toward the window / counter.
      pitch = lerp(stepPitch, to.pitch, easeInOut(phase(v, 0.45, 1)));
    } else {
      const v = phase(t, T(TL.settle[0]), T(TL.settle[1]));
      x = to.x;
      z = to.z;
      yaw = to.yaw;
      pitch = to.pitch;
      // Cushion takes the weight: a dip, then a smaller rebound.
      const rebound = SETTLE_REBOUND * (seat.settleDip / SETTLE_DIP);
      const dip = v < 0.6 ? -seat.settleDip * Math.sin(Math.PI * (v / 0.6)) : rebound * Math.sin(Math.PI * ((v - 0.6) / 0.4));
      y = to.y + dip;
    }
    this.setCamera(x, y, z, yaw, pitch);
  }

  private setCamera(x: number, y: number, z: number, yaw: number, pitch: number): void {
    const cam = this.player.camera;
    cam.position.set(x, y, z);
    cam.rotation.set(0, 0, 0, "YXZ");
    cam.rotation.y = yaw;
    cam.rotation.x = pitch;
  }

  /** Standing spot in front of a seat — the aisle for a bench, behind the stool (for the debug API). */
  aisleStand(seat: Seat): PoseRec {
    if (seat.kind === "stool") {
      const x = seat.seated.x + 0.35, z = seat.focus.z + 0.75;
      return { x, y: PLAYER.eyeHeight, z, yaw: yawToward(seat.focus.x - x, seat.focus.z - z), pitch: THREE.MathUtils.degToRad(-28) };
    }
    const x = seat.seated.x;
    const z = BOOTH.zInner - 0.4;
    return { x, y: PLAYER.eyeHeight, z, yaw: yawToward(seat.focus.x - x, seat.focus.z - z), pitch: THREE.MathUtils.degToRad(-25) };
  }
}

function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}
