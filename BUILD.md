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
    Lighting.ts           System 4: the physical light rig (see "System 4" below). `K` scene scale,
                          `CAMERA`/`EV100`/`EXPOSURE`, `configureRenderer()` (AgX, exposure, sRGB,
                          BasicShadowMap + `installPcss`), `sunDirection()` (az 38° / el 35°),
                          `buildLighting()` (spot sun with PCSS + detached `sunBeam` twin for post,
                          directional lot sun, troffer / window / floor-bounce RectAreaLights, sky
                          dome scaled to nits), `installShadowMasks` (per-light caster lists,
                          shadow-once), `buildContactShadows()` (multiply decals)
    Openables.ts          System 9: under-counter cabinet bay (carcass, shelf, saucers, filters, spray
                          bottle; two overlay laminate leaves on hinge Groups with chrome pulls) and the
                          kitchen swing-door leaf + dim vestibule (Shell.ts keeps the casings only)
    Presence.ts           System 9 implied presence: apron on a hook, cardigan over a stool, half-finished
                          plate + folded newspaper (booth 2), lipstick cup — lofts + lathes on the
                          `presenceAtlas` material, statics merged into existing buckets
    Sys9.ts               buildSystem9(): the two above → one statics builder → core/mergeInto.ts
  player/FirstPerson.ts   pointer-lock look, WASD at 1.4 m/s (Shift 2.6), Space hop, eye 1.62 m, AABB sliding collision
  core/
    mergeInto.ts          mergeIntoHosts(): append a MergedBuilder's buckets to existing same-material
                          meshes (no new draw calls); unmatched materials become their own meshes
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
    presence.ts           System 9 atlas: cotton canvas, knit, newsprint, toast/yolk, lipstick strip
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
- **CanvasTexture v runs bottom-up: canvas row 0 is v = 1.** Anything authored at
  a height (a scuff band at 0.95–1.12 m, the 24 mm tee face at v 0–0.024, the
  floor's plan-space wear) must be drawn at row `(1 - v) * size`. The first
  System 5 build had the wall scuffs at 1.4 m, the tee chips in a strip the
  face never samples, and the floor's aisle wear mirrored behind the counter.
  Rule now: every generator that places features by v says so in a comment,
  and gets shot at 1 m before anything else is judged.
- **Transparent decals behind transmissive glass do not render.** The
  transmission buffer holds opaque objects only, so a `transparent: true`
  quad on the far side of `transmission: 1` glass is invisible from this side.
  Door vinyl is therefore applied to the INSIDE face (reversed where it should
  read from outside) — which is also where a diner actually puts it.
- **Per-pixel distance fields are the generator cost.** `checkerFloor` at 2 M
  px × ~50 polyline distances was 10 s serial (15 s critical path under 8
  workers). Evaluate slow, smooth fields (fbm, lane/wall distances) on a 4 px
  grid and bilinearly sample; the 23 mm cell is far below any 0.3 m feather.
  Profile with `?workers=1` (serial → honest per-job ms via `__perf().textures.jobs`);
  8-worker wall times are inflated 3–4× by contention and mislead.
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
- **Decade decision (sedan).** The brief named a 1991–96 Caprice; the model is
  the 1977–90 *box* Caprice (upright greenhouse, flat hood/deck, quad
  rectangular sealed beams, egg-crate grille, chrome bumpers with guards). Kept
  on purpose: the box body suits the diner's period and the front graphic already
  reads; the 91–96 "whale" body would need a whole new loft and its rounded glass
  is a worse fit for the blend-pane approach.

## System 4 — lighting (`src/scene/Lighting.ts`, probes in `Diner.ts`, additive material tweaks in `materials.ts`)

Goal: a paused frame that exposes like a photograph — ISO 100, f/5.6, 1/160 s — of a
room lit by a 90-klux sun through venetian blinds, with the fluorescents on and losing.
Every light is in physical units (lux / nits / lumens / kelvin) times one scale `K`, and
the exposure is derived from the camera, not tuned to taste. Numbers, measurements and
the trial history are in `docs/REFERENCE.md §8`; this section is the how.

### Units and exposure

- `K = 1e-4`: 1 scene unit = 10,000 nits (or lux). `nits(n)` converts. Half-float
  targets (System 8's chain is HalfFloat) hold the 90-klux sun (9.0) and the sun disc
  in the sky dome (≈ 30) with room to spare; k = 0.01 (REFERENCE §7's suggestion)
  overflowed on the chrome's sun lobe.
- `CAMERA = { iso 100, f/5.6, 1/160 }` → `EV100 = 12.29` → `L_SAT_NITS = 1.2 · 2^EV ≈ 6,000`
  (Lagarde) → `EXPOSURE = 1 / (L_SAT · K) ≈ 1.67`. Middle grey = 1,080 nits. `main.ts`
  applies `?ev=±n` (stops) and `?tm=aces|agx|neutral` on top for A/B shoots.
- Tone curve **AgX**, `outputColorSpace = SRGBColorSpace`, no gamma or contrast hacks.
  System 8's `finish` pass reads `renderer.toneMapping` / `toneMappingExposure`, so
  `?post=0` and post-on agree on exposure.

### The rig (`buildLighting`)

- **`sun`** — SpotLight 150 m out on `sunDirection()` (az 38° / el 35°), cone 2.1° over the
  building, `intensity = 90,000 · 150² · K` candela so the irradiance at the glass is 90 klux
  (the 0.88 glass transmission is deliberately not applied — 0.2 EV; the glass is not in the
  shadow path). Colour 5500 K. 4096² map, 3.5 mm texels, `bias −1.2e-4`, `normalBias 0.012`.
  **PCSS**: `renderer.shadowMap.type = BasicShadowMap` (raw depths) and `installPcss()` patches
  `THREE.ShaderChunk.shadowmap_pars_fragment` so `getShadow` does a 16-tap blocker search
  (radius 0.2 × `shadowRadius`) and a 24-tap PCF with `penumbra = (dReceiver −
  dBlocker) · lightAngularRadius / dBlocker`. `shadow.radius` is re-purposed: positive =
  penumbra growth per unit depth (`penumbraPerDepth(camera, dist, 0.265°)`), negative =
  fixed PCF in texels. A `primeShadowMapType()` dummy render at boot avoids the
  recompile-everything cost the type switch would otherwise trigger later.
- **`sunBeam`** — a detached twin of `sun` (same transform, map size, biases) whose shadow
  map is a `WebGLRenderTarget` with a `compareFunction = LessEqualCompare` depth texture.
  System 8's dust and haze sample the sun's map through `sampler2DShadow`, which a
  BasicShadowMap depth texture cannot serve; `installShadowMasks` renders `sunBeam`'s map
  right after `sun`'s with the same caster list, and `main.ts` passes `diner.sunBeam` to
  `createPostPipeline`. It is not in `scene` — no lighting cost.
- **`sunLot`** — DirectionalLight, 90 klux, ortho frustum over the lot, 4096² (≈ 8 mm
  texels), fixed 1.2-texel 8-tap PCF (`shadow.radius = −1.2`), `normalBias 0.03`. Casters:
  exterior objects + the caster-only cone that puts the building's footprint in shadow
  (System 3 rev 2's split). The lot's shadows are hard; its softness comes from the sky.
- **Sky dome** — `scaleSky(mesh)` patches Exterior's `ShaderMaterial` with a `skyScale`
  uniform (`nits(5,500) / 0.91` so the authored horizon lands at 5,500 nits, zenith ≈ 2,800)
  and multiplies by `1 + 1.5 · cos⁴(angle to sun)` for the circumsolar haze. The same dome
  is `scene.background`, the fog colour (`horizon`), and what the probes and windows see.
- **Window fills** — one RectAreaLight per window in the glass plane, 1,200 nits, bluish
  white (205, 215, 232), facing in: the sky + lot the slats let through, minus the part
  the room probe already delivers.
- **Floor-patch bounce** — one upward RectAreaLight per window on the aisle floor where the
  beam lands (window heights × cot 35°, shifted −x by tan 38° per metre), 2,000 nits average
  in sun × warm-checker colour: the room's second key light (ceiling, table undersides,
  counter die). Needed because the dielectrics' probe is captured with the sun off.
- **Troffers** — RectAreaLight 1.11 × 0.51 m per 2×4 fixture, `power = 7,500 lm`, 4100 K with
  a 4 % green bias; the lens material's emissive is 4,500 nits (`materials.ts`). 7,500 lm is
  above the maintained-lumen estimate (5,800) and below the brief's initial-lumen figure
  (10,500 was tried: ceiling at 0 EV, counter side too lit).
- **Contact occlusion** (`buildContactShadows`) — merged multiply-blended, vertex-coloured
  strips (`MeshBasicMaterial`, `MultiplyBlending`, `premultipliedAlpha`, `DoubleSide`,
  `polygonOffset`) under booth bases, stool bases, the counter toe, table pedestals, the
  wall–floor junctions and a 0.25 m ceiling cove. One draw call, no shadow maps.
- `?nospot`, `?nolot`, `?nofluor`, `?nofill`, `?nobounce` drop each group for A/B.

### Probes (`Diner.ts`)

Two 512² cube probes at (−2.3, 1.3, −0.2) — chest height, mid-aisle, away from the sun
patches — captured in two passes (pass 2 sees pass-1 lighting = one bounce of indirect):
`room` with the interior sun **off** → `scene.environment` (dielectrics' diffuse + specular
ambient, no double-counted sun patches through the PMREM blur); `roomSpec` with the sun
**on** → every material with `metalness ≥ 0.9`, so chrome mirrors the real sun patches and
windows. Prop and lot probes as before, re-baked under the physical rig.

### `materials.ts` (additive only)

`envMapIntensity = 1` everywhere (the probes are physical now); emissives rewritten in
nits × K (`fixtureLens` 0.54 ≈ 4,500 nits after the lens map; `rockerLit` 0.15, `pilotRed` 0.3,
`kitchenDim` 0.07 — × the emissive colour's luminance ≈ 700 / 700 / 30 nits);
vinyl base `#AA1A15` (from `#A8141C`) so the AgX-desaturated sunlit stripes go orange-red
instead of pink.

### Verification (rev 1)

- Float render-target probe (`renderer.render` into an RGBA16F target, region means /
  p10 / p90 in nits) on `length`, `booth`, `counter`, `stripes`, `window`, `warmer`,
  `ceiling`: table in sun +3.8 EV (core clips), vinyl stripe cores +0.9 … +1.7, sky through
  the slats +2.3 … +3.1, troffer lens +2.05, ceiling −0.85 … −0.2, back wall −1.1, counter
  top −1.1 … −1.3, die −2.7, seat in shade −2.9. Display clipping (≥ 250/255) 0.3–5.5 % on
  interior poses, 5–12 % on `window`.
- Against the references: Reitz "Shadows in a Diner" (stripes crisp on near tables, softer
  with distance, interior dropped) — the PCSS penumbra grows from ≈ 1 slat gap at the sill
  to ≈ 3 at the far wall; Shore / Eggleston reds — two reds on the vinyl, the sunlit one
  orange-red, the shaded one deep; Crewdson — the counter side reads as fluorescent-lit
  space that the sun does not reach, the lens visibly lit but not hot.
- Bench (RTX 4060, 1080p, shadow-once, probe script): 267–278 draw calls, 5.0–5.7 ms per
  frame with post, 5.0–6.9 ms without (the scene pass dominates; MSAA + post ≈ 1 ms here).
  Trials before rev 1 are in REFERENCE §8 (probe placement, 10.5 klm troffers, 7,000-nit
  sky, 1/125 s).

### Lessons

- The room's ambient is set by the probe's *placement*: a probe that sees the sun patches
  at close range turns them into a diffuse glow on every surface. Keep it away from the
  brightest thing in the room and split diffuse (sun off) from specular (sun on).
- Brightening the sky to make the exterior hotter brightens the interior more than the
  exterior on the display (AgX shoulder), and flattens the lot's shadows. Exposure and the
  sun : sky ratio decide the exterior, not the dome.
- A shader-chunk PCSS survives three.js updates only if it searches for code signatures
  (`float getShadow( sampler2D shadowMap`), not comments; and BasicShadowMap depth textures
  cannot be bound as `sampler2DShadow` — anything else that samples the sun's map needs its
  own compare-mode copy.

## System 5 — textures and surface detail (rev 1, `materials` branch)

Everything that does not depend on the light rig: what the surfaces are made
of and what has happened to them. All maps are procedural
(`src/procedural/textures.ts`), run in the TextureBank workers, and are
additive to the palette — no base roughness / metalness / colour value that
System 4 tunes was changed. New materials are *derived* (`palette.x.clone()` +
maps) so the lighting pass's numbers carry through (`withRough` in
`materials.ts`). Frames: `shots/sys5-*.png`; new poses `door-dressing`,
`floor-macro`, `wall-macro`, `welt-macro`, `ceiling-stain`.

Real-world numbers used (cited so the next pass can argue with them):

| Surface | Measurement | Source |
|---|---|---|
| Floor tile | 300 mm quarry/ceramic checker, 6 mm sanded cementitious joint (TCNA: sanded grout for joints ≥ 1/8"; pressed-edge ceramic typically 3/16"), joint 1.5 mm below the glaze, lippage ≤ 1/32" (ANSI A108.02 4.3.8) | [TCNA grout FAQ](https://tcnatile.com/resource-center/faq/grout/), [TCNA/ANSI install guide](https://remodelcalculators.com/blog/floor-tile-installation-guide) |
| Wall paint | 3/8" nap roller stipple: 1–3 mm paint domes, 0.1–0.2 mm high, ~60 % coverage; gypsum board 4 ft (1.22 m) wide → taped seam every 1.2 m under a 250 mm feathered compound band | trade practice (USG Gypsum Construction Handbook: 48" boards, 10–12" feathered joints) |
| Ceiling | Armstrong Cortega 704: 24 × 24 × 5/8" wet-formed mineral fibre, angled tegular, 15/16" grid face, factory latex paint, LR 0.80–0.82 ("medium texture" fissured, ASTM E1264 Pattern C D) | [Armstrong 704](https://www.armstrongceilings.com/commercial/en/commercial-ceilings-walls/cortega-lay-in-ceiling-tiles/item/704.html), [Cortega spec sheet](https://hdsupplysolutions.com/wcsstore/ExtendedSitesCatalogAssetStore/product/hdpro/additional/PR/PRO_303314_Specification_303314_SpecSheet.pdf) |
| Kick plate | 8" (203 mm) high — BHMA: 8/10/12/16" typical — width 2" less than door width (LDW), 18 ga / .050" 304 stainless #4 satin, ANSI/BHMA A156.6 J102 | [BHMA terminology](https://buildershardware.com/Resources/Guide-to-Builders-Hardware-Terminology/Architectural-Door-Trim), [A156.6](https://buildershardware.com/ANSI-BHMA-Standards/Hardware-Highlights/A1566-2026-Architectural-Door-Trim), [Activar kickplate submittal](https://www.activarcpg.com/wp-content/uploads/Door-Protection-Kickplate-Hiawatha-Series-Submittal.pdf) |
| Vinyl | expanded (foam-backed) upholstery vinyl, emboss grain 0.4–0.7 mm pebbles / 0.1 mm creases (measured off a Naugahyde-class swatch), crazing cells ≈ 3.5 mm in plasticiser-starved areas | trade practice |
| Laminate | HPL wipe haze + 10–40 mm curved scratches, mug ring ghosts 80 mm Ø (standard diner mug 3.2" base) | trade practice |
| Bare tee metal | hot-dip galvanised steel under the baked white (chips read grey, Ra ≈ 0.55, one rust hairline) | trade practice |

Per item:

1. **Floor** — `checkerFloor` rewritten (2040 × 1020 map + roughness, 40 × 20
   tiles at 51 px / 300 mm) with a world-space wear description from the plan
   (`dinerFloorWear()`: aisle lane between stools and booths, counter standing
   zone, door path, staff run, sheltered rectangles under the booth seats and
   the back bar, wall lines for dust, one crack by the door). ±1.5 % tile tone
   (blacks 3 %), whites grey off and blacks scuff lighter in the lanes,
   roughness +0.28 in the lanes / −0.09 sheltered, grout dust (pale, matte)
   within 0.4 m of a wall, 220 heel-scuff arcs (6–15 mm, two thirds in the
   lanes), hairline crack with a light catch on one lip. Grout relief is a
   separate 2 × 2-tile detail normal (`floorGrout`, 1024 px = 0.6 m: 1.5 mm
   trench with rounded shoulders, ±0.4 mm lippage per tile, 0.1 mm glaze
   waviness) repeated `w/0.6 × d/0.6`. Slow fields (fbm, lane and wall
   distances) are evaluated on a 4 px grid and bilinearly sampled — the
   per-pixel polyline distances were 10 s of the boot, now 0.5 s.
2. **Walls** — `paintedWall` takes `WallOpts`: drywall seams every 1.2 m
   (0.8 % lighter compound band, 7 % glossier), a scuff band at 0.95–1.12 m
   (chair-back / booth-cap height: ragged 30–150 mm rub bundles + small dark
   knocks, burnished under them), sun fade near the window jambs (window wall
   only, `wallPaintWindow`, +2.5 % between sill and head, reaching 0.25 m). The
   roller stipple is a detail normal (`wallStipple`, 1024 px = 0.6 m, jittered
   2.2 mm cell grid of domes with 15 % skipped on a 0.05 mm swell). Interior
   walls use **world-aligned UVs** (`worldBoxUv`, merge.ts) so seams and fades
   land at real heights and are continuous across the punched wall boxes.
   Baseboards: `baseboardScuff` (mop-water tide mark at the toe, heel/broom
   streaks) on metric UVs, `baseboardWorn`.
3. **Ceiling tiles** — `acousticTile` rewritten: worm-track fissures 2–8 mm ×
   0.7–1.5 mm, 0.7–1.4 mm deep (~1.1 per cm²), soft 1.5–2.5 mm pinholes, fibre
   nap, depth carried as height → normal AND as shading (a fissure floor is in
   its own shadow: no black dots), same reveal shade on all four tegular edges.
   Per-instance tint: ±1.5 %, warm yellowing on 30 %, 1 in 25 a shade greyer
   (`InstancedMesh.setColorAt`). Two water-stained tiles (`stain: true`: wobbly
   130–200 mm tan wash, dark tide rim, two inner rims) as their own small mesh
   (+1 draw call — two instances cannot carry a different map). Three tiles sag
   0.5–0.7° on a bowed cross tee. Grid tees: `teePaint` (1 m of tee per canvas,
   ±2 % yellowing drift, 3–8 chips per metre to bare galvanised with a rust
   hairline, chips in the last 2.4 % of v — the 24 mm face).
4. **Laminate** — `laminateWear`: wipe haze (anisotropic fbm), 140 curved
   scratches + a few long ones, cup-ring ghosts (rings only near where a mug
   sits: 3 per booth table, 6 along the counter). Tables get per-table UV
   offsets so no two share a scratch pattern; counter uses a 2048 map over
   2.05 m. T-mould edge: `formicaEdgeBrushed` (brushed roughness along the
   band, softer at the corner radii).
5. **Vinyl** — `vinylSurface` rewritten as pebble grain (Voronoi on a jittered
   0.55 mm grid, flat-topped domes with rounded creases) instead of noise, on
   a 0.25 m canvas so the grain is true size; burnished blotches (−0.1
   roughness) where hands and seats polish it, crazing in patches on the
   backs (pre-existing `vinylRedCrazed`). **One booth (the second) has cracked
   welts**: `vinylRedWeltCracked` — `vinylSurface(..., weltCracks)` puts a
   4–18 mm crazed band and long seam-parallel cracks at u ≈ 0, and Booths.ts
   remaps that booth's back-panel u to the distance from the nearest cord
   (+1 draw call).
6. **Chrome / stainless** — `formicaEdgeBrushed` (T-mould), `stainlessTouched`
   (dispensers, brewer rails: anisotropic brush + 8–14 fingerprints with 0.45 mm
   ridge pitch + wiped smears), `chromeScuffed` (stool footrings + footrail:
   rub streaks with the UVs turned so they run along the ring), `chromeBar`
   (push bar + pull: polished grip zone toward the latch, haze shoulders, 40
   finger smears).
7. **Wood** — `capSlab` lightens the cap's arris vertices by normal direction
   and grip-point proximity (worn finish), `woodVeneer(..., dings: 3)` stamps
   dents into the height/colour.
8. **Door dressing** — one atlas (`doorDecals`, `DECAL` regions in shapes.ts,
   `atlasQuad`) for the OPEN card (suction hooks), hours vinyl, PUSH sticker
   with a lifted corner, "WE ACCEPT" card sticker (generic marks), and the
   window-film edge (bare-glass hairline, lifted corner, trapped motes) applied
   to the five windows. All door decals are on the INSIDE face of the glass:
   OPEN/PUSH read from the room, hours/cards are applied reversed and read
   from the lot (mirrored from inside, as in life). 8" satin stainless kick
   plate on the push side. +1 draw call (decal material).
9. **Glass** — `glassCarafe` (`carafeScratches`: dishwasher etching + fine
   scratches, base roughness lifted so they read), coffee-stain tide line as
   an alpha map on the existing stain mesh (`tideLineAlpha`: irregular rim,
   drips).
10. **Anti-tell** — no pure black/white in any generator (floor blacks 26,
    whites 220, decal card #f4efe2, marks #f4f4f2); every large surface has a
    roughness map with wear structure, not uniform noise; repetition broken by
    per-tile tint, per-table UV offsets, world-aligned wall UVs, panel jitter
    on metric UVs, and quarter-turned tile instances.

Draw calls: **+8 at the spawn pose (131 → 139), +8–14 in the poses** — not the
"maps only" zero the brief asked for. Each is one new material bucket inside
an existing merged mesh: window-wall paint (sun fade), window-film decals,
stained tiles, the welt-cracked booth, scuffed footrail/footring chrome next
to plain bracket chrome, the counter's worn top next to the back-bar laminate,
the door decals, the brewer's touched trim. All are maps, none is geometry;
each could be folded back by giving the base material the same maps (e.g. one
`wallPaint` with the fade baked into the world-UV map, `chromeScuffed` on the
brackets too) if the budget needs it. Startup (same warm shader cache, same
port): 12.1–12.5 s to ready vs 14.8 s at the base commit `5ab934f` — no
measurable cost; textures 9.4–10.0 s wall on 8 workers either way. Serial CPU
for all 42 generator jobs is 19.2 s, of which the rewritten floor is 0.5 s
(was 10 s before the coarse-grid fix), the two big walls 1.1 s each, and every
new small map < 0.1 s.

Lessons from this pass are in "Lessons recorded" (CanvasTexture v is
upside-down relative to canvas rows; transparent decals behind transmissive
glass; per-pixel distance fields).

## System 6 — sound (rev 3: the live mix)

Everything is synthesised in `src/audio/` (Web Audio, no files; details in
`src/audio/INTEGRATION.md`). Revs 1–2 passed the individual sources through the
numerical critics; rev 3 measured **the mix the player hears** — the wired graph
(`wiring.ts` positions) rendered through an `OfflineAudioContext` with the
listener at six poses, every bus tapped (post-panner, pre-reverb), integrated
loudness per ITU-R BS.1770-4 (K-weighting, −70 LUFS absolute / −10 LU relative
gating, coefficients verified against the 48 kHz table to 1e-14) — and then
re-levelled it. `node tools/audio-harness.mjs --poses | --calib |
--scenario=pour|door [--tag=]` writes `tmp/<tag>-*.wav` + `tmp/<tag>-report*.json`;
Vite on :5320 (`--port=`; the visual harnesses own 5210–5260). Deterministic
(seed 20260902): the numbers below reproduce exactly.

**Per-pose loudness (LUFS, 12 s, listener eye 1.62 m; booth seated 1.15 m).**
`mix` is the master output; the source columns are the solo taps at that pose.
Targets from the brief: room ≈ −45, AC ≈ −38 @ 1 m, fan ≈ −42 under it, radio
≈ −36 @ 1 m, warmer only within ~1.5 m, aisle bed ≈ −34…−36. Those add up to
≈ −39 at the aisle, 3 LU under the bed range, so the spatial sources were set
2–3 LU over their nominal marks (AC −35, fan −39, radio −33 at 1 m) with the
room at −44.5, which lands the aisle at −36.2 and keeps the ordering.

| pose (x, z, yaw) | mix before → **after** | AC (d) | fan (d) | radio (d) | warmer (d) | room |
|---|---|---|---|---|---|---|
| door, facing in (4.95, 2.45, 90°) | −36.8 → **−40.0** | −50.4 (10.8 m) | −49.8 (6.4) | −43.0 (5.7) | −64 (8.2) | −44.5 |
| aisle centre (0, 0.9, 90°) | −31.0 → **−36.2** | −45.4 (5.7) | −41.0 (1.6) | −40.4 (3.6) | −58 (3.7) | −44.5 |
| booth 3, seated (−1.7, 2.6, 215°, −9°) | −31.1 → **−37.0** | −44.6 (4.6) | −41.1 (1.9) | −43.6 (5.9) | −65 (5.0) | −44.5 |
| counter at the brewer (−1.5, −1.3, 0°) | −31.4 → **−36.3** | −44.0 (4.8) | −44.4 (2.7) | −39.1 (3.4) | −50.2 (1.2) | −44.5 |
| under the AC (−4.9, 0.9, 90°) | −26.6 → **−34.7** | −36.2 (1.3) | −46.8 (3.7) | −46.7 (7.3) | −64 (4.6) | −44.5 |
| at the radio (1.7, −1.3, 0°) | −30.6 → **−33.5** | −47.4 (7.7) | −46.4 (4.1) | −33.6 (1.1) | −58 (3.6) | −44.5 |

Before, the AC dominated everything (−27 LUFS under it, −36 from the aisle —
11 dB over target), the fan was 8 dB hot, the radio 3 dB, and the room tone 7 LU
too quiet to read as a room. Mix crest factor 13.5–17 dB at every pose (nothing
is compressed; the limiter idles). Mix spectral centroid 390–1020 Hz: warm.

**Calibration at 1 m and distance (solo taps, listener facing the source).**
All fixed emitters use the PannerNode `inverse` model, `refDistance` 1 m,
`rolloffFactor` 0.55, `maxDistance` 18 m — measured against the model:

| source | 1 m LUFS before → **after** | 1.5 m | 2 m | 4 m | 6 m | 10 m | model at 6 m |
|---|---|---|---|---|---|---|---|
| AC (HRTF) | −26.5 → **−35.5** (1.1 m) | −1.3 | −3.0 | −7.2 | −10.2 | −14.2 | −11.0 |
| radio (HRTF) | −31.1 → **−33.1** | −1.1 | −2.8 | −7.8 | −10.8 | — | −11.5 |
| fan (HRTF) | −32.5 → **−39.0** | −1.9 | −3.2 | −7.3 | — | — | −8.5 @ 4 m |
| warmer (HRTF, ref 0.7 / rolloff 1.4) | −48.8 → **−47.9** | −2.5 | −5.3 | −7.6 @ 3 m | | | −10.9 @ 3 m |

Every source loses 10–14 dB across the room: no source is "uniformly loud
everywhere". Measured falls sit 0.3–1.2 dB shallower than the bare model because
the HRTF adds level as the source moves off-axis (the listener path turns), and
because the taps include each source's own width. The warmer was the one that
did not fall (−3.2 dB over 3 m — an event source, its integrated loudness is set
by the ticks): it now has its own steeper model and is a near-field detail
(ticks peak −34 dBFS at the brewer against a −38 dBFS bed; 20 dB under the bed
at the aisle). Panner choice is consistent: HRTF for the fixed emitters and the
door jambs, equal-power for arm's-length one-shots (pour, clinks, latch) where
the HRTF's interaural delay reads as phase. L/R balance follows geometry at
every pose (radio +7.2 dB R−L when 0.87 to the right, −6.8 when 0.94 left; AC
0.0 dead ahead).

**SFX timelines (`--scenario`, System 7's exact clocks).** Pour, listener at the
counter: the clink fires at 0, `pourCoffee(2.5)` at +1.30 s, the set-down clink
at +5.30 s. The splash now starts **169 ms after the call** — when the stream,
falling 60 mm to the rim and 76 mm to the mug floor, lands (167 ms; Pour.ts
ripples at +170 ms). Before rev 3 it started at +19 ms, 150 ms before the
coffee arrived. Cavity resonance climbs 824 → 1299 Hz across the pour (rising
pitch as the mug fills); the 300 ms taper + ring lets it die 0.8 s after the
stream stops. Pour −30.3 LUFS (target −30; was −33.3), clink peaks −11.8 /
−10.5 dBFS in the mix (target −12; were −21 / −23). Pour start / stop steps
0.07 / 0.015 FS, ≤ 2.4× the local RMS — no discontinuities (the clinks' own
0.15 FS onsets are the ceramic contact, a 1.5 ms attack).

Door, listener inside the leaf: `doorOpen()` at 0, leaf 30° at +124 ms, 85° at
+1.1 s, hold to +5.1 s, closer sweep to 8° by +6.9 s, latch +7.15 s. Heat wall
holds at **−26.2 LUFS** on the outside bus (target −26; was −22.2), mix −26.0
while open vs −40.4 before — a 14 dB wall. The crossfade is equal-power in
shape (exterior sin(π/2·a), interior √(1 − ½ sin²) — the two powers sum to a
constant — replacing a^0.6 with the room untouched), smoothed with τ = 0.22 s
opening / 0.07 s closing: half power at +450 ms, within 1 dB of hold at
+0.75–0.9 s, i.e. 0.6–0.8 s after the leaf clears 30° (the bed itself breathes
±1.5 dB, hence the range). Interior bed −40.5 → **−43.4 while open (−3.0 dB)**
→ −40.2 after the latch (was: no duck at all). Closing: −2 dB at mid-sweep,
−16 dB at 8°, gone after the latch. The latch itself now clicks (−23 dBFS at
0.85 m; the open latch peaks −17.9) — `setOutside(0)` after an opening fires
`doorClose()`, since DoorSwing only calls `open()` + `outside(p)`. Steps at
open / sweep / latch ≤ 5.1× local RMS.

**Start path (read, not edited).** `main.ts` calls `interactions.startAudio()`
after `loader.waitForEnter()` resolves and again on the first canvas click; the
overlay's enter click also bubbles to `window`, where `startAudioOnGesture`'s
one-shot listener constructs and resumes the `AudioContext` *inside* the
gesture (no `stopPropagation` on the way), and Enter/Space take the same
`keydown` route. Every later call is a resume retry. One change on the audio
side: `start()` used to await the first `resume()` before building the graph —
Chromium leaves that promise pending until a gesture, so a premature first call
would have postponed the whole build. It now builds synchronously and returns
the resume.

Files: `src/audio/{index,AudioEngine,wiring}.ts`, `ambience/{AirConditioner,
CeilingFan,Radio,RoomTone,CoffeeWarmer}.ts`, `sfx/{Coffee,Door}.ts`,
`harness/page.ts`, `tools/audio-harness.mjs`, `src/audio/INTEGRATION.md`.

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
  Sit.ts         10 benches (5 window booths × 2 sides); 1.8 s sit-down in four beats (rev 2):
                 0.15 s anticipation (hint fades, 4 mm weight shift) → 0.6 s step & turn to the
                 cushion edge, eyes on the seat (−32°), only 7 cm lost → 0.7 s lower & slide
                 (1.55 → 1.15 m ease in-out, 8 cm lean toward the table and back, eyes lift to the
                 window) → 0.35 s cushion settle (14 mm dip, 4 mm rebound). Seated eye 1.15 m,
                 centred on the bench, turned 35° to the window, −9° pitch; movement locked, look
                 clamped ±70° / ±40°; E again stands (1.0 s: lean, rise, slide out). Any window booth.
  Pour.ts        5.95 s from E (rev 2): 0.25 s reach → lift off the plate → 0.75 s Bézier arc of the
                 spout lip to 4 cm over the pour point, wrist already tilting from 55 % of the carry →
                 tilt-on settles the lip → stream 1.78–4.35 s: flow ramps in over 0.35 s (a thread
                 that thickens), holds, dies over 0.4 s; over-tilt (≤ 6°) ∝ flow, pot dips 1.5 cm as
                 the mug fills → 0.35 s wrist snap upright (ease-out) cuts the stream, tail falls at g,
                 two drips at 4.50 / 4.75 → arc back, decelerating set-down. Stream radius ∝ √flow ×
                 √(v0/v(d)) (continuity thinning), parabola from a 0.3 m/s lip speed, Rayleigh–Plateau
                 bead-up when the flow is a thread; mug level = landed volume (flow integrated with the
                 0.17 s fall delay) through the mug's inner-radius profile; decanter coffee = tall body
                 + world clipping plane (Props' fixed body hidden from boot), level drops 9 mm; steam =
                 `src/post/Steam.ts` SteamEmitter at the rim (the interactions/Steam.ts duplicate is
                 gone), strength/rise/size build over 1.5 s from the first splash, fade 18 → 30 s.
                 SFX on the visual: clink as the glass leaves / lands on the plate, pour from the moment
                 the leading edge hits the mug for as long as liquid lands (tail + drips included).
                 Once full, E gives a 4 mm / 0.22 s bob and no refill.
  DoorSwing.ts   7.25 s closer cycle (rev 2): 0.22 s reach (hint fades; latch click + whoosh as the
                 leaf starts) → 1.23 s weighted push (velocity profile: ease-in, peak ≈ 40 %, backcheck
                 cushions the last 15°, a 0.9° bump into the cushion — no spring-back) → 1.4 s hold,
                 extended while the player stands in the threshold zone → 3.6 s sweep 85° → 12°
                 (take-up from rest, then decelerating: spring torque falls, damping ∝ speed) → 0.8 s
                 latch 12° → 0, velocity-continuous, slightly accelerating, `latch()` SFX on the stop.
                 One AABB collider follows the leaf every frame (disabled for the frame if the
                 player's centre is inside it); `angleDeg` for captures; `onDoorOpen(progress)`
                 listeners (default brightens the hemi fill +12 % at full open); `setOutside(progress)`
                 every frame the leaf moves — the crossfade inherits the closer's ease.
  debug.ts       window.__interact / __interactPose / __interactions / __player (below)
  util.ts        easings + the Interactable interface
src/audio/wiring.ts   createDinerAudio() with the warmer at the brewer's lower plate and the mug at
                 `pourMug`; radio / AC / fan / door from System 6's defaultPositions();
                 startAudio() (idempotent) + first click/keydown/pointerdown fallback;
                 listener follows the camera in update(); `doorLatch()` — leaf-on-stop thump
                 (150–210 Hz, 60 ms) + bolt click (2.6–3.8 kHz) + strike seat (1.4 kHz, 35 ms later)
                 + a quiet 700 Hz pane shiver, at the strike jamb through the door bus
```

Controls: E (F, or click under pointer lock) on the highlighted target. Reach:
benches 1.4 m, mug 1.25 m, door 1.4 m, cabinet doors 1.5 m, kitchen door 1.6 m (System 9);
look cone 22–30° half-angle.
System 9 keys (`src/player/FirstPerson.ts`, feature 5): **WASD / arrows** walk 1.4 m/s;
**Shift** walk fast (2.6 m/s, 0.2 s blend in/out, same 0.15 / 0.12 s accel/decel *times*,
head-bob 1.8 → 2.4 Hz phase and 1.4 → 2.2 cm p-p with speed); **Space** a hop (0.32 m apex,
g = 9.81, 0.51 s in the air, 2 cm landing dip over 0.15 s + `sfx.footfall`; one hop per
press, no bunny-hop on a held key); **E** the prompt action (interact / sit / pour / open —
"Stand" when seated); **Q** stand up. Shift and Space are refused while seated (controller
disabled by Sit) and mid-interaction (`player.blocked()`: pouring, drinking, or standing in the
door swing while the leaf cycles); a sprint in progress blends out. The hop and the bob are camera
offsets only — `position.y`, the colliders and `setPose()` never see them, and both are
exactly 0 at rest. The loader shows the keys under "Click to enter".

Debug / capture API (`src/interactions/debug.ts`, on `window`):

| Call | Meaning |
|---|---|
| `__interact("sit" \| "pour" \| "door")` | run the interaction live (sit picks the nearest bench; `{booth, side}` as 3rd arg) |
| `__interact(name, t)` | seek to `t` seconds into that interaction and freeze the clocks (silent) |
| `__interact("stand" \| "resume" \| "reset")` | stand up / unfreeze / everything back to rest |
| `__interact("drink" \| "cabinet" \| "cabinet-right" \| "cabinet-close" \| "kitchen-door", t?)` | System 9: drink (1.6 s; a seek fills the mug first), toggle the left / right cabinet door (`t` seeks the 0.8 s opening), close the left door (`t` seeks the 0.75 s closing), push the kitchen door (`t` seeks the 2.8 s cycle) |
| `__interactPose("sit-seated" \| "pour-mid" \| "pour-full" \| "door-open" \| "drink-sip" \| "cabinet-open" \| "kitchen-door-open" \| "kitchen-door-back")` | state + camera for `tools/shoot.mjs` |
| `__interactions` | the live object: `.sit.state`, `.pour.state`, `.pour.fill`, `.door.progress`, `.door.angleDeg`, `.drink.state`, `.cabinet[0..1].{state,angleDeg}`, `.kitchenDoor.{busy,angleDeg}`, `.target`, `.audio.state()`, `.startAudio()` |
| `__player` | the `FirstPerson` controller (harness feel checks: `.position`, `.camera`, `.setPose`, `.keys` (a `Set` of key codes — add `"KeyW"` / `"ShiftLeft"` / `"Space"` and call `.update(dt)`), `.speed`, `.sprintAmount`, `.inAir`, `.jumpHeight`, `.blocked`) |

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

### System 7 rev 2 — feel polish (`shots/sys7-seq-*.png`)

**Contact sheets.** `node tools/sequence.mjs` (port 5260, `--port=` to move) builds, serves
`dist/`, and shoots each interaction as a frozen time series through `__interact(name, t)`:
sit 0 → 1.8 s @ 0.1 s (first person — the sit *is* the camera path), pour 0 → 6 s @ 0.25 s
(back-bar camera), door 0 → 7.25 s @ 0.25 s from the vestibule camera and from an exterior
3/4 camera (`door-ext`, the leaf swings toward the lens so its angle reads). Each frame's
strip carries the time and the state (leaf angle in degrees, pour/sit state); key frames
(amber) are also written full-size (`sys7-seq-<seq>-k<i>-<t>s.png`). Post ON by default
(`--query=post=0` for the plain renderer), `--seqs=`, `--no-build`, `--out=DIR` (before/after
runs), `--tag=`, and a window override `--t0 --t1 --step --keys=all|none|t,…` to zoom into a
beat at full size. pngjs only, bitmap labels, GPU asserted like `shoot.mjs`.

**Before → after (read off the sheets, then re-shot).**

| | before | after |
|---|---|---|
| Sit | 0.9 s single cubic ease from the aisle straight to the seated pose — the view swings across the booth back, everything is over by 0.6 s and frames 0.5–1.1 s are identical; 12 mm "settle" invisible; no lean, no look-at-seat; hint and motion start on the same frame | 1.8 s in four beats (above): the hint has faded before the step, eyes drop to the seat while stepping in, the drop is the slow part, the head leans 8 cm toward the table and comes back as the hips land, then a 14 mm cushion dip + 4 mm rebound. Every frame of the sheet is different; the window fills the frame from 1.3 s |
| Pour | decanter teleports 12 cm up in the first 0.25 s, straight lines between key points, tilt starts only after arrival, constant-radius rod of a stream (taper 1.0 → 0.7), no drips, fill linear in time, steam an opaque white cloud twice the mug's size within ~1 s | 0.25 s reach, lift then a Bézier arc with the tilt blended into the arrival; stream is a thread that thickens, thins with √(v0/v) as it falls (≈ 45 % over 10 cm) on a parabola, beads up and detaches at the end, two drips; the level follows the landed volume through the mug's profile (fast at the narrow foot, slow at the rim, 0.17 s behind the lip); steam is the System 8 emitter building over 1.5 s to a translucent wisp |
| Door | 0 → 53° in the first 0.25 s (≈ 210°/s: a slammed door), 85° by 0.75 s with a spring overshoot, 4.3 s hold, sweep 85 → 8° in 1.8 s (≈ 43°/s), 0.25 s latch, no latch sound | 0.22 s reach, 1.23 s weighted push peaking ≈ 90°/s with a backcheck cushion instead of a spring, hold that waits while you stand in it, 3.6 s decelerating sweep (24 → 15°/s), 0.8 s latch at ≈ 15°/s with the thump + bolt click; measured live: 85° at 1.45 s, 12° at 6.45 s, shut at 7.25 s |
| SFX | pour SFX at stream start (0.17 s before anything lands), clink on the same frame as the lift, no latch | pour on impact for as long as liquid lands; clink as the glass leaves / meets the plate; latch release as the leaf starts; `doorLatch()` on the stop |

**References used.** Door: 2010 ADA Standards 404.2.8.1 — closers adjusted so that from 90°
the door takes ≥ 5 s to reach 12° from the latch (<https://www.access-board.gov/ada/chapter/ch04/>).
LCN 4040XP field adjustment: sweep valve = 90° → 10–15° from the latch, target 5–7 s on ADA
openings, 4–6 s acceptable on lighter-traffic doors; latch valve = the last 10–15°, "it should
accelerate slightly in that zone and seat against the strike with a clean, firm click — no
bounce"; backcheck engages at 70–75° and cushions the rest of the opening
(<https://www.securityparts.com/how-to-adjust-commercial-door-closer>; exterior 4–6 s and a
1–2 s latch zone: <https://nationallocksupply.com/blog/commercial-door-closer-adjustment-sizing-guide/>).
This diner door sweeps 85° → 12° in 3.6 s + 0.8 s latch — the brisk end of a light aluminium
storefront leaf, as the brief asked (3–4 s sweep + 1 s latch); an ADA-strict 5 s sweep is
one constant (`TL.sweep`). Pour: a free-falling stream thins by continuity, radius ∝ (v0/v)^½,
and a thread breaks into drops below ≈ 1 mm (Plateau–Rayleigh,
<https://en.wikipedia.org/wiki/Plateau%E2%80%93Rayleigh_instability>); the pouring form —
tilt just past the lip angle, flow set by the extra tilt, cut with a quick wrist snap so the
stream detaches rather than dribbles — is what a Bunn decanter's pinched lip is shaped for.
Sit: young adults sit down in 1.33–1.49 s with seat contact at 0.70–0.88 s and a forward
trunk lean throughout (Sci Rep 2023, <https://www.nature.com/articles/s41598-023-43401-6>);
the iTUG "sit" phase averages 1.6 ± 0.5 s with a 0.6 s flexion beat
(<https://pmc.ncbi.nlm.nih.gov/articles/PMC11943381/>); trunk flexion is what controls the
descent (<https://doi.org/10.3389/fnhum.2024.1399179>). Our 1.8 s = 1.45 s to seat contact
+ 0.35 s cushion settle. Head-bob: ≈ 1.8–2 steps/s at 1.4 m/s; a 1–2 cm camera bob reads as
"a body" without motion sickness.

**Hook checks.** `onDoorOpen(progress)` fires every frame the leaf moves and once at rest; the
default listener lifts the hemisphere fill +12 % at full open (nothing in System 4/8 binds it
yet). `src/post/beams.ts` includes the door *lite* as a static aperture, so the sun-beam dust
prism does not need an update when the leaf swings — but it stays the size of the closed
leaf's glass; a rev could add the clear opening × progress. `setOutside()` is already a
perceptual curve (a^0.6, 0.1 s ramps) and now follows the closer's ease, so the heat wall
comes in over the 1.2 s push and leaves with the sweep, cut at the latch — not abrupt.

**Player feel (`src/player/FirstPerson.ts`, documented in its header).** Velocity is
rate-limited: 0 → 1.4 m/s in 0.15 s, stop in 0.12 s (measured 0.62 / 1.09 / 1.40 m/s at
0.05 / 0.10 / 0.15 s; 0.62 / 0.09 / 0 at 0.05 / 0.10 / 0.15 s after release). Head-bob 1.4 cm
peak-to-peak at 1.8 Hz with a 5 mm sway at half rate, amplitude eased in over 0.25 s and out
over 0.2 s; applied to the camera only, `position` never bobs, and a still player is exactly
at eye height (so every capture pose is unchanged). Eye height stays at the project's 1.62 m
(the brief said 1.65; every System 1–8 shot is framed at 1.62, so it was left). Mouse look
has no smoothing. Collision: the axis-separated test refused *both* axes whenever the circle
touched an AABB corner, so walking diagonally along the counter stopped dead at the first
stool base; it is now move-then-push-out along the contact normal (≤ 4 rounds, refuse the
move if squeezed), which slides on faces and rolls round corners — measured: along the stool
row at 0.56–0.7 m/s with a ±1.5 cm ripple, along the booth fronts at 0.7 m/s (no stepping on
seats: stops 28 cm short of the cushion front), along the counter front at 1.35 m/s, across
the door jamb without a catch, and through the open door at full speed.

**Lessons.** (1) `renderer.compile()` links materials *without* their `clippingPlanes`
(clipping state is set per object during a real render), so the numClippingPlanes=1
variant of the clipped decanter body only exists once that mesh has been drawn — and the
boot camera never sees the decanter, so it linked on the first E at the mug (0.7 s freeze).
Fix: the live body is visible from boot (Props' fixed body hidden) with `frustumCulled =
false`, and a pending `moved` flag re-renders the shadow maps on frame 1 so the depth
variant links too — first pour now costs 16 ms. (2) A good interaction has an anticipation
beat: the hint's 180 ms fade needs to finish before the first thing moves (sit 0.15 s, door
0.22 s, pour 0.25 s). (3) Author swings as velocity profiles and integrate to a LUT
(`integrateProfile` in DoorSwing.ts): "fast here, slow there" is how a closer valve and an
animator both think, and the latch can be made velocity-continuous from the LUT's end slope.

**Merge with System 6 rev 3 (`main`).** Both branches fixed the same two audio-sync problems
independently, so the merge keeps one path for each: (1) the close latch — rev 3's
`DoorSfx.setOutside(0)` plays `doorClose()` by itself on the frame the leaf seats, so
`index.ts` no longer also calls `wiring.doorLatch()` (kept as a scripted voice; both together
were a doubled click); (2) the pour landing — rev 3's `pourCoffee()` starts its splash
`CoffeeSfx.LANDING_S` (0.17 s) after the call, so `Pour.ts` fires the cue that much *before*
its computed impact time (fallDelay ≈ 0.167 s) instead of at it, and the sound still lands
with the leading edge. Runtime verification of this merge (sequences, audio harness,
boot/draw-call deltas) was **not** run at merge time — GPU unavailable — and is owed.

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
- **Steam duplication (resolved in System 7 rev 2).** System 7 rev 1 carried its own
  `src/interactions/Steam.ts` for the pour beside `src/post/Steam.ts`'s
  `SteamEmitter` (decanter). Rev 2 deleted the duplicate: the pour's mug steam is a
  second `SteamEmitter` (`Pour.ts` → `MugSteam`) whose strength / rise / size are
  driven from the pour clock, so the API here is the only steam API.
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

## System 9 — extended interactions and implied presence (`sys9-interactions`)

Five features, all in new files hooked into the existing ones by a few lines each:
`scene/Sys9.ts` (one call in `Diner.build` after `buildProps`), `interactions/Openables.ts`
+ `Drink.ts` (registered in `interactions/index.ts`), `audio/ambience/Kitchen.ts` + `sfx/Player.ts`
+ `sfx/Openables.ts` (positions + entries in `audio/index.ts`), `player/FirstPerson.ts` (feature 5).
Frames: `shots/sys9-sys9-{apron,cardigan,plate,cup,cabinet,cabinet-open,kitchen-door,kitchen-door-open,kitchen-door-back}.png`,
sheets `shots/sys9-seq-{drink,cabinet,cabinet-close,kitchen-door}.png` + key frames.

**1 · Drink the coffee** (`interactions/Drink.ts`; hooks in `Pour.ts`: `fill`, `setFill`, `levelFor`,
steam scale). Once the mug holds more than `EMPTY_FILL` (15 %) the mug's target is "Drink"
instead of "Pour". 1.6 s from E in four beats: 0.22 s reach (nothing moves, hint fades) →
0.5 s lift on a quadratic arc up and in to a point low-right of the lens (camera-attached, so
looking around carries the mug) → 0.43 s sip: the mug closes to 0.21 m and tips 20–45° (enough
to bring the surface to the rim for the level it starts at, plus a few degrees), the head
tilts back 4° with 1.5° roll (`player.lean`), the level falls by ⅓ of a mug between 0.82 and
1.08 s through the pour's volume LUT, the rim steam scales with the level, `sfx.sip` at 0.78 →
0.45 s set-down, decelerating, quiet clink. The liquid disc is counter-rotated each frame to
stay world-horizontal and slid to the low side, so it reads as liquid in a tilted mug. Three
sips empty a full mug (1 → 0.667 → 0.333 → 0); below 15 % "Pour" is offered again and a pour
tops it up. Movement locked and `blocked()` true for the 1.6 s. `__interact("drink", t)` seeks
(filling the mug first if empty); `drink-sip` pose.

**2 · Openables** (`scene/Openables.ts` geometry, `interactions/Openables.ts` motion).
*Cabinet*: `BACK_BAR.cabinet` = a 1.0 m bay under the brewer that `Counter.ts` now leaves open
(one entry in its `openings` list; the laminate bay gets no stainless face frame). Carcass, shelf,
stacked saucers, an open box of filters, a paper-towel roll and a spray bottle are static and go
into existing buckets; two overlay laminate doors (8 mm lap, 2.5 mm arris) each hang on their own
hinge Group with a chrome wire pull, and a 4 mm dark reveal on the die face frames the pair so it
reads as doors in the flat service-side light (head-on it was invisible — the grain runs through).
One press toggles: open = 0.2 s reach, catch `release` tick, 0.6 s swing to 95° — quick off the
catch, the damper takes the last quarter, a 1.5° overshoot settles (soft stop); close = 0.15 s
reach, shove to 20°, damper to 3°, the magnetic catch pulls the last 3° home with a `close`
click at 0.75 s. *Kitchen door*: `Shell.ts` keeps only the casings; the leaf (0.9 × 2.1 m, paint +
dark lite + grey plates + pivots, one vertex-coloured mesh) is pushed from the dining room:
0.2 s reach → 0.5 s ease-out to 90° into the kitchen (push thud + frame-pass whoosh) → released
from rest, θ = 90°·e^(−2τ)·(cos 4.6τ + 0.43 sin 4.6τ): through the frame at 0.43 s to −23° into
the dining room, through again to +6°, once more, the check blends the last 0.3 s to rest —
2.8 s in all, a whoosh on each pass scaled by angular speed, a bumper thud on the settle. Behind
it a dim vestibule in the pass-through's `kitchenDim` (walls, floor, a wire shelving silhouette,
a mop bucket) with two `rockerLit` glow strips — no lights. Both are shadow-once: `consumeSettled()`
is true exactly once when a leaf comes to rest and `index.ts` calls `invalidateShadows()` then, not
per frame. Neither blocks sprint/jump (the player does not move). Reach 1.5 / 1.6 m — the service
aisle is walkable round the L-return, so both are reachable on foot.

**3 · Implied presence** (`scene/Presence.ts`, `procedural/presence.ts`). One 1024² atlas
(`presenceAtlas`, registered in `SHAPES`/`texWorker`; map + roughness + normal) holds four
materials — 2/1 basket-weave cotton canvas with hand-wipe grime and two ragged coffee blots,
rust stockinette knit, an aged newsprint page (masthead, rules, columns, a halftone photo), toast
crumb + dried yolk — plus a flat lipstick-red strip, so every soft prop is one `presence` bucket.
The apron hangs from a hook by the pass-through: a 20 × 32 loft of six catenary pleats opening
toward the hem, gathered waistband, straps; the cardigan is a lofted mound over stool 6's seat
with a rolled collar, a sleeve hanging down the front and three buttons; booth 2 has a plate
(lathe) with a bitten toast crust (extruded, UV'd to the toast tile), a yolk smear, a fork and
crumbs, and a folded newspaper (three lofted leaves over a fold, newsprint on both faces); the
cup on the saucer at stool 3 keeps 2 cm of cold coffee and a lipstick crescent on the rim opposite
the handle. Everything static is appended into the scene's existing material buckets by
`core/mergeInto.ts` (`mergeIntoHosts`: find a non-instanced `name:material` mesh with the same
material, merge geometries, recompute bounds) — 9 buckets hosted, 0 new draw calls for the
statics.

**4 · Kitchen presence audio** (`audio/ambience/Kitchen.ts`, positions `kitchenSink` / `kitchenRadio`
just behind the pass-through opening). Muffled talk murmur (pink noise through a wandering
320–700 Hz band-pass and a 900 Hz low-pass ×2, a 3.5–5.5 Hz syllabic envelope inside 1.5–4 s
phrases with 0.6–2.5 s gaps, a lower "cook" register answering 30 % of the time — no formants,
never a word), dish clusters (2–5 inharmonic ceramic contacts low-passed at 3.8 kHz + a cutlery
tinkle, every 20–60 s), the tap running 3–6 s (stream hiss + splash burble + valve onset + drips,
every 20–60 s). Harness (`tools/audio-harness.mjs`, `kitchen` bus, 40 s): **−48.2 LUFS at the
counter** (service aisle at the brewer, 1.7 m), −51.4 aisle centre, −56.6 at the door; the aisle
bed is −36.1 LUFS (was −36.2). One-shots (`--scenario=sys9`, 1.2 m from the cabinet, 3.9 m
from the kitchen door): footfall −28.6 dBFS, sip −32.1, catch release −31.0 / close −20.6,
kitchen-door push −30.6 / pass −32.9 / settle −26.5; no discontinuities.

**5 · Player controls** (`player/FirstPerson.ts`; keys documented under System 7 "Controls" and in
the loader). Shift blends the top speed 1.4 → 2.6 m/s over 0.2 s with the same accel/decel
times, head-bob 1.8 → 2.4 Hz and 1.4 → 2.2 cm p-p with speed; Space is one 0.32 m hop under
9.81 (0.51 s), 2 cm landing dip over 0.15 s + `sfx.footfall`; E is the prompt action, Q (or E
seated) stands. Both refused seated and mid-interaction (`blocked()`: pouring, drinking, in the
door swing). Harness (live `__player.keys` + `update()`): walk 1.4 at 0.15 s; sprint 1.45 → 2.6
over 0.2 s, release 2.55 → 1.4 over 0.2 s; bob p-p 1.39 / 2.08 cm walk / sprint, **0 at rest**
and after stopping; apex 0.320 m, flight 0.508 s, dip −2.0 cm at 67 ms, 0 at 150 ms, one footfall;
collision holds mid-hop; blocked → speed 1.4 / sprint 0 / apex 0; seated → speed 0, camera still.

**Verification.** `tsc --noEmit` and `npm run build` clean. Live openables harness 17/17
(target pick from the aisle, anticipation beat, 95° at 0.8 s, label flips to "Close", closed at
0.75 s, other door untouched, kitchen door 90.0° → −23.0° → 3 frame passes → rest by 3 s,
`blocked()` false during a swing, seeks deterministic); drink harness (3 sips → empty → Pour
re-armed → refill; seeks deterministic). **Draw calls vs `origin/main` (same build, same GPU,
other agents shooting):** boot 179 → 183 (+4), `door` 197 → 197, `aisle` 265 → 269 (+4),
`warmer` 217 → 225 (+8), `counter` 263 → 273 (+10), `length` 306 → 316 (+10) — six own meshes
(two cabinet leaves × {laminate, chrome}, the kitchen leaf, the presence bucket), doubled where
the transmission pass draws the opaques twice. Triangles 1.220 → 1.225 M. Boot 33.7 → 34.2 s
under the same contention (+0.5 s, within the run-to-run noise of a shared GPU). `tools/gpu.mjs`
passes.

### Lessons
- **"Merge into the existing buckets" needs a host.** Palette materials that only live on an
  `InstancedMesh` (the mugs' `bisque` foot ring), on a per-prop clone (`vinylRed` on the booths
  is a different instance) or nowhere yet (`orangeBand`) have no mesh to join, and each became
  its own draw call — the probe (traverse for meshes under `sys9`) found 11 where the design said
  6. Check the host list before choosing a material; when there is none, paint the colour into
  an atlas you already own (the lipstick strip) or pick a hosted neighbour.
- **Transmission doubles every opaque draw.** With glass in view the renderer draws the opaque
  list twice, so a "+6 meshes" budget line reads as +12 in `counter`/`length`. Budget own
  meshes, not draw calls, and measure at the transmissive poses.
- **A door you cannot see is a wall.** Overlay doors in the same laminate as the die, lit flat
  from the service side, were invisible in the frame (the grain ran straight through). What
  made them read was not geometry but a shadow gap — a 4 mm dark reveal — plus a pull.
- **Release a swing door from rest.** `θ = A·e^(−λτ)·cos ωτ` has velocity −λA at τ = 0, a
  visible kick after an ease-out push; the `(cos + λ/ω·sin)` form starts at zero velocity and
  the hand-over is continuous. Blend the last 0.3 s to zero rather than cutting at an envelope
  threshold (a 1.5° cut is 23 mm at the free edge).
- **Seek before the timeline exists.** `drink.seek(t)` on an empty mug is meaningless; the
  debug seek fills it first (`pour.seek(6)`), and the harness must do the same or the results
  are order-dependent.
- **Harness time is float.** Stepping `0.8 s` as 96 × 1/120 lands at 0.79999; a state that
  flips at exactly `end` reads one frame late. Step past the end by a frame.

## System status

| # | System | Status |
|---|---|---|
| 1 | Interior geometry and floor plan | **done** (rev 4 close-out: empty L-return, footrail at 200 mm on cast brackets, bell pedestals, head bulkhead + 25 mm wall angle, 60 × 40 caps, 100 mm saddle + stepped exterior slab) |
| 2 | Booth and counter detail | **PASSED at rev 7 (`9adefff`)**; System 3 rev 1 polish: 3 condiment sets on 9 stools (centred between stool pairs), boomerangs in two classes (32–38 mm + 15–20 mm) with a few outline-only shapes, channels pillowed 4 mm outward with the 1–2 mm valley at the welt, stool seats with a 17 mm crown + 10 mm roll over the band, near-white granular sugar. Rev 7 was: flicker audit + fixes (see Lessons); stools built per stool into the merged buckets (no instancing): ±6 mm column height, any yaw with the welt junction + boxing seam travelling with it, ±5 % squash, 250 × 200 mm sit-hollow 6–9 mm deep in its own shade, one 2.5° worn swivel, three chrome wear grades (roughness 0.07/0.12/0.17), four bolt caps per base; glass `transmission 1`/roughness 0/thin, granular sugar top tilted 7° at 75 %, grey-blue granular salt standing in front of the pepper; black SplashGard funnel (Ø 178 × 100, paddle handle) in the rails, stainless fill lid so one black warmer disc tops the hood, 7 mugs staggered ±15 mm on the mat; napkin tip with folded leaf + crease, domed cast pedestal with collar, pass-through surround in wall-trim paint. Rev 6 was: A1 veneer at true scale (lines 1.5–2.5 mm, one decaying cathedral per 0.5 m, ≤ 9 % contrast, per-panel UV jitter + flips; oak caps / walnut panels + die / maple cabinets + fan blades kept); A2 cords proud of the channels (centre +1 mm over the crowns, 6 mm, baked line shadows, 6 puckers in the last 30 mm at both tucks), 6 mm piped head-roll seam, seat welt + boxing seam + dark top-stitch line at the nose, 6 mm welt torus round every stool seat over a 1" band; vinyl roughness ≈ 0.32–0.5, grain normal 1.25, clearcoat 0.1. B1 boomerangs as straight-armed 100–130° elbows with rounded tapered tips, 28–52 mm, ~3.5 / 100 cm², three tones, on a 2048 px / 1.2 m tile (no repeat on a table). B2 one fluted jar (14 cos² ribs, 2.5 mm) in `glassFluted` (10 mm refraction thickness) with the sugar at 97 % of the bore to 65 %, full-diameter 12 mm lid with 1" side-hinged flap; S&P 1.5 mm glass walls, fills at 97 % of the bore to 60 %, opaque `salt`. B3 hood in light `stainlessCool` (albedo 0.6, roughness 0.3, anisotropic, room probe) with black control band + black 150 mm warmer discs top and base, stainless base plate over a black base, 25 × 14 mm lit rocker switches with pivot line. B4 mug 7–8 mm walls / 13 mm floor / 6.5 mm rim, dark `bisque` foot ring, stubby handle; 8 spares inverted on a ribbed rubber bar mat, 2 upright, saucers only at the two stools. B5 stools: seat parts pivot on the column top with ±1.2° tilt, ±10 mm height, ±5 % cushion squash, ±10 mm pitch with two nudged 22–30 mm. C: 2" fluted T-mould with 4 grooves on the counter, 28 mm push bar on cast rose/post/saddle standoffs, 4.5" × ½" five-rib saddle threshold, 5 mm dark-steel spider plate with 4 screws on a dark-sealed underside, ½" troffer recess in a 1" frame, shaped cast fan irons with bosses, 1.8 mm rolled dispenser lid edge. Rev 5 was: mugs are `MeshPhysicalMaterial` ivory china (opaque, roughness 0.15, clearcoat 0.6, env 0.45; runtime probe confirmed transmission/transparent were never set — the rev 4 "frosted" read was a shaded white body mirroring the counter); Skylark laminate as sparse (~30 %) round-capped stroked chevrons, three tones pulled toward cream, non-touching; Tablecraft-221 dispenser in smooth `stainlessBrushed` (roughness 0.2, anisotropy 0.4 — at 1.0 the sun lobe whited the face) with 70 × 22 slots on both long faces, napkin fans, flange lid, rubber feet; BUNN tower in matte `blackPowder` with brushed stainless side panels and a Ø 190 × 110 stainless funnel with forward handle; channel depth 20 mm with 6 mm cords riding 2 mm under the crowns, vinyl #A8141C roughness ≈ 0.3–0.4, 0.4 mm grain, clearcoat 0.15; veneer ridge pitch 1–4 mm with ~300 mm cathedral figure at ≤ 12 % contrast (caps satin 0.3, laminates 0.5); shaker fill fitted to the glass, half-moon side-hinged sugar flap, 13 mm troffer reveal. Rev 4 was: prop-side reflection probe (no checker in glassware), opaque #2A1408 coffee at 55 % with fill line/meniscus/tide line, 12 mm D-handle facing the aisle, 100 mm-deep funnel; opaque ivory mugs (roughness 0.14, env 0.2) inverted on 140 mm saucers on the drip tray + 3 loose uprights + `pourMug`; Skylark boomerangs as bent chevrons (62/72 mm, 12–15 mm, tan/grey-blue/white, ~40 %); three grain sources via `woodVeneer` (oak caps, walnut panels/die, maple cabinets); seat boxing seam 25 mm below the crown, brighter valley cords, ±3–4 mm puckers; stools ±8 mm height/±10 mm pitch/±25 mm off-line, concave rim band mirrors the checker; Tablecraft-221 dispenser with 52 × 42 arch, napkin tip, lid seam; bright 4" saddle; kitchen box with its own emissive ambient. Rev 3 was: — 5 mm welt cords proud in every channel valley + 7 mm roll-seam and boxing-seam welts, puckers at both tucks, broad sheen (roughness map 0.35–0.55, clearcoat 0.25); 512 px interior-capture PMREM; irregular vertical veneer grain on end panels/counter die/cabinets (contrast 0.10), horizontal cap grain; T-mould with 3 real 2 mm grooves + returned lip, 38 mm tops with sparse two-tone boomerang; counter sheet seams every 3.6 m; steep-rimmed bell stool bases that mirror the floor, per-stool rim seam, ±12 mm height/±25 mm offset; footrail elbow + return flange; 300 mm brushed spider plate; BUNN VPR brewer with one lower + one upper warmer, deep SplashGard funnel, brushed body; 173 × 178 decanter with opaque 55 % coffee, fill line, tide line, black collar/handle, stainless base ring; closed 98 × 117 × 184 dispenser with recessed faceplates and one napkin tip; 12-flute sugar pourer at 65 %; glass shakers with visible fill; glossy waisted mugs (roughness 0.1); 6 mm prism troffer lens; 14 mm fan blades; alu threshold plate |
| 3 | Windows, blinds, exterior view | **built, rev 4 (branch `sys3-rev4`; frames `shots/sys3-{window,door-glass,lot-wide,dbg-sedan-front34,dbg-sedan-rear34,dbg-pickup-side,dbg-pickup-front34,dbg-pickup-rear34,dbg-wheel,dbg-wheelstop,dbg-wall-road}.png`)**. Rev 4 (two critics passed everything but the vehicles and wheel stops): **1** panel shut lines as real grooves in the loft (6 mm wide × 8 mm deep dark walls/floors in their own geometry, door cuts on both cars, trunk-lid leading edge, 6 cm cab–bed gap; hood↔fender and deck↔quarter cut strips 2.5 mm proud), one pull per door (pickup 1, sedan 2 per side) just ahead of each rear shut line; **2** glass cut out of the body loft and rendered as a blended dielectric pane (`makePaneGlass`: Schlick Fresnel α = 0.38 + 0.62·F, premultiplied custom blend, still in the opaque list for the transmission pass, inner faces 12 % reflection) over a cabin lining (the loft flipped inside out), padded dash + binnacle, tilted steering wheel with three spokes and column, seat backs / cushions / headrests on posts (sedan), bench (pickup), rear shelf; A-pillar and C-pillar edges raked by quad splitting; windshield shows wheel + dash silhouettes in `dbg-sedan-front34`; **3** wipers as pivot post + nut + arm + hinge + blade + rubber, parked along the cowl channel 60 mm below the glass base at 12° rake, lower part behind the hood's trailing edge; **4** wheels: lathed tyre (sidewall bulge, 8 tread grooves, bead, sidewall/tread tones in the vertex colour), painted steel rim with lip + 5 lug nuts + centre cap (pickup) or full chrome cover with dish rings + black medallion (sedan), radial brake-dust vertex colour, dark drum behind; tyres fill the arches (superellipse p = 2.6 flattened arch on the sedan, p = 4 rounded-rectangle on the pickup); **5** pickup re-proportioned: front axle 0.72 m behind the nose (WB 3.0), windshield base 0.64 m behind the axle (21 % WB; measured in `dbg-pickup-side` at native resolution: axle x = 404, A-pillar base 637, rear axle 1264 → 233 / 860 px = 27 % axle-to-cowl (rev 3: 41 %), body nose 160 → 28 % front overhang, bumper 112 → 34 % (rev 3: 42 %)), door cut at 1.42, full-width chrome-framed fascia with twin round sealed beams per side (concave chrome bowls, fluted domes) flanking an egg-crate grille; **6** both door mirrors 150 × 100 × 70 mm painted heads on chrome arms; **7** wheel stops: 1.83 × 0.20 × 0.14 m (72" × 8" × 5.5") precast bars with 6 mm chamfers, two dark rebar pin holes 0.46 m in from each end, centred in the stall (0.44 m clear each side), ±3° skew; noses parked 0.37 m (pickup) / 0.48 m (sedan) past the bar face, tyres 8–10 cm short of it. Polish: **8** blinds — one 6–10 mm sagging slat and one creased slat (outer 15–25 cm twisted 14–25°, tip drooping 8–15 mm) per blind at seeded heights 66–94 % down the drop (the band a seated or standing eye actually sees — measured in `window`: sag slat 9–12 px between ladders ≈ 6–8 mm at 1.5 px/mm, kink tip 12 px down with the twist reading edge-on; every other slat within 3 px end to end), the last blind in the row pulled up 15–30 cm, closed 27 × 19 mm bottom rail with end caps and two cord buttons, cream acorn tassel (17 × 50 mm) on a 2 mm cord pair; **9** horizon as three ridged-noise range layers with a clear tonal step fading with distance, scrub edge broken by a noise-graded shoulder with a parallel pair of tyre-track ruts running from the road to the wall gap (visible through the gap in `dbg-wall-road`; rev 3's ruts were wound face-down and back-face culled — see Lessons), six distinct creosote / mesquite silhouettes merged into one mesh; **10** headlamps with reflector depth and lens fluting, bumper guards in mirrored pairs flanking both plates. Also fixed in the final pass: the loft's belt ring sat *above* the hood/deck top ring wherever the panel is lower than the belt line, folding the skin outward so its underside showed as a 4–9 cm black lip along the far hood edge on both cars (`dbg-pickup-front34`, `dbg-sedan-front34`); the belt ring is now clamped 3 cm under the top ring (see Lessons). Sedan kept as the 1977–90 box Caprice (see Lessons). Boot 12.6–13.0 s in the harness with parallel agents on the GPU (main `f642bac` shot beside it measured 37.6 s under the same contention, so the number is load, not the branch); draw calls at boot 167 (main 173), `lot-wide` 237 (main 237), `door-glass` 139 (main 133: +6 = the two blended car-glass/lamp-glass meshes and the extra dark/chrome/wheel buckets); triangles 1.28 M (main 1.24 M). Rev 3 (critic items A–F): **A** vehicles rebuilt as lofted bodies through 24-point cross-sections (`Station`/`loftBody` in `Exterior.ts`: 20 mm sill radius, side bulge to the belt, tumblehome to a 70–90 mm roof radius, plan taper at the ends, analytic normals with one-sided tangents at the hood/roof creases) with the wheel arches cut into the lower edge so four lathed tyres (rounded shoulders, sidewall bulge, 0.19 m bead) show under the fenders; ride height 0.31 m sill / 0.35 m tyre (sedan), 0.42 / 0.38 (pickup); chrome bumpers 0.45–0.58 m with rubber guards over a painted valance; sealed beams (2 × round 5¾" per side on the pickup, 2 × rectangular on the sedan) as glassy `MeshPhysicalMaterial` lenses in chrome bezels; amber signals; egg-crate grille texture (`grilleTexture`); plates front + rear (`plateTexture`); door mirrors on chrome arms, wipers on the glass, chrome pulls, rubber + chrome side moulding, drip rails, shut-line slivers, wheel-well liners and underbody mass; glass metalness 0 (rev 2's 0.55 tinted the sky reflection black — see Lessons), dust-film paint (`carDust` map + roughness). **B** route holes 12 × 6 mm ovals (annulus-triangulated patches in the slat mesh) — 5 px at booth distance, showing whatever is behind (`crop-route-hole`). **C** slats are real per-blind geometry (`appendSlat`): tilt 25 ± 5° per blind, drop 0 or 3–8 cm with the spare slats stacked on the bottom rail, 1–3 mm parabolic sag between ladders + free-end droop, 1–3 creased slats per run, ±2.5° per-slat jitter, ±4 % tone via vertex colours; ladders front + rear with rungs; 25 × 38 mm pale headrail; moulded plastic tassel in slat colour (the `lot-wide` "dark 15 cm band" is the window's transom bar behind the slats, not the headrail — see Lessons). **D** Ø 0.6 m poured piers 0.75 m high with chamfer, grout collar, steel base plate, four anchor bolts + nuts and a pole flange; 150 mm kerb + 0.7 m gravel strip along the CMU base; 90 mm precast cap with 25 mm overhang; two-lane frontage road 16 m behind the wall (shoulders, edge lines, faded centre line) with creosoted utility poles / crossarms / insulators every 38 m and 1 px catenary wires; 110 instanced 1–2 m creosote bushes (stem fan + olive foliage clumps). **E** verified, no leak: with the spot off (`sunLot` only) the room has no sun patches at all; the "unstriped" wall patches in `length`/`counter` are the last window's blinded throw on the end wall — striped at 2–3 px pitch (oblique compression + penumbra), invisible at frame scale; the seat patch in `stripes` is shadowed vinyl mirroring the bright window. **F** door smudge redrawn as a palm-heel smear arc + scattered fingertip dabs + diagonal drag streaks (nothing periodic), alpha × (0.3 + 0.7·(1 − N·V)²) so it brightens at grazing angles (`crop-smudge`). Draw calls unchanged (114–271 by pose, worst `length`); triangles 1.30 M. Rev 2: two-light sun split (spot for the building, directional + caster-only cone for the lot — see Lessons) so poles, cars, stops and the CMU wall cast onto the lot; exterior fill ×0.45; A1/A2 measured and documented as critic mis-reads (`crop-wall-under-sill`, `crop-stripes-rectified`); blinds: 1.3 mm ladders front + rear with a rung under every slat, 10 × 6 mm route slots with the lift cord through them, ±2.5° tilt jitter + 3–4 kinked slats, ±4 % tone, enamel crown highlight (smooth 0.3 roughness base + sparse dust streaks to 0.6, metalness 0.1, env 0.7), 1" × ½" bottom rail with end caps, headrail + valance lip, 12 mm tan tilt wand (0.5 m, right jamb), two pull cords + equaliser + turned-wood acorn tassel (left jamb, ending 15 mm over the stool); cars re-bodied (lofted profile with sloped hood/trunk, raked pillars, flared arches, rocker, door shut lines, B/C pillars, drip rails, chrome bumpers/belt line/mirrors, sky-reflecting glass, recessed lamps); 1.8 × 0.15 m trapezoid concrete wheel stops; 3 more branching cracks with 3–4 cm black filler, oil blotch at a stall head, tyre scuffs; CMU tones randomised per block on an 8 × 4 tile; satin stainless push-bar mounts; sky brightened toward the sun azimuth with a haze band at the ridge foot and a fainter second range; scrub in three size classes / three tones with down-sun contact-shadow decals; ceiling/fan/overlays/car trim no longer cast (draw calls 179–338, worst `length`, with the per-frame shadow passes; lower since the shadow maps are rendered once at boot — see Startup). Rev 1 was: venetian blinds on all five windows (none on the door: the reference diners keep the door pane clear for the OPEN sign and the view of who is coming), instanced curved 1" slats at 22 mm pitch / 45°, ±0.5° tilt, ±0.3 mm sag, a kinked slat per window, ±4 % tone, dust streaks on the up-faces, rails, two ladders + lift cords + wand each; slats cast the hard stripe shadows through the existing sun (tight 3.3 mm shadow texels). Window/door glass `MeshPhysicalMaterial` T = 1 with the 12 % loss in the colour, IOR 1.52, 6 mm, green-grey attenuation, room-probe reflection, dust haze heavier at the lower edge/corners, wipe streaks, five handprints at push-bar height (roughness patch + haze decal). Exterior: 150 mm kerb + 1.5 m sidewalk, 12 stalls of re-striped asphalt (drift, tyre polish, sealcoat patches, alligator + long cracks with dusty/sealed fills, oil drips, old + new lines) over a plain surround, kerb stops, 1.2 m CMU wall at the far edge, two 7 m light standards on concrete bases, dusty white pickup (5.3 m, 2.9 m wheelbase, 0.71 m tyres) and maroon sedan (4.9 m, faded clearcoat) with dark glass, chrome bumpers/trim, recessed headlamps with chrome bezels, contact-shadow decals, `lotEnv` probe; desert dirt with 900 instanced scrub patches, fBm mesa/ridge ring fading into the sky, shader sky dome (near-white horizon → pale desaturated blue, sun glare on az 38° / el 35°), linear fog 45–260 m for atmospheric perspective. Draw calls 181–335 (worst: `length`). |
| 4 | Lighting | **built, rev 1** (`shots/sys4-*.png`, post on; `shots/sys4-raw-*.png`, `?post=0`). Physical units at K = 1e-4 with camera exposure ISO 100 f/5.6 1/160 (EV 12.29, grey 1,080 nits, AgX); 90 klux 5500 K spot sun with PCSS (0.53° disc, 3.5 mm texels) + directional lot sun; sky dome scaled to 5,500-nit horizon with circumsolar boost and baked into split PMREM probes (sun-off for dielectrics, sun-on for metals); 8 × 7,500 lm 4100 K troffer RectAreaLights with 4,500-nit lenses; window sky fills + floor-patch bounce RectAreaLights; contact-occlusion decals; `sunBeam` compare-map twin so System 8's dust/haze keep working under BasicShadowMap. Measured: sunlit vinyl stripes +0.9…+1.7 EV, table core +3.8 (clips), sky through slats +2.3…+3.1, counter top −1.1…−1.3, die −2.7, seat in shade −2.9 — see REFERENCE §8 |
| 5 | Materials and textures | **built, rev 1 (textures)**, merged into `main` over System 3 rev 3 + System 8 — the light-independent half: floor wear/grout relief, wall stipple/seams/scuffs/fade, fissured tiles + stains/sag/tee chips, laminate wear + cup rings, pebble-grain vinyl + cracked welts on one booth, brushed/fingerprinted/scuffed metals, cap arris wear, door dressing (OPEN/hours/PUSH/cards/kick plate/film edge), carafe stain + scratches. See "System 5". Roughness/metalness/colour/envMapIntensity base values untouched (System 4 owns them). |
| 6 | Sound design | **built, rev 3** (section above) — 100 % synthesised: AM-radio speech rhythm, AC drone + rattle, fan whoosh, warmer ticks/gurgle, room tone; pour / clink / door one-shots and the exterior heat wall. Rev 3 measured the live mix at six listener poses (BS.1770 LUFS per bus) and re-levelled it: aisle bed −36.2 LUFS, room −44.5, AC / fan / radio −35 / −39 / −33 at 1 m, warmer near-field; pour lands with the stream, clinks −12 dBFS, heat wall −26 LUFS with an equal-power swell, room ducks 3 dB while the door is open, latch on close |
| 7 | The 3 interactions (sit, pour coffee, open door) | **built, rev 2 — feel polish** (`shots/sys7-seq-{sit,pour,door,door-ext}.png` time-series sheets + 18 key frames from `tools/sequence.mjs`; anticipation beats, arced/tilting pour with continuity-thinning stream, drips and volume-true fill, closer-profile door with hold-while-in-doorway and latch SFX, four-beat sit with lean and cushion settle, System 8 `SteamEmitter` reused (duplicate `interactions/Steam.ts` deleted), first-pour 0.7 s link hitch removed; player accel/decel 0.15/0.12 s, 1.4 cm head-bob, push-out collision that slides round stool bases — see "System 7 rev 2" above). Rev 1 was: (merged into `main` over the loader + System 3 rev 2: shadow-once invalidation on door/pour, audio on the loader's enter click, pour programs pre-issued) — `src/interactions/*` + `src/audio/wiring.ts` (System 6 wired: gesture start, positional beds, pour/clink/door SFX, exterior crossfade). Frames `shots/sys7-{sit-seated,pour-mid,pour-full,door-open}.png`; 23/23 live Playwright checks; update ≈ 0.01 ms; +6 draw calls only while pouring |
| 8 | Post-processing and final polish | **built, rev 1** (`src/post/`, section above), merged with the loader + System 3 rev 2 (spot sun, shadow-once — see "Integration" above) — MSAA 4× scene target, sun-beam dust (5 k shadow-map-lit motes), half-res volumetric haze through the beam prisms, exterior-only heat shimmer, ambient decanter steam (`SteamEmitter`; System 7 rev 2's pour steam is a second instance of the same class), high-threshold bloom, CA 0.5 px, 0.3 EV vignette, corner softness, ACES/AgX/Neutral tone map, luminance-dependent procedural grain; ~1.3 ms post + ~1.3 ms MSAA at 1080p on the 4060; `?post=0` bypasses everything |
| 9 | Extended interactions and implied presence | **built, rev 1** (branch `sys9-interactions`, section above; frames `shots/sys9-sys9-*.png`, sheets `shots/sys9-seq-{drink,cabinet,cabinet-close,kitchen-door}.png`) — drink from the mug (1.6 s camera-attached raise, ⅓ per sip, volume-true, steam with level, Pour re-arms under 15 %); openable cabinet doors (soft stop, magnetic catch SFX, shelf of saucers/filters/spray bottle) and a double-acting kitchen swing door (push to 90°, spring return with two decaying oscillations, dim vestibule, no lights), shadow-once at rest; implied presence — apron on a hook, cardigan over a stool, half-finished plate + folded newspaper in booth 2, lipstick cup at the counter — on one atlas material with the statics merged into existing buckets; kitchen presence audio (murmur, dishes, tap; −48 LUFS at the counter, aisle bed unchanged); Shift sprint / Space hop / E + Q keys. +4…+10 draw calls by pose, 6 own meshes |

Known simplifications after System 3: no heat shimmer (System 8 post), no
chain fence, the cars have no interiors (dark glass hides it at 10–30 m), the
sky has no clouds, L-return top empty (register is a later prop),
kitchen box holds dim grey silhouettes only, no second (restroom) door on the
far end wall, the troffer lens prism pattern is a faint 6 mm cell map +
normal map, cap rails have no separate end-grain material. After System 4:
the lot asphalt sits at +1.4 EV rather than the brief's +2.5 (its albedo is
0.135; System 5 can pale the sealcoat), the sky through the slats peaks at
≈ +3.1 EV rather than +3.5–4.5 (raising the dome lights the room through the
glass and flattens the lot shadows — REFERENCE §8 Lessons), the chrome does
not "blow out" because the stools' sun highlights are small at 1080p.
