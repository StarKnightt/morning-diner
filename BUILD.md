# Morning Diner — build notes

A first-person walk through a small American roadside diner at 8 AM. Three.js
only, zero external assets: every mesh, texture and (later) sound is generated in
code. The target is a paused frame that reads as a photograph.

## Architecture

```
src/
  main.ts                 renderer, 37° camera, frame-capped loop, resize, ?debug logging
  scene/
    layout.ts             THE floor plan: every dimension and position, in metres
    Diner.ts              composes the room, owns colliders and per-frame animation
    Shell.ts              floor, 250 mm walls with punched openings (reveals show),
                          window frames + transom + glass stops, sill boards/aprons/casings,
                          full-depth door frame with stops + closer bracket + saddle,
                          closed kitchen swing door (far end of the back-bar wall),
                          pass-through liner / shelf / heat lamps + a dim kitchen box behind it,
                          cove base, supply register, roof slab, kitchen void, lot
    Booths.ts             5 booths: slab tables (bullnose + chrome band) on real pedestals,
                          cushions on plinth/kick, 9° wedge backs tapering to a 90 mm roll,
                          dividers + end panels under one mitred 70 × 35 mm T-cap each
    Counter.ts            L-shaped slab top, die + cove-faced toe kick, 36 mm footrail on
                          brackets, 10 instanced stools (torus footring on spokes), register
                          stand on the L-return, back bar with cooler door + drawer unit,
                          300 mm cabinet runs under a wall-finish bulkhead
    Ceiling.ts            tegular tiles (instanced), main/cross tee grid with end clips,
                          wall angle (also along the bulkhead), 6 troffers with a lipped door
                          frame in a shadow gap + recessed lens, ceiling fan
    Door.ts               front door leaf on its own hinged Group (static until System 7)
    Lighting.ts           PLACEHOLDER lighting; System 4 replaces this file
  player/FirstPerson.ts   pointer-lock look, WASD at 1.4 m/s, eye 1.62 m, AABB sliding collision
  core/
    materials.ts          shared material palette (placeholders; System 5 owns the real set)
    merge.ts              MergedBuilder: per-material merging, `box` / `rbox` (bevelled), colliders
    shapes.ts             plan-view polygon offset, rounded corners, extruded slab + edge band,
                          trapezoid prisms — the "no razor edges" toolkit
    rng.ts                deterministic PRNG, tileable value/fBm noise
  procedural/textures.ts  canvas textures: checker floor, painted wall, acoustic tile, asphalt, concrete
  capture/pose.ts         window.__setPose / __SCENE_READY / __stats for the harness
tools/
  shoot.mjs               headless capture harness (build → serve :5210 → shoot poses)
  gpu.mjs                 Chromium GPU flags and software-rasteriser assertion
```

Coordinates: +x runs the length of the room (door end is +x), +z is toward the
parking lot (window wall at z = 3.25), +y up, origin at floor level mid-room.
Interior 11.6 × 5.85 m, 2.9 m ceiling; kitchen partition at z = -2.6 with a
shallow dim kitchen box behind the pass-through and a black void elsewhere.

### Construction rules (from the System 1 critic review)

- Lens: vertical FOV 37° (≈ 61° horizontal at 16:9, a 32 mm equivalent), eye
  height 1.62 m. Never go wider; near edges skew into trapezoids.
- Nothing within reach of the camera uses raw `BoxGeometry`. Use `rbox`
  (2–3 mm bevel, more for nosings) or `slabGeometry` (quarter-round bullnose +
  chrome band). Booth backs are extruded wedges, stool parts are lathes.
- Counter: 1.05 m top, 40 mm thick, 300 mm knee overhang past a 400 mm die,
  100 mm recessed kick faced in cove base, 36 mm footrail 130 mm off the die at
  230 mm on plate-and-arm brackets every 1.2 m. Stools at 600 mm centres, seat
  front 75 mm from the nosing; footring is a Ø 0.42 torus at 290 mm on a collar
  with four spokes; base Ø 0.43. Back counter 0.9 m with a 450 mm gap to the
  300 mm-deep cabinets, whose tops meet a wall-finish bulkhead (no dark reveal).
- Booths: 1.8 m pitch, 450 mm × 140 mm cushions (top 0.45), 100 mm kick,
  wedge back reclined 9° tapering to a 90 mm roll, one mitred 70 × 35 mm cap per
  divider (T in plan over divider + both end panels) at 1.045–1.08 m. Table
  750 mm high, 38 mm thick, 25 mm band, 30 mm corner radii, pedestal on a
  400 × 600 foot; wall edge 24 mm off the apron. Last partition is 1.0 m from
  the door jamb (vestibule zone).
- Windows: 40 mm frame in the middle of a 250 mm wall, 15 mm glass stops both
  faces, transom at 2.2 m, 22 mm sill board with a rounded nose over a distinct
  apron at 0.85 m, 280 mm header band.
- Front door: jambs fill the wall depth, leaf sits inside with a 4 mm reveal
  against an exterior stop, closer + pivots, push bar at 1.02 m, 12 mm saddle.
- Nothing renders as a 0-albedo plane: kitchen lite is dark glass, equipment
  bays have stainless fronts, the pass-through looks into a dim grey kitchen box.
- Ceiling grid: 24 mm main tees every 1.2 m along x, 15 mm cross tees, wall
  angle, 6 mm tegular drop. Troffers own whole cells; tees are skipped inside.
- Draw calls sit around 85–125 per frame: everything static is merged per
  material (`MergedBuilder`); stools (9 parts) and 184 tiles are `InstancedMesh`.
  Textures ≤ 2048 px, pixel ratio capped at 1.5. The loop is capped at ~120 fps
  and drops to ~10 fps when the tab is hidden or the window loses focus.

## Pose / capture API

Installed on `window` by `src/capture/pose.ts`:

| Global | Meaning |
|---|---|
| `__SCENE_READY` | `true` after the second rendered frame |
| `__setPose({x, y?, z, yaw, pitch})` | teleport the camera. Metres; angles in **degrees**. `yaw 0` looks toward −z (the kitchen wall), positive turns left (toward −x). `pitch` positive looks up. `y` defaults to eye height 1.62 |
| `__stats()` | `{ calls, triangles, renderer }` from the live WebGL context |
| `__APP` | `{ renderer, scene, camera }` for ad-hoc inspection |

URL flags: `?debug` logs the GPU adapter and draw calls every 5 s; `?nofill`
renders the sun alone (diagnostic).

## Running the capture

```
npm install
npm run build                      # tsc --noEmit && vite build
node tools/shoot.mjs --tag=sys1    # → shots/sys1-{door,length,aisle,counter,booth,undertable,ceiling}.png
```

Options: `--no-build` (reuse `dist/`), `--poses=door,aisle`, `--query=nofill`.
The harness serves `dist/` on `127.0.0.1:5210`, launches full Chromium
(`channel: "chromium"`, new headless) with ANGLE/D3D11 flags so it lands on the
RTX 4060, prints `[gpu] <renderer>` from the live three.js context and exits
non-zero on SwiftShader or on any shader compile/link error. Browser and server
are torn down on every exit path and the process always ends with
`process.exit`. Frames are 1920 × 1080, DPR 1.

Poses are defined at the top of `tools/shoot.mjs`. Every pose keeps the camera
≥ 0.5 m from any surface. `door` stands inside looking at the entrance;
`length` stands just inside the door looking down the room (kitchen door at the
far end of the back wall); `counter` stands at the L-return looking along the
footrail toward the kitchen door; `undertable` is a 1.0 m-high view under a
booth table for the pedestal and foot plate.

## Lessons recorded

- `RoomEnvironment` is bright. At `environmentIntensity 0.25` it out-lit a
  5.0-intensity sun and every frame came out flat; `?nofill` proved the fills
  were not the cause. It now sits at 0.05, reflections only.
- With almost no environment, `metalness 1` materials render black. The
  placeholder metals sit at metalness 0.6–0.8 so they read under direct light;
  System 5 restores proper metals together with a real environment.
- r185 deprecates `PCFSoftShadowMap` (it silently maps to PCF). Use
  `PCFShadowMap` + `shadow.radius`.
- D3D emits `X4122` precision *warnings* in the program info log for the
  RectAreaLight LTC code. They are benign; the harness fails only on errors.
- `mergeGeometries` needs a consistent index state; `ExtrudeGeometry` is
  non-indexed, so `MergedBuilder.build` converts the bucket when mixed.
- Two coplanar faces from butting boxes z-fight; make adjoining panels butt
  edge-to-edge (booth end panels stop at the divider face) rather than overlap.

## System status

| # | System | Status |
|---|---|---|
| 1 | Interior geometry and floor plan | **built, rev 3** (service zone, stools, booth caps, door per critic review) |
| 2 | Booth and counter detail | pending |
| 3 | Windows, blinds, exterior view | pending |
| 4 | Lighting | pending (placeholder sun/hemi/troffers in `Lighting.ts`) |
| 5 | Materials and textures | pending (placeholder palette in `materials.ts`) |
| 6 | Sound design | pending |
| 7 | The 3 interactions (sit, pour coffee, open door) | pending — door is already a hinged Group; door leaf has no collider yet |
| 8 | Post-processing and final polish | pending |

Known System 1 simplifications: flat asphalt lot and plain sky colour outside
(System 3), no blinds, coffee warmer is a stainless box, register stand is a
lidded formica block with a dark display, kitchen box holds dim grey
silhouettes only, no second (restroom) door on the far end wall.
