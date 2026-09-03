/**
 * Capture / debug surface for System 7, installed on `window`:
 *
 *   __interact("pour", t?)          pour; with `t` (seconds from the E press) jump there and FREEZE the animations
 *                                   (5.95 s cycle: reach 0.25, lift, carry, tilt, stream 1.78–4.35, snap, return)
 *   __interact("door", t?)          open the door; with `t` jump into the 7.25 s cycle and freeze
 *                                   (reach 0.22, open → 1.45, hold → 2.85, sweep → 6.45, latch → 7.25)
 *   __interact("sit", t?, {booth, side})   sit (booth 0–4, side −1|1; default: nearest bench); `t` seeks + freezes
 *                                   (1.8 s: anticipation 0.15, step 0.75, lower 1.45, settle 1.8)
 *   __interact("stand")             stand up
 *   __interact("drink", t?)         System 9: drink from the mug (2.8 s; a seek first fills it)
 *   __interact("cabinet", t?)       System 9: toggle the LEFT cabinet door; `t` seeks into the 0.8 s opening
 *   __interact("cabinet-right", t?) the right door likewise
 *   __interact("cabinet-close", t?) close the (open) left door; `t` seeks into the 0.75 s closing
 *   __interact("kitchen-door", t?)  System 9: push the kitchen swing door; `t` seeks into the 2.8 s cycle
 *   __interact("resume")            unfreeze
 *   __interact("reset")             everything back to rest, unfrozen
 *   __interactPose("sit-seated" | "pour-mid" | "pour-full" | "door-open")
 *                                   deterministic frames for tools/shoot.mjs: state + camera
 *   __interactions                  the live Interactions object
 *   __player                        the FirstPerson controller (feel checks from a harness)
 *
 * Seeks are silent (no SFX). `t` is seconds into that interaction's own timeline.
 */
import type { Interactions } from "./index";
import type { FirstPerson } from "../player/FirstPerson";
import { EMPTY_FILL, POUR_STREAM_START } from "./Pour";

export type InteractPoseName = "sit-seated" | "pour-mid" | "pour-full" | "door-open" | "drink-sip" | "cabinet-open" | "kitchen-door-open" | "kitchen-door-back";

interface SitOpts {
  booth?: number;
  side?: -1 | 1;
}

declare global {
  interface Window {
    __interact?: (name: string, t?: number, opts?: SitOpts) => void;
    __interactPose?: (name: InteractPoseName) => void;
    __interactions?: Interactions;
    __player?: FirstPerson;
  }
}

/**
 * Camera for the pour frames: 0.8 m along the back bar on the +x side, looking down the counter
 * at the mug, so the decanter body (which hovers on the +z side of the mug) does not hide the
 * stream; brewer behind.
 */
const POUR_CAMERA = { x: -0.55, y: 1.42, z: -2.15, yaw: 83, pitch: -28 };
/**
 * Inside, on the far (+x) side of the vestibule looking back through the opening: the leaf swings
 * out on the hinge (−x) side, so from here it is seen through the opening at a shallow angle
 * with the lot behind it; from the hinge side it hides edge-on behind the jamb.
 */
const DOOR_CAMERA = { x: 5.5, y: 1.62, z: 1.7, yaw: 156, pitch: -12 };
/** System 9: standing in the service aisle at the mug, looking down at it — the drink is first person. */
export const DRINK_CAMERA = { x: -1.25, y: 1.62, z: -1.5, yaw: 8, pitch: -28 };
/** System 9: in the service aisle, 3/4 view down at the cabinet bay so both leaves' swing reads. */
export const CABINET_CAMERA = { x: -1.35, y: 1.25, z: -0.7, yaw: 22, pitch: -30 };
/** System 9: in the aisle at the -x end looking at the kitchen door; the leaf swings away and back through the frame. */
export const KITCHEN_DOOR_CAMERA = { x: -4.0, y: 1.55, z: -0.9, yaw: 34, pitch: -8 };
export const INTERACT_POSES: Record<InteractPoseName, { camera?: typeof POUR_CAMERA; note: string }> = {
  "sit-seated": { note: "booth 2, +x bench, seated eye 1.15 m turned 35° to the window" },
  "pour-mid": { camera: POUR_CAMERA, note: "1.2 s into the stream (t ≈ 3.0): mug half full, stream + building steam" },
  "pour-full": { camera: POUR_CAMERA, note: "6 s: decanter back on the warmer 9 mm lower, mug full, steam" },
  "door-open": { camera: DOOR_CAMERA, note: "2 s: leaf held at 85° (hold phase 1.45–2.85 s)" },
  "drink-sip": { camera: DRINK_CAMERA, note: "1.35 s into the drink from a full mug: rim at the lips, head tilted back 5°, level falling" },
  "cabinet-open": { camera: CABINET_CAMERA, note: "both cabinet doors open at rest (95°): shelf, saucers, filters, spray bottle" },
  "kitchen-door-open": { camera: KITCHEN_DOOR_CAMERA, note: "0.7 s: leaf pushed to 90° into the kitchen, the lit kitchen slice beyond" },
  "kitchen-door-back": { camera: KITCHEN_DOOR_CAMERA, note: "1.38 s: the spring's back-swing, leaf ~23° into the dining room" },
};

export function installInteractionDebugApi(
  api: Interactions,
  player: FirstPerson,
  clock: { freeze(f: boolean): void; isFrozen(): boolean },
): void {
  const { sit, pour, door, drink, cabinet, kitchenDoor } = api;

  const nearestBench = () => {
    const p = player.position;
    let best = sit.benches[0];
    let bd = Infinity;
    for (const b of sit.benches) {
      const d = (b.focus.x - p.x) ** 2 + (b.focus.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  };

  const interact = (name: string, t?: number, opts: SitOpts = {}): void => {
    switch (name) {
      case "pour":
        if (t === undefined) pour.start();
        else {
          pour.seek(t);
          clock.freeze(true);
        }
        break;
      case "door":
        if (t === undefined) door.open();
        else {
          door.seek(t);
          clock.freeze(true);
        }
        break;
      case "drink":
        // A seek from an empty mug first fills it (pour seeked past its end: full, steaming).
        if (t === undefined) drink.start();
        else {
          drink.reset();
          if (pour.fill < EMPTY_FILL) pour.seek(6.0);
          drink.seek(t);
          clock.freeze(true);
        }
        break;
      case "cabinet":
      case "cabinet-right": {
        const d = cabinet[name === "cabinet" ? 0 : 1];
        if (t === undefined) d.toggle();
        else {
          d.seek(t, "closed");
          clock.freeze(true);
        }
        break;
      }
      case "cabinet-close": {
        if (t === undefined) {
          if (cabinet[0].state === "open") cabinet[0].toggle();
        } else {
          cabinet[0].seek(t, "open");
          clock.freeze(true);
        }
        break;
      }
      case "kitchen-door":
        if (t === undefined) kitchenDoor.push();
        else {
          kitchenDoor.seek(t);
          clock.freeze(true);
        }
        break;
      case "sit": {
        const bench =
          opts.booth !== undefined ? sit.benches.find((b) => b.booth === opts.booth && b.side === (opts.side ?? 1)) ?? nearestBench() : nearestBench();
        if (t === undefined) {
          if (sit.state !== "standing") sit.reset();
          sit.sitDown(bench);
        } else {
          sit.seek(bench, t, sit.aisleStand(bench));
          clock.freeze(true);
        }
        break;
      }
      case "stand":
        sit.standUp();
        break;
      case "resume":
        clock.freeze(false);
        break;
      case "reset":
        sit.reset();
        drink.reset();
        pour.reset();
        door.reset();
        cabinet[0].reset();
        cabinet[1].reset();
        kitchenDoor.reset();
        clock.freeze(false);
        break;
      default:
        console.warn(`[interact] unknown "${name}"`);
    }
  };

  const pose = (name: InteractPoseName): void => {
    interact("reset");
    const cam = INTERACT_POSES[name]?.camera;
    if (cam) player.setPose(cam.x, cam.y, cam.z, cam.yaw, cam.pitch);
    switch (name) {
      case "sit-seated":
        interact("sit", 10, { booth: 2, side: 1 });
        break;
      case "pour-mid":
        interact("pour", POUR_STREAM_START + 1.2);
        break;
      case "pour-full":
        interact("pour", 6.0);
        break;
      case "door-open":
        interact("door", 2.0);
        break;
      case "drink-sip":
        interact("drink", 1.35);
        break;
      case "cabinet-open":
        interact("cabinet", 10);
        interact("cabinet-right", 10);
        break;
      case "kitchen-door-open":
        interact("kitchen-door", 0.7);
        break;
      case "kitchen-door-back":
        interact("kitchen-door", 1.38);
        break;
    }
    // Run one zero-dt tick so the prompt and camera reflect the new state before the next render.
    api.update(0);
  };

  window.__interact = interact;
  window.__interactPose = pose;
  window.__interactions = api;
  window.__player = player;
}
