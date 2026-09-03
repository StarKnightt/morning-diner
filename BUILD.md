# Morning Diner — build notes

A first-person walk through a small American roadside diner at 6:45 PM on a hot summer evening (rev 7 evening preset; 8 AM until System 4 rev 6.1). Three.js
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
                          program in parallel, bakes the three probes once (+ station probes for
                          materials that ask, `userData.probePos`), owns colliders and per-frame
                          animation, `invalidateShadows()`
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
    Signage.ts            exterior signage, name in `DINER_NAME`: roadside pylon at the entrance gap
                          (lit 2.4 × 1.5 acrylic cabinet ≈ 2,000 nits, reader board, sheet-metal star,
                          arrow cabinet with instanced bulbs ≈ 10,000 nits + dead ones, rust-streaked
                          pole, footing), parapet channel letters (11 alpha-tested return slices +
                          lit face + neon-stroke layer on a raceway), AIR CONDITIONED + WELCOME enamel
                          panels at the door. Main-thread canvas text; lives inside the `exterior`
                          group (lot probe / lot sun / lotCaster). Poses `sign-{pylon,facade,door}`
    Lighting.ts           System 4: the physical light rig (see "System 4" below). `K` scene scale,
                          `CAMERA`/`EV100`/`EXPOSURE`, `configureRenderer()` (AgX, exposure, sRGB,
                          BasicShadowMap + `installPcss`), `sunDirection()` (az 38° / el 35°),
                          `buildLighting()` (spot sun with PCSS + detached `sunBeam` twin for post,
                          directional lot sun, troffer / window / floor-bounce RectAreaLights, sky
                          dome scaled to nits), `installShadowMasks` (per-light caster lists,
                          shadow-once), `buildContactShadows()` (multiply decals)
    Openables.ts          System 9: under-counter cabinet bay (carcass, shelf, saucers, filters, spray
                          bottle; two overlay laminate leaves, one CPU-baked mesh, chrome by vertex alpha)
                          and the kitchen swing-door leaf (paint + satin plates by vertex alpha - a
                          box-projected, brush-stretched mirror of a probe captured at the door -,
                          vision pane, scuff decal) + the lit kitchen slice behind it (Shell.ts keeps
                          the casings only)
    Presence.ts           System 9 implied presence (rev 3): a chrome hook by the pass-through, the
                          finished plate setting in booth 2 (plate, fork, crumbs, yolk film), the
                          lipstick cup on its saucer — lathes + lofts, decals on `presenceAtlas`,
                          statics merged into existing buckets
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
    presence.ts           System 9 atlas: wall tile, quarry floor, lipstick print, yolk film, crumb,
                          box label, #10 can label, cart-scuff transfer, residue ring, dreg, contact AO
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

## Parallel builds — worktrees

Every builder works on its own branch in its own `git worktree`. **All worktrees
MUST be created under `C:\Code\morning-diner-wt\<name>`, never as siblings of
the repo in `C:\Code`:**

```
git worktree add ../morning-diner-wt/sys4-rev6 -b sys4-rev6
```

`C:\Code\morning-diner-wt\` lives outside the repo and is the only place a
worktree may go. Pick a `<name>` that matches the branch. Run the capture
harness from inside the worktree with its own `--port` (see "Running the
capture").

**Every builder must remove its own tree when done** — after the branch is
merged (or abandoned), from the main checkout:

```
git worktree remove ../morning-diner-wt/sys4-rev6     # --force only for ignored build output (dist/, node_modules/, shots/, tmp/)
git worktree prune
```

Leave the branch alone (branches are kept for history); only the working
directory goes. Stale trees left behind fill `C:\Code`, hold ports, and cost a
`node_modules` each — do not leave them.

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
- **Wear that lives only in roughness is invisible here (System 5 rev 2 root
  cause).** Every rev 1 map was bound and correct; the critic saw none of it
  because the lanes, rings, haze, scratches, burnish and etch were roughness
  changes and the rig reflects a dim, flat ceiling into those surfaces: a
  0.95 → 0.25 roughness swing on the whole floor moves the white tiles 1.5 Y,
  and `envMapIntensity` 0.1 vs 1 changes nothing (probes and lights, not
  `scene.environment`, light the floor). Albedo changes of 1–5 % are film
  grain after tone mapping. Rule: anything the frames must show is a 10–30 %
  albedo step or geometry; roughness is the second layer, never the carrier.
  Prove it with a probe (`material.map/roughnessMap` bound? map dumped? then
  swap the map for a constant and measure the frame) before touching a
  generator.
- **A 1-texel antialiased line magnifies into beads.** At 3.75 mm per floor
  texel the hairline crack drawn in the map rendered as a string of dots
  (bilinear reconstruction of a sub-texel diagonal). Hairlines are geometry:
  a 2 mm ribbon along the same polyline (`floorCrackPath`), folded into an
  existing bucket; the map keeps only the soft shadow and the matte band —
  and that band is anti-aliased by distance, not stamped at rounded texels
  (the stamp's stair-steps beat against the line and read as a twisted rope).
- **Mip levels bleed transparent black into decal edges.** With zero RGB in
  transparent texels, every mip averages letter edges toward black, which is
  what made the door signage look blurred at 130 px — not the atlas size.
  Dilate opaque colour into the transparent surround (6 texels) and fill the
  rest with the card colour; then `alphaTest` at 0.02.
- **A `transparent` mesh inside/behind transmissive glass is invisible** (the
  carafe tide line in rev 1); use `alphaTest` + `DoubleSide` so it goes
  through the opaque pass, exactly like the door decals.
- **New material = new draw call, even if it is "just a map".** Fold it into a
  bucket that already exists in that builder (the crack ribbon rides the cove
  base, the push-bar rose rides the kick plate, the spider plate rides the
  dusty bells with its v pinned to the clean row, the seam rides the T-mould)
  or replace the bucket it derives from. Rev 2 added three materials and
  finished at −1…−4 draw calls per pose.
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
- **A loft flank must be one profile, not one per station.** Rev 4 placed the side-bulge ring point at 45 % of the height *remaining above the wheel arch*, so every station over an arch had its own flank curve and the skin "breathed" around the cut-out — the critics' blistered fender with a crease running to the A-pillar. Anchor the flank x(y) at the nominal sill and the belt and only clip its lower end at the arch; the arch itself is a separate constant-width rolled lip.
- **A length tangent along an arch column tilts the normal.** `normalAt` took each ring point's fore/aft tangent from its own column; for the flank points that column climbs the arch, so the normals leaned fore/aft around every wheel and the fender shaded like a ripple even after the geometry was flat. Flank points now borrow the belt column's tangent (`jRef`); only the lip roll keeps its own.
- **A 6 mm groove is not a shut line at 4–6 m.** It anti-aliases to a 1 px grey line (per-row step 28 sRGB on the white pickup, ~6 on the maroon sedan). What reads is depth: an unlit black floor (`MeshBasicMaterial`, no lighting to lift it) plus a paint chamfer either side so the two rolled edges shade differently. Measure the step at native (`tmp/seam.mjs`, per-row minimum vs the panel 6–14 px away — a slanted seam smears a column average) and aim for ≥ 25.
- **Stand-offs are per body.** The sedan's wipers park 60 mm below the glass base in a deep cowl channel; on the pickup's steep, shallow-cowl windshield the same numbers floated the arms 35° up the pane. Branch on glass steepness (dy/dz > 1.2) and park on the glass at 5°.
- **"Lit facet through the cab gap" was the truck bed.** Two rounds of geometry hunting (gap depth, cab-back step, materials dyed red) before a ray probe (`window.__APP.camera` + Möller–Trumbore over every mesh) showed the bright slanted patch is the sunlit far bedside wall seen over the near rail, cut by the cab's shadow. Probe pixels before changing geometry: `__APP` exposes scene + camera for exactly this.
- **Seeded imperfections need the visible END too.** The rev 4 crease was in the right height band but on a random end; the `window` pose clips the +x end at the frame, so half the seeds were invisible. Fix the end (keep the rng call so the rest of the sequence is stable).
- **Colour-code to find a slat.** A per-index dye (`k === kinkK ? red`) in one throwaway shoot located the creased slat in seconds after four blind crops missed it.
- **A shut line is a body-architecture problem, not a groove-width problem.** Rev 5's pickup had the right 7 mm groove and the critics still read a 15 px black "shut line": the door cut sat 8 cm ahead of an unlit 6 cm cab-to-bed gap, the side glass ended 4 cm ahead of the cut, so three verticals disagreed about where the door ended and the eye took the darkest one. The fix was the cab: glass → door frame → shut line → solid quarter → lit gap, each where a real cab has it; the groove itself did not change.
- **A station filter must know what it is filtering.** `!inGroove(z)` was written for shut lines (two stations bracket a 7 mm gap; anything between them is noise). Applied to the 1.95 m bed pocket it silently deleted the rear wheel arch — 21 stations — and nothing failed: the loft closed fine, just straight. Wide grooves keep their interior stations.
- **`LatheGeometry` smooths across profile steps.** Its normals are averaged per profile vertex, so a stepped chrome dish gets normals that rotate across every step and the reflection swirls. Revolve with analytic normals (`lathe()`: hard join above 40°, averaged below) — and author the profile so (dh, −dr) faces the viewer, then check the winding against the normal, not against a guess ((c−a)×(b−a) is MINUS the (a, b, c) face normal; one sign inverted every wheel face to culled-black).
- **A flat mirror at wheel height reflects the lot, not the sky.** The rev 5 cover looked bright because its wobbling normals scattered sky into the dish; with correct normals the flat dish went near-black. Real covers are dished — the concavity is what puts sky in the upper half.
- **Trim follows the surface it sits on, not the feature it decorates.** The rev 6 drip rail was sized from the side-glass span (the thing it "belongs to") and rendered as one straight box; the roof it should lie on starts 30 cm further back at the windshield header, so a third of the rail floated. Any strip along a lofted body is built station by station from the loft's own edge points, and its extent comes from the surface (header to header), not from the glass or the door.
- **Layer order is depth order.** Recessing the tail lamps by pushing the lens INTO the bezel put the lens behind the bezel's solid front face and the lamps rendered black; a flush lamp is bezel face < reveal face < lens face < rib face, each 0.5–1 mm further out.
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

### Rev 2 (branch `sys4-rev2`) — what changed and why

Two critics failed rev 1 on the same measurements: sun : shade on the interior wall 0.3 EV
(target ≥ 2.5), 2–12 % of the frame at 255 with the mid-tones still murky, the sky through
the slats the same brightness and hue as the sunlit wall, troffers reading as painted
rectangles, no ceiling gradient, no cast shadows on the lot, speckled penumbrae, and a
scene pass of 10–14 ms on `length`. The rev 1 fill rig (18 RectAreaLights) was 27 ms of
the GPU frame in a light-isolation bench (`snip-perf.js`), so the rig was rebuilt rather
than re-tuned. Where the paragraphs below supersede the rev 1 text above, rev 2 is what
ships.

**Exposure.** `CAMERA` is now `1/250 s` (EV100 12.94, L_sat ≈ 9,400 nits, middle grey
1,690 nits) and the default tone curve is a camera curve, not AgX:
`installCameraToneMapping()` registers a Hable-style shoulder in
`THREE.ShaderChunk.tonemapping_pars_fragment` as `CustomToneMapping` with display white
at `CAMERA_WHITE_EV = +2.5` EV over middle grey — AgX puts white at ≈ +6 EV and turns the
whole +2 … +6 range into 190–235, which is why rev 1's sunlit table, lens and sky all
landed in the same grey band. With the curve, the sun patches clip (as a photograph's
would), the lens at +1.6 … +1.9 EV reads at 205–229 without clipping, and the shade
side keeps its separation. `?tm=camera|agx|aces|neutral`, `?ev=±n`. `%TEMP%\sys4\camtone.mjs`
inverts the curve + sRGB analytically so a probe reading in nits predicts the 8-bit code
(after night-street's `docs/TECHNIQUE.md`: fitting the display curve from frames came out
2× wrong; invert it). The one AgX-specific adjustment in `materials.ts` (vinyl base pulled
toward orange for AgX's desaturation) was left in place; the camera curve desaturates less
and the sunlit vinyl now reads (184, 38, 32) — a red, not pink or orange.

**Troffers** (item 1). The 6 RectAreaLights (one per 2×4 in `CEILING.troffers`) are one
Lambertian SpotLight each — angle 89°, penumbra 1 (the smoothstep cone ≈ cos θ), decay 2,
intensity Φ/π cd with Φ = `TROFFER_LUMENS` 7,500 — 12 mm under the lens, no shadow map.
The lens is emissive at `TROFFER_LENS_NITS` = Φ / (π A) ≈ 4,200 nits through a procedural
`emissiveMap` (`textures.ts` `trofferLens`, registered in `SHAPES`): four tube images with a
1.5× hot-spot over a K12-prismatic grain, 4100 K with the 4 % green bias, so the lens has
the fluorescent signature (tubes read through the prismatic lens, brighter at the centre)
and the counter laminate reflects tubes, not a flat plate. Same construction as
dawn-station's `BuildingSystem.ts` troffers (emissive lens 0xdfe9f2 @ 2.4, spots for the
pools), with the lumens kept physical.

**Fills** (item 2). The 5 window RectAreas and 5 floor-patch RectAreas are gone. What
replaces them is derived at the constants in `Lighting.ts`:

- *Sun bounce, one upward Lambertian spot per booth* (`BOUNCE_FLUX`): the beam through one
  window lands on ≈ 1.75 m² of aisle checker (ρ 0.47/0.45/0.42), ≈ 0.3 m² of cream table
  and ≈ 0.8 m² of red vinyl bench front (ρ 0.40/0.010/0.007); at 22.7 klux (horizontal, ×
  0.88 glass × sin 35° × 0.5 slat duty) / 20 klux (bench fronts) the reflected flux is
  (31k, 24k, 22k) lm-equivalent — 20 % of the red channel is vinyl, which is the pink bleed
  onto the ceiling, table undersides and the wall behind the far bench. Placed at the
  flux-weighted centroid, 0.12 m up. The first window's beam hits the −x end wall, so its
  spot sits *on* the wall and fires horizontally along +x (an up-spot 0.4 m from that wall
  lit the wall it stood for to +0.9 EV over the others — a wall cannot light itself).
- *Sky through the windows*: the room probe sees the dome through the glass at 3.5 m; it
  delivers this without a fill. The rev 1 window RectAreas double-counted it.
- *Fluorescent ambient*: the emissive lenses are in the probe, so the probe carries the
  fluorescent second bounce; the troffer spots carry the pools.
- *Near-field correction*: `scene.environmentIntensity = ROOM_PROBE_INTENSITY` (0.7,
  `?ibounce=n`). A single cube at the counter edge stares at a ceiling and floor 1.3 m away
  that the bounce spots already lit, so it hands back ≈ 1,400 lux-equivalent of second
  bounce on the shaded walls where the flux balance Φρ / (A(1−ρ)) allows ≈ 600. 0.7 halves
  the excess and leaves the sky through the windows (3.5 m off, not inflated) mostly intact.
  dawn-station ships the same correction at 0.35 on a room with no sun (`lightInterior.ts`
  `ibounce`).
- *Kitchen*: two 250 W red R40 heat lamps over the pass-through (≈ 600 lm each through the
  red coating, colour (1.0, 0.45, 0.20)) as a 60° spot + emissive bulb caps (`Shell.ts`);
  `kitchenDim` raised so the box behind the pass-through reads −3.5 EV instead of black.

**Sky** (item 3). The dome is the lighting's: `SKY_HORIZON_RGB` (0.78, 0.86, 0.97) at
`SKY_HORIZON_NITS` = 10,000, `SKY_ZENITH_RGB` (0.15, 0.25, 0.48) → ≈ 2,900 nits at the
zenith, linear gradient, circumsolar ×(1 + cos⁴). The number that was tuned is the
hemisphere's cosine-weighted integral — the diffuse skylight on the lot — computed by
numerically integrating the shader (`%TEMP%\sys4\skyE.mjs`): rev 1's 5,500-nit dome gave
≈ 14 klux; the first rev 2 attempt (12,000 nits, `pow(h, 1.6)`, ×1.5 boost) gave 39 klux
and flattened the lot to 2.5 : 1; the shipped dome gives 23 klux, inside the 15–25 klux a
turbid summer morning measures at 35° sun (CIE 8–10), and the lot to 3.2–3.8 : 1. The
band the windows see (5–25° elevation, away from the sun) is 8–9 k nits → ≈ 7–7.7 k
through the glass → sRGB ≈ 225–248, a pale blue distinct from the clipped sunlit wall
(p50 of `sky-slats-mixed` 8,480 nits, +2.3 EV; `door-glass` sky 7,500 nits, (228, 235,
239)). The System 3 `skyFill` emissive on the lot ground was dropped (the lot probe *is*
the skylight; `?skyfill=1` restores it).

**Glass.** `glass` / `glassDoor` colour `0xf9fbfa` (was `0xedf0ee`): three.js applies a
`DoubleSide` transmissive material's colour and Fresnel twice (once into the transmission
buffer, once on the front face), so the door read 0.69 instead of 0.82–0.88; the square
root of the intended tint applied twice lands at 0.86, and the green cast the critics saw
in the sky is gone. `renderer.transmissionResolutionScale = 0.5` (`?txscale=n`) saves
≈ 1.8 ms on `window`; `installTransmissionLod()` patches `transmission_pars_fragment` so
the roughness-LOD (`log2(bufferWidth) · roughness`) is computed for the full-resolution
buffer — otherwise the halved buffer blurs the lot twice as wide on screen.

**Shadows** (item 4). PCSS: `PCSS_BLOCKER_TAPS` 8 / `PCSS_FILTER_TAPS` 12 (`?taps=b,f`) on a
Vogel spiral; each PCF tap is a *bilinear* tap (4 coherent fetches, `pcssTap`) so the
penumbra is a continuous ramp rather than 24 dithered samples; the spiral's phase is
derived from `shadowCoord.xy · mapSize · 8` (world-anchored) instead of `gl_FragCoord`, which
removes the crawling speckle both critics flagged when the camera moves (night-street's
`softShadow.ts` world-space tap phase). Rev 1's 16 + 24 single-fetch taps cost ≈ 2.9 ms
on `length`; rev 2's 8 + 12 bilinear taps are cheaper and smoother. `sunLot`: 2048² (≈ 16 mm texels on
the lot) with a single bilinear tap (`shadow.radius = −0.25`, the `−0.5 < r < 0` branch in
the chunk) — lot shadows from cars and poles are hard in real life at this scale, and the
sky does the softening. `sun-beam` kept as-is for System 8.

**Lot shadows** (item 5, the merge agent's lead). Checked in-page: the asphalt / sand /
kerb materials sample only `sunLot` (`installShadowMasks` masks `sun` off the exterior
receivers, as designed), and `sunLot`'s depth map does contain the cars, wheel stops,
poles and CMU wall — the cone occluder is a caster with `sunLot` but its disk lands on the
building's footprint, not the stalls (radius unchanged by rev 3/4). Light-isolation frames
at `door-glass` (`?nospot` / `?nolot` / both) show the car and pole shadows on the asphalt
pointing away from az 38° in the `sunLot`-only frame. Two other things were hiding them:
(a) the System 3 contact-shadow decal under each car (`exterior.ts` `contactShadowAlpha`)
painted `rgba(255,255,255,α)` onto a transparent canvas, and `alphaMap` reads the *green*
channel of a texture the browser un-premultiplies on upload — so the decal was an opaque
0-nit disk, the "black hole under the sedan" the critics measured, sitting on top of the
real shadow; it now paints grey on an opaque canvas (204 → 0) and reads as a soft
contact shadow with residual skylight under the sill; (b) the 39-klux sky of the first
rev 2 round flattened lit : shade to 2.5 : 1. With the 23-klux dome, `lot-shadow`: asphalt
in sun 3,585 nits, pole shadow 1,369 (−1.4 EV), car shadow 793 (−2.2 EV), shade side of
the sedan 388 nits vs the sunlit side 5,940 (3.9 EV).

**Vinyl "inversion"** (item 6). The rev 1 EV maps show the sunlit vinyl stripe cores at
+0.9 … +1.7 EV and the shaded vinyl at −2.9, the right way round; the critic's "the shaded
cushion is brighter than the lit one" sample fell on a slat shadow across the lit cushion.
No change; the two-probe split (`roomSpec` sun-on for metals, `room` sun-off for
dielectrics) is intact and the vinyl is a dielectric on the sun-off probe.

**Polish** (item 7). Under-table occlusion strengthened (elliptical, ×0.4 at the centre,
pedestal bell and wall-corner strips added) — `undertable` pose floor under the table
157 nits vs aisle 443 (−1.5 EV). Mugs and saucers sit on `ContactDisc` decals (`Props.ts`,
`buildContactShadows`) so the base leak the critics saw on the counter mat is closed
(`mat-between-mugs` p10 32 nits under the rim).

**Merge.** `origin/main` `7d3600c` (System 3 rev 4: lofted cars, wheel stops, blind
variation) merged at `bb347b7`, theirs for `Exterior.ts` / `Blinds.ts`; the lot frames
show the current cars.

### Verification (rev 2)

HDR probe (`%TEMP%\sys4\probe.mjs`, RGBA16F target, region p10/50/90 in nits and EV over
middle grey 1,690 nits; display codes from the same frame with post on), summary at
`%TEMP%\sys4\out\r2k-summary.txt`. Against the critics' table:

| Measurement (target) | Rev 1 | Rev 2 |
|---|---|---|
| Interior wall, sun patch vs shade (≥ 2.5 EV) | +0.3 EV | `counter`: 6,490 vs 838 nits = **+3.0 EV** (patch core clips, shade at −1.0) |
| Sky through slats vs sunlit wall (sky brighter, blue) | same, grey-green | sky 8,480 nits (+2.3), wall shade 726 (−1.2); sky (201, 202, 201) → clipped centre, blue edges; door-glass sky (228, 235, 239) |
| Lot ground vs sky (lot readable, sky clips first) | both clipped | `door-glass`: sky 7,515 / sand 6,180 / asphalt 3,310 nits — asphalt (189, 183, 177), sky 241 |
| Troffer lens (visible tubes, not clipped) | 190 flat | lens p10/50/90 187 / 215 / 229 (`ceiling`), tubes 1.5× the field |
| Ceiling gradient (window side brighter) | flat | `length`: window-side 608 → back 659 nits with the sun-bounce pink at the front (visible in frame); `ceiling` pose 861 → 830 |
| Vinyl sunlit vs shade | "inverted" sample | `stripes` back cushion 872 nits p50, (184, 38, 32); `booth` shade cushion 140 nits (93, 44, 37) = 2.6 EV apart |
| Cast shadows on the lot | none visible | pole −1.4 EV, car −2.2 EV under the sedan, hard-edged, pointing away from az 38° |
| Penumbra quality | speckled, sinusoidal | continuous ramp, 1 slat gap at the sill → 3 at the far wall, no crawl when the camera moves |
| Black holes | decal under cars 0 nits; `blackPowder` / rubber 1–3 % | decal fixed; `blackPowder` 0x383838, `rubberMat` 0x363636 (3–4 % albedo); every pose `black 0 %` |
| Display clipping (≥ 250) | 2–12 % interior, 5–12 % window | `length` 1.3 %, `booth` 2.9 %, `counter` 0.4 %, `stripes` 4.8 %, `window` 22 % (the sky), `door-glass` 4.5 % |

Performance (RTX 4060, 1080p, uncontended minimum of repeated runs, `post-bench.mjs`):
scene pass 7.7 ms at `length` (rev 1 on merged `main`: 27.3 / 27.7 / 12.7 ms at `length` /
`stripes` / `window`; budget 8), boot 10.0 s (budget 14), 168 draw calls, 1.23 M tris.
Rev 1 attribution by in-page ablation at `length` (`snip-perf.js`): the 16 RectAreaLights
27.3 → 11.7 ms, `sunLot`'s 4096² 8-tap PCF 11.7 → 7.0, the sun's 16 + 24-tap PCSS 7.0 →
4.1 (base incl. MSAA 4). Rev 2: RectAreas gone; `sunLot` 2048² single bilinear tap; PCSS
8 + 12 bilinear (8 + 16 was 0.5 ms more); transmission at half resolution −3.4 ms on the
door / window poses. The dust culling test (System 8) still passes; a sibling agent on the
GPU adds 1–3 ms to any single run, so the minimum is quoted.

### Lessons

- **Tone curve first, fills second** (rev 2). Rev 1 chased the sun : shade ratio by lifting
  fills under AgX, whose shoulder compresses +2 … +6 EV into 190–235: the ratio existed in
  the HDR probe (3 EV) and vanished on the display. A camera curve with white at +2.5 EV
  over grey shows the ratio the probe measures. Always predict display codes by
  *inverting* the curve analytically (`camtone.mjs`), not by fitting frames (night-street
  `docs/TECHNIQUE.md` — their fit was 2× wrong).
- **RectAreaLights are not fills** (rev 2). 18 of them cost 27 ms on a 4060 at 1080p (LTC
  per fragment × overdraw); a Lambertian SpotLight (89°, penumbra 1, decay 2, Φ/π cd) is
  the same far-field irradiance for free. Keep RectArea only where the *shape* of a pool
  matters — here, nowhere; dawn-station reached the same conclusion.
- **Integrate the sky, don't tune the horizon** (rev 2). The lot's lit : shade ratio is
  51.6 klux / E_sky; the horizon nits are a poor proxy for E_sky because the gradient
  exponent and the circumsolar boost move it 2× (`skyE.mjs`: 14 → 39 → 23 klux across
  three domes with similar horizons). Target 15–25 klux for a turbid morning at 35°.
- **A single interior probe overstates the second bounce** near the surfaces it sees;
  scale `scene.environmentIntensity` (0.7 here, 0.35 in dawn-station) from the flux balance
  Φρ / (A(1 − ρ)), not by eye.
- **`alphaMap` reads green, and browsers un-premultiply on upload** (rev 2). An
  `rgba(255,255,255,α)` shadow decal becomes an opaque black disk. Paint grey on an
  opaque canvas.
- **`DoubleSide` transmission applies `color` twice**; author the square root. And halving
  `transmissionResolutionScale` doubles the on-screen blur unless the LOD is compensated
  for the full-size buffer.
- **World-anchor the PCSS tap phase** (`shadowCoord · mapSize`, not `gl_FragCoord`) and use
  bilinear taps: fewer, smoother, no crawl. Taken from night-street's `softShadow.ts`.
- Dark unlit colours (`0x141414` "black" powder-coat) are 0.6 % albedo — a black hole under
  any exposure; real matte black is 3–5 % (dawn-station NOTES cases 24/27).
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

### Rev 3 (branch `sys4-rev2`, on top of the rev 2 merge `4547daf`) — what changed and why

Two critics failed rev 2 with progress acknowledged (wall sun : shade +3.0 EV, `window` /
`stripes` photographic, vinyl right, bounce under the tables, no black holes). The six
blockers they agreed on, and what rev 3 did about each — measured with the same HDR probe
(`%TEMP%\sys4\probe.mjs`, tag `r3p`, every pose in one run at the one fixed exposure;
`grey 1693.44` nits in every pose's summary line, no per-pose `?ev=` anywhere):

**1. Exposure "not locked".** Nothing varied the exposure: `shoot.mjs` has no per-pose `ev`,
there is no adaptive exposure, the probe is captured once. What the critics measured as a
2 EV swing was the room probe: at `environmentIntensity 0.7` it handed the shaded walls
≈ 400 nits of *second* bounce (its cube was captured 1.3 m from a ceiling and floor that
the bounce spots already light), and the poses that see the far wall and ceiling see the
faces it inflates most. Attribution on the `length` shade wall (`?nofill` / `?nobounce` /
`?ibounce=n`, nits): sun + probe 40 → + troffers 130 → + bounce spots (probe 0.01) 180 →
probe 0.35 / 0.45 / 0.7 = 382 / 452 / 650, i.e. 5.8 nits per 0.01 of probe. The flux
balance allows ≈ 90 nits of second bounce on a cream wall; `ROOM_PROBE_INTENSITY` is now
**0.1** (≈ 60 nits), the troffer lenses are emissive-off during the room capture so they
are no longer counted twice, and the counter laminate takes the specular (sun-on) probe at
the same 0.1. Shaded back wall: `length` 221 nits (sRGB 46), `booth` 239 (47), `counter`
332 (56), `lot-wide` 337 (64) — the 0.6 EV between them is the wall's distance from the
window bank (the `length` patch is the far end of the room), not exposure. The `length`
histogram is bimodal (bins 33 / 39 / 14 / 4 / 3 / 2 / 2 / 2 %).

**2. Sky.** `Lighting.ts` sky dome rebuilt as luminance × chroma in nits (`scaleSky`):
`SKY_HORIZON_NITS` 4,500, zenith 0.5×, linear in sin(elevation); chroma
`SKY_HORIZON_CHROMA` (0.34, 0.58, 1) → `SKY_ZENITH_CHROMA` (0.22, 0.45, 1) in √h, each
normalised to unit luminance so the chroma does not change E_sky (`skyE.mjs`: 15 klux,
lit : shade on the lot 3.0 EV). The aureole whitens within 20° of the sun. Display samples
(sky-only pixels, sRGB): `door-glass` (138, 168, 200), `door-open` (142, 166, 195) — the
same through the pane and without it (the probe's rev 2 `door-open` "sky" rectangle holds
the CLOSED sign in that pose; measure sky on sky-only pixels) — `sit-seated`
(134–141, 160, 177–187), `window` (187, 201, 216) on the
sun side. Scene-linear R/B 0.48 in the `door-glass` sky region. The glass is a neutral 6 mm
float (0xf9fbfa, 0.26 EV loss measured, `snip-glass.js`): sand through it 195 vs sky 162
(+0.6 EV), from outside sand 227 / sky 176 (+0.7 EV). Far ridge ring `horizon-far` scaled
0.65 for aerial perspective; after the 40 → 200 m fog it displays 0.35 EV under the sky
behind it (145 vs 162) — a 30 km range on a turbid morning, not the critics' 1 EV, which
would be a near ridge.

**3. Lot shadows.** The `sun` spot's cone occluder disk is gone; the two-sun split is a
material define instead (`assignSunSplit`: exterior materials `SUN_SKIP_SPOT0`, interior
`SUN_SKIP_DIR0`, a material used both sides gets both and is reported), `sunLot`'s frustum is
tightened to the stalls + wall and its map is 4096² with a single hardware-PCF tap (hard
edges: 3–4 px 10–90 % at `lot-shadow` y = 850 and y = 1000 by `edge.mjs`; rev 2 was 32 /
40 px because the asphalt was sampling the spot's soft map). Asphalt albedo sRGB 96 → 78
(`exterior.ts`); the parking-line "blotches" were the per-segment tyre-scuff wear on the
paint decal, now an fBm field. Light isolation at `lot-shadow` (`snip-lotiso.js`, nits):
asphalt sun 2,303 = sun-only 1,964 + sky-only 340; car shadow 277 (probe) = **3.07 EV**
under the sunlit asphalt, R/B 0.40 (sky-only asphalt R/B 0.39); tan wall 7,173 nits above
the sand 5,025 above the asphalt 2,303 (asphalt 1.1 EV under sand; rev 2 0.65).

**4. Fluorescents.** `TROFFER_LUMENS` 7,500 → 10,500 (a 2×4 with two F32T8 in a K12 lens
is 10–11 klm). Lens map: **two** bars at 2.2× the mean (`TROFFER_LENS_HEADROOM` 2.4, 16×
anisotropy so the bars survive the grazing view in `length`), valley 0.3×, end caps 0.45,
4,100 K with the green bias — in `ceiling` the bars are 11,800–12,200 nits (clipped, soft
halo through the haze pass), the field 4,400–5,700, the tile beside the lens 618 nits
(4.3 EV under the bars); lens field (216, 223, 215), R < G and B < G. Under the
troffers the white mugs read sRGB 112–120 against the shaded wall at 56 (+2 EV; rev 2 had
them at 60–77 *under* the wall); the laminate itself is 162 nits (sRGB 37) because its
albedo is 0.5 and a horizontal face away from the windows sees only the ceiling — the
critics' "counter darker than the wall" was right and is right; the crockery is the test.
Heat lamps: coating chroma (1, 0.12, 0.02) — rev 2's (1, 0.35, 0.13) put green at 6,000
nits, which this camera shows as sRGB 225, a pale peach; now red clips at 27,000, green
+0.9 EV, blue −1.7 EV: saturated orange with a clipped core.

**5. Car paint.** three sums the clearcoat Fresnel and the base Fresnel; the maroon at
`specularIntensity 1` under `clearcoat 0.7` mirrored the aureole across the whole hood.
`specularIntensity 0.35` (`exterior.ts` `maroonPaint`) with the dimmer, bluer sky: the
shaded flank reads 948 / 765 / 1,320 nits = maroon 506 / 92 / 90 under a sky sheen of
442 / 673 / 1,230 (the clearcoat lobe is 196 / 475 / 870 of it; `snip-paint.js` ablation) —
sRGB (150, 137, 156), a desaturated blue-grey over maroon — and only the sun's lobe clips
(`lot-shadow` 3.3 % ≥ 250 in the whole frame, sky and chrome included).

**6. Artefacts.** (a) Cord-thin streaks and vinyl glitter: `installSpecularAA` widens the
roughness by the screen-space normal variance (Tokuyoshi–Kaplanyan). Checked at the critics'
coordinates in `r3p`: `length` 630–670 × 310–340 p90 60 / p50 57 (no dots), the floor
"streaks" 1390–1430 × 920–930 p10–p90 40–45, `stripes` 1300–1700 × 880–920 adjacent pixels
151 144 137 128 134 152 … (a gradient, not 39/111/58/104). (b) Sun on the *room-side* slat
faces: `Blinds.ts` wound its slat triangles against the authored normal, so the DoubleSide
flip pointed every room-facing normal down and streetward and the sun never lit the face the
room sees — the "grey grille" of every oblique pose was this one winding. (c) Motes on the
shaded wall in `door`: the emitter is culled by the `sunBeam` compare map; the specks the
critics saw are inside the door's beam, which does cross that wall (`snip-perf3.js`, 5,000
motes, only beam-lit ones drawn). (d) Penumbra vs distance: the PCSS blocker search
averaged the depths of *all* blockers, and on the tables two blockers sit at different
depths (slats 1 m away, roof edge 3 m), so the average produced a penumbra that was neither
— the mosaic on the laminate; the search now takes the **nearest** blocker
(`dNear = max(dNear, d)`) and the penumbra floor is 1.75 texels (0.5 gave a sawtooth on
near edges). Wall stripes at 6 m: 3–4 px 10–90 % (≈ 15 mm at that distance, the 32 mm
physical penumbra of a 1 m slat gap); table stripes at 1 m: 10 px. (e) Mug-base crescent:
`pourMug:foot` was created without `receiveShadow` (sun through the roof lit its 0.5 mm top
sliver), and the glaze mirrored the troffer at the foot chamfer with nothing to occlude it —
mugs and saucers now carry a profile AO in `uv.y` (`writeProfileOcclusion`, upright and
inverted profiles, identity-ramp `aoMap` on `ceramic` / `bisque`).

**Polish.** (7) One red Lambert spot per lit bench (`VINYL_FLUX`, split out of the aisle
bounce): wall beside a bench R/G 1.30 vs 1.11 far from one (+0.19). (8) Window-side ceiling
335 vs back 313 nits in `length` (+0.1 EV; `snip-ceil.js` attribution: the bounce spots'
cos-falloff puts most of the first bounce on the *wall* above the booths, the ceiling gets it
from the probe — a second probe or a lightmap is the fix, not a fill). (9) Chrome and glaze
carry clipped highlights (`macro-table` 11 % ≥ 250, the mug rim in `macro-warmer`). (10)
Slats in `window` hold a cream tone with the sunlit top edges clipped, gaps brighter than
the edges. (11) Checker floor: light tile 218 nits vs dark tile 53 in `counter` shade
(sRGB 42 vs 17, 2.0 EV). The albedos are 6 EV apart (sRGB 220 vs 26, `checkerFloor`), so
this is not albedo: the dark tile is the waxed floor's sheen — ≈ 6–10 % Fresnel of a
500-nit ceiling is 30–50 nits, which is what a black VCT tile does in a photograph. Not a
System 5 item; if the critics want ≥ 3 EV the floor's roughness map is the knob.

**Also fixed on the way.** ANGLE rejected every draw of a material whose `onBeforeCompile`
was assigned *after* `installPcss` ran (Pour.ts's coffee liquid): the PCSS chunk's
`sampler2DShadow` stayed on unit 0 beside a `sampler2D` — `GL_INVALID_OPERATION: two
textures of different types use the same sampler location` — and the mesh vanished
silently. `onBeforeCompile` is now an accessor on `Material.prototype` whose setter wraps
any hook with the sampler binding (`toString` carries the inner source so the default
program-cache key still separates them). `snip-glerr.js` wraps `drawElements` and checks
`getError` per draw: zero errors in every pose.

### Verification (rev 3)

All poses in one run (`r3p`), one exposure (`grey 1693.44` nits everywhere). Nits are HDR
probe p50; sRGB is the display p50 of the same region.

| Pose | Shaded wall (nits → sRGB) | Slat gaps / window (sRGB p50 · p90 · % ≥ 250) | Frame % ≥ 250 | Sky (sRGB, sky-only) |
|---|---|---|---|---|
| `length` | back wall 221 → **46** | near window 123 · 169 · 1 % (blue sky, not clipping; 3.8 EV over the wall in nits); windows 2–5 at 15° show slat faces only | 1.4 | — |
| `booth` | wall by the bench 239 → **47** (R/G 1.30) | right window 226 · 255 · 46 % | 9.6 | — |
| `aisle` | — | right window 190 · 254 · 21 %; left 172 · 255 · 20 % | 7.3 | — |
| `counter` | 332 → **56** | — | 0.3 | — |
| `lot-wide` | 337 → **64** | window 172 · — · — | 2.7 | (90, 101, 115) low horizon behind the far ridge |
| `stripes` | wall in stripes 493 → 77 (mixed) | top band 79 · 208 · 5 % | 2.9 | — |
| `window` | sill 243 → 61 | blinds 184 · 228 · 6 % | 7.7 | (187, 201, 216) sun side |
| `door-glass` | front-wall pier 104 → 27 (faces away from every window) | — | 0.07 | (138, 168, 200) |
| `door-open` | — | — | 1.2 | (142, 166, 195) |
| `sit-seated` | — | — | 4.4 | (134–141, 160, 177–187) |
| `ceiling` | tile 618 → 82 beside the lens | lens field 203 · bars clip | 2.8 | — |

Lot (`lot-shadow`, nits): asphalt sun 2,324 / car shadow 277 (**3.07 EV**, R/B 0.40) /
sedan shade side 1,765 / sunlit wall 7,173 / sand 5,025. Isolation: sun-only asphalt 1,964,
sky-only 340 (R/B 0.39). Edge 10–90 % width: 3 px at y = 850 (car), 4 px both sides of the
pole trough at y = 1000. Troffer proof: `ceiling` lens bars 11,800–12,200 nits (clip), field
4,400–5,700, tile beside 618 (4.3 EV under the bars); mugs under the troffers sRGB 112–120
vs shaded wall 56.

Performance (RTX 4060, 1080p, `post-bench.mjs`, GPU shared with two sibling agents and a
live wallpaper — contended): scene 8.4–8.5 ms at `length`, 5.6 ms at `window`; `main`
(rev 2 lighting + System 3 rev 7 + System 9 geometry) measured back-to-back under the same
load: 8.2 ms at `length`, 7.8 ms at `window`. Draw calls at `length` 168 → 323 and
triangles 1.23 → 2.33 M since the rev 2 measurement are the merged systems' geometry; the
lighting delta is +0.3 ms at `length` (two more non-shadow spots) and −2.2 ms at `window`
(nearest-blocker PCSS). Boot 13.2–14.5 s contended (rev 2: 10.0 s uncontended). Dust: 5,000
motes, culled by the `sunBeam` compare map, only beam-lit ones drawn.

Rev 3 lessons:

- **When "exposure varies" and the shutter is fixed, look for the light that only some
  poses see.** A one-point probe at 0.7 is a pose-independent light with a pose-dependent
  excess: it inflates the faces it saw at close range, and the oblique poses look at
  exactly those. Attribute per source on one wall (`?nofill`, `?nobounce`, `?ibounce=n`)
  before touching the curve.
- **Read winding before lighting.** A slat whose triangles oppose its authored normal is
  lit as if it faced the other way under DoubleSide, and no amount of sun fixes it: the
  "grey grille" was one `for (const [x, v] of [a, b, c])`.
- **PCSS blocker search: nearest, not mean.** With two casters at different depths the
  averaged depth belongs to neither and the penumbra estimate jumps between texels — the
  mosaic on the tables. Nearest blocker + a texel-and-three-quarters floor.
- **Every program that includes a shader chunk must bind every sampler the chunk declares,
  including programs compiled from hooks assigned later.** ANGLE drops the draw and says so
  only in the console. An accessor on `Material.prototype.onBeforeCompile` catches the late
  ones; `getError` after every `drawElements` (`snip-glerr.js`) is the test.
- **Saturation is in the ratio, not the intensity.** (1, 0.35, 0.13) at 8,000 nits is a
  peach lamp on this camera; (1, 0.12, 0.02) is an orange one. Author emissive chroma at
  the display, then scale to nits.
- **A horizontal face away from the windows is darker than a vertical face toward them,
  and should be.** The counter laminate under 500 lux of troffer light at ρ 0.5 is 160 nits;
  the cream wall facing 10 m² of sky is 330. Test fluorescents with the white crockery, not
  the counter.
- three sums the clearcoat and base Fresnels; a clear-coated paint needs `specularIntensity`
  well under 1 or the hood mirrors the sky twice.
- Emissive maps seen at grazing angles need anisotropy or their mips average the hot bars
  into the valleys; a lens that clips head-on stops clipping down the room at 4×.

### Rev 4 (branch `sys4-rev2`, on top of `main` `a255016` = System 5 rev 5 + System 9 rev 4) — what changed and why

Two critics failed rev 3 narrowly and agreed the physics was right: one camera across poses,
backlit blinds with sky in the gaps, lot order sand > asphalt > CMU > shadow, blue sky the
same through glass and without, coffee liquid drawn, clean table penumbrae. Their main fail
was the *placement* of that one exposure: 1/250 s is an exterior exposure, and the interior
it was pointed at read 1.5 EV under every diner photograph they held it against (Shore's
table wood 79–99, Reitz's blind-lit window 104 / tabletop 107, Eggleston's walls 150–200;
ours: walls 32–57, ceiling 30–35, `undertable` tiles 4–16). Six blockers, in order:

**1. Exposure placement.** `CAMERA.shutter` 1/250 → **1/60** (EV100 12.29 → 10.88; middle
grey 1,693 → **405 nits**; L_sat 9,560 → 2,260) and `CAMERA_WHITE_EV` 2.5 → **4.5** with
`CAMERA_CURVE_GAIN` re-solved so grey still lands at display-linear 0.26: two stops more
room, and a Hable shoulder long enough that the sky, sand and sunlit slats roll off instead
of slamming to 255 (`window` clip 29 %, `door-glass` 3 %, `table` 19 %). It is one exposure
for every interior pose; `lot-shadow` alone is the exterior camera (`ev −2` in the probe =
rev 3's 1/250), because a photographer who walks out to the lot re-meters — a lot frame at
the room's exposure is a white sheet (sand 255, asphalt 240) and tells the critic nothing.
`ROOM_PROBE_INTENSITY` 0.1 → 0.13 (frame medians, see the table).

**2. Blind slats.** Three things made "fat glossy cylinders": `metalness 0.1` (a dielectric
enamel has none), an enamel base roughness of 0.3 with the dust only to 0.6 (a 20–30 GU
painted slat is 0.55–0.7), and undersides lit by nothing but the room probe (the lot,
4,000 nits of sunlit concrete and sand, bounces up into every slat's underside through the
glass — `installLotGroundFill`, a fixed-direction Lambert fill on the slat material only,
0.6 down / 0.8 out). Albedo (224, 216, 196) → (205, 196, 175): a slat that has hung in a
diner window is yellowed alabaster, not fresh white. `window` column x = 700 is now a flat
239–248 body with one dark edge (the underside line, 131) per slat — rev 3's 243 → 180 →
114 crown is gone; `booth` faces (darker half of the window) medL 206 / p90 233, the gaps
clip. Near and far windows in `length` 138 vs 133 (0.11 EV).

**3. Sedan roof.** Ablation on the roof pixel (`snip-roof.js`, nits at the lot camera):
base 9,600 → env off 1,400 / clearcoat off 6,500 / base specular off 5,100 / lot sun off
2,300. The clearcoat (0.22 → a 20° lobe) was ~3,100 of it; the *base* dielectric lobe at
roughness 0.85 × `specularIntensity 0.35` spread the sun over the whole panel for another
~4,500. Now `specularIntensity 0.05`, roughness 0.7, `clearcoatRoughness 0.1`: a solid
maroon under clearcoat is a pigment layer whose interface with the clear (n 1.5 → 1.5)
reflects almost nothing. Roof 2,350 → 1,950 nits, mean sRGB 148, 0.5 % ≥ 250, B − R +13,
under the sky patch behind it (151).

**4. Fireflies and hard motes.** Two sources. (a) System 8's motes: intensity 0.4 → 0.015
and size 1.0–2.8 → **3.0–4.5 px** — every mote is a soft disc and the brightest one over the
`door` wall peaks +0.75 EV over the wall it drifts in front of (was 1–2 px points at +2…+3
EV, 49 of them on that wall). (b) The 25 mm slat stripes on the far wall (11 m) are 3.5 px
apart; filtered at the PCSS 1.75-texel floor, each stripe edge's texel staircase beat against
the next into a diagonal hatch that the 5 × 5 outlier test counted as ~200 hard motes per
10 k px. Fix: a **camera-footprint floor** on the PCSS radius, `pen ≥ max(|∂uv/∂x|,
|∂uv/∂y|)` — the sensor's own box filter, ≈ 2 texels at 11 m, < 0.5 texel within 4 m (the
table stripes are untouched). Isolated px > +40 L over their 5 × 5 ring on every flat shaded
region cited: **0** (`door` right wall, `door` left wall, `length` wall left of the beam and
right of it, `booth` shaded vinyl), post on and `?post=0`.

**5. Wall shaft penumbra.** Ray-cast (`snip-shaft.js`): the `length` shaft is the FIRST
window's beam on the −x end wall at 11 m from the camera, and its blind is ≈ 1.8 m up the
beam from the wall (1.1 m past the window centre at 38°), not 3 m; the sun's 0.53° gives a
17 mm full penumbra there and one pixel is 7 mm, so the 10–90 % transition is ≈ 2 px — the
3–4 px the critics measured is the physical value at this framing. Unchanged. The "2 px
rebound" at the dispenser base in `table` (row 700, x 908–915: 172 → 197 → 178) is the
fluted glass rim, not a leak.

**6. Laminate moiré.** Verified on the merged tree at the `macro-table` pose (= System 5's
`sys5-macro-table` camera): `shots/sys4-macro-table.png` — slat stripes with a clean
penumbra on the sunlit laminate, no concentric arcs, no mosaic. Rev 3's nearest-blocker
search + 1.75-texel floor had already taken it out.

Polish done: **7** lot kernel ±1.06 texel + the footprint floor: outline steps 4.1 → 2.7 px
(the rest is the sedan's lofted facets, not filtering); asphalt vs car shadow 3.12 EV.
**8/9** the door frames no sky — its header cuts it off; what reads as "sky through the
door" is the hazed MID range and the darker band under it the NEAR range (ray-cast). At 8 AM
both are due east, backlit, so their visible faces are shaded slopes: ring scales 1 / 1 /
0.65 → **0.55 / 0.7 / 0.75** (near 1,080 vs mid 1,930 nits, −0.85 EV; display 193 vs 215),
and the sky the door does not show agrees with `lot-wide` (228 / 226 through glass and
open; 3,120 nits vs 2,200 sunlit asphalt). **11** the counter lip's "neon": ablation
(`snip-lip.js`) — 14,700 nits with anisotropy, 900 without, unchanged with the env, the sun
and the lot sun off: it was the **bounce stand-ins' specular**. A 25,000 lm point 1.5 m from
a satin metal is a 10⁴× over-concentrated image of the floor patch it stands for. The
stand-ins are now diffuse-only (`installBounceDiffuseOnly`, marker `distance 100`) — the
patch's real specular image is in the sun-on probe the metals sample; the lip is a palette
material (`stainlessLip`, kick-plate satin in the stainless colour) so it takes that probe.
Lip face 14,700 → 1,900 nits: in `counter` the face reads 225–243 along its length
(was 255 in 90 % of columns, pink), with its 3 mm rounded top edge still a 1–2 px clipped
line (the sky's highlight on a steel edge). It is one uniform bar, not "broken" — one
probe point has no parallax to break it. The same specular was on the glossy floor and the
vinyl backs — the "vinyl sparkle" (13) went with it. **14** dispenser region 8.9 % clip. **15** the `aisle` diagonal is the roof-edge shadow crossing that window's blind.

Skipped / not met: ceiling tile beside a lens 160 (target 100–150; the field is 4,400 nits
of lens 0.3 m away); `undertable` frame median 58 (target ≥ 70 — the camera is under a
table; its light tiles are 40 with 0 % black); `booth` window top-to-bottom B − R is flat
(−10 → −12; the `sit-seated` gradient comes from seeing the undersides low and the tops
high, which this pitch does not); floor sun patch in `counter` p90 96, not 220–255 — at
3.5 m from the blind the 25 mm stripes are a 33 mm penumbra wide, so the "patch" is a
25–45 % slat-duty smear on a 0.35-albedo tile, not full sun (the table at 1 m clips 37 %);
ceiling window-side vs back in the `ceiling` frame (+0.14 EV on the regions I could name) —
along z at x = 0.3 the tile goes 613 nits (z 1.4) → 165 (z −2.2), bounce 542 → 115 of it,
troffers 0 (a recessed lens lights no ceiling), so the gradient is there and steep; the
frame's regions do not sample it.

Measured against the brief (post on, sRGB, `%TEMP%\sys4\targets.mjs fin5`):

| target | measured | brief |
|---|---|---|
| shaded wall medL `length` / `booth` / `counter` / `door` | 99 / 108 / 120 / 116 | 85–130 |
| `length` ceiling window-side / mid / far | 122 / 119 / 81 | ≥ 80 / ≥ 80 / ≥ 60 |
| interior frame median | `length` 96, `booth` 96, `counter` 91, `door` 92, `warmer` 76, `macro-warmer` 72; `undertable` 58 | ≥ 70 |
| `undertable` light tiles medL / black | 36 / 0.01 % | ≥ 25 / < 0.5 % |
| sun on cream wall (`length` shaft p90) / sunlit table (`stripes` medL, clip) | 243 / 239, 38 % | 220–255 |
| shaded red vinyl (`booth`) luma | 70 | 65–85 |
| sky through east glass (`window`) medL / clip | 237 / 62 % | ≥ 235, clipped centre |
| `door-glass` sand > asphalt | 238 > 222 | order kept |
| `window` slat body / edge (x = 700) | 239–248 flat / 131 one edge | flat body, one edge |
| `booth` slat faces medL / p90 | 206 / 232 | 200–235, < 10 % clip |
| `length` near vs far window slats | 0.11 EV | ≤ 0.3 EV |
| sedan roof mean / clip / B − R / vs sky | 148 / 0.5 % / +13 / 147 ≤ 151 | 150–210 / ≤ 5 % / ≥ +10 / ≤ sky |
| isolated px > +40 L over the 5 × 5 ring: `door` right wall, `door` left wall, `length` wall above and right of the shaft, `booth` shaded vinyl | 0 / 0 / 0 / 0 / 0 (post on and `?post=0`) | 0 |
| mote size / peak | 3–4.5 px discs / +0.75 EV | ≥ 3 px / ≤ +1 EV |
| shaft 10–90 % (slat casting 1.8 m from the wall) | ≈ 2 px | physical 17 mm = 2.4 px |
| laminate moiré (`macro-table`) | none | none |
| lot shadow depth / outline steps | 3.12 EV / 2.7 px (rev 3: 4.1) | 2.7–3.0 EV / ≤ 1 px |
| ranges under sky (`door-glass` near vs mid; `lot-shadow`) | 0.85 EV nits, 0.35 display; 0.62 | ≥ 0.7 |
| sky through open door vs asphalt | 3,120 vs 2,200 nits | sky ≥ asphalt |
| counter lip face / counter top clip | 225–243 unclipped, 1–2 px edge line clips / 0.0 % | ≤ 10 %, broken / flat |
| wood back under the table | 37 | ≥ 30 |
| dispenser clip | 8.9 % | ≤ 15 % |

Performance (RTX 4060, 1080p, `snip-perf3.js`, GPU shared with sibling agents): scene
8.6–8.8 ms at `length` (rev 3 8.4–8.5 under the same kind of load; GPU at 70 % from
siblings during the measurement), 4.7 at `door-glass`, 5.8 at `window`; draw calls `length`
330 (rev 3 323: +1 `stainlessLip` bucket, the rest System 5 rev 5 / System 9 rev 4), boot
185 calls / 1.32 M tris, ready 14.2–18.1 s contended. Dust: 5,000 motes, culled by the
`sunBeam` compare map as before.

Rev 4 lessons:

- **The camera exposes for the subject; a consistent exposure can still be the wrong one.**
  Rev 3 locked one exposure and was right to — then metered it on the lot. The subject is
  the room: put grey on the shaded wall, let the glass go, and move only the shoulder to
  keep the exterior legible.
- **A point stand-in for an area light must be diffuse-only.** Its irradiance is the panel's
  beyond two widths; its specular image is the panel's compressed into a point, and every
  glossy surface within a few metres shows it as a hot streak (the "neon" lip, the wet
  floor, the vinyl sparkle). Give the specular to the probe that holds the real patch.
- **Ablate before authoring.** The roof, the lip and the ridges each had a "likely" cause
  in the brief; in each case one snippet that zeroed sources one at a time named a
  different one (base lobe, bounce specular, the wrong ring) in under a minute.
- **Shadow filtering needs a screen-space floor too.** A physically small penumbra is
  right until the pattern it shapes is sub-pixel; then the filter must be at least the
  pixel's footprint in the map or the texel grid aliases into structure the eye reads as
  dots. `fwidth` of the shadow coordinate is that footprint for free.
- **Measure what the frame actually shows before targeting it.** "Sky through the door"
  was a hazed mountain range (ray-cast); "the shaded wall left of the beam" was the beam.
  A region chosen from a screenshot needs one ray-cast to earn its name.

### Evening preset (rev 7, branch `sys4-rev6-2`) — 6:45 PM golden hour

User call ("make it evening at least"; the 8 AM sky read as a flat cyan wash with a white
disc, the troffers as switched off). Bold parameter changes, no new machinery; the diner now
faces WEST so the same glass, blinds and door take the low sun. Geometry, materials (other
than light colours), the analytic slat term (only its sun vector), glazing, interactions,
audio untouched; beams / dust / haze / steam read the sun's direction and colour from the
light (`beams.ts sunDirectionOf`), so they inherited the change with no edit.

| Quantity | Morning (rev 6.1) | Evening (rev 7) |
|---|---|---|
| Sun elevation / azimuth off the window normal | 35° / 38° | **9° / 38°** (shadows 6.3× height) |
| Sun colour (linear, unit luminance) | (1.0, 0.83, 0.71) ≈ 5,400 K | **(1.0, 0.72, 0.45)/Y ≈ 3,200 K** (sedona-sunset solver at 8–9°) |
| Direct normal illuminance | 90 klux | **18 klux** (6 air masses; 14 klux on the glass, 2.8 klux on the ground) |
| Sky horizon by the sun / opposite / zenith | 4,500 / 4,500 / 2,250 nits, blue | **1,200 / 660 / 300 nits**; peach (1, .6, .34) → pale-yellow band 5–25° above the sun → blue-grey opposite → zenith (.24, .4, 1); orange aureole (0.5c⁴ + 0.8c³² + 1.5c⁴⁰⁰) |
| Diffuse skylight (hemisphere integral) | ≈ 11 klux | ≈ 2.4 klux |
| Ridge rings / fog | blue haze | same code, tinted by the new horizon chroma → pale orange-grey |
| Troffers | 5,800 lm (4-lamp, depreciated) | **8,700 lm** (3 × F32T8, new lamps, clean lens) — lens bars 250 / 252 (p50 / p90), pools on the tiles |
| Camera | 1/60 f/5.6 ISO 100, grey 56 nits | **1/20 f/5.6 ISO 100, grey 211 nits** |
| Room probe intensity | 0.1 | 0.3 |
| Blind-underside lot fill | 4,000 / 16,000 lux | 600 / 2,400 lux (the 9° sun now lights the undersides directly, n·s 0.19) |
| Bounce rects (`bounceRects.ts`) | floor quads + one end-wall special case | **first-hit projection**: each window band lands on the first of floor / kitchen partition / end wall (at 9° the upper half of every window crosses the room to the partition, back bar and counter); radiance carries the sun's chroma |

Measured (rev 7 frames, `shots/sys4-*`, `%TEMP%\sys4\out7`): `length` wall sun patch p50/p90
233 / 235, clip 0 %; shaded back wall p50 91 (p10 72, p90 110); undertable p50 **34** (target
≥ 40 — the kick space is filled by the probe and the toe only; a further +0.4 EV would land
it at ≈ 40 with the patch at ≈ 241, left for the critic's call); `ceiling` lens p50 250 / p90
252, tiles 98; `lot-shadow` sunlit asphalt 73, car shadow 67 blue (76, 76, 95), maroon hood
(164, 128, 125) — the horizontal panel is a clearcoat mirror of the sky at the evening
angles (pink = red diffuse + blue-grey sheen; `Exterior.ts` is another builder's file this
round, albedo left at 0x6e1a16); `ext-facade` sunlit stucco 234, pole shadow 152 (−0.6 EV,
warm — the low sun's shadow on a sun-facing wall is short and sky-filled), slats 140, sky
15° up opposite the sun (174, 188, 218); `door-glass` sky by the sun's horizon (223, 208,
193) → 224 (+3.4 EV, on the knee: reads pale peach, not the white disc in cyan).

Exposure dial (`main.ts`): `?ev=<stops>` (default 0) or the player's last `[` / `]` step
(±0.25 EV, clamped ±4, persisted in `localStorage["morning-diner.ev"]`, 1.2 s toast
"EV +0.25"); multiplies `toneMappingExposure`, which the bloom prefilter and shadow lift read
each frame. No `?tod=morning` switch (it would have cost the bounce/lot-fill re-derivation).

### Rev 6 (branch `sys4-rev2`, on top of `main` `734f8a6` = fix-glass + steam rev 3 + fix-counter-door) — structural ports from the sibling projects

Rev 5 was stopped before it changed any light: its only commits are the `origin/main` merge
resolutions (`cfd91b0` System 5 polish) and the checkpoint. Rev 6 replaces the rev 5 tuning
list with five structural changes, each a port from a sibling project named in
`C:\Code\morning-diner-wt\lighting-port-survey.md`, each A/B'd at the standard poses before
the next (`%TEMP%\sys4\out\r6s0…r6s5e-*.png`, `ab-*.png` montages). Not merged to `main`;
critics review first.

**1. Tone: hue-preserving knee, stock crosstalk, print toe, display-referred bloom
(`Lighting.ts` `installCameraToneMapping`, `post/shaders.ts`, `post/settings.ts`).**
nightdrive's `tameHighlights` runs before the Hable curve: above `CAMERA_KNEE_EV` (+3.5 EV
over grey, 2.04 exposed) the pixel's max channel is compressed as `knee + over / (1 +
over / knee)` and the other two channels are scaled by the same factor, so a sunlit red panel
loses luminance before it loses hue (Hable per channel was turning the maroon car lilac and the
sunlit vinyl orange). jungle-trail's `stock()` crosstalk follows — 6 % of the channel
difference pulled toward luminance at a rate keyed on exposed luminance (`1 − exp(−2 · Y)`),
the film stock's inter-layer bleed — and its print toe `0.014 · (1 − c)⁴` sits on the ENCODED
value at the end of the finish pass, so the densest black prints at code 4, not 0. The bloom
prefilter is Karis-weighted and thresholds on `scene × exposure` (2.0 exposed = +3.5 EV), so
what blooms no longer moves with `?ev=` or the camera; `uClamp` (fix-counter-door) is in the
same units. Gain solve unchanged; white stays at +4.5 EV.

**2. Analytic blind-slat shadow (`scene/slatShadow.ts`, `Blinds.ts`, `post/beams.ts`).** The
slats are out of the interior sun's shadow map (`castShadow = false`; frame, headrail and
furniture stay in it). Their stripes are the closed-form transmittance of a tilted-slat blind
under a 0.53° sun, evaluated per fragment in world space in `lights_fragment_begin` for spot 0
(jungle-trail `canopyTransmit` pattern): the fragment is carried back along the sun vector to
the blind plane, the across-beam coordinate is reduced modulo the projected pitch, and the
slat's occluded band (half-width `hw` from the tilt and the sun's elevation) is convolved with
the sun disc at 9.3 mm per metre of travel plus the pixel footprint (`fwidth`) — a trapezoid
that is a hard box at the sill and gone by ≈ 5 m. `blindLayout()` is the single source of
each window's tilt / drop / raised state for both the geometry and the shader (baked as GLSL
constants at module load). No System 9 openable touches the blinds in this build; the
documented fallback for a blind that is ever raised or tilted at run time is to put that
window's slats back on the caster list and drop it from `blindLayout` (term = 1 there). The
haze / dust march (`beams.ts sunVisible`) multiplies the same term.
Measured (`macro-table`, column x = 1300, post on): crests 246, troughs 53–61 — 91–110 nits
against ≥ 6,500, **1.7 % of the crest** (target ≤ 15 %; rev 4 was 60–85 %); 10–90 %
edges 6–8 px at 0.5 m from the blind, stripes soft on the vinyl back at 1.5 m (91–205) and
gone on the far wall. `slatBeamOpen()` (0.76 for 25° slats under a 35° sun, not the 0.5 rev 2
assumed) is what the bounce rectangles use for the patch flux.

**3. Glazing: alpha leaf + additive reflection leaves (`scene/Glazing.ts`, `Shell.ts`,
`Door.ts`, `materials.ts`, `Diner.ts`; `GlassResolution.ts` removed).** dawn-station's
`applyGlazingFresnel`: a pane is an alpha-blended black leaf whose alpha is
`1 − (1 − F)(1 − a0)` (F the Schlick Fresnel at the view angle from `ior`, a0 = 0.12 body
loss) and writes depth, plus two additive `MeshPhysicalMaterial` leaves (one per face, dust
roughness map, `ior 1.52`) that reflect the room probe (inside) or the lot probe (outside).
three's `transmission` is gone from architectural glass (still on carafe, sugar, mug glass,
clock dome): no half-resolution buffer (the "melting blinds" from the lot — `shots/sys4-ext-
facade.png` now shows the slats as crisp as `fix-glass-after-exterior.png`), no double
Fresnel, and the exterior is seen at its full HDR value × one physical factor. Measured: sky
through the east glass (`window`) 3,813 nits p50 / 4,548 p90, **+3.2 / +3.5 EV**, codes
226 / 230; the same sky through the open door (`door-open`) 2,187–2,770 and through the
`lot-wide` glass 2,323 — glass and no-glass now agree within 0.1 EV (rev 4: 1.5–2.5 EV
apart). Scene pass fell ≈ 1 ms from dropping the transmission pass.

**4. Exposure and shade (`CAMERA_MID_GREY` 0.26 → 0.18, sedona shadow lift in
`finishFragment`).** Grey pinned to display-linear 0.18 (code 118, the grey card) instead of
rev 2–5's 0.26: same white, steeper curve through the shade. sedona-sunset's local-max-masked
scene-linear lift: pixels under 0.045 exposed are lifted up to 2.5× only where an 8-tap
Vogel search (48 px at 1440p) finds a brighter neighbour — a dark facet next to a lit one
gains legibility, a dark wall stays a dark wall. Measured shaded walls (post on): `length`
139 nits / **68**, `counter` 164 / **73**, `booth` 180 / **77**, `door-glass` interior wall
76 / **46**, `lot-wide` 216 / **98**; wall sun : shade `counter` 5,424 (p90) : 164 =
**+5.0 EV** (target ≥ +4; rev 4 +3.0). The near-window walls sit 10–17 codes above the
brief's 40–60: they face the sunlit lot through the glass and the first bounce of the floor
patches, both now exact.

**5. First bounce as rectangle form factors (`scene/bounceRects.ts`; the bounce spots are
gone).** sedona-sunset's `s4GroundBand` pattern: the sunlit floor / table zone / bench front /
end-wall band / vestibule floor are baked as world-space quads (the window openings carried
along the sun vector, clipped by the table edge and the bench back so only the half of the
footprint that actually clears the booth lights the aisle floor) with radiance
E_patch · ρ / π, and `lights_fragment_begin` adds Lambert's contour integral of each to
`irradiance` after the ambient term. Floor albedo is the checker's mean (0.36, not a light
tile's 0.47). `TROFFER_LUMENS` back to the derived 5,800 maintained, `ROOM_PROBE_INTENSITY`
0.1. Measured ceiling : wall in shade, `length`: ceiling-back 191 nits vs wall 139 = **+0.46
EV** (rev 4/5: a stop and more); `ceiling` pose tiles 277–353 nits (95–108), tile beside a
lens 106 (target ≤ 130), lens bars p90 6,500 nits = +4.0 EV, over the bloom threshold. The
ceiling still sits above the wall because it faces the floor patches and the wall does not;
that is the geometry, and the remaining half-stop is the honest number.

Perf: the first version of the rectangle term (runtime loop over `const` arrays, exact acos)
cost 5.3 ms — scene pass 12.5 ms at `length`. Shipped: unrolled with literal constants, a
room gate (`p.z`), per-quad plane and tangent-plane early-outs, Eberly acos, and a point
form beyond three quad-diagonals: **7.7 ms at `length`** (rev 4 7.7 / 8.6–8.8 contended),
7.7 `booth`, 3.9 `window`; post 2.1–3.4 ms; boot ≈ 10 s uncontended. The tangent-plane test
also removed an error: the unclipped contour integral had been lighting upward-facing
receivers from patches BELOW them (booth cushion in shade 189 → 46 nits, `undertable`
tiles 34 → 24–28 code).

Troffers: skipped as a complaint, per the survey's physics — 35 klm maintained over 68 m²
is ≈ 300 lux against 34,500 in a patch; at 8 AM a fluorescent fixture is visible only as its
own lens. The lens reads +2.6 EV mean / +4.0 EV on the lamp bars and blooms.

Maroon paint (`Exterior.ts` `0x3a1014` → `0x6e141c`): the old albedo was 4 % red, so a
clearcoat's sky reflection out-shone the diffuse on every shaded panel (B > R = lilac). Now
R > B on every panel in every pose: sunlit hood through the door glass 2,270 / 820 / 1,510
nits → (196, 141, 166) — the hood is seen at ≈ 15° grazing, F ≈ 0.2 of a 4,500-nit sky,
which is a real glossy hood under a blue sky; `lot-shadow` roof B−R −10 (was +25 of sky
over a black panel). Shaded side panels still read blue-grey (`door-glass` (116, 118, 139)):
sky reflection ≈ diffuse there, as it is on a real dark car in open shade.

Rev 6 measurements (post on, sRGB unless noted; HDR in nits, grey 406):

| Target (brief) | Measured | Verdict |
|---|---|---|
| Sun patches roll off, no paper-white clip | `length` wall patch p90 237, clip 0.0 %; `stripes` table medL 234, clip 19 % (textured, not flat) | met |
| Stripe troughs ≤ 15 % of crest near the window | 1.7 % (`macro-table`); fade with distance (soft at 1.5 m, gone at 5 m) | met |
| Exterior through glass ≈ +3.5 EV, near clip | +3.2 / +3.5 EV (p50 / p90), codes 226 / 230; glass vs open door within 0.1 EV | met (sky dome is 3,800–4,500 nits there; it does not clip at a +4.5 EV white) |
| Wall sun : shade ≥ +4 EV | +5.0 EV (`counter`), +5.1 (`length`) | met |
| Shaded interior walls sRGB 40–60 | 46 (`door-glass`), 68 (`length`), 73 (`counter`), 77 (`booth`), 98 (`lot-wide`) | partly — far walls in range, window-side walls 10–17 over |
| Ceiling ≤ wall in shade | ceiling +0.46 EV over the wall (`length`); tile beside lens 106 ≤ 130 | improved from +1 EV; not ≤ |
| Maroon stays maroon | R > B on every panel; sunlit hood R−B +30 at grazing; roof B−R −10 | met for sunlit; shaded sides blue-grey |
| Troffer lens ≈ +4 EV and blooms | +4.0 EV on the bars (p90 6,500 nits), +2.6 mean | met |
| Perf ≤ rev 4 | scene 7.7 ms at `length` (rev 4 7.7), boot ≈ 10 s | met |

**6.1 — facade (`sys4-ext-facade`; both critics passed every interior pose and failed this
one).** Two blockers, interior untouched (`length` / `booth` controls re-shot: every interior
region median identical — wall-shade 139 nits / 68, cushion 46 / 54; frame-wide mean |ΔY| 1.7
codes against 1.2–1.5 run-to-run noise, the excess entirely in the exterior seen through the
raised blind's gap).

1. *Blinds from the lot read 46–65 beside 185 stucco.* Not self-shadowing (the slat material
   compiles `SLAT_NO_ANALYTIC`, verified in the compiled source) and not the glass (hiding all
   three leaves changed the slats by < 10 %). From the lot at eye height the visible faces are
   the slats' UNDERSIDES (street edge up: the upper face's normal points into the room), which
   the sun never touches (n·s = −0.25); their only light was rev 4's 4,000-lux lot fill ≈ 600
   nits. What actually lights an underside from the lot: the sunlit upper face of the slat
   below (22 klux on alabaster = 5,300 nits, 22 mm away, filling ≈ 0.6 of the hemisphere,
   76 % of it in sun → ≈ 8 klux), the sunlit apron (≈ 4.7 klux) and the low sky (≈ 2.8 klux):
   16–20 klux. `installLotGroundFill` now adds 16,000 lux of hemispheric fill to the lot-facing
   faces — **faded in with the camera's z across the window wall** (`smoothstep(zFront − 0.2,
   zFront + 0.4, cameraPosition.z)`), because the interior frames are frozen at the 4,000-lux
   undersides the critics passed (`sit-seated` ≤ 180 was a rev 5 target). This is a
   view-dependent term and is labelled as one in the code; the player crossing the doorway is
   looking at the door, and the undersides brighten over 0.6 m of walk. Measured (post on,
   exterior camera −2 EV): slat-face peaks (column x = 1100) 72 → **146**; window-3 blind
   region Y p50 68 → 129, p90 189 → 197; window 1 (pole shadow across it) 61 → 95. The
   critics' 170–220 assumed sunlit faces; the undersides top out at ≈ 150 with every honest
   source in, and the room still shows between them because 25° slats are 52 % open to a
   horizontal view — System 3's tilt, which the interior stripes depend on. Stated, not tuned.
2. *Facade shadows warm-black, 4.3 stops under the wall, beside blue lot shadows 2.5 down.*
   The shell's outer skins (`wallPaintExt` — the outer half of every wall box and the roof
   slab — and the `concrete` base / apron) are built inside the room group, so they took
   `scene.environment`: the sun-off room probe at 0.1, i.e. the room's darkness as the only
   fill on an outdoor wall. Diner.ts now lists both in `exteriorMats` (lot probe, own
   `envMapIntensity` 0.75 — at 1.0 the band measured 2.1 EV under the wall; the probe sits 8 m
   out over sunlit sand and over-delivers ground bounce to a vertical wall). Sun split
   unchanged (spot 0; the roof's awning band and the pole shadow are in its map). Measured:
   awning band Y 12 (11, 10, 9), 36 % black, −7.1 EV → **Y 88 (91, 87, 84), 0 % black, −2.47
   EV** under the sunlit stucco (194); pole shadow on the wall 103 → 130. The shadow is
   warm-neutral, not blue: sky + sunlit-sand fill on a warm-beige albedo — the lot's shadows
   are blue because asphalt is not.

Nice-to-have: maroon albedo `0x6e141c` → `0x6e1a16` (G ≥ B in the albedo — it was B > G,
raspberry); panels that mirror the sky keep B > G in the clearcoat term, which is the sky.
Not done beyond that one line. `counter` sun patch 176 vs `length` 237: one exposure (grey 406
nits in every pose's log); the `counter` wall patch's HDR p90 is 5,424 nits, *brighter* than
`length`'s 4,701 — a 176 reading is a stripe-mixed region at that pose's distance from the
blind (the stripes are 1.5 m from the slats there; troughs and crests average), geometry not
exposure.

Rev 6 lessons:

- **Port the structure, not the number.** Five revs tuned PCSS radii, bounce lumens and
  glass tints around the same three complaints; each port (analytic stripes, alpha glazing,
  rectangle bounce) removed the complaint's cause and its tuning knob in one step.
- **The contour integral is a form factor only above the tangent plane.** Unclipped, a
  polygon below the receiver contributes its negative projected solid angle with whatever
  sign convention the code settled on; the 140 nits it gave a shaded cushion looked like
  fill. Test the emitting plane and the receiver's plane before integrating.
- **Unroll baked geometry.** A `const vec3[]` indexed in a loop cost 5 ms; the same
  arithmetic on literals with early-outs cost 0.7. When the data is known at install time,
  generate the shader for it.
- **A bright pane is not a dark room's fault.** With the exterior at its true value behind an
  alpha leaf, the "dark exterior through glass" complaint was the transmission buffer's
  double Fresnel and tone-mapped texture, not the exposure.

## System 5 — textures and surface detail (rev 1 `materials` branch; rev 2 `sys5-rev2` below)

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

### System 5 rev 2 — making the wear visible (`sys5-rev2`, frames `shots/sys5-*.png`, new pose `kick-macro`)

The rev 1 critic could not see most of what rev 1 reported (no lanes, no tone
drift, no crack, no cup rings, no sag, no tee chips, no tide line, no
burnish, no arris wear, no baseboard tide). **Root cause, verified before any
generator was touched** (`tmp/probe.mjs`, a throwaway harness that dumped
`material.map/roughnessMap/normalMap`, `texture.image` sizes, UV ranges, and
the texture canvases themselves):

- Every map was bound, the right size, and oriented correctly; the canvases
  contained the detail. Nothing was NaN-broken.
- **Roughness is close to inert on the light surfaces.** Most of rev 1's wear
  lived in the roughness channel (lanes +0.28, cup rings, wipe haze,
  scratches, burnish, etch). Roughness only shows as a change in *reflected
  environment*, and what this rig reflects into a floor or a counter (ceiling
  tile, cream walls) is dim and flat. Measured on the final build by replacing
  the floor's roughness map with a constant: 0.95 → 0.25 moves the white
  tiles by 1.5 Y in `floor-macro` (90.5 → 92.0) and 1.5 Y in `length` (90.2 →
  88.7); `envMapIntensity` 0.1 vs 1 makes **no** difference in either pose
  (the floor is lit by the lights and probes, not `scene.environment`). Only
  the black tiles answer to gloss (the count of texels above 45 Y rises 12 %
  at 0.25 as they pick up the windows). Anything that must be *seen* on a
  light surface has to be albedo or geometry — which is what every rev 2
  fix does.
- **Albedo amplitudes were sub-threshold.** Rev 1's colour changes were 1–5 %
  (tile drift ±1.5 %, lane grey 4 %, seam 0.8 %, fade 2.5 %) — under ACES-style
  tone mapping and 8-bit quantisation those are 1–3 sRGB steps, i.e. film
  grain. Real wear is 10–30 % steps; that is what rev 2 uses.
- Two things were genuinely not rendering: the carafe tide line (a
  `transparent` mesh sorted behind the transmissive glass — same as the rev 1
  decal lesson, now `alphaTest`) and the OPEN card's back face (single-sided
  decal, the wrong way round for a flip sign).

Fixes (all measured on the final frames with pngjs, 1:1 crops):

1. **Door signage** — the atlas is 2048² (`doorDecals`, `DECAL` regions in
   px) with a mip guard: opaque texel colour is dilated 6 texels into the
   transparent surround and the rest filled with card stock, so mip levels no
   longer average toward black at letter edges (that, not resolution, was the
   blur). Decals are `FrontSide` with `alphaTest`; `atlasQuad(..., mirrorU)`
   picks the face. Street-facing text (hours, cards) is applied reversed and
   reads mirrored from inside; the flip sign is two quads — OPEN toward the
   lot, its blank/CLOSED back toward the room. In `door-dressing` the hours
   block is crisp and mirrored at 1:1 (clean letter edges, no grey halo);
   OPEN is not legible forwards from any interior pose — the room sees the
   card's back.
2. **Ceiling stains** — `acousticTile` stain atlas is 2 × 1: two shapes,
   each a lobed outline (fbm-modulated radius, 5–7 lobes), thin dark tide
   rim, paler interior, crazing ridges and a swell in the height field. The
   sagging tile (4,3) is its own subdivided box: 12 mm bow, one edge slipped
   off the tee flange leaving a dark slot (`ceiling-stain`: a 1–2 px slot at
   46 Y along a tee that reads 85 Y elsewhere, −39 Y; the stain outline is a
   lobed blotch, not an ellipse).
3. **Floor** — `checkerFloor` at 80 px/tile (3200 × 1600): per-tile tone
   drift ±6 % warm/cool with a gloss term, one mismatched replacement tile
   (+12 % lighter, cooler), 210 hard-edged rubber-transfer marks (0.6–2.4 mm
   wide, 12–60 mm, variable curvature, 85 % drawn from the lanes), lane grey
   mix 0.5 on whites / 0.34 on blacks toward dirt grey, door fan lanes,
   aisle half-width 0.3 m. **Map:** aisle whites 175–182 sRGB vs 206–216 off
   the lane (−15…−19 %). **Frame (`floor-macro`):** white tiles in the lane
   mean 78 Y vs 94 Y beside the booths (−17 %); `length` shows the aisle as a
   grey band between the bright tiles under the stools and against the
   plinths. **Crack:** the dark line is a 2.2 mm ribbon mesh (`floorCrackPath`,
   Shell.ts) folded into the cove-base bucket; the map keeps its soft shadow
   and an anti-aliased matte band. Profile across it in `floor-macro`: 83 →
   53 → 83 Y over 9 px, core 2 px, no beading.
4. **Wall rub** — `paintedWall`: one diffuse grey band 0.95–1.12 m with a
   darker paint-transfer line at contact height and a few knocks; nothing at
   0.4 or 1.4 m. `wallStipple` on a 0.3 m canvas with 0.1–0.3 mm domes,
   `normalScale` 1.3 **plus an AO map from the same height field** (0.84–1) so
   the orange peel reads even when no light rakes it. `wall-macro` profile:
   81 Y above → 75.6 in the band → 72.3 at the contact line → 80 below;
   stipple sd 2.6 Y at 30 cm.
5. **Kick plate** — `kickPlate` (brushed roughness 0.5/96, cool
   0.74/0.77/0.80, anisotropy 0.7 rotated to the vertical brush), 1.2 mm
   bevel, six Ø 8 mm oval-head screws with slots. New pose `kick-macro`:
   screw heads and slots resolve at 1:1, bevel line +7 Y over the face. The
   push-bar rose shares the bucket so the door lost its `stainlessCool`
   bucket (−1 draw call).
6. **Laminate** — wipe haze, 2–3 cup rings and scratches are now in the
   boomerang *map* (albedo) as well as its roughness; gold flecks are 1.5 mm
   at 0.3/cm² (the "dot grid" the critic saw at 1:1 was two things: the old
   1-px flecks, and the sun's PCF shadow dither in the specular — the latter
   is System 4's). T-mould is neutral aluminium (0.80/0.80/0.78, roughness
   0.3) over the ribbed `slabGeometry`; the counter seam is a 0.8 mm satin
   H-strip in the T-mould bucket, perpendicular to the edge — the black
   hairline is gone, but at the `counter` distance (2.3 m, 0.5 px) the strip
   is not resolvable either (profile across it flat within 1 Y). The counter
   top's own rings/haze/scratches (`laminateWear`, roughness-only in rev 1)
   now also ride in an `aoMap` because `formicaCounter` keeps its speckle
   `map` at a different repeat.
7. **Vinyl** — `vinylSurface` now emits a map: #AA1A15, burnished blotches
   −10 %, and pale cotton scrim (smoothstep of crack depth) in the crack
   floors. Crazing is on booth 2 only (`vinylRedWeltCracked` channels,
   `vinylRedCrazed` roll top); generic patch presence on that panel is halved
   so the welt band reads as the event. `welt-macro`: crazing cells resolve
   at 1:1 with pale floors; desaturated (scrim) texels average 114 Y against
   the 99 Y red around them.
8. **Chrome** — push bar dulled centre + 40 smears (`chromeBar`), posts and
   saddles in `chromeBar` (were `stainlessCool`, read cream), footring tops
   scuffed (`chromeScuffed` UVs along the ring), pedestal bells in
   `castBaseDusty`: a 64² `DataTexture` on the lathe's v — grey dust film
   over the bottom 30 mm, lighter kick marks, roughness up and metalness
   down under the dust. `undertable`: bell rim 32 Y vs body 18 Y. Spider
   plate/arms/hub share the bucket with v pinned to the clean row, so the
   tables lost their `darkMetal` bucket (−1).
9. **Carafe** — tide line is a 22 mm `alphaTest` band (`DoubleSide`) above
   the coffee, colour #3a1f0c; visible in `warmer`/`macro-warmer` as a dark
   matte band interrupting the reflections just above the coffee (numerically
   small — 13.5 vs 15.5 Y — because the black brewer is behind the glass).
   Side-panel scratches 20–80 mm at 6–12 % alpha (were 150 mm at 30 %).
10. **Wood / tees / baseboard** — cap arris lightening 20 % (was 9 %) and
    warmer, 7 dings; `teePaint` at 2048 px with 3–12 × 1.5–4 mm chips, rust
    bloom and grime drift; `baseboardScuff` is an absolute-colour map (black
    vinyl 42/39/36, grey dust toe, pale mineral mop tide line at 32–44 mm
    with drips), `baseboardWorn.color` white so the map is the colour.
    `undertable` shows the tide line as a light band along the cove.

Draw calls vs `origin/main` @ 7d3600c (same poses, same build): door 197 →
193, length 306 → 306, counter 263 → 263, undertable 235 → 232, floor-macro
182 → 179. Three new materials were added (kick plate, dusty bells, seam) and
each was folded into an existing bucket or replaced one. Boot to ready
(shared GPU, other agents running): 36–37 s on this branch vs 46 s for main
in the same session — noise-level, both dominated by texture workers
(13.7–18.4 s wall) and shader compile.

Not achieved / caveats: the lane step is clear in `floor-macro` and `length`
but the absolute tone of everything is System 4 rev 1's (flat, bright fills);
the sun's PCF dither on the laminate is a lighting issue; the brushed grain
on the kick plate is below 1:1 at 3.6 m (`door`) and only reads in
`kick-macro`.

### System 5 rev 3 — marks that obey their physics (`sys5-rev3`, frames `shots/sys5-*.png`)

The rev 2 critic (1:1 crops against photographs) passed the structure and
failed the marks: nearly every wear element read as a *drawn or stamped
pattern* — clean single strokes at one scale, uniform contrast, composited
regardless of substrate. Rev 3 rewrites each mark as the process that makes it.

**Decision — VCT, not quarry tile.** The floor is now vinyl composition tile:
12-in butt-joined tiles, a 1.5 mm hairline seam (a sub-texel canvas stroke so
the texel's *mean* darkens — a whole dark texel would be a 3.75 mm grout line),
no bevel, no brown grout; the seam relief (`floorGrout`) is a 0.4 mm V with the
tile edges curled up 0.12 mm and ±0.1 mm lippage. VCT's streaky chip mottle
(two value-noise fields, quarter-turned per tile) replaces the quarry glaze
speckle. BUILD.md had no reason recorded for quarry tile; a diner of this
period and plan has VCT.

1. **Vinyl crazing** — `vinylSurface` is now only the embossed pebble grain
   (normal + roughness + a map that darkens the creases), and the crazing is a
   separate non-tiling **atlas** (`vinylCrazeAtlas`, 1.4 m, UV channel 1, one
   region each for the crazed booth's roll, channel panels and welt cords —
   `boothVinylCrazeLayout` in `upholstery.ts`). Cracks are grown as *sequential
   fragmentation*: random walks seeded at the flex lines (welt, seat front,
   panel seams), branching and running until they meet an earlier crack, so
   cells come out 2–15 mm and irregular, and the network is a connected web
   that thins away from the flex points. They are **dark** (× 0.25 in the
   valley); the pale scrim shows only in fuzzy lifted islands with a raised
   rim; the welt cord carries a stitch line and cracks first. Seam strength is
   randomised along the bench so no two panels match. The roll's UVs are
   cylindrical arc-length (`cylinderArcUv`, seam rotated to the underside), so
   the rev 2 grain flip along the crest is gone: `welt-macro` 0–1920 × 440–560
   is one continuous grain over the crest; `stripes` 1180–1500 × 470–620 shows
   dark hairlines fanning from the welt into cells of 4–12 px, no repeat.
2. **Laminate haze** — `formicaBoomerang` / `laminateWear` wear is a milky,
   featureless roughness increase (isotropic fbm, roughness floor 0.28) with
   random micro-scratch streaks (varying length/angle, weighted to the front
   edge) and cup rings as partial arcs with a sharp outer edge; per-texel
   dither against 8-bit banding. Boomerangs 1–3 cm in four tones with overlaps.
   The concentric ripples + sparkle in `macro-table` 300–1100 × 750–1050 are
   **not** the maps — see Fireflies below (they vanish with `?taps=32,24`).
3. **Floor scuffs and crack** — rubber transfer is a float *transfer field*
   `T` (0..1) **multiplied** into the albedo (× 0.42 at full density): the
   same physics on both tiles, so it is a grey smear on the white tile and all
   but invisible on the charcoal one. Each smear is a dense core with a
   feathered `(1 − d²)^1.5` edge, streaked *along* the drag (noise sampled in
   the mark's own frame, 8:1), broken where the sole lifted, its width
   (10–42 mm) and weight varying along; density is a **max**, not a sum (a sum
   saturated every core to black on the first pass); 85 % in the lanes; the
   lane greys the whites by 0.62 toward dirt grey. At standing height
   (`counter` 0–900 × 560–1040) what reads is the *clustering* — the smears
   line the aisle between the stools and the booths and thin out under the
   booths — more than the grey step, which the sun patches on that floor
   swamp; not fully achieved, see caveats.
   The crack (`floorCrackSegments`) is a jagged random walk with half-width
   0.4–1.8 mm, that **runs along a seam for 5–25 mm at every joint it crosses
   and breaks clean at one joint in three**; in the scene it is a dark ribbon
   per segment plus two *lip* strips merged into the floor mesh (one side
   0.9–2.2 mm proud, flipping side per segment — a lit ramp and a shadow ramp
   under the sun), and the map carries a pale worn-edge stroke on the proud side
   and a dark one on the low side (+0 draw calls). `floor-macro` ~400–1000 ×
   900–1000: a kinked hairline that jogs at the seam, one side a hair lighter.
4. **Wall rub band + stipple** — the band *is* the mark: 0.88–1.08 m plus a
   feathered tail, greasy grey-brown, densest at the centre, its density a
   smudge field (fbm stretched 5:1 along the wall × a 3:1 mid-frequency field
   × fine grain), patchy where people sit, 2–3 heavier shoulder smears per
   metre, roughness dropping to ~0.6 inside. No contact line, no fly specks.
   `wallStipple` domes are 2–4 mm × 0.2–0.5 mm high (was 1.4–3.4 × 0.1–0.3):
   in the sunlit pier (`booth` ~880,300) the domes show a lit top and a dark
   under-side; in `wall-macro` (a shaded wall, 0.95 m away) the relief reads
   through the AO valleys only — the pose has no directional light on it.
5. **Kick plate** — its own canvas (`kickPlateWear`, 1024 × 256 over the
   plate's face UVs, +1 draw call `kickPlateWorn`): satin aluminium tint with
   vertical brush streaks in the roughness (0.36–0.5; anisotropy 0.7 along
   them so the floor smears up the plate), boot rubber as the same multiplied
   smears as the floor (latch-side, lower half; broad faint sole-drags and
   narrower hooks), a mop-splash film over the bottom 15 mm, a dulled bottom
   band; twelve Ø 8 mm oval-head **Phillips** screws on the standard template
   (5 along the top, 5 along the bottom, one at mid-height on each end); the
   bottom edge is a bent sheet (24 × 8 grid, 160 mm, lip 10° out, dished
   above, nothing at the ends) carrying the plate's UVs. `kick-macro`
   480–1440 × 620–920: soft grey smears with dense cores over vertical
   brushing; the roughness floor is 0.3, so no map-side sparkle.
6. **Ceiling stain** — the stain is a **tint multiplied into the tile** (the
   fissures and their shading show through): tan wash grading heavier toward
   the rim, a brown rim whose width (2–8 mm) and darkness wander around the
   outline, 2–3 nested tide rings that are soft-edged and *broken* (gated on
   their own noise, open for a third of their length), the older leak's faint
   outline, a 1 mm swell. No crazing network, no chalk flakes. The second
   stain (tile 15,3, atlas half 1) exists — the claim stands. The sag slot
   tapers: the −z edge drops 14 mm at its middle and 0 at the corners (the tile
   is held at the crossings), and a matte near-black slab sits in the plenum
   behind it, so `ceiling-stain` 700–1260 × 270–300 is a near-black lens
   closing to nothing at both ends with no lit strip under it.
7. **Seat burnish** — the rev 2 blotches are gone from the tiling map; the
   burnish is one zone in the cushion's vertex colour (`cushionGeometry`
   `burnish`): the front 12 cm lighter and a touch pinker where thighs slide,
   glossier in the roughness. `stripes` 330–600 × 520–720: no grid.
8. **Counter seam** — a 2 mm flush matte near-black overlay line
   (`plinthLine`) instead of rev 2's 0.8 mm proud satin strip, whose
   sub-pixel highlight aliased into dashes. `counter` 910,647 → 1050,590 is a
   continuous dark hairline.

Polish done: boomerangs denser/smaller in four tones; cup rings as partial
arcs. Skipped (not reached): carafe film above the level / warmer ring /
panel scratches, cast-iron casting grain, cap dings as dents, signage mount
hardware / decal yellowing / glass smudge, T-bar chip legibility.

Caveats: the aisle lane's grey step is real in the map (whites × 0.62 toward
dirt grey at full lane weight) but at standing height the sun patches on that
floor dominate; the crack's lit/shadow lips are geometry and only shade under
a directional light — in `floor-macro` the crack is in the room's fill and
reads as a kinked hairline with a soft dark side and a faintly pale edge, not
a ridge; `wall-macro` frames a shaded wall, so the stipple's directional
shading can only be checked where the sun reaches a wall (`booth` pier).

Lessons (rev 3): **compose wear by max, not sum** — a marching stamp visits
each texel many times, and summing densities saturates every core (the first
pass of the floor smears was solid black). **Multiply, never composite,
anything that is a film on a surface** (rubber, grime, water minerals): the
substrate then decides how visible it is, which is the whole difference
between a stamp and a mark. **Sample mark texture in the mark's own frame**
(along × across) — isotropic noise over a thin stroke produces a ladder of
cross-stripes. **Sub-pixel geometry aliases into dashes**: a hairline that
must read at a pose needs ≥ 1 px there (2 mm at 2 m) or it beads. **Before
blaming a map for sparkle, A/B the light path**: `?taps=`, `?ibounce=`,
`?post=0` split the fireflies into PCSS residue (laminate) and post dust motes
(everything else) in three shots.

**Fireflies — diagnosed, not textures.** Two sources, both outside System 5:
- *Laminate* (`macro-table` 300–1100 × 750–1050, 134 near-white isolated
  pixels; also the concentric "fingerprint" ripples): the sun's **PCSS**.
  Re-shot with `?taps=32,24` (blocker/filter taps, `Lighting.ts installPcss`)
  the count is **0** and the ripples are gone; nothing else changed. The 8-tap
  blocker search with per-pixel interleaved-gradient rotation leaves a
  structured residue in the blind-slat penumbrae that the tone curve lifts to
  white on the pale laminate. For the lighting builder.
- *Door stile / wall / kick plate / vinyl* (`door` 1080–1260 × 300–800: 30
  dots; `kick-macro` plate: 39): identical count with `?taps=32,24`, with
  `?ibounce=0.001`, and on `origin/main`; **gone with `?post=0`**. They are the
  System 8 **sun-beam dust motes** (`src/post/Dust.ts`, `post:sun-dust`
  Points, the "sparkly" size class) hanging in the beam prisms in front of the
  door — 1–2 px white points that read as specular fireflies on dark
  materials. For the post/System 8 owner (mote size floor or brightness of the
  sparkly class), not a map issue: the plate's roughness floor is 0.3 and the
  vinyl's crazing is albedo-only.

Perf vs `origin/main` @ 5894333, same session, quiet GPU: scene ready 10.66 s
vs 10.37 s (+0.29 s), texture workers 8.11 s vs 8.03 s wall, draw calls 180 →
180 (+1 `kickPlateWorn`, −1 `vinylRedWeltCracked` aliased to the crazed
material), triangles 1.2424 M vs 1.2417 M. New textures: the crazing atlas
(1.4 m, 1 map) and the kick plate canvas (1024 × 256, 2 maps); the vinyl
tiling map lost its blotch pass.

### System 5 rev 4 — the five blockers, at 1:1 (`sys5-rev4`, frames `shots/sys5-*.png`, A/B `shots/sys5-ab-*.png`)

The rev 3 critic cleared five of eight rev 2 blockers and failed the pass on
five items. Rev 4, materials only (no lights, tone, post, Openables/Presence):

1. **Laminate moiré — settled by A/B, it is the shadow term.** Committed
   `shots/sys5-ab-a-asis.png`, `-b-taps32-24.png` (PCSS blocker/filter taps
   32/24) and `-c-lamflat.png` (`?lamflat`: no albedo, roughness or normal
   map — constant cream, roughness 0.4). The concentric arcs are in **all
   three**, identical in pitch and phase, and also in `-g-lamflat-matte.png`
   (`?lamflat=matte`: specular 0, clearcoat 0 — diffuse only), `-d-…-normalbias05`
   and `-e/-f-…-screenphase` (per-pixel IGN phase on the PCSS taps). A pattern
   that survives constant maps and a diffuse-only material is not in the
   material; one that stops dead at the shadow terminator and only exists in
   the sunlit penumbra of the blinds is the shadow-map texel grid beating
   against the screen grid through the blind slats' 25 mm pitch. **Owner:
   lighting** (`Lighting.ts installPcss`; more filter radius / a texel-space
   jitter, or a higher-res sun map for the table zone). The rev 3 note "0
   dots at `?taps=32,24`" was about the *fireflies*, which are gone — the
   ripples never responded to taps. No roughness floor can mitigate a diffuse
   term, so none was added; the frames still show it and this is flagged.
2. **Kick plate is metal now.** `kickPlateWear` albedo is oxidised-aluminium
   F0 (sRGB 238/240/243, neutral cool), roughness 0.22–0.32 in the brushing
   (was 0.36–0.54, khaki 224/228/232). The material has its own **door probe**
   (`Diner.ts`: a CubeCamera at the plate's station, `userData.doorProbe`)
   and a shader hook (`kickPlateWorn.onBeforeCompile`) that replaces the IBL
   radiance lookup with a **box-projected, 9-tap Gaussian fan along the brush
   direction** (spread 0.6 × roughness, sampled at roughness × 0.6): the floor
   checker under the door and the bright threshold smear into vertical
   streaks that break up run by run with the brushing texture, which is what
   a satin anisotropic mirror does and what three's built-in `anisotropy`
   could not do against a probe parked 2 m away (it reflected the room's
   average). `envMapIntensity` 1.3. Screws and boot smears kept; the bent
   bottom lip catches the threshold as a bright edge. `?kpmirror` sets
   spread 0 / lr 0.05 for reading the projection.
3. **Vinyl crazing.** Cracks are now dark red-brown grooves (sRGB 92/30/20
   mixed ≤ 0.8 → × 0.62–0.7 of the vinyl at full darkness; rev 3 was × 0.25
   ink), each walk has its own width (0.5–1.6 texels, old ones 2+) spilled
   onto the neighbour texel, headings wander gently (the ring doodles were the
   1.1× fbm wobble), the texel on the lit side of a crack lifts 8–14 %
   (the raised lip), the crazed field goes paler and greyer (chalked
   plasticiser, 24 % toward 178/70/60 at full density), and a second atlas
   channel — **`physMap`**, R = clearcoat factor, A = specular-intensity factor,
   a 5 mm box blur of the crack field — makes the net **matte** (clearcoat
   → 0.15 ×, specular → 0.45 ×), so at `booth` distance the crazing is a dull
   patch and the hairlines are near-invisible, while `welt-macro` resolves
   them. Density beside the cords 0.2–0.65 (was 0.3–1.0). Stitch rows (0.6 mm
   holes at 3.5 mm pitch with thread dashes) run 3.5 mm out from every cord,
   4.5 mm either side of the roll seam and along each welt's foot. **The
   roll/channel junction is a real seam**: the channel panel runs to 2 mm past
   the piping (`boothBackDims().panelH` from `rollSeam()`, which places the
   3.5 mm piping 25 mm out from the wedge face where it first touches the
   roll — rev 3's sat 5 mm off the roll over a 47 mm bare strip), its top edge
   keeps full crown height under the piping (only the seat end tapers), the
   welt cords stop 1 mm short of the piping's axis (their end discs inside
   the piping — no caps), a 0.8 mm dark top-stitch runs 4.5 mm up the roll,
   and the tuck gathers pucker under the seam. Atlas relaid at 1.5 m.
4. **Ceiling stain.** One outer rim (2–9 mm, weight and darkness wandering,
   open for short stretches), **one** faint inner tide line (the older leak's
   own off-centre outline, gated, 0.28), a **blotchy** wash driven by a coarse
   fbm with dry islands (no radial gradient), and the tile fissures × 0.45
   browner inside the stain (dirt in the slots). The three nested rings are
   gone. The second stain moved from tile 15,3 (no pose saw it) to **3,5** —
   in `ceiling` at ≈ 1380 × 880 next to the fan's blade tip.
5. **Floor crack — it had never drawn.** The dark-floor ribbon's index order
   was clockwise from above and back-face culled since rev 2; the "crack" the
   critic saw was the floor map's 0.9–1.4 px strokes (3.75 mm texels → a
   5 mm feathered smear, pale on charcoal). Fixed the winding; the ribbon is
   0.6–2 mm across (`hwAt` 0.3–1.0 mm), a hard 1 px line at `floor-macro`
   (≈ 450–1200 × 800, on both tile colours the same dark), starts **at** a
   joint (start x snapped to the nearest seam), jogs at joints, runs along a
   seam 5–25 mm or (1 in 3) 40–120 mm; the map strokes are gone and replaced
   by **chips** — 3–9 mm pale matte bites along the lip every 20–60 mm, alpha
   by substrate luminance.

Polish done: **6** scuffs — bend ±0.35 rad max (no J/7/comma), 6–26 mm, edge
profile (1 − d²)^0.7, × 0.6 on whites (grey, not black) and × 0.94 on
charcoal (invisible; the wax dulling in roughness is what shows), 420 marks;
**7** white-tile tone ±4 % (blacks ±8 % already); **8** no outline-only
boomerangs (the hollow ones read as outlined stickers), cup rings 0.5 mix /
+0.42 roughness, scratches 0.34 α / +0.45; **9** seat burnish 0.22 and a
`mkVinyl` shader hook: the vertex colour's green excess flattens the pebble
normal (up to 85 %) and halves roughness — the nose is a lighter *and*
glossier band (also polishes the cushion edges); **10** wall band roughness
core `prof⁴ × 0.42` down to 0.28 along the centre (skin oil); it cannot be
seen in `wall-macro`, which is flat shadow with no specular path. Skipped:
lane haze — the lane greying (0.62 toward grey 130) already exists and
reads in `counter`; no change.

Later-stage items were **mine**: the hard-edged lighter parallelogram
(`floor-macro` 1560–1760 × 830–980) and the strip beside the booth base were
the `sheltered` rectangle's in/out roughness step, and the booth rect ran to
`DOOR.hingeX − 0.9`, out onto the open floor. The shelter is now feathered
0.12 m inside the footprint and ends at the last divider (+0.95 m).

Lessons. **Check that geometry draws before tuning it** — a culled ribbon
absorbed two revs of "make the crack sharper". **A/B the light path with a
constant-map flag before touching a map**: `?lamflat` cost one shot and
settled ownership. **A probe reflection only reads if it is projected**:
`envMap` on a curved-normal plate with a distant probe is a room average;
box-project it to the room and stretch the lookup along the brush, and the
floor appears. **Seams are positions, not offsets** — the roll seam was three
independent numbers (piping, panel top, cord length) that drifted apart;
`rollSeam()` derives them all from one contact point. **Matte is a channel**:
crazing, burnish and rub bands all needed roughness/clearcoat to move, not
albedo alone.

Perf vs `origin/main`, same session: scene ready 11.1 s vs 10.4 s (+0.7 s —
texture workers 8.6 vs 7.85 s wall: the atlas's density blur + `physMap`, the
per-pixel shelter feather), draw calls 177 vs 179 at boot, `counter` 272 vs
274, `length` 321 vs 321, triangles 1.256 M vs 1.242 M (longer channel
panels). New: `physMap` (2048², one channel-1 texture), the door probe (one
CubeCamera at boot), two shader hooks (`kickPlateBoxProbe`, `vinylBurnish`).

### System 5 rev 5 — the three blockers, then merge (`sys5-rev4` → `main`, frames `shots/sys5-*.png`, floor A/B `shots/sys5-ab-floor-*.png`)

The rev 4 critic confirmed four of five rev 3 failures fixed (kick plate,
crazing, stain, crack) and failed the pass narrowly on three items. Rev 5,
materials only, plus one contact-shadow authoring fix in `Lighting.ts`
(geometry, not lights):

1. **Kick-plate boot smears as continuous drags.** Rev 4 gated every mark's
   path with a 64-cell fbm sampled at `t × 0.6` (`gap = smoothstep(0.34,
   0.44, along)`) — periodic along the stroke, so each drag came out as 6–9
   equal dashes, the "dashed stamp". Each mark is now ONE integrated path
   (heading = arc + drift, an optional hook over the last fifth), full
   density and width within 5 % of the impact end and feathering to nothing
   along `(1 − t)^1.3`; the field is sampled at `t × 0.08` (one cell per
   drag, so it can only thin, not chop) and gates the trailing half alone;
   plus a grey rubber-dust halo at 2.4× the width (`Hd`, −10 % albedo,
   +0.12 roughness). The first two marks are the long drags by the latch
   (120–200 mm, one hooked). `kick-macro` 460–1460 × 600–920: every mark is
   a comma — a dense head, a tail that thins and fades, no repeated ovals
   anywhere on the plate.
2. **Booth vinyl pale flecks removed.** They were the flaked-scrim `island()`s
   (rev 3–4): free-standing 2–8 mm pale cotton blobs 5–17 mm off the roll seam
   and beside the cords. Deleted, together with the `scrim`/`rim` fields.
   Pale wear now exists only INSIDE the crack lines: `walk()` marks an `open`
   field along the old, wide cracks (`wide ? fade · (0.5 + 0.5 · spill)`) and
   the compose step mixes the crack FLOOR 75 % toward the cotton backing
   (196/182/160) there, so the backing shows in the widest hairlines and
   nowhere else. `booth` 512–722 × 386–446 (the roll) and the panels below
   it: plain red, hairline network, no pale spots (rev 4 frame at the same
   crop: four cream blobs). `welt-macro` 560×900 / 1105×345: clean.
3. **Hard-edged floor rectangles — owned by the contact-occlusion mesh,
   fixed.** A/B at `floor-macro` (committed `shots/sys5-ab-floor-a-asis.png`,
   `-b-nocontact.png` = `?hide=contact-occlusion`, `-c-noshelter.png` =
   `?noshelter`; also run, not committed: `?nocast=counter`, `?nospot&nolot`,
   `?nofluor`): both artefacts survive the roughness step, the counter's
   shadow, the suns and the troffers, and vanish ONLY when the contact-
   occlusion mesh is hidden. Cause (Lighting.ts contact shadows, booth
   block): per aisle end, an end-panel strip (`xa..xb` at `zEnd0`) and a
   divider strip (`xd ± 0.05`) with hard cut ends overlapped by a few cm —
   the occlusion multiplied twice where they overlapped, once beyond = the
   two stepped lighter rectangles at 1050–1145 × 112–188; the end-panel
   strip's cut end at the bay opening = the quadrilateral at 1630–1725 ×
   825–940; and every strip started at the panel face `zEnd0` while the kick
   is recessed 12 mm, so the recess floor was unoccluded = the bright 1 px
   seam. Fix: `strip()` takes `fade: [a, b]` (a free end ramps to zero over
   that length); each aisle end is ONE run from the bay opening's free edge
   (60 mm fade) to the divider centre shared with the neighbour (or the end
   partitions), starting at the KICK face. The door-side partition's outer
   corner is convex, so the run carries 50 mm past it and fades over 80 mm,
   and the partition's vestibule-face strip starts 50 mm before the corner
   with the same fade — a dead stop there had left a faint vertical step at
   1077 × 100–210 (world x 3.42) in the first rev 5 frame. Both rectangles
   and the seam are gone from the committed `floor-macro`; the tile at
   1097×150 grades smoothly into the partition foot on both sides.

Polish (all ten attempted; 9 verified as bound, not visible — see below):

4. **Crack chips as geometry, second crack.** A 3–6 mm bite is one texel of
   the 3.75 mm floor map — two revs of map chips never resolved. Chips are
   now ragged 5–8-gons, 3–9 mm across, 0.4 mm over the lip in `Shell.ts`
   (almond `pal.cord` on cream tiles, grey `pal.tileBacking` on charcoal, by
   tile parity), 2–3 clustered at every segment end (the joint) and one
   every 60–120 mm; two material buckets. A second crack (`wear.cracks`, `floorCrackSegments` →
   `oneCrack()`) starts from a joint two tiles toward the door.
   **Registration bug found on the way:** `dinerFloorWear().originZ` was
   `zBack`, but Shell.ts scales the floor's v by d / 6 m (20 tiles), so the
   canvas's row 0 is 6.0 m behind the window wall — every world-authored
   mark (lanes, shelter, the crack's joint snapping and along-seam runs, the
   replaced tile) had been 150 mm off in z since rev 2; the map's chips sat
   a lip-width from the ribbon (`dbgreg` frame, green path vs black ribbon).
   `originZ = zFront − 6.0` now; the crack follows the real seams.
5. **Seam pucker.** The panel-top crazing band under the roll piping is a
   third of rev 4's (`strength 0.25, reach 0.012`) and each stitch throws a
   short diagonal wrinkle (3–7 mm, ±25–40°, lit flank / shaded flank at
   ±22 %, `wr` field). Channel stitch holes are 1.4 mm (two texels) with
   brighter thread — `welt-macro` shows a dotted row both sides of every
   cord. The dark band directly under the piping that remains is the tuck
   geometry's own shading.
6. **Cup rings and scratches; seat burnish.** Seven rings per 1.2 m canvas
   (a 0.7 m top samples a third of it — three rings left most tops with
   none): `macro-table` ≈ 560–820 × 790–880 shows a brown partial ring on
   the shaded laminate. Scratches 0.55·a white at 1.3 texels (an abraded
   scratch shows the paper in the diffuse). Burnish: the rev 4 signal
   `vColor.g − 1` was a 35 % lift of G = 26/255 — nothing — and the halved
   roughness had no light to mirror in shade; the signal is now `G − R`
   (plainColor's uniform tints on welts/cords cancel), and the band mixes
   the diffuse 55 % toward a pale pink, adds 0.5 clearcoat and takes
   roughness to 0.3×. `stripes` lower-left cushion: a lighter, pinker band
   along the nose. The pebble grain itself is 0.55 mm — sub-pixel at 2 m by
   design, so "no grain" at that distance is correct.
7. **Seat-front piping**: welt tint 1.3 and a 2 mm dark bead (0.55) sunk
   under it so its lower half shows — `undertable` reads a light line over a
   dark line along every seat nose.
8. **Stain rim**: weight follows `cos(θ − lowAng)` (0.12 → 1.0), inner edge
   harder on the low side — `ceiling-stain` 790–1125 × 347–545: hard brown
   line lower-left, fading to a soft tan edge upper-right.
9. **`wall-macro` orange peel**: verified — `wallStipple` normal map is
   bound (`normalScale 1.3`, 0.2–0.5 mm domes at 2–4 mm, aoMap alongside),
   but that wall at that pose sees no directional light (probe + fills
   only), so a normal map has nothing to shade; the mottle visible is the
   aoMap. Not a material fix; needs a grazing light or a different pose.
10. **Blind slats**: a settled-dust line along the up-face trough
    (`slatDust`: 30–40 % of the slat wide, −7.5 % albedo, +0.25 roughness,
    weight wandering along the slat). `blind-macro` looks up at the slats
    from below, so the line is on the faces it cannot see.

Skipped: nothing on the list; item 9 is a report.

Later-stage (report only, unchanged): red-pink tint along the threshold
edge (`kick-macro` y ≈ 913–919: the saddle's edge band catching the red
vinyl in the door probe); 1–2 px sparkles on sunlit laminate and pebbled
vinyl (System 8 dust motes + PCSS fireflies, rev 3 diagnosis stands); ~40
white dots on the shaded wall in `door` 1180–1310 × 560–1040 (dust motes).

Lessons. **Prove ownership before touching a map**: `?hide=` / `?nocast=` /
`?noshelter` cost three shots and put the rectangles in a file I had not
suspected. **Check registration with a debug stroke**: one green line in the
map against the world ribbon exposed a 150 mm offset that four revs of
"authored in world metres" had hidden. **Below one texel, use geometry** (the
crack ribbon, its lips, now its chips). **A tint signal on a saturated
colour must move the weak channels** — lifting G by 35 % on a red does
nothing; mix toward the target colour instead. **Never gate a drag with a
high-frequency field** — anything periodic along the path reads as stamps.

Perf vs `origin/main` (90dc584 = System 5 rev 2 + System 9 rev 4), same
session, same GPU: scene ready 12.2 s vs 11.1 s (+1.1 s, in the texture
workers: the per-mark halo pass on the kick plate, the wrinkle and `open`
fields in the atlas), draw calls 185 vs 183 at boot (rev 4 measured 177
against a then-main of 179; the chips are two new material buckets),
`door` 202 vs 202,
`length` 326 vs 322, `aisle` 270 vs 272, `counter` 273 vs 275, `floor-macro`
184 vs 182, triangles 1.322 M vs 1.266 M (the second crack's ribbon and lips,
the chips, the welt beads). New capture flags: `?hide=a,b` (hide meshes by
name substring), `?nocast=a,b` (clear castShadow, shadows invalidated),
`?noshelter` (drop the floor shelter step) — main.ts / materials.ts. Merge:
`origin/main` merged twice (sys9 rev 3 at debb987, rev 4 at 90dc584);
`Diner.ts` keeps both the door probe (`userData.doorProbe`) and System 9's
station probes (`userData.probePos`), `textureBank.ts` keeps both label sets;
`sys9-kitchen-door` / `sys9-cabinet` re-shot after the merge: plates, scuff
rubs, cabinet all present, mean |Δ| 2.4/channel vs System 9's frames (my
material changes + PCSS noise).

### System 5 polish (`sys5-polish`, no critic loop; `door length floor-macro table macro-table kick-macro stripes` re-shot)

Rev 5 passed and closed the gate; one time-boxed polish round on the four
notes. **Floor scuffs** were one population — same width, similar length,
random angle, everywhere — and each was still chopped by a lift field
sampled at `t × 0.6` (38 cells per mark: the dash-chain). Now three families
placed where they happen: PIVOTS (30–90 mm tight arcs, ±0.6–1.3 rad) cluster
at `hotspots` — the aisle side of every stool base, both ends of every booth,
the threshold (weight 2.2) and the door fan; SCUFFS (20–140 mm, skewed short,
shallow bends) ride the lanes; a few DRAGS (250–500 mm broad faint arcs)
cross the open floor, which is otherwise sparse (half the free marks
dropped). Width 3–24 mm skewed narrow, weight 0.3–1.0, and every mark has a
heavy end (density × (1 + 1.1(1 − t)⁴), width × (0.7 + 0.3(1 − t)²), the
tail fading from t = 0.5); the lift field is sampled at `t × 0.1` and only
thins the trailing half. Map crops at the threshold and the stool row:
commas, hairlines and broad smears together, clustered, none chained.
**Cup rings**: `ringAt()` gives each ring a tilt side — pooled there (1.5 mm
line, 5 mm inward fade, full weight), a hairline opposite (0.5 mm, ¼ weight),
broken by a 6-cell field around the circumference; ten per canvas (two
strong, three medium, five faint — the first seven keep rev 5's positions,
the polish parameters draw from their own stream). Map: strong ring −34 %
luma at the pooled edge, faint −12 %. `macro-table` 560–820 × 790–880: the
ring is now heavy on its right, fading left, broken. **Kick plate grain**
runs lengthwise: the streak field is sampled along v (map |Δ| across rows
4.8 vs along 0.33), the probe fan follows `cross(up, N)` in world space (so
it stays along the leaf when the door swings), the roses' `anisotropyRotation`
is 0. `kick-macro`: horizontal runs, the doorway smeared across the plate.
**Contrast check from the maps** (not frames) for +1.5 EV: stitch holes are
20/255 texels in a 60/255 field (−65 %), pucker wrinkles ±22 %; slat dust
−6.5 % albedo and roughness 0.31 → 0.53 in the trough; burnish is a shader
mix (36 % toward pale pink, +0.33 clearcoat, roughness × 0.54 at full band)
— all ratios, exposure-independent. Draw calls 185 / boot ≈ 12 s unchanged.

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
**`[` / `]`** exposure ±0.25 EV (rev 7, persisted); **Shift** walk fast (2.6 m/s, 0.2 s blend in/out, same 0.15 / 0.12 s accel/decel *times*,
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
| `__interact("drink" \| "cabinet" \| "cabinet-right" \| "cabinet-close" \| "kitchen-door" \| "kitchen-door-close", t?)` | System 9: drink (1.6 s; a seek fills the mug first), toggle the left / right cabinet door (`t` seeks the 0.8 s opening), close the left door (`t` seeks the 0.75 s closing), toggle the kitchen door — it opens and HOLDS at 90° (`t` seeks the 1.5 s opening), close it (`t` seeks the 2.25 s spring return) |
| `__interactPose("sit-seated" \| "pour-mid" \| "pour-full" \| "door-open" \| "drink-sip" \| "cabinet-open" \| "kitchen-door-open" \| "kitchen-door-back")` | state + camera for `tools/shoot.mjs` |
| `__interactions` | the live object: `.sit.state`, `.pour.state`, `.pour.fill`, `.door.progress`, `.door.angleDeg`, `.drink.state`, `.cabinet[0..1].{state,angleDeg}`, `.kitchenDoor.{state,busy,angleDeg}`, `.target`, `.audio.state()`, `.startAudio()` |
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
  second `SteamEmitter` (`Pour.ts` → `MugSteam`) whose strength / life / width / burst are
  driven from the pour clock, so the API here is the only steam API (steam rev 2 kept that:
  `Drink.ts` only feeds `pour.steamVelocity`).
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

`steam` (Steam.ts — `SteamEmitter`; **steam rev 2, `sys8-steam`**: wisp ribbons, one instanced draw per source, premultiplied alpha, no sprites)
- Rev 1 was 20–28 radial-alpha billboards per source; the critics read them as opaque cotton balls and hollow rings (a radial-falloff texture with an off-centre noise hole *is* a ring). Rev 2 draws `count` **strands**: each a 20-quad camera-facing ribbon whose centreline is a *streakline* — every term is a function of the parcel's emission time `tau = t − s·life`, so knots, bends and bursts travel up the strand with the flow instead of sliding along a fixed tube.
- Centreline: buoyant rise `rise · s(1.6 − 0.6 s)` (1.6× mean speed at the surface, 0.4× at the top — never stalls; a stalled top seen from above lies flat and folds the ribbon), source disc `radius` with a slowly wandering release angle, `release` lean, room air = divergence-free curl of three travelling sines (speed ≈ `shear`, wavelength `shearScale`) sampled at the parcel's mid-life, `wind` draught, `meander` (∝ `s^1.7`, none at the laminar root, wavelengths ≥ 5 cm so the strip never turns sharper than its width), and a carried source: `emitter.velocity` (m/s, world) leaves older parcels where the source *was* and tears them up (`exp(−|v|·age/0.05)`).
- Ribbon side vector = `cross(view, T)` with `T` = local tangent × 0.35 + strand chord × 0.65, handedness pinned to camera-right. A strip that follows every local turn folds over itself where the centreline bends sharper than its width and draws a bright double-alpha crease (the "thin bright slivers" of the first crops — diagnosed with `wireframe = true` and single-strand renders).
- Alpha along the strand: `smoothstep(0, 0.26, s)` (0 at the rim crossing — the mug rim is never sliced), peak 5–6 cm up, exactly 0 at the top; × `(width₀/width)^0.8` (diffusion thins what it widens — strongly enough that the widened upper half reads clearly fainter than the root); × burst envelope (`burst` 0 → continuous threads, 1 → packets 0.6–1 s long every 2–3 s per strand, staggered by seed); × per-strand 0.5–1; × `fadePlane` distance (`smoothstep(0, fadeWidth, n·p + d)` — back wall for the mug, brew-basket underside for the decanter). Peak `alpha` **0.12–0.25** in shade before `strength`.
- Across the strand (fragment): Gaussian with a ±40 % wobbling half-width and a drifting core, closed by `1 − smoothstep(0.5, 0.9, |u|)` before the quad edge; along-strand streak noise anchored to `tau` (dense knots and clear gaps, floor 0.1 — a strand breaks into pieces but never cuts to exactly nothing); past mid-height an across-strand noise splits the widened sheet into filaments — the across coordinate is scaled by height (lanes fan apart, never parallel), shifted by a parcel-anchored warp and thresholded from two incommensurate octaves (unequal widths and spacings that form and vanish). Vertex side: ±40 % width jitter along the strand riding with the parcel. No radial term anywhere.
- Centreline (rev 3): besides rise, room air, release lean and the `s^1.7` meander, every strand *bows* — a per-strand bend ∝ age² (`release × 3 × age²/life`, direction wandering slowly; curvature radius ≈ 25 cm at the top) so no strand is straight over more than a few cm and neighbours bow different ways — and a root `curl` (m, `smoothstep(0, 0.3, s)`-weighted) twists the laminar part where a draught passes the source (the brew basket). Carried source: each strand lags a different fraction (0.4–1) of the source displacement, its trail leaves at its own fixed angle (±25°) off the motion and curls along its length (vortex street), the visible trail is capped at 15 cm (`1 − smoothstep(0.09, 0.15, d)`), and the wake is torn by `exp(−uTear·age)` with `uTear = |v|/0.06 + min(6, |a|)/1.5` (CPU, from `e.velocity` and `e.acceleration`).
- Light: fill radiance `color × intensity` in shade; where the fragment is in the sun beam — the dust's `inBeam` aperture prism × the compare-map `sunVisibleSoft` (3 taps over one slat pitch) — `sunBoost` **2.5** × the fill luminance in the sun's hue, HG g 0.6 forward-scatter weighted (normalised at 25° like the dust). The beam test runs **per fragment**: the slats cut the beam into 12 mm stripes, finer than a 9 mm ribbon row, and the per-vertex test aliased them into bright bars. `backdrop` is a per-emitter alpha multiplier standing in for background contrast (the pipeline has no colour buffer at scene time). Premultiplied `(radiance·a, a·occlusion)`: the vapour adds scattered light and dims the wall by `occlusion` **0.35**.
- Decanter (settings.ts): `count` **4**, `rise` **0.16**, `life` **1.6**, `offset` **[0, 0.012, 0.06]**, width 7 → 45 mm, `alpha` 0.14, `burst` 0.9, `wind` [0.004, 0.09] (out from under the brew basket toward the front), `backdrop` 1.3, fade plane at the basket underside. Decanter rev 3: `meander` 0.024, `curl` 0.008, `release` 0.024; the emitter follows the `coffeePot` group, so while System 7 carries the pot its plume smears out over the first centimetres of the lift (frame-difference velocity → wake tear) and is off until the pot is back on the warmer (`strength × (1 − smoothstep(1, 6 cm, |lift|))`). Mug (Pour.ts `MugSteam`): `count` **5**, `radius` 24 mm, `rise` **0.18**, `life` **1.4**, width 7 → 50 mm, `shear` 0.07, `meander` 0.02, `curl` 0.003, `burst` 0.85, `alpha` **0.12**, fade plane at the back wall; `life`/`width`/`burst` build over the pour and scale with the fill level; `Drink.ts` derives the mug's world velocity and acceleration (three `poseAt` samples 1/120 s apart) into `pour.steamVelocity` / `pour.steamAcceleration` so the lift and sip drag the wisps and the wake behind a fast or jerked mug is torn to nothing.
- API: `new SteamEmitter(params, sun)`, `scene.add(e.object)`, `e.update(t)` per frame, `e.strength = 0` to fade, `e.velocity` / `e.acceleration` for a carried source. All `SteamParams` are public and re-read every update; `count` rebuilds the geometry. `?debug.timeSteam=1` wraps each emitter's draw in its own GPU timer (`post:steam-<name>` in `post-bench`).
- Cost: +1 draw call per source (226 vs 225 at `warmer`), **0.002–0.006 ms** GPU per emitter (`post-bench --configs="post=1&debug.timeSteam=1" --poses=warmer,macro-warmer`, 4060; rev 3: 0.004–0.006 ms, same draw calls), no per-frame allocations (uniforms updated in place).

`bloom`
- `threshold` **2.2** scene-linear luminance (only the hot exterior and specular pings; the placeholder interior peaks ≈ 1), `knee` **0.6**, `strength` **0.045**, `radius` **1.0**. No halos: 9-tap Gaussian at ½ then ¼ res, added before tone mapping.
- `clamp` **24** — per-tap luminance ceiling in the prefilter (`fetchClamped`), so one HDR ping (a specular pin, a mote) carries at most ~10× the threshold into the blur instead of 10³× and cannot come out as a saturated blob. The motes are also capped in their own shader at `threshold − knee` (`SunDust.maxRadiance`, set by PostPipeline each frame): a mote is a white speck, never a bloom halo.

**Counter-edge beads (`fix-counter-door`, `shots/fix-counter-{before,after}-{user,counter}.png`).** A chain of 30 px white blobs
along the counter's stainless backsplash lip, seen from behind the counter. A/B (`?post=0`, `?bloom=0`, hide by material, `?nobounce`,
in-page `anisotropy = 0`) put it on the lip's `MeshPhysicalMaterial` with `anisotropy 0.6` lit by the per-booth floor-bounce spots:
without a `tangent` attribute three builds the anisotropy frame from screen-space derivatives (`getTangentFrame`), scaling T and B by
*one* shared factor, so on the lip's 7.8 × 0.1 m RoundedBox face with 0..1 UVs both ways (78:1) the tangent came out ≈ 0.013 long
and `D_GGX_Anisotropic` spiked 10³–10⁴× wherever the half vector crossed the plane of the missing axis — once per light along the lip,
independent of roughness (a roughness-1 lip still beaded), then bloom grew each spike into a blob. Not the roughness map, not the bloom
downsample, not the profile tessellation, not the troffer light count. Fix: `core/shaderPatches.ts` (installed by `createPalette`
before any program compiles) re-orthonormalises the anisotropy frame in `lights_physical_fragment` (keep the longer axis, rebuild the
other as N × it) for every physical material; `?anisofix=0` is the A/B. The bloom `clamp` and the mote radiance cap above are the
safety nets the report asked for. Frames: the lip is a continuous soft sheen at both poses, tabletop specks reduced to micro-sparkle,
the mote column above the counter has no halos. A related observation left alone (Lighting.ts is System 4's): the troffers and bounce
patches are `SpotLight`s, so on a low-roughness metal they reflect as pins, not as 0.5 m panels; a Karis sphere-light widening of the
specular lobe for penumbra-1 / angle-89° spots was tried and dropped — it flattened the napkin dispensers and stool bands more than it
helped the lip, which no longer needed it.

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

### Verification — steam rev 2 (`sys8-steam`; `shots/sys8-steam-{pour,drink}.png` sheets + key frames)
- Drink k0 (1:1 and 2× crops over the mug, 900–1120 × 400–800): two to three translucent strands 7–50 mm wide rising ≈ 12 cm, leaning with the room air, splitting into filaments past mid-height and gone before the wall's top edge; the steel backsplash and the wall texture read through every part of them; no circular silhouette, no ring, no hard row edge. The pale wedge at 935–945 × 0–60 is gone (the column tops out ≈ 500 px lower).
- Drink lift/sip (0.6–1.7 s): at 1.9 m/s the wake is torn within a centimetre (nothing trails a fast mug — a coffee mug lifted briskly shows no steam until it stops); at the sip (0.3 m/s) faint straight streaks 15–20 cm long trail up and away from the rim, wall readable through them.
- `macro-warmer` / `warmer`: two soft grey filaments from the decanter mouth drifting forward out from under the brew basket and up its front, fading against the black housing; the fade plane removes the hard clip at the basket underside.
- Sun: the per-fragment test brightens a strand only where it crosses a lit slat stripe (soft 12 mm bands, sun hue), nothing else changes; `debug.timeSteam` timings above.
- Diagnosis method that found the crease: swap the fragment output for `vec4(0.5, 0, 0, 0) · env · 40` with `across = 1` (raw quads), then `material.wireframe = true`, then `instanceCount = 1` with the seed row copied per strand — three page-side edits, no rebuild.

### Verification — steam rev 3 (`sys8-steam3`; the same sheets/frames re-shot like-for-like: `shots/sys8-steam-{pour,drink}.png` + keys, `warmer`, `macro-warmer`, `pour-mid`, `pour-full`)
- **Root radiance (drink k0; pngjs on `sys8-steam-drink-k0-0.00s.png`, luminance 0.2126/0.7152/0.0722).** Strand column 900–1120 × 600–790: per-row max **63–78** over the steel band (background 44–47 → ≤ 1.5×) and over the counter (background 50–53 → ≤ 1.5×); region p99.9 82, p99 71 (rev 2: 105–142 over 50, 2.1–2.8×). The two brighter rows at y 580–590 (82–85) are the backsplash's polished top edge, present off-strand too (reference 1150–1250 × 560–640: max 84). Mug glaze specular max **163** @ (973, 965) — the strand peak is 48 % of it (target ≤ ~L95). The alpha peak sits 5–6 cm above the rim (`smoothstep(0, 0.26, s)`); the rim crossing is faint. `pour-full` / `pour-mid` keep a readable knotty column over the dark panel (same emitter, so they lost ≈ 30 % too; still clearly present).
- **Straight-ray regime.** Iteration frames at drink T = 0.9 / 1.0 / 1.4 / 1.5 / 1.8 / 1.9 (2× crops): the lift end shows three or four *broad soft bands* fanning at different angles (±25° per strand) and bowing along their length, ≤ 15 cm, wall readable through them; the sip and set-down show a faint smeared veil or nothing. No equal-width bright rays, no parallel bundle, nothing reaches the top of the frame. Static strands (k0, warmer): every strand bows (age² bend) — none straight over more than ~5 cm.
- **Pour-k2 top-left streaks: they were a steam emitter** — the decanter plume. `PostPipeline` places that emitter from `coffeePot.matrixWorld` every frame and System 7 carries the real pot, so during the pour the plume flew with the pot (at k2 the pot is high over the mug, off the top-left of the frame) and its 30 cm strands, seen from 2–3 m, read as two straight rays across the wall and tile band. Proven by diffing pour-k2 against the same frame with `?steam=0` (streaks gone: 604 px differ in 330–650 × 0–220) and `?haze=0` (streaks stay). Fix: the plume smears with the frame-difference velocity and fades out as the pot lifts (1 → 6 cm); the region is clean in `sys8-steam-pour-k2-1.50s.png`.
- **Ribbon uniformity.** `macro-warmer` (3×): one main wisp with dense knots and gaps, ragged edges, laminar 3–5 cm then a curling tendril, the upper part visibly fainter and wider than the root; a second faint strand at another angle — no parallel tapered strokes. `warmer`: wisps curl in the gap under the basket (`curl` 0.008). Drink k0 (2×): the two strands break into knots, split into lanes of unequal width that fan apart, and thin as they widen.
- Budget: `post-bench --configs="post=1&debug.timeSteam=1" --poses=warmer,macro-warmer`: `post:steam-decanter` 0.006 / 0.004 ms, draw calls 226 / 211 (unchanged); no new per-frame allocations (`PostPipeline` keeps two `Vector3` scratch + one `clone()` on the first frame).

### Lessons
- **A backtick inside a GLSL comment inside a TS template literal ends the string** — `tsc` reports "',' expected" in the shader file. Keep GLSL comments backtick-free.
- **`+` in a query string decodes to a space** — `?aa=msaa4+smaa` arrives as `"msaa4 smaa"`; the parser normalises whitespace back to `+`.
- **Phase-function normalisation matters more than g.** Normalising HG to its exact-forward peak made motes 3 % bright at 45° off-sun (the closest the slats ever let you look) — invisible. Normalise at the nearest viewable angle (25°) and let the far side fall off.
- **Sparse ray marches alias against slat stripes.** 24 steps over a 22 mm-pitch shadow pattern → moiré. Average the shadow over one pitch per step instead of adding steps.
- **Scene cost is the elephant.** The scene pass is 6–11 ms at 1080p before any post; MSAA and the whole post chain together add ≈ 2.6 ms. System 4/5 should look at the shadow-map pass and draw-call count before worrying about post. (Post-merge bench: post total 1.35–1.41 ms at `beam` / `length` / `window` — haze 1.00, composite 0.10, bloom 0.15–0.17, finish 0.13–0.14 — unchanged; the scene numbers that run (7.3 / 12.5–13.4 / 25 ms) were taken while other worktrees were shooting on the same GPU and are not a measurement.)
- **A scene can have more than one shadow-casting "sun".** `findSun()` looked for the first shadow-casting DirectionalLight; after the two-sun split that is the *lot* light, whose map never sees the room — every mote would have read "lit" (or "shadowed" by the cone). Take the light from `Diner` rather than searching the graph, and keep the search as a typed fallback only.
- **Steam is not particles.** A billboard with radial alpha is a ball at any size, and a ball with a noise hole is a ring; no amount of count/alpha tuning fixes the silhouette. Vapour is a *streakline*: thin ribbons whose features are functions of emission time and ride up with the flow, alpha 0 at the source and at the top, filaments past mid-height, lit by the same beam test as the dust. (Steam rev 2.)
- **A ribbon folds where its centreline turns sharper than its width — and a fold is a bright crease.** Overlapping triangles double the premultiplied alpha into thin slivers that read as "edge-on cards". Blend the tangent with the strand chord, pin the side vector's handedness to camera-right, keep meander wavelengths above the ribbon width, and never let the rise stall (a flat top seen from above snakes). Render raw quads / wireframe / one instance at a time before guessing at noise.
- **Per-vertex lighting on a coarse ribbon aliases against slat stripes.** 12 mm stripes vs 9 mm rows → one row lit, the next not → bright bars across the strand. The shadow compare is cheap on the few thousand fragments a wisp covers: do it per fragment (with the slat-pitch average the haze already uses).

## System 9 — extended interactions and implied presence (`sys9-interactions`)

Five features, all in new files hooked into the existing ones by a few lines each:
`scene/Sys9.ts` (one call in `Diner.build` after `buildProps`), `interactions/Openables.ts`
+ `Drink.ts` (registered in `interactions/index.ts`), `audio/ambience/Kitchen.ts` + `sfx/Player.ts`
+ `sfx/Openables.ts` (positions + entries in `audio/index.ts`), `player/FirstPerson.ts` (feature 5).
Frames: `shots/sys9-sys9-{plate,cup,cabinet,cabinet-open,kitchen-door,kitchen-door-open,kitchen-door-back}.png`,
sheets `shots/sys9-seq-{drink,cabinet,cabinet-close,kitchen-door}.png` + key frames. The five
paragraphs below describe rev 1 as built; **"Rev 2"** and **"Rev 3"** after the verification
paragraph list what the two critic passes failed and how it stands now (cardigan, toast, yolk
smear, newspaper and apron are gone).

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

### Rev 2 (`sys9-rev2`) — the critic's frame review, item by item

The rule applied: a prop a viewer clocks as procedural is worse than no prop.

**Cut.** The *cardigan* (mesh, `knit` atlas strip, pose, frame — stools are backless and it read
as a tea-cosy), the *toast* (an annulus wedge), the *yolk smear* (a matte polygon) and the
*newspaper* (a rigid slab with a keyboard-like band). Nothing replaces them; booth 2 keeps a
finished setting — plate, fork, crumbs — and the atlas strips were reassigned (below).

**Plate** (`buildPlate`): a lathe with the diner profile — 2 cm rolled rim with a lip, shallow well,
foot ring — in the mugs' `ceramic` (roughness 0.15, clearcoat), so the rim carries the window's
specular arc (`sys9-plate` 995–1277 × 558–635); a stainless fork with thickness (lofted bowed
handle, neck, four tapering tines, in the hosted `stainless`, sun highlight at 1042 × 703, tines
1072–1123 × 703–737) resting on the rim at 7.5° pitch; 11 flake crumbs — irregular lofted flakes
at random yaw and 5–9 mm, not cubes — on the well and the table; a thin glossy near-transparent
dried-yolk *film* (alpha decal, `yolkFilm` tile: feathered blob, three fork-drag streaks) that only
reads as a sheen change.

**Cup** (`buildLipstickCup`): the lipstick is a `lipstick` alpha decal on the outer face of the rim
(17 × 7.5 mm two-lobed upper-lip print, cupid's bow, lip lines, pressure fading to the outline —
`sys9-cup` 909 × 471), UVs inset 4 % so the mip chain cannot pull the tile's neighbours in (the
square halo rev 2 first shot). The cup wall's crease was the lathe's seam: `lathe()` now welds the
seam normals. Inside: a `residue` ring (ragged tide line, alpha) 4 mm above a `dreg` disc (opaque
cold coffee, roughness 0.06–0.16, in the decal bucket rather than a `coffee` clone). Saucer with
centre well + foot ring (828–1100 × 555–639) and a `contactAO` disc under the cup (902–1026 × 606–621).

**Apron** (`buildApron`, rebuilt): a fabric loop over the hook (a ribbon tube, 740 × 20–120), the
waistband bunched under it — a flat 26 mm band pleated into 116 mm as six unequal sawtooth pleats
with 1.4 mm rolled edges — and the skirt gathered under the band: four heavy folds of unequal
width (crests 0.11 / 0.37 / 0.60 / 0.84 of the width, 32–48 mm relief) plus four incommensurate
gather frequencies running the full drop (decaying to 30 %, not to zero), half-width 116 → 160 mm
(hem barely wider than the bunch), hem dips of a few mm, a 5 × 3 mm rolled hem and 3 × 2 mm
selvedges. Patch pocket: face proud 4 mm with a gaping mouth and a sagging top hem, closed sides,
stitch line and doubled top hem in the atlas (656–844 × 534–750), contact shadow under its mouth on
the skirt. Two 25 mm ties: one hanging past the hem with a lazy twist (834 × 940), one tucked back
under the band's left end. Blots: a continuous darker tide line round a lighter mottled interior
(703 × 440, 769 × 825). Weave: the coarse 2/1 basket dot grid is gone — a 2 px twill in the height
field only (sub-texel at frame scale, mips average it to matte), fibre grain, anisotropy 8. Judged
at 1:1: it hangs, it does not flare; kept.

**Kitchen door** (`buildKitchenDoor`, rebuilt). Behind it, a lit kitchen slice 2.7 m deep to a far
wall, seen through the opening and the vision glass: 4" white ceramic wall tile to 1.5 m with
cushion edges and grey grout (`wallTile` atlas tile, `sys9-kitchen-door-open` 1069–1294 × 319–806),
white paint above, 6" red quarry floor (`quarry` tile, 1069–1275 × 937–1080), a stainless prep
table with undershelf, sheet pans, a board and a Cambro (1162–1294 × 544–619), a stainless wall
shelf with #10 cans and mixing bowls, a range under a stainless hood on the far wall
(1200–1312 × 0–94), a chrome wire unit on the +x wall, and a 4 ft strip fixture at 1.95 m
(`fixtureLens` band, 1078–1219 × 103–169) — all statics hosted in existing buckets. Light: one
shadowless 5000 K SpotLight, 16,000 lm, aimed 43° down into the slice; its 46° cone misses every
dining-room point, so no pool on the dining floor. Door face: 9 × 14 in vision panel in a black
rubber moulding with a blended dielectric pane (`makePaneGlass`, single pass — the transmissive
`glass` doubled the opaque list; 881–984 × 216–459, tile grid visible through it), stainless kick
plate 16 in (788–1050 × 881–1050) and a 4 × 16 in push plate (1022–1059 × 375–600), both as
vertex-alpha metal on the one leaf mesh (`metalByVertexAlpha`: `vColor.a < 0.5` renders polished
metal), soft diagonal cart scuffs at hip height (900–1050 × 600–881). Swing physics unchanged
(harness: 90.0° → −23.0°, 4 frame passes, rest by 3.2 s).

**Cabinet.** Open curve: 0.15 s quadratic ease-in from rest (θ(0.275 s)/θ(0.35 s) = 0.250,
first 1/120 s step 0.3°, rev 1 stepped 0 → 29°), then the quick swing, damper and 1.2° overshoot
kept. Two Ø 35 mm Euro hinge cups on each leaf's inner face with arms on the carcass
(`sys9-cabinet-open` 491 × 203, 572 × 694, 1631 × 356, 1500 × 947). Spray bottle with a neck and a
trigger head (1388 × 244); filter box with a printed `label` band (844–1022 × 281–375); five
saucers with the diner rim profile (806–938 × 544–647). Both leaves + pulls + cups are ONE mesh:
the leaf geometry is baked on the CPU through its hinge matrix from `updateMatrixWorld`, pulls and
cups are chrome by vertex alpha — 4 rev-1 meshes → 1.

**Drink** (`Drink.ts`): 2.8 s. Reach 0–0.25 (nothing moves), lift 0.25–0.95 on a quintic
smootherstep (zero velocity and acceleration at both ends), sip 0.95–1.55 with the level falling
1.10–1.45 (`sys9-seq-drink` FILL 100 → 97 → 77 → 67), lower 1.55–1.85, set-down 1.85–2.55
decelerating to contact, release to 2.8. The head is a Catmull-Rom spline through nine keys
(`HEAD_KEYS`): pitch back 5.2° at the sip, yaw drift 1.2°, roll 1.5°, so the camera itself moves
every frame (harness: no two 50 ms samples identical between 0.26 and 2.8 s); `FirstPerson.lean`
gained `yaw`. Fill drop ⅓ per sip and Pour re-arm under 15 % kept; steam untouched.

**Verification.** `tsc --noEmit`, `npm run build` clean; `tools/gpu.mjs` assertion passes (ANGLE
D3D11 on the 4060). Live harness 27/27: cabinet anticipation / ease-in / velocity ramp / overshoot
/ 95° rest / settle-once / other leaf untouched / closed by 0.8 s; kitchen door 90 → −23 → 4
passes → rest, `blocked()` false; drink 2.79 s, tilt 5.2°, yaw 1.2°, camera never static, fill
1 → 0.667, three sips → 0 → "Pour coffee" → refill → "Drink", seek deterministic; walk 1.4 /
sprint 2.6 / release / stop / hop 0.320 m / hop refused mid-drink. **Draw calls vs `origin/main`
`5150cea` (which already holds rev 1; same GPU, same session, other agents shooting):** boot
179 → 183 (+4), `door` 196 → 202 (+6), `aisle` 271 → 272 (+1), `warmer` 224 → 222 (−2), `counter`
274 → 270 (−4), `length` 321 → 317 (−4), `sys9-apron` 192 → 190, `sys9-plate` 241 → 244,
`sys9-cup` 203 → 203, `sys9-cabinet` 228 → 223, `sys9-cabinet-open` 229 → 221 (−8),
`sys9-kitchen-door` 160 → 165, `sys9-kitchen-door-open` 172 → 175, `drink-sip` 216 → 216. Own
meshes 6 → 5 (presence, presence decals, cabinet doors, kitchen leaf, vision pane) — the whole
kitchen slice is hosted. Triangles 1.242 → 1.298 M at the spawn. Boot 11.4 s (main) vs
10.8–11.2 s over four runs (noise).

### Rev 3 (`sys9-rev2` → `main`) — second frame review: apron cut, fork, plates, drink

Verdicts carried from rev 2: cup, plate, crumbs KEEP; cabinet, kitchen-door physics + slice, drink
timing PASS. Rev 3 answers the rest.

**Apron — cut.** Two lofted attempts failed the 1:1 bar (a stiff flat band with a regular scallop,
square floating shoulders, 6 × 3 px stitch dashes, a flat strap). Mesh, `cotton` + `pocket` atlas
strips, the `sys9-apron` pose and frame are gone; the chrome hook stays (`buildHook`, it passed).
Implied presence is now the plate setting and the lipstick cup. The freed atlas quarter holds the
cart-scuff transfer and the #10 can label.

**Fork** (`sys9-plate` 1013–1300 × 650–745): rebuilt on one spine — four tines 2 mm apart with a
tip curl (tips 1013–1023 × 653–670), tine root → shoulder (1073–1103 × 673–690, the highlight)
→ waisted neck → a handle with a superellipse section, bowed and widening to the rim; soft contact
shadows (`aoEllipse`: vertex-alpha gradient on the decal bucket) under the head (1047–1080 ×
690–710) and the handle root. The head was moved out of the sun spot into the well's shade.

**Cup** (`sys9-cup` 928–962 × 462–478): the print's mid-line sits 0.8 mm past the rim's outer top
corner, so the contact line is 2.8 mm down the outer face, the lobes lie over the 5 mm rolled rim
top and a faint broken trace (tile v 0.69–0.77, alpha ≤ 0.26) laps 0–1.5 mm down the inside; it
faces the pose camera (centre azimuth 77°); colour pulled ~15 % toward luminance (0.73/0.19/0.24).

**Kitchen door.** Plates: `leafMat` is a `MeshPhysicalMaterial` with `anisotropy` 0.75; the
vertex-alpha branch renders metalness 1, roughness 0.35, the anisotropy vector zeroed on the
paint, the interior probe as envMap; plates 1.5 mm proud with a 0.7 mm round-over and pan-head
screws (slotted, on a template: four per push plate, six on the kick plate). Read: closed push
plate 1313–1440 × 140–593 mean 86 with a vertical reflection gradient (max 117), open push plate
1028–1055 × 385–590 mean 95 / max 146 against paint 111 — satin steel mirroring a dim room, not
charcoal. *Scuffs* are a `MultiplyBlending` albedo decal (`scuff` tile: layered soft strokes, palm
smears, streak smudges, no repeat) 0.3 mm proud of both faces — darker than the paint from every
angle (closed 773–1307 × 713–940: p2 77 vs median 99; open 860–1050 × 560–880: 93 vs 117). *Vision
panel*: `makePaneGlass` α₀ 0.08, env 1.6 — the pane reflects at the oblique `kitchen-door` view.
*Slice props*: #10 can with tinplate body, chime rings, recessed lid and a printed `canLabel`
(1225–1300 × 235–300); mixing bowls in `kitchenSteel` (metalness 0.55, roughness 0.3, probe env)
with a 4 mm rolled bead (1125–1220 × 230–300); the Cambro is a stack of six sheet pans on the prep
table (1130–1285 × 555–620); the black cube is a ribbed 20-gal trash can on the partition's kitchen
face right of the casing; the hood has a downturned lip and a baffle filter grille — hood and can
sit outside the three door frames. One new material (`kitchenSteel`) + the scuff decal.

**Drink.** Per-sip volume 25 % (four sips), drained linearly across the whole 0.95–1.55 s sip
(harness: 1 → 0.875 → 0.75 at 0.95 / 1.25 / 1.55, worst 0.2 s share 42 %). The pour mug's contact
disc is its own mesh (`buildContactDisc`) and `Drink.setDisc` fades it with lift — opacity
1 − lift / 3 cm, so it is gone before the mug clears the bar (`sys9-seq-drink` k1 925–1030 ×
875–945 and k4 900–980 × 990–1050 are plain counter now); back to 1 at rest and on reset.

**Hygiene.** `shoot.mjs` / `sequence.mjs` hide the prompt on `sys9-*` poses and the drink / cabinet
/ kitchen-door sheets. The pale tapering sliver at 935–945 × 0–60 in the drink k0/k4 frames is the
pour mug's steam column (`pour:steam` quad, world −1.37, 1.46–1.48, −2.3) seen against the wall —
System 7/8's, not touched.

**Verification.** `tsc --noEmit`, `npm run build` clean; GPU assertion passes (ANGLE D3D11, RTX 4060).
Harness 27/27 (cabinet ease-in / overshoot / rest / one mesh / close; kitchen door 90 → −23 → +5.9
→ rest by 3 s; drink tilt 5.2°, yaw 1.7°, camera never static, 25 % per sip spread over the sip,
disc 0 aloft / 1 at rest, four sips → Pour re-armed → seek deterministic; sprint / stop / hop).
**Draw calls vs `origin/main` `5150cea`:** boot 179 → 183 (+4), `door` 196 → 202 (+6), `aisle`
271 → 272 (+1), `warmer` 224 → 226 (+2), `counter` 274 → 275 (+1), `length` 321 → 322 (+1),
`sys9-plate` 241 → 244, `sys9-cup` 203 → 206, `sys9-cabinet` 228 → 227, `sys9-cabinet-open`
229 → 225, `sys9-kitchen-door` 160 → 166, `sys9-kitchen-door-open` 172 → 176 (rev 2 → rev 3:
+1…+5 by pose = scuff decal + `kitchenSteel` + the mug's disc mesh, doubled by the transmission
pass). Triangles 1.266 M at the spawn (rev 2 1.298 M — the apron). Boot 11.0–11.9 s over five runs
(main 11.4 s in the rev 2 session; shared GPU).

### Rev 4 (`sys9-rev4` → `main`) — the plates
The rev 3 confirmation passed seven of eight items (fork, lip print, scuffs, drain + disc, apron
gone, prompts gone) and kept one blocker: the kitchen-door push and kick plates still read as
flat dark paint (closed push plate luma mean 88 / max 116 against paint 101–109, kick plates
mean ≈ 75, no gradient, no streaks, no bright round-over). Cause: metalness 1 + three's
`anisotropy` against the metals' room probe, captured 3 m away and looked up by direction alone —
a 0.4 m plate returned one colour, and `anisotropy` bends the lookup by a single normal, so no
streaks. The System 5 rev 4 kick-plate recipe (`kickPlateWorn` on `sys5-rev4`) is reused:

**Plates** (`brushedPlatesByVertexAlpha`, Openables.ts). The leaf material takes a probe captured
AT THE DOOR — (`KITCHEN_DOOR.centerX`, 1.0, `zBack` + 0.35), the dining side of the closed leaf,
sun on, once at boot after the three room probes (Diner.ts "station probes": any `envMetals`
material with `userData.probePos`; 6 face renders each). Every environment tap is parallax-
corrected against the room box (extended through the kitchen slice, so the plates on the swung
leaf still land somewhere sane), and the satin finish is a 9-tap Gaussian fan of taps along the
brush (±1.6 × roughness at 2σ) with the lookup roughness lowered across it (0.8 × roughness):
the stretched mirror — floor at the bottom, back-bar / booths / front wall up the plate, a bright
hairline where the 0.7 mm round-over turns. The brush direction rides in the vertex alpha (`tint`:
0 = along the leaf's y, the push plates and screws; 0.25 = along x, the kick plates) and is
transformed by `modelMatrix`, so it swings with the leaf. Roughness 0.30 ± 0.06 in brushing runs
(two hashed run widths, 0.8 / 2.5 mm, across the brush) so the streaks break up run by run;
F0 238/240/243 (0xeef0f3, satin aluminium / 430); the probe's near-field weight 1.4. The paint
keeps the metals' room probe through a second sampler uniform (`uKpEnv` carries the station
probe): with the whole leaf on the door probe the paint dropped 95 → 82. Zero extra draw calls.
**Measured, `sys9-sys9-kitchen-door.png` closed:** push plate 1313–1440 × 140–593 luma mean 82 /
max 109 (rev 3: 88 / 116), upper half 90 (p10 83, p90 96) against the door paint 95 (p10 89, p90
105) at 1000–1250 × 200–450; mean RGB 101/88/80 vs the paint's 104/95/86 — the plate is a
half-stop under the paint in the upper half and reads as brushed metal (vertical runs, a
light-to-dark gradient down the plate, the top corner lifting to 109). The critic's ≥ 105 target
is NOT met: from this camera the plate's mirror direction runs down into the service aisle — the
walnut back bar, the booths, the checker — and that is what a mirror on the back wall shows; only
a fudge (gain ≥ 1.8) would put the upper half over the paint. Kick plate closed 675–1050 × 950–1080
mean 74 / max 101 (rev 3 ≈ 75): it mirrors the dim aisle floor, now with horizontal runs and a
gradient. **Open** (`kitchen-door-open`): push plate 1028–1055 × 385–590 mean 116 / max 120,
kick plate 800–1050 × 900–1080 mean 109 / max 121 against paint 98 — both over the paint, the
kick plate a smeared mirror of the quarry floor and the lit tile.

**Polish** (time-boxed). Scuffs (`presence.ts` `rub`): a rub is now a hard streaky core (three to
five fine parallel rubber lines, dense where the bumper bit) feathering into a broad faint tail,
with a per-mark blur and density and a slight bow; rubs are spread along the leaf (no two within
60 mm), so the comma + two lozenges "face" at closed 773–870 × 830–940 is gone. Lip print:
feather 0.4 → 1.2 mm (the 2× stair-steps), lip-line creases cut 85 % through so the print is a
bundle of short vertical streaks, colour toward brick (0.64/0.26/0.28) at ≤ 0.7 opacity. Kitchen
steel (bowls, table, pans): metalness 0.85 / roughness 0.36 on its own probe captured inside the
slice — the bowls show a graded reflection with a bright rim instead of matte melamine. Sheet
pans: each pan flares 3 mm wider than the one below and carries a 3 mm rolled bead, so the stack
steps up in thin lips. Fork: the handle end is a superellipse ribbon (power 3.2), not a sphere cap
— the 25 px bloom was the sun's specular on it; the fork is swung 17° toward the camera
(`yaw = π − 1.15`) so the handle end lies outside the sun patch (no ≥ 250 pixel at the handle
end; the patch's lower edge at y 720–760 runs x 1310–1483). **Skipped / reported:** the k1
lifted-mug crescent (1010–1070 × 865–880) is the ceramic's grazing Fresnel reflection of the prop
probe's lower hemisphere — the plain grey floor swapped in for the glassware (Diner.ts) — not an
emissive or unlit face; fixing it means a per-prop probe or a darker floor swap in the probe
pass, System 2/4's, not touched.

**Verification.** `tsc --noEmit`, `npm run build` clean; GPU assertion on every capture; live
harness 25/25 (the rev 3 file was a `/tmp` throwaway, rebuilt from the transcript: cabinet
ease-in / overshoot / rest / one mesh / close, kitchen swing 90 → −23 → +6 → rest, drink tilt
5.2° / yaw 1.7° / never static / 1 → 0.75 / four sips → re-arm / seek deterministic, sprint /
stop / hop 0.320 m). **Draw calls vs `origin/main` `debb987`: identical at every pose** (boot 183,
`door` 202, `aisle` 272, `warmer` 226, `counter` 275, `length` 322, `sys9-plate` 244, `sys9-cup`
206, `sys9-cabinet` 227, `sys9-cabinet-open` 225, `sys9-kitchen-door` 166, `sys9-kitchen-door-open`
176) — the probes are boot-time captures, the plates stay in the leaf's bucket. Triangles 1.266 M.
Boot 11.1 s ready (rev 3 11.0–11.9 s).

### Lessons
- **A satin plate is a stretched mirror; give it a probe from where it stands and project the
  taps.** A directional lookup into a probe captured metres away returns one colour across a
  plate (no gradient, no floor/wall split), and `MeshPhysicalMaterial.anisotropy` bends the lookup
  by one normal (no streaks): the result measures as paint. Capture at the plate, box-project
  each tap, fan the taps along the brush, and vary the roughness per brushing run. And keep the
  paint on the room probe — a station probe under a dielectric changes its ambient.
- **A mirror shows the room, not the reference photo.** The closed push plate mirrors the walnut
  back bar and the booths, so it sits a half-stop under the paint in the upper half whatever the
  material does; the critic's "≥ paint" comes from plates facing lit walls. Say so with numbers
  rather than raising the gain.
- **Lofted cloth does not pass at 1:1 without a real cloth solve; cut it.** Two apron rebuilds
  (catenary pleats, then unequal folds + incommensurate gathers + rolled hems) still read as a
  stiff panel with a regular scallop under a 6× crop. Folds that are not driven by tension,
  gravity and contact keep a period the eye finds instantly. Either simulate or leave it out.
- **Raycast the pixel before theorising about a decal.** The lip print "on the far inside wall"
  was on the near outer rim all along — the rim ellipse is 25 px tall at the pose and the far
  inner wall shows above the near rim line. `Raycaster.setFromCamera` at the frame's pixel, with
  the post quads and `distance < 0.05` filtered out, settles it in one run.
- **Multiply for rubber, not gloss.** A roughness-only scuff flips sign with the view (darker
  where it kills a reflection, brighter where it scatters one). Rubber transfer is pigment:
  a `MultiplyBlending` albedo decal (`premultipliedAlpha: true`, no depth write) is dark from
  every angle and costs one draw.
- **A contact disc must know its caster is airborne.** Static contact AO under a prop that
  moves rides the counter while the prop lifts; give the moving prop its own disc mesh and fade
  it with height (gone by 3 cm).
- **Mind the canvas row when a tile sits at the right edge.** `px(x, y)` indexes `(y·S + x)`; a
  loop drawn CE wide into a 64 px tile at x = 960 wrote 32 px past the edge, which wrapped to
  x 0–31 of the *next* rows — a coffee-brown bar on the cotton tile's left edge that surfaced
  as a 10 mm dark strip up the apron's selvedge and cost an hour of lighting theories. Dump the
  atlas (`material.map.image` → PNG) before reasoning about shading.
- **A merged bucket is culled by one sphere.** Hosting the kitchen's ceramic bowls in the `ceramic`
  bucket stretched its bounding sphere from the kitchen shelf to booth 2, so a bucket the spawn
  never saw was drawn every frame (+2 with the transmission pass). Host far-apart props in
  buckets that are already in view everywhere, or keep them out.
- **Vertex alpha is a free material slot.** A vertex-coloured mesh can carry paint *and* polished
  metal (`onBeforeCompile`: `vColor.a < 0.5` → metalness 1, fixed roughness) — kick plate, push
  plate, pulls and hinge cups cost no draw call.
- **Bake a hinge on the CPU when the leaves must share a mesh.** Override the hinge Group's
  `updateMatrixWorld`, transform that leaf's vertex range by `matrixWorld`, upload; the shadow
  and main passes see the same frame and two doors are one draw.
- **Blend, don't transmit, for small glass.** A 9 × 14 in transmissive pane made the renderer draw
  every opaque twice; `makePaneGlass` (Fresnel-weighted custom blend, opaque list) shows the lit
  kitchen for one draw.
- **Inset decal UVs.** A decal whose UV rect touches the tile boundary picks up the neighbour in
  the lower mips — a faint square around the lipstick. 2–4 % in fixes it.
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

## Fix — "melting" blinds through the storefront glass from the lot (`fix-glass`, `shots/fix-glass-*.png`)

Reported from outside the diner, ~9 m back on the lot, looking at the window row: the slats
behind the panes read as smeared, wavy, horizontally streaked bands
(`shots/fix-glass-before-exterior.png`, crop `shots/crops/crop-fix-glass-before-exterior.png`).

**Root cause.** Not the glass material. Lighting.ts runs three's transmission pass at half
resolution (`renderer.transmissionResolutionScale = 0.5`, a 960 × 540 buffer) because from
inside the panes only ever have the lot behind them. From the lot the blinds are *behind* the
glass and so render into that buffer: a 1" slat pitch is ≈ 2.5 px at 1080p and 1.25 px in the
buffer — under Nyquist even with its 4× MSAA — and the beat between the slat pitch and the
buffer rows changes with perspective across each pane, so the aliasing forms the curved bands,
which the bicubic upsample then smears. A/B at the exterior pose with the live material:
`roughness 0` + no roughness map, `FrontSide`, `thickness 0` each changed nothing;
`?txscale=1` alone gave straight slats.

**Fix** (`src/scene/GlassResolution.ts`, hooked from the window glass in Shell.ts and the door
glass in Door.ts — no lighting or material change): the panes' `onBeforeRender` sets the
transmission scale to 1 while the camera's world z is on the lot side of the pane plane and
restores Lighting's value (or the `?txscale` override) the moment it is back inside. Only poses
with a pane in the frustum run it; the renderer reads the scale at the start of `render()`, so a
crossing lands one frame late. Inside is untouched: the interior before/after
(`shots/fix-glass-{before,after}-interior.png`, the `window` pose) differ by 21.1 % of pixels
> 6/765, mean 4.06 — the same as two consecutive frames of the same build (21.4 %, mean 4.18:
grain and motes). Known residue: Lighting's LOD compensation is baked for k = 2, so at scale 1
the door handprints frost ~0.8 mip less from outside than inside — invisible at 6 m. If the
full-size buffer is wanted everywhere instead, that is Lighting's `txScale` (3.4 vs 0.5 ms).

## Fix — the lot light standards read as toys (`fix-pole`, `src/scene/LotLight.ts`, `shots/fix-pole-*.png`)

Reported looking up at a pole from the drive aisle (`shots/fix-pole-before-lookup.png`): a
straight cylinder arm butted into the mast with a step at the elbow, a plain box head with a
flat "grid" underside. Exterior.ts now only makes the materials and calls `buildLotLight()`
per pole (the pier / grout materials are passed in); the builder is `LotLight.ts`:

- **Pier** — the System 3 recipe unchanged (Ø 0.6 poured pier, 15 mm chamfer, grout collar),
  under a 420 mm base plate with four anchor bolts on washers + hex nuts; the mast stands on a
  flared shoe. **Mast** — tapered round steel, Ø 200 → 100 over 8.2 m, flat cap with a lip;
  handhole cover (90 × 220, two screws) 0.45 m up, facing the aisle. Paint is a 256 × 1024
  canvas: grey-white (albedo ≈ 0.58 — a 0.8 pole clipped in the desert sun), per-column
  vertical streaks + drip runs, chalkier toward the top, a rust bloom climbing 0.4–0.9 m from
  the foot with a ragged per-streak edge; `roughness 0.38 / metalness 0.3` on the lot probe.
- **Arm** — one tapered tube (Ø 92 → 60 mm) along a centripetal Catmull-Rom from the mast
  axis to a level tenon 2.15 m out and 0.4 m up (`taperedTube`: TubeGeometry's layout and
  winding, radius as a function of t). It leaves the mast through a collar ring + a short
  boss along the exit tangent — the join is an intersection curve, no step.
- **Head** — shoebox 0.6 × 0.4 × 0.18 in dark bronze: rounded upper body over a four-bar
  door frame, so the underside is a real 0.5 × 0.31 recess; inside it an aluminium LED module
  with 5 × 3 hemispherical optics, a flat 22 %-opacity glass flush in the frame (`noCast`),
  a twist-lock photocell on top, a slip-fitter sleeve over the tenon with three hex set
  screws. The optics are emissive `(1, 0.9, 0.76) × 0.36` ≈ 3,400 nits (K = 1e-4) — lit at
  dusk, well under a sunlit white.

Cost: +4 draw calls at the look-up pose (50 → 54: eight buckets for the standards where there
were four), ≈ 5.8 k triangles per pole. Frames: `fix-pole-{before,after}-lookup.png` (the
user's pose, 3 m out on the aisle), `fix-pole-{before,after}-lot.png` (15 m), and
`fix-pole-after-base.png` (crouched at the pier: plate, bolts, shoe, rust, handhole). Poses
`fix-pole-lookup`, `fix-pole-lot`, `fix-pole-base` are in `shoot.mjs`.

## System status

| # | System | Status |
|---|---|---|
| 1 | Interior geometry and floor plan | **done** (rev 4 close-out: empty L-return, footrail at 200 mm on cast brackets, bell pedestals, head bulkhead + 25 mm wall angle, 60 × 40 caps, 100 mm saddle + stepped exterior slab) |
| 2 | Booth and counter detail | **PASSED at rev 7 (`9adefff`)**; System 3 rev 1 polish: 3 condiment sets on 9 stools (centred between stool pairs), boomerangs in two classes (32–38 mm + 15–20 mm) with a few outline-only shapes, channels pillowed 4 mm outward with the 1–2 mm valley at the welt, stool seats with a 17 mm crown + 10 mm roll over the band, near-white granular sugar. Rev 7 was: flicker audit + fixes (see Lessons); stools built per stool into the merged buckets (no instancing): ±6 mm column height, any yaw with the welt junction + boxing seam travelling with it, ±5 % squash, 250 × 200 mm sit-hollow 6–9 mm deep in its own shade, one 2.5° worn swivel, three chrome wear grades (roughness 0.07/0.12/0.17), four bolt caps per base; glass `transmission 1`/roughness 0/thin, granular sugar top tilted 7° at 75 %, grey-blue granular salt standing in front of the pepper; black SplashGard funnel (Ø 178 × 100, paddle handle) in the rails, stainless fill lid so one black warmer disc tops the hood, 7 mugs staggered ±15 mm on the mat; napkin tip with folded leaf + crease, domed cast pedestal with collar, pass-through surround in wall-trim paint. Rev 6 was: A1 veneer at true scale (lines 1.5–2.5 mm, one decaying cathedral per 0.5 m, ≤ 9 % contrast, per-panel UV jitter + flips; oak caps / walnut panels + die / maple cabinets + fan blades kept); A2 cords proud of the channels (centre +1 mm over the crowns, 6 mm, baked line shadows, 6 puckers in the last 30 mm at both tucks), 6 mm piped head-roll seam, seat welt + boxing seam + dark top-stitch line at the nose, 6 mm welt torus round every stool seat over a 1" band; vinyl roughness ≈ 0.32–0.5, grain normal 1.25, clearcoat 0.1. B1 boomerangs as straight-armed 100–130° elbows with rounded tapered tips, 28–52 mm, ~3.5 / 100 cm², three tones, on a 2048 px / 1.2 m tile (no repeat on a table). B2 one fluted jar (14 cos² ribs, 2.5 mm) in `glassFluted` (10 mm refraction thickness) with the sugar at 97 % of the bore to 65 %, full-diameter 12 mm lid with 1" side-hinged flap; S&P 1.5 mm glass walls, fills at 97 % of the bore to 60 %, opaque `salt`. B3 hood in light `stainlessCool` (albedo 0.6, roughness 0.3, anisotropic, room probe) with black control band + black 150 mm warmer discs top and base, stainless base plate over a black base, 25 × 14 mm lit rocker switches with pivot line. B4 mug 7–8 mm walls / 13 mm floor / 6.5 mm rim, dark `bisque` foot ring, stubby handle; 8 spares inverted on a ribbed rubber bar mat, 2 upright, saucers only at the two stools. B5 stools: seat parts pivot on the column top with ±1.2° tilt, ±10 mm height, ±5 % cushion squash, ±10 mm pitch with two nudged 22–30 mm. C: 2" fluted T-mould with 4 grooves on the counter, 28 mm push bar on cast rose/post/saddle standoffs, 4.5" × ½" five-rib saddle threshold, 5 mm dark-steel spider plate with 4 screws on a dark-sealed underside, ½" troffer recess in a 1" frame, shaped cast fan irons with bosses, 1.8 mm rolled dispenser lid edge. Rev 5 was: mugs are `MeshPhysicalMaterial` ivory china (opaque, roughness 0.15, clearcoat 0.6, env 0.45; runtime probe confirmed transmission/transparent were never set — the rev 4 "frosted" read was a shaded white body mirroring the counter); Skylark laminate as sparse (~30 %) round-capped stroked chevrons, three tones pulled toward cream, non-touching; Tablecraft-221 dispenser in smooth `stainlessBrushed` (roughness 0.2, anisotropy 0.4 — at 1.0 the sun lobe whited the face) with 70 × 22 slots on both long faces, napkin fans, flange lid, rubber feet; BUNN tower in matte `blackPowder` with brushed stainless side panels and a Ø 190 × 110 stainless funnel with forward handle; channel depth 20 mm with 6 mm cords riding 2 mm under the crowns, vinyl #A8141C roughness ≈ 0.3–0.4, 0.4 mm grain, clearcoat 0.15; veneer ridge pitch 1–4 mm with ~300 mm cathedral figure at ≤ 12 % contrast (caps satin 0.3, laminates 0.5); shaker fill fitted to the glass, half-moon side-hinged sugar flap, 13 mm troffer reveal. Rev 4 was: prop-side reflection probe (no checker in glassware), opaque #2A1408 coffee at 55 % with fill line/meniscus/tide line, 12 mm D-handle facing the aisle, 100 mm-deep funnel; opaque ivory mugs (roughness 0.14, env 0.2) inverted on 140 mm saucers on the drip tray + 3 loose uprights + `pourMug`; Skylark boomerangs as bent chevrons (62/72 mm, 12–15 mm, tan/grey-blue/white, ~40 %); three grain sources via `woodVeneer` (oak caps, walnut panels/die, maple cabinets); seat boxing seam 25 mm below the crown, brighter valley cords, ±3–4 mm puckers; stools ±8 mm height/±10 mm pitch/±25 mm off-line, concave rim band mirrors the checker; Tablecraft-221 dispenser with 52 × 42 arch, napkin tip, lid seam; bright 4" saddle; kitchen box with its own emissive ambient. Rev 3 was: — 5 mm welt cords proud in every channel valley + 7 mm roll-seam and boxing-seam welts, puckers at both tucks, broad sheen (roughness map 0.35–0.55, clearcoat 0.25); 512 px interior-capture PMREM; irregular vertical veneer grain on end panels/counter die/cabinets (contrast 0.10), horizontal cap grain; T-mould with 3 real 2 mm grooves + returned lip, 38 mm tops with sparse two-tone boomerang; counter sheet seams every 3.6 m; steep-rimmed bell stool bases that mirror the floor, per-stool rim seam, ±12 mm height/±25 mm offset; footrail elbow + return flange; 300 mm brushed spider plate; BUNN VPR brewer with one lower + one upper warmer, deep SplashGard funnel, brushed body; 173 × 178 decanter with opaque 55 % coffee, fill line, tide line, black collar/handle, stainless base ring; closed 98 × 117 × 184 dispenser with recessed faceplates and one napkin tip; 12-flute sugar pourer at 65 %; glass shakers with visible fill; glossy waisted mugs (roughness 0.1); 6 mm prism troffer lens; 14 mm fan blades; alu threshold plate |
| 3 | Windows, blinds, exterior view | **built, rev 7 — PASSED the critic's geometry gate at rev 6 (all four blockers verified from every pickup angle, no blocker-level regressions); rev 7 is post-pass polish, merged to `main` as a fast-forward of `sys3-rev4` over 5894333 (System 5 rev 2 + System 9); frames `shots/sys3-{window,door-glass,blind-macro,lot-wide,stripes,dbg-sedan-front34,dbg-sedan-rear34,dbg-pickup-side,dbg-pickup-front34,dbg-pickup-rear34,dbg-wheel,dbg-wheelstop,dbg-wall-road}.png`)**. Rev 7 polish: **1** drip rail (regression) — rev 6 ran one straight box over the side-glass span ± 8–10 cm, so 30 cm of rail hung in mid-air ahead of the A-pillar top as a 4-px hairline against the sky (`pickup-side` 567–676 × 402–405, `sedan-front34` 1345–1430 × 447–455); now built station by station along the roof edge from the windshield header to the backlight header — `pickup-side` column 600 is sky (242–252) from y 385 to 419, `blind-macro` 190–450 × 385–400 shows only the A-pillar and windshield moulding between the slats; **2** pickup headlamps: one 7" sealed beam per side in a 196 mm square chrome bezel at the outer end of the bay, egg-crate over an amber parking lamp inboard (1973–80 C10 Custom Deluxe) — rev 6's two 5¾" lamps 160 mm apart overlapped into two vertical ovals; **3** glass gaskets: every pane in a 24 mm black rubber gasket straddling its edge, 4 mm proud, with a 7 mm bright moulding outside it (12 mm belt moulding on the door glass, the drip rail as the top moulding), built as four strips along a trapezoid in the pane's plane (`gasket()`); **4** wheel stops as the real trapezoid — 7.6" base, 4.9" tall, faces sloping to a 4.6" top with 10 mm rounds, 15 mm chamfered ends (extrusion bevel, shape drawn 15 mm inside), scuff decals lying on the sloped face; **5** fuel doors as a 6 mm lit-dark reveal ring around a panel 1.5 mm proud, the reveal's top band unlit (shadow under the upper lip) — reads as a recess in `sedan-rear34` 1090–1150 × 640–740; **6** sedan wheel well: liner clipped at the rocker line and lit as dusty undercoat (0x2a2724), the see-through closed by an underbody mass 45 cm inboard (rev 6's wall ran to 6 cm and hung 10–15 px below the sill as a black curtain in `dbg-wheel` 1370–1470 × 480–845); **7** mirror arms as 13 mm chrome tubes from an L-bracket (foot + upright) with a knuckle at the shell, pickup tail lamps wrap the bedside corner (40 mm side lens in its own bezel, ribs continued), tailgate band recessed (unlit shadow line under the upper lip, lit lower lip 2 mm proud, end gaps). Not done: bed-front chamfer rounding, wheel-cover slots as stamped depth (still flat dark slots), axle-position/bed-length change (not a one-parameter fix). Verification: tsc, build, GPU assertion on every capture, no page problems; boot 10.2 s ready in the harness (main 9.6 s in the same session, both under contention); draw calls boot 179 vs main 180, `length` 321 vs 316 (+5), `door-glass` 149 vs 146 (+3), `lot-wide` 257 vs 254 (+3); interior frames `door`, `aisle`, `counter`, `length` unchanged (System 5 rev 2 textures, System 9 props present). Rev 6 (critic on rev 5: FAIL — sedan accepted, pickup regressed): **1** pickup rear wheel arch restored — the bed pocket is a `span: "bed"` groove from 3.0 to 4.95 m and rev 5's station filter dropped EVERY loft station inside a groove's z span, the rear arch's 21 stations included, so the bedside was one straight quad from the bulkhead to the gate with the tyre poking out beneath; stations inside a bed groove are now kept and carry the bed inset (`Entry.mid`, not a crease) — `dbg-pickup-side` 1150–1520 × 780–960 shows a semicircular opening with the 2 cm rolled lip and the tyre inside it, same in `rear34` (900–1090, 700–840) and `front34` (0–225, 675–900); **2** cab architecture: door 1.42 → 2.60 with its window frame (glass ends at 2.54, 6 cm ahead of the shut line, so the visible B-pillar IS the door's rear frame and the cut runs rocker → drip rail in one plane), a solid 30 cm cab rear quarter, then a 5 cm cab-to-bed gap routed to its own `cavity` sink in LIT near-black (`mats.dark`) behind a 2.5 cm bulkhead (rev 5: 6.5 cm, whose top showed through the gap as a lit slanted band) — per-row profiles at native (`tmp/seam.mjs`): rear door line `side` 180→160→0→88→173 (2 px core + chamfer highlight, mean step 147), front door line 179→181→160→6→87→173 (identical), the same line on the glasshouse 182→0→0→154 (2–3 px, continuous to the rail), `front34` 255→248→238→147→16→255 (target profile), cab gap 11–16 px at luma 26–33 with a 55–90 lit far wall (was 12–18 px luma 0); **3** sedan wheel cover: the wobble was three's `LatheGeometry` smoothing normals across every profile step (a stepped dish got normals that swing across each step, so the reflection swirled) — new `lathe()` with analytic normals (hard joins above 40°, averaged below); cover rebuilt outer → inner with a dark bead-gap annulus against the tyre, a rolled trim ring, a CONCAVE dish (a flat chrome dish is a horizontal mirror of the lot at wheel height = black; 14 mm concavity tilts its upper half to the sky), eight slots, raised hub ring, domed centre with a 14 mm amber badge (the dark emblem read as a pit), valve stem with chrome cap; `dbg-wheel` 660–1120 × 380–800 shows one continuous gradient across the dish, crisp ring edges, the dark gap at the bead; **4** pickup arch superellipse p 4 → 2.6 (w R+9 cm, h R+6 cm): rev 5's p = 4 dropped its legs vertically over the last 5 cm, the "flap with a void behind it" at `side` 255–295 × 705–765 — now a continuous curve into the sill; arch stations 21 → 33 (sedan rear-arch faceting). Polish: **5** tail lamps on both flush (3–4 mm proud: 2 mm chrome bezel, dark reveal, lens 1 mm inside the bezel face, 1.5 mm rib lines every 14 mm); **6** tyres: analytic-normal lathe, `tyreTread` map (72 blocks around in three ribs, sipes, wide shoulder blocks; UV v = across the section), bottom 35 mm squashed into a contact patch with 8 mm sidewall bulge, raised sidewall rib + two arcs of raised lettering, valve stems on all four; **7** mirrors as 150 × 100 × 45 mm shells on a chrome stalk from a base plate under the belt; sedan wiper pivots 35 mm below the glass base (arms + posts now clear the hood edge); drip rail a 14 mm flat chrome strip 5 mm proud, running to the cab back on the pickup; **8** well inner wall down to 6 cm; **9** bumpers and returns at 6 bevel segments (no facets in `wheelstop`); **10** tailgate relief panel, fuel filler doors (150 mm shut-line squares, left rear quarter / left bedside), sedan trunk lock; **11** `precast` redrawn as a smooth mould face with float grain, dust and water-run stains, bug holes, a rust bleed, and exposed aggregate only in six chipped patches; **13** ladder cords 1.1 mm / rungs 0.5 mm. Skipped: 11 chipped arris (geometry), 12 (rut tracks, crack dust fill, CMU mortar depth), 13 tilt wand — it exists (12 mm tan rod at the left jamb, room side) but hangs behind the slats from the lot, as a real one does; sidewall lettering is raised glyph blocks, not legible text. Later-stage, not touched: the contact shadow (main's fix is merged — it is no longer a black blob), chrome bumper lower faces still take the probe's sky. Boot 10.5 s ready in the harness (merged main; rev 5 13.1–15.4 s under contention); draw calls at boot 179, `lot-wide` 255, `door-glass` 147 (rev 5: 166 / 238 / 140 — the delta is main's System 9 props, not the vehicles: `dbg-wheel` 71 vs 67), triangles 1.24 M. Rev 5 (critic on rev 4: narrow fail — glass interiors, mirrors, wheel stops, horizon layering, raised blind and slat sag verified; four vehicle blockers left): **1** sedan fender flattened — `stationRing` now keeps every flank point on ONE x(y) profile anchored at the nominal sill and the belt (rev 4 re-placed the bulge point at 45 % of the *remaining* height over each arch, so the flank re-shaped itself around every wheel cut-out = the "blister" with a crease to the A-pillar), constant 2 cm rolled lip on the arch edge, and `normalAt` takes the belt column's length tangent for the flank points (their own columns climb the arch curve and tilted the normals fore/aft) — specular-stretched `dbg-sedan-front34` shows one continuous highlight band along the fender shoulder; **2** pickup tailgate: the bed pocket runs to the gate's inner face and a separate gate slab sits between the bedsides (two 6 mm dark vertical gaps, bottom hinge line, recessed centre handle with chrome pull, top 15 mm under the bedside caps), vertical tail-lamp units on the bedside rear corners, plate moved down to the step bumper, tail taper 6 mm, cab back drops straight to the bed-rail height; **3** shut lines: 7 mm × 8 mm groove in unlit black (`MeshBasicMaterial 0x000000` — a light trap, nothing to shade) with 6 mm paint chamfers either side (`Groove.bevel`: the two chamfers face opposite ways along z so one catches light and one shadows — the highlight/dark pair a real cut line shows), hood↔fender / deck↔quarter strips 9 mm; measured at native in `tmp/seam.mjs` (per-row min vs panel ±6–14 px): sedan doors 52 / 52 sRGB (`dbg-sedan-front34`), 79 / 74 (`dbg-sedan-rear34`), pickup door 187–220, pickup hood/fender line 53–55 (was 28 at 6 mm); **4** pickup wipers parked along the cowl at 5° rake for the steep glass (rev 4 used the sedan's deep-cowl stand-offs, which floated the arms up the pane), pivots visible, arm 6 mm / blade 10 mm. Polish: **5** curved dark wheel-well tub (superellipse following the arch 1.5 cm inside the lip, down to the sill) and a domed chrome centre cap with a 18 mm emblem on the sedan covers (the flat dark medallion read as a hole); **6** sedan bumper ends return around the corner in chrome with amber signals in the valance below; **7** pickup axle-to-cowl 22 % (wheelbase 3.0, front axle 0.86, cowl 1.52), drip rail 10 × 10 mm at 3 mm proud (the 16 mm bead read as a roof lid), roof stations tightened at the tail; **8** blinds: three ladders at ±0.55 / 0 (no duplicate end verticals), both pull cords run the full drop from the headrail end into a turned acorn (neck + flared body), the creased slat is forced to the −x end in the bottom 4–20 hanging slats where `window` sees it (22–34° twist, tip 20–28 mm up — legible fold at native 1720, 370 in `sys3-window`); **9** scrub: six leggy trunkless creosote variants near, one broken-canopy mesquite only beyond 45 m; ruts feathered by vertex alpha with independent wander and width wobble; graded shoulder with a wandering outer edge; range feet vary with `footNoise`; **10** wheel stops: `precast` aggregate texture (speckle + rust runs), true 45° chamfers (flat extrusion, chamfered profile), two 40 % rubber scuff bands on the lot face. Boot 13.1–15.4 s ready in the harness (other agents on the GPU); draw calls at boot 166, `lot-wide` 238, `door-glass` 140 (rev 4: 167 / 237 / 139), triangles 1.28 M. Rev 4 (two critics passed everything but the vehicles and wheel stops): **1** panel shut lines as real grooves in the loft (6 mm wide × 8 mm deep dark walls/floors in their own geometry, door cuts on both cars, trunk-lid leading edge, 6 cm cab–bed gap; hood↔fender and deck↔quarter cut strips 2.5 mm proud), one pull per door (pickup 1, sedan 2 per side) just ahead of each rear shut line; **2** glass cut out of the body loft and rendered as a blended dielectric pane (`makePaneGlass`: Schlick Fresnel α = 0.38 + 0.62·F, premultiplied custom blend, still in the opaque list for the transmission pass, inner faces 12 % reflection) over a cabin lining (the loft flipped inside out), padded dash + binnacle, tilted steering wheel with three spokes and column, seat backs / cushions / headrests on posts (sedan), bench (pickup), rear shelf; A-pillar and C-pillar edges raked by quad splitting; windshield shows wheel + dash silhouettes in `dbg-sedan-front34`; **3** wipers as pivot post + nut + arm + hinge + blade + rubber, parked along the cowl channel 60 mm below the glass base at 12° rake, lower part behind the hood's trailing edge; **4** wheels: lathed tyre (sidewall bulge, 8 tread grooves, bead, sidewall/tread tones in the vertex colour), painted steel rim with lip + 5 lug nuts + centre cap (pickup) or full chrome cover with dish rings + black medallion (sedan), radial brake-dust vertex colour, dark drum behind; tyres fill the arches (superellipse p = 2.6 flattened arch on the sedan, p = 4 rounded-rectangle on the pickup); **5** pickup re-proportioned: front axle 0.72 m behind the nose (WB 3.0), windshield base 0.64 m behind the axle (21 % WB; measured in `dbg-pickup-side` at native resolution: axle x = 404, A-pillar base 637, rear axle 1264 → 233 / 860 px = 27 % axle-to-cowl (rev 3: 41 %), body nose 160 → 28 % front overhang, bumper 112 → 34 % (rev 3: 42 %)), door cut at 1.42, full-width chrome-framed fascia with twin round sealed beams per side (concave chrome bowls, fluted domes) flanking an egg-crate grille; **6** both door mirrors 150 × 100 × 70 mm painted heads on chrome arms; **7** wheel stops: 1.83 × 0.20 × 0.14 m (72" × 8" × 5.5") precast bars with 6 mm chamfers, two dark rebar pin holes 0.46 m in from each end, centred in the stall (0.44 m clear each side), ±3° skew; noses parked 0.37 m (pickup) / 0.48 m (sedan) past the bar face, tyres 8–10 cm short of it. Polish: **8** blinds — one 6–10 mm sagging slat and one creased slat (outer 15–25 cm twisted 14–25°, tip drooping 8–15 mm) per blind at seeded heights 66–94 % down the drop (the band a seated or standing eye actually sees — measured in `window`: sag slat 9–12 px between ladders ≈ 6–8 mm at 1.5 px/mm, kink tip 12 px down with the twist reading edge-on; every other slat within 3 px end to end), the last blind in the row pulled up 15–30 cm, closed 27 × 19 mm bottom rail with end caps and two cord buttons, cream acorn tassel (17 × 50 mm) on a 2 mm cord pair; **9** horizon as three ridged-noise range layers with a clear tonal step fading with distance, scrub edge broken by a noise-graded shoulder with a parallel pair of tyre-track ruts running from the road to the wall gap (visible through the gap in `dbg-wall-road`; rev 3's ruts were wound face-down and back-face culled — see Lessons), six distinct creosote / mesquite silhouettes merged into one mesh; **10** headlamps with reflector depth and lens fluting, bumper guards in mirrored pairs flanking both plates. Also fixed in the final pass: the loft's belt ring sat *above* the hood/deck top ring wherever the panel is lower than the belt line, folding the skin outward so its underside showed as a 4–9 cm black lip along the far hood edge on both cars (`dbg-pickup-front34`, `dbg-sedan-front34`); the belt ring is now clamped 3 cm under the top ring (see Lessons). Sedan kept as the 1977–90 box Caprice (see Lessons). Boot 12.6–13.0 s in the harness with parallel agents on the GPU (main `f642bac` shot beside it measured 37.6 s under the same contention, so the number is load, not the branch); draw calls at boot 167 (main 173), `lot-wide` 237 (main 237), `door-glass` 139 (main 133: +6 = the two blended car-glass/lamp-glass meshes and the extra dark/chrome/wheel buckets); triangles 1.28 M (main 1.24 M). Rev 3 (critic items A–F): **A** vehicles rebuilt as lofted bodies through 24-point cross-sections (`Station`/`loftBody` in `Exterior.ts`: 20 mm sill radius, side bulge to the belt, tumblehome to a 70–90 mm roof radius, plan taper at the ends, analytic normals with one-sided tangents at the hood/roof creases) with the wheel arches cut into the lower edge so four lathed tyres (rounded shoulders, sidewall bulge, 0.19 m bead) show under the fenders; ride height 0.31 m sill / 0.35 m tyre (sedan), 0.42 / 0.38 (pickup); chrome bumpers 0.45–0.58 m with rubber guards over a painted valance; sealed beams (2 × round 5¾" per side on the pickup, 2 × rectangular on the sedan) as glassy `MeshPhysicalMaterial` lenses in chrome bezels; amber signals; egg-crate grille texture (`grilleTexture`); plates front + rear (`plateTexture`); door mirrors on chrome arms, wipers on the glass, chrome pulls, rubber + chrome side moulding, drip rails, shut-line slivers, wheel-well liners and underbody mass; glass metalness 0 (rev 2's 0.55 tinted the sky reflection black — see Lessons), dust-film paint (`carDust` map + roughness). **B** route holes 12 × 6 mm ovals (annulus-triangulated patches in the slat mesh) — 5 px at booth distance, showing whatever is behind (`crop-route-hole`). **C** slats are real per-blind geometry (`appendSlat`): tilt 25 ± 5° per blind, drop 0 or 3–8 cm with the spare slats stacked on the bottom rail, 1–3 mm parabolic sag between ladders + free-end droop, 1–3 creased slats per run, ±2.5° per-slat jitter, ±4 % tone via vertex colours; ladders front + rear with rungs; 25 × 38 mm pale headrail; moulded plastic tassel in slat colour (the `lot-wide` "dark 15 cm band" is the window's transom bar behind the slats, not the headrail — see Lessons). **D** Ø 0.6 m poured piers 0.75 m high with chamfer, grout collar, steel base plate, four anchor bolts + nuts and a pole flange; 150 mm kerb + 0.7 m gravel strip along the CMU base; 90 mm precast cap with 25 mm overhang; two-lane frontage road 16 m behind the wall (shoulders, edge lines, faded centre line) with creosoted utility poles / crossarms / insulators every 38 m and 1 px catenary wires; 110 instanced 1–2 m creosote bushes (stem fan + olive foliage clumps). **E** verified, no leak: with the spot off (`sunLot` only) the room has no sun patches at all; the "unstriped" wall patches in `length`/`counter` are the last window's blinded throw on the end wall — striped at 2–3 px pitch (oblique compression + penumbra), invisible at frame scale; the seat patch in `stripes` is shadowed vinyl mirroring the bright window. **F** door smudge redrawn as a palm-heel smear arc + scattered fingertip dabs + diagonal drag streaks (nothing periodic), alpha × (0.3 + 0.7·(1 − N·V)²) so it brightens at grazing angles (`crop-smudge`). Draw calls unchanged (114–271 by pose, worst `length`); triangles 1.30 M. Rev 2: two-light sun split (spot for the building, directional + caster-only cone for the lot — see Lessons) so poles, cars, stops and the CMU wall cast onto the lot; exterior fill ×0.45; A1/A2 measured and documented as critic mis-reads (`crop-wall-under-sill`, `crop-stripes-rectified`); blinds: 1.3 mm ladders front + rear with a rung under every slat, 10 × 6 mm route slots with the lift cord through them, ±2.5° tilt jitter + 3–4 kinked slats, ±4 % tone, enamel crown highlight (smooth 0.3 roughness base + sparse dust streaks to 0.6, metalness 0.1, env 0.7), 1" × ½" bottom rail with end caps, headrail + valance lip, 12 mm tan tilt wand (0.5 m, right jamb), two pull cords + equaliser + turned-wood acorn tassel (left jamb, ending 15 mm over the stool); cars re-bodied (lofted profile with sloped hood/trunk, raked pillars, flared arches, rocker, door shut lines, B/C pillars, drip rails, chrome bumpers/belt line/mirrors, sky-reflecting glass, recessed lamps); 1.8 × 0.15 m trapezoid concrete wheel stops; 3 more branching cracks with 3–4 cm black filler, oil blotch at a stall head, tyre scuffs; CMU tones randomised per block on an 8 × 4 tile; satin stainless push-bar mounts; sky brightened toward the sun azimuth with a haze band at the ridge foot and a fainter second range; scrub in three size classes / three tones with down-sun contact-shadow decals; ceiling/fan/overlays/car trim no longer cast (draw calls 179–338, worst `length`, with the per-frame shadow passes; lower since the shadow maps are rendered once at boot — see Startup). Rev 1 was: venetian blinds on all five windows (none on the door: the reference diners keep the door pane clear for the OPEN sign and the view of who is coming), instanced curved 1" slats at 22 mm pitch / 45°, ±0.5° tilt, ±0.3 mm sag, a kinked slat per window, ±4 % tone, dust streaks on the up-faces, rails, two ladders + lift cords + wand each; slats cast the hard stripe shadows through the existing sun (tight 3.3 mm shadow texels). Window/door glass `MeshPhysicalMaterial` T = 1 with the 12 % loss in the colour, IOR 1.52, 6 mm, green-grey attenuation, room-probe reflection, dust haze heavier at the lower edge/corners, wipe streaks, five handprints at push-bar height (roughness patch + haze decal). Exterior: 150 mm kerb + 1.5 m sidewalk, 12 stalls of re-striped asphalt (drift, tyre polish, sealcoat patches, alligator + long cracks with dusty/sealed fills, oil drips, old + new lines) over a plain surround, kerb stops, 1.2 m CMU wall at the far edge, two 7 m light standards on concrete bases, dusty white pickup (5.3 m, 2.9 m wheelbase, 0.71 m tyres) and maroon sedan (4.9 m, faded clearcoat) with dark glass, chrome bumpers/trim, recessed headlamps with chrome bezels, contact-shadow decals, `lotEnv` probe; desert dirt with 900 instanced scrub patches, fBm mesa/ridge ring fading into the sky, shader sky dome (near-white horizon → pale desaturated blue, sun glare on az 38° / el 35°), linear fog 45–260 m for atmospheric perspective. Draw calls 181–335 (worst: `length`). |
| 4 | Lighting | **Rev 7 evening preset** (6:45 PM, sun 9° / 18 klux / 3,200 K, golden-hour sky, troffers 8,700 lm, 1/20 exposure, `?ev=` + `[` `]` dial — see "Evening preset (rev 7)"); **PASSED at rev 6.1** (two independent critics passed every interior pose at rev 6 — stripe troughs 1.6 %, sun : shade +5.2 EV, glass vs open door within 0.3 EV, troffer +3.9 EV, no true clipping; 6.1 fixed the one failing exterior pose, `ext-facade`: undersides of the blinds lit from the lot 72 → 146, facade shadows on the lot probe −7.1 → −2.5 EV under the wall; merged to `main`). Rev 6 was (see "Rev 6"): structural ports from the sibling projects — hue-preserving knee (+3.5 EV) + stock crosstalk before the Hable curve and a print toe after it, display-referred Karis bloom; analytic blind-slat stripes (slats out of the shadow map, closed-form transmittance ⊗ sun disc; troughs 1.7 % of the crest at `macro-table`, rev 4 60–85 %); alpha + additive-leaf glazing with no `transmission` on architectural glass (sky through the east glass 3,813 / 4,548 nits = +3.2 / +3.5 EV, codes 226 / 230, within 0.1 EV of the open door; `GlassResolution.ts` removed); grey pinned at display 0.18 with sedona's local-max shadow lift (wall sun : shade +5.0 EV; shaded walls 46 far, 68–77 window-side); rectangle form-factor first bounce from the baked sun-patch quads replacing the bounce spots (ceiling +0.46 EV over the shaded wall, from +1; tile beside a lens 106); troffers 5,800 lm maintained, lens bars +4.0 EV and blooming; maroon albedo 0x6e141c (R > B on every panel). Scene pass 7.7 ms at `length` (rev 4 7.7), boot ≈ 10 s. Rev 4 was (over `main` a255016; see "Rev 4"): the camera exposes for the room — 1/60 s with a +4.5 EV Hable shoulder (grey 405 nits; shaded walls 99–120, ceiling 81–122, `undertable` tiles 36 with 0 % black, sky through glass 237 clipped, `door-glass` sand 238 > asphalt 222), `lot-shadow` alone at the exterior camera (−2 EV); dielectric slats (metalness 0, roughness 0.6–0.85, alabaster albedo, lot ground fill on the undersides: flat 239–248 body + one edge, `booth` faces 206, near/far windows 0.11 EV apart); sedan base specular 0.05 + clearcoat 0.1 (roof 148 mean, 0.5 % clip, B−R +13, under the sky); dust 3–4.5 px discs at 0.015 + PCSS camera-footprint floor (0 fireflies on every cited region); bounce stand-ins diffuse-only (the counter lip's 14,700-nit neon → 1,900) on a satin `stainlessLip`; horizon rings 0.55/0.7/0.75×; lot kernel ±1.06 texel (car shadow 3.12 EV, 2.7 px steps). Scene 8.6–8.8 ms at `length` contended (rev 3 8.4–8.5), 330 calls. Rev 3 was: room probe 0.7 → 0.1 after per-source attribution (the critics' "unlocked exposure"), physical blue dome in nits × chroma (15 klux; sky (138, 168, 200) the same through glass and without), material-define two-sun split with no cone occluder + `sunLot` 4096² 1-tap (car shadow 3.07 EV, 3–4 px edges), troffers 10.5 klm with two clipping tube bars, heat lamps orange, car paint `specularIntensity 0.35`, specular AA, slat winding fixed (the "grey grille"), nearest-blocker PCSS, ceramic profile AO, late-hook PCSS sampler binding (the coffee liquid was silently undrawn). Scene 8.4 ms at `length` contended vs `main` 8.2 under the same load. Rev 2 was: camera tone curve with white at +2.5 EV, 1/250 s, 6 Lambertian troffer spots + tube-image lens emissive, per-booth sun-bounce spots derived from first principles, 10,000-nit blue dome integrating to 23 klux diffuse, bilinear PCSS 8 + 12 with world-anchored taps, `sunLot` 2048² 1-tap, car-shadow decal fixed, scene pass 7.7 ms / boot 10 s. Rev 1 was: (`shots/sys4-*.png`, post on; `shots/sys4-raw-*.png`, `?post=0`). Physical units at K = 1e-4 with camera exposure ISO 100 f/5.6 1/160 (EV 12.29, grey 1,080 nits, AgX); 90 klux 5500 K spot sun with PCSS (0.53° disc, 3.5 mm texels) + directional lot sun; sky dome scaled to 5,500-nit horizon with circumsolar boost and baked into split PMREM probes (sun-off for dielectrics, sun-on for metals); 8 × 7,500 lm 4100 K troffer RectAreaLights with 4,500-nit lenses; window sky fills + floor-patch bounce RectAreaLights; contact-occlusion decals; `sunBeam` compare-map twin so System 8's dust/haze keep working under BasicShadowMap. Measured: sunlit vinyl stripes +0.9…+1.7 EV, table core +3.8 (clips), sky through slats +2.3…+3.1, counter top −1.1…−1.3, die −2.7, seat in shade −2.9 — see REFERENCE §8 |
| 5 | Materials and textures | **passed, rev 5 + polish** (`sys5-rev4` → `main`; polish on `sys5-polish`: scuff families clustered at hotspots with heavy ends, tilted/broken cup rings ×10, lengthwise kick-plate grain and fan). Rev 5 was (`sys5-rev4`, merged into `main`). Rev 4 was a narrow fail on three items — the dashed boot smears, free-standing pale flecks on the booth vinyl, hard-edged lighter rectangles on the floor; rev 5 draws each smear as one integrated path with a rubber-dust halo, deletes the flaked-scrim islands (the backing now shows only inside the widest crack lines, `open` field), and proves the rectangles were contact-occlusion strip ends (A/B `shots/sys5-ab-floor-*`: survive the shelter step, the counter shadow, the suns and troffers; vanish with `?hide=contact-occlusion`) — one faded run per aisle end from the kick face. Polish: geometry chips at the crack lips (almond/grey by tile) + a second crack, seam pucker as stitch wrinkles, 1.4 mm stitch holes, seven cup rings + visible scratches, burnish hook rewritten on `G − R` with a pink lift + clearcoat, welt shadow bead, stain rim weighted to the low side, slat dust line; `wall-macro` orange peel verified bound (no directional light at that pose). Found and fixed a 150 mm z registration error in every world-authored floor mark (`originZ`). Boot +1.1 s, draw calls 185 vs 183. See "System 5 rev 5". Rev 4 was (`sys5-rev4`): rev 3 cleared five of eight rev 2 blockers and failed on five: rev 4 fixes the kick plate (aluminium F0, roughness 0.22–0.32, own door probe, box-projected 9-tap brush-fan reflection), the crazing (dark red-brown hairlines of varying width with lifted lips, matte `physMap` field, stitch rows; the roll/channel junction is a real seam — panel and cords run under the piping, `rollSeam()`), the ceiling stain (one rim, one faint tide, blotchy wash, dirty fissures; second stain moved into `ceiling`), the floor crack (the ribbon had been back-face culled since rev 2 — never drew; now a hard 1 px hairline starting at a joint, chips instead of strokes), scuffs (grey, sharper, no hooks, invisible on charcoal), boomerang outlines, seat burnish (gloss/flatten hook), wall-band gloss core, and the shelter step (the later-stage parallelogram — mine). Laminate moiré A/B committed (`shots/sys5-ab-*`): survives constant maps and diffuse-only → lighting (PCSS × blind penumbra). Boot +0.7 s, draw calls 177 vs 179. See "System 5 rev 4". Rev 3 was (`sys5-rev3`, over `main` @ 5894333). Rev 2 passed structure and failed at 1:1 — every mark read as a stamped pattern; rev 3 makes each mark obey its physics: **VCT floor decision** (butt-joined 12-in tiles, 1.5 mm hairline seams, no grout), rubber transfer as a *multiplied* transfer field (dense core, feathered, streaked along the drag, broken, max-composited, substrate-aware), a jagged crack that runs along seams and breaks at joints with geometric lips and a per-segment dark ribbon, dark sequential-fragmentation vinyl crazing on a non-tiling UV1 atlas with cylindrical roll UVs (no crest seam), featureless laminate haze + micro-scratches + partial-arc cup rings with dither, a smudge-field wall rub band (no line, no specks) with 2–4 mm stipple domes, a kick plate canvas (brushing, boot rubber, mop film) + 12 Phillips screws on the template + a bent bottom edge, ceiling stains as a multiplied tint with a wandering rim and broken nested tide rings + a tapering sag slot over a dark plenum, vertex-colour seat burnish, a 2 mm flush counter seam. Fireflies diagnosed: laminate = PCSS (0 dots at `?taps=32,24`), door/kick/vinyl = System 8 dust motes (0 at `?post=0`, same count on main). Boot +0.29 s, draw calls 180 → 180. See "System 5 rev 3". Rev 2 was (`sys5-rev2`, over `main` @ 7d3600c = lighting rev 1 + sys3 rev 4 + audio rev 3 + interactions rev 2 + System 8): rev 1's wear was bound but invisible (roughness-only under a rig that reflects nothing bright; 1–5 % albedo); rev 2 moves every cue into 10–30 % albedo steps or geometry: greyed lanes + hard rubber marks + tone drift + a ribbon-mesh crack on the floor, a rub band + contact line + AO'd stipple on the walls, lobed stains + a sagging tile with a shadow slot, mirrored/two-sided door signage on a mip-guarded 2048 atlas, satin kick plate with screws, laminate wear in albedo, scrim-floored crazing on one booth, dusty bells, carafe tide line, tee chips with rust, baseboard mop line. Draw calls −1…−4 per pose vs main. See "System 5 rev 2". Merged into `main` over System 4 rev 2; `shots/sys5-*.png` re-shot under the rev 2 rig (camera curve, 1/250 s) at the merge so the wear is judged at the shipping exposure. |
| 6 | Sound design | **built, rev 3** (section above) — 100 % synthesised: AM-radio speech rhythm, AC drone + rattle, fan whoosh, warmer ticks/gurgle, room tone; pour / clink / door one-shots and the exterior heat wall. Rev 3 measured the live mix at six listener poses (BS.1770 LUFS per bus) and re-levelled it: aisle bed −36.2 LUFS, room −44.5, AC / fan / radio −35 / −39 / −33 at 1 m, warmer near-field; pour lands with the stream, clinks −12 dBFS, heat wall −26 LUFS with an equal-power swell, room ducks 3 dB while the door is open, latch on close |
| 7 | The 3 interactions (sit, pour coffee, open door) | **built, rev 2 — feel polish** (`shots/sys7-seq-{sit,pour,door,door-ext}.png` time-series sheets + 18 key frames from `tools/sequence.mjs`; anticipation beats, arced/tilting pour with continuity-thinning stream, drips and volume-true fill, closer-profile door with hold-while-in-doorway and latch SFX, four-beat sit with lean and cushion settle, System 8 `SteamEmitter` reused (duplicate `interactions/Steam.ts` deleted), first-pour 0.7 s link hitch removed; player accel/decel 0.15/0.12 s, 1.4 cm head-bob, push-out collision that slides round stool bases — see "System 7 rev 2" above). Rev 1 was: (merged into `main` over the loader + System 3 rev 2: shadow-once invalidation on door/pour, audio on the loader's enter click, pour programs pre-issued) — `src/interactions/*` + `src/audio/wiring.ts` (System 6 wired: gesture start, positional beds, pour/clink/door SFX, exterior crossfade). Frames `shots/sys7-{sit-seated,pour-mid,pour-full,door-open}.png`; 23/23 live Playwright checks; update ≈ 0.01 ms; +6 draw calls only while pouring |
| 8 | Post-processing and final polish | **built, rev 1 + steam rev 2** (`sys8-steam`: puff sprites → wisp ribbons, streakline centreline, per-fragment sun-beam test, fade planes, carried-source wake from the drink; +1 draw call and ≤ 0.006 ms per source — see "steam rev 2" under System 8) — rev 1: (`src/post/`, section above), merged with the loader + System 3 rev 2 (spot sun, shadow-once — see "Integration" above) — MSAA 4× scene target, sun-beam dust (5 k shadow-map-lit motes), half-res volumetric haze through the beam prisms, exterior-only heat shimmer, ambient decanter steam (`SteamEmitter`; System 7 rev 2's pour steam is a second instance of the same class), high-threshold bloom, CA 0.5 px, 0.3 EV vignette, corner softness, ACES/AgX/Neutral tone map, luminance-dependent procedural grain; ~1.3 ms post + ~1.3 ms MSAA at 1080p on the 4060; `?post=0` bypasses everything |
| 9 | Extended interactions and implied presence | **built, rev 4** (`sys9-rev4` merged to `main`; "Rev 4" under System 9). Fix `fix-counter-door`: the kitchen door is a toggle like the front door — E opens it (0.7 s push + 0.8 s wobble against a hold-open) and it STAYS at 90°; E again releases it into the spring return (2.25 s, frame-pass whooshes, bumper thud); prompt "Open / Close kitchen door", `__interact("kitchen-door-close", t?)`, `kitchenDoor.state`, `shots/fix-door-*.png` (held at 90° through 8 s of live frames). Rev 4 ( frames `shots/sys9-sys9-{plate,cup,cabinet,cabinet-open,kitchen-door,kitchen-door-open,kitchen-door-back}.png`, sheets `shots/sys9-seq-{drink,cabinet,cabinet-close,kitchen-door}.png`). Rev 4 (rev 3 confirmation: seven of eight passed, plates the blocker): kitchen-leaf plates as a box-projected, brush-stretched (9-tap fan) mirror of a probe captured at the door, brushing runs in the roughness, F0 238/240/243 — closed push plate mean 82 / upper half 90 vs paint 95 (mirrors the back bar and booths; the ≥ 105 target is not physical from that camera), open push / kick plates 116 / 109 over paint 98; station probes in Diner.ts; kitchen steel on an in-slice probe; streaky feathered scuffs; feathered lip-line print; flared sheet pans; fork handle out of the sun; draw calls identical to main at every pose; harness 25/25. Rev 3 — second frame review: **apron cut** (two lofted rebuilds still read as a stiff scalloped panel at 1:1; the hook stays), fork rebuilt on one spine (2 mm tines with a tip curl, root → shoulder → neck, superellipse handle, contact AO, head out of the sun spot), lip print straddling the rim top with an inner trace, kitchen-door plates as brushed stainless by vertex alpha + anisotropy with screws, cart scuffs as a multiply albedo decal (no sign flip), Fresnel vision pane, #10 can label, stainless bowls, sheet-pan stack, trash can, hood lip + grille, drink drained linearly over the sip at 25 % (four sips) with the contact disc fading by 3 cm of lift, prompts hidden on `sys9-*` frames; harness 27/27, draw calls vs main +1…+6 by pose, boot within noise. Rev 2 (critic's frame review answered item by item): **cut** the cardigan, toast, yolk smear and newspaper (read as procedural: tea-cosy, annulus wedge, matte polygon, keyboard slab); plate with a rolled-rim diner profile in glossy ceramic, stainless fork with a bowed handle and tapering tines, 11 flake crumbs, a near-transparent dried-yolk film; cup with a two-lobed upper-lip lipstick print on the outer rim, welded lathe seam, residue ring + dreg, saucer well + foot ring + contact shadow; apron rebuilt (fabric loop on the hook, pleated waistband, four heavy unequal folds + full-drop gathers, hem 160 mm vs 116 mm bunch, rolled hem, pocket with stitch line / gaping mouth / sag, tide-line blots, two ties, twill weave); kitchen door with a lit 2.7 m kitchen slice behind it (white 4" tile, quarry floor, stainless prep table + shelf, hood, 5000 K strip + one shadowless spot), 9 × 14 in vision panel in rubber moulding with a blended pane, 16 in kick plate, push plate, cart scuffs; cabinet open with a 0.15 s ease-in, Euro hinge cups + arms, spray trigger head, filter label band, saucer-profile stack, both leaves one CPU-baked mesh; drink retimed to 2.8 s with a Catmull-Rom head spline (5.2° tilt, 1.2° yaw drift, no static frames). Harness 27/27. Own meshes 6 → 5; draw calls vs main −8…+6 by pose (all ≤ +8); boot within noise. Rev 1 was: (branch `sys9-interactions`, section above; frames `shots/sys9-sys9-*.png`, sheets `shots/sys9-seq-{drink,cabinet,cabinet-close,kitchen-door}.png`) — drink from the mug (1.6 s camera-attached raise, ⅓ per sip, volume-true, steam with level, Pour re-arms under 15 %); openable cabinet doors (soft stop, magnetic catch SFX, shelf of saucers/filters/spray bottle) and a double-acting kitchen swing door (push to 90°, spring return with two decaying oscillations, dim vestibule, no lights), shadow-once at rest; implied presence — apron on a hook, cardigan over a stool, half-finished plate + folded newspaper in booth 2, lipstick cup at the counter — on one atlas material with the statics merged into existing buckets; kitchen presence audio (murmur, dishes, tap; −48 LUFS at the counter, aisle bed unchanged); Shift sprint / Space hop / E + Q keys. +4…+10 draw calls by pose, 6 own meshes |

Known simplifications after System 3: no heat shimmer (System 8 post), no
chain fence, the cars have no interiors (dark glass hides it at 10–30 m), the
sky has no clouds, L-return top empty (register is a later prop),
kitchen box holds dim grey silhouettes only (the slice behind the swing door is lit since System 9 rev 2), no second (restroom) door on the
far end wall, the troffer lens prism pattern is a faint 6 mm cell map +
normal map, cap rails have no separate end-grain material. After System 4:
the lot asphalt sits at +1.4 EV rather than the brief's +2.5 (its albedo is
0.135; System 5 can pale the sealcoat), the sky through the slats peaks at
≈ +3.1 EV rather than +3.5–4.5 (raising the dome lights the room through the
glass and flattens the lot shadows — REFERENCE §8 Lessons), the chrome does
not "blow out" because the stools' sun highlights are small at 1080p.
