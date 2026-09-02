/**
 * The front door. Press E at the door: the leaf (the `front-door` hinge
 * Group built in Door.ts) swings outward to 85° and a surface closer brings
 * it back. Timeline (seconds from the E press), tuned against a commercial
 * storefront closer (LCN 4040-class: sweep valve + latch valve + backcheck):
 *
 *   reach   0 → 0.22   hand to the push bar; the hint fades (0.18 s) before anything moves;
 *                      the latch-release click + hinge whoosh fire as the leaf starts
 *   open    0.22 → 1.45 a weighted push: slow start, peak speed ≈ 40 % in, then the
 *                      backcheck cushions the last 15° (a 0.9° bump into the cushion, no spring)
 *   hold    1.45 → 2.85 the person is in the doorway; extended while the player stands in
 *                      the threshold zone, so the door never closes on them
 *   sweep   2.85 → 6.45 closer sweep 85° → 12° in 3.6 s: quick take-up from rest, then
 *                      decelerating (spring torque falls as the arm folds, damping ∝ speed).
 *                      Field practice is 3–7 s to the latch zone (ADA 404.2.8 asks ≥ 5 s for
 *                      accessible openings; this diner door is on the brisk side of that)
 *   latch   6.45 → 7.25 latch valve: the last 12° speed up slightly, velocity-continuous with
 *                      the sweep, and the leaf seats on the stop with a firm click (latch SFX)
 *
 * While it moves: `setOutside(progress)` crossfades the exterior heat wall
 * (System 6), `onDoorOpen(progress)` fires for any listener (System 4/8 bind
 * sun/exposure here; the default nudges the hemisphere fill by +12 %), and an
 * AABB collider follows the leaf so the player can walk out through the
 * opening while it is open and cannot walk through the closed leaf.
 */
import * as THREE from "three";
import type { Collider } from "../core/merge";
import type { FirstPerson } from "../player/FirstPerson";
import { DOOR, ROOM } from "../scene/layout";
import { phase, type Interactable } from "./util";

const OPEN_DEG = 85;
const LATCH_ZONE_DEG = 12;
const TL = { reach: [0, 0.22], open: [0.22, 1.45], hold: [1.45, 2.85], sweep: [2.85, 6.45], latch: [6.45, 7.25], end: 7.25 } as const;
export const DOOR_CYCLE_END = TL.end;
/** Backcheck bump: 0.9° into the cushion over 0.3 s after arrival (a closer has no spring-back). */
const BACKCHECK_BUMP_DEG = 0.9;
const BACKCHECK_BUMP_S = 0.3;

const LEAF_W = DOOR.width - 2 * DOOR.jamb - 2 * DOOR.reveal;
const LEAF_T = 0.045;

/**
 * Integrate a piecewise-linear angular-velocity profile v(u), u ∈ [0, 1], into a
 * normalised position LUT f(u) with f(0) = 0, f(1) = 1. Lets the swing be authored the way
 * an animator (or a closer valve) thinks: "fast here, slow there", then sampled cheaply.
 */
function integrateProfile(points: ReadonlyArray<readonly [number, number]>, n = 96): { lut: Float32Array; endSlope: number } {
  const v = (u: number): number => {
    for (let i = 1; i < points.length; i++) {
      if (u <= points[i][0]) {
        const [u0, v0] = points[i - 1], [u1, v1] = points[i];
        return v0 + ((v1 - v0) * (u - u0)) / Math.max(1e-6, u1 - u0);
      }
    }
    return points[points.length - 1][1];
  };
  const lut = new Float32Array(n + 1);
  let acc = 0;
  for (let i = 1; i <= n; i++) {
    const a = (i - 1) / n, b = i / n;
    acc += ((v(a) + v(b)) / 2) * (1 / n);
    lut[i] = acc;
  }
  for (let i = 0; i <= n; i++) lut[i] /= acc;
  // Normalised slope at u = 1 (dimensionless: fraction of travel per unit u).
  return { lut, endSlope: v(1) / acc };
}
function sampleLut(lut: Float32Array, u: number): number {
  u = u <= 0 ? 0 : u >= 1 ? 1 : u;
  const x = u * (lut.length - 1), i = Math.floor(x), f = x - i;
  return i >= lut.length - 1 ? 1 : lut[i] + (lut[i + 1] - lut[i]) * f;
}

/** Push: ease in over the first ~30 %, peak ≈ 40 %, then the backcheck (from ≈ 70°) drags the last stretch. */
const OPEN = integrateProfile([[0, 0], [0.1, 0.45], [0.3, 0.95], [0.42, 1.0], [0.68, 0.8], [0.82, 0.38], [0.94, 0.1], [1, 0]]);
/** Closer sweep: take-up from rest in the first 7 %, then a steady fall-off to ≈ 55 % speed at the latch zone. */
const SWEEP = integrateProfile([[0, 0], [0.07, 1.0], [1, 0.55]]);

export interface DoorAudio {
  /** Latch release + hinge whoosh + closer breathing in (fires as the leaf starts to move). */
  open(): void;
  /** 0 shut … 1 open. */
  outside(amount: number): void;
  /** Leaf meets the stop and the latch seats (fires at the end of the cycle). */
  latch?(): void;
}

export type DoorListener = (progress: number) => void;

export class DoorInteraction {
  readonly interactable: Interactable;
  /** 0 shut … 1 fully open, updated every frame. */
  progress = 0;
  /** Leaf angle in degrees (0 shut), for captures and the label strip. */
  angleDeg = 0;
  private t = -1;
  private lastDeg = 0;
  private moved = false;
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

  /**
   * True once if the leaf's angle changed since the last call. index.ts polls this every
   * frame and calls `diner.invalidateShadows()` (the shadow maps are rendered once at boot,
   * so the leaf's shadow on the floor and the sun through the opening would otherwise stay
   * "closed" while the door is open).
   */
  consumeMoved(): boolean {
    const m = this.moved;
    this.moved = false;
    return m;
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

  /** True while the player's centre is in the threshold zone (the closer waits for them). */
  private playerInDoorway(): boolean {
    const p = this.player.position;
    const x0 = DOOR.hingeX - 0.2, x1 = DOOR.hingeX + DOOR.width + 0.2;
    const z0 = ROOM.zFront - 0.6, z1 = ROOM.zFront + ROOM.wallThickness + 1.0;
    return p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1;
  }

  update(dt: number): void {
    if (this.t < 0) return;
    const before = this.t;
    let t = this.t + dt;
    // Hold extension: a real door is only held open while someone is in it.
    if (dt > 0 && before >= TL.hold[0] && before < TL.hold[1] && t >= TL.hold[1] - 0.25 && this.playerInDoorway()) t = Math.min(t, TL.hold[1] - 0.25);
    this.t = t;
    // SFX cues on the visual: latch release as the leaf starts, latch seat as it lands.
    if (dt > 0) {
      if (before < TL.open[0] && t >= TL.open[0]) this.audio.open();
      if (before < TL.end && t >= TL.end) this.audio.latch?.();
    }
    if (this.t >= TL.end) this.t = -1;
    this.apply(this.t);
  }

  /** Leaf angle (degrees) at cycle time `t`; −1 = at rest. */
  angleAt(t: number): number {
    if (t < 0) return 0;
    if (t < TL.open[0]) return 0;
    if (t < TL.open[1]) return OPEN_DEG * sampleLut(OPEN.lut, phase(t, TL.open[0], TL.open[1]));
    if (t < TL.hold[1]) {
      // Into the backcheck cushion and back: a bump, not a spring.
      const v = phase(t, TL.open[1], TL.open[1] + BACKCHECK_BUMP_S);
      return OPEN_DEG + BACKCHECK_BUMP_DEG * Math.sin(Math.PI * v);
    }
    if (t < TL.sweep[1]) return OPEN_DEG - (OPEN_DEG - LATCH_ZONE_DEG) * sampleLut(SWEEP.lut, phase(t, TL.sweep[0], TL.sweep[1]));
    if (t < TL.latch[1]) {
      // Velocity-continuous hand-over from the sweep, then the latch valve lets it speed up.
      const u = phase(t, TL.latch[0], TL.latch[1]);
      const sweepDegPerS = ((OPEN_DEG - LATCH_ZONE_DEG) * SWEEP.endSlope) / (TL.sweep[1] - TL.sweep[0]);
      const a = Math.min(1, (sweepDegPerS * (TL.latch[1] - TL.latch[0])) / LATCH_ZONE_DEG); // initial slope of g
      const g = a * u + (1 - a) * u * u;
      return LATCH_ZONE_DEG * (1 - g);
    }
    return 0;
  }

  private apply(t: number): void {
    const deg = this.angleAt(t);
    this.angleDeg = deg;
    // Swing outward (+z): rotation.y negative turns local +x toward +z.
    this.leaf.rotation.y = -THREE.MathUtils.degToRad(deg);
    if (deg !== this.lastDeg) {
      this.lastDeg = deg;
      this.moved = true;
    }
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
