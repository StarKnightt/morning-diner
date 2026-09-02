/**
 * Counter run: formica-topped counter with stainless kick, eight bolted chrome
 * stools (InstancedMesh), back-bar work counter with a coffee-warmer position
 * and upper cabinets either side of the pass-through.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { BACK_BAR, COUNTER, PASS_THROUGH, ROOM, STOOL } from "./layout";

export function buildCounter(parent: THREE.Group, pal: Palette): { colliders: MergedBuilder["colliders"] } {
  const b = new MergedBuilder();

  /* ---------------- counter ---------------- */
  {
    const { zFront, depth, height, xMin, xMax, overhang } = COUNTER;
    const zBack = zFront - depth;
    const topT = 0.035;
    // Body
    b.box(pal.laminateWood, [xMin, 0.1, zBack], [xMax, height - topT, zFront]);
    // Stainless kick
    b.box(pal.stainless, [xMin, 0, zBack + 0.02], [xMax - 0.02, 0.1, zFront - 0.02]);
    // Top with overhang toward the customer side
    const tz1 = zFront + overhang;
    b.box(pal.formica, [xMin, height - topT, zBack], [xMax + overhang, height, tz1]);
    // Chrome edge band on the front (the end is taken over by the L-return below)
    const bt = 0.012;
    b.box(pal.formicaEdge, [xMin, height - topT - 0.006, tz1], [xMax + depth + overhang + bt, height + 0.002, tz1 + bt]);
    // Footrest rail: chrome tube along the front at 0.2 m, on brackets.
    const rail = new THREE.CylinderGeometry(0.02, 0.02, xMax - xMin - 0.3, 16);
    rail.rotateZ(Math.PI / 2);
    rail.translate((xMin + xMax) / 2, 0.22, zFront + 0.18);
    b.add(rail, pal.chrome);
    for (let x = xMin + 0.4; x < xMax - 0.2; x += 1.6) {
      b.box(pal.chrome, [x - 0.015, 0.2, zFront - 0.01], [x + 0.015, 0.24, zFront + 0.18]);
    }
    b.collider([xMin, 0, zBack], [xMax + overhang, height, tz1]);

    // Work-side shelf under the counter (open, dark)
    b.box(pal.kickPanel, [xMin, 0.5, zBack - 0.01], [xMax, 0.52, zBack + 0.3]);

    // L-return at the door end: the register end of the counter turns toward
    // the kitchen wall, leaving a staff gap between its end and the back bar.
    const lx0 = xMax, lx1 = xMax + depth;
    const lz0 = COUNTER.lReturnZ, lz1 = zBack;
    b.box(pal.laminateWood, [lx0, 0.1, lz0], [lx1, height - topT, lz1]);
    b.box(pal.stainless, [lx0 + 0.02, 0, lz0 + 0.02], [lx1 - 0.02, 0.1, lz1]);
    b.box(pal.formica, [lx0, height - topT, lz0 - overhang], [lx1 + overhang, height, lz1]);
    b.box(pal.formicaEdge, [lx1 + overhang, height - topT - 0.006, lz0 - overhang - bt], [lx1 + overhang + bt, height + 0.002, tz1 + bt]);
    b.box(pal.formicaEdge, [lx0 - 0.001, height - topT - 0.006, lz0 - overhang - bt], [lx1 + overhang, height + 0.002, lz0 - overhang]);
    b.collider([lx0, 0, lz0 - overhang], [lx1 + overhang, height, lz1]);
  }

  /* ---------------- stools (instanced) ---------------- */
  {
    const n = STOOL.centersX.length;
    const r = STOOL.seatDiameter / 2;
    const seatT = 0.07;
    const parts: Array<[THREE.BufferGeometry, THREE.Material, number]> = [
      [new THREE.CylinderGeometry(0.16, 0.19, 0.03, 28), pal.chrome, 0.015],
      [new THREE.CylinderGeometry(0.035, 0.035, STOOL.seatHeight - seatT - 0.03, 20), pal.chrome, 0.03 + (STOOL.seatHeight - seatT - 0.03) / 2],
      [new THREE.CylinderGeometry(r + 0.006, r + 0.006, 0.035, 32), pal.chrome, STOOL.seatHeight - seatT + 0.0175],
      [new THREE.CylinderGeometry(r, r, seatT, 32), pal.vinylRed, STOOL.seatHeight - seatT / 2],
    ];
    const m = new THREE.Matrix4();
    for (const [geo, mat, y] of parts) {
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.castShadow = true;
      im.receiveShadow = true;
      STOOL.centersX.forEach((x, i) => {
        m.makeTranslation(x, y, STOOL.z);
        im.setMatrixAt(i, m);
      });
      im.instanceMatrix.needsUpdate = true;
      im.name = "stools";
      parent.add(im);
    }
    for (const x of STOOL.centersX) {
      b.collider([x - r, 0, STOOL.z - r], [x + r, STOOL.seatHeight, STOOL.z + r]);
    }
  }

  /* ---------------- back bar ---------------- */
  {
    const { zFront, depth, height, xMin, xMax, coffeeX } = BACK_BAR;
    const zBack = zFront - depth;
    b.box(pal.laminateWood, [xMin, 0.08, zBack], [xMax, height - 0.03, zFront]);
    b.box(pal.stainless, [xMin, 0, zBack], [xMax - 0.02, 0.08, zFront - 0.02]);
    b.box(pal.stainless, [xMin, height - 0.03, zBack - 0.01], [xMax, height, zFront + 0.02]);
    // Backsplash
    b.box(pal.stainless, [xMin, height, zBack - 0.01], [xMax, height + 0.12, zBack + 0.02]);
    b.collider([xMin, 0, zBack], [xMax, height, zFront]);

    // Coffee warmer position: stainless brewer body placeholder (System 2 details it).
    b.box(pal.stainless, [coffeeX - 0.2, height, zBack + 0.05], [coffeeX + 0.2, height + 0.42, zBack + 0.45]);
    b.box(pal.darkMetal, [coffeeX - 0.18, height + 0.005, zBack + 0.05], [coffeeX + 0.18, height + 0.03, zBack + 0.5]);

    // Upper cabinets either side of the pass-through.
    const p0 = PASS_THROUGH.centerX - PASS_THROUGH.width / 2 - 0.1;
    const p1 = PASS_THROUGH.centerX + PASS_THROUGH.width / 2 + 0.1;
    const cz0 = ROOM.zBack, cz1 = ROOM.zBack + 0.35;
    const cy0 = 1.55, cy1 = 2.35;
    b.box(pal.laminateWood, [xMin + 0.01, cy0, cz0], [p0, cy1, cz1]);
    b.box(pal.laminateWood, [p1, cy0, cz0], [xMax, cy1, cz1]);
    // Door reveals on the cabinets: thin recessed lines.
    for (let x = xMin + 0.01 + 0.6; x < p0 - 0.1; x += 0.6) {
      b.box(pal.kickPanel, [x - 0.003, cy0 + 0.02, cz1 - 0.001], [x + 0.003, cy1 - 0.02, cz1 + 0.002]);
    }
    for (let x = p1 + 0.6; x < xMax - 0.1; x += 0.6) {
      b.box(pal.kickPanel, [x - 0.003, cy0 + 0.02, cz1 - 0.001], [x + 0.003, cy1 - 0.02, cz1 + 0.002]);
    }
    // Shelf between cabinets over the pass-through? No — keep the opening clear.
  }

  b.build(parent, { name: "counter" });
  return { colliders: b.colliders };
}
