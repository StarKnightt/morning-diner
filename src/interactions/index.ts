/**
 * System 7 — the three interactions (sit, pour coffee, open the door) plus
 * the System 6 audio wiring. One call from main.ts:
 *
 *   const interactions = initInteractions({ renderer, scene, camera, player, diner });
 *   ... in the loop, after diner.update(dt):  interactions.update(dt);
 *
 * Input: E (also F, or a click while the pointer is locked). A centre-bottom
 * hint fades in when a target is within reach and inside the look cone.
 * System 9: Q stands up (E again when seated does too — the seated target is
 * "Stand"); the player's Shift / Space are refused mid-interaction via
 * `player.blocked` (sit transitions, a pour, a drink, the door swing).
 * Debug/capture API on `window.__interact` — see debug.ts.
 */
import * as THREE from "three";
import { wireDinerAudio, type DinerAudioWiring } from "../audio/wiring";
import type { FirstPerson } from "../player/FirstPerson";
import type { Diner } from "../scene/Diner";
import { installInteractionDebugApi } from "./debug";
import { DoorInteraction } from "./DoorSwing";
import { DrinkInteraction } from "./Drink";
import { CabinetDoorInteraction, KitchenDoorInteraction } from "./Openables";
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
  /** System 9. */
  readonly drink: DrinkInteraction;
  /** System 9 openables: [left, right] cabinet doors and the kitchen swing door. */
  readonly cabinet: [CabinetDoorInteraction, CabinetDoorInteraction];
  readonly kitchenDoor: KitchenDoorInteraction;
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
  // Latch: System 6 rev 3's `DoorSfx.setOutside(0)` plays the strike/tongue/thud itself
  // (`doorClose()`, calibrated at −23 dBFS @ 0.85 m in the live mix) on the same frame the leaf
  // seats, so `outside(0)` IS the latch cue. `wiring.doorLatch()` (rev 2's own voice) is kept for
  // scripted use but not wired here — both together read as a doubled click.
  const door = new DoorInteraction(diner.door, diner.colliders, player, {
    open: () => audio.sfx.doorOpen(),
    outside: (amount) => audio.sfx.setOutside(amount),
  }, scene);

  // System 9: drink from the pour mug (offered once it holds more than EMPTY_FILL; "Pour" below).
  const drink = new DrinkInteraction(pour, diner.pourMug, player, {
    sip: () => audio.sfx.sip(),
    clink: (at) => audio.sfx.mugClink(toVec(at)),
  }, diner.pourMugShadow);

  // System 9 openables (scene/Openables.ts leaves): both cabinet doors toggle, the kitchen door is pushed.
  const catchSfx = { catch: (at: THREE.Vector3, ph: "release" | "close") => audio.sfx.cabinetCatch(toVec(at), ph) };
  const cabinet: [CabinetDoorInteraction, CabinetDoorInteraction] = [
    new CabinetDoorInteraction(diner.sys9.openables.cabinet[0], "cabinet-left", catchSfx, "cabinet"),
    new CabinetDoorInteraction(diner.sys9.openables.cabinet[1], "cabinet-right", catchSfx, "cabinet"),
  ];
  const kitchenDoor = new KitchenDoorInteraction(diner.sys9.openables.kitchenDoor, {
    push: (at) => audio.sfx.kitchenDoorPush(toVec(at)),
    pass: (at, speed) => audio.sfx.kitchenDoorPass(toVec(at), speed),
    settle: (at) => audio.sfx.kitchenDoorSettle(toVec(at)),
  });

  const prompt = new Prompt("E", new URLSearchParams(location.search).has("shoot"));
  const items: Interactable[] = [
    ...sit.interactables,
    pour.interactable,
    drink.interactable,
    door.interactable,
    cabinet[0].interactable,
    cabinet[1].interactable,
    kitchenDoor.interactable,
  ];

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
    if (e.repeat) return;
    if (e.code === "KeyQ") {
      if (sit.seated) sit.standUp();
      return;
    }
    if (!KEYS.has(e.code)) return;
    interact();
  };

  // Sprint / jump gate (FirstPerson reads it every frame). Sit transitions disable the
  // controller outright; this covers the pour and standing in the door's swing.
  player.blocked = () => pour.state === "pouring" || drink.state === "drinking" || door.inSwing;
  player.onLand = (strength) => audio.sfx.footfall(strength);
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
      drink.update(step);
      door.update(step);
      cabinet[0].update(step);
      cabinet[1].update(step);
      kitchenDoor.update(step);
      // Shadow-once (Diner.ts): both sun shadow maps are rendered once at boot, so anything
      // sunlit that moved this frame (door leaf, decanter, mug, stream) re-renders them.
      // The openables re-render once when a leaf comes to rest, not per frame.
      const openableSettled = cabinet[0].consumeSettled() || cabinet[1].consumeSettled() || kitchenDoor.consumeSettled();
      if (door.consumeMoved() || pour.consumeMoved() || drink.consumeMoved() || openableSettled) diner.invalidateShadows();
      target = pickTarget();
      prompt.set(target ? target.label() : null);
      audio.update(camera);
    },
    startAudio: wiring.startAudio,
    audio,
    sit,
    pour,
    door,
    drink,
    cabinet,
    kitchenDoor,
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
