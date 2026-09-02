/**
 * SteamEmitter — faint procedural steam (coffee decanter, filled mug).
 *
 * Reusable by System 7 for the pour:
 *
 *   import { SteamEmitter } from "../post/Steam";
 *   const steam = new SteamEmitter({ count: 20, radius: 0.03, rise: 0.3, life: 2.8, size: [0.02, 0.09], strength: 0.5 });
 *   scene.add(steam.object);
 *   steam.object.position.set(x, rimY, z);          // the emitter origin (world), move it any time
 *   steam.strength = 0;                              // fade out (multiplier on alpha, 0–1+)
 *   steam.update(timeSeconds);                       // once per frame with a shared clock
 *   steam.dispose();
 *
 * Every parameter is a plain public field on `params` and is re-read each update,
 * so `steam.params.rise = 0.6` just works. The emitter is one instanced draw
 * (count billboards), time-driven in the vertex shader — no per-frame CPU work.
 *
 * Look: each particle is a soft billboard whose alpha is a two-octave value noise
 * scrolled along its life (so the puff evolves, not just fades), rising with a
 * slow spiral curl and spreading as it climbs; colour × intensity is the
 * scattered light (scene-linear; System 4 sets it to the fluorescent/sky fill it
 * actually receives). Premultiplied blending: adds scattered light and slightly
 * occludes what is behind (`occlusion`), which is what a thin vapour does.
 */
import * as THREE from "three";

export interface SteamParams {
  /** Billboards alive at any moment. 16–40. */
  count: number;
  /** Emitter mouth radius, m. */
  radius: number;
  /** Vertical rise over one life, m. */
  rise: number;
  /** Particle life, s. */
  life: number;
  /** Billboard diameter at birth and death, m. */
  size: [number, number];
  /** Horizontal spread at the top of the rise, m. */
  spread: number;
  /** Spiral curl rate, rad per life. */
  curl: number;
  /** Alpha multiplier; 0.3–0.6 for barely-there ambient steam, 1.0–1.5 for a fresh pour. */
  strength: number;
  /** Scattered-light colour (scene-linear, multiplied by `intensity`). */
  color: THREE.Color;
  intensity: number;
  /** 0–1 how much the vapour dims what is behind it. */
  occlusion: number;
  /** Per-particle peak alpha before `strength`. */
  alpha: number;
  /** Side-drift (m/s) — a draught across the counter. */
  wind: [number, number];
}

export function defaultSteamParams(): SteamParams {
  return {
    count: 28,
    radius: 0.045,
    rise: 0.4,
    life: 3.6,
    size: [0.035, 0.14],
    spread: 0.06,
    curl: 2.2,
    strength: 0.35,
    color: new THREE.Color(1.0, 0.98, 0.95),
    intensity: 0.9,
    occlusion: 0.5,
    alpha: 0.11,
    wind: [0.006, -0.004],
  };
}

const vertexShader = /* glsl */ `
  attribute vec4 seed;     // phase, angle, size jitter, noise offset
  uniform float uTime, uLife, uRise, uRadius, uSpread, uCurl;
  uniform vec2 uSize, uWind;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vNoiseOff;
  varying float vAge;
  void main() {
    float age = fract(uTime / uLife + seed.x);
    float t = age * uLife;
    // Birth on the mouth ring, then a slow spiral outward; ease the rise (buoyant start, drag later).
    float ang = seed.y + age * uCurl + sin(t * 0.9 + seed.w) * 0.6;
    float r = uRadius * (0.5 + 0.5 * fract(seed.z * 7.13)) + uSpread * age * age;
    vec3 local = vec3(cos(ang) * r, uRise * (1.0 - pow(1.0 - age, 1.6)), sin(ang) * r);
    local.xz += uWind * t;
    // Small lateral wobble (turbulence) growing with age.
    local.x += sin(t * 1.7 + seed.w * 3.0) * 0.012 * age;
    local.z += cos(t * 1.3 + seed.y * 2.0) * 0.012 * age;
    vec4 origin = modelMatrix * vec4(local, 1.0);
    vec4 mv = viewMatrix * origin;
    float size = mix(uSize.x, uSize.y, age) * (0.85 + 0.3 * seed.z);
    mv.xy += (uv - 0.5) * size;
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vAge = age;
    vNoiseOff = seed.w * 10.0;
    vAlpha = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.35, 1.0, age));
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity, uOcclusion, uAlpha;
  varying vec2 vUv;
  varying float vAlpha, vNoiseOff, vAge;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec2 d = vUv - 0.5;
    float r2 = dot(d, d) * 4.0;
    float disc = exp(-r2 * 3.0) * smoothstep(1.0, 0.55, r2);
    // Two octaves of noise that drift upward with age so the puff churns instead of scaling.
    vec2 q = vUv * 3.0 + vec2(vNoiseOff, -vAge * 2.5);
    float n = vnoise(q) * 0.65 + vnoise(q * 2.3 + 7.1) * 0.35;
    n = smoothstep(0.32, 0.82, n);
    float a = disc * n * vAlpha * uAlpha;
    // Premultiplied: rgb adds the scattered light, alpha dims the background by uOcclusion.
    gl_FragColor = vec4(uColor * uIntensity * a, a * uOcclusion);
  }
`;

export class SteamEmitter {
  readonly object: THREE.Mesh;
  readonly params: SteamParams;
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

  constructor(params: Partial<SteamParams> = {}) {
    this.params = { ...defaultSteamParams(), ...params };
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uLife: { value: 1 },
        uRise: { value: 1 },
        uRadius: { value: 1 },
        uSpread: { value: 1 },
        uCurl: { value: 1 },
        uSize: { value: new THREE.Vector2() },
        uWind: { value: new THREE.Vector2() },
        uColor: { value: new THREE.Color() },
        uIntensity: { value: 1 },
        uOcclusion: { value: 1 },
        uAlpha: { value: 1 },
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
  }

  private buildGeometry(): THREE.InstancedBufferGeometry {
    const count = Math.max(1, Math.round(this.params.count));
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.setAttribute("position", quad.getAttribute("position"));
    g.setAttribute("uv", quad.getAttribute("uv"));
    g.setIndex(quad.getIndex());
    const seed = new Float32Array(count * 4);
    let s = 1234567 + count;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < count; i++) {
      seed[i * 4] = i / count + rnd() * 0.02; // evenly staggered births
      seed[i * 4 + 1] = rnd() * Math.PI * 2;
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
    u.uLife.value = p.life;
    u.uRise.value = p.rise;
    u.uRadius.value = p.radius;
    u.uSpread.value = p.spread;
    u.uCurl.value = p.curl;
    (u.uSize.value as THREE.Vector2).set(p.size[0], p.size[1]);
    (u.uWind.value as THREE.Vector2).set(p.wind[0], p.wind[1]);
    (u.uColor.value as THREE.Color).copy(p.color);
    u.uIntensity.value = p.intensity;
    u.uOcclusion.value = p.occlusion;
    u.uAlpha.value = p.alpha * p.strength;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.object.removeFromParent();
  }
}
