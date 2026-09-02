/**
 * Sun-beam volumes: the set of points inside the room that see the sun through
 * a glazed aperture. Read-only view of the layout + the scene's sun light, shared
 * by the dust (spawn volume + analytic lit test) and the haze march (aperture
 * test per sample). The shadow map then adds the slat stripes and the furniture.
 *
 * A point p is in a beam when p + ray(p) · t lands on an aperture rectangle at
 * the glass plane (t = (zGlass − p.z) / ray.z), where ray(p) is the unit vector
 * from p toward the sun — constant for a DirectionalLight, converging on the
 * apex for the SpotLight sun (see `SunRays`). The room-side prism for each
 * aperture is bounded below by the floor and behind by the kitchen partition.
 */
import * as THREE from "three";
import { DOOR, ROOM, WINDOW } from "../scene/layout";

export interface Aperture {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Glazed rectangles (frame members, transom and door rails removed), all at `glassZ`. */
export function apertures(): { glassZ: number; rects: Aperture[] } {
  const fw = 0.04; // Shell.ts frame face
  const rects: Aperture[] = [];
  for (const cx of WINDOW.centersX) {
    const x0 = cx - WINDOW.width / 2 + fw, x1 = cx + WINDOW.width / 2 - fw;
    rects.push({ x0, x1, y0: WINDOW.sill + fw, y1: WINDOW.transomY - fw / 2 });
    rects.push({ x0, x1, y0: WINDOW.transomY + fw / 2, y1: WINDOW.head - fw });
  }
  // Door lite (Door.ts): hinge group at hingeX + jamb + reveal; stiles 100 mm, bottom rail 260, top rail 120.
  {
    const hx = DOOR.hingeX + DOOR.jamb + DOOR.reveal;
    const clearW = DOOR.width - 2 * DOOR.jamb, clearH = DOOR.height - DOOR.jamb;
    const leafW = clearW - 2 * DOOR.reveal, leafH = clearH - DOOR.reveal - 0.012;
    rects.push({ x0: hx + 0.1, x1: hx + leafW - 0.1, y0: 0.012 + 0.26, y1: leafH - 0.12 });
  }
  return { glassZ: ROOM.zFront + ROOM.wallThickness / 2, rects };
}

/**
 * The building sun. Since System 3 rev 2 it is a **SpotLight** 150 m out along the sun
 * vector (`Diner.sun`, perspective 4096² shadow map ≈ 3.5 mm texels — that map makes the
 * slat stripes); `Diner.sunLot` is a DirectionalLight over the lot whose map the room
 * never appears in (the caster-only cone blacks the building out of it), so nothing here
 * reads it. A plain DirectionalLight sun (System 4 may go back to one) still works.
 */
export type SunLight = THREE.SpotLight | THREE.DirectionalLight;

/**
 * How the sun's rays run through the room: parallel along `dir` for a directional
 * light, converging on `apex` (the light position) for the spot. Across the 11.6 m
 * room the spot's rays differ from the mean by ±2.3°, which over a 3 m beam is a
 * 12 cm shift of the prism edge — the analytic aperture test has to use the same
 * ray the shadow map used or the two disagree at the frames.
 */
export interface SunRays {
  /** Unit vector from the scene toward the sun (the mean ray for a spot). */
  dir: THREE.Vector3;
  /** Spot apex in world space; null for a directional light. */
  apex: THREE.Vector3 | null;
}

export function sunRaysOf(sun: SunLight, out: SunRays = { dir: new THREE.Vector3(), apex: null }): SunRays {
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  const a = new THREE.Vector3().setFromMatrixPosition(sun.matrixWorld);
  const b = new THREE.Vector3().setFromMatrixPosition(sun.target.matrixWorld);
  out.dir.copy(a).sub(b).normalize();
  if ((sun as THREE.SpotLight).isSpotLight) out.apex = (out.apex ?? new THREE.Vector3()).copy(a);
  else out.apex = null;
  return out;
}

/** Unit vector from `p` toward the sun along the ray the shadow camera used. */
export function rayToSun(rays: SunRays, p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  return rays.apex ? out.copy(rays.apex).sub(p).normalize() : out.copy(rays.dir);
}

/** Mean unit vector from the scene toward the sun (matches `Lighting.sunDirection()`). */
export function sunDirectionOf(sun: SunLight, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(sunRaysOf(sun).dir);
}

/** First shadow-casting SpotLight (the building sun), else the first shadow-casting DirectionalLight. */
export function findSun(scene: THREE.Scene): SunLight | null {
  let spot: THREE.SpotLight | null = null;
  let dir: THREE.DirectionalLight | null = null;
  scene.traverse((o) => {
    if (!(o as THREE.Light).isLight || !(o as THREE.Light).castShadow) return;
    if (!spot && (o as THREE.SpotLight).isSpotLight) spot = o as THREE.SpotLight;
    else if (!dir && (o as THREE.DirectionalLight).isDirectionalLight) dir = o as THREE.DirectionalLight;
  });
  return spot ?? dir;
}

/**
 * World AABB of the union of the beam prisms, clipped to the room air. The haze
 * march only walks inside this box; the dust only spawns inside the prisms.
 */
export function beamBounds(rays: SunRays): THREE.Box3 {
  const { glassZ, rects } = apertures();
  const box = new THREE.Box3();
  const d = new THREE.Vector3();
  for (const r of rects) {
    for (const [x, y] of [
      [r.x0, r.y0],
      [r.x1, r.y0],
      [r.x0, r.y1],
      [r.x1, r.y1],
    ]) {
      const a = new THREE.Vector3(x, y, glassZ);
      box.expandByPoint(a);
      rayToSun(rays, a, d);
      // Where this aperture corner's ray meets the floor (or the back partition first).
      const tFloor = y / Math.max(1e-4, d.y);
      const tBack = (glassZ - ROOM.zBack) / Math.max(1e-4, d.z);
      const t = Math.min(tFloor, tBack);
      box.expandByPoint(a.clone().addScaledVector(d, -t));
    }
  }
  box.min.set(Math.max(box.min.x, -ROOM.halfX), Math.max(box.min.y, 0), Math.max(box.min.z, ROOM.zBack));
  box.max.set(Math.min(box.max.x, ROOM.halfX), Math.min(box.max.y, ROOM.height), Math.min(box.max.z, ROOM.zFront));
  return box;
}

/**
 * Uniform random points inside the beam prisms (room side of the wall plane).
 * Rejection-sampled per aperture, weighted by aperture area so density is even.
 */
export function sampleBeamPoints(count: number, rays: SunRays, rng: () => number): Float32Array {
  const { glassZ, rects } = apertures();
  const areas = rects.map((r) => (r.x1 - r.x0) * (r.y1 - r.y0));
  const total = areas.reduce((a, b) => a + b, 0);
  const out = new Float32Array(count * 3);
  const a = new THREE.Vector3();
  const d = new THREE.Vector3();
  let i = 0;
  let guard = 0;
  while (i < count && guard++ < count * 50) {
    let pick = rng() * total, k = 0;
    while (k < rects.length - 1 && pick > areas[k]) pick -= areas[k++];
    const r = rects[k];
    const ax = r.x0 + rng() * (r.x1 - r.x0), ay = r.y0 + rng() * (r.y1 - r.y0);
    rayToSun(rays, a.set(ax, ay, glassZ), d); // the ray through THIS aperture point (spot: converging)
    const tBack = (glassZ - ROOM.zBack) / Math.max(1e-4, d.z);
    const tRoom = (glassZ - ROOM.zFront) / Math.max(1e-4, d.z); // wall depth: skip the air inside the reveal
    const tMax = Math.min(ay / Math.max(1e-4, d.y), tBack);
    if (tMax <= tRoom) continue;
    const t = tRoom + rng() * (tMax - tRoom);
    const x = ax - d.x * t, y = ay - d.y * t, z = glassZ - d.z * t;
    if (x < -ROOM.halfX || x > ROOM.halfX || y < 0.01) continue;
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
    i++;
  }
  return out;
}

/** GLSL: `float inBeam(vec3 p)` over a uniform aperture list. */
export function apertureGlsl(maxRects: number): string {
  return /* glsl */ `
    uniform vec4 uApertures[${maxRects}]; // x0, x1, y0, y1
    uniform int uApertureCount;
    uniform float uGlassZ;
    uniform vec3 uSunDir;  // mean ray toward the sun (phase functions)
    uniform vec4 uSunApex; // xyz = spot apex, w = 1 for the spot sun, 0 for a directional sun
    // Unit vector from p toward the sun along the ray the shadow camera used.
    vec3 sunRay(vec3 p) {
      return uSunApex.w > 0.5 ? normalize(uSunApex.xyz - p) : uSunDir;
    }
    // 1 when the point sees the sun through a pane (soft 6 mm edge = one shadow texel + the 0.53° penumbra at 1 m).
    float inBeam(vec3 p) {
      vec3 sd = sunRay(p);
      float t = (uGlassZ - p.z) / max(1e-4, sd.z);
      if (t < 0.0) return 0.0;
      vec2 a = p.xy + sd.xy * t;
      float e = 0.006 + 0.0093 * t; // penumbra grows 9.3 mm per metre from the aperture
      float best = 0.0;
      for (int i = 0; i < ${maxRects}; i++) {
        if (i >= uApertureCount) break;
        vec4 r = uApertures[i];
        float fx = min(smoothstep(r.x - e, r.x + e, a.x), 1.0 - smoothstep(r.y - e, r.y + e, a.x));
        float fy = min(smoothstep(r.z - e, r.z + e, a.y), 1.0 - smoothstep(r.w - e, r.w + e, a.y));
        best = max(best, fx * fy);
      }
      return best;
    }
    // 1 when (x, y) on the glass plane lies inside a pane (2 cm tolerance: the depth buffer's glass hit).
    float inApertureXY(vec2 a) {
      for (int i = 0; i < ${maxRects}; i++) {
        if (i >= uApertureCount) break;
        vec4 r = uApertures[i];
        if (a.x > r.x - 0.02 && a.x < r.y + 0.02 && a.y > r.z - 0.02 && a.y < r.w + 0.02) return 1.0;
      }
      return 0.0;
    }`;
}

export const MAX_APERTURES = 12;

export interface ApertureUniforms {
  uApertures: { value: THREE.Vector4[] };
  uApertureCount: { value: number };
  uGlassZ: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSunApex: { value: THREE.Vector4 };
}

export function apertureUniforms(): ApertureUniforms {
  const { glassZ, rects } = apertures();
  const arr: THREE.Vector4[] = [];
  for (let i = 0; i < MAX_APERTURES; i++) {
    const r = rects[i];
    arr.push(r ? new THREE.Vector4(r.x0, r.x1, r.y0, r.y1) : new THREE.Vector4());
  }
  return {
    uApertures: { value: arr },
    uApertureCount: { value: Math.min(rects.length, MAX_APERTURES) },
    uGlassZ: { value: glassZ },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunApex: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
}

/** Push the live sun's rays into a material's aperture uniforms. */
export function setSunUniforms(u: ApertureUniforms, rays: SunRays): void {
  u.uSunDir.value.copy(rays.dir);
  if (rays.apex) u.uSunApex.value.set(rays.apex.x, rays.apex.y, rays.apex.z, 1);
  else u.uSunApex.value.set(0, 0, 0, 0);
}

/**
 * GLSL: shadow-map test for a world point against the building sun's map (three r185 PCF
 * depth texture, non-reversed depth). `uShadowMatrix` is `sun.shadow.matrix` = bias ×
 * projection × view, for a SpotLight (perspective) or a DirectionalLight (ortho) alike:
 * the perspective divide below is exactly what three's `getShadow` does for a spot, and
 * for an ortho map `w` is 1 so it is a no-op. The depth compared is the shadow camera's
 * non-linear NDC depth in both cases — the same quantity the map stores.
 */
export const shadowGlsl = /* glsl */ `
  uniform highp sampler2DShadow uShadowMap;
  uniform mat4 uShadowMatrix;
  uniform float uShadowBias;
  // 1 = lit. Hardware compare (LinearFilter → 4-tap PCF per fetch).
  float sunVisible(vec3 p) {
    vec4 sc = uShadowMatrix * vec4(p, 1.0);
    sc.xyz /= sc.w;
    sc.z += uShadowBias;
    if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
    return texture(uShadowMap, sc.xyz);
  }
  // Slat-stripe-averaged visibility for the haze march: three taps spread over one slat pitch
  // (25 mm) vertically. A 24-step march cannot resolve 25 mm stripes and would alias into
  // moiré; averaging returns the local duty cycle (≈ the fraction of the beam that is lit).
  float sunVisibleSoft(vec3 p) {
    return (sunVisible(p + vec3(0.0, -0.0085, 0.0)) + sunVisible(p) + sunVisible(p + vec3(0.0, 0.0085, 0.0))) / 3.0;
  }`;
