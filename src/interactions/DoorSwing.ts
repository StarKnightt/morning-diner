/**
 * The front door. Press E at the door: the leaf (the `front-door` hinge
 * Group built in Door.ts) swings outward to 85° with weight — ease-out over
 * 1.1 s with a ~3 % overshoot that settles — holds 4 s, then the closer
 * brings it back: a slow sine sweep to 8° over 1.8 s and a quick latch.
 *
 * While it moves: `setOutside(progress)` crossfades the exterior heat wall in
 * (System 6), `onDoorOpen(progress)` fires for any listener (System 4/8 bind
 * sun/exposure here; the default nudges the hemisphere fill by +12 %), and an
 * AABB collider follows the leaf so the player can walk out through the
 * opening while it is open and cannot walk through the closed leaf.
 */
import * as THREE from "three";
import type { Collider } from "../core/merge";
import type { FirstPerson } from "../player/FirstPerson";
import { DOOR, ROOM } from "../scene/layout";
import { easeIn, easeInOutSine, easeOutBack, phase, type Interactable } from "./util";

const OPEN_DEG = 85;
const TL = { open: [0, 1.1], hold: [1.1, 5.1], sweep: [5.1, 6.9], latch: [6.9, 7.15], end: 7.15 } as const;
const SWEEP_TO_DEG = 8;
export const DOOR_CYCLE_END = TL.end;

const LEAF_W = DOOR.width - 2 * DOOR.jamb - 2 * DOOR.reveal;
const LEAF_T = 0.045;

export interface DoorAudio {
  open(): void;
  /** 0 shut … 1 open. */
  outside(amount: number): void;
}

export type DoorListener = (progress: number) => void;

export class DoorInteraction {
  readonly interactable: Interactable;
  /** 0 shut … 1 fully open, updated every frame. */
  progress = 0;
  private t = -1;
  private readonly leaf: THREE.Group;
  private readonly collider: Collider;
  private readonly listeners: DoorListener[] = [];
  private readonly focusPoint: THREE.Vector3;
  private lastOutside = -1;

  constructor(leaf: THREE.Group, colliders: Collider[], private readonly player: FirstPerson, private readonly audio: DoorAudio, scene: THREE.Scene) {
    this.leaf = leaf;
    this.collider = { min: new THREE.Vector3(), max: new THREE.Vector3() };
    colliders.push(this.collider);
    const zMid = ROOM.zFront + ROOM.wallThickness / 2;
    this.focusPoint = new THREE.Vector3(DOOR.centerX, 1.1, zMid);
    this.updateCollider();

    // Default light hook: brighten the hemisphere fill a touch while the leaf is open.
    let hemi: THREE.HemisphereLight | null = null;
    scene.traverse((o) => {
      if (!hemi && (o as THREE.HemisphereLight).isHemisphereLight) hemi = o as THREE.HemisphereLight;
    });
    if (hemi) {
      const h: THREE.HemisphereLight = hemi;
      const base = h.intensity;
      this.onDoorOpen((p) => (h.intensity = base * (1 + 0.12 * p)));
    }

    this.interactable = {
      name: "door",
      label: () => "Open door",
      focus: (out) => out.copy(this.focusPoint),
      reach: 1.4,
      halfAngleDeg: 28,
      available: () => this.t < 0,
      interact: () => this.open(),
    };
  }

  /** Register a listener for the open progress (0..1). Called every frame the door moves, plus once at rest. */
  onDoorOpen(fn: DoorListener): () => void {
    this.listeners.push(fn);
    fn(this.progress);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  open(): void {
    if (this.t >= 0) return;
    this.t = 0;
    this.audio.open();
    this.update(0);
  }

  /** Jump to `seconds` into the cycle (silent). */
  seek(seconds: number): void {
    this.t = seconds >= TL.end ? -1 : seconds;
    this.apply(seconds >= TL.end ? -1 : seconds);
  }

  reset(): void {
    this.t = -1;
    this.apply(-1);
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    if (this.t >= TL.end) this.t = -1;
    this.apply(this.t);
  }

  private apply(t: number): void {
    let deg = 0;
    if (t >= 0) {
      if (t < TL.open[1]) deg = OPEN_DEG * easeOutBack(phase(t, TL.open[0], TL.open[1]), 0.6);
      else if (t < TL.hold[1]) deg = OPEN_DEG;
      else if (t < TL.sweep[1]) deg = OPEN_DEG - (OPEN_DEG - SWEEP_TO_DEG) * easeInOutSine(phase(t, TL.sweep[0], TL.sweep[1]));
      else if (t < TL.latch[1]) deg = SWEEP_TO_DEG * (1 - easeIn(phase(t, TL.latch[0], TL.latch[1])));
    }
    // Swing outward (+z): rotation.y negative turns local +x toward +z.
    this.leaf.rotation.y = -THREE.MathUtils.degToRad(deg);
    const p = Math.min(1, Math.max(0, deg / OPEN_DEG));
    this.progress = p;
    if (p !== this.lastOutside) {
      this.lastOutside = p;
      this.audio.outside(p);
      for (const fn of this.listeners) fn(p);
    }
    this.updateCollider();
  }

  private updateCollider(): void {
    const hx = this.leaf.position.x, hz = this.leaf.position.z;
    const a = -this.leaf.rotation.y;
    const ex = hx + LEAF_W * Math.cos(a), ez = hz + LEAF_W * Math.sin(a);
    const pad = LEAF_T / 2 + 0.01;
    const c = this.collider;
    c.min.set(Math.min(hx, ex) - pad, 0, Math.min(hz, ez) - pad);
    c.max.set(Math.max(hx, ex) + pad, DOOR.height, Math.max(hz, ez) + pad);
    // If the player's centre is already inside the box (they stood in the swing while it closed),
    // disable it this frame rather than trapping them: FirstPerson skips colliders with max.y < 0.05.
    const pp = this.player.position;
    if (pp.x > c.min.x && pp.x < c.max.x && pp.z > c.min.z && pp.z < c.max.z) c.max.y = 0;
  }
}
