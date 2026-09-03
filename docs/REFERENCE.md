# Morning Diner — Technical Reference Brief

Scene: small diner interior, ~08:00 MST, ~June 20, high-desert Southwest (Flagstaff / Holbrook AZ, ~35°N, ~2,000 m elevation), clear dry sky, hot day coming. Consumers: System 4 (lighting), System 5 (materials), System 8 (post). All numbers are for a 1 unit = 1 m scene. Where a value is an estimate rather than a measured/published figure it is marked *(est.)*.

Conventions used below: sRGB triplets are 8-bit display values; "linear" means linear-light albedo 0–1; K = correlated colour temperature; nits = cd/m²; EV = EV100 (ISO 100).

---

## 1. Sun geometry (08:00 MST, June 20, 35°N)

Arizona does not observe DST, so 08:00 clock time is 07:32 apparent solar time at Flagstaff (111.65°W, 6.65° west of the MST meridian → −26.6 min; equation of time ≈ −1.5 min). Hour angle ≈ −67°, declination +23.4°.

- **Flagstaff (35.20°N, 111.65°W)**: elevation **31.1°**, azimuth **82°** (E, 8° north of due east). Published hourly table agrees: 08:00 → +31°07′ altitude, az 82° — https://sunsetsunrisetime.com/sun-altitude/flagstaff , https://www.sunrisesunsettime.org/north-america/united-states/flagstaff-sun-position.htm
- **Holbrook AZ (34.9°N, 110.16°W)**: elevation ≈ 32.7°, azimuth ≈ 83° *(computed)*.
- **Gallup NM** is on MDT: 08:00 MDT = 07:00 MST → sun only ≈ 20° high, az ≈ 75°. Use Arizona for the 8 AM brief; if a New Mexico setting is wanted, treat the clock as 09:00 MDT.
- Sunrise 05:12 at az 60°; the sun has been up 2 h 48 min. Solar noon 12:28, max altitude 78°. https://www.timeanddate.com/sun/usa/flagstaff?month=6
- Sun angular diameter 0.53° → **penumbra width = 9.3 mm per metre** of occluder-to-surface distance. This is the single most important number for the blind stripes (see below).
- Relative air mass at 31° ≈ 1.93; at 2,100 m the absolute air mass ≈ 1.5 → clean, high-transmission, slightly bluer-than-sea-level sun.

### Direction of the beam relative to the windows

Profile angle β (the apparent slope of the beam in the vertical plane perpendicular to the window) = atan(tan(31.1°) / cos γ), where γ is the angle between the sun azimuth (82°) and the window's outward normal:

| Window faces | γ | Profile angle β | Floor hit from 0.85 m sill | Floor hit from 2.10 m head | Sideways skew of the whole patch |
|---|---|---|---|---|---|
| East (90°) | 8° | 31.4° | **1.40 m** into the room | 3.45 m | 0.20 m toward south at the sill line, 0.48 m at the far edge |
| ESE (112.5°) | 30.5° | 35.0° | 1.21 m | 3.00 m | 0.71 m / 1.77 m toward SSW |
| SE (135°) | 53° | 45.1° | 0.85 m | 2.10 m | 1.13 m / 2.79 m — patch runs strongly along the wall toward SW |
| NE (45°) | 37° | 37.1° | 1.12 m | 2.78 m | toward WSW |
| South (180°) | 98° | — | no direct sun on a south wall at 08:00 | | |

- All shadow edges travel toward **az 262° (WSW)**. Horizontal slat shadows are lines **parallel to the sill**; vertical elements (mullions, blind ladder cords, frame) cast lines on the floor at angle γ from the window normal.
- Beam footprint: on an east window the whole 1.25 m-high glazed band lands on the floor between 1.4 m and 3.45 m from the wall; nothing reaches a wall 4 m away. Counter fronts and booth ends inside that band get near-normal incidence (66,000 lux, see §2) and are the brightest vertical surfaces in the room.

### Venetian-blind stripes (slat 50 mm, pitch 43 mm, tilt θ from horizontal)

Blocked fraction of the beam f = w·|sin(β − θ)| / (p·cos β); stripe pitch on the floor = p / tan β; dark-stripe width on the floor = w·|sin(β − θ)| / sin β. θ positive = outer (street-side) edge raised (the normal "block the sky" tilt).

| Window | β | Floor pitch | θ = 0° | θ = 20° | θ = 30° | θ = 35° | θ = 40° |
|---|---|---|---|---|---|---|---|
| East | 31.4° | **70.6 mm** | 71% dark | 27% dark (19 mm) | 3% dark (2 mm hairline) | 5% dark (3 mm) | 20% dark (14 mm) |
| ESE | 35.0° | 61 mm | 82% dark | 37% dark (23 mm) | 12% dark (8 mm) | 0% (slats parallel to beam) | 14% dark |
| SE | 45.1° | **43 mm** | 100% blocked | 78% dark | **43% dark (18 mm dark / 25 mm light)** | 29% dark (12 mm) | 15% dark (6 mm) |

- Tilting the other way (outer edge down, θ = −10…−30°) blocks 90–100% on every orientation — no stripes at all.
- **Recommendation for legible ~40/60 stripes with the specified 30–40° tilt: an ESE or SE window with θ ≈ 30° (outer edge up).** On a true east window the specified tilt is nearly parallel to the 31° beam and passes ~95% of the light as an almost continuous sheet with hairline shadows — which is also a real and common look ("light pours in"), but not the stripy one.
- 29 slats fill a 1.25 m window → 29 stripes.
- **Penumbra**: blind-to-floor distance is 1.4–3.5 m (east) → edges soften by 13–32 mm. With a 14–19 mm dark stripe, the far half of the pattern washes out into a soft ripple; only the first ~1.5 m of stripes are crisp. Photographs show this gradient; CG that keeps stripes razor-sharp to the far edge reads as fake. Implement with PCSS or a shadow blur proportional to receiver distance from the blind plane.
- Slat top faces are sunlit at grazing incidence and glow; undersides are lit by bounce from sill and floor. Slat specular sends a faint secondary ghost stripe onto the ceiling above the window (~2–5% of beam).

---

## 2. Light levels and colour

### Outdoors (clear, dry, ~2,000 m, 31° sun)

- Direct normal irradiance ≈ 900 W/m² *(est., Ineichen/Solis clear-sky at low turbidity)*; direct luminous efficacy 100–110 lm/W (Perez 1990 coefficients as implemented in https://github.com/ladybug-tools/ladybug/blob/master/ladybug/skymodel.py and EnergyPlus https://dmey.github.io/EnergyPlusFortran-Reference/proc/dayltgluminousefficacy.html ) → **direct normal illuminance ≈ 90,000–95,000 lux**.
- Direct on horizontal ground = 90,000 × sin 31° ≈ **46,000 lux**. Diffuse sky on horizontal ≈ **8,000–12,000 lux** (very clear, low aerosol). Global horizontal ≈ 55,000–58,000 lux.
- On the outside of an east-facing window plane: direct 90,000 × cos 31° × cos 8° ≈ 76,000 + sky ≈ 6,000 + ground bounce (asphalt 0.12 × 56,000 × 0.5) ≈ 3,400 → **≈ 85,000 lux**.
- Exterior luminances seen through the glass: sunlit aged asphalt 56,000 × 0.12 / π ≈ **2,100 nits**; sunlit pale stucco/concrete (ρ 0.5) ≈ **8,900 nits**; sunlit desert dirt (ρ 0.3) ≈ 5,300 nits; clear sky near horizon away from sun 4,000–6,000 nits, zenith 2,000–3,000 nits, within 20° of the sun 10,000–30,000 nits; solar disc 1.6 × 10⁹ nits.

### Through the glass, on interior surfaces

- Clear 6 mm float: 88–89% visible transmittance, 8% reflectance total (≈4% per surface) at normal incidence; still ≈87% at the 32° incidence here. https://www.guardianglass.com/mx/en/our-glass/guardian-clear/clear , https://www.vitroglazings.com/media/rnff0xlj/tds_clear.pdf
- Beam after glass ≈ 78,000 lux normal to the ray. **On the floor: ≈ 40,000 lux. On a vertical surface facing the window: ≈ 66,000 lux.**
- Sky fill through a window is small: diffuse illuminance inside ≈ DHI × window view factor ≈ 10,000 × 0.05–0.15 = **500–1,500 lux** within 1 m of the glass, falling to ~100 lux at 4 m. Do not put the outdoor 10,000-lux hemisphere inside the room.
- Fluorescent ambient: IES RP-2 casual dining 215–538 lux, cafeterias 200–300 lux https://diningroommanagement.com/lighting-standards-for-dining-rooms/ , https://www.ledvance.com/en-us/professional-lighting/insights/blog/lighting-basics/recommended-lighting-levels . Old small-town diners with a few 2×4 troffers: **250–350 lux on tables, ~150 lux on vertical surfaces** *(est.)*. Use **300 lux** as the design value.

### Fluorescent troffers

- 2×4 recessed prismatic troffer, three F32T8 lamps at 2,800 lm each; luminaire output **≈ 5,850 lm** (efficiency 69.7%); measured **lens luminance ≈ 4,200 nits at nadir**, ~4,000 nits at 30°, dropping to ~1,000 nits at 60°. Metalux 2GC-332A photometric report https://www.webtools.cooperlighting.com/Public/files/ies/instabase/METALUX/RECESSED%20STATIC/GC8/2%20X%204/NY-2GC8-332A19_156.pdf ; spec sheet https://www.assets.cooperlighting.com/is/content/CLS/metalux-troffer-2gc-2x4-3lampt8-specsheet
- Lamp colours: F32T8/835 = 3500 K, F32T8/841 = 4100 K, CRI 82–85; older halophosphate "Cool White" 4100 K, CRI 62 (greener, dingier). Emitted colour in a D65 pipeline ≈ sRGB (255, 214, 170) for 3500 K, (255, 224, 190) for 4100 K, plus a **+3–5% green bias** (mercury 546 nm line) — the classic slightly green-cyan fluorescent cast versus the sun.
- **Why they "lose the fight" (numbers):**
  - Sunlit Classic White VCT (ρ 0.57): 40,000 × 0.57 / π ≈ **7,300 nits**. Sunlit white Formica (ρ 0.8): ≈ **10,000 nits**. The lamp lens itself is only **4,200 nits** — the floor is brighter than the light fixture.
  - Fluorescent-lit white Formica: 300 × 0.8 / π ≈ **76 nits**; fluorescent-lit floor ≈ 55 nits. Sun patch : fluorescent-lit same surface = **133 : 1 ≈ 7.1 stops** (horizontal), **440 : 1 ≈ 8.8 stops** on vertical surfaces facing the window.
  - Sunlit red vinyl (linear ρ ≈ 0.40, 0.02, 0.02): red channel ≈ 5,100 "nits" while G/B ≈ 250 — the red channel clips 3–4 stops before green/blue, so sunlit vinyl goes hot salmon/orange-pink at the highlight, not white.
  - Exterior through the glass is 2,000–9,000 nits vs interior 20–100 nits: 5–7 stops. Interior reflections in the window are 8% × 50 nits ≈ 4 nits — invisible in daytime except against a dark parked car.

### Colour temperature

- Direct sun at 31° elevation: **≈ 5,000–5,300 K** in clean, dry, high-altitude air *(est. from the elevation-dependence data; turbid sea-level air gives ~4,500 K at 30°)*. References: JOSA A 33, 1049 (2016) simulated sunlight/skylight CCT vs zenith angle https://doi.org/10.1364/josaa.33.001049 ; Granada 2-year measurements (≈5,750 K midday, rising steeply only near sunrise/sunset) https://doi.org/10.1186/1687-5281-2013-14 ; discussion https://physics.stackexchange.com/questions/66448
- Golden hour = sun below ~10°: **3,000–3,800 K**. At 08:00 the sun is 31° up, i.e. 2.8 h past sunrise — firmly out of golden hour.
- **"Hot morning white-yellow, not golden" in numbers**: sun 5,100 K ≈ sRGB (255, 230, 210) in a D65-balanced pipeline (chroma ≈ 1/3 of a 3,500 K (255, 196, 137) golden-hour sun). If the render is white-balanced to 5,600 K (daylight film), the sun reads almost neutral (255, 246, 236) and the fluorescents read distinctly amber-green — that is the film look.
- Clear blue skylight: 10,000–20,000 K and beyond (deep-blue high-altitude sky); D65 sRGB ≈ (150, 185, 255) near zenith, (200, 215, 235) hazy near horizon. Skylight is the only cool light in the scene and only reaches ~1 m past the glass.
- Shadow colour inside the room: shadows within the sun patch are filled by (a) sky through the window — cool — and (b) bounce from the sunlit floor/formica — warm-neutral, or red where vinyl is sunlit; shadows away from the window are filled by fluorescents (3,500–4,100 K, green bias). Net: **near-window shadows slightly cool; everything else slightly warm-green.** Never blue-black shadows deep in the room.

### Suggested Three.js values (r155+ lighting model, `useLegacyLights = false`, 1 unit = 1 m)

- In the r155+ model there is no π scaling: a DirectionalLight of intensity E on albedo ρ gives radiance ρ·E/π, exactly the lux→nits relation, so **DirectionalLight.intensity can be used as lux and outgoing values are nits** even though the docs do not formally assign SI units to directional/hemisphere lights. Point/spot are in candela; RectAreaLight `power` is in lumens with intensity = power / (width·height·π), i.e. **nits**. https://discourse.threejs.org/t/updates-to-lighting-in-three-js-r155/53733 , https://threejs.org/docs/pages/RectAreaLight.html
- Work at a global scale **k = 0.01** (1 unit = 100 lux / 100 nits) to keep half-float render targets (max 65,504) safe around specular highlights, then fold k into exposure. Values below are given as physical / ×k:
  - Sun DirectionalLight: **78,000 lux / 780** (already includes glass transmission; if the glass is a real transmissive mesh in the shadow path, use 90,000 / 900 and let the material attenuate). Colour sRGB (255, 230, 210). Shadow: cascaded or tight-fit orthographic, 4k map, PCSS with light size 0.53° → blur radius 9.3 mm/m of receiver distance.
  - Exterior sky (for what the window sees and for exterior geometry): HemisphereLight **10,000 / 100** sky (150,185,255) ground (asphalt tan/grey) ~ (110,105,100); or better an HDRI/analytic sky whose horizon reads ~5,000 nits and zenith ~2,500 nits.
  - Interior sky fill: **300–800 lux / 3–8** near windows (a RectAreaLight the size of each window, colour (150,185,255), intensity ≈ 4,000 nits / 40 approximates the sky patch seen through the glass and gives correct falloff), or probes/lightmaps. No global interior ambient above ~50 lux / 0.5.
  - Troffers: RectAreaLight 0.61 × 1.22 m, `power` = 5,850 lm → intensity ≈ **2,500 nits / 25**; measured nadir lens luminance is 4,200 nits because the prismatic lens is not Lambertian — set the visible lens **emissive ≈ 4,000 nits / 40** (3500 K (255,214,170)+green, or 4100 K (255,224,190)+green). A 12 m × 6 m room with 6–8 such fixtures gives ~300 lux average.
  - Bounce: the 40,000-lux floor patch is the room's second key light. Ensure GI (lightmap / SSGI / probes) — a sunlit white VCT patch of 2 m² throws ~1,000–2,000 lux onto adjacent booth backs and the ceiling above.
- **Exposure (film practice: expose so the interior reads, let the sun clip).** Saturation luminance L_sat = 1.2 × 2^EV nits (Lagarde). Middle grey of an 18% surface at E lux = 0.057·E nits. Options:
  - EV 6.5: fluorescent 300-lux mid-grey → 0.18 (textbook interior exposure). Sun patch +7 stops, sky +5 → windows pure white, patch a featureless blob. Too much.
  - **EV 8.0–8.5 (recommended)**: L_sat ≈ 307–434 nits → `toneMappingExposure = 1 / L_sat / k` ≈ **0.23–0.33 at k = 0.01**. Fluorescent 300-lux surfaces land at 0.04–0.06 linear (≈ −1.7 stops, dim but fully readable, print-shadow territory); sunlit white floor lands +4 to +4.5 stops over → after AgX/ACES ≈ 0.95–1.0 with a soft shoulder ("slightly overexposed whites"); sunlit red vinyl clips red only; asphalt outside +2 stops (bleached but readable); pale stucco +4.5 stops (white); sky +4 stops (white with a faint blue in the shoulder). Reference point: a real Leica shot of blind stripes in a diner was made at 28 mm f/5.6 1/125 ISO 200 = EV 12.9 — exposed for the stripes, interior dark https://photos.kennethreitz.org/images/63137693-c672-4c66-a385-d68519efe5e6/ . The photoreal target sits between those two: EV 8–9.
  - Tone curve: **AgX** (hue-preserving shoulder; keeps the red vinyl red as it clips). ACES pushes clipped reds toward orange-yellow; if ACES is used, desaturate highlights (≈ 0.9 × chroma above 0.8) to fake the same behaviour. Slope toward white should start ≈ +2 stops above middle grey and reach 1.0 by +4.5 stops — film-like. Keep black point at ~0.005–0.01 (not 0).

---

## 3. Photographic look references

### Gregory Crewdson (Beneath the Roses 2003–08; Cathedral of the Pines 2013–14)

- Cameras: 8×10 view camera (Beneath the Roses), Phase One set up like a view camera (Cathedral). Interviews: https://petapixel.com/2016/05/18/interview-gregory-crewdson/ , https://gregorycrewdson.substack.com/p/deep-dive-4-intro-to-the-soundstage
- Depth of field: effectively **infinite** — f/45+ on 8×10 plus 40–50 negatives at different focus/aperture composited so "the constant depth of field gives a hyperrealist impression" https://artblart.com/tag/gregory-crewdson-beneath-the-roses/ . Emulate with **no DoF at all** (or CoC ≤ 1 px) and no bokeh.
- Lighting: continuous HMI on lifts as "daylight"; DP Rick Sands. Cathedral interiors: "the main narrative light comes from the exterior … practical lights are on, but the guiding light is the one from the exterior" https://gagosian.com/media/gallery/press/2016/5aff235bc5e2b237bd207ef8219b2916.pdf — exactly this scene's structure (window key, fluorescent practicals losing).
- Measurable character *(est. from the prints)*: overall lighting ratio **2:1–4:1** across the frame (fill lifted); print black ≈ 3–5% luminance, never 0; highlights held (multiple exposures) — windows glow at ~95% but keep faint detail; colour: earth tones, low saturation (chroma ≈ 60–70% of a straight capture), cool-neutral ambient against warm practicals; **no grain, no bloom, no flare**, edges sharp everywhere; atmospheric haze in Beneath the Roses (smoke machines) — not appropriate for a dry 8 AM diner, except thin grill haze from the kitchen pass.

### Terrence Malick / Emmanuel Lubezki (Tree of Life, To the Wonder)

- The "dogma": available natural light; never underexpose ("we want the blacks, we don't like milky images"); preserve latitude; fine grain (1.85, Vision2 stocks, 35 mm Arricam); deep focus ("compose in depth"); backlight; negative fill; no flares (mostly); avoid white and primaries in frame; no filters. https://www.filmdetail.com/2012/02/14/emmanuel-lubezki-wins-the-asc-award-tree-of-life/ , https://www.icgmagazine.com/web/sights-unseen/
- Interiors: subject beside a window, key from the window, **no fill on the shadow side** (face ratio 4:1–8:1 = 2–3 stops); windows run **+3 to +5 stops over key** and roll into soft white on the film shoulder with a trace of colour; **true blacks** present in the frame. An HMI supplement was tried and sent back — it did not look like the sun.
- Lenses 12–27 mm Master Primes at T2.8–T4 on Super35 → DoF similar to 35 mm at f/5.6–f/8 on full frame. Steadicam movement; handheld feel is optional here.
- Colour: "pellucid" — neutral whites, pink skin, sky and grass bounce as visible coloured fill through windows. No LUT-style teal/orange.

### Depth of field at 35 mm, full frame, CoC 0.030 mm

- Hyperfocal: f/5.6 → 7.3 m; f/8 → 5.1 m.
- Focus 3 m: f/5.6 → sharp 2.1–5.2 m; f/8 → 1.9–7.4 m. Focus 5 m at f/8 → 2.5 m to ∞.
- CoC 0.030 mm = 1.6 px at 1920 px across 36 mm. Far-background blur when focused at 3 m, f/5.6, object at 8 m ≈ 0.046 mm = **2.5 px** — i.e. the whole image is nearly sharp; a chrome glint at 8 m is a 2–3 px disc, not a bokeh ball. Recommendation: physically based DoF with these numbers or none.
- No grain, no bloom, no chromatic aberration, no vignette beyond the natural ~0.3–0.5 stop corner falloff of a 35 mm lens at f/5.6.

### Real diner photographs (light on vinyl, chrome, Formica, checkered tile)

- **"Shadows in a Diner", Kenneth Reitz, Leica M10, 28 mm f/5.6, 1/125 s, ISO 200** — https://photos.kennethreitz.org/images/63137693-c672-4c66-a385-d68519efe5e6/ . Blind stripes across tables and chairs; exposed for the stripes (EV 12.9), so the interior goes to deep tone; stripes on horizontal table tops are crisp near the window and soften with distance; verticals (chair legs) cut the stripes with sharp edges. B&W — use for tonal structure only.
- **Selena's Diner, Haines Falls NY (Nancy de Flon)** — https://fstopnancyphoto.me/2012/09/06/a-photogenic-diner/ . Low sun forming "long streaks of light" the length of the diner across Formica tables and vinyl; note how the streaks on the table tops show the Formica's semi-gloss as an elongated soft highlight, and how the vinyl seat fronts catch the light as a saturated red band with a narrow hot edge. Processed with raised clarity — mentally reduce the local contrast.
- **Whately Diner, MA (photo essay, daytime interior)** — https://medium.com/@fmduffy/24-hour-diner-whately-diner-b1951128fea1 . Stainless counter and chrome stools under mixed daylight + fluorescents: chrome shows the checker floor and ceiling as sharp but slightly smeared reflections, the stainless counter face reads as a soft gradient (brushed anisotropy), and the fluorescent-lit rear looks flat and slightly green relative to the window side.
- **Owego NY historic diner stools and glass tile** — https://ramblinwitham.blogspot.com/2025/01/diner-shadows-shadowshotsunday.html . Stool shadows on VCT; note the double shadow (window + fluorescent) and the reflection of the stool in the waxed tile directly beneath it.
- **Unsplash: "Retro diner interior with red and chrome accents"** (checkerboard floor, red booths, no direct sun) — https://unsplash.com/photos/retro-diner-interior-with-red-and-chrome-accents-CQ7W9FTpr2E . Useful for the "white" tile actually being warm grey, and the red vinyl reading as (150–170, 20–35, 30–40) under fluorescents.
- Caution: Lummi / Vecteezy "golden diner" results are AI-generated (Vecteezy labels them) and exhibit the exact CG tells listed in §6 — do not use as references.

---

## 4. Material measurements (for procedural generation)

All roughness values are for the GGX/Three.js `roughness` parameter; dielectrics use F0 ≈ 4% (`specularIntensity` 1, IOR 1.5) unless noted.

### Red vinyl upholstery (expanded PVC, e.g. Naugahyde Spirit Millennium / Zodiac)

- Spec: 37 oz/yd², 54" wide, "smooth leather grain", Advanced BeautyGard topcoat, UV-stable pigment https://carolynfabrics.com/products/spirit-millennium , https://www.naugahyde.com/catalog/pattern.cfm?iteID=4175
- Colour: cherry/bright red ≈ **sRGB (160–180, 20–30, 25–35)**, linear ≈ (0.36–0.45, 0.01, 0.015). Sun-facing booths fade toward (190, 60, 55) and lose gloss; under fluorescents the same vinyl photographs as (150, 25, 35).
- Shading: base roughness **0.45–0.6**; **clearcoat 0.3–0.6, clearcoatRoughness 0.15–0.3** for the topcoat sheen (sheen appears as an elongated soft highlight along bolsters; the red stays saturated under it). Grain: embossed leather grain 0.5–1.5 mm cells, normal-map amplitude ~0.05–0.1 mm; seat fronts polished smoother by use (roughness −0.15).
- Cracking: plasticiser loss → crazing on seat-front edges, back tops and armrests: polygonal cells **3–15 mm**, crack width **0.2–1 mm**, edges curl upward; cracks expose the **light grey/white knit backing, so cracks are LIGHTER than the vinyl**, not dark https://rubnrestore.com/how-to/cracking-vinyl/ . Silver duct-tape patches (50 mm wide) are period-correct.
- Geometry: welt/piping cord **4–5 mm dia (5/32")** in a ~6 mm sleeve along every seam; channel tufting on backs: vertical pleats **75–100 mm** wide, 15–25 mm deep; seat 0.46 m high, 0.45 m deep, bolster radius 25–40 mm; booth back 1.0–1.1 m; 4-top booth length 1.8–2.2 m; visible stitching 3–4 mm pitch.

### Formica / high-pressure laminate

- Boomerang (originally "Skylark", Brooks Stevens, 1950/51; re-issued 2023 as Aquamarine, Atomic Pink, Sunglo) https://www.formica.com/en-us/press-room/boomerang-launch . Stock item 6942 Charcoal Boomerang in 58 Matte https://www.formica.com/en-us/products/lamtrade/06942
- Motifs: boomerang shapes **20–40 mm long, ~4–6 mm stroke**, random rotation, density ≈ 1 per 10–15 cm², two tones (light grey + white on charcoal; white + cream on turquoise/red). Also common: "Cracked Ice" (crackle cells 3–8 mm), "Linen" (fine 0.5 mm weave), marble/Carrara veining 20–60 mm.
- Colours: Charcoal base ≈ (45, 45, 48); classic diner turquoise ≈ (80, 170, 165); red ≈ (170, 35, 40); cream ≈ (235, 225, 200).
- Finish: **58 Matte ≈ 5–10 GU → roughness 0.5–0.65; 90 Gloss ≈ 80+ GU → roughness 0.10–0.15**. Old diner tabletops are worn gloss: roughness **0.25–0.4** with directional wipe scratches (anisotropy 0.2–0.4 along the wipe direction) and matte elbow patches (roughness 0.5) at seat positions; cigarette burns 8–10 mm brown ovals; edge: ribbed aluminium band 32 mm (1¼") with yellowed adhesive line.
- Table: 1.2 × 0.75 m top, 0.74 m high, 25–32 mm thick (particleboard core; chipped corners show tan core).

### Checkered VCT floor (12" vinyl composition tile)

- Armstrong Standard Excelon Imperial Texture, 12" × 12" × 1/8" (305 × 305 × 3.2 mm), square edges, "non-directional tone-on-tone" fleck, through-pattern; factory 60° gloss **20–40 GU** ("Fast Start" finish, polish required). https://www.floorexpert.com/knowledge-base/standard-excelon-imperial-texture-vinyl-composition-tile-data-sheet/
- **Classic Black 51910: light reflectance 0–9%** https://www.armstrongflooring.com/commercial/en-us/products/vinyl-composition-tile/std-excelon-imp-texture/item/51910.html → linear albedo ≈ 0.05, sRGB ≈ (60, 60, 62) with lighter grey flecks 1–3 mm.
- **Classic White 51911: light reflectance 55–59%** https://www.armstrongflooring.com/commercial/en-us/products/vinyl-composition-tile/std-excelon-imp-texture/item/51911.html → linear ≈ 0.57, **sRGB ≈ (198, 196, 190) — a warm grey, not white**, with darker grey flecks. Pure (255,255,255) tile is a CG tell.
- Waxed (3–5 coats acrylic finish): gloss 70–90 GU → model as **clearcoat 1.0, clearcoatRoughness 0.10–0.18** over a base roughness 0.5. Window and fixture reflections are clear but slightly wobbly (subfloor unevenness ±1 mm over 300 mm → normal perturbation 0.2–0.4°).
- Seams: butt joints **0.2–0.5 mm**, no grout; dirt-filled hairline darker than either tile; alignment drift ±1 mm; occasional cracked corner or lifted edge; grid runs parallel to the counter, not the walls, in many diners.
- Wear: traffic lanes (door → counter → booths) roughness up to 0.35–0.5 with the clearcoat worn to 0.3; finish yellowing near walls and under booths (white tile shifts toward (205, 195, 170)); black heel marks 20–80 mm streaks; chair-leg scuffs; a 0.6 m matte ring at each stool. Sunlit patch shows every scuff as a dark mark and every gloss variation as a bright/dim mottle — that mottle is the realism.

### Chrome (stools, table edges, napkin dispensers)

- Decorative chrome reflectance **60–70% visible**, peaking blue-green, weaker in red https://eureka.patsnap.com/report-chrome-plating-vs-metalizing-surface-reflectance-studies ; bulk Cr n,k ≈ 3.1 + 3.3i at 550 nm https://refractiveindex.info/?book=Cr&page=Johnson&shelf=main . Use `metalness 1`, base colour linear ≈ **(0.60, 0.63, 0.66)** (sRGB ≈ (203, 208, 212)).
- Roughness: showroom 0.05–0.08; **real diner stool rings and rails 0.15–0.25** with fingerprint smudges (patches 10–20 mm, roughness 0.3–0.45, reflectance −5%); dull spots where chrome has bloomed/pitted to the nickel: roughness 0.4–0.6, colour warm grey (0.5); rust freckles at welds (0.5 mm, brown).
- Spun tubes/rings: **anisotropy 0.4–0.7** aligned with the circumference (brushed stainless counter faces 0.6–0.8 along the grain, roughness 0.3).
- What chrome shows: mostly ceiling (grey-white) and floor (the checker pattern reflected as red/black/white bands on the stool column) plus the window as a hot elongated highlight. Reflections must include the room, not a generic HDRI.

### Acoustic ceiling tile (fissured mineral fibre, e.g. Armstrong Cortega 769, 24 × 48 × 5/8")

- Light reflectance **0.80–0.83** (white) https://www.armstrongceilings.com/commercial/en/commercial-ceilings-walls/cortega-lay-in-ceiling-tiles/item/769.html → linear 0.8, sRGB ≈ (230, 230, 226); latex paint finish, roughness **0.85–0.95**, no clearcoat. NRC 0.55.
- Fissures: non-directional, **5–30 mm long, 1–3 mm wide, 1–2 mm deep**, ~3–6 per 100 cm²; pinholes 1–2 mm at 2–4 per cm² *(est. from product photos; manufacturer does not publish geometry)*.
- Ageing: yellow-tan (215, 205, 180), reflectance 0.6–0.7; brown water-stain rings 100–300 mm; sag 3–6 mm at tile centre; grid T-bar 24 mm (15/16") white, roughness 0.4, slight bow. Grease/nicotine gradient darkest above the grill pass.

### Painted drywall

- Eggshell 10–25 GU → roughness **0.55–0.7**; flat ≤ 5 GU → 0.85–0.95; semi-gloss (kitchen pass, trim) 35–70 GU → 0.3–0.45. Orange-peel texture: bumps 1–3 mm, height 0.2–0.5 mm.
- Colours: cream/Navajo white (235, 222, 195), mint (200, 225, 205), or white; a scuff/rub band at 0.7–1.1 m from chair backs; darker grease gradient toward the ceiling near the kitchen; chalk-dust matte near the sunlit wall where UV has flattened the paint.

### Window glass

- Clear float 6 mm: **T = 88–89%, R = 8% total (≈4% per surface)** at normal incidence; IOR 1.52; slight green tint in thick edges. https://www.vitroglazings.com/media/rnff0xlj/tds_clear.pdf , https://www.nationalglass.com.au/assets/main/Energy-Performance-Data-v45-min.pdf
- Fresnel: reflectance climbs to ~100% at grazing; daytime interior reflections are ≈ 4 nits vs 2,000–9,000 nits outside → invisible except against dark exterior objects.
- Dust film (inside greasy haze + outside desert dust): transmission −5–10%, adds **1–3% forward-scatter haze** (a faint veil/glow around the bright exterior when viewed from the shadow side), streaky wipe marks, roughness 0.05–0.15 modulated by a dust mask. Corners and lower edge dustier. Occasional tape residue / sun-faded decal.
- Model: `MeshPhysicalMaterial` transmission 0.88, ior 1.52, thickness 0.006, roughness 0.02–0.1 (dust), attenuation faint green over metres only.

### Aluminium venetian slats (50 mm)

- Aluminium 0.18–0.21 mm, baked enamel. Colours: white (245, 245, 240) or alabaster/ivory (238, 232, 218); gloss 20–30 GU → **roughness 0.35–0.45**, dielectric (painted), F0 4%; not metallic.
- Sag: 1–2 mm between ladder cords (ladders every 0.55–0.6 m), individual bent/kinked slats ±5–10 mm, a couple of slats reversed or hooked; dust on upper faces (upper face roughness +0.15, albedo −5% but appears brighter because it faces the light); ladder cords 1.5 mm, tilt wand, bottom rail 50 × 12 mm.
- Under direct sun the slat tops receive 78,000 × sin(β − θ) lux — a few thousand lux at the specified near-parallel tilt on an east window, up to ~20,000 lux at θ = 30° on a SE window — so they glow as bright grazing-lit strips, and their specular sends faint ghost stripes onto the ceiling above the window.

### Ceramic diner mug (Victor-style heavy mug)

- 9–10 oz, ~89 mm tall, 83 mm dia, wall **5–6 mm**, ~400 g; off-white/ivory glaze **sRGB (236, 228, 212)**; glaze **roughness 0.08–0.15**, F0 4–5% (no clearcoat needed — the glaze is the specular layer); subtle orange-peel 0.5 mm in the glaze; rim chips 2–5 mm exposing bisque (roughness 0.7, colour (225, 215, 200)); brown coffee ring inside 5 mm below the rim (linear 0.25 brown); faint crazing lines on very old mugs.

### Glass coffee carafe with coffee (Bunn-type 64 oz decanter)

- Borosilicate, IOR 1.47, wall ~2 mm, 165 mm dia × 180 mm tall; handle black/brown (regular) or orange (decaf); brown mineral/coffee stain ring at the fill line.
- Brewed coffee in Three.js `MeshPhysicalMaterial` transmission: **attenuationColor ≈ sRGB (110, 45, 12), attenuationDistance ≈ 8–15 mm**; body reads black, the last 5–10 mm at the edges and meniscus glow deep amber/red when the sun is behind the carafe *(est.; at 1 cm path coffee transmits ~1–3% blue, ~10% red)*. Surface of coffee: roughness 0.02, thin foam ring. Sunlit carafe throws a caustic amber crescent onto the counter 50–150 mm long — bake or fake it.

### Cracked asphalt and faded parking lines (seen through the windows)

- Albedo: new asphalt 0.04–0.05, **aged 0.10–0.15 (asymptote ≈ 0.12 after 3–5 years)** https://eta-publications.lbl.gov/sites/default/files/lbnl-49283.pdf , http://overlays.acpa.org/Downloads/RT/RT3.05.pdf . sRGB ≈ (98, 96, 93); fresh sealcoat patches 0.06 (55, 55, 55); aggregate exposed at the surface gives 3–8 mm speckle (linear 0.2–0.3).
- Alligator (fatigue) cracking: interconnected polygons **< 0.6 m** on the long side, typically 100–400 mm cells, crack width 3–15 mm https://www.tarmacview.com/glossary/alligator-cracking/ ; longitudinal cracks along the wheel paths; cracks filled with black sealant (0.03) or light dust/sand (0.3); oil drips 0.4–0.8 m dark ovals at stall heads; concrete curb stops 1.8 m × 0.15 m (0.35 albedo).
- Parking lines: 100 mm (4") wide, stalls 2.7 × 5.5 m; fresh white traffic paint linear 0.75; faded to 30–70% coverage, colour (200, 195, 180), edges eroded, missing where wheels ride. Yellow (Federal Yellow) fades to (210, 185, 110).
- Roughness 0.7–0.9 with weak retro-reflective sparkle from aggregate; at 8 AM with the sun 31° up the lot is 46,000 lux → 1,800–2,100 nits — bleached grey, not black.

### Heat shimmer (over the lot, seen through the glass)

- Physics: n_air ≈ 1.000274 at 20 °C, dn/dT ≈ −1 × 10⁻⁶ per K; ray deflection ≈ path length × |∇n|. At 08:00 the asphalt is only ~35–45 °C over ~20–25 °C air (Flagstaff air is 14–18 °C at 8 AM; Holbrook/Gallup 20–24 °C), so gradients of 3–8 K/m within 0.3 m of the surface give deflections of **~10⁻⁴ rad over 30 m ≈ 0.3 px at 1080p / 35 mm**. It is barely visible; noticeable only at grazing views along a long road. https://ntrs.nasa.gov/api/citations/20040040297/downloads/20040040297.pdf , real-time treatments https://arxiv.org/pdf/2603.02048
- Screen-space recipe if used: distortion amplitude **0.3–1.0 px** (1080p), horizontal noise 8–15 cycles/screen width, vertical scroll 0.3–0.8 screen-heights/s (plumes rise 0.5–1 m/s), temporal 3–8 Hz, two octaves. Mask = window pixels × background depth > 15 m × height above ground < 1.5 m × distance factor. Do not distort the window frame or blinds. If in doubt, omit — over-strong shimmer is a CG tell at this hour.

---

## 5. Dust in sunbeams

- Sizes: visible motes are **10–100 µm**; the sparkly ones 20–50 µm. Sub-10 µm dust is present in far greater numbers but invisible to the eye/camera.
- Settling speed (Stokes): 5 µm ≈ 0.08 cm/s, 10 µm ≈ 0.3 cm/s, 20 µm ≈ 1.2 cm/s, 50 µm ≈ 8 cm/s https://eprints.gla.ac.uk/111678/1/111678.pdf , https://inspectapedia.com/indoor_air_quality/Gravitational-Particle-Settling-Murakami.pdf . Room convection (5–20 cm/s, rising in the sun patch, falling at cold glass) dominates → motion is a slow **1–5 cm/s drift with lazy curls**, slight downward bias, occasional 10–20 cm/s gusts when a door opens.
- Density: typical indoor coarse dust ≈ 10³–10⁴ particles/m³ above 10 µm *(est.)* → a 1 m³ beam shows **a few hundred visible motes at any moment**; visually ~50–300 on screen inside the beam, near zero outside it.
- Visibility is **forward scattering**: Mie scattering for >10 µm particles concentrates within ~5–10° of the forward direction and falls off steeply; there is a weak rise again beyond ~120° from reflection https://pmc.ncbi.nlm.nih.gov/articles/PMC5540421/ , HSE dust-lamp note https://www.toxicdocs.org/d/zo55k6wVKwEa07jdQKbQ3Jdra . Practical: brightness ∝ Henyey-Greenstein with **g ≈ 0.7–0.85**; motes are vivid when the camera looks toward the window (sun within ~40° of the view axis), faint at 90°, invisible with the sun behind the camera.
- On screen: a 30 µm mote at 2 m subtends 3 arcsec ≈ 0.05 px → render as the lens PSF: **1–2 px soft dot**, brightness comparable to the sunlit floor patch (0.5–1.0 after tone mapping) at forward angles; with a 1/60 s shutter and 2 cm/s drift the streak is 0.3 mm — no visible motion blur. Only motes inside the beam volume are lit; a mote crossing a slat shadow blinks off.
- The beam itself is invisible in clean dry air. Extinction ≈ 0.01–0.03 /m only with kitchen haze → volumetric brightness ≤ 1–3% of the floor patch per metre. Keep any god-ray pass ≤ 2% intensity, or omit; strong visible shafts at 8 AM in a dry-air diner are a CG tell.

---

## 6. Common CG tells for this scene, and what photographs do instead

- **Razor-sharp blind stripes everywhere.** Photos: crisp within ~1.5 m of the blind, blurred 13–32 mm by the 0.53° sun further away; stripe contrast falls with distance.
- **Pure-white tile, pure-white ceiling, pure-black tile.** Photos: white VCT ≈ 0.57 reflectance (warm grey), black VCT ≈ 0.05 with flecks, ceiling ≈ 0.8 yellowing to 0.65.
- **Uniform gloss.** Photos: gloss is a map — traffic lanes matte, edges glossy, elbow spots dull, fingerprints on chrome; the sun patch reveals mottle.
- **Cracks and seams drawn dark.** Vinyl crazing exposes light backing (bright cracks); VCT seams are dark hairlines but tiles also mismatch by ±1 mm and tilt slightly.
- **No contact shadows / floating objects.** Every stool base, sugar shaker, napkin dispenser and mug has a tight 1–3 mm dark contact occlusion and a second soft shadow from the fluorescents (double shadows are a photographic signature of this scene).
- **Missing bounce.** The 40,000-lux floor patch lights the underside of tables, the booth backs and the ceiling above it; in CG without GI those stay fluorescent-flat.
- **Wrong window exposure.** Photos exposed for the interior show the exterior as bleached-but-readable asphalt (+2 stops) and white sky (+4); pure grey "correctly exposed" exteriors or fully black windows both read as composites.
- **Visible interior reflections in daytime glass.** At 4 nits vs thousands they do not show; only dark exterior areas (car shadows) reveal faint room reflections.
- **Perfect edges.** Real edges: Formica edge band with a 0.5 mm radius and dents; drywall corners with 3 mm radius corner bead; slats with 0.5 mm rolled edges; tile corners chipped; booth piping slightly wavy (±2 mm).
- **Perfect alignment.** Fixtures 5–10 mm off the ceiling grid, blinds hanging 1–2° off level, a slat or two flipped, tables not parallel to the tile grid, stools rotated randomly, ceiling grid bowed.
- **Uniform dirt.** Photos show gradients: dark grease band above the grill, yellowed finish at wall edges, clean stripes where the mop reaches, dust heaviest on horizontal ledges and the top faces of slats, none on vertical faces.
- **Over-saturated red.** Real vinyl under fluorescents is (150, 25, 35); only the sunlit strip goes to salmon; ACES turning that toward orange-yellow is a tell — use AgX or highlight desaturation.
- **Blue shadows deep in the room.** Sky fill dies within ~1 m of the glass; deep-room shadows are warm-green fluorescent.
- **Bloom, lens flare, chromatic aberration, heavy vignette, film grain.** None in the Crewdson/Lubezki register; 35 mm at f/5.6 has ≤ 0.5 stop corner falloff and no visible CA.
- **Volumetric shafts and heavy dust.** Dry-air beams are invisible; motes only in the beam, only toward the sun.
- **Fluorescents that "win".** Lens luminance is 4,200 nits, below the sunlit floor; on the sun side they should look switched-on-but-pointless, slightly green, and their light should only be evident on the far side of the room.
- **Static noise textures at one scale.** Real wear has 3 scales: 0.5–1.5 mm grain, 20–80 mm scuffs/smudges, 0.5–3 m traffic gradients.
- **Sun colour too orange.** 08:00 sun is ≈ 5,100 K (255, 230, 210), not 3,500 K; the warmth in the frame comes from the fluorescents and the red bounce, not the sun.

---

## 7. Cheat sheet (values to copy into Systems 4 / 5 / 8)

The S4 rows (sun geometry, exposure, troffer, sky) are superseded by the as-built numbers in §8 — the brief fixed az 38° / el 35°, 5500 K, ISO 100 f/5.6, and the trials in §8 changed the exposure and troffer values.

| Quantity | Value | Owner |
|---|---|---|
| Sun elevation / azimuth | 31.1° / 82° (Flagstaff, 08:00 MST, Jun 20) | S4 |
| Sun direction vector (Y-up, +Z = south, +X = east) | normalize(−0.848, −0.516, +0.119) pointing from sun toward scene | S4 |
| Direct sun through glass | 78,000 lux, sRGB (255, 230, 210), angular size 0.53° | S4 |
| Floor patch (east window, sill 0.85 m, head 2.10 m) | 1.40–3.45 m from wall, skewed 0.2–0.5 m south | S4 |
| Stripe pitch on floor / recommended blind | 70.6 mm (E) or 43 mm (SE); SE window, θ = 30° → 43% dark | S4 |
| Penumbra | 9.3 mm per metre from blind | S4 |
| Interior sky fill | 300–800 lux near glass, ≤ 100 lux at 4 m, (150, 185, 255) | S4 |
| Troffer | 0.61 × 1.22 m, 5,850 lm, RectAreaLight ≈ 2,500 nits, lens emissive 4,000 nits, 3500/4100 K + 3–5% green | S4 |
| Fluorescent ambient | 300 lux horizontal, 150 lux vertical | S4 |
| Exposure | EV 8.0–8.5; `toneMappingExposure` ≈ 0.23–0.33 at scale k = 0.01; AgX | S8 |
| DoF | 35 mm f/5.6–f/8, CoC 0.03 mm (≈1.6 px); effectively sharp; no bloom/CA/grain | S8 |
| White VCT | linear 0.57 (198,196,190), clearcoat 1.0 / cc-rough 0.10–0.18, base rough 0.5 | S5 |
| Black VCT | linear 0.05 (60,60,62) with flecks, same finish | S5 |
| Red vinyl | (165, 25, 30), rough 0.45–0.6, clearcoat 0.3–0.6 / cc-rough 0.15–0.3, crazing 3–15 mm light cracks | S5 |
| Formica (worn gloss) | rough 0.25–0.4, anisotropy 0.2–0.4; boomerang motif 20–40 mm | S5 |
| Chrome | metal, linear (0.60, 0.63, 0.66), rough 0.15–0.25 used / 0.05 pristine, aniso 0.4–0.7 on spun parts | S5 |
| Ceiling tile | linear 0.80 new → 0.65 aged (215,205,180), rough 0.9, fissures 5–30 mm | S5 |
| Drywall eggshell | rough 0.55–0.7, orange peel 0.2–0.5 mm | S5 |
| Glass | T 0.88, IOR 1.52, R 4%/surface, dust haze 1–3% | S5 |
| Slats | painted Al, (238,232,218), rough 0.35–0.45, sag 1–2 mm, ±5–10 mm kinks | S5 |
| Mug glaze | (236,228,212), rough 0.08–0.15 | S5 |
| Coffee | attenuationColor (110,45,12), attenuationDistance 8–15 mm | S5 |
| Asphalt | albedo 0.12 (98,96,93), alligator cells 100–400 mm, lines 100 mm wide faded to (200,195,180) | S5 |
| Dust motes | 1–2 px, 50–300 visible in beam, drift 1–5 cm/s, HG g 0.7–0.85, only inside beam | S4/S8 |
| Heat shimmer | ≤ 1 px at 1080p at 08:00; optional | S8 |

### Assumptions to confirm with the coordinator (pre-System 4)

- Location fixed as Arizona (MST, no DST). A New Mexico location at 08:00 MDT has the sun at ~20°, which changes every geometry number above.
- Window orientation: the stripe recommendation assumes an ESE/SE window. If the design locks an east window, either accept sheet-light with hairline shadows or lower the slat tilt to ~10–20° for 40–60% stripes.
- Glass modelled as a transmission multiplier (0.88) baked into the sun intensity rather than a refractive mesh in the shadow path.

---

## 8. As built — System 4 light rig (`src/scene/Lighting.ts`, measured on `shots/sys4-*.png`)

Where this section disagrees with §2/§7 it is because the brief fixed values (sun az 38° / el 35°, 5200–5600 K, 10–12 klm troffers, ISO 100 f/5.6 1/125–1/250) or because a trial showed the §7 number produced the wrong picture. The measured numbers below come from a float render-target probe (HDR nits before tone mapping), not from the PNGs.

### Scale and exposure

- Scene unit scale **K = 1e-4** (1 unit = 10,000 nits / lux). The §7 suggestion of k = 0.01 overflowed half-float on the sun disc and the specular lobe of the sun on the chrome; 1e-4 keeps the 90,000-lux sun at 9.0 and the glass-plane sky at ≈ 1.
- Camera **ISO 100, f/5.6, 1/160 s → EV100 = log2(5.6² · 160) = 12.29**. Saturation luminance L_sat = 1.2 · 2^12.29 ≈ **6,000 nits**; `toneMappingExposure = 1 / (L_sat · K) ≈ 1.67`; middle grey (0.18 of L_sat) = **1,080 nits**.
- 1/125 s (EV 11.94, grey 845 nits) was the first choice; the counter side then sat at −0.6 EV and the ceiling at +0.2 (rev 6 measurement) — a lit office, not a room the sun is winning. 1/160 buys the third of a stop that puts the fluorescent side where the reference photographs have it.
- Tone curve **AgX**, sRGB output, no gamma or contrast hacks. ACES was tried (`?tm=aces`): more contrast, but the clipped red channel of the sunlit vinyl goes orange-yellow and the hot sky through the slats goes cream. AgX keeps the vinyl red as it clips; the "two reds" (sunlit orange-red, shaded deep red) in Crewdson / Shore frames come from the material, not the curve.

### Measured HDR values (nits) and EV relative to middle grey

| Surface | nits | EV vs grey | Brief target |
|---|---|---|---|
| Sunlit Formica table (`booth`, p90) | 14,750 | +3.8 (core clips) | — |
| Sunlit red vinyl, stripe cores (`stripes`) | 2,000–3,500 | +0.9 … +1.7 | ≈ +1.5 |
| Sky through the slats, gap pixels (`window`) | 5,300 (p90) … 9,000 | +2.3 … +3.1 | exterior +2–3 over vinyl → yes (+1.5 over the vinyl stripes) |
| Lot asphalt through the door glass | ≈ 2,900 | +1.4 | +2.5 (asphalt albedo 0.135 is System 3/5's; a paler sealcoat would get there) |
| Troffer lens | 4,500 | +2.05 | ≈ 2 stops under sun patches → 1.7 |
| Ceiling tiles away from troffers (`length`) | 600–950 | −0.85 … −0.2 | — |
| Back wall behind the counter (`counter`) | 505 | −1.1 | counter side 2–3 under the window side |
| Counter top, fluorescent side | 436–510 | −1.3 … −1.1 | " |
| Counter die (`length`) | 165 | −2.7 | " |
| Vinyl seat in shade (`stripes`) | 140 | −2.9 | — |
| Stool seat tops | 180–200 | −2.5 | — |

Window side vs counter side: the sunlit vinyl stripes / table (+1.5 … +3.8) against the counter top / die (−1.1 … −2.7) is 2.5–5 stops; the brief's "2–3 stops" is met at the working surfaces and exceeded in the sun patches, which is what the Reitz frame does.

### Light list (all physical; scene value = physical × K)

| Light | Type | Physical value | Colour | Notes |
|---|---|---|---|---|
| `sun` (interior) | SpotLight 150 m out on az 38° / el 35°, cone 2.1° | 90,000 lux at the glass (candela = 90,000 · 150² · K) | 5500 K ≈ sRGB (255, 235, 220) | 4096² map, 3.5 mm texels, `bias −1.2e-4`, `normalBias 0.012`; **PCSS**, light angular radius 0.265° → penumbra 4.6 mm per metre of blocker–receiver distance (9.3 mm/m full width); `shadowMap.type = BasicShadowMap` + `installPcss` (shader-chunk patch); shadows rendered once at boot |
| `sunBeam` | detached SpotLight twin of `sun` | same | same | compare-mode depth texture for the System 8 dust / haze (`sampler2DShadow`); rendered right after `sun` in the shadow-once pass; not in the scene's light list |
| `sunLot` (exterior) | DirectionalLight, ortho frustum over the lot | 90,000 lux | same | 4096² map, ≈ 8 mm texels, fixed 8-tap PCF 1.2 texels (`shadow.radius = −1.2`), `normalBias 0.03`; casters = exterior only + the caster-only cone that shadows the building's footprint |
| Sky dome | `ShaderMaterial` scaled to nits (`scaleSky`) | horizon 5,500 nits, zenith ≈ 2,800; circumsolar ×(1 + 1.5 cos⁴) → ≈ 9,000 nits where the windows look, 13,750 next to the disc | authored gradient (near-white horizon → pale blue) | hemisphere average ≈ 4,500 nits → ≈ 15 klux diffuse on the lot; direct : diffuse = 51.6 : 15 = 3.4 : 1 (2.3 stops of shadow on the asphalt); also `scene.background` and the fog colour |
| Window sky fills | RectAreaLight per window, in the glass plane | 1,200 nits (physical 2,900 for ½ sky + ½ lot × 0.88 glass × 0.5 slat duty; the room probe carries the rest) | sRGB (205, 215, 232) — bluish-white | facing in |
| Floor-patch bounce | RectAreaLight per window on the aisle floor, facing up | 2,000 nits average over the reachable patch (3,250 on the lit stripes: 0.45 albedo × 22.7 klux / π) | sun × warm checker (0.47, 0.45, 0.42) | the warm second key on the ceiling, table undersides and the counter die; the dielectrics' probe is captured with the sun off, so this is their sun bounce |
| Troffers ×8 | RectAreaLight 1.11 × 0.51 m per 2×4 troffer | **7,500 lm** (4 × 2,850 lm F32T8 = 11,400 initial × 0.68 luminaire efficiency × 0.88 ballast × 0.85 depreciation ≈ 5,800 maintained; 7,500 keeps them visibly working) → ≈ 900 lux over 68 m² | 4100 K sRGB (255, 224, 190) + 4 % green | lens emissive 4,500 nits (Lambertian = lm / (area·π) = 4,200) |
| Ambient (diffuse) | `scene.environment` = PMREM of a 512² cube probe at (−2.3, 1.3, −0.2), **captured with the interior sun off**, two passes (pass 2 sees pass-1 lighting) | — | — | dielectrics; keeps the sun patches from double-counting through the probe's blur |
| Ambient (specular) | second probe at the same point **with the sun** | — | — | assigned to every metal (`metalness ≥ 0.9`) so chrome mirrors the real sun patches and windows |
| Prop / lot probes | as System 2/3 | — | — | re-baked under the physical rig |
| Contact occlusion | multiply-blended vertex-coloured decals, `premultipliedAlpha`, `DoubleSide` | AO 0.30–0.45 | — | under booth bases, stool bases, counter toe, table pedestals, wall–floor junctions, ceiling cove (0.25 m, 0.3) |
| Emissives | `fixtureLens` ≈ 4,500 nits, `rockerLit` ≈ 700, `pilotRed` ≈ 700, `kitchenDim` ≈ 30 | | | emissiveIntensity × colour luminance / K |

### Lessons

- **Too much sky is the enemy of the "brutal lot".** Raising the dome to 7,000 nits + ×3 circumsolar to make the windows hotter (rev 7 trial) pushed diffuse skylight on the lot to 25 klux, flattening the pole and wheel-stop shadows to 1.8 stops and lighting the whole room through the glass; the sky reads hotter on the display only by ⅓ stop. The lot gets its brutality from sun : sky ratio and the tone curve, not from a brighter dome.
- **The probe must not stare at the sun patches.** A probe at counter height 0.9 m from the windows put the 14,000-nit floor patches into the PMREM blur and lit the ceiling and far wall to 0 EV. Moving it to (−2.3, 1.3, −0.2) and splitting it (sun off for dielectrics, sun on for metals) dropped the ceiling a stop while keeping the chrome's sun reflections.
- **Fresh-lamp lumens are not maintained lumens.** 10.5 klm per troffer (the brief's figure, near the initial lamp lumens) gave 1,200 lux on the counter side and a ceiling at 0 EV. 7,500 (still above the 5,800 maintained estimate) is the compromise that keeps the tubes "on but losing".
- **AgX vs the lens.** Everything above +2 EV lands in 190–235 on the display under AgX, so the 4,500-nit lens (+2.05) and the 14,000-nit sun patch (+3.8) read closer than their 1.7-stop scene difference. Photographs do the same thing (film shoulder); the difference is carried by the surroundings, so keep the ceiling tiles under −0.5 EV.

### Rev 2 (branch `sys4-rev2`) — as built

Supersedes the tables above where it disagrees. Method: the same float render-target probe (`%TEMP%\sys4\probe.mjs`, RGBA16F, per-region p10/50/90 in nits; EV relative to middle grey), plus display codes from the post-on frame; full output `%TEMP%\sys4\out\r2k-summary.txt`.

**Exposure.** ISO 100, f/5.6, **1/250 s** → EV100 12.94, L_sat = 1.2 · 2^12.94 ≈ 9,400 nits, `toneMappingExposure ≈ 1.06`, middle grey **1,690 nits**. Tone curve: **camera** (`CustomToneMapping`, Hable shoulder with display white at +2.5 EV over grey = 9,600 nits ≈ L_sat, so "sensor saturation" and "curve white" are the same event). AgX is kept behind `?tm=agx` for comparison: under AgX everything from +2 to +6 EV lands in codes 190–235, which is why rev 1's table (+3.8), lens (+2.05) and sky (+2.3 … +3.1) were indistinguishable on the display though 1.5 stops apart in the probe. Display prediction: `camtone.mjs` inverts curve + sRGB (nits ↔ code), e.g. −1.2 EV → 88, −0.8 → 105, +1.6 → 215, +2.3 → 248.

**Measured HDR values, rev 2** (nits, p50 unless noted; EV over 1,690):

| Region (pose) | nits | EV | display |
|---|---|---|---|
| Wall sun patch core (`counter`, p90) | 6,490 | +1.9 | 230 (clips at the centre) |
| Wall in shade (`counter` / `length`) | 838 / 726 | −1.0 / −1.2 | 97 / 90 |
| Sky through the slats (`window`) | 8,480 (p90 13,500) | +2.3 | 248 → 255, (201, 202, 201) mean, blue at the edges |
| Sky, door glass (`door-glass`) | 7,515 | +2.15 | (228, 235, 239) |
| Sunlit sand (`door-glass`) | 6,180 | +1.9 | 228 |
| Asphalt in sun (`lot-shadow`) | 3,585 | +1.1 | 191 |
| Asphalt in pole shadow | 1,369 | −0.3 | 126 |
| Asphalt under the sedan (real shadow + decal) | 793 | −1.1 | 82 |
| Sedan, sunlit side / shade side | 5,940 / 388 | +1.8 / −2.1 | 226 / 63 |
| Troffer lens (`ceiling`, p10/50/90) | 3,400 / 5,100 / 6,300 | +1.0 / +1.6 / +1.9 | 187 / 215 / 229 |
| Ceiling tile, window side → back (`ceiling`) | 861 → 830 | −1.0 → −1.0 | 99 → 97 |
| Ceiling, window side → back (`length`) | 608 → 659 | −1.5 → −1.4 | 82 → 86 |
| Vinyl, sunlit back cushion (`stripes`) | 872 (p90 1,554) | −1.0 | (184, 38, 32) |
| Vinyl in shade (`booth`) | 140 | −3.6 | (93, 44, 37) |
| Table, sunlit (`stripes`) | 4,710 (p90 9,580) | +1.5 (core clips) | 209 → 252 |
| Counter top, fluorescent side (`counter` / `length`) | 464 / 199 | −1.9 / −3.1 | 70 / 42 |
| Pass-through shelf under the heat lamps (`warmer`) | 978 | −0.8 | 106 |
| Kitchen box (`warmer`) | 124 | −3.8 | 32 |
| Floor under the table / aisle (`undertable`) | 157 / 443 | −3.4 / −1.9 | 41 / 71 |
| Door frame, interior shade (`door-glass`) | 40 | −5.4 | 14 |

Ratios: wall sun : shade **3.0 EV** (rev 1: 0.3); lot lit : pole shadow 1.4 EV, lit : under-car 2.2 EV; sky through the slats vs wall shade 3.5 EV; sunlit vs shaded vinyl 2.6 EV. Display clipping (≥ 250): `length` 1.3 %, `booth` 2.9 %, `counter` 0.4 %, `stripes` 4.8 %, `door-glass` 4.5 %, `window` 22 % (the sky and the sunlit sill — the pose is a window). No pose has any pixel at 0.

**Sky.** Dome horizon 10,000 nits (0.78, 0.86, 0.97), zenith ≈ 2,900 (0.15, 0.25, 0.48), linear gradient, circumsolar ×(1 + cos⁴). Cosine-weighted hemisphere integral (`skyE.mjs`): **23 klux** diffuse (rev 1 dome ≈ 14; the first rev 2 dome — 12,000 nits, `pow(h, 1.6)`, ×1.5 — 39 klux, which flattened the lot to 2.5 : 1). Sun on the horizontal 51.6 klux → lit : shade 3.2 : 1 on the asphalt (measured 3.8 : 1 including the poles' partial occlusion of the sky).

**Light list, rev 2** (scene value = physical × K):

| Light | Type | Physical | Notes |
|---|---|---|---|
| `sun` | SpotLight 150 m out, az 38° / el 35°, 2.1° cone | 90 klux at the glass, 5500 K | 4096² BasicShadowMap, PCSS 8 blocker + 12 bilinear PCF on a Vogel spiral, phase from `shadowCoord · mapSize · 8` |
| `sun-beam` | detached twin | same | compare-mode depth for System 8 |
| `sun-lot` | DirectionalLight over the lot | 90 klux | 2048², single bilinear tap (`radius −0.25`), `normalBias 0.03`; cone occluder unchanged |
| Troffers ×6 | SpotLight 89° / penumbra 1 / decay 2 (Lambertian), 12 mm under the lens | 7,500 lm each, 4100 K + 4 % green | lens emissive 4,200 nits mean, tubes 1.5× via `trofferLens` emissive map |
| Sun bounce ×5 | upward Lambertian spot per booth at the flux centroid (first one on the −x wall, horizontal) | Σ E·A·ρ = (31k, 24k, 22k) lm-eq, colour (1.0, 0.77, 0.70) | replaces the floor-patch RectAreas; the pink on the ceiling is the vinyl's 20 % of the red channel |
| Heat lamps ×1 spot + 2 emissive caps | 60° spot over the pass-through | 1,200 lm, (1.0, 0.45, 0.20) | `kitchenDim` raised so the box reads −3.8 EV |
| Ambient | `scene.environment` = sun-off room probe × `environmentIntensity 0.7` | — | near-field correction, see BUILD.md; metals on the sun-on probe |
| Window fills, floor-patch fills | — | removed | the probe carries the sky; the bounce spots carry the patches |
| Lot `skyFill` emissive | — | removed (`?skyfill=1`) | the lot probe is the skylight |

Materials touched (additive): `glass` / `glassDoor` `0xf9fbfa` (colour applied twice by the transmission path); `blackPowder` `0x383838`, `rubberMat` `0x363636` (3–4 % albedo, were 0.6–1.3 %); `fixtureLens` emissive map. Performance: scene pass 7.7 ms at `length`, boot 10.0 s, 168 draw calls (rev 1 on merged `main`: 27.3 ms — 16 RectAreaLights ≈ 15.6 ms, `sunLot` 4096² 8-tap ≈ 4.7 ms, 16 + 24-tap PCSS ≈ 2.9 ms).

### Rev 6 (branch `sys4-rev2`) — as built

Supersedes rev 2 above and the rev 3/4 numbers in BUILD.md where it disagrees. Same probe (`%TEMP%\sys4\probe.mjs`, float render target, per-region p10/50/90 in nits, EV over middle grey), display codes from the post-on frame; full output `%TEMP%\sys4\out\r6-log.txt`, targets `targets.mjs r6`.

**Exposure.** ISO 100, f/5.6, **1/60 s** → EV100 10.88, L_sat ≈ 2,260 nits, middle grey **406 nits**. Tone curve (`installCameraToneMapping`): hue-preserving knee at **+3.5 EV** (max channel compressed as `knee + over / (1 + over / knee)`, the other channels scaled with it), stock crosstalk 6 % at rate 2 on exposed luminance, Hable with white at **+4.5 EV**, gain solved so grey lands at display-linear **0.18** (code 118; rev 2–5 0.26 / 139), then sRGB and a print toe `0.014 · (1 − c)⁴` on the encoded value (floor code 4). Neutral table (`camtone6.mjs --mid 0.18`):

| EV over grey | −4 | −3 | −2.5 | −2 | −1.5 | −1 | −0.5 | 0 | +1 | +2 | +2.5 | +3 | +3.5 | +4 | +4.5 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nits | 25 | 51 | 72 | 102 | 144 | 203 | 287 | 406 | 813 | 1,626 | 2,299 | 3,251 | 4,598 | 6,502 | 9,196 |
| code | 26 | 41 | 51 | 62 | 75 | 90 | 105 | 118 | 160 | 205 | 220 | 231 | 240 | 246 | 251 |

So the brief's "shaded wall 40–60" is 50–100 nits (−3 … −2 EV), "+4 EV over grey" is 6,500 nits / 246, and the sky through the glass (3,800–4,500 nits) is 226–230, not a clip — the dome would need ≈ 9,000 nits to clip at this white.

**Measured HDR values, rev 6** (nits, p50 unless noted; EV over 406; display code post on):

| Region (pose) | nits | EV | display |
|---|---|---|---|
| Wall sun patch, stripe crests (`counter` p90 / `length` p90) | 5,424 / 4,701 | +3.7 / +3.5 | 237 (0.0 % clip) |
| Table top in sun, crest (`macro-table` column x = 1300) | ≥ 6,500 | ≥ +4.0 | 246 |
| Table top, stripe trough beside it | 91–110 | −2.2 … −1.9 | 53–61 (1.7 % of the crest) |
| Wall in shade (`door-glass` int. / `length` / `counter` / `booth` / `lot-wide`) | 76 / 139 / 164 / 180 / 216 | −2.4 / −1.55 / −1.3 / −1.2 / −0.9 | 46 / 68 / 73 / 77 / 98 |
| Ceiling tile, window side → back (`length`) | 212 → 191 | −0.9 → −1.1 | 82 → 77 |
| Ceiling tile beside a lens / window side / back (`ceiling`) | 335 / 353 / 277 | −0.3 / −0.2 / −0.55 | 106 / 108 / 95 |
| Troffer lens, mean / lamp bars (`ceiling` p50 / p90) | 2,423 / 6,501 | +2.6 / +4.0 | 212 / 245 (blooms; threshold +3.5) |
| Sky through the east glass (`window` p50 / p90) | 3,813 / 4,548 | +3.2 / +3.5 | 226 / 230 |
| Sky through the open door (`door-open` p50, high) | 2,187 / 2,770 | +2.4 / +2.8 | 206 / 215 |
| Window, mixed (`lot-wide`) | 2,323 | +2.5 | 212 |
| Sunlit sand / asphalt (`door-glass`) | 4,006 / 2,218 | +3.3 / +2.45 | 232 / 210 |
| Asphalt in sun / car shadow (`lot-shadow`, exterior camera −2 EV) | 2,322 / 275 | 3.1 EV apart | 135 / 45 |
| Maroon hood, sunlit, through door glass (R / G / B) | 2,270 / 820 / 1,510 | — | (196, 141, 166) |
| Vinyl, sunlit back (`stripes`) / cushion in shade (`booth`) | 691 / 46 | +0.8 / −3.15 | (210, 65, 57) / (100, 64, 59) |
| Counter top (`counter` / `length`) | 95 / 47 | −2.1 / −3.1 | 55 / 35 |
| Floor under the table / aisle (`undertable`) | 25 / 74 | −4.0 / −2.5 | 24 / 55 |
| Kitchen box / pass-through shelf (`warmer`) | 73 / 218 | −2.5 / −0.9 | 45 / 83 |

Ratios: wall sun : shade **+5.0 EV** (rev 4 +3.0, rev 2 +3.0); ceiling : shaded wall (`length`) +0.46 EV (rev 4 ≈ +1); glass : no-glass sky ≤ 0.1 EV (rev 4 1.5–2.5); stripe trough : crest 1.7 % (rev 4 60–85 %). Display clipping (≥ 250): `length` 0.3 %, `booth` 5.0 %, `stripes` 1.7 %, `table` 7.6 %, `window` 1.7 %, `door-glass` 0.02 %. Frame medians: `undertable` 28, `length` 60, `counter` 55, `booth` 64, `table` 110 (rev 4 asked ≥ 70 everywhere; the rev 6 brief lets the shade fall to −3 … −4 EV).

**Light list, rev 6** (changes from rev 2–4 only):

| Light / term | Rev 6 |
|---|---|
| `sun` (interior spot) | as rev 4, but the blind slats are NOT casters; `directLight.color *= slatTransmit()` (scene/slatShadow.ts) — closed-form stripe transmittance, sun disc 9.3 mm/m, `fwidth` AA; the same term in the haze/dust march |
| Sun bounce | the five Lambertian spots are gone; `bounceIrradiance(p, n)` (scene/bounceRects.ts) adds the exact rectangle form factor of each baked sun-patch quad (floor, table zone, bench front, end-wall band, vestibule floor; radiance E · ρ / π, ρ_floor 0.36 checker mean, blind open fraction 0.76) to `irradiance` in `lights_fragment_begin`; unrolled, early-outs, point form beyond three diagonals; 0.7 ms |
| Troffers ×6 | 5,800 lm maintained (rev 3–5 10,500); lens bars +4.0 EV |
| Room probe (`environmentIntensity`) | 0.10 (rev 4 0.13) — second bounce only, the first is the rectangle term |
| Glazing | alpha leaf `α = 1 − (1 − F)(1 − 0.12)` + additive reflection leaves (room probe inside, lot probe outside); no `transmission` on architectural glass |
| Camera | mid grey 0.18, knee +3.5 EV, crosstalk 0.06 @ 2, print toe 0.014; bloom threshold 2.0 exposed (+3.5 EV), Karis-weighted, clamp 100 |
| Finish | sedona shadow lift: ×2.5 max under 0.045 exposed, masked by an 8-tap local-max search (48 px @ 1440p, fall 0.22, mask 0.1–0.3) |

Materials touched: `maroonPaint` `0x3a1014` → `0x6e141c` (linear R 0.043 → 0.155; a 4 % red under a clearcoat's sky reflection read lilac). Performance: scene pass 7.7 ms at `length`, 7.7 `booth`, 3.9 `window`; post 2.1–3.4 ms; boot ≈ 10 s uncontended.
