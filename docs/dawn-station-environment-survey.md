# dawn-station → morning-diner: environment-layer survey

Read-only survey of `C:\Code\dawn-station` (src/site.ts, src/gen/*, src/systems/TerrainSystem.ts, VegetationSystem.ts, lightSky.ts, lightShaderPatches.ts, HANDOVER-terrain.md, HANDOVER-vegetation.md, PERF.md, BUILD.md, NOTES.md). Lighting/tone/shadow/PMREM/glazing are in `lighting-port-survey.md` and are not repeated. All colours quoted are **linear scene-referred** unless stated.

Reference frame for the diner: `src/scene/Exterior.ts` today = `PlaneGeometry(420,420)` desert with one 1024² dirt map at `repeat 60`, 520 `IcosahedronGeometry(0.5,1)` blobs in one InstancedMesh + ellipse contact decals, three vertex-coloured horizon rings at 118/150/188 m, a 170 m sky sphere with a `smoothstep(0.999975, 0.999992)` pinprick disc, `scene.fog = new THREE.Fog(horizon, 40, 200)` (`Diner.ts:118`), 1-px catenary wire lines, tyre tracks as feathered vertex-alpha strips.

---

## 1. Ground

### 1.1 Mesh
- **One 840 m native-ground mesh**, `TerrainSystem.ts:961`: `gridSurfaceGraded(-420, 420, -420, 420, 420, 420, dirtY, D, { halfX: 50, halfZ: 45, ratio: 5.5 })` (`gen/geo.ts`). Vertex density is 5.5× finer inside the ±50×45 m pad box and ramps out over 2.6× that distance so there is no visible resolution seam. 231,200 tris, 1 draw, `castShadow = false` (PERF.md §3a). Far quads ~2.5 m, near ~0.5 m.
- `gridSurfaceGraded` publishes `userData.surfaceAt(x,z)` = height of the **rendered** chord, not the field; everything placed on the ground uses it (fix for objects buried by chord error, HANDOVER-terrain).
- Roads are separate grids: highway `gridSurface(-340, 340, ±ROAD.halfPaved=5.16, 1360, 26, roadSurface)` (70,720 tris), pad `gridSurface(PAD…, 200, 130, padY)` (52,000), driveways `48×20`, forecourt slabs `16×16` each, merged.
- **Ragged pavement edges**: `ragEdge(geo, axis, edge, excursion, sag, seed)` (`geo.ts`) — `ROAD_EDGE = { excursion: 0.4, sag: 0.011 }` (`site.ts:82`), driveways `ragEdge(g, "x", …, 0.16, 0.009)`. `ragOffset` = 4 octaves of true-wavelength 1-D value noise (`vnoise1`, integer lattice + interpolation — a bare hash gave white noise); the 4th octave at **0.055 cyc/m (~18 m, a paving train's wander)** carries most of the weight because the original 3 octaves topped out at 2.7 m and vanished past 15 m ("dead-straight pavement edge" critic note).

### 1.2 Height field (`src/site.ts`) — everything is analytic, no heightmap
`groundHeight(x,z)` = `roadSurface` inside ±5.16, `drivewayY` in driveways, `padY` on the pad, else `dirtY`.
- `undulation(x,z,amp)`: 5 sines, wavelengths ~78–100 m down to ~9 m, weights 0.55/0.3/0.09/0.05/0.03.
- `dirtY`: `swell` (600 m+, amplitudes 1.5 + 2.4 + 0.35 m) ramped in by `smooth01(70, 260, |x|,|z|)` so the site stays flat and the horizon is not a ruled line; **drainage swale** `exp(-((d-2.0)/2.4)²) × 0.34` m deep 2 m off the pavement; **berm** `exp(-((d-7.4)/2.3)²) × 0.44` m (back slope 0.19 = the solar tangent, so 700 m of frontage gets a lit edge and a dark edge); **`hum`** = 3 terms at 16–31 m wavelength, 0.30 + 0.26 + 0.11 m; near-field `churn` 3–5 m; hummocks; wheel `tracks`; road crown 0.032 m; `roadRuts`; `LOW_SPOTS` (puddles, e.g. x 22.6 z 38.2; x 12.5 z 10.4) and `FORECOURT_POOLS`.
- **The lesson that matters most for the diner** (HANDOVER-terrain "The plane is so flat it takes no relief lighting at all"): shading responds to **slope = amplitude × spatial frequency**. `swell` (slope ~0.006) and `undulation` (0.42 m over 78–100 m, slope ~0.006) were both 30× under the sun's tangent (0.194 at 11°/0.109 at 6.2°), so every square metre faced the sun within a fraction of a degree of every other and returned one value. `hum` at 16–31 m gives slopes 0.10–0.20 bracketing the sun: crests light, back-slopes fall away, each crest throws 2–3 m of shadow downsun. "No triangles, no textures, no draw calls, and it changes hundreds of metres of frame." Lower bound is the mesh: <12 m wavelength needs ≥5 samples/cycle or it facets with the camera.
- `pavedDistance(x,z)` = distance to nearest hard surface; every scatter system uses it for exclusion.

### 1.3 Textures (`src/gen/textures.ts`, all procedural CPU)
- `makeAsphalt(2048, 8 m, 1337)` → albedo/normal/roughness, 3.9 mm/texel; finest feature `aggFine` ~7 mm = 1.8 texels (they refused to halve it: it is the foreground aggregate grain the critic said "holds up"). Lot asphalt = `clone()` of the highway maps with `repeat × 1.42` so the two surfaces never share a tile phase.
- `makeConcrete(1024, 4 m)`, `makeDirt(1024, 17 m, 404)` + a second `makeDirt(1024, 11.3 m, 909, {…})` "dirt fine" variant, `makePaint(1024)` white/yellow, `makeMacroNoise(512)`.
- `resolvableOctaves(size, baseFreq)` caps fbm octaves at what the texture can hold — the previous unbounded fbm gave "an evenly dappled carpet with no structure". In `makeDirt` the gravel/grass terms are **reduced in the height map but kept full in albedo** (aliasing reads as speckle in albedo, as pits in normals); restoring the slope budget after that produced a "golf ball", so the weight moved to larger features.
- Anisotropy 16 on all ground maps.

### 1.4 World-space detail injection (`src/gen/worldDetail.ts`, `applyWorldDetail(material, opts)` via `onBeforeCompile`)
Uniform table generated once and asserted against the injected GLSL (`assertDeclared`). Layers, all in world XZ so nothing tiles:
- **Macro variation** `wdMacroBig(p)` — analytic, because texture-based macro was destroyed by mipmaps at grazing incidence.
- **Anti-tiling** blend, `antiTile` 0.5 asphalt / 0.4 concrete / 0.85 dirt (`TerrainSystem.ts:558/638/771`), kept out of the program cache key (uniform only) so it does not double the program count.
- **Near-field detail normal** `nearDetailInject`, gain `uNearGain`, fades with distance (`tforce=nonear` control).
- **Site overlay** `uOverlay` (§1.5), **soil field** `uSoilField` (§1.6), **wheel polish** `uWheelZ` (`wdWheel`).
- **Paint erosion** `erodeInject`: macro noise + void map on the stripe materials, so paint lines wear from the edges and along traffic.
- **Wetness** `wdSoil`: albedo `mix(1.0, 0.52, wet)`, roughness → 0.42, `uSpecDirect`/`uSpecIBL` ramps, rain shadow under the canopy, drying stains. **`wetBase = 0.34` damp asphalt** everywhere on pavement, modulated by a 34 m patchy dry-off leaning to low ground (pavement only: soil is touch-dry by first light). Standing water `wdPool` is evaluated **per fragment from world Y against a mirror level** (not baked — baking gave airbrushed blobs), with depth-graded roughness, Fresnel and a chewed margin.
- `reduced` compile-time tier removes most of it for low quality.

### 1.5 Site overlay (`src/gen/siteOverlay.ts`, `makeSiteOverlay(accum)`)
One non-repeating RGBA `DataTexture`, **2048 × ~1000** over the 92 × 66 m `OVERLAY_REGION` (45 mm/texel; was 3072×2204, cut for blur time). Channels: R albedo multiplier, G roughness offset, B oil/tar tint, A dirt-wash coverage. Drawn with Canvas2D and `filter: blur`: tonal drift, sun bleaching, `drivenPath` (two dark wheel ribbons, no pale centre — the pale centre version lowered contrast), `patch`/`coldPatch` repairs and potholes, `sealantWalk` tar-crack sealant with a highlight edge, fuel stains, `stanceScrub` tyre scrub at pump stances, kerb grime from `groundAccum.grime/swept` as normalized lerp weights, damp spots, `ravel` edge ravelling, `jointBleed` where concrete meets asphalt, `wash` grit fans, `contact`/`contactRect` grime under every vertical.

### 1.6 Soil field (`src/gen/groundSoil.ts`, `makeSoilField(n, metresHalf, seed)`)
Baked RGBA `DataTexture`: R drainage (height relative to a `boxBlur`red local datum, `DRAIN_RANGE`), G disturbance (road/pad verges, driveway turn-ins), B wetness, A material (0 coarse gravelly crust → 1 fine pale clay, fbm coarse+fine modulated by rel/dist). Same bytes sampled by GPU (`uSoilField`) and CPU (`sample()` bilinear; `drainage/disturbance/wetness/material` accessors) so shading, mat cover and scatter agree by construction (the earlier independent TS/GLSL versions drifted).

### 1.7 Debris and drift (how the dirt stops being a plane)
- `scatterDebris()`: **12,000 gravel stones** (`STONES`, median radius 54 mm, 20 tris each ≈ 240k tris) in one `InstancedMesh`, `castShadow` on — "at a 6.4° sun each 40 mm stone throws a shadow several times its own length, so the read per triangle is unusually good". Litter `InstancedMesh` from `groundAccum.litter` (items/m²), cast + receive.
- Placement uses the `groundAccum` service (shelter, swept, litter, grime fields + `WIND = { bearing: 2.9, strength: 0.35 }`) so gravel/litter drift to the lee of kerbs, walls and posts and are swept off driven paths. Fields are declared **bimodal**; consumers use them as smoothstep masks with bounded output, never as gradients (a bimodal field as a gradient "reads as a hard cut with a fringe").
- Vegetation adds needle/leaf **debris skirts** under crowns (`addGroundContact`): discrete 4–10 cm flakes standing proud, plus `MeshBasicMaterial` contact discs only under the larger clumps, and publishes `vegetationDebris.coverAt(x,z)` so Terrain subtracts it instead of double-scattering into the same shelter-driven places.
- `ground.receiveShadow` on; 8192 shadow map covers it (see lighting survey).

---

## 2. Mid-ground scatter (`src/systems/VegetationSystem.ts` + `src/gen/veg*.ts`)

Counts (current build, `__VEGETATION` report / HANDOVER): 57 draw calls, ~646k built tris for the whole layer.

- **Pines**: 10 hand-placed (`PINES` array: x, z, h 9.8–13 m, lean, deadBelow, vigour), built procedurally in `vegPine.ts` with distance LOD; whorl vigour `0.62 + rng()*0.66`; one-sided light asymmetry `0.1 + rng()*0.16` (was `0.3 + rng()*0.45` = 7:1 → naked trunk on one face, critic B9); branch cap is a smooth saturation `CAP*(1-exp(-raw/CAP))` not `min()` (a clamp put 9% of silhouette branches at exactly 0.34 H = a ruler along the crown). Trunk AABBs published as collision blockers.
- **Mid-storey** (sage `buildSage`, thistle `buildThistle`, saplings): 228 sites from `midStoreySites` (along fence/kerb/edge) + `openGroundSites`; contact radius `MID_CONTACT_RADIUS_M`; instanced (`veg-mid-wood` 187k tris in one draw).
- **Scrub clumps** (`vegScrub.ts`): alpha-cut card bunches, unit 1×1 m, base of every card darkened in vertex colour. **7 forms × 4 random variants = 28 meshes** (was 3, instanced 1,600×; critic: "the same tuft mesh is recognisable four times… varying uniform scale is not variety"). Forms differ in *structure*: `grass {cards 7–11, spread .24, tilt .4}`, `weed {4–7, .58×1.05, tilt .26}`, `tuft {5–9, .95×.5, tilt .54}`, `sprawl` (near-flat, `bleach 1.18`), `seed` (emergent bolted stems), `dead` (all cards lodged one way), `grazed`. Dead material is **brighter**, not darker (bleached straw ≈ 0.4 reflectance; authored-dark + horizontal under a 6° sun rendered as black plates).
- **Placement** `scatterScrub`: not Poisson — **feature-anchored rules**, each with its own density and a `push()` that emits a main plant plus satellites (patches, not a uniform field). Regions: highway shoulder crack (continuous jittered spacing, density ramped down over 55 m — the old two-sine gate left bare patches; the old 3× cliff at 90 m was visible), frontage verge, fence line (density ∝ wire sag), driveway aprons, back-of-kerb joint, pine drip-line ring with a few stunted survivors under the canopy, **lee-side crescents on posts/poles** (downwind of `WIND.bearing`), open dirt deliberately thin and clustered, far country = `farClusters 58 + gapClusters 16 + roadClusters 34` clusters (~820 instances) with bigger plants at distance. Size distribution `rng()*rng()` with a higher ceiling (uniform gave "tiny specks"); tint = `SAGE↔STRAW` mix biased to sage (straw-biased read "burned-over").
- **Exclusion**: `blocked(x,z)` = `pavedDistance` < margin ∪ `building.footprint` (fatal if the service is missing — plants once scattered through the shop) ∪ trunk blockers; `edgeWander` perturbs every mask boundary so no exclusion zone has a straight edge.
- **Continuous mat** (`vegMat.ts`, `buildMatSheet`, `scatterSprigs`) — the answer to "bare soil with props scattered on it": (a) an alpha-blended `MeshStandardMaterial` sheet following the terrain, receives shadow, **tilted normal field** (an unlit decal over the whole near field "replaces the ground's response to the sun with a flat tone"); cover = `smoothstep(.33,.70, broad fbm @155 m)` × `lerp(.30,1.35, smoothstep(.22,.82, fine fbm @27 m))` × soil suitability (disturbance nearly absolute kill, wetness/drainage help). Raw fbm was remapped to full range then contrast-curved because fbm concentrates at 0.5 and gave "50% of the site inside cover 0.2–0.3 = a uniform 25% green wash". Near sheet: 11.4k cells at 0.85 m pitch, radius 62 m centred (0, 24); (b) **road fringe**: second sheet, 2.1k cells at 1.9 m pitch along a ribbon `reach 190 m × out 15 m` beside the highway (4,358 tris, 1 draw — measured 10.4k px of far ground tone); (c) **7,000 thatch sprigs** 6–16 cm in one InstancedMesh within 42 m, `castShadow false`, foliage transmission `strength 1.6, falloff 2.6, fill 0.45` (was 6.8 → white sparklers; the tuned quantity is `strength × albedo`).
- **Wind**: vertex-shader sway on foliage materials (`?vegwind`, `?vegdamp` minification damping, `?vegramp`, `?vegdepth`).
- **Shadows/shade**: foliage cards use `alphaTest` + `customDepthMaterial` on instanced meshes (alphaToCoverage overrode the shadow-pass threshold); pines and mid-storey cast; mat, sprigs, fringe receive only. Crowns reading dark was measured as missing direct sun (self-shadow cascade), not albedo — they refused to lift albedo because the PMREM is a world capture and would have lit everything else by compensation.
- **Scale props** (`vegProps.ts`): property-line fence (`FENCE_PATH`, posts 1.2 m, T-posts, staples, strands as fractions of post height) and highway poles (`POLE_XS`, `POLE_Z`, 10 m, crossarm, insulators). Wires hang in a true catenary `a·cosh(x/a)` with `a` bisected 28 iterations. Posts published as `{x,z,radius}` blockers.
- **Wires** (`vegWire.ts`): a 10 mm conductor at 40 m is 0.50 px, 0.25 px at 80 m → a tube renders as a moving dashed line. Fix: **camera-facing ribbon widened in the vertex shader to `minPixels 1.7`**, **alpha × (true width / drawn width)** with floor `minAlpha 0.16`, and an **anisotropic cylindrical specular from the tangent** — "a bright thread against the sky and the single most photographic thing about a power line". `fog: true`. (The diner's 1-px `Line` wires are exactly the failure this file documents.)

---

## 3. Horizon and distance

- **Geometry, not dome painting**: `buildDistantLandscape` (VegetationSystem) builds 4 silhouette bands from `HORIZON_BANDS` (`gen/vegHorizonBands.ts`): radii **520 / 780 / 1150 / 1800 m**, heights [9–13.5] / [11–16] / [12–17.5] / [13–19] m, `MeshBasicMaterial({ vertexColors: true, fog: false })`, 4 draws. Assertions enforce each band further, lighter and closer to the sky than the one in front.
- **Colour is not authored, it is `hazed(f)` = mix(`CONIFER_LINEAR [0.030,0.032,0.030]`, `SKY_LINEAR [0.330,0.305,0.315]`, f)** with f = 0.14 / 0.34 / 0.72 / 0.88. `SKY_LINEAR` is the **measured** dome colour 1° above the skyline (`skyRadiance.atHorizon`, `SKY_HORIZON_ELEVATION = 0.01745` — not 0, where the dome starts mixing to `uGround`). Vegetation throws if `skyRadiance` is absent; a "plausible constant" fallback caused the persistent "distant lake" bug. `LightingSystem` also publishes `hazeTint.forDirection(dir)` = the exact colour the fog patch mixes toward on that bearing, because the dome and the air in front of it differ most at the skyline.
- Silhouette: spectrum weighted to crown scale (coarse weighting gave repeating sawtooth / flat-topped mesas), `tanh` height compression, emergents only on some bands, `radiusVary` wobble compensated by `h·(r/radius)` so apparent height is independent of radius, `slopeLight` widens contrast instead of clamping (clamping saturated to flat grey), crown luma **soft-capped under the sky behind it** (white-fringe fix), `baseHaze` small at eye level (large base haze + elevated camera read as a lake).
- **Fog is off on horizon bands** — fog double-counted the aerial perspective already in the colour and produced a cold blue strip.
- Ground relief to the horizon comes from `swell` (§1.2) ramped in 70→260 m; there is no separate mesa/mountain geometry — the desert here reads as a conifer treeline at 500–1800 m over undulating ground.
- Distant road = the same highway grid (680 m long) with ragged edges + far clusters + pole line; no separate LOD road.
- **Not present**: heat shimmer, dust particles, volumetric dust in beams, cloud shadows. Nothing found in src/ for any of them.

---

## 4. Sky (`src/systems/lightSky.ts`, `buildSkyDome`) — structure beyond the lighting survey

Sphere 1400 m, 64×40, `BackSide`, `depthWrite false`, `fog false`, `renderOrder -1000`. All radiances linear working-space:
```
uZenith    (0.020, 0.046, 0.132)   uMid      (0.068, 0.128, 0.252)
uHorizon   (0.325, 0.280, 0.250)   uWarmBand (0.98, 0.475, 0.190)
uSunAureole(1.55, 0.66, 0.235)     uSunDisc  (29.6, 13.0, 4.4)   uGround (0.055, 0.045, 0.036)
uSunRadius 0.0185 rad              uTurbidity 1.0                uCloudGain 1.0
```
- **Vertical falloff**: two stacked powers, `mix(horizon, mid, pow(h, 0.30))` then `mix(…, zenith, pow(h, 0.72))` — a compressed bright horizon and a dark zenith with no banding edge; zenith ≈ 1/8 horizon luminance and far more saturated.
- **Sun-facing tangent frame**: `angle = |(px,py)|/pz` in the sun's own basis, so all aureole terms are elliptical around the sun rather than `dot()` cones.
- **Warm band is anisotropic**: `horizonBand = exp(-|h|·5.6)`; aureole = `exp(-angle·6.5) + 0.30·exp(-angle·1.6)`, weighted `(0.24 + 1.15·horizonBand)·turbidity`; the rest of the horizon gets `uWarmBand · horizonBand · (0.055 + 0.62·pow(cosAzimuth·0.5+0.5, 3.5))` — "making it uniform is what turns a sunrise into a dome of flat cream, which is the first thing a critic notices".
- **Disc**: radius 0.0185 rad (≈2.1° dia, "half again the true 0.27° radius" because refraction+haze smear it), **flattened vertically ÷0.68**, edge `1 - smoothstep(0.22, 1.08, r)` (wide shoulder, limb dissolves at 10 air masses), limb darkening `pow(1 - 0.82r², 0.45)` tinting toward `(0.72, 0.34, 0.14)`, base darker than top by `mix(1, 0.55, …)`. Disc radiance ≈ **100× its own sky band** (at 13× ACES put it at 253/255 and it "read as not drawn at all"); solid-angle 8.5e-5 of the sphere so it adds ~2% to mean env radiance.
- **Horizontal smear** `uSunDisc·0.022·exp(-|ay|·22)·exp(-|ax|/(6R))` and **veiling glare** `uSunDisc·0.0025·exp(-angle·5)` (11.5° e-fold) — "the cue whose absence makes a blown disc look like a white sticker pasted on a gradient".
- **Clouds**: thin under-lit stratus, `fbm` with **non-harmonic octave steps 2.17 / 2.41 / 1.93 / 2.63** (harmonic doubling gives plaid, NOTES #5), projected `cuv = d.xz / (|h| + 0.10)` at scale 0.48, coverage `smoothstep(0.50, 0.87, fbm)` × `smoothstep(0.015, 0.26, h)` × `smoothstep(1.0, 0.40, h)`, colour `mix((0.20,0.20,0.245), uWarmBand·0.92, pow(dot(d,s)·.5+.5, 3))`, blended at 0.70·`uCloudGain`.
- **Below horizon** mixes to `uGround` over h 0 → −0.10: this hemisphere is what the PMREM samples for downward-facing surfaces, so it is the IBL's ground-bounce term and must not be black.
- `evaluateSky()` CPU port of the same shader (minus disc and clouds) → `skyRadiance` service, cross-checked against an 8×8 GPU readback at 18 directions, tolerance 2% (`verifySkyRadiance`). Consumers (horizon bands, haze) get colours from this, not from constants.
- Sky through glass: handled by `applyGlazingFresnel` + PMREM world capture — covered in the lighting survey.

Diner comparison: `buildSky` horizon `(0.9, 0.915, 0.93)` near-white, `pow(h, 0.55)` single ramp, isotropic `pow(c, 6/40/400)` glow, disc `smoothstep(0.999975, 0.999992, c)·40` = ~0.4° hard pinprick with no flattening, limb or veil, no clouds, no azimuthal warm band. `scaleSky` (Lighting.ts:1216) keeps that structure and only re-scales it into nits.

---

## 5. Atmosphere

- Base: `scene.fog = new THREE.FogExp2(new THREE.Color(0.30, 0.34, 0.44), 0.0027)` (`LightingSystem.ts:559`), but the **fog chunk is replaced** (`lightShaderPatches.ts patchFog()`, installed before any material exists; `LightingSystem` registers first for this reason). `fog_vertex` adds `vFogViewPos = mvPosition.xyz`; `fog_fragment` becomes:
```glsl
vec3 hazeOffset = ( vec4( vFogViewPos, 0.0 ) * viewMatrix ).xyz;   // world offset, no extra uniform
float hazeSun = max( dot( normalize(hazeOffset), normalize(uHazeSunDir) ), 0.0 );
float hazeH   = max( cameraPosition.y + 0.5 * hazeOffset.y, 0.0 );
float hazeAtt = exp( -hazeH / uHazeHeight );                         // 46 m e-fold layer
float hazeFactor = clamp( fogFactor * hazeAtt * uHazeGain, 0.0, 1.0 );
vec3 hazeCol = mix( uHazeCool, uHazeWarm, pow(hazeSun,1.6)*0.86 + hazeSun*0.14 ) + uHazeGlow * pow(hazeSun, 9.0) * 0.9;
gl_FragColor.rgb = mix( gl_FragColor.rgb, hazeCol, hazeFactor );
```
`uHazeCool (0.355, 0.288, 0.306)`, `uHazeWarm (0.84, 0.545, 0.335)`, `uHazeGlow (1.20, 0.62, 0.28)`, `uHazeHeight 46`, `uHazeGain 1`. Uniforms merged into `UniformsLib.fog` **and** every already-merged `ShaderLib` entry.
- **Why the cool side is not blue** (comment block, worth keeping verbatim in spirit): Rayleigh extinction 0.0116/km → τ = 0.008 over 700 m, negligible; visible haze at this range is aerosol (Ångström 0.5–1.3), spectrally near-neutral, forward-scattering; at 6.2° the beam crosses 9.5 air masses so transmittance is 5:1 red over blue; and the published dome horizon has B/R 0.87–0.89 away from the sun. "A blue 700 m haze is the signature of tens of kilometres of clean air, which is why it reads as midday." Cool colour matched to dome horizon chromaticity at held luminance.
- Aerial perspective on distant geometry: horizon bands carry it in vertex colour (fog off); everything else uses the patch. Colour of outdoor shade = PMREM of dome + world (lighting survey).
- No participating media / dust-in-beams anywhere.

---

## 6. Lot dressing (TerrainSystem + services; pumps/canopy excluded)

- Kerbs and islands via `mergeGeometries`; forecourt slabs on `SLAB_TOP` with `jointFiller` material and a `joint-bed` (28,800 tris); painted markings `paint-white`/`paint-yellow` (~5k tris each) with **erosion** from `erodeInject`.
- Ragged asphalt edge (0.4 m excursion, 11 mm sag) with `pavementEdge` published as a *function* so Vegetation straddles weeds exactly on the crumbled line ("no shared constant for two systems to disagree about").
- Puddles at `LOW_SPOTS` (mirror level from sampled `groundHeight`, depth-graded roughness, Fresnel, chewed margin) and `FORECOURT_POOLS`; damp asphalt `wetBase 0.34`.
- Site overlay: wheel paths, cold patches, potholes, sealant cracks, fuel stains, stance scrub, kerb grime, contact grime at every vertical, edge ravelling, joint bleed, wash fans (§1.5).
- Gravel 12,000 + litter (paper etc.) instanced, wind-drifted (§1.7). Bollards ×4 (pump system, 5,136 tris each). Fence with T-posts/staples; utility poles with crossarms/insulators; catenary wire ribbons. `contact`/`contactRect` grime and vegetation contact discs under everything that meets the ground.
- Everything is placed off `groundSurface(x,z)` (rendered chord), never `groundHeight`.

---

## 7. Documented critic feedback → fix (exterior only)

| Critic finding | Root cause found | Fix (file) |
|---|---|---|
| "The plane is so flat it takes no relief lighting" | height terms 30× under the solar tangent in slope | `hum` 16–31 m + berm in `site.ts dirtY` |
| Dead-straight pavement edge | `ragEdge` max 0.37 cyc/m, invisible past 15 m | 4th octave at 0.055 cyc/m (`geo.ts ragOffset`) |
| Asphalt near pools same value as anywhere | wet channel is drainage-keyed; rain lands everywhere | `wetBase 0.34` + 34 m dry-off, albedo+roughness+spec together (`worldDetail.ts`) |
| Pale grey ovals on asphalt | binary-coverage puddles | depth-graded roughness/Fresnel/chewed margin (`wdPool`) |
| Ruts/clod shadow, truck tracks at driveway corners | 2.47 m quads can't hold it | left open; "a separate near-field patch, not a global subdivision" |
| "Bare soil with props scattered on it" | discrete clumps, discrete decals, nothing between | `vegMat.ts` sheet + 7,000 sprigs |
| Far scrub = isolated sparks on clean dirt (14–21 of 40 bearing bins filled past 60 m) | no continuous element past 62 m | road fringe sheet, 190 × 15 m ribbon |
| "Same tuft mesh recognisable four times… scale is not variety" | 3 meshes × 1,600 instances | 7 forms × 4 variants (`vegScrub.ts`) |
| Foliage only on one side of trunk, hard vertical cut | light asymmetry 7:1 | `0.1 + rng()*0.16` |
| Flat quadrilateral patches / straight edges in crowns | `min()` cap bound on 9% of silhouette branches | smooth saturation cap |
| Distant treeline reads as a lake / cold blue strip | display sRGB authored as linear (12.8× too dark), blue-biased "distance", fog double-counted, base haze at elevated camera | linear colours from measured sky, `hazed()`, `fog:false`, small `baseHaze` (`vegHorizonBands.ts`) |
| Crowns with white fringe | crown brighter than sky behind | soft luma cap under sky |
| "The sun is not drawn at all" | disc 13× sky → 253/255 after ACES | disc 100× sky (`uSunDisc 29.6`) |
| Sky = dome of flat cream | uniform warm band | azimuthal `pow(…, 3.5)` weighting |
| Haze reads midday | Rayleigh-blue cool colour over 700 m | neutral-pink cool haze matched to dome |
| Sprigs = white sparklers | `strength 6.8` tuned against needle albedo 0.1, applied at 0.44 | `strength × albedo` held: 1.6 |
| Wires dashed / vanish | 0.5 px geometry | ribbon + coverage alpha (`vegWire.ts`) |
| Uniform green wash (mat cover 50% in 0.2–0.3) | fbm concentrates at 0.5 | remap + contrast, broad × fine (`vegMat.ts`) |
| Objects buried in ground | placed on field, not chord | `surfaceAt` (`geo.ts`) |

Method lessons they keep repeating: every feature has a `?force=`/`?tforce=`/`?vforce=` control and is verified by pixel diff ("a feature that does nothing and a feature that does something subtle are the same screenshot"); colours crossing a system boundary state their colour space; consumers read published functions, not copied constants; measure rendered pixels before theorising a mechanism.

---

## Ranked port list for the diner exterior (gain per hour, evening golden hour bias)

Budget context: dawn-station's whole environment layer (terrain ~70 draws/~700k tris incl. 240k gravel, vegetation 57 draws/~646k tris, 4 horizon draws, 1 sky) sits inside a ~10 ms mean frame at 1080p on a 4060 **with** an 8192 shadow map and ~500 draws total (PERF.md §2). Its 26 s boot is dominated by 2048² procedural maps and the overlay blur — keep the diner at 1024² and a 1024–2048 overlay to stay under 10 s. The diner's western sun at golden hour is ~5–10° elevation, i.e. the same slope regime dawn-station tuned for; hue shifts are noted per item.

1. **Aerial perspective patch** — `src/systems/lightShaderPatches.ts` (`LIGHT_FOG_UNIFORMS`, `patchFog`, `installLightShaderPatches`). Replaces `scene.fog = new THREE.Fog(horizon, 40, 200)` in `Diner.ts:118` with `FogExp2` + the sun-aware chunk. **Paste** (~1 h incl. installing before the first material). GPU: +~10 ALU per fogged fragment, 0 draws, 0 memory. Evening: `uHazeSunDir` = west sun; `uHazeWarm` redder (≈ `(0.84, 0.45, 0.25)`), `uHazeCool` matched to whatever the new dome's anti-solar horizon measures (keep B/R ≤ 0.9 — do not use the diner's current blue-white horizon), `uHazeHeight` 46 m is fine. Also publish `hazeTint.forDirection` for item 4.

2. **Sky dome structure** — `src/systems/lightSky.ts buildSkyDome` fragment. Replaces the body of `Exterior.ts buildSky` and the injected block in `Lighting.ts scaleSky` (keep the nits scaling, port the structure: two-power falloff, sun tangent frame, anisotropic warm band, flattened limb-darkened 100× disc with shoulder, smear + veil, non-harmonic stratus, ground hemisphere). **Adapt** (half day; the diner's `SKY_HORIZON_NITS`/`SKY_ZENITH_RATIO 0.5` become `uHorizon`/`uZenith` ratios — dawn-station's zenith/horizon luminance is ~1/8, the diner's 0.5 is the "washed-out" tell). 0 extra draws; radius must grow from 170 m to ≥ 2000 m for item 4, so camera `far` and the fog density (not distance) must follow. Evening: swap `uWarmBand` toward `(1.0, 0.42, 0.14)`, `uSunAureole` `(1.6, 0.6, 0.2)`, `uSunDisc` keep ≈100× the horizon band, `uHazeGlow` likewise; stratus underlit from the west. Probes/PMREM in the diner already re-capture the sky, so IBL follows for free.

3. **Ground relief at shading wavelength** — `src/site.ts dirtY` (`hum`, `swale`/`berm`, `swell` ramp) + `src/gen/geo.ts gridSurfaceGraded` / `surfaceAt`. Replaces `PlaneGeometry(420, 420)` "desert" in `Exterior.ts:1785`. **Adapt** (half day: one height function, focus box on the lot, ramp swell in past ~70 m, place everything via `surfaceAt`). Cost: ~150–230k tris, 1 draw, `castShadow false`; the diner's lot shadow frustum stops at the CMU wall, so relief beyond the wall is lit by sun only — exactly where `hum` at slopes 0.10–0.20 does its work at a 6–10° western sun (crests lit, hollows 2–3 m of shadow). Add the highway berm along the frontage road for a lit/dark edge across the whole width.

4. **Horizon as measured-sky-hazed bands** — `src/gen/vegHorizonBands.ts` (`hazed`, band spec, assertions) + `buildDistantLandscape` pattern (vertexColors, `fog: false`, luma cap). Replaces `buildHorizon` rings at 118/150/188 m. **Adapt** (2–3 h). Keep the diner's ridged mesa profiles but move them to ~500–1800 m, colour each vertex `mix(rock, hazeTint.forDirection(dir), f)` per band with f ≈ 0.15/0.35/0.7/0.9, cap luma under the sky, turn scene fog off on them. 3–4 draws, <10k tris. Evening: the western band sits against the warm band → per-bearing haze colour (item 1's service) makes the sunward ranges orange-grey and the eastern ones pink-grey with the same code.

5. **Continuous ground mat + road fringe** — `src/gen/vegMat.ts` (`makeMatField`, `buildMatSheet`, `makeRoadFringeRegion`, `matSheetMaterial`) with a stub `SoilQuery` (disturbance = 1 − smoothstep of distance from lot/road/tracks; wetness/drainage/material from low-frequency noise). Adds what nothing in `Exterior.ts` has: a lit, shadow-receiving, tilted-normal thatch layer that makes bushes look planted. **Adapt** (half day). 2 draws, ~35k tris, alpha-blended (renderOrder 1). Skip the 7,000 sprigs initially (+1 instanced draw, 20k tris, needs transmission shader) — add if the near field still reads bare.

6. **Scrub clump forms and feature-anchored placement** — `src/gen/vegScrub.ts` (7 forms, `SHAPES`, base-darkened cards, `bleach`) + the rule list in `VegetationSystem.scatterScrub` (shoulder crack, wall foot, lee-side crescents on poles, `rng()*rng()` sizes, satellites). Replaces the 520 `IcosahedronGeometry` blobs and their ellipse decals. **Adapt** (1 day: 3 card alpha textures, `alphaTest` + `customDepthMaterial`, 7–28 InstancedMesh draws or merge variants per card texture into 3 draws). ~1,600 instances × ~16 cards × 2 tris ≈ 50k tris; cast shadows only inside the lot frustum. Golden hour: back-lit alpha cards with a dark base read as vegetation; solid blobs cannot.

7. **Wire ribbons** — `src/gen/vegWire.ts` (`wireRibbonGeometry`, `wireMaterial`, `minPixels 1.7`, `minAlpha 0.16`, tangent specular). Replaces the 1-px catenary `Line`s in `Exterior.ts:2004`. **Paste** (1 h; feed it the existing catenary points, set `uViewportHeight` on resize, `uSunDir` west). 1 draw, ~2 tris per segment. At a low western sun the anisotropic glint along the conductors is the single cheapest "photograph" cue on the list.

8. **Site overlay for the lot** — `src/gen/siteOverlay.ts` (`makeSiteOverlay`, `ov()`, `drivenPath`, `patch`, `sealantWalk`, `contact`, `ravel`) + the `uOverlay` sampling path in `worldDetail.ts` (or a minimal `onBeforeCompile` that multiplies `diffuseColor` by R, adds G to roughness, tints by B). Adds tyre paths, stains, patches, kerb grime, contact grime to the lot asphalt and wheel stops. **Adapt** (1 day). One 2048×N RGBA (~8–16 MB), 0 draws, ~0.5–1 s boot for the canvas blurs (they cut 3072→2048 for this). Evening: the G (roughness) channel is what shows at grazing western light — driven paths go glossy-dark toward the sun.

9. **Ragged pavement/lot edges** — `src/gen/geo.ts ragEdge` / `ragOffset` (4 octaves incl. 0.055 cyc/m). Apply to the road plane edges and the lot→dirt boundary in `Exterior.ts`. **Paste** (1 h). 0 cost.

10. **Gravel/debris scatter with drift** — `TerrainSystem.scatterDebris` pattern (instanced 20-tri stones, `rng()*rng()` radii, shelter/swept fields, `WIND`). Add ~3–4k stones near the wall foot, wheel stops and kerb (not 12k). **Adapt** (half day, needs a simple shelter field: distance to wall/kerb along wind). 1 draw, ~80k tris, cast shadows inside the lot frustum only — at a 6–10° sun each stone throws several lengths of shadow, which is the point.

11. **Damp asphalt / puddles** — `worldDetail.ts wdPool`, `wetBase`, spec/env ramps. Optional for evening (reads as after-rain); if wanted, **adapt** (1 day, shader injection). 0 draws.

12. **Property fence with catenary + posts as blockers** — `vegProps.ts buildFence`, `catenary`. Low priority behind the CMU wall; **adapt** (2 h), 1–2 draws.

Not worth porting: pines (wrong biome for the diner's flat), the 8192 shadow map (lighting survey), the 2048² asphalt set (boot time), soil-field probe tooling.
