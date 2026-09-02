# Morning Diner — build notes

A first-person walk through a small American roadside diner at 8 AM. Three.js
only, zero external assets: every mesh, texture and (later) sound is generated in
code. The target is a paused frame that reads as a photograph.

## Architecture

```
src/
  main.ts                 renderer, camera, frame-capped loop, resize, ?debug logging
  scene/
    layout.ts             THE floor plan: every dimension and position, in metres
    Diner.ts              composes the room, owns colliders and per-frame animation
    Shell.ts              floor, walls with punched openings, window frames/glass/sills,
                          door frame, kitchen swing door, pass-through, baseboards,
                          roof slab, kitchen void, exterior apron + lot
    Booths.ts             5 booths (pedestal tables, vinyl benches, laminate dividers)
    Counter.ts            counter + L-return, 8 instanced stools, back bar, cabinets
    Ceiling.ts            tile plane, T-bar grid, 8 troffers, ceiling fan (rotor returned)
    Door.ts               front door leaf on its own hinged Group (static until System 7)
    Lighting.ts           PLACEHOLDER lighting; System 4 replaces this file
  player/FirstPerson.ts   pointer-lock look, WASD at 1.4 m/s, eye 1.65 m, AABB sliding collision
  core/
    materials.ts          shared material palette (placeholders; System 5 owns the real set)
    merge.ts              MergedBuilder: per-material geometry merging + collider registry
    rng.ts                deterministic PRNG, tileable value/fBm noise
  procedural/textures.ts  canvas textures: checker floor, painted wall, acoustic tile, asphalt, concrete
  capture/pose.ts         window.__setPose / __SCENE_READY / __stats for the harness
tools/
  shoot.mjs               headless capture harness (build → serve :5210 → shoot poses)
  gpu.mjs                 Chromium GPU flags and software-rasteriser assertion
```

Coordinates: +x runs the length of the room (door end is +x), +z is toward the
parking lot (window wall at z = 3.25), +y up, origin at floor level mid-room.
Interior 11.0 × 5.85 m, 2.9 m ceiling; kitchen void beyond z = -2.6.

Draw calls sit around 70–90 per frame because everything static is merged per
material (`MergedBuilder`) and the stools are `InstancedMesh`. Textures are
≤ 2048 px, pixel ratio capped at 1.5. The loop is capped at ~120 fps and drops
to ~10 fps when the tab is hidden or the window loses focus.

## Pose / capture API

Installed on `window` by `src/capture/pose.ts`:

| Global | Meaning |
|---|---|
| `__SCENE_READY` | `true` after the second rendered frame |
| `__setPose({x, y?, z, yaw, pitch})` | teleport the camera. Metres; angles in **degrees**. `yaw 0` looks toward −z (the kitchen wall), positive turns left (toward −x). `pitch` positive looks up. `y` defaults to eye height 1.65 |
| `__stats()` | `{ calls, triangles, renderer }` from the live WebGL context |
| `__APP` | `{ renderer, scene, camera }` for ad-hoc inspection |

URL flags: `?debug` logs the GPU adapter and draw calls every 5 s; `?nofill`
renders the sun alone (diagnostic).

## Running the capture

```
npm install
npm run build                      # tsc --noEmit && vite build
node tools/shoot.mjs --tag=sys1    # → shots/sys1-{door,aisle,counter,booth,ceiling}.png
```

Options: `--no-build` (reuse `dist/`), `--poses=door,aisle`, `--query=nofill`.
The harness serves `dist/` on `127.0.0.1:5210`, launches full Chromium
(`channel: "chromium"`, new headless) with ANGLE/D3D11 flags so it lands on the
RTX 4060, prints `[gpu] <renderer>` from the live three.js context and exits
non-zero on SwiftShader or on any shader compile/link error. Browser and server
are torn down on every exit path and the process always ends with
`process.exit`. Frames are 1920 × 1080, DPR 1.

Poses are defined at the top of `tools/shoot.mjs`.

## Lessons recorded

- `RoomEnvironment` is bright. At `environmentIntensity 0.25` it out-lit a
  5.0-intensity sun and every frame came out flat; `?nofill` proved the fills
  were not the cause. It now sits at 0.05, reflections only.
- r185 deprecates `PCFSoftShadowMap` (it silently maps to PCF). Use
  `PCFShadowMap` + `shadow.radius`.
- D3D emits `X4122` precision *warnings* in the program info log for the
  RectAreaLight LTC code. They are benign; the harness fails only on errors.

## System status

| # | System | Status |
|---|---|---|
| 1 | Interior geometry and floor plan | **built** |
| 2 | Booth and counter detail | pending |
| 3 | Windows, blinds, exterior view | pending |
| 4 | Lighting | pending (placeholder sun/hemi/troffers in `Lighting.ts`) |
| 5 | Materials and textures | pending (placeholder palette in `materials.ts`) |
| 6 | Sound design | pending |
| 7 | The 3 interactions (sit, pour coffee, open door) | pending — door is already a hinged Group; door leaf has no collider yet |
| 8 | Post-processing and final polish | pending |

Known System 1 simplifications: flat asphalt lot and plain sky colour outside
(System 3), no blinds, coffee warmer is a stainless box, kitchen void holds two
near-black silhouettes only, cabinet doors are flat panels with reveal lines.
