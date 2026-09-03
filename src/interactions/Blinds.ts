/**
 * feat-blinds-f: raise / lower a window's venetian blind (F while looking at the window).
 * Geometry + the analytic stripe uniform live in scene/Blinds.ts (`BlindRig.setDrop`); this is
 * the timeline, in the System 7 rev 2 grammar (anticipation beat, SFX cued on the visual,
 * seekable and silent under a seek, shadow-once via `consumeShadowDirty`).
 *
 *   raise  reach  0 → 0.20   hand to the pull cord (cord rustle starts as it takes the weight)
 *          travel 0.20 → 2.30  drop 1 → 0, sine ease in/out: the stack gathers from the bottom
 *          settle 2.30 → 2.50  a 9 mm overshoot bump against the headrail, then rest (up)
 *   lower  reach  0 → 0.15   hand lets the cord lock go
 *          travel 0.15 → 1.60  drop 0 → 1, ease-in (gravity) with a braked last 15 cm
 *          settle 1.60 → 2.00  the rail bounces 5 mm and the slats clatter as they seat
 *
 * Shadow-once: the rail assembly casts, the slats do not (analytic term). `consumeShadowDirty()`
 * is true every ~0.3 s of travel and once at rest, so index.ts re-bakes the maps then.
 */
import * as THREE from "three";
import type { BlindRig } from "../scene/Blinds";
import { clamp01, easeInOutSine, phase, type Interactable } from "./util";

const TL = {
  raise: { reach: [0, 0.2], travel: [0.2, 2.3], settle: [2.3, 2.5], end: 2.5 },
  lower: { reach: [0, 0.15], travel: [0.15, 1.6], settle: [1.6, 2.0], end: 2.0 },
} as const;
export const BLINDS_RAISE_END = TL.raise.end;
export const BLINDS_LOWER_END = TL.lower.end;

export interface BlindsAudio {
  /** The cord taking the weight and the slats gathering: a soft ratchet / rustle. */
  raise(at: THREE.Vector3): void;
  /** The blind running down: a shorter rustle. */
  run(at: THREE.Vector3): void;
  /** The slats seating on the rail at the bottom: a metallic clatter. */
  clatter(at: THREE.Vector3): void;
}

export type BlindState = "down" | "raising" | "up" | "lowering";

export class BlindInteraction {
  readonly interactable: Interactable;
  state: BlindState = "down";
  /** Current drop 1 (down) … 0 (up). */
  drop = 1;
  private t = -1;
  private dirty = false;
  private sinceBake = 0;

  constructor(readonly rig: BlindRig, private readonly audio: BlindsAudio) {
    this.interactable = {
      name: `blinds-${rig.wi}`,
      label: () => (this.state === "up" ? "Lower blinds" : "Raise blinds"),
      focus: (out) => out.copy(this.rig.focus),
      reach: 2.5,
      halfAngleDeg: 22,
      available: () => this.state === "down" || this.state === "up",
      interact: () => this.toggle(),
    };
  }

  get busy(): boolean {
    return this.t >= 0;
  }

  /** True when the shadow maps should be re-baked (every ~0.3 s of travel, and once at rest). */
  consumeShadowDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  toggle(): void {
    if (this.t >= 0) return;
    this.state = this.state === "up" ? "lowering" : "raising";
    this.t = 0;
    this.sinceBake = 0;
    this.update(0);
  }

  /** Jump to `seconds` into the raise (from down) or the lowering (from up), silent. */
  seek(seconds: number, from: "down" | "up" = "down"): void {
    const tl = from === "down" ? TL.raise : TL.lower;
    if (seconds >= tl.end) {
      this.state = from === "down" ? "up" : "down";
      this.t = -1;
    } else {
      this.state = from === "down" ? "raising" : "lowering";
      this.t = Math.max(0, seconds);
    }
    this.apply(this.t);
    this.dirty = true;
  }

  reset(): void {
    this.state = "down";
    this.t = -1;
    this.apply(-1);
    this.dirty = true;
  }

  update(dt: number): void {
    if (this.t < 0) return;
    const before = this.t;
    const t = before + dt;
    const raising = this.state === "raising";
    const tl = raising ? TL.raise : TL.lower;
    if (dt > 0) {
      const at = this.rig.focus;
      if (before < tl.travel[0] && t >= tl.travel[0]) (raising ? this.audio.raise : this.audio.run).call(this.audio, at);
      if (!raising && before < tl.settle[0] && t >= tl.settle[0]) this.audio.clatter(at);
      this.sinceBake += dt;
      if (this.sinceBake >= 0.3) {
        this.sinceBake = 0;
        this.dirty = true;
      }
    }
    if (t >= tl.end) {
      this.state = raising ? "up" : "down";
      this.t = -1;
      this.apply(-1);
      this.dirty = true;
      return;
    }
    this.t = t;
    this.apply(t);
  }

  /** Drop at cycle time `t` for the current state; −1 = at rest. */
  dropAt(t: number): number {
    if (t < 0) return this.state === "up" ? 0 : 1;
    if (this.state === "raising") {
      const { travel, settle } = TL.raise;
      if (t < travel[0]) return 1;
      if (t < travel[1]) return 1 - easeInOutSine(phase(t, travel[0], travel[1]));
      // Overshoot bump against the headrail (the rig clamps the rail ~9 mm above its stop).
      const v = phase(t, settle[0], settle[1]);
      return -0.006 * Math.sin(Math.PI * v) * (1 - 0.4 * v);
    }
    if (this.state === "lowering") {
      const { travel, settle } = TL.lower;
      if (t < travel[0]) return 0;
      if (t < travel[1]) {
        // Gravity: quadratic ease-in to 90 %, the cord lock's brake takes the last 15 cm.
        const u = phase(t, travel[0], travel[1]);
        return u < 0.75 ? 0.9 * (u / 0.75) * (u / 0.75) : 0.9 + 0.1 * clamp01((u - 0.75) / 0.25) * (2 - clamp01((u - 0.75) / 0.25));
      }
      // Seat: the rail bounces on the sill stop and the slats settle with a small wobble.
      const tau = t - settle[0];
      return 1 - 0.005 * Math.exp(-6 * tau) * Math.abs(Math.sin(18 * tau));
    }
    return this.state === "up" ? 0 : 1;
  }

  private apply(t: number): void {
    const d = this.dropAt(t);
    this.drop = d;
    this.rig.setDrop(d);
  }
}
