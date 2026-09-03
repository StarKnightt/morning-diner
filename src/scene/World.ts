/**
 * The world layer (feat-world): everything outside the CMU wall that the lot looks out on.
 * Replaces Exterior.ts's flat dirt plane, its one-blob scrub and the three flat ridge bands.
 *
 *  1. Ground — one warped grid (fine at the lot exit, coarse at 200 m) with metres-scale
 *     undulation, decimetre bumps, wheel ruts from the gap to the road, drift sand against
 *     the wall, a damp/oil patch at the exit; vertex-colour macro albedo (caliche / pale sand /
 *     gravel), a grain detail normal and a two-sample tile break-up in the shader.
 *  2. Scatter — InstancedMesh per species (creosote, saltbush dome, yucca, grass tufts, dead
 *     shrub, rocks ×2) with per-instance tint, clustered along drainage lines and the lot
 *     edge, excluded from lot / road / the dirt approach; contact occlusion baked into the
 *     ground's vertex colours; debris (tyre, cans, tumbleweeds), a barbed-wire property line.
 *  3. Horizon — four ridge layers with silhouette noise and per-layer aerial perspective
 *     toward the sky's horizon colour, ravines on the near ridge, a mesa, a water tower, a
 *     radio mast, a ranch tree line, two parked semi-trailers and a billboard back on the road.
 *
 * Everything lives in the "exterior" group (so Diner.ts hands it the lot probe) and is
 * flagged `userData.lotCaster` for the lot sun's shadow map.
 */
import * as THREE from "three";
import { makeFbm, makeRng, makeValueNoise } from "../core/rng";
import { grainNormal } from "../procedural/world";
import { LOT } from "./Exterior";
import { ROOM } from "./layout";

const ROAD = { z: LOT.wallZ + 16, halfW: 3.6 } as const;
const GAP_X = -2.5;
const Y0 = LOT.y - 0.045;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const sstep = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------------------------------ */
/* Heightfield                                                                                 */
/* ------------------------------------------------------------------------------------------ */

interface Field {
  height: (x: number, z: number) => number;
  /** 0 inside the lot / road corridors, 1 in open desert. */
  open: (x: number, z: number) => number;
  /** 0..1 how much this point is in a wheel rut. */
  rut: (x: number, z: number) => number;
  drift: (x: number, z: number) => number;
}

function makeField(): Field {
  const big = makeFbm(4410, 8, 3), med = makeFbm(4411, 32, 2), bump = makeFbm(4412, 256, 2);
  const wander = makeValueNoise(4413, 16), driftN = makeValueNoise(4414, 64);
  const S = 420;
  const open = (x: number, z: number) => {
    const dx = Math.abs(x) - 44, dz = z - (LOT.wallZ + 3);
    const dOut = Math.max(dx, dz);
    const road = sstep(7, 14, Math.abs(z - ROAD.z));
    return sstep(0, 14, dOut) * road;
  };
  const rutZ0 = LOT.wallZ + 0.3, rutZ1 = ROAD.z - ROAD.halfW - 1.0;
  const rut = (x: number, z: number) => {
    if (z < rutZ0 || z > rutZ1) return 0;
    const t = (z - rutZ0) / (rutZ1 - rutZ0);
    const cx = GAP_X + 1.2 * t + (wander(t * 6 + 3, 3) - 0.5) * 0.7 * Math.sin(Math.PI * t);
    const d = Math.min(Math.abs(x - (cx - 0.95)), Math.abs(x - (cx + 0.95)));
    const ends = sstep(0, 1.5, z - rutZ0) * sstep(0, 1.5, rutZ1 - z);
    return Math.exp(-((d / 0.19) ** 2)) * ends;
  };
  const drift = (x: number, z: number) => {
    const inWall = (x > -40 && x < -6) || (x > 1 && x < 40);
    if (!inWall || z < LOT.wallZ + 0.19 || z > LOT.wallZ + 2.5) return 0;
    const n = Math.pow(driftN(x / 2.2 + 7, 0.4), 1.6);
    return n * Math.exp(-(z - (LOT.wallZ + 0.2)) / 0.42);
  };
  const height = (x: number, z: number) => {
    const u = x / S + 0.5, v = z / S + 0.5;
    const o = open(x, z);
    let h = Y0;
    h += o * (2.6 * (big(u, v) - 0.5) * 2 + 0.6 * (med(u, v) - 0.5) * 2);
    h += o * 0.02 * Math.max(0, Math.hypot(x - GRID_CX, z - GRID_CZ) - 40); // alluvial rise toward the ranges
    const r = rut(x, z);
    const amp = 0.025 + 0.09 * o;
    h += amp * (bump(u, v) - 0.5) * 2 * (1 - 0.7 * r);
    h -= 0.045 * r;
    h += 0.16 * drift(x, z);
    return h;
  };
  return { height, open, rut, drift };
}

/* ------------------------------------------------------------------------------------------ */
/* Ground mesh                                                                                 */
/* ------------------------------------------------------------------------------------------ */

const GRID_N = 300, GRID_R = 215, GRID_P = 1.9;
const GRID_CX = -2, GRID_CZ = LOT.wallZ + 6;
const gridCoord = (t: number) => Math.sign(t) * GRID_R * Math.pow(Math.abs(t), GRID_P);
const gridIndexOf = (w: number, c: number) => {
  const t = Math.sign(w - c) * Math.pow(Math.min(1, Math.abs(w - c) / GRID_R), 1 / GRID_P);
  return ((t + 1) / 2) * GRID_N;
};

interface Ground { mesh: THREE.Mesh; colors: Float32Array; positions: Float32Array }

function buildGround(field: Field, dirtMap: THREE.Texture | null): Ground {
  const N = GRID_N, V = N + 1;
  const pos = new Float32Array(V * V * 3), col = new Float32Array(V * V * 3), uv = new Float32Array(V * V * 2);
  const caliche = makeFbm(4420, 16, 3), pale = makeFbm(4421, 40, 2), gravel = makeFbm(4422, 90, 2);
  for (let j = 0; j < V; j++)
    for (let i = 0; i < V; i++) {
      const x = GRID_CX + gridCoord((i / N) * 2 - 1), z = GRID_CZ + gridCoord((j / N) * 2 - 1);
      const k = j * V + i;
      pos[k * 3] = x; pos[k * 3 + 1] = field.height(x, z); pos[k * 3 + 2] = z;
      uv[k * 2] = x / 420 + 0.5; uv[k * 2 + 1] = z / 420 + 0.5;
      const u = x / 420 + 0.5, v = z / 420 + 0.5;
      // Macro albedo: darker caliche / pale sand patches, gravel bands (darker, greyer).
      const c = caliche(u, v), p = pale(u, v), g = gravel(u, v);
      let r = 0.8, gg = 0.78, b = 0.74;
      const dark = sstep(0.55, 0.75, c) * 0.22;
      r -= dark * 1.0; gg -= dark * 1.05; b -= dark * 1.15;
      const light = sstep(0.55, 0.8, p) * 0.1;
      r += light; gg += light * 0.98; b += light * 0.92;
      const gr = sstep(0.58, 0.78, g) * 0.18;
      r -= gr * 1.1; gg -= gr; b -= gr * 0.85;
      // Ruts: compacted, darker; drift: fine pale sand.
      const rut = field.rut(x, z);
      r *= 1 - 0.22 * rut; gg *= 1 - 0.22 * rut; b *= 1 - 0.2 * rut;
      const d = field.drift(x, z);
      r += 0.1 * d; gg += 0.09 * d; b += 0.07 * d;
      // Damp / oil patch where vehicles idle at the exit.
      const dx = (x - (GAP_X + 0.4)) / 1.9, dz = (z - (LOT.wallZ + 2.4)) / 2.6;
      const damp = Math.exp(-(dx * dx + dz * dz) * 1.6) * (0.55 + 0.45 * caliche(u * 7, v * 7));
      r *= 1 - 0.42 * damp; gg *= 1 - 0.4 * damp; b *= 1 - 0.36 * damp;
      col[k * 3] = r; col[k * 3 + 1] = gg; col[k * 3 + 2] = b;
    }
  const idx: number[] = [];
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();

  const normal = grainNormal(256, 4401);
  normal.repeat.set(420 / 0.7, 420 / 0.7);
  const mat = new THREE.MeshStandardMaterial({ map: dirtMap ?? undefined, color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0, normalMap: normal, normalScale: new THREE.Vector2(0.45, 0.45) });
  if (!dirtMap) mat.color.set(0xb3a894);
  // Tile break-up: a second, rotated and rescaled sample of the same map, selected by a
  // low-frequency (≈ 20 m) value noise — no repeat survives from eye height to 200 m.
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace("#include <map_fragment>", `#ifdef USE_MAP
        vec4 wS1 = texture2D(map, vMapUv);
        vec2 wUv2 = mat2(0.766, -0.643, 0.643, 0.766) * vMapUv * 0.53 + vec2(0.31, 0.77);
        vec4 wS2 = texture2D(map, wUv2);
        float wMk = smoothstep(0.36, 0.64, wNoise(vMapUv / 2.9 + 11.0));
        diffuseColor *= mix(wS1, wS2, wMk);
        #endif`);
  };
  mat.customProgramCacheKey = () => "world-ground";
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = "world-ground";
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return { mesh, colors: col, positions: pos };
}

/* ------------------------------------------------------------------------------------------ */
/* Species geometry (non-indexed position + normal + colour)                                   */
/* ------------------------------------------------------------------------------------------ */

type Part = { g: THREE.BufferGeometry; c: [number, number, number] };

function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  for (const { g, c } of parts) {
    const ni = g.index ? g.toNonIndexed() : g;
    if (!ni.attributes.normal) ni.computeVertexNormals();
    const p = ni.attributes.position.array as ArrayLike<number>, n = ni.attributes.normal.array as ArrayLike<number>;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
    for (let i = 0; i < p.length / 3; i++) col.push(c[0], c[1], c[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

function jitter(g: THREE.BufferGeometry, rng: () => number, k: number, ySquash: number): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const s = 1 - k + rng() * 2 * k;
    p.setXYZ(i, p.getX(i) * s, Math.max(-0.02, p.getY(i) * ySquash * s), p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

const STEM: [number, number, number] = [0.3, 0.24, 0.19];
const WHITE: [number, number, number] = [1, 1, 1];

function creosote(rng: () => number, nStems: number, spread: number, height: number, leaves: boolean): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (let s = 0; s < nStems; s++) {
    const a = (s / nStems) * Math.PI * 2 + rng() * (Math.PI * 2 / nStems), tilt = spread + rng() * 0.3, len = height * (0.7 + rng() * 0.45);
    const stem = new THREE.CylinderGeometry(0.007, 0.02, len, 4, 1, true);
    stem.translate(0, len / 2, 0);
    stem.rotateX(tilt);
    stem.rotateY(a);
    parts.push({ g: stem, c: leaves ? STEM : [0.62, 0.58, 0.52] });
    if (!leaves) continue;
    const tip = new THREE.Vector3(0, len, 0).applyEuler(new THREE.Euler(tilt, a, 0, "YXZ"));
    const clumps = 3 + Math.floor(rng() * 2);
    for (let k = 0; k < clumps; k++) {
      const leaf = new THREE.IcosahedronGeometry(0.045 + rng() * 0.05, 0);
      leaf.scale(1.3, 0.6, 1);
      const t = 0.5 + k * (0.5 / clumps) + rng() * 0.1;
      leaf.translate(tip.x * t + (rng() - 0.5) * 0.15, tip.y * t, tip.z * t + (rng() - 0.5) * 0.15);
      parts.push({ g: leaf, c: WHITE });
    }
  }
  return mergeParts(parts);
}

function dome(rng: () => number, r: number, n: number, squash: number): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (let k = 0; k < n; k++) {
    const a = rng() * Math.PI * 2, d = rng() * r * 0.55;
    const b = jitter(new THREE.IcosahedronGeometry(r * (0.55 + rng() * 0.45), 1), rng, 0.18, squash);
    b.translate(Math.cos(a) * d, r * squash * 0.25 * rng(), Math.sin(a) * d);
    parts.push({ g: b, c: WHITE });
  }
  return mergeParts(parts);
}

function yucca(rng: () => number): THREE.BufferGeometry {
  const parts: Part[] = [];
  const trunkH = 0.35 + rng() * 0.6;
  const trunk = new THREE.CylinderGeometry(0.07, 0.1, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0);
  parts.push({ g: trunk, c: [0.42, 0.36, 0.3] });
  // Dead thatch skirt: a short inverted cone of straw below the crown.
  const skirt = new THREE.ConeGeometry(0.28, 0.4, 8, 1, true);
  skirt.translate(0, trunkH - 0.05, 0);
  parts.push({ g: skirt, c: [0.72, 0.64, 0.48] });
  const blades = 26 + Math.floor(rng() * 10);
  for (let k = 0; k < blades; k++) {
    const a = (k / blades) * Math.PI * 2 + rng() * 0.3, tilt = 0.25 + rng() * 0.95, len = 0.5 + rng() * 0.4;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-0.02, 0, 0, 0.02, 0, 0, 0, len, 0.01], 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    g.rotateX(-tilt);
    g.rotateY(a);
    g.translate(0, trunkH, 0);
    parts.push({ g, c: [0.4, 0.48, 0.34] });
  }
  return mergeParts(parts);
}

function grassTuft(rng: () => number): THREE.BufferGeometry {
  const parts: Part[] = [];
  const n = 12 + Math.floor(rng() * 6);
  for (let k = 0; k < n; k++) {
    const a = rng() * Math.PI * 2, lean = 0.25 + rng() * 0.6, len = 0.22 + rng() * 0.25;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-0.012, 0, 0, 0.012, 0, 0, 0.0, len, 0], 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    g.rotateX(-lean);
    g.rotateY(a);
    g.translate((rng() - 0.5) * 0.08, 0, (rng() - 0.5) * 0.08);
    parts.push({ g, c: WHITE });
  }
  return mergeParts(parts);
}

function rock(rng: () => number, r: number): THREE.BufferGeometry {
  return mergeParts([{ g: jitter(new THREE.IcosahedronGeometry(r, r > 0.3 ? 1 : 0), rng, 0.25, 0.6), c: WHITE }]);
}

/* ------------------------------------------------------------------------------------------ */
/* Scatter                                                                                     */
/* ------------------------------------------------------------------------------------------ */

interface Species {
  name: string;
  geo: THREE.BufferGeometry;
  count: number;
  /** Relative acceptance at (x, z, drainage 0..1, lot-edge band 0..1, radius). */
  weight: (open: number, drain: number, edge: number, r: number) => number;
  scale: () => [number, number, number];
  tint: (c: THREE.Color) => void;
  /** Footprint radius for the baked ground occlusion (0 = none). */
  shadow: number;
  cast: boolean;
  doubleSide?: boolean;
  minR?: number;
}

function buildScatter(parent: THREE.Group, field: Field, ground: Ground, rng: () => number): void {
  const drainN = makeFbm(4430, 10, 2), clusterN = makeFbm(4431, 60, 2), edgeN = makeValueNoise(4432, 64);
  const drainage = (x: number, z: number) => {
    const n = drainN(x / 420 + 0.5, z / 420 + 0.5);
    return Math.pow(1 - Math.abs(2 * n - 1), 3); // 1 on the wash lines, 0 on the interfluves
  };
  const cluster = (x: number, z: number) => clusterN(x / 420 + 0.5, z / 420 + 0.5);
  const lotEdge = (x: number, z: number) => {
    const e = LOT.wallZ + 2.5 + 4 * edgeN(x / 6 + 32, 0.5);
    const d = z - e;
    return d > 0 && d < 9 && Math.abs(x) < 60 ? 1 - d / 9 : 0;
  };
  const approachX = (z: number) => GAP_X + 1.2 * clamp01((z - LOT.wallZ) / (ROAD.z - ROAD.halfW - LOT.wallZ));
  const allowed = (x: number, z: number) => {
    if (Math.abs(x) < 44 && z < LOT.wallZ + 1.6) return false; // lot + building
    if (Math.abs(z - ROAD.z) < ROAD.halfW + 1.4) return false; // road + shoulders
    if (z > LOT.wallZ && z < ROAD.z && Math.abs(x - approachX(z)) < 2.2) return false; // dirt approach
    if (z < ROOM.zBack - 4 && Math.abs(x) < 14) return false; // behind the kitchen
    return true;
  };

  const species: Species[] = [
    { name: "creosote", geo: creosote(rng, 9, 0.28, 1.0, true), count: 450, weight: (_o, d, e) => 0.25 + 0.6 * d + 0.5 * e + 0.3 * _o, scale: () => { const h = 0.8 + rng() * 1.1; return [h * (0.85 + rng() * 0.3), h, h * (0.85 + rng() * 0.3)]; }, tint: (c) => c.setRGB(0.26 + rng() * 0.1, 0.3 + rng() * 0.08, 0.17 + rng() * 0.06), shadow: 0.9, cast: true },
    { name: "creosote-b", geo: creosote(rng, 6, 0.5, 0.8, true), count: 350, weight: (_o, d, e) => 0.3 + 0.5 * d + 0.4 * e, scale: () => { const h = 0.7 + rng() * 0.9; return [h * (0.9 + rng() * 0.3), h, h * (0.9 + rng() * 0.3)]; }, tint: (c) => c.setRGB(0.3 + rng() * 0.1, 0.32 + rng() * 0.08, 0.2 + rng() * 0.06), shadow: 0.8, cast: true },
    { name: "saltbush", geo: dome(rng, 0.42, 4, 0.62), count: 700, weight: (_o, d, e) => 0.5 + 0.3 * d + 0.7 * e, scale: () => { const s = 0.55 + rng() * 0.9; return [s * (0.85 + rng() * 0.4), s * (0.7 + rng() * 0.5), s * (0.85 + rng() * 0.4)]; }, tint: (c) => { const t = rng(); if (t < 0.5) c.setRGB(0.34 + rng() * 0.08, 0.38 + rng() * 0.07, 0.3 + rng() * 0.06); else if (t < 0.8) c.setRGB(0.4 + rng() * 0.08, 0.42 + rng() * 0.07, 0.36 + rng() * 0.05); else c.setRGB(0.28 + rng() * 0.08, 0.31 + rng() * 0.07, 0.2 + rng() * 0.05); }, shadow: 0.7, cast: true },
    { name: "brittlebush", geo: dome(rng, 0.3, 3, 0.75), count: 600, weight: (_o, d, e) => 0.45 + 0.4 * d + 0.5 * e, scale: () => { const s = 0.6 + rng() * 0.8; return [s, s * (0.8 + rng() * 0.4), s]; }, tint: (c) => c.setRGB(0.42 + rng() * 0.08, 0.44 + rng() * 0.07, 0.34 + rng() * 0.06), shadow: 0.5, cast: true },
    { name: "yucca", geo: yucca(rng), count: 140, weight: (_o, d, e) => 0.5 + 0.3 * (1 - d) + 0.3 * e, scale: () => { const s = 0.8 + rng() * 0.8; return [s, s, s]; }, tint: (c) => c.setRGB(0.55 + rng() * 0.1, 0.6 + rng() * 0.1, 0.55 + rng() * 0.1), shadow: 0.35, cast: true, doubleSide: true },
    { name: "dead-shrub", geo: creosote(rng, 11, 0.4, 0.85, false), count: 220, weight: (_o, d, e) => 0.4 + 0.3 * (1 - d) + 0.3 * e, scale: () => { const h = 0.7 + rng() * 0.9; return [h, h, h]; }, tint: (c) => c.setRGB(0.62 + rng() * 0.1, 0.6 + rng() * 0.1, 0.56 + rng() * 0.1), shadow: 0.3, cast: true },
    { name: "grass", geo: grassTuft(rng), count: 3200, weight: (_o, d, e) => 0.35 + 0.6 * d + 0.9 * e, scale: () => { const s = 0.7 + rng() * 1.0; return [s, s * (0.8 + rng() * 0.5), s]; }, tint: (c) => { const t = rng(); if (t < 0.6) c.setRGB(0.5 + rng() * 0.1, 0.42 + rng() * 0.08, 0.25 + rng() * 0.06); else c.setRGB(0.36 + rng() * 0.08, 0.37 + rng() * 0.08, 0.22 + rng() * 0.06); }, shadow: 0, cast: false, doubleSide: true },
    { name: "rock-s", geo: rock(rng, 0.11), count: 2200, weight: (_o, d) => 0.5 + 0.6 * d, scale: () => { const s = 0.5 + rng() * 1.2; return [s * (0.8 + rng() * 0.5), s * (0.6 + rng() * 0.5), s * (0.8 + rng() * 0.5)]; }, tint: (c) => { const k = 0.26 + rng() * 0.2; c.setRGB(k * 1.05, k * 0.98, k * 0.9); }, shadow: 0, cast: false },
    { name: "rock-l", geo: rock(rng, 0.42), count: 320, weight: (_o, d) => 0.4 + 0.4 * (1 - d) + 0.3 * _o, scale: () => { const s = 0.6 + rng() * 1.3; return [s * (0.8 + rng() * 0.5), s * (0.55 + rng() * 0.5), s * (0.8 + rng() * 0.5)]; }, tint: (c) => { const k = 0.24 + rng() * 0.18; c.setRGB(k * 1.06, k * 0.98, k * 0.9); }, shadow: 0.5, cast: true, minR: 12 },
  ];

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const yAxis = new THREE.Vector3(0, 1, 0), tiltAxis = new THREE.Vector3();
  const V = GRID_N + 1;
  // Baked contact occlusion: darken the ground vertices under each shrub's footprint.
  const occlude = (x: number, z: number, r: number) => {
    const i0 = Math.floor(gridIndexOf(x - r, GRID_CX)), i1 = Math.ceil(gridIndexOf(x + r, GRID_CX));
    const j0 = Math.floor(gridIndexOf(z - r, GRID_CZ)), j1 = Math.ceil(gridIndexOf(z + r, GRID_CZ));
    for (let j = Math.max(0, j0); j <= Math.min(GRID_N, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(GRID_N, i1); i++) {
        const k = j * V + i;
        const dx = ground.positions[k * 3] - x, dz = ground.positions[k * 3 + 2] - z;
        const d = Math.hypot(dx, dz) / r;
        if (d >= 1) continue;
        const f = 1 - 0.5 * (1 - d) * (1 - d);
        ground.colors[k * 3] *= f; ground.colors[k * 3 + 1] *= f; ground.colors[k * 3 + 2] *= f;
      }
  };

  // perf-boot: each species is split into SECTORS wedge-shaped InstancedMeshes around the grid
  // centre, each with its own bounding sphere and frustum culling on. From inside the building
  // the camera looks along the room and out one wall of windows, so most wedges are behind it:
  // the whole scatter was drawn from every interior pose before (frustumCulled = false).
  const SECTORS = 8;
  // Scatter radius cap (was 154 m): past 120 m a shrub is a few pixels inside the fog ramp
  // (40 → 200 m) and the ridge rings take over the horizon.
  const R_MAX = 120;
  for (const sp of species) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0, side: sp.doubleSide ? THREE.DoubleSide : THREE.FrontSide });
    const per = Math.ceil(sp.count / SECTORS) + 8;
    const meshes: THREE.InstancedMesh[] = [];
    for (let k = 0; k < SECTORS; k++) meshes.push(new THREE.InstancedMesh(sp.geo, mat, per));
    const filled = new Array<number>(SECTORS).fill(0);
    let placed = 0, tries = 0;
    while (placed < sp.count && tries < sp.count * 12) {
      tries++;
      const r = (sp.minR ?? 4) + Math.pow(rng(), 0.75) * 150, a = rng() * Math.PI * 2;
      if (r > R_MAX) continue;
      const x = GRID_CX + Math.sin(a) * r, z = GRID_CZ + Math.cos(a) * r;
      if (Math.abs(x) > 205 || Math.abs(z) > 205 || !allowed(x, z)) continue;
      const sector = Math.min(SECTORS - 1, Math.floor((a / (Math.PI * 2)) * SECTORS));
      const mesh = meshes[sector];
      if (filled[sector] >= per) continue;
      const o = field.open(x, z), d = drainage(x, z), e = lotEdge(x, z);
      const w = sp.weight(o, d, e, r) * (0.35 + 0.65 * sstep(0.35, 0.7, cluster(x, z)));
      if (rng() > w) continue;
      const sc = sp.scale();
      // Far out, fewer but bigger (they stand for a clump): keep the density reading.
      const far = 1 + 0.6 * sstep(80, 190, r);
      s.set(sc[0] * far, sc[1] * far, sc[2] * far);
      q.setFromAxisAngle(yAxis, rng() * Math.PI * 2);
      if (sp.name === "grass" || sp.name.startsWith("rock")) {
        tiltAxis.set(rng() - 0.5, 0, rng() - 0.5).normalize();
        q.multiply(new THREE.Quaternion().setFromAxisAngle(tiltAxis, (rng() - 0.5) * 0.3));
      }
      p.set(x, field.height(x, z) - 0.02 * s.y, z);
      m.compose(p, q, s);
      mesh.setMatrixAt(filled[sector], m);
      sp.tint(c);
      mesh.setColorAt(filled[sector], c);
      if (sp.shadow > 0 && r < 120) occlude(x, z, sp.shadow * Math.max(s.x, s.z));
      filled[sector]++;
      placed++;
    }
    meshes.forEach((mesh, k) => {
      mesh.count = filled[k];
      if (filled[k] === 0) { mesh.dispose(); return; }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.name = `world-${sp.name}-${k}`;
      mesh.computeBoundingSphere();
      mesh.frustumCulled = true;
      mesh.castShadow = sp.cast;
      mesh.receiveShadow = true;
      parent.add(mesh);
    });
  }
  (ground.mesh.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
}

/* ------------------------------------------------------------------------------------------ */
/* Debris and man-made bits                                                                    */
/* ------------------------------------------------------------------------------------------ */

function buildDebris(parent: THREE.Group, field: Field, rng: () => number): void {
  const parts: Part[] = [];
  const at = (g: THREE.BufferGeometry, x: number, z: number, yaw: number, c: [number, number, number], lift = 0) => {
    g.rotateY(yaw);
    g.translate(x, field.height(x, z) + lift, z);
    parts.push({ g, c });
  };
  // A tyre, half sunk, near the exit; a second far along the wall.
  for (const [x, z] of [[GAP_X + 4.5, LOT.wallZ + 3.2], [22, LOT.wallZ + 7]]) {
    const t = new THREE.TorusGeometry(0.31, 0.1, 8, 18);
    t.rotateX(Math.PI / 2 + 0.25);
    at(t, x, z, rng() * 3, [0.12, 0.12, 0.12], 0.06);
  }
  // Faded cans.
  for (let i = 0; i < 6; i++) {
    const x = -30 + rng() * 60, z = LOT.wallZ + 2 + rng() * 10;
    if (Math.abs(x - GAP_X) < 3) continue;
    const can = new THREE.CylinderGeometry(0.033, 0.033, 0.12, 8);
    can.rotateZ(Math.PI / 2 + (rng() - 0.5) * 0.4);
    at(can, x, z, rng() * 6, rng() < 0.5 ? [0.75, 0.3, 0.28] : [0.7, 0.7, 0.68], 0.03);
  }
  // Fence posts along the east property line, with three sagging wires.
  const wire: number[] = [];
  const posts: THREE.Vector3[] = [];
  for (let z = LOT.wallZ - 14; z < ROAD.z - 6; z += 3.6) {
    const x = 47 + (rng() - 0.5) * 0.3, lean = (rng() - 0.5) * 0.12;
    const post = new THREE.BoxGeometry(0.1, 1.35, 0.1);
    post.translate(0, 0.62, 0);
    post.rotateX(lean);
    at(post, x, z, 0, [0.4, 0.33, 0.27]);
    posts.push(new THREE.Vector3(x, field.height(x, z), z));
  }
  for (let i = 0; i + 1 < posts.length; i++)
    for (const h of [0.45, 0.85, 1.2]) {
      const a = posts[i], b = posts[i + 1];
      for (let s = 0; s < 6; s++) {
        const t0 = s / 6, t1 = (s + 1) / 6, sag = (t: number) => -0.09 * 4 * t * (1 - t);
        wire.push(a.x + (b.x - a.x) * t0, a.y + h + (b.y - a.y) * t0 + sag(t0), a.z + (b.z - a.z) * t0, a.x + (b.x - a.x) * t1, a.y + h + (b.y - a.y) * t1 + sag(t1), a.z + (b.z - a.z) * t1);
      }
    }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute("position", new THREE.Float32BufferAttribute(wire, 3));
  const wires = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x3a3430, transparent: true, opacity: 0.7 }));
  wires.name = "world-fence-wire";
  wires.frustumCulled = false;
  parent.add(wires);
  // Tumbleweeds: wire balls caught against the wall base and the fence.
  const tumble: number[] = [];
  for (const [x, z] of [[-12, LOT.wallZ + 0.65], [9, LOT.wallZ + 0.7], [31, LOT.wallZ + 0.6], [46.4, LOT.wallZ + 4], [-27, LOT.wallZ + 5]]) {
    const r = 0.35 + rng() * 0.3;
    const g = new THREE.WireframeGeometry(jitter(new THREE.IcosahedronGeometry(r, 1), rng, 0.2, 1));
    g.translate(x, field.height(x, z) + r * 0.85, z);
    tumble.push(...Array.from(g.attributes.position.array as Float32Array));
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute("position", new THREE.Float32BufferAttribute(tumble, 3));
  const tw = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0x8a7a60 }));
  tw.name = "world-tumbleweeds";
  tw.frustumCulled = false;
  parent.add(tw);

  // Two semi-trailers parked on the far shoulder, a billboard back, far down the road.
  const trailer = (x: number, yaw: number) => {
    const z = ROAD.z + ROAD.halfW + 4.5, y = field.height(x, z);
    const box = new THREE.BoxGeometry(13.6, 2.7, 2.6);
    box.translate(0, 1.25 + 1.35, 0); box.rotateY(yaw); box.translate(x, y, z);
    parts.push({ g: box, c: [0.78, 0.78, 0.76] });
    const under = new THREE.BoxGeometry(11, 0.5, 2.3);
    under.translate(0, 1.0, 0); under.rotateY(yaw); under.translate(x, y, z);
    parts.push({ g: under, c: [0.12, 0.12, 0.12] });
    for (const dx of [-5.2, -4.0, 5.6]) {
      const wh = new THREE.CylinderGeometry(0.5, 0.5, 2.4, 10);
      wh.rotateX(Math.PI / 2); wh.translate(dx, 0.5, 0); wh.rotateY(yaw); wh.translate(x, y, z);
      parts.push({ g: wh, c: [0.08, 0.08, 0.08] });
    }
  };
  trailer(-74, 0.04); trailer(-58, -0.03);
  {
    const x = 68, z = ROAD.z + 11, y = field.height(x, z);
    for (const dx of [-2.6, 2.6]) { const post = new THREE.BoxGeometry(0.25, 6.5, 0.25); post.translate(x + dx, y + 3.25, z); parts.push({ g: post, c: [0.35, 0.3, 0.26] }); }
    const board = new THREE.BoxGeometry(7.4, 3.2, 0.12); board.translate(x, y + 5.5, z); parts.push({ g: board, c: [0.3, 0.29, 0.28] });
    for (const dy of [-1.2, 0, 1.2]) { const brace = new THREE.BoxGeometry(7.2, 0.12, 0.1); brace.translate(x, y + 5.5 + dy, z - 0.1); parts.push({ g: brace, c: [0.42, 0.37, 0.31] }); }
  }
  const mesh = new THREE.Mesh(mergeParts(parts), new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0 }));
  mesh.name = "world-debris";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  parent.add(mesh);
}

/* ------------------------------------------------------------------------------------------ */
/* Horizon                                                                                     */
/* ------------------------------------------------------------------------------------------ */

function buildHorizon(parent: THREE.Group, field: Field, horizon: THREE.Color, rng: () => number): void {
  const ridged = (seed: number, cells: number, octaves: number) => {
    const layers: { n: (x: number, y: number) => number; c: number; a: number }[] = [];
    for (let o = 0, c = cells; o < octaves; o++, c *= 2) layers.push({ n: makeValueNoise(seed + o * 131, c), c, a: 1 / (o + 1) });
    return (u: number, v: number) => {
      let s = 0, t = 0;
      for (const l of layers) { s += l.a * (1 - Math.abs(2 * l.n(u * l.c, v * 7) - 1)); t += l.a; }
      return s / t;
    };
  };
  const footNoise = makeFbm(4440, 10, 2);
  const tmp = new THREE.Color();
  // Aerial perspective: rock → horizon colour by `fade`, contrast falls with it.
  const ring = (R: number, segs: number, rock: THREE.Color, fade: number, hMax: number, footAmp: number, name: string, ravines: number, profile: (a: number, u: number) => number) => {
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const rav = ridged(4450 + R, 220, 2);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2 - Math.PI, u = i / segs;
      const x = Math.sin(a) * R, z = Math.cos(a) * R;
      const h = Math.max(0.4, profile(a, u));
      const foot = -1.2 + footAmp * (footNoise(u * 1.7 + R * 0.01, 0.4) - 0.5) * 2;
      const mid = foot + (h - foot) * 0.45;
      pos.push(x, foot, z, x, mid, z, x, h, z);
      // Foot hazier than the crest; the crest lit side slightly warmer.
      const fadeFoot = Math.min(1, fade + 0.14), fadeMid = Math.min(1, fade + 0.05);
      const ravine = ravines * (1 - Math.pow(rav(u, 0.3), 1.5)) * (1 - fade);
      tmp.copy(rock).multiply(horizon).lerp(horizon, fadeFoot); col.push(tmp.r, tmp.g, tmp.b);
      tmp.copy(rock).multiplyScalar(1 - 0.35 * ravine).multiply(horizon).lerp(horizon, fadeMid); col.push(tmp.r, tmp.g, tmp.b);
      const lit = 1 + 0.08 * Math.max(0, Math.sin(a + 0.6)) * (1 - fade);
      tmp.copy(rock).multiplyScalar(lit * (1 - 0.15 * ravine)).multiply(horizon).lerp(horizon, fade * (0.9 + 0.1 * Math.min(1, h / hMax))); col.push(tmp.r, tmp.g, tmp.b);
    }
    for (let i = 0; i < segs; i++) {
      const p = i * 3;
      idx.push(p, p + 3, p + 1, p + 3, p + 4, p + 1, p + 1, p + 4, p + 2, p + 4, p + 5, p + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    m.name = name;
    m.frustumCulled = false;
    parent.add(m);
  };
  const mesaAt = (deg: number, c: number, w: number, h: number, u: number, n: (u: number, v: number) => number) => {
    const e = Math.min(1, Math.max(0, Math.min(deg - (c - w), c + w - deg) / 5));
    return e > 0 ? h * Math.pow(e, 0.5) + 0.5 * n(u, 0.5) : 0;
  };
  const nearBase = makeFbm(4441, 24, 2), nearRidge = ridged(4451, 90, 3);
  ring(108, 1440, new THREE.Color(0.3, 0.29, 0.3), 0.08, 10, 0.8, "world-ridge-0", 1.0, (a, u) => {
    const deg = THREE.MathUtils.radToDeg(a);
    const hills = 1.5 + 4.5 * nearBase(u, 0.3) + 3.2 * Math.pow(nearRidge(u, 0.1), 1.6);
    return Math.max(mesaAt(deg, -43, 19, 14, u, nearRidge), mesaAt(deg, 128, 11, 9, u, nearRidge), hills);
  });
  const midBase = makeFbm(4442, 14, 2), midRidge = ridged(4452, 60, 3);
  ring(134, 1440, new THREE.Color(0.36, 0.36, 0.4), 0.22, 22, 1.2, "world-ridge-1", 0.5, (_a, u) => 5 + 11 * midBase(u + 0.2, 0.55) + 6 * Math.pow(midRidge(u, 0.2), 1.4));
  const farBase = makeFbm(4443, 9, 2), farRidge = ridged(4453, 40, 3);
  ring(160, 1200, new THREE.Color(0.42, 0.43, 0.48), 0.38, 32, 2.0, "world-ridge-2", 0.2, (_a, u) => 9 + 15 * farBase(u * 1.3 + 0.7, 0.2) + 8 * Math.pow(farRidge(u, 0.3), 1.3));
  const fartherBase = makeFbm(4444, 6, 2), fartherRidge = ridged(4454, 28, 3);
  ring(188, 1000, new THREE.Color(0.5, 0.51, 0.56), 0.52, 42, 2.5, "world-ridge-3", 0, (_a, u) => 14 + 20 * fartherBase(u * 0.8 + 0.3, 0.6) + 8 * Math.pow(fartherRidge(u, 0.4), 1.2));

  // Distant man-made marks and a ranch tree line, all hazed by the scene fog.
  const parts: Part[] = [];
  const dark: [number, number, number] = [0.3, 0.29, 0.28];
  void rng;
  {
    // Water tower at ~140 m: four legs, tank, cone roof.
    const x = -88, z = 128, y = field.height(x, z);
    for (const [dx, dz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) { const leg = new THREE.CylinderGeometry(0.12, 0.16, 14, 5); leg.translate(x + dx * 0.7, y + 7, z + dz * 0.7); parts.push({ g: leg, c: dark }); }
    const tank = new THREE.CylinderGeometry(3.2, 2.6, 4.5, 14); tank.translate(x, y + 16, z); parts.push({ g: tank, c: [0.62, 0.6, 0.57] });
    const roof = new THREE.ConeGeometry(3.4, 1.6, 14); roof.translate(x, y + 19, z); parts.push({ g: roof, c: [0.4, 0.38, 0.36] });
  }
  {
    // Radio mast at ~165 m with its beacon (off).
    const x = 118, z = 150, y = field.height(x, z);
    const mast = new THREE.CylinderGeometry(0.15, 0.4, 42, 5); mast.translate(x, y + 21, z); parts.push({ g: mast, c: [0.55, 0.53, 0.52] });
    const beacon = new THREE.SphereGeometry(0.5, 6, 4); beacon.translate(x, y + 42.4, z); parts.push({ g: beacon, c: [0.45, 0.12, 0.1] });
  }
  // (A ranch tree line at 125 m was tried: fog-lifted dark crowns read as pale crystals in front of the darker near ridge — dropped.)
  const mesh = new THREE.Mesh(mergeParts(parts), new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0 }));
  mesh.name = "world-far-marks";
  mesh.frustumCulled = false;
  parent.add(mesh);
}

/* ------------------------------------------------------------------------------------------ */

export interface WorldResult { ground: THREE.Mesh; heightAt: (x: number, z: number) => number }

/**
 * Builds the world layer into the diner's "exterior" group and hides the Exterior.ts
 * pieces it replaces. `horizon` is the sky's horizon colour (Lighting.ts) — the ridges'
 * aerial perspective fades toward it, and the scene fog does the rest.
 */
export function buildWorld(diner: THREE.Group, horizon: THREE.Color): WorldResult {
  const exterior = (diner.getObjectByName("exterior") as THREE.Group | undefined) ?? diner;
  let dirtMap: THREE.Texture | null = null;
  for (const name of ["desert", "scrub", "scrub-shadows", "tyre-tracks", "creosote", "creosote-stems", "horizon", "horizon-mid", "horizon-far"]) {
    const o = exterior.getObjectByName(name) as THREE.Mesh | undefined;
    if (!o) continue;
    if (name === "desert") dirtMap = ((o.material as THREE.MeshStandardMaterial).map as THREE.Texture | null) ?? null;
    o.visible = false;
  }
  const rng = makeRng(4400);
  const field = makeField();
  const group = new THREE.Group();
  group.name = "world";
  const ground = buildGround(field, dirtMap);
  group.add(ground.mesh);
  buildScatter(group, field, ground, rng);
  buildDebris(group, field, rng);
  buildHorizon(group, field, horizon, rng);
  group.traverse((o) => { o.userData.lotCaster = true; });
  exterior.add(group);
  return { ground: ground.mesh, heightAt: field.height };
}
