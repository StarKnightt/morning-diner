/**
 * System 4 — the light rig, in physical units.
 *
 * Every light, emissive and the sky are expressed in nits / lux times one global
 * scale `K` (1 scene unit = 10,000 nits). The exposure is a camera setting
 * (`EXPOSURE`, ISO / f-number / shutter → EV100 → saturation luminance), applied as
 * `renderer.toneMappingExposure`, so the post pipeline (System 8) can take over the
 * final tone map without re-balancing a single light. Numbers from docs/REFERENCE.md §2;
 * measurements from the sys4 frames are appended there.
 *
 * Sun = two lights with the same direction and colour, split by REGION, not by
 * intensity (System 3 rev 2 — see BUILD.md → Lessons):
 *
 *   `sun`     SpotLight 150 m out along the sun vector, decay 0 (no falloff → its
 *             intensity is irradiance, i.e. lux × K, exactly like a DirectionalLight),
 *             cone just wide enough to hold the whole building. Its perspective shadow
 *             map (4096², ≈ 3.5 mm texels at the room) makes the blind stripes, filtered
 *             with PCSS (`installPcss`) so the penumbra grows 9.3 mm per metre of
 *             slat → receiver distance, as a 0.53° sun does.
 *   `sunLot`  DirectionalLight with a wide orthographic shadow frustum over the lot
 *             (poles, wall, cars, stops, ≈ 8 × 5 mm texels), hard-edged. A caster-only
 *             CONE (invisible to every camera) sits exactly on the spot's cone, so
 *             `sunLot` is shadowed wherever `sun` shines and the two tile the world.
 *
 * Sky: the procedural sky dome (Exterior.ts) is scaled to physical nits through an
 * injected uniform (`scaleSky`) and the reflection probes captured from it are the
 * diffuse + specular environment — the lot probe for everything outdoors, the room
 * probe for the interior (the sky seen through the windows, the lit lenses, the second
 * bounce of everything below). Two probe passes in Diner.build() give a two-bounce
 * approximation. The interior sun's FIRST bounce is not in the dielectrics' probe (it is
 * captured with the interior sun off — a single probe point cannot fall off with distance
 * from a 3 m² patch two metres away); it is the five `bounce` spots below instead.
 *
 * Rev 2 (see BUILD.md → System 4 rev 2). Every fill is derived here, in the comments next
 * to its constant, from glazing area × sky luminance, sun patch area × albedo, or lamp
 * lumens / floor area; anything that could not be derived was removed (rev 1's five
 * 1,200-nit window RectAreas and five 2,000-nit floor RectAreas double-counted the probe,
 * and 16 RectAreaLights cost ~27 ms/frame of LTC evaluation at 1080p). Fills are
 * SpotLights with a Lambertian-shaped cone (angle 89°, penumbra 1 →
 * smoothstep(0, 1, cos θ) ≈ cos θ), decay 2, intensity Φ/π candela × K: a point-source
 * stand-in for a Lambertian panel of flux Φ, exact beyond ~2 panel widths.
 *
 * Fluorescents: one such spot per 2×4 troffer (six fixtures, 4100 K + a green bias,
 * 7,500 lm maintained through a K12 lens, TROFFER_LUMENS) and the lens emissive at the
 * fixture's mean luminance (TROFFER_LENS_NITS, ≈ 4,200) with the four tube images through
 * the prisms as an emissive map (textures.ts trofferLens).
 *
 * three.js cannot mask a LIGHT per object (layers are tested against the render
 * camera, even in the shadow pass), so `installShadowMasks` wraps
 * `renderer.shadowMap.render` to run one light at a time and flips `castShadow`
 * between them — a per-MAP caster list with no wasted depth draws.
 */
import * as THREE from "three";
import { BACK_BAR, BOOTH, CEILING, COUNTER, PASS_THROUGH, ROOM, STOOL, WINDOW, trofferCenter } from "./layout";

/* ------------------------------------------------------------------------- */
/* Units and exposure                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Scene units per nit (and per lux for irradiance). 1e-4 → 1 unit = 10,000 nits.
 * REFERENCE §2 suggested 0.01, but a 0.07-roughness chrome mirror of a 900-unit sun
 * peaks at ~1.8e6 units and overflows a half-float render target (65,504) — the post
 * pipeline's MSAA target is half-float — so the scale is 100× smaller. At 1e-4 the
 * same glint is ~1.8e4, the sky disc 33, and the deepest interior shadow (2 nits)
 * 2e-4, still 3 decades above half-float's subnormal floor.
 */
export const K = 1e-4;
/** nits (or lux) → scene units. */
export const nits = (n: number): number => n * K;

/**
 * Camera: ISO 100, f/5.6, 1/250 s. EV100 = log2(N²/t) − log2(ISO/100) = 12.94.
 *
 * Rev 1 shot at 1/160 (EV 12.29, grey 1,080 nits). Rev 2's HDR probe of the derived rig
 * (BUILD.md System 4 rev 2) put the *shaded* room at 700–1,000 nits — five 1.7 m² windows of
 * 90-klux sun bounce off a checker floor make a bright room, ≈ 3,000–4,500 lux in the shade
 * — so at 1/160 a centre-weighted meter's exposure left the shade within half a stop of
 * grey and the frame read "evenly lit". A photographer holding the sunlit table (12–14 k nits)
 * closes down ⅔ of a stop: at 1/250 grey is 1,690 nits, the shaded walls sit at −0.9 EV
 * (sRGB ≈ 90), the ceiling −0.6, the counter top −1.3, the kitchen −3.5, and everything
 * above L_sat (9,560 nits: the sunlit table, the sky through the slats, the sand) clips.
 * That is the histogram of the Reitz frame (f/5.6 · 1/125 · ISO 200 = EV 11.9 for a room
 * with one window's worth of sun).
 */
export const CAMERA = { iso: 100, fNumber: 5.6, shutter: 1 / 250 } as const;
export const EV100 = Math.log2((CAMERA.fNumber * CAMERA.fNumber) / CAMERA.shutter) - Math.log2(CAMERA.iso / 100);
/** Saturation luminance for that exposure (Lagarde: L_sat = 1.2 · 2^EV) ≈ 9,560 nits. */
export const L_SAT_NITS = 1.2 * Math.pow(2, EV100);
/**
 * `renderer.toneMappingExposure`: scene value 1.0 = L_sat. ≈ 1.05 at K = 1e-4.
 * Middle grey (0.18) then sits at ≈ 1,690 nits. Measured scene-referred values (rev 2 probe,
 * REFERENCE §8): sunlit Formica table 12–14 k nits (+3 EV, clips), sun patch on a wall
 * ≈ 6,300 (+1.9), sky through the slats 7–12 k (+2 … clip), lot asphalt ≈ 3,000 (+0.8),
 * shaded wall ≈ 900 (−0.9), ceiling tile ≈ 1,000 (−0.75), counter top ≈ 650 (−1.3),
 * seat in shade ≈ 170 (−3.3), floor under a table ≈ 80–220 (−4.4 … −2.9).
 */
export const EXPOSURE = 1 / (L_SAT_NITS * K);
/** Scene luminance that lands on middle grey (0.18 of L_sat). */
export const GREY_NITS = 0.18 * L_SAT_NITS;
/**
 * Tone curve (rev 2): a camera-like curve, `CustomToneMapping` filled in by
 * `installCameraToneMapping`. AgX (rev 1) maps 0.18 → 0.18 but does not reach display white
 * until ≈ +6.5 EV over grey, so nothing in the frame clipped: the 12,000-nit sunlit table
 * sat at sRGB 235, the 10,000-nit sky at 220, and the shaded room, at −1 EV, within a
 * stop of grey — a 12-stop HDR render, not a photograph. A sensor saturates at L_sat, which
 * is +2.47 EV over the 0.18 grey by construction (Lagarde's 1.2 · 2^EV); a camera JPEG
 * rolls off into that point. CAMERA_WHITE_EV puts display white there, so `EXPOSURE` and
 * the curve agree on what clips. `?tm=agx|aces|neutral` still select the others for A/B
 * captures, `?ev=±n` shifts the exposure.
 */
export const TONE_MAPPING: THREE.ToneMapping = THREE.CustomToneMapping;
/**
 * Scene value (in stops over middle grey) that reaches display white under the camera
 * curve: the sensor's saturation, log2(1 / 0.18) = 2.47. Rev 2's first round used 3.5
 * ("the JPEG engine keeps a stop of headroom"); with it the 10 k-nit sky sat at sRGB 220
 * and the sand at 226 — nothing in the exterior clipped, which no camera does.
 */
export const CAMERA_WHITE_EV = 2.5;
/**
 * Hable ("Uncharted 2") filmic curve, per channel, normalised so x_white → 1 with
 * x_white = 0.18 · 2^CAMERA_WHITE_EV · CAMERA_CURVE_GAIN. The gain scales the input so
 * middle grey lands at 0.26 display-linear (sRGB 140; a camera JPEG puts a grey card at
 * 118–140) instead of Hable's default 0.149. Display values on this curve, by stops over
 * grey (white at +2.5), from the exact port of this GLSL in the rev 2 harness (camtone.mjs;
 * verified against 14 probe regions to ±1 code): −5 → sRGB 17, −4 → 29, −3 → 44, −2 → 67,
 * −1 → 98, 0 → 140, +1 → 187, +2 → 234, +2.5 → 255. Author by inverting a target code
 * through that table (code 64 ↔ 390 nits, 96 ↔ 810, 128 ↔ 1,410, 192 ↔ 3,600, 240 ↔ 7,400),
 * never by eye against a tone-mapped frame (night-street TECHNIQUE §1–2).
 * Per-channel: a clipped sunlit red goes salmon → white the way film and sensors do
 * (AgX kept it red by design; the photographs the frame is judged against do not).
 */
const CAMERA_CURVE_GAIN = 1.5;

/**
 * Replace three's identity `CustomToneMapping` in the shared tonemapping chunk with the
 * camera curve. Must run before any material or post pass compiles (configureRenderer,
 * i.e. right after the renderer is created — main.ts). The post pipeline's finish pass
 * includes the same chunk (post/shaders.ts) and picks the curve by `uToneMap == 4`.
 */
export function installCameraToneMapping(): void {
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  const stub = "vec3 CustomToneMapping( vec3 color ) { return color; }";
  if (!chunk.includes(stub)) {
    if (chunk.includes("cameraToneMap")) return; // already installed
    console.warn("[lighting] CustomToneMapping stub not found in three's tonemapping chunk; camera curve not installed");
    return;
  }
  const W = 0.18 * Math.pow(2, CAMERA_WHITE_EV) * CAMERA_CURVE_GAIN;
  const glsl = /* glsl */ `
    // Camera-like tone curve (System 4 rev 2, scene/Lighting.ts): Hable filmic, per channel,
    // display white at +${CAMERA_WHITE_EV} EV over middle grey. See CAMERA_CURVE_GAIN there.
    vec3 cameraToneMapHable( vec3 x ) {
      const float A = 0.22, B = 0.30, C = 0.10, D = 0.20, E = 0.01, F = 0.30;
      return ( x * ( A * x + C * B ) + D * E ) / ( x * ( A * x + B ) + D * F ) - E / F;
    }
    vec3 CustomToneMapping( vec3 color ) {
      color *= toneMappingExposure * ${CAMERA_CURVE_GAIN.toFixed(4)};
      vec3 white = cameraToneMapHable( vec3( ${W.toFixed(6)} ) );
      return saturate( cameraToneMapHable( max( color, vec3( 0.0 ) ) ) / white );
    }`;
  THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(stub, glsl);
}
/** PCSS needs raw depths, so the maps are plain depth textures (`installPcss` supplies the filter). */
export const SHADOW_MAP_TYPE: THREE.ShadowMapType = THREE.BasicShadowMap;

/* ------------------------------------------------------------------------- */
/* Sun geometry and colour                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Sun: 8 AM, 35° elevation, 38° off the window normal toward the door end (the
 * coordinator's locked geometry; an ESE window at Flagstaff, REFERENCE §1). Unit
 * vector pointing FROM the scene TOWARD the sun; System 3's sky dome and blind tilt
 * read it from here so the window relationship stays consistent.
 */
export function sunDirection(): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(35);
  const az = THREE.MathUtils.degToRad(38);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

/**
 * Sun angular diameter 0.53° → the full penumbra (lit → dark) grows 9.3 mm per metre of
 * occluder → receiver. The PCSS filter disk is a RADIUS, so it takes half of that.
 */
const SUN_ANGULAR_DIAMETER = THREE.MathUtils.degToRad(0.53);
/** 5,400 K in a D65 pipeline: white-yellow, not golden (REFERENCE §2 "hot morning"). */
const SUN_COLOR = new THREE.Color().setRGB(255 / 255, 235 / 255, 220 / 255, THREE.SRGBColorSpace);
/** Direct normal illuminance, clear dry air at 2,000 m, sun 35° up (REFERENCE §2: 90–95 klux). */
const SUN_LUX = 90_000;
/** Spot apex distance from the building centre. Ray directions across the room vary by ±2.3°. */
const SPOT_DIST = 150;

/**
 * 4100 K cool-white fluorescent in a D65 pipeline ≈ (255, 224, 190), plus the 546 nm
 * mercury line: +6 % G, +4 % B → a tint that reads slightly green-cyan beside the 5,400 K
 * sun (rev 1's +4 % G was invisible next to the warmer lens albedo). Exported for the lens
 * emissive (materials.ts), so lamp and lens share one colour.
 */
export const FLUORESCENT = new THREE.Color().setRGB(255 / 255, Math.min(1, (224 / 255) * 1.06), Math.min(1, (190 / 255) * 1.04), THREE.SRGBColorSpace);
/**
 * Luminaire output of a four-lamp F32T8 2×4: 4 × 2,850 lm initial lamp lumens = 11,400,
 * × 0.68 luminaire efficiency through a K12 lens × 0.88 ballast factor × 0.85 lamp
 * depreciation ≈ 5,800 lm maintained; set at 7,500 (a cleaner, younger install).
 * Six fixtures (layout.ts CEILING.troffers) → 45,000 lm over the 68 m² room = 660 lux if
 * every lumen reached the floor; with a room cavity utilisation of ≈ 0.6 (light walls,
 * dark floor, 2.9 m ceiling) the working plane sits at ≈ 400 lux, the "300–500 lux from
 * the troffers" of the brief. A white surface under that is 0.8 × 400 / π ≈ 100 nits:
 * 3.4 stops under middle grey (GREY_NITS) at this exposure.
 */
export const TROFFER_LUMENS = 7_500;
/** Lens: 1.11 × 0.51 m opening (two 0.6 m cells less the door frame). */
export const TROFFER_LENS_AREA = (CEILING.tile * 2 - 0.09) * (CEILING.tile - 0.09);
/**
 * Mean lens luminance of a Lambertian emitter of TROFFER_LUMENS over TROFFER_LENS_AREA:
 * Φ / (π A) ≈ 4,200 nits (+2.0 EV over grey; the tube images in the emissive map peak at
 * ≈ 1.5× → 6,300 nits, +2.5 EV: "near clip" under the camera curve, not clipped).
 */
export const TROFFER_LENS_NITS = TROFFER_LUMENS / (Math.PI * TROFFER_LENS_AREA);
/**
 * Sky dome: the shader's horizon is authored at display scale (SKY_HORIZON_RGB); the scale
 * puts the horizon band at 10,000 nits (zenith 0.29× → 2,900). `scaleSky` adds the
 * circumsolar brightening on top (×2 at the sun, ×1.4 at 35° from it).
 *
 * The number that matters is the hemisphere's cosine-weighted integral — the diffuse
 * skylight on the lot — not the horizon: it sets the lit/shadow ratio of every outdoor
 * surface, E_sun,h / E_sky = 51.6 klux / E_sky. Integrated numerically over the shader
 * (harness skyE.mjs: gradient, forward-scatter and haze-band mixes, glow, boost):
 *   rev 2 round 9  12,000 horizon · zenith 0.48× · pow(h, 1.6) · boost 1.5  →  39 klux,
 *                  asphalt lit 4,300 / shade 1,700 nits = 2.5:1 (1.3 EV), flat, and the
 *                  sunlit sand at 11,600 nits (36 % of an exterior frame clipped);
 *   this          10,000 horizon · zenith 0.29× · linear gradient · boost 1.0  →  23 klux,
 *                  3.2:1 (1.7 EV); sand ≈ 9,500, at L_sat.
 * A turbid summer morning measures 15–25 klux diffuse with the sun at 35° (CIE types
 * 8–10: horizon 10–12 k cd/m², zenith 3–5 k, circumsolar 20 k+), so the earlier comment's
 * "hemisphere average ≈ 8,000 nits" was wrong by 1.7× — the horizon value held to 30° by
 * pow(h, 1.6) and the ×2.5 boost were most of the excess. The band the windows see (5–25°,
 * away from the sun) is now 8–9 k nits, ≈ 7–7.7 k through the glass: sRGB ≈ 225, a pale
 * blue distinct from the clipped sunlit wall, while the circumsolar quarter still clips.
 */
const SKY_HORIZON_NITS = 10_000;
/**
 * Sky dome colours (display-scale, luminance ≈ 0.85 at the horizon; `scaleSky` sets them on
 * the shader and normalises by the horizon's luminance). Rev 1 kept System 3's near-white
 * horizon (0.90, 0.915, 0.93) and the sky read grey-green through the tinted glass; a
 * clear desert morning at 5–25° elevation — what the windows see — is a pale but
 * unmistakable blue, deepening to the zenith (ratio ≈ 0.29 → ≈ 2,900 nits, a turbid summer
 * zenith). The shader's
 * own forward-scatter and haze-band terms whiten it toward the sun's azimuth and at the
 * horizon line, so the circumsolar quarter still goes white (with `scaleSky`'s ×2.5 boost).
 */
const SKY_HORIZON_RGB = new THREE.Color(0.78, 0.86, 0.97);
const SKY_ZENITH_RGB = new THREE.Color(0.15, 0.25, 0.48);
export const luminance = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const SKY_SCALE = nits(SKY_HORIZON_NITS) / luminance(SKY_HORIZON_RGB);
/**
 * Sun inside the room, on the horizontal, averaged over the slat duty cycle: 90 klux ×
 * 0.88 glass × sin 35° × 0.5 (half-open 1" slats pass ~50 % of the beam) ≈ 22,700 lux on
 * a sunlit patch; on a vertical face toward +x (the bench fronts; the sun vector's x is
 * sin 38° · cos 35° = 0.504) 90 klux × 0.88 × 0.504 × 0.5 ≈ 20,000 lux.
 */
const PATCH_LUX_H = SUN_LUX * 0.88 * Math.sin(THREE.MathUtils.degToRad(35)) * 0.5;
const PATCH_LUX_X = SUN_LUX * 0.88 * 0.504 * 0.5;
/**
 * First bounce of one window's beam, per booth. The beam lands on (ray-traced from the
 * window rectangle along the sun vector, see BUILD.md rev 2):
 *   · the aisle floor past the booth back — 1.35 m wide × ≈ 1.3 m deep ≈ 1.75 m² of checker
 *     (albedo 0.47/0.45/0.42, warm grey);
 *   · the sun side of the table top — ≈ 0.3 m² of cream laminate (0.90/0.85/0.75);
 *   · the −x bench's seat and back front, both facing the sun — ≈ 0.8 m² of red vinyl,
 *     linear albedo (0.40/0.010/0.007) from #AA1A15.
 * Reflected flux per channel = Σ E × A × ρ:
 *   floor 22.7k × 1.75 × (0.47, 0.45, 0.42) = (18.7k, 17.9k, 16.7k)
 *   table 22.7k × 0.30 × (0.90, 0.85, 0.75) = ( 6.1k,  5.8k,  5.1k)
 *   vinyl 20.0k × 0.80 × (0.40, 0.01, 0.007)= ( 6.4k,  0.16k, 0.11k)
 *   total ≈ (31k, 24k, 22k) lm-equivalent; the red vinyl is 20 % of the red channel,
 * which is the colour bleed (a warm pink, not the sun's white-yellow) that reaches the
 * ceiling, the table underside and the wall behind the far bench. One upward Lambertian
 * spot per booth, Φ/π cd, at the flux-weighted centroid of those three surfaces.
 */
const BOUNCE_FLUX = new THREE.Vector3(
  PATCH_LUX_H * 1.75 * 0.47 + PATCH_LUX_H * 0.3 * 0.9 + PATCH_LUX_X * 0.8 * 0.4,
  PATCH_LUX_H * 1.75 * 0.45 + PATCH_LUX_H * 0.3 * 0.85 + PATCH_LUX_X * 0.8 * 0.01,
  PATCH_LUX_H * 1.75 * 0.42 + PATCH_LUX_H * 0.3 * 0.75 + PATCH_LUX_X * 0.8 * 0.007,
);
/** Spot cone that approximates a Lambertian emitter: smoothstep(cos 89°, 1, cos θ) ≈ cos θ. */
const LAMBERT_ANGLE = THREE.MathUtils.degToRad(89);
/**
 * `scene.environmentIntensity` for the room probe (Diner.ts). A single cube captured at one
 * point is a far-field approximation of a near-field room: every surface is lit as if it
 * were surrounded by what the probe saw, and what the probe saw from the counter edge is a
 * ceiling and a floor 1.3 m away already lit by the bounce spots — so the probe hands the
 * second bounce back at roughly the average radiance of the room's brightest faces rather
 * than the room's mean. Measured (rev 2, `?nofill` / `?nobounce` A/B on the HDR probe): the
 * probe adds ≈ 1,400 lux-equivalent of spot-lit second bounce on the shaded walls where the
 * flux balance (Φ₁ · ρ / (A · (1 − ρ)) ≈ 125 klm · 0.5 / (220 m² · 0.5) ≈ 570 lux) allows
 * ≈ 600. 0.7 halves that excess while keeping most of the probe's other job — the sky
 * through the five windows, which sits 3.5 m from the probe and is not inflated the same
 * way — intact. dawn-station ships the same correction on its interior PMREM at 0.35
 * (`lightInterior.ts`, `ibounce`), for a room with no sun in it. `?ibounce=n` overrides.
 */
export const ROOM_PROBE_INTENSITY = (() => {
  if (typeof location === "undefined") return 0.7;
  const v = Number(new URLSearchParams(location.search).get("ibounce"));
  return Number.isFinite(v) && v > 0 ? v : 0.7;
})();

export interface LightingResult {
  sun: THREE.SpotLight;
  /**
   * A copy of `sun` that is NOT in the scene graph: same position, target, colour,
   * intensity and shadow camera, but its (pre-allocated) shadow map is a compare-mode
   * depth texture (`sampler2DShadow`), rendered right after `sun`'s by the shadow-mask
   * wrapper. `sun`'s own map is a raw depth texture for the PCSS filter, which the post
   * pipeline's haze/dust march cannot sample; it takes this light instead (`Diner.sunBeam`).
   * Being outside the scene it costs no shader lookups and no light-list slot.
   */
  sunBeam: THREE.SpotLight;
  sunLot: THREE.DirectionalLight;
  /** Caster-only cone on the spot's cone; masks `sunLot` out of the building. */
  cone: THREE.Mesh;
  /** One Lambertian spot per 2×4 fixture (`?nofluor` → none). */
  troffers: THREE.SpotLight[];
  /** One upward Lambertian spot per booth: the first bounce of that window's sun (`?nobounce` → none). */
  bounces: THREE.SpotLight[];
  /** Horizon colour in scene units, for the fog and the background. */
  horizon: THREE.Color;
}

/* ------------------------------------------------------------------------- */
/* Renderer                                                                   */
/* ------------------------------------------------------------------------- */

/** Tone mapping, exposure and shadow filtering. main.ts owns the renderer; this keeps the numbers in one place. */
export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  installCameraToneMapping();
  renderer.toneMapping = TONE_MAPPING;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = SHADOW_MAP_TYPE;
  primeShadowMapType(renderer);
  installPcss();
  // The window and door panes are transmissive, so three renders the whole opaque scene a
  // second time into the transmission buffer every frame — 140 of the 294 draws at `length`,
  // every one of them paying for the PCSS, and all of it for the exterior seen through six
  // panes. Measured (rev 2, GPU timer at `length`): 3.4 ms of an 11.4 ms scene pass at full
  // resolution; 0.5 (a 960×540 buffer) gives the same frame for 8.0 ms. What is behind the
  // glass is the sunlit lot — mostly clipped — and a hot-morning exterior through 6 mm float
  // is never pixel-sharp anyway (System 8's shimmer works the same region). `?txscale=n`.
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
  const tx = Number(q?.get("txscale"));
  const txScale = Number.isFinite(tx) && tx > 0 ? tx : 0.5;
  renderer.transmissionResolutionScale = txScale;
  installTransmissionLod(1 / txScale);
}

/**
 * three's transmission blur is `lod = log2(bufferWidth) · roughness'`, a mip level of the
 * transmission buffer — so it is a blur in BUFFER texels, and a half-size buffer blurs the
 * view through the glass twice as wide on screen as the full-size one did (measured: the
 * block wall and the scrub through the door pane went from readable to mush at 0.5). This
 * rewrites the level so the on-screen blur is the one the full-resolution formula gives:
 * lod = log2(bufferWidth · k) · roughness' − log2(k), k = 1 / transmissionResolutionScale.
 * Roughness 0 still costs the buffer's own 1-texel (2 px) bicubic softness; the smudge map's
 * 0.05–0.15 roughness is 3–8 px of blur either way, so that floor is invisible.
 */
function installTransmissionLod(k: number): void {
  const chunk = THREE.ShaderChunk.transmission_pars_fragment;
  const line = "float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );";
  if (!chunk.includes(line)) {
    console.warn("[lighting] transmission_pars_fragment layout changed; LOD compensation not installed");
    return;
  }
  const kk = k.toFixed(4);
  THREE.ShaderChunk.transmission_pars_fragment = chunk.replace(
    line,
    `float lod = max( 0.0, log2( transmissionSamplerSize.x * ${kk} ) * applyIorToRoughness( roughness, ior ) - log2( ${kk} ) );`,
  );
}

/**
 * WebGLShadowMap remembers the type it was constructed with (PCF) and, on the first pass
 * where the type differs, flags EVERY material in the scene for recompilation and
 * re-allocates every shadow map. Setting the type after construction would therefore
 * throw away the loader's parallel compile on the first frame and replace the
 * pre-allocated beam map (`buildSunBeam`). One 2×2 pass over an empty scene right here,
 * before any material exists, moves the remembered type to ours.
 */
function primeShadowMapType(renderer: THREE.WebGLRenderer): void {
  const light = new THREE.DirectionalLight();
  light.castShadow = true;
  light.shadow.mapSize.set(2, 2);
  const scene = new THREE.Scene();
  scene.add(light, light.target);
  scene.updateMatrixWorld(true);
  renderer.shadowMap.render([light], scene, new THREE.PerspectiveCamera());
  light.shadow.map?.dispose();
  light.shadow.map = null;
  light.dispose();
}

/* ------------------------------------------------------------------------- */
/* PCSS                                                                       */
/* ------------------------------------------------------------------------- */

let pcssInstalled = false;

/**
 * Percentage-closer soft shadows for the BasicShadowMap path (raw depth textures).
 * `shadow.radius` is re-purposed per light:
 *   radius > 0 → PCSS. Penumbra (in shadow-map UV) = radius × (receiverDepth − blockerDepth)
 *                in the map's [0,1] depth space; blocker search radius = 0.2 × radius.
 *                `penumbraPerDepth()` computes the constant from the light's frustum and
 *                the sun's 0.53° diameter.
 *   radius ≤ 0 → fixed-kernel PCF of |radius| texels (the lot sun: its penumbrae would be
 *                a few px through the blinds, and a blur on the cone occluder's edge would
 *                have opened a half-lit ring at the two-sun seam).
 *
 * Rev 2: 8 blocker taps + 12 filter taps (rev 1: 16 + 24) on a Vogel spiral rotated per
 * pixel by interleaved-gradient noise keyed to the shadow-map UV (world-stationary; see the
 * note at `phi`); the lot light takes one bilinear tap.
 * Every FILTER tap is a bilinear comparison (`pcssTap`: the four texels around the tap,
 * each compared, then bilinearly weighted — what a `sampler2DShadow` does in hardware, which
 * a raw depth texture cannot). It costs 4 coherent fetches per tap but turns the 13-level
 * staircase of 12 hard taps into a continuous ramp, which is what removes the speckle in
 * the penumbrae (rev 1's 24 single-fetch taps still dithered visibly). `?pcss=fast` compiles
 * single-fetch taps for the A/B timing. Non-reversed depth.
 */
export function installPcss(): void {
  if (pcssInstalled) return;
  pcssInstalled = true;
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
  const fast = q?.get("pcss") === "fast";
  // Tap budget. `?taps=b,f` for the A/B (rev 2 measured 8/16 → 8/12 at −0.5 ms on `length`).
  const taps = (q?.get("taps") ?? "").split(",").map(Number);
  const BLOCKER_TAPS = Number.isInteger(taps[0]) && taps[0] >= 4 ? taps[0] : 8;
  const FILTER_TAPS = Number.isInteger(taps[1]) && taps[1] >= 4 ? taps[1] : 12;
  // The built three.module.js strips the chunk's comments, so the BASIC branch is located
  // structurally: the `#else` after the VSM `#elif`, up to the `#endif` before the point-light block.
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const sig = "float getShadow( sampler2D shadowMap";
  const vsm = chunk.indexOf("#elif defined( SHADOWMAP_TYPE_VSM )");
  const vsmFn = vsm < 0 ? -1 : chunk.indexOf(sig, vsm); // the VSM getShadow
  const basicFn = vsmFn < 0 ? -1 : chunk.indexOf(sig, vsmFn + sig.length); // the BASIC getShadow
  const start = basicFn < 0 ? -1 : chunk.lastIndexOf("#else", basicFn);
  const pointStart = start < 0 ? -1 : chunk.indexOf("#if NUM_POINT_LIGHT_SHADOWS > 0", start);
  const end = pointStart < 0 ? -1 : chunk.lastIndexOf("#endif", pointStart);
  if (start < 0 || pointStart < 0 || end < 0 || start <= vsmFn) {
    console.warn("[lighting] shadowmap_pars_fragment layout changed; PCSS not installed");
    return;
  }
  const pcss = /* glsl */ `#else // SHADOWMAP_TYPE_BASIC — replaced by PCSS (src/scene/Lighting.ts)
		${fast ? "#define PCSS_FAST 1" : ""}

		#define PCSS_BLOCKER_TAPS ${BLOCKER_TAPS}
		#define PCSS_FILTER_TAPS ${FILTER_TAPS}

		// Vogel spiral: n points of equal area on the unit disk (golden angle), rotated by phi.
		// Any tap count is a well-distributed disk, so the budget is a constant, not a table.
		vec2 pcssVogel( int i, int n, float phi ) {
			float r = sqrt( ( float( i ) + 0.5 ) / float( n ) );
			float theta = float( i ) * 2.39996323 + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}

		// Interleaved gradient noise (Jimenez 2014): a per-pixel rotation with no visible structure.
		float pcssNoise( vec2 p ) {
			return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
		}

		// One filter tap: bilinearly weighted comparison of the 2×2 texels around uv.
		float pcssTap( sampler2D map, vec2 uv, vec2 texel, float zR ) {
			#ifdef PCSS_FAST
				return step( zR, texture2D( map, uv ).r );
			#else
				vec2 p = uv / texel - 0.5;
				vec2 f = fract( p );
				vec2 base = ( floor( p ) + 0.5 ) * texel;
				float d00 = step( zR, texture2D( map, base ).r );
				float d10 = step( zR, texture2D( map, base + vec2( texel.x, 0.0 ) ).r );
				float d01 = step( zR, texture2D( map, base + vec2( 0.0, texel.y ) ).r );
				float d11 = step( zR, texture2D( map, base + texel ).r );
				return mix( mix( d00, d10, f.x ), mix( d01, d11, f.x ), f.y );
			#endif
		}

		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {

			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			float zR = shadowCoord.z + shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;

			if ( inFrustum && zR <= 1.0 ) {

				vec2 texel = vec2( 1.0 ) / shadowMapSize;
				// Tap-pattern phase from the shadow-map UV (world space perpendicular to the light,
				// 1/8 texel = 0.4 mm for the sun), not gl_FragCoord: a point on a surface keeps its
				// phase as the camera walks, so the Monte-Carlo residual rides with the surface
				// instead of being redrawn every frame (night-street softShadow.ts, 'world' phase).
				float phi = pcssNoise( shadowCoord.xy * shadowMapSize * 8.0 ) * PI2;

				if ( shadowRadius > 0.0 ) {

					// 1. Blocker search: average depth of everything in front of the receiver.
					float searchR = shadowRadius * 0.2;
					float sum = 0.0, n = 0.0;
					for ( int i = 0; i < PCSS_BLOCKER_TAPS; i ++ ) {
						float d = texture2D( shadowMap, shadowCoord.xy + pcssVogel( i, PCSS_BLOCKER_TAPS, phi ) * searchR ).r;
						if ( d < zR ) { sum += d; n += 1.0; }
					}
					if ( n > 0.5 ) {
						// 2. Penumbra ∝ receiver−blocker separation, clamped to the search disk.
						float pen = clamp( shadowRadius * ( zR - sum / n ), texel.x * 0.75, searchR );
						// 3. PCF over the penumbra, bilinear taps (a second phase so the filter's
						//    residual is not correlated with the search's).
						float lit = 0.0;
						for ( int i = 0; i < PCSS_FILTER_TAPS; i ++ ) {
							lit += pcssTap( shadowMap, shadowCoord.xy + pcssVogel( i, PCSS_FILTER_TAPS, phi + 1.0 ) * pen, texel, zR );
						}
						shadow = lit / float( PCSS_FILTER_TAPS );
					}

				} else if ( shadowRadius > -0.5 ) {

					// One bilinear tap: a 1-texel ramp, what hardware PCF gives (the lot sun).
					shadow = pcssTap( shadowMap, shadowCoord.xy, texel, zR );

				} else {

					// Fixed kernel: four bilinear taps on a rotated square of half-side |radius| texels.
					float r = max( 0.5, -shadowRadius ) * texel.x * 0.7071;
					float cs = cos( phi ), sn = sin( phi );
					mat2 rot = mat2( cs, sn, -sn, cs );
					vec2 a = rot * vec2( r, r ), b = rot * vec2( r, -r );
					float lit = pcssTap( shadowMap, shadowCoord.xy + a, texel, zR )
						+ pcssTap( shadowMap, shadowCoord.xy - a, texel, zR )
						+ pcssTap( shadowMap, shadowCoord.xy + b, texel, zR )
						+ pcssTap( shadowMap, shadowCoord.xy - b, texel, zR );
					shadow = lit * 0.25;

				}

			}

			return mix( 1.0, shadow, shadowIntensity );

		}

	`;
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.slice(0, start) + pcss + chunk.slice(end);
}

/**
 * The post pipeline's twin of `sun` (see `LightingResult.sunBeam`). Detached from the
 * scene; its map is allocated here exactly as WebGLShadowMap would for PCFShadowMap
 * (compare-mode depth, linear filter → hardware 4-tap PCF) so `render` reuses it instead
 * of allocating a raw-depth (BasicShadowMap) one.
 */
function buildSunBeam(sun: THREE.SpotLight): THREE.SpotLight {
  const beam = new THREE.SpotLight(sun.color, sun.intensity, sun.distance, sun.angle, sun.penumbra, sun.decay);
  beam.name = "sun-beam";
  beam.position.copy(sun.position);
  beam.target.position.copy(sun.target.position);
  beam.castShadow = true;
  beam.shadow.mapSize.copy(sun.shadow.mapSize);
  beam.shadow.camera.near = sun.shadow.camera.near;
  beam.shadow.camera.far = sun.shadow.camera.far;
  beam.shadow.camera.fov = sun.shadow.camera.fov;
  beam.shadow.camera.updateProjectionMatrix();
  beam.shadow.bias = sun.shadow.bias;
  beam.shadow.normalBias = sun.shadow.normalBias;
  beam.updateMatrixWorld(true);
  beam.target.updateMatrixWorld(true);
  const size = beam.shadow.mapSize;
  const depth = new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType);
  depth.name = beam.name + ".shadowMap";
  depth.format = THREE.DepthFormat;
  depth.compareFunction = THREE.LessEqualCompare;
  depth.minFilter = THREE.LinearFilter;
  depth.magFilter = THREE.LinearFilter;
  const map = new THREE.WebGLRenderTarget(size.x, size.y);
  map.depthTexture = depth;
  beam.shadow.map = map;
  return beam;
}

/**
 * PCSS constant for a perspective shadow camera: penumbra UV per unit of [0,1] depth
 * difference, for an occluder of angular diameter `theta` at the receiver distance `d`.
 * pen_world = Δd · θ; UV/m = 1 / (2 d tan(half)); Δz01 = Δd · f n / ((f − n) d²).
 */
function penumbraPerDepth(cam: THREE.PerspectiveCamera, d: number, theta: number): number {
  const n = cam.near, f = cam.far;
  const half = THREE.MathUtils.degToRad(cam.fov / 2);
  const uvPerMetre = 1 / (2 * d * Math.tan(half));
  const z01PerMetre = (f * n) / ((f - n) * d * d);
  return (theta * uvPerMetre) / z01PerMetre;
}

/* ------------------------------------------------------------------------- */
/* Shadow masks (per-light caster lists)                                      */
/* ------------------------------------------------------------------------- */

/**
 * Per-light caster lists. `renderer.shadowMap.render` is wrapped to render one light's
 * map at a time; between maps the interior meshes and the cone occluder swap
 * `castShadow`. Everything flagged `userData.lotCaster` (Exterior.ts) casts into both.
 *
 * Shadow-once (Diner.ts sets `shadowMap.autoUpdate = false` and raises `needsUpdate`
 * through `Diner.invalidateShadows()`): WebGLShadowMap.render returns early when
 * neither flag is set and clears `needsUpdate` at the end of a pass, so with the
 * per-light split the flag has to be re-raised before every light's pass or only the
 * first map in the list would ever be rendered. The wrapper mirrors the early return
 * and the final clear itself.
 */
export function installShadowMasks(renderer: THREE.WebGLRenderer, root: THREE.Object3D, lights: LightingResult): void {
  const interior: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.castShadow && !o.userData.lotCaster) interior.push(o);
  });
  const shadowMap = renderer.shadowMap as THREE.WebGLShadowMap & { render: (l: THREE.Light[], s: THREE.Scene, c: THREE.Camera) => void };
  const original = shadowMap.render.bind(shadowMap);
  shadowMap.render = (list: THREE.Light[], scene: THREE.Scene, camera: THREE.Camera) => {
    if (!shadowMap.enabled) return;
    if (!shadowMap.autoUpdate && !shadowMap.needsUpdate) return;
    for (const light of list) {
      const lot = light === lights.sunLot;
      for (const o of interior) o.castShadow = !lot;
      lights.cone.castShadow = lot;
      shadowMap.needsUpdate = true;
      original([light], scene, camera);
      if (light === lights.sun) {
        // Same casters, same camera: the compare-mode copy for the post pipeline.
        shadowMap.needsUpdate = true;
        original([lights.sunBeam], scene, camera);
      }
    }
    for (const o of interior) o.castShadow = true;
    shadowMap.needsUpdate = false;
  };
}

/* ------------------------------------------------------------------------- */
/* The rig                                                                    */
/* ------------------------------------------------------------------------- */

export function buildLighting(scene: THREE.Scene): LightingResult {
  const dir = sunDirection();
  const T = ROOM.wallThickness;
  // Building box incl. walls and the apron slab; the spot cone must contain all of it.
  const bx0 = -ROOM.halfX - T - 0.3, bx1 = ROOM.halfX + T + 0.3;
  const by0 = -0.2, by1 = ROOM.height + 0.25;
  const bz0 = ROOM.zBack - T - 0.3, bz1 = ROOM.zFront + T + 0.3;
  const centre = new THREE.Vector3((bx0 + bx1) / 2, (by0 + by1) / 2, (bz0 + bz1) / 2);
  let radius = 0;
  const tmp = new THREE.Vector3();
  for (const x of [bx0, bx1]) for (const y of [by0, by1]) for (const z of [bz0, bz1]) {
    tmp.set(x, y, z).sub(centre);
    const along = tmp.dot(dir);
    radius = Math.max(radius, Math.sqrt(Math.max(0, tmp.lengthSq() - along * along)));
  }
  radius += 0.25;
  const halfAngle = Math.atan(radius / SPOT_DIST);

  // The window glass is not in the shadow path (it does not cast), so the 88 % float-glass
  // transmission is not applied to the interior beam: 90 klux inside instead of 78 — 0.2 EV,
  // accepted so the spot and the lot light can share one intensity and the seam stays invisible.
  const sunIntensity = nits(SUN_LUX);

  /* ---------------- interior sun: distant narrow spot ---------------- */
  const sun = new THREE.SpotLight(SUN_COLOR, sunIntensity, 0, halfAngle, 0, 0);
  sun.name = "sun";
  sun.position.copy(centre).addScaledVector(dir, SPOT_DIST);
  sun.target.position.copy(centre);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  // Depth range just around the building + cone footprint: 2 × 3.5 mm texels on the floor.
  sun.shadow.camera.near = SPOT_DIST - 20;
  sun.shadow.camera.far = SPOT_DIST + 22;
  sun.shadow.camera.fov = THREE.MathUtils.radToDeg(halfAngle) * 2;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.012; // ≈ 3.5 mm texels: 12 mm keeps sunlit planes acne-free under the blocker search
  // PCSS: 0.53° sun → 9.3 mm/m full penumbra = 4.65 mm/m filter radius (≈ 0.0127 UV per unit depth here).
  sun.shadow.radius = penumbraPerDepth(sun.shadow.camera, SPOT_DIST, SUN_ANGULAR_DIAMETER / 2);
  scene.add(sun, sun.target);
  const sunBeam = buildSunBeam(sun);

  /* ---------------- exterior sun: wide directional over the lot ---------------- */
  const sunLot = new THREE.DirectionalLight(SUN_COLOR, sunIntensity);
  sunLot.name = "sun-lot";
  // Apex of the spot cone must lie inside this frustum (rays have to cross the cone's
  // lateral surface before they reach a receiver), so the light sits beyond the apex.
  const lotDist = SPOT_DIST + 15;
  sunLot.position.copy(centre).addScaledVector(dir, lotDist);
  sunLot.target.position.copy(centre);
  sunLot.castShadow = true;
  // Rev 2: 2048² (was 4096²) — ≈ 22 × 11 mm texels over the lot box below; the casters
  // out there are cars, poles, wheel stops and a wall, whose shadows are metres long.
  // Halves the depth pass's fill and the map's memory (4.7 ms → measure).
  sunLot.shadow.mapSize.set(2048, 2048);
  {
    // Fit the ortho frustum to the lot box (kerb → CMU wall, pole tops) plus the building.
    const cam = sunLot.shadow.camera;
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, dir).normalize(); // camera +x in world
    const camUp = new THREE.Vector3().crossVectors(dir, right).normalize(); // camera +y
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    const pts: THREE.Vector3[] = [];
    for (const x of [-17, 17]) for (const y of [-0.5, 8.8]) for (const z of [ROOM.zFront, ROOM.zFront + 21]) pts.push(new THREE.Vector3(x, y, z));
    for (const x of [bx0, bx1]) for (const y of [by0, by1]) for (const z of [bz0, bz1]) pts.push(new THREE.Vector3(x, y, z));
    for (const p of pts) {
      tmp.copy(p).sub(centre);
      const u = tmp.dot(right), v = tmp.dot(camUp);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    // Matrix4.lookAt(eye, target, up): camera +x = up × (eye − target) = `right` above.
    cam.left = u0 - 0.5;
    cam.right = u1 + 0.5;
    cam.bottom = v0 - 0.5;
    cam.top = v1 + 0.5;
    cam.near = 1;
    cam.far = lotDist + 20;
    cam.updateProjectionMatrix();
  }
  sunLot.shadow.bias = -0.0001;
  sunLot.shadow.normalBias = 0.05; // ≈ 2 texels of the 2048² map (22 mm): acne-free on the asphalt at 35° incidence
  // One bilinear tap (installPcss, radius in (−0.5, 0]): a 1-texel (11 mm) ramp. The sun's
  // real penumbra on the lot is 9.3 mm per metre of caster height — one texel for a car's
  // sill, two for its roof — so the 4-tap kernel was softer than the sun and cost 0.8 ms.
  sunLot.shadow.radius = -0.25;
  scene.add(sunLot, sunLot.target);

  /* ---------------- cone occluder: masks `sunLot` out of the spot's cone ---------------- */
  let cone3: THREE.Mesh;
  {
    const L = SPOT_DIST + 40; // apex → base, well past the ground under the far side of the room
    const cone = new THREE.ConeGeometry(Math.tan(halfAngle) * L, L, 96, 1, true);
    cone.translate(0, -L / 2, 0); // apex at the origin, axis down −y
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); // −y → −dir
    // Invisible to every colour pass (nothing written) but a real caster for `sunLot`.
    const mesh = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: false, depthTest: false }));
    mesh.material.shadowSide = THREE.DoubleSide;
    mesh.quaternion.copy(q);
    mesh.position.copy(sun.position);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = -20;
    mesh.name = "sun-cone-occluder";
    scene.add(mesh);
    cone3 = mesh;
  }

  /* ---------------- sky dome → physical nits ---------------- */
  const horizon = SKY_HORIZON_RGB.clone().multiplyScalar(SKY_SCALE);
  const sky = scene.getObjectByName("sky") as THREE.Mesh | undefined;
  if (sky) scaleSky(sky, SKY_SCALE);

  // Diagnostics for the capture harness: `?nofill` renders the suns alone, `?nospot` /
  // `?nolot` switch one of the two suns off so the cone seam and each map can be checked;
  // `?nofluor` switches the troffers off (their contribution alone).
  const q = new URLSearchParams(location.search);
  if (q.has("nospot")) sun.intensity = 0;
  if (q.has("nolot")) sunLot.intensity = 0;
  if (q.has("nofill")) return { sun, sunBeam, sunLot, cone: cone3, troffers: [], bounces: [], horizon };

  /**
   * A Lambertian panel of flux Φ as a point: SpotLight, angle 89°, penumbra 1 (the
   * smoothstep cone ≈ cos θ), decay 2, intensity Φ/π cd → E = (Φ/π) cos θ cos θ_r / d²,
   * which is the far-field irradiance of the panel. No shadow map: these are fills.
   */
  const lambertSpot = (color: THREE.Color, lumens: number, name: string) => {
    const l = new THREE.SpotLight(color, nits(lumens / Math.PI), 0, LAMBERT_ANGLE, 1, 2);
    l.castShadow = false;
    l.name = name;
    return l;
  };

  /* ---------------- fluorescent troffers ---------------- */
  // One spot per fixture, 12 mm under the lens plane, aimed straight down. Under a
  // fixture at 2 m (the counter top): (7,500/π) / 4 ≈ 600 lux — the pools; the aisle
  // floor between two fixtures (≈ 1.5 m off-axis, 2.9 m down, cos θ ≈ 0.89): ≈ 130 lux
  // from each. The lens itself is emissive (materials.ts fixtureLens, TROFFER_LENS_NITS)
  // and reaches the probe, so its reflection is in the counter laminate.
  const troffers: THREE.SpotLight[] = [];
  if (!q.has("nofluor")) {
    for (const cell of CEILING.troffers) {
      const [x, z] = trofferCenter(cell);
      const l = lambertSpot(FLUORESCENT, TROFFER_LUMENS, "troffer");
      l.position.set(x, ROOM.height - CEILING.teeDepth - 0.012, z);
      l.target.position.set(x, 0, z);
      scene.add(l, l.target);
      troffers.push(l);
    }
  }

  /* ---------------- first bounce of each window's beam (per booth) ---------------- */
  // BOUNCE_FLUX (derivation at the constant): ≈ 25,000 lm-equivalent per booth, colour
  // (1.0, 0.77, 0.70) — the checker floor's warm grey pulled toward red by the sunlit
  // bench. Placed at the flux-weighted centroid of the lit floor patch (aisle, z ≈ 1.0,
  // shifted −x by the sun's plan angle), the table and the −x bench: about 1.2 m into the
  // room from the booth's centre, low, so it lights the table underside and the bench
  // undersides from below, the ceiling above the booths (≈ 950 lux directly above at
  // 2.6 m → a 240-nit tile, −2.2 EV, fading to ≈ 60 lux at the back wall — the ceiling
  // gradient the critics asked for) and the divider/wall faces next to the lit vinyl.
  // The dielectrics' probe is captured with the interior sun off (Diner.ts), so these
  // are the only sun bounce they see; metals use the sun-on probe and get it from there.
  const bounces: THREE.SpotLight[] = [];
  if (!q.has("nobounce")) {
    const planShift = Math.tan(THREE.MathUtils.degToRad(38));
    const zFloor = (COUNTER.topFrontZ + 0.15 + BOOTH.zInner - 0.4) / 2; // aisle patch centre, ≈ 0.95
    const zBooth = BOOTH.zInner + 0.5; // table / bench sun zone
    const wFloor = 0.73, wBooth = 0.27; // flux shares from the table above
    const zc = zFloor * wFloor + zBooth * wBooth;
    const flux = BOUNCE_FLUX;
    const lum = 0.2126 * flux.x + 0.7152 * flux.y + 0.0722 * flux.z;
    const color = new THREE.Color(flux.x / lum, flux.y / lum, flux.z / lum); // luminance 1 → intensity carries the lumens
    for (const cx of WINDOW.centersX) {
      const l = lambertSpot(color, lum, "sun-bounce");
      const xc = cx - (ROOM.zFront - zFloor) * planShift * wFloor - 0.5 * wBooth;
      if (xc > -ROOM.halfX + 0.4) {
        l.position.set(xc, 0.12, zc);
        l.target.position.set(xc, 3, zc);
      } else {
        // The first window's beam meets the −x end wall 1.1 m past its centre: the wall
        // patch (the one the `counter` pose looks at) is a band at z ≈ zFront − 1.1/tan 38°
        // from the floor up to 2.62 − 1.78·tan 35° ≈ 1.4 m. That bounce leaves the wall
        // horizontally, toward +x — so this spot sits ON the wall and fires along +x. Rev 2's
        // first round clamped it to an up-facing spot 0.4 m from the wall, which lit the
        // wall it stood for (a wall cannot light itself) to 1,090 nits, 0.9 EV over the
        // other shaded walls, and the ceiling above the first booth with it.
        const dx = ROOM.halfX - 0.05 + cx; // window centre → wall, along −x
        const zWall = ROOM.zFront - dx / planShift;
        l.position.set(-ROOM.halfX + 0.05, 0.7, zWall);
        l.target.position.set(-ROOM.halfX + 3, 0.7, zWall);
      }
      scene.add(l, l.target);
      bounces.push(l);
    }
  }

  /* ---------------- heat lamps over the pass-through shelf ---------------- */
  // Two 250 W red R40 heat lamps (Shell.ts: shades at pass.a0 + 0.35 and pass.a1 − 0.35,
  // 0.45 m over the shelf, 120 mm behind the wall). A clear 250 W R40 is ≈ 4,000 lm; the
  // red coating passes ≈ 15 % → ≈ 600 lm each, 1,200 lm, colour ≈ (1.0, 0.45, 0.20) —
  // one 60°-half-angle spot midway between them covers the whole 1.4 m shelf from 0.4 m:
  // E ≈ (1,200/π) / 0.4² ≈ 2,400 lux at the shelf → the painted liner and jambs at ≈ 600
  // nits, orange-red (middle grey, GREY_NITS), the stainless shelf showing the two bulbs.
  // Rev 1 had nothing lighting the pass-through and both critics called it a black hole;
  // this is what a diner pass-through looks like at any hour. `distance` 3 m clips it to
  // the kitchen box + the back bar (decay 2 has it under 1 lux by 2.5 m anyway).
  {
    const pass = PASS_THROUGH;
    const shelfY = pass.sill, lampY = shelfY + pass.heatLampAbove - 0.1;
    const z = ROOM.zBack - T - 0.12;
    const heat = new THREE.SpotLight(new THREE.Color(1.0, 0.45, 0.2), nits(1_200 / Math.PI), 3, THREE.MathUtils.degToRad(60), 0.6, 2);
    heat.castShadow = false;
    heat.name = "heat-lamp";
    heat.position.set(pass.centerX, lampY, z);
    heat.target.position.set(pass.centerX, shelfY, z + 0.05);
    scene.add(heat, heat.target);
  }

  return { sun, sunBeam, sunLot, cone: cone3, troffers, bounces, horizon };
}

/**
 * Multiply the sky shader's output before tone mapping, through an injected uniform, so
 * System 3's authored gradient keeps its shape while reading in nits (horizon ≈ 7,000,
 * zenith ≈ 3,800, glare and disc above that). A circumsolar term is added on top: on a
 * hazy summer morning the sky within ~40° of the sun is 1.7–2.5× brighter than the opposite
 * horizon (forward scattering by dust; CIE clear-sky types 11–12), and that is the part
 * of the sky the windows face (sun 38° off the window normal). `c` = cos(angle to the
 * sun) is a local of the sky shader's main(). Done here rather than in Exterior.ts so the
 * sky's look and its photometric scale stay in separate files.
 */
export function scaleSky(sky: THREE.Mesh, scale: number): void {
  const mat = sky.material as THREE.ShaderMaterial;
  // Rev 2: the dome's authored colours are the lighting's (SKY_HORIZON_RGB / SKY_ZENITH_RGB).
  (mat.uniforms.horizon.value as THREE.Color).copy(SKY_HORIZON_RGB);
  (mat.uniforms.zenith.value as THREE.Color).copy(SKY_ZENITH_RGB);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.skyScale = { value: scale };
    const boost = shader.fragmentShader.includes("float c = clamp( dot( d, sunDir )") || shader.fragmentShader.includes("float c = clamp(dot(d, sunDir)")
      ? "gl_FragColor.rgb *= skyScale * ( 1.0 + 1.0 * pow( c, 4.0 ) );"
      : "gl_FragColor.rgb *= skyScale;";
    shader.fragmentShader = shader.fragmentShader
      .replace("varying vec3 vDir;", "varying vec3 vDir;\nuniform float skyScale;")
      // Horizon → zenith gradient shape. Exterior.ts authors mix(horizon, zenith, pow(h, 0.55)),
      // halfway to the zenith by 15° of elevation. Linear in sin(elevation): 74 % of the
      // horizon value at 15°, 50 % at 30° — between CIE types 8 and 10 for a 35° sun, and
      // the integral above. (Round 9's pow(h, 1.6) held 94 % to 15° and 82 % to 30°, which
      // put the diffuse sky at 39 klux.)
      .replace("pow(h, 0.55)", "h")
      .replace("#include <tonemapping_fragment>", boost + "\n#include <tonemapping_fragment>");
  };
  mat.customProgramCacheKey = () => "sky-scaled";
  mat.needsUpdate = true;
}

/* ------------------------------------------------------------------------- */
/* Contact occlusion                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Baked contact occlusion: one merged mesh of multiply-blended vertex-coloured quads
 * laid 1.5 mm over the floor along every base line (stool bases, booth kicks and end
 * panels, the counter's recessed kick, the back bar, the end walls) plus the shade
 * under the counter's 300 mm knee overhang and in the recessed kicks. Nothing in the
 * rig shadows these regions (RectAreaLights cast nothing, the probe has no
 * occlusion), so without it every base "floats" — REFERENCE §6.
 *
 * MultiplyBlending with `toneMapped: false`: the quad's colour (1 − ao) multiplies the
 * framebuffer, in linear light on the post pipeline's HDR target and in sRGB on the
 * default framebuffer (0.5 → 0.735 encoded ≈ ×0.5 decoded) — the same darkening either way.
 */
export interface ContactDisc {
  x: number;
  y: number;
  z: number;
  /** Full occlusion `ao` inside `r0`, fading to 0 at `r1`. */
  r0: number;
  r1: number;
  ao: number;
}

export function buildContactShadows(parent: THREE.Object3D, extra: readonly ContactDisc[] = []): THREE.Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const Y = 0.0015;
  const STEPS = 6;
  const push = (p: THREE.Vector3, ao: number) => {
    pos.push(p.x, p.y, p.z);
    const g = 1 - ao;
    col.push(g, g, g);
    return pos.length / 3 - 1;
  };
  // Falloff of a corner's occlusion with distance from the junction (0 → 1 across the strip).
  const fall = (t: number) => (1 - t) * (1 - t) * (1 - 0.35 * t);

  /** Strip from a line (a → b) outward along `out` for `width`, occlusion `ao` at the line. */
  const strip = (a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3, width: number, ao: number) => {
    const rows: number[][] = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const o = out.clone().multiplyScalar(width * t);
      rows.push([push(a.clone().add(o), ao * fall(t)), push(b.clone().add(o), ao * fall(t))]);
    }
    for (let i = 0; i < STEPS; i++) {
      const [a0, b0] = rows[i], [a1, b1] = rows[i + 1];
      idx.push(a0, b0, b1, a0, b1, a1);
    }
  };
  /** Horizontal floor strip along x at z, spreading toward `dz` (±1). */
  const floorX = (x0: number, x1: number, z: number, dz: number, width: number, ao: number) =>
    strip(new THREE.Vector3(x0, Y, z), new THREE.Vector3(x1, Y, z), new THREE.Vector3(0, 0, dz), width, ao);
  /** Horizontal floor strip along z at x, spreading toward `dx` (±1). */
  const floorZ = (z0: number, z1: number, x: number, dx: number, width: number, ao: number) =>
    strip(new THREE.Vector3(x, Y, z0), new THREE.Vector3(x, Y, z1), new THREE.Vector3(dx, 0, 0), width, ao);
  /** Vertical band on a face at z (normal ±z), from y0 spreading `dy` (±1) for `height`. */
  const faceZ = (x0: number, x1: number, y0: number, z: number, nz: number, dy: number, height: number, ao: number) =>
    strip(new THREE.Vector3(x0, y0, z + nz * 0.0012), new THREE.Vector3(x1, y0, z + nz * 0.0012), new THREE.Vector3(0, dy, 0), height, ao);
  const faceX = (z0: number, z1: number, y0: number, x: number, nx: number, dy: number, height: number, ao: number) =>
    strip(new THREE.Vector3(x + nx * 0.0012, y0, z0), new THREE.Vector3(x + nx * 0.0012, y0, z1), new THREE.Vector3(0, dy, 0), height, ao);
  /**
   * Annulus on a horizontal surface at height `y` (the floor by default) around (x, z):
   * full `ao` inside r0, fading to 0 at r1; `sx`/`sz` stretch it to an ellipse.
   */
  const disc = (x: number, z: number, r0: number, r1: number, ao: number, sx = 1, sz = 1, y = Y) => {
    const N = 28;
    const c = push(new THREE.Vector3(x, y, z), ao);
    const rings: number[][] = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const r = r0 + (r1 - r0) * t;
      const ring: number[] = [];
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2;
        ring.push(push(new THREE.Vector3(x + Math.cos(a) * r * sx, y, z + Math.sin(a) * r * sz), ao * fall(t)));
      }
      rings.push(ring);
    }
    for (let k = 0; k < N; k++) idx.push(c, rings[0][k], rings[0][(k + 1) % N]);
    for (let i = 0; i < STEPS; i++) for (let k = 0; k < N; k++) {
      const a0 = rings[i][k], b0 = rings[i][(k + 1) % N], a1 = rings[i + 1][k], b1 = rings[i + 1][(k + 1) % N];
      idx.push(a0, b0, b1, a0, b1, a1);
    }
  };

  /* ---- stools: bell base Ø 0.43 on the floor ---- */
  for (const x of STOOL.centersX) disc(x, STOOL.z, STOOL.baseR * 0.9, STOOL.baseR + 0.13, 0.55);

  /* ---- booths ---- */
  const { zInner, zOuter, seat, divider, endPanel, kick } = BOOTH;
  const zEnd0 = zInner - endPanel;
  for (const cx of WINDOW.centersX) {
    // Seat kicks facing the table (recessed under the cushion): floor line + the kick face itself.
    for (const s of [-1, 1]) {
      const xk = cx + s * (seat.front + 0.04);
      floorZ(zInner, zOuter, xk, -s, 0.16, 0.5);
      faceX(zInner, zOuter, kick, xk, -s, -1, kick, 0.45);
      // Aisle end panel: floor line in front of it.
      const xa = cx + s * (seat.front - 0.02), xb = cx + s * divider.x0;
      floorX(Math.min(xa, xb), Math.max(xa, xb), zEnd0, -1, 0.14, 0.45);
    }
    // Under the table: the top above, seats both sides, the wall behind — that floor sees
    // only the 0.72 m opening to the aisle, ≈ 8 % of its hemisphere, and in photographs
    // sits 2–3 EV under the aisle floor. Rev 1's 0.3 (×0.7) left a lit floor under every
    // table (both critics: the booths "float"). Rev 2: an elliptical pool the size of the
    // bay (0.7 × 1.0 m at full strength, fading past the seat fronts and 0.35 m out into
    // the aisle mouth) at 0.6 (×0.4, −1.3 EV) — the probe still lights it, so this is the
    // occlusion the probe lacks, not black — plus the pedestal bell's own contact ring
    // and the wall corner on top.
    const zTable = zInner + BOOTH.table.inset + 0.35;
    disc(cx, zTable + 0.15, 0.3, 0.62, 0.6, 1.15, 1.6);
    disc(cx, zTable, BOOTH.pedestal.bellR * 0.9, BOOTH.pedestal.bellR + 0.1, 0.5);
    floorX(cx - seat.front, cx + seat.front, zOuter, -1, 0.2, 0.45);
  }
  // Dividers between booths and the end partitions: floor line at the aisle end.
  for (let i = 0; i < WINDOW.centersX.length - 1; i++) {
    const xd = (WINDOW.centersX[i] + WINDOW.centersX[i + 1]) / 2;
    floorX(xd - 0.05, xd + 0.05, zEnd0, -1, 0.14, 0.45);
  }
  {
    const cx0 = WINDOW.centersX[0], xd0 = cx0 - divider.x0 - 0.02;
    floorX(-ROOM.halfX, xd0 + 0.05, zEnd0, -1, 0.14, 0.45);
    const cxN = WINDOW.centersX[WINDOW.centersX.length - 1], xdN = cxN + divider.x0 + 0.02;
    floorX(xdN - 0.05, xdN + 0.02, zEnd0, -1, 0.14, 0.45);
    // Partition toward the door: its face toward the vestibule meets the floor too.
    floorZ(zEnd0, zOuter, xdN + 0.02, 1, 0.14, 0.4);
  }

  /* ---- counter ---- */
  {
    const dieFront = COUNTER.topFrontZ - COUNTER.overhang;
    const dieBack = dieFront - COUNTER.dieDepth;
    const kickZ = dieFront - COUNTER.kickRecess;
    const lDieX1 = COUNTER.xMax + COUNTER.dieDepth;
    // Recessed toe kick: floor line and the kick face under the die's bottom edge.
    floorX(COUNTER.xMin, COUNTER.xMax, kickZ, 1, 0.16, 0.5);
    faceZ(COUNTER.xMin, COUNTER.xMax, COUNTER.kickHeight, kickZ, 1, -1, COUNTER.kickHeight, 0.4);
    // Die face under the 300 mm knee overhang: shade grading down from the nosing.
    faceZ(COUNTER.xMin, COUNTER.xMax, COUNTER.height - COUNTER.topThickness, dieFront, 1, -1, 0.3, 0.42);
    // L-return (faces +x toward the door).
    floorZ(COUNTER.lReturnZEnd + COUNTER.kickRecess, dieBack, lDieX1 - COUNTER.kickRecess, 1, 0.16, 0.5);
    faceX(COUNTER.lReturnZEnd + COUNTER.kickRecess, dieBack, COUNTER.kickHeight, lDieX1 - COUNTER.kickRecess, 1, -1, COUNTER.kickHeight, 0.4);
    faceX(COUNTER.lReturnZEnd, dieBack, COUNTER.height - COUNTER.topThickness, lDieX1, 1, -1, 0.3, 0.42);
    // Service side of the die and the back bar's kick.
    floorX(COUNTER.xMin, COUNTER.xMax, dieBack, -1, 0.14, 0.45);
    floorX(BACK_BAR.xMin, BACK_BAR.xMax, BACK_BAR.zFront, 1, 0.14, 0.45);
  }

  /* ---- walls ---- */
  floorZ(ROOM.zBack, zEnd0, -ROOM.halfX, 1, 0.12, 0.35);
  floorZ(ROOM.zBack, ROOM.zFront, ROOM.halfX, -1, 0.12, 0.35);
  floorX(ROOM.halfX - 3.4, ROOM.halfX, ROOM.zBack, 1, 0.12, 0.35);
  floorX(-ROOM.halfX, BACK_BAR.xMin, ROOM.zBack, 1, 0.12, 0.35);

  /* ---- ceiling cove: the tiles meet the walls, 0.25 m of falling occlusion on the tile face ---- */
  {
    const yc = ROOM.height - CEILING.teeDepth - CEILING.tegularDrop - 0.0015;
    const cX = (x0: number, x1: number, z: number, dz: number) =>
      strip(new THREE.Vector3(x0, yc, z), new THREE.Vector3(x1, yc, z), new THREE.Vector3(0, 0, dz), 0.25, 0.3);
    const cZ = (z0: number, z1: number, x: number, dx: number) =>
      strip(new THREE.Vector3(x, yc, z0), new THREE.Vector3(x, yc, z1), new THREE.Vector3(dx, 0, 0), 0.25, 0.3);
    cX(-ROOM.halfX, ROOM.halfX, ROOM.zBack, 1);
    cX(-ROOM.halfX, ROOM.halfX, ROOM.zFront, -1);
    cZ(ROOM.zBack, ROOM.zFront, -ROOM.halfX, 1);
    cZ(ROOM.zBack, ROOM.zFront, ROOM.halfX, -1);
  }

  /* ---- props (Props.ts): mug feet and rims, saucers — 1.5 mm over their own surface ---- */
  // Rev 1 had none: an inverted mug's rounded 3.5 mm rim is one texel of the 4096² sun map
  // and the PCSS filter blurs it away, so every mug stood on a fully lit ring of mat/counter
  // — "light leaking under the mugs". The fills cast nothing either.
  for (const d of extra) disc(d.x, d.z, d.r0, d.r1, d.ao, 1, 1, d.y + 0.0015);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, contactMaterial());
  mesh.name = "contact-occlusion";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = -1; // before the transmissive glass in the transparent pass
  parent.add(mesh);
  return mesh;
}

function contactMaterial(): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    // r185: MultiplyBlending is dst × (src·a + 1 − a) and requires premultipliedAlpha;
    // with a = 1 that is dst × colour, colour = 1 − ao. `opacity` therefore fades the
    // occlusion out to "no darkening" — buildContactDisc's movable discs use that.
    blending: THREE.MultiplyBlending,
    premultipliedAlpha: true,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  mat.userData.noCast = true;
  return mat;
}

/**
 * One contact disc as its OWN mesh (its own material, so `material.opacity` can fade it): for a
 * prop that leaves its surface — the pour mug, lifted to drink (System 9 rev 3: the baked disc
 * stayed dense on the bar under a mug 15 cm in the air). Same annulus as `buildContactShadows`'
 * `disc`; +1 draw where the prop is in view.
 */
export function buildContactDisc(parent: THREE.Object3D, d: ContactDisc, name: string): THREE.Mesh {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const STEPS = 6, N = 28;
  const fall = (t: number) => (1 - t) * (1 - t) * (1 - 0.35 * t);
  const push = (x: number, y: number, z: number, ao: number) => {
    pos.push(x, y, z);
    col.push(1 - ao, 1 - ao, 1 - ao);
    return pos.length / 3 - 1;
  };
  const y = d.y + 0.0015;
  const c = push(d.x, y, d.z, d.ao);
  const rings: number[][] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS, r = d.r0 + (d.r1 - d.r0) * t, ring: number[] = [];
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      ring.push(push(d.x + Math.cos(a) * r, y, d.z + Math.sin(a) * r, d.ao * fall(t)));
    }
    rings.push(ring);
  }
  for (let k = 0; k < N; k++) idx.push(c, rings[0][k], rings[0][(k + 1) % N]);
  for (let i = 0; i < STEPS; i++)
    for (let k = 0; k < N; k++) {
      const a0 = rings[i][k], b0 = rings[i][(k + 1) % N], a1 = rings[i + 1][k], b1 = rings[i + 1][(k + 1) % N];
      idx.push(a0, b0, b1, a0, b1, a1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, contactMaterial());
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = -1;
  parent.add(mesh);
  return mesh;
}
