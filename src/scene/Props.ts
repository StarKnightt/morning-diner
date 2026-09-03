/**
 * System 2 props: table sets (napkin dispenser, sugar pourer, salt & pepper) on
 * every booth table and at every second stool; heavy ceramic mugs (instanced)
 * inverted on a stainless drip tray, inverted on saucers at two stools, and
 * the named upright `pourMug`; a BUNN VPR-class brewer with the glass decanter
 * `coffeePot`; a tray stack; a wall clock with bezel and glass.
 * Static geometry is merged per material; the mugs are InstancedMeshes.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { makeRng } from "../core/rng";
import { BACK_BAR, BOOTH, COUNTER, PROPS, ROOM, WINDOW } from "./layout";
import { buildContactDisc, type ContactDisc } from "./Lighting";

export interface PropsResult {
  pourMug: THREE.Mesh;
  /** The pour mug's contact disc, its own mesh so the drink can fade it with the lift. */
  pourMugShadow: THREE.Mesh;
  coffeePot: THREE.Group;
  /** Contact-occlusion rings under the mugs and saucers, for Lighting.ts buildContactShadows. */
  contactDiscs: ContactDisc[];
}

const V2 = (x: number, y: number) => new THREE.Vector2(x, y);
const MUG_H = 0.089;

/**
 * Self-occlusion for the ceramic, written into the UVs (System 4 rev 3). `materials.ts`
 * gives `ceramic` and `bisque` an identity-ramp aoMap (texel v = v), so a vertex's uv.y IS
 * its ambient/specular occlusion and three applies it to the probe's diffuse, the
 * clearcoat's and the base specular (aomap_fragment: computeSpecularOcclusion). The
 * ceramic has no colour map, so the UVs are free for this.
 *
 * Why: a one-point probe has no parallax and no self-occlusion. The glaze at the foot
 * chamfer of an upright mug (normal 45° down and out) reflects a ray that goes UP, through
 * the mug's own body — and the probe returns the troffer lens overhead (10,000 nits) for
 * it: a 1,700-nit crescent at the base, brighter than any lit part of the mug (the rev 1–2
 * critics' "mug-base light leak"). Same at the rim curl of an inverted mug standing on the
 * mat. The true reflection is the mug's own shaded underside.
 *
 * Occlusion per lathe profile point (index → value), one set per orientation, since the
 * end that meets the table differs and the InstancedMeshes are split by orientation.
 */
function writeProfileOcclusion(geo: THREE.BufferGeometry, pointCount: number, ao: (j: number) => number): void {
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const j = Math.round(uv.getY(i) * (pointCount - 1));
    uv.setXY(i, 0.5, ao(j));
  }
  uv.needsUpdate = true;
}

const MUG_PROFILE = [
  V2(0, 0.003), V2(0.031, 0.003), V2(0.036, 0.006), V2(0.04, 0.014), V2(0.041, 0.024),
  V2(0.0395, 0.038), V2(0.0385, 0.05), V2(0.039, 0.062), V2(0.0405, 0.074), V2(0.041, 0.082),
  V2(0.0405, 0.0875), V2(0.0385, 0.089), V2(0.0355, 0.089), V2(0.034, 0.0875), V2(0.0335, 0.084),
  V2(0.0325, 0.072), V2(0.0315, 0.05), V2(0.032, 0.03), V2(0.03, 0.016), V2(0.026, 0.013), V2(0, 0.013),
];
// Upright (foot on the table): bottom + chamfer occluded by the table and the body above;
// the cavity (inner wall, floor) is a deep white cup — modest; the rim sees the ceiling.
const MUG_AO_UPRIGHT = [0.15, 0.15, 0.3, 0.55, 0.9, 1, 1, 1, 1, 1, 0.95, 0.9, 0.9, 0.85, 0.7, 0.6, 0.5, 0.45, 0.4, 0.4, 0.4];
// Inverted (rim on the table): the rim curl and the wall just above it are what would
// mirror the ceiling through the body; the foot, now on top, sees everything.
const MUG_AO_INVERTED = [1, 1, 1, 0.95, 0.9, 1, 1, 1, 0.85, 0.5, 0.3, 0.25, 0.25, 0.3, 0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 0.35];

/**
 * Victor-style heavy mug: 89 mm tall, Ø 82 with a clear waist, 6 mm walls, a
 * 3.5 mm rounded rim, tapered foot, heavy C-handle. Origin at the foot; the
 * unglazed foot ring is a separate geometry (see `mugFootGeometry`).
 */
function mugGeometry(inverted: boolean): THREE.BufferGeometry {
  // Outer wall down the right, inner wall back up: 7–8 mm walls, 13 mm floor, 6.5 mm rim.
  const body = new THREE.LatheGeometry(MUG_PROFILE, 48);
  const ao = inverted ? MUG_AO_INVERTED : MUG_AO_UPRIGHT;
  writeProfileOcclusion(body, MUG_PROFILE.length, (j) => ao[j]);
  // Stubby C-handle: 36 mm outside reach, 15 mm thick, bonded high and low on the waist.
  const handle = new THREE.TorusGeometry(0.019, 0.0075, 12, 28, 1.2 * Math.PI);
  handle.rotateZ(-0.6 * Math.PI);
  handle.scale(1, 1.25, 1);
  handle.translate(0.052, 0.048, 0);
  writeProfileOcclusion(handle, 2, () => 1);
  return mergeGeometries([body.toNonIndexed(), handle.toNonIndexed()], false)!;
}

/** Unglazed foot ring, 3 mm tall, matching the mug's base. */
function mugFootGeometry(inverted: boolean): THREE.BufferGeometry {
  const geo = new THREE.LatheGeometry([V2(0.024, 0.0002), V2(0.026, 0), V2(0.031, 0), V2(0.0315, 0.003), V2(0.0235, 0.003), V2(0.024, 0.0002)], 40);
  // On the table, the 3 mm ring sees half a hemisphere at best; on top of an inverted mug, all of it.
  writeProfileOcclusion(geo, 6, () => (inverted ? 1 : 0.5));
  return geo;
}

const SAUCER_PROFILE = [V2(0, 0.003), V2(0.03, 0.003), V2(0.033, 0), V2(0.045, 0), V2(0.05, 0.005), V2(0.072, 0.014), V2(0.078, 0.018), V2(0.074, 0.019), V2(0.052, 0.011), V2(0.042, 0.008), V2(0, 0.008)];

function saucerGeometry(): THREE.BufferGeometry {
  const geo = new THREE.LatheGeometry(SAUCER_PROFILE, 40);
  // Underside and foot against the counter; the flare's underside sees the counter only.
  writeProfileOcclusion(geo, SAUCER_PROFILE.length, (j) => (j <= 3 ? 0.2 : j <= 5 ? 0.5 : 1));
  return geo;
}

export function buildProps(parent: THREE.Group, pal: Palette): PropsResult {
  const b = new MergedBuilder();
  const rng = makeRng(4321);

  /* ---------------- napkin dispenser + condiments ---------------- */
  // Dispenser (Tablecraft 221): 117 W × 98 D × 184 H smooth brushed-stainless body, 4 mm
  // folded-flange lid, rubber feet. Both long faces carry a spring faceplate recessed 2.5 mm
  // with a 70 × 22 mm rounded-end opening centred 40 mm below the top; a white napkin fan
  // protrudes ~10 mm from each opening.
  const dispenser = (x: number, z: number, yTop: number, yaw: number) => {
    const m = new THREE.Matrix4().makeRotationY(yaw);
    m.setPosition(x, yTop, z);
    const W = 0.117, D = 0.098, H = 0.184, t = 0.0025;
    const add = (g: THREE.BufferGeometry, mat: THREE.Material) => b.add(g, mat, m);
    const box = (mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      add(g, mat);
    };
    const steel = pal.stainlessTouched; // brushed stainless with fingerprints (System 5)
    // Shell: end panels, bottom, and the long faces as open frames (top rail + two stiles)
    box(steel, -W / 2, 0.003, -D / 2, -W / 2 + t, H - 0.004, D / 2);
    box(steel, W / 2 - t, 0.003, -D / 2, W / 2, H - 0.004, D / 2);
    box(steel, -W / 2, 0.003, -D / 2, W / 2, 0.003 + t, D / 2);
    for (const s of [-1, 1]) {
      const zf0 = s > 0 ? D / 2 - t : -D / 2, zf1 = s > 0 ? D / 2 : -D / 2 + t;
      box(steel, -W / 2, 0.003, zf0, -W / 2 + 0.008, H - 0.004, zf1); // stiles
      box(steel, W / 2 - 0.008, 0.003, zf0, W / 2, H - 0.004, zf1);
      box(steel, -W / 2, H - 0.012, zf0, W / 2, H - 0.004, zf1); // top rail
    }
    // Lid: 4 mm cap with a folded flange dropping 6 mm over the body, plus a dark seam under it
    const cap = new RoundedBoxGeometry(W + 0.004, 0.004, D + 0.004, 3, 0.0018); // 1.8 mm rolled edge
    cap.translate(0, H - 0.002, 0);
    add(cap, steel);
    box(steel, -W / 2 - 0.002, H - 0.01, -D / 2 - 0.002, -W / 2, H - 0.004, D / 2 + 0.002);
    box(steel, W / 2, H - 0.01, -D / 2 - 0.002, W / 2 + 0.002, H - 0.004, D / 2 + 0.002);
    box(steel, -W / 2 - 0.002, H - 0.01, -D / 2 - 0.002, W / 2 + 0.002, H - 0.004, -D / 2);
    box(steel, -W / 2 - 0.002, H - 0.01, D / 2, W / 2 + 0.002, H - 0.004, D / 2 + 0.002);
    box(pal.blackPlastic, -W / 2 - 0.0022, H - 0.0115, -D / 2 - 0.0022, W / 2 + 0.0022, H - 0.0105, D / 2 + 0.0022);
    // Napkin stack fills the body (white shows through the openings)
    box(pal.napkin, -W / 2 + 0.006, 0.008, -D / 2 + 0.006, W / 2 - 0.006, H - 0.014, D / 2 - 0.006);
    // Rubber feet
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const foot = new THREE.CylinderGeometry(0.006, 0.006, 0.003, 12);
        foot.translate(sx * (W / 2 - 0.012), 0.0015, sz * (D / 2 - 0.012));
        add(foot, pal.blackPlastic);
      }
    for (const s of [-1, 1]) {
      const zf = s * (D / 2 - t); // faceplate face, recessed 2.5 mm behind the shell
      const hw = W / 2 - 0.008, y0 = 0.004, y1 = H - 0.012;
      const plate = new THREE.Shape();
      plate.moveTo(-hw, y0); plate.lineTo(hw, y0); plate.lineTo(hw, y1); plate.lineTo(-hw, y1); plate.closePath();
      // 70 × 22 mm rounded-end slot centred 40 mm below the top
      const sw = 0.035, sh = 0.011, yc = H - 0.04;
      const slot = new THREE.Path();
      slot.moveTo(-sw + sh, yc - sh);
      slot.lineTo(sw - sh, yc - sh);
      slot.absarc(sw - sh, yc, sh, -Math.PI / 2, Math.PI / 2, false);
      slot.lineTo(-sw + sh, yc + sh);
      slot.absarc(-sw + sh, yc, sh, Math.PI / 2, (3 * Math.PI) / 2, false);
      plate.holes.push(slot);
      const pg = new THREE.ExtrudeGeometry(plate, { depth: 0.001, bevelEnabled: false, curveSegments: 10 });
      {
        // Extrude UVs are in metres (a 0.1 × 0.18 m corner of the map): normalise so the
        // faceplate shows one full fingerprint canvas like the box faces do.
        const uv = pg.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + hw) / (2 * hw), (uv.getY(i) - y0) / (y1 - y0));
      }
      if (s < 0) pg.rotateY(Math.PI);
      pg.translate(0, 0, s > 0 ? zf - 0.001 : zf + 0.001);
      add(pg, steel);
      // Napkin fan: a soft white wedge out through the slot, ~10 mm proud, drooping 20°,
      // with the interfold crease — a shaded 1.2 mm valley across the tip where the
      // next napkin's fold shows — 4 mm in from the tip.
      const fan = new RoundedBoxGeometry(0.056, 0.008, 0.016, 2, 0.003);
      fan.translate(0, 0, 0.008);
      const crease = new THREE.BoxGeometry(0.05, 0.0012, 0.0012);
      crease.translate(0, 0.0038, 0.012);
      const tipFold = new RoundedBoxGeometry(0.046, 0.005, 0.007, 2, 0.002); // the folded-back leaf riding on the tip
      tipFold.translate(0, 0.0045, 0.0135);
      for (const g of [fan, crease, tipFold]) {
        g.rotateX(s * THREE.MathUtils.degToRad(20));
        g.translate(0, yc - 0.001, s * (D / 2 - 0.002));
      }
      add(fan, pal.napkin);
      add(tipFold, pal.napkin);
      add(crease, pal.napkinFold);
    }
  };
  // Sugar pourer: ONE fluted clear-glass jar Ø 76 (14 ribs, 1.5 mm high) × 105, 2.5 mm
  // wall; sugar column at 97 % of the bore to 65 %; flat brushed-chrome lid the full
  // jar diameter, 12 mm tall, with a 25 mm (1") side-hinged half-moon flap.
  const flutedJar = (rBase: number, ribs: number, amp: number, h: number): THREE.BufferGeometry => {
    const g = new THREE.CylinderGeometry(rBase, rBase - 0.0015, h, ribs * 10, 8, true);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
      const r0 = Math.hypot(x, z);
      const th = Math.atan2(z, x);
      // Ribs fade out over the top 8 mm (plain shoulder under the lid); each rib is a
      // rounded ridge with a flat between (cos² profile) so it throws its own highlight.
      const fade = Math.min(1, Math.max(0, (h / 2 - y) / 0.008));
      const r = r0 + amp * (0.5 + 0.5 * Math.cos(ribs * th)) ** 2 * fade;
      pos.setXYZ(i, (x / r0) * r, y, (z / r0) * r);
    }
    g.computeVertexNormals();
    const bottom = new THREE.CircleGeometry(rBase - 0.0015, ribs * 10);
    bottom.rotateX(Math.PI / 2);
    bottom.translate(0, -h / 2, 0);
    return mergeGeometries([g.toNonIndexed(), bottom.toNonIndexed()], false)!;
  };
  // Granular fill column: a cylinder whose top is tilted `tiltDeg` and roughened ±0.3 mm
  // (per-vertex hash) so it reads as a poured heap, not a machined plane.
  const granularFill = (rTop: number, rBot: number, h: number, tiltDeg: number, seed: number): THREE.BufferGeometry => {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, 40, 1).toNonIndexed();
    const pos = g.attributes.position as THREE.BufferAttribute;
    const slope = Math.tan(THREE.MathUtils.degToRad(tiltDeg));
    const hash = (a: number, b: number) => {
      const t = Math.sin(a * 127.1 + b * 311.7 + seed) * 43758.5453;
      return t - Math.floor(t);
    };
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < h / 2 - 1e-6) continue;
      const x = pos.getX(i), z = pos.getZ(i);
      const grain = (hash(Math.round(x * 1e4), Math.round(z * 1e4)) - 0.5) * 0.0006;
      pos.setY(i, h / 2 + x * slope + grain);
    }
    g.computeVertexNormals();
    return g;
  };
  const sugarCaddy = (x: number, z: number, y: number, yaw = 0) => {
    const m = new THREE.Matrix4().makeRotationY(yaw);
    m.setPosition(x, y, z);
    const add = (g: THREE.BufferGeometry, mat: THREE.Material) => b.add(g, mat, m);
    const R = 0.036, wall = 0.0025, jarH = 0.105, ribAmp = 0.0025;
    add(flutedJar(R, 14, ribAmp, jarH).translate(0, jarH / 2, 0), pal.glassFluted);
    const bore = R - wall;
    const fillH = jarH * 0.75;
    add(granularFill(bore * 0.985, bore * 0.985, fillH, 7, 3).translate(0, 0.003 + fillH / 2, 0), pal.sugar);
    // Lid: full-diameter flat cap (12 mm) with a 2 mm knurled band and a domed centre
    const lidR = R + ribAmp;
    add(new THREE.CylinderGeometry(lidR, lidR, 0.012, 40).translate(0, jarH + 0.006, 0), pal.chromeSoft);
    add(new THREE.CylinderGeometry(lidR - 0.006, lidR - 0.0005, 0.003, 40).translate(0, jarH + 0.0135, 0), pal.chromeSoft);
    // 1" half-moon flap lying flat on the lid, hinged on a pin along its chord at the rim
    const moon = new THREE.Shape();
    moon.absarc(0, 0, 0.0125, 0, Math.PI, false);
    moon.closePath();
    const flap = new THREE.ExtrudeGeometry(moon, { depth: 0.0015, bevelEnabled: false, curveSegments: 12 });
    flap.rotateX(-Math.PI / 2); // semicircle bulging toward −z, chord along x
    flap.translate(0, jarH + 0.0155, lidR - 0.004);
    add(flap, pal.chromeSoft);
    const hinge = new THREE.CylinderGeometry(0.002, 0.002, 0.027, 10);
    hinge.rotateZ(Math.PI / 2);
    hinge.translate(0, jarH + 0.0155, lidR - 0.0035);
    add(hinge, pal.chromeSoft);
  };
  // Salt / pepper: clear glass Ø 30 (1.5 mm wall) with an opaque fill to 60 % at 97 % of
  // the bore, 30 mm perforated chrome cap.
  const shaker = (x: number, z: number, y: number, contents: THREE.Material) => {
    const add = (g: THREE.BufferGeometry, mat: THREE.Material) => b.add(g.translate(x, y, z), mat);
    add(new THREE.CylinderGeometry(0.015, 0.014, 0.058, 28).translate(0, 0.029, 0), pal.glassClear);
    add(granularFill(0.0131, 0.0121, 0.035, 6, x * 100 + z).translate(0, 0.0195, 0), contents);
    add(new THREE.CylinderGeometry(0.015, 0.015, 0.012, 28).translate(0, 0.064, 0), pal.chromeSoft);
    const dome = new THREE.SphereGeometry(0.015, 28, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.4, 1);
    dome.translate(0, 0.07, 0);
    add(dome, pal.chromeSoft);
    for (let k = 0; k < 7; k++) {
      const r = k === 0 ? 0 : 0.0075, a = (k / 6) * Math.PI * 2;
      const hole = new THREE.CylinderGeometry(0.0013, 0.0013, 0.002, 6);
      hole.translate(Math.cos(a) * r, k === 0 ? 0.0755 : 0.0745, Math.sin(a) * r);
      add(hole, pal.blackPlastic);
    }
  };
  const tableSet = (cx: number, cz: number, y: number, yaw: number) => {
    // Local frame along the table's wall edge: caddy centred, dispenser one side, S&P the other.
    const rot = new THREE.Matrix4().makeRotationY(yaw);
    const at = (dx: number, dz: number) => new THREE.Vector3(dx, 0, dz).applyMatrix4(rot).add(new THREE.Vector3(cx, 0, cz));
    const c = at((rng() - 0.5) * 0.01, (rng() - 0.5) * 0.01);
    sugarCaddy(c.x, c.z, y, yaw + rng() * Math.PI);
    const d = at(-0.13 + (rng() - 0.5) * 0.01, (rng() - 0.5) * 0.01);
    dispenser(d.x, d.z, y, yaw + Math.PI / 2 + (rng() - 0.5) * 0.1);
    const s1 = at(0.075, 0.01 + (rng() - 0.5) * 0.02), s2 = at(0.115, -0.012 + (rng() - 0.5) * 0.02);
    // Salt stands nearer the aisle (in front of the pepper from the booth side), so the
    // pale column is not hidden behind the pepper in a near view.
    shaker(s1.x, s1.z, y, pal.pepper);
    shaker(s2.x, s2.z, y, pal.salt);
  };
  for (const cx of WINDOW.centersX) tableSet(cx, BOOTH.zOuter - 0.1, BOOTH.table.top, 0);
  // Counter: sets toward the back edge of the top at every second stool, dispenser faces the stools.
  for (const x of PROPS.napkinCounterX) tableSet(x, PROPS.napkinCounterZ, COUNTER.height, Math.PI / 2);

  /* ---------------- mugs ---------------- */
  const mugGeo = mugGeometry(false), mugGeoInv = mugGeometry(true);
  const footGeo = mugFootGeometry(false), footGeoInv = mugFootGeometry(true);
  const yBar = BACK_BAR.height;
  const ledge = PROPS.mugLedge;
  {
    // Black ribbed rubber bar mat on the back bar: 8 mm base with 4 mm ribs at 12 mm pitch.
    b.rbox(pal.rubberMat, [ledge.x0, yBar, ledge.z0], [ledge.x1, yBar + 0.008, ledge.z1], 0.003);
    const ribs = Math.round((ledge.x1 - ledge.x0) / 0.012);
    for (let k = 0; k < ribs; k++) {
      const xr = ledge.x0 + 0.008 + k * ((ledge.x1 - ledge.x0 - 0.016) / (ribs - 1));
      b.rbox(pal.rubberMat, [xr - 0.002, yBar + 0.008, ledge.z0 + 0.006], [xr + 0.002, yBar + 0.012, ledge.z1 - 0.006], 0.0015);
    }
  }
  const mugPoses: THREE.Matrix4[] = [], mugPosesInv: THREE.Matrix4[] = [];
  const contactDiscs: ContactDisc[] = [];
  const mugAt = (x: number, y: number, z: number, yaw: number, inverted: boolean, onSaucer = false) => {
    const m = new THREE.Matrix4().makeRotationY(yaw);
    if (inverted) m.premultiply(new THREE.Matrix4().makeRotationX(Math.PI)).setPosition(x, y + MUG_H, z);
    else m.setPosition(x, y, z);
    (inverted ? mugPosesInv : mugPoses).push(m);
    // Contact occlusion (System 4 rev 2): inverted, the Ø 82 rim sits on the surface and the
    // shade spreads ≈ 35 mm out from it; upright, the Ø 63 foot ring. Inside the ring the
    // disc is hidden by the mug itself. On a saucer the saucer's own ring stands in (a disc
    // at the well's level would sit inside the flared rim).
    if (!onSaucer) contactDiscs.push(inverted ? { x, y, z, r0: 0.041, r1: 0.078, ao: 0.6 } : { x, y, z, r0: 0.031, r1: 0.062, ao: 0.6 });
  };
  // Seven spare mugs inverted straight onto the mat: two staggered rows, one slot left
  // empty, ±15 mm scatter and any handle angle, so the mat does not read as a grid.
  const saucerGeo = saucerGeometry();
  const matCols = 4, matRows = 2, skip = 5;
  for (let i = 0; i < matCols * matRows; i++) {
    if (i === skip) continue;
    const col = i % matCols, row = Math.floor(i / matCols);
    const sx = ledge.x0 + 0.075 + col * 0.13 + row * 0.035 + (rng() - 0.5) * 0.03;
    const sz = ledge.z0 + 0.07 + row * 0.13 + (rng() - 0.5) * 0.03;
    mugAt(sx, yBar + 0.012, sz, rng() * Math.PI * 2, true);
  }
  // Two loose mugs standing upright beside the mat, jittered
  for (let i = 0; i < 2; i++) {
    mugAt(ledge.x1 + 0.07 + i * 0.1 + (rng() - 0.5) * 0.03, yBar, ledge.z0 + 0.09 + (rng() - 0.5) * 0.08, rng() * Math.PI * 2, false);
  }
  // Inverted mugs on saucers at two stools
  for (const x of PROPS.saucerStoolX) {
    const s = saucerGeo.clone();
    s.translate(x, COUNTER.height, PROPS.saucerZ);
    b.add(s, pal.ceramic);
    // The saucer's flared rim stands 18 mm over the counter: shade under the flare and out.
    contactDiscs.push({ x, y: COUNTER.height, z: PROPS.saucerZ, r0: 0.05, r1: 0.12, ao: 0.45 });
    mugAt(x, COUNTER.height + 0.009, PROPS.saucerZ, Math.PI * (0.9 + rng() * 0.3), true, true);
  }
  for (const [geo, mat, name, poses] of [
    [mugGeo, pal.ceramic, "mugs", mugPoses], [footGeo, pal.bisque, "mug-feet", mugPoses],
    [mugGeoInv, pal.ceramic, "mugs-inverted", mugPosesInv], [footGeoInv, pal.bisque, "mug-feet-inverted", mugPosesInv],
  ] as const) {
    if (poses.length === 0) continue;
    const im = new THREE.InstancedMesh(geo, mat, poses.length);
    poses.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = im.receiveShadow = true;
    im.name = name;
    parent.add(im);
  }
  // The pour mug: its own mesh so System 7 can find and fill it.
  const pourMug = new THREE.Mesh(mugGeo, pal.ceramic);
  pourMug.name = "pourMug";
  pourMug.position.set(PROPS.pourMug.x, yBar, PROPS.pourMug.z);
  pourMug.rotation.y = -0.6;
  pourMug.castShadow = pourMug.receiveShadow = true;
  const pourFoot = new THREE.Mesh(footGeo, pal.bisque);
  pourFoot.name = "pourMug:foot";
  // System 4 rev 3: the foot never received shadows, so its 0.5 mm top sliver outside the
  // body's chamfer took the full sun through the roof — the 4,800-nit "mug-base crescent"
  // the critics saw in `macro-warmer` for three revs.
  pourFoot.castShadow = pourFoot.receiveShadow = true;
  pourMug.add(pourFoot);
  parent.add(pourMug);
  // Its contact disc is its own mesh: the drink (System 9) fades it as the mug lifts off the bar.
  const pourMugShadow = buildContactDisc(parent, { x: PROPS.pourMug.x, y: yBar, z: PROPS.pourMug.z, r0: 0.031, r1: 0.062, ao: 0.6 }, "pourMug:contact");

  /* ---------------- BUNN VPR-class brewer + decanter ---------------- */
  const coffeePot = new THREE.Group();
  {
    const { x, zBack, width, depth, height } = PROPS.brewer;
    const x0 = x - width / 2, x1 = x + width / 2;
    const zBody = zBack + depth; // 203 mm body
    const zBase = zBack + 0.32; // warmer apron runs forward of the body
    const yTop = yBar + height, yHead = yTop - 0.11;
    const zW = zBack + 0.21; // lower warmer centre, under the funnel
    // Base: black powder-coated box under a brushed stainless top plate carrying ONE black
    // 150 mm warmer disc; black front panel with a pilot light and two lit rocker switches.
    b.rbox(pal.blackPowder, [x0, yBar, zBack], [x1, yBar + 0.046, zBase], 0.004, 3);
    b.rbox(pal.stainlessCool, [x0 - 0.001, yBar + 0.046, zBack], [x1 + 0.001, yBar + 0.052, zBase + 0.001], 0.002, 2);
    b.box(pal.blackPlastic, [x0 + 0.004, yBar + 0.006, zBase - 0.003], [x1 - 0.004, yBar + 0.044, zBase + 0.001]);
    b.rbox(pal.pilotRed, [x + 0.1, yBar + 0.022, zBase - 0.002], [x + 0.108, yBar + 0.03, zBase + 0.004], 0.002);
    // Rocker switches 25 × 14 mm in a black bezel: upper half lit amber, lower half black, pivot line between.
    for (const sx of [-1, 1]) {
      const cx = x + sx * 0.15;
      b.rbox(pal.blackPlastic, [cx - 0.016, yBar + 0.016, zBase - 0.002], [cx + 0.016, yBar + 0.036, zBase + 0.005], 0.002);
      b.rbox(pal.rockerLit, [cx - 0.012, yBar + 0.0265, zBase + 0.004], [cx + 0.012, yBar + 0.033, zBase + 0.0085], 0.0015);
      b.rbox(pal.blackPowder, [cx - 0.012, yBar + 0.019, zBase + 0.004], [cx + 0.012, yBar + 0.0255, zBase + 0.0075], 0.0015);
    }
    const ring = new THREE.CylinderGeometry(0.08, 0.08, 0.003, 48);
    ring.translate(x, yBar + 0.0535, zW);
    b.add(ring, pal.stainlessCool);
    const plate = new THREE.CylinderGeometry(0.075, 0.075, 0.004, 48);
    plate.translate(x, yBar + 0.057, zW);
    b.add(plate, pal.blackPowder);
    // Body: matte black powder-coated tower, 203 deep, with brushed stainless side panels (VPR)
    b.rbox(pal.blackPowder, [x0 + 0.003, yBar + 0.05, zBack], [x1 - 0.003, yHead, zBody], 0.004, 3);
    b.box(pal.stainlessTouched, [x0, yBar + 0.05, zBack + 0.004], [x0 + 0.003, yHead - 0.004, zBody - 0.004]);
    b.box(pal.stainlessTouched, [x1 - 0.003, yBar + 0.05, zBack + 0.004], [x1, yHead - 0.004, zBody - 0.004]);
    // Hood: light brushed stainless wrap, overhanging the warmer, with a black front control
    // band and a black fill lid at the back; the tower under it stays powder-black.
    b.rbox(pal.stainlessCool, [x0, yHead, zBack], [x1, yTop, zBack + 0.3], 0.005, 3);
    b.box(pal.blackPowder, [x0 + 0.002, yHead + 0.02, zBack + 0.296], [x1 - 0.002, yHead + 0.07, zBack + 0.302]); // black control band
    // Fill lid: stainless like the hood (a second black disc up there read as a second warmer), with a dark seam
    b.rbox(pal.stainlessCool, [x0 + 0.006, yTop - 0.001, zBack + 0.006], [x1 - 0.006, yTop + 0.004, zBack + 0.118], 0.002);
    b.box(pal.darkMetal, [x0 + 0.004, yTop - 0.0005, zBack + 0.118], [x1 - 0.004, yTop + 0.0015, zBack + 0.1205]);
    b.rbox(pal.chromeSoft, [x - 0.04, yHead + 0.035, zBack + 0.302], [x + 0.04, yHead + 0.055, zBack + 0.304], 0.0015); // badge
    // ONE upper warmer: black 150 mm disc on the stainless hood
    const upperRing = new THREE.CylinderGeometry(0.08, 0.08, 0.003, 48);
    upperRing.translate(x, yTop + 0.0015, zBack + 0.19);
    b.add(upperRing, pal.stainlessCool);
    const upperPlate = new THREE.CylinderGeometry(0.075, 0.075, 0.004, 48);
    upperPlate.translate(x, yTop + 0.005, zBack + 0.19);
    b.add(upperPlate, pal.blackPowder);
    // Brew funnel: deep black SplashGard bowl (Ø 200 × 60) with a flat rim flange, sliding in
    // stainless rails under the head; handle bar forward
    for (const s of [-1, 1]) {
      b.box(pal.stainlessCool, [x + s * 0.108 - 0.004, yHead - 0.03, zBack + 0.06], [x + s * 0.108 + 0.004, yHead, zBack + 0.29]);
      b.box(pal.stainlessCool, [x + s * 0.108 - 0.014, yHead - 0.03, zBack + 0.06], [x + s * 0.108 + 0.014, yHead - 0.026, zBack + 0.29]);
    }
    // Funnel: BUNN SplashGard — black plastic 7" (Ø 178) cylinder, 100 mm deep, near-straight
    // sides easing to a Ø 130 floor, a flat rim flange riding on the rails, and a 50 × 65 mm
    // paddle handle forward. (Rev 6 had a stainless lathe that read as a milky cone.)
    const funnel = new THREE.LatheGeometry(
      [
        V2(0, -0.1), V2(0.058, -0.1), V2(0.065, -0.097), V2(0.07, -0.088), V2(0.082, -0.03), V2(0.088, -0.006), V2(0.108, -0.006),
        V2(0.108, 0), V2(0.086, 0), V2(0.085, -0.008), V2(0.079, -0.03), V2(0.067, -0.086), V2(0.06, -0.093), V2(0, -0.094),
      ],
      56,
    );
    funnel.translate(x, yHead - 0.004, zW);
    b.add(funnel, pal.blackPlastic);
    b.rbox(pal.blackPlastic, [x - 0.025, yHead - 0.02, zW + 0.1], [x + 0.025, yHead - 0.008, zW + 0.17], 0.003, 2);
    b.box(pal.blackPlastic, [x - 0.02, yHead - 0.016, zW + 0.085], [x + 0.02, yHead - 0.008, zW + 0.1]);
    // Decanter on the warmer: 173 Ø × 178, 55 % full, black handle + spout collar, stainless base ring
    const px = x, pz = zW, py = yBar + 0.058;
    const R = 0.0865, Hd = 0.178;
    const glass = new THREE.LatheGeometry(
      [
        V2(0, 0.001), V2(0.045, 0.001), V2(0.066, 0.006), V2(0.079, 0.02), V2(R - 0.002, 0.045), V2(R, 0.08), V2(R - 0.003, 0.11), V2(0.074, 0.14), V2(0.064, 0.158), V2(0.06, 0.168), V2(0.063, Hd), V2(0.06, Hd),
        V2(0.0575, 0.168), V2(0.0615, 0.158), V2(0.0715, 0.14), V2(R - 0.0055, 0.11), V2(R - 0.0025, 0.08), V2(R - 0.0045, 0.045), V2(0.0765, 0.02), V2(0.064, 0.0085), V2(0.045, 0.0035), V2(0, 0.0035),
      ],
      64,
    );
    const glassMesh = new THREE.Mesh(glass, pal.glassCarafe); // scratched, dishwasher-etched (System 5)
    glassMesh.name = "coffeePot:glass";
    // Coffee to 55 % as an opaque dark body: fills the inner profile with a meniscus curling up at the wall
    const fillY = 0.098;
    const coffee = new THREE.LatheGeometry(
      [V2(0, 0.0035), V2(0.045, 0.0035), V2(0.064, 0.0085), V2(0.0765, 0.02), V2(R - 0.0045, 0.045), V2(R - 0.0025, 0.08), V2(R - 0.0031, fillY + 0.0018), V2(R - 0.005, fillY + 0.0014), V2(R - 0.014, fillY + 0.0002), V2(0, fillY)],
      64,
    );
    const coffeeMesh = new THREE.Mesh(coffee, pal.coffee);
    coffeeMesh.name = "coffeePot:coffee";
    // Tide-line stain above the fill, inside the glass: 22 mm band whose alpha map puts the
    // dense line ~3 mm above the meniscus and thins upward (the level of earlier, fuller pots).
    const stain = new THREE.CylinderGeometry(R - 0.0036, R - 0.0032, 0.022, 64, 1, true);
    stain.translate(0, fillY + 0.0135, 0);
    const stainMesh = new THREE.Mesh(stain, pal.coffeeStain);
    // Black spout collar and 25 mm handle bonded to the body
    const collar = new THREE.CylinderGeometry(0.0655, 0.062, 0.03, 48, 1, true);
    collar.translate(0, 0.156, 0);
    const collarRing = new THREE.TorusGeometry(0.0645, 0.0045, 10, 48);
    collarRing.rotateX(Math.PI / 2);
    collarRing.translate(0, 0.142, 0);
    // D-handle: 12 mm black bar 40 mm off the glass, from the collar down to mid-body, with two arms bonded to the body.
    const handleBar = new THREE.CylinderGeometry(0.0125, 0.0125, 0.105, 16);
    handleBar.translate(R + 0.028, 0.105, 0);
    const armTop = new THREE.CylinderGeometry(0.011, 0.011, 0.05, 12);
    armTop.rotateZ(Math.PI / 2);
    armTop.translate(R + 0.004, 0.155, 0);
    const armBot = new THREE.CylinderGeometry(0.011, 0.011, 0.045, 12);
    armBot.rotateZ(Math.PI / 2);
    armBot.translate(R - 0.006, 0.058, 0);
    const knuckleT = new THREE.SphereGeometry(0.0125, 14, 10);
    knuckleT.translate(R + 0.028, 0.155, 0);
    const knuckleB = new THREE.SphereGeometry(0.0125, 14, 10);
    knuckleB.translate(R + 0.028, 0.056, 0);
    const handle = mergeGeometries([handleBar.toNonIndexed(), armTop.toNonIndexed(), armBot.toNonIndexed(), knuckleT.toNonIndexed(), knuckleB.toNonIndexed()], false)!;
    const bond = new THREE.BoxGeometry(0.02, 0.05, 0.03);
    bond.translate(0.078, 0.145, 0);
    const handleMesh = new THREE.Mesh(mergeGeometries([collar.toNonIndexed(), collarRing.toNonIndexed(), handle.toNonIndexed(), bond.toNonIndexed()], false)!, pal.blackPlastic);
    handleMesh.name = "coffeePot:handle";
    const baseRing = new THREE.TorusGeometry(0.06, 0.004, 10, 48);
    baseRing.rotateX(Math.PI / 2);
    baseRing.translate(0, 0.003, 0);
    const baseMesh = new THREE.Mesh(baseRing, pal.stainless);
    coffeePot.add(glassMesh, coffeeMesh, stainMesh, handleMesh, baseMesh);
    coffeePot.name = "coffeePot";
    coffeePot.position.set(px, py, pz);
    coffeePot.rotation.y = -0.4; // handle to the right, quartered toward the service aisle; spout to the wall
    coffeePot.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    parent.add(coffeePot);
  }

  /* ---------------- tray station ---------------- */
  {
    const { x, z, count } = PROPS.trays;
    for (let i = 0; i < count; i++) {
      const m = new THREE.Matrix4().makeRotationY((rng() - 0.5) * 0.1);
      m.setPosition(x + (rng() - 0.5) * 0.012, yBar + i * 0.02, z + (rng() - 0.5) * 0.012);
      const tray = new THREE.BoxGeometry(0.35, 0.02, 0.45);
      tray.translate(0, 0.01, 0);
      b.add(tray, pal.trayBrown, m);
      const well = new THREE.BoxGeometry(0.31, 0.006, 0.41);
      well.translate(0, 0.02, 0);
      b.add(well, pal.rubberMat, m);
    }
  }

  /* ---------------- wall clock ---------------- */
  {
    const { x, y, radius, hour, minute } = PROPS.clock;
    const z = ROOM.zBack + 0.04;
    const shell = new THREE.CylinderGeometry(radius, radius - 0.004, 0.04, 48);
    shell.rotateX(Math.PI / 2);
    shell.translate(x, y, z - 0.02);
    b.add(shell, pal.blackPlastic);
    // Chrome bezel ring holding a domed glass
    const bezel = new THREE.TorusGeometry(radius - 0.005, 0.007, 12, 64);
    bezel.translate(x, y, z);
    b.add(bezel, pal.chromeSoft);
    const face = new THREE.CylinderGeometry(radius - 0.01, radius - 0.01, 0.004, 48);
    face.rotateX(Math.PI / 2);
    face.translate(x, y, z - 0.008);
    b.add(face, pal.clockFace);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const tick = new THREE.BoxGeometry(k % 3 === 0 ? 0.008 : 0.005, 0.016, 0.002);
      tick.rotateZ(-a);
      tick.translate(x + Math.sin(a) * (radius - 0.03), y + Math.cos(a) * (radius - 0.03), z - 0.005);
      b.add(tick, pal.blackPlastic);
    }
    const hand = (len: number, w: number, angle: number, mat: THREE.Material, zOff: number) => {
      const h = new THREE.BoxGeometry(w, len, 0.0015);
      h.translate(0, len / 2 - 0.012, 0);
      h.rotateZ(-angle);
      h.translate(x, y, z + zOff);
      b.add(h, mat);
    };
    const minA = (minute / 60) * Math.PI * 2, hourA = ((hour % 12) / 12 + minute / 720) * Math.PI * 2;
    hand(radius * 0.55, 0.008, hourA, pal.blackPlastic, -0.003);
    hand(radius * 0.8, 0.006, minA, pal.blackPlastic, -0.001);
    hand(radius * 0.85, 0.002, (37 / 60) * Math.PI * 2, pal.pilotRed, 0.001);
    const hub = new THREE.CylinderGeometry(0.006, 0.006, 0.006, 16);
    hub.rotateX(Math.PI / 2);
    hub.translate(x, y, z - 0.001);
    b.add(hub, pal.blackPlastic);
    // Glass: a shallow dome in front of the hands
    const glass = new THREE.SphereGeometry(radius - 0.006, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    glass.scale(1, 0.12, 1);
    glass.rotateX(Math.PI / 2);
    glass.translate(x, y, z + 0.004);
    b.add(glass, pal.glassClear); // System 4 rev 6: `glass` is now the storefront alpha leaf; the clock dome keeps transmission
  }

  b.build(parent, { name: "props" });
  return { pourMug, pourMugShadow, coffeePot, contactDiscs };
}
