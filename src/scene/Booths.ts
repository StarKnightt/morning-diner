/**
 * Five booths against the window wall, 1.8 m pitch. Each: a formica table with
 * rounded corners, bullnose and chrome band on a real pedestal; two facing
 * benches with 140 mm cushions on a plinth and kick, reclined wedge backs with
 * a rolled top; laminate dividers and end panels with 30 mm caps.
 * Props (napkin dispensers, condiments, menus) are System 2.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { prismXY, rectXZ, slabGeometry } from "../core/shapes";
import { BOOTH, ROOM, WINDOW } from "./layout";

export function buildBooths(parent: THREE.Group, pal: Palette): { colliders: MergedBuilder["colliders"] } {
  const b = new MergedBuilder();
  const { zInner, zOuter, table, seat, back, divider, cap, kick } = BOOTH;
  const zEnd0 = zInner - 0.04; // end panel thickness

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
      b.rbox(pal.darkMetal, [cx - 0.2, 0, pz - 0.3], [cx + 0.2, 0.025, pz + 0.3], 0.01, 3);
      const col = new THREE.CylinderGeometry(0.045, 0.045, table.top - table.thickness - 0.035, 24);
      col.translate(cx, 0.025 + (table.top - table.thickness - 0.035) / 2, pz);
      b.add(col, pal.chrome);
      b.rbox(pal.darkMetal, [cx - 0.15, table.top - table.thickness - 0.012, pz - 0.15], [cx + 0.15, table.top - table.thickness, pz + 0.15], 0.004);
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
      // Reclined wedge back: front face leans 8°, rear face vertical against the divider.
      const lean = Math.tan(THREE.MathUtils.degToRad(back.reclineDeg)) * (back.top - (seat.top + 0.01));
      const profile: Array<[number, number]> = [
        [X(back.frontX), seat.top + 0.01],
        [X(back.rearX), seat.top + 0.01],
        [X(back.rearX), back.top],
        [X(back.frontX + lean), back.top],
      ];
      b.add(prismXY(profile, zInner, zOuter, 0.008), pal.vinylRed);
      // Rolled top cushion
      const rollX = X((back.frontX + lean + back.rearX) / 2);
      const roll = new THREE.CylinderGeometry(back.rollR, back.rollR, zOuter - zInner - 0.01, 24);
      roll.rotateX(Math.PI / 2);
      roll.translate(rollX, back.top - 0.005, (zInner + zOuter) / 2);
      b.add(roll, pal.vinylRed);
      // Aisle-end panel: from the seat front to the divider, full bench height, capped.
      // (butts against the divider partition; no coplanar overlap)
      b.rbox(pal.laminateWood, [lo(seat.front - 0.02, divider.x0), kick, zEnd0], [hi(seat.front - 0.02, divider.x0), cap.y0, zInner], 0.003);
      b.box(pal.baseboard, [lo(seat.front + 0.01, divider.x0 - 0.005), 0, zEnd0 + 0.012], [hi(seat.front + 0.01, divider.x0 - 0.005), kick, zInner]);
      b.rbox(pal.laminateWood, [lo(seat.front - 0.05, divider.x0 - cap.proud), cap.y0, zEnd0 - cap.proud], [hi(seat.front - 0.05, divider.x0 - cap.proud), cap.y1, zInner + 0.02], 0.004, 3);
      b.collider([lo(seat.front - 0.05, divider.x0), 0, zEnd0 - cap.proud], [hi(seat.front - 0.05, divider.x0), cap.y1, zOuter]);
    }
  }

  /* ---- dividers between back-to-back benches, and end partitions ---- */
  const partition = (x0: number, x1: number) => {
    b.rbox(pal.laminateWood, [x0, kick, zEnd0], [x1, cap.y0, zOuter], 0.003);
    b.box(pal.baseboard, [x0 + 0.005, 0, zEnd0 + 0.012], [x1 - 0.005, kick, zOuter]);
    b.rbox(pal.laminateWood, [x0 - cap.proud, cap.y0, zEnd0 - cap.proud], [x1 + cap.proud, cap.y1, zOuter], 0.004, 3);
    b.collider([x0 - cap.proud, 0, zEnd0 - cap.proud], [x1 + cap.proud, cap.y1, zOuter]);
  };
  for (let i = 0; i < WINDOW.centersX.length - 1; i++) {
    const x0 = WINDOW.centersX[i] + divider.x0, x1 = WINDOW.centersX[i + 1] - divider.x0;
    partition(x0, x1);
  }
  // Left end: partition fills to the wall.
  partition(-ROOM.halfX + 0.012, WINDOW.centersX[0] - divider.x0);
  // Right end: proper end partition toward the door.
  {
    const x0 = WINDOW.centersX[WINDOW.centersX.length - 1] + divider.x0;
    partition(x0, x0 + 0.04);
  }

  b.build(parent, { name: "booths" });
  return { colliders: b.colliders };
}
