/**
 * Capture / debug surface for System 7, installed on `window`:
 *
 *   __interact("pour", t?)          pour; with `t` (seconds from the E press) jump there and FREEZE the animations
 *                                   (5.95 s cycle: reach 0.25, lift, carry, tilt, stream 1.78–4.35, snap, return)
 *   __interact("door", t?)          open the door; with `t` jump into the 7.25 s cycle and freeze
 *                                   (reach 0.22, open → 1.45, hold → 2.85, sweep → 6.45, latch → 7.25)
 *   __interact("sit", t?, {booth, side})   sit (booth 0–4, side −1|1; default: nearest bench); `t` seeks + freezes
 *                                   (1.8 s: anticipation 0.15, step 0.75, lower 1.45, settle 1.8)
 *   __interact("sit-stool", index?, t?)  sit on counter stool `index` (0–8; default: nearest); `t` seeks + freezes
 *                                   (1.0 s: anticipation 0.08, step 0.42, lower 0.81, settle 1.0). Also
 *                                   __interact("sit-stool", t, {stool}) in the other interactions' shape
 *   __interact("look", yawDeg, {pitch?})  seated only: turn the look off the seat heading (+ = left), stool swivel snapped
 *   __interact("stand")             stand up
 *   __interact("drink", t?)         System 9: drink from the mug (2.8 s; a seek first fills it)
 *   __interact("cabinet", t?)       System 9: toggle the LEFT cabinet door; `t` seeks into the 0.8 s opening
 *   __interact("cabinet-right", t?) the right door likewise
 *   __interact("cabinet-close", t?) close the (open) left door; `t` seeks into the 0.75 s closing
 *   __interact("kitchen-door", t?)  System 9: toggle the kitchen swing door (opens and HOLDS at 90°, a second
 *                                   press releases it); `t` seeks into the 1.5 s opening
 *   __interact("kitchen-door-close", t?)  release the (open) kitchen door; `t` seeks into the 2.25 s spring return
 *   __interact("blinds-raise", wi?, t?)   feat-blinds-f: raise window `wi`'s blind (default 1); `t` seeks into the 2.5 s raise
 *   __interact("blinds-lower", wi?, t?)   lower it (from up); `t` seeks into the 2.0 s lowering
 *   __interact("resume")            unfreeze
 *   __interact("reset")             everything back to rest, unfrozen
 *   __interactPose("sit-seated" | "pour-mid" | "pour-full" | "door-open")
 *                                   deterministic frames for tools/shoot.mjs: state + camera
 *   __interactions                  the live Interactions object
 *   __player                        the FirstPerson controller (feel checks from a harness)
 *
 * Seeks are silent (no SFX). `t` is seconds into that interaction's own timeline.
 */
import * as THREE from "three";
import type { Interactions } from "./index";
import type { FirstPerson } from "../player/FirstPerson";
import { EMPTY_FILL, POUR_STREAM_START } from "./Pour";

export type InteractPoseName =
  | "sit-seated"
  | "stool-approach"
  | "stool-seated"
  | "stool-seated-look-left"
  | "pour-mid"
  | "pour-full"
  | "door-open"
  | "drink-sip"
  | "cabinet-open"
  | "kitchen-door-open"
  | "kitchen-door-back"
  | "blinds-down"
  | "blinds-mid"
  | "blinds-up"
  | "blinds-up-exterior";

interface SitOpts {
  booth?: number;
  side?: -1 | 1;
  /** Counter stool index 0–8 (`sit-stool`). */
  stool?: number;
  /** `look`: pitch in degrees. */
  pitch?: number;
}

declare global {
  interface Window {
    __interact?: (name: string, t?: number, opts?: SitOpts | number) => void;
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
/** Counter stool the `stool-*` poses use: stool 5 (x = −2.0), the coffee warmer behind it across the service aisle. */
export const STOOL_POSE_INDEX = 5;
export const KITCHEN_DOOR_CAMERA = { x: -4.0, y: 1.55, z: -0.9, yaw: 34, pitch: -8 };
/** feat-blinds-f: standing at the second booth (window 1, x −2.9) looking at the blind AND the table / bench the stripes land on. */
export const BLINDS_CAMERA = { x: -2.35, y: 1.5, z: 1.35, yaw: 166, pitch: -14 };
/** feat-blinds-f: on the lot in front of window 1, looking back in through the raised blind. */
export const BLINDS_EXTERIOR_CAMERA = { x: -2.2, y: 1.6, z: 5.6, yaw: 14, pitch: 2 };
/** Which window the blind poses use. */
export const BLINDS_POSE_WINDOW = 1;
export const INTERACT_POSES: Record<InteractPoseName, { camera?: typeof POUR_CAMERA; note: string }> = {
  "sit-seated": { note: "booth 2, +x bench, seated eye 1.15 m turned 35° to the window" },
  "stool-approach": { note: "standing 0.75 m behind stool 5 with the E — Sit prompt up (0.35 m off to +x, looking down at the seat)" },
  "stool-seated": { note: "seated on stool 5: eye 1.45 m (seat 0.73 + 0.72) facing the counter, −12° pitch" },
  "stool-seated-look-left": { note: "seated on stool 5, look turned 60° left (toward the kitchen-door end); the seat top has swivelled with it" },
  "pour-mid": { camera: POUR_CAMERA, note: "1.2 s into the stream (t ≈ 3.0): mug half full, stream + building steam" },
  "pour-full": { camera: POUR_CAMERA, note: "6 s: decanter back on the warmer 9 mm lower, mug full, steam" },
  "door-open": { camera: DOOR_CAMERA, note: "2 s: leaf held at 85° (hold phase 1.45–2.85 s)" },
  "drink-sip": { camera: DRINK_CAMERA, note: "1.35 s into the drink from a full mug: rim at the lips, head tilted back 5°, level falling" },
  "cabinet-open": { camera: CABINET_CAMERA, note: "both cabinet doors open at rest (95°): shelf, saucers, filters, spray bottle" },
  "kitchen-door-open": { camera: KITCHEN_DOOR_CAMERA, note: "open at rest: leaf held at 90° into the kitchen, the lit kitchen slice beyond" },
  "kitchen-door-back": { camera: KITCHEN_DOOR_CAMERA, note: "0.83 s into the release: the spring's back-swing, leaf ~23° into the dining room" },
  "blinds-down": { camera: BLINDS_CAMERA, note: "window 1 blind hanging as built: full stripe pattern on the table and bench" },
  "blinds-mid": { camera: BLINDS_CAMERA, note: "1.25 s into the raise: stack half way up, stripes only in the upper half, full sun below" },
  "blinds-up": { camera: BLINDS_CAMERA, note: "raised at rest: stack under the headrail, clear glass, one full sun patch" },
  "blinds-up-exterior": { camera: BLINDS_EXTERIOR_CAMERA, note: "from the lot: the raised blind's headrail stack, clear glass, the interior visible" },
};

export function installInteractionDebugApi(
  api: Interactions,
  player: FirstPerson,
  clock: { freeze(f: boolean): void; isFrozen(): boolean },
): void {
  const { sit, pour, door, drink, cabinet, kitchenDoor, blinds } = api;

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

  const nearestStool = () => {
    const p = player.position;
    let best = sit.stools[0];
    let bd = Infinity;
    for (const s of sit.stools) {
      const d = (s.focus.x - p.x) ** 2 + (s.focus.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  };

  const interact = (name: string, t?: number, optsIn: SitOpts | number = {}): void => {
    const opts: SitOpts = typeof optsIn === "number" ? {} : optsIn;
    switch (name) {
      // feat-blinds-f: ("blinds-raise", windowIndex?, t?) — the window index rides in `t`'s slot.
      case "blinds-raise":
      case "blinds-lower": {
        const wi = Math.max(0, Math.min(blinds.length - 1, Math.round(t ?? BLINDS_POSE_WINDOW)));
        const seek = typeof optsIn === "number" ? optsIn : undefined;
        const b = blinds[wi];
        const from = name === "blinds-raise" ? "down" : "up";
        if (seek === undefined) {
          if (b.state === from) b.toggle();
        } else {
          b.seek(seek, from);
          clock.freeze(true);
        }
        break;
      }
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
        if (t === undefined) kitchenDoor.toggle();
        else {
          kitchenDoor.seek(t);
          clock.freeze(true);
        }
        break;
      case "kitchen-door-close":
        if (t === undefined) {
          if (kitchenDoor.state === "open") kitchenDoor.toggle();
        } else {
          kitchenDoor.seek(t, "open");
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
      case "sit-stool": {
        // Two shapes: ("sit-stool", index, t) and ("sit-stool", t, {stool}).
        const positional = typeof optsIn === "number";
        const index = positional ? t : opts.stool;
        const seek = positional ? optsIn : opts.stool !== undefined ? t : undefined;
        const stool = index !== undefined ? sit.stools[Math.max(0, Math.min(sit.stools.length - 1, Math.round(index)))] : nearestStool();
        if (seek === undefined) {
          if (sit.state !== "standing") sit.reset();
          sit.sitDown(stool);
        } else {
          sit.seek(stool, seek, sit.aisleStand(stool));
          clock.freeze(true);
        }
        break;
      }
      case "look":
        sit.look(t ?? 0, opts.pitch);
        break;
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
        for (const b of blinds) b.reset();
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
      case "stool-approach": {
        // Standing where a seek would start from, prompt up, nothing running.
        const s = sit.aisleStand(sit.stools[STOOL_POSE_INDEX]);
        player.setPose(s.x, s.y, s.z, THREE.MathUtils.radToDeg(s.yaw), THREE.MathUtils.radToDeg(s.pitch));
        break;
      }
      case "stool-seated":
        interact("sit-stool", 10, { stool: STOOL_POSE_INDEX });
        break;
      case "stool-seated-look-left":
        interact("sit-stool", 10, { stool: STOOL_POSE_INDEX });
        interact("look", 60, { pitch: -6 });
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
        interact("kitchen-door", 10);
        break;
      case "kitchen-door-back":
        interact("kitchen-door-close", 0.83);
        break;
      case "blinds-down":
        break;
      case "blinds-mid":
        interact("blinds-raise", BLINDS_POSE_WINDOW, 1.25);
        break;
      case "blinds-up":
      case "blinds-up-exterior":
        interact("blinds-raise", BLINDS_POSE_WINDOW, 10);
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
