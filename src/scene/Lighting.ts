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
import { slatBeamOpen, slatShadowGlsl } from "./slatShadow";
import { bounceQuads, bounceRectsGlsl } from "./bounceRects";

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
 *
 * Rev 4: 1/60 s (EV100 10.9, grey ≈ 405 nits). Rev 3 had one consistent camera across every
 * pose — and it was an *exterior* exposure on an interior subject: the shaded walls at
 * 220–340 nits sat at −2.9 … −2.3 EV (sRGB 46–64), the ceiling at 30–35, the floor under
 * the tables black, 56 % of `length` under sRGB 48. Shore (Trail's End), Eggleston (Snak
 * Shak) and Reitz expose for the room — walls 85–130, tabletops 100, the window average 104
 * with the glass gone — and let the exterior roll off. Two stops open puts the 220–340-nit
 * walls at −0.9 … −0.3 EV (sRGB 105–130), the ceiling beside a troffer at +0.6, the sunlit
 * wall and table 5 stops over grey (clip), the 4,500-nit sky at +3.5 (rolled off, ≈ 240,
 * the aureole clipped) and the sunlit lot at +2.5 … +4 (asphalt ≈ 225, sand ≈ 245, CMU ≈
 * 250: order kept, nothing readable lost). The shoulder that makes that possible is
 * CAMERA_WHITE_EV below.
 */
/**
 * Rev 7 (evening): 1/20 at f/5.6 ISO 100 — 1.6 stops more open than the morning's 1/60,
 * middle grey ≈ 211 nits (L_sat 1,176). The 14 klux window patch on an alabaster wall
 * (2,200 nits) sits +3.7 EV → 243 unclipped; the horizon sky by the sun (1,800 nits)
 * +3.4; the zenith (400 nits) +1.2 — a real blue, not a wash; the troffers' 300 lux on the
 * counter (≈ 70 nits) reads at −1.3 EV: visibly ON. `?ev=` and `[` `]` step from here.
 */
export const CAMERA = { iso: 100, fNumber: 5.6, shutter: 1 / 15 } as const; // rev 7.1: +0.4 EV (undertable → ≈ 40, patch ≈ 241)
export const EV100 = Math.log2((CAMERA.fNumber * CAMERA.fNumber) / CAMERA.shutter) - Math.log2(CAMERA.iso / 100);
/** Metered saturation luminance for that exposure (Lagarde: L_sat = 1.2 · 2^EV) ≈ 2,260 nits at 1/60 (9,560 at rev 3's 1/250); the display white sits CAMERA_WHITE_EV − 2.47 stops above it. */
export const L_SAT_NITS = 1.2 * Math.pow(2, EV100);
/**
 * `renderer.toneMappingExposure`: scene value 1.0 = L_sat. ≈ 1.05 at K = 1e-4.
 * Middle grey (0.18) then sits at ≈ 405 nits (rev 2–3: 1,690). Measured scene-referred values (rev 2 probe,
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
 *
 * Rev 4: 4.5. With the camera open two stops for the room (CAMERA), a white at +2.5 would
 * put the whole exterior — asphalt +2.5, sky +3.5, sand +3.6, CMU +4.1 — at 255 and the
 * sedan roof's sky sheen with it. A camera JPEG has 3–4 stops of highlight roll-off over
 * metered grey (highlight-priority / DR-optimiser modes exist for exactly this frame), so
 * the shoulder is stretched: the same Hable curve normalised to white at +4.5 EV, with the
 * gain re-solved so grey still lands at 0.26. Below +1 EV it is within 3 codes of the rev 2
 * curve (−3 → 47, −2 → 70, −1 → 102, 0 → 139, +1 → 178); above it rolls: +2 → 211,
 * +3 → 235, +4 → 250, +4.5 → 255. Sun on a cream wall (+5.4) and the troffer bars (+4.9)
 * still clip; the sky through the east glass sits at ≈ 240 with its aureole clipped.
 */
export const CAMERA_WHITE_EV = 4.5;
/**
 * Rev 6, step 1 (ported, see BUILD.md "System 4 rev 6"): two hue-preserving stages run on the
 * exposed value BEFORE the per-channel Hable curve.
 *
 * 1. nightdrive's `tameHighlights` knee (`C:\Code\nightdrive\index.html:2601-2619`): above
 *    K = 0.18 · 2^CAMERA_KNEE_EV the maximum channel is compressed as K + over / (1 + over/K)
 *    and the other two scaled with it, so the excess folds toward an asymptote of 2K with the
 *    hue and saturation of the pixel intact. Per-channel Hable alone compresses the leading
 *    channel first: a sunlit maroon panel (R +3.8 EV, B +1.3) came out with R flattened onto
 *    B — lilac — and a sun patch went to paper white with a hard edge where all three hit W.
 *    K at +3.5 EV puts the asymptote 2K exactly at the +4.5 EV white point, so the shoulder is
 *    never entered above its knee: nothing hard-clips, the patches roll.
 * 2. jungle-trail's film-stock crosstalk (`src/render/grade.js:632-666`): colour film
 *    desaturates toward its shoulder, a renderer's brightest pixels are its most saturated —
 *    mix toward luminance by CAMERA_CROSS_AMOUNT · (1 − e^(−luma · CAMERA_CROSS_RATE)), keyed
 *    on the exposed value ("a highlight is a pixel near the top of the print"). At grey the
 *    weight is 0.30 (1.8 % desaturation: red vinyl in shade keeps its chroma), +2 EV 0.76,
 *    +3.5 EV 0.95.
 */
export const CAMERA_KNEE_EV = 3.5;
export const CAMERA_CROSS_AMOUNT = 0.06;
export const CAMERA_CROSS_RATE = 2.0;
/**
 * Display-linear value of middle grey (the gain solve below). Rev 2–5: 0.26 (sRGB 139), the
 * top of the camera-JPEG range, chosen when the critics wanted no interior median under sRGB
 * 70. Rev 6 (step 4, survey #4): 0.18 — sRGB 118, the textbook grey card. With the mid-tones
 * a third of a stop lower and the white point unchanged the curve is steeper through the
 * shade: a 192-nit shaded wall goes from code 100 to 81 and a 4,500-nit sky stays at 238, so
 * the display ratio between them opens from 2.8 to 3.6 EV; the rest of the critics' +4 EV /
 * sRGB 40–60 comes from the fill balance (step 5), not from the curve.
 */
export const CAMERA_MID_GREY = 0.18;
/**
 * Hable ("Uncharted 2") filmic curve, per channel, normalised so x_white → 1 with
 * x_white = 0.18 · 2^CAMERA_WHITE_EV · CAMERA_CURVE_GAIN. The gain scales the input so
 * middle grey lands at CAMERA_MID_GREY display-linear (rev 6: 0.18, sRGB 118; a camera JPEG
 * puts a grey card at 118–140) instead of Hable's default 0.149; it is solved for the white point at module
 * load (1.492 at +2.5, 2.587 at +4.5). Rev 2's table (white +2.5), from the exact port of
 * this GLSL in the harness (camtone.mjs; verified against 14 probe regions to ±1 code):
 * −5 → sRGB 17, −4 → 29, −3 → 44, −2 → 67, −1 → 98, 0 → 140, +1 → 187, +2 → 234,
 * +2.5 → 255; the rev 4 table is on CAMERA_WHITE_EV. Author by inverting a target code
 * through the table (rev 4: code 64 ↔ 105 nits, 96 ↔ 205, 128 ↔ 340, 192 ↔ 1,050,
 * 240 ↔ 3,900), never by eye against a tone-mapped frame (night-street TECHNIQUE §1–2).
 * Per-channel: a clipped sunlit red goes salmon → white the way film and sensors do
 * (AgX kept it red by design; the photographs the frame is judged against do not).
 */
const CAMERA_CURVE_GAIN = (() => {
  const hable = (x: number) => { const A = 0.22, B = 0.30, C = 0.10, D = 0.20, E = 0.01, F = 0.30; return (x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F) - E / F; };
  const W = 0.18 * Math.pow(2, CAMERA_WHITE_EV);
  let lo = 0.1, hi = 20;
  for (let i = 0; i < 60; i++) { const g = (lo + hi) / 2; if (hable(0.18 * g) / hable(W * g) < CAMERA_MID_GREY) lo = g; else hi = g; }
  return (lo + hi) / 2;
})();

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
  const K = 0.18 * Math.pow(2, CAMERA_KNEE_EV);
  const glsl = /* glsl */ `
    // Camera-like tone curve (System 4 rev 2, scene/Lighting.ts): Hable filmic, per channel,
    // display white at +${CAMERA_WHITE_EV} EV over middle grey. See CAMERA_CURVE_GAIN there.
    vec3 cameraToneMapHable( vec3 x ) {
      const float A = 0.22, B = 0.30, C = 0.10, D = 0.20, E = 0.01, F = 0.30;
      return ( x * ( A * x + C * B ) + D * E ) / ( x * ( A * x + B ) + D * F ) - E / F;
    }
    vec3 CustomToneMapping( vec3 color ) {
      vec3 x = max( color * toneMappingExposure, vec3( 0.0 ) );
      // rev 6 step 1a: hue-preserving knee (nightdrive tameHighlights), K = grey · 2^${CAMERA_KNEE_EV}
      float hl = max( x.r, max( x.g, x.b ) );
      if ( hl > ${K.toFixed(5)} ) {
        float over = hl - ${K.toFixed(5)};
        x *= ( ${K.toFixed(5)} + over / ( 1.0 + over / ${K.toFixed(5)} ) ) / hl;
      }
      // rev 6 step 1b: film-stock crosstalk (jungle-trail stock()), keyed on the exposed luminance
      float ly = dot( x, vec3( 0.2126, 0.7152, 0.0722 ) );
      x = mix( x, vec3( ly ), ${CAMERA_CROSS_AMOUNT.toFixed(3)} * ( 1.0 - exp( -ly * ${CAMERA_CROSS_RATE.toFixed(3)} ) ) );
      x *= ${CAMERA_CURVE_GAIN.toFixed(4)};
      vec3 white = cameraToneMapHable( vec3( ${W.toFixed(6)} ) );
      return saturate( cameraToneMapHable( x ) / white );
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
  // Rev 7 (evening preset): 6:45 PM, sun 9° up, 38° off the window normal toward the door
  // end — the diner now faces WEST, so the same glass takes the low sun (Flagstaff, late
  // July: sunset azimuth ≈ 298°, the facade normal ≈ 260°). Shadows run 6.3× height.
  const el = THREE.MathUtils.degToRad(9);
  const az = THREE.MathUtils.degToRad(38);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

/**
 * Sun angular diameter 0.53° → the full penumbra (lit → dark) grows 9.3 mm per metre of
 * occluder → receiver. The PCSS filter disk is a RADIUS, so it takes half of that.
 */
const SUN_ANGULAR_DIAMETER = THREE.MathUtils.degToRad(0.53);
/**
 * Rev 7 (evening): the sun 9° up has crossed ≈ 6 air masses — ≈ 3,200 K after extinction
 * (sedona-sunset's spectral solver lands (1.0, 0.72, 0.45) linear for a 9° sun in clear
 * high-desert air; the morning preset was (1.0, 0.83, 0.71) ≈ 5,400 K). Normalised to unit
 * LUMINANCE so SUN_LUX below is the photometric value.
 */
export const SUN_COLOR = new THREE.Color(1.0, 0.72, 0.45);
SUN_COLOR.multiplyScalar(1 / (0.2126 * SUN_COLOR.r + 0.7152 * SUN_COLOR.g + 0.0722 * SUN_COLOR.b));
/**
 * Direct normal illuminance. Rev 7: 18 klux — a 9° sun through 6 air masses at 2,000 m
 * (Kasten–Young: τ ≈ 0.3·6 → ×0.17 of the 105 klux extraterrestrial ≈ 18 klux; the morning
 * preset's 35° sun had 90 klux). On the window glass (n·s 0.78): 14 klux; on the lot
 * ground (s.y 0.156): 2.8 klux — shadows are sky-lit blue, the sunlit ground only ≈ 2 EV up.
 */
export const SUN_LUX = 18_000;
/** Spot apex distance from the building centre. Ray directions across the room vary by ±2.3°. */
const SPOT_DIST = 150;

/**
 * Rev 3: cool-white fluorescent as a daylight-balanced camera records it — the 546 nm
 * mercury line dominates a halophosphate lamp's spectrum, so the lens photographs pale
 * green-cyan (R < G, B < G) beside the 5,400 K sun; both critics asked for exactly that
 * after rev 2's warm (255, 237, 198) tint read as "cream". sRGB (236, 255, 238). Exported
 * for the lens emissive (materials.ts), so lamp and lens share one colour.
 */
export const FLUORESCENT = new THREE.Color().setRGB(236 / 255, 255 / 255, 238 / 255, THREE.SRGBColorSpace);
/**
 * Luminaire output of a four-lamp F32T8 2×4: 4 × 2,850 lm initial lamp lumens = 11,400,
 * × 0.68 luminaire efficiency through a K12 lens × 0.88 ballast factor × 0.85 lamp
 * depreciation ≈ 5,800 lm maintained; rev 2 set 7,500. Rev 3: 10,500 — new lamps behind a
 * clean lens (the brief's 10–12 klm), because under the rev 3 fills a white mug directly
 * under a fixture must read brighter than a cream wall in window shade, as it does in the
 * Reitz frame: 10,500 lm / π over 2 m² ≈ 840 lux straight under the lens, 0.85 × 840 / π ≈
 * 230 nits on white crockery, against ≈ 250 nits of shaded wall. Six fixtures (layout.ts
 * CEILING.troffers) → 63,000 lm over the 68 m² room, ≈ 550 lux on the working plane with a
 * room cavity utilisation of ≈ 0.6.
 *
 * Rev 6 (survey #4/#7 physics): back to the derived 5,800 lm maintained. Rev 3's 10,500 was
 * tuned so the fixtures would visibly light the room against the sun — the one thing a
 * fluorescent troffer cannot do at 8 AM: 35 klm maintained over 68 m² is ≈ 300 lux, one
 * hundredth of the 34,500 lux in a sun patch, and in the photographs the fixtures show only
 * as their own lens. Half the flux takes ≈ 45 nits off every shaded wall (the critics' walls
 * at sRGB 40–60), and the lens keeps its +4 EV: 5,800 / (π · 0.566 m²) = 3,260 nits mean
 * with the two lamp-pair bars at 2.2× — 7,200 nits, +4.1 EV over grey, above the bloom
 * threshold (post/settings.ts, 2.0 exposed = +3.5 EV) so the bars glow as a lit lens does.
 */
export const TROFFER_LUMENS = 8_700;
/**
 * Rev 7 (evening preset): 8,700 lm maintained — three-lamp F32T8 2×4 with new lamps behind a
 * clean lens (3 × 2,850 × 0.85 × 0.88 × 0.68 × 1.5 for the lens-brightness the user asked
 * for: "the lights are so dim"). Six fixtures → 52 klm over 68 m² ≈ 460 lux on the working
 * plane, ≈ 110 nits on the laminate: against a 6:45 PM window (14 klux on the glass, 3 klux
 * of sky through it) the troffers are now the room's fill and print as pools on the tiles.
 */
/** Lens: 1.11 × 0.51 m opening (two 0.6 m cells less the door frame). */
export const TROFFER_LENS_AREA = (CEILING.tile * 2 - 0.09) * (CEILING.tile - 0.09);
/**
 * Mean lens luminance of a Lambertian emitter of TROFFER_LUMENS over TROFFER_LENS_AREA:
 * Φ / (π A) ≈ 3,260 nits (rev 6; +3.0 EV over grey); the two tube-pair images in the emissive
 * map peak at ≈ 2.2× → 7,200 nits, +4.1 EV: the bars sit on the knee and bloom, the field
 * between them holds the green-cyan tint — a lit troffer in a daylight exposure.
 */
export const TROFFER_LENS_NITS = TROFFER_LUMENS / (Math.PI * TROFFER_LENS_AREA);
/**
 * Sky dome, in nits (rev 3; `scaleSky` replaces the dome shader's colour model). Luminance
 * is linear in sin(elevation) from SKY_HORIZON_NITS to SKY_ZENITH_RATIO × that, times a
 * circumsolar aureole (0.5 c⁴ + 0.6 c³² + 1.5 c⁴⁰⁰, c = cos of the angle to the sun: ×1.5
 * within 20° of the sun, ×3 at its rim); chroma runs from SKY_HORIZON_CHROMA to
 * SKY_ZENITH_CHROMA (unit luminance each), whitened inside the aureole and in a 2° dust
 * band on the horizon line.
 *
 * The number that matters is the hemisphere's cosine-weighted integral — the diffuse
 * skylight — not the horizon: it sets the lit/shadow ratio of every outdoor surface,
 * E_sun,h / E_sky = 51.6 klux / E_sky, and it is most of what lights the shaded room.
 * Integrated numerically over the shader (this model, sun at 35°):
 *   rev 2  10,000 horizon · zenith 0.29× · linear · boost 1.0          →  23 klux, 3.2:1 (1.7 EV);
 *   rev 3   4,500 horizon · zenith 0.50× · linear · aureole as above   →  ≈ 11 klux, 4.7:1
 *          (2.2 EV) on open ground; 3.1 EV under a car, which also hides half the sky.
 * A clear summer morning with the sun at 35° measures 10–15 klux diffuse (CIE types 11–12:
 * horizon 4–6 k cd/m², zenith 2–3 k). Rev 2's 23 klux (and its 3.4:1 horizon/zenith) was
 * the turbid end; both critics measured every lot shadow 1 EV too shallow and every sky
 * sample achromatic — the latter because 8–12 k nits sat on the camera curve's shoulder,
 * where the channels converge. Measured on the dome (evalpage, HDR): 90° from the sun at
 * 20° elevation (2,107, 3,843, 7,433) nits — through the door glass (×0.84, Fresnel twice +
 * the pane's tint) the sky prints sRGB (151, 185, 219) against the critics' (150, 185, 235).
 */
/**
 * Rev 7 (evening preset, 6:45 PM, sun 9° up). Golden-hour sky, from sedona-sunset's solved
 * dome (`atmos.js` single-scatter at 8° elevation, `sky.js` gradient): horizon by the sun
 * 1,600 nits (peach → pale yellow in the 5–25° band above it, whitened orange inside the
 * 20° aureole), horizon opposite the sun 0.55× and blue-grey, zenith 0.25× (400 nits) in a
 * saturated blue. Cosine-weighted hemisphere ≈ 3.2 klux diffuse — the sunlit lot (2.8 klux
 * direct on the ground) is barely 1 EV over its own shadows, which are blue: evening.
 */
const SKY_HORIZON_NITS = 1_200;
const SKY_ZENITH_RATIO = 0.25;
/**
 * Chroma at unit luminance. Horizon (0.34, 0.58, 1.0) / Y, B/R 2.9; zenith (0.22, 0.45, 1.0)
 * / Y, B/R 4.5; blended in √h so the 5–25° band the windows see sits near B/R 3.5. That is
 * what the critics' target sRGB (150, 185, 235) means once inverted through the camera
 * curve (tools camtone: 1,980 / 3,281 / 6,860 nits): B at +2.0 EV over grey, R at +0.25 — a
 * scene ratio of 3.5, not the 1.6 of a "pale blue" (0.6, 0.76, 1.0) which the per-channel
 * shoulder then squeezed to (205, 225, 245). Rev 2's authored horizon (0.78, 0.86, 0.97)
 * read R ≈ G ≈ B outright.
 */
/** Rev 7: warm horizon (peach, toward the sun) — also the haze tint of the ridge rings. */
const SKY_HORIZON_CHROMA = new THREE.Color(1.0, 0.6, 0.34);
/** Rev 7: horizon opposite the sun — pale blue-grey (the Belt of Venus sits just above it). */
const SKY_HORIZON_COOL_CHROMA = new THREE.Color(0.74, 0.8, 1.0);
/** Rev 7: pale yellow band 5–25° above the sun. */
const SKY_ABOVE_SUN_CHROMA = new THREE.Color(1.0, 0.86, 0.6);
/** Rev 7: orange aureole (forward scatter, 20° around the sun). */
const SKY_AUREOLE_CHROMA = new THREE.Color(1.0, 0.66, 0.38);
/** Rev 7: deep saturated blue at the zenith. */
const SKY_ZENITH_CHROMA = new THREE.Color(0.24, 0.4, 1.0);
export const luminance = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
for (const c of [SKY_HORIZON_CHROMA, SKY_HORIZON_COOL_CHROMA, SKY_ABOVE_SUN_CHROMA, SKY_AUREOLE_CHROMA, SKY_ZENITH_CHROMA]) c.multiplyScalar(1 / luminance(c));
const glslVec3 = (c: THREE.Color): string => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
const SKY_SCALE = nits(SKY_HORIZON_NITS);
/**
 * First bounce of the sun patches (System 4 rev 6, step 5): see scene/bounceRects.ts. Rev 2–5
 * derived one Lambertian spot per booth from PATCH_LUX × area × albedo (≈ 25,000 lm per booth,
 * BOUNCE_FLUX / VINYL_FLUX; BUILD.md rev 2–4); the rectangles now carry E_patch · ρ / π as
 * radiance and the shader integrates the form factor, so the derivation lives there. Glass
 * 0.88, blind beam transmittance from the slat geometry (slatShadow.ts slatBeamOpen, 0.76).
 */
export const GLASS_T = 0.88;
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
 * ≈ 600. Rev 2 shipped 0.7 and both critics measured the shaded walls of every oblique
 * pose (`length`, `booth`, `aisle`, `counter`) 1–1.5 EV over the poses that look at a
 * window — the probe is pose-independent, but its excess is not: the poses that see the
 * far wall and the ceiling see the faces the probe inflates most.
 *
 * Rev 3 attribution (`length` wall-shade, HDR probe, one exposure; nits):
 *   sun + probe only (`?nofill`)                     40   sky through the windows
 *   + troffers (`?nobounce`)                        130   ≈ 90 from the fixtures
 *   + bounce spots, probe 0.01                      180   the first bounce, no probe
 *   full, probe 0.35 / 0.45 / 0.7                   382 / 452 / 650
 * so the probe's second bounce is ≈ 5.8 nits per 0.01 of intensity, and the flux balance
 * above allows ≈ 90 nits of it on a cream wall (≈ 410 lux). 0.1 ships: ≈ 60 nits of probe
 * on top of the 180 the spots deliver (the spots already carry part of the second bounce
 * through their cos-falloff), which puts the shaded back wall at 220 nits far from the
 * windows (`length`, sRGB 46) and 330 near them (`counter`, `lot-wide`, sRGB 56–64) —
 * inside the critics' 40–60 with the window and slat gaps ≥ +4 EV above it. 0.25 was tried
 * first and put the far wall at 325 nits with the floor's shade at sRGB 60, too flat.
 * dawn-station ships 0.35 (`lightInterior.ts`, `ibounce`) for a room with no sun in it.
 * `?ibounce=n` overrides.
 *
 * Rev 4: 0.13 (≈ 75 of the 90 nits the balance allows). With the camera open two stops the
 * room's darkest corners — the floor under the tables, the mat between the mugs — set the
 * frame medians of `undertable` and `macro-warmer`, and both critics want no interior
 * median under sRGB 70; the walls move 0.1 EV (106 → 110 far, 126 → 130 near the windows).
 *
 * Rev 6: 0.1 again. The first bounce is now the exact rectangle term (bounceRects.ts), which
 * the probe capture also sees, so the probe is purely the second bounce; measured at `length`
 * (`?ibounce=0.01` against 0.13) it was adding 19 nits to a 173-nit shaded wall. The brief's
 * shade target is sRGB 40–60 (60–110 nits at this camera), not rev 4's "no median under 70".
 */
export const ROOM_PROBE_INTENSITY = (() => {
  // Rev 7 (evening): 0.3 — the room the probe sees is ≈ 3 EV dimmer than the morning's, and
  // the undertable / kick spaces it fills alone must stay ≥ 40 sRGB at the evening exposure.
  if (typeof location === "undefined") return 0.3;
  const v = Number(new URLSearchParams(location.search).get("ibounce"));
  return Number.isFinite(v) && v > 0 ? v : 0.3;
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
  /** One Lambertian spot per 2×4 fixture (`?nofluor` → none). */
  troffers: THREE.SpotLight[];
  /** Rev 2–5: one upward Lambertian spot per booth. Rev 6: always empty — the first bounce is the analytic rectangle term (bounceRects.ts, `?nobounce` → off). */
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
  installSunSplit();
  installSlatShadow();
  installBounceRects();
  installSpecularAA();
  renderer.toneMapping = TONE_MAPPING;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = SHADOW_MAP_TYPE;
  primeShadowMapType(renderer);
  installPcss();
  // Transmissive materials (rev 6: only the carafe, sugar, mug and clock glass — the panes
  // are alpha glazing, scene/Glazing.ts) make three render the opaque scene a second time
  // into the transmission buffer. Rev 2 measured 3.4 ms of an 11.4 ms scene pass at full
  // resolution when the panes used it; 0.5 (a 960×540 buffer) is kept for the tabletop glass,
  // whose refracted view of the room is never pixel-sharp anyway. `?txscale=n`.
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
 * The compare-mode depth texture the PCSS filter taps (`sunBeam`'s map, same camera and
 * casters as spot 0). Set by buildLighting; injected into every material's uniforms by
 * `installPcss` (Material.prototype.onBeforeCompile) and `assignSunSplit` (materials with
 * their own onBeforeCompile).
 */
const SUN_PCF_UNIFORM: { value: THREE.Texture | null } = { value: null };

/**
 * Percentage-closer soft shadows for the BasicShadowMap path (raw depth textures).
 * `shadow.radius` is re-purposed per light:
 *   radius > 0 → PCSS (the interior sun). Penumbra (in shadow-map UV) = radius ×
 *                (receiverDepth − blockerDepth) in the map's [0,1] depth space; blocker
 *                search radius = 0.2 × radius. `penumbraPerDepth()` computes the constant
 *                from the light's frustum and the sun's 0.53° diameter.
 *   −0.5 < radius ≤ 0 → one bilinear tap (the lot sun: hard shadows, a 1-texel ramp).
 *   radius ≤ −0.5 → four bilinear taps on a square of |radius| texels.
 *
 * Rev 3. Rev 2 sampled 8 + 12 taps on a Vogel spiral rotated per pixel: Monte-Carlo, so
 * wherever the penumbra spanned a few slat periods (the far wall, the aisle floor, the
 * far end of every table) the 12 taps returned a random fraction of a 50/50 pattern —
 * ±14 % grain that both critics read as speckle, dither and glitter. Three changes:
 *
 *  1. Deterministic kernels. Blocker search on a 4 × 4 grid over the search disc; filter on
 *     a 7 × 7 grid over the penumbra disc with a smooth disc weight (the taps are baked as
 *     constants). Bilinear taps at ≤ 1-texel spacing integrate the map exactly (a box
 *     filter): no noise, and with a 4096² map that holds up to a 3.5-texel (15 mm) penumbra
 *     radius ≈ 3 m of slat → receiver distance; beyond that the grid undersamples the
 *     slats slightly (mild moiré where the eye sees a uniform glow anyway).
 *  2. Hardware PCF. The filter taps read `sunPcfMap`, the compare-mode copy of the sun's
 *     map the post pipeline already renders (`sunBeam`): one `texture()` = one bilinear
 *     comparison, so 45 taps cost what 12 manual bilinear taps did. The blocker search
 *     still needs raw depths and reads the light's own map.
 *  3. Receiver-plane depth bias (Isidoro 2006): the reference depth of each tap follows
 *     the receiver's depth gradient (dz/du, dz/dv from screen derivatives), so a wide
 *     kernel on a floor at 35° incidence no longer shadows itself on the light-side half —
 *     rev 2 hid that with `normalBias 0.012`, 3 texels, which also let the sun through the
 *     0.3 mm slats onto their room-side lips. `normalBias` is one texel now.
 */
export function installPcss(): void {
  if (pcssInstalled) return;
  pcssInstalled = true;
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

  // Filter kernel: 7 × 7 cell-centred grid over [−pen, pen], disc weight 1 inside r = 0.7,
  // fading to 0 at r = 1.0 (close to a disc sun's penumbra profile), normalised.
  const N = 7;
  const taps: Array<[number, number, number]> = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = ((i + 0.5) / N) * 2 - 1, v = ((j + 0.5) / N) * 2 - 1;
    const w = THREE.MathUtils.clamp((1.0 - Math.hypot(u, v)) / 0.3, 0, 1);
    if (w > 0) taps.push([u, v, w]);
  }
  const wsum = taps.reduce((acc, t) => acc + t[2], 0);
  const filterGlsl = taps.map(([u, v, w]) => {
    const o = `vec2( ${u.toFixed(4)}, ${v.toFixed(4)} ) * pen`;
    return `lit += ${(w / wsum).toFixed(5)} * texture( sunPcfMap, vec3( shadowCoord.xy + ${o}, zR + dot( gradZ, ${o} ) ) );`;
  }).join("\n\t\t\t\t\t\t");
  // Blocker search: 4 × 4 cell-centred grid over the search disc.
  const search: string[] = [];
  for (const v of [-0.75, -0.25, 0.25, 0.75]) for (const u of [-0.75, -0.25, 0.25, 0.75]) {
    search.push(`{ vec2 o = vec2( ${u}, ${v} ) * searchR; float d = texture2D( shadowMap, shadowCoord.xy + o ).r; if ( d < zR + dot( gradZ, o ) ) { dNear = max( dNear, d ); n += 1.0; } }`);
  }

  const pcss = /* glsl */ `#else // SHADOWMAP_TYPE_BASIC — replaced by PCSS (src/scene/Lighting.ts)

		uniform sampler2DShadow sunPcfMap;

		// One bilinear comparison of a raw depth map (what sampler2DShadow does in hardware).
		float pcssTap( sampler2D map, vec2 uv, vec2 texel, float zR ) {
			vec2 p = uv / texel - 0.5;
			vec2 f = fract( p );
			vec2 base = ( floor( p ) + 0.5 ) * texel;
			float d00 = step( zR, texture2D( map, base ).r );
			float d10 = step( zR, texture2D( map, base + vec2( texel.x, 0.0 ) ).r );
			float d01 = step( zR, texture2D( map, base + vec2( 0.0, texel.y ) ).r );
			float d11 = step( zR, texture2D( map, base + texel ).r );
			return mix( mix( d00, d10, f.x ), mix( d01, d11, f.x ), f.y );
		}

		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {

			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			float zR = shadowCoord.z + shadowBias;
			// Receiver-plane depth gradient: dz/d(uv) from the screen-space derivatives of the
			// projected coordinate (Isidoro 2006), taken here, outside any branch, where the
			// derivatives are defined. Clamped to the slope of an 80° incidence so a silhouette's
			// derivative cannot throw a tap's reference depth across the room.
			vec2 dxUV = dFdx( shadowCoord.xy ), dyUV = dFdy( shadowCoord.xy );
			float dxZ = dFdx( shadowCoord.z ), dyZ = dFdy( shadowCoord.z );
			float det = dxUV.x * dyUV.y - dxUV.y * dyUV.x;
			vec2 gradZ = abs( det ) > 1e-14 ? vec2( dxZ * dyUV.y - dyZ * dxUV.y, dyZ * dxUV.x - dxZ * dyUV.x ) / det : vec2( 0.0 );
			gradZ = clamp( gradZ, vec2( -2.5 ), vec2( 2.5 ) );
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;

			if ( inFrustum && zR <= 1.0 ) {

				vec2 texel = vec2( 1.0 ) / shadowMapSize;
				// Slope-scaled bias for the hardware PCF's own footprint: each tap compares one
				// reference depth against the four texels around it, up to a texel from the
				// receiver point, and on a surface at 70–80° to the light (a slat top, a table
				// edge) the surface itself is deeper by |∇z| × texel there — acne that read as
				// "every slat face in shade" until this line (rev 3).
				zR -= ( abs( gradZ.x ) + abs( gradZ.y ) ) * texel.x * 0.75;

				if ( shadowRadius > 0.0 ) {

					// 1. Blocker search: the NEAREST blocker in front of the receiver (largest depth).
					// Rev 3 first used the mean blocker depth, as in the PCSS paper: under the blinds
					// the search disc holds slat texels (0.5–1 m away) AND, wherever the roof edge's
					// shadow crosses the table, its texels (3–6.5 m away), in a proportion that
					// changes with every texel the 16 taps step over, so the penumbra estimate
					// jumped between 7 mm and 60 mm and the sun patch on the macro-table laminate
					// became a mosaic of texel-sized tiles at different blurs. The nearest blocker's
					// edge is the one that shapes the boundary at that point; taking it makes the
					// estimate a step function of *which* casters are present, not of how many taps
					// hit each — the slat stripes keep their 7 mm/m penumbra over the whole table
					// and the roof's own edge is soft where no slat is in the disc.
					float searchR = shadowRadius * 0.2;
					float dNear = 0.0, n = 0.0;
					${search.join("\n\t\t\t\t\t")}
					if ( n > 0.5 ) {
						// 2. Penumbra ∝ receiver−blocker separation, clamped to the search disk. The
						// floor is 1.75 texels (6.6 mm): below that the 3.75 mm depth texels show
						// through the filter as a staircase along every slat edge that runs at an
						// angle to the map's grid (the near end of a table 0.5 m from the blinds,
						// where the physical penumbra radius is 2.3 mm). It still grows with distance
						// past 1.4 m, and by the far wall (3–4 m) it is 3× this floor.
						float pen = clamp( shadowRadius * ( zR - dNear ), texel.x * 1.75, searchR );
						// 2b. Camera-footprint floor (rev 4). A pixel integrates the shadow over its own
						// footprint in the map — on the far wall (11 m) one pixel spans ~2 texels, and the
						// 25 mm slat stripes there are 3.5 px apart: filtered at the 1.75-texel floor,
						// each stripe edge's texel staircase beat against the next into a diagonal hatch
						// that the critics counted as hard motes (L 200–235 on a 110 wall). Widening the
						// disc to the pixel footprint is exactly the sensor's own box filter; it changes
						// nothing within ~4 m (footprint < 0.5 texel there).
						pen = max( pen, min( max( length( dxUV ), length( dyUV ) ), texel.x * 12.0 ) );
						// 3. Weighted disc of hardware-PCF taps over the penumbra.
						float lit = 0.0;
						${filterGlsl}
						shadow = lit;
					}

				} else if ( shadowRadius > -0.5 ) {

					// One bilinear tap: a 1-texel ramp, what hardware PCF gives (the lot sun).
					shadow = pcssTap( shadowMap, shadowCoord.xy, texel, zR );

				} else {

					// Fixed kernel: four bilinear taps on a square of half-side |radius| texels.
					float r = max( 0.5, -shadowRadius ) * texel.x * 0.7071;
					// Camera-footprint floor, as in the PCSS branch (rev 4): the lot's shadow outlines
					// stepped 2.7 px where a pixel covered more than the kernel.
					r = max( r, 0.7071 * min( max( length( dxUV ), length( dyUV ) ), texel.x * 8.0 ) );
					vec2 a = vec2( r, r ), b = vec2( r, -r );
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

  // Every program that includes the chunk needs the sampler bound, or the unit-0 default
  // makes ANGLE reject the draw ("two textures of different types use the same sampler
  // location") and the mesh silently vanishes — rev 3 lost the coffee-pot liquid that way.
  // `onBeforeCompile` becomes an accessor on the prototype: materials that never set their
  // own hook get the default + binding; a hook assigned later (Pour.ts builds its materials
  // after the lighting is installed) is stored and wrapped by the setter. The wrapper's
  // toString carries the inner hook's source so the default program cache key still
  // distinguishes them. Own data properties assigned *before* this ran are untouched by
  // the accessor; assignSunSplit wraps those (bindSunPcf).
  type Hook = (this: THREE.Material, s: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) => void;
  const proto = THREE.Material.prototype as unknown as { onBeforeCompile: Hook };
  const base = proto.onBeforeCompile;
  const wrap = (fn: Hook): Hook => {
    const wrapped: Hook = function (this: THREE.Material, shader, renderer) {
      fn.call(this, shader, renderer);
      (shader.uniforms as Record<string, { value: unknown }>).sunPcfMap = SUN_PCF_UNIFORM;
    };
    wrapped.toString = () => fn.toString() + "+sunpcf";
    (wrapped as unknown as { sunPcf?: boolean }).sunPcf = true;
    return wrapped;
  };
  const defaultHook = wrap(base);
  const SLOT = Symbol("onBeforeCompile");
  Object.defineProperty(proto, "onBeforeCompile", {
    configurable: true,
    get(this: Record<symbol, Hook | undefined>) { return this[SLOT] ?? defaultHook; },
    set(this: Record<symbol, Hook | undefined>, fn: Hook) { this[SLOT] = (fn as unknown as { sunPcf?: boolean }).sunPcf ? fn : wrap(fn); },
  });
}

/** Give a material with its own `onBeforeCompile` the PCSS sampler too (see installPcss). */
function bindSunPcf(m: THREE.Material): void {
  if (!Object.prototype.hasOwnProperty.call(m, "onBeforeCompile")) return;
  const own = m.onBeforeCompile;
  if ((own as unknown as { sunPcf?: boolean }).sunPcf) return;
  const wrapped = function (this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) {
    own.call(this, shader, renderer);
    (shader.uniforms as Record<string, { value: unknown }>).sunPcfMap = SUN_PCF_UNIFORM;
  };
  (wrapped as unknown as { sunPcf?: boolean }).sunPcf = true;
  m.onBeforeCompile = wrapped;
  // The program cache keys on onBeforeCompile.toString() unless a custom key exists; every
  // wrapper prints the same, so key on the wrapped function instead.
  if (!Object.prototype.hasOwnProperty.call(m, "customProgramCacheKey")) m.customProgramCacheKey = () => own.toString() + "+sunpcf";
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
/* Two-sun split by receiver (rev 3)                                          */
/* ------------------------------------------------------------------------- */

/**
 * `sun` (the spot) and `sunLot` (the directional) are the same sun; each receiver must
 * see exactly one of them. Rev 1–2 did that with a caster-only cone on the spot's cone
 * in `sunLot`'s map — which also put every car, wheel stop and pole shadow inside the cone
 * (the near stalls) into `sunLot`'s shadow, so the near lot was lit by the SPOT, through
 * its 3.5 mm PCSS map with a penumbra estimated for slats, and its shadows came out
 * 250 mm soft (rev 2 critics: "car-shadow edge ramps over 32 px"). Rev 3 splits by
 * material instead: every mesh under the `exterior` group compiles with `SUN_SKIP_SPOT0`
 * and drops spot 0 before its shadow lookup; everything else compiles with
 * `SUN_SKIP_DIR0` and drops directional 0. three orders shadow-casting lights first
 * within a type, and the two suns are the only casters of theirs, so index 0 is stable.
 * The cone is gone; `sunLot`'s casters are the lot objects alone (the building's own
 * shadow falls behind it, out of every pose).
 */
function installSunSplit(): void {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const spotLine = "getSpotLightInfo( spotLight, geometryPosition, directLight );";
  const dirLine = "getDirectionalLightInfo( directionalLight, directLight );";
  if (!chunk.includes(spotLine) || !chunk.includes(dirLine)) {
    console.warn("[lighting] lights_fragment_begin layout changed; sun split not installed");
    return;
  }
  THREE.ShaderChunk.lights_fragment_begin = chunk
    .replace(spotLine, `${spotLine}
		#if defined( SUN_SKIP_SPOT0 ) && ( UNROLLED_LOOP_INDEX == 0 )
			directLight.visible = false; directLight.color = vec3( 0.0 );
		#elif ( UNROLLED_LOOP_INDEX == 0 ) && ! defined( SLAT_NO_ANALYTIC )
			// System 4 rev 6: the blind slats are not in this sun's shadow map; their stripes are the
			// closed-form transmittance of src/scene/slatShadow.ts (installSlatShadow), world-space.
			{
				vec3 slatWp = cameraPosition - ( vec4( vViewPosition, 0.0 ) * viewMatrix ).xyz;
				vec3 slatWs = ( vec4( directLight.direction, 0.0 ) * viewMatrix ).xyz;
				float slatAa = length( fwidth( slatWp ) );
				directLight.color *= slatTransmit( slatWp, slatWs, slatAa );
			}
		#endif`)
    .replace(dirLine, `${dirLine}
		#if defined( SUN_SKIP_DIR0 ) && ( UNROLLED_LOOP_INDEX == 0 )
			directLight.visible = false; directLight.color = vec3( 0.0 );
		#endif`);
}

/**
 * Declare `slatTransmit` (slatShadow.ts) in every lit fragment shader, ahead of the light loop
 * that calls it (installSunSplit). The post pipeline's beam / dust / haze shaders include the
 * same GLSL through beams.ts `shadowGlsl`, so a mote in a stripe's shadow is dark in both.
 */
function installSlatShadow(): void {
  const chunk = THREE.ShaderChunk.lights_pars_begin;
  if (chunk.includes("slatTransmit")) return;
  THREE.ShaderChunk.lights_pars_begin = chunk + slatShadowGlsl();
}

/**
 * Sun-patch first bounce as rectangle form factors (rev 6, scene/bounceRects.ts): the quad list
 * goes into `lights_pars_begin`, and `bounceIrradiance( worldPos, worldNormal )` is added to
 * `irradiance` at three's light-probe line — the same slot sedona-sunset's s4GroundBand uses —
 * so it feeds `indirectDiffuse` through the material's own Lambert term and nothing else (no
 * specular image: the point-source stand-ins needed a diffuse-only patch for that, rev 4).
 * `?nobounce` leaves it out.
 */
function installBounceRects(): void {
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
  if (q?.has("nobounce") || q?.has("nofill")) return;
  const pars = THREE.ShaderChunk.lights_pars_begin;
  if (pars.includes("bounceIrradiance")) return;
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  // Anchor on the ambient line, not the light-probe one: that one sits inside
  // `#if defined( USE_LIGHT_PROBES )`, which this scene never defines (found the hard way —
  // the ceiling lost its bounce entirely on the first build).
  const anchor = "vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );";
  if (!chunk.includes(anchor)) {
    console.warn("[lighting] lights_fragment_begin layout changed; bounce rectangles not installed");
    return;
  }
  const sun = sunDirection();
  const quads = bounceQuads({ sunLux: SUN_LUX, sun, glass: GLASS_T, slatOpen: slatBeamOpen(sun), sunColor: new THREE.Vector3(SUN_COLOR.r, SUN_COLOR.g, SUN_COLOR.b) });
  THREE.ShaderChunk.lights_pars_begin = pars + bounceRectsGlsl(quads, K);
  THREE.ShaderChunk.lights_fragment_begin = chunk.replace(anchor, `${anchor}
    #ifndef BOUNCE_NO_RECTS
    {
      // System 4 rev 6: first bounce of the sun patches, exact rectangle form factors (bounceRects.ts)
      vec3 bWp = cameraPosition - ( vec4( vViewPosition, 0.0 ) * viewMatrix ).xyz;
      vec3 bWn = inverseTransformDirection( geometryNormal, viewMatrix );
      irradiance += bounceIrradiance( bWp, bWn );
    }
    #endif`);
}

/**
 * Geometric specular anti-aliasing (Tokuyoshi & Kaplanyan 2019, "Improved Geometric
 * Specular Antialiasing"): the roughness of every standard/physical material is widened by
 * the screen-space variance of its SHADED normal, σ² = 0.25 · (|∂n/∂x|² + |∂n/∂y|²), capped
 * at 0.18. three does this for the geometric normal only (`geometryRoughness`); the
 * normal-mapped one is what glittered — the vinyl's pebble grain under the sun (rev 2
 * critics: adjacent pixels 39 / 111 / 58 / 104 on a sunlit bench) is a normal map whose
 * facets flip across the specular lobe from one pixel to the next. A real lens integrates
 * that over the pixel; this is the closed-form equivalent. Costs two derivatives.
 */
function installSpecularAA(): void {
  const chunk = THREE.ShaderChunk.lights_physical_fragment;
  const line = "material.roughness = min( material.roughness, 1.0 );";
  if (!chunk.includes(line)) {
    console.warn("[lighting] lights_physical_fragment layout changed; specular AA not installed");
    return;
  }
  THREE.ShaderChunk.lights_physical_fragment = chunk.replace(line, `${line}
{
	vec3 dnx = dFdx( normal ), dny = dFdy( normal );
	float kernelRoughness = min( 0.18, 0.25 * ( dot( dnx, dnx ) + dot( dny, dny ) ) );
	material.roughness = min( 1.0, sqrt( material.roughness * material.roughness + kernelRoughness ) );
}`);
}

/**
 * Tag every material under `root` with the define its meshes need (see installSunSplit).
 * `exteriorMaterials` are outdoor receivers built by the Shell (the apron slab: `concrete`
 * reaches 1.8 m past the wall, beyond the spot's cone). A material used both inside and
 * outside gets neither (both suns, as before) and is reported. Runs before the compile
 * pass (Diner.build), so no program is rebuilt.
 */
function assignSunSplit(root: THREE.Object3D, exteriorMaterials: THREE.Material[]): void {
  const exteriorRoot = root.getObjectByName("exterior");
  const ext = new Set<THREE.Material>(exteriorMaterials), int = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let outside = false;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === exteriorRoot) { outside = true; break; }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      bindSunPcf(m);
      if (!ext.has(m)) (outside ? ext : int).add(m);
    }
  });
  let shared = 0;
  for (const m of ext) {
    if (int.has(m)) { shared++; continue; }
    (m.defines ??= {}).SUN_SKIP_SPOT0 = 1;
  }
  for (const m of int) {
    if (ext.has(m)) continue;
    (m.defines ??= {}).SUN_SKIP_DIR0 = 1;
  }
  if (shared) console.warn(`[lighting] ${shared} material(s) used both inside and outside receive both suns`);
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
/**
 * Rev 4: bounce from the sunlit lot onto the blinds. The slats hang 85 mm inside the glass,
 * and their only indirect light was the room probe at 0.1 × — a probe that sees the windows
 * from 3 m back — so a slat's underside (which, street edge up, faces down and toward the lot)
 * received ≈ 100 nits and every slat seen from below read as a dark bar (`sit-seated`, the far
 * windows in `length`). Outside that underside is 2,300–3,900 nits of sunlit asphalt and sand:
 * E ≈ π · 2,800 nits · 0.45 (view factor past the slat below and the sill) ≈ 4,000 lux, warm.
 * Modelled as a Lambertian fill of fixed direction (down-street, 37° below the horizon) added
 * to the material's indirect diffuse — what a HemisphereLight's ground term does, but only for
 * this material, so the room does not get lit by the lot through the wall. Top faces see it at
 * dot ≈ 0 (their light is the sun and the sky, 4–7 k nits; this adds nothing there).
 */
export function installLotGroundFill(mat: THREE.Material): void {
  const dir = new THREE.Vector3(0, -0.6, 0.8).normalize();
  const fill = new THREE.Color().setRGB(255 / 255, 230 / 255, 195 / 255, THREE.SRGBColorSpace).multiplyScalar(nits(600)); // rev 7: sunlit sand 2.8 klux → ×0.15
  // Rev 6.1 (facade critics): seen from the LOT the same undersides are the whole blind. Their
  // real illuminance there is the sunlit face of the slat below (n·s 0.25 → 22 klux on an
  // alabaster slat = 5,300 nits, filling ≈ half the underside's hemisphere 22 mm away: ≈ 8,300
  // lux) plus the sunlit apron (5,000 nits × 0.3 → 4,700) and the low sky (4,500 × 0.2 → 2,800):
  // ≈ 16–20 klux on the underside (a hemisphere integral, not a cosine lobe: the term below
  // is gated on facing the lot, not scaled by it). Measured at `ext-facade`: slat pixels 72 →
  // 150 (peaks), the stucco 199; the undersides cannot honestly reach the sunlit wall. The interior
  // frames are frozen (rev 6 passed with the 4,000-lux undersides: `sit-seated`, `length`), so
  // the extra 11,000 lux fades in with the CAMERA's z across the window wall — a view-dependent
  // term, stated as such in BUILD.md; the player crossing the door sees the blinds' undersides
  // brighten over 0.6 m of walk while looking at the door, not the blinds.
  const fillOut = new THREE.Color().setRGB(255 / 255, 236 / 255, 210 / 255, THREE.SRGBColorSpace).multiplyScalar(nits(2400)); // rev 7: ×0.15 (the 9° sun now lights the undersides directly, n·s 0.19)
  const zBlend = new THREE.Vector2(ROOM.zFront - 0.2, ROOM.zFront + 0.4);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (shader, renderer) {
    prev.call(this, shader, renderer);
    shader.uniforms.uLotFill = { value: fill };
    shader.uniforms.uLotFillOut = { value: fillOut };
    shader.uniforms.uLotFillDir = { value: dir };
    shader.uniforms.uLotFillZ = { value: zBlend };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uLotFill; uniform vec3 uLotFillOut; uniform vec3 uLotFillDir; uniform vec2 uLotFillZ;")
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
	{
		vec3 fillDirView = normalize( ( viewMatrix * vec4( uLotFillDir, 0.0 ) ).xyz );
		float lotCos = dot( normal, fillDirView );
		vec3 lotE = uLotFill * max( 0.0, lotCos ) + uLotFillOut * smoothstep( -0.2, 0.3, lotCos ) * smoothstep( uLotFillZ.x, uLotFillZ.y, cameraPosition.z );
		reflectedLight.indirectDiffuse += BRDF_Lambert( diffuseColor.rgb ) * lotE;
	}`);
  };
  (mat as THREE.Material & { customProgramCacheKey: () => string }).customProgramCacheKey = () => "lotfill61";
}

export function installShadowMasks(renderer: THREE.WebGLRenderer, root: THREE.Object3D, lights: LightingResult, exteriorMaterials: THREE.Material[] = []): void {
  assignSunSplit(root, exteriorMaterials);
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
  sun.shadow.normalBias = 0.004; // one 4 mm texel; the receiver-plane bias in the PCSS kernel does the rest (rev 2: 0.012)
  // PCSS: 0.53° sun → 9.3 mm/m full penumbra = 4.65 mm/m filter radius (≈ 0.0127 UV per unit depth here).
  sun.shadow.radius = penumbraPerDepth(sun.shadow.camera, SPOT_DIST, SUN_ANGULAR_DIAMETER / 2);
  {
    // Diagnostics: `?nopcss` = fixed 4-tap kernel, `?nbias=n` overrides normalBias (metres).
    const dq = new URLSearchParams(location.search);
    if (dq.has("nopcss")) sun.shadow.radius = -1;
    const nb = Number(dq.get("nbias"));
    if (dq.has("nbias") && Number.isFinite(nb)) sun.shadow.normalBias = nb;
  }
  scene.add(sun, sun.target);
  const sunBeam = buildSunBeam(sun);
  SUN_PCF_UNIFORM.value = (sunBeam.shadow.map as THREE.WebGLRenderTarget).depthTexture;

  /* ---------------- exterior sun: wide directional over the lot ---------------- */
  const sunLot = new THREE.DirectionalLight(SUN_COLOR, sunIntensity);
  sunLot.name = "sun-lot";
  // Apex of the spot cone must lie inside this frustum (rays have to cross the cone's
  // lateral surface before they reach a receiver), so the light sits beyond the apex.
  const lotDist = SPOT_DIST + 15;
  sunLot.position.copy(centre).addScaledVector(dir, lotDist);
  sunLot.target.position.copy(centre);
  sunLot.castShadow = true;
  // Rev 3: 4096² over the lot box alone (rev 2: 2048² over lot + building, 22 × 11 mm
  // texels, whose staircase showed on every car-shadow edge once the cone was gone). The
  // building is no receiver of this light any more (installSunSplit) and casts nothing into
  // its map, so the frustum is the lot: kerb → CMU wall, pole tops. ≈ 7 × 4 mm texels,
  // 7 mm on the ground — a 15 mm ramp against the sun's own 3 mm (car sill) to 45 mm (pole top).
  sunLot.shadow.mapSize.set(4096, 4096);
  {
    const cam = sunLot.shadow.camera;
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, dir).normalize(); // camera +x in world
    const camUp = new THREE.Vector3().crossVectors(dir, right).normalize(); // camera +y
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    const pts: THREE.Vector3[] = [];
    for (const x of [-14.5, 14.5]) for (const y of [-0.5, 9.0]) for (const z of [ROOM.zFront + T, ROOM.zFront + T + 16.5]) pts.push(new THREE.Vector3(x, y, z));
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
  sunLot.shadow.normalBias = 0.03; // ≈ 1.5 texels of the 2048² map (rev 2: 0.05 lifted every tyre and wheel stop off its shadow)
  // Rev 3: one bilinear tap (installPcss, radius in (−0.5, 0]) — a 1-texel (7 mm) ramp; the
  // sun's real penumbra on the lot is 9.3 mm per metre of caster height, one texel for a
  // car's sill, two for its roof. Rev 4: four bilinear taps on a square of ±1.06 texels
  // (radius −1.5, ≈ 3-texel ramp ≈ 20 mm). A single bilinear ramp is exact along the map's
  // axes but a diagonal edge crosses the depth texels one at a time: on the sedan's shadow
  // outline at `lot-shadow` (edge slope 1.25 px/row) both critics measured 4–5 px jumps
  // every ~14 rows; a 7-row-smoothed mid-point trace (stair.mjs) gives rev 3 jumps of
  // 3.5 / 4.1 / 3.1 px at y 846 / 860 / 874 and, with this kernel, 2.7 / 2.5 / 2.2 —
  // 1.5 px over the slope, the rest of the outline within 0.8 px rms of a straight line.
  sunLot.shadow.radius = -1.5;
  scene.add(sunLot, sunLot.target);

  // Rev 3: no cone occluder. The spot / directional split is per receiver (installSunSplit):
  // exterior materials ignore the spot, interior ones ignore `sunLot`, so `sunLot` may
  // shine straight through the walls and windows in its own map without lighting anything
  // indoors, and the near stalls get its hard shadows from the cars and poles.

  /* ---------------- sky dome → physical nits ---------------- */
  const horizon = SKY_HORIZON_CHROMA.clone().multiplyScalar(SKY_SCALE);
  const sky = scene.getObjectByName("sky") as THREE.Mesh | undefined;
  if (sky) scaleSky(sky, SKY_SCALE);
  scaleHorizonRings(scene);

  // Diagnostics for the capture harness: `?nofill` renders the suns alone, `?nospot` /
  // `?nolot` switch one of the two suns off so the cone seam and each map can be checked;
  // `?nofluor` switches the troffers off (their contribution alone).
  const q = new URLSearchParams(location.search);
  if (q.has("nospot")) sun.intensity = 0;
  if (q.has("nolot")) sunLot.intensity = 0;
  if (q.has("nofill")) return { sun, sunBeam, sunLot, troffers: [], bounces: [], horizon };

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

  /* ---------------- first bounce of each window's beam ---------------- */
  // Rev 6: the analytic rectangle term installed by installBounceRects (configureRenderer);
  // no lights. Kept as an empty list for the callers that iterate it.
  const bounces: THREE.SpotLight[] = [];

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

  return { sun, sunBeam, sunLot, troffers, bounces, horizon };
}

/**
 * Replace the dome shader's colour model (Exterior.ts authors a display-scale mix) with the
 * physical one above, in scene units: luminance and chroma as documented at
 * SKY_HORIZON_NITS. `horizon` / `zenith` uniforms carry the unit-luminance chromas; `ground`
 * (below the horizon line, seen only by probes where no geometry covers) keeps the dome's
 * authored value times the scale; the 0.53° disc stays at 40× the horizon.
 */
export function scaleSky(sky: THREE.Mesh, scale: number): void {
  const mat = sky.material as THREE.ShaderMaterial;
  (mat.uniforms.horizon.value as THREE.Color).copy(SKY_HORIZON_CHROMA);
  (mat.uniforms.zenith.value as THREE.Color).copy(SKY_ZENITH_CHROMA);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.skyScale = { value: scale };
    const src = shader.fragmentShader;
    const i0 = src.indexOf("float h = clamp(d.y, 0.0, 1.0);");
    const i1 = src.indexOf("gl_FragColor = vec4(col, 1.0);");
    if (i0 < 0 || i1 < 0) {
      console.warn("[lighting] sky shader layout changed; physical sky not installed");
      return;
    }
    const body = /* glsl */ `float h = clamp(d.y, 0.0, 1.0);
        float c = clamp(dot(d, sunDir), 0.0, 1.0);
        // Azimuth relative to the sun: a = 1 toward it, 0 opposite.
        vec2 dh = normalize(d.xz + vec2(1e-5, 0.0));
        float a = 0.5 + 0.5 * dot(dh, normalize(sunDir.xz));
        // Rev 7 (evening): horizon luminance falls to 0.55× opposite the sun; the elevation
        // falloff is steeper than the morning's (pow 0.7) — the low sun's light stays in the
        // long horizontal paths; the aureole is wider (forward scatter through 6 air masses).
        float circ = 0.5 * pow(c, 4.0) + 0.8 * pow(c, 32.0) + 1.5 * pow(c, 400.0);
        float horizLum = mix(0.55, 1.0, smoothstep(0.0, 1.0, a));
        float lum = mix(horizLum, ${SKY_ZENITH_RATIO.toFixed(3)}, pow(h, 0.7)) * (1.0 + circ);
        // Chroma (unit luminance): peach horizon toward the sun, blue-grey opposite → deep
        // blue zenith; a pale-yellow band 5–25° above the sun; the aureole goes orange.
        vec3 hor = mix(${glslVec3(SKY_HORIZON_COOL_CHROMA)}, horizon, smoothstep(0.0, 1.0, a));
        vec3 chroma = mix(hor, zenith, pow(h, 0.45));
        float band = smoothstep(0.0, 0.12, h) * smoothstep(0.45, 0.15, h) * a * a;
        chroma = mix(chroma, ${glslVec3(SKY_ABOVE_SUN_CHROMA)}, band * 0.65);
        chroma = mix(chroma, ${glslVec3(SKY_AUREOLE_CHROMA)}, clamp(circ * 0.8, 0.0, 0.9));
        chroma = mix(chroma, vec3(1.02, 0.9, 0.78), smoothstep(0.035, 0.0, h) * 0.4);
        vec3 col = chroma * lum;
        float disc = smoothstep(0.999975, 0.999992, c) * 40.0;
        col += ${glslVec3(SKY_AUREOLE_CHROMA)} * disc;
        if (d.y < 0.0) col = mix(horizon * horizLum, ground, clamp(-d.y * 6.0, 0.0, 1.0));
        gl_FragColor = vec4(col * skyScale, 1.0);`;
    shader.fragmentShader = src.slice(0, i0) + body + src.slice(i1 + "gl_FragColor = vec4(col, 1.0);".length);
    shader.fragmentShader = shader.fragmentShader.replace("varying vec3 vDir;", "varying vec3 vDir;\nuniform float skyScale;");
  };
  mat.customProgramCacheKey = () => "sky-physical-r7";
  mat.needsUpdate = true;
}

/**
 * The three ridge rings (Exterior.ts buildHorizon) are unlit vertex-coloured meshes authored
 * against the dome's display-scale near-white horizon (Y ≈ 0.905): rock 0.3, hazed crests
 * toward 0.87. Rev 3 puts them in the sky's units — colour × horizon nits / 0.905 — so the
 * near range sits ≈ 1.6 EV under the horizon sky, the far "ghost" range ≈ 0.9 EV under, and
 * the hazed fraction takes the sky's chroma (aerial perspective IS skylight). They leave the
 * scene fog: rev 2's 40 → 200 m fog to the horizon colour had them 70 % sky at 150 m, i.e.
 * brighter than the blue behind them (critics: "mountains should sit ~1 EV below the sky").
 */
function scaleHorizonRings(scene: THREE.Scene): void {
  const k = SKY_SCALE / 0.905;
  const tint = SKY_HORIZON_CHROMA;
  const c = new THREE.Color();
  // The far range was authored at the sky's own luminance (its haze vertices reach 0.87 of
  // the dome's 0.905) and read 0.3 EV under the sky through the door glass; a range 30 km
  // off on a clear morning sits 0.7–1 EV under the sky behind it, so the far ring takes
  // 0.65× (the mid ring already lands −0.8 EV, the near ring is sunlit ground).
  // Rev 4. Measured through the door glass (HDR probe): the NEAR ring, which is what the door
  // frames, sat at 1,870 nits against the mid ring's 2,130 behind it — 0.2 EV apart, and the
  // rev 4 camera's shoulder squeezed that to 0.05 EV on the display: no horizon. At 8 AM the
  // ranges are due east, BACKLIT: the faces we see are their shaded west slopes, rock 0.3 under
  // 15 klux of sky ≈ 1,400 nits plus haze, so every ring must sit under the sky and the nearer
  // (less hazed) ring lowest: near 0.55× (−0.85 EV), mid 0.7× (−0.5), far 0.75× (−0.4).
  const ringScale: Record<string, number> = { horizon: 0.55, "horizon-mid": 0.7, "horizon-far": 0.75 };
  for (const name of ["horizon", "horizon-mid", "horizon-far"]) {
    const mesh = scene.getObjectByName(name) as THREE.Mesh | undefined;
    if (!mesh) continue;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    if (mat.userData.skyScaled) continue;
    mat.userData.skyScaled = true;
    mat.fog = false;
    const col = mesh.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (!col) continue;
    for (let i = 0; i < col.count; i++) {
      c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
      const t = THREE.MathUtils.clamp(luminance(c) / 0.87, 0, 1);
      c.multiplyScalar(k * ringScale[name]);
      c.r *= THREE.MathUtils.lerp(1, tint.r, t);
      c.g *= THREE.MathUtils.lerp(1, tint.g, t);
      c.b *= THREE.MathUtils.lerp(1, tint.b, t);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }
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

  /**
   * Strip from a line (a → b) outward along `out` for `width`, occlusion `ao` at the line.
   * `fade` = [at a, at b] in metres: a free end (a panel edge, not a corner) ramps its
   * occlusion to zero over that length instead of stopping dead — System 5 rev 5: two strips
   * with hard ends 4 cm apart at the booth dividers printed as stepped lighter rectangles on
   * the floor (`floor-macro`), and an end-panel strip's cut end as a hard-edged quadrilateral.
   */
  const strip = (a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3, width: number, ao: number, fade: [number, number] = [0, 0]) => {
    const L = a.distanceTo(b);
    const ts = [0, Math.min(0.5, fade[0] / L), Math.max(0.5, 1 - fade[1] / L), 1].filter((t, i, arr) => i === 0 || t > arr[i - 1] + 1e-6);
    const along = ts.map((t) => ({ p: a.clone().lerp(b, t), k: t < 0.5 ? (fade[0] > 0 ? Math.min(1, (t * L) / fade[0]) : 1) : fade[1] > 0 ? Math.min(1, ((1 - t) * L) / fade[1]) : 1 }));
    const rows: number[][] = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const o = out.clone().multiplyScalar(width * t);
      rows.push(along.map(({ p, k }) => push(p.clone().add(o), ao * fall(t) * k)));
    }
    for (let i = 0; i < STEPS; i++) {
      for (let j = 0; j < along.length - 1; j++) {
        const a0 = rows[i][j], b0 = rows[i][j + 1], a1 = rows[i + 1][j], b1 = rows[i + 1][j + 1];
        idx.push(a0, b0, b1, a0, b1, a1);
      }
    }
  };
  /** Horizontal floor strip along x at z, spreading toward `dz` (±1). */
  const floorX = (x0: number, x1: number, z: number, dz: number, width: number, ao: number, fade?: [number, number]) =>
    strip(new THREE.Vector3(x0, Y, z), new THREE.Vector3(x1, Y, z), new THREE.Vector3(0, 0, dz), width, ao, fade);
  /** Horizontal floor strip along z at x, spreading toward `dx` (±1). */
  const floorZ = (z0: number, z1: number, x: number, dx: number, width: number, ao: number, fade?: [number, number]) =>
    strip(new THREE.Vector3(x, Y, z0), new THREE.Vector3(x, Y, z1), new THREE.Vector3(dx, 0, 0), width, ao, fade);
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
  for (let i = 0; i < WINDOW.centersX.length; i++) {
    const cx = WINDOW.centersX[i];
    // Seat kicks facing the table (recessed under the cushion): floor line + the kick face itself.
    for (const s of [-1, 1]) {
      const xk = cx + s * (seat.front + 0.04);
      floorZ(zInner, zOuter, xk, -s, 0.16, 0.5);
      faceX(zInner, zOuter, kick, xk, -s, -1, kick, 0.45);
      // Aisle end panel + divider: one coplanar face at zEnd0, its kick recessed 12 mm
      // (Booths.ts). One strip per run, from the bay opening's free edge (fading over 60 mm)
      // to the divider centre shared with the neighbour — or to the end partitions — starting
      // at the KICK face so the recess floor is occluded too. Rev 4 had an end-panel strip and
      // a divider strip per side, overlapping 3–4 cm with hard ends: stepped rectangles and a
      // bright 12 mm seam at the panel foot (`floor-macro`).
      const xa = cx + s * (seat.front - 0.02);
      const last = WINDOW.centersX.length - 1;
      // The door-side partition's outer corner is convex: the run carries 50 mm past it and
      // fades over 80 mm (a dead stop at the corner printed a faint vertical step at
      // `floor-macro` 1077 × 100–210, world x 3.42).
      const xFar = s < 0 ? (i === 0 ? -ROOM.halfX : (cx + WINDOW.centersX[i - 1]) / 2) : i === last ? cx + divider.x0 + 0.04 + 0.05 : (cx + WINDOW.centersX[i + 1]) / 2;
      const fade: [number, number] = s < 0 ? [0, 0.06] : [0.06, i === last ? 0.08 : 0];
      floorX(Math.min(xa, xFar), Math.max(xa, xFar), zEnd0 + 0.012, -1, 0.14, 0.45, fade);
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
  // Partition toward the door: its face toward the vestibule meets the floor too (the kick is
  // recessed 5 mm there). The divider and end-partition floor lines are in the per-booth runs above.
  {
    const cxN = WINDOW.centersX[WINDOW.centersX.length - 1], xdN = cxN + divider.x0 + 0.02;
    // Starts 50 mm before the convex corner and fades in over 80 mm (see the booth runs).
    floorZ(zEnd0 - 0.05, zOuter, xdN + 0.02 - 0.005, 1, 0.14, 0.4, [0.08, 0]);
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
