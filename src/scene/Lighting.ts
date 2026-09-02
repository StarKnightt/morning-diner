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
 * probe for the interior (bounce off the sunlit floor and vinyl onto ceiling and
 * undersides comes from there, not from a uniform ambient). Two probe passes in
 * Diner.build() give a two-bounce approximation.
 *
 * Fluorescents: one RectAreaLight per 2×4 troffer, 4100 K + a 4 % green bias, 5,900 lm
 * (four aged F32T8 through a dirty prismatic lens), and the lens emissive calibrated
 * to 4,000 nits — about two stops under a sunlit white surface, "on but losing".
 *
 * three.js cannot mask a LIGHT per object (layers are tested against the render
 * camera, even in the shadow pass), so `installShadowMasks` wraps
 * `renderer.shadowMap.render` to run one light at a time and flips `castShadow`
 * between them — a per-MAP caster list with no wasted depth draws.
 */
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { BACK_BAR, BOOTH, CEILING, COUNTER, ROOM, STOOL, WINDOW, trofferCenter } from "./layout";

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

/** Camera: ISO 100, f/5.6, 1/160 s. EV100 = log2(N²/t) − log2(ISO/100) = 12.29. */
export const CAMERA = { iso: 100, fNumber: 5.6, shutter: 1 / 160 } as const;
export const EV100 = Math.log2((CAMERA.fNumber * CAMERA.fNumber) / CAMERA.shutter) - Math.log2(CAMERA.iso / 100);
/** Saturation luminance for that exposure (Lagarde: L_sat = 1.2 · 2^EV) ≈ 6,000 nits. */
export const L_SAT_NITS = 1.2 * Math.pow(2, EV100);
/**
 * `renderer.toneMappingExposure`: scene value 1.0 = L_sat. ≈ 1.67 at K = 1e-4.
 * Middle grey (0.18) then sits at ≈ 1,080 nits (measured on the sys4 frames, REFERENCE §8):
 * the sunlit stripes on the red vinyl (≈ 3,000 nits) +1.5 EV over grey, the sunlit Formica
 * table (≈ 14,000 nits) +3.7 EV with its core clipping, the sky seen through the slats
 * (≈ 12,000 nits) +3.5 EV, the lot asphalt (≈ 2,700 nits) +1.3 EV, the counter top on the
 * fluorescent side (≈ 500 nits) −1.1 EV, the back wall (≈ 500) −1.1, the counter die
 * (≈ 170 nits) −2.7 EV, the vinyl seat in shade (≈ 140) −2.9 EV.
 */
export const EXPOSURE = 1 / (L_SAT_NITS * K);
/** Tone curve. AgX keeps the clipped red channel of sunlit vinyl red (ACES pulls it to orange). */
export const TONE_MAPPING: THREE.ToneMapping = THREE.AgXToneMapping;
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

/** 4100 K cool-white fluorescent (255, 224, 190) with the mercury-line green bias (+4 % G). */
const FLUORESCENT = new THREE.Color().setRGB(255 / 255, (224 / 255) * 1.04, 190 / 255, THREE.SRGBColorSpace);
/**
 * Luminaire output of a four-lamp F32T8 2×4 (4 × 2,850 lm lamps, ballast factor 0.88,
 * ≈ 0.75 fixture efficiency through a prismatic lens, a little lamp ageing): 10,500 lm.
 */
const TROFFER_LUMENS = 10_500;
/**
 * Sky + lot seen through the glass and the half-open slats, as one Lambertian rectangle
 * in the glass plane: (½ sky at ≈ 10,000 nits + ½ lot at ≈ 3,000) × 0.88 glass × 0.5
 * slat openness ≈ 2,900 nits; set to 1,800 because the room probe already carries part
 * of the window's contribution (it sees the windows) — REFERENCE §8 explains the split.
 */
const WINDOW_SKY = new THREE.Color().setRGB(205 / 255, 215 / 255, 232 / 255, THREE.SRGBColorSpace);
const WINDOW_SKY_NITS = 1_200;
/**
 * Sky dome: the shader's horizon (≈ 0.9) is authored at display scale; ×0.77 puts the
 * horizon haze at 7,000 nits. `scaleSky` adds the circumsolar brightening on top (up to
 * ×3 at the sun, ×1.9 at 35° from it — the part of the sky the windows look at, ≈ 13,000).
 */
const SKY_HORIZON_NITS = 7_000;
/**
 * Aisle floor under a window's beam, averaged over lit and shaded stripes: ρ 0.45 × 22.7
 * klux / π = 3,250 nits for a clear patch; ×0.6 because the booth backs and the stools
 * intercept the lower part of every beam before it reaches the aisle.
 */
const BOUNCE_NITS = 2_000;
const SKY_SCALE = nits(SKY_HORIZON_NITS) / 0.91;

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
  troffers: THREE.RectAreaLight[];
  windowFills: THREE.RectAreaLight[];
  /** Horizon colour in scene units, for the fog and the background. */
  horizon: THREE.Color;
}

/* ------------------------------------------------------------------------- */
/* Renderer                                                                   */
/* ------------------------------------------------------------------------- */

/** Tone mapping, exposure and shadow filtering. main.ts owns the renderer; this keeps the numbers in one place. */
export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.toneMapping = TONE_MAPPING;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = SHADOW_MAP_TYPE;
  primeShadowMapType(renderer);
  installPcss();
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
 * 16 blocker taps + 24 filter taps on a per-pixel rotated Vogel disk. Non-reversed depth.
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
  const pcss = /* glsl */ `#else // SHADOWMAP_TYPE_BASIC — replaced by PCSS (src/scene/Lighting.ts)

		float pcssNoise( vec2 p ) {
			return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 pcssVogel( int i, int n, float phi ) {
			float r = sqrt( ( float( i ) + 0.5 ) / float( n ) );
			float theta = float( i ) * 2.399963229728653 + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}

		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {

			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			float zR = shadowCoord.z + shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;

			if ( inFrustum && zR <= 1.0 ) {

				vec2 texel = vec2( 1.0 ) / shadowMapSize;
				float phi = pcssNoise( gl_FragCoord.xy ) * PI2;

				if ( shadowRadius > 0.0 ) {

					// 1. Blocker search: average depth of everything in front of the receiver.
					float searchR = shadowRadius * 0.2;
					float sum = 0.0, n = 0.0;
					for ( int i = 0; i < 16; i ++ ) {
						float d = texture2D( shadowMap, shadowCoord.xy + pcssVogel( i, 16, phi ) * searchR ).r;
						if ( d < zR ) { sum += d; n += 1.0; }
					}
					if ( n > 0.5 ) {
						// 2. Penumbra ∝ receiver−blocker separation, clamped to the search disk.
						float pen = clamp( shadowRadius * ( zR - sum / n ), texel.x * 0.75, searchR );
						// 3. PCF over the penumbra.
						float lit = 0.0;
						for ( int i = 0; i < 24; i ++ ) {
							float d = texture2D( shadowMap, shadowCoord.xy + pcssVogel( i, 24, phi + 1.0 ) * pen ).r;
							lit += step( zR, d );
						}
						shadow = lit / 24.0;
					}

				} else {

					float r = max( 0.5, -shadowRadius ) * texel.x;
					float lit = 0.0;
					for ( int i = 0; i < 8; i ++ ) {
						float d = texture2D( shadowMap, shadowCoord.xy + pcssVogel( i, 8, phi ) * r ).r;
						lit += step( zR, d );
					}
					shadow = lit * 0.125;

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
  sunLot.shadow.mapSize.set(4096, 4096);
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
  sunLot.shadow.normalBias = 0.03; // ≈ 8 mm texels
  sunLot.shadow.radius = -1.2; // fixed PCF, 1.2 texels (see installPcss)
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
  const horizon = new THREE.Color(0.9, 0.915, 0.93).multiplyScalar(SKY_SCALE);
  const sky = scene.getObjectByName("sky") as THREE.Mesh | undefined;
  if (sky) scaleSky(sky, SKY_SCALE);

  // Diagnostics for the capture harness: `?nofill` renders the suns alone, `?nospot` /
  // `?nolot` switch one of the two suns off so the cone seam and each map can be checked;
  // `?nofluor` switches the troffers off (their contribution alone).
  const q = new URLSearchParams(location.search);
  if (q.has("nospot")) sun.intensity = 0;
  if (q.has("nolot")) sunLot.intensity = 0;
  if (q.has("nofill")) return { sun, sunBeam, sunLot, cone: cone3, troffers: [], windowFills: [], horizon };

  RectAreaLightUniformsLib.init();

  /* ---------------- fluorescent troffers ---------------- */
  // RectAreaLight `power` is lumens → intensity = power / (w·h·π) in nits (× K here):
  // 5,900 lm over 1.11 × 0.51 m ≈ 3,300 nits of Lambertian emission per troffer.
  const troffers: THREE.RectAreaLight[] = [];
  if (!q.has("nofluor")) {
    for (const cell of CEILING.troffers) {
      const [x, z] = trofferCenter(cell);
      const l = new THREE.RectAreaLight(FLUORESCENT, 1, CEILING.tile * 2 - 0.09, CEILING.tile - 0.09);
      l.power = nits(TROFFER_LUMENS);
      l.position.set(x, ROOM.height - CEILING.teeDepth + 0.012, z);
      l.lookAt(x, 0, z);
      l.name = "troffer";
      scene.add(l);
      troffers.push(l);
    }
  }

  /* ---------------- sky through the windows ---------------- */
  // One RectAreaLight the size of each glazed opening, in the glass plane, facing in: the
  // bluish-white sky/lot patch the room sees through the half-open slats. Gives the near-
  // window falloff the probe (a single point) cannot; the probe carries the rest.
  const windowFills: THREE.RectAreaLight[] = [];
  {
    const h = WINDOW.head - WINDOW.sill;
    for (const x of WINDOW.centersX) {
      const l = new THREE.RectAreaLight(WINDOW_SKY, nits(WINDOW_SKY_NITS), WINDOW.width, h);
      l.position.set(x, WINDOW.sill + h / 2, ROOM.zFront - 0.02);
      l.lookAt(x, WINDOW.sill + h / 2, ROOM.zFront - 5);
      l.name = "window-sky";
      scene.add(l);
      windowFills.push(l);
    }
  }

  /* ---------------- bounce off the aisle sun patches ---------------- */
  // Each window's beam lands on the aisle floor between the booth fronts and the counter's
  // toe (window heights 1.1–2.6 m × cot 35° along the sun's plan direction), shifted
  // toward −x by tan 38° per metre of depth. Those patches are the room's brightest
  // surfaces after the windows and the main source of warm light on the ceiling, the
  // table undersides and the counter die — the probe now sits away from them (Diner.ts),
  // so each patch is an upward-facing RectAreaLight: sun colour × checker floor
  // (average albedo ≈ 0.45, slightly warm), luminance ρ·E/π with E = 90 klux · sin 35° ·
  // 0.88 glass · 0.5 slat duty ≈ 22.7 klux → 3,250 nits. The dielectrics' probe is
  // captured with the interior sun off (Diner.ts), so this is the only sun bounce they get.
  const bounces: THREE.RectAreaLight[] = [];
  if (!q.has("nobounce")) {
    const planShift = Math.tan(THREE.MathUtils.degToRad(38));
    const z0 = COUNTER.topFrontZ + 0.15, z1 = BOOTH.zInner - 0.4; // aisle floor the beam reaches past the booth backs
    const zc = (z0 + z1) / 2, depth = ROOM.zFront - zc;
    const bounceColor = SUN_COLOR.clone().multiply(new THREE.Color().setRGB(0.47, 0.45, 0.42, THREE.LinearSRGBColorSpace));
    for (const cx of WINDOW.centersX) {
      const l = new THREE.RectAreaLight(bounceColor, nits(BOUNCE_NITS) / 0.39, WINDOW.width, z1 - z0); // 0.39 = Y of bounceColor
      l.position.set(cx - depth * planShift, 0.02, zc);
      l.lookAt(l.position.x, 5, zc);
      l.name = "floor-bounce";
      scene.add(l);
      bounces.push(l);
    }
  }

  return { sun, sunBeam, sunLot, cone: cone3, troffers, windowFills: [...windowFills, ...bounces], horizon };
}

/**
 * Multiply the sky shader's output before tone mapping, through an injected uniform, so
 * System 3's authored gradient keeps its shape while reading in nits (horizon ≈ 7,000,
 * zenith ≈ 3,800, glare and disc above that). A circumsolar term is added on top: on a
 * hazy summer morning the sky within ~40° of the sun is 2–3× brighter than the opposite
 * horizon (forward scattering by dust; CIE clear-sky types 11–12), and that is the part
 * of the sky the windows face (sun 38° off the window normal). `c` = cos(angle to the
 * sun) is a local of the sky shader's main(). Done here rather than in Exterior.ts so the
 * sky's look and its photometric scale stay in separate files.
 */
export function scaleSky(sky: THREE.Mesh, scale: number): void {
  const mat = sky.material as THREE.ShaderMaterial;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.skyScale = { value: scale };
    const boost = shader.fragmentShader.includes("float c = clamp( dot( d, sunDir )") || shader.fragmentShader.includes("float c = clamp(dot(d, sunDir)")
      ? "gl_FragColor.rgb *= skyScale * ( 1.0 + 2.0 * pow( c, 4.0 ) );"
      : "gl_FragColor.rgb *= skyScale;";
    shader.fragmentShader = shader.fragmentShader
      .replace("varying vec3 vDir;", "varying vec3 vDir;\nuniform float skyScale;")
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
export function buildContactShadows(parent: THREE.Object3D): THREE.Mesh {
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
  /** Annulus on the floor around (x, z): full `ao` inside r0, fading to 0 at r1. */
  const disc = (x: number, z: number, r0: number, r1: number, ao: number) => {
    const N = 28;
    const c = push(new THREE.Vector3(x, Y, z), ao);
    const rings: number[][] = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const r = r0 + (r1 - r0) * t;
      const ring: number[] = [];
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2;
        ring.push(push(new THREE.Vector3(x + Math.cos(a) * r, Y, z + Math.sin(a) * r), ao * fall(t)));
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
    // Under the table between the seats: table above, seats both sides — a soft general shade.
    floorX(cx - seat.front, cx + seat.front, zOuter, -1, 0.5, 0.3);
    disc(cx, zInner + BOOTH.table.inset + 0.35, 0.22, 0.42, 0.35);
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

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    // r185: MultiplyBlending is dst × (src·a + 1 − a) and requires premultipliedAlpha;
    // with a = 1 that is dst × colour, colour = 1 − ao.
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
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = "contact-occlusion";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = -1; // before the transmissive glass in the transparent pass
  parent.add(mesh);
  return mesh;
}
