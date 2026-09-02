/**
 * Small shared helpers for System 7: easing curves and the Interactable
 * contract every one of the three interactions implements.
 */
import type * as THREE from "three";

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (t: number): number => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};
/** Cubic ease in-out. */
export const easeInOut = (t: number): number => {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const easeOut = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeIn = (t: number): number => Math.pow(clamp01(t), 3);
/** Ease-out with a small overshoot (c1 controls it; 0.6 → ~3.5 % over). */
export const easeOutBack = (t: number, c1 = 0.6): number => {
  t = clamp01(t);
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
/** Sine ease in-out (a closer's constant-ish sweep). */
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;
/** Phase of `t` within [a, b], clamped to 0..1. */
export const phase = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));

/** Camera yaw (radians, FirstPerson convention: 0 looks −z, positive turns toward −x) that looks along `dx, dz`. */
export const yawToward = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

/**
 * One thing the player can do. The controller picks the nearest interactable
 * whose focus point is within `reach` metres and inside a cone of
 * `halfAngleDeg` around the camera forward, and shows its `label`.
 */
export interface Interactable {
  readonly name: string;
  /** Prompt text after the key glyph, e.g. "Sit". */
  label(): string;
  /** World point the player has to look at. Written into `out`. */
  focus(out: THREE.Vector3): THREE.Vector3;
  reach: number;
  halfAngleDeg: number;
  /** False while animating or otherwise unavailable — no prompt, key ignored. */
  available(): boolean;
  /** Fire. Only called when `available()`. */
  interact(): void;
}
