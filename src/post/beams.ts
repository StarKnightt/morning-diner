/**
 * Sun-beam volumes: the set of points inside the room that see the sun through
 * a glazed aperture. Read-only view of the layout + the scene's sun light, shared
 * by the dust (spawn volume + analytic lit test) and the haze march (aperture
 * test per sample). The shadow map then adds the slat stripes and the furniture.
 *
 * A point p is in a beam when p + sunDir · t lands on an aperture rectangle at
 * the glass plane (t = (zGlass − p.z) / sunDir.z). The room-side prism for each
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

/** Unit vector from the scene toward the sun, read from the live DirectionalLight. */
export function sunDirectionOf(sun: THREE.DirectionalLight, out = new THREE.Vector3()): THREE.Vector3 {
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  const a = new THREE.Vector3().setFromMatrixPosition(sun.matrixWorld);
  const b = new THREE.Vector3().setFromMatrixPosition(sun.target.matrixWorld);
  return out.copy(a).sub(b).normalize();
}

export function findSun(scene: THREE.Scene): THREE.DirectionalLight | null {
  let found: THREE.DirectionalLight | null = null;
  scene.traverse((o) => {
    if (!found && (o as THREE.DirectionalLight).isDirectionalLight && (o as THREE.Light).castShadow) found = o as THREE.DirectionalLight;
  });
  return found;
}

/**
 * World AABB of the union of the beam prisms, clipped to the room air. The haze
 * march only walks inside this box; the dust only spawns inside the prisms.
 */
export function beamBounds(sunDir: THREE.Vector3): THREE.Box3 {
  const { glassZ, rects } = apertures();
  const box = new THREE.Box3();
  for (const r of rects) {
    for (const [x, y] of [
      [r.x0, r.y0],
      [r.x1, r.y0],
      [r.x0, r.y1],
      [r.x1, r.y1],
    ]) {
      const a = new THREE.Vector3(x, y, glassZ);
      box.expandByPoint(a);
      // Where this aperture corner's ray meets the floor (or the back partition first).
      const tFloor = y / Math.max(1e-4, sunDir.y);
      const tBack = (glassZ - ROOM.zBack) / Math.max(1e-4, sunDir.z);
      const t = Math.min(tFloor, tBack);
      box.expandByPoint(a.clone().addScaledVector(sunDir, -t));
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
export function sampleBeamPoints(count: number, sunDir: THREE.Vector3, rng: () => number): Float32Array {
  const { glassZ, rects } = apertures();
  const areas = rects.map((r) => (r.x1 - r.x0) * (r.y1 - r.y0));
  const total = areas.reduce((a, b) => a + b, 0);
  const out = new Float32Array(count * 3);
  const tBack = (glassZ - ROOM.zBack) / Math.max(1e-4, sunDir.z);
  const tRoom = (glassZ - ROOM.zFront) / Math.max(1e-4, sunDir.z); // wall depth: skip the air inside the reveal
  let i = 0;
  let guard = 0;
  while (i < count && guard++ < count * 50) {
    let pick = rng() * total, k = 0;
    while (k < rects.length - 1 && pick > areas[k]) pick -= areas[k++];
    const r = rects[k];
    const ax = r.x0 + rng() * (r.x1 - r.x0), ay = r.y0 + rng() * (r.y1 - r.y0);
    const tMax = Math.min(ay / Math.max(1e-4, sunDir.y), tBack);
    if (tMax <= tRoom) continue;
    const t = tRoom + rng() * (tMax - tRoom);
    const x = ax - sunDir.x * t, y = ay - sunDir.y * t, z = glassZ - sunDir.z * t;
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
    uniform vec3 uSunDir;
    // 1 when the point sees the sun through a pane (soft 6 mm edge = one shadow texel + the 0.53° penumbra at 1 m).
    float inBeam(vec3 p) {
      float t = (uGlassZ - p.z) / max(1e-4, uSunDir.z);
      if (t < 0.0) return 0.0;
      vec2 a = p.xy + uSunDir.xy * t;
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

export function apertureUniforms(): { uApertures: { value: THREE.Vector4[] }; uApertureCount: { value: number }; uGlassZ: { value: number }; uSunDir: { value: THREE.Vector3 } } {
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
  };
}

/** GLSL: shadow-map test for a world point (three r185 PCF depth texture, non-reversed depth). */
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
