/**
 * SteamEmitter — coffee steam as a few thin wisps (decanter on the warmer, the poured mug).
 *
 *   import { SteamEmitter } from "../post/Steam";
 *   const steam = new SteamEmitter({ count: 6, radius: 0.02, rise: 0.2, life: 1.5, strength: 1 }, diner.sunBeam);
 *   scene.add(steam.object);
 *   steam.object.position.set(x, rimY, z);          // the source (world); move it any time
 *   steam.velocity.set(vx, vy, vz);                  // the source's world velocity (a carried mug drags the wisps)
 *   steam.strength = 0;                              // fade out (multiplier on alpha, 0–1+)
 *   steam.update(timeSeconds);                       // once per frame with a shared clock
 *   steam.dispose();
 *
 * Every parameter is a plain public field on `params`, re-read each update. One emitter is
 * ONE instanced draw: `count` ribbons of SEGMENTS quads each, everything time-driven in the
 * vertex shader — no per-frame CPU work, no allocations.
 *
 * Model (System 8 steam fix). What a photograph shows above a cup at 8 AM is not a cloud:
 * a few thin, ragged, laminar strands that rise 10–20 cm, lean with the room's air and
 * dissolve. Each strand here is a *streakline*: the parcel now at height h left the source
 * `age = h / v` seconds ago, so every property along the ribbon is a function of its
 * emission time τ = t − age — the release point's slow wander, the room-air drift (a
 * divergence-free 2-D curl field of three travelling sines, sampled by position and time),
 * the per-strand release direction, a turbulent meander that grows with height (laminar at
 * the source), an intermittent emission envelope (so puffs form, rise and vanish), and the
 * fragment's streak noise — features are anchored to the parcel and travel up with the
 * flow instead of being scaled or scrolled. A carried source (`velocity`) leaves the older
 * parcels behind: p = src − v·age. The ribbon is a camera-facing strip rotated to the local
 * tangent, so there is no circular silhouette anywhere; its width grows with height
 * (diffusion) and the fragment alpha is a Gaussian across it with a noise-wobbled edge —
 * no radial texture, no hollow ring. Alpha along the strand is 0 at the surface (the rim
 * crossing is a fade, not a cut), peaks a few cm up and is exactly 0 at the top.
 *
 * Light: the scattered radiance is `color × intensity` in shade (the fill the station gets)
 * and, where the strand crosses the sun beam — the same aperture prism × compare-map test the
 * sun dust uses — `sunBoost` × that luminance in the sun's hue, weighted by a forward-scatter
 * lobe. Premultiplied blending: rgb adds the scattered light and alpha × `occlusion` dims
 * what is behind, so a fixed radiance shows against a dark backdrop and hides against a
 * bright one (the physical contrast rule). The scene colour is not readable inside the
 * scene pass, so `backdrop` is the fixed per-station approximation. `fadePlane` fades the
 * alpha toward a world plane (the back wall) — the analytic stand-in for a soft depth test,
 * since the MSAA scene depth is being written while these draw.
 */
import * as THREE from "three";
import { apertureGlsl, apertureUniforms, MAX_APERTURES, setSunUniforms, shadowGlsl, sunRaysOf, type ApertureUniforms, type SunLight, type SunRays } from "./beams";

export interface SteamParams {
  /** Strands alive at once. 3–8. */
  count: number;
  /** Release-disc radius on the surface, m. */
  radius: number;
  /** Height at which a strand has fully dissolved, m (10–25 cm for coffee). */
  rise: number;
  /** Seconds a parcel takes to climb `rise` (rise / life ≈ 0.1–0.2 m/s). */
  life: number;
  /** Ribbon width at the source and at the top, m (diffusive growth). */
  width: [number, number];
  /** Room-air drift speed amplitude, m/s (2-D curl field sampled by position and time). */
  shear: number;
  /** Size of the room-air eddies, m. */
  shearScale: number;
  /** Per-strand release-direction wander, m/s. */
  release: number;
  /** Turbulent meander amplitude at the top of the strand, m (0 at the source). */
  meander: number;
  /** Root curl amplitude, m: air moving past the source twists the laminar part a little. */
  curl: number;
  /** 0 = continuous strands, 1 = fully intermittent puffs (each strand emits ~half the time). */
  burst: number;
  /** Alpha multiplier; 0 = off. */
  strength: number;
  /** Peak alpha of a strand in shade before `strength` (0.12–0.25 reads as vapour). */
  alpha: number;
  /** Scattered-light radiance in shade (scene-linear, `color × intensity`). */
  color: THREE.Color;
  intensity: number;
  /** 0–1 how much the vapour dims what is behind it. */
  occlusion: number;
  /** Constant side-drift, m/s (a draught along the counter). */
  wind: [number, number];
  /** Radiance multiplier where the strand is in the sun beam (photographs: ×2–3, in the sun's hue). */
  sunBoost: number;
  /** Alpha multiplier standing in for the background contrast (1 = neutral, >1 over a dark backdrop). */
  backdrop: number;
  /** World plane (nx, ny, nz, d), n·p + d ≥ 0 inside the room; alpha fades to 0 within `fadeWidth` of it. null = none. */
  fadePlane: THREE.Vector4 | null;
  fadeWidth: number;
}

export function defaultSteamParams(): SteamParams {
  return {
    count: 5,
    radius: 0.03,
    rise: 0.22,
    life: 2.0,
    width: [0.008, 0.045],
    shear: 0.04,
    shearScale: 0.8,
    release: 0.012,
    meander: 0.012,
    curl: 0.003,
    burst: 0.85,
    strength: 0.35,
    color: new THREE.Color(0.93, 0.95, 1.0),
    intensity: 1.0,
    occlusion: 0.35,
    alpha: 0.16,
    wind: [0.006, -0.004],
    sunBoost: 2.5,
    backdrop: 1.0,
    fadePlane: null,
    fadeWidth: 0.03,
  };
}

/** Quads along one strand. 20 keeps the meander smooth in a 2× crop. */
const SEGMENTS = 20;

const vertexShader = /* glsl */ `
  attribute vec4 seed;      // per strand: phase, release angle, size jitter, noise offset
  attribute float along;    // 0 at the surface … 1 at the top
  attribute float side;     // −1 / +1 across the ribbon
  uniform float uTime, uLife, uRise, uRadius, uShear, uShearScale, uRelease, uMeander, uBurst, uCurl, uTear;
  uniform vec2 uWidth, uWind;
  uniform vec3 uSrcVel;
  uniform vec4 uFadePlane;
  uniform float uFadeWidth, uHasSun, uSunBoost, uAlpha;
  uniform vec3 uSunRadiance, uAmbient;
  varying float vU, vTau, vEnv, vSeed, vS;
  varying vec3 vRadiance, vWorld;
  ${apertureGlsl(MAX_APERTURES)}
  ${shadowGlsl}

  // Divergence-free room air: v = (dpsi/dz, -dpsi/dx) for psi = a sum of three travelling sines.
  // For psi_i = A sin(K (a x + b z) + w t + phi) with (a, b) unit, v_i = A K cos(...) (b, -a); the
  // weights make the speed amplitude about uShear.
  vec2 roomAir(vec2 p, float t) {
    float k = 6.2831853 / uShearScale;
    vec2 v = vec2(0.0);
    v += vec2( 0.70, -0.71) * (0.60 * cos(k * (0.71 * p.x + 0.70 * p.y) + t * 0.31 + 1.0));
    v += vec2( 0.83,  0.55) * (0.30 * cos(k * 1.7 * (-0.55 * p.x + 0.83 * p.y) + t * 0.47 + 2.7));
    v += vec2(-0.31, -0.95) * (0.20 * cos(k * 2.9 * (0.95 * p.x - 0.31 * p.y) + t * 0.73 + 4.1));
    return v * uShear;
  }

  // Intermittent emission: packets ~0.6–1 s long every 2–3 s per strand, staggered by the seed,
  // so a strand reads as a wisp that forms, rises and is gone rather than a standing thread.
  float burst(float tau) {
    float b = 0.5 + 0.5 * sin(tau * (2.4 + 1.2 * seed.z) + seed.x * 6.2831853);
    b = 0.7 * b + 0.3 * (0.5 + 0.5 * sin(tau * (5.3 + 1.7 * seed.w) + seed.y * 6.2831853));
    return mix(1.0, smoothstep(0.38, 0.72, b), uBurst);
  }

  // Centreline of this strand at along-parameter s (world). Every term is a function of the
  // parcel's emission time tau, so features travel up the strand with the flow.
  vec3 centre(float s) {
    float age = s * uLife;
    float tau = uTime - age;
    float ang = seed.y * 6.2831853 + 0.8 * sin(tau * 0.41 + seed.w * 6.0);
    float rr = uRadius * (0.3 + 0.7 * seed.z);
    vec3 src = (modelMatrix * vec4(cos(ang) * rr, 0.0, sin(ang) * rr, 1.0)).xyz;
    // Buoyant rise that slows as the parcel cools and mixes (1.6× the mean speed at the surface,
    // 0.4× at the top; it never stalls, a stalled top seen from above lies flat and folds the ribbon).
    float h = uRise * s * (1.6 - 0.6 * s);
    // Room air, evaluated at the parcel's mid-life (the field is slow), plus the draught.
    vec2 air = roomAir(src.xz, uTime - 0.5 * age) + uWind;
    // The strand leaves the surface leaning a little, and the lean wanders.
    vec2 rel = uRelease * vec2(sin(tau * 0.9 + seed.x * 6.2831853), cos(tau * 0.7 + seed.y * 4.0));
    // The whole strand bows: a slow per-strand bend growing with age squared (curvature radius
    // ~25 cm at the top), its direction wandering, so no strand is straight over more than a
    // few centimetres and neighbours bow different ways.
    vec2 bend = uRelease * 3.0 * vec2(sin(tau * 0.5 + seed.z * 6.2831853), cos(tau * 0.6 + seed.w * 6.2831853)) * age * age / uLife;
    // Turbulent meander: none at the surface (laminar), growing past the mid-height.
    float g = pow(s, 1.7) * uMeander;
    // Wavelengths stay well above the ribbon width (≈ 9 and 5 cm along a 1.4 s strand) so the
    // centreline never turns sharper than the strip can follow.
    vec2 mea = g * vec2(sin(tau * 4.7 + seed.w * 9.0) + 0.3 * sin(tau * 9.1 + seed.z * 5.0),
                        cos(tau * 4.1 + seed.x * 7.0) + 0.3 * cos(tau * 8.3 + seed.y * 3.0));
    // Root curl: air moving past the source (a draught under the brew basket) already twists the
    // laminar part a little.
    mea += uCurl * smoothstep(0.0, 0.3, s) * vec2(sin(tau * 5.3 + seed.x * 6.2831853), cos(tau * 4.3 + seed.w * 6.2831853));
    // A carried source: the parcel stays (mostly) where the source was when it left. Each strand
    // lags a different fraction (the rim's boundary layer entrains some), and the wake behind a
    // moving rim is a vortex street, so the trail curls sideways in proportion to its length —
    // never a comb of straight parallel rays.
    float vl = length(uSrcVel);
    vec3 vdir = uSrcVel / max(vl, 1e-4);
    vec3 perpA = normalize(cross(vdir, abs(vdir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)) + vec3(1e-5));
    vec3 perpB = cross(vdir, perpA);
    float lag = 0.4 + 0.6 * fract(seed.w * 5.3 + seed.x * 2.1);
    float d = vl * age * lag;
    // Each strand's trail also leaves at its own fixed angle off the motion (±25°), so the trails
    // fan rather than run parallel; the oscillating part bends each one along its length.
    float fan = seed.x * 6.2831853 + seed.y * 2.0;
    vec3 wake = -vdir * d
      + (perpA * (0.45 * sin(fan) + 0.35 * sin(tau * 9.0 + seed.x * 6.2831853))
       + perpB * (0.45 * cos(fan) + 0.35 * cos(tau * 7.0 + seed.y * 6.2831853))) * d;
    vec3 p = src + wake;
    p.y += h;
    p.xz += (air + rel) * age + bend + mea;
    return p;
  }

  void main() {
    float s = along;
    vec3 p = centre(s);
    // Ribbon direction: the local tangent blended with the strand's chord. A strip that follows
    // every local turn folds over itself where the centreline bends sharper than its width (seen
    // from above, the xz meander does exactly that) and the fold draws a bright double-alpha
    // crease; the chord keeps the side vector turning slowly, and a Gaussian strip does not care
    // that it is a little skewed to the local flow.
    vec3 Tl = centre(min(s + 0.05, 1.0)) - centre(max(s - 0.05, 0.0));
    vec3 Tc = centre(0.8) - centre(0.05);
    vec3 T = normalize(Tl) * 0.35 + normalize(Tc) * 0.65;
    vec3 V = p - cameraPosition;
    vec3 v = normalize(V);
    // Camera-facing ribbon rotated to that direction; camera-right when looking down the strand.
    vec3 sideV = cross(v, T);
    float sl = length(sideV);
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    sideV = sl > 1e-6 ? sideV / sl : camRight;
    // Keep the strip's handedness along the strand (a flipped row folds the quad into a bow-tie).
    if (dot(sideV, camRight) < 0.0) sideV = -sideV;
    float age = s * uLife;
    float tau = uTime - age;
    float wj = 0.8 + 0.4 * seed.z;
    // Width jitter along the strand (±40 %, riding with the parcel): knots and necks, and the
    // mass-conserving thinning below makes the necks fainter and the knots denser.
    float wjit = 1.0 + 0.4 * sin(tau * 6.1 + seed.w * 6.2831853);
    float w = mix(uWidth.x, uWidth.y, s) * wj * wjit;
    vec3 wp = p + sideV * (0.5 * w * side);
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);

    // Along the strand: 0 at the surface (the rim crossing fades, it is never cut), peak 5–6 cm
    // up, exactly 0 at the top; the vapour that widens by diffusion thins with it (strongly: the
    // widened upper half must read clearly fainter than the root).
    float env = smoothstep(0.0, 0.26, s) * pow(1.0 - smoothstep(0.3, 1.0, s), 1.3);
    env *= pow(uWidth.x * wj / max(1e-4, w), 0.8);
    env *= burst(tau);
    // Strands differ: some are faint, one or two carry the plume.
    env *= 0.5 + 0.5 * fract(seed.z * 3.7 + seed.w * 1.3);
    // A source on the move (the carried mug) sweeps its own wake apart: parcels left behind have
    // been torn up by the motion (speed and acceleration, uTear from the CPU) and the visible
    // trail never exceeds ~15 cm whatever the speed.
    float d = length(uSrcVel) * age * (0.55 + 0.45 * fract(seed.w * 5.3 + seed.x * 2.1));
    env *= exp(-uTear * age) * (1.0 - smoothstep(0.09, 0.15, d));
    // Soft fade toward a world plane (the back wall): nothing slices geometry.
    if (uFadeWidth > 0.0) env *= smoothstep(0.0, uFadeWidth, dot(uFadePlane.xyz, p) + uFadePlane.w);

    // Light: in shade the fill radiance; in the sun beam (aperture prism × compare map, the
    // sun dust's test) uSunBoost × that luminance in the sun's hue, forward-scatter weighted
    // (HG g 0.6, normalised at 25° off the sun like the dust so uSunBoost is "looking toward the window").
    // The beam test itself runs per fragment: the blind slats cut the beam into 12 mm stripes,
    // finer than a ribbon row, and a per-vertex test aliased them into bright bars across the strand.
    float c = dot(v, uSunDir);
    float g2 = 0.36;
    float hg = (1.0 - g2) / pow(1.0 + g2 - 1.2 * c, 1.5);
    float hgRef = (1.0 - g2) / pow(1.0 + g2 - 1.2 * 0.9063, 1.5);
    float phase = min(2.0, hg / hgRef);
    vec3 lumW = vec3(0.2126, 0.7152, 0.0722);
    vec3 sunHue = uSunRadiance / max(1e-5, dot(uSunRadiance, lumW));
    vRadiance = sunHue * dot(uAmbient, lumW) * uSunBoost * phase;
    vWorld = p;

    vU = side;
    vS = s;
    vTau = tau;
    vSeed = seed.w * 10.0;
    vEnv = env * uAlpha;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uOcclusion, uHasSun;
  uniform vec3 uAmbient;
  varying float vU, vTau, vEnv, vSeed, vS;
  varying vec3 vRadiance, vWorld;
  ${apertureGlsl(MAX_APERTURES)}
  ${shadowGlsl}
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    // Streaks anchored to the parcel (tau): 2–4 cm long, they ride up with the flow; a slower
    // term varies the density over ~6 cm so the strand has dense knots and thin necks.
    vec2 q = vec2(vU * 1.4 + vSeed, vTau * 4.5);
    float n1 = vnoise(q) * 0.6 + vnoise(q * 2.1 + 3.3) * 0.4;
    float n2 = vnoise(vec2(vU * 0.5 + vSeed + 7.0, vTau * 2.0));
    float n3 = vnoise(vec2(vSeed + 21.0, vTau * 1.3));
    // Ragged edge: the half-width wobbles ±40 % along the strand, and the core drifts off-centre
    // (a little: pushed further it piles against the quad-edge window and draws a straight side).
    float edge = 0.5 + 0.5 * n2;
    float u = abs(vU - 0.2 * (n3 - 0.5)) / edge;
    // Soft Gaussian across the ribbon, always closed before the quad edge (|vU| = 1) so no row
    // ever shows a hard cut. No radial term anywhere.
    float across = exp(-u * u * 3.0) * (1.0 - smoothstep(0.5, 0.9, abs(vU)));
    // Past mid-height the widened sheet is really two or three filaments with clear air between.
    // The across coordinate is scaled by height (lanes fan apart, never parallel), shifted by a
    // parcel-anchored warp, and thresholded from two incommensurate octaves (lanes of unequal
    // width and spacing that form and vanish as they ride up). Never at the laminar root.
    float warp = vnoise(vec2(vSeed + 5.0, vTau * 1.7)) - 0.5;
    float uu = vU * (1.6 + 1.4 * vS) + 1.2 * warp;
    float fn = 0.65 * vnoise(vec2(uu + vSeed * 3.0, vTau * 3.5 + 11.0)) + 0.35 * vnoise(vec2(uu * 2.3 + 9.0, vTau * 5.0));
    float fil = smoothstep(0.3, 0.7, fn);
    float split = mix(1.0, 0.15 + 0.85 * fil, smoothstep(0.2, 0.75, vS));
    // Dense knots and clear gaps along the strand: the modulation floor is 0.1, so a strand
    // breaks into pieces (it still never cuts to exactly nothing).
    float a = across * split * vEnv * (0.1 + 0.9 * smoothstep(0.2, 0.8, n1)) * (0.55 + 0.45 * n3);
    // Sun-beam test per fragment; the slat-averaged compare (three taps over one slat pitch)
    // stands in for the vapour's ~2 cm depth, so a stripe brightens a soft band, not a knife edge.
    float lit = 0.0;
    if (uHasSun > 0.5) lit = inBeam(vWorld) * sunVisibleSoft(vWorld);
    vec3 radiance = mix(uAmbient, vRadiance, lit);
    // Premultiplied: rgb adds the scattered light, alpha dims the background by uOcclusion.
    gl_FragColor = vec4(radiance * a, a * uOcclusion);
  }
`;

/** Optional GPU-timer hook (`?debug.timeSteam=1`): begin/end around each emitter's draw. */
export interface SteamTimer {
  begin(label: string): void;
  end(): void;
}

export class SteamEmitter {
  /** Set by the post pipeline in the steam-timing mode; null otherwise. */
  static timer: SteamTimer | null = null;

  readonly object: THREE.Mesh;
  readonly params: SteamParams;
  /** World velocity of the source (m/s); older parcels trail behind a moving source. */
  readonly velocity = new THREE.Vector3();
  /** World acceleration of the source (m/s²); a jerked source tears its wake apart faster. */
  readonly acceleration = new THREE.Vector3();
  /** Alpha multiplier (0 = off). Same as params.strength. */
  get strength(): number {
    return this.params.strength;
  }
  set strength(v: number) {
    this.params.strength = v;
  }
  private readonly material: THREE.ShaderMaterial;
  private geometry: THREE.InstancedBufferGeometry;
  private builtCount = 0;
  private readonly sun: SunLight | null;
  private readonly ap: ApertureUniforms;
  private readonly rays: SunRays = { dir: new THREE.Vector3(), apex: new THREE.Vector3() };

  /**
   * `sun` is the building sun whose compare-mode shadow map lights the dust (`diner.sunBeam`);
   * without it the strands never brighten in the beam.
   */
  constructor(params: Partial<SteamParams> = {}, sun: SunLight | null = null) {
    this.params = { ...defaultSteamParams(), ...params };
    this.sun = sun;
    this.ap = apertureUniforms();
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...this.ap,
        uTime: { value: 0 },
        uLife: { value: 1 },
        uRise: { value: 1 },
        uRadius: { value: 1 },
        uShear: { value: 0 },
        uShearScale: { value: 1 },
        uRelease: { value: 0 },
        uMeander: { value: 0 },
        uBurst: { value: 0 },
        uCurl: { value: 0 },
        uTear: { value: 0 },
        uWidth: { value: new THREE.Vector2() },
        uWind: { value: new THREE.Vector2() },
        uSrcVel: { value: new THREE.Vector3() },
        uFadePlane: { value: new THREE.Vector4() },
        uFadeWidth: { value: 0 },
        uHasSun: { value: 0 },
        uSunBoost: { value: 1 },
        uAlpha: { value: 1 },
        uSunRadiance: { value: new THREE.Color(1, 1, 1) },
        uAmbient: { value: new THREE.Color() },
        uOcclusion: { value: 1 },
        uShadowMap: { value: null },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uShadowBias: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.geometry = this.buildGeometry();
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.name = "post:steam";
    this.object.frustumCulled = false;
    this.object.renderOrder = 21;
    this.object.onBeforeRender = () => SteamEmitter.timer?.begin(this.object.name);
    this.object.onAfterRender = () => SteamEmitter.timer?.end();
  }

  private buildGeometry(): THREE.InstancedBufferGeometry {
    const count = Math.max(1, Math.round(this.params.count));
    const g = new THREE.InstancedBufferGeometry();
    // One strip: (SEGMENTS + 1) rows × 2 columns, `along` and `side` per vertex.
    const rows = SEGMENTS + 1;
    const position = new Float32Array(rows * 2 * 3); // unused by the shader, present for three's bounds
    const along = new Float32Array(rows * 2);
    const side = new Float32Array(rows * 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 2; c++) {
        const i = r * 2 + c;
        along[i] = r / SEGMENTS;
        side[i] = c === 0 ? -1 : 1;
        position[i * 3 + 1] = along[i];
      }
    }
    const index: number[] = [];
    for (let r = 0; r < SEGMENTS; r++) {
      const a = r * 2, b = a + 1, c = a + 2, d = a + 3;
      index.push(a, b, c, b, d, c);
    }
    g.setAttribute("position", new THREE.BufferAttribute(position, 3));
    g.setAttribute("along", new THREE.BufferAttribute(along, 1));
    g.setAttribute("side", new THREE.BufferAttribute(side, 1));
    g.setIndex(index);
    const seed = new Float32Array(count * 4);
    let s = 1234567 + count;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < count; i++) {
      seed[i * 4] = i / count + rnd() * 0.05; // staggered burst phases
      seed[i * 4 + 1] = (i + rnd() * 0.6) / count; // release angles spread round the disc
      seed[i * 4 + 2] = rnd();
      seed[i * 4 + 3] = rnd();
    }
    g.setAttribute("seed", new THREE.InstancedBufferAttribute(seed, 4));
    g.instanceCount = count;
    this.builtCount = count;
    return g;
  }

  /** Call once per frame with a monotonic clock in seconds. */
  update(time: number): void {
    const p = this.params;
    if (Math.round(p.count) !== this.builtCount) {
      this.geometry.dispose();
      this.geometry = this.buildGeometry();
      this.object.geometry = this.geometry;
    }
    this.object.visible = p.strength > 0.001;
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uLife.value = Math.max(0.05, p.life);
    u.uRise.value = p.rise;
    u.uRadius.value = p.radius;
    u.uShear.value = p.shear;
    u.uShearScale.value = Math.max(0.05, p.shearScale);
    u.uRelease.value = p.release;
    u.uMeander.value = p.meander;
    u.uBurst.value = p.burst;
    u.uCurl.value = p.curl;
    // Wake tear rate (1/s): a rim moving at 0.3 m/s shreds a parcel in ~0.2 s, a 3 m/s² jerk in ~0.5 s.
    u.uTear.value = this.velocity.length() / 0.06 + Math.min(6, this.acceleration.length()) / 1.5;
    (u.uWidth.value as THREE.Vector2).set(p.width[0], p.width[1]);
    (u.uWind.value as THREE.Vector2).set(p.wind[0], p.wind[1]);
    (u.uSrcVel.value as THREE.Vector3).copy(this.velocity);
    if (p.fadePlane) {
      (u.uFadePlane.value as THREE.Vector4).copy(p.fadePlane);
      u.uFadeWidth.value = Math.max(1e-4, p.fadeWidth);
    } else u.uFadeWidth.value = 0;
    (u.uAmbient.value as THREE.Color).copy(p.color).multiplyScalar(p.intensity);
    u.uOcclusion.value = p.occlusion;
    u.uAlpha.value = p.alpha * p.strength * p.backdrop;
    u.uSunBoost.value = p.sunBoost;
    const sun = this.sun;
    const depth = sun?.shadow.map?.depthTexture ?? null;
    if (sun && depth) {
      setSunUniforms(this.ap, sunRaysOf(sun, this.rays));
      (u.uSunRadiance.value as THREE.Color).copy(sun.color).multiplyScalar(sun.intensity);
      u.uShadowMap.value = depth;
      (u.uShadowMatrix.value as THREE.Matrix4).copy(sun.shadow.matrix);
      u.uShadowBias.value = sun.shadow.bias;
      u.uHasSun.value = 1;
    } else u.uHasSun.value = 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.object.removeFromParent();
  }
}
