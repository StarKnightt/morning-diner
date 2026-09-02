/**
 * First-person controller: pointer-lock mouse look, WASD walking at 1.4 m/s,
 * fixed eye height, circle-vs-AABB sliding collision against the scene's
 * collider list. No jumping, no crouching — this is a walk through a diner.
 *
 * Feel (System 7 rev 2): velocity is rate-limited so a key press takes 0.15 s
 * to reach walking speed and 0.12 s to stop (a body, not a cursor); while moving
 * the camera bobs 1.4 cm vertically at 1.8 Hz with a 0.5 cm sway at half that
 * (a relaxed walking cadence, amplitude scaled by speed), and the bob fades
 * out over 0.2 s when you stop rather than freezing mid-step. The bob
 * is applied to the camera only — `position` (what colliders see) never bobs,
 * and `setPose()` / a still player produce exactly the flat eye height, so the
 * capture harness frames are unchanged. Mouse look has no smoothing.
 */
import * as THREE from "three";
import type { Collider } from "../core/merge";
import { PLAYER } from "../scene/layout";

const PITCH_LIMIT = THREE.MathUtils.degToRad(85);
/** Seconds to reach walking speed / to stop. */
const ACCEL_TIME = 0.15;
const DECEL_TIME = 0.12;
/** Head-bob: vertical amplitude (m), cadence at walking speed (Hz), lateral sway (m). */
const BOB_AMP = 0.014;
const BOB_HZ = 1.8;
const BOB_SWAY = 0.005;

export class FirstPerson {
  readonly camera: THREE.PerspectiveCamera;
  readonly position = new THREE.Vector3();
  /** Radians. yaw 0 looks toward -z; positive turns left. pitch positive looks up. */
  yaw = 0;
  pitch = 0;
  enabled = true;

  private keys = new Set<string>();
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
    this.applyToCamera();
  }

  update(dt: number): void {
    if (!this.enabled) return;
    let fwd = 0, side = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) fwd += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) fwd -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) side += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) side -= 1;
    // Target velocity from the keys (world xz), then rate-limit toward it.
    let tx = 0, tz = 0;
    if (fwd !== 0 || side !== 0) {
      this.tmpForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.tmpRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      this.tmpMove.copy(this.tmpForward).multiplyScalar(fwd).addScaledVector(this.tmpRight, side).normalize().multiplyScalar(PLAYER.walkSpeed);
      tx = this.tmpMove.x;
      tz = this.tmpMove.z;
    }
    const v = this.vel;
    const dx = tx - v.x, dz = tz - v.y;
    const gap = Math.hypot(dx, dz);
    if (gap > 1e-6 && dt > 0) {
      const accelerating = tx !== 0 || tz !== 0;
      const maxStep = (PLAYER.walkSpeed / (accelerating ? ACCEL_TIME : DECEL_TIME)) * dt;
      const k = Math.min(1, maxStep / gap);
      v.x += dx * k;
      v.y += dz * k;
    }
    const speed = Math.hypot(v.x, v.y);
    if (speed > 1e-4) this.moveWithCollision(v.x * dt, v.y * dt);

    // Head-bob: cadence follows speed; amplitude eases in over 0.25 s and, when stopping, the
    // phase keeps running while the amplitude fades over 0.2 s — no freeze mid-step, no snap.
    const speedFrac = Math.min(1, speed / PLAYER.walkSpeed);
    if (speedFrac > 0.05) {
      this.bobPhase += 2 * Math.PI * BOB_HZ * (0.6 + 0.4 * speedFrac) * dt;
      this.bobAmount = Math.min(1, this.bobAmount + dt / 0.25);
    } else if (this.bobAmount > 0) {
      this.bobPhase += 2 * Math.PI * BOB_HZ * 0.6 * dt;
      this.bobAmount = Math.max(0, this.bobAmount - dt / 0.2);
      if (this.bobAmount === 0) this.bobPhase = 0;
    }
    this.applyToCamera();
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

  private applyToCamera(): void {
    this.camera.position.copy(this.position);
    if (this.bobAmount > 0) {
      const a = this.bobAmount;
      // Two footfalls per stride: vertical at BOB_HZ (each step), sway at half (left/right).
      this.camera.position.y += BOB_AMP * a * Math.abs(Math.sin(this.bobPhase)) - BOB_AMP * a * 0.5;
      const sway = BOB_SWAY * a * Math.sin(this.bobPhase * 0.5);
      this.camera.position.x += Math.cos(this.yaw) * sway;
      this.camera.position.z += -Math.sin(this.yaw) * sway;
    }
    this.camera.rotation.set(0, 0, 0, "YXZ");
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }
}
