/**
 * Sitting in a window booth. Every bench (5 booths × 2) is an interactable;
 * pressing E in front of one plays a 1.8 s sit-down (stand-to-sit in the
 * biomechanics literature runs 1.2–1.8 s: trunk flexes forward, hips drop,
 * head settles). Phases, seconds from the E press:
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
 */
import * as THREE from "three";
import type { FirstPerson } from "../player/FirstPerson";
import { BOOTH, PLAYER, WINDOW } from "../scene/layout";
import { easeInOut, lerp, phase, yawToward, type Interactable } from "./util";

const TL = { antic: [0, 0.15], step: [0.15, 0.75], lower: [0.75, 1.45], settle: [1.45, 1.8], end: 1.8 } as const;
export const SIT_END = TL.end;
const STAND_DURATION = 1.0;
/** Height at the end of the step phase (the body has only bent a little). */
const EYE_STEP = 1.55;
const EYE_SEATED = 1.15;
/** Eye sits 0.6 m from the booth centre — 0.16 m in front of the wedge back. */
const EYE_FROM_CENTRE = 0.6;
/** Turn toward the window from straight-ahead (+z), degrees. */
const WINDOW_TURN_DEG = 35;
const SEATED_PITCH_DEG = -9;
/** Looking down at the seat while stepping in. */
const STEP_PITCH_DEG = -32;
const LEAN = 0.08;
const SETTLE_DIP = 0.014;
const SETTLE_REBOUND = 0.004;
const YAW_LIMIT = THREE.MathUtils.degToRad(70);
const PITCH_LIMIT = THREE.MathUtils.degToRad(40);

type State = "standing" | "sitting-down" | "seated" | "standing-up";

interface PoseRec {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface Bench {
  booth: number;
  /** −1: bench on the −x side of the booth; +1: on the +x side. */
  side: -1 | 1;
  seated: PoseRec;
  /** Point the player has to look at (the aisle end of the cushion). */
  focus: THREE.Vector3;
}

export class SitInteraction {
  readonly benches: Bench[] = [];
  readonly interactables: Interactable[] = [];
  /** The "stand up" pseudo-interactable, offered while seated. */
  readonly stand: Interactable;
  state: State = "standing";
  private bench: Bench | null = null;
  private t = 0;
  private from: PoseRec = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private to: PoseRec = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private standing: PoseRec = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

  constructor(private readonly player: FirstPerson) {
    const zMid = (BOOTH.zInner + BOOTH.zOuter) / 2;
    WINDOW.centersX.forEach((cx, booth) => {
      for (const side of [-1, 1] as const) {
        const ex = cx + side * EYE_FROM_CENTRE;
        // Straight ahead is +z (yaw π). The window centre is toward −side·x; forward is (−sin yaw, −cos yaw),
        // so yaw = π − side·turn swings the view that way.
        const yaw = Math.PI - side * THREE.MathUtils.degToRad(WINDOW_TURN_DEG);
        const bench: Bench = {
          booth,
          side,
          seated: { x: ex, y: EYE_SEATED, z: zMid, yaw, pitch: THREE.MathUtils.degToRad(SEATED_PITCH_DEG) },
          // Aisle end of the bench at back-cushion height: what you look at when you pick a seat.
          focus: new THREE.Vector3(cx + side * EYE_FROM_CENTRE, 0.8, BOOTH.zInner + 0.3),
        };
        this.benches.push(bench);
        this.interactables.push({
          name: `sit:${booth}:${side > 0 ? "+" : "-"}`,
          label: () => "Sit",
          focus: (out) => out.copy(bench.focus),
          reach: 1.4,
          halfAngleDeg: 30,
          available: () => this.state === "standing",
          interact: () => this.sitDown(bench),
        });
      }
    });
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

  sitDown(bench: Bench, standingFrom?: PoseRec): void {
    if (this.state !== "standing") return;
    const p = this.player;
    const s = standingFrom ?? { x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.yaw, pitch: p.pitch };
    this.standing = { ...s };
    this.from = { ...s };
    // Take the short way round for the yaw.
    const to = { ...bench.seated };
    to.yaw = s.yaw + wrapAngle(to.yaw - s.yaw);
    this.to = to;
    this.bench = bench;
    this.t = 0;
    this.state = "sitting-down";
    p.enabled = false;
    this.apply(0);
  }

  standUp(): void {
    if (this.state !== "seated" || !this.bench) return;
    const p = this.player;
    // Leave from wherever the head is looking now; keep that heading on the way up.
    this.from = { x: p.camera.position.x, y: p.camera.position.y, z: p.camera.position.z, yaw: p.yaw, pitch: p.pitch };
    this.to = { ...this.standing, yaw: p.yaw, pitch: p.pitch };
    this.t = 0;
    this.state = "standing-up";
  }

  /** Jump to `seconds` into the sit-down (deterministic captures). */
  seek(bench: Bench, seconds: number, standingFrom: PoseRec): void {
    if (this.state !== "standing") this.reset();
    this.sitDown(bench, standingFrom);
    this.t = seconds;
    this.update(0);
  }

  reset(): void {
    if (this.state === "standing") return;
    const p = this.player;
    p.position.set(this.standing.x, this.standing.y, this.standing.z);
    p.yaw = this.standing.yaw;
    p.pitch = this.standing.pitch;
    p.enabled = true;
    this.state = "standing";
    this.bench = null;
    p.update(0);
  }

  update(dt: number): void {
    const p = this.player;
    switch (this.state) {
      case "standing":
        return;
      case "sitting-down": {
        this.t += dt;
        this.apply(this.t);
        if (this.t >= TL.end) {
          this.state = "seated";
          p.yaw = this.to.yaw;
          p.pitch = this.to.pitch;
        }
        return;
      }
      case "seated": {
        // Mouse look keeps writing player.yaw/pitch; clamp about the seated view.
        const base = this.to;
        p.yaw = base.yaw + THREE.MathUtils.clamp(wrapAngle(p.yaw - base.yaw), -YAW_LIMIT, YAW_LIMIT);
        p.pitch = THREE.MathUtils.clamp(p.pitch, -PITCH_LIMIT, PITCH_LIMIT);
        this.setCamera(base.x, base.y, base.z, p.yaw, p.pitch);
        return;
      }
      case "standing-up": {
        this.t += dt;
        const u = this.t / STAND_DURATION;
        const f = this.from, to = this.to;
        // Trunk leans toward the table first, then the hips rise and the body slides out to the aisle.
        const lean = LEAN * 0.7 * Math.sin(Math.PI * Math.min(1, u / 0.7));
        const uy = easeInOut(phase(u, 0.05, 0.85));
        const uxz = easeInOut(phase(u, 0.2, 1));
        const lx = this.bench ? -this.bench.side * lean : 0;
        this.setCamera(lerp(f.x, to.x, uxz) + lx * (1 - uxz), lerp(f.y, to.y, uy), lerp(f.z, to.z, uxz), p.yaw, p.pitch);
        if (this.t >= STAND_DURATION) {
          p.position.set(to.x, to.y, to.z);
          p.enabled = true;
          this.state = "standing";
          this.bench = null;
          p.update(0);
        }
        return;
      }
    }
  }

  /** Camera along the sit-down path at time `t` (seconds). */
  private apply(t: number): void {
    const f = this.from, to = this.to;
    const bench = this.bench;
    // Cushion front edge, where the body turns and starts to lower.
    const zEdge = BOOTH.zInner + 0.25;
    // "Forward" for the lean: toward the table (−side·x), the way the trunk faces while lowering.
    const leanX = bench ? -bench.side : 0;
    const stepPitch = THREE.MathUtils.degToRad(STEP_PITCH_DEG);

    let x: number, y: number, z: number, yaw: number, pitch: number;
    if (t < TL.step[0]) {
      // Anticipation: weight shift, nothing else.
      const v = phase(t, TL.antic[0], TL.antic[1]);
      x = f.x;
      y = f.y + 0.004 * Math.sin(Math.PI * v);
      z = f.z;
      yaw = f.yaw;
      pitch = f.pitch;
    } else if (t < TL.step[1]) {
      const u = easeInOut(phase(t, TL.step[0], TL.step[1]));
      x = lerp(f.x, to.x, u);
      y = lerp(f.y, EYE_STEP, u);
      z = lerp(f.z, zEdge, u);
      yaw = lerp(f.yaw, to.yaw, 0.7 * u);
      pitch = lerp(f.pitch, stepPitch, u);
    } else if (t < TL.lower[1]) {
      const v = phase(t, TL.lower[0], TL.lower[1]);
      const u = easeInOut(v);
      x = to.x + leanX * LEAN * Math.sin(Math.PI * v);
      y = lerp(EYE_STEP, to.y, u);
      z = lerp(zEdge, to.z, u);
      yaw = lerp(f.yaw, to.yaw, 0.7 + 0.3 * u);
      // Eyes stay on the seat through the first half of the drop, then lift toward the window.
      pitch = lerp(stepPitch, to.pitch, easeInOut(phase(v, 0.45, 1)));
    } else {
      const v = phase(t, TL.settle[0], TL.settle[1]);
      x = to.x;
      z = to.z;
      yaw = to.yaw;
      pitch = to.pitch;
      // Cushion takes the weight: a dip, then a smaller rebound.
      const dip = v < 0.6 ? -SETTLE_DIP * Math.sin(Math.PI * (v / 0.6)) : SETTLE_REBOUND * Math.sin(Math.PI * ((v - 0.6) / 0.4));
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

  /** Standing spot in the aisle in front of a bench (for the debug API). */
  aisleStand(bench: Bench): PoseRec {
    const x = bench.seated.x;
    const z = BOOTH.zInner - 0.4;
    return { x, y: PLAYER.eyeHeight, z, yaw: yawToward(bench.focus.x - x, bench.focus.z - z), pitch: THREE.MathUtils.degToRad(-25) };
  }
}

function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}
