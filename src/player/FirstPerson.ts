/**
 * First-person controller: pointer-lock mouse look, WASD walking at 1.4 m/s,
 * fixed eye height, circle-vs-AABB sliding collision against the scene's
 * collider list. No jumping, no crouching — this is a walk through a diner.
 */
import * as THREE from "three";
import type { Collider } from "../core/merge";
import { PLAYER } from "../scene/layout";

const PITCH_LIMIT = THREE.MathUtils.degToRad(85);

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
    this.applyToCamera();
  }

  update(dt: number): void {
    if (!this.enabled) return;
    let fwd = 0, side = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) fwd += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) fwd -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) side += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) side -= 1;
    if (fwd !== 0 || side !== 0) {
      this.tmpForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.tmpRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      this.tmpMove
        .copy(this.tmpForward)
        .multiplyScalar(fwd)
        .addScaledVector(this.tmpRight, side)
        .normalize()
        .multiplyScalar(PLAYER.walkSpeed * dt);
      this.moveWithCollision(this.tmpMove.x, this.tmpMove.z);
    }
    this.applyToCamera();
  }

  private moveWithCollision(dx: number, dz: number): void {
    const r = PLAYER.radius;
    const p = this.position;
    // Axis-separated so the player slides along walls.
    const nx = p.x + dx;
    if (!this.hits(nx, p.z, r)) p.x = nx;
    const nz = p.z + dz;
    if (!this.hits(p.x, nz, r)) p.z = nz;
  }

  private hits(x: number, z: number, r: number): boolean {
    for (const c of this.colliders) {
      // Ignore things entirely above the head or flush with the floor.
      if (c.min.y > 1.7 || c.max.y < 0.05) continue;
      const cx = THREE.MathUtils.clamp(x, c.min.x, c.max.x);
      const cz = THREE.MathUtils.clamp(z, c.min.z, c.max.z);
      const ddx = x - cx, ddz = z - cz;
      if (ddx * ddx + ddz * ddz < r * r) return true;
    }
    return false;
  }

  private applyToCamera(): void {
    this.camera.position.copy(this.position);
    this.camera.rotation.set(0, 0, 0, "YXZ");
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }
}
