# System 6 — wiring the sound into the scene

Everything is synthesised at runtime; there are no assets to load and no UI.
The ambience is not interactive. Browsers refuse to run an `AudioContext`
without a user gesture, so `start()` must be called from one — pointer lock is
the natural place.

## `src/main.ts` (4 lines)

```ts
import { createDinerAudio } from "./audio";

const audio = createDinerAudio();                       // nothing is created yet, no context
renderer.domElement.addEventListener("click", () => void audio.start(), { once: true });
// inside the animation loop, after player.update(dt):
audio.update(camera);                                   // moves the listener, advances schedulers
```

`start()` is idempotent and returns a promise; calling it again is harmless.
`update()` is a no-op until the context exists.

If pointer lock lives in `FirstPerson`, the `click` listener above already fires
on the same gesture (the controller requests lock on `click` too). Alternatively
`startAudioOnGesture(audio)` installs one-shot `click`/`keydown`/`pointerdown`
listeners on `window` and removes them after the first fire.

## System 7 hooks (`audio.sfx`)

```ts
audio.sfx.pourCoffee(3.5, { x, y, z });   // call when the stream leaves the spout: the splash starts 170 ms later,
                                          // when the coffee lands; 1–5 kHz, mug resonance 800 Hz → 1.8 kHz as it fills
audio.sfx.mugClink({ x, y, z });          // ceramic ping over a 10 ms contact thock, peaks ≈ -12 dBFS at 1.2 m
audio.sfx.doorOpen();                     // latch click, hinge/pressure whoosh, pneumatic closer
audio.sfx.setOutside(angle / maxAngle);   // 0 shut … 1 open, per frame: heat wall in (sin), room down to −3 dB, HOLDS;
                                          // follows the leaf through a 0.22 s swell opening / 0.07 s cut closing
audio.sfx.setOutside(1, 0.7);             // or: one call, linear rise in 0.7 s, holds until setOutside(0)
audio.sfx.doorClose();                    // the latch; setOutside(0) after an opening fires it by itself
audio.setMasterVolume(0.8);               // 0..1
```

One-shots are panned equal-power (not HRTF) so a mug at arm's length stays in
phase between the ears; the fixed emitters use HRTF.

## Positions

`createDinerAudio(positions?)` defaults every emitter from `scene/layout.ts`
(radio on the back bar at the register end, AC high on the -x end wall at the
supply register, fan hub under the ceiling at `FAN`, coffee pot at
`BACK_BAR.coffeeX`, door at `DOOR.centerX`, outside shimmer at every window
centre and the door). Pass any subset to override, e.g.
`createDinerAudio({ radio: { x: 1.7, y: 1.05, z: -2.25 } })`.

The fan's blade-pass rate is taken from `FAN.rpm` (40 rpm × 4 blades ≈ 2.7 Hz).

## Levels (rev 3 — the live mix)

Calibrated with `node tools/audio-harness.mjs --poses` / `--calib` /
`--scenario=pour|door` (offline render of the wired graph, listener at the
player's poses, BS.1770-4 integrated loudness per bus; Vite on :5320, `--port=`).
The full table is in BUILD.md, System 6. In short: the bed is −36.2 LUFS at the
aisle centre, −37.0 seated in a booth, −36.3 at the counter, −40.0 inside the
door, −34.7 under the AC and −33.5 at the radio; room tone −44.5; AC / fan /
radio −35 / −39 / −33 LUFS at 1 m falling 10–14 dB across the room on the
inverse model (ref 1 m, rolloff 0.55); the warmer is near-field (ref 0.7 m,
rolloff 1.4: ticks peak −34 dBFS at the brewer, 20 dB under the bed by the
aisle). A pour is −30 LUFS at the counter, clinks peak −12 dBFS; the heat wall
holds −26 LUFS at the threshold (mix −26 vs −40 with the door shut) while the
room ducks 3 dB, and everything is back within 0.3 dB after the latch. The
limiter never engages in the ambience (mix crest 13.5–17 dB); the −4 dB master
trim cancels the compressor's make-up gain.

`node tools/audio-harness.mjs --sfx` also fires the one-shots;
`--solo=radio` isolates a layer; `--listener=x,z,yawDeg[,y]` moves the ear;
`--seconds=60` for a long stability check. Output: `shots/audio-mix.wav`
(gitignored, regenerate with the tool). The report includes band energies,
envelope-modulation shares (fan blade-pass vs speech syllables), L/R correlation
per event, tonal-line detection, the coherent AM index at the fan's blade-pass
rate, a transient list (band envelope in the louder ear > 6 dB over its 1 s
rolling median: gurgle 80–600 Hz, thock 250 Hz–2 kHz, hiss 3–8 kHz, tick 4–8 kHz)
and the timestamped event list;
`--analyze=file.wav` runs the analysis alone on an existing file.

`audio-harness.html` (dev only, not part of the build) is the live version:
`npx vite --port 5320`, click Start, solo/mute layers, drag the listener around
the plan, watch the meter.

## Cost

~200 native nodes total (oscillators, gains, biquads, one convolver with a
0.78 s procedural IR, 12 HRTF panners — one per emitter, six of them for the
window/door shimmer, two for the door jambs). No ScriptProcessor, no AudioWorklet,
no per-sample JavaScript at runtime; the noise buffers (7–11 s each, three
colours) and the impulse response are computed once at `start()` in ~20 ms.
