/**
 * Sun-beam dust: a few thousand motes suspended only in the beam prisms.
 *
 * Physics, from REFERENCE §5: visible motes are 10–100 µm, a 30 µm mote at 2 m
 * subtends 0.05 px so it renders as the lens PSF (1–3 px soft disc); motion is a
 * 1–5 cm/s drift with lazy curls plus slow convection; visibility is Mie forward
 * scattering (HG g ≈ 0.7–0.85) so motes are vivid looking toward the window and
 * vanish with the sun behind the camera; a mote crossing a slat shadow blinks off.
 *
 * Implementation: THREE.Points with all motion computed in the vertex shader
 * from a per-mote seed (bounded sum-of-sines, so nothing leaves its beam and
 * there is no CPU/GPU traffic per frame). Lighting = analytic aperture test ×
 * hardware-PCF shadow-map fetch in the vertex shader × HG phase × twinkle.
 * Additive, depth-tested against the scene, no depth write. Drawn inside the
 * scene pass so it is MSAA-resolved with everything else.
 */
import * as THREE from "three";
import { makeRng } from "../core/rng";
import { apertureGlsl, apertureUniforms, MAX_APERTURES, sampleBeamPoints, setSunUniforms, shadowGlsl, sunRaysOf, type ApertureUniforms, type SunLight, type SunRays } from "./beams";
import type { PostSettings } from "./settings";

const vertexShader = /* glsl */ `
  attribute vec4 seed;   // phase x, phase y, phase z, twinkle phase
  attribute vec2 kind;   // size px, brightness class (0 dim … 1 sparkly)
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uBokeh;
  uniform float uDrift, uDriftPeriod, uRise;
  uniform float uG, uTwinkle;
  uniform int uDebugLit;
  uniform vec3 uCamPos;
  varying float vLight;
  varying float vSoft;
  ${apertureGlsl(MAX_APERTURES)}
  ${shadowGlsl}

  // Bounded Brownian-looking drift: three incommensurate sines per axis. Amplitude uDrift,
  // characteristic period uDriftPeriod. The rise is a slow sawtooth folded into a sine so
  // the mote climbs ~uRise m/s for half a period and sinks back (convective cell).
  vec3 drift(vec4 s, float t) {
    float w = 6.2831853 / uDriftPeriod;
    vec3 p;
    p.x = sin(t * w * 1.00 + s.x) * 0.55 + sin(t * w * 2.31 + s.y * 1.7) * 0.3 + sin(t * w * 4.73 + s.z * 0.9) * 0.15;
    p.y = sin(t * w * 0.87 + s.y) * 0.45 + sin(t * w * 2.03 + s.z * 1.3) * 0.3 + sin(t * w * 5.11 + s.x * 1.1) * 0.15;
    p.z = sin(t * w * 1.13 + s.z) * 0.55 + sin(t * w * 2.67 + s.x * 1.9) * 0.3 + sin(t * w * 4.31 + s.y * 0.7) * 0.15;
    p *= uDrift;
    float riseT = 60.0; // s per convective cycle
    p.y += uRise * riseT / 6.2831853 * sin(t * 6.2831853 / riseT + s.w);
    return p;
  }

  void main() {
    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz + drift(seed, uTime);
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = max(0.05, -mv.z);

    // Lit only where the sun actually reaches: aperture prism × shadow map (slats, frames, furniture).
    float lit = inBeam(wp) * sunVisible(wp);
    if (uDebugLit == 1) lit = inBeam(wp);          // debug: ignore the shadow map
    else if (uDebugLit == 2) lit = 1.0;            // debug: show every mote

    // Mie forward lobe: cosθ between the view ray and the direction to the sun. Normalised
    // to 1 at 25° off the sun (the closest a view can get past the slats) so uIntensity
    // means "brightness of a mote when you look toward the window"; 90° ≈ 0.12, 135° ≈ 0.05.
    vec3 v = normalize(wp - uCamPos);
    float c = dot(v, uSunDir);
    float g2 = uG * uG;
    float hg = (1.0 - g2) / pow(1.0 + g2 - 2.0 * uG * c, 1.5);
    float hgRef = (1.0 - g2) / pow(1.0 + g2 - 2.0 * uG * 0.9063, 1.5);
    float phase = min(1.6, hg / hgRef);

    // Twinkle: a flake tumbling shows a varying cross-section (two beat frequencies).
    float tw = 0.5 + 0.5 * sin(uTime * (1.3 + kind.y * 2.0) + seed.w) * sin(uTime * 0.37 + seed.x);
    float twinkle = mix(1.0, tw, uTwinkle);

    // PSF disc 1–3 px; nearer than ~0.8 m the circle of confusion opens (focus ≈ 3 m, f/5.6).
    float coc = uBokeh * max(0.0, 1.0 / dist - 1.0 / 0.8) * 0.3;
    float px = kind.x + coc;
    gl_PointSize = px * uPixelRatio;
    vSoft = clamp((px - 1.0) / 2.0, 0.0, 1.0);
    // Energy of a defocused disc spreads over its area; keep total flux constant.
    float spread = (kind.x * kind.x) / (px * px);
    vLight = lit * phase * twinkle * mix(0.45, 1.0, kind.y) * spread;
    if (lit < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // cull: off-screen
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunRadiance;
  uniform float uIntensity;
  uniform float uMaxRadiance;
  varying float vLight;
  varying float vSoft;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r2 = dot(d, d) * 4.0;
    // Gaussian-ish PSF; a 1 px point stays a 1 px point (little softness), a 3 px disc is soft.
    float a = exp(-r2 * mix(1.6, 2.6, vSoft));
    a *= smoothstep(1.0, 0.6, r2);
    // Peak radiance capped under the bloom knee (PostPipeline sets it): a mote is a white
    // speck, never a bloom halo. The PSF profile is applied after the cap so the disc keeps its shape.
    vec3 c = uSunRadiance * (uIntensity * vLight);
    float l = max(c.r, max(c.g, c.b));
    c *= min(1.0, uMaxRadiance / max(l, 1e-6));
    gl_FragColor = vec4(c * a, 1.0);
  }
`;

export class SunDust {
  readonly points: THREE.Points;
  /** Scene-linear ceiling on a mote's peak radiance (PostPipeline: just under the bloom knee). */
  maxRadiance = 1e6;
  private readonly material: THREE.ShaderMaterial;
  private readonly sun: SunLight;
  private readonly settings: PostSettings["dust"];
  private geometry: THREE.BufferGeometry;
  private spawnedCount = 0;
  private readonly rays: SunRays = { dir: new THREE.Vector3(), apex: null };
  private readonly ap: ApertureUniforms;

  /** `sun` is the building sun (`Diner.sun`, a SpotLight since System 3 rev 2; a DirectionalLight also works). */
  constructor(sun: SunLight, settings: PostSettings["dust"], pixelRatio: number) {
    this.sun = sun;
    this.settings = settings;
    this.ap = apertureUniforms();
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...this.ap,
        uTime: { value: 0 },
        uPixelRatio: { value: pixelRatio },
        uBokeh: { value: settings.bokeh },
        uDrift: { value: settings.drift },
        uDriftPeriod: { value: settings.driftPeriod },
        uRise: { value: settings.rise },
        uG: { value: settings.g },
        uTwinkle: { value: settings.twinkle },
        uDebugLit: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uSunRadiance: { value: new THREE.Color() },
        uIntensity: { value: settings.intensity },
        uMaxRadiance: { value: 1e6 },
        uShadowMap: { value: null },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uShadowBias: { value: 0 },
      },
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    });
    this.geometry = this.buildGeometry();
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = "post:sun-dust";
    this.points.frustumCulled = false;
    this.points.renderOrder = 20; // after the glass so the transparent sort never puts motes behind it
  }

  private buildGeometry(): THREE.BufferGeometry {
    const count = Math.max(1, Math.round(this.settings.count));
    const rng = makeRng(8801 + count);
    sunRaysOf(this.sun, this.rays);
    const pos = sampleBeamPoints(count, this.rays, rng);
    const seed = new Float32Array(count * 4);
    const kind = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      seed[i * 4] = rng() * Math.PI * 2;
      seed[i * 4 + 1] = rng() * Math.PI * 2;
      seed[i * 4 + 2] = rng() * Math.PI * 2;
      seed[i * 4 + 3] = rng() * Math.PI * 2;
      const bright = rng() < this.settings.brightFraction ? 1 : 0;
      // Size ∝ the mote's physical size class: the sparkly 30–50 µm ones sit at the top of the PSF range.
      const u = rng();
      const size = this.settings.sizeMin + (this.settings.sizeMax - this.settings.sizeMin) * (bright ? 0.6 + 0.4 * u : u * u);
      kind[i * 2] = size;
      kind[i * 2 + 1] = bright ? 0.7 + 0.3 * rng() : rng() * 0.5;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("seed", new THREE.BufferAttribute(seed, 4));
    g.setAttribute("kind", new THREE.BufferAttribute(kind, 2));
    this.spawnedCount = count;
    return g;
  }

  /** Re-sample the spawn volume (after `count` changes or System 4 moves the sun). */
  respawn(): void {
    this.geometry.dispose();
    this.geometry = this.buildGeometry();
    this.points.geometry = this.geometry;
  }

  update(time: number, camera: THREE.Camera, pixelRatio: number, debugLit = 0): void {
    const s = this.settings;
    this.material.uniforms.uDebugLit.value = debugLit;
    if (Math.round(s.count) !== this.spawnedCount) this.respawn();
    this.points.visible = s.enabled;
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uPixelRatio.value = pixelRatio;
    u.uBokeh.value = s.bokeh;
    u.uDrift.value = s.drift;
    u.uDriftPeriod.value = s.driftPeriod;
    u.uRise.value = s.rise;
    u.uG.value = s.g;
    u.uTwinkle.value = s.twinkle;
    u.uIntensity.value = s.intensity;
    u.uMaxRadiance.value = this.maxRadiance;
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    setSunUniforms(this.ap, sunRaysOf(this.sun, this.rays));
    (u.uSunRadiance.value as THREE.Color).copy(this.sun.color).multiplyScalar(this.sun.intensity);
    // Shadow-once (Diner.ts): the map is rendered at boot and on invalidateShadows(); the
    // depth texture object persists between renders, so this is the live map every frame.
    const shadow = this.sun.shadow;
    u.uShadowMap.value = shadow.map?.depthTexture ?? null;
    u.uShadowMatrix.value.copy(shadow.matrix);
    u.uShadowBias.value = shadow.bias;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
