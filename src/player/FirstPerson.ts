/**
 * First-person controller: pointer-lock mouse look, WASD walking at 1.4 m/s
 * (Shift: 2.6 m/s), Space for a small hop, fixed eye height, circle-vs-AABB
 * sliding collision against the scene's collider list. No crouching — this is
 * a walk through a diner.
 *
 * Feel (System 7 rev 2): velocity is rate-limited so a key press takes 0.15 s
 * to reach walking speed and 0.12 s to stop (a body, not a cursor); while moving
 * the camera bobs 1.4 cm vertically at 1.8 Hz with a 0.5 cm sway at half that
 * (a relaxed walking cadence, amplitude scaled by speed), and the bob fades
 * out over 0.2 s when you stop rather than freezing mid-step. The bob
 * is applied to the camera only — `position` (what colliders see) never bobs,
 * and `setPose()` / a still player produce exactly the flat eye height, so the
 * capture harness frames are unchanged. Mouse look has no smoothing.
 *
 * System 9 (feature 5):
 *   Shift    walk fast: the target speed blends 1.4 → 2.6 m/s over 0.2 s (and back), the
 *            accel/decel *times* stay 0.15 / 0.12 s so the feel is the same; the head-bob
 *            follows the speed — 1.8 Hz / 1.4 cm p-p at a walk, 2.4 Hz / 2.2 cm p-p at a sprint.
 *            Refused while seated (the controller is disabled) or mid-interaction (`blocked()`).
 *   Space    a hop: 0.32 m apex under 9.81 m/s² (v0 = 2.51 m/s, 0.51 s in the air), no change to
 *            the horizontal handling in the air, a 2 cm landing dip over 0.15 s and `onLand()`
 *            for the footfall SFX. Refused while seated or mid-interaction; ceilings are not
 *            tested (the apex is under the counter overhang); the collision volume still holds
 *            horizontally. `position.y` stays the eye height — the jump is a camera offset
 *            (`airY`) like the bob, so poses, colliders and the seat transitions are untouched.
 *   lean     `{ pitch, roll, yaw }` radians added to the camera's rotation (the sip's head-tilt and gaze drift).
 */
import * as THREE from "three";
import type { Collider } from "../core/merge";
import { PLAYER } from "../scene/layout";

const PITCH_LIMIT = THREE.MathUtils.degToRad(85);
/** Seconds to reach walking speed / to stop. */
const ACCEL_TIME = 0.15;
const DECEL_TIME = 0.12;
/** Head-bob: vertical amplitude (m, peak-to-peak), cadence at walking speed (Hz), lateral sway (m). */
const BOB_AMP = 0.014;
const BOB_HZ = 1.8;
const BOB_SWAY = 0.005;
/** Sprint (System 9): speed, bob at full sprint, and the blend in/out of the sprint. */
export const SPRINT_SPEED = 2.6;
const SPRINT_BOB_AMP = 0.022;
const SPRINT_BOB_HZ = 2.4;
const SPRINT_BLEND = 0.2;
/** Jump (System 9): apex and gravity; landing dip depth and duration. */
export const JUMP_APEX = 0.32;
const GRAVITY = 9.81;
const LAND_DIP = 0.02;
const LAND_DIP_TIME = 0.15;

export class FirstPerson {
  readonly camera: THREE.PerspectiveCamera;
  readonly position = new THREE.Vector3();
  /** Radians. yaw 0 looks toward -z; positive turns left. pitch positive looks up. */
  yaw = 0;
  pitch = 0;
  enabled = true;
  /**
   * Mid-interaction gate (System 9): while this returns true, Shift and Space are refused
   * (a sprint already running blends out). Interactions set it (index.ts).
   */
  blocked: () => boolean = () => false;
  /** Feet planted (System 9 Drink.ts): the keys are ignored — the body decelerates — but the look stays live. */
  movementLocked = false;
  /** Extra camera rotation, radians — the sip's head-tilt and gaze drift (Drink.ts). Zero at rest. */
  readonly lean = { pitch: 0, roll: 0, yaw: 0 };
  /** Landing footfall: `strength` 0..1 from the impact speed (0.32 m hop ≈ 1). */
  onLand?: (strength: number) => void;

  /** Pressed key codes (public for the feel harness: `__player.keys.add("KeyW")`). */
  readonly keys = new Set<string>();
  private colliders: Collider[];
  private locked = false;
  private tmpForward = new THREE.Vector3();
  private tmpRight = new THREE.Vector3();
  private tmpMove = new THREE.Vector3();
  /** Current horizontal velocity (world xz), rate-limited toward the input direction. */
  private vel = new THREE.Vector2();
  /** Head-bob phase (radians) and current amplitude factor 0..1. */
  private bobPhase = 0;
  private bobAmount = 0;
  /** Sprint blend 0..1 (0.2 s in / out). */
  private sprint = 0;
  /** Jump: camera height offset over the eye line and its vertical speed; landing-dip clock (−1 = idle). */
  private airY = 0;
  private airV = 0;
  private airborne = false;
  private dipT = -1;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement, colliders: Collider[]) {
    this.camera = camera;
    this.colliders = colliders;
    this.position.set(PLAYER.start.x, PLAYER.eyeHeight, PLAYER.start.z);
    this.yaw = THREE.MathUtils.degToRad(PLAYER.start.yawDeg);
    this.pitch = THREE.MathUtils.degToRad(PLAYER.start.pitchDeg);
    this.applyToCamera();

    domElement.addEventListener("click", () => {
      if (!this.locked && this.enabled) domElement.requestPointerLock();
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === domElement;
      if (!this.locked) this.keys.clear();
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    });
    document.addEventListener("keydown", (e) => {
      if (this.locked) this.keys.add(e.code);
    });
    document.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  /** Teleport (used by the capture harness). Angles in degrees. */
  setPose(x: number, y: number | undefined, z: number, yawDeg: number, pitchDeg: number): void {
    this.position.set(x, y ?? PLAYER.eyeHeight, z);
    this.yaw = THREE.MathUtils.degToRad(yawDeg);
    this.pitch = THREE.MathUtils.clamp(THREE.MathUtils.degToRad(pitchDeg), -PITCH_LIMIT, PITCH_LIMIT);
    this.vel.set(0, 0);
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.sprint = 0;
    this.airY = 0;
    this.airV = 0;
    this.airborne = false;
    this.dipT = -1;
    this.applyToCamera();
  }

  /** Current horizontal speed, m/s (harness). */
  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.y);
  }

  /** True between take-off and landing (harness; interactions refuse to start mid-air). */
  get inAir(): boolean {
    return this.airborne;
  }

  /** Camera height over the eye line while jumping (harness). */
  get jumpHeight(): number {
    return this.airY;
  }

  /** Sprint blend 0..1 (harness). */
  get sprintAmount(): number {
    return this.sprint;
  }

  update(dt: number): void {
    if (!this.enabled) {
      // Seated (Sit.ts drives the camera): nothing runs, and a hop or sprint in flight is dropped
      // — Sit's own transition owns the camera from the flat pose.
      this.airY = 0;
      this.airV = 0;
      this.airborne = false;
      this.dipT = -1;
      this.sprint = 0;
      return;
    }
    const blocked = this.blocked() || this.movementLocked;
    let fwd = 0, side = 0;
    if (!this.movementLocked) {
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) fwd += 1;
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) fwd -= 1;
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) side += 1;
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) side -= 1;
    }
    // Sprint blend: Shift held (and allowed) → 1 over 0.2 s; released / refused → 0 over 0.2 s.
    const wantSprint = !blocked && (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"));
    this.sprint = THREE.MathUtils.clamp(this.sprint + (wantSprint ? dt : -dt) / SPRINT_BLEND, 0, 1);
    const topSpeed = THREE.MathUtils.lerp(PLAYER.walkSpeed, SPRINT_SPEED, this.sprint);
    // Target velocity from the keys (world xz), then rate-limit toward it.
    let tx = 0, tz = 0;
    if (fwd !== 0 || side !== 0) {
      this.tmpForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.tmpRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      this.tmpMove.copy(this.tmpForward).multiplyScalar(fwd).addScaledVector(this.tmpRight, side).normalize().multiplyScalar(topSpeed);
      tx = this.tmpMove.x;
      tz = this.tmpMove.z;
    }
    const v = this.vel;
    const dx = tx - v.x, dz = tz - v.y;
    const gap = Math.hypot(dx, dz);
    if (gap > 1e-6 && dt > 0) {
      const accelerating = tx !== 0 || tz !== 0;
      // Same *time* to speed at a walk and at a sprint (the rate scales with the target).
      const maxStep = (topSpeed / (accelerating ? ACCEL_TIME : DECEL_TIME)) * dt;
      const k = Math.min(1, maxStep / gap);
      v.x += dx * k;
      v.y += dz * k;
    }
    const speed = Math.hypot(v.x, v.y);
    if (speed > 1e-4) this.moveWithCollision(v.x * dt, v.y * dt);

    // Jump: Space on the ground (edge-triggered by consuming the key) → v0 for a 0.32 m apex.
    if (this.keys.has("Space")) {
      this.keys.delete("Space"); // one hop per press; held Space does not bunny-hop
      if (!this.airborne && !blocked) {
        this.airborne = true;
        this.airV = Math.sqrt(2 * GRAVITY * JUMP_APEX);
        this.dipT = -1;
      }
    }
    if (this.airborne && dt > 0) {
      // Exact ballistic step (not Euler — at 120 Hz Euler lands 1 cm under the apex).
      this.airY += this.airV * dt - 0.5 * GRAVITY * dt * dt;
      this.airV -= GRAVITY * dt;
      if (this.airY <= 0) {
        // Landed: the impact speed sets the footfall; the knees give 2 cm over 0.15 s.
        const impact = Math.min(1, -this.airV / Math.sqrt(2 * GRAVITY * JUMP_APEX));
        this.airY = 0;
        this.airV = 0;
        this.airborne = false;
        this.dipT = 0;
        this.onLand?.(impact);
      }
    }
    if (this.dipT >= 0) {
      this.dipT += dt;
      if (this.dipT >= LAND_DIP_TIME) this.dipT = -1;
    }

    // Head-bob: cadence follows speed; amplitude eases in over 0.25 s and, when stopping, the
    // phase keeps running while the amplitude fades over 0.2 s — no freeze mid-step, no snap.
    // In the air the feet are off the floor: the bob fades out and the phase pauses.
    const speedFrac = Math.min(1, speed / PLAYER.walkSpeed);
    const sprintFrac = THREE.MathUtils.clamp((speed - PLAYER.walkSpeed) / (SPRINT_SPEED - PLAYER.walkSpeed), 0, 1);
    const hz = THREE.MathUtils.lerp(BOB_HZ, SPRINT_BOB_HZ, sprintFrac);
    if (speedFrac > 0.05 && !this.airborne) {
      this.bobPhase += 2 * Math.PI * hz * (0.6 + 0.4 * speedFrac) * dt;
      this.bobAmount = Math.min(1, this.bobAmount + dt / 0.25);
    } else if (this.bobAmount > 0) {
      if (!this.airborne) this.bobPhase += 2 * Math.PI * hz * 0.6 * dt;
      this.bobAmount = Math.max(0, this.bobAmount - dt / 0.2);
      if (this.bobAmount === 0) this.bobPhase = 0;
    }
    this.applyToCamera(sprintFrac);
  }

  /**
   * Move, then resolve every circle-vs-AABB overlap by pushing out along the contact normal
   * (up to 4 rounds so two touching boxes settle). Sliding falls out of that: on a face the
   * push is perpendicular to the face, so the tangential part of the step survives; at a
   * corner the push is along the corner-to-centre direction, so the player rolls round it.
   * (The old axis-separated test refused *both* axes whenever the circle touched a corner,
   * which turned every stool base into a snag when walking diagonally along the counter.)
   * If the resolution would fling the player farther than the step (squeezed between two
   * boxes), the move is refused instead.
   */
  private moveWithCollision(dx: number, dz: number): void {
    const r = PLAYER.radius;
    const p = this.position;
    const ox = p.x, oz = p.z;
    p.x += dx;
    p.z += dz;
    for (let round = 0; round < 4; round++) {
      let pushed = false;
      for (const c of this.colliders) {
        // Ignore things entirely above the head or flush with the floor.
        if (c.min.y > 1.7 || c.max.y < 0.05) continue;
        const cx = THREE.MathUtils.clamp(p.x, c.min.x, c.max.x);
        const cz = THREE.MathUtils.clamp(p.z, c.min.z, c.max.z);
        const ddx = p.x - cx, ddz = p.z - cz;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          const push = r - d + 1e-4;
          p.x += (ddx / d) * push;
          p.z += (ddz / d) * push;
        } else {
          // Centre inside the box: out through the nearest face.
          const lx = Math.min(p.x - c.min.x, c.max.x - p.x), lz = Math.min(p.z - c.min.z, c.max.z - p.z);
          if (lx < lz) p.x += (p.x >= (c.min.x + c.max.x) / 2 ? 1 : -1) * (lx + r + 1e-4);
          else p.z += (p.z >= (c.min.z + c.max.z) / 2 ? 1 : -1) * (lz + r + 1e-4);
        }
        pushed = true;
      }
      if (!pushed) break;
    }
    const step = Math.hypot(dx, dz);
    if (Math.hypot(p.x - ox, p.z - oz) > step + 0.05) {
      p.x = ox;
      p.z = oz;
    }
  }

  private applyToCamera(sprintFrac = 0): void {
    this.camera.position.copy(this.position);
    if (this.bobAmount > 0) {
      const a = this.bobAmount;
      const amp = THREE.MathUtils.lerp(BOB_AMP, SPRINT_BOB_AMP, sprintFrac);
      // Two footfalls per stride: vertical at the cadence (each step), sway at half (left/right).
      this.camera.position.y += amp * a * Math.abs(Math.sin(this.bobPhase)) - amp * a * 0.5;
      const sway = BOB_SWAY * a * Math.sin(this.bobPhase * 0.5);
      this.camera.position.x += Math.cos(this.yaw) * sway;
      this.camera.position.z += -Math.sin(this.yaw) * sway;
    }
    if (this.airY > 0) this.camera.position.y += this.airY;
    if (this.dipT >= 0) this.camera.position.y -= LAND_DIP * Math.sin(Math.PI * Math.min(1, this.dipT / LAND_DIP_TIME));
    this.camera.rotation.set(0, 0, 0, "YXZ");
    this.camera.rotation.y = this.yaw + this.lean.yaw;
    this.camera.rotation.x = this.pitch + this.lean.pitch;
    this.camera.rotation.z = this.lean.roll;
  }
}
