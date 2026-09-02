/**
 * Glue between System 6 (src/audio) and the scene. Emitter positions come
 * from the floor plan (brewer/decanter and pour mug from PROPS; radio, AC,
 * fan, door and window openings from `defaultPositions()`).
 *
 *   const wired = wireDinerAudio();
 *   wired.startAudio();                 // from any user gesture (the loader's "Click to enter")
 *   ... per frame: wired.audio.update(camera);
 *   wired.doorLatch();                  // System 7: the leaf seats on the stop (end of the closer cycle)
 *
 * `startAudio` is idempotent. As a fallback the first click / keydown /
 * pointerdown anywhere on the window also starts it, so audio comes up on the
 * first WASD press or the pointer-lock click even without a loader.
 *
 * SFX timing (System 7 rev 2) — every cue sits on its visual:
 *   clink      decanter leaves the warmer plate / lands back on it (Pour.ts)
 *   pour       the moment the stream's leading edge hits the mug (not when it leaves the lip),
 *              for as long as liquid is landing (tail included)
 *   doorOpen   latch release + hinge whoosh as the leaf starts to move (after the 0.22 s reach)
 *   setOutside every frame the leaf moves, from the open progress
 *   doorLatch  the leaf meets the stop at the end of the latch phase (below)
 */
import { createDinerAudio, startAudioOnGesture, type DinerAudio } from "./index";
import { dbToGain } from "./dsp";
import { scheduleCleanup } from "./sfx/Coffee";
import { BACK_BAR, DOOR, PROPS, ROOM } from "../scene/layout";

export interface DinerAudioWiring {
  readonly audio: DinerAudio;
  /** Create/resume the AudioContext. Call from a user gesture; safe to call repeatedly. */
  startAudio(): Promise<void>;
  /** Door leaf seating on the stop + latch bolt: a short thump and a two-part click at the strike. */
  doorLatch(): void;
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

  /**
   * Latch. System 6 has the opening latch inside `doorOpen()` but no close; this is the
   * counterpart: the leaf's 90 lb meeting the stop (a 60 ms thump, 90–300 Hz) and the
   * latch bolt riding over and dropping into the strike (two clicks, 2.5–4 kHz then a duller
   * 1.4 kHz, 35 ms apart). At the strike-side jamb, ≈ −18 dBFS at 1 m, through the door bus.
   */
  const doorLatch = (): void => {
    const engine = audio.engine, door = audio.door;
    if (!engine || !door) return;
    const ctx = engine.ctx;
    const rng = engine.rng;
    const t = engine.now + 0.01;
    engine.logEvent("sfx.latch", t, 0.4);
    const strike = { x: DOOR.hingeX + DOOR.width - DOOR.jamb, y: 1.0, z: ROOM.zFront + ROOM.wallThickness / 2 };
    const out = ctx.createGain();
    out.gain.value = dbToGain(-8);
    const spatial = engine.attach(out, strike, door.bus, { model: "equalpower" });

    // Thump: the leaf lands on the stop.
    const brown = engine.noiseSource("brown", 1, t);
    const thumpBp = ctx.createBiquadFilter();
    thumpBp.type = "bandpass";
    thumpBp.frequency.value = rng.range(150, 210);
    thumpBp.Q.value = 0.8;
    const thump = ctx.createGain();
    thump.gain.setValueAtTime(0, t);
    thump.gain.linearRampToValueAtTime(1.6, t + 0.003);
    thump.gain.setTargetAtTime(0, t + 0.012, 0.025);
    brown.connect(thumpBp);
    thumpBp.connect(thump);
    thump.connect(out);

    // Bolt: bright click as the tongue clears the strike lip, duller one as it drops in.
    const white = engine.noiseSource("white", 1, t);
    const clickBp = ctx.createBiquadFilter();
    clickBp.type = "bandpass";
    clickBp.frequency.value = rng.range(2600, 3800);
    clickBp.Q.value = 1.0;
    const click = ctx.createGain();
    const tc = t + 0.008;
    click.gain.setValueAtTime(0, tc);
    click.gain.linearRampToValueAtTime(0.7, tc + 0.001);
    click.gain.setTargetAtTime(0, tc + 0.002, 0.003);
    white.connect(clickBp);
    clickBp.connect(click);
    click.connect(out);
    const seatBp = ctx.createBiquadFilter();
    seatBp.type = "bandpass";
    seatBp.frequency.value = 1400;
    seatBp.Q.value = 1.4;
    const seat = ctx.createGain();
    const ts = tc + 0.035;
    seat.gain.setValueAtTime(0, ts);
    seat.gain.linearRampToValueAtTime(0.55, ts + 0.0015);
    seat.gain.setTargetAtTime(0, ts + 0.003, 0.005);
    white.connect(seatBp);
    seatBp.connect(seat);
    seat.connect(out);

    // The glass lite shivers for a moment after the thump: a quiet 700 Hz ring.
    const pane = ctx.createBiquadFilter();
    pane.type = "bandpass";
    pane.frequency.value = rng.range(640, 760);
    pane.Q.value = 12;
    const paneGain = ctx.createGain();
    paneGain.gain.setValueAtTime(0, t);
    paneGain.gain.linearRampToValueAtTime(0.25, t + 0.004);
    paneGain.gain.setTargetAtTime(0, t + 0.01, 0.06);
    white.connect(pane);
    pane.connect(paneGain);
    paneGain.connect(out);

    const stopAt = t + 0.5;
    brown.stop(stopAt);
    white.stop(stopAt);
    scheduleCleanup(white, stopAt, spatial, engine);
  };

  return {
    audio,
    startAudio,
    doorLatch,
    dispose: off,
  };
}
