/**
 * System 3: everything seen through the glass. Concrete kerb and sidewalk, a
 * parking lot with a nose-in stall row, drive aisle and a CMU wall at the far
 * edge, two light standards, two boxy 80s–90s vehicles, desert dirt, low scrub,
 * a hazed mesa/ridge silhouette and a procedural sky dome with the sun glare.
 *
 * Everything is procedural and merged per material; the scrub is one
 * InstancedMesh. Exterior materials carry a small sky-fill emissive: the interior
 * hemisphere fill is deliberately low (REFERENCE §2 — do not put the outdoor
 * 10 klux hemisphere inside the room) and lights cannot be masked per object,
 * so the lot's diffuse sky light is approximated here. System 4 replaces it.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { makeRng, makeFbm, makeValueNoise } from "../core/rng";
import type { TextureBank } from "../core/textureBank";
import * as extModule from "../procedural/exterior";
import { ROOM } from "./layout";

const T = ROOM.wallThickness;
export const LOT = {
  /** Sidewalk: building face to kerb. */
  kerbZ: ROOM.zFront + T + 1.8,
  kerbH: 0.15,
  /** Lot surface height (apron top is −0.12). */
  y: -0.12 - 0.15,
  /** Detailed lot canvas extent. */
  x0: -14,
  w: 28,
  d: 14,
  stallDepth: 5.5,
  stallPitch: 2.7,
  wallZ: ROOM.zFront + T + 1.8 + 14,
  /** Wheel stop centre line, from the kerb face (rev 4: 72" precast bars, see buildExterior). */
  stopZ: 0.75,
} as const;
/** Frontage road behind the CMU wall (rev 3): visible over the wall from a standing eye. */
const ROAD = { z: LOT.wallZ + 16, halfW: 3.6 } as const;

export interface ExteriorResult {
  /** Materials whose envMap should be the lot probe (sky + facade). */
  envMaterials: THREE.Material[];
  sky: THREE.Mesh;
}

/**
 * Diffuse sky fill approximation from System 3 (emissive = albedo × k × 0.45), when nothing
 * lit the lot but the sun. System 4 replaced it: every exterior material samples the lot
 * probe (Diner.ts), a PMREM of the physical sky dome (Lighting.ts SKY_HORIZON_NITS), which IS
 * the diffuse skylight — ≈ 17 klux against 51.6 klux of direct sun, a 2 EV lit/shadow ratio.
 * Rev 2 of System 4 (2026-09) sets `SKY_FILL_SCALE` to 0: at k ≈ 0.2 the emissive was still
 * adding ≈ 900 nits × albedo to every exterior surface, lit or shaded — 14 % of the shade
 * side on the asphalt, a flat, unshadowable term that lifted every lot shadow and could not
 * be in a photograph. The hook is kept so the term can be A/B'd (`?skyfill=1` restores it).
 */
const SKY_FILL_SCALE = typeof location !== "undefined" && new URLSearchParams(location.search).has("skyfill") ? 0.45 : 0;
function skyFill(mat: THREE.MeshStandardMaterial, k: number): THREE.MeshStandardMaterial {
  k *= SKY_FILL_SCALE;
  if (k <= 0) return mat;
  // emissive = colour × k, through the map when there is one (colour × map is the albedo — rev 3:
  // the car paint's dust map is a near-white tint, so emissive had to carry the paint colour).
  mat.emissive.copy(mat.color).multiplyScalar(k);
  if (mat.map) mat.emissiveMap = mat.map;
  return mat;
}

/** Sky dome: horizon-white → pale desaturated blue, glare + 0.53° disc around the sun. */
function buildSky(sunDir: THREE.Vector3): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      sunDir: { value: sunDir.clone().normalize() },
      horizon: { value: new THREE.Color(0.9, 0.915, 0.93) },
      zenith: { value: new THREE.Color(0.34, 0.5, 0.8) },
      ground: { value: new THREE.Color(0.62, 0.6, 0.58) },
      sunColor: { value: new THREE.Color(1.0, 0.94, 0.84) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir, horizon, zenith, ground, sunColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        // Washed-out morning sky: the horizon band stays near white for the first ~12°.
        vec3 col = mix(horizon, zenith, pow(h, 0.55));
        // Brighter toward the sun's azimuth all the way down to the horizon (forward scatter)
        vec2 az = normalize(d.xz), sAz = normalize(sunDir.xz);
        float azc = clamp(dot(az, sAz), 0.0, 1.0);
        col = mix(col, vec3(0.985, 0.975, 0.955), pow(azc, 3.0) * (1.0 - h) * (1.0 - h) * 0.55);
        // Dust haze band sitting on the horizon: 0–2.5° above the horizon reads lighter and warmer
        col = mix(col, vec3(0.94, 0.93, 0.915), smoothstep(0.045, 0.0, h) * 0.6);
        float c = clamp(dot(d, sunDir), 0.0, 1.0);
        float glow = pow(c, 6.0) * 0.18 + pow(c, 40.0) * 0.45 + pow(c, 400.0) * 1.5;
        float disc = smoothstep(0.999975, 0.999992, c) * 40.0;
        col += sunColor * (glow + disc);
        if (d.y < 0.0) col = mix(horizon, ground, clamp(-d.y * 6.0, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(170, 48, 24), mat);
  sky.name = "sky";
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

/**
 * Far terrain (rev 4): three range layers at 118 / 150 / 188 m with a clear tonal step
 * between them — near broken hills in a dark warm grey, a taller mid range, a ghost far
 * range — each a ridged-noise profile (1 − |2n − 1| octaves give sharp peaks and saddles,
 * not the low-frequency humps of rev 3 that read as a cloud bank) sampled every 0.25°
 * so the crest is jagged at pixel scale. Vertex colours fade toward the haze with height
 * and distance; scene fog (45 → 260 m) dissolves the far layer further.
 */
function buildHorizon(parent: THREE.Group): void {
  const haze = new THREE.Color(0.86, 0.87, 0.89);
  // Foot of each range: alluvial fans, not a ruler line — the base wanders ±footAmp (m) with
  // low-frequency noise (the rev 4 bases were dead level where they met the flat).
  const footNoise = makeFbm(7104, 10, 2);
  const ring = (R: number, segs: number, rock: THREE.Color, baseFade: number, hMax: number, footAmp: number, name: string, profile: (a: number, u: number) => number) => {
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const tmp = new THREE.Color();
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2 - Math.PI;
      const u = i / segs;
      const x = Math.sin(a) * R, z = Math.cos(a) * R;
      const h = Math.max(0.3, profile(a, u));
      const fade = baseFade + 0.12 * (1 - Math.min(1, h / hMax));
      const foot = -0.35 + footAmp * (footNoise(u * 1.7 + R * 0.01, 0.4) - 0.5) * 2;
      pos.push(x, Math.min(foot, h - 0.65), z, x, h - 0.35, z);
      tmp.copy(rock).lerp(haze, Math.min(1, fade + 0.12)); // foot is hazier than the top
      col.push(tmp.r, tmp.g, tmp.b);
      tmp.copy(rock).lerp(haze, fade);
      col.push(tmp.r, tmp.g, tmp.b);
    }
    for (let i = 0; i < segs; i++) {
      const p = i * 2;
      idx.push(p, p + 2, p + 1, p + 2, p + 3, p + 1);
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
  // Ridged multi-octave noise: sharp crests where the value noise crosses ½.
  const ridged = (seed: number, cells: number, octaves: number) => {
    const layers: { n: (x: number, y: number) => number; c: number; a: number }[] = [];
    for (let o = 0, c = cells; o < octaves; o++, c *= 2) layers.push({ n: makeValueNoise(seed + o * 131, c), c, a: 1 / (o + 1) });
    return (u: number, v: number) => {
      let s = 0, t = 0;
      for (const l of layers) { s += l.a * (1 - Math.abs(2 * l.n(u * l.c, v * 7) - 1)); t += l.a; }
      return s / t;
    };
  };
  // Near: 2–8 m broken hills + the mesa left of centre (a in radians, 0 = +z, straight out the windows).
  const nearBase = makeFbm(7101, 24, 2), nearRidge = ridged(7111, 90, 3);
  ring(118, 1440, new THREE.Color(0.33, 0.29, 0.27), 0.22, 9, 0.7, "horizon", (a, u) => {
    const deg = THREE.MathUtils.radToDeg(a);
    const mesaL = deg > -62 && deg < -24 ? 1 : 0;
    const mesaEdge = mesaL ? Math.min(1, Math.min(deg + 62, -24 - deg) / 6) : 0;
    const mesa = 15 * Math.pow(mesaEdge, 0.6) + (mesaL ? 0.6 * nearRidge(u, 0.5) : 0);
    const hills = 1.5 + 4.5 * nearBase(u, 0.3) + 3.0 * Math.pow(nearRidge(u, 0.1), 1.6);
    return Math.max(mesa, hills);
  });
  // Mid: a taller range with serrated crest lines.
  const midBase = makeFbm(7102, 14, 2), midRidge = ridged(7122, 60, 3);
  ring(150, 1440, new THREE.Color(0.41, 0.38, 0.37), 0.44, 22, 1.2, "horizon-mid", (_a, u) => 5 + 11 * midBase(u * 1.0 + 0.2, 0.55) + 6 * Math.pow(midRidge(u, 0.2), 1.4));
  // Far: the tallest, a ghost in the haze.
  const farBase = makeFbm(7103, 9, 2), farRidge = ridged(7133, 40, 3);
  ring(188, 1200, new THREE.Color(0.5, 0.48, 0.49), 0.62, 34, 2.0, "horizon-far", (_a, u) => 10 + 16 * farBase(u * 1.3 + 0.7, 0.2) + 8 * Math.pow(farRidge(u, 0.3), 1.3));
}

/* ------------------------------------------------------------------------------------------
 * Vehicles (rev 3 loft, rev 4 detail). The body is lofted through real cross-sections
 * (rounded sills, a side bulge to the belt, tumblehome up to a radiused roof) with the wheel
 * arches cut into the lower edge. Rev 4 adds what the critics measured missing at ≤ 6 m:
 * real panel shut lines (3–4 mm grooves lofted into the body, dark floor/walls), a 6 cm cab-
 * to-bed gap and an open bed on the pickup (same mechanism, deeper), a cowl step under the
 * windshield with parked wiper arm + blade assemblies, cabin interiors behind thin dielectric
 * glass (premultiplied Fresnel alpha, so the dash, wheel and seats show under a sky
 * reflection), lathed tyres with tread grooves and a sidewall bulge inside flatter (sedan) /
 * squarer (pickup) arches, steel wheels with lip + lugs or a full cover with a hub ring and
 * brake-dust shading, and a corrected square-body front end (axle under the A-pillar, 28 %
 * overhang, full-width egg-crate grille between dual sealed beams in chrome bowls).
 * Car frame: nose at z = 0, tail at z = L, +x = the car's right when facing +z, y up from
 * the asphalt.
 * ---------------------------------------------------------------------------------------- */

/** One body cross-section at z (all in m). */
interface Station {
  z: number;
  /** Lower body edge (sill / valance; lifted over the wheel arches) and belt line. */
  yLo: number;
  /** Nominal sill height (the flank profile is anchored here, not at the arch-lifted yLo). */
  ySill: number;
  yBelt: number;
  /** Top of the body at this z (hood / roof / deck). */
  yTop: number;
  hwSill: number;
  hwBelt: number;
  /** Half width of the body at yTop (roof narrower than the belt = tumblehome). */
  hwTop: number;
  /** Radius of the top edge. */
  rTop: number;
  /** Hard shading break at this station (hood → windshield, roof → backlight …). */
  crease?: boolean;
  /** Inset faces at this station are painted body (open bed) rather than dark shut-line walls. */
  insetPaint?: boolean;
  /** This station's inset is the paint chamfer beside a shut line, not the dark gap itself. */
  bevel?: boolean;
  /** Inset faces are a wide, lit dark cavity (cab-to-bed gap) rather than an unlit shut line. */
  insetLit?: boolean;
  /** Shut line / gap / bed: moves ring point j (given its outward 2D normal) or leaves it (null). */
  inset?: (j: number, p: [number, number], n: [number, number]) => [number, number] | null;
}

/** A lofted groove between two z's; `span` picks which ring points drop. */
interface Groove {
  z0: number;
  z1: number;
  depth: number;
  span: "side" | "top" | "all" | "bed";
  /** Paint chamfer length (m) either side of the gap — rolled panel edges. */
  bevel?: number;
  /** Wide gap whose walls catch sky light (lit near-black) instead of the unlit shut-line black. */
  lit?: boolean;
}

interface CarSpec {
  length: number;
  hw: number;
  sillY: number;
  beltY: number;
  wheelR: number;
  /** Tyre section half width. */
  tyreHw: number;
  wheelZ: [number, number];
  /** Wheel-arch opening: Caprice arches are flat-topped and wide, C/K openings are rounded rectangles. */
  arch: "flat" | "square";
  /** Body top line as (z, yTop, hwTop, rTop, crease?) — the loft resamples between them. */
  top: Array<[number, number, number, number, boolean?]>;
  /** Side glass panes along the flank. */
  /** Side panes: belt-line z extent, with optional raked pillar edges at the roof (A-pillar z0Top, C-pillar z1Top). */
  sideGlass: Array<{ z0: number; z1: number; z0Top?: number; z1Top?: number }>;
  /** Door shut lines (z). The handle of each door sits ahead of its REAR cut. */
  doors: number[];
  grooves: Groove[];
  /** Longitudinal cut lines on the top surface (hood/fender, deck/quarter): x offset and z range. */
  topLines: Array<{ x: number; z0: number; z1: number }>;
  /** Windshield / backlight: z at the base, z at the top, y base, y top. */
  screens: Array<{ zb: number; zt: number; yb: number; yt: number }>;
  /** Headlamps: "round2" = two 5¾" sealed beams per side (square-body pickup), "rect2" = two rectangular per side (80s sedan). */
  lamps: "round2" | "rect2";
  lampY: number;
  grille: { y0: number; y1: number; hw: number };
  interior: {
    cabin: { z0: number; z1: number; y0: number; y1: number; hw: number };
    dash: { z0: number; z1: number; y: number; hw: number };
    wheel: { x: number; y: number; z: number; r: number };
    seats: Array<{ z: number; x0: number; x1: number; y0: number; y1: number; headrest?: boolean }>;
    shelf?: { z0: number; z1: number; y: number; hw: number };
  };
  paint: THREE.Material;
  grilleMat: THREE.Material;
  plateMat: THREE.Material;
  wheelFace: THREE.Material;
  wheelStyle: "steel" | "cover";
  /** Open bed with a tailgate between the bedsides (rear plate on the bumper, vertical tail lamps). */
  tailgate?: { xIn: number; y0: number; y1: number };
  /** Plan taper at the tail (m, default 0.04 — a pickup bed's sides run straight). */
  tailTaper?: number;
}

interface CarMats {
  glass: THREE.Material; lensGlass: THREE.Material; chrome: THREE.Material; tyre: THREE.Material; dark: THREE.Material;
  /** Unlit black for shut lines: a 7 mm gap 8 mm deep is a light trap, so no IBL/sun in it. */
  gap: THREE.Material;
  amber: THREE.Material; tail: THREE.Material; rubber: THREE.Material; shadow: THREE.Material;
  cabin: THREE.Material; seat: THREE.Material; trim: THREE.Material; liner: THREE.Material;
}

/** Geometry that is NOT merged through the builder: the blended glass panes get their own meshes. */
interface CarSink {
  panes: THREE.BufferGeometry[];
  lenses: THREE.BufferGeometry[];
}

/** Ring point classes (24-point ring, see stationRing). */
const RING_N = 24;
const RING_SIDE = new Set([0, 1, 2, 3, 4, 5, 6, 7, 17, 18, 19, 20, 21, 22, 23]);
const RING_TOP = new Set([9, 10, 11, 12, 13, 14, 15]);

/** Ring of 24 points around a station: bottom centre → right side up → top centre → left side down. */
function stationRing(s: Station): Array<[number, number]> {
  const R: Array<[number, number]> = [];
  const rS = 0.02;
  const yb = Math.max(s.yBelt, s.yLo + rS + 0.01);
  // Flank profile x(y), anchored at the NOMINAL sill and the belt, the same at every station:
  // a convex tuck (t^0.45: 70 % of the width at 45 % of the height). Over a wheel arch the
  // lower edge is lifted to yLo, but the points stay ON this profile — rev 4 put the bulge
  // point at 45 % of the *remaining* height, so the flank re-shaped itself around every arch
  // (a blister with creases). The arch edge is a constant 2 cm rolled lip.
  const flankX = (y: number) => s.hwSill + (s.hwBelt - s.hwSill) * Math.pow(THREE.MathUtils.clamp((y - s.ySill) / Math.max(0.05, yb - s.ySill), 0, 1), 0.45);
  const xLip = flankX(s.yLo + rS);
  R.push([xLip - rS, s.yLo]);
  for (let k = 1; k <= 2; k++) { const a = (k / 3) * Math.PI / 2; R.push([xLip - rS + Math.sin(a) * rS, s.yLo + rS - Math.cos(a) * rS]); }
  R.push([xLip, s.yLo + rS]);
  const yBulge = THREE.MathUtils.clamp(s.ySill + (s.yBelt - s.ySill) * 0.45, s.yLo + rS + 0.01, yb - 0.005);
  R.push([flankX(yBulge), yBulge]); // side bulge (fixed height; only lifted when an arch reaches it)
  R.push([s.hwBelt, yb]);
  const rT = Math.max(0.004, Math.min(s.rTop, (s.yTop - yb) * 0.9, s.hwTop * 0.5));
  R.push([s.hwTop, Math.max(yb + 0.001, s.yTop - rT)]); // tumblehome line ends here
  for (let k = 1; k <= 3; k++) { const a = (k / 4) * Math.PI / 2; R.push([s.hwTop - rT + Math.cos(a) * rT, s.yTop - rT + Math.sin(a) * rT]); }
  R.push([s.hwTop - rT, s.yTop]);
  const out: Array<[number, number]> = [[0, s.yLo], ...R, [0, s.yTop]];
  for (let i = R.length - 1; i >= 0; i--) out.push([-R[i][0], R[i][1]]);
  if (!s.inset) return out;
  // Outward 2D normals from the neighbours, then let the station move its points.
  const cy = (s.yLo + s.yTop) / 2;
  const moved = out.map((p, j) => {
    const a = out[(j + RING_N - 1) % RING_N], b = out[(j + 1) % RING_N];
    let nx = b[1] - a[1], ny = -(b[0] - a[0]);
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    if (nx * p[0] + ny * (p[1] - cy) < 0) { nx = -nx; ny = -ny; }
    return s.inset!(j, p, [nx, ny]) ?? p;
  });
  return moved;
}

/**
 * Loft the stations into one closed body: quads between consecutive rings, triangulated end
 * caps, analytic normals (ring tangent × length tangent; one-sided at creases so the hood →
 * windshield break stays sharp while the radii shade smoothly), UVs u = z/L, v = around.
 * Quads that touch an inset (moved) ring point are the groove walls / floors and go to the
 * second geometry (dark material) so a 3 mm shut line reads without shadow-map resolution.
 */
/**
 * Glass classification of loft quad (station i → i+1, ring segment j): `full` — the whole quad
 * is a pane (side glass on the tumblehome segment); `[wA, wB]` — the top-centre quad is split
 * at |x| = w (glass inboard, A-pillar/header paint outboard), w interpolated per station.
 */
type GlassSplit = { tA: number; tB: number; low: boolean };
type GlassOf = (i: number, j: number) => "full" | GlassSplit | null;

function loftBody(stations: Station[], L: number, glassOf: GlassOf = () => null): { body: THREE.BufferGeometry; grooves: THREE.BufferGeometry; cavity: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const rings = stations.map(stationRing);
  const plain = stations.map((s) => stationRing({ ...s, inset: undefined }));
  const movedBy = rings.map((r, i) => r.map((p, j) => Math.abs(p[0] - plain[i][j][0]) + Math.abs(p[1] - plain[i][j][1])));
  const moved = movedBy.map((r) => r.map((d) => d > 1e-9));
  const N = rings[0].length;
  const P = (i: number, j: number) => new THREE.Vector3(rings[i][(j + N) % N][0], rings[i][(j + N) % N][1], stations[i].z);
  type Sink = { pos: number[]; nor: number[]; uv: number[] };
  const out: { body: Sink; grooves: Sink; cavity: Sink; glass: Sink } = { body: { pos: [], nor: [], uv: [] }, grooves: { pos: [], nor: [], uv: [] }, cavity: { pos: [], nor: [], uv: [] }, glass: { pos: [], nor: [], uv: [] } };
  const normalAt = (i: number, j: number, dir: -1 | 0 | 1) => {
    const around = P(i, j + 1).sub(P(i, j - 1));
    // Length tangent. The flank points below the belt (lip top, bulge) take the BELT point's
    // tangent: their own column climbs the wheel-arch curve, and a tangent taken along it
    // tilts the flank's normals fore/aft around every arch (rev 4's soft blister). The lip
    // roll itself (j 1–3) keeps its own tangent — that hem really does turn around the arch.
    const jj = (j + N) % N;
    const jRef = jj >= 4 && jj <= 5 ? 6 : jj >= 19 && jj <= 20 ? 18 : jj;
    const back = dir <= 0 && i > 0 ? P(i - 1, jRef) : P(i, jRef);
    const fwd = dir >= 0 && i < stations.length - 1 ? P(i + 1, jRef) : P(i, jRef);
    const along = fwd.sub(back);
    if (along.lengthSq() < 1e-12) along.set(0, 0, 1);
    if (Math.abs(along.z) < 1e-7) {
      // Groove wall (two stations at one z): the face looks INTO the groove, i.e. toward the
      // deeper-inset station of the pair (chamfer → gap steps count too).
      const insetAhead = dir >= 0 ? (movedBy[i + 1]?.[jj] ?? 0) > movedBy[i][jj] : movedBy[i][jj] > (movedBy[i - 1]?.[jj] ?? 0);
      return new THREE.Vector3(0, 0, insetAhead ? 1 : -1);
    }
    const n = new THREE.Vector3().crossVectors(along, around).normalize();
    const c = new THREE.Vector3(0, (stations[i].yLo + stations[i].yTop) / 2, stations[i].z);
    if (n.dot(P(i, j).sub(c)) < 0) n.negate();
    return n;
  };
  /** Mean height of a station's inset (moved) ring points — the pocket floor; falls back to the neighbour. */
  const pocketFloorY = (i: number): number => {
    for (const k of [i, i + 1]) {
      let s = 0, n = 0;
      rings[k].forEach((p, j) => { if (moved[k][j]) { s += p[1]; n++; } });
      if (n) return s / n;
    }
    return stations[i].yTop;
  };
  const tri = (dst: { pos: number[]; nor: number[]; uv: number[] }, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, na: THREE.Vector3, nb: THREE.Vector3, nc: THREE.Vector3, ua: number[], ub: number[], uc: number[]) => {
    const fn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (fn.lengthSq() < 1e-16) return; // degenerate (coincident groove stations)
    const flip = fn.dot(na.clone().add(nb).add(nc)) < 0;
    const order = flip ? [[a, na, ua], [c, nc, uc], [b, nb, ub]] : [[a, na, ua], [b, nb, ub], [c, nc, uc]];
    for (const [p, n, t] of order as Array<[THREE.Vector3, THREE.Vector3, number[]]>) { dst.pos.push(p.x, p.y, p.z); dst.nor.push(n.x, n.y, n.z); dst.uv.push(t[0], t[1]); }
  };
  for (let i = 0; i < stations.length - 1; i++) {
    const nA: THREE.Vector3[] = [], nB: THREE.Vector3[] = [];
    for (let j = 0; j < N; j++) {
      nA.push(normalAt(i, j, stations[i].crease ? 1 : 0));
      nB.push(normalAt(i + 1, j, stations[i + 1].crease ? -1 : 0));
    }
    const uA = stations[i].z / L, uB = stations[i + 1].z / L;
    for (let j = 0; j < N; j++) {
      const j1 = (j + 1) % N;
      const a = P(i, j), b = P(i, j1), c = P(i + 1, j1), d = P(i + 1, j);
      const va = j / N, vb = (j + 1) / N;
      const groove = moved[i][j] || moved[i][j1] || moved[i + 1][j] || moved[i + 1][j1];
      // Dark gap only where a corner belongs to a full-depth inset station; chamfer-only quads stay paint.
      const deep = (k: number, jj: number) => moved[k][jj] && !stations[k].bevel;
      const gap = deep(i, j) || deep(i, j1) || deep(i + 1, j) || deep(i + 1, j1);
      const paintPocket = groove && (stations[i].insetPaint || stations[i + 1].insetPaint);
      if (paintPocket && stations[i + 1].z - stations[i].z > 1e-6) {
        // Open pocket in the skin (pickup bed): the radial "outward" test in normalAt points the
        // floor DOWN and the inner walls INTO the metal (they lie below / outside the station
        // centre), which culled them and showed the dark lining instead. Use a flat face normal
        // aimed at the cavity — 15 cm above the pocket floor on the centre line.
        const fc = a.clone().add(b).add(c).add(d).multiplyScalar(0.25);
        const fn = new THREE.Vector3().subVectors(c, a).cross(new THREE.Vector3().subVectors(d, b)).normalize();
        if (fn.lengthSq() < 0.5) continue; // fully degenerate (collapsed groove points)
        const cav = new THREE.Vector3(0, pocketFloorY(i) + 0.15, fc.z);
        if (fn.dot(cav.sub(fc)) < 0) fn.negate();
        tri(out.body, a, b, c, fn, fn, fn, [uA, va], [uA, vb], [uB, vb]);
        tri(out.body, a, c, d, fn, fn, fn, [uA, va], [uB, vb], [uB, va]);
        continue;
      }
      const glass = groove ? null : glassOf(i, j);
      const lit = groove && (stations[i].insetLit || stations[i + 1].insetLit);
      const dst = gap ? (paintPocket ? out.body : lit ? out.cavity : out.grooves) : glass === "full" ? out.glass : out.body;
      if (glass && glass !== "full") {
        // Split the quad by the line joining parameter tA on edge a→b (station i) to tB on edge
        // d→c (station i+1); the t-low side is glass when `low`, else the t-high side.
        const cut = (p: THREE.Vector3, q: THREE.Vector3, np: THREE.Vector3, nq: THREE.Vector3, t: number) => ({
          p: p.clone().lerp(q, t), n: np.clone().lerp(nq, t).normalize(), t,
        });
        const sA = cut(a, b, nA[j], nA[j1], THREE.MathUtils.clamp(glass.tA, 0, 1)), sB = cut(d, c, nB[j], nB[j1], THREE.MathUtils.clamp(glass.tB, 0, 1));
        const vA = va + (vb - va) * sA.t, vB = va + (vb - va) * sB.t;
        const lowDst = glass.low ? out.glass : out.body, highDst = glass.low ? out.body : out.glass;
        // low quad: a, sA, sB, d ; high quad: sA, b, c, sB
        tri(lowDst, a, sA.p, sB.p, nA[j], sA.n, sB.n, [uA, va], [uA, vA], [uB, vB]);
        tri(lowDst, a, sB.p, d, nA[j], sB.n, nB[j], [uA, va], [uB, vB], [uB, va]);
        tri(highDst, sA.p, b, c, sA.n, nA[j1], nB[j1], [uA, vA], [uA, vb], [uB, vb]);
        tri(highDst, sA.p, c, sB.p, sA.n, nB[j1], sB.n, [uA, vA], [uB, vb], [uB, vB]);
        continue;
      }
      tri(dst, a, b, c, nA[j], nA[j1], nB[j1], [uA, va], [uA, vb], [uB, vb]);
      tri(dst, a, c, d, nA[j], nB[j1], nB[j], [uA, va], [uB, vb], [uB, va]);
    }
  }
  // End caps
  for (const [i, nz] of [[0, -1], [stations.length - 1, 1]] as Array<[number, number]>) {
    const pts = rings[i].map(([x, y]) => new THREE.Vector2(x, y));
    const n = new THREE.Vector3(0, 0, nz);
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(pts, [])) {
      const u = stations[i].z / L;
      tri(out.body, P(i, a), P(i, b), P(i, c), n, n, n, [u, a / N], [u, b / N], [u, c / N]);
    }
  }
  const make = (o: { pos: number[]; nor: number[]; uv: number[] }) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(o.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(o.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(o.uv, 2));
    return g;
  };
  return { body: make(out.body), grooves: make(out.grooves), cavity: make(out.cavity), glass: make(out.glass) };
}

/** Rounded box (all edges radius r) via ExtrudeGeometry of a rounded rectangle. */
function roundedBox(w: number, h: number, d: number, r: number, segs = 2): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x0 = -w / 2 + r, x1 = w / 2 - r, y0 = -h / 2 + r, y1 = h / 2 - r;
  s.moveTo(x0, -h / 2); s.lineTo(x1, -h / 2); s.absarc(x1, y0, r, -Math.PI / 2, 0, false);
  s.lineTo(w / 2, y1); s.absarc(x1, y1, r, 0, Math.PI / 2, false);
  s.lineTo(x0, h / 2); s.absarc(x0, y1, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-w / 2, y0); s.absarc(x0, y0, r, Math.PI, Math.PI * 1.5, false);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.999, bevelSegments: segs, curveSegments: segs * 2 });
  g.translate(0, 0, -(d - 2 * r) / 2);
  g.computeVertexNormals();
  return g;
}

/** Turn a surface inside out (concave reflector bowls): reverse winding, negate normals. */
function flipFaces(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const p = ng.attributes.position as THREE.BufferAttribute;
  const n = ng.attributes.normal as THREE.BufferAttribute | undefined;
  for (let i = 0; i < p.count; i += 3) {
    const bx = p.getX(i + 1), by = p.getY(i + 1), bz = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, bx, by, bz);
    if (n) {
      const nx = n.getX(i + 1), ny = n.getY(i + 1), nz = n.getZ(i + 1);
      n.setXYZ(i + 1, n.getX(i + 2), n.getY(i + 2), n.getZ(i + 2));
      n.setXYZ(i + 2, nx, ny, nz);
    }
  }
  if (n) for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return ng;
}

/**
 * Surface of revolution with ANALYTIC normals: smooth around the axis, hard along the profile
 * wherever two segments meet at more than `smoothDeg` (a flange step, a slot lip), averaged
 * where they meet gently (a dome). three's LatheGeometry smooths every join, so a stepped
 * chrome dish gets normals that swing across each step and the reflection wobbles
 * ("turbulent" chrome on the rev 5 wheel covers). Same frame as LatheGeometry: profile
 * (r, h) revolves about +y, x = r·sin φ, z = r·cos φ; normal = (dh, −dr) in the profile plane,
 * so a profile authored outward/upward faces +r / +h. UV: u around, v along the profile.
 */
function lathe(profile: Array<[number, number]>, segs: number, smoothDeg = 40): THREE.BufferGeometry {
  const segN: Array<[number, number]> = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const dr = profile[i + 1][0] - profile[i][0], dh = profile[i + 1][1] - profile[i][1];
    const l = Math.hypot(dr, dh) || 1;
    segN.push([dh / l, -dr / l]);
  }
  const cosS = Math.cos(THREE.MathUtils.degToRad(smoothDeg));
  const avg = (a: [number, number], b: [number, number]): [number, number] => { const l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1; return [(a[0] + b[0]) / l, (a[1] + b[1]) / l]; };
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const total = profile.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - profile[i - 1][0], p[1] - profile[i - 1][1]) : 0), 0) || 1;
  let acc = 0;
  for (let i = 0; i < segN.length; i++) {
    const n = segN[i];
    const nA = i > 0 && segN[i - 1][0] * n[0] + segN[i - 1][1] * n[1] > cosS ? avg(segN[i - 1], n) : n;
    const nB = i < segN.length - 1 && segN[i + 1][0] * n[0] + segN[i + 1][1] * n[1] > cosS ? avg(n, segN[i + 1]) : n;
    const [r0, h0] = profile[i], [r1, h1] = profile[i + 1];
    const v0 = acc / total; acc += Math.hypot(r1 - r0, h1 - h0); const v1 = acc / total;
    if (Math.hypot(r1 - r0, h1 - h0) < 1e-9) continue;
    for (let j = 0; j < segs; j++) {
      const p0 = (j / segs) * Math.PI * 2, p1 = ((j + 1) / segs) * Math.PI * 2;
      const P = (r: number, h: number, ph: number) => [r * Math.sin(ph), h, r * Math.cos(ph)];
      const Nn = (nn: [number, number], ph: number) => [nn[0] * Math.sin(ph), nn[1], nn[0] * Math.cos(ph)];
      const a = P(r0, h0, p0), b = P(r0, h0, p1), c = P(r1, h1, p1), d = P(r1, h1, p0);
      const na = Nn(nA, p0), nb = Nn(nA, p1), nc = Nn(nB, p1), nd = Nn(nB, p0);
      // Winding to agree with the analytic normal
      const e1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], e2 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const fx = e1[1] * e2[2] - e1[2] * e2[1], fy = e1[2] * e2[0] - e1[0] * e2[2], fz = e1[0] * e2[1] - e1[1] * e2[0];
      const ref = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
      const flip = fx * ref[0] + fy * ref[1] + fz * ref[2] > 0; // (c−a)×(b−a) is MINUS the (a,b,c) face normal
      const tris = flip ? [[a, na, j / segs, v0], [c, nc, (j + 1) / segs, v1], [b, nb, (j + 1) / segs, v0], [a, na, j / segs, v0], [d, nd, j / segs, v1], [c, nc, (j + 1) / segs, v1]]
        : [[a, na, j / segs, v0], [b, nb, (j + 1) / segs, v0], [c, nc, (j + 1) / segs, v1], [a, na, j / segs, v0], [c, nc, (j + 1) / segs, v1], [d, nd, j / segs, v1]];
      for (const [p, nn, u, v] of tris as Array<[number[], number[], number, number]>) { pos.push(p[0], p[1], p[2]); nor.push(nn[0], nn[1], nn[2]); uv.push(u, v); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Vertex colour attribute from a per-vertex function of (radius, height) in the lathe's frame. */
function latheColors(g: THREE.BufferGeometry, f: (r: number, h: number) => number, tint: [number, number, number] = [1, 1, 1]): void {
  const p = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = f(Math.hypot(p.getX(i), p.getZ(i)), p.getY(i));
    col[i * 3] = k * tint[0]; col[i * 3 + 1] = k * tint[1]; col[i * 3 + 2] = k * tint[2];
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

/**
 * Thin dielectric pane without a transmission pass. The material stays in the OPAQUE list
 * (transparent: false) so it is drawn into three's transmission buffer — the diner's window
 * and door glass see it — but blends premultiplied: gl_FragColor = (reflection, α) with
 * α = α₀ + (1 − α₀)·F(θ) (Schlick, F₀ 0.04), source ONE / dest ONE_MINUS_SRC_ALPHA, so the
 * result is reflection + (1 − α)·(whatever was drawn behind: the cabin interior, the far
 * pane, the sky beyond). renderOrder 5 puts it after every other opaque; depthWrite off so
 * both panes of a cabin composite. Seen from inside the cabin (back face) the reflection is
 * cut to 12 % — the inner face mirrors the dark cabin, not the probe's sky.
 */
export function makePaneGlass(alpha0: number, envInt: number): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x000000, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: envInt, specularIntensity: 1,
    side: THREE.DoubleSide, transparent: false, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uAlpha0 = { value: alpha0 };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uAlpha0;")
      .replace(
        "#include <opaque_fragment>",
        [
          "float paneNdV = saturate( dot( normal, geometryViewDir ) );",
          "float paneF = 0.04 + 0.96 * pow( 1.0 - paneNdV, 5.0 );",
          "float paneA = uAlpha0 + ( 1.0 - uAlpha0 ) * paneF;",
          "vec3 paneLight = gl_FrontFacing ? outgoingLight : outgoingLight * 0.12;",
          "gl_FragColor = vec4( paneLight, paneA );",
        ].join("\n"),
      );
  };
  m.customProgramCacheKey = () => "pane-glass";
  return m;
}

function buildCar(b: MergedBuilder, parent: THREE.Object3D, spec: CarSpec, mats: CarMats, sink: CarSink, at: THREE.Vector3, yaw: number): void {
  const M = new THREE.Matrix4().makeRotationY(yaw).setPosition(at);
  // Casting is decided per material by MergedBuilder (material.userData.noCast): the body, tyres
  // and glass cast, every trim / interior material is flagged.
  const place = (g: THREE.BufferGeometry, mat: THREE.Material) => {
    b.add(g, mat, M);
  };
  const box = (mat: THREE.Material, min: [number, number, number], max: [number, number, number]) => {
    const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    place(g, mat);
  };
  const rbox = (mat: THREE.Material, min: [number, number, number], max: [number, number, number], r: number, segs = 2) => {
    const g = roundedBox(max[0] - min[0], max[1] - min[1], max[2] - min[2], r, segs);
    g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    place(g, mat);
  };
  const sink2 = (list: THREE.BufferGeometry[], g: THREE.BufferGeometry) => { g.applyMatrix4(M); list.push(g); };
  const { hw, length: L, wheelR: R, beltY, sillY } = spec;
  // Arch opening as a superellipse about the axle: |d/w|^p + |(y−R)/h|^p = 1.
  // Both are continuous curves: rev 5's p = 4 "square" opening dropped its legs almost
  // vertically over the last 5 cm, which read as a flap with the black well behind it.
  const arch = spec.arch === "square" ? { w: R + 0.09, h: R + 0.06, p: 2.6 } : { w: R + 0.1, h: R + 0.025, p: 2.6 };

  /* ---- body loft ---- */
  const topAt = (z: number): [number, number, number, boolean] => {
    const t = spec.top;
    if (z <= t[0][0]) return [t[0][1], t[0][2], t[0][3], false];
    for (let i = 0; i < t.length - 1; i++) {
      const [z0, y0, w0, r0] = t[i], [z1, y1, w1, r1] = t[i + 1];
      if (z >= z0 && z <= z1) {
        const k = z1 > z0 ? (z - z0) / (z1 - z0) : 0;
        return [y0 + (y1 - y0) * k, w0 + (w1 - w0) * k, r0 + (r1 - r0) * k, false];
      }
    }
    const e = t[t.length - 1];
    return [e[1], e[2], e[3], false];
  };
  const lowAt = (z: number): number => {
    let y = sillY;
    for (const wz of spec.wheelZ) {
      const d = Math.abs(z - wz);
      if (d < arch.w) y = Math.max(y, R + arch.h * Math.pow(1 - Math.pow(d / arch.w, arch.p), 1 / arch.p));
    }
    if (z < 0.35) y = Math.max(y, 0.36); // valance under the bumper
    return y;
  };
  // Screens lie on the body's top line between two crease stations: derive their z extent from
  // the requested y extent so the glass edge sits exactly on a loft station.
  const screens = spec.screens.map((sc0) => {
    const yA = topAt(sc0.zb)[0], yB = topAt(sc0.zt)[0];
    const zAt = (y: number) => sc0.zb + ((sc0.zt - sc0.zb) * (y - yA)) / (yB - yA);
    return { ...sc0, zb: zAt(sc0.yb), zt: zAt(sc0.yt) };
  });
  const inGroove = (z: number) => spec.grooves.some((g) => z > g.z0 - (g.bevel ?? 0) - 1e-9 && z < g.z1 + (g.bevel ?? 0) + 1e-9);
  const zs = new Set<number>();
  for (const [z] of spec.top) zs.add(z);
  for (const gl of spec.sideGlass) { zs.add(gl.z0); zs.add(gl.z1); if (gl.z0Top) zs.add(gl.z0Top); if (gl.z1Top) zs.add(gl.z1Top); }
  for (const sc of screens) { zs.add(sc.zb); zs.add(sc.zt); }
  for (const wz of spec.wheelZ) for (let k = -16; k <= 16; k++) zs.add(THREE.MathUtils.clamp(wz + (k / 16) * arch.w, 0, L)); // 33 stations per arch (rev 5's 21 faceted the legs)
  for (let z = 0; z <= L; z += 0.25) zs.add(Math.min(L, z));
  zs.add(0); zs.add(L);
  const creaseZ = new Set(spec.top.filter((t) => t[4]).map((t) => t[0]));
  type Entry = { z: number; k: number; groove?: Groove; bevel?: boolean; mid?: boolean };
  // Stations inside a shut line are dropped (the gap is its own two stations); stations inside
  // the open bed are KEPT and carry the bed inset — rev 5 dropped them too, so the bedside
  // between the pocket's two end stations was one straight quad and the rear wheel arch (all
  // of whose stations lie inside the bed's z span) vanished: a dead-straight lower edge with
  // the tyre poking out beneath it.
  const bedAt = (z: number) => spec.grooves.find((g) => g.span === "bed" && z > g.z0 + 1e-9 && z < g.z1 - 1e-9);
  const entries: Entry[] = [...zs].filter((z) => !inGroove(z) || bedAt(z)).map((z) => { const bg = bedAt(z); return bg ? { z, k: 1, groove: bg, mid: true } : { z, k: 1 }; });
  for (const g of spec.grooves) {
    if (g.bevel) {
      // Shut line with rolled panel edges: a paint chamfer (`bevel` stations, 2.5 mm deep over
      // `bevel` m) either side of the dark gap. The two chamfers face opposite ways along z, so
      // one catches the light and the other shadows — a highlight/dark pair flanking the gap,
      // which is how a real cut line reads on a dark car (rev 4's bare 6 mm groove did not).
      const ch: Groove = { ...g, depth: 0.0025, bevel: undefined };
      entries.push({ z: g.z0 - g.bevel, k: 0 }, { z: g.z0, k: 0, groove: ch, bevel: true }, { z: g.z0, k: 1, groove: g }, { z: g.z1, k: 1, groove: g }, { z: g.z1, k: 2, groove: ch, bevel: true }, { z: g.z1 + g.bevel, k: 2 });
    } else entries.push({ z: g.z0, k: 0 }, { z: g.z0, k: 1, groove: g }, { z: g.z1, k: 1, groove: g }, { z: g.z1, k: 2 });
  }
  entries.sort((p, q) => p.z - q.z || p.k - q.k);
  // Two grooves meeting at one z (bed pocket → tailgate top): the wall runs straight from the
  // one inset to the other — drop the plain stations there, or a zero-thickness fin folds in.
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.groove) continue;
    const same = entries.filter((o) => Math.abs(o.z - e.z) < 1e-9 && o.groove && o.k === 1);
    if (same.length >= 2) entries.splice(i, 1);
  }
  const insetFor = (g: Groove, st: Station): Station["inset"] => (j, p, n) => {
    if (g.span === "bed") {
      if (!RING_TOP.has(j)) return null;
      const xr = Math.max(0.02, st.hwTop - 0.07);
      return [THREE.MathUtils.clamp(p[0], -xr, xr), st.yTop - g.depth];
    }
    const ok = g.span === "all" || (g.span === "side" ? RING_SIDE.has(j) : RING_TOP.has(j));
    return ok ? [p[0] - n[0] * g.depth, p[1] - n[1] * g.depth] : null;
  };
  const stations: Station[] = entries.map((e) => {
    const z = e.z;
    const [yTop, hwTop, rTop] = topAt(z);
    // Plan taper: the body narrows 40 mm over the last 0.6 m at each end
    const hwB = hw - 0.04 * (1 - Math.min(1, z / 0.6)) - (spec.tailTaper ?? 0.04) * (1 - Math.min(1, (L - z) / 0.6));
    const yLo = lowAt(z);
    // Belt ring never above the top ring: over the hood/deck (lower than the belt line) it becomes
    // the fender shoulder 3 cm under the panel edge, otherwise the ring folds outward over the
    // hood and its underside shows as a 4–9 cm black lip along the far hood edge.
    const st: Station = { z, yLo, ySill: sillY, yBelt: Math.min(yTop - 0.03, Math.max(beltY, yLo + 0.05)), yTop, hwSill: hwB - 0.035, hwBelt: hwB, hwTop: Math.min(hwTop, hwB - 0.012), rTop, crease: creaseZ.has(z) || e.k !== 1 || (!!e.groove && !e.mid) };
    if (e.groove) { st.inset = insetFor(e.groove, st); st.insetPaint = e.groove.span === "bed"; st.insetLit = e.groove.lit; st.bevel = e.bevel; }
    return st;
  });
  // Glass IS the loft skin (not a proud pane over paint): the tumblehome segment over a side
  // pane's z span, and the top-centre quads inboard of the A-pillars over a screen's span.
  const eps = 1e-6;
  const glassOf: GlassOf = (i, j) => {
    const zA = stations[i].z, zB = stations[i + 1].z;
    if (zB - zA < eps) return null;
    if (j === 6 || j === 17) {
      // Side pane: full between the raked pillar edges; split diagonally along the A-pillar
      // (z0 at the belt → z0Top at the roof) and C-pillar (z1 → z1Top) rakes. Ring segment 6
      // runs belt → roof (t up); 17 runs roof → belt, so mirror the parameter.
      for (const g of spec.sideGlass) {
        const zf = g.z0Top ?? g.z0, zr = g.z1Top ?? g.z1;
        const lo = Math.min(g.z0, zf), hi = Math.max(g.z1, zr);
        if (zA < lo - eps || zB > hi + eps) continue;
        let s: GlassSplit | "full" = "full";
        if (zB <= Math.max(g.z0, zf) + eps && zf !== g.z0) {
          const tOf = (z: number) => (z - g.z0) / (zf - g.z0); // glass for t < tOf (z ahead of the edge line)
          s = { tA: tOf(zA), tB: tOf(zB), low: true };
        } else if (zA >= Math.min(g.z1, zr) - eps && zr !== g.z1) {
          const tOf = (z: number) => (z - g.z1) / (zr - g.z1);
          s = { tA: tOf(zA), tB: tOf(zB), low: true };
        }
        if (s !== "full" && j === 17) s = { tA: 1 - s.tA, tB: 1 - s.tB, low: false };
        return s;
      }
      return null;
    }
    if (j !== 11 && j !== 12) return null;
    for (const sc of screens) {
      const lo = Math.min(sc.zb, sc.zt), hi = Math.max(sc.zb, sc.zt);
      if (zA < lo - eps || zB > hi + eps) continue;
      // Split at |x| = w(z): segment 11 runs from x = +flat (t 0) to 0 (t 1) — glass is t high;
      // segment 12 runs 0 → −flat — glass is t low.
      const tAt = (k: number) => {
        const st = stations[k];
        const f = hi > lo ? (st.z - sc.zb) / (sc.zt - sc.zb) : 0; // 0 at the base, 1 at the roof
        const wBase = st.hwBelt - 0.07, wRoof = st.hwTop - 0.06; // pillar widths at each end
        const flat = st.hwTop - Math.max(0.004, Math.min(st.rTop, (st.yTop - st.yBelt) * 0.9, st.hwTop * 0.5)); // ±x of ring point 11
        const w = Math.min(wBase + (wRoof - wBase) * f, flat - 0.004);
        const tIn = (flat - w) / flat; // parameter from the outboard end
        return j === 11 ? tIn : 1 - tIn;
      };
      return { tA: tAt(i), tB: tAt(i + 1), low: j === 12 };
    }
    return null;
  };
  const loft = loftBody(stations, L, glassOf);
  // Cabin lining: the same shell inside out in dark matte, so the eye never passes through the
  // culled back of the paint skin to the sky/asphalt; the glass cut-outs are its only openings.
  // (Clone BEFORE place(): MergedBuilder.add transforms the geometry it is given in place.)
  const lining = flipFaces(loft.body.clone());
  place(loft.body, spec.paint);
  place(lining, mats.cabin);
  place(loft.grooves, mats.gap);
  place(loft.cavity, mats.dark); // cab-to-bed gap: lit near-black, so it reads as a slot with walls, not black tape
  sink2(sink.panes, loft.glass);
  // Longitudinal cut lines (hood ↔ fender, deck ↔ quarter): 9 mm dark strips 2.5 mm over the top skin
  for (const ln of spec.topLines)
    for (const sx of [-1, 1]) {
      const pos: number[] = [], nor: number[] = [], uvs: number[] = [], idx: number[] = [];
      const n = Math.max(2, Math.round((ln.z1 - ln.z0) / 0.08));
      for (let i = 0; i <= n; i++) {
        const z = ln.z0 + ((ln.z1 - ln.z0) * i) / n;
        const y = topAt(z)[0] + 0.0025;
        pos.push(sx * ln.x - 0.0045, y, z, sx * ln.x + 0.0045, y, z); // 9 mm: ≥ 2 px at 4–5 m (6 mm AA'd to a grey 1-px line, step 28)
        nor.push(0, 1, 0, 0, 1, 0);
        uvs.push(0, i / n, 1, i / n);
        if (i < n) { const p = i * 2; idx.push(p, p + 2, p + 1, p + 2, p + 3, p + 1); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      place(g, mats.gap);
    }

  /* ---- glass gaskets and bright mouldings (rev 7) ---- */
  // Every pane sits in a black rubber gasket with a bright moulding outside it (rev 6's glass
  // butted straight into the paint). A gasket is four strips along the edges of a trapezoid in
  // the pane's plane: local X across, Y up the glass, Z the outward normal; the rubber straddles
  // the glass edge (12 mm each side, 4 mm proud), the chrome lies outside it, 1 mm prouder.
  const gasket = (O: THREE.Vector3, X: THREE.Vector3, Y: THREE.Vector3, Z: THREE.Vector3, xa: [number, number], xb: [number, number], l: number, opt: { beltW?: number; topChrome?: boolean; topDrop?: number } = {}) => {
    const basis = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(O);
    const gk = 0.024, yt = l - (opt.topDrop ?? 0);
    const c: Array<[number, number]> = [[xa[0], 0], [xa[1], 0], [xb[1], yt], [xb[0], yt]]; // CCW
    for (let e = 0; e < 4; e++) {
      const p = c[e], q = c[(e + 1) % 4];
      const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
      const th = Math.atan2(-dx, dy); // rotate +Y onto the edge direction
      const nx = dy / len, ny = -dx / len; // outward edge normal
      const strip = (w: number, t: number, off: number, mat: THREE.Material) => {
        const g = new THREE.BoxGeometry(w, len + w * 0.8, t);
        g.rotateZ(th);
        g.translate((p[0] + q[0]) / 2 + nx * off, (p[1] + q[1]) / 2 + ny * off, t / 2);
        g.applyMatrix4(basis);
        place(g, mat);
      };
      strip(gk, 0.004, 0, mats.rubber);
      if (e === 2 && opt.topChrome === false) continue;
      const cw = e === 0 && opt.beltW ? opt.beltW : 0.007;
      strip(cw, 0.005, gk / 2 + cw / 2 - 0.002, mats.chrome);
    }
  };
  for (const sc of screens) {
    const dz = sc.zt - sc.zb, dy = sc.yt - sc.yb, l = Math.hypot(dz, dy), sg = Math.sign(dz);
    const up = new THREE.Vector3(0, dy / l, dz / l);
    const nrm = new THREE.Vector3(0, sg * dz / l, -sg * dy / l); // outward: up and away from the cabin
    const X = new THREE.Vector3(-sg, 0, 0); // X × up = nrm for both screens (right-handed, so the boxes are not inside out)
    const wAt = (z: number, f: number) => {
      const st = stations.reduce((p, s) => (Math.abs(s.z - z) < Math.abs(p.z - z) ? s : p));
      const flat = st.hwTop - Math.max(0.004, Math.min(st.rTop, (st.yTop - st.yBelt) * 0.9, st.hwTop * 0.5));
      return Math.min(st.hwBelt - 0.07 + (st.hwTop - 0.06 - (st.hwBelt - 0.07)) * f, flat - 0.004);
    };
    const wB = wAt(sc.zb, 0), wT = wAt(sc.zt, 1);
    gasket(new THREE.Vector3(0, sc.yb, sc.zb), X, up, nrm, [-wB, wB], [-wT, wT], l);
  }
  for (const sx of [-1, 1])
    for (const g of spec.sideGlass) {
      const st = stations.reduce((p, s) => (Math.abs(s.z - (g.z0 + g.z1) / 2) < Math.abs(p.z - (g.z0 + g.z1) / 2) ? s : p));
      const yb = Math.max(st.yBelt, st.yLo + 0.03);
      const rT = Math.max(0.004, Math.min(st.rTop, (st.yTop - yb) * 0.9, st.hwTop * 0.5));
      const dxu = st.hwTop - st.hwBelt, dyu = st.yTop - rT - yb, hgt = Math.hypot(dxu, dyu);
      const Y = new THREE.Vector3(sx * dxu / hgt, dyu / hgt, 0);
      const X = new THREE.Vector3(0, 0, -sx);
      const Z = new THREE.Vector3().crossVectors(X, Y).normalize();
      const lx = (z: number) => -sx * z;
      const xa = [lx(g.z0), lx(g.z1)].sort((a, b) => a - b) as [number, number];
      const xb = [lx(g.z0Top ?? g.z0), lx(g.z1Top ?? g.z1)].sort((a, b) => a - b) as [number, number];
      // Top strip dropped under the drip rail (which is the bright moulding there); the belt
      // moulding is the wide bright strip along the bottom edge.
      gasket(new THREE.Vector3(sx * st.hwBelt, yb, 0), X, Y, Z, xa, xb, hgt, { beltW: 0.012, topChrome: false, topDrop: 0.014 });
    }

  /* ---- wipers ---- */
  for (const sc of screens) {
    const dz = sc.zt - sc.zb, dy = sc.yt - sc.yb, l = Math.hypot(dz, dy);
    // Front screen only: arm + blade assemblies parked along the cowl, pivots in the cowl
    // channel behind the hood's trailing edge, 12° rake, blades pointing to the passenger side.
    if (dz > 0) {
      const up = new THREE.Vector3(0, dy / l, dz / l); // up the glass
      const nrm = new THREE.Vector3(0, dz / l, -dy / l); // glass normal (outward)
      const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), nrm, up);
      // Steep glass (the pickup's 63° screen over a shallow cowl): the wipers park ON the glass
      // just above its base, near-horizontal, the assembly hugging the pane — rev 4 used the
      // sedan's deep-cowl standoffs there and the arms floated 3 cm off the glass at 12°.
      const steep = dy / dz > 1.2;
      const rake = THREE.MathUtils.degToRad(steep ? 5 : 12);
      // Rev 6: the sedan's arms sit 35 mm below the glass base (was 60: the hood's trailing edge
      // hid the pivots and most of the arm, leaving 1 px bars).
      const drop = steep ? -0.005 : -0.035, hArm = steep ? 0.014 : 0.03, hBlade = steep ? 0.008 : 0.017, hRub = steep ? 0.003 : 0.01;
      for (const [xp, len] of [[0.34, 0.44], [-0.24, 0.42]] as Array<[number, number]>) {
        // Root below the glass base in the (extended) glass plane: down in the cowl channel,
        // so the hood's trailing edge hides the post and the lower part of the blade.
        const root = new THREE.Vector3(xp, sc.yb, sc.zb).addScaledVector(up, drop);
        const T2 = new THREE.Matrix4().copy(basis).setPosition(root);
        const part = (g: THREE.BufferGeometry, mat: THREE.Material) => { g.rotateY(rake); g.applyMatrix4(T2); place(g, mat); };
        // Pivot post, standing out of the cowl to the arm plane (local y = glass normal)
        const post = new THREE.CylinderGeometry(0.006, 0.006, steep ? 0.05 : 0.06, 10);
        post.translate(0, steep ? -0.01 : 0.008, 0);
        part(post, mats.dark);
        const nut = new THREE.CylinderGeometry(0.009, 0.009, 0.006, 10);
        nut.translate(0, hArm + 0.007, 0);
        part(nut, mats.dark);
        // Arm: from the pivot toward −x (passenger side), thinner than the blade, with a hinge block
        const arm = new THREE.BoxGeometry(len, 0.005, steep ? 0.007 : 0.009);
        arm.translate(-len / 2 + 0.02, hArm, 0);
        part(arm, mats.dark);
        const hinge = new THREE.BoxGeometry(0.04, 0.012, 0.014);
        hinge.translate(-0.01, hArm, 0);
        part(hinge, mats.dark);
        // Blade: superstructure + rubber lying on the glass, slightly ahead of the arm end
        const blade = new THREE.BoxGeometry(0.46, 0.006, 0.014);
        blade.translate(-len + 0.06, hBlade, 0.012);
        part(blade, mats.dark);
        const rub = new THREE.BoxGeometry(0.46, 0.008, 0.004);
        rub.translate(-len + 0.06, hRub, 0.012);
        part(rub, mats.rubber);
        const clip = new THREE.BoxGeometry(0.03, 0.01, 0.012);
        clip.translate(-len + 0.02, (hArm + hBlade) / 2, 0.008);
        part(clip, mats.dark);
      }
    }
  }

  /* ---- cabin interior (behind the panes) ---- */
  {
    const I = spec.interior;
    // Floor: a slab at the cabin's floor height so the footwells read as carpet, not the sill loft
    box(mats.cabin, [-I.cabin.hw, I.cabin.y0 - 0.02, I.cabin.z0], [I.cabin.hw, I.cabin.y0, I.cabin.z1]);
    // Dash: a padded top under the windshield with a lip, instrument binnacle on the driver's side
    rbox(mats.trim, [-I.dash.hw, I.dash.y - 0.1, I.dash.z0], [I.dash.hw, I.dash.y, I.dash.z1], 0.012);
    rbox(mats.trim, [I.wheel.x - 0.2, I.dash.y, I.dash.z1 - 0.2], [I.wheel.x + 0.2, I.dash.y + 0.07, I.dash.z1 - 0.02], 0.01);
    // Steering wheel + column (LHD: driver at +x in this frame)
    const tilt = THREE.MathUtils.degToRad(28);
    const wheel = new THREE.TorusGeometry(I.wheel.r, 0.017, 8, 36);
    wheel.rotateX(-tilt);
    wheel.translate(I.wheel.x, I.wheel.y, I.wheel.z);
    place(wheel, mats.rubber);
    for (const a of [0, 2.1, -2.1]) {
      const spoke = new THREE.BoxGeometry(0.022, I.wheel.r - 0.03, 0.012);
      spoke.translate(0, (I.wheel.r - 0.03) / 2 + 0.03, 0);
      spoke.rotateZ(a);
      spoke.rotateX(-tilt);
      spoke.translate(I.wheel.x, I.wheel.y, I.wheel.z);
      place(spoke, mats.rubber);
    }
    const hub = new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16);
    hub.rotateX(Math.PI / 2 - tilt);
    hub.translate(I.wheel.x, I.wheel.y, I.wheel.z);
    place(hub, mats.rubber);
    const colLen = 0.34;
    const column = new THREE.CylinderGeometry(0.02, 0.026, colLen, 12);
    column.rotateX(Math.PI / 2 - tilt);
    const u = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt)); // wheel normal (up + back)
    column.translate(I.wheel.x - u.x * colLen / 2, I.wheel.y - u.y * colLen / 2, I.wheel.z - u.z * colLen / 2);
    place(column, mats.trim);
    // Seats: backs with a rolled top, headrests on posts (sedan), bench (pickup)
    for (const s of I.seats) {
      rbox(mats.seat, [s.x0, s.y0, s.z], [s.x1, s.y1, s.z + 0.12], 0.03);
      rbox(mats.seat, [s.x0, s.y0 - 0.04, s.z - 0.45], [s.x1, s.y0 + 0.04, s.z + 0.08], 0.03); // cushion
      if (s.headrest) {
        const xc = (s.x0 + s.x1) / 2;
        rbox(mats.seat, [xc - 0.14, s.y1 + 0.05, s.z + 0.01], [xc + 0.14, s.y1 + 0.17, s.z + 0.11], 0.025);
        for (const dx of [-0.06, 0.06]) box(mats.trim, [xc + dx - 0.006, s.y1 - 0.01, s.z + 0.05], [xc + dx + 0.006, s.y1 + 0.06, s.z + 0.062]);
      }
    }
    if (I.shelf) rbox(mats.trim, [-I.shelf.hw, I.shelf.y - 0.02, I.shelf.z0], [I.shelf.hw, I.shelf.y, I.shelf.z1], 0.008);
  }

  /* ---- wheels ---- */
  const hwT = spec.tyreHw;
  const tyreProfile: Array<[number, number]> = [
    [0.19, -(hwT - 0.012)], [0.235, -hwT], [R - 0.055, -(hwT - 0.004)], [R - 0.02, -(hwT - 0.014)], [R - 0.006, -(hwT - 0.024)], [R, -(hwT - 0.034)],
    [R, -0.046], [R - 0.007, -0.043], [R - 0.007, -0.039], [R, -0.036],
    [R, -0.006], [R - 0.007, -0.003], [R - 0.007, 0.003], [R, 0.006],
    [R, 0.036], [R - 0.007, 0.039], [R - 0.007, 0.043], [R, 0.046],
    [R, hwT - 0.034], [R - 0.006, hwT - 0.024], [R - 0.02, hwT - 0.014], [R - 0.055, hwT - 0.004], [0.235, hwT], [0.19, hwT - 0.012],
  ];
  const tyreTone = (r: number, h: number) => {
    const side = Math.abs(h) > hwT - 0.03 || r < R - 0.02; // sidewall
    const shoulder = THREE.MathUtils.clamp((r - (R - 0.06)) / 0.05, 0, 1);
    return side ? 0.72 + 0.1 * shoulder : 1.08; // tread carries a little road dust
  };
  /** Pin every UV to one texel of the tyre map (sidewall band) so the rib / lettering take the plain rubber tone. */
  const sidewallUV = (g: THREE.BufferGeometry) => { const t = g.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < t.count; i++) t.setXY(i, 0.5, 0.05); return g; };
  /** Around-the-axle placement in the car frame: local x = along the axle (sx side), y radial, z tangential → rotated by a. */
  const onWheel = (g: THREE.BufferGeometry, xc: number, wz: number, a: number, rad: number, xOff: number) => {
    g.rotateX(a);
    g.translate(xc + xOff, R + Math.cos(a) * rad, wz + Math.sin(a) * rad);
    return g;
  };
  for (const wz of spec.wheelZ)
    for (const sx of [-1, 1]) {
      const xc = sx * (hw - 0.035 - hwT - (spec.arch === "flat" ? 0.025 : 0.0)); // tyre centre: outer sidewall inside the flank
      // Tyre: analytic-normal lathe, v = across the section so the tread texture's block band
      // lands on the tread; the bottom 35 mm squashed into a contact patch (sidewalls bulge
      // 8 mm, tread flattens on the asphalt).
      const tyre = lathe(tyreProfile, 96, 50);
      {
        const p = tyre.attributes.position as THREE.BufferAttribute, t = tyre.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) t.setY(i, (p.getY(i) + hwT) / (2 * hwT));
      }
      latheColors(tyre, tyreTone);
      tyre.rotateZ(sx > 0 ? -Math.PI / 2 : Math.PI / 2); // axis → x, +h outboard
      tyre.translate(xc, R, wz);
      {
        const p = tyre.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          const y = p.getY(i);
          if (y < 0.035) {
            const k = (0.035 - Math.max(y, 0.007)) / 0.028; // 0 at the patch edge → 1 at the ground
            p.setY(i, Math.max(y, 0.007));
            const dx = p.getX(i) - xc;
            if (Math.abs(dx) > hwT - 0.03) p.setX(i, p.getX(i) + Math.sign(dx) * 0.008 * k);
            p.setZ(i, p.getZ(i) + Math.sign(p.getZ(i) - wz) * 0.01 * k);
          }
        }
      }
      place(tyre, mats.tyre);
      // Sidewall dress: a raised decorative rib and two arcs of raised lettering (1 mm proud,
      // a shade paler — the mould's polished band), outer sidewall only.
      {
        const rib = sidewallUV(new THREE.TorusGeometry(0.268, 0.0025, 6, 72));
        latheColors(rib, () => 0.8);
        rib.rotateY(Math.PI / 2);
        rib.translate(xc + sx * (hwT - 0.003), R, wz);
        place(rib, mats.tyre);
        for (const a0 of [0.6, 3.74])
          for (let k = 0; k < 9; k++) {
            const a = a0 + (k - 4) * 0.042;
            const glyph = sidewallUV(new THREE.BoxGeometry(0.0026, 0.011, k % 3 === 1 ? 0.005 : 0.007));
            latheColors(glyph, () => 0.86);
            place(onWheel(glyph, xc, wz, a, 0.3, sx * (hwT - 0.0065)), mats.tyre);
          }
      }
      // Valve stem through the wheel face near the bead (rubber body, chrome cap)
      {
        const aV = sx > 0 ? 3.9 : 2.4;
        const faceH = spec.wheelStyle === "steel" ? 0.05 : hwT - 0.03;
        const stem = new THREE.CylinderGeometry(0.0035, 0.0045, 0.034, 8);
        stem.rotateZ(Math.PI / 2);
        place(onWheel(stem, xc, wz, aV, 0.158, sx * (faceH + 0.012)), mats.rubber);
        const capV = new THREE.CylinderGeometry(0.005, 0.005, 0.008, 8);
        capV.rotateZ(Math.PI / 2);
        place(onWheel(capV, xc, wz, aV, 0.158, sx * (faceH + 0.032)), mats.chrome);
      }
      const dust = (r: number) => (r > 0.1 ? 1 - 0.25 * Math.min(1, (r - 0.1) / 0.085) : 1); // brake dust toward the rim
      if (spec.wheelStyle === "steel") {
        // Painted steel wheel: barrel → rolled lip → dished spider face 60 mm inside the sidewall
        const face = lathe([[0.19, hwT - 0.014], [0.19, 0.06], [0.181, 0.046], [0.166, 0.036], [0.15, 0.031], [0.14, 0.03], [0.07, 0.03], [0.062, 0.036], [0.045, 0.04], [0, 0.04]], 48);
        latheColors(face, (r) => dust(r));
        face.rotateZ(sx > 0 ? -Math.PI / 2 : Math.PI / 2);
        face.translate(xc, R, wz);
        place(face, spec.wheelFace);
        // Five lug nuts on a 116 mm circle, small chrome centre cap
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + 0.3;
          const nut = new THREE.CylinderGeometry(0.011, 0.011, 0.016, 6);
          nut.rotateZ(Math.PI / 2);
          nut.translate(xc + sx * 0.038, R + Math.cos(a) * 0.058, wz + Math.sin(a) * 0.058);
          place(nut, mats.chrome);
        }
        const cap = lathe([[0.042, 0.03], [0.044, 0.045], [0.036, 0.058], [0.015, 0.066], [0, 0.067]], 32);
        cap.rotateZ(sx > 0 ? -Math.PI / 2 : Math.PI / 2);
        cap.translate(xc, R, wz);
        place(cap, mats.chrome);
      } else {
        // Full chrome wheel cover (rev 6): dark bead gap against the tyre, a rolled trim ring,
        // flat dish 30 mm inside the sidewall with eight cooling slots, raised hub ring and a
        // domed centre with a small amber badge (rev 5's dark emblem read as a pit). Profile
        // authored outer → inner so the analytic normals face +r / +h (see lathe()).
        const H = hwT;
        const bead = lathe([[0.198, H - 0.033], [0.184, H - 0.033]], 48);
        bead.rotateZ(sx > 0 ? -Math.PI / 2 : Math.PI / 2);
        bead.translate(xc, R, wz);
        place(bead, mats.rubber);
        const cover = lathe(
          [
            [0.19, H - 0.034], [0.182, H - 0.016], [0.176, H - 0.006], [0.168, H - 0.008], [0.16, H - 0.024], // trim ring
            // Dish: concave (14 mm deeper at the hub ring), so its upper half tilts to the sky and
            // the lower half to the ground — a FLAT chrome dish is a horizontal mirror that shows
            // whatever is at wheel height across the lot: near black.
            [0.1, H - 0.038],
            [0.096, H - 0.024], [0.066, H - 0.02], [0.062, H - 0.034], [0.036, H - 0.034], // hub ring, step down
            [0.036, H - 0.026], [0.032, H - 0.014], [0.022, H - 0.006], [0.011, H - 0.001], [0, H], // dome
          ],
          48,
          40,
        );
        latheColors(cover, (r) => dust(r));
        cover.rotateZ(sx > 0 ? -Math.PI / 2 : Math.PI / 2);
        cover.translate(xc, R, wz);
        place(cover, spec.wheelFace);
        for (let k = 0; k < 8; k++) {
          const slot = new THREE.BoxGeometry(0.0012, 0.009, 0.026);
          place(onWheel(slot, xc, wz, (k / 8) * Math.PI * 2 + 0.2, 0.128, sx * (H - 0.0305)), mats.dark);
        }
        const badge = new THREE.CylinderGeometry(0.007, 0.007, 0.002, 12);
        badge.rotateZ(Math.PI / 2);
        badge.translate(xc + sx * H, R, wz);
        place(badge, mats.amber);
      }
      // Brake drum / dark well behind the wheel face
      const drum = new THREE.CylinderGeometry(0.17, 0.17, 0.12, 16);
      drum.rotateZ(Math.PI / 2);
      drum.translate(xc - sx * 0.04, R, wz);
      place(drum, mats.dark);
      // Wheel-well: a curved dark tub following the arch opening 1.5 cm inside the lip (the
      // strip the eye sees over the tyre) plus the flat inner wall behind the tyre.
      {
        const xIn = sx * (hw - 0.29), xOut = sx * (hw - 0.05);
        const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
        const n = 28;
        // Profile: down the front end to below the sill, over the arch (0.96 scale), down the back
        const prof: Array<[number, number]> = [[-arch.w * 0.96, sillY - 0.03]];
        for (let k = 0; k <= n; k++) {
          const th = Math.PI * (k / n);
          const c = Math.cos(th), s = Math.sin(th);
          const d = arch.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / arch.p), y = R + arch.h * Math.pow(Math.max(0, s), 2 / arch.p);
          prof.push([-d * 0.96, Math.max(0.12, R + (y - R) * 0.96 - 0.004)]);
        }
        prof.push([arch.w * 0.96, sillY - 0.03]);
        prof.forEach(([dd, yy], k) => {
          const ny = -(yy - R), nz = -dd; // toward the axle
          const l = Math.hypot(ny, nz) || 1;
          pos.push(xIn, yy, wz + dd, xOut, yy, wz + dd);
          nor.push(0, ny / l, nz / l, 0, ny / l, nz / l);
          uv.push(0, k / (prof.length - 1), 1, k / (prof.length - 1));
          if (k < prof.length - 1) { const p = k * 2; idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        const tub = g.toNonIndexed();
        // Winding: make every triangle agree with its inward normal
        const p = tub.attributes.position as THREE.BufferAttribute, nn = tub.attributes.normal as THREE.BufferAttribute;
        const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), fn = new THREE.Vector3(), vn = new THREE.Vector3();
        for (let i = 0; i < p.count; i += 3) {
          A.fromBufferAttribute(p, i); B.fromBufferAttribute(p, i + 1); C.fromBufferAttribute(p, i + 2);
          fn.subVectors(B, A).cross(C.clone().sub(A));
          vn.fromBufferAttribute(nn, i);
          if (fn.dot(vn) < 0) { p.setXYZ(i + 1, C.x, C.y, C.z); p.setXYZ(i + 2, B.x, B.y, B.z); }
        }
        place(tub, mats.liner);
        // Rev 7: the tub is clipped at the rocker line (rev 6's wall ran to 6 cm and hung
        // 10–15 px below the sill as a black curtain) and lit as a dusty liner; the see-through
        // the deep wall was blocking is closed instead by an underbody mass (frame rail, tank)
        // 45 cm inboard, where a real car has one.
        box(mats.liner, [Math.min(0, xIn), sillY - 0.012, wz - arch.w], [Math.max(0, xIn), R + arch.h - 0.01, wz + arch.w]);
        box(mats.dark, [Math.min(0, sx * (hw - 0.45)), 0.14, wz - arch.w - 0.02], [Math.max(0, sx * (hw - 0.45)), sillY + 0.02, wz + arch.w + 0.02]);
      }
    }
  // Underbody mass between the wheels (frame, tank, exhaust — one dark block)
  box(mats.dark, [-hw + 0.25, sillY - 0.14, spec.wheelZ[0] + arch.w], [hw - 0.25, sillY + 0.02, spec.wheelZ[1] - arch.w]);
  box(mats.dark, [-hw + 0.25, 0.26, 0.12], [hw - 0.25, 0.37, spec.wheelZ[0] - arch.w]);
  box(mats.dark, [-hw + 0.25, 0.26, spec.wheelZ[1] + arch.w], [hw - 0.25, 0.37, L - 0.12]);

  /* ---- fuel filler door (rev 7) ---- */
  // A 150 mm door reading as a 2–3 mm recess: a 6 mm lit-dark reveal ring around a panel 1.5 mm
  // proud, the reveal's top band unlit black (the shadow under the upper lip), a shadow line
  // along the panel's own lower edge
  // — rev 6 drew it as four 3 mm black lines and it was a 1-px outline in the 4 m frames.
  const fuelDoor = (xo: number, fy: number, fz: number) => {
    const s = Math.sign(xo), h = 0.075, r = 0.006;
    const xr = (d: number) => [Math.min(xo, xo + s * d), Math.max(xo, xo + s * d)] as [number, number];
    let [x0, x1] = xr(0.0006);
    box(mats.dark, [x0, fy - h, fz - h], [x1, fy + h, fz - h + r]);
    box(mats.dark, [x0, fy - h, fz + h - r], [x1, fy + h, fz + h]);
    box(mats.dark, [x0, fy - h, fz - h], [x1, fy - h + r, fz + h]);
    box(mats.gap, [x0, fy + h - r, fz - h], [x1, fy + h, fz + h]);
    [x0, x1] = xr(0.0015);
    box(spec.paint, [x0, fy - h + r, fz - h + r], [x1, fy + h - r, fz + h - r]);
    [x0, x1] = xr(0.0018);
    box(mats.dark, [x0, fy - h + r, fz - h + r], [x1, fy - h + r + 0.0015, fz + h - r]); // panel's own lower edge, in its shadow
  };

  /* ---- bumpers, valance lamps, plates ---- */
  const bw = hw * 2 + 0.06;
  // Bumpers and their returns at 6 bevel segments: the 2-segment default showed as five flat
  // facets around the wrap in the 1 m frames.
  rbox(mats.chrome, [-bw / 2, 0.45, -0.13], [bw / 2, 0.58, 0.01], 0.03, 6);
  rbox(mats.chrome, [-bw / 2, 0.45, L - 0.01], [bw / 2, 0.58, L + 0.13], 0.03, 6);
  for (const sx of [-1, 1]) { // rubber bumper guards, a mirrored pair flanking the plate
    rbox(mats.rubber, [sx * 0.3 - 0.035, 0.44, -0.16], [sx * 0.3 + 0.035, 0.59, -0.1], 0.012);
    rbox(mats.rubber, [sx * 0.3 - 0.035, 0.44, L + 0.1], [sx * 0.3 + 0.035, 0.59, L + 0.16], 0.012);
    // Bumper end returns: the bar wraps the corner onto the flank (the plan taper leaves the
    // body 4 cm inside the bar's end at the nose — rev 4 showed that as a dark recess).
    const xo = sx * (bw / 2), xi = sx * (hw - 0.05);
    rbox(mats.chrome, [Math.min(xo, xi), 0.45, -0.1], [Math.max(xo, xi), 0.58, 0.34], 0.03, 6);
    rbox(mats.chrome, [Math.min(xo, xi), 0.45, L - 0.34], [Math.max(xo, xi), 0.58, L + 0.1], 0.03, 6);
    // Sedan: amber turn signals in the valance under the bumper ends
    if (spec.lamps === "rect2") rbox(mats.amber, [sx * 0.72 - 0.11, 0.375, -0.03], [sx * 0.72 + 0.11, 0.435, 0.0], 0.008);
  }
  box(spec.plateMat, [-0.1525, 0.455, -0.14], [0.1525, 0.575, -0.13]); // front plate on the bumper
  if (spec.tailgate) {
    // Square-body tail: a separate tailgate slab between the bedsides. The loft already steps
    // the gate's top 15 mm under the bedside caps; here the two vertical gaps, the hinge line
    // along the bottom, the recessed centre handle, vertical lamp units on the bedside rear
    // corners, and the plate on the step bumper.
    const tg = spec.tailgate;
    const zF = L + 0.0015; // proud of the end cap
    for (const sx of [-1, 1]) {
      const xg = sx * tg.xIn;
      box(mats.gap, [xg - 0.004, tg.y0 - 0.02, L - 0.01], [xg + 0.004, tg.y1 + 0.005, zF]); // gap
      // Vertical lamp unit, flush in the bedside corner (rev 5's stood 20 mm proud and showed as
      // blocks from the side): a 3 mm chrome bezel with a dark reveal inside it for depth, the
      // lens 1 mm behind the bezel face, horizontal rib lines across the lens, a pale reverse
      // segment low down.
      const xl = sx * (hw - 0.055);
      box(mats.chrome, [xl - 0.055, tg.y0 + 0.02, L], [xl + 0.055, tg.y1 - 0.04, L + 0.002]);
      box(mats.dark, [xl - 0.047, tg.y0 + 0.028, L + 0.0015], [xl + 0.047, tg.y1 - 0.048, L + 0.0025]); // reveal
      box(mats.tail, [xl - 0.043, tg.y0 + 0.11, L + 0.002], [xl + 0.043, tg.y1 - 0.052, L + 0.0035]);
      box(mats.chrome, [xl - 0.043, tg.y0 + 0.032, L + 0.002], [xl + 0.043, tg.y0 + 0.1, L + 0.0035]); // reverse lens (reads as pale)
      box(mats.dark, [xl - 0.043, tg.y0 + 0.1, L + 0.002], [xl + 0.043, tg.y0 + 0.11, L + 0.0036]); // divider
      for (let y = tg.y0 + 0.125; y < tg.y1 - 0.06; y += 0.014) box(mats.dark, [xl - 0.043, y, L + 0.0034], [xl + 0.043, y + 0.0015, L + 0.0038]); // lens ribs
      // Rev 7: the unit wraps the bedside corner — a 40 mm side lens in its own bezel on the flank
      {
        const st = stations[stations.length - 1];
        const xo = sx * (st.hwBelt + 0.0005), xs = (d: number) => [Math.min(xo, xo + sx * d), Math.max(xo, xo + sx * d)] as [number, number];
        let [x0, x1] = xs(0.002);
        box(mats.chrome, [x0, tg.y0 + 0.02, L - 0.048], [x1, tg.y1 - 0.04, L]);
        [x0, x1] = xs(0.0035);
        box(mats.tail, [x0, tg.y0 + 0.11, L - 0.043], [x1, tg.y1 - 0.052, L - 0.003]);
        [x0, x1] = xs(0.0032);
        box(mats.chrome, [x0, tg.y0 + 0.032, L - 0.043], [x1, tg.y0 + 0.1, L - 0.003]);
        for (let y = tg.y0 + 0.125; y < tg.y1 - 0.06; y += 0.014) box(mats.dark, [xs(0.0038)[0], y, L - 0.043], [xs(0.0038)[1], y + 0.0015, L - 0.003]);
      }
    }
    // Tailgate (rev 7): a stamped horizontal band recessed across the gate under the handle —
    // an unlit shadow line under its upper lip, a lit lower lip 2 mm proud (rev 6's proud panel
    // read as a sticker).
    {
      const yb0 = tg.y0 + 0.11, yb1 = tg.y1 - 0.24, xw = tg.xIn - 0.07;
      box(mats.gap, [-xw, yb1 - 0.003, L - 0.004], [xw, yb1, zF + 0.0005]);
      box(mats.dark, [-xw, yb1 - 0.009, L - 0.004], [xw, yb1 - 0.003, zF + 0.0003]);
      box(spec.paint, [-xw, yb0, L - 0.004], [xw, yb0 + 0.007, zF + 0.002]);
      box(mats.gap, [-xw - 0.004, yb0, L - 0.004], [-xw, yb1, zF + 0.0005]);
      box(mats.gap, [xw, yb0, L - 0.004], [xw + 0.004, yb1, zF + 0.0005]);
    }
    fuelDoor(-(hw - 0.001), 0.86, 3.3); // on the left bedside behind the cab
    box(mats.gap, [-tg.xIn, tg.y0 - 0.004, L - 0.01], [tg.xIn, tg.y0 + 0.004, zF]); // hinge / latch line
    // Centre handle: recessed dark pocket with a chrome pull bar
    box(mats.dark, [-0.13, tg.y1 - 0.2, L - 0.015], [0.13, tg.y1 - 0.11, zF]);
    box(mats.chrome, [-0.11, tg.y1 - 0.175, L - 0.012], [0.11, tg.y1 - 0.135, L + 0.004]);
    // Plate on the step bumper
    box(spec.plateMat, [-0.1525, 0.455, L + 0.13], [0.1525, 0.575, L + 0.14]);
  } else {
    // Rear plate on the tail face, centred above the bumper
    const st = stations[stations.length - 1];
    const yP = Math.min(st.yTop - 0.12, 0.72);
    box(spec.plateMat, [-0.1525, yP - 0.076, L + 0.001], [0.1525, yP + 0.076, L + 0.012]);
    // Tail lamps: wide red lenses in a 3 mm chrome bezel with a dark reveal (depth), the lens
    // 1 mm inside the bezel face, horizontal rib lines, amber segment inboard.
    for (const sx of [-1, 1]) {
      const xc = sx * (hw - 0.3);
      box(mats.chrome, [xc - 0.24, yP - 0.085, L], [xc + 0.24, yP + 0.085, L + 0.002]);
      box(mats.dark, [xc - 0.232, yP - 0.077, L + 0.0015], [xc + 0.232, yP + 0.077, L + 0.0025]); // reveal
      box(mats.tail, [xc - 0.226, yP - 0.071, L + 0.002], [xc + 0.226, yP + 0.071, L + 0.0035]);
      box(mats.amber, [xc - sx * 0.05 - 0.05, yP - 0.062, L + 0.002], [xc - sx * 0.05 + 0.05, yP + 0.062, L + 0.0036]);
      for (let y = yP - 0.06; y < yP + 0.065; y += 0.014) box(mats.dark, [xc - 0.226, y, L + 0.0035], [xc + 0.226, y + 0.0015, L + 0.0039]); // lens ribs
    }
    // Trunk lock cylinder above the plate, and the fuel filler door on the left rear quarter
    {
      const lock = new THREE.CylinderGeometry(0.014, 0.014, 0.006, 16);
      lock.rotateX(Math.PI / 2);
      lock.translate(0, yP + 0.13, L + 0.003);
      place(lock, mats.chrome);
      box(mats.dark, [-0.002, yP + 0.122, L + 0.005], [0.002, yP + 0.138, L + 0.007]);
      const fz = 4.35;
      fuelDoor(-(hw - 0.04 * (1 - Math.min(1, (L - fz) / 0.6)) - 0.001), beltY - 0.14, fz);
    }
  }

  /* ---- front fascia: grille, sealed beams, signals ---- */
  const g = spec.grille;
  const hwNose = hw - 0.05;
  {
    const q = new THREE.PlaneGeometry(g.hw * 2, g.y1 - g.y0);
    q.rotateY(Math.PI); // face −z
    q.translate(0, (g.y0 + g.y1) / 2, -0.012);
    place(q, spec.grilleMat);
    // Chrome surround: full fascia width, framing grille and lamp bays together
    box(mats.chrome, [-hwNose, g.y1, -0.02], [hwNose, g.y1 + 0.02, 0.0]);
    box(mats.chrome, [-hwNose, g.y0 - 0.02, -0.02], [hwNose, g.y0, 0.0]);
    for (const sx of [-1, 1]) box(mats.chrome, [Math.min(sx * hwNose, sx * (hwNose - 0.02)), g.y0 - 0.02, -0.02], [Math.max(sx * hwNose, sx * (hwNose - 0.02)), g.y1 + 0.02, 0.0]);
  }
  for (const sx of [-1, 1]) {
    const bayHalf = (hwNose - 0.02 - g.hw) / 2 - 0.004;
    const xc = sx * (g.hw + 0.004 + bayHalf); // centre of the lamp bay
    const yc = spec.lampY;
    const bayH = spec.lamps === "round2" ? 0.115 : 0.1;
    // Dark bay behind a proud chrome frame (the sealed beams sit recessed inside it)
    box(mats.dark, [xc - bayHalf, yc - bayH, -0.006], [xc + bayHalf, yc + bayH, 0.01]);
    const fr = 0.013;
    box(mats.chrome, [xc - bayHalf, yc + bayH - fr, -0.028], [xc + bayHalf, yc + bayH, -0.005]);
    box(mats.chrome, [xc - bayHalf, yc - bayH, -0.028], [xc + bayHalf, yc - bayH + fr, -0.005]);
    box(mats.chrome, [xc - bayHalf, yc - bayH, -0.028], [xc - bayHalf + fr, yc + bayH, -0.005]);
    box(mats.chrome, [xc + bayHalf - fr, yc - bayH, -0.028], [xc + bayHalf, yc + bayH, -0.005]);
    if (spec.lamps === "round2") {
      // Rev 7: ONE 7" sealed beam per side in a square chrome bezel at the outer end of the
      // bay (1973–80 C10 Custom Deluxe / Scottsdale), the egg-crate continuing inboard of the
      // bezel over an amber parking lamp. Rev 6 put two 5¾" lamps 160 mm apart in a 320 mm bay
      // and they overlapped into a pair of vertical ovals — a layout no truck ever had.
      const bz = 0.098, bf = 0.012; // bezel half size, bezel face width
      const xk = xc + sx * (bayHalf - fr - bz - 0.006);
      box(mats.chrome, [xk - bz, yc + bz - bf, -0.032], [xk + bz, yc + bz, -0.006]);
      box(mats.chrome, [xk - bz, yc - bz, -0.032], [xk + bz, yc - bz + bf, -0.006]);
      box(mats.chrome, [xk - bz, yc - bz, -0.032], [xk - bz + bf, yc + bz, -0.006]);
      box(mats.chrome, [xk + bz - bf, yc - bz, -0.032], [xk + bz, yc + bz, -0.006]);
      // Concave chrome reflector bowl, rim at the bezel's inner face
      const rl = 0.089;
      const bowl = flipFaces(new THREE.SphereGeometry(rl, 28, 8, 0, Math.PI * 2, 0, 1.0));
      bowl.rotateX(Math.PI / 2); // cap points +z (into the bay)
      bowl.translate(xk, yc, -0.024 - rl * Math.cos(1.0));
      place(bowl, mats.chrome);
      const ring = new THREE.TorusGeometry(rl + 0.001, 0.006, 6, 28);
      ring.translate(xk, yc, -0.026);
      place(ring, mats.chrome);
      // Fluted glass: shallow dome with five vertical prism ribs let into it (ends flush)
      const lens = new THREE.SphereGeometry(rl - 0.002, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      lens.scale(1, 0.3, 1);
      lens.rotateX(-Math.PI / 2); // dome faces −z
      lens.translate(xk, yc, -0.024);
      sink2(sink.lenses, lens);
      for (const rx of [-0.058, -0.029, 0, 0.029, 0.058]) {
        const chord = Math.sqrt((rl - 0.002) ** 2 - rx * rx);
        const rib = new THREE.CylinderGeometry(0.0025, 0.0025, chord * 0.66 * 2, 6);
        rib.translate(xk + rx, yc, -0.024 - 0.3 * chord * 0.75);
        sink2(sink.lenses, rib);
      }
      // Inboard of the bezel: egg-crate above, amber parking lamp below
      const xi0 = xc - sx * (bayHalf - fr), xi1 = xk - sx * (bz + 0.004);
      const gw = Math.abs(xi1 - xi0), gx = (xi0 + xi1) / 2;
      const q = new THREE.PlaneGeometry(gw, bayH - 0.02);
      q.rotateY(Math.PI);
      q.translate(gx, yc + bayH / 2 + 0.002, -0.01);
      place(q, spec.grilleMat);
      rbox(mats.amber, [gx - gw / 2 + 0.006, yc - bayH + fr + 0.006, -0.02], [gx + gw / 2 - 0.006, yc - 0.006, -0.008], 0.006);
    } else {
      box(mats.chrome, [xc - 0.006, yc - bayH, -0.026], [xc + 0.006, yc + bayH, -0.005]); // divider
      for (const k of [-1, 1]) {
        const xk = xc + k * 0.088;
        // Flat chrome reflector at the back of the bay, fluted rectangular lens recessed in the frame
        box(mats.chrome, [xk - 0.078, yc - 0.07, -0.007], [xk + 0.078, yc + 0.07, -0.004]);
        const lens = new THREE.PlaneGeometry(0.16, 0.15);
        lens.rotateY(Math.PI);
        lens.translate(xk, yc, -0.024);
        sink2(sink.lenses, lens);
        for (let i = -2; i <= 2; i++) {
          const rib = new THREE.CylinderGeometry(0.0025, 0.0025, 0.146, 6);
          rib.translate(xk + i * 0.03, yc, -0.0255);
          sink2(sink.lenses, rib);
        }
      }
    }
  }

  /* ---- flank hardware ---- */
  for (const sx of [-1, 1]) {
    const flankX = (y: number, z: number) => {
      const st = stations.find((s) => s.z >= z) ?? stations[0];
      if (y <= st.yBelt) {
        const k = THREE.MathUtils.clamp((y - st.yLo) / (st.yBelt - st.yLo), 0, 1);
        return st.hwSill + (st.hwBelt - st.hwSill) * Math.min(1, k / 0.6);
      }
      const k = THREE.MathUtils.clamp((y - st.yBelt) / Math.max(0.01, st.yTop - st.rTop - st.yBelt), 0, 1);
      return st.hwBelt + (st.hwTop - st.hwBelt) * k;
    };
    // Door handles: one chrome pull per door, on the door just ahead of its REAR shut line
    for (const dz of spec.doors.slice(1)) {
      const xo = flankX(beltY - 0.1, dz - 0.14);
      rbox(mats.chrome, [Math.min(sx * xo, sx * (xo + 0.02)), beltY - 0.115, dz - 0.22], [Math.max(sx * xo, sx * (xo + 0.02)), beltY - 0.085, dz - 0.06], 0.006);
      box(mats.dark, [Math.min(sx * (xo - 0.002), sx * (xo + 0.004)), beltY - 0.108, dz - 0.21], [Math.max(sx * (xo - 0.002), sx * (xo + 0.004)), beltY - 0.092, dz - 0.07]); // finger recess
    }
    // Body side moulding: black rubber strip with a chrome insert, 6 mm proud, wheel arch to wheel arch
    {
      const y = beltY - 0.28, xo = flankX(y, L / 2);
      const z0 = spec.wheelZ[0] + arch.w + 0.02, z1 = spec.wheelZ[1] - arch.w - 0.02;
      box(mats.rubber, [Math.min(sx * (xo - 0.02), sx * (xo + 0.007)), y - 0.025, z0], [Math.max(sx * (xo - 0.02), sx * (xo + 0.007)), y + 0.025, z1]);
      box(mats.chrome, [Math.min(sx * (xo + 0.007), sx * (xo + 0.009)), y - 0.006, z0], [Math.max(sx * (xo + 0.007), sx * (xo + 0.009)), y + 0.006, z1]);
    }
    // Drip rail (rev 7): a 14 mm flat chrome strip 5 mm proud, following the roof edge station
    // by station from the windshield header to the backlight header — the roof's plan footprint.
    // Rev 6 ran one straight box over the side-glass span ± 8–10 cm, which put 30 cm of rail in
    // mid-air ahead of the A-pillar top (the roof only starts at the header) and it read as a
    // 4-px hairline against the sky in every side frame.
    {
      const zA = Math.max(screens[0].zb, screens[0].zt), zC = Math.min(screens[1].zb, screens[1].zt);
      const edge = (st: Station): [number, number] => [st.hwTop + 0.001, st.yTop - Math.max(0.004, Math.min(st.rTop, (st.yTop - st.yBelt) * 0.9, st.hwTop * 0.5)) + 0.002];
      const run = stations.filter((s, i, a) => s.z >= zA - 1e-6 && s.z <= zC + 1e-6 && (i === 0 || a[i - 1].z !== s.z) && !s.inset);
      for (let i = 0; i + 1 < run.length; i++) {
        const [xa, ya] = edge(run[i]), [xb2, yb2] = edge(run[i + 1]);
        const a = new THREE.Vector3(sx * xa, ya, run[i].z), c = new THREE.Vector3(sx * xb2, yb2, run[i + 1].z);
        const d = c.clone().sub(a), len = d.length() + 0.004;
        const seg = new THREE.BoxGeometry(0.009, 0.014, len);
        seg.translate(sx * 0.0005, 0, 0);
        seg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize()));
        seg.translate((a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2);
        place(seg, mats.chrome);
      }
    }
    // Door mirror (rev 7): a 150 × 100 × 45 mm shell on a 13 mm chrome tube arm on an L-bracket
    // — the bracket's foot on the door skin below the belt, its upright along the skin, the tube
    // leaving the top of the upright outward and up to the shell (rev 6's 10 mm tapered stalk
    // from a flat pad read as a wire).
    {
      const z = spec.sideGlass[0].z0 + 0.07, yB = beltY + 0.02, yH = beltY + 0.17;
      const xb = flankX(yB, z);
      rbox(mats.chrome, [Math.min(sx * xb, sx * (xb + 0.01)), yB - 0.035, z - 0.03], [Math.max(sx * xb, sx * (xb + 0.01)), yB + 0.035, z + 0.03], 0.003, 2); // foot
      rbox(mats.chrome, [Math.min(sx * xb, sx * (xb + 0.03)), yB + 0.02, z - 0.012], [Math.max(sx * xb, sx * (xb + 0.03)), yB + 0.035, z + 0.012], 0.003, 2); // L upright
      const xh = xb + 0.075;
      const x0 = xb + 0.022, y0 = yB + 0.03;
      const arm = new THREE.CylinderGeometry(0.0065, 0.0065, Math.hypot(xh - x0, yH - y0) + 0.012, 12);
      arm.rotateZ(sx > 0 ? -Math.atan2(xh - x0, yH - y0) : Math.atan2(xh - x0, yH - y0));
      arm.translate(sx * (x0 + xh) / 2, (y0 + yH) / 2, z);
      place(arm, mats.chrome);
      const knuckle = new THREE.SphereGeometry(0.011, 12, 8);
      knuckle.translate(sx * xh, yH - 0.045, z);
      place(knuckle, mats.chrome);
      rbox(spec.paint, [Math.min(sx * (xh - 0.02), sx * (xh + 0.025)), yH - 0.05, z - 0.075], [Math.max(sx * (xh - 0.02), sx * (xh + 0.025)), yH + 0.05, z + 0.075], 0.014, 3);
      box(mats.chrome, [Math.min(sx * (xh - 0.014), sx * (xh + 0.019)), yH - 0.042, z + 0.075], [Math.max(sx * (xh - 0.014), sx * (xh + 0.019)), yH + 0.042, z + 0.079]);
    }
    // Rocker panel: dark strip along the sill (mud + shadow)
    {
      const z0 = spec.wheelZ[0] + arch.w, z1 = spec.wheelZ[1] - arch.w;
      const st = stations.find((s) => s.z >= L / 2) ?? stations[0];
      const xo = st.hwSill;
      box(mats.rubber, [Math.min(sx * (xo - 0.01), sx * (xo + 0.002)), sillY + 0.005, z0], [Math.max(sx * (xo - 0.01), sx * (xo + 0.002)), sillY + 0.07, z1]);
    }
  }

  // Contact shadow decal: its own mesh so it never casts
  const decal = new THREE.PlaneGeometry(hw * 2 + 0.5, L + 0.5);
  decal.rotateX(-Math.PI / 2);
  decal.translate(0, 0.004, L / 2);
  decal.applyMatrix4(M);
  const dm = new THREE.Mesh(decal, mats.shadow);
  dm.renderOrder = 2;
  dm.name = "car-shadow";
  parent.add(dm);
}

/** Merge loose geometries (any index state) into one non-indexed BufferGeometry. */
function mergeLoose(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (const g of list) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...Array.from(ng.attributes.position.array as Float32Array));
    nor.push(...Array.from(ng.attributes.normal.array as Float32Array));
    const u = ng.attributes.uv;
    if (u) uv.push(...Array.from(u.array as Float32Array));
    else for (let i = 0; i < ng.attributes.position.count; i++) uv.push(0, 0);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

export function buildExterior(diner: THREE.Group, pal: Palette, sunDir: THREE.Vector3, bank?: TextureBank): ExteriorResult {
  const ext = bank ? bank.proxy(extModule, "ext") : extModule; // canvases in workers when a bank is given
  // Own group: everything in it is flagged `userData.lotCaster` at the end so Diner.ts
  // lets it cast into the lot sun's shadow map (interior objects are masked out of it).
  const parent = new THREE.Group();
  parent.name = "exterior";
  diner.add(parent);
  const rng = makeRng(3302);
  const b = new MergedBuilder();
  const envMaterials: THREE.Material[] = [];
  const halfX = ROOM.halfX;
  const yApron = -0.12;
  const yLot = LOT.y;

  /* ---------------- kerb + sidewalk edge ---------------- */
  const kerb = skyFill(new THREE.MeshStandardMaterial({ map: pal.concrete.map, roughness: 0.85, metalness: 0 }), 0.22);
  // Kerb face and top nose along the apron edge; slight batter
  b.rbox(kerb, [-halfX - 1.5, yLot, LOT.kerbZ - 0.16], [halfX + 1.5, yApron + 0.003, LOT.kerbZ], 0.012, 3);
  // Sidewalk beyond the diner's ends, both sides (the apron slab itself is in Shell.ts)
  b.box(kerb, [-halfX - 7, yLot - 0.02, ROOM.zFront + T], [-halfX - 1.5, yApron, LOT.kerbZ]);
  b.box(kerb, [halfX + 1.5, yLot - 0.02, ROOM.zFront + T], [halfX + 7, yApron, LOT.kerbZ]);

  /* ---------------- lot: detailed near plane + plain surround ---------------- */
  const stallLinesX: number[] = [];
  for (let x = -13.5; x <= 13.5 + 1e-6; x += LOT.stallPitch) stallLinesX.push(x);
  const layout: extModule.LotLayout = { x0: LOT.x0, z0: LOT.kerbZ, w: LOT.w, d: LOT.d, stallLinesX, stallDepth: LOT.stallDepth };
  const lotTex = ext.lotSurface(2048, layout, 3310);
  const detail = ext.asphaltDetail(512, 3311);
  const asphalt = skyFill(new THREE.MeshStandardMaterial({
    map: lotTex.map,
    roughnessMap: lotTex.roughnessMap,
    roughness: 1,
    normalMap: detail.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    metalness: 0,
  }), 0.2);
  detail.normalMap.repeat.set(LOT.w / 0.5, LOT.d / 0.5);
  {
    const g = new THREE.PlaneGeometry(LOT.w, LOT.d);
    g.rotateX(-Math.PI / 2);
    g.translate(LOT.x0 + LOT.w / 2, yLot, LOT.kerbZ + LOT.d / 2);
    const m = new THREE.Mesh(g, asphalt);
    m.receiveShadow = true;
    m.name = "lot";
    parent.add(m);
  }
  const plainAsphalt = skyFill(new THREE.MeshStandardMaterial({ color: 0x67655f, roughness: 0.9, metalness: 0, normalMap: detail.normalMap, normalScale: new THREE.Vector2(0.6, 0.6) }), 0.2);
  {
    // Surround: everything paved from x ±40 and from behind the building line out to the wall
    const g = new THREE.PlaneGeometry(80, LOT.d + 6);
    g.rotateX(-Math.PI / 2);
    g.translate(0, yLot - 0.01, LOT.kerbZ - 6 + (LOT.d + 6) / 2);
    const m = new THREE.Mesh(g, plainAsphalt);
    m.receiveShadow = true;
    m.name = "lot-surround";
    parent.add(m);
  }

  /* ---------------- wheel stops at the stall heads ---------------- */
  // Rev 4 to spec: 72" × 8" × 5½" precast bars (1.83 × 0.2 × 0.14), 15 mm chamfers on the
  // top edges, two Ø 20 mm rebar pin holes at ±0.6 m, centred in the stall (≈ 17" clear each
  // side), 0.75 m off the kerb face so a nosed-in bumper overhangs the bar, not the kerb.
  // Rev 5: exposed-aggregate precast texture (1 m tile, metric UVs), 20 mm true chamfers with
  // no rounded extrusion bevel, and a rubber scuff band on the lot face where tyres kiss it.
  const stopMat = skyFill(new THREE.MeshStandardMaterial({ map: ext.precast(1024, 3345), color: 0xc4c0b8, roughness: 0.92, metalness: 0 }), 0.22);
  const pinMat = new THREE.MeshStandardMaterial({ color: 0x141312, roughness: 0.9, metalness: 0 });
  pinMat.userData.noCast = true;
  const scuffMat = new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 1, metalness: 0, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  scuffMat.userData.noCast = true;
  for (let i = 0; i < stallLinesX.length - 1; i++) {
    if (i % 2 === 1 && rng() < 0.5) continue;
    const cx = (stallLinesX[i] + stallLinesX[i + 1]) / 2 + (rng() - 0.5) * 0.06;
    const z = LOT.kerbZ + LOT.stopZ + (rng() - 0.5) * 0.04;
    const skew = (rng() - 0.5) * 0.03; // a degree or so off square, as they are set by eye
    // Rev 7: the real trapezoidal section — 7.6" base, 4.9" tall, faces sloping in to a 4.6"
    // top with 10 mm rounds, and 15 mm chamfered ends (the extrusion bevel, so the shape is
    // drawn 15 mm inside the finished section). Rev 6 was a sharp rectangular prism.
    const c = 0.015, B = 0.0965, T = 0.058, H = 0.124, rr = 0.01;
    const sh = new THREE.Shape();
    const bx = B - c, tx = T - c, y0 = c, y1 = H - c;
    sh.moveTo(-bx, y0); sh.lineTo(bx, y0); sh.lineTo(tx + rr * 0.3, y1 - rr); sh.quadraticCurveTo(tx, y1, tx - rr, y1);
    sh.lineTo(-tx + rr, y1); sh.quadraticCurveTo(-tx, y1, -tx - rr * 0.3, y1 - rr); sh.closePath();
    const bar = new THREE.ExtrudeGeometry(sh, { depth: 1.83 - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 1, curveSegments: 3 });
    bar.computeVertexNormals();
    bar.rotateY(Math.PI / 2); // extrusion (z) → x; profile x → −z
    bar.translate(-0.915 + c, 0, 0);
    const faceTilt = Math.atan2(B - T, H); // the sloped face, for the scuffs
    bar.rotateY(skew);
    bar.translate(cx, yLot, z);
    b.add(bar, stopMat);
    // Tyre scuffs on the lot-side face (+z): two smeared bands at the track width, uneven
    for (const sx of [-1, 1]) {
      const w = 0.3 + rng() * 0.25, h0 = 0.03 + rng() * 0.02, h1 = 0.09 + rng() * 0.03;
      const scuff = new THREE.PlaneGeometry(w, h1 - h0);
      const yc = (h0 + h1) / 2;
      scuff.rotateX(-faceTilt); // lie on the sloped face
      scuff.translate(sx * (0.62 + rng() * 0.16), yc, B - (B - T) * (yc / H) + 0.0015);
      scuff.rotateY(skew);
      scuff.translate(cx, yLot, z);
      b.add(scuff, scuffMat);
    }
    for (const px of [-0.6, 0.6]) {
      const pin = new THREE.CylinderGeometry(0.011, 0.011, 0.02, 10);
      pin.translate(px, H - 0.0095, 0); // top 0.5 mm over the bar top so the hole reads as a dark disc
      pin.rotateY(skew);
      pin.translate(cx, yLot, z);
      b.add(pin, pinMat);
    }
  }

  /* ---------------- CMU wall at the far edge, with a cap and a gap for the entrance ---------------- */
  const wallTex = ext.blockWall(2048, 3312);
  const cmu = skyFill(new THREE.MeshStandardMaterial({ map: wallTex.map, roughnessMap: wallTex.roughnessMap, roughness: 1, metalness: 0 }), 0.22);
  wallTex.map.repeat.set(1 / 3.2, 1 / 0.8);
  wallTex.roughnessMap.repeat.copy(wallTex.map.repeat);
  const capMat = skyFill(new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.85, metalness: 0 }), 0.22);
  const gravelTex = ext.desertDirt(512, 3340);
  gravelTex.repeat.set(30, 1);
  const gravel = skyFill(new THREE.MeshStandardMaterial({ map: gravelTex, color: 0xb0aa9c, roughness: 1, metalness: 0 }), 0.22);
  const pierMat = skyFill(new THREE.MeshStandardMaterial({ color: 0xa9a49a, roughness: 0.9, metalness: 0 }), 0.22);
  for (const [xa, xb] of [[-40, -6], [1, 40]] as Array<[number, number]>) {
    b.box(cmu, [xa, yLot - 0.05, LOT.wallZ], [xb, yLot + 0.82, LOT.wallZ + 0.2], { metric: true });
    // Cap course: a 90 mm precast cap with a 25 mm overhang each side, lighter than the block
    b.rbox(capMat, [xa, yLot + 0.82, LOT.wallZ - 0.025], [xb, yLot + 0.91, LOT.wallZ + 0.225], 0.01, 2);
    // Kerb + gravel strip along the wall base: a 150 mm concrete kerb 0.7 m off the wall with
    // a crushed-rock strip behind it (the lot drains here — dust, weeds, blown trash).
    b.rbox(kerb, [xa, yLot, LOT.wallZ - 0.85], [xb, yLot + 0.13, LOT.wallZ - 0.7], 0.012, 3);
    {
      const g = new THREE.PlaneGeometry(xb - xa, 0.7);
      g.rotateX(-Math.PI / 2);
      g.translate((xa + xb) / 2, yLot + 0.03, LOT.wallZ - 0.35);
      b.add(g, gravel);
    }
  }

  /* ---------------- light standards on poured piers ---------------- */
  const galv = new THREE.MeshStandardMaterial({ color: 0x8b8e90, roughness: 0.45, metalness: 0.7 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4c4e, roughness: 0.55, metalness: 0.8 });
  const grout = skyFill(new THREE.MeshStandardMaterial({ color: 0xbdb9b0, roughness: 0.9, metalness: 0 }), 0.22);
  envMaterials.push(galv, steel);
  for (const px of [-6.7, 5.4]) {
    const pz = LOT.kerbZ + LOT.stallDepth + 0.6;
    // Round poured pier Ø 0.6 m, 0.75 m above grade, 15 mm chamfer, rust-streaked base plate,
    // four anchor bolts with nuts on a grout collar; the pole shaft sits on the plate.
    const pierTop = yLot + 0.75;
    const pier = new THREE.CylinderGeometry(0.285, 0.3, 0.735, 28);
    pier.translate(px, yLot + 0.735 / 2, pz);
    b.add(pier, pierMat);
    const chamfer = new THREE.CylinderGeometry(0.27, 0.285, 0.015, 28);
    chamfer.translate(px, pierTop - 0.0075, pz);
    b.add(chamfer, pierMat);
    b.box(grout, [px - 0.2, pierTop, pz - 0.2], [px + 0.2, pierTop + 0.03, pz + 0.2]); // grout collar
    b.rbox(steel, [px - 0.19, pierTop + 0.03, pz - 0.19], [px + 0.19, pierTop + 0.055, pz + 0.19], 0.006, 2); // base plate
    for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const bx = px + ax * 0.15, bz = pz + az * 0.15;
      const bolt = new THREE.CylinderGeometry(0.011, 0.011, 0.07, 8);
      bolt.translate(bx, pierTop + 0.055 + 0.035, bz);
      b.add(bolt, galv);
      const nut = new THREE.CylinderGeometry(0.02, 0.02, 0.018, 6);
      nut.translate(bx, pierTop + 0.055 + 0.009, bz);
      b.add(nut, galv);
    }
    const pole = new THREE.CylinderGeometry(0.06, 0.1, 7.35, 12);
    pole.translate(px, pierTop + 0.055 + 7.35 / 2, pz);
    b.add(pole, galv);
    const flange = new THREE.CylinderGeometry(0.1, 0.13, 0.04, 12);
    flange.translate(px, pierTop + 0.055 + 0.02, pz);
    b.add(flange, galv);
    const arm = new THREE.CylinderGeometry(0.035, 0.05, 1.9, 8);
    arm.rotateX(Math.PI / 2 - 0.25);
    arm.translate(px, yLot + 8.0, pz - 0.85);
    b.add(arm, galv);
    b.rbox(pal.darkMetal, [px - 0.14, yLot + 8.05, pz - 2.2], [px + 0.14, yLot + 8.25, pz - 1.45], 0.03, 3);
    b.box(new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.4 }), [px - 0.1, yLot + 8.03, pz - 2.1], [px + 0.1, yLot + 8.05, pz - 1.55]);
  }

  /* ---------------- vehicles ---------------- */
  // Glass: a dielectric (metalness 0) so the sky reflection is white Fresnel over the cabin.
  // rev 2 used metalness 0.55 with a near-black colour, which *tints the reflection black*;
  // rev 3 was opaque navy; rev 4 blends (see makePaneGlass) so the interior shows through.
  const carMats: CarMats = {
    glass: makePaneGlass(0.38, 1.1),
    lensGlass: makePaneGlass(0.1, 1.2),
    chrome: new THREE.MeshStandardMaterial({ color: 0xc4c7cb, roughness: 0.22, metalness: 1 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x262625, map: ext.tyreTread(1024, 3346), roughness: 0.82, metalness: 0, vertexColors: true }), // sidewall/tread tones in the vertex colour, blocks in the map
    dark: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.95, metalness: 0 }),
    gap: new THREE.MeshBasicMaterial({ color: 0x000000 }),
    amber: new THREE.MeshPhysicalMaterial({ color: 0xd9741a, roughness: 0.15, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1 }),
    tail: new THREE.MeshPhysicalMaterial({ color: 0x8a1212, roughness: 0.15, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.8, metalness: 0 }),
    shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, alphaMap: ext.contactShadowAlpha(128), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    // Cabin: the body shell inside out (headliner, door panels), cloth seats, dark padded trim
    cabin: new THREE.MeshStandardMaterial({ color: 0x17120f, roughness: 0.95, metalness: 0 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x33201c, roughness: 0.92, metalness: 0 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x100e0d, roughness: 0.88, metalness: 0 }),
    // Wheel-well liner: undercoat under road dust — lit, not the unlit black of the shut lines
    liner: new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 1, metalness: 0 }),
  };
  carMats.glass.name = "car-glass"; carMats.lensGlass.name = "lamp-glass";
  // Trim sits inside the body's silhouette (lamps in the nose, chrome on the flanks, liners
  // behind the tyres) and the interior is behind the glass: no shadow of their own, so skip
  // their depth draws in both maps.
  for (const m of [carMats.chrome, carMats.amber, carMats.tail, carMats.rubber, carMats.dark, carMats.gap, carMats.cabin, carMats.seat, carMats.trim, carMats.liner]) m.userData.noCast = true;
  // Paint: faded clearcoat under a dust film (carDust: sills and roof/hood dusty, flanks clean)
  const dustW = ext.carDust(512, 3330), dustM = ext.carDust(512, 3331);
  const whitePaint = skyFill(new THREE.MeshPhysicalMaterial({ color: 0xdcd9ce, map: dustW.map, roughnessMap: dustW.roughnessMap, roughness: 1, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.7 }), 0.2);
  // Rev 3 (System 4): specularIntensity 0.35 on the base under the coat. three sums the coat's
  // Fresnel (0.7 × 0.19 at the 70° the `lot-shadow` camera sees the hood at) with the base's
  // own full dielectric Fresnel (0.19) → 0.30 of the sky where a coated paint reflects ≈ 0.20
  // (the coat's surface dominates; what enters the coat meets the base at the refracted angle
  // and comes back through the coat's own interface). At 0.30 the hood mirrored the circumsolar
  // sky (≈ 9,000 nits at 20° from the sun) at 2,700 nits — the critics' lilac hood "with a hard
  // edge to maroon"; at 0.20 it is a 1,600-nit bluish sheen over the maroon and only the sun's
  // highlight clips.
  // System 4 rev 4: the roof read 47–50 % clipped from the lot with the sun 20–30° off its mirror
  // direction — not the clearcoat (0.22 → a 20°-wide lobe, ≈ 3,100 nits of the 9,600) so much as
  // the base layer: a 0.85-rough dielectric lobe at specularIntensity 0.35 spread the sun over the
  // whole panel (≈ 4,500 nits; ablation in BUILD.md). A solid maroon under clearcoat is a pigment
  // layer with little gloss of its own: specularIntensity 0.1, roughness 0.7; the clearcoat is a
  // slightly hazed 0.1 (a mirror of the sky, the sun's lobe only where the mirror direction hits it).
  // Re-measured at 0.1: roof 2,350 nits against 2,250 of sky behind it — the base lobe still
  // added ≈ 800 nits of sky. Under a clearcoat of the same index the pigment/clear interface
  // reflects almost nothing (n 1.5 → 1.5), so 0.05: roof ≈ 1,950, 0.2 EV under the sky.
  // System 4 rev 6: albedo 0x3a1014 was linear R 0.043 — a 4 % red under a clearcoat whose
  // sky reflection (F ≈ 0.06 at the door-glass view angle × 4,500 nits) was 270 nits of blue
  // over 100 nits of red diffuse, so every shaded panel measured B > R (door-glass 125/133/157)
  // and the critics read lilac. Dark maroon paint measures 10–15 % in red; 0x6e141c (linear
  // 0.155/0.007/0.011) keeps the panel red under the same sky. Rev 6.1: 0x6e1a16 (G 0.0093 ≥
  // B 0.0065) — the albedo itself was B > G, which read raspberry; the clearcoat's sky
  // reflection still puts B over G on panels that mirror the sky (the hood), by design.
  const maroonPaint = skyFill(new THREE.MeshPhysicalMaterial({ color: 0x6e1a16, map: dustM.map, roughnessMap: dustM.roughnessMap, roughness: 0.7, metalness: 0, specularIntensity: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.1, envMapIntensity: 1 }), 0.2);
  const grilleP = ext.grilleTexture(512, 8, 2, false, 3332), grilleS = ext.grilleTexture(512, 24, 6, true, 3333);
  const grillePickup = new THREE.MeshStandardMaterial({ map: grilleP.map, roughnessMap: grilleP.roughnessMap, roughness: 1, metalness: 0.6 });
  const grilleSedan = new THREE.MeshStandardMaterial({ map: grilleS.map, roughnessMap: grilleS.roughnessMap, roughness: 1, metalness: 0.8 });
  const platePickup = new THREE.MeshStandardMaterial({ map: ext.plateTexture(256, "CVN 4187", false, 3334), roughness: 0.45, metalness: 0.1 });
  const plateSedan = new THREE.MeshStandardMaterial({ map: ext.plateTexture(256, "LKR 902", true, 3335), roughness: 0.45, metalness: 0.1 });
  const steelWheelWhite = new THREE.MeshStandardMaterial({ color: 0xd8d5cc, roughness: 0.5, metalness: 0.2, vertexColors: true }); // painted steel wheel, brake dust in the vertex colour
  const wheelCover = new THREE.MeshStandardMaterial({ color: 0xc0c3c7, roughness: 0.38, metalness: 0.88, vertexColors: true }); // full chrome cover (a little diffuse: stamped, not plated-mirror)
  for (const m of [grillePickup, grilleSedan, platePickup, plateSedan, steelWheelWhite, wheelCover]) m.userData.noCast = true;
  envMaterials.push(carMats.glass, carMats.lensGlass, carMats.chrome, carMats.amber, carMats.tail, whitePaint, maroonPaint, grilleSedan, wheelCover, steelWheelWhite);

  // Dusty white single-cab square-body pickup (5.0 m, 1.8 wide, 1.80 tall, 3.0 m wheelbase):
  // front axle 0.72 m behind the body nose (28 % of WB with the bumper), A-pillar base at
  // 0.27 WB behind it, 1.58 m cab, 6 cm cab–bed gap, 2.0 m open bed.
  const pickup: CarSpec = {
    // Front axle at 0.86: overhang 29 % of the 3.0 m wheelbase (real ≈ 28 %), axle → A-pillar
    // base (1.52) 22 %.
    length: 5.0, hw: 0.9, sillY: 0.42, beltY: 0.98, wheelR: 0.38, tyreHw: 0.115, wheelZ: [0.86, 3.86], arch: "square",
    top: [
      [0.0, 0.90, 0.85, 0.02], [0.12, 0.94, 0.86, 0.02], [1.26, 0.995, 0.88, 0.02, true], [1.265, 0.95, 0.88, 0.008, true], [1.32, 0.955, 0.88, 0.008],
      [1.36, 1.02, 0.86, 0.02, true], [1.70, 1.74, 0.79, 0.04, true], [1.80, 1.79, 0.78, 0.03], [2.80, 1.79, 0.78, 0.03],
      // Cab back drops straight to the bed-rail height (rev 4's 1.14 → 1.10 step over 2 cm was a
      // lit facet showing through the cab-to-bed gap from the side).
      [2.86, 1.74, 0.78, 0.03, true], [2.90, 1.10, 0.888, 0.012, true], [2.92, 1.10, 0.888, 0.012], [4.98, 1.10, 0.888, 0.012], [5.0, 1.09, 0.885, 0.01],
    ],
    tailgate: { xIn: 0.815, y0: 0.68, y1: 1.085 }, tailTaper: 0.006,
    // Cab architecture (rev 6): door 1.42 → 2.60 with its window frame (glass ends 6 cm ahead
    // of the rear shut line, so the B-pillar IS the door's rear frame and the shut line runs
    // rocker → drip rail in one plane), a solid 30 cm cab rear quarter behind it, then a 5 cm
    // cab-to-bed gap lit as a cavity. Rev 5 put the door line 8 cm ahead of a 6 cm unlit gap
    // and the critics read the gap as a 15 px black "shut line" with the glasshouse's pillar
    // 30 px forward of it.
    sideGlass: [{ z0: 1.52, z1: 2.54, z0Top: 1.86 }],
    doors: [1.42, 2.6],
    grooves: [
      { z0: 1.4165, z1: 1.4235, depth: 0.008, span: "side", bevel: 0.006 }, { z0: 2.5965, z1: 2.6035, depth: 0.008, span: "side", bevel: 0.006 },
      { z0: 2.925, z1: 2.975, depth: 0.15, span: "all", lit: true }, // cab-to-bed gap
      // Open bed between the rails, from a 2.5 cm bulkhead behind the gap to the gate's inner
      // face (rev 5's 6.5 cm bulkhead top showed through the gap as a lit slanted band).
      { z0: 3.0, z1: 4.95, depth: 0.42, span: "bed" },
      { z0: 4.95, z1: 5.0, depth: 0.015, span: "bed" }, // tailgate top 15 mm under the bedside caps
    ],
    topLines: [{ x: 0.8, z0: 0.15, z1: 1.25 }],
    screens: [{ zb: 1.36, zt: 1.7, yb: 1.02, yt: 1.7 }, { zb: 2.9, zt: 2.86, yb: 1.2, yt: 1.68 }],
    lamps: "round2", lampY: 0.75, grille: { y0: 0.62, y1: 0.88, hw: 0.5 },
    interior: {
      cabin: { z0: 1.3, z1: 2.9, y0: 0.55, y1: 1.76, hw: 0.84 },
      dash: { z0: 1.36, z1: 1.82, y: 0.98, hw: 0.82 },
      wheel: { x: 0.4, y: 1.1, z: 2.08, r: 0.2 },
      seats: [{ z: 2.6, x0: -0.78, x1: 0.78, y0: 0.66, y1: 1.28 }],
    },
    paint: whitePaint, grilleMat: grillePickup, plateMat: platePickup, wheelFace: steelWheelWhite, wheelStyle: "steel",
  };
  // Maroon 3-box sedan (4.95 m, 1.8 wide, 1.42 tall), full wheel covers. Modelled as the
  // 1977–90 box Caprice (the brief said 1991–96; the box body suits the diner and its front
  // graphic already reads — see BUILD.md).
  const sedan: CarSpec = {
    length: 4.95, hw: 0.9, sillY: 0.31, beltY: 0.87, wheelR: 0.35, tyreHw: 0.105, wheelZ: [0.95, 3.85], arch: "flat",
    top: [
      [0.0, 0.78, 0.85, 0.02], [0.12, 0.80, 0.87, 0.02], [1.8, 0.875, 0.88, 0.02, true], [1.805, 0.835, 0.88, 0.008, true], [1.86, 0.84, 0.88, 0.008],
      [1.9, 0.90, 0.86, 0.02, true], [2.44, 1.38, 0.72, 0.08, true], [2.52, 1.42, 0.71, 0.09], [3.5, 1.42, 0.71, 0.09],
      [3.58, 1.38, 0.72, 0.08, true], [4.12, 1.02, 0.86, 0.03, true], [4.2, 1.0, 0.888, 0.015], [4.88, 0.98, 0.888, 0.015], [4.95, 0.9, 0.86, 0.02],
    ],
    sideGlass: [{ z0: 2.0, z1: 2.9, z0Top: 2.32 }, { z0: 2.98, z1: 3.62, z1Top: 3.5 }],
    doors: [1.96, 2.94, 3.72],
    grooves: [
      { z0: 1.9565, z1: 1.9635, depth: 0.008, span: "side", bevel: 0.006 }, { z0: 2.9365, z1: 2.9435, depth: 0.008, span: "side", bevel: 0.006 }, { z0: 3.7165, z1: 3.7235, depth: 0.008, span: "side", bevel: 0.006 },
      { z0: 4.2365, z1: 4.2435, depth: 0.008, span: "top", bevel: 0.006 }, // trunk lid leading edge
    ],
    topLines: [{ x: 0.8, z0: 0.15, z1: 1.79 }, { x: 0.79, z0: 4.24, z1: 4.9 }],
    screens: [{ zb: 1.9, zt: 2.44, yb: 0.9, yt: 1.34 }, { zb: 4.12, zt: 3.58, yb: 1.04, yt: 1.34 }],
    lamps: "rect2", lampY: 0.7, grille: { y0: 0.61, y1: 0.78, hw: 0.34 },
    interior: {
      cabin: { z0: 1.86, z1: 4.14, y0: 0.45, y1: 1.37, hw: 0.82 },
      dash: { z0: 1.9, z1: 2.36, y: 0.86, hw: 0.8 },
      wheel: { x: 0.4, y: 0.98, z: 2.58, r: 0.19 },
      seats: [
        { z: 2.9, x0: 0.12, x1: 0.68, y0: 0.55, y1: 1.02, headrest: true },
        { z: 2.9, x0: -0.68, x1: -0.12, y0: 0.55, y1: 1.02, headrest: true },
        { z: 3.86, x0: -0.76, x1: 0.76, y0: 0.55, y1: 1.0 },
      ],
      shelf: { z0: 3.95, z1: 4.13, y: 1.02, hw: 0.8 },
    },
    paint: maroonPaint, grilleMat: grilleSedan, plateMat: plateSedan, wheelFace: wheelCover, wheelStyle: "cover",
  };
  const stall = (i: number) => (stallLinesX[i] + stallLinesX[i + 1]) / 2;
  const sink: CarSink = { panes: [], lenses: [] };
  // Nosed in against the stops: the pickup's front tyres 0.10 m short of the bar (bumper 0.37 m
  // past it, 0.48 m off the kerb), the sedan's 0.08 m short (bumper 0.48 m past, 0.20 m off the kerb).
  const stopFace = LOT.kerbZ + LOT.stopZ + 0.1;
  buildCar(b, parent, pickup, carMats, sink, new THREE.Vector3(stall(4) + 0.12, yLot, stopFace + 0.1 - (pickup.wheelZ[0] - pickup.wheelR)), THREE.MathUtils.degToRad(1.5));
  buildCar(b, parent, sedan, carMats, sink, new THREE.Vector3(stall(6) - 0.08, yLot, stopFace + 0.08 - (sedan.wheelZ[0] - sedan.wheelR)), THREE.MathUtils.degToRad(-2));
  for (const [list, mat, name] of [[sink.panes, carMats.glass, "car-glass"], [sink.lenses, carMats.lensGlass, "lamp-glass"]] as Array<[THREE.BufferGeometry[], THREE.Material, string]>) {
    const mesh = new THREE.Mesh(mergeLoose(list), mat);
    mesh.renderOrder = 5; // after every other opaque (the cabin, the far pane's backdrop) — blended, see makePaneGlass
    mesh.castShadow = true; // tinted glass: the cabin stays in shadow
    mesh.receiveShadow = false;
    mesh.name = name;
    parent.add(mesh);
  }

  /* ---------------- desert dirt, scrub, horizon, sky ---------------- */
  const dirtTex = ext.desertDirt(1024, 3313);
  dirtTex.repeat.set(60, 60);
  const dirt = skyFill(new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1, metalness: 0 }), 0.22);
  {
    const g = new THREE.PlaneGeometry(420, 420);
    g.rotateX(-Math.PI / 2);
    g.translate(0, yLot - 0.04, 0);
    const m = new THREE.Mesh(g, dirt);
    m.name = "desert";
    parent.add(m);
  }
  // Scrub edge behind the wall: not a ruler line. The clear strip along the wall wanders 0–4 m
  // (`edgeAt`) and the bushes thin out over the next 3 m (`edgeKeep`) — a graded shoulder.
  const edgeNoise = makeValueNoise(3361, 64);
  const edgeAt = (x: number) => LOT.wallZ + 1.5 + 3.5 * edgeNoise(x / 6 + 32, 0.5);
  const edgeKeep = (x: number, z: number) => {
    const d = z - edgeAt(x);
    return d > 0 && (d > 3 || rng() < 0.2 + 0.8 * (d / 3));
  };
  {
    // Scrub: noise-jittered low blobs, one InstancedMesh, colour per instance
    const base = new THREE.IcosahedronGeometry(0.5, 1);
    const p = base.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const k = 0.8 + rng() * 0.45;
      p.setXYZ(i, p.getX(i) * k, Math.max(-0.05, p.getY(i) * 0.55 * k), p.getZ(i) * k);
    }
    base.computeVertexNormals();
    const mat = skyFill(new THREE.MeshStandardMaterial({ color: 0x8a8870, roughness: 1, metalness: 0 }), 0.22);
    const N = 520;
    const scrub = new THREE.InstancedMesh(base, mat, N);
    // Contact shadows: one instanced ellipse decal per bush, offset down-sun (the lot light's
    // frustum stops at the CMU wall, so the desert gets its ground contact this way).
    const decalGeo = new THREE.CircleGeometry(0.5, 14);
    decalGeo.rotateX(-Math.PI / 2);
    const decals = new THREE.InstancedMesh(decalGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, alphaMap: ext.contactShadowAlpha(64), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), N);
    const shadowDir = new THREE.Vector3(-sunDir.x, 0, -sunDir.z).normalize();
    const shadowLen = 1 / Math.tan(Math.asin(sunDir.y)); // shadow length per metre of height
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), c = new THREE.Color();
    const yAxis = new THREE.Vector3(0, 1, 0);
    let placed = 0, tries = 0;
    while (placed < N && tries < 6000) {
      tries++;
      const r = 22 + Math.pow(rng(), 0.7) * 100, a = rng() * Math.PI * 2;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (Math.abs(x) < 42 && z < LOT.wallZ + 6 && !edgeKeep(x, z)) continue; // not in the lot, graded edge
      if (z < ROOM.zBack - 4 && Math.abs(x) < 12) continue; // not behind the kitchen
      if (Math.abs(z - ROAD.z) < ROAD.halfW + 1.2) continue; // not on the road or its shoulders
      // Three size classes: rabbitbrush clumps, sage, the odd big saltbush
      const cls = rng();
      const sc = cls < 0.35 ? 0.35 + rng() * 0.3 : cls < 0.88 ? 0.65 + rng() * 0.55 : 1.25 + rng() * 0.7;
      s.set(sc * (0.9 + rng() * 0.4), sc * (0.55 + rng() * 0.5), sc * (0.9 + rng() * 0.4));
      q.setFromAxisAngle(yAxis, rng() * Math.PI * 2);
      pos.set(x, yLot - 0.03, z);
      m.compose(pos, q, s);
      scrub.setMatrixAt(placed, m);
      // Tones: grey-green sage / olive rabbitbrush / straw (dead)
      const tone = rng();
      if (tone < 0.45) c.setRGB(0.5 + rng() * 0.1, 0.54 + rng() * 0.1, 0.42 + rng() * 0.08);
      else if (tone < 0.8) c.setRGB(0.46 + rng() * 0.1, 0.5 + rng() * 0.1, 0.3 + rng() * 0.08);
      else c.setRGB(0.66 + rng() * 0.1, 0.6 + rng() * 0.08, 0.42 + rng() * 0.08);
      scrub.setColorAt(placed, c);
      // Decal: ellipse of the blob's footprint stretched down-sun by the shadow length
      const hgt = s.y * 0.55;
      const len = s.x * 0.5 + hgt * shadowLen;
      const cx = x + shadowDir.x * (len - s.x * 0.5) * 0.5, cz = z + shadowDir.z * (len - s.x * 0.5) * 0.5;
      q.setFromAxisAngle(yAxis, Math.atan2(shadowDir.x, shadowDir.z));
      pos.set(cx, yLot - 0.035, cz);
      m.compose(pos, q, new THREE.Vector3(s.z * 0.9, 1, len));
      decals.setMatrixAt(placed, m);
      placed++;
    }
    scrub.count = placed;
    decals.count = placed;
    scrub.instanceMatrix.needsUpdate = true;
    decals.instanceMatrix.needsUpdate = true;
    if (scrub.instanceColor) scrub.instanceColor.needsUpdate = true;
    scrub.name = "scrub";
    scrub.frustumCulled = false;
    decals.name = "scrub-shadows";
    decals.frustumCulled = false;
    decals.renderOrder = 1;
    parent.add(scrub, decals);
  }
  // Tyre tracks in the dirt behind the wall: a dirt approach from the road to the entrance gap
  // (two wheel ruts 1.9 m apart) and two stray single tracks — darker compacted dirt strips.
  {
    // Feathered: three vertices across (edge, centre, edge) with vertex ALPHA 0 / 1 / 0, so the
    // compacted strip blends into the dirt instead of two hard-edged ribbons (rev 4). Width
    // and alpha wander along the track, and the two ruts of a pair share the vehicle's wander
    // plus their own small one — parallel, not identical.
    const trackMat = skyFill(new THREE.MeshStandardMaterial({ map: dirtTex, color: 0xa39a8a, roughness: 1, metalness: 0, transparent: true, depthWrite: false, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 0.22);
    trackMat.userData.noCast = true;
    const trackParts: THREE.BufferGeometry[] = [];
    const wobble = makeValueNoise(3363, 32);
    const rut = (pts: Array<[number, number]>, w: number, seed: number) => {
      const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x, z] = pts[i];
        const [xa, za] = pts[Math.max(0, i - 1)], [xb, zb] = pts[Math.min(pts.length - 1, i + 1)];
        let tx = xb - xa, tz = zb - za;
        const l = Math.hypot(tx, tz) || 1;
        tx /= l; tz /= l;
        const t = i / (pts.length - 1);
        const ww = w * (0.8 + 0.5 * wobble(t * 9 + seed, seed * 0.7)); // width breathes ±25 %
        const a = 0.55 + 0.45 * wobble(t * 5 + seed * 1.3, 3 + seed); // compaction varies along
        for (const k of [-1, 0, 1]) {
          pos.push(x - tz * ww * 0.5 * k, yLot - 0.036, z + tx * ww * 0.5 * k);
          nor.push(0, 1, 0);
          uv.push((x - tz * ww * 0.5 * k) / 7, (z + tx * ww * 0.5 * k) / 7);
          col.push(1, 1, 1, k === 0 ? a : 0);
        }
        // Wound so the strip faces +y whichever way the path runs — the rev 3 winding faced
        // down and every track was back-face culled (invisible in all frames).
        if (i < pts.length - 1) { const p = i * 3; idx.push(p, p + 1, p + 3, p + 1, p + 4, p + 3, p + 1, p + 2, p + 4, p + 2, p + 5, p + 4); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
      g.setIndex(idx);
      trackParts.push(g.toNonIndexed());
    };
    const wander = makeValueNoise(3362, 16);
    const path = (x0: number, z0: number, x1: number, z1: number, amp: number, seedU: number, ownAmp = 0, ownSeed = 0): Array<[number, number]> => {
      const out: Array<[number, number]> = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const w = (wander(t * 6 + seedU, seedU) - 0.5) * amp * Math.sin(Math.PI * t) + (wander(t * 11 + ownSeed, ownSeed + 5) - 0.5) * ownAmp;
        out.push([x0 + (x1 - x0) * t + w, z0 + (z1 - z0) * t]);
      }
      return out;
    };
    const gapX = -2.5; // centre of the wall opening (−6 … 1)
    // Same wander seed for both ruts of the pair: one vehicle, two wheels 1.9 m apart, parallel.
    rut(path(gapX - 0.95 + 1.2, ROAD.z - ROAD.halfW - 1.4, gapX - 0.95, LOT.wallZ + 0.6, 0.7, 3, 0.18, 21), 0.34, 1);
    rut(path(gapX + 0.95 + 1.2, ROAD.z - ROAD.halfW - 1.4, gapX + 0.95, LOT.wallZ + 0.6, 0.7, 3, 0.18, 29), 0.3, 2);
    rut(path(14, ROAD.z - ROAD.halfW - 1.0, 30, LOT.wallZ + 3, 4, 11), 0.3, 3);
    rut(path(-22, LOT.wallZ + 2.5, -9, ROAD.z - ROAD.halfW - 1.2, 3, 17), 0.3, 4);
    const tracks = new THREE.Mesh(mergeLoose(trackParts), trackMat);
    {
      const col: number[] = [];
      for (const g of trackParts) col.push(...Array.from(g.attributes.color.array as Float32Array));
      tracks.geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
    }
    tracks.name = "tyre-tracks"; tracks.renderOrder = 1; tracks.frustumCulled = false; tracks.receiveShadow = true;
    parent.add(tracks);
  }

  /* ---------------- frontage road + utility poles behind the wall ---------------- */
  {
    // From a 1.6 m eye the ground behind the 0.9 m wall reappears ~15 m past it; the road sits
    // there so the flat does not die into raw scrub: two-lane asphalt with pale gravel
    // shoulders and a faded white edge line, and a pole line on the far shoulder.
    const roadMat = skyFill(new THREE.MeshStandardMaterial({ color: 0x5e5c57, roughness: 0.95, metalness: 0, normalMap: detail.normalMap, normalScale: new THREE.Vector2(0.5, 0.5) }), 0.2);
    const shoulderMat = skyFill(new THREE.MeshStandardMaterial({ color: 0xa79e8e, roughness: 1, metalness: 0 }), 0.22);
    const lineMat = skyFill(new THREE.MeshStandardMaterial({ color: 0xcfcbc0, roughness: 0.9, metalness: 0 }), 0.22);
    const plane = (w: number, d: number, y: number, z: number, mat: THREE.Material) => {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(0, y, z);
      b.add(g, mat);
    };
    // Gravel shoulders: graded into the dirt (vertex alpha 1 at the asphalt → 0 at a wandering
    // outer edge 1.4–2.6 m out), not the rev 4 hard-edged pale band.
    {
      shoulderMat.transparent = true; shoulderMat.depthWrite = false; shoulderMat.vertexColors = true;
      shoulderMat.polygonOffset = true; shoulderMat.polygonOffsetFactor = -1; shoulderMat.polygonOffsetUnits = -1;
      const edge = makeValueNoise(3364, 32);
      const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
      const n = 100;
      for (const s of [-1, 1]) {
        const base = pos.length / 3;
        for (let i = 0; i <= n; i++) {
          const x = -200 + (400 * i) / n;
          const outer = ROAD.halfW + 1.0 + 1.3 * edge(i / 3 + (s > 0 ? 0 : 50), 0.5);
          for (const [dz, a] of [[ROAD.halfW - 0.05, 1], [ROAD.halfW + 0.45, 0.5], [outer, 0]] as Array<[number, number]>) {
            pos.push(x, yLot - 0.02, ROAD.z + s * dz); nor.push(0, 1, 0); uv.push(x / 7, (ROAD.z + s * dz) / 7); col.push(1, 1, 1, a);
          }
          if (i < n) {
            const p = base + i * 3;
            const quad = (q0: number, q1: number, q2: number, q3: number) => (s > 0 ? idx.push(q0, q1, q2, q1, q3, q2) : idx.push(q0, q2, q1, q1, q2, q3));
            quad(p, p + 1, p + 3, p + 4); quad(p + 1, p + 2, p + 4, p + 5);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, shoulderMat);
      m.name = "road-shoulders"; m.frustumCulled = false; m.renderOrder = 1; m.receiveShadow = true;
      parent.add(m);
    }
    plane(400, ROAD.halfW * 2, yLot - 0.005, ROAD.z, roadMat);
    for (const s of [-1, 1]) plane(400, 0.1, yLot + 0.001, ROAD.z + s * (ROAD.halfW - 0.3), lineMat);
    plane(400, 0.1, yLot + 0.001, ROAD.z, new THREE.MeshStandardMaterial({ color: 0xc9b25a, roughness: 0.9 })); // faded centre line
    // Utility poles: creosoted timber, 10 m, crossarm with insulators, spaced ~38 m on the far shoulder
    const wood = skyFill(new THREE.MeshStandardMaterial({ color: 0x4b4239, roughness: 0.95, metalness: 0 }), 0.15);
    const insulator = new THREE.MeshStandardMaterial({ color: 0xbfc8cc, roughness: 0.3, metalness: 0 });
    const wirePts: number[] = [];
    const pz = ROAD.z + ROAD.halfW + 1.4;
    const tops: THREE.Vector3[] = [];
    for (let px = -152; px <= 152; px += 38) {
      const x = px + (rng() - 0.5) * 3, lean = (rng() - 0.5) * 0.02;
      const pole = new THREE.CylinderGeometry(0.13, 0.17, 10, 10);
      pole.translate(0, 5 - 0.3, 0);
      pole.rotateZ(lean);
      pole.translate(x, yLot, pz);
      b.add(pole, wood);
      const arm = new THREE.BoxGeometry(2.4, 0.1, 0.12);
      arm.translate(x, yLot + 9.0, pz + 0.12);
      b.add(arm, wood);
      for (const ix of [-1.05, -0.45, 0.45, 1.05]) {
        const ins = new THREE.CylinderGeometry(0.06, 0.05, 0.16, 8);
        ins.translate(x + ix, yLot + 9.13, pz + 0.12);
        b.add(ins, insulator);
        tops.push(new THREE.Vector3(x + ix, yLot + 9.21, pz + 0.12));
      }
    }
    // Wires: catenaries between consecutive poles (4 per span), 1 px lines — sub-pixel at 40 m
    for (let i = 0; i + 4 < tops.length; i += 4)
      for (let k = 0; k < 4; k++) {
        const a = tops[i + k], c = tops[i + 4 + k];
        for (let s = 0; s < 12; s++) {
          const t0 = s / 12, t1 = (s + 1) / 12;
          const sag = (t: number) => -0.9 * 4 * t * (1 - t);
          wirePts.push(a.x + (c.x - a.x) * t0, a.y + sag(t0), a.z, a.x + (c.x - a.x) * t1, a.y + sag(t1), a.z);
        }
      }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute("position", new THREE.Float32BufferAttribute(wirePts, 3));
    const wires = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2a2826, transparent: true, opacity: 0.55 }));
    wires.name = "wires";
    wires.frustumCulled = false;
    parent.add(wires);
  }

  /* ---------------- creosote + mesquite: 1–2.5 m open shrubs among the scrub ---------------- */
  {
    // Creosote (Larrea): a fan of thin dark stems from one root crown, sparse olive foliage in
    // small clumps at the stem ends; mesquite: two or three thicker leaning trunks under a
    // broad flat canopy. Rev 4: five distinct silhouettes (the rev 3 flat repeated one
    // instanced sprite — the critics counted its copies), baked with a random pick, yaw and
    // scale per bush into ONE merged geometry per material (two draw calls, ~80 k triangles).
    const brng = makeRng(3350);
    type Variant = { stems: THREE.BufferGeometry[]; leaves: THREE.BufferGeometry[] };
    const variants: Variant[] = [];
    const creosote = (nStems: number, spread: number, height: number, clumps: number): Variant => {
      const v: Variant = { stems: [], leaves: [] };
      for (let s = 0; s < nStems; s++) {
        const a = (s / nStems) * Math.PI * 2 + brng() * (Math.PI * 2 / nStems), tilt = spread + brng() * 0.3, len = height * (0.7 + brng() * 0.4);
        const stem = new THREE.CylinderGeometry(0.008, 0.02, len, 5);
        stem.translate(0, len / 2, 0);
        stem.rotateX(tilt);
        stem.rotateY(a);
        v.stems.push(stem);
        const tip = new THREE.Vector3(0, len, 0).applyEuler(new THREE.Euler(tilt, a, 0, "YXZ"));
        for (let k = 0; k < clumps; k++) {
          const leaf = new THREE.IcosahedronGeometry(0.1 + brng() * 0.08, 0);
          leaf.scale(1, 0.7, 1);
          const t = 0.6 + k * (0.4 / clumps) + brng() * 0.1;
          leaf.translate(tip.x * t + (brng() - 0.5) * 0.14, tip.y * t, tip.z * t + (brng() - 0.5) * 0.14);
          v.leaves.push(leaf);
        }
      }
      return v;
    };
    const mesquite = (trunks: number): Variant => {
      const v: Variant = { stems: [], leaves: [] };
      for (let s = 0; s < trunks; s++) {
        const a = (s / trunks) * Math.PI * 2 + brng(), tilt = 0.35 + brng() * 0.3, len = 1.1 + brng() * 0.4;
        const trunk = new THREE.CylinderGeometry(0.03, 0.06, len, 6);
        trunk.translate(0, len / 2, 0);
        trunk.rotateX(tilt);
        trunk.rotateY(a);
        v.stems.push(trunk);
        const tip = new THREE.Vector3(0, len, 0).applyEuler(new THREE.Euler(tilt, a, 0, "YXZ"));
        for (let k = 0; k < 3; k++) {
          const br = new THREE.CylinderGeometry(0.012, 0.025, 0.7, 5);
          br.translate(0, 0.35, 0);
          br.rotateX(0.9 + brng() * 0.5);
          br.rotateY(a + (k - 1) * 0.9 + brng() * 0.4);
          br.translate(tip.x, tip.y, tip.z);
          v.stems.push(br);
        }
        // Broken crown: 4 clumps at uneven radii and heights, one side bare
        for (let k = 0; k < 4; k++) {
          const ca = brng() * Math.PI * 1.4 + a, cr = 0.25 + brng() * 0.5;
          const leaf = new THREE.IcosahedronGeometry(0.18 + brng() * 0.12, 0);
          leaf.scale(1.2, 0.55, 1.1);
          leaf.translate(tip.x + Math.cos(ca) * cr, tip.y + 0.05 + brng() * 0.35, tip.z + Math.sin(ca) * cr);
          v.leaves.push(leaf);
        }
      }
      return v;
    };
    // Rev 5: the two mesquites read as repeated umbrella trees from the road (a flat ring canopy
    // on a trunk, five copies in `dbg-wall-road`). Now the mix is 6 creosote silhouettes —
    // leggy, trunkless fans of stems with sparse clumps — and ONE mesquite with a broken,
    // irregular crown, picked one time in eight and only far out.
    variants.push(creosote(9, 0.25, 0.95, 3), creosote(6, 0.45, 0.8, 2), creosote(12, 0.18, 1.15, 3), creosote(5, 0.6, 0.7, 4), creosote(7, 0.35, 1.05, 2), creosote(10, 0.5, 0.9, 2));
    const mesq = mesquite(2);
    const stemMat = skyFill(new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1, metalness: 0 }), 0.2);
    const leafMat = skyFill(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true }), 0.0);
    leafMat.emissive.setRGB(0.42, 0.44, 0.3).multiplyScalar(0.22 * 0.45); // sky fill for the mean tone (vertex colour carries the tint)
    const stemParts: THREE.BufferGeometry[] = [], leafParts: THREE.BufferGeometry[] = [];
    const N = 110;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    let placed = 0, tries = 0;
    while (placed < N && tries < 4000) {
      tries++;
      const r = 24 + Math.pow(rng(), 0.8) * 110, a = rng() * Math.PI * 2;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (Math.abs(x) < 42 && z < LOT.wallZ + 6 && !edgeKeep(x, z)) continue;
      if (z < ROOM.zBack - 4 && Math.abs(x) < 12) continue;
      if (Math.abs(z - ROAD.z) < ROAD.halfW + 1.5) continue;
      const v = r > 45 && rng() < 0.125 ? mesq : variants[Math.floor(rng() * variants.length)];
      const h = 1.0 + rng() * 1.0; // 1–2 m tall (mesquite variants are taller by construction)
      s.set(h * (0.85 + rng() * 0.3), h, h * (0.85 + rng() * 0.3));
      q.setFromAxisAngle(yAxis, rng() * Math.PI * 2);
      p.set(x, yLot - 0.03, z);
      m.compose(p, q, s);
      const tint: [number, number, number] = [0.42 + rng() * 0.12, 0.44 + rng() * 0.1, 0.3 + rng() * 0.08]; // dusty olive, not lawn green
      for (const g of v.stems) stemParts.push(g.clone().applyMatrix4(m));
      for (const g of v.leaves) {
        const lg = g.clone().applyMatrix4(m);
        const n = lg.attributes.position.count;
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { col[i * 3] = tint[0]; col[i * 3 + 1] = tint[1]; col[i * 3 + 2] = tint[2]; }
        lg.setAttribute("color", new THREE.BufferAttribute(col, 3));
        leafParts.push(lg);
      }
      placed++;
    }
    const stems = new THREE.Mesh(mergeLoose(stemParts), stemMat);
    const leafGeo = mergeLoose(leafParts);
    {
      // mergeLoose drops colours; re-gather them in the same order
      const col: number[] = [];
      for (const g of leafParts) col.push(...Array.from((g.index ? g.toNonIndexed() : g).attributes.color.array as Float32Array));
      leafGeo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    }
    const leaves = new THREE.Mesh(leafGeo, leafMat);
    stems.name = "creosote-stems"; leaves.name = "creosote";
    stems.frustumCulled = leaves.frustumCulled = false;
    stems.castShadow = leaves.castShadow = false; // outside the lot light's frustum anyway
    parent.add(stems, leaves);
  }
  buildHorizon(parent);
  const sky = buildSky(sunDir);
  parent.add(sky);

  b.build(parent, { name: "exterior" });
  parent.traverse((o) => { o.userData.lotCaster = true; });
  return { envMaterials, sky };
}
