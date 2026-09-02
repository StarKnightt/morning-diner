/**
 * Upholstery geometry: pillowed cushions with analytic normals, welt piping
 * along seams, channel-tufted back panels. Everything here carries a vertex
 * colour attribute (the vinyl material multiplies by it for edge wear) and
 * metric UVs so the crazing texture tiles at a constant physical scale.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/** Attach a constant vertex colour (default: no wear). */
export function plainColor(g: THREE.BufferGeometry, v = 1): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3).fill(v);
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}

/** Replace UVs with a metric projection chosen per vertex from the dominant normal axis. */
export function metricUv(g: THREE.BufferGeometry, jitter: number | { u: number; v: number; flip: boolean } = 0): void {
  const j = typeof jitter === "number" ? { u: jitter, v: jitter, flip: false } : jitter;
  const p = g.attributes.position, nrm = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    let u: number, v: number;
    if (ny >= nx && ny >= nz) { u = p.getX(i); v = p.getZ(i); }
    else if (nz >= nx) { u = p.getX(i); v = p.getY(i); }
    else { u = p.getZ(i); v = p.getY(i); }
    if (j.flip) { u = -u; v = -v; }
    uv[i * 2] = u + j.u;
    uv[i * 2 + 1] = v + j.v;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface CushionOptions {
  /** Dome height of the top face. */
  bulge: number;
  /** Which face bellies outward (world axis of the cushion's front), or none. */
  belly?: "+x" | "-x" | "+z" | "-z" | "none";
  bellyAmount?: number;
  /** Edge-wear strength (0..1) → vertex colour lightening toward edges. */
  wear?: number;
  segments?: number;
  /** Seat sag: dips in the top face at these z positions (local), each `depth` deep over a ~0.22 m radius. */
  sags?: Array<{ z: number; depth: number }>;
}

/**
 * Pillowed cushion centred on the origin: w (x) × h (y) × d (z), edge radius
 * `r`. Top face domed, one side face bellied, normals fixed analytically,
 * edges lightened for wear. Translate afterwards.
 */
export function cushionGeometry(w: number, h: number, d: number, r: number, o: CushionOptions): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, o.segments ?? 6, Math.min(r, h / 2 - 1e-3));
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const belly = o.belly ?? "none";
  const bellyAmt = o.bellyAmount ?? o.bulge * 0.6;
  const wear = o.wear ?? 0.5;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    // Top dome
    const cxw = Math.cos((Math.PI * x) / w), czd = Math.cos((Math.PI * z) / d);
    const wt = Math.max(0, ny) ** 1.5;
    const b = o.bulge * cxw * czd;
    const bx = -o.bulge * (Math.PI / w) * Math.sin((Math.PI * x) / w) * czd;
    const bz = -o.bulge * (Math.PI / d) * cxw * Math.sin((Math.PI * z) / d);
    y += b * wt;
    nx -= bx * wt; nz -= bz * wt;
    // Sit-position sag: gaussian dips, strongest at the seat centre-line front half.
    if (o.sags) {
      for (const sg of o.sags) {
        const r2 = ((z - sg.z) / 0.2) ** 2 + (x / (w * 0.45)) ** 2;
        const gauss = Math.exp(-r2);
        y -= sg.depth * gauss * wt;
        // d/dz of -depth·exp(-r2) = depth·gauss·2(z-zi)/0.2²
        nz -= sg.depth * gauss * (2 * (z - sg.z)) / (0.2 * 0.2) * wt;
        nx -= sg.depth * gauss * (2 * x) / ((w * 0.45) ** 2) * wt;
      }
    }
    // Belly on the front face
    if (belly !== "none") {
      const axis = belly[1], sign = belly[0] === "+" ? 1 : -1;
      const nf = axis === "x" ? nx * sign : nz * sign;
      const wf = Math.max(0, nf) ** 1.5;
      const cy = Math.cos((Math.PI * y) / h);
      const cAcross = axis === "x" ? czd : cxw;
      const bb = bellyAmt * cy * cAcross;
      const dAcross = axis === "x"
        ? -bellyAmt * (Math.PI / d) * cy * Math.sin((Math.PI * z) / d)
        : -bellyAmt * (Math.PI / w) * cy * Math.sin((Math.PI * x) / w);
      const dy = -bellyAmt * (Math.PI / h) * Math.sin((Math.PI * y) / h) * cAcross;
      if (axis === "x") { x += sign * bb * wf; nz -= dAcross * wf * sign; }
      else { z += sign * bb * wf; nx -= dAcross * wf * sign; }
      ny -= dy * wf * sign;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    p.setXYZ(i, x, y, z);
    n.setXYZ(i, nx / len, ny / len, nz / len);
    // Edge wear: sum of the two largest normalised coordinates → 2 at an edge, 1 on a face centre.
    const a = [Math.abs(x) / (w / 2), Math.abs(y) / (h / 2), Math.abs(z) / (d / 2)].sort((u, v) => v - u);
    const k = smooth(1.55, 1.98, a[0] + a[1]) * wear;
    col[i * 3] = 1 + k * 0.08;
    col[i * 3 + 1] = 1 + k * 0.35;
    col[i * 3 + 2] = 1 + k * 0.3;
  }
  p.needsUpdate = true;
  n.needsUpdate = true;
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  metricUv(g);
  return g;
}

/** Welt cord along a closed or open polyline, radius ~2.5 mm. */
export function piping(points: THREE.Vector3[], radius: number, closed: boolean, segmentsPerMetre = 40): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, closed, "centripetal");
  const len = curve.getLength();
  const g = new THREE.TubeGeometry(curve, Math.max(8, Math.round(len * segmentsPerMetre)), radius, 8, closed);
  return plainColor(g, 1.04);
}

/** Rounded-rectangle outline in the xz plane at height y, corner radius r. */
export function roundedRectPoints(x0: number, z0: number, x1: number, z1: number, y: number, r: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const corners: Array<[number, number, number]> = [
    [x1 - r, z1 - r, 0], [x0 + r, z1 - r, Math.PI / 2], [x0 + r, z0 + r, Math.PI], [x1 - r, z0 + r, -Math.PI / 2],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let k = 0; k <= 4; k++) {
      const a = a0 + (k / 4) * (Math.PI / 2);
      pts.push(new THREE.Vector3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r));
    }
  }
  return pts;
}

export interface ChannelPanel {
  geometry: THREE.BufferGeometry;
  /** Local x of every valley (between channels), for the welt cords. */
  valleys: number[];
}

/**
 * Channel-tufted (sewn) back panel: PlaneGeometry w × h in xy facing +z.
 * Channels of ~`pitch` (each ±10 %) crown `depth` toward +z. The valleys are
 * shallow (6 mm under the crowns, steep-footed) because the 6 mm welt cord is
 * sewn ON the seam, proud of the surface — see Booths.ts, which lays the cords at
 * `depth` + 1 mm. Vertex colour darkens 6–7 mm either side of every valley (the
 * cord's line shadow) and the last ~30 mm of each channel gathers into 6 puckers
 * of ±3 mm where it dives under the head roll / seat seam. The crowns fade to
 * zero at the panel's outer edge so it can sit 2–3 mm inside a flat backing.
 */
export function channelPanel(w: number, h: number, pitch: number, depth: number, seed = 1): ChannelPanel {
  const rng = (() => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const n = Math.max(1, Math.round(w / pitch));
  // Channel widths ±10 %, normalised to fill w.
  const raw = Array.from({ length: n }, () => 0.9 + rng() * 0.2);
  const sum = raw.reduce((a, b) => a + b, 0);
  const bounds = [-w / 2];
  for (let k = 0; k < n; k++) bounds.push(bounds[k] + (raw[k] / sum) * w);
  const valleys = bounds.slice(1, -1);
  const segX = n * 18, segY = 64;
  const valleyDrop = 0.005; // fabric sits 5 mm under the crown at the cord: a 1–2 mm dip below the cord's underside
  const g = new THREE.PlaneGeometry(w, h, segX, segY);
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    let k = 0;
    while (k < n - 1 && x > bounds[k + 1]) k++;
    const cw = bounds[k + 1] - bounds[k];
    const u = Math.min(1, Math.max(0, (x - bounds[k]) / cw)); // 0..1 across this channel
    // Crown: a rounded pillow (sin^0.9) — the old sin^0.35 was flat across 80 % of the
    // channel and the field read as a plane between the cords.
    const pleat = Math.sin(Math.PI * u) ** 0.9;
    const env = smooth(0, 0.06, 0.5 - Math.abs(y) / h) * smooth(0, 0.03, 0.5 - Math.abs(x) / w);
    // Gathers where the channel is tucked under the roll seam (top) and the seat seam (bottom).
    const top = h / 2 - y, bot = y + h / 2;
    const tuck = Math.exp(-((top / 0.018) ** 2)) + 0.7 * Math.exp(-((bot / 0.018) ** 2));
    const pucker = Math.abs(Math.sin(Math.PI * u * 6)) * tuck;
    const z = (depth - valleyDrop + valleyDrop * pleat + pucker * 0.003 * pleat) * env;
    p.setZ(i, z);
    // Crowns pick up the light; the seam's cord throws a line shadow 6–7 mm either side.
    const dv = Math.min(u, 1 - u) * cw;
    const seamShade = k === 0 && u < 0.5 ? 0 : k === n - 1 && u > 0.5 ? 0 : Math.exp(-((dv / 0.0065) ** 2)) * 0.32;
    const shade = (0.86 + 0.14 * pleat) * (1 - seamShade) * (1 - 0.22 * pucker);
    col[i * 3] = shade; col[i * 3 + 1] = shade; col[i * 3 + 2] = shade;
    uv.setXY(i, x + w / 2, y + h / 2);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return { geometry: g, valleys };
}
