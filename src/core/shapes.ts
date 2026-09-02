/**
 * Plan-view shape helpers for furniture slabs: polygon offsetting, rounded
 * corners, and extruded slabs with a bullnose bevel and a chrome edge band.
 * Points are world (x, z); slabs are extruded along +y.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type XZ = [number, number];

function signedArea(pts: XZ[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

/** Miter-offset a closed polygon outward by `d` (negative = inward). */
export function offsetPolygon(pts: XZ[], d: number): XZ[] {
  const n = pts.length;
  const sign = signedArea(pts) > 0 ? 1 : -1;
  const out: XZ[] = [];
  for (let i = 0; i < n; i++) {
    const [px, pz] = pts[i];
    const [ax, az] = pts[(i - 1 + n) % n];
    const [bx, bz] = pts[(i + 1) % n];
    let e1x = px - ax, e1z = pz - az, e2x = bx - px, e2z = bz - pz;
    const l1 = Math.hypot(e1x, e1z) || 1, l2 = Math.hypot(e2x, e2z) || 1;
    e1x /= l1; e1z /= l1; e2x /= l2; e2z /= l2;
    // Outward normals (for a CCW polygon in x/z the outward normal is (ez, -ex)).
    const n1x = e1z * sign, n1z = -e1x * sign;
    const n2x = e2z * sign, n2z = -e2x * sign;
    const dot = n1x * n2x + n1z * n2z;
    const k = d / Math.max(0.2, 1 + dot);
    out.push([px + (n1x + n2x) * k, pz + (n1z + n2z) * k]);
  }
  return out;
}

/** Closed path with rounded corners. `radius` may be per-vertex. */
export function roundedPath<T extends THREE.Path>(path: T, pts: XZ[], radius: number | number[]): T {
  const n = pts.length;
  const r = (i: number) => (Array.isArray(radius) ? radius[i] : radius);
  const corner = (i: number) => {
    const [px, pz] = pts[i];
    const [ax, az] = pts[(i - 1 + n) % n];
    const [bx, bz] = pts[(i + 1) % n];
    const l1 = Math.hypot(px - ax, pz - az), l2 = Math.hypot(bx - px, bz - pz);
    const rr = Math.min(r(i), l1 * 0.49, l2 * 0.49);
    const sx = px + ((ax - px) / l1) * rr, sz = pz + ((az - pz) / l1) * rr;
    const ex = px + ((bx - px) / l2) * rr, ez = pz + ((bz - pz) / l2) * rr;
    return { sx, sz, ex, ez, px, pz, rr };
  };
  const c0 = corner(0);
  // Shape space: (sx, sy) = (x, -z) so that rotateX(-PI/2) lands on world xz.
  path.moveTo(c0.sx, -c0.sz);
  for (let i = 0; i < n; i++) {
    const c = corner(i);
    path.lineTo(c.sx, -c.sz);
    if (c.rr > 1e-4) path.quadraticCurveTo(c.px, -c.pz, c.ex, -c.ez);
  }
  path.closePath();
  return path;
}

export interface SlabOptions {
  /** Corner radius (plan), per vertex or uniform. */
  radius: number | number[];
  /** Bottom face y. */
  y0: number;
  thickness: number;
  /** Edge bevel/bullnose radius. */
  bevel: number;
  /** Chrome band height; 0 for none. */
  bandHeight?: number;
  /** How far the band stands proud of the slab outline. */
  bandProud?: number;
  /** Number of grooves (grooved T-mould) centred on the band, 6 mm pitch, returned as a third geometry. */
  grooves?: number;
  curveSegments?: number;
}

/**
 * Extruded slab whose plan outline is `pts`, with a quarter-round bevel on
 * top and bottom edges and an optional metal band wrapping the edge at mid
 * height. Returns [slabGeometry, bandGeometry | null].
 */
export function slabGeometry(pts: XZ[], o: SlabOptions): [THREE.BufferGeometry, THREE.BufferGeometry | null, THREE.BufferGeometry | null] {
  const bevel = Math.min(o.bevel, o.thickness / 2 - 0.0005);
  const inset = offsetPolygon(pts, -bevel);
  const radii = Array.isArray(o.radius) ? o.radius.map((r) => Math.max(0.0005, r - bevel)) : Math.max(0.0005, o.radius - bevel);
  const shape = roundedPath(new THREE.Shape(), inset, radii);
  const slab = new THREE.ExtrudeGeometry(shape, {
    depth: o.thickness - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: 4,
    curveSegments: o.curveSegments ?? 6,
  });
  slab.rotateX(-Math.PI / 2);
  slab.translate(0, o.y0 + bevel, 0);

  let band: THREE.BufferGeometry | null = null;
  let grooves: THREE.BufferGeometry | null = null;
  if (o.bandHeight && o.bandHeight > 0) {
    const proud = o.bandProud ?? 0.003;
    const outer = roundedPath(new THREE.Shape(), offsetPolygon(pts, proud), o.radius);
    const hole = roundedPath(new THREE.Path(), offsetPolygon(pts, -0.012), o.radius);
    outer.holes.push(hole);
    band = new THREE.ExtrudeGeometry(outer, { depth: o.bandHeight, bevelEnabled: false, curveSegments: o.curveSegments ?? 6 });
    band.rotateX(-Math.PI / 2);
    band.translate(0, o.y0 + o.thickness / 2 - o.bandHeight / 2, 0);
    // Returned lower lip: the T-mould's leg folds under the slab edge by 8 mm.
    const lipOuter = roundedPath(new THREE.Shape(), offsetPolygon(pts, proud), o.radius);
    lipOuter.holes.push(roundedPath(new THREE.Path(), offsetPolygon(pts, -0.008), o.radius));
    const lip = new THREE.ExtrudeGeometry(lipOuter, { depth: 0.0015, bevelEnabled: false, curveSegments: o.curveSegments ?? 6 });
    lip.rotateX(-Math.PI / 2);
    lip.translate(0, o.y0 - 0.0015 + 0.0015, 0);
    band = mergeGeometries([band, lip].map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
    if (o.grooves && o.grooves > 0) {
      // Grooves: 2 mm dark recessed lines on the band face at 6 mm pitch (a separate, darker material).
      const rings: THREE.BufferGeometry[] = [];
      const gOuter = roundedPath(new THREE.Shape(), offsetPolygon(pts, proud + 0.0003), o.radius);
      gOuter.holes.push(roundedPath(new THREE.Path(), offsetPolygon(pts, proud - 0.0015), o.radius));
      const pitch = 0.006, gH = 0.002;
      const y0 = o.y0 + o.thickness / 2 - ((o.grooves - 1) * pitch) / 2;
      for (let k = 0; k < o.grooves; k++) {
        const g = new THREE.ExtrudeGeometry(gOuter, { depth: gH, bevelEnabled: false, curveSegments: o.curveSegments ?? 6 });
        g.rotateX(-Math.PI / 2);
        g.translate(0, y0 + k * pitch - gH / 2, 0);
        rings.push(g);
      }
      grooves = mergeGeometries(rings, false)!;
    }
  }
  return [slab, band, grooves];
}

/** Axis-aligned rectangle as plan points, from min/max corners. */
export function rectXZ(x0: number, z0: number, x1: number, z1: number): XZ[] {
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

/**
 * Trapezoid prism (for reclined booth backs): a 2D profile in the xy plane
 * extruded along z from z0 to z1. Profile points are (x, y).
 */
export function prismXY(profile: Array<[number, number]>, z0: number, z1: number, bevel = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const inset = bevel > 0 ? offsetPolygon(profile as XZ[], -bevel) : (profile as XZ[]);
  inset.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: z1 - z0 - 2 * bevel,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
  });
  g.translate(0, 0, z0 + bevel);
  return g;
}
