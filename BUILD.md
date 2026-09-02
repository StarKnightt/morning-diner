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
                          cove base, supply register, roof slab, kitchen void
    Booths.ts             5 booths: boomerang-formica slab tables (bullnose + chrome band)
                          on cast bell pedestals, pillowed + welted vinyl cushions on
                          plinth/kick, 9° channel-tufted backs tapering to a 90 mm roll,
                          dividers + end panels under one mitred 60 × 40 mm T-cap each
    Counter.ts            L-shaped grey-speckle slab top, die + cove base + toe recess, 36 mm
                          footrail on cast brackets, 9 instanced stools at 610 mm (domed vinyl seat,
                          torus footring on spokes, each swivelled differently), back bar
                          with cooler door + drawer unit, 300 mm cabinet runs under a bulkhead
    Props.ts              System 2 props: table sets (117×98×184 dispenser with napkin stack,
                          sugar pourer, S&P) on every table and every second stool, mugs
                          (InstancedMesh + the named `pourMug`, bisque foot rings), saucers, drip
                          tray, BUNN VPR-class brewer with the named `coffeePot`, trays, clock
    Ceiling.ts            tegular tiles (instanced), main/cross tee grid with end clips,
                          wall angle (also along the bulkhead), 6 troffers with a lipped door
                          frame in a shadow gap + recessed lens, ceiling fan
    Door.ts               front door leaf on its own hinged Group (swung by System 7 — `src/interactions/DoorSwing.ts`);
                          `glassDoor` pane + 1 mm-proud handprint haze decal at push-bar height
    Blinds.ts             System 3: 1" venetian blinds on the five windows — instanced curved
                          slats (25 × 0.2 mm, 22 mm pitch, 45° half-open, ±0.5° tilt / ±0.3 mm
                          sag / occasional kinked slat, ±4 % per-slat tone), head + bottom rails,
                          two ladders per window (cords + rungs), lift cords, tilt wand
    Exterior.ts           System 3: kerb + sidewalk, cracked/striped asphalt lot with kerb stops,
                          CMU block wall, two light standards, a dusty white pickup and a maroon
                          sedan (extruded profiles, wheels, chrome, dark glass, contact-shadow
                          decals), desert dirt with instanced scrub, fBm mesa/ridge ring, shader
                          sky dome (horizon → zenith gradient + sun glare on the REFERENCE bearing)
    Lighting.ts           PLACEHOLDER lighting; System 4 replaces this file. Exports `sunDirection()`
                          (az 38° / el 35° from REFERENCE) so the sky glare and the shadows agree
  player/FirstPerson.ts   pointer-lock look, WASD at 1.4 m/s, eye 1.62 m, AABB sliding collision
  core/
    materials.ts          shared material palette: vinyl (plain + crazed), boomerang / speckle
                          Formica, solid cap wood vs two woodgrain laminates, chrome (r 0.08),
                          anisotropic brushed stainless, ceramic, glass, coffee; System 5 refines
    merge.ts              MergedBuilder: per-material merging, `box` / `rbox` (bevelled), colliders
    shapes.ts             plan-view polygon offset, rounded corners, extruded slab + edge band,
                          trapezoid prisms — the "no razor edges" toolkit
    upholstery.ts         pillowed cushions (analytic normals, edge-wear vertex colours),
                          welt piping along seams, channel-tufted back panels
    rng.ts                deterministic PRNG, tileable value/fBm noise
  procedural/
    textures.ts           canvas textures: checker floor, painted wall, acoustic tile, asphalt,
                          concrete, vinyl micro-grain + crazing (normal/roughness only), boomerang
                          and speckle laminate, wood grain (map/rough/normal), glaze speckle,
                          brushed-metal roughness, prismatic lens normal
    exterior.ts           System 3 canvases: lot surface (drift, tyre-polish, sealcoat patches,
                          alligator + long cracks, oil drips, faded/re-striped stalls) + aggregate
                          normal/roughness, glass dust/wipe/handprint roughness + handprint alpha,
                          slat dust, desert dirt, CMU wall
    environment.ts        procedural emissive room used ONLY during the startup CubeCamera pass;
                          Diner.ts then PMREMs a 256 px capture of the real interior from counter
                          height and that becomes `scene.environment`
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
- Draw calls sit around 100–240 per frame (the transmission pass for glass
  props roughly doubles the count where they are visible): everything static is
  merged per material (`MergedBuilder`); stools (11 parts), mugs and 184 tiles are
  `InstancedMesh`.
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
node tools/shoot.mjs --tag=sys3    # → shots/sys3-{door,length,aisle,counter,booth,undertable,ceiling,table,warmer,macro-table,macro-warmer,window,door-glass,blind-macro,lot-wide,stripes}.png
node tools/crop.mjs shots/sys2-booth.png 750,470 shots/crops/valley.png   # 400 px crop (×2) centred on x,y for close inspection
```

`shots/crops/crop-<feature>.png` are the proof crops for the current system,
cut from the committed frames and committed alongside them (from rev 4 on).
Always look at the crops before reporting a feature as done: a 4 mm welt cord
or a 2 mm groove is 2–3 px at 1080p and only reads in a crop — and then ask
whether the crop *reads* as the thing, not just whether the mesh is present.

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
footrail toward the kitchen door; `undertable` is a 0.62 m-high view between
two booth end panels so the pedestal column, spider plate and bell base are
all in frame; `table` is a seated (1.15 m) view across a booth table at the
dispenser, caddy and shakers; `warmer` stands in the service aisle looking at
the brewer, decanter and mug ledge; `macro-table` is 0.6 m from the third
booth's caddy set; `macro-warmer` is 0.7 m from the decanter and pour mug.
System 3 poses: `window` is a seated (1.15 m) eye-line looking out through the
blinds of booth 3; `door-glass` stands at the door looking out through the
pane at the sedan; `blind-macro` is 0.3 m from the slats; `lot-wide` looks
through the big front window at lot + pickup + horizon; `stripes` looks down
at a booth seat and table under the slat shadows.

## Lessons recorded

- `RoomEnvironment` is bright. At `environmentIntensity 0.25` it out-lit a
  5.0-intensity sun and every frame came out flat; `?nofill` proved the fills
  were not the cause. System 2 replaced it with a procedural room map, and rev 2
  with a one-time CubeCamera capture of the actual interior (256 px, HalfFloat,
  PMREM'd) taken from counter height — the checker floor and red seats now bend
  into the chrome. Metals take it fully (`envMapIntensity 1`); dielectrics 0.1
  (0.3 for glossy laminates/vinyl) so the sun/fill balance holds. Render targets
  skip tone mapping, so the capture is linear HDR as it should be.
- Canvas textures are sRGB bytes. Never feed `new THREE.Color(hex).r` into a
  canvas — the constructor converts to linear and the wood came out near-black.
  Parse the hex yourself (see `woodGrain`).
- `new THREE.Color(r, g, b)` with floats is LINEAR in r152+. Author sRGB
  swatches with `setRGB(r, g, b, THREE.SRGBColorSpace)`; the first vinyl pass
  came out salmon pink for exactly this reason.
- Vertex colours: a material with `vertexColors: true` needs a `color`
  attribute on EVERY geometry in its merge bucket (`plainColor` in upholstery.ts).
- Transmission (`MeshPhysicalMaterial.transmission`) adds a render pass; keep
  it to the few glass props and never on the window glass.
- r185 deprecates `PCFSoftShadowMap` (it silently maps to PCF). Use
  `PCFShadowMap` + `shadow.radius`.
- D3D emits `X4122` precision *warnings* in the program info log for the
  RectAreaLight LTC code. They are benign; the harness fails only on errors.
- `mergeGeometries` needs a consistent index state; `ExtrudeGeometry` is
  non-indexed, so `MergedBuilder.build` converts the bucket when mixed.
- Two coplanar faces from butting boxes z-fight; make adjoining panels butt
  edge-to-edge (booth end panels stop at the divider face) rather than overlap.
- Transmissive objects do not see each other: three renders them in a separate
  pass after the opaque transmission buffer, so a transmissive liquid inside a
  transmissive decanter is invisible. Liquids inside glass must be opaque
  (`coffee` is an opaque clearcoated dark brown) — and need a light backdrop
  behind the glass or dark coffee reads as empty glass.
- `makeValueNoise(seed, period)` needs an INTEGER period; a fractional period
  produced NaN → every woodGrain map and roughness map became black → every
  wood surface rendered as a perfect chrome mirror. `rng.ts` now throws on it.
  Probe materials in the live page (`__APP.scene.traverse`, read the
  roughnessMap canvas) when a surface looks wrong rather than guessing.
- Glossy dielectrics at grazing angles mirror the room (Fresnel). Laminates use
  `envMapIntensity 0.3` and roughness ≥ 0.55 or the counter die turns into a
  mirror in `length`.
- A rotationally symmetric stool can't show its swivel; each seat has a single
  vertical boxing seam on the rim so the random rotation reads.
- Small chrome parts near red vinyl read as copper because they mirror the red
  band. The probe capture mutes the vinyl to #6a1c20 and small fittings use a
  cool-tinted `chromeSoft`/`chromeBrushed`.
- **Rev 3 "coffee is water / mug is frosted glass" root cause (checked first, per
  the coordinator).** Not a capture mismatch: `shoot.mjs` runs `vite build()`
  every time (the ~190 ms figure is real — rolldown), the committed bundle
  contained the rev 3 source strings, the coffee mesh was present with
  `transmission 0`, and painting it orange in the built page proved it renders
  where it should. The failure was a *read* failure: the coffee is near-black,
  so what you see in the lower half of the decanter is the glass surface's
  specular reflection of the environment — and the room probe was taken at
  0.8 m in the aisle, so its whole lower hemisphere is checker floor. Glass
  (`envMapIntensity 0.7`, roughness 0.03) and the clearcoated coffee both
  mirrored it → sharp checkerboard "inside" a clear liquid. The mug was opaque
  ivory, but at `envMapIntensity 0.5` it mirrored the window mullions as
  vertical streaks → "frosted fluted glass". My crops confirmed geometry, not
  the read. Fix: a second probe for props (0.4 m in front of the brewer at
  1.15 m, with the checker swapped for a plain grey floor during that capture)
  is assigned as `envMap` to glass, coffee, ceramic, bisque, chromeSoft and
  sugar; glass 0.45 / coffee 0.25 / ceramic 0.2 intensity; glass roughness 0.05.
- A `Shape` hole that crosses the outer contour breaks earcut and the hole
  silently fills (the dispenser arch). Cut such openings as a notch in the
  outline instead.
- Anisotropic noise: `makeValueNoise2(seed, px, py)` / `makeFbm2` give
  tileable stretched lattices; `woodVeneer` uses them with a low-frequency
  domain warp so the band pitch drifts across a panel — no periodic function.
- Rev 5 wood, measured (the critics were right): dumping the shipped albedo
  canvases (`toDataURL` from the built page) and reading them at 1:1 showed
  bands 10–20 mm wide swung 25–50 mm side to side by the "figure" warp — a
  sinusoidal swirl, not veneer. The rev 5 note ("1–4 mm ridge pitch") described
  the lattice cell size, not what a thresholded 3-octave fbm actually draws.
  Rev 6 `woodVeneer` is authored in millimetres: a long thin lattice (3 cells
  along × canvas_mm / pitch across) thresholded into continuous 1.5–2.5 mm
  lines, a ring band every 9–13 mm at half contrast, ≤ 4 mm of drift, and ONE
  cathedral arch per 0.5 m tile whose bend decays across the tile so the rest
  stays straight; peak contrast 6–9 %. Every metric panel also gets a random
  UV offset + coin-flip 180° turn (`MergedBuilder.panelJitter`, fan blades by
  hand) so adjacent panels never share a feature. Always measure the texture,
  not the intent.
- The prop probe sits under the upper cabinets, so its upper hemisphere is dark
  maple: any light metal that faces UP and samples it (the brewer hood in rev 5)
  turns into a bronze gradient. Upward-facing brushed metals stay on the room
  probe (`stainlessCool` is deliberately not in the prop-probe list).
- Welt cords only read when they are proud: at 2 mm under the crowns (rev 5)
  the 6 mm cords were hairline creases. Rev 6 lays the cord centre 1 mm ABOVE
  the crown tangent on a 6 mm-deep steep-footed valley, and bakes the cord's
  line shadow (±6.5 mm) into the panel's vertex colour so it reads at 1080p
  without shadow-map resolution.
- **Flicker (rev 7).** The user saw pieces flicker while walking. Audited with a
  paired-frame probe: every pose shot at A, at A + 0.4 mm, and at A again; pixels
  that change A→B but not A→A' are view-dependent (z-fight or specular sparkle),
  the A' control excludes the fan. At 1–3 m a 24-bit depth buffer with near 0.05
  resolves ~0.01 mm, so only *exactly* coplanar faces fight — sub-mm overlays
  (0.2–0.8 mm) were not the culprits. Culprits found and fixed: (1) pass-through
  liner jambs placed beside the opening with their inner face ON the wall's
  reveal plane — the stainless/paint fight read as "speckled concrete"; the
  surround now lines the reveal, 3 mm into the opening, in wall-trim paint; (2)
  the counter's work-side shelf was buried inside the die with its end faces
  coplanar with the die ends — maple sawtoothed through the walnut at the
  L-return; shelf moved to the service side, 20 mm short of the ends; (3) kitchen
  ceiling box soffit coplanar with the void box top; (4) pass-through shelf top
  on the sill cut plane; (5) vinyl specular sparkle in sun — 0.1 mm/texel grain
  at normalScale 1.25 under a 0.3-rough clearcoat gave pixel highlights that
  changed every step (normalScale 0.8, clearcoatRoughness 0.45). Hygiene: all
  overlay materials (`alumGroove`, `laminateScuffed`, `edgeBand`, `plinthLine`)
  carry `polygonOffset −1/−2`, T-mould grooves are 1 mm proud (were 0.3), the
  T-mould lip hangs 1.5 mm under the slab, the counter sheet seam is 0.8 mm
  proud, sun `normalBias` 0.02. Camera near/far 0.05/200 (ratio 4000) is fine.
  Remaining A→B differences are regular dotted runs along 1-px lines (grille
  louvers, T-mould grooves, footrail edges) — thin-line coverage aliasing, not
  fighting. The probe script is not in the repo (it was a throwaway in %TEMP%);
  the recipe above is enough to rebuild it from `tools/shoot.mjs`.
- Clear glass needs `transmission 1`: at 0.95 the remaining 5 % is a diffuse
  white skin that reads as a milky veil over whatever is inside (rev 6 sugar).
  Roughness 0 keeps the transmission pass unblurred; the flutes are geometry.

- **Window glass (System 3).** A pane with `transmission 0.88` renders the missing
  12 % as a lit diffuse skin — the whole window turned into a milky veil over the
  lot. Keep `transmission 1` and put the loss into `color` (#E2EBE6 ≈ T 0.88 with
  the green-grey body tint) plus a 0.6 m `attenuationDistance`. The dust/wipe
  roughness map has to stay tiny (0.003–0.03): the transmission pass blurs by
  roughness at *screen* scale, so 0.05 already smears a car 10 m away. Handprints
  are two layers — a 0.2–0.3 roughness patch in the pane's map (frosts what is
  behind) and a 1 mm-proud `MeshBasicMaterial` alpha decal in the same layout
  (the whitish forward-scatter that makes a print visible against a bright lot).
- **Slat shadows need a tight sun frustum.** With the System 2 shadow camera
  (18 m, 4.4 mm texels, normalBias 20 mm) the 22 mm-pitch slats self-shadowed
  into a flat sheet and the stripes on the booths were soft. The shadow frustum
  now hugs the building + the two cars (13.4 × 10.4 m, 3.3 mm texels) with
  normalBias 14 mm / bias −0.0002 / radius 1; that is the smallest bias that keeps
  the sunlit floor acne-free at this texel size. System 4 should keep the
  frustum this tight (or cascade) — the stripes are the window relationship.
- **Exterior probe.** Car paint, glass and chrome sample a third CubeCamera
  (`lotEnv`, 8 m out on the lot at 1.4 m) — the room probes would put the
  ceiling grid on the hood. Materials must be assigned to exactly one probe.
- **Atmospheric perspective** is `scene.fog` (linear, sky-horizon colour, 45 → 260 m).
  Nothing inside the building or the lot is within reach, the sky shader opts
  out (`fog: false`), so only the dirt plane, scrub and ridge dissolve — the
  ground/sky meeting line disappears without any per-vertex tricks.
- **Exposure.** The exterior is ~4–5 stops brighter than the room (REFERENCE §4);
  under the placeholder exposure the sky is near-white and the white pickup
  blooms — that is the intended "already washed out" read and System 4 sets the
  final balance, but the asphalt still needs its aggregate speckle (±0.2 albedo
  contrast) to read as asphalt and not as concrete at that exposure.

## System 7 — interactions + System 6 audio wiring

All of it lives in `src/interactions/` and `src/audio/wiring.ts`; `main.ts` has
two hooks (`initInteractions({ renderer, scene, camera, player, diner })` after
the player is built, `interactions.update(dt)` after `diner.update(dt)`).
Nothing in `src/scene/*` was changed: the pot, mug, door leaf and colliders are
taken from the `Diner` instance (`diner.coffeePot`, `diner.pourMug`,
`diner.door`, `diner.colliders`); the HemisphereLight is found by traversal.

```
src/interactions/
  index.ts       initInteractions(ctx) → { update, startAudio, audio, sit, pour, door, onDoorOpen, target, interact, dispose }
                 target pick: reach + look-cone test against each interactable's focus point
                 (no raycast: 3 candidates, 12 benches — an angle test is cheaper and never misses
                 through a mug handle); keys E / F, or left-click while the pointer is locked
  Prompt.ts      centre-bottom hint "E — Sit" / "E — Stand" / "E — Pour coffee" / "E — Open door";
                 system font, 180 ms fade, `?shoot` makes it instant for deterministic frames
  Sit.ts         10 benches (5 window booths × 2 sides); 0.9 s eased glide to the seated pose
                 (eye 1.15 m, centred on the bench, turned 35° to the window, −9° pitch) then a
                 12 mm head settle over 0.25 s; movement locked, look clamped ±70° / ±40° around
                 the seated heading; E again glides back to the aisle spot. Any window booth works.
  Pour.ts        decanter lift 12 cm → over the mug → tilt 45° → 2.5 s hold → return, 6.3 s total;
                 stream = wobbling tapered cylinder (onBeforeCompile), mug liquid = lathe disc with
                 meniscus lip + rippled surface (shader, coffee material), decanter coffee clipped
                 by a plane that drops 9 mm; steam = Steam.ts; clink at pick-up/put-down, pour SFX
                 for the stream duration. Once full, E gives a 4 mm / 0.22 s bob and no refill.
  Steam.ts       1 InstancedMesh, 22 billboard quads, procedural noise alpha in the shader, rise +
                 drift, 30 s then fades. Modest by design (System 8 may extend).
  DoorSwing.ts   leaf 0 → 85° over 1.1 s with overshoot + settle, 4 s hold, closer-style slow →
                 latch (7.15 s cycle); one AABB collider that follows the leaf every frame
                 (disabled for the frame if the player's centre is inside it, so they are never
                 trapped); `onDoorOpen(progress)` listeners (default one brightens the hemi fill
                 +12 % at full open); audio `setOutside(progress)` crossfades the heat wall.
  debug.ts       window.__interact / __interactPose / __interactions (below)
  util.ts        easings + the Interactable interface
src/audio/wiring.ts   createDinerAudio() with the warmer at the brewer's lower plate and the mug at
                 `pourMug`; radio / AC / fan / door from System 6's defaultPositions();
                 startAudio() (idempotent) + first click/keydown/pointerdown fallback;
                 listener follows the camera in update()
```

Controls: E (F, or click under pointer lock) on the highlighted target. Reach:
benches 1.4 m, mug 1.25 m, door 1.4 m; look cone 22–30° half-angle.

Debug / capture API (`src/interactions/debug.ts`, on `window`):

| Call | Meaning |
|---|---|
| `__interact("sit" \| "pour" \| "door")` | run the interaction live (sit picks the nearest bench; `{booth, side}` as 3rd arg) |
| `__interact(name, t)` | seek to `t` seconds into that interaction and freeze the clocks (silent) |
| `__interact("stand" \| "resume" \| "reset")` | stand up / unfreeze / everything back to rest |
| `__interactPose("sit-seated" \| "pour-mid" \| "pour-full" \| "door-open")` | state + camera for `tools/shoot.mjs` |
| `__interactions` | the live object: `.sit.state`, `.pour.state`, `.door.progress`, `.target`, `.audio.state()`, `.startAudio()` |

Poses (`tools/shoot.mjs --tag=sys7 --poses=sit-seated,pour-mid,pour-full,door-open`,
`--port=` to run beside another worktree's harness): `sit-seated` = booth 2,
+x bench, seated eye line filling the window with the stripe shadows on the
table; `pour-mid` = 1.2 s into the stream (mug half full, stream, first steam)
from the back bar looking down the counter; `pour-full` = 6 s (decanter back
9 mm lower, mug full, steam); `door-open` = 2 s, leaf settled at 85°, seen
from the +x side of the vestibule through the opening with the sedan behind it.

Live verification (Playwright against `vite` dev, not committed): the whole
flow — prompt appears at the bench, E sits, look clamps, movement locks, F
stands; prompt at the mug, E pours, mid-pour stream/liquid/steam, full mug,
decanter clip plane −9 mm, bob without refill; closed leaf blocks the player,
E opens, hemi fill up, `setOutside(1)`, player walks out through the opening,
door latches after the cycle — 23/23 checks. `interactions.update` costs
≈ 0.01 ms idle and while pouring + swinging (budget 0.5 ms); no per-frame
allocations (scratch vectors are members). Draw calls: +6 at the pour camera
while pouring (stream, liquid, live decanter clone, steam), 0 otherwise.

## System status

| # | System | Status |
|---|---|---|
| 1 | Interior geometry and floor plan | **done** (rev 4 close-out: empty L-return, footrail at 200 mm on cast brackets, bell pedestals, head bulkhead + 25 mm wall angle, 60 × 40 caps, 100 mm saddle + stepped exterior slab) |
| 2 | Booth and counter detail | **PASSED at rev 7 (`9adefff`)**; System 3 rev 1 polish: 3 condiment sets on 9 stools (centred between stool pairs), boomerangs in two classes (32–38 mm + 15–20 mm) with a few outline-only shapes, channels pillowed 4 mm outward with the 1–2 mm valley at the welt, stool seats with a 17 mm crown + 10 mm roll over the band, near-white granular sugar. Rev 7 was: flicker audit + fixes (see Lessons); stools built per stool into the merged buckets (no instancing): ±6 mm column height, any yaw with the welt junction + boxing seam travelling with it, ±5 % squash, 250 × 200 mm sit-hollow 6–9 mm deep in its own shade, one 2.5° worn swivel, three chrome wear grades (roughness 0.07/0.12/0.17), four bolt caps per base; glass `transmission 1`/roughness 0/thin, granular sugar top tilted 7° at 75 %, grey-blue granular salt standing in front of the pepper; black SplashGard funnel (Ø 178 × 100, paddle handle) in the rails, stainless fill lid so one black warmer disc tops the hood, 7 mugs staggered ±15 mm on the mat; napkin tip with folded leaf + crease, domed cast pedestal with collar, pass-through surround in wall-trim paint. Rev 6 was: A1 veneer at true scale (lines 1.5–2.5 mm, one decaying cathedral per 0.5 m, ≤ 9 % contrast, per-panel UV jitter + flips; oak caps / walnut panels + die / maple cabinets + fan blades kept); A2 cords proud of the channels (centre +1 mm over the crowns, 6 mm, baked line shadows, 6 puckers in the last 30 mm at both tucks), 6 mm piped head-roll seam, seat welt + boxing seam + dark top-stitch line at the nose, 6 mm welt torus round every stool seat over a 1" band; vinyl roughness ≈ 0.32–0.5, grain normal 1.25, clearcoat 0.1. B1 boomerangs as straight-armed 100–130° elbows with rounded tapered tips, 28–52 mm, ~3.5 / 100 cm², three tones, on a 2048 px / 1.2 m tile (no repeat on a table). B2 one fluted jar (14 cos² ribs, 2.5 mm) in `glassFluted` (10 mm refraction thickness) with the sugar at 97 % of the bore to 65 %, full-diameter 12 mm lid with 1" side-hinged flap; S&P 1.5 mm glass walls, fills at 97 % of the bore to 60 %, opaque `salt`. B3 hood in light `stainlessCool` (albedo 0.6, roughness 0.3, anisotropic, room probe) with black control band + black 150 mm warmer discs top and base, stainless base plate over a black base, 25 × 14 mm lit rocker switches with pivot line. B4 mug 7–8 mm walls / 13 mm floor / 6.5 mm rim, dark `bisque` foot ring, stubby handle; 8 spares inverted on a ribbed rubber bar mat, 2 upright, saucers only at the two stools. B5 stools: seat parts pivot on the column top with ±1.2° tilt, ±10 mm height, ±5 % cushion squash, ±10 mm pitch with two nudged 22–30 mm. C: 2" fluted T-mould with 4 grooves on the counter, 28 mm push bar on cast rose/post/saddle standoffs, 4.5" × ½" five-rib saddle threshold, 5 mm dark-steel spider plate with 4 screws on a dark-sealed underside, ½" troffer recess in a 1" frame, shaped cast fan irons with bosses, 1.8 mm rolled dispenser lid edge. Rev 5 was: mugs are `MeshPhysicalMaterial` ivory china (opaque, roughness 0.15, clearcoat 0.6, env 0.45; runtime probe confirmed transmission/transparent were never set — the rev 4 "frosted" read was a shaded white body mirroring the counter); Skylark laminate as sparse (~30 %) round-capped stroked chevrons, three tones pulled toward cream, non-touching; Tablecraft-221 dispenser in smooth `stainlessBrushed` (roughness 0.2, anisotropy 0.4 — at 1.0 the sun lobe whited the face) with 70 × 22 slots on both long faces, napkin fans, flange lid, rubber feet; BUNN tower in matte `blackPowder` with brushed stainless side panels and a Ø 190 × 110 stainless funnel with forward handle; channel depth 20 mm with 6 mm cords riding 2 mm under the crowns, vinyl #A8141C roughness ≈ 0.3–0.4, 0.4 mm grain, clearcoat 0.15; veneer ridge pitch 1–4 mm with ~300 mm cathedral figure at ≤ 12 % contrast (caps satin 0.3, laminates 0.5); shaker fill fitted to the glass, half-moon side-hinged sugar flap, 13 mm troffer reveal. Rev 4 was: prop-side reflection probe (no checker in glassware), opaque #2A1408 coffee at 55 % with fill line/meniscus/tide line, 12 mm D-handle facing the aisle, 100 mm-deep funnel; opaque ivory mugs (roughness 0.14, env 0.2) inverted on 140 mm saucers on the drip tray + 3 loose uprights + `pourMug`; Skylark boomerangs as bent chevrons (62/72 mm, 12–15 mm, tan/grey-blue/white, ~40 %); three grain sources via `woodVeneer` (oak caps, walnut panels/die, maple cabinets); seat boxing seam 25 mm below the crown, brighter valley cords, ±3–4 mm puckers; stools ±8 mm height/±10 mm pitch/±25 mm off-line, concave rim band mirrors the checker; Tablecraft-221 dispenser with 52 × 42 arch, napkin tip, lid seam; bright 4" saddle; kitchen box with its own emissive ambient. Rev 3 was: — 5 mm welt cords proud in every channel valley + 7 mm roll-seam and boxing-seam welts, puckers at both tucks, broad sheen (roughness map 0.35–0.55, clearcoat 0.25); 512 px interior-capture PMREM; irregular vertical veneer grain on end panels/counter die/cabinets (contrast 0.10), horizontal cap grain; T-mould with 3 real 2 mm grooves + returned lip, 38 mm tops with sparse two-tone boomerang; counter sheet seams every 3.6 m; steep-rimmed bell stool bases that mirror the floor, per-stool rim seam, ±12 mm height/±25 mm offset; footrail elbow + return flange; 300 mm brushed spider plate; BUNN VPR brewer with one lower + one upper warmer, deep SplashGard funnel, brushed body; 173 × 178 decanter with opaque 55 % coffee, fill line, tide line, black collar/handle, stainless base ring; closed 98 × 117 × 184 dispenser with recessed faceplates and one napkin tip; 12-flute sugar pourer at 65 %; glass shakers with visible fill; glossy waisted mugs (roughness 0.1); 6 mm prism troffer lens; 14 mm fan blades; alu threshold plate |
| 3 | Windows, blinds, exterior view | **built, rev 1 (proof crops in `shots/crops/`)** — venetian blinds on all five windows (none on the door: the reference diners keep the door pane clear for the OPEN sign and the view of who is coming), instanced curved 1" slats at 22 mm pitch / 45°, ±0.5° tilt, ±0.3 mm sag, a kinked slat per window, ±4 % tone, dust streaks on the up-faces, rails, two ladders + lift cords + wand each; slats cast the hard stripe shadows through the existing sun (tight 3.3 mm shadow texels). Window/door glass `MeshPhysicalMaterial` T = 1 with the 12 % loss in the colour, IOR 1.52, 6 mm, green-grey attenuation, room-probe reflection, dust haze heavier at the lower edge/corners, wipe streaks, five handprints at push-bar height (roughness patch + haze decal). Exterior: 150 mm kerb + 1.5 m sidewalk, 12 stalls of re-striped asphalt (drift, tyre polish, sealcoat patches, alligator + long cracks with dusty/sealed fills, oil drips, old + new lines) over a plain surround, kerb stops, 1.2 m CMU wall at the far edge, two 7 m light standards on concrete bases, dusty white pickup (5.3 m, 2.9 m wheelbase, 0.71 m tyres) and maroon sedan (4.9 m, faded clearcoat) with dark glass, chrome bumpers/trim, recessed headlamps with chrome bezels, contact-shadow decals, `lotEnv` probe; desert dirt with 900 instanced scrub patches, fBm mesa/ridge ring fading into the sky, shader sky dome (near-white horizon → pale desaturated blue, sun glare on az 38° / el 35°), linear fog 45–260 m for atmospheric perspective. Draw calls 181–335 (worst: `length`). |
| 4 | Lighting | pending (placeholder sun/hemi/troffers in `Lighting.ts`) |
| 5 | Materials and textures | pending (placeholder palette in `materials.ts`) |
| 6 | Sound design | pending |
| 7 | The 3 interactions (sit, pour coffee, open door) | **built, rev 1** — `src/interactions/*` + `src/audio/wiring.ts` (System 6 wired: gesture start, positional beds, pour/clink/door SFX, exterior crossfade). Frames `shots/sys7-{sit-seated,pour-mid,pour-full,door-open}.png`; 23/23 live Playwright checks; update ≈ 0.01 ms; +6 draw calls only while pouring |
| 8 | Post-processing and final polish | pending |

Known simplifications after System 3: no heat shimmer (System 8 post), no
chain fence, the cars have no interiors (dark glass hides it at 10–30 m), the
sky has no clouds, L-return top empty (register is a later prop),
kitchen box holds dim grey silhouettes only, no second (restroom) door on the
far end wall, sun-facing vinyl reads a little washed under the placeholder
light rig (System 4/5 own that balance), the troffer lens prism pattern is a
faint 6 mm cell map + normal map that will only really read once System 4
lights it, cap rails have no separate end-grain material.
