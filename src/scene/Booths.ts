/**
 * Five booths against the window wall: pedestal table with chrome-banded
 * formica top, two facing vinyl benches, laminate dividers between the
 * back-to-back benches. Detail (rolled cushions, napkin dispensers, condiments)
 * is System 2.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { BOOTH, ROOM, WINDOW } from "./layout";

export function buildBooths(parent: THREE.Group, pal: Palette): { colliders: MergedBuilder["colliders"] } {
  const b = new MergedBuilder();
  const zWall = ROOM.zFront;
  const zOuter = zWall - 0.05; // 5 cm gap to the wall
  const zInner = zOuter - BOOTH.bench.length;
  const { table, bench, benchOffset } = BOOTH;

  for (const cx of WINDOW.centersX) {
    /* ---- table ---- */
    const tx0 = cx - table.width / 2, tx1 = cx + table.width / 2;
    const tz1 = zOuter, tz0 = zOuter - table.length;
    const topY1 = table.top, topY0 = table.top - table.thickness;
    b.box(pal.formica, [tx0, topY0, tz0], [tx1, topY1, tz1]);
    // Chrome edge band: four thin strips wrapping the top edge.
    const bt = 0.012, by0 = topY0 - 0.006, by1 = topY1 + 0.002;
    b.box(pal.formicaEdge, [tx0 - bt, by0, tz0 - bt], [tx0, by1, tz1 + bt]);
    b.box(pal.formicaEdge, [tx1, by0, tz0 - bt], [tx1 + bt, by1, tz1 + bt]);
    b.box(pal.formicaEdge, [tx0, by0, tz0 - bt], [tx1, by1, tz0]);
    b.box(pal.formicaEdge, [tx0, by0, tz1], [tx1, by1, tz1 + bt]);
    // Pedestal: chrome column on a weighted base.
    const pz = (tz0 + tz1) / 2 + 0.1;
    const col = new THREE.CylinderGeometry(0.035, 0.035, topY0 - 0.03, 20);
    col.translate(cx, 0.03 + (topY0 - 0.03) / 2, pz);
    b.add(col, pal.chrome);
    const base = new THREE.CylinderGeometry(0.22, 0.26, 0.03, 28);
    base.translate(cx, 0.015, pz);
    b.add(base, pal.chrome);
    const plate = new THREE.BoxGeometry(0.5, 0.02, 0.5);
    plate.translate(cx, topY0 - 0.01, pz);
    b.add(plate, pal.darkMetal);
    b.collider([tx0, 0, tz0], [tx1, topY1, tz1]);

    /* ---- benches ---- */
    for (const side of [-1, 1]) {
      const bcx = cx + side * benchOffset;
      const bx0 = bcx - bench.depth / 2, bx1 = bcx + bench.depth / 2;
      const outerX = side < 0 ? bx0 : bx1; // wall-facing (back) edge
      const innerX = side < 0 ? bx1 : bx0; // table-facing edge
      // Plinth (laminate), slightly inset.
      b.box(pal.laminateWood, [bx0 + 0.02, 0, zInner + 0.02], [bx1 - 0.02, bench.seatHeight - 0.08, zOuter]);
      // Seat cushion (vinyl).
      b.box(pal.vinylRed, [bx0, bench.seatHeight - 0.08, zInner], [bx1, bench.seatHeight, zOuter]);
      // Backrest (vinyl), slightly tilted look faked by a thicker top.
      const backT = 0.11;
      const bxA = side < 0 ? outerX : outerX - backT;
      const bxB = side < 0 ? outerX + backT : outerX;
      b.box(pal.vinylRed, [bxA, bench.seatHeight, zInner], [bxB, bench.backHeight - 0.03, zOuter]);
      // Laminate cap on top of the back.
      b.box(pal.laminateWood, [bxA - 0.01, bench.backHeight - 0.03, zInner - 0.01], [bxB + 0.01, bench.backHeight, zOuter]);
      // End panel on the aisle end (laminate).
      b.box(pal.laminateWood, [Math.min(bxA, innerX) - 0.005, 0, zInner - 0.02], [Math.max(bxB, innerX) + 0.005, bench.backHeight - 0.05, zInner]);
      b.collider([bx0, 0, zInner - 0.02], [bx1, bench.backHeight, zOuter]);
    }
  }

  /* ---- dividers between back-to-back benches, and end fills ---- */
  const backOut = benchOffset + bench.depth / 2; // 0.85
  for (let i = 0; i < WINDOW.centersX.length - 1; i++) {
    const x0 = WINDOW.centersX[i] + backOut, x1 = WINDOW.centersX[i + 1] - backOut;
    if (x1 > x0) {
      b.box(pal.laminateWood, [x0 - 0.002, 0, zInner - 0.02], [x1 + 0.002, bench.backHeight, zOuter]);
      b.collider([x0, 0, zInner - 0.02], [x1, bench.backHeight, zOuter]);
    }
  }
  // Left end: fill to the wall.
  {
    const x1 = WINDOW.centersX[0] - backOut;
    b.box(pal.laminateWood, [-ROOM.halfX + 0.012, 0, zInner - 0.02], [x1 + 0.002, bench.backHeight, zOuter]);
    b.collider([-ROOM.halfX, 0, zInner - 0.02], [x1, bench.backHeight, zOuter]);
  }
  // Right end: exposed laminate end panel toward the door.
  {
    const x0 = WINDOW.centersX[WINDOW.centersX.length - 1] + backOut;
    b.box(pal.laminateWood, [x0 - 0.002, 0, zInner - 0.02], [x0 + 0.03, bench.backHeight, zOuter]);
  }

  b.build(parent, { name: "booths" });
  return { colliders: b.colliders };
}
