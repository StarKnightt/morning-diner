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
  /** Rev 7: the sun's chroma at unit luminance — the bounce is as warm as the beam. */
  sunColor?: THREE.Vector3;
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
  const tint = p.sunColor ?? new THREE.Vector3(1, 1, 1);
  const rad = (Elux: number, rho: THREE.Vector3) => rho.clone().multiply(tint).multiplyScalar(Elux / Math.PI);
  const UP = new THREE.Vector3(0, 1, 0), PX = new THREE.Vector3(1, 0, 0), PZ = new THREE.Vector3(0, 0, 1);
  const zBackIn = ROOM.zBack + 0.01, xEndIn = -ROOM.halfX + 0.01;
  /**
   * Rev 7 (evening, sun 9° up): a window band [ya..yb] × [xa..xb] traced along −s meets the
   * FIRST of the floor (y = 0), the kitchen partition (z = zBack) or the −x end wall — at 9°
   * the beam from the upper half of every window crosses the whole room and lands on the
   * partition, the back bar and the counter, not the floor (t to the floor from the head:
   * 13 m; to the partition: 7.5 m). The plane is chosen by the band's centre ray, every
   * corner is projected onto it and clamped into the room box. Morning (35°) reproduces the
   * old floor / wall-patch split exactly (the wall test was `tWall < 0.6·tFloor`).
   */
  const landQuad = (xa: number, ya: number, xb: number, yb: number, yTop: number, name: string, open = p.slatOpen) => {
    ya = THREE.MathUtils.clamp(ya, yLo, yTop); yb = THREE.MathUtils.clamp(yb, yLo, yTop);
    if (ya >= yTop - 0.02 && yb >= yTop - 0.02) return;
    const yc = (ya + yb + 2 * yTop) / 4, xc = (xa + xb) / 2;
    const tF = yc / s.y, tB = (zF - zBackIn) / s.z, tW = (xc - xEndIn) / s.x;
    const plane = tF <= tB && tF <= tW ? "floor" : tB <= tW ? "back" : "end";
    const corner = (x: number, y: number) => {
      const t = plane === "floor" ? y / s.y : plane === "back" ? tB : (x - xEndIn) / s.x;
      const q = along(new THREE.Vector3(x, y, zF), s, t);
      q.x = THREE.MathUtils.clamp(q.x, xEndIn, ROOM.halfX - 0.01);
      q.y = THREE.MathUtils.clamp(q.y, 0, yTop);
      q.z = THREE.MathUtils.clamp(q.z, zBackIn, zF - 0.01);
      return q;
    };
    const v: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] = [corner(xa, ya), corner(xb, yb), corner(xb, yTop), corner(xa, yTop)];
    const radiance = plane === "floor" ? rad(E(UP, open), RHO_FLOOR) : plane === "back" ? rad(E(PZ, open), RHO_WALL) : rad(E(PX, open), RHO_WALL);
    quads.push({ name: `${name}-${plane}`, v, radiance });
  };
  // Beam parameter t at which a window point of height y reaches height yTarget, or plane z.
  const tToY = (y: number, yTarget: number) => (y - yTarget) / s.y;
  const tToZ = (zTarget: number) => (zF - zTarget) / s.z;

  WINDOW.centersX.forEach((cx, wi) => {
    const x0 = cx - openW / 2, x1 = cx + openW / 2;
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
    const xs = cx + uSplit;
    // Three height bands per strip so a beam that lands half on the floor and half on the
    // partition gets a quad on each (rev 7).
    const bands = (xa: number, ya: number, xb: number, yb: number, name: string) => {
      const yFrom = Math.min(ya, yb);
      for (let k = 0; k < 3; k++) {
        const fa = k / 3, fb = (k + 1) / 3;
        const yTop = THREE.MathUtils.lerp(yFrom, yHi, fb);
        landQuad(xa, Math.max(ya, THREE.MathUtils.lerp(yFrom, yHi, fa)), xb, Math.max(yb, THREE.MathUtils.lerp(yFrom, yHi, fa)), yTop, `${name}${k}`);
      }
    };
    bands(x0, Math.max(yTable, yBench(x0)), xs, Math.max(yTable, yBench(xs)), `floor-${wi}a`);
    if (xs < x1 - 0.02) bands(xs, yTable, x1, yTable, `floor-${wi}b`);
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
  // The door leaf's clear glass, no blinds (Lighting.ts rev 3 note): 0.69 × 1.69 m. Rev 7:
  // traced like the windows (at 9° its upper half lands on the partition, not the floor).
  {
    const gw = 0.692, gy0 = 0.28, gy1 = 0.28 + 1.692;
    const x0 = DOOR.centerX - gw / 2, x1 = DOOR.centerX + gw / 2;
    for (let k = 0; k < 3; k++) {
      const ya = THREE.MathUtils.lerp(gy0, gy1, k / 3), yb = THREE.MathUtils.lerp(gy0, gy1, (k + 1) / 3);
      landQuad(x0, Math.max(yLo, ya), x1, Math.max(yLo, ya), Math.min(yHi, yb), `door${k}`, 1);
    }
  }
  return quads;
}

/**
 * GLSL: `bounceIrradiance( vec3 p, vec3 n )` in three's `irradiance` units (lux × K), from the
 * baked quad list. `k` converts nits to shader units (Lighting.ts `nits()`).
 *
 * Cost (measured, `length`, RTX 4060, 1080p): the first version — a runtime loop over `const`
 * arrays, four normalize + four acos per quad for every fragment of every material — was 5.3 ms
 * of scene pass (12.5 vs 7.2 ms). This one is unrolled with literal constants, skips fragments
 * outside the room (the lot never sees an interior patch), and per quad skips a fragment that is
 * behind the emitting plane or has every corner behind its own tangent plane (the floor under a
 * floor patch, a wall facing away) with four dots before any of the transcendental work; beyond
 * three quad-diagonals the patch is evaluated as a point (L · A · cosθe · cosθr / r², 3 % off the
 * contour integral there); acos is Eberly's polynomial (|err| < 7e-5 rad). 0.7 ms (7.7 ms scene
 * pass at `length`, rev 4's number).
 *
 * The all-corners-behind test is also a correctness fix: Lambert's contour integral is only the
 * form factor when the whole polygon is above the receiver's tangent plane, and the first version
 * evaluated it unclipped — an upward-facing seat cushion 0.45 m ABOVE the sunlit floor patch was
 * getting ≈ 140 nits from the floor (the lower hemisphere's negative projected solid angle came
 * out positive through the sign convention). Cushions, table tops and the shaded floor lost that
 * light (`booth` cushion-shade 189 → 46 nits). A polygon straddling the tangent plane (a booth
 * partition beside a floor patch) is still evaluated unclipped; the part behind the plane counts
 * negative, so the error is a shortfall of at most that part's share, not a gain.
 */
export function bounceRectsGlsl(quads: BounceQuad[], k: number, zInside = ROOM.zFront): string {
  const f = (v: number) => (Math.abs(v) < 1e-6 ? "0.0" : v.toFixed(5));
  const v3 = (v: THREE.Vector3) => `vec3( ${f(v.x)}, ${f(v.y)}, ${f(v.z)} )`;
  if (quads.length === 0) return `vec3 bounceIrradiance( vec3 p, vec3 n ) { return vec3( 0.0 ); }`;
  const body = quads
    .map((q) => {
      // Emitting-side normal: the corners are counter-clockwise seen from the emitting side, so
      // (v1 − v0) × (v3 − v0) points toward the receivers.
      const e1 = new THREE.Vector3().subVectors(q.v[1], q.v[0]), e3 = new THREE.Vector3().subVectors(q.v[3], q.v[0]);
      const e2 = new THREE.Vector3().subVectors(q.v[2], q.v[0]);
      const N = new THREE.Vector3().crossVectors(e1, e3).normalize();
      // Area of the (possibly non-parallelogram) quad: the two triangles' cross products.
      const area = 0.5 * (new THREE.Vector3().crossVectors(e1, e2).length() + new THREE.Vector3().crossVectors(e2, e3).length());
      const c = q.v[0].clone().add(q.v[1]).add(q.v[2]).add(q.v[3]).multiplyScalar(0.25);
      const L = q.radiance.clone().multiplyScalar(k * 0.5);
      // Beyond 3 quad-diagonals the patch is a point: E = L · A · cosθe · cosθr / r² (the contour
      // integral and the point form agree to 3 % there); in nits × k, so L · 2 · A.
      const far = 9 * (2 * area);
      const Lpt = q.radiance.clone().multiplyScalar(k * area);
      return `
    { // ${q.name}
      vec3 dc = ${v3(c)} - p;
      float r2 = dot( dc, dc );
      float ce = -dot( dc, ${v3(N)} );
      if ( ce > 0.01 ) {
        if ( r2 > ${f(far)} ) {
          acc += ${v3(Lpt)} * ( ce * max( dot( n, dc ), 0.0 ) / ( r2 * r2 ) );
        } else {
          vec3 d0 = ${v3(q.v[0])} - p, d1 = ${v3(q.v[1])} - p, d2 = ${v3(q.v[2])} - p, d3 = ${v3(q.v[3])} - p;
          if ( max( max( dot( n, d0 ), dot( n, d1 ) ), max( dot( n, d2 ), dot( n, d3 ) ) ) > 0.0 ) {
            d0 = normalize( d0 ); d1 = normalize( d1 ); d2 = normalize( d2 ); d3 = normalize( d3 );
            float ff = bounceEdge( d0, d1, n ) + bounceEdge( d1, d2, n ) + bounceEdge( d2, d3, n ) + bounceEdge( d3, d0, n );
            acc += ${v3(L)} * max( -ff, 0.0 );
          }
        }
      }
    }`;
    })
    .join("");
  return /* glsl */ `
  // ---- sun-patch first bounce, rectangle form factors (src/scene/bounceRects.ts) ----
  #define BOUNCE_N ${quads.length}
  // acos on [-1, 1], Eberly's polynomial (|err| < 7e-5 rad); the exact one is the cost here.
  float bounceAcos( float x ) {
    float ax = abs( x );
    float r = sqrt( 1.0 - ax ) * ( 1.5707288 + ax * ( -0.2121144 + ax * ( 0.0742610 - 0.0187293 * ax ) ) );
    return x < 0.0 ? PI - r : r;
  }
  // γ · (n · Γ) for one edge; an edge of (near) zero length contributes nothing rather than the
  // garbage a normalised zero cross product gives (a collapsed corner cost a stop of fill once).
  float bounceEdge( vec3 a, vec3 b, vec3 n ) {
    vec3 c = cross( a, b );
    float l = length( c );
    if ( l < 1e-5 ) return 0.0;
    return bounceAcos( clamp( dot( a, b ), -1.0, 1.0 ) ) * dot( n, c ) / l;
  }
  // Signed contour integral (Lambert): corners counter-clockwise from the emitting side put the
  // sum negative for a fragment on that side; a fragment behind the emitting face, or facing
  // away, gets nothing. Checked against the parallel-rectangle form factor (E/L 1.741 for a 2×2
  // patch 1 m below a downward-facing point) in /tmp ff.mjs before shipping.
  vec3 bounceIrradiance( vec3 p, vec3 n ) {
    if ( p.z > ${f(zInside + 0.02)} ) return vec3( 0.0 );
    vec3 acc = vec3( 0.0 );${body}
    return acc;
  }
  `;
}
