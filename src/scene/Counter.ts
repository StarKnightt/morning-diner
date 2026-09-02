/**
 * Counter run: L-shaped formica top (bullnose + chrome band) on a 400 mm die
 * with a 300 mm knee overhang and recessed toe kick, 40 mm chrome footrest on
 * brackets, ten bolted chrome stools (InstancedMesh parts), register block at
 * the door end, back bar with toe kick / backsplash / equipment openings, and
 * a continuous upper-cabinet run under a soffit.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { slabGeometry, type XZ } from "../core/shapes";
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
      bevel: 0.018,
      bandHeight: 0.02,
      bandProud: 0.003,
      curveSegments: 8,
    });
    b.add(slab, pal.formica);
    if (band) b.add(band, pal.formicaEdge);

    // Die (laminate) and recessed toe kick (dark), main run and L-return.
    const kickH = 0.1, kickIn = 0.05;
    b.box(pal.laminateWood, [xMin, kickH, dieBack], [xMax, height - tt, dieFront]);
    b.box(pal.kickPanel, [xMin, 0, dieBack], [xMax, kickH, dieFront - kickIn]);
    b.box(pal.laminateWood, [xMax, kickH, lReturnZEnd], [lDieX1, height - tt, dieBack]);
    b.box(pal.kickPanel, [xMax, 0, lReturnZEnd + kickIn], [lDieX1 - kickIn, kickH, dieBack]);
    // Work-side shelf under the main counter (open, dark)
    b.box(pal.kickPanel, [xMin, 0.5, dieBack - 0.01], [xMax, 0.52, dieBack + 0.3]);

    // Footrest: 40 mm chrome tube 50 mm off the die face, brackets every 1.2 m.
    const tubeZ = dieFront + footrest.gap + footrest.tubeR;
    const tubeX = lDieX1 + footrest.gap + footrest.tubeR; // corner of the L
    const rail = new THREE.CylinderGeometry(footrest.tubeR, footrest.tubeR, tubeX - (xMin + 0.05), 20);
    rail.rotateZ(Math.PI / 2);
    rail.translate((xMin + 0.05 + tubeX) / 2, footrest.y, tubeZ);
    b.add(rail, pal.chrome);
    for (let x = xMin + 0.3; x < xMax; x += footrest.bracketPitch) {
      b.rbox(pal.chrome, [x - 0.015, footrest.y - 0.012, dieFront - 0.005], [x + 0.015, footrest.y + 0.012, tubeZ], 0.003);
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
      b.rbox(pal.chrome, [lDieX1 - 0.005, footrest.y - 0.012, z - 0.015], [tubeX, footrest.y + 0.012, z + 0.015], 0.003);
    }

    // Register / pie-case block on the top at the door end (geometry only).
    const { x0: rx0, x1: rx1 } = COUNTER.register;
    b.rbox(pal.stainless, [rx0, height, dieBack + 0.05], [rx1, height + 0.03, dieFront + 0.05], 0.003);
    b.rbox(pal.formica, [rx0 + 0.02, height + 0.03, dieBack + 0.07], [rx1 - 0.02, height + 0.28, dieFront + 0.03], 0.006, 3);
    b.rbox(pal.stainless, [rx0, height + 0.28, dieBack + 0.05], [rx1, height + 0.31, dieFront + 0.05], 0.003);

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
    const footring = new THREE.TorusGeometry(footringR, 0.011, 12, 48);
    footring.rotateX(Math.PI / 2);
    footring.translate(0, footringY, 0);
    const spokes: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 3; k++) {
      const s = new THREE.BoxGeometry(footringR - columnR + 0.01, 0.014, 0.014);
      s.translate((footringR + columnR) / 2, footringY, 0);
      s.rotateY((k / 3) * Math.PI * 2);
      spokes.push(s);
    }
    const swivel = new THREE.CylinderGeometry(0.07, 0.05, 0.02, 24);
    swivel.translate(0, seatHeight - st - 0.01, 0);
    // Seat cushion: lathe with a 20 mm rounded edge.
    const seatProfile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(r - 0.02, 0),
      new THREE.Vector2(r - 0.006, 0.006),
      new THREE.Vector2(r, 0.02),
      new THREE.Vector2(r, st - 0.03),
      new THREE.Vector2(r - 0.008, st - 0.008),
      new THREE.Vector2(r - 0.03, st),
      new THREE.Vector2(0, st),
    ];
    const cushion = new THREE.LatheGeometry(seatProfile, 40);
    cushion.translate(0, seatHeight - st, 0);
    // Chrome band around the cushion edge
    const seatBand = new THREE.CylinderGeometry(r + 0.004, r + 0.004, 0.022, 40, 1, true);
    seatBand.translate(0, seatHeight - st + 0.03, 0);

    const parts: Array<[THREE.BufferGeometry, THREE.Material]> = [
      [base, pal.chrome],
      [column, pal.chrome],
      [footring, pal.chrome],
      [spokes[0], pal.chrome],
      [spokes[1], pal.chrome],
      [spokes[2], pal.chrome],
      [swivel, pal.darkMetal],
      [cushion, pal.vinylRed],
      [seatBand, pal.chrome],
    ];
    const m = new THREE.Matrix4();
    for (const [geo, mat] of parts) {
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.castShadow = true;
      im.receiveShadow = true;
      STOOL.centersX.forEach((x, i) => {
        m.makeTranslation(x, 0, STOOL.z);
        im.setMatrixAt(i, m);
      });
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
    // Die with equipment openings
    punchedWall(
      xMin,
      xMax,
      kickH,
      height - topT,
      BACK_BAR.openings.map(([a0, a1]) => ({ a0, a1, y0: kickH, y1: height - topT - 0.02 })),
      (x0, x1, y0, y1) => b.box(pal.laminateWood, [x0, y0, zBack], [x1, y1, zFront]),
    );
    for (const [a0, a1] of BACK_BAR.openings) {
      // Dark interior with a stainless face frame
      b.box(pal.kickPanel, [a0 + 0.01, kickH, zBack], [a1 - 0.01, height - topT - 0.02, zFront - 0.35]);
      b.rbox(pal.stainless, [a0 - 0.02, kickH - 0.005, zFront - 0.02], [a0 + 0.01, height - topT - 0.02, zFront + 0.004], 0.002);
      b.rbox(pal.stainless, [a1 - 0.01, kickH - 0.005, zFront - 0.02], [a1 + 0.02, height - topT - 0.02, zFront + 0.004], 0.002);
      b.rbox(pal.stainless, [a0 - 0.02, height - topT - 0.04, zFront - 0.02], [a1 + 0.02, height - topT - 0.02, zFront + 0.004], 0.002);
    }
    b.box(pal.kickPanel, [xMin, 0, zBack], [xMax, kickH, zFront - 0.05]);
    // Stainless top with a bevelled nosing and a 100 mm backsplash line
    b.rbox(pal.stainless, [xMin, height - topT, zBack], [xMax, height, zFront + 0.02], 0.006, 3);
    b.rbox(pal.stainless, [xMin, height, zBack - 0.005], [xMax, height + 0.1, zBack + 0.015], 0.002);
    b.collider([xMin, 0, zBack], [xMax, height, zFront]);

    // Coffee warmer position: stainless brewer body placeholder (System 2 details it).
    b.rbox(pal.stainless, [coffeeX - 0.2, height, zBack + 0.05], [coffeeX + 0.2, height + 0.42, zBack + 0.45], 0.004, 3);
    b.rbox(pal.darkMetal, [coffeeX - 0.18, height + 0.005, zBack + 0.05], [coffeeX + 0.18, height + 0.03, zBack + 0.5], 0.003);
  }

  /* ---------------- upper cabinets + soffit ---------------- */
  {
    const { bottom, top, depth, soffitDepth, doorWidth, runs } = CABINETS;
    const zWall = ROOM.zBack;
    const zFace = zWall + depth;
    // Soffit / bulkhead: continuous, ties the cabinets to the ceiling.
    b.box(pal.wallPaint, [BACK_BAR.xMin, top, zWall], [BACK_BAR.xMax, ROOM.height, zWall + soffitDepth], { uvScale: 2 });
    // Reveal shadow line under the soffit
    b.box(pal.kickPanel, [BACK_BAR.xMin, top - 0.02, zWall], [BACK_BAR.xMax, top, zWall + soffitDepth - 0.015]);
    for (const [x0, x1] of runs) {
      // Carcass with a dark face so door gaps read as shadow; laminate end panels.
      b.box(pal.kickPanel, [x0 + 0.018, bottom, zWall], [x1 - 0.018, top - 0.02, zFace - 0.02]);
      b.rbox(pal.laminateWood, [x0, bottom, zWall], [x0 + 0.018, top - 0.02, zFace], 0.002);
      b.rbox(pal.laminateWood, [x1 - 0.018, bottom, zWall], [x1, top - 0.02, zFace], 0.002);
      // Light valance / cleat under the cabinets
      b.box(pal.kickPanel, [x0, bottom - 0.04, zFace - 0.05], [x1, bottom, zFace - 0.02]);
      // Equal door modules with 4 mm reveals
      const inner0 = x0 + 0.018, inner1 = x1 - 0.018;
      const count = Math.max(1, Math.round((inner1 - inner0) / doorWidth));
      const w = (inner1 - inner0) / count;
      for (let k = 0; k < count; k++) {
        const dx0 = inner0 + k * w + 0.002, dx1 = inner0 + (k + 1) * w - 0.002;
        b.rbox(pal.laminateWood, [dx0, bottom + 0.002, zFace - 0.02], [dx1, top - 0.024, zFace], 0.003, 2);
        // Small bar pull near the bottom edge (alternating sides)
        const px = k % 2 === 0 ? dx1 - 0.05 : dx0 + 0.05;
        b.rbox(pal.chrome, [px - 0.006, bottom + 0.06, zFace], [px + 0.006, bottom + 0.16, zFace + 0.025], 0.003);
      }
    }
  }

  b.build(parent, { name: "counter" });
  return { colliders: b.colliders };
}
