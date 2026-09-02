/**
 * GLSL for the System 8 screen passes. All passes are full-screen triangles
 * (three's FullScreenQuad); the vertex shader below ignores the camera.
 */
import { apertureGlsl, MAX_APERTURES, shadowGlsl } from "./beams";

export const fsVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

/** Shared: depth → view-space distance and world position (non-reversed perspective depth). */
const depthGlsl = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 uInvProj;
  uniform mat4 uInvView;
  uniform vec3 uCamPos;
  uniform float uNear, uFar;
  float viewDepth(float d) {
    // perspectiveDepthToViewZ, negated (positive metres in front of the camera)
    return (uNear * uFar) / (uFar - d * (uFar - uNear));
  }
  vec3 worldPos(vec2 uv, float d) {
    vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 v = uInvProj * clip;
    v /= v.w;
    return (uInvView * v).xyz;
  }
  float ign(vec2 px) { // interleaved gradient noise
    return fract(52.9829189 * fract(0.06711056 * px.x + 0.00583715 * px.y));
  }
`;

/**
 * Volumetric hint: single-scatter march inside the beam bounding box, lit where
 * the aperture test × shadow map say the sun reaches. Output rgb = in-scattered
 * radiance (scene-linear), a = the pixel's view depth for the depth-aware upsample.
 */
export const hazeFragment = /* glsl */ `
  varying vec2 vUv;
  ${depthGlsl}
  ${apertureGlsl(MAX_APERTURES)}
  ${shadowGlsl}
  uniform vec3 uBoxMin, uBoxMax;
  uniform vec3 uSunRadiance;
  uniform float uStrength, uG;
  uniform int uSteps;
  void main() {
    float d = texture2D(tDepth, vUv).r;
    float vd = viewDepth(d);
    vec3 P = worldPos(vUv, d);
    vec3 o = uCamPos;
    vec3 dir = P - o;
    float tEnd = length(dir);
    dir /= max(tEnd, 1e-4);
    vec3 inv = 1.0 / dir;
    vec3 ta = (uBoxMin - o) * inv, tb = (uBoxMax - o) * inv;
    vec3 tmn = min(ta, tb), tmx = max(ta, tb);
    float t0 = max(max(tmn.x, tmn.y), max(tmn.z, 0.0));
    float t1 = min(min(tmx.x, tmx.y), min(tmx.z, tEnd));
    vec3 rad = vec3(0.0);
    if (t1 > t0) {
      float ds = (t1 - t0) / float(uSteps);
      float j = ign(gl_FragCoord.xy);
      float lit = 0.0;
      for (int i = 0; i < 64; i++) {
        if (i >= uSteps) break;
        vec3 p = o + dir * (t0 + (float(i) + j) * ds);
        lit += inBeam(p) * sunVisibleSoft(p);
      }
      float c = dot(dir, uSunDir);
      float g2 = uG * uG;
      float hg = (1.0 - g2) / pow(1.0 + g2 - 2.0 * uG * c, 1.5);
      float hgRef = (1.0 - g2) / pow(1.0 + g2 - 2.0 * uG * 0.9063, 1.5); // normalised at 25° off the sun
      float phase = min(1.6, hg / hgRef);
      rad = uSunRadiance * (uStrength * lit * ds * phase);
    }
    gl_FragColor = vec4(rad, vd);
  }
`;

/**
 * Composite: scene + haze (depth-aware upsample) with the exterior heat shimmer
 * applied to the scene fetch. Interior pixels are never displaced and never
 * fetched from a displaced location that lands on the interior.
 */
export const compositeFragment = /* glsl */ `
  varying vec2 vUv;
  ${depthGlsl}
  ${apertureGlsl(MAX_APERTURES)}
  uniform sampler2D tScene, tHaze;
  uniform vec2 uResolution, uHazeSize;
  uniform float uTime;
  uniform float uShimmerAmp, uShimmerFreq, uShimmerSpeed, uShimmerScroll, uMinDepth, uHeightFade, uWallZ;
  uniform int uShimmerOn, uHazeOn, uDebug;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  void main() {
    float d = texture2D(tDepth, vUv).r;
    float vd = viewDepth(d);
    vec3 P = worldPos(vUv, d);

    // ---- heat shimmer mask: exterior only, far, near the asphalt / the horizon line ----
    // The window glass writes depth, so a pixel "through the glass" reads as the pane itself
    // (|z − glassZ| < 2 cm inside a pane rectangle). For those the exterior distance is
    // estimated from where the view ray meets the lot surface (y = −0.15); an open doorway
    // or a camera outside sees real exterior depth and uses it directly.
    float w = 0.0;
    vec3 dir = normalize(P - uCamPos);
    bool onGlass = abs(P.z - uGlassZ) < 0.02 && inApertureXY(P.xy) > 0.5;
    bool exterior = vd > uMinDepth && P.z > uWallZ;
    if (uShimmerOn == 1 && (onGlass || exterior)) {
      float tGround = dir.y < -1e-3 ? (uCamPos.y + 0.15) / (-dir.y) : 1e4;
      float dist = onGlass ? tGround : vd;
      float y = onGlass ? (dir.y < -1e-3 ? -0.15 : 50.0) : P.y;
      float distRamp = smoothstep(uMinDepth, uMinDepth * 2.5, dist);
      float wHeight = 1.0 - smoothstep(0.0, uHeightFade, y + 0.15); // lot surface is at y = -0.15
      float wHorizon = 1.0 - smoothstep(0.0, 0.06, dir.y);          // ~3.4° above horizontal
      w = distRamp * max(wHeight, wHorizon);
    }
    vec2 uv = vUv;
    if (w > 0.001) {
      // Two octaves, rising: plumes scroll up at uShimmerScroll screen-heights/s and churn at uShimmerSpeed Hz.
      vec2 q = vec2(vUv.x * uShimmerFreq, vUv.y * uShimmerFreq * 0.55 - uTime * uShimmerScroll * uShimmerFreq * 0.55);
      float tt = uTime * uShimmerSpeed;
      float nx = vnoise(q + vec2(tt * 0.7, 0.0)) * 0.65 + vnoise(q * 2.1 + vec2(3.7, tt * 1.3)) * 0.35;
      float ny = vnoise(q + vec2(11.3, tt * 0.9)) * 0.65 + vnoise(q * 2.1 + vec2(tt * 1.1, 5.2)) * 0.35;
      vec2 off = (vec2(nx, ny) - 0.5) * 2.0 * uShimmerAmp * w / uResolution;
      vec2 uv2 = vUv + off;
      float d2 = texture2D(tDepth, uv2).r;
      vec3 P2 = worldPos(uv2, d2);
      // Only fetch from another glass/exterior pixel: a slat or frame must never smear into the lot.
      bool onGlass2 = abs(P2.z - uGlassZ) < 0.02 && inApertureXY(P2.xy) > 0.5;
      bool exterior2 = viewDepth(d2) > uMinDepth && P2.z > uWallZ;
      if (onGlass2 || exterior2) uv = uv2;
    }
    vec3 col = texture2D(tScene, uv).rgb;

    // ---- haze: 4-tap depth-aware upsample from the half-res march ----
    vec3 haze = vec3(0.0);
    if (uHazeOn == 1) {
      vec2 hc = vUv * uHazeSize - 0.5;
      vec2 f = fract(hc);
      vec2 base = (floor(hc) + 0.5) / uHazeSize;
      vec2 tx = 1.0 / uHazeSize;
      vec4 h00 = texture2D(tHaze, base), h10 = texture2D(tHaze, base + vec2(tx.x, 0.0));
      vec4 h01 = texture2D(tHaze, base + vec2(0.0, tx.y)), h11 = texture2D(tHaze, base + tx);
      float w00 = (1.0 - f.x) * (1.0 - f.y) / (0.02 + abs(h00.a - vd) / vd);
      float w10 = f.x * (1.0 - f.y) / (0.02 + abs(h10.a - vd) / vd);
      float w01 = (1.0 - f.x) * f.y / (0.02 + abs(h01.a - vd) / vd);
      float w11 = f.x * f.y / (0.02 + abs(h11.a - vd) / vd);
      haze = (h00.rgb * w00 + h10.rgb * w10 + h01.rgb * w01 + h11.rgb * w11) / max(1e-5, w00 + w10 + w01 + w11);
    }
    col += haze;

    if (uDebug == 1) col = vec3(w);
    else if (uDebug == 2) col = haze * 20.0;
    else if (uDebug == 3) col = vec3(inBeam(P));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Bloom prefilter: luminance soft-knee threshold, written at half res. */
export const bloomPrefilterFragment = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform vec2 uTexel;
  uniform float uThreshold, uKnee;
  void main() {
    // 4-tap box over the full-res 2×2 footprint plus its neighbours: fewer fireflies from 1-px pings.
    vec3 c = texture2D(tColor, vUv).rgb * 0.5
      + (texture2D(tColor, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tColor, vUv - vec2(uTexel.x, 0.0)).rgb
      + texture2D(tColor, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tColor, vUv - vec2(0.0, uTexel.y)).rgb) * 0.125;
    float l = max(c.r, max(c.g, c.b));
    float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    float contrib = max(soft, l - uThreshold) / max(l, 1e-4);
    gl_FragColor = vec4(c * contrib, 1.0);
  }
`;

/** Separable 9-tap Gaussian (σ ≈ 1.6 texels × uRadius). */
export const blurFragment = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform vec2 uDir; // texel step
  void main() {
    vec3 c = texture2D(tColor, vUv).rgb * 0.2270270270;
    c += (texture2D(tColor, vUv + uDir * 1.3846153846).rgb + texture2D(tColor, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;
    c += (texture2D(tColor, vUv + uDir * 3.2307692308).rgb + texture2D(tColor, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;
    gl_FragColor = vec4(c, 1.0);
  }
`;

/** 4-tap tent downsample (half → quarter). */
export const downsampleFragment = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform vec2 uTexel;
  void main() {
    vec3 c = texture2D(tColor, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tColor, vUv + uTexel * vec2(0.5, -0.5)).rgb
      + texture2D(tColor, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tColor, vUv + uTexel * vec2(0.5, 0.5)).rgb;
    gl_FragColor = vec4(c * 0.25, 1.0);
  }
`;

/**
 * Photographic finish. Lens (CA + corner softness) → bloom add → vignette →
 * tone map → optional highlight desaturation → sRGB → optional grain.
 * GRAIN is a define so the SMAA path can run it as a separate last pass.
 */
export const finishFragment = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tColor, tBloomHalf, tBloomQuarter;
  uniform vec2 uResolution;
  uniform float uBloomStrength;
  uniform float uVignetteEV, uVignettePower, uCA, uCornerSoft, uCornerSoftStart, uHighlightDesat;
  uniform int uToneMap, uBloomOn, uDebug;
  uniform float uGrain, uGrainChroma, uGrainSize, uFrame;
  // declares uniform float toneMappingExposure + ACESFilmic / AgX / Neutral
  #include <tonemapping_pars_fragment>

  vec3 lensFetch(vec2 uv, vec2 c, float r) {
    // Lateral CA: red magnified, blue shrunk, by uCA px at the frame corner (∝ r²).
    vec2 radial = c / max(r, 1e-4);
    vec2 caOff = radial * (uCA * r * r) / uResolution;
    float soft = uCornerSoft * smoothstep(uCornerSoftStart, 1.0, r);
    vec2 s = soft / uResolution;
    vec2 uvR = uv + caOff, uvB = uv - caOff;
    if (soft < 0.02) {
      return vec3(texture2D(tColor, uvR).r, texture2D(tColor, uv).g, texture2D(tColor, uvB).b);
    }
    // 5-tap disc per channel; total blur radius ≈ soft px at the extreme corner.
    vec2 o1 = vec2(s.x, s.y), o2 = vec2(-s.x, s.y);
    float rr = 0.4 * texture2D(tColor, uvR).r + 0.15 * (texture2D(tColor, uvR + o1).r + texture2D(tColor, uvR - o1).r + texture2D(tColor, uvR + o2).r + texture2D(tColor, uvR - o2).r);
    float gg = 0.4 * texture2D(tColor, uv).g + 0.15 * (texture2D(tColor, uv + o1).g + texture2D(tColor, uv - o1).g + texture2D(tColor, uv + o2).g + texture2D(tColor, uv - o2).g);
    float bb = 0.4 * texture2D(tColor, uvB).b + 0.15 * (texture2D(tColor, uvB + o1).b + texture2D(tColor, uvB - o1).b + texture2D(tColor, uvB + o2).b + texture2D(tColor, uvB - o2).b);
    return vec3(rr, gg, bb);
  }

  vec3 srgbOETF(vec3 c) {
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(lo, hi, step(vec3(0.0031308), c));
  }

  uint pcg(uint v) {
    uint s = v * 747796405u + 2891336453u;
    uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
  }
  float grainNoise(vec2 px, float frame, float salt) {
    uvec2 p = uvec2(px / uGrainSize);
    uint h = pcg(p.x + pcg(p.y + pcg(uint(frame) * 3u + uint(salt))));
    uint h2 = pcg(h + 0x9e3779b9u);
    // triangular distribution in [-1, 1]
    return (float(h) + float(h2)) / 4294967296.0 - 1.0;
  }

  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) / 0.70710678; // 1 at the corners
    vec3 col = lensFetch(vUv, c, r);
    if (uBloomOn == 1) col += (texture2D(tBloomHalf, vUv).rgb * 0.5 + texture2D(tBloomQuarter, vUv).rgb * 0.5) * uBloomStrength;
    if (uDebug == 4) col = texture2D(tBloomQuarter, vUv).rgb * 4.0;
    // Natural falloff: cos⁴-like, uVignetteEV stops at the corner.
    col *= exp2(-uVignetteEV * pow(r, uVignettePower));

    if (uToneMap == 0) col = ACESFilmicToneMapping(col);
    else if (uToneMap == 1) col = AgXToneMapping(col);
    else if (uToneMap == 2) col = NeutralToneMapping(col);
    else col = clamp(col * toneMappingExposure, 0.0, 1.0);

    if (uHighlightDesat > 0.0) {
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float k = uHighlightDesat * smoothstep(0.7, 1.0, max(col.r, max(col.g, col.b)));
      col = mix(col, vec3(l), k);
    }
    col = srgbOETF(clamp(col, 0.0, 1.0));

    #ifdef GRAIN
    if (uGrain > 0.0) {
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // Strongest in the low-mids, fading in the highlights; uGrain is the mid-grey amplitude.
      float amp = uGrain * 2.0 * (1.0 - l) * clamp(l / 0.25, 0.0, 1.0);
      float n = grainNoise(gl_FragCoord.xy, uFrame, 0.0);
      vec3 nc = vec3(grainNoise(gl_FragCoord.xy, uFrame, 1.0), grainNoise(gl_FragCoord.xy, uFrame, 2.0), grainNoise(gl_FragCoord.xy, uFrame, 3.0));
      col += amp * mix(vec3(n), nc, uGrainChroma);
    }
    #endif
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Grain only, on an already display-encoded buffer (after SMAA). */
export const grainFragment = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform float uGrain, uGrainChroma, uGrainSize, uFrame;
  uint pcg(uint v) {
    uint s = v * 747796405u + 2891336453u;
    uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
  }
  float grainNoise(vec2 px, float frame, float salt) {
    uvec2 p = uvec2(px / uGrainSize);
    uint h = pcg(p.x + pcg(p.y + pcg(uint(frame) * 3u + uint(salt))));
    uint h2 = pcg(h + 0x9e3779b9u);
    return (float(h) + float(h2)) / 4294967296.0 - 1.0;
  }
  void main() {
    vec3 col = texture2D(tColor, vUv).rgb;
    if (uGrain > 0.0) {
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float amp = uGrain * 2.0 * (1.0 - l) * clamp(l / 0.25, 0.0, 1.0);
      float n = grainNoise(gl_FragCoord.xy, uFrame, 0.0);
      vec3 nc = vec3(grainNoise(gl_FragCoord.xy, uFrame, 1.0), grainNoise(gl_FragCoord.xy, uFrame, 2.0), grainNoise(gl_FragCoord.xy, uFrame, 3.0));
      col += amp * mix(vec3(n), nc, uGrainChroma);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;
