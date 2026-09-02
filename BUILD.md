# Morning Diner — build notes

A first-person walk through a small American roadside diner at 8 AM. Three.js
only, zero external assets: every mesh, texture and (later) sound is generated in
code. The target is a paused frame that reads as a photograph.

## Architecture

```
src/
  main.ts                 boot pipeline (loader → staged build → probes → post pipeline → first
                          frames → enter), renderer, 37° camera, frame-capped loop, resize, ?debug logging
  ui/Loader.ts            the loading overlay (#loader in index.html): bar, stage label, Click to enter
  scene/
    layout.ts             THE floor plan: every dimension and position, in metres
    Diner.ts              composes the room in yielding stages (`build()`), issues every shader
                          program in parallel, bakes the three probes once, owns colliders and
                          per-frame animation, `invalidateShadows()`
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
                          (az 38° / el 35° from REFERENCE) so the sky glare and the shadows agree.
                          Sun = spot (building, 3.5 mm shadow texels) + directional (lot) tiled by a
                          caster-only cone; `installShadowMasks` gives each map its own caster list
                          and re-raises `shadowMap.needsUpdate` per light so shadow-once renders both
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
    scheduler.ts          yieldToPaint / sleep, weighted Progress model, BootTimeline (marks)
    textureBank.ts        worker pool for the canvas generators: proxies textures.ts / exterior.ts,
                          hands out placeholder textures, fills them from ImageBitmaps; main-thread fallback
    texProtocol.ts        worker message types + `propsOf` / `applyProps` (sampler state round-trip)
    compile.ts            parallel shader link: issueCompile / waitForPrograms (KHR_parallel_shader_compile)
  procedural/
    texWorker.ts          Web Worker entry: runs any generator below on an OffscreenCanvas, posts bitmaps
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
  capture/pose.ts         window.__ready / __SCENE_READY / __setPose / __stats / __perf for the harness
  post/                   System 8 (see "System 8 — post-processing & atmosphere" below)
    PostPipeline.ts       createPostPipeline(): MSAA scene target → haze → composite (shimmer)
                          → bloom → finish (CA, vignette, tone map, grain) [→ SMAA]; GPU timers
    settings.ts           every knob + default, `?post=0`, URL overrides, window.__post.settings
    beams.ts              sun-beam prisms from the window/door apertures; GLSL inBeam/sunVisible
    Dust.ts               SunDust: 5 k motes as Points, shadow-map-lit, Mie phase, twinkle
    Steam.ts              SteamEmitter (reusable: decanter here, mug pour in System 7)
    shaders.ts            haze / composite / bloom / finish / grain fragment shaders
    GpuTimer.ts           EXT_disjoint_timer_query_webgl2 per-pass timings
tools/
  shoot.mjs               headless capture harness (build → serve :5210 → shoot poses;
                          `--port=N` / SHOOT_PORT=… for a parallel worktree)
  post-bench.mjs          System 8 bench: per-pass GPU ms + frames for a list of ?configs
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
  and drops to ~10 fps when the tab is hidden or the window loses focus. The
  two shadow maps (interior spot + lot directional) are rendered once at boot
  (`shadowMap.autoUpdate = false`; call `diner.invalidateShadows()` whenever
  anything sunlit moves — door leaf, blinds, decanter, the sun itself; both maps
  re-render on the next frame) — those passes were ~110 draw calls and ~6 ms of
  GPU time per frame.

## Startup

`main.ts` boots in stages behind a DOM overlay (`index.html` `#loader`,
`src/ui/Loader.ts`): title, a thin bar with a percentage, a one-line stage
label, and at the end "Click to enter" — the click is forwarded to the canvas so
FirstPerson takes pointer lock and the AudioContext starts on the same gesture.
With `?shoot` (the harness) the overlay is removed as soon as the scene is
ready and no click is needed. `window.__ready` (a Promise) and
`window.__SCENE_READY` are installed before any work starts and settle after the
second rendered frame; `window.__perf()` returns the boot timeline.

Order, and where the time goes on the RTX 4060 / 7600X (cold, headless, DPR 1):

```
  0.2 s  renderer + palette   createPalette() calls the generators through TextureBank.proxy():
                              every canvas generator returns a placeholder texture immediately
                              and the job goes to a pool of 8 Workers (OffscreenCanvas, same
                              code, same PRNG → byte-identical pixels)
  0.7 s  geometry             Shell, Booths, Counter, Ceiling, Door, Props, Blinds, Exterior —
                              one stage per painted frame so the bar moves
  1.2 s  environment          procedural room map (buildEnvironment)
  1.6 s  stand-in + compile   a blank 512 px cubemap PMREM'd to the probes' size stands in as
                              scene.environment while ALL ~98 programs are issued at once:
                              A render-target + room env (probe pass), B canvas + probe env
                              (main pass), C render-target + probe env (transmission pass).
                              Programs key on the env map's PMREM height, not its content.
  ~7.5 s textures             workers finish (≈ 33 s of generator CPU across 25 jobs; the
                              driver's link threads share the same six cores)
  ~8.3 s shaders              all programs linked (ANGLE links on a thread pool;
                              WebGLProgram.isReady() polled every 20 ms)
  ~9.2 s probes               room / prop / lot CubeCamera captures, PMREM'd, assigned;
                              both shadow maps render once inside the first probe face
  +5 ms  post                 createPostPipeline(): MSAA target + post materials allocated; the
                              dust + steam programs join the pour's compile batch right after;
                              the 6 screen-pass programs link on the first frame
  ~9.8 s first frames         → __ready, overlay fades / Click to enter (the first two frames
                              go through post.render(), so the overlay never lifts on a
                              frame the pipeline has not drawn)
```

Measured with `tools/shoot.mjs` (`[shoot] boot:` line): **9.5–9.9 s to ready**
on the loader branch; 10.8–12.3 s after the merge with System 3 rev 2 (98
programs, two shadow maps, three other worktrees building on the same cores);
was 34–49 s before (43 s of that was one-at-a-time synchronous shader links —
the canvases were only ~7 s). Main-thread fallback (`?workers=0`, or when
Workers/OffscreenCanvas are missing): 12.7 s. Frame time at the spawn pose:
GPU 5.8 ms median (was 11.9), 124 draw calls (was 233), 1.4 M triangles (was
2.2 M) — the difference is the per-frame shadow pass. The bar's weights
(`main.ts`) follow the shares above: geometry 12, textures 25, shaders 40,
probes 18, first frame 5.

The remaining floor is CPU: ~33 s of canvas generation plus the D3D compile of
94 physical-material programs on six cores. Cutting further means cheaper
generators (`lotSurface` 2048², `glassDust`, `paintedWall`, `woodVeneer` ×3 and
`concrete` are 2–3 s each) or fewer program variants — both change
`src/procedural/*` / material parameters and were out of scope for the loader.

Worker rules: generators are dispatched through `TextureBank.proxy(module)`;
only functions listed in `SHAPES` (textureBank.ts) go to a worker — the entry
says which fields of the result are textures. The proxy returns real
`THREE.Texture` placeholders with the generator's sampler state applied when the
bitmap lands, so call sites can keep doing `t.repeat.set(...)` / `t.wrapS = …`
right after the call (call-site values win over the generator's, exactly as in
the synchronous path). A texture that is re-drawn at runtime must NOT be listed
in `SHAPES` — it needs a live canvas on the main thread. Bitmaps are created
with `imageOrientation: "flipY"` and `premultiplyAlpha: "none"` and the texture
is marked `flipY = false`: WebGL ignores UNPACK_FLIP_Y / UNPACK_PREMULTIPLY_ALPHA
for ImageBitmap sources, so the flip has to be baked in (without it every
texture was upside down — the checker floor inverted and every surface differed
by a few LSB). `?workers=N` overrides the pool size for profiling.

## Pose / capture API

Installed on `window` by `src/capture/pose.ts`:

| Global | Meaning |
|---|---|
| `__ready` | Promise, resolves after the second rendered frame (probes baked). Installed before any boot work |
| `__SCENE_READY` | `true` at the same moment (what `tools/shoot.mjs` polls) |
| `__perf()` | boot timeline `{ marks: [{name, ms, dt}], textures: { workers, wallMs, jobs }, programs, parallelCompile }` |
| `__setPose({x, y?, z, yaw, pitch})` | teleport the camera. Metres; angles in **degrees**. `yaw 0` looks toward −z (the kitchen wall), positive turns left (toward −x). `pitch` positive looks up. `y` defaults to eye height 1.62 |
| `__stats()` | `{ calls, triangles, renderer }` from the live WebGL context |
| `__APP` | `{ renderer, scene, camera }` for ad-hoc inspection |

URL flags: `?debug` logs the GPU adapter, boot timeline, per-job texture times
and draw calls every 5 s; `?shoot` removes the loader without a click (the
harness sets it); `?workers=N` sets the texture worker count (0 = main thread);
`?nofill` renders the sun alone; `?nospot` / `?nolot` drop one of the two sun
lights (diagnostics for the two-light split).

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

Options: `--no-build` (reuse `dist/`), `--poses=door,aisle`, `--query=nofill`,
`--port=5211` or `SHOOT_PORT=5211` (the machine is shared with other worktrees' harnesses; 5210 is
the default). The harness serves `dist/` on `127.0.0.1:<port>`, launches full Chromium
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
at a booth seat and table under the slat shadows. Rev 4 added the exterior
debug poses to `shoot.mjs` (they were a throwaway harness in rev 2/3): `dbg-pickup-front34`,
`dbg-pickup-side` (true side elevation for proportion measurement), `dbg-pickup-rear34`,
`dbg-sedan-front34` (the windshield-interior check), `dbg-sedan-rear34`, `dbg-wheel`
(1.2 m from the sedan's front-left wheel), `dbg-wheelstop` (under the sedan's nose at the
stop bar) and `dbg-wall-road` (standing in the empty stall between the two cars — the pickup's roof filled the frame from its rev 3 spot once the truck moved forward — looking over the wall and through its gap: ruts, scrub edge, road, ranges). They
stand outside the building — never player-reachable — and are shot with `--tag=sys3`.

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
- **Shader links were the cold start.** On ANGLE/D3D11 every three.js program
  is an HLSL compile (~0.3 s); this room has 94 across three output/env
  variants, and first-use linking is synchronous. `renderer.compile()` per
  variant issues them all and Chromium's KHR_parallel_shader_compile links on a
  thread pool. Two traps: a *synchronous* link (PMREMGenerator's own materials,
  anything that reads LINK_STATUS) queued behind the batch waits for the whole
  batch (~2 s), so make the stand-in PMREM before issuing; and programs key on
  the environment map's PMREM *height*, so the main-pass variants can be
  compiled against a blank cubemap of the probes' size before the probes exist.
- ImageBitmap textures ignore `flipY` / `premultiplyAlpha` at upload; bake the
  flip into `createImageBitmap(..., { imageOrientation: "flipY" })` (texWorker.ts).
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
  into a flat sheet and the stripes on the booths were soft. Rev 1 hugged the
  building + the two cars (13.4 × 10.4 m, 3.3 mm texels, normalBias 14 mm /
  bias −0.0002 / radius 1) — and that is exactly why the lot lost its shadows
  (rev 1 critic A3): the pole, wall and far stalls were outside the map, and
  three.js lights anything outside an ortho shadow frustum as *unshadowed*.
- **Two suns, split by region (System 3 rev 2) — the System 4 decision.** One
  frustum cannot hold both 3.5 mm stripe texels and a 31 × 20 m lot; a CSM costs
  a full extra depth pass per cascade and the < 350 draw-call budget has no room.
  So `Lighting.ts` has (a) `sun`, a **SpotLight** 150 m out along the sun vector,
  `decay 0`, cone just wide enough for the building (rays vary ±2.3° across the
  room — invisible), 4096² perspective map ≈ 3.5 mm at the floor; the spot
  contributes nothing outside its cone, which is the mask; and (b) `sunLot`, a
  **DirectionalLight** with the same colour/intensity and a wide ortho frustum
  over the lot (≈ 8 mm texels). An invisible **caster-only cone** (colorWrite
  off, DoubleSide shadowSide) sits exactly on the spot cone so `sunLot` is
  shadowed wherever `sun` shines: the two lights tile the world and the seam is
  a shadow-map edge, not a lit/dark step (checked in a top-down `?nofill` frame
  — no ring on the lot). three.js cannot mask a light per object (layers are
  tested against the *render* camera even in the shadow pass), so
  `installShadowMasks` wraps `renderer.shadowMap.render`, renders one light at a
  time and flips `castShadow` between maps: cone → lot map only, interior →
  spot map only, exterior (`userData.lotCaster`) → both. A first attempt with
  `geometry.drawRange = 0` did not help: `renderer.info.render.calls` counts the
  draw even when it draws nothing. Net: lot shadows everywhere (pole shadow
  10.7 m long ≈ 1.43 × height at el 35°, cars, stops, wall) at 231–338 calls.
- **Shadow-once × per-light wrapper: re-raise `needsUpdate` per light (loader
  merge).** `WebGLShadowMap.render` returns early when `autoUpdate` is off and
  `needsUpdate` is clear, and *clears* `needsUpdate` at the end of a pass. The
  two-sun wrapper calls the original once per light, so after the loader's
  `shadowMap.autoUpdate = false` the first light's pass would have cleared the
  flag and the second map (whichever three.js listed second) would never have
  rendered — no lot shadows or no stripes, depending on order. The wrapper now
  mirrors the early return, sets `needsUpdate = true` before each light's pass
  and clears it once at the end; `Diner.invalidateShadows()` therefore always
  re-renders both maps. Verified by pixel-diffing the merged build against the
  rev 2 frames (per-frame shadows): `window`, `stripes`, `door-glass`,
  `macro-warmer` identical (max 1 LSB), `length` differs only on the spinning fan
  blades. Casters are listed once in `installShadowMasks` (after every builder
  ran); a mesh added later casts into both maps, which is harmless because the
  cone already blacks the building out of the lot light.
- **Exterior fill was flattening the lot shadows.** `skyFill` emissive (0.2–0.22
  × albedo) on top of the hemisphere light gave lit:shadow ≈ 1.5:1 on the
  asphalt; 8 AM sun over a clear sky is ≈ 5:1. Emissive is now scaled ×0.45;
  the hemisphere carries the sky term.
- **Shadow-pass draw calls are the budget.** Every caster is one depth draw per
  shadow map per frame, and with `transmission` glass in the scene the opaque
  set is also drawn a second time into the transmission target. So: ceiling and
  fan never cast (the sun enters below them heading down — 13 draws saved),
  coplanar overlays (`userData.noCast`, read by `MergedBuilder.build`) never
  cast, car trim buckets (chrome, hubs, lamps) never cast. Worst pose went
  361 → 338.
- **Rev 1 critic A1/A2 were mis-reads, verified not assumed.** A1 "sun on the
  wall under the sill": the striped surface at `sys3-table` x 0–330 / y 350–480
  is the **sill stool top** (horizontal, 0.95 m, lit through the bottom of the
  pane); the vertical wall face under it is uniform (`crop-wall-under-sill`).
  A2 "stripes not parallel to the wall": re-projecting the `table` frame onto
  the tabletop plane (y = 0.75, known camera pose, `crop-stripes-rectified`,
  cyan lines = x axis) and cross-correlating the stripe profile across 24 cm
  gives 0.0–0.6° from the window-wall axis (sub-pixel; the structure-tensor
  method is useless here because the boomerang pattern and the shadows of the
  props dominate). Slats are only ever rotated about x (`Blinds.ts` Euler
  `(rx, 0, ±0.1°)`), so their shadows on any horizontal plane are x-parallel by
  construction; the visual "25–40°" is the perspective of x-parallel lines at
  different depths converging on the x vanishing point (≈ (2411, −78) px in
  that frame). Also confirmed: with a point-like spot the shadow of a horizontal
  line on a horizontal plane is still parallel to it (the plane through apex
  and line contains x̂).
- **LatheGeometry points must run bottom → top** (increasing y) or the surface is
  inside-out and back-face culled — the rev 2 tassel vanished for exactly that.
- **Hardware needs contrast, not just geometry.** A clear acrylic tilt wand
  16 mm off almond slats and an almond tassel at bottom-rail height were both
  present in the mesh and invisible in every frame. Now: 12 mm tan glossy wand
  45 mm in front of the slats (right jamb from inside, `x0`), 1.3 mm pull cords
  35 mm in front with an equaliser and a turned-wood acorn tassel ending 15 mm
  above the stool (left jamb from inside, `x1`).
- **Exterior probe.** Car paint, glass and chrome sample a third CubeCamera
  (`lotEnv`, 8 m out on the lot at 1.4 m) — the room probes would put the
  ceiling grid on the hood. Materials must be assigned to exactly one probe.
- **Atmospheric perspective** is `scene.fog` (linear, sky-horizon colour, 45 → 260 m).
  Nothing inside the building or the lot is within reach, the sky shader opts
  out (`fog: false`), so only the dirt plane, scrub and ridge dissolve — the
  ground/sky meeting line disappears without any per-vertex tricks.
- **Dark glass must be a dielectric.** Rev 2 car glass was `metalness 0.55` with a
  near-black colour: a metal's reflection is tinted by its base colour, so the
  windshields mirrored a *black* sky while the chrome next to them caught white
  sky — the critics' "contradictory" read. Tint goes in `color`, reflection comes
  from `metalness 0` Fresnel (+ clearcoat) with the `lotEnv` probe.
- **Loft, don't extrude, anything seen in three-quarter view.** An extruded side
  profile has vertical flanks, a flat nose and no way to cut wheel arches; the
  rev 3 `loftBody` (fixed 24-point section per station, wheel arches lifting the
  lower edge, analytic normals with one-sided tangents at flagged creases) gives
  tumblehome, edge radii and real arches for ~2 k triangles per car. Screens and
  trim are placed from the *station* data (`topAt`, `flankX`), never from
  hand-typed coordinates — the first pass had the pickup's rear glass buried in
  the cab-back slope for exactly that reason.
- **`skyFill` emissive with a map**: `emissive` must be `colour × k` and the map
  goes in `emissiveMap`; with a tinting map (near-white car dust) a plain
  `emissive = k` washed the maroon sedan pink.
- **Rev 2 critic C ("dark 15 cm headrail") and E ("unstriped patches") were
  mis-reads, verified not assumed.** `lot-wide` y 70–125 is the window's transom
  bar (`WINDOW.transomY` 2.2, dark stained frame) *behind* the slats; the pale
  headrail sits above the frame, out of that pose. The end-wall patches in
  `length` / `counter` are striped — 2–3 px pitch after the oblique projection —
  and vanish with the spot off (`sunLot` cannot reach the room). Proof frames
  were made with the throwaway probe harness (a spec of poses + page JS that
  toggles lights / hides meshes / raycasts from a pixel toward the sun) — cheaper
  than editing `tools/shoot.mjs`, and it keeps debug poses out of the repo.
- **Exposure.** The exterior is ~4–5 stops brighter than the room (REFERENCE §4);
  under the placeholder exposure the sky is near-white and the white pickup
  blooms — that is the intended "already washed out" read and System 4 sets the
  final balance, but the asphalt still needs its aggregate speckle (±0.2 albedo
  contrast) to read as asphalt and not as concrete at that exposure.
- **`MergedBuilder.add` mutates the geometry it is given** (`applyMatrix4` in
  place, no clone). Anything you want to reuse — the rev 4 cabin lining is the
  body loft flipped inside out — must be cloned *before* the first `add`, or the
  copy is transformed twice and lands at 2× the car's offset (a black ghost
  sedan appeared 5 m behind the pickup in `dbg-pickup-side`).
- **Glass over paint is not glass.** Rev 3 laid panes 6 mm proud of a closed
  body loft, so every window was a tinted reflection of a *painted* surface —
  the critics' "opaque navy slabs". Rev 4 cuts the glass out of the loft itself
  (`glassOf`: tumblehome segment over a side pane's span, top-centre quads split
  at |x| = w(z) inside the A-pillars; raked pillar edges by splitting quads along
  a parameter line) and emits those quads with the pane material, with the same
  loft flipped inside out (`flipFaces`) in dark matte as the cabin lining, so the
  only openings are the glass. A pane that blends must stay in the OPAQUE list
  (`transparent: false`, `CustomBlending`, premultiplied `gl_FragColor = (light,
  α)` via `onBeforeCompile`, `depthWrite` off, `renderOrder 5`) or three's
  transmission pass never sees it and the diner's window glass looks straight
  through the car.
- **A convex-body normal rule fails inside a pocket.** `loftBody` orients
  normals away from the station centre; the pickup bed's floor and inner walls
  lie below / outside that centre, so they faced into the metal, were culled and
  showed the dark lining ("black bed"). Pockets use a flat face normal aimed at
  the cavity (`pocketFloorY + 0.15` on the centre line) instead.
- **Attribute parity in a merged bucket.** `mergeGeometries` drops the *whole*
  bucket if one geometry lacks an attribute the others have — the rev 4 hood cut
  strips (position + normal, no uv) silently removed every dark-trim part on both
  cars. Give hand-built geometry all three of position / normal / uv.
- **Loft rings must stay ordered in y.** `Station.yBelt` was `max(beltY, yLo + 0.05)`
  regardless of `yTop`; over the hood and deck (lower than the belt line) the
  belt ring sat above the top ring, the skin folded outward and its underside
  read as a black lip along the far hood edge (pickup 4 cm, sedan up to 9 cm at
  the nose). Clamp each ring under the one above (`yBelt ≤ yTop − 0.03`).
- **Hand-wound strips: check the winding against the camera, not the maths in
  your head.** The tyre-track ruts (rev 3) were wound (p, p+1, p+2) which faces
  −y for any path direction, so every track was back-face culled and no frame
  ever showed one — nobody noticed because the pose also happened to hide the
  ground behind the wall. Shoot a top-down debug pose for any ground decal.
- **Put seeded imperfections where the eye is.** A "random height" kink on a
  74-slat blind lands in the top half most of the time, and the `window` pose
  only sees the bottom 25 slats; rev 3's kinks/sags were there but never in
  frame. Constrain the seed to the band the poses cover (66–94 % down).
- **Measure at native resolution.** `tools/crop.mjs` takes 1920 × 1080 pixel
  coordinates; reading a downscaled 1024 px preview and passing those numbers
  crops the wrong region (×1.875).
- **`tools/shoot.mjs` is CRLF in the working copy on Windows** (`core.autocrlf
  true`); an editor that writes LF turns a 12-line pose edit into a 536-line
  diff. Normalise to LF before committing (`sed -i 's/\r$//'`) so git's
  autocrlf handles the rest.
- **A loft flank must be one profile, not one per station.** Rev 4 placed the side-bulge ring point at 45 % of the height *remaining above the wheel arch*, so every station over an arch had its own flank curve and the skin "breathed" around the cut-out — the critics' blistered fender with a crease running to the A-pillar. Anchor the flank x(y) at the nominal sill and the belt and only clip its lower end at the arch; the arch itself is a separate constant-width rolled lip.
- **A length tangent along an arch column tilts the normal.** `normalAt` took each ring point's fore/aft tangent from its own column; for the flank points that column climbs the arch, so the normals leaned fore/aft around every wheel and the fender shaded like a ripple even after the geometry was flat. Flank points now borrow the belt column's tangent (`jRef`); only the lip roll keeps its own.
- **A 6 mm groove is not a shut line at 4–6 m.** It anti-aliases to a 1 px grey line (per-row step 28 sRGB on the white pickup, ~6 on the maroon sedan). What reads is depth: an unlit black floor (`MeshBasicMaterial`, no lighting to lift it) plus a paint chamfer either side so the two rolled edges shade differently. Measure the step at native (`tmp/seam.mjs`, per-row minimum vs the panel 6–14 px away — a slanted seam smears a column average) and aim for ≥ 25.
- **Stand-offs are per body.** The sedan's wipers park 60 mm below the glass base in a deep cowl channel; on the pickup's steep, shallow-cowl windshield the same numbers floated the arms 35° up the pane. Branch on glass steepness (dy/dz > 1.2) and park on the glass at 5°.
- **"Lit facet through the cab gap" was the truck bed.** Two rounds of geometry hunting (gap depth, cab-back step, materials dyed red) before a ray probe (`window.__APP.camera` + Möller–Trumbore over every mesh) showed the bright slanted patch is the sunlit far bedside wall seen over the near rail, cut by the cab's shadow. Probe pixels before changing geometry: `__APP` exposes scene + camera for exactly this.
- **Seeded imperfections need the visible END too.** The rev 4 crease was in the right height band but on a random end; the `window` pose clips the +x end at the frame, so half the seeds were invisible. Fix the end (keep the rng call so the rest of the sequence is stable).
- **Colour-code to find a slat.** A per-index dye (`k === kinkK ? red`) in one throwaway shoot located the creased slat in seconds after four blind crops missed it.
- **Decade decision (sedan).** The brief named a 1991–96 Caprice; the model is
  the 1977–90 *box* Caprice (upright greenhouse, flat hood/deck, quad
  rectangular sealed beams, egg-crate grille, chrome bumpers with guards). Kept
  on purpose: the box body suits the diner's period and the front graphic already
  reads; the 91–96 "whale" body would need a whole new loft and its rounded glass
  is a worse fit for the blend-pane approach.

## System 7 — interactions + System 6 audio wiring

All of it lives in `src/interactions/` and `src/audio/wiring.ts`; `main.ts` has
two hooks (`initInteractions({ renderer, scene, camera, player, diner })` once
`diner.build()` has resolved and the player exists, `interactions.update(dt)`
after `diner.update(dt)`). The wiring owns the audio engine
(`interactions.audio`, listener moved in `update`); the loader's "Click to
enter" and the canvas click both call `interactions.startAudio()` (idempotent).
Nothing in `src/scene/*` was changed: the pot, mug, door leaf and colliders are
taken from the `Diner` instance (`diner.coffeePot`, `diner.pourMug`,
`diner.door`, `diner.colliders`); the HemisphereLight is found by traversal.

Shadow-once (see Startup): `DoorInteraction.consumeMoved()` /
`PourInteraction.consumeMoved()` report a changed leaf angle, a moving decanter
or mug, or a seek/reset, and `index.ts` calls `diner.invalidateShadows()` that
frame, so both sun maps follow the door (leaf shadow on the wall and slab, sun
through the opening onto the vestibule floor — verified open vs closed from
fixed cameras) and the decanter. While the leaf or the pot is moving that is
the old per-frame shadow cost again (~110 depth draws); frozen seeks
(`__interact(name, t)`) re-render once. The pour's four programs (clipped
coffee, rippled surface, stream, steam) are issued in both output variants right
after `initInteractions` so they link in the background — the first pour was a
3.7 s synchronous link otherwise (headless `pour-mid` 4.5 s → 1.5 s).

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
while pouring (stream, liquid, live decanter clone, steam), 0 otherwise — plus
both shadow passes on frames where the leaf or the decanter moved. The hint is
shown in the `sys7-*` frames and hidden by the harness for every scene pose.

## System 8 — post-processing & atmosphere (`src/post/`)

Everything is procedural, scene-linear until the finish pass, and expressed
relative to the sun light where it can be (`sun.color × sun.intensity`), so
System 4 re-lighting scales dust and haze for free. Hook: one call in
`main.ts` after `await diner.build()` resolves
(`createPostPipeline(renderer, scene, camera, { sun: diner.sun })` →
`post.render()` in the loop); `?post=0` makes `render()` a plain
`renderer.render`, nothing allocated.

### Integration with the two-sun split and shadow-once (merge with System 3 rev 2 + loader)

- **Which sun.** The dust and haze light themselves from the *building* sun's
  shadow map, and since rev 2 that is `Diner.sun`, a **SpotLight** (perspective
  camera, 4096², near 130 / far 172 m, ≈ 3.5 mm texels — the map that draws the
  slat stripes). `Diner.sunLot` is a shadow-casting DirectionalLight too, but its
  ortho map never contains the room (the caster-only cone blacks the building out
  of it), so `main.ts` passes `diner.sun` explicitly; `findSun()` is only the
  fallback (spot first, then directional) and would otherwise have picked the lot
  light. `beams.ts` accepts either type (`SunLight`).
- **Perspective map.** `sunVisible()` already did `sc.xyz /= sc.w` — exactly
  what three's `getShadow` does for a spot (for an ortho map `w = 1`), and the
  compared depth is the shadow camera's non-linear NDC depth in both cases, the
  same quantity the map stores; `sun.shadow.matrix` is bias × proj × view for
  both light types. No shader change was needed for the fetch.
- **Converging rays.** A spot 150 m out has rays that differ from the mean
  `sunDirection()` by ±2.3° across the room — a 12 cm shift of a prism edge over
  a 3 m beam. The analytic aperture test now uses the ray through the point being
  tested (`SunRays { dir, apex }`, GLSL `sunRay(p)`, uniform `uSunApex` w = 1 for
  a spot / 0 for a directional): mote spawn positions (`sampleBeamPoints`), the
  haze march bounds (`beamBounds`) and `inBeam()` all follow the same ray the
  shadow camera used, so the prism edge and the frame shadow coincide. The mean
  direction still feeds the phase functions (±2.3° is nothing to HG) and equals
  `Lighting.sunDirection()`.
- **Shadow-once.** The maps render once inside the first probe face (before the
  pipeline exists) and again only after `diner.invalidateShadows()`. The dust and
  haze bind `sun.shadow.map.depthTexture` every frame; it is the same texture
  object after the one-shot render (checked in-page: `dust.uShadowMap ===
  sun.shadow.map.depthTexture`, `autoUpdate false`, `needsUpdate false`), never a
  cleared target. `post.render()` goes through `renderer.render(scene, camera)`
  for the scene pass, so the `installShadowMasks` wrapper runs inside it — both
  maps re-render when `needsUpdate` is set, before the opaque pass and therefore
  before the haze/composite passes read the map; three restores `sceneRT` as the
  target after the shadow pass. The door swinging (System 7) therefore only has
  to call `invalidateShadows()`; the dust in the door beam follows on the same
  frame.
- **Staged build / loader.** The pipeline is created after `build()` (lights and
  the named `coffeePot` exist, the dust samples its spawn volume from the live
  light), the first two frames render through it, and only then does `__ready`
  settle / the overlay fade. MSAA target size follows
  `renderer.getDrawingBufferSize()` (pixel ratio ≤ 1.5, `setSize` on resize) and
  is re-allocated lazily on the first frame after a change.
- **Steam duplication (clean-up owed).** System 7 (now in `main`) carries its own
  `src/interactions/Steam.ts` for the pour; `src/post/Steam.ts` exports the
  `SteamEmitter` used for the decanter (and written for the pour — see `steam`
  below). Both compile and run side by side (the pour's steam at the mug, the
  ambient wisp at the decanter); they were deliberately not unified in this merge.
  Pick one emitter in a System 7/8 polish pass.
- **Interactions × post.** `interactions.update(dt)` runs before `post.render()`
  in the loop: a swinging door leaf or a lifted decanter calls
  `diner.invalidateShadows()`, and the scene pass inside `post.render()` is what
  re-renders both maps (the dust in the door beam follows on the same frame).
  `main.ts` issues the compile batch for the pour's materials *after* the post
  pipeline is created, so the dust and steam programs link in the same background
  batch (canvas + render-target variants) instead of on the first frame.

### Pipeline order (1920 × 1080, all HalfFloat, no per-frame allocations)

| # | pass | target | what | GPU ms (4060) |
|---|---|---|---|---|
| 1 | scene | `sceneRT` MSAA 4× + resolved Float depth | the diner, plus dust `Points` and steam billboards (depth-tested, MSAA-resolved with the scene) | MSAA 4× adds ≈ 0.6–1.3 over no-AA (scene itself ≈ 6–11) |
| 2 | haze | `hazeRT` ½ res | 24-step march through the union AABB of the beam prisms; per step `inBeam × sunVisibleSoft` (3-tap PCF, slat-pitch averaged) × HG phase; sun radiance × strength per metre | 0.95 |
| 3 | composite | `compRT` full | scene fetch with the exterior heat-shimmer offset + depth-aware haze upsample | 0.08–0.12 |
| 4 | bloom | ½ → ¼ res | soft-knee luminance threshold, 9-tap separable blur at ½, box-down, blur at ¼ | 0.08–0.15 |
| 5 | finish | screen (or `ldrA`) | CA + corner softness → bloom add → vignette → tone map → sRGB → grain | 0.13 |
| 6 | smaa | screen | only with `aa=smaa` / `msaa4+smaa`: SMAA 1× on the display-encoded frame, then grain as its own pass | 0.31–0.34 |

Post total (2–6, MSAA excluded) **≈ 1.25–1.4 ms**; with MSAA 4× ≈ 2.6 ms —
inside the 3.5 ms budget. Measured with `EXT_disjoint_timer_query_webgl2`
(`window.__post.timings()`, EMA over 300 frames; `node tools/post-bench.mjs
--configs="…" --poses=…`). The exterior is the hottest region and bloom prefilter
cost scales with how much of it is in frame (`window` pose is the worst).

### Anti-aliasing decision: **MSAA 4× on the scene target**

| mode | scene Δ vs none (length / window) | post Δ | slat / cord / T-mould edges |
|---|---|---|---|
| none | — | — | staircases on every cabinet edge, cords shimmer sub-pixel |
| **msaa4** | **+1.2–1.5 / +0.5–1.6 ms** | 0 | clean geometric edges, cords resolve to grey lines, stripe-shadow edges unaffected (those are shadow-map edges — System 4's PCF radius owns them) |
| msaa8 | +3.0–3.3 / +1.8 ms | 0 | marginal gain over 4× at the 22 mm slat pitch, over budget |
| smaa | 0 | +0.34 ms | edges softened but residual stairs on the high-contrast cabinet/frame edges; cannot recover 1-px cords (it only sees the resolved frame) |
| msaa4+smaa | as msaa4 | +0.34 ms | the smoothest still; kept as an option for the paused-frame capture |

TAA was not built: the target is a paused frame shot by a static harness, the
camera is user-driven (no motion vectors for the hinged door/fan), and MSAA 4×
already meets the ≤ 2 ms bar with geometric — not temporal — edge quality.
`?aa=none|msaa4|msaa8|smaa|msaa4+smaa` switches at runtime (targets rebuilt
lazily, once).

### Knobs (all live: `window.__post.settings.<group>.<knob>`; URL `?<group>.<knob>=v`, `?<group>=0`)

`dust` (Dust.ts — `THREE.Points`, additive, motion + lighting in the vertex shader)
- `count` **5000** motes (REFERENCE §5: 2–6 k in the lit volume). Positions are sampled *inside the beam prisms* (`beams.ts`: each window/door aperture swept along the sun direction until it hits the floor / back wall), so nothing is spawned outside a beam. `respawn()` after changing it.
- `intensity` **0.4** — mote radiance / sun radiance when viewed 25° off the sun axis.
- `sizeMin` / `sizeMax` **1.0 / 2.8** px at DPR 1 (a 30 µm mote is the lens PSF, 1–3 px); `bokeh` **3.0** extra px growth for motes inside 0.8 m.
- `drift` **0.06** m amplitude, `driftPeriod` **14** s (Brownian sum-of-sines), `rise` **0.012** m/s convective rise (wrapped inside the prism height).
- `g` **0.55** Henyey-Greenstein of the visible lobe, normalised to 1 at 25° off-axis: 90° ≈ 0.12×, 135° ≈ 0.05× — vivid looking toward a window, gone with the sun behind (REFERENCE §5).
- `twinkle` **0.55** depth of the per-mote flake-rotation modulation; `brightFraction` **0.18** share of the sparkly 30–50 µm class (top of the size range, 1.0× vs 0.45× brightness).
- Lighting: every mote does one hardware-PCF fetch of the sun's shadow map (`sampler2DShadow`, `sun.shadow.matrix/bias`), so motes in the slat shadow bands and behind booth backs vanish. `debug.view=5` skips the shadow test, `6` lights every mote (spawn-volume check).

`haze` (single-scatter march, shaders.ts `hazeFragment`)
- `strength` **0.012** in-scatter per metre of lit beam as a fraction of sun radiance (REFERENCE §5 says ≤ 0.02 for an 8 AM diner without smoke); `g` **0.55** (same normalisation as dust); `steps` **24** (4–64); `halfRes` **true**.
- `debug.view=2` shows the haze buffer, `3` the beam/aperture test.

`shimmer` (composite pass; touches only pixels whose reconstructed world position is *beyond the front wall plane* and deeper than `minDepth`)
- `amplitude` **1.2** px at 1080p (1–3 px is what a 30 °C asphalt gradient gives at 10–30 m), `frequency` **11** cycles across the width, `speed` **0.9** Hz turbulence, `scroll` **0.45** screen heights/s upward, `minDepth` **8** m, `heightFade` **2.2** m above the lot where the near-ground boost has faded (strongest at the asphalt horizon).
- Interior pixels are never displaced: the mask is world-space (`z > wall face` ∧ depth, or "on a glass pane inside an aperture rectangle", since the glass writes depth and the exterior distance is then taken from the view ray's hit on the lot surface), and the displaced fetch is only accepted when the *source* pixel is also glass/exterior — a slat or frame never smears into the lot. `debug.view=1` shows the mask.

`steam` (Steam.ts — `SteamEmitter`, one instanced draw, premultiplied alpha, evolving 2-octave noise alpha, spiral curl, spread)
- Ambient decanter emitter: `strength` **0.8**, `count` **28**, `rise` **0.4** m, `life` **3.6** s, `offset` **[0, 0.02, 0.05]** m from the decanter mouth (5 cm toward the front of the machine so the wisp clears the brew basket).
- System 7 pour: `new SteamEmitter({ count: 20, radius: 0.03, rise: 0.3, life: 2.8, strength: 1.2 })`, `scene.add(e.object)`, position the object at the mug rim, `e.update(t)` per frame, `e.strength = 0` to fade. All `SteamParams` are public and re-read every update; `color`/`intensity` are scene-linear scattered light for System 4 to set to the fill the counter actually receives.

`bloom`
- `threshold` **2.2** scene-linear luminance (only the hot exterior and specular pings; the placeholder interior peaks ≈ 1), `knee` **0.6**, `strength` **0.045**, `radius` **1.0**. No halos: 9-tap Gaussian at ½ then ¼ res, added before tone mapping.

`finish`
- `tonemap` **null → follows `renderer.toneMapping`** (ACES today); `?tonemap=aces|agx|neutral|none`. ACES: filmic contrast, pushes clipped reds toward orange; AgX: gentler shoulder, keeps hue in the hot exterior — the better choice once System 4 sets real exposure. `exposure` **null → `renderer.toneMappingExposure`**; `?exposure=` overrides.
- `vignetteEV` **0.3** stops at the corner, `vignettePower` **2.4** (cos⁴-like, no hard ring).
- `ca` **0.5** px lateral chromatic aberration at the corner (∝ r², red out / blue in).
- `cornerSoft` **0.7** px blur radius from `cornerSoftStart` **0.55** of the normalised radius to the corner.
- `grain` **0.015** at mid grey (fraction of display code value), strongest in the low-mids, → 0 in the highlights and shadows; `grainChroma` **0.3**; `grainSize` **1.0** px. Per-frame integer hash (PCG) — no texture, no repeat.
- `highlightDesat` **0.0** (0.3–0.5 is a fix for ACES orange skies; off until System 4).

`aa` **"msaa4"** — see above. `debug.view` **0**.

### Verification (rev 1, `shots/sys8-*.png` vs `shots/sys8-*-off.png`; re-shot after the merge with the spot sun + shadow-once)
- `?post=0` frames vs the committed `shots/sys3-*.png` from main (per-frame → once shadows, spot sun): `stripes` identical (0 px), `window` 628 px at ≤ 1 LSB, `door-glass` 2 px at 1 LSB, `length` differs only in the ceiling-fan cells (6.2 k px, blades spinning). The pipeline's bypass path is the plain renderer.
- Motes, counted as pixels changed vs a `dust=0` frame with grain/shimmer/steam/bloom/haze off (same page, same pose): `beam` 425 with the shadow-map test / 1252 with it skipped (`debug.view=5`) / 1381 with every mote lit (`6`); `beam-low` 96 / 290 / 331. The map removes ~⅔ of the in-prism motes (45° half-open slats ≈ ½ duty, plus frames and booth backs); the analytic prism itself culls ~10 % more (penumbra + drift at the edges). Frame-to-frame changes in the default state (862 / 210 px) are ≈ 2 × the mote count — each drifting mote leaves and arrives, nothing else moves.
- Motes: only inside the beam prisms, gone in the slat shadow bands and behind booth backs (checked with `debug.view=5/6` against the default); brightest looking toward the windows (`beam`, `beam-low` bench poses), nearly invisible looking away (`stripes`).
- Shimmer, mapped as pixels changed by toggling `shimmer.enabled` in-page (everything else off): `door-glass` 3.5 k px, all inside the pane in the horizon / wall / pole / sedan-roof band (px 480–1440 × 120–480); frame, push bar and the near asphalt (< `minDepth`) untouched. `window` 13.8 k px in the lot/horizon band between the slats (rows 420–780); sky, slats and sill untouched.
- Haze `debug.view=2` at `beam-low`: prisms with booth-back shadows, the sill/frame shadow band and the fine slat modulation, read from the spot's perspective map.
- Haze: beam prisms read in the `debug.view=2` buffer with booth-back shadows and soft stripe averaging (the 3-tap slat-pitch average removed the moiré a 24-step march produced against 22 mm stripes); at 0.012 it is a hint, as intended.
- Shimmer: only the exterior through the door/window glass wobbles (car edge, pole, lot lines in `door-glass`); frame, slats and interior identical to the off frame.
- Steam: a faint grey wisp above the decanter in `warmer` / `macro-warmer`.
- Finish: fine grain visible in corner crops, ~0.3 EV corner fall-off, no CA fringes at 0.5 px, no bloom halos on the window frames, no banding (HalfFloat chain, grain dithers the 8-bit output).

### Lessons
- **A backtick inside a GLSL comment inside a TS template literal ends the string** — `tsc` reports "',' expected" in the shader file. Keep GLSL comments backtick-free.
- **`+` in a query string decodes to a space** — `?aa=msaa4+smaa` arrives as `"msaa4 smaa"`; the parser normalises whitespace back to `+`.
- **Phase-function normalisation matters more than g.** Normalising HG to its exact-forward peak made motes 3 % bright at 45° off-sun (the closest the slats ever let you look) — invisible. Normalise at the nearest viewable angle (25°) and let the far side fall off.
- **Sparse ray marches alias against slat stripes.** 24 steps over a 22 mm-pitch shadow pattern → moiré. Average the shadow over one pitch per step instead of adding steps.
- **Scene cost is the elephant.** The scene pass is 6–11 ms at 1080p before any post; MSAA and the whole post chain together add ≈ 2.6 ms. System 4/5 should look at the shadow-map pass and draw-call count before worrying about post. (Post-merge bench: post total 1.35–1.41 ms at `beam` / `length` / `window` — haze 1.00, composite 0.10, bloom 0.15–0.17, finish 0.13–0.14 — unchanged; the scene numbers that run (7.3 / 12.5–13.4 / 25 ms) were taken while other worktrees were shooting on the same GPU and are not a measurement.)
- **A scene can have more than one shadow-casting "sun".** `findSun()` looked for the first shadow-casting DirectionalLight; after the two-sun split that is the *lot* light, whose map never sees the room — every mote would have read "lit" (or "shadowed" by the cone). Take the light from `Diner` rather than searching the graph, and keep the search as a typed fallback only.

## System status

| # | System | Status |
|---|---|---|
| 1 | Interior geometry and floor plan | **done** (rev 4 close-out: empty L-return, footrail at 200 mm on cast brackets, bell pedestals, head bulkhead + 25 mm wall angle, 60 × 40 caps, 100 mm saddle + stepped exterior slab) |
| 2 | Booth and counter detail | **PASSED at rev 7 (`9adefff`)**; System 3 rev 1 polish: 3 condiment sets on 9 stools (centred between stool pairs), boomerangs in two classes (32–38 mm + 15–20 mm) with a few outline-only shapes, channels pillowed 4 mm outward with the 1–2 mm valley at the welt, stool seats with a 17 mm crown + 10 mm roll over the band, near-white granular sugar. Rev 7 was: flicker audit + fixes (see Lessons); stools built per stool into the merged buckets (no instancing): ±6 mm column height, any yaw with the welt junction + boxing seam travelling with it, ±5 % squash, 250 × 200 mm sit-hollow 6–9 mm deep in its own shade, one 2.5° worn swivel, three chrome wear grades (roughness 0.07/0.12/0.17), four bolt caps per base; glass `transmission 1`/roughness 0/thin, granular sugar top tilted 7° at 75 %, grey-blue granular salt standing in front of the pepper; black SplashGard funnel (Ø 178 × 100, paddle handle) in the rails, stainless fill lid so one black warmer disc tops the hood, 7 mugs staggered ±15 mm on the mat; napkin tip with folded leaf + crease, domed cast pedestal with collar, pass-through surround in wall-trim paint. Rev 6 was: A1 veneer at true scale (lines 1.5–2.5 mm, one decaying cathedral per 0.5 m, ≤ 9 % contrast, per-panel UV jitter + flips; oak caps / walnut panels + die / maple cabinets + fan blades kept); A2 cords proud of the channels (centre +1 mm over the crowns, 6 mm, baked line shadows, 6 puckers in the last 30 mm at both tucks), 6 mm piped head-roll seam, seat welt + boxing seam + dark top-stitch line at the nose, 6 mm welt torus round every stool seat over a 1" band; vinyl roughness ≈ 0.32–0.5, grain normal 1.25, clearcoat 0.1. B1 boomerangs as straight-armed 100–130° elbows with rounded tapered tips, 28–52 mm, ~3.5 / 100 cm², three tones, on a 2048 px / 1.2 m tile (no repeat on a table). B2 one fluted jar (14 cos² ribs, 2.5 mm) in `glassFluted` (10 mm refraction thickness) with the sugar at 97 % of the bore to 65 %, full-diameter 12 mm lid with 1" side-hinged flap; S&P 1.5 mm glass walls, fills at 97 % of the bore to 60 %, opaque `salt`. B3 hood in light `stainlessCool` (albedo 0.6, roughness 0.3, anisotropic, room probe) with black control band + black 150 mm warmer discs top and base, stainless base plate over a black base, 25 × 14 mm lit rocker switches with pivot line. B4 mug 7–8 mm walls / 13 mm floor / 6.5 mm rim, dark `bisque` foot ring, stubby handle; 8 spares inverted on a ribbed rubber bar mat, 2 upright, saucers only at the two stools. B5 stools: seat parts pivot on the column top with ±1.2° tilt, ±10 mm height, ±5 % cushion squash, ±10 mm pitch with two nudged 22–30 mm. C: 2" fluted T-mould with 4 grooves on the counter, 28 mm push bar on cast rose/post/saddle standoffs, 4.5" × ½" five-rib saddle threshold, 5 mm dark-steel spider plate with 4 screws on a dark-sealed underside, ½" troffer recess in a 1" frame, shaped cast fan irons with bosses, 1.8 mm rolled dispenser lid edge. Rev 5 was: mugs are `MeshPhysicalMaterial` ivory china (opaque, roughness 0.15, clearcoat 0.6, env 0.45; runtime probe confirmed transmission/transparent were never set — the rev 4 "frosted" read was a shaded white body mirroring the counter); Skylark laminate as sparse (~30 %) round-capped stroked chevrons, three tones pulled toward cream, non-touching; Tablecraft-221 dispenser in smooth `stainlessBrushed` (roughness 0.2, anisotropy 0.4 — at 1.0 the sun lobe whited the face) with 70 × 22 slots on both long faces, napkin fans, flange lid, rubber feet; BUNN tower in matte `blackPowder` with brushed stainless side panels and a Ø 190 × 110 stainless funnel with forward handle; channel depth 20 mm with 6 mm cords riding 2 mm under the crowns, vinyl #A8141C roughness ≈ 0.3–0.4, 0.4 mm grain, clearcoat 0.15; veneer ridge pitch 1–4 mm with ~300 mm cathedral figure at ≤ 12 % contrast (caps satin 0.3, laminates 0.5); shaker fill fitted to the glass, half-moon side-hinged sugar flap, 13 mm troffer reveal. Rev 4 was: prop-side reflection probe (no checker in glassware), opaque #2A1408 coffee at 55 % with fill line/meniscus/tide line, 12 mm D-handle facing the aisle, 100 mm-deep funnel; opaque ivory mugs (roughness 0.14, env 0.2) inverted on 140 mm saucers on the drip tray + 3 loose uprights + `pourMug`; Skylark boomerangs as bent chevrons (62/72 mm, 12–15 mm, tan/grey-blue/white, ~40 %); three grain sources via `woodVeneer` (oak caps, walnut panels/die, maple cabinets); seat boxing seam 25 mm below the crown, brighter valley cords, ±3–4 mm puckers; stools ±8 mm height/±10 mm pitch/±25 mm off-line, concave rim band mirrors the checker; Tablecraft-221 dispenser with 52 × 42 arch, napkin tip, lid seam; bright 4" saddle; kitchen box with its own emissive ambient. Rev 3 was: — 5 mm welt cords proud in every channel valley + 7 mm roll-seam and boxing-seam welts, puckers at both tucks, broad sheen (roughness map 0.35–0.55, clearcoat 0.25); 512 px interior-capture PMREM; irregular vertical veneer grain on end panels/counter die/cabinets (contrast 0.10), horizontal cap grain; T-mould with 3 real 2 mm grooves + returned lip, 38 mm tops with sparse two-tone boomerang; counter sheet seams every 3.6 m; steep-rimmed bell stool bases that mirror the floor, per-stool rim seam, ±12 mm height/±25 mm offset; footrail elbow + return flange; 300 mm brushed spider plate; BUNN VPR brewer with one lower + one upper warmer, deep SplashGard funnel, brushed body; 173 × 178 decanter with opaque 55 % coffee, fill line, tide line, black collar/handle, stainless base ring; closed 98 × 117 × 184 dispenser with recessed faceplates and one napkin tip; 12-flute sugar pourer at 65 %; glass shakers with visible fill; glossy waisted mugs (roughness 0.1); 6 mm prism troffer lens; 14 mm fan blades; alu threshold plate |
| 3 | Windows, blinds, exterior view | **built, rev 5 (branch `sys3-rev4`; frames `shots/sys3-{window,door-glass,blind-macro,lot-wide,stripes,dbg-sedan-front34,dbg-sedan-rear34,dbg-pickup-side,dbg-pickup-front34,dbg-pickup-rear34,dbg-wheel,dbg-wheelstop,dbg-wall-road}.png`)**. Rev 5 (critic on rev 4: narrow fail — glass interiors, mirrors, wheel stops, horizon layering, raised blind and slat sag verified; four vehicle blockers left): **1** sedan fender flattened — `stationRing` now keeps every flank point on ONE x(y) profile anchored at the nominal sill and the belt (rev 4 re-placed the bulge point at 45 % of the *remaining* height over each arch, so the flank re-shaped itself around every wheel cut-out = the "blister" with a crease to the A-pillar), constant 2 cm rolled lip on the arch edge, and `normalAt` takes the belt column's length tangent for the flank points (their own columns climb the arch curve and tilted the normals fore/aft) — specular-stretched `dbg-sedan-front34` shows one continuous highlight band along the fender shoulder; **2** pickup tailgate: the bed pocket runs to the gate's inner face and a separate gate slab sits between the bedsides (two 6 mm dark vertical gaps, bottom hinge line, recessed centre handle with chrome pull, top 15 mm under the bedside caps), vertical tail-lamp units on the bedside rear corners, plate moved down to the step bumper, tail taper 6 mm, cab back drops straight to the bed-rail height; **3** shut lines: 7 mm × 8 mm groove in unlit black (`MeshBasicMaterial 0x000000` — a light trap, nothing to shade) with 6 mm paint chamfers either side (`Groove.bevel`: the two chamfers face opposite ways along z so one catches light and one shadows — the highlight/dark pair a real cut line shows), hood↔fender / deck↔quarter strips 9 mm; measured at native in `tmp/seam.mjs` (per-row min vs panel ±6–14 px): sedan doors 52 / 52 sRGB (`dbg-sedan-front34`), 79 / 74 (`dbg-sedan-rear34`), pickup door 187–220, pickup hood/fender line 53–55 (was 28 at 6 mm); **4** pickup wipers parked along the cowl at 5° rake for the steep glass (rev 4 used the sedan's deep-cowl stand-offs, which floated the arms up the pane), pivots visible, arm 6 mm / blade 10 mm. Polish: **5** curved dark wheel-well tub (superellipse following the arch 1.5 cm inside the lip, down to the sill) and a domed chrome centre cap with a 18 mm emblem on the sedan covers (the flat dark medallion read as a hole); **6** sedan bumper ends return around the corner in chrome with amber signals in the valance below; **7** pickup axle-to-cowl 22 % (wheelbase 3.0, front axle 0.86, cowl 1.52), drip rail 10 × 10 mm at 3 mm proud (the 16 mm bead read as a roof lid), roof stations tightened at the tail; **8** blinds: three ladders at ±0.55 / 0 (no duplicate end verticals), both pull cords run the full drop from the headrail end into a turned acorn (neck + flared body), the creased slat is forced to the −x end in the bottom 4–20 hanging slats where `window` sees it (22–34° twist, tip 20–28 mm up — legible fold at native 1720, 370 in `sys3-window`); **9** scrub: six leggy trunkless creosote variants near, one broken-canopy mesquite only beyond 45 m; ruts feathered by vertex alpha with independent wander and width wobble; graded shoulder with a wandering outer edge; range feet vary with `footNoise`; **10** wheel stops: `precast` aggregate texture (speckle + rust runs), true 45° chamfers (flat extrusion, chamfered profile), two 40 % rubber scuff bands on the lot face. Boot 13.1–15.4 s ready in the harness (other agents on the GPU); draw calls at boot 166, `lot-wide` 238, `door-glass` 140 (rev 4: 167 / 237 / 139), triangles 1.28 M. Rev 4 (two critics passed everything but the vehicles and wheel stops): **1** panel shut lines as real grooves in the loft (6 mm wide × 8 mm deep dark walls/floors in their own geometry, door cuts on both cars, trunk-lid leading edge, 6 cm cab–bed gap; hood↔fender and deck↔quarter cut strips 2.5 mm proud), one pull per door (pickup 1, sedan 2 per side) just ahead of each rear shut line; **2** glass cut out of the body loft and rendered as a blended dielectric pane (`makePaneGlass`: Schlick Fresnel α = 0.38 + 0.62·F, premultiplied custom blend, still in the opaque list for the transmission pass, inner faces 12 % reflection) over a cabin lining (the loft flipped inside out), padded dash + binnacle, tilted steering wheel with three spokes and column, seat backs / cushions / headrests on posts (sedan), bench (pickup), rear shelf; A-pillar and C-pillar edges raked by quad splitting; windshield shows wheel + dash silhouettes in `dbg-sedan-front34`; **3** wipers as pivot post + nut + arm + hinge + blade + rubber, parked along the cowl channel 60 mm below the glass base at 12° rake, lower part behind the hood's trailing edge; **4** wheels: lathed tyre (sidewall bulge, 8 tread grooves, bead, sidewall/tread tones in the vertex colour), painted steel rim with lip + 5 lug nuts + centre cap (pickup) or full chrome cover with dish rings + black medallion (sedan), radial brake-dust vertex colour, dark drum behind; tyres fill the arches (superellipse p = 2.6 flattened arch on the sedan, p = 4 rounded-rectangle on the pickup); **5** pickup re-proportioned: front axle 0.72 m behind the nose (WB 3.0), windshield base 0.64 m behind the axle (21 % WB; measured in `dbg-pickup-side` at native resolution: axle x = 404, A-pillar base 637, rear axle 1264 → 233 / 860 px = 27 % axle-to-cowl (rev 3: 41 %), body nose 160 → 28 % front overhang, bumper 112 → 34 % (rev 3: 42 %)), door cut at 1.42, full-width chrome-framed fascia with twin round sealed beams per side (concave chrome bowls, fluted domes) flanking an egg-crate grille; **6** both door mirrors 150 × 100 × 70 mm painted heads on chrome arms; **7** wheel stops: 1.83 × 0.20 × 0.14 m (72" × 8" × 5.5") precast bars with 6 mm chamfers, two dark rebar pin holes 0.46 m in from each end, centred in the stall (0.44 m clear each side), ±3° skew; noses parked 0.37 m (pickup) / 0.48 m (sedan) past the bar face, tyres 8–10 cm short of it. Polish: **8** blinds — one 6–10 mm sagging slat and one creased slat (outer 15–25 cm twisted 14–25°, tip drooping 8–15 mm) per blind at seeded heights 66–94 % down the drop (the band a seated or standing eye actually sees — measured in `window`: sag slat 9–12 px between ladders ≈ 6–8 mm at 1.5 px/mm, kink tip 12 px down with the twist reading edge-on; every other slat within 3 px end to end), the last blind in the row pulled up 15–30 cm, closed 27 × 19 mm bottom rail with end caps and two cord buttons, cream acorn tassel (17 × 50 mm) on a 2 mm cord pair; **9** horizon as three ridged-noise range layers with a clear tonal step fading with distance, scrub edge broken by a noise-graded shoulder with a parallel pair of tyre-track ruts running from the road to the wall gap (visible through the gap in `dbg-wall-road`; rev 3's ruts were wound face-down and back-face culled — see Lessons), six distinct creosote / mesquite silhouettes merged into one mesh; **10** headlamps with reflector depth and lens fluting, bumper guards in mirrored pairs flanking both plates. Also fixed in the final pass: the loft's belt ring sat *above* the hood/deck top ring wherever the panel is lower than the belt line, folding the skin outward so its underside showed as a 4–9 cm black lip along the far hood edge on both cars (`dbg-pickup-front34`, `dbg-sedan-front34`); the belt ring is now clamped 3 cm under the top ring (see Lessons). Sedan kept as the 1977–90 box Caprice (see Lessons). Boot 12.6–13.0 s in the harness with parallel agents on the GPU (main `f642bac` shot beside it measured 37.6 s under the same contention, so the number is load, not the branch); draw calls at boot 167 (main 173), `lot-wide` 237 (main 237), `door-glass` 139 (main 133: +6 = the two blended car-glass/lamp-glass meshes and the extra dark/chrome/wheel buckets); triangles 1.28 M (main 1.24 M). Rev 3 (critic items A–F): **A** vehicles rebuilt as lofted bodies through 24-point cross-sections (`Station`/`loftBody` in `Exterior.ts`: 20 mm sill radius, side bulge to the belt, tumblehome to a 70–90 mm roof radius, plan taper at the ends, analytic normals with one-sided tangents at the hood/roof creases) with the wheel arches cut into the lower edge so four lathed tyres (rounded shoulders, sidewall bulge, 0.19 m bead) show under the fenders; ride height 0.31 m sill / 0.35 m tyre (sedan), 0.42 / 0.38 (pickup); chrome bumpers 0.45–0.58 m with rubber guards over a painted valance; sealed beams (2 × round 5¾" per side on the pickup, 2 × rectangular on the sedan) as glassy `MeshPhysicalMaterial` lenses in chrome bezels; amber signals; egg-crate grille texture (`grilleTexture`); plates front + rear (`plateTexture`); door mirrors on chrome arms, wipers on the glass, chrome pulls, rubber + chrome side moulding, drip rails, shut-line slivers, wheel-well liners and underbody mass; glass metalness 0 (rev 2's 0.55 tinted the sky reflection black — see Lessons), dust-film paint (`carDust` map + roughness). **B** route holes 12 × 6 mm ovals (annulus-triangulated patches in the slat mesh) — 5 px at booth distance, showing whatever is behind (`crop-route-hole`). **C** slats are real per-blind geometry (`appendSlat`): tilt 25 ± 5° per blind, drop 0 or 3–8 cm with the spare slats stacked on the bottom rail, 1–3 mm parabolic sag between ladders + free-end droop, 1–3 creased slats per run, ±2.5° per-slat jitter, ±4 % tone via vertex colours; ladders front + rear with rungs; 25 × 38 mm pale headrail; moulded plastic tassel in slat colour (the `lot-wide` "dark 15 cm band" is the window's transom bar behind the slats, not the headrail — see Lessons). **D** Ø 0.6 m poured piers 0.75 m high with chamfer, grout collar, steel base plate, four anchor bolts + nuts and a pole flange; 150 mm kerb + 0.7 m gravel strip along the CMU base; 90 mm precast cap with 25 mm overhang; two-lane frontage road 16 m behind the wall (shoulders, edge lines, faded centre line) with creosoted utility poles / crossarms / insulators every 38 m and 1 px catenary wires; 110 instanced 1–2 m creosote bushes (stem fan + olive foliage clumps). **E** verified, no leak: with the spot off (`sunLot` only) the room has no sun patches at all; the "unstriped" wall patches in `length`/`counter` are the last window's blinded throw on the end wall — striped at 2–3 px pitch (oblique compression + penumbra), invisible at frame scale; the seat patch in `stripes` is shadowed vinyl mirroring the bright window. **F** door smudge redrawn as a palm-heel smear arc + scattered fingertip dabs + diagonal drag streaks (nothing periodic), alpha × (0.3 + 0.7·(1 − N·V)²) so it brightens at grazing angles (`crop-smudge`). Draw calls unchanged (114–271 by pose, worst `length`); triangles 1.30 M. Rev 2: two-light sun split (spot for the building, directional + caster-only cone for the lot — see Lessons) so poles, cars, stops and the CMU wall cast onto the lot; exterior fill ×0.45; A1/A2 measured and documented as critic mis-reads (`crop-wall-under-sill`, `crop-stripes-rectified`); blinds: 1.3 mm ladders front + rear with a rung under every slat, 10 × 6 mm route slots with the lift cord through them, ±2.5° tilt jitter + 3–4 kinked slats, ±4 % tone, enamel crown highlight (smooth 0.3 roughness base + sparse dust streaks to 0.6, metalness 0.1, env 0.7), 1" × ½" bottom rail with end caps, headrail + valance lip, 12 mm tan tilt wand (0.5 m, right jamb), two pull cords + equaliser + turned-wood acorn tassel (left jamb, ending 15 mm over the stool); cars re-bodied (lofted profile with sloped hood/trunk, raked pillars, flared arches, rocker, door shut lines, B/C pillars, drip rails, chrome bumpers/belt line/mirrors, sky-reflecting glass, recessed lamps); 1.8 × 0.15 m trapezoid concrete wheel stops; 3 more branching cracks with 3–4 cm black filler, oil blotch at a stall head, tyre scuffs; CMU tones randomised per block on an 8 × 4 tile; satin stainless push-bar mounts; sky brightened toward the sun azimuth with a haze band at the ridge foot and a fainter second range; scrub in three size classes / three tones with down-sun contact-shadow decals; ceiling/fan/overlays/car trim no longer cast (draw calls 179–338, worst `length`, with the per-frame shadow passes; lower since the shadow maps are rendered once at boot — see Startup). Rev 1 was: venetian blinds on all five windows (none on the door: the reference diners keep the door pane clear for the OPEN sign and the view of who is coming), instanced curved 1" slats at 22 mm pitch / 45°, ±0.5° tilt, ±0.3 mm sag, a kinked slat per window, ±4 % tone, dust streaks on the up-faces, rails, two ladders + lift cords + wand each; slats cast the hard stripe shadows through the existing sun (tight 3.3 mm shadow texels). Window/door glass `MeshPhysicalMaterial` T = 1 with the 12 % loss in the colour, IOR 1.52, 6 mm, green-grey attenuation, room-probe reflection, dust haze heavier at the lower edge/corners, wipe streaks, five handprints at push-bar height (roughness patch + haze decal). Exterior: 150 mm kerb + 1.5 m sidewalk, 12 stalls of re-striped asphalt (drift, tyre polish, sealcoat patches, alligator + long cracks with dusty/sealed fills, oil drips, old + new lines) over a plain surround, kerb stops, 1.2 m CMU wall at the far edge, two 7 m light standards on concrete bases, dusty white pickup (5.3 m, 2.9 m wheelbase, 0.71 m tyres) and maroon sedan (4.9 m, faded clearcoat) with dark glass, chrome bumpers/trim, recessed headlamps with chrome bezels, contact-shadow decals, `lotEnv` probe; desert dirt with 900 instanced scrub patches, fBm mesa/ridge ring fading into the sky, shader sky dome (near-white horizon → pale desaturated blue, sun glare on az 38° / el 35°), linear fog 45–260 m for atmospheric perspective. Draw calls 181–335 (worst: `length`). |
| 4 | Lighting | pending (placeholder sun/hemi/troffers in `Lighting.ts`) |
| 5 | Materials and textures | pending (placeholder palette in `materials.ts`) |
| 6 | Sound design | pending |
| 7 | The 3 interactions (sit, pour coffee, open door) | **built, rev 1** (merged into `main` over the loader + System 3 rev 2: shadow-once invalidation on door/pour, audio on the loader's enter click, pour programs pre-issued) — `src/interactions/*` + `src/audio/wiring.ts` (System 6 wired: gesture start, positional beds, pour/clink/door SFX, exterior crossfade). Frames `shots/sys7-{sit-seated,pour-mid,pour-full,door-open}.png`; 23/23 live Playwright checks; update ≈ 0.01 ms; +6 draw calls only while pouring |
| 8 | Post-processing and final polish | **built, rev 1** (`src/post/`, section above), merged with the loader + System 3 rev 2 (spot sun, shadow-once — see "Integration" above) — MSAA 4× scene target, sun-beam dust (5 k shadow-map-lit motes), half-res volumetric haze through the beam prisms, exterior-only heat shimmer, ambient decanter steam (`SteamEmitter`; System 7's pour has its own `interactions/Steam.ts` — duplication noted above), high-threshold bloom, CA 0.5 px, 0.3 EV vignette, corner softness, ACES/AgX/Neutral tone map, luminance-dependent procedural grain; ~1.3 ms post + ~1.3 ms MSAA at 1080p on the 4060; `?post=0` bypasses everything |

Known simplifications after System 3: no heat shimmer (System 8 post), no
chain fence, the cars have no interiors (dark glass hides it at 10–30 m), the
sky has no clouds, L-return top empty (register is a later prop),
kitchen box holds dim grey silhouettes only, no second (restroom) door on the
far end wall, sun-facing vinyl reads a little washed under the placeholder
light rig (System 4/5 own that balance), the troffer lens prism pattern is a
faint 6 mm cell map + normal map that will only really read once System 4
lights it, cap rails have no separate end-grain material.
