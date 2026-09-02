/**
 * System 9 — implied presence (rev 2). No figures: the things a person leaves in the two
 * minutes they are out of the room.
 *
 *   apron   the waitress's cotton waist apron on a chrome hook beside the pass-through: a
 *           fabric loop over the hook, the waistband pleated into a 116 mm bunch under it,
 *           the skirt gathered under the band and falling in four heavy folds of unequal
 *           width to a hem barely wider than the shoulder; a patch pocket with a stitch line,
 *           one tie hanging past the hem, the other tucked back into the band
 *   plate   booth 2, aisle end: a diner plate with a rolled rim and a shallow well, a
 *           stainless fork across it (bowed handle, tapering tines), a scatter of toast
 *           flakes, and a thin dried-yolk film with the tine drag through it
 *   cup     a mug on a saucer at stool 3: a dreg of coffee, the residue ring above it, an
 *           upper-lip lipstick print on the outer rim, the saucer's well and foot ring, a
 *           contact shadow under the cup
 *
 * Rev 1's cardigan, toast crust, yolk polygon and newspaper were cut on the critic's frames:
 * a prop a viewer clocks as procedural is worse than no prop. Cloth, tile and the decals
 * share one atlas (procedural/presence.ts). Opaque cloth is the `presence` bucket; the
 * alpha decals (lipstick, yolk film, residue ring, contact shadow) are `presenceDecal`, one
 * transparent mesh. Everything in a palette material (ceramic, stainless, chrome, coffee) is
 * appended to the scene's existing merged meshes by core/mergeInto.ts.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import type { MergedBuilder } from "../core/merge";
import type { TextureBank } from "../core/textureBank";
import * as presMod from "../procedural/presence";
import { PRESENCE_UV } from "../procedural/presence";
import { BOOTH, COUNTER, PASS_THROUGH, PROPS, ROOM, STOOL, WINDOW } from "./layout";

export type UvRect = readonly [number, number, number, number];
const V2 = (x: number, y: number) => new THREE.Vector2(x, y);
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export interface PresenceMaterials {
  cloth: THREE.MeshStandardMaterial;
  decal: THREE.MeshStandardMaterial;
}

export interface PresenceResult {
  /** The atlas materials (for the debug HUD / material counts). */
  material: THREE.MeshStandardMaterial;
  materials: PresenceMaterials;
  /** Where the props sit, for the `sys9-*` capture poses. */
  points: { apron: THREE.Vector3; plate: THREE.Vector3; cup: THREE.Vector3 };
}

export function presenceMaterials(pal: Palette, bank?: TextureBank): PresenceMaterials {
  const pres = bank ? bank.proxy(presMod, "pres") : presMod;
  const set = pres.presenceAtlas(1024);
  const cloth = new THREE.MeshStandardMaterial({
    map: set.map,
    roughnessMap: set.roughnessMap,
    normalMap: set.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    envMapIntensity: pal.napkin.envMapIntensity,
  });
  cloth.name = "presence";
  // Alpha decals over glazed ceramic: lipstick, dried yolk, the residue ring, contact shadow.
  const decal = new THREE.MeshStandardMaterial({
    map: set.map,
    roughnessMap: set.roughnessMap,
    normalMap: set.normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 1,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
    envMapIntensity: pal.ceramic.envMapIntensity,
  });
  decal.name = "presenceDecal";
  decal.userData.noCast = true;
  decal.forceSinglePass = true; // a DoubleSide transparent is otherwise two draws (back pass, front pass)
  return { cloth, decal };
}

export function buildPresence(statics: MergedBuilder, pal: Palette, mats: PresenceMaterials): PresenceResult {
  const apron = buildApron(statics, pal, mats.cloth);
  const plate = buildPlate(statics, pal, mats);
  const cup = buildLipstickCup(statics, pal, mats);
  return { material: mats.cloth, materials: mats, points: { apron, plate, cup } };
}

/* ------------------------------------------------------------------------------------ */
/* Geometry helpers                                                                       */
/* ------------------------------------------------------------------------------------ */

/**
 * rows × cols grid surface. `P(t, s, out)` gives the point for t (0 top/start … 1) and
 * s (0 … 1 across); UVs fill `rect` (u along s, v along 1 − t). Indexed, smooth normals.
 */
export function loft(rows: number, cols: number, P: (t: number, s: number, out: THREE.Vector3) => void, rect: UvRect, uvRepeat: [number, number] = [1, 1]): THREE.BufferGeometry {
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const p = new THREE.Vector3();
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const t = r / (rows - 1), s = c / (cols - 1);
      P(t, s, p);
      const i = r * cols + c;
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      // Repeats fold back and forth inside the region (no wrap across the atlas).
      const fu = tri(s * uvRepeat[0]), fv = tri((1 - t) * uvRepeat[1]);
      uv[i * 2] = rect[0] + fu * (rect[2] - rect[0]);
      uv[i * 2 + 1] = rect[1] + fv * (rect[3] - rect[1]);
    }
  const idx: number[] = [];
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Triangle wave 0..1..0 with period 2 (so a repeat of 3 gives 1.5 back-and-forth passes). */
export function tri(x: number): number {
  const f = ((x % 2) + 2) % 2;
  return f <= 1 ? f : 2 - f;
}

/**
 * A flat tape or a bar along a polyline: a closed tube with a rounded-rectangle section,
 * `halfW(t)` across (along the side vector) and `halfH(t)` thick (along the normal), capped.
 * `up` seeds the frame (the tape's face normal at t = 0); the frame is transported along the
 * path so the tape can twist by `twist(t)` radians. UVs: u round the section, v along.
 */
export function ribbon(
  path: THREE.Vector3[],
  halfW: (t: number) => number,
  halfH: (t: number) => number,
  up: THREE.Vector3,
  rect: UvRect,
  opts: { twist?: (t: number) => number; ring?: number; uvRepeat?: [number, number]; power?: number } = {},
): THREE.BufferGeometry {
  const n = path.length, ring = opts.ring ?? 12, power = opts.power ?? 3;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const T = new THREE.Vector3(), S = new THREE.Vector3(), N = new THREE.Vector3(), tmp = new THREE.Vector3();
  const rep = opts.uvRepeat ?? [1, 1];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
    T.subVectors(b, a).normalize();
    // Parallel transport: the previous normal (or `up` at the start) projected off the tangent;
    // the side vector completes a right-handed (S, N, T) frame.
    if (i === 0) N.copy(up);
    N.addScaledVector(T, -N.dot(T));
    if (N.lengthSq() < 1e-8) N.set(0, 1, 0).addScaledVector(T, -T.y);
    if (N.lengthSq() < 1e-8) N.set(1, 0, 0).addScaledVector(T, -T.x);
    N.normalize();
    S.crossVectors(N, T).normalize();
    const tw = opts.twist ? opts.twist(t) : 0;
    if (tw !== 0) {
      const c = Math.cos(tw), s = Math.sin(tw);
      tmp.copy(S).multiplyScalar(c).addScaledVector(N, s);
      N.multiplyScalar(c).addScaledVector(S, -s);
      S.copy(tmp);
    }
    const w = halfW(t), h = halfH(t);
    for (let k = 0; k <= ring; k++) {
      const ang = (k / ring) * Math.PI * 2;
      // Superellipse (rounded rectangle) section.
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const ex = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / power), ey = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / power);
      tmp.copy(path[i]).addScaledVector(S, ex * w).addScaledVector(N, ey * h);
      pos.push(tmp.x, tmp.y, tmp.z);
      uv.push(rect[0] + tri((k / ring) * rep[0]) * (rect[2] - rect[0]), rect[1] + tri(t * rep[1]) * (rect[3] - rect[1]));
    }
  }
  const stride = ring + 1;
  for (let i = 0; i < n - 1; i++)
    for (let k = 0; k < ring; k++) {
      const a = i * stride + k, b = a + 1, c = a + stride, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  // Caps: a centre vertex fanned to the end rings.
  for (const end of [0, n - 1]) {
    const ci = pos.length / 3;
    pos.push(path[end].x, path[end].y, path[end].z);
    uv.push((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2);
    for (let k = 0; k < ring; k++) {
      const a = end * stride + k, b = a + 1;
      if (end === 0) idx.push(ci, b, a);
      else idx.push(ci, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Sample a polyline (Vector3) into `n` points with Catmull-Rom smoothing. */
export function curve(pts: THREE.Vector3[], n: number, tension = 0.5): THREE.Vector3[] {
  const c = new THREE.CatmullRomCurve3(pts, false, "catmullrom", tension);
  return c.getPoints(n - 1);
}

/** LatheGeometry with the seam normals welded (the duplicated seam column otherwise shades as a crease). */
export function lathe(points: THREE.Vector2[], segments: number): THREE.LatheGeometry {
  const g = new THREE.LatheGeometry(points, segments);
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const m = points.length;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let j = 0; j < m; j++) {
    const i0 = j, i1 = segments * m + j;
    a.fromBufferAttribute(nrm, i0);
    b.fromBufferAttribute(nrm, i1);
    a.add(b).normalize();
    nrm.setXYZ(i0, a.x, a.y, a.z);
    nrm.setXYZ(i1, a.x, a.y, a.z);
  }
  return g;
}

/** Map every vertex's UV into `rect` by its (x, z) footprint over `size` metres (for flat things). */
/** Shrink an atlas rect by `f` of its size on every side (or per axis), so a decal's edge texels
 *  never bilinear-blend with the opaque neighbour tile — that blend drew a thin opaque frame
 *  around every alpha decal. */
function inset(rect: UvRect, f: number, fv = f): UvRect {
  const w = rect[2] - rect[0], h = rect[3] - rect[1];
  return [rect[0] + w * f, rect[1] + h * fv, rect[2] - w * f, rect[3] - h * fv];
}

function uvByPlan(g: THREE.BufferGeometry, rect: UvRect, size: number): void {
  const pos = g.attributes.position;
  g.computeBoundingBox();
  const c = g.boundingBox!.getCenter(new THREE.Vector3());
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const u = clamp01(0.5 + (pos.getX(i) - c.x) / size), v = clamp01(0.5 + (pos.getZ(i) - c.z) / size);
    uv[i * 2] = rect[0] + u * (rect[2] - rect[0]);
    uv[i * 2 + 1] = rect[1] + v * (rect[3] - rect[1]);
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/**
 * An axis-aligned rectangle (corners `a`, `b`, equal along the axis of `normal`) cut into
 * `size`-metre cells, each cell UV'd to the whole atlas `rect` (a sub-rectangle of an atlas
 * cannot wrap, so the repeat is in the mesh). Partial last cells get a partial rect. Used for
 * the kitchen slice's wall and floor tile (Openables.ts).
 */
export function tiledRect(a: readonly [number, number, number], b: readonly [number, number, number], normal: THREE.Vector3, size: number, rect: UvRect): THREE.BufferGeometry {
  const lo = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
  const hi = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
  const n = normal;
  const iN = Math.abs(n.x) > 0.5 ? 0 : Math.abs(n.y) > 0.5 ? 1 : 2;
  // u runs along the horizontal in-plane axis (x, else z), v along the other (y for walls, z for floors).
  const iu = iN === 0 ? 2 : 0;
  const iv = iN === 1 ? 2 : 1;
  const wu = hi[iu] - lo[iu], wv = hi[iv] - lo[iv];
  const nu = Math.max(1, Math.ceil(wu / size - 1e-6)), nv = Math.max(1, Math.ceil(wv / size - 1e-6));
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [], idx: number[] = [];
  const rw = rect[2] - rect[0], rh = rect[3] - rect[1];
  const p = [0, 0, 0];
  p[iN] = lo[iN];
  let flip = false;
  for (let i = 0; i < nu; i++) {
    const u0 = lo[iu] + i * size, u1 = Math.min(hi[iu], u0 + size);
    for (let j = 0; j < nv; j++) {
      const v0 = lo[iv] + j * size, v1 = Math.min(hi[iv], v0 + size);
      const base = pos.length / 3;
      for (const [uu, vv] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) {
        p[iu] = uu;
        p[iv] = vv;
        pos.push(p[0], p[1], p[2]);
        uv.push(rect[0] + ((uu - u0) / size) * rw, rect[1] + ((vv - v0) / size) * rh);
        nrm.push(n.x, n.y, n.z);
      }
      if (i === 0 && j === 0) {
        // Winding: (v1−v0)×(v2−v0) must point along the normal.
        const ax = pos[3] - pos[0], ay = pos[4] - pos[1], az = pos[5] - pos[2];
        const bx = pos[6] - pos[0], by = pos[7] - pos[1], bz = pos[8] - pos[2];
        const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
        flip = cx * n.x + cy * n.y + cz * n.z < 0;
      }
      if (flip) idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * Map a geometry's existing 0..1 UVs (a PlaneGeometry) into an atlas rect, optionally only a
 * v-band of it (for a slice of the troffer lens texture).
 */
export function uvIntoRect(g: THREE.BufferGeometry, rect: UvRect, vBand: readonly [number, number] = [0, 1]): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = vBand[0] + uv.getY(i) * (vBand[1] - vBand[0]);
    uv.setXY(i, rect[0] + u * (rect[2] - rect[0]), rect[1] + v * (rect[3] - rect[1]));
  }
  return g;
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------------------------ */
/* Apron                                                                                  */
/* ------------------------------------------------------------------------------------ */

function buildApron(s: MergedBuilder, pal: Palette, cloth: THREE.Material): THREE.Vector3 {
  // Hook on the wall strip left of the pass-through jamb, clear of the brewer, at 1.92 m.
  const wallZ = ROOM.zBack;
  const hx = PASS_THROUGH.centerX - PASS_THROUGH.width / 2 - PASS_THROUGH.jamb - 0.2; // ≈ −1.445
  const hy = 1.92;
  const R = PRESENCE_UV.cotton;
  const plain: UvRect = [R[0] + 0.02, R[3] - 0.045, R[0] + 0.46, R[3] - 0.005]; // clean canvas strip (under the band on the skirt)

  /* ---- chrome hook: rose, shank out of the wall, quarter turn up, tip with a ball ---- */
  {
    const rose = new THREE.CylinderGeometry(0.018, 0.02, 0.006, 24);
    rose.rotateX(Math.PI / 2);
    rose.translate(hx, hy, wallZ + 0.003);
    s.add(rose, pal.chrome);
    const shank = new THREE.CylinderGeometry(0.005, 0.005, 0.04, 14);
    shank.rotateX(Math.PI / 2);
    shank.translate(hx, hy, wallZ + 0.026);
    s.add(shank, pal.chrome);
    const bend = new THREE.TorusGeometry(0.012, 0.005, 10, 16, Math.PI / 2);
    // Quarter ring in the y–z plane: local (R,0,0) → (0,−R,0) [shank end], local (0,R,0) → (0,0,+R) [tip start].
    bend.rotateZ(-Math.PI / 2);
    bend.rotateY(-Math.PI / 2);
    bend.translate(hx, hy + 0.012, wallZ + 0.046);
    s.add(bend, pal.chrome);
    const tip = new THREE.CylinderGeometry(0.005, 0.005, 0.024, 14);
    tip.translate(hx, hy + 0.024, wallZ + 0.058);
    s.add(tip, pal.chrome);
    const ball = new THREE.SphereGeometry(0.0065, 14, 10);
    ball.translate(hx, hy + 0.037, wallZ + 0.058);
    s.add(ball, pal.chrome);
  }

  /* ---- fabric loop over the shank: a 16 mm tape, legs nearly parallel, converging on the band centre ---- */
  const loopZ = wallZ + 0.04; // rides the shank's outer third
  const bandTop = hy - 0.058, bandH = 0.026, bandBot = bandTop - bandH;
  {
    const pts: THREE.Vector3[] = [];
    // Up the left leg, over the shank (inner radius 6 mm → tape centre 7 mm), down the right leg.
    const legB = bandTop + 0.004, legT = hy - 0.001;
    for (let i = 0; i <= 6; i++) pts.push(V3(hx - 0.004 + 0.001 * (i / 6), legB + (legT - legB) * (i / 6), loopZ - 0.0015 + 0.0006 * Math.sin(i)));
    for (let i = 1; i < 8; i++) {
      const a = Math.PI - (i / 8) * Math.PI;
      pts.push(V3(hx + 0.007 * Math.cos(a), hy + 0.007 * Math.sin(a), loopZ));
    }
    for (let i = 0; i <= 6; i++) pts.push(V3(hx + 0.007 - 0.002 * (i / 6), legT - (legT - legB) * (i / 6), loopZ + 0.0015 + 0.0006 * Math.cos(i)));
    s.add(ribbon(curve(pts, 40, 0.4), () => 0.008, () => 0.0011, V3(0, 0, 1), plain, { ring: 10, uvRepeat: [0.35, 2] }), cloth);
  }

  /* ---- waistband bunched under the loop: the 0.7 m band pleated into 116 mm ---- */
  // A flat 26 mm band cannot hang 116 mm wide without folding: it pleats into six ridges of
  // unequal width and depth (a sawtooth, each pleat's return face steeper than its show face),
  // its ends curling back toward the wall. The skirt's top edge hides under it.
  const bunchX0 = hx - 0.058, bunchX1 = hx + 0.058;
  const pleats = [
    { c: 0.06, w: 0.07, a: 0.009, k: 0.35 },
    { c: 0.24, w: 0.08, a: 0.0115, k: -0.3 },
    { c: 0.41, w: 0.06, a: 0.008, k: 0.4 },
    { c: 0.57, w: 0.09, a: 0.012, k: -0.25 },
    { c: 0.76, w: 0.065, a: 0.0095, k: 0.3 },
    { c: 0.92, w: 0.07, a: 0.007, k: -0.35 },
  ];
  const bandRelief = (u: number, t: number) => {
    let z = 0.055;
    for (const p of pleats) {
      const d = (u - p.c) / p.w;
      z += p.a * Math.exp(-Math.pow(Math.abs(d + p.k * d * Math.abs(d)), 1.6)) * (1 + 0.15 * Math.sin(t * Math.PI));
    }
    z -= 0.012 * Math.pow(Math.abs(u - 0.5) * 2, 6); // ends curl back
    return z;
  };
  const band = (t: number, u: number, o: THREE.Vector3, lift = 0) => {
    const x = bunchX0 + u * (bunchX1 - bunchX0) + 0.0015 * Math.sin(u * Math.PI * 7 + t);
    // Suspended at its centre, the band's ends sag ~9 mm.
    const y = bandTop - t * bandH - 0.0015 * Math.sin(u * Math.PI * 2.3 + 0.7) - 0.009 * Math.pow(Math.abs(u - 0.5) * 2, 2);
    return o.set(x, y, wallZ + bandRelief(u, t) + lift);
  };
  s.add(loft(6, 60, (t, u, o) => band(t, u, o), plain, [0.35, 0.35]), cloth);
  for (const tt of [0, 1]) {
    const edge: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i++) band(tt, i / 48, edge[i] = new THREE.Vector3(), -0.0014);
    s.add(ribbon(edge, () => 0.0014, () => 0.0014, V3(0, 1, 0), plain, { ring: 8, uvRepeat: [0.2, 2] }), cloth);
  }

  /* ---- skirt: gathered under the band, four heavy folds of unequal width, hem barely wider than the shoulder ---- */
  const fall = 0.34;
  const skirtTop = bandBot + 0.006; // tucked 6 mm under the band
  const folds = [
    { s: 0.11, w: 0.09, a: 0.04 },
    { s: 0.37, w: 0.12, a: 0.048 },
    { s: 0.6, w: 0.07, a: 0.032 },
    { s: 0.84, w: 0.1, a: 0.042 },
  ];
  const gathers = [
    { f: 9.3, ph: 0.4, a: 0.0045 },
    { f: 14.1, ph: 2.1, a: 0.0032 },
    { f: 22.7, ph: 4.4, a: 0.0018 },
    { f: 6.1, ph: 1.3, a: 0.0028 },
  ];
  // Half-width: 116 mm under the band (the bunch), 160 mm at the hem — it hangs, it does not flare.
  const halfW = (t: number) => 0.058 + 0.016 * smooth(t / 0.45) + 0.006 * t;
  // Front-face relief of the skirt (metres out of the wall plane) at (t, u).
  const relief = (t: number, u: number) => {
    let z = 0;
    const open = 0.35 + 0.65 * smooth(t / 0.35), relax = 1 - 0.2 * t;
    // The selvedges hang flatter: a fold crest right at the edge made a steep left flank that
    // faced away from every light in the aisle and read as a black slab from the apron camera.
    const edge = 0.55 + 0.45 * smooth(Math.min(u, 1 - u) / 0.14);
    for (const f of folds) z += f.a * open * relax * edge * Math.exp(-Math.pow(Math.abs(u - f.s) / f.w, 1.4));
    const gDecay = 1 - 0.7 * smooth(t / 0.55);
    for (const g of gathers) z += g.a * gDecay * Math.sin(u * Math.PI * 2 * g.f + g.ph + 0.9 * Math.sin(t * 5 + g.ph));
    return z;
  };
  const skirt = (t: number, u: number, out: THREE.Vector3, lift = 0) => {
    const w = halfW(t);
    // Folds also bunch the cloth sideways: shift x toward each fold's crest a little.
    let dx = 0;
    const edge = 0.3 + 0.7 * smooth(Math.min(u, 1 - u) / 0.14);
    for (const f of folds) dx += 0.25 * f.a * (0.4 + 0.6 * t) * edge * Math.tanh((u - f.s) / f.w) * Math.exp(-Math.pow(Math.abs(u - f.s) / (2 * f.w), 2));
    const x = hx + (u - 0.5) * 2 * w + 0.006 * t * t - dx;
    const z = wallZ + 0.03 + relief(t, u) + 0.018 * smooth(t / 0.5) + lift;
    // Hem dips a few millimetres where the folds hang heavier.
    const dip = 0.006 * t * (0.5 * Math.sin(u * Math.PI * 2.7 + 0.6) + 0.5 * Math.sin(u * Math.PI * 5.3 + 2.2));
    const y = skirtTop - t * fall - dip;
    return out.set(x, y, z);
  };
  // Inset from the tile edges: the hem (v = 0.5) sits on the quarry tile's border, and where the
  // side folds turn edge-on the anisotropic footprint reached across it — a dark red 10 mm strip
  // up the left selvedge in the apron frame.
  s.add(loft(40, 72, (t, u, o) => skirt(t, u, o), inset(R, 0.02, 0.035)), cloth);
  // Hem: a rolled 5 × 3 mm edge along the bottom; the side selvedges 3 × 2 mm.
  {
    const hem: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) hem.push(skirt(1, i / 40, new THREE.Vector3(), 0));
    s.add(ribbon(hem, () => 0.0026, () => 0.0016, V3(0, 1, 0), plain, { ring: 8, uvRepeat: [0.4, 4] }), cloth);
    for (const u of [0, 1]) {
      const side: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) side.push(skirt(0.02 + 0.98 * (i / 24), u, new THREE.Vector3(), 0));
      s.add(ribbon(side, () => 0.0015, () => 0.0011, V3(1, 0, 0), plain, { ring: 8, uvRepeat: [0.3, 3] }), cloth);
    }
  }
  /* ---- patch pocket, right of centre: face proud 4 mm, mouth gaping, top hem doubled, sides closed ---- */
  {
    const P = { t0: 0.42, t1: 0.78, s0: 0.2, s1: 0.8 }; // must match the atlas POCKET footprint
    const face = (t: number, u: number, o: THREE.Vector3) => {
      const tt = P.t0 + t * (P.t1 - P.t0), uu = P.s0 + u * (P.s1 - P.s0);
      const gape = 0.011 * (1 - smooth(t / 0.8)) * Math.sin(u * Math.PI);
      const sag = 0.004 * (1 - t) * Math.sin(u * Math.PI); // the top edge droops at its middle
      skirt(tt + sag / fall, uu, o, 0.004 + gape);
    };
    s.add(loft(12, 14, face, inset(PRESENCE_UV.pocket, 0.012)), cloth);
    // Side + bottom closure: a strip from the skirt to the pocket face.
    const edgeLoop = (q: number, o: THREE.Vector3, lift: number) => {
      // q 0..1 runs down the left side, along the bottom, up the right side.
      let t: number, u: number;
      if (q < 0.33) {
        t = q / 0.33;
        u = 0;
      } else if (q < 0.67) {
        t = 1;
        u = (q - 0.33) / 0.34;
      } else {
        t = 1 - (q - 0.67) / 0.33;
        u = 1;
      }
      const tt = P.t0 + t * (P.t1 - P.t0), uu = P.s0 + u * (P.s1 - P.s0);
      skirt(tt, uu, o, lift);
    };
    s.add(loft(2, 40, (k, q, o) => edgeLoop(q, o, k * 0.004), plain, [3, 0.1]), cloth);
    // Top hem: doubled cloth, 2.5 mm thick, 18 mm tall, following the gaping mouth.
    const mouth: THREE.Vector3[] = [];
    for (let i = 0; i <= 14; i++) {
      const o = new THREE.Vector3();
      face(0, i / 14, o);
      mouth.push(o);
    }
    s.add(ribbon(mouth, () => 0.009, () => 0.0014, V3(0, 0, 1), plain, { ring: 8, uvRepeat: [0.3, 1.5] }), cloth);
  }
  /* ---- ties: 25 mm tapes. Right one hangs past the hem with a lazy twist; left one is tucked back into the band ---- */
  {
    const pts: THREE.Vector3[] = [];
    const x0 = bunchX1 - 0.02, y0 = bandBot - 0.004; // starts under the band's bottom edge
    const yEnd = skirtTop - fall - 0.09;
    for (let i = 0; i <= 10; i++) {
      const q = i / 10;
      const y = y0 + (yEnd - y0) * q;
      const t = clamp01((skirtTop - y) / fall);
      const u = clamp01(0.5 + 0.045 / (2 * halfW(t))); // skirt u under the tie
      const front = y > skirtTop - fall ? relief(t, u) + 0.018 * smooth(t / 0.5) + 0.03 : 0.03 + relief(1, u) + 0.018 - 0.01 * clamp01((skirtTop - fall - y) / 0.09);
      pts.push(V3(x0 + 0.012 * Math.sin(q * Math.PI * 1.3 + 0.4) + 0.01 * q, y, wallZ + front + 0.0035 + 0.004 * Math.sin(q * Math.PI * 2.1)));
    }
    s.add(ribbon(curve(pts, 36, 0.5), () => 0.0125, () => 0.0009, V3(0, 0, 1), plain, { ring: 10, twist: (t) => 0.12 * Math.sin(t * Math.PI * 1.4), uvRepeat: [0.5, 6] }), cloth);
    // Tucked tie: its 6 cm tail pokes out from under the band's left end and hangs against the skirt.
    const tuck: THREE.Vector3[] = [
      V3(bunchX0 + 0.018, bandBot + 0.004, wallZ + 0.05),
      V3(bunchX0 + 0.015, bandBot - 0.018, wallZ + 0.062),
      V3(bunchX0 + 0.012, bandBot - 0.04, wallZ + 0.066),
      V3(bunchX0 + 0.013, bandBot - 0.06, wallZ + 0.0665),
    ];
    s.add(ribbon(curve(tuck, 20, 0.5), () => 0.0125, () => 0.0009, V3(0, 0, 1), plain, { ring: 10, twist: (t) => 0.25 * t, uvRepeat: [0.5, 2] }), cloth);
  }
  return new THREE.Vector3(hx, hy - 0.22, wallZ + 0.06);
}

/* ------------------------------------------------------------------------------------ */
/* Booth 2: plate, fork, crumbs, yolk film                                                 */
/* ------------------------------------------------------------------------------------ */

function buildPlate(s: MergedBuilder, pal: Palette, mats: PresenceMaterials): THREE.Vector3 {
  const bx = WINDOW.centersX[2];
  const tableTop = BOOTH.table.top;
  const px = bx - 0.14, pz = BOOTH.zInner + 0.4; // the −x bench's place, nearest the aisle
  // Plate: Ø 237 mm diner china — foot ring, shallow well, 30 mm rim rising to a rolled bead.
  const wellY = 0.0068;
  const plate = lathe(
    [
      V2(0, 0.003), V2(0.058, 0.003), V2(0.058, 0), V2(0.067, 0), V2(0.067, 0.0035), V2(0.076, 0.0055), V2(0.086, 0.011), V2(0.096, 0.016), V2(0.108, 0.0195), V2(0.115, 0.0225),
      V2(0.1178, 0.0246), V2(0.1185, 0.0262), V2(0.1176, 0.0276), V2(0.1158, 0.0272), V2(0.1148, 0.0255), V2(0.108, 0.0228), V2(0.097, 0.0196), V2(0.089, 0.0155), V2(0.082, 0.0105), V2(0.074, 0.0078), V2(0.062, wellY), V2(0, wellY),
    ],
    72,
  );
  plate.translate(px, tableTop, pz);
  s.add(plate, pal.ceramic);

  // Fork: stainless, across the plate — tines in the well, handle over the rim, end overhanging.
  {
    const L = 0.185;
    // Tines rest on the well floor; the handle's underside meets the rim bead ~3.3 cm from its
    // end (rise 2 cm over 15 cm → 7.5°) and overhangs 2.5 cm.
    const yaw = -0.85, pitch = THREE.MathUtils.degToRad(7.5);
    const M = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationZ(pitch));
    const tips = V3(px - 0.012, tableTop + wellY + 0.0025, pz - 0.035);
    M.setPosition(tips);
    const place = (g: THREE.BufferGeometry) => {
      g.applyMatrix4(M);
      s.add(g, pal.stainless);
    };
    // Handle + neck + head as one bar (x from the head, 0.045, to the end, L): width waisted, bowed up in the middle.
    const spine: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const q = i / 16, x = 0.045 + q * (L - 0.045);
      spine.push(V3(x, 0.0035 * Math.sin(q * Math.PI) - 0.002 * (1 - q) * (1 - q), 0));
    }
    place(
      ribbon(
        spine,
        (t) => 0.006 + 0.0055 * smooth((t - 0.15) / 0.6) - 0.0025 * Math.exp(-Math.pow((t - 0.12) / 0.1, 2)),
        (t) => 0.0016 + 0.0004 * t,
        V3(0, 1, 0),
        PRESENCE_UV.crumb,
        { ring: 12, power: 2.4 },
      ),
    );
    // Head: flares from the neck to the tine root.
    const head: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) head.push(V3(0.03 + (i / 6) * 0.017, -0.0012 + 0.0008 * (i / 6), 0));
    place(ribbon(head, (t) => 0.0115 - 0.0045 * t, () => 0.0015, V3(0, 1, 0), PRESENCE_UV.crumb, { ring: 12, power: 2.4 }));
    // Four tines: tapering, curving up a little at the tips.
    for (let k = 0; k < 4; k++) {
      const z = -0.0105 + k * 0.007;
      const tine: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const q = i / 8; // 0 tip … 1 root
        tine.push(V3(0.031 * q, -0.0012 + 0.0022 * (1 - q) * (1 - q), z * (0.92 + 0.08 * q)));
      }
      place(ribbon(tine, (t) => 0.0009 + 0.0007 * t, (t) => 0.0007 + 0.0005 * t, V3(0, 1, 0), PRESENCE_UV.crumb, { ring: 10, power: 2.2 }));
    }
  }

  // Dried yolk film: a thin feathered smear with the tine drag through it, 0.3 mm over the well.
  {
    const g = new THREE.CircleGeometry(0.026, 40);
    g.rotateX(-Math.PI / 2);
    g.rotateY(0.7);
    g.scale(1.15, 1, 0.9);
    uvByPlan(g, inset(PRESENCE_UV.yolkFilm, 0.03), 0.05);
    g.translate(px + 0.018, tableTop + wellY + 0.0003, pz + 0.014);
    s.add(g, mats.decal);
  }

  // Crumbs: eleven irregular flakes, random yaw and a slight cant, on the well and the table.
  {
    const r = rng(4242);
    const spots: Array<[number, number, number]> = [
      [px + 0.01, wellY, pz - 0.048], [px + 0.052, wellY, pz - 0.02], [px - 0.055, wellY, pz + 0.03], [px - 0.03, wellY, pz - 0.015], [px + 0.04, wellY, pz + 0.045],
      [px - 0.012, wellY, pz + 0.052], [px + 0.06, wellY, pz + 0.018], [px + 0.02, wellY, pz + 0.033],
      [px + 0.165, 0, pz + 0.03], [px + 0.2, 0, pz - 0.055], [px - 0.16, 0, pz + 0.08],
    ];
    spots.forEach(([x, y, z], i) => {
      const n = 5 + Math.floor(r() * 3);
      const shape = new THREE.Shape();
      const rad = 0.0016 + 0.0016 * r();
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2;
        const rr = rad * (0.6 + 0.8 * r()) * (1 + 0.3 * Math.cos(a * 2 + i));
        const X = rr * Math.cos(a) * (1.3 + 0.4 * r()), Y = rr * Math.sin(a);
        if (k === 0) shape.moveTo(X, Y);
        else shape.lineTo(X, Y);
      }
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.0008 + 0.0008 * r(), bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      uvByPlan(g, PRESENCE_UV.crumb, 0.008);
      g.rotateZ((r() - 0.5) * 0.5); // cant
      g.rotateY(r() * Math.PI * 2);
      g.translate(x, tableTop + y + 0.0002, z);
      s.add(g, mats.cloth);
    });
  }
  return new THREE.Vector3(px - 0.02, tableTop + 0.02, pz + 0.02);
}

/* ------------------------------------------------------------------------------------ */
/* Lipstick cup                                                                           */
/* ------------------------------------------------------------------------------------ */

/** Saucer well floor height (the cup's foot sits here). */
export const SAUCER_WELL = 0.0055;
/**
 * Diner saucer profile (r, y): foot ring, a centre well the cup foot sits in (a small ridge at
 * its edge), flaring to a rolled rim. Shared with the cabinet's saucer stack (Openables.ts).
 */
export const SAUCER_PROFILE = [
  V2(0, 0.003), V2(0.035, 0.003), V2(0.035, 0), V2(0.042, 0), V2(0.042, 0.0035), V2(0.046, 0.005), V2(0.056, 0.0075), V2(0.07, 0.0135), V2(0.0785, 0.0195), V2(0.0793, 0.0215), V2(0.0785, 0.0228),
  V2(0.077, 0.0222), V2(0.07, 0.0175), V2(0.056, 0.0108), V2(0.046, 0.0087), V2(0.041, 0.0095), V2(0.0375, 0.0095), V2(0.0355, 0.0068), V2(0.033, SAUCER_WELL), V2(0, SAUCER_WELL),
];

/** Cup body profile (r, y), outside up the wall, over the rim, down inside to the floor. */
const CUP_PROFILE = [
  V2(0, 0.003), V2(0.031, 0.003), V2(0.036, 0.006), V2(0.04, 0.014), V2(0.041, 0.024), V2(0.0395, 0.038), V2(0.0385, 0.05), V2(0.039, 0.062), V2(0.0405, 0.074), V2(0.041, 0.082),
  V2(0.0405, 0.0875), V2(0.0385, 0.089), V2(0.0355, 0.089), V2(0.034, 0.0875), V2(0.0335, 0.084), V2(0.0325, 0.072), V2(0.0315, 0.05), V2(0.032, 0.03), V2(0.03, 0.016), V2(0.026, 0.013), V2(0, 0.013),
];

function buildLipstickCup(s: MergedBuilder, pal: Palette, mats: PresenceMaterials): THREE.Vector3 {
  const x = STOOL.centersX[2], z = PROPS.saucerZ, y = COUNTER.height;
  // Saucer: foot ring, a centre well the cup foot sits in (a small ridge at its edge), flaring to a rolled rim.
  const wellFloor = SAUCER_WELL;
  const saucer = lathe(SAUCER_PROFILE, 56);
  saucer.translate(x, y, z);
  s.add(saucer, pal.ceramic);
  const my = y + wellFloor;
  // Contact shadow in the well, under and just outside the cup's foot.
  {
    const g = new THREE.CircleGeometry(0.0345, 36);
    g.rotateX(-Math.PI / 2);
    uvByPlan(g, inset(PRESENCE_UV.contactAO, 0.03), 0.069);
    g.translate(x, my + 0.00015, z);
    s.add(g, mats.decal);
  }
  const body = lathe(CUP_PROFILE, 56);
  const handle = new THREE.TorusGeometry(0.019, 0.0075, 12, 28, 1.2 * Math.PI);
  handle.rotateZ(-0.6 * Math.PI);
  handle.scale(1, 1.25, 1);
  handle.translate(0.052, 0.048, 0);
  const yaw = Math.PI; // handle to −x: the drinker sits at +z facing the back bar, right hand at −x
  for (const g of [body, handle]) {
    g.rotateY(yaw);
    g.translate(x, my, z);
    s.add(g, pal.ceramic);
  }
  // Foot ring in the cup's own ceramic (the mugs' bisque ring lives on the InstancedMesh — no bucket to join).
  const foot = lathe([V2(0.024, 0.0002), V2(0.026, 0), V2(0.031, 0), V2(0.0315, 0.003), V2(0.0235, 0.003), V2(0.024, 0.0002)], 40);
  foot.translate(x, my, z);
  s.add(foot, pal.ceramic);
  // A dreg: 4 mm of cold coffee on the floor of the cup.
  const dregY = 0.013 + 0.004;
  const coffee = new THREE.CircleGeometry(innerR(dregY) - 0.0002, 40);
  coffee.rotateX(-Math.PI / 2);
  uvByPlan(coffee, inset(PRESENCE_UV.dreg, 0.03), 2 * (innerR(dregY) - 0.0002));
  coffee.translate(x, my + dregY, z);
  s.add(coffee, mats.decal); // opaque tile in the decal bucket: `pal.coffee` has no static host
  // Residue ring: the tide the coffee left as it went down, on the inside wall above the dreg.
  s.add(
    loft(6, 49, (t, u, o) => {
      const yy = dregY + 0.014 - t * 0.014; // t 0 top … 1 at the surface
      const rr = innerR(yy) - 0.00025;
      const a = u * Math.PI * 2;
      o.set(x + rr * Math.cos(a), my + yy, z + rr * Math.sin(a));
    }, inset(PRESENCE_UV.residue, 0, 0.03), [2, 1]),
    mats.decal,
  );
  // Lipstick: an upper-lip print on the outer face of the rim opposite the handle, its top
  // lapping 1 mm over the lip. A patch that follows the rim profile (arc length along the
  // outside-up-over-inside polyline), 0.25 mm proud, UV'd to the 24 mm print tile.
  {
    const prof = [V2(0.041, 0.066), V2(0.041, 0.082), V2(0.0405, 0.0875), V2(0.0385, 0.089), V2(0.0355, 0.089), V2(0.034, 0.0875), V2(0.0335, 0.084)];
    const cum = [0];
    for (let i = 1; i < prof.length; i++) cum.push(cum[i - 1] + prof[i].distanceTo(prof[i - 1]));
    const total = cum[cum.length - 1];
    // Only the tile's print band (v 0.28 … 0.74, 11 mm) is placed, so the patch's edges never
    // sample the tile boundary. Its top (tile v ≈ 0.69) lands 1 mm over the rim top: arc
    // position of (0.0375, 0.089) minus (0.69 − 0.28) × 24 mm.
    const band: [number, number] = [0.28, 0.74];
    const bandH = (band[1] - band[0]) * 0.024;
    const topArc = cum[3] + 0.001;
    const arc0 = topArc - (0.69 - band[0]) * 0.024;
    const sample = (arc: number, out: { r: number; y: number; nr: number; ny: number }) => {
      const a = Math.min(total - 1e-6, Math.max(0, arc));
      let i = 1;
      while (i < cum.length - 1 && cum[i] < a) i++;
      const f = (a - cum[i - 1]) / (cum[i] - cum[i - 1]);
      const p0 = prof[i - 1], p1 = prof[i];
      out.r = p0.x + (p1.x - p0.x) * f;
      out.y = p0.y + (p1.y - p0.y) * f;
      // Outward normal of the polyline (rotate the tangent −90°: outside is +r going up).
      const tx = p1.x - p0.x, ty = p1.y - p0.y, len = Math.hypot(tx, ty);
      out.nr = ty / len;
      out.ny = -tx / len;
    };
    const smp = { r: 0, y: 0, nr: 0, ny: 0 };
    const centreA = Math.PI / 2 + 0.3; // the drinker's side of the rim (+z), a little toward −x
    const span = 0.024 / 0.0405; // 24 mm of arc at the rim radius
    const g = loft(16, 14, (t, u, o) => {
      sample(arc0 + (1 - t) * bandH, smp);
      const rr = smp.r + 0.00025 * smp.nr, yy = smp.y + 0.00025 * smp.ny;
      const a = centreA + (u - 0.5) * span;
      o.set(x + rr * Math.cos(a), my + yy, z + rr * Math.sin(a));
    }, (() => {
      const L = PRESENCE_UV.lipstick, w = L[2] - L[0], h = L[3] - L[1];
      return [L[0] + w * 0.03, L[1] + h * band[0], L[2] - w * 0.03, L[1] + h * band[1]] as UvRect;
    })());
    s.add(g, mats.decal);
  }
  return new THREE.Vector3(x, my + 0.05, z);
}

/** Inner wall radius of the cup at height `yy` (from the profile's inside leg). */
function innerR(yy: number): number {
  const inner = [V2(0.026, 0.013), V2(0.03, 0.016), V2(0.032, 0.03), V2(0.0315, 0.05), V2(0.0325, 0.072), V2(0.0335, 0.084), V2(0.034, 0.0875)];
  for (let i = 1; i < inner.length; i++) {
    if (yy <= inner[i].y) {
      const f = (yy - inner[i - 1].y) / (inner[i].y - inner[i - 1].y);
      return inner[i - 1].x + (inner[i].x - inner[i - 1].x) * f;
    }
  }
  return inner[inner.length - 1].x;
}
