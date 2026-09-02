/**
 * Capture / debug surface for System 7, installed on `window`:
 *
 *   __interact("pour", t?)          pour; with `t` (seconds) jump there and FREEZE the animations
 *   __interact("door", t?)          open the door; with `t` jump into the 7.15 s cycle and freeze
 *   __interact("sit", t?, {booth, side})   sit (booth 0–4, side −1|1; default: nearest bench); `t` seeks + freezes
 *   __interact("stand")             stand up
 *   __interact("resume")            unfreeze
 *   __interact("reset")             everything back to rest, unfrozen
 *   __interactPose("sit-seated" | "pour-mid" | "pour-full" | "door-open")
 *                                   deterministic frames for tools/shoot.mjs: state + camera
 *   __interactions                  the live Interactions object
 *
 * Seeks are silent (no SFX). `t` is seconds into that interaction's own timeline.
 */
import type { Interactions } from "./index";
import type { FirstPerson } from "../player/FirstPerson";
import { POUR_STREAM_START } from "./Pour";

export type InteractPoseName = "sit-seated" | "pour-mid" | "pour-full" | "door-open";

interface SitOpts {
  booth?: number;
  side?: -1 | 1;
}

declare global {
  interface Window {
    __interact?: (name: string, t?: number, opts?: SitOpts) => void;
    __interactPose?: (name: InteractPoseName) => void;
    __interactions?: Interactions;
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
export const INTERACT_POSES: Record<InteractPoseName, { camera?: typeof POUR_CAMERA; note: string }> = {
  "sit-seated": { note: "booth 2, +x bench, seated eye 1.15 m turned 35° to the window" },
  "pour-mid": { camera: POUR_CAMERA, note: "1.2 s into the stream: mug half full, stream + first steam" },
  "pour-full": { camera: POUR_CAMERA, note: "6 s: decanter back on the warmer 9 mm lower, mug full, steam" },
  "door-open": { camera: DOOR_CAMERA, note: "2 s: leaf settled at 85°" },
};

export function installInteractionDebugApi(
  api: Interactions,
  player: FirstPerson,
  clock: { freeze(f: boolean): void; isFrozen(): boolean },
): void {
  const { sit, pour, door } = api;

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
        pour.reset();
        door.reset();
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
    }
    // Run one zero-dt tick so the prompt and camera reflect the new state before the next render.
    api.update(0);
  };

  window.__interact = interact;
  window.__interactPose = pose;
  window.__interactions = api;
}
