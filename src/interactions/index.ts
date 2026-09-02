/**
 * System 7 — the three interactions (sit, pour coffee, open the door) plus
 * the System 6 audio wiring. One call from main.ts:
 *
 *   const interactions = initInteractions({ renderer, scene, camera, player, diner });
 *   ... in the loop, after diner.update(dt):  interactions.update(dt);
 *
 * Input: E (also F, or a click while the pointer is locked). A centre-bottom
 * hint fades in when a target is within reach and inside the look cone.
 * Debug/capture API on `window.__interact` — see debug.ts.
 */
import * as THREE from "three";
import { wireDinerAudio, type DinerAudioWiring } from "../audio/wiring";
import type { FirstPerson } from "../player/FirstPerson";
import type { Diner } from "../scene/Diner";
import { installInteractionDebugApi } from "./debug";
import { DoorInteraction } from "./DoorSwing";
import { PourInteraction } from "./Pour";
import { Prompt } from "./Prompt";
import { SitInteraction } from "./Sit";
import type { Interactable } from "./util";

export interface InteractionContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  player: FirstPerson;
  diner: Diner;
}

export interface Interactions {
  update(dt: number): void;
  /** Start the audio engine (call from a user gesture, e.g. the loader's "Click to enter"). */
  startAudio(): Promise<void>;
  readonly audio: DinerAudioWiring["audio"];
  readonly sit: SitInteraction;
  readonly pour: PourInteraction;
  readonly door: DoorInteraction;
  /** Bind sun / exposure to the door: fn(progress 0..1). Returns an unsubscribe. */
  onDoorOpen(fn: (progress: number) => void): () => void;
  /** Currently highlighted target, or null. */
  readonly target: Interactable | null;
  /** Fire the highlighted target (what E does). */
  interact(): void;
  dispose(): void;
}

const KEYS = new Set(["KeyE", "KeyF"]);

export function initInteractions(ctx: InteractionContext): Interactions {
  const { renderer, scene, camera, player, diner } = ctx;
  const wiring = wireDinerAudio();
  const { audio } = wiring;
  const toVec = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });

  const sit = new SitInteraction(player);
  const pour = new PourInteraction(scene, renderer, diner.palette, diner.coffeePot, diner.pourMug, {
    clink: (at) => audio.sfx.mugClink(toVec(at)),
    pour: (seconds, at) => audio.sfx.pourCoffee(seconds, toVec(at)),
  });
  const door = new DoorInteraction(diner.door, diner.colliders, player, {
    open: () => audio.sfx.doorOpen(),
    outside: (amount) => audio.sfx.setOutside(amount),
  }, scene);

  const prompt = new Prompt("E", new URLSearchParams(location.search).has("shoot"));
  const items: Interactable[] = [...sit.interactables, pour.interactable, door.interactable];

  const camPos = new THREE.Vector3();
  const camFwd = new THREE.Vector3();
  const focus = new THREE.Vector3();
  let target: Interactable | null = null;
  let frozen = false;

  function pickTarget(): Interactable | null {
    if (sit.seated) return sit.stand.available() ? sit.stand : null;
    camera.getWorldPosition(camPos);
    camera.getWorldDirection(camFwd);
    let best: Interactable | null = null;
    let bestScore = Infinity;
    for (const it of items) {
      if (!it.available()) continue;
      it.focus(focus).sub(camPos);
      const d = focus.length();
      if (d > it.reach || d < 1e-4) continue;
      const cosA = focus.dot(camFwd) / d;
      if (cosA < Math.cos(THREE.MathUtils.degToRad(it.halfAngleDeg))) continue;
      // Prefer what is most centred, then nearest.
      const score = (1 - cosA) * 4 + d * 0.25;
      if (score < bestScore) {
        bestScore = score;
        best = it;
      }
    }
    return best;
  }

  function interact(): void {
    const t = target ?? pickTarget();
    if (t && t.available()) t.interact();
  }

  const onKey = (e: KeyboardEvent): void => {
    if (!KEYS.has(e.code) || e.repeat) return;
    interact();
  };
  const onMouse = (e: MouseEvent): void => {
    if (e.button !== 0 || document.pointerLockElement !== renderer.domElement) return;
    interact();
  };
  document.addEventListener("keydown", onKey);
  document.addEventListener("mousedown", onMouse);

  const api: Interactions = {
    update(dt: number): void {
      const step = frozen ? 0 : dt;
      sit.update(step);
      pour.update(step);
      door.update(step);
      target = pickTarget();
      prompt.set(target ? target.label() : null);
      audio.update(camera);
    },
    startAudio: wiring.startAudio,
    audio,
    sit,
    pour,
    door,
    onDoorOpen: (fn) => door.onDoorOpen(fn),
    get target() {
      return target;
    },
    interact,
    dispose(): void {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouse);
      prompt.dispose();
      wiring.dispose();
    },
  };

  installInteractionDebugApi(api, player, {
    freeze: (f) => (frozen = f),
    isFrozen: () => frozen,
  });
  return api;
}
