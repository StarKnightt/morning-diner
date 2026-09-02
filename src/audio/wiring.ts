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
 */
import { createDinerAudio, startAudioOnGesture, type DinerAudio } from "./index";
import { BACK_BAR, PROPS } from "../scene/layout";

export interface DinerAudioWiring {
  readonly audio: DinerAudio;
  /** Create/resume the AudioContext. Call from a user gesture; safe to call repeatedly. */
  startAudio(): Promise<void>;
  /** Remove the window gesture listeners (they remove themselves after the first fire anyway). */
  dispose(): void;
}

export function wireDinerAudio(): DinerAudioWiring {
  const yBar = BACK_BAR.height;
  const audio = createDinerAudio({
    // The warmer is the brewer's lower plate under the decanter, not the layout's nominal coffeeX.
    coffeeWarmer: { x: PROPS.brewer.x, y: yBar + 0.09, z: PROPS.brewer.zBack + 0.21 },
    mug: { x: PROPS.pourMug.x, y: yBar + 0.08, z: PROPS.pourMug.z },
  });
  const off = startAudioOnGesture(audio, window);
  const startAudio = (): Promise<void> => audio.start();
  return {
    audio,
    startAudio,
    dispose: off,
  };
}
