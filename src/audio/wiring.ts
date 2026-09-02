/**
 * Glue between System 6 (src/audio) and the scene. Emitter positions come
 * from the floor plan (brewer/decanter and pour mug from PROPS; radio, AC,
 * fan, door and window openings from `defaultPositions()`).
 *
 *   const wired = wireDinerAudio();
 *   wired.startAudio();                 // from any user gesture (the loader's "Click to enter")
 *   ... per frame: wired.audio.update(camera);
 *
 * `startAudio` is idempotent. As a fallback the first click / keydown /
 * pointerdown anywhere on the window also starts it, so audio comes up on the
 * first WASD press or the pointer-lock click even without a loader.
 *
 * `wiredPositions()` is the single source of the scene's emitter overrides:
 * the offline harness (src/audio/harness/page.ts) builds its graph from the
 * same object, so tools/audio-harness.mjs measures the mix the player hears.
 */
import { createDinerAudio, startAudioOnGesture, type DinerAudio, type DinerAudioPositions } from "./index";
import { BACK_BAR, PROPS } from "../scene/layout";

export interface DinerAudioWiring {
  readonly audio: DinerAudio;
  /** Create/resume the AudioContext. Call from a user gesture; safe to call repeatedly. */
  startAudio(): Promise<void>;
  /** Remove the window gesture listeners (they remove themselves after the first fire anyway). */
  dispose(): void;
}

/** Height of the back bar (where the brewer, decanter and pour mug stand). */
const yBar = BACK_BAR.height;

/**
 * Scene-specific emitter positions layered over `defaultPositions()`.
 * The warmer is the brewer's lower plate under the decanter (Props.ts: `zBack + 0.21`,
 * plate top at `yBar + 0.058`), not the layout's nominal `coffeeX`; the mug is the
 * named `pourMug`, whose rim (System 7's `mugTop`) is 89 mm over the bar.
 */
export function wiredPositions(): DinerAudioPositions {
  return {
    coffeeWarmer: { x: PROPS.brewer.x, y: yBar + 0.09, z: PROPS.brewer.zBack + 0.21 },
    mug: { x: PROPS.pourMug.x, y: yBar + 0.08, z: PROPS.pourMug.z },
  };
}

/** Where System 7 fires the one-shots: decanter rest (Pour.ts `potRest`) and the mug rim (`mugTop`). */
export const POUR_POINTS = {
  potRest: { x: PROPS.brewer.x, y: yBar + 0.058, z: PROPS.brewer.zBack + 0.21 },
  mugTop: { x: PROPS.pourMug.x, y: yBar + 0.089, z: PROPS.pourMug.z },
} as const;

export function wireDinerAudio(): DinerAudioWiring {
  const audio = createDinerAudio(wiredPositions());
  const off = startAudioOnGesture(audio, window);
  const startAudio = (): Promise<void> => audio.start();
  return {
    audio,
    startAudio,
    dispose: off,
  };
}
