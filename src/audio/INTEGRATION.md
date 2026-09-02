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
audio.sfx.pourCoffee(3.5, { x, y, z });   // liquid into ceramic, resonance rises as the mug fills
audio.sfx.mugClink({ x, y, z });          // tiny ceramic ping
audio.sfx.doorOpen();                     // push bar, hinge creak, pneumatic closer
audio.sfx.setOutside(angle / maxAngle);   // 0 shut … 1 open: heat wall crossfades in (call per frame)
audio.setMasterVolume(0.8);               // 0..1
```

## Positions

`createDinerAudio(positions?)` defaults every emitter from `scene/layout.ts`
(radio on the back bar at the register end, AC high on the -x end wall at the
supply register, fan hub under the ceiling at `FAN`, coffee pot at
`BACK_BAR.coffeeX`, door at `DOOR.centerX`, outside shimmer at every window
centre and the door). Pass any subset to override, e.g.
`createDinerAudio({ radio: { x: 1.7, y: 1.05, z: -2.25 } })`.

The fan's blade-pass rate is taken from `FAN.rpm` (40 rpm × 4 blades ≈ 2.7 Hz).

## Levels

Calibrated with `node tools/audio-harness.mjs` (offline render, port 5220):
listener mid-aisle hears the mix at ≈ -33 dBFS RMS, peaks ≈ -19 dBFS; range
across the room is -30 (booth beside the AC) to -38 (door corner). One-shots peak
≈ -13 dBFS at arm's length. The limiter never engages in the ambience.

`node tools/audio-harness.mjs --sfx` also fires the one-shots;
`--solo=radio` isolates a layer; `--listener=x,z,yawDeg[,y]` moves the ear;
`--seconds=60` for a long stability check. Output: `shots/audio-mix.wav`
(gitignored, regenerate with the tool).

`audio-harness.html` (dev only, not part of the build) is the live version:
`npx vite --port 5220`, click Start, solo/mute layers, drag the listener around
the plan, watch the meter.

## Cost

~130 native nodes total (oscillators, gains, biquads, one convolver with a
0.78 s procedural IR, 12 HRTF panners — one per emitter, six of them for the
window/door shimmer). No ScriptProcessor, no AudioWorklet,
no per-sample JavaScript at runtime; the noise buffers (7–11 s each, three
colours) and the impulse response are computed once at `start()` in ~20 ms.
