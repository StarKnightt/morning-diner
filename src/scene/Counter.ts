/**
 * Counter run: L-shaped grey-speckle formica top (bullnose + chrome band) on a
 * 400 mm die with a 300 mm knee overhang, cove base and toe recess, 36 mm
 * chrome footrail on cast brackets, ten bolted chrome stools with domed red
 * vinyl cushions (InstancedMesh parts, each swivelled a little differently),
 * back bar with toe kick / backsplash / equipment fronts, and a continuous
 * upper-cabinet run under a bulkhead. The L-return top is left empty.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { slabGeometry, type XZ } from "../core/shapes";
import { makeRng } from "../core/rng";
import { plainColor } from "../core/upholstery";
import { BACK_BAR, CABINETS, COUNTER, ROOM, STOOL } from "./layout";
import { punchedWall } from "./Shell";

export function buildCounter(parent: THREE.Group, pal: Palette): { colliders: MergedBuilder["colliders"] } {
  const b = new MergedBuilder();

  /* ---------------- counter ---------------- */
  {
    const { topFrontZ, overhang, dieDepth, height, topThickness: tt, xMin, xMax, lReturnXOuter, lReturnZEnd, footrest } = COUNTER;
    const dieFront = topFrontZ - overhang; // -0.15
    const dieBack = dieFront - dieDepth; // -0.55
    const lDieX1 = xMax + dieDepth; // 2.4

    // Top: one L-shaped slab. Corner radii: 30 mm on free corners, ~0 at the wall.
    const pts: XZ[] = [
      [xMin, topFrontZ],
      [lReturnXOuter, topFrontZ],
      [lReturnXOuter, lReturnZEnd],
      [xMax, lReturnZEnd],
      [xMax, dieBack],
      [xMin, dieBack],
    ];
    const [slab, band] = slabGeometry(pts, {
      radius: [0.002, 0.04, 0.04, 0.03, 0.02, 0.002],
      y0: height - tt,
      thickness: tt,
      bevel: 0.012,
      bandHeight: 0.032,
      bandProud: 0.0015,
      grooves: 4,
      curveSegments: 8,
    });
    b.add(slab, pal.formicaCounter);
    if (band) b.add(band, pal.formicaEdge);
    // 100 mm stainless backsplash lip along the service edge of the top
    b.rbox(pal.stainless, [xMin, height - 0.004, dieBack - 0.006], [xMax + 0.006, height + 0.1, dieBack + 0.014], 0.003);

    // Die (woodgrain laminate, metric UVs) with a 100 mm recessed toe kick faced in cove base, main run and L-return.
    const kickH = COUNTER.kickHeight, kickIn = COUNTER.kickRecess;
    b.box(pal.laminatePanel, [xMin, kickH, dieBack], [xMax, height - tt, dieFront], { metric: true });
    b.rbox(pal.baseboard, [xMin, 0, dieBack], [xMax, kickH, dieFront - kickIn], 0.004);
    b.box(pal.laminatePanel, [xMax, kickH, lReturnZEnd], [lDieX1, height - tt, dieBack], { metric: true });
    b.rbox(pal.baseboard, [xMax, 0, lReturnZEnd + kickIn], [lDieX1 - kickIn, kickH, dieBack], 0.004);
    // 130 mm scuff band and a plinth line at the base of the die faces
    b.box(pal.laminateScuffed, [xMin + 0.002, kickH + 0.002, dieFront], [xMax, kickH + 0.132, dieFront + 0.0006]);
    b.box(pal.laminateScuffed, [lDieX1, kickH + 0.002, lReturnZEnd + 0.002], [lDieX1 + 0.0006, kickH + 0.132, dieBack]);
    b.box(pal.baseboard, [xMin + 0.002, kickH + 0.132, dieFront], [xMax, kickH + 0.138, dieFront + 0.0008]);
    b.box(pal.baseboard, [lDieX1, kickH + 0.132, lReturnZEnd + 0.002], [lDieX1 + 0.0008, kickH + 0.138, dieBack]);
    // Work-side shelf under the main counter (open, laminate)
    b.box(pal.laminateCabinet, [xMin, 0.5, dieBack - 0.01], [xMax, 0.52, dieBack + 0.3], { metric: true });

    // Footrail: 36 mm chrome tube 130 mm off the die face at 230 mm AFF, brackets every 1.2 m.
    const tubeZ = dieFront + footrest.gap + footrest.tubeR;
    const tubeX = lDieX1 + footrest.gap + footrest.tubeR; // corner of the L
    const rail = new THREE.CylinderGeometry(footrest.tubeR, footrest.tubeR, tubeX - (xMin + 0.05), 20);
    rail.rotateZ(Math.PI / 2);
    rail.translate((xMin + 0.05 + tubeX) / 2, footrest.y, tubeZ);
    b.add(rail, pal.chrome);
    for (let x = xMin + 0.3; x < xMax; x += footrest.bracketPitch) {
      // Cast bracket: 70 × 110 mm base plate on the die, tapered arm out to a saddle under the tube
      b.rbox(pal.chrome, [x - 0.035, footrest.y - 0.055, dieFront - 0.002], [x + 0.035, footrest.y + 0.055, dieFront + 0.01], 0.004);
      b.rbox(pal.chrome, [x - 0.014, footrest.y - 0.03, dieFront], [x + 0.014, footrest.y - 0.006, tubeZ + 0.012], 0.004);
      b.rbox(pal.chrome, [x - 0.02, footrest.y - 0.032, tubeZ - 0.014], [x + 0.02, footrest.y + 0.004, tubeZ + 0.014], 0.005);
    }
    // L-return footrest along z
    const rail2 = new THREE.CylinderGeometry(footrest.tubeR, footrest.tubeR, tubeZ - lReturnZEnd - 0.05, 20);
    rail2.rotateX(Math.PI / 2);
    rail2.translate(tubeX, footrest.y, (lReturnZEnd + 0.05 + tubeZ) / 2);
    b.add(rail2, pal.chrome);
    const elbow = new THREE.SphereGeometry(footrest.tubeR, 16, 12);
    elbow.translate(tubeX, footrest.y, tubeZ);
    b.add(elbow, pal.chrome);
    for (let z = lReturnZEnd + 0.3; z < dieBack; z += footrest.bracketPitch) {
      b.rbox(pal.chrome, [lDieX1 - 0.002, footrest.y - 0.055, z - 0.035], [lDieX1 + 0.01, footrest.y + 0.055, z + 0.035], 0.004);
      b.rbox(pal.chrome, [lDieX1, footrest.y - 0.03, z - 0.014], [tubeX + 0.012, footrest.y - 0.006, z + 0.014], 0.004);
      b.rbox(pal.chrome, [tubeX - 0.014, footrest.y - 0.032, z - 0.02], [tubeX + 0.014, footrest.y + 0.004, z + 0.02], 0.005);
    }

    // The L-return top stays empty: the register is a prop (System 2+).

    b.collider([xMin, 0, dieBack], [lReturnXOuter, height, topFrontZ]);
    b.collider([xMax, 0, lReturnZEnd], [lReturnXOuter, height, dieBack]);
  }

  /* ---------------- stools (instanced parts) ---------------- */
  {
    const n = STOOL.centersX.length;
    const r = STOOL.seatDiameter / 2;
    const { seatHeight, seatThickness: st, columnR, baseR, footringY, footringR } = STOOL;

    // Flared base: lathe profile from a 420 mm dome down to the column.
    const baseProfile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(baseR, 0),
      new THREE.Vector2(baseR - 0.004, 0.012),
      new THREE.Vector2(baseR * 0.72, 0.03),
      new THREE.Vector2(baseR * 0.42, 0.055),
      new THREE.Vector2(columnR + 0.02, 0.08),
      new THREE.Vector2(columnR + 0.006, 0.1),
      new THREE.Vector2(columnR, 0.11),
      new THREE.Vector2(0, 0.11),
    ];
    const base = new THREE.LatheGeometry(baseProfile, 40);
    const column = new THREE.CylinderGeometry(columnR, columnR, seatHeight - st - 0.11 - 0.02, 28);
    column.translate(0, 0.11 + (seatHeight - st - 0.11 - 0.02) / 2, 0);
    // Footring: torus Ø 0.42 at 290 mm AFF, 20 mm tube, fixed to a collar by four spokes.
    const footring = new THREE.TorusGeometry(footringR, STOOL.footringTube, 14, 56);
    footring.rotateX(Math.PI / 2);
    footring.translate(0, footringY, 0);
    const collar = new THREE.CylinderGeometry(columnR + 0.012, columnR + 0.012, 0.04, 28);
    collar.translate(0, footringY, 0);
    const spokes: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 4; k++) {
      const len = footringR - columnR;
      const s = new THREE.CylinderGeometry(0.007, 0.007, len, 12);
      s.rotateZ(Math.PI / 2);
      s.translate(columnR + len / 2, footringY, 0);
      s.rotateY((k / 4) * Math.PI * 2 + Math.PI / 4);
      spokes.push(s);
    }
    const swivel = new THREE.CylinderGeometry(0.07, 0.05, 0.02, 24);
    swivel.translate(0, seatHeight - st - 0.01, 0);
    // Seat cushion: vinyl rim band below a 22 mm chrome band (2 mm shadow gap under it), then the
    // upholstered top with a 6 mm rolled welt at the rim and a 25 mm domed crown.
    const bandY0 = 0.03, bandY1 = 0.052, crown = 0.025;
    const seatProfile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(r - 0.03, 0),
      new THREE.Vector2(r - 0.006, 0.006),
      new THREE.Vector2(r - 0.001, 0.016),
      new THREE.Vector2(r - 0.001, bandY0 - 0.002), // shadow gap under the band
      new THREE.Vector2(r - 0.004, bandY0),
      new THREE.Vector2(r - 0.004, bandY1),
      new THREE.Vector2(r - 0.002, bandY1 + 0.002),
      new THREE.Vector2(r, bandY1 + 0.006), // welt roll
      new THREE.Vector2(r - 0.002, bandY1 + 0.011),
      new THREE.Vector2(r - 0.006, bandY1 + 0.012),
      new THREE.Vector2(r - 0.012, st - crown + 0.002),
      new THREE.Vector2(r - 0.05, st - crown + 0.012),
      new THREE.Vector2(r - 0.1, st - crown + 0.019),
      new THREE.Vector2(r - 0.15, st - 0.001),
      new THREE.Vector2(0, st),
    ];
    const cushion = plainColor(new THREE.LatheGeometry(seatProfile, 56));
    cushion.translate(0, seatHeight - st, 0);
    // 22 mm chrome band around the rim, 2 mm shadow gap below it
    const seatBand = new THREE.CylinderGeometry(r + 0.0025, r + 0.0025, bandY1 - bandY0, 56, 1, true);
    seatBand.translate(0, seatHeight - st + (bandY0 + bandY1) / 2, 0);

    const parts: Array<[THREE.BufferGeometry, THREE.Material]> = [
      [base, pal.chrome],
      [column, pal.chrome],
      [footring, pal.chrome],
      [collar, pal.chrome],
      [spokes[0], pal.chrome],
      [spokes[1], pal.chrome],
      [spokes[2], pal.chrome],
      [spokes[3], pal.chrome],
      [swivel, pal.darkMetal],
      [cushion, pal.vinylRed],
      [seatBand, pal.chrome],
    ];
    // Per-stool: any swivel angle, ±5 mm height, ±20 mm off the line, two nudged ~50 mm along it.
    const rng = makeRng(808);
    const nudged = new Set([2, 6]);
    const poses = STOOL.centersX.map((x, i) => {
      const yaw = rng() * Math.PI * 2;
      const tilt = THREE.MathUtils.degToRad(0.6 * (rng() - 0.5)), tiltZ = THREE.MathUtils.degToRad(0.6 * (rng() - 0.5));
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tilt, yaw, tiltZ));
      const dx = (rng() - 0.5) * 0.02 + (nudged.has(i) ? (rng() < 0.5 ? -0.05 : 0.05) : 0);
      m.setPosition(x + dx, (rng() - 0.5) * 0.01, STOOL.z + (rng() - 0.5) * 0.04);
      return m;
    });
    for (const [geo, mat] of parts) {
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.castShadow = true;
      im.receiveShadow = true;
      poses.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.name = "stools";
      parent.add(im);
    }
    for (const x of STOOL.centersX) {
      b.collider([x - r, 0, STOOL.z - r], [x + r, seatHeight, STOOL.z + r]);
    }
  }

  /* ---------------- back bar ---------------- */
  {
    const { zFront, depth, height, xMin, xMax, coffeeX } = BACK_BAR;
    const zBack = zFront - depth;
    const kickH = 0.1, topT = 0.03;
    const openings = [BACK_BAR.cooler, BACK_BAR.drawers];
    const yTop = height - topT - 0.02;
    // Die with two equipment bays
    punchedWall(
      xMin,
      xMax,
      kickH,
      height - topT,
      openings.map(([a0, a1]) => ({ a0, a1, y0: kickH, y1: yTop })),
      (x0, x1, y0, y1) => b.box(pal.laminateCabinet, [x0, y0, zBack], [x1, y1, zFront], { metric: true }),
    );
    for (const [a0, a1] of openings) {
      // Stainless face frame; the bay is backed 60 mm deep so nothing reads as a hole
      b.box(pal.stainless, [a0 - 0.005, kickH, zBack], [a1 + 0.005, yTop, zFront - 0.06]);
      b.rbox(pal.stainless, [a0 - 0.02, kickH - 0.005, zFront - 0.02], [a0 + 0.01, yTop, zFront + 0.004], 0.002);
      b.rbox(pal.stainless, [a1 - 0.01, kickH - 0.005, zFront - 0.02], [a1 + 0.02, yTop, zFront + 0.004], 0.002);
      b.rbox(pal.stainless, [a0 - 0.02, yTop - 0.02, zFront - 0.02], [a1 + 0.02, yTop, zFront + 0.004], 0.002);
    }
    {
      // Reach-in cooler: one door with a full-height vertical pull and a hinge line
      const [a0, a1] = BACK_BAR.cooler;
      b.rbox(pal.stainless, [a0 + 0.015, kickH + 0.005, zFront - 0.04], [a1 - 0.015, yTop - 0.025, zFront - 0.012], 0.004, 3);
      const pull = new THREE.CylinderGeometry(0.012, 0.012, 0.5, 16);
      pull.translate(a1 - 0.07, (kickH + yTop) / 2, zFront + 0.03);
      b.add(pull, pal.chrome);
      for (const y of [(kickH + yTop) / 2 - 0.22, (kickH + yTop) / 2 + 0.22]) {
        b.rbox(pal.chrome, [a1 - 0.082, y - 0.012, zFront - 0.012], [a1 - 0.058, y + 0.012, zFront + 0.03], 0.003);
      }
      b.box(pal.darkMetal, [a0 + 0.015, kickH + 0.005, zFront - 0.014], [a0 + 0.02, yTop - 0.025, zFront - 0.011]);
    }
    {
      // Two-drawer unit with horizontal bar pulls
      const [a0, a1] = BACK_BAR.drawers;
      const mid = (kickH + yTop) / 2;
      for (const [y0, y1] of [
        [kickH + 0.005, mid - 0.004],
        [mid + 0.004, yTop - 0.025],
      ]) {
        b.rbox(pal.stainless, [a0 + 0.015, y0, zFront - 0.04], [a1 - 0.015, y1, zFront - 0.012], 0.004, 3);
        const py = (y0 + y1) / 2;
        const pull = new THREE.CylinderGeometry(0.01, 0.01, a1 - a0 - 0.2, 16);
        pull.rotateZ(Math.PI / 2);
        pull.translate((a0 + a1) / 2, py, zFront + 0.028);
        b.add(pull, pal.chrome);
        for (const px of [a0 + 0.1, a1 - 0.1]) {
          b.rbox(pal.chrome, [px - 0.01, py - 0.01, zFront - 0.012], [px + 0.01, py + 0.01, zFront + 0.028], 0.003);
        }
      }
    }
    // Recessed toe kick faced in cove base
    b.rbox(pal.baseboard, [xMin, 0, zBack], [xMax, kickH, zFront - 0.04], 0.004);
    // Stainless top with a bevelled nosing and a 100 mm backsplash line
    b.rbox(pal.stainless, [xMin, height - topT, zBack], [xMax, height, zFront + 0.02], 0.006, 3);
    b.rbox(pal.stainless, [xMin, height, zBack - 0.005], [xMax, height + 0.1, zBack + 0.015], 0.002);
    b.collider([xMin, 0, zBack], [xMax, height, zFront]);

    void coffeeX; // the brewer itself is built in Props.ts (System 2)
  }

  /* ---------------- upper cabinets + soffit ---------------- */
  {
    const { bottom, top, depth, soffitDepth, doorWidth, runs } = CABINETS;
    const zWall = ROOM.zBack;
    const zFace = zWall + depth;
    // Bulkhead / soffit: wall finish from the cabinet tops to the ceiling, 60 mm proud of the doors.
    // The ceiling grid stops against it with a wall angle (Ceiling.ts).
    b.box(pal.wallPaint, [BACK_BAR.xMin, top, zWall], [BACK_BAR.xMax, ROOM.height, zWall + soffitDepth], { uvScale: 2 });
    for (const [x0, x1] of runs) {
      // Carcass with a dark face so door gaps read as shadow; laminate end panels run to the soffit.
      b.box(pal.kickPanel, [x0 + 0.018, bottom, zWall], [x1 - 0.018, top, zFace - 0.02]);
      b.rbox(pal.laminateCabinet, [x0, bottom, zWall], [x0 + 0.018, top, zFace], 0.002, 2, { metric: true });
      b.rbox(pal.laminateCabinet, [x1 - 0.018, bottom, zWall], [x1, top, zFace], 0.002, 2, { metric: true });
      // Light rail under the cabinets (laminate, set back 30 mm)
      b.rbox(pal.laminateCabinet, [x0, bottom - 0.04, zFace - 0.05], [x1, bottom, zFace - 0.03], 0.002, 2, { metric: true });
      // Equal door modules with 3 mm gaps (dark carcass behind reads as the shadow), up to a scribe under the soffit
      const inner0 = x0 + 0.018, inner1 = x1 - 0.018;
      const count = Math.max(1, Math.round((inner1 - inner0) / doorWidth));
      const w = (inner1 - inner0) / count;
      for (let k = 0; k < count; k++) {
        const dx0 = inner0 + k * w + 0.0015, dx1 = inner0 + (k + 1) * w - 0.0015;
        b.rbox(pal.laminateCabinet, [dx0, bottom + 0.0015, zFace - 0.02], [dx1, top - 0.003, zFace], 0.002, 2, { metric: true });
        // 2 mm edge band on the door's visible vertical edges
        b.box(pal.edgeBand, [dx0, bottom + 0.0015, zFace - 0.02], [dx0 + 0.0022, top - 0.003, zFace + 0.0002]);
        b.box(pal.edgeBand, [dx1 - 0.0022, bottom + 0.0015, zFace - 0.02], [dx1, top - 0.003, zFace + 0.0002]);
        // Small bar pull near the bottom edge (alternating sides)
        const px = k % 2 === 0 ? dx1 - 0.05 : dx0 + 0.05;
        b.rbox(pal.chrome, [px - 0.006, bottom + 0.06, zFace], [px + 0.006, bottom + 0.16, zFace + 0.025], 0.003);
      }
    }
  }

  b.build(parent, { name: "counter" });
  return { colliders: b.colliders };
}
