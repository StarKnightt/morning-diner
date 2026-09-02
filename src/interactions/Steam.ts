/**
 * Steam off a fresh mug: a handful of billboarded soft quads driven entirely
 * in the shader from one time uniform (no per-frame instance updates, no
 * allocations). Each quad is a puff with its own seed: it rises 5–10 cm/s
 * from the rim, drifts, grows, and its alpha is a radial falloff × two
 * octaves of value noise. Intensity ramps in over the pour and fades out
 * 20–30 s later. Deliberately modest — System 8 may extend it.
 */
import * as THREE from "three";

const COUNT = 22;

const VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform vec3 uOrigin;
uniform float uIntensity;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
float h1(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
void main(){
  vUv = uv;
  vSeed = aSeed;
  float life = 2.6 + 1.2 * h1(aSeed + 3.1);
  float ph = fract(uTime / life + aSeed);
  float age = ph * life;
  // Rise with a gentle acceleration, spiral drift, and a slow room draught toward +x.
  float rise = 0.055 * age + 0.012 * age * age;
  float ang = 6.2831 * h1(aSeed + 7.7) + age * (0.9 + h1(aSeed + 9.3));
  float rad = 0.006 + 0.014 * age;
  vec3 p = uOrigin + vec3(cos(ang) * rad + 0.018 * age, rise, sin(ang) * rad);
  float size = 0.045 + 0.05 * age;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = p + (right * position.x + up * position.y) * size;
  float fadeIn = smoothstep(0.0, 0.35, age);
  float fadeOut = 1.0 - smoothstep(life * 0.45, life, age);
  vAlpha = fadeIn * fadeOut * uIntensity * (0.55 + 0.45 * h1(aSeed + 1.7));
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1,0)), f.x), mix(h2(i + vec2(0,1)), h2(i + vec2(1,1)), f.x), f.y);
}
void main(){
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float fall = 1.0 - r * r;
  fall *= fall;
  vec2 q = vUv * 3.0 + vec2(vSeed * 17.0, uTime * 0.25);
  float n = 0.6 * vnoise(q) + 0.4 * vnoise(q * 2.3 + 5.0);
  float a = fall * smoothstep(0.28, 0.85, n) * vAlpha * 0.42;
  vec3 col = vec3(0.82, 0.81, 0.79);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Steam {
  readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;
  private time = 0;
  /** Seconds since the steam started, or −1 when off. */
  private started = -1;

  constructor(parent: THREE.Object3D) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const seeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) seeds[i] = (i + 0.5) / COUNT;
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uOrigin: { value: new THREE.Vector3() },
        uIntensity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, COUNT);
    // Identity instance matrices; all motion happens in the shader.
    const m = new THREE.Matrix4();
    for (let i = 0; i < COUNT; i++) this.mesh.setMatrixAt(i, m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    this.mesh.name = "steam";
    parent.add(this.mesh);
  }

  /** Where the puffs are born (mug rim centre, world). */
  setOrigin(p: THREE.Vector3): void {
    (this.material.uniforms.uOrigin.value as THREE.Vector3).copy(p);
  }

  start(): void {
    this.started = 0;
    this.mesh.visible = true;
  }

  stop(): void {
    this.started = -1;
    this.mesh.visible = false;
    this.material.uniforms.uIntensity.value = 0;
  }

  /** Jump to `seconds` after start (deterministic captures). */
  seek(seconds: number): void {
    if (seconds < 0) {
      this.stop();
      return;
    }
    this.started = seconds;
    this.time = seconds;
    this.mesh.visible = true;
    this.update(0);
  }

  update(dt: number): void {
    if (this.started < 0) return;
    this.started += dt;
    this.time += dt;
    const s = this.started;
    // Ramp in over 1 s, hold, fade 20 → 30 s.
    const k = Math.min(1, s / 1.0) * (1 - THREE.MathUtils.smoothstep(s, 20, 30));
    this.material.uniforms.uIntensity.value = k;
    this.material.uniforms.uTime.value = this.time;
    if (s > 30) this.stop();
  }
}
