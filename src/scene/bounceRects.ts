/**
 * System 4 rev 6, step 5 — first bounce of the sun patches as rectangle form factors.
 *
 * Rev 2–5 stood one Lambertian SpotLight per booth in for the sunlit floor / table / bench
 * (Lighting.ts BOUNCE_FLUX): right in the far field, wrong within a patch width — a point
 * with a cos lobe lights the ceiling above it as if the whole patch sat under one tile and
 * gives a wall at the patch's own height nothing at all. The port (survey #7, sedona-sunset
 * `sky.js` s4GroundBand: irradiance from the sunlit floor as a closed-form term added to
 * `irradiance` at three's light-probe line) evaluates the exact irradiance a fragment gets
 * from each sunlit rectangle as a uniform Lambertian emitter:
 *
 *   E = (L / 2) · Σ_edges γ_i · (n · Γ_i)
 *
 * (Lambert's contour integral: γ_i the angle the edge subtends at the fragment, Γ_i the unit
 * normal of the plane through the fragment and the edge; a full hemisphere gives π L). The
 * rectangles are the beam footprints themselves — the window opening carried along the sun
 * vector to the floor, table zone, bench front and end wall — with radiance E_patch · ρ / π,
 * so the ceiling-to-wall ratio is geometry, not a spot's placement.
 *
 * The dielectrics' probe is captured with the interior sun off (Diner.ts), so this is the
 * only first bounce they see; it is unoccluded, like the spots were.
 */
import * as THREE from "three";
import { BOOTH, DOOR, ROOM, WINDOW } from "./layout";
import { SLAT } from "./slatShadow";

export interface BounceQuad {
  /** Four world-space corners, counter-clockwise seen from the emitting side. */
  v: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
  /** Radiance in nits, per channel. */
  radiance: THREE.Vector3;
  name: string;
}

export interface BounceParams {
  /** Direct normal illuminance (lux) and the sun's unit vector toward the sun. */
  sunLux: number;
  sun: THREE.Vector3;
  /** Glass transmittance and the blinds' beam transmittance (open fraction). */
  glass: number;
  slatOpen: number;
}

// Linear albedos. Floor: the checker (procedural/textures.ts) is off-white sRGB 220 (0.72) and
// charcoal 30 (0.013) in equal parts — mean 0.36, not the 0.47 of a plain light tile that
// rev 2 used (−0.4 EV of bounce). Table laminate cream, bench red vinyl (#AA1A15), wall khaki.
const RHO_FLOOR = new THREE.Vector3(0.365, 0.35, 0.325);
const RHO_TABLE = new THREE.Vector3(0.9, 0.85, 0.75);
const RHO_SEAT = new THREE.Vector3(0.4, 0.01, 0.007);
const RHO_WALL = new THREE.Vector3(0.5, 0.46, 0.36);

/** Point on the ray from `o` along −sun at parameter t. */
const along = (o: THREE.Vector3, s: THREE.Vector3, t: number) => o.clone().addScaledVector(s, -t);

export function bounceQuads(p: BounceParams): BounceQuad[] {
  const s = p.sun;
  const quads: BounceQuad[] = [];
  const openW = WINDOW.width - 2 * SLAT.frameFace;
  const yLo = WINDOW.sill + SLAT.frameFace, yHi = WINDOW.head - SLAT.frameFace - SLAT.headrailH;
  const zF = ROOM.zFront;
  // Illuminance on a plane of normal n from the beam: E = sunLux · glass · open · max(0, n·s).
  const E = (n: THREE.Vector3, open = p.slatOpen) => p.sunLux * p.glass * open * Math.max(0, n.dot(s));
  const rad = (Elux: number, rho: THREE.Vector3) => rho.clone().multiplyScalar(Elux / Math.PI);
  const UP = new THREE.Vector3(0, 1, 0), PX = new THREE.Vector3(1, 0, 0);
  // Beam parameter t at which a window point of height y reaches height yTarget, or plane z.
  const tToY = (y: number, yTarget: number) => (y - yTarget) / s.y;
  const tToZ = (zTarget: number) => (zF - zTarget) / s.z;

  WINDOW.centersX.forEach((cx, wi) => {
    const x0 = cx - openW / 2, x1 = cx + openW / 2;
    const tWall = (x0 + ROOM.halfX) / s.x; // the −x edge of the beam meets the end wall
    if (tWall < tToY(yHi, 0) * 0.6) {
      // Window 0: most of the beam meets the −x end wall before the floor (Lighting.ts rev 2
      // note). Band on the wall: from where the beam's low edge lands to where its top does.
      const tA = (x0 + ROOM.halfX) / s.x, tB = (x1 + ROOM.halfX) / s.x;
      const xw = -ROOM.halfX + 0.01;
      const zA = zF - s.z * tA, zB = zF - s.z * tB;
      const yTop = Math.min(yHi - s.y * tA, 1.6), yBot = 0.0;
      quads.push({
        name: `wall-patch-${wi}`,
        v: [new THREE.Vector3(xw, yBot, zA), new THREE.Vector3(xw, yBot, zB), new THREE.Vector3(xw, yTop, zB), new THREE.Vector3(xw, yTop, zA)],
        radiance: rad(E(PX), RHO_WALL),
      });
      return;
    }
    // Aisle floor: the part of the beam that clears the booth before y = 0 — over the table
    // top (BOOTH.table.top at the table's aisle edge) and, for the rays that are still inside
    // the booth when they reach it, over the −x bench's back (BOOTH.back.top at x = cx −
    // frontX). The bench clearance depends on where in the window the ray starts: a ray from
    // the −x jamb reaches the bench plane after 0.25 m and needs 1.1 m of height, one from
    // 0.22 m right of centre reaches the aisle edge first and the bench cannot block it. So
    // the lit floor is a trapezoid under the window's upper-left plus the strip to its right,
    // about half the full footprint. Rev 2–5's spots carried the whole footprint's flux (the
    // "ceiling a stop too bright" of every review).
    const tAisle = tToZ(BOOTH.zInner);
    const zTableAisle = BOOTH.zOuter - BOOTH.table.inset - BOOTH.table.width;
    const yTable = BOOTH.table.top + s.y * tToZ(zTableAisle); // window height that just clears the table's aisle edge
    const xBench = cx - BOOTH.back.frontX;
    const uSplit = THREE.MathUtils.clamp(s.x * tAisle - BOOTH.back.frontX, -openW / 2, openW / 2); // window offset past which the ray leaves the booth before the bench plane
    const yBench = (xw: number) => BOOTH.back.top + (s.y / s.x) * (xw - xBench);
    const floorQuad = (xa: number, ya: number, xb: number, yb: number, name: string) => {
      ya = THREE.MathUtils.clamp(ya, yLo, yHi); yb = THREE.MathUtils.clamp(yb, yLo, yHi);
      if (ya >= yHi - 0.02 && yb >= yHi - 0.02) return;
      const a = along(new THREE.Vector3(xa, ya, zF), s, tToY(ya, 0));
      const b = along(new THREE.Vector3(xb, yb, zF), s, tToY(yb, 0));
      const c = along(new THREE.Vector3(xb, yHi, zF), s, tToY(yHi, 0));
      const d = along(new THREE.Vector3(xa, yHi, zF), s, tToY(yHi, 0));
      quads.push({ name, v: [a, b, c, d], radiance: rad(E(UP), RHO_FLOOR) });
    };
    const xs = cx + uSplit;
    floorQuad(x0, Math.max(yTable, yBench(x0)), xs, Math.max(yTable, yBench(xs)), `floor-${wi}a`);
    if (xs < x1 - 0.02) floorQuad(xs, yTable, x1, yTable, `floor-${wi}b`);
    // Booth zone: the low part of the beam lands on the table top and the seats. One
    // horizontal patch at the table height over the booth's depth, laminate + vinyl mix.
    {
      const yT = BOOTH.table.top;
      const yB = Math.min(yHi, Math.max(yLo, yTable)); // rows below this land on the table or the seats
      const a = along(new THREE.Vector3(x0, yLo, zF), s, tToY(yLo, yT));
      const b = along(new THREE.Vector3(x1, yLo, zF), s, tToY(yLo, yT));
      const c = along(new THREE.Vector3(x1, yB, zF), s, tToY(yB, yT));
      const d = along(new THREE.Vector3(x0, yB, zF), s, tToY(yB, yT));
      for (const q of [a, b, c, d]) q.z = THREE.MathUtils.clamp(q.z, BOOTH.zInner, BOOTH.zOuter - 0.1);
      // What those rows land on: the table top (0.3 m² of cream), the −x seat (red) and the −x
      // bench front — the last is the vertical rect below and must not be counted twice, so
      // the horizontal patch carries 0.6 of the rows' flux at a 40/60 laminate/vinyl mix.
      const rho = RHO_TABLE.clone().multiplyScalar(0.4).addScaledVector(RHO_SEAT, 0.6).multiplyScalar(0.6);
      quads.push({ name: `booth-${wi}`, v: [a, b, c, d], radiance: rad(E(UP), rho) });
    }
    // The lit −x bench front (seat riser + back), a vertical red panel facing +x.
    {
      const xb = cx - BOOTH.back.frontX + 0.02;
      const z0 = BOOTH.zInner + 0.05, z1 = BOOTH.zOuter - 0.05;
      // The table shades the seat riser: the lit vinyl is the seat's front edge and the back.
      const y0 = 0.45, y1 = BOOTH.back.top;
      quads.push({
        name: `bench-${wi}`,
        v: [new THREE.Vector3(xb, y0, z1), new THREE.Vector3(xb, y0, z0), new THREE.Vector3(xb, y1, z0), new THREE.Vector3(xb, y1, z1)],
        radiance: rad(E(PX), RHO_SEAT),
      });
    }
  });
  // The door leaf's clear glass, no blinds (Lighting.ts rev 3 note): 0.69 × 1.69 m, lands on
  // the vestibule floor 0.4–2.8 m inside the wall.
  {
    const gw = 0.692, gy0 = 0.28, gy1 = 0.28 + 1.692;
    const x0 = DOOR.centerX - gw / 2, x1 = DOOR.centerX + gw / 2;
    const a = along(new THREE.Vector3(x0, gy0, zF), s, tToY(gy0, 0));
    const b = along(new THREE.Vector3(x1, gy0, zF), s, tToY(gy0, 0));
    const c = along(new THREE.Vector3(x1, gy1, zF), s, tToY(gy1, 0));
    const d = along(new THREE.Vector3(x0, gy1, zF), s, tToY(gy1, 0));
    quads.push({ name: "door-floor", v: [a, b, c, d], radiance: rad(E(UP, 1), RHO_FLOOR) });
  }
  return quads;
}

/**
 * GLSL: `bounceIrradiance( vec3 p, vec3 n )` in three's `irradiance` units (lux × K), from the
 * baked quad list. `k` converts nits to shader units (Lighting.ts `nits()`).
 */
export function bounceRectsGlsl(quads: BounceQuad[], k: number): string {
  const f = (v: number) => (Math.abs(v) < 1e-6 ? "0.0" : v.toFixed(5));
  const verts = quads.flatMap((q) => q.v.map((v) => `vec3( ${f(v.x)}, ${f(v.y)}, ${f(v.z)} )`)).join(", ");
  const rads = quads.map((q) => `vec3( ${f(q.radiance.x * k)}, ${f(q.radiance.y * k)}, ${f(q.radiance.z * k)} )`).join(", ");
  const n = quads.length;
  if (n === 0) return `vec3 bounceIrradiance( vec3 p, vec3 n ) { return vec3( 0.0 ); }`;
  return /* glsl */ `
  // ---- sun-patch first bounce, rectangle form factors (src/scene/bounceRects.ts) ----
  #define BOUNCE_N ${n}
  const vec3 BOUNCE_V[${n * 4}] = vec3[${n * 4}]( ${verts} );
  const vec3 BOUNCE_L[BOUNCE_N] = vec3[BOUNCE_N]( ${rads} );
  // γ · (n · Γ) for one edge; an edge of (near) zero length contributes nothing rather than the
  // garbage a normalised zero cross product gives (a collapsed corner cost a stop of fill once).
  float bounceEdge( vec3 a, vec3 b, vec3 n ) {
    vec3 c = cross( a, b );
    float l = length( c );
    if ( l < 1e-5 ) return 0.0;
    return acos( clamp( dot( a, b ), -1.0, 1.0 ) ) * dot( n, c / l );
  }
  vec3 bounceIrradiance( vec3 p, vec3 n ) {
    vec3 acc = vec3( 0.0 );
    for ( int i = 0; i < BOUNCE_N; i ++ ) {
      vec3 v0 = normalize( BOUNCE_V[ 4 * i ] - p );
      vec3 v1 = normalize( BOUNCE_V[ 4 * i + 1 ] - p );
      vec3 v2 = normalize( BOUNCE_V[ 4 * i + 2 ] - p );
      vec3 v3 = normalize( BOUNCE_V[ 4 * i + 3 ] - p );
      float ff = bounceEdge( v0, v1, n ) + bounceEdge( v1, v2, n ) + bounceEdge( v2, v3, n ) + bounceEdge( v3, v0, n );
      // Signed (corners counter-clockwise from the emitting side put the sum negative for a
      // fragment on that side): a fragment behind the emitting face, or facing away, gets
      // nothing. Checked against the parallel-rectangle form factor (E/L 1.741 for a 2×2 patch
      // 1 m below a downward-facing point) in /tmp ff.mjs before shipping.
      acc += BOUNCE_L[ i ] * max( -ff, 0.0 ) * 0.5;
    }
    return acc;
  }
  `;
}
