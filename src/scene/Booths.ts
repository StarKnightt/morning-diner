/**
 * Five booths against the window wall, 1.8 m pitch. Each: a formica table with
 * rounded corners, bullnose and chrome band on a real pedestal; two facing
 * benches with 140 mm cushions on a plinth and kick, 9° wedge backs tapering
 * to a 90 mm roll; laminate dividers and end panels under one continuous
 * mitred 70 × 35 mm cap per divider (T-shaped in plan).
 * Props (napkin dispensers, condiments, menus) are System 2.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { prismXY, rectXZ, slabGeometry, type XZ } from "../core/shapes";
import { BOOTH, ROOM, WINDOW } from "./layout";

export function buildBooths(parent: THREE.Group, pal: Palette): { colliders: MergedBuilder["colliders"] } {
  const b = new MergedBuilder();
  const { zInner, zOuter, table, seat, back, divider, cap, kick, endPanel } = BOOTH;
  const zEnd0 = zInner - endPanel;
  const capHalf = cap.width / 2;
  // Cap crossbar (over the end panels) z-range: centred on the end panel, 70 mm wide.
  const czMid = (zEnd0 + zInner) / 2;
  const cz0 = czMid - capHalf, cz1 = czMid + capHalf;

  const capSlab = (pts: XZ[]) => {
    const [slab] = slabGeometry(pts, { radius: 0.006, y0: cap.y0, thickness: cap.y1 - cap.y0, bevel: 0.006, curveSegments: 3 });
    b.add(slab, pal.laminateWood);
  };

  for (const cx of WINDOW.centersX) {
    /* ---- table ---- */
    {
      const pts = rectXZ(cx - table.width / 2, zInner, cx + table.width / 2, zOuter);
      const [slab, band] = slabGeometry(pts, {
        radius: table.cornerR,
        y0: table.top - table.thickness,
        thickness: table.thickness,
        bevel: 0.012,
        bandHeight: table.band,
        bandProud: 0.003,
      });
      b.add(slab, pal.formica);
      if (band) b.add(band, pal.formicaEdge);
      // Pedestal: 90 mm chrome column on a 400 × 600 cast foot, mount plate under the top.
      const pz = (zInner + zOuter) / 2;
      b.rbox(pal.darkMetal, [cx - 0.2, 0, pz - 0.3], [cx + 0.2, 0.03, pz + 0.3], 0.012, 3);
      const colH = table.top - table.thickness - 0.045;
      const col = new THREE.CylinderGeometry(0.045, 0.045, colH, 24);
      col.translate(cx, 0.03 + colH / 2, pz);
      b.add(col, pal.chrome);
      b.rbox(pal.darkMetal, [cx - 0.15, table.top - table.thickness - 0.015, pz - 0.15], [cx + 0.15, table.top - table.thickness, pz + 0.15], 0.004);
      b.collider([cx - table.width / 2, 0, zInner], [cx + table.width / 2, table.top, zOuter]);
    }

    /* ---- benches ---- */
    for (const s of [-1, 1]) {
      const X = (u: number) => cx + s * u; // booth-local x → world
      const lo = (a: number, c: number) => Math.min(X(a), X(c));
      const hi = (a: number, c: number) => Math.max(X(a), X(c));
      const seatBack = seat.front + seat.depth; // 0.81
      // Cushion (rounded 40 mm front edge)
      b.rbox(pal.vinylRed, [lo(seat.front, seatBack), seat.top - seat.thickness, zInner], [hi(seat.front, seatBack), seat.top, zOuter], seat.edgeR, 4);
      // Plinth (laminate) and kick (rubber, recessed 30 mm)
      b.rbox(pal.laminateWood, [lo(seat.front + 0.01, divider.x0), kick, zInner], [hi(seat.front + 0.01, divider.x0), seat.top - seat.thickness, zOuter], 0.003);
      b.box(pal.baseboard, [lo(seat.front + 0.04, divider.x0), 0, zInner], [hi(seat.front + 0.04, divider.x0), kick, zOuter]);
      // Wedge back: front face reclined 9°, rear face vertical against the divider, tapering to the roll.
      const yb0 = seat.top + 0.01;
      const lean = Math.tan(THREE.MathUtils.degToRad(back.reclineDeg)) * (back.top - yb0);
      const profile: Array<[number, number]> = [
        [X(back.frontX), yb0],
        [X(back.rearX), yb0],
        [X(back.rearX), back.top],
        [X(back.frontX + lean), back.top],
      ];
      b.add(prismXY(profile, zInner, zOuter, 0.008), pal.vinylRed);
      // Rolled top cushion (90 mm Ø), tucked against the divider
      const rollX = X(back.rearX - back.rollR + 0.02);
      const roll = new THREE.CylinderGeometry(back.rollR, back.rollR, zOuter - zInner - 0.01, 24);
      roll.rotateX(Math.PI / 2);
      roll.translate(rollX, back.top, (zInner + zOuter) / 2);
      b.add(roll, pal.vinylRed);
      // Aisle-end panel: from the seat front to the divider, under the cap.
      b.rbox(pal.laminateWood, [lo(seat.front - 0.02, divider.x0), kick, zEnd0], [hi(seat.front - 0.02, divider.x0), cap.y0, zInner], 0.003);
      b.box(pal.baseboard, [lo(seat.front + 0.01, divider.x0 - 0.005), 0, zEnd0 + 0.012], [hi(seat.front + 0.01, divider.x0 - 0.005), kick, zInner]);
      b.collider([lo(seat.front - 0.05, divider.x0), 0, cz0], [hi(seat.front - 0.05, divider.x0), cap.y1, zOuter]);
    }
  }

  /* ---- dividers between back-to-back benches, with one T-shaped cap each ---- */
  const dividerBody = (x0: number, x1: number) => {
    b.rbox(pal.laminateWood, [x0, kick, zEnd0], [x1, cap.y0, zOuter], 0.003);
    b.box(pal.baseboard, [x0 + 0.005, 0, zEnd0 + 0.012], [x1 - 0.005, kick, zOuter]);
    b.collider([x0 - capHalf, 0, cz0], [x1 + capHalf, cap.y1, zOuter]);
  };
  const n = WINDOW.centersX.length;
  for (let i = 0; i < n - 1; i++) {
    const xd = (WINDOW.centersX[i] + WINDOW.centersX[i + 1]) / 2;
    dividerBody(xd - 0.02, xd + 0.02);
    // Crossbar spans both benches' end panels; stem runs back along the divider.
    const xa = WINDOW.centersX[i] + seat.front - 0.02 - 0.015;
    const xb = WINDOW.centersX[i + 1] - seat.front + 0.02 + 0.015;
    capSlab([
      [xa, cz0], [xb, cz0], [xb, cz1],
      [xd + capHalf, cz1], [xd + capHalf, zOuter], [xd - capHalf, zOuter], [xd - capHalf, cz1],
      [xa, cz1],
    ]);
  }
  // Left end: 40 mm partition with an L cap; a lower wall-return filler closes the gap to the wall.
  {
    const cx = WINDOW.centersX[0];
    const xd = cx - divider.x0 - 0.02;
    dividerBody(xd - 0.02, xd + 0.02);
    const xb = cx - seat.front + 0.02 + 0.015;
    capSlab([[xd - capHalf, cz0], [xb, cz0], [xb, cz1], [xd + capHalf, cz1], [xd + capHalf, zOuter], [xd - capHalf, zOuter]]);
    b.rbox(pal.laminateWood, [-ROOM.halfX + 0.012, kick, zEnd0], [xd - 0.02, cap.y0 - 0.03, zOuter], 0.003);
    b.box(pal.baseboard, [-ROOM.halfX + 0.012, 0, zEnd0 + 0.012], [xd - 0.02, kick, zOuter]);
    b.collider([-ROOM.halfX, 0, cz0], [xd, cap.y1, zOuter]);
  }
  // Right end: partition toward the door with an L cap (the vestibule side).
  {
    const cx = WINDOW.centersX[n - 1];
    const xd = cx + divider.x0 + 0.02;
    dividerBody(xd - 0.02, xd + 0.02);
    const xa = cx + seat.front - 0.02 - 0.015;
    capSlab([[xa, cz0], [xd + capHalf, cz0], [xd + capHalf, zOuter], [xd - capHalf, zOuter], [xd - capHalf, cz1], [xa, cz1]]);
  }

  b.build(parent, { name: "booths" });
  return { colliders: b.colliders };
}
