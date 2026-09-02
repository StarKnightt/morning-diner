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
import { makeRng, makeFbm } from "../core/rng";
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
} as const;
/** Frontage road behind the CMU wall (rev 3): visible over the wall from a standing eye. */
const ROAD = { z: LOT.wallZ + 16, halfW: 3.6 } as const;

export interface ExteriorResult {
  /** Materials whose envMap should be the lot probe (sky + facade). */
  envMaterials: THREE.Material[];
  sky: THREE.Mesh;
}

function skyFill(mat: THREE.MeshStandardMaterial, k: number): THREE.MeshStandardMaterial {
  // Diffuse sky fill approximation: emissive = albedo × k (placeholder until System 4).
  // Rev 2: scaled down ×0.45 — the hemisphere light already supplies most of the sky term,
  // and the extra emissive was flattening the lot shadows to ~1.5:1 (real 8 AM sun ≈ 5:1).
  k *= 0.45;
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
 * Far terrain: two rings. Near ring (135 m) — low rises, one mesa, a serrated ridge;
 * far ring (175 m) — a taller, smoother range behind it. Both fade toward the sky
 * in their vertex colours and the scene fog (40 → 200 m) does the rest, so the
 * far range is a ghost and the near ridge's foot melts into the haze band.
 */
function buildHorizon(parent: THREE.Group): void {
  const haze = new THREE.Color(0.86, 0.87, 0.89);
  const ring = (R: number, segs: number, seed: number, rock: THREE.Color, baseFade: number, name: string, profile: (a: number, noise: (u: number, v: number) => number) => number) => {
    const noise = makeFbm(seed, 24, 3);
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const tmp = new THREE.Color();
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2 - Math.PI;
      const x = Math.sin(a) * R, z = Math.cos(a) * R;
      const h = profile(a, noise);
      const fade = baseFade + 0.15 * (1 - Math.min(1, h / 16));
      pos.push(x, -0.35, z, x, h - 0.35, z);
      tmp.copy(rock).lerp(haze, Math.min(1, fade + 0.1)); // foot is hazier than the top
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
  ring(135, 360, 7101, new THREE.Color(0.36, 0.3, 0.28), 0.3, "horizon", (a, noise) => {
    // a in radians, 0 = +z (straight out the windows). Mesa 24°–62° left of centre, ridge elsewhere.
    const deg = THREE.MathUtils.radToDeg(a);
    const mesaL = deg > -62 && deg < -24 ? 1 : 0;
    const mesaEdge = mesaL ? Math.min(1, Math.min(deg + 62, -24 - deg) / 6) : 0;
    const mesa = 16 * Math.pow(mesaEdge, 0.6);
    const ridge = 3.5 + 5 * noise(a / (Math.PI * 2), 0.3) + 2.5 * Math.abs(Math.sin(deg * 0.35)) * noise(a / (Math.PI * 2) + 0.5, 0.7);
    return Math.max(mesa, ridge);
  });
  ring(175, 240, 7102, new THREE.Color(0.4, 0.36, 0.36), 0.42, "horizon-far", (a, noise) => {
    const u = a / (Math.PI * 2);
    return 12 + 14 * noise(u * 1.3 + 0.2, 0.55) + 6 * noise(u * 4 + 0.7, 0.2);
  });
}

/* ------------------------------------------------------------------------------------------
 * Vehicles (rev 3). The rev 2 cars were a side silhouette extruded across the width — slabs
 * with no tyres under the fenders, vertical flanks and a nose 10 cm off the asphalt. rev 3
 * lofts the body through real cross-sections (rounded sills, a side bulge to the belt,
 * tumblehome up to a radiused roof), cuts the wheel arches into the lower edge so the tyres
 * actually show, and hangs the hardware a viewer 4–30 m away resolves: four lathed tyres
 * with sidewall shading, steel wheels + caps, chrome bumpers at 0.45 m with a painted
 * valance below, dual sealed beams in chrome bezels with a glassy lens, amber signals, an
 * egg-crate grille, plates, door mirrors, wipers, handles, side moulding and drip rails.
 * Car frame: nose at z = 0, tail at z = L, +x = the car's right when facing +z, y up from
 * the asphalt.
 * ---------------------------------------------------------------------------------------- */

/** One body cross-section at z (all in m). */
interface Station {
  z: number;
  /** Lower body edge (sill / valance; lifted over the wheel arches) and belt line. */
  yLo: number;
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
}

interface CarSpec {
  length: number;
  hw: number;
  sillY: number;
  beltY: number;
  wheelR: number;
  wheelZ: [number, number];
  /** Body top line as (z, yTop, hwTop, rTop, crease?) — the loft resamples between them. */
  top: Array<[number, number, number, number, boolean?]>;
  /** Side glass panes along the flank and the shut lines / handles. */
  sideGlass: Array<{ z0: number; z1: number }>;
  doors: number[];
  /** Windshield / backlight: z at the base, z at the top, y base, y top. */
  screens: Array<{ zb: number; zt: number; yb: number; yt: number }>;
  bed?: { z0: number; z1: number; y: number };
  /** Headlamps: "round2" = two 5¾" sealed beams per side (square-body pickup), "rect2" = stacked-pair rectangular (80s sedan). */
  lamps: "round2" | "rect2";
  lampY: number;
  grille: { y0: number; y1: number; hw: number };
  plateSerial: string;
  paint: THREE.Material;
  grilleMat: THREE.Material;
  plateMat: THREE.Material;
  wheelFace: THREE.Material;
}

interface CarMats {
  glass: THREE.Material; chrome: THREE.Material; tyre: THREE.Material; dark: THREE.Material;
  lens: THREE.Material; amber: THREE.Material; tail: THREE.Material; rubber: THREE.Material; shadow: THREE.Material;
}

/** Ring of 24 points around a station: bottom centre → right side up → top centre → left side down. */
function stationRing(s: Station): Array<[number, number]> {
  const R: Array<[number, number]> = [];
  const rS = 0.02;
  R.push([s.hwSill - rS, s.yLo]);
  for (let k = 1; k <= 2; k++) { const a = (k / 3) * Math.PI / 2; R.push([s.hwSill - rS + Math.sin(a) * rS, s.yLo + rS - Math.cos(a) * rS]); }
  R.push([s.hwSill, s.yLo + rS]);
  const yb = Math.max(s.yBelt, s.yLo + rS + 0.01);
  R.push([s.hwSill + (s.hwBelt - s.hwSill) * 0.7, s.yLo + rS + (yb - s.yLo - rS) * 0.45]); // side bulge
  R.push([s.hwBelt, yb]);
  const rT = Math.max(0.004, Math.min(s.rTop, (s.yTop - yb) * 0.9, s.hwTop * 0.5));
  R.push([s.hwTop, Math.max(yb + 0.001, s.yTop - rT)]); // tumblehome line ends here
  for (let k = 1; k <= 3; k++) { const a = (k / 4) * Math.PI / 2; R.push([s.hwTop - rT + Math.cos(a) * rT, s.yTop - rT + Math.sin(a) * rT]); }
  R.push([s.hwTop - rT, s.yTop]);
  const out: Array<[number, number]> = [[0, s.yLo], ...R, [0, s.yTop]];
  for (let i = R.length - 1; i >= 0; i--) out.push([-R[i][0], R[i][1]]);
  return out;
}

/**
 * Loft the stations into one closed body: quads between consecutive rings, triangulated end
 * caps, analytic normals (ring tangent × length tangent; one-sided at creases so the hood →
 * windshield break stays sharp while the radii shade smoothly), UVs u = z/L, v = around.
 */
function loftBody(stations: Station[], L: number): THREE.BufferGeometry {
  const rings = stations.map(stationRing);
  const N = rings[0].length;
  const P = (i: number, j: number) => new THREE.Vector3(rings[i][(j + N) % N][0], rings[i][(j + N) % N][1], stations[i].z);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const normalAt = (i: number, j: number, dir: -1 | 0 | 1) => {
    const around = P(i, j + 1).sub(P(i, j - 1));
    const back = dir <= 0 && i > 0 ? P(i - 1, j) : P(i, j);
    const fwd = dir >= 0 && i < stations.length - 1 ? P(i + 1, j) : P(i, j);
    const along = fwd.sub(back);
    if (along.lengthSq() < 1e-12) along.set(0, 0, 1);
    const n = new THREE.Vector3().crossVectors(along, around).normalize();
    const c = new THREE.Vector3(0, (stations[i].yLo + stations[i].yTop) / 2, stations[i].z);
    if (n.dot(P(i, j).sub(c)) < 0) n.negate();
    return n;
  };
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, na: THREE.Vector3, nb: THREE.Vector3, nc: THREE.Vector3, ua: number[], ub: number[], uc: number[]) => {
    const fn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const flip = fn.dot(na.clone().add(nb).add(nc)) < 0;
    const order = flip ? [[a, na, ua], [c, nc, uc], [b, nb, ub]] : [[a, na, ua], [b, nb, ub], [c, nc, uc]];
    for (const [p, n, t] of order as Array<[THREE.Vector3, THREE.Vector3, number[]]>) { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push(t[0], t[1]); }
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
      tri(a, b, c, nA[j], nA[j1], nB[j1], [uA, va], [uA, vb], [uB, vb]);
      tri(a, c, d, nA[j], nB[j1], nB[j], [uA, va], [uB, vb], [uB, va]);
    }
  }
  // End caps
  for (const [i, nz] of [[0, -1], [stations.length - 1, 1]] as Array<[number, number]>) {
    const pts = rings[i].map(([x, y]) => new THREE.Vector2(x, y));
    const n = new THREE.Vector3(0, 0, nz);
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(pts, [])) {
      const u = stations[i].z / L;
      tri(P(i, a), P(i, b), P(i, c), n, n, n, [u, a / N], [u, b / N], [u, c / N]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Rounded box (all edges radius r) via ExtrudeGeometry of a rounded rectangle. */
function roundedBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x0 = -w / 2 + r, x1 = w / 2 - r, y0 = -h / 2 + r, y1 = h / 2 - r;
  s.moveTo(x0, -h / 2); s.lineTo(x1, -h / 2); s.absarc(x1, y0, r, -Math.PI / 2, 0, false);
  s.lineTo(w / 2, y1); s.absarc(x1, y1, r, 0, Math.PI / 2, false);
  s.lineTo(x0, h / 2); s.absarc(x0, y1, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-w / 2, y0); s.absarc(x0, y0, r, Math.PI, Math.PI * 1.5, false);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.999, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(d - 2 * r) / 2);
  g.computeVertexNormals();
  return g;
}

function buildCar(b: MergedBuilder, parent: THREE.Object3D, spec: CarSpec, mats: CarMats, at: THREE.Vector3, yaw: number): void {
  const M = new THREE.Matrix4().makeRotationY(yaw).setPosition(at);
  // `noCast` is documentary only: casting is decided per material by MergedBuilder
  // (material.userData.noCast); all trim materials below are flagged, the body/tyres cast.
  const place = (g: THREE.BufferGeometry, mat: THREE.Material, _noCast = false) => {
    b.add(g, mat, M);
  };
  const box = (mat: THREE.Material, min: [number, number, number], max: [number, number, number], noCast = false) => {
    const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    place(g, mat, noCast);
  };
  const rbox = (mat: THREE.Material, min: [number, number, number], max: [number, number, number], r: number, noCast = false) => {
    const g = roundedBox(max[0] - min[0], max[1] - min[1], max[2] - min[2], r);
    g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    place(g, mat, noCast);
  };
  const { hw, length: L, wheelR: R, beltY, sillY } = spec;
  const rArch = R + 0.065;

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
      if (d < rArch) y = Math.max(y, R + Math.sqrt(rArch * rArch - d * d));
    }
    // Valances: the body drops to 0.36 under the bumpers and the ends are slightly narrower
    if (z < 0.35) y = Math.max(y, 0.36 + (0.35 - z) * 0.0);
    return y;
  };
  const zs = new Set<number>();
  for (const [z] of spec.top) zs.add(z);
  for (const wz of spec.wheelZ) for (let k = -8; k <= 8; k++) zs.add(THREE.MathUtils.clamp(wz + (k / 8) * rArch, 0, L));
  for (let z = 0; z <= L; z += 0.25) zs.add(Math.min(L, z));
  zs.add(0); zs.add(L);
  const creaseZ = new Set(spec.top.filter((t) => t[4]).map((t) => t[0]));
  const stations: Station[] = [...zs].sort((p, q) => p - q).map((z) => {
    const [yTop, hwTop, rTop] = topAt(z);
    // Plan taper: the body narrows 40 mm over the last 0.6 m at each end
    const taper = Math.min(1, Math.min(z, L - z) / 0.6);
    const hwB = hw - 0.04 * (1 - taper);
    const yLo = lowAt(z);
    return { z, yLo, yBelt: Math.max(beltY, yLo + 0.05), yTop, hwSill: hwB - 0.035, hwBelt: hwB, hwTop: Math.min(hwTop, hwB - 0.012), rTop, crease: creaseZ.has(z) };
  });
  place(loftBody(stations, L), spec.paint);

  /* ---- glass ---- */
  // Side glass: a quad on the tumblehome plane (belt → roof edge), 6 mm proud of the body
  const sideQuad = (sx: number, z0: number, z1: number, mat: THREE.Material, inset: number) => {
    const st = stations.find((s) => s.z >= (z0 + z1) / 2) ?? stations[0];
    const rT = Math.min(st.rTop, (st.yTop - st.yBelt) * 0.9);
    const a = new THREE.Vector2(st.hwBelt, st.yBelt + 0.02), c = new THREE.Vector2(st.hwTop, st.yTop - rT - 0.01);
    const n = new THREE.Vector2(c.y - a.y, -(c.x - a.x)).normalize(); // outward in (x, y)
    const g = new THREE.BufferGeometry();
    const p = [
      a.x + n.x * inset, a.y + n.y * inset, z0, c.x + n.x * inset, c.y + n.y * inset, z0,
      c.x + n.x * inset, c.y + n.y * inset, z1, a.x + n.x * inset, a.y + n.y * inset, z1,
    ];
    for (let i = 0; i < p.length; i += 3) p[i] *= sx;
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setIndex(sx > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
    g.computeVertexNormals();
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2));
    place(g, mat, true);
  };
  for (const sx of [-1, 1]) for (const gl of spec.sideGlass) sideQuad(sx, gl.z0, gl.z1, mats.glass, 0.006);
  // Windshield / backlight: a trapezoid following the roof-to-cowl taper, 6 mm proud
  for (const sc0 of spec.screens) {
    // The glass lies on the body's top line between the two crease stations: derive its z
    // extent from the requested y extent so it neither sinks into nor floats off the loft.
    const yA = topAt(sc0.zb)[0], yB = topAt(sc0.zt)[0];
    const zAt = (y: number) => sc0.zb + ((sc0.zt - sc0.zb) * (y - yA)) / (yB - yA);
    const sc = { ...sc0, zb: zAt(sc0.yb), zt: zAt(sc0.yt) };
    const baseSt = stations.find((s) => s.z >= sc.zb) ?? stations[stations.length - 1];
    const roofSt = stations.find((s) => s.z >= sc.zt) ?? stations[stations.length - 1];
    const dz = sc.zt - sc.zb, dy = sc.yt - sc.yb, l = Math.hypot(dz, dy);
    const wt = roofSt.hwTop - 0.06;
    const wb = dz > 0 ? baseSt.hwBelt - 0.07 : Math.min(baseSt.hwTop, roofSt.hwTop + 0.08) - 0.05;
    const ny = Math.abs(dz) / l, nz = dz > 0 ? -dy / l : dy / l;
    const off = 0.006;
    const p = [
      -wb, sc.yb + ny * off, sc.zb + nz * off, wb, sc.yb + ny * off, sc.zb + nz * off,
      wt, sc.yt + ny * off, sc.zt + nz * off, -wt, sc.yt + ny * off, sc.zt + nz * off,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setIndex(dz > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    place(g, mats.glass, true);
    // Wipers at the windshield base (front screen only): two dark arms lying on the glass
    if (dz > 0) {
      for (const sx of [-1, 1]) {
        const arm = new THREE.BoxGeometry(0.46, 0.012, 0.022);
        arm.rotateY(sx * 0.42);
        arm.rotateX(-Math.atan2(dy, dz)); // thin axis → glass normal
        arm.translate(sx * 0.3, sc.yb + (dy / l) * 0.07 + ny * 0.018, sc.zb + (dz / l) * 0.07 + nz * 0.018);
        place(arm, mats.rubber, true);
      }
    }
  }

  /* ---- wheels ---- */
  const tyreProfile = [
    [0.19, -0.095], [R - 0.06, -0.1], [R - 0.014, -0.086], [R, -0.07], [R, 0.07], [R - 0.014, 0.086], [R - 0.06, 0.1], [0.19, 0.095],
  ].map(([r, h]) => new THREE.Vector2(r, h));
  for (const wz of spec.wheelZ)
    for (const sx of [-1, 1]) {
      const xc = sx * (hw - 0.035 - 0.1); // tyre centre: outer sidewall 35 mm inside the flank
      const tyre = new THREE.LatheGeometry(tyreProfile, 32);
      tyre.rotateZ(sx > 0 ? -Math.PI / 2 : Math.PI / 2); // axis → x, +h outboard
      tyre.translate(xc, R, wz);
      place(tyre, mats.tyre);
      // Steel wheel face recessed 25 mm inside the sidewall, hub dome, brake drum / dark well behind
      const face = new THREE.CylinderGeometry(0.19, 0.185, 0.02, 24);
      face.rotateZ(Math.PI / 2);
      face.translate(xc + sx * 0.07, R, wz);
      place(face, spec.wheelFace, true);
      const cap = new THREE.SphereGeometry(0.075, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      cap.scale(1, 0.4, 1);
      cap.rotateZ(sx > 0 ? -Math.PI / 2 : Math.PI / 2);
      cap.translate(xc + sx * 0.08, R, wz);
      place(cap, mats.chrome, true);
      const drum = new THREE.CylinderGeometry(0.18, 0.18, 0.12, 16);
      drum.rotateZ(Math.PI / 2);
      drum.translate(xc - sx * 0.02, R, wz);
      place(drum, mats.dark, true);
      // Wheel-well liner: blocks the see-through behind the tyre, up to the arch
      box(mats.dark, [Math.min(0, sx * (hw - 0.24)), 0.18, wz - rArch], [Math.max(0, sx * (hw - 0.24)), R + rArch - 0.01, wz + rArch], true);
    }
  // Underbody mass between the wheels (frame, tank, exhaust — one dark block)
  box(mats.dark, [-hw + 0.25, sillY - 0.14, spec.wheelZ[0] + rArch], [hw - 0.25, sillY + 0.02, spec.wheelZ[1] - rArch], true);
  box(mats.dark, [-hw + 0.25, 0.26, 0.12], [hw - 0.25, 0.37, spec.wheelZ[0] - rArch], true);
  box(mats.dark, [-hw + 0.25, 0.26, spec.wheelZ[1] + rArch], [hw - 0.25, 0.37, L - 0.12], true);

  /* ---- bumpers, valance lamps, plates ---- */
  const bw = hw * 2 + 0.06;
  rbox(mats.chrome, [-bw / 2, 0.45, -0.13], [bw / 2, 0.58, 0.01], 0.03);
  rbox(mats.chrome, [-bw / 2, 0.45, L - 0.01], [bw / 2, 0.58, L + 0.13], 0.03);
  for (const sx of [-1, 1]) { // rubber bumper guards
    rbox(mats.rubber, [sx * 0.42 - 0.035, 0.44, -0.16], [sx * 0.42 + 0.035, 0.59, -0.1], 0.012, true);
    rbox(mats.rubber, [sx * 0.42 - 0.035, 0.44, L + 0.1], [sx * 0.42 + 0.035, 0.59, L + 0.16], 0.012, true);
  }
  box(spec.plateMat, [-0.1525, 0.455, -0.14], [0.1525, 0.575, -0.13], true); // front plate on the bumper
  {
    // Rear plate on the tail face, centred above the bumper
    const st = stations[stations.length - 1];
    const yP = Math.min(st.yTop - 0.12, 0.72);
    box(spec.plateMat, [-0.1525, yP - 0.076, L + 0.001], [0.1525, yP + 0.076, L + 0.012], true);
    // Tail lamps: wide red lenses with a chrome surround
    for (const sx of [-1, 1]) {
      const xc = sx * (hw - 0.3);
      box(mats.chrome, [xc - 0.24, yP - 0.085, L], [xc + 0.24, yP + 0.085, L + 0.012], true);
      box(mats.tail, [xc - 0.225, yP - 0.07, L + 0.01], [xc + 0.225, yP + 0.07, L + 0.02], true);
      box(mats.amber, [xc - sx * 0.05 - 0.05, yP - 0.06, L + 0.012], [xc - sx * 0.05 + 0.05, yP + 0.06, L + 0.022], true);
    }
  }

  /* ---- front fascia: grille, sealed beams, signals ---- */
  const g = spec.grille;
  {
    const q = new THREE.PlaneGeometry(g.hw * 2, g.y1 - g.y0);
    q.rotateY(Math.PI); // face −z
    q.translate(0, (g.y0 + g.y1) / 2, -0.012);
    place(q, spec.grilleMat, true);
    // Chrome grille surround
    box(mats.chrome, [-g.hw - 0.02, g.y1, -0.018], [g.hw + 0.02, g.y1 + 0.02, 0.0], true);
    box(mats.chrome, [-g.hw - 0.02, g.y0 - 0.02, -0.018], [g.hw + 0.02, g.y0, 0.0], true);
  }
  for (const sx of [-1, 1]) {
    const xc = sx * (g.hw + 0.02 + (hw - g.hw - 0.02) / 2 - 0.01); // centre of the lamp bay
    const yc = spec.lampY;
    if (spec.lamps === "round2") {
      rbox(mats.chrome, [xc - 0.17, yc - 0.09, -0.02], [xc + 0.17, yc + 0.09, 0.01], 0.02, true);
      for (const k of [-1, 1]) {
        const lens = new THREE.SphereGeometry(0.072, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
        lens.scale(1, 0.3, 1);
        lens.rotateX(-Math.PI / 2); // dome faces −z
        lens.translate(xc + k * 0.078, yc, -0.02);
        place(lens, mats.lens, true);
        const ring = new THREE.TorusGeometry(0.074, 0.006, 6, 20);
        ring.translate(xc + k * 0.078, yc, -0.022);
        place(ring, mats.chrome, true);
      }
    } else {
      rbox(mats.chrome, [xc - 0.19, yc - 0.1, -0.02], [xc + 0.19, yc + 0.1, 0.01], 0.015, true);
      for (const k of [-1, 1]) {
        rbox(mats.lens, [xc + k * 0.09 - 0.08, yc - 0.075, -0.03], [xc + k * 0.09 + 0.08, yc + 0.075, -0.012], 0.008, true);
      }
    }
    // Amber turn signal under the lamp bay, above the bumper
    rbox(mats.amber, [xc - 0.11, yc - 0.155, -0.03], [xc + 0.11, yc - 0.105, -0.01], 0.008, true);
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
    // Door shut lines: 3 mm dark slivers buried 30 mm into the body, 1 mm proud
    for (const dz of spec.doors) {
      const xo = flankX(beltY - 0.05, dz);
      box(mats.dark, [Math.min(sx * (xo - 0.04), sx * (xo + 0.001)), sillY + 0.03, dz - 0.0015], [Math.max(sx * (xo - 0.04), sx * (xo + 0.001)), beltY + 0.02, dz + 0.0015], true);
    }
    // Door handles: chrome pulls just under the belt, 180 mm ahead of each shut line
    for (const dz of spec.doors) {
      const xo = flankX(beltY - 0.1, dz);
      rbox(mats.chrome, [Math.min(sx * xo, sx * (xo + 0.022)), beltY - 0.115, dz - 0.19], [Math.max(sx * xo, sx * (xo + 0.022)), beltY - 0.085, dz - 0.03], 0.006, true);
    }
    // Body side moulding: black rubber strip with a chrome insert, 6 mm proud, wheel arch to wheel arch
    {
      const y = beltY - 0.28, xo = flankX(y, L / 2);
      const z0 = spec.wheelZ[0] + rArch + 0.02, z1 = spec.wheelZ[1] - rArch - 0.02;
      box(mats.rubber, [Math.min(sx * (xo - 0.02), sx * (xo + 0.007)), y - 0.025, z0], [Math.max(sx * (xo - 0.02), sx * (xo + 0.007)), y + 0.025, z1], true);
      box(mats.chrome, [Math.min(sx * (xo + 0.007), sx * (xo + 0.009)), y - 0.006, z0], [Math.max(sx * (xo + 0.007), sx * (xo + 0.009)), y + 0.006, z1], true);
    }
    // Drip rail: chrome bead along the roof edge over the side glass
    {
      const g0 = spec.sideGlass[0], g1 = spec.sideGlass[spec.sideGlass.length - 1];
      const st = stations.find((s) => s.z >= (g0.z0 + g1.z1) / 2) ?? stations[0];
      const y = st.yTop - st.rTop + 0.004, xo = st.hwTop + 0.003;
      box(mats.chrome, [Math.min(sx * (xo - 0.01), sx * (xo + 0.006)), y - 0.008, g0.z0 - 0.08], [Math.max(sx * (xo - 0.01), sx * (xo + 0.006)), y + 0.008, g1.z1 + 0.1], true);
    }
    // Door mirror on a chrome arm at the A-pillar base, painted housing, chrome face aft
    {
      const z = spec.sideGlass[0].z0 + 0.05, y = beltY + 0.2;
      const xo = flankX(y, z);
      box(mats.chrome, [Math.min(sx * xo, sx * (xo + 0.1)), y - 0.012, z - 0.012], [Math.max(sx * xo, sx * (xo + 0.1)), y + 0.012, z + 0.012], true);
      rbox(spec.paint, [Math.min(sx * (xo + 0.08), sx * (xo + 0.2)), y - 0.06, z - 0.05], [Math.max(sx * (xo + 0.08), sx * (xo + 0.2)), y + 0.06, z + 0.05], 0.015, true);
      box(mats.chrome, [Math.min(sx * (xo + 0.09), sx * (xo + 0.19)), y - 0.05, z + 0.05], [Math.max(sx * (xo + 0.09), sx * (xo + 0.19)), y + 0.05, z + 0.056], true);
    }
    // Rocker panel: dark strip along the sill (mud + shadow)
    {
      const z0 = spec.wheelZ[0] + rArch, z1 = spec.wheelZ[1] - rArch;
      const st = stations.find((s) => s.z >= L / 2) ?? stations[0];
      const xo = st.hwSill;
      box(mats.rubber, [Math.min(sx * (xo - 0.01), sx * (xo + 0.002)), sillY + 0.005, z0], [Math.max(sx * (xo - 0.01), sx * (xo + 0.002)), sillY + 0.07, z1], true);
    }
  }
  if (spec.bed) box(mats.dark, [-hw + 0.1, spec.bed.y - 0.008, spec.bed.z0], [hw - 0.1, spec.bed.y + 0.004, spec.bed.z1], true);

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

  /* ---------------- kerb stops at the stall heads ---------------- */
  const stopMat = skyFill(new THREE.MeshStandardMaterial({ color: 0xa9a49a, roughness: 0.9, metalness: 0 }), 0.22);
  for (let i = 0; i < stallLinesX.length - 1; i++) {
    if (i % 2 === 1 && rng() < 0.5) continue;
    const cx = (stallLinesX[i] + stallLinesX[i + 1]) / 2 + (rng() - 0.5) * 0.08;
    const z = LOT.kerbZ + 0.55 + (rng() - 0.5) * 0.05;
    // Precast wheel stop: 1.8 m bar, trapezoid section 220 mm at the base → 140 mm top, 130 mm high
    const sh = new THREE.Shape();
    sh.moveTo(-0.11, 0); sh.lineTo(0.11, 0); sh.lineTo(0.07, 0.13); sh.lineTo(-0.07, 0.13); sh.closePath();
    const bar = new THREE.ExtrudeGeometry(sh, { depth: 1.8, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2 });
    bar.rotateY(Math.PI / 2); // extrusion (z) → x; profile x → −z
    bar.translate(cx - 0.9, yLot, z);
    b.add(bar, stopMat);
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
    b.add(pier, stopMat);
    const chamfer = new THREE.CylinderGeometry(0.27, 0.285, 0.015, 28);
    chamfer.translate(px, pierTop - 0.0075, pz);
    b.add(chamfer, stopMat);
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
  // Glass: a dielectric (metalness 0) so the sky reflection is white Fresnel over a dark
  // tint. rev 2 used metalness 0.55 with a near-black colour, which *tints the reflection
  // black* — that is why the windshields read as uniform dark slabs while the chrome caught sky.
  const carMats: CarMats = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b1014, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6, specularIntensity: 1, side: THREE.DoubleSide }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xc4c7cb, roughness: 0.22, metalness: 1 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.85, metalness: 0 }), // sidewall shading needs a little albedo to show
    dark: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.95, metalness: 0 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x9aa4ab, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.4 }),
    amber: new THREE.MeshPhysicalMaterial({ color: 0xd9741a, roughness: 0.15, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1 }),
    tail: new THREE.MeshPhysicalMaterial({ color: 0x8a1212, roughness: 0.15, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.8, metalness: 0 }),
    shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, alphaMap: ext.contactShadowAlpha(128), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  };
  // Trim sits inside the body's silhouette (lamps in the nose, chrome on the flanks, liners
  // behind the tyres): no shadow of its own, so skip its depth draws in both maps.
  for (const m of [carMats.chrome, carMats.lens, carMats.amber, carMats.tail, carMats.rubber, carMats.dark]) m.userData.noCast = true;
  // Paint: faded clearcoat under a dust film (carDust: sills and roof/hood dusty, flanks clean)
  const dustW = ext.carDust(512, 3330), dustM = ext.carDust(512, 3331);
  const whitePaint = skyFill(new THREE.MeshPhysicalMaterial({ color: 0xdcd9ce, map: dustW.map, roughnessMap: dustW.roughnessMap, roughness: 1, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.7 }), 0.2);
  const maroonPaint = skyFill(new THREE.MeshPhysicalMaterial({ color: 0x3a1014, map: dustM.map, roughnessMap: dustM.roughnessMap, roughness: 0.85, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.22, envMapIntensity: 1 }), 0.2);
  const grilleP = ext.grilleTexture(512, 18, 6, false, 3332), grilleS = ext.grilleTexture(512, 24, 5, true, 3333);
  const grillePickup = new THREE.MeshStandardMaterial({ map: grilleP.map, roughnessMap: grilleP.roughnessMap, roughness: 1, metalness: 0.6 });
  const grilleSedan = new THREE.MeshStandardMaterial({ map: grilleS.map, roughnessMap: grilleS.roughnessMap, roughness: 1, metalness: 0.8 });
  const platePickup = new THREE.MeshStandardMaterial({ map: ext.plateTexture(256, "CVN 4187", false, 3334), roughness: 0.45, metalness: 0.1 });
  const plateSedan = new THREE.MeshStandardMaterial({ map: ext.plateTexture(256, "LKR 902", true, 3335), roughness: 0.45, metalness: 0.1 });
  const steelWheelWhite = new THREE.MeshStandardMaterial({ color: 0xd8d5cc, roughness: 0.5, metalness: 0.2 }); // painted steel wheel
  const wheelCover = new THREE.MeshStandardMaterial({ color: 0xb8bbbf, roughness: 0.3, metalness: 0.95 }); // full chrome cover
  for (const m of [grillePickup, grilleSedan, platePickup, plateSedan, steelWheelWhite, wheelCover]) m.userData.noCast = true;
  envMaterials.push(carMats.glass, carMats.chrome, carMats.lens, carMats.amber, carMats.tail, whitePaint, maroonPaint, grilleSedan, wheelCover, steelWheelWhite);

  // Dusty white single-cab square-body pickup (5.2 m, 1.8 wide, 1.80 tall), nose to the kerb stop
  const pickup: CarSpec = {
    length: 5.2, hw: 0.9, sillY: 0.42, beltY: 0.98, wheelR: 0.38, wheelZ: [1.0, 4.12],
    top: [
      [0.0, 0.90, 0.85, 0.02], [0.12, 0.94, 0.86, 0.02], [1.72, 0.99, 0.88, 0.02, true],
      [1.8, 1.04, 0.86, 0.02], [2.18, 1.74, 0.79, 0.07, true], [2.28, 1.79, 0.78, 0.08], [3.3, 1.79, 0.78, 0.08],
      [3.4, 1.74, 0.78, 0.06, true], [3.46, 1.14, 0.88, 0.02, true], [3.5, 1.10, 0.888, 0.012], [5.14, 1.10, 0.888, 0.012], [5.2, 1.02, 0.86, 0.02],
    ],
    sideGlass: [{ z0: 2.3, z1: 3.32 }],
    doors: [2.26, 3.38],
    screens: [{ zb: 1.8, zt: 2.18, yb: 1.04, yt: 1.7 }, { zb: 3.46, zt: 3.4, yb: 1.2, yt: 1.7 }],
    bed: { z0: 3.6, z1: 5.05, y: 1.1 },
    lamps: "round2", lampY: 0.75, grille: { y0: 0.62, y1: 0.86, hw: 0.36 },
    plateSerial: "CVN 4187", paint: whitePaint, grilleMat: grillePickup, plateMat: platePickup, wheelFace: steelWheelWhite,
  };
  // Maroon 3-box sedan (4.95 m, 1.8 wide, 1.42 tall), full wheel covers
  const sedan: CarSpec = {
    length: 4.95, hw: 0.9, sillY: 0.31, beltY: 0.87, wheelR: 0.35, wheelZ: [0.92, 3.8],
    top: [
      [0.0, 0.78, 0.85, 0.02], [0.12, 0.80, 0.87, 0.02], [1.8, 0.87, 0.88, 0.02, true],
      [1.9, 0.92, 0.85, 0.03], [2.44, 1.38, 0.72, 0.08, true], [2.52, 1.42, 0.71, 0.09], [3.5, 1.42, 0.71, 0.09],
      [3.58, 1.38, 0.72, 0.08, true], [4.12, 1.02, 0.86, 0.03, true], [4.2, 1.0, 0.888, 0.015], [4.88, 0.98, 0.888, 0.015], [4.95, 0.9, 0.86, 0.02],
    ],
    sideGlass: [{ z0: 2.0, z1: 2.9 }, { z0: 2.98, z1: 3.62 }],
    doors: [1.96, 2.94, 3.72],
    screens: [{ zb: 1.9, zt: 2.44, yb: 0.92, yt: 1.34 }, { zb: 4.12, zt: 3.58, yb: 1.04, yt: 1.34 }],
    lamps: "rect2", lampY: 0.7, grille: { y0: 0.61, y1: 0.78, hw: 0.34 },
    plateSerial: "LKR 902", paint: maroonPaint, grilleMat: grilleSedan, plateMat: plateSedan, wheelFace: wheelCover,
  };
  const stall = (i: number) => (stallLinesX[i] + stallLinesX[i + 1]) / 2;
  buildCar(b, parent, pickup, carMats, new THREE.Vector3(stall(4) + 0.12, yLot, LOT.kerbZ + 0.62), THREE.MathUtils.degToRad(1.5));
  buildCar(b, parent, sedan, carMats, new THREE.Vector3(stall(6) - 0.08, yLot, LOT.kerbZ + 0.7), THREE.MathUtils.degToRad(-2));

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
      if (z < LOT.wallZ + 1.5 && Math.abs(x) < 42) continue; // not in the lot
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
    plane(400, ROAD.halfW * 2 + 3.6, yLot - 0.02, ROAD.z, shoulderMat);
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

  /* ---------------- creosote bushes: 1–2 m open shrubs among the scrub ---------------- */
  {
    // Creosote (Larrea): a fan of thin dark stems from one root crown, sparse olive foliage
    // in small clumps at the stem ends — nothing like the low rounded scrub blobs, which is
    // exactly why the flat needs them. Two InstancedMeshes (stems / foliage), same matrices.
    const stemGeos: THREE.BufferGeometry[] = [], leafGeos: THREE.BufferGeometry[] = [];
    const brng = makeRng(3350);
    for (let s = 0; s < 9; s++) {
      const a = (s / 9) * Math.PI * 2 + brng() * 0.5, tilt = 0.25 + brng() * 0.3, len = 0.75 + brng() * 0.35;
      const stem = new THREE.CylinderGeometry(0.008, 0.02, len, 5);
      stem.translate(0, len / 2, 0);
      stem.rotateX(tilt);
      stem.rotateY(a);
      stemGeos.push(stem);
      const tip = new THREE.Vector3(0, len, 0).applyEuler(new THREE.Euler(tilt, a, 0, "YXZ"));
      for (let k = 0; k < 3; k++) {
        const leaf = new THREE.IcosahedronGeometry(0.11 + brng() * 0.07, 0);
        leaf.scale(1, 0.7, 1);
        leaf.translate(tip.x * (0.7 + k * 0.15) + (brng() - 0.5) * 0.12, tip.y * (0.65 + k * 0.17), tip.z * (0.7 + k * 0.15) + (brng() - 0.5) * 0.12);
        leafGeos.push(leaf);
      }
    }
    const merge = (gs: THREE.BufferGeometry[]) => {
      const pos: number[] = [], nor: number[] = [];
      for (const g of gs) {
        const ng = g.index ? g.toNonIndexed() : g;
        pos.push(...Array.from(ng.attributes.position.array));
        nor.push(...Array.from(ng.attributes.normal.array));
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      return out;
    };
    const stemMat = skyFill(new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1, metalness: 0 }), 0.2);
    const leafMat = skyFill(new THREE.MeshStandardMaterial({ color: 0x6b6e4c, roughness: 1, metalness: 0 }), 0.22);
    const N = 110;
    const stems = new THREE.InstancedMesh(merge(stemGeos), stemMat, N);
    const leaves = new THREE.InstancedMesh(merge(leafGeos), leafMat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    const yAxis = new THREE.Vector3(0, 1, 0);
    let placed = 0, tries = 0;
    while (placed < N && tries < 4000) {
      tries++;
      const r = 24 + Math.pow(rng(), 0.8) * 110, a = rng() * Math.PI * 2;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (z < LOT.wallZ + 2 && Math.abs(x) < 42) continue;
      if (z < ROOM.zBack - 4 && Math.abs(x) < 12) continue;
      if (Math.abs(z - ROAD.z) < ROAD.halfW + 1.5) continue;
      const h = 1.0 + rng() * 1.0; // 1–2 m tall
      s.set(h * (0.85 + rng() * 0.3), h, h * (0.85 + rng() * 0.3));
      q.setFromAxisAngle(yAxis, rng() * Math.PI * 2);
      p.set(x, yLot - 0.03, z);
      m.compose(p, q, s);
      stems.setMatrixAt(placed, m);
      leaves.setMatrixAt(placed, m);
      c.setRGB(0.42 + rng() * 0.12, 0.44 + rng() * 0.1, 0.3 + rng() * 0.08); // dusty olive, not lawn green
      leaves.setColorAt(placed, c);
      placed++;
    }
    stems.count = leaves.count = placed;
    stems.instanceMatrix.needsUpdate = leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    stems.name = "creosote-stems"; leaves.name = "creosote";
    stems.frustumCulled = leaves.frustumCulled = false;
    parent.add(stems, leaves);
  }
  buildHorizon(parent);
  const sky = buildSky(sunDir);
  parent.add(sky);

  b.build(parent, { name: "exterior" });
  parent.traverse((o) => { o.userData.lotCaster = true; });
  return { envMaterials, sky };
}
