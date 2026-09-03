# Lighting port survey: dawn-station / nightdrive / sedona-sunset / jungle-trail → morning-diner System 4

(Read-only survey by a research agent. Exact values and file paths quoted from the sibling repos. Nothing was edited.)

## 0. Data sheets (exact values)

### Diner baseline — `C:\Code\morning-diner-sys4rev2\src\scene\Lighting.ts`
- Physical units: `K = 1e-4` (1 unit = 10,000 nits) `:68`; camera ISO 100 f/5.6 1/60 `:98`; `L_SAT_NITS = 1.2·2^EV100` `:101`; `EXPOSURE = 1/(L_SAT·K)` `:110`; `GREY_NITS = 0.18·L_SAT` (~407 nits) `:112`.
- Tone map: `CustomToneMapping` = Hable, `CAMERA_WHITE_EV = 4.5` `:141`, i.e. white at `0.18·2^4.5 ≈ 4.07×` grey; `installCameraToneMapping` `:170` patches `tonemapping_pars_fragment`. Hable normalised to a white point reaches exactly 1.0 at W and hard-clips above — this is the mechanism behind "sun patches clip to paper white".
- Shadows: `BasicShadowMap` `:194`; sun is a `SpotLight` at `SPOT_DIST 150` `:222`, map 4096² `:989`, `radius = penumbraPerDepth(...)` `:998` (4.65 mm/m filter radius); `sunLot` 4096² `:1024`. `installPcss` `:515`: nearest-blocker 4×4 search (searchR = 0.2·radius), deterministic 7×7 disc filter on hardware PCF via `sunPcfMap`, receiver-plane bias, penumbra floor `1.75 texels` (6.6 mm) `:618`, **camera-footprint floor up to `12 texels` (45 mm radius)** `:626`.
- Sky: `SKY_HORIZON_NITS 4500`, zenith ratio 0.5 `:276-277`. Fill: `ROOM_PROBE_INTENSITY` (0.13) `:368`, Lambertian 89° bounce SpotLights (diffuse-only via `installBounceDiffuseOnly` `:806`), `installSunSplit` `:774`, `installSpecularAA` `:834`.
- Window glass: `MeshPhysicalMaterial transmission:1, ior 1.52, thickness 0.006, roughness map 0.008–0.045, DoubleSide` — `src/core/materials.ts:560-573`; note at `:551-559` documents that DoubleSide transmissive panes apply `color`+Fresnel twice (measured 0.69 not 0.88), compensated by sqrt of color.

### dawn-station — `C:\Code\dawn-station`
- Renderer `src/core/Game.ts:146-148`: `ACESFilmicToneMapping`, `toneMappingExposure 1.25` (`?expo=`), sRGB out; `shadowMap.type` PCF or `BasicShadowMap` (`?pcss=1`).
- Sun/sky: `DirectionalLight`, elevation 6.2°, `sun = num("sun", 4.4)` `LightingSystem.ts:488`, `shadow.bias -0.00016` `:511`, `normalBias pcss ? 0.012 : 0.055` `:520`, `SHADOW_MAP_SIZE 8192`; frustum fit to a sphere with texel-snapped centre `src/systems/lightShadows.ts:104-129`. Procedural multi-band sky dome `src/systems/lightSky.ts`. `scene.environment` = PMREM of the **actual scene** (`buildWorldEnvironment`, `LightingSystem.ts:908`), `environmentIntensity = num("env", 2.4)` `:427`.
- Fill: `HemisphereLight num("fill", 0.10)` `:552`; interior irradiance probe `ibounce = 0.35` `:181,586,826` (documented as compensatory, not physical 1.0); `RectAreaLight` troffers/coolers/`daylight` + a `SpotLight` twin `daylightSpot` for shadows; door glass toggles `castShadow` when open (`lightInterior.ts`).
- Shader patches `src/systems/lightShaderPatches.ts`: `patchPcf` 16-tap `:99`; `patchPcss` `:334` with `PCSS_SEARCH_TAPS 12, PCSS_TAPS 16, SEARCH/MAX_TEXELS 48.0, MIN_TEXELS 0.6` `:188-209`, Vogel disc, `dFdx/dFdy` receiver-plane gradient `:232-234`. Glazing: `src/gen/buildingGlazing.ts:58-118` `applyGlazingFresnel` — alpha-blended transmission leaf + additive reflection leaf, alpha = `1-(1-F)(1-a0)`, tint rescaled so `tint·a` falls with `(1-F)`; injected at `normal_fragment_maps`.
- Docs: `HANDOVER-lighting.md` (contact-hardening proof, penumbra rig, ambient fix, NaN-in-PMREM root cause).

### nightdrive — `C:\Code\nightdrive\index.html`
- Renderer `:242-244`: ACES, `exposure 1.0` keyframed per time-of-day, `PCFSoftShadowMap`.
- `tameHighlights` `:2601-2619`: `HILITE_KNEE 2.6`; after `opaque_fragment`, `hl = max(rgb); if (hl>k) rgb *= (k + over/(1+over/k))/hl` — hue-preserving soft knee in scene-linear, asymptote 2k. Applied to paint/carbon/chrome/trim/rim/glass. Glass: back face `alpha *= 0.18, rgb *= 2.2` `:2622-2630` (view-dependent tint, not `transmission`).
- Post: `EffectComposer` → `GodRaysPass` `:4916` → `UnrealBloomPass(0.72, 0.62, 0.72)` `:4919` → `OutputPass` → `CompositeShader`.

### sedona-sunset — `C:\Code\sedona-sunset`
- Renderer `src/main.js`: ACES, `EXPOSURE 0.95` (`sky.js:102`), `PCFSoftShadowMap`, `shadowMap.autoUpdate false`.
- Sky/sun: `src/atmos.js` spectral single-scatter solve → direct beam colour/irradiance, sky radiance map, SH9 irradiance; `THREE.LightProbe` from SH9.
- Shadows `sky.js:963-967`: two `DirectionalLight` cascades; `patchShadowChunk` replaces `getShadow` with `getShadowCascade` `:582`; `rpBias` receiver-plane `:608`; `sunSoftShadow` `:719` blocker search + variable-radius PCF; `sunSlope` gradient clamp `:709`.
- Fill: `installProbeHeightLerp` `:1018` — SH lerp by height/aperture, `s4AoTint` `:1146` per-channel occlusion, `s4GroundBand` sunlit-floor bounce keyed on normal and `s4BandHeight`.
- Post `src/post.js` (`POST_DEFAULTS :93-288`): **scene-linear `shadowLift 5.0, knee 0.045`** with local-max mask (radius 48 px, fall 0.22, mask [0.10, 0.30]); encoded-domain `contrast 1.03 @ pivot 0.5`; Hermite toe `toeTop 0.111, toeSlope 1.00`; Hermite shoulder `shoulderTop 0.86, slope 0.45`; bloom `thresh 0.55, knee 0.35, gain 0.013`; ACES copied verbatim `:1150-1180`. Docs: `CONTRACT.md`.

### jungle-trail — `C:\Code\jungle-trail`
- Renderer `src/main.js:86-101`: sRGB out, **`NoToneMapping` in the scene pass**, ACES once in composite at `uExposure 1.48` (`grade.js:1126`), `PCFSoftShadowMap`.
- Sun/sky `src/render/sky.js`: per-pixel single-scatter dome baked to 256 HalfFloat cube → PMREM (`bake()` `:199-237`); `sunLight()` `:243-290`. `scene.environmentIntensity 0.34` `main.js:283`.
- Shadows `main.js:344-372`: tiered 1024–3072², `bias -0.0006`, `normalBias 0.06`. **The canopy is not in the shadow map** — replaced by analytic transmittance `src/render/canopy.js:120-245` `canopyTransmit`: projected tiling mask along the sun vector, `lod = log2(1 + slant·uPenumbra.x)` so penumbra grows with occluder distance, then **contrast re-expanded by a ramp whose edges slide with blur** (`lo/hi = mix(uFleck.xy, uFleck.zw, blur)`). Applied by `patchCanopyLight` `:562-627`: wraps `RE_Direct` (`dl.color *= gCanopyMask`), adds `canopyFill` into `irradiance` before `lights_fragment_end`, analytic `canopyContact` darkening.
- Fill: `HemisphereLight(0x82a081, 0x63513a, 0.55)` `main.js:223`; `canopyFill` height gain. Depth AO `atmosphere.js:378-420`: two radii.
- Post `src/render/grade.js`: bloom pyramid — Karis-weighted prefilter thresholded on **display-referred** brightness `uKnee (0.85, 0.55, exposure/0.6)` `:1109`; `FINAL_FRAG :590-830`: `stock()` — highlight crosstalk `cross (0.13, 1.8)` weighted by exposed luminance `:632-666`, ASC CDL; ACES; `print()` toe `0.014·(1-c)^4` `:684-695`, midtone contrast, split tone; CA, vignette, grain. Docs: `README.md:138-180`.

## 1. What each does well vs the diner's failures
- **dawn-station**: glazing never goes through three's transmission pass (no double Fresnel/colour, no downscaled buffer); interior daylight carried by explicit RectAreaLight + shadow SpotLight twin.
- **nightdrive**: `tameHighlights` hue-preserving knee stopped paint/chrome blowing out and shifting hue.
- **sedona-sunset**: most rigorous treatment of what a tone curve does to shade — scene-linear shadow lift with local-max mask, non-clipping Hermite toe/shoulder, rule "toeTop ≈ 2.5× shaded face level"; models bounce from a sunlit floor as normal- and height-dependent irradiance.
- **jungle-trail**: solved "small bright patches through a perforated occluder losing contrast to the shadow filter" (their sunflecks = our slat stripes) via analytic transmittance + contrast re-expansion; solved "bright patch rolling to flat cream" by exposure choice + toe; per-channel highlight desaturation = antidote to lilac paint.

## 2. Portable ideas, ranked by expected impact

1. **Analytic slat shadow instead of shadow-mapped slats** (stripes filled/blurred; slats brighter than sky; PCSS cost). Source `jungle-trail/src/render/canopy.js:120-245` + `:562-627`. Blinds are a known periodic 1-D structure: per fragment intersect the sun ray with the blind plane, distance `d`, stripe = duty-cycle box convolved with the sun disc (trapezoid width `9.3 mm/m · d`), closed form, `fwidth` AA. Multiply only the interior sun's `directLight.color` by it (as `RE_Direct_Canopy`), remove slats from `sun`'s caster list (use `installShadowMasks`), keep frame/mullions/furniture in the 4096² map. Stripe contrast then depends only on `d`, not the 1.75-/12-texel floors. Caveats: slat tilt/curvature (analytic profile or 1-D LUT), raised blinds/cords fall back to the map, the beam/haze pass needs the same analytic term.
2. **Hue-preserving highlight knee before the curve** (paper-white; lilac). Source `nightdrive/index.html:2601-2619`. Add in `finishFragment` before Hable, knee ≈ `0.18·2^3.5 ≈ 2` (W is 4.07). Plain paste.
3. **Film-stock crosstalk before the curve** (lilac; cream patches). Source `jungle-trail/src/render/grade.js:632-666`: `hw = 1 - exp(-luma·rate·exposure/0.6); c = mix(c, luma, 0.13·hw)`. Start at ~0.06 so red vinyl stays red in mids. Plain paste.
4. **Expose for the patch, rescue shade with scene-linear lift + encoded toe** (ratio too low; clipping). Sources: `jungle-trail main.js:95-99`, `grade.js:684-695`; `sedona-sunset/src/post.js:159-233`. Drop exposure ~1 EV (or raise W to 5.5), let shade fall to −3…−4 EV, use sedona's local-max-masked lift and jungle's toe so shade doesn't hole. Rebalance; re-measure REFERENCE.md values.
5. **Fresnel-coupled alpha glazing, no transmission pass** (exterior through glass 1.5–2.5 EV dark). Source `dawn-station/src/gen/buildingGlazing.ts:58-118` (+ nightdrive `:2622-2630`). Alpha pane shows sky/lot at full HDR × `(1-F)(1-a0)` with one Fresnel, no resolution loss, no transmission pass; add coincident additive reflection leaf. Caveats: lose refraction and haze blur through pane (fake as roughness on reflection leaf); renderOrder with dust/steam/decals. NOTE: main now has `src/scene/GlassResolution.ts` (transmission scale 1 when camera is on lot side) — becomes moot if panes go alpha; remove or keep consistent.
6. **Contrast re-expansion after the shadow filter** (cheap stop-gap if #1 is too much). Source `canopy.js:205-226`. In `installPcss` after `shadow = lit`: when `pen` exceeds the stripe period, `shadow = smoothstep(lo(pen), hi(pen), shadow)` with lo/hi narrowing as `pen/period` grows; gate on `dNear` in the slat range.
7. **Height-/normal-keyed first-bounce irradiance at `lights_fragment_end`** (ceiling a stop too bright). Sources `sedona sky.js:1018-1250` (`s4GroundBand`, `s4BandHeight`, `s4AoTint`), `jungle canopy.js:255-330`. Replace Lambertian bounce spots with rectangle form-factor from the actual patch rectangles (`PATCH_LUX_H/X`, `BOUNCE_FLUX` already computed) — ceiling/wall ratio becomes geometry.
8. **sedona `sunSlope` clamp** (`sky.js:709-717`) — three lines on the diner's rpBias if grazing leaks appear.
9. **Display-referred bloom threshold with Karis weights** (`grade.js:481-518`). Check `src/post/shaders.ts` prefilter: if threshold is in scene units it drifts with exposure changes. Plain paste.
10. dawn texel snapping — not needed (static sun).

**Not portable:** fluorescent troffers. At 8 AM with 45k-lux patches a 10,500 lm troffer adds ~100–300 lux — physically invisible except as its own lens (~6,500 nits, +4 EV over grey → should read near white and bloom). Only honest lever is pictorial (cool-green tint contrast in shade, lens bloom).

## 3. Direct answers
- **Stripes**: 50% square wave period P convolved with disc diameter D keeps full amplitude to D = P, zero at D = 2P. With 9.3 mm/m and P = 25 mm stripes survive to ~2.7 m from the blinds and vanish by ~5 m — far-wall stripes are physically gone; the complaint is nearer surfaces where the camera-footprint floor (`Lighting.ts:626`, up to 45 mm radius / 90 mm diameter ≫ P) dominates, and smooth disc weighting reduces contrast faster than a hard disc. Fix = #1 (analytic) or #6 (re-expansion).
- **Rolloff**: all four siblings use ACES (asymptotic). The diner's Hable with fixed white point is the odd one out and the reason patches hit paper white. Least change first: (a) nightdrive knee in front of Hable; (b) raise `CAMERA_WHITE_EV` to 5.5–6 and re-derive `CAMERA_CURVE_GAIN`; (c) swap to ACES/AgX and re-measure. Lilac: knee + crosstalk stack.
- **Glass balance**: no sibling uses `transmission` for architectural glazing; alpha + Fresnel with additive reflection leaf. Sky at 4,500 nits horizon should read ≈ +3.5 EV over grey — what the critics ask for.
- **Ceiling/wall**: form-factor bounce from actual patch rectangles (#7).

## 4. Plain paste vs rebalance
Paste: nightdrive `tameHighlights`; jungle `stock()` crosstalk; jungle print toe; jungle Karis/display-referred bloom prefilter; sedona Hermite toe/shoulder (set `toeTop` ≈ 2.5× measured shaded-wall value); sedona `sunSlope`; dawn `applyGlazingFresnel`.
Rebalance/new: analytic slat transmittance; PCSS re-expansion tuning; exposure/white-point change (re-measure REFERENCE.md); form-factor bounce.
