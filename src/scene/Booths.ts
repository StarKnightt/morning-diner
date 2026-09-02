/**
 * Five booths against the window wall, 1.8 m pitch. Each: a boomerang-formica
 * table with 50 mm corners, bullnose and chrome band on a cast bell pedestal;
 * two facing benches with pillowed, welted 140 mm vinyl cushions on a plinth
 * and kick, 9° channel-tufted backs tapering to a 90 mm roll; laminate
 * dividers and end panels under one continuous mitred 60 × 40 mm cap per
 * divider (T-shaped in plan). Tabletop props live in Props.ts.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { prismXY, rectXZ, slabGeometry, type XZ } from "../core/shapes";
import { channelPanel, cushionGeometry, metricUv, piping, plainColor, roundedRectPoints } from "../core/upholstery";
import { BOOTH, ROOM, WINDOW } from "./layout";

export function buildBooths(parent: THREE.Group, pal: Palette): { colliders: MergedBuilder["colliders"] } {
  const b = new MergedBuilder();
  const { zInner, zOuter, table, seat, back, divider, cap, kick, endPanel } = BOOTH;
  const zEnd0 = zInner - endPanel;
  const capHalf = cap.width / 2;
  // Cap crossbar (over the end panels) z-range: centred on the end panel, 70 mm wide.
  const czMid = (zEnd0 + zInner) / 2;
  const cz0 = czMid - capHalf, cz1 = czMid + capHalf;

  // Cap rail 60 × 40 mm with a 16 mm bullnose, one continuous run per divider.
  const capSlab = (pts: XZ[]) => {
    const [slab] = slabGeometry(pts, { radius: 0.008, y0: cap.y0, thickness: cap.y1 - cap.y0, bevel: cap.bullnose, curveSegments: 3 });
    b.add(slab, pal.laminateWood);
  };

  for (const cx of WINDOW.centersX) {
    /* ---- table ---- */
    {
      const zT0 = zInner + table.inset;
      const pts = rectXZ(cx - table.width / 2, zT0, cx + table.width / 2, zOuter);
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
      // Pedestal on the table centroid: cast bell base Ø 470 (40 mm rim rising to a Ø 150 boss),
      // chrome column, 360 mm spider plate under the top.
      const pz = (zT0 + zOuter) / 2;
      const { bellR, bellRim, bossR, bossH, columnR, spider } = BOOTH.pedestal;
      const bell = new THREE.LatheGeometry(
        [
          new THREE.Vector2(0, 0),
          new THREE.Vector2(bellR, 0),
          new THREE.Vector2(bellR, 0.012),
          new THREE.Vector2(bellR - 0.006, bellRim),
          new THREE.Vector2(bellR * 0.72, bellRim + 0.012),
          new THREE.Vector2(bellR * 0.45, bellRim + 0.03),
          new THREE.Vector2(bossR + 0.01, bossH - 0.012),
          new THREE.Vector2(bossR, bossH),
          new THREE.Vector2(0, bossH),
        ],
        48,
      );
      bell.translate(cx, 0, pz);
      b.add(bell, pal.darkMetal);
      const colH = table.top - table.thickness - 0.02 - bossH;
      const col = new THREE.CylinderGeometry(columnR, columnR, colH, 28);
      col.translate(cx, bossH + colH / 2, pz);
      b.add(col, pal.chrome);
      const plate = new THREE.CylinderGeometry(spider / 2, spider / 2 - 0.01, 0.02, 32);
      plate.translate(cx, table.top - table.thickness - 0.01, pz);
      b.add(plate, pal.darkMetal);
      for (let k = 0; k < 4; k++) {
        const arm = new THREE.BoxGeometry(spider / 2 - columnR, 0.03, 0.04);
        arm.translate((spider / 2 + columnR) / 2, 0, 0);
        arm.rotateY((k / 4) * Math.PI * 2);
        arm.translate(cx, table.top - table.thickness - 0.035, pz);
        b.add(arm, pal.darkMetal);
      }
      b.collider([cx - table.width / 2, 0, zT0], [cx + table.width / 2, table.top, zOuter]);
    }

    /* ---- benches ---- */
    for (const s of [-1, 1]) {
      const X = (u: number) => cx + s * u; // booth-local x → world
      const lo = (a: number, c: number) => Math.min(X(a), X(c));
      const hi = (a: number, c: number) => Math.max(X(a), X(c));
      const seatBack = seat.front + seat.depth; // 0.81
      const zMid = (zInner + zOuter) / 2, cd = zOuter - zInner;
      // Seat cushion: pillowed top, bellied front (toward the table), welt around the top edge.
      {
        const cush = cushionGeometry(seat.depth, seat.thickness, cd, seat.edgeR, {
          bulge: 0.012,
          belly: s > 0 ? "-x" : "+x",
          bellyAmount: 0.008,
          wear: 0.45,
        });
        cush.translate((lo(seat.front, seatBack) + hi(seat.front, seatBack)) / 2, seat.top - seat.thickness / 2, zMid);
        b.add(cush, pal.vinylRed);
        const welt = piping(
          roundedRectPoints(lo(seat.front, seatBack) + 0.01, zInner + 0.01, hi(seat.front, seatBack) - 0.01, zOuter - 0.01, seat.top - 0.014, seat.edgeR),
          0.0025,
          true,
        );
        b.add(welt, pal.vinylRed);
      }
      // Plinth (laminate) and kick (rubber, recessed 30 mm)
      b.rbox(pal.laminateWood, [lo(seat.front + 0.01, divider.x0), kick, zInner], [hi(seat.front + 0.01, divider.x0), seat.top - seat.thickness, zOuter], 0.003);
      b.box(pal.baseboard, [lo(seat.front + 0.04, divider.x0), 0, zInner], [hi(seat.front + 0.04, divider.x0), kick, zOuter]);
      // Wedge back: front face reclined 9°, rear face vertical against the divider, tapering to the roll.
      const yb0 = seat.top + 0.01;
      const recl = THREE.MathUtils.degToRad(back.reclineDeg);
      const lean = Math.tan(recl) * (back.top - yb0);
      const profile: Array<[number, number]> = [
        [X(back.frontX), yb0],
        [X(back.rearX), yb0],
        [X(back.rearX), back.top],
        [X(back.frontX + lean), back.top],
      ];
      const wedge = prismXY(profile, zInner, zOuter, 0.008);
      metricUv(wedge);
      b.add(plainColor(wedge), pal.vinylRed);
      // Channel tufting on the reclined face: 100 mm pleats bulging 16 mm, seated 3 mm inside the wedge.
      {
        const faceLen = Math.hypot(lean, back.top - yb0);
        const panelH = faceLen - 0.1;
        const panel = channelPanel(cd - 0.03, panelH, 0.1, 0.016);
        const ex = new THREE.Vector3(0, 0, s), ey = new THREE.Vector3(0, 1, 0), ez = new THREE.Vector3(-s, 0, 0);
        const m = new THREE.Matrix4().makeBasis(ex, ey, ez);
        m.premultiply(new THREE.Matrix4().makeRotationZ(-s * recl));
        const dirX = (s * lean) / faceLen, dirY = (back.top - yb0) / faceLen;
        const t = 0.02 + panelH / 2;
        m.setPosition(X(back.frontX) + dirX * t + s * 0.003, yb0 + dirY * t, zMid);
        b.add(panel, pal.vinylRed, m);
      }
      // Rolled top cushion (90 mm Ø), tucked against the divider, with a welt where it meets the face.
      const rollX = X(back.rearX - back.rollR + 0.02);
      const roll = new THREE.CylinderGeometry(back.rollR, back.rollR, cd - 0.01, 28);
      roll.rotateX(Math.PI / 2);
      roll.translate(rollX, back.top, zMid);
      metricUv(roll);
      b.add(plainColor(roll), pal.vinylRed);
      const seamZ = (x: number, y: number) => piping([new THREE.Vector3(x, y, zInner + 0.008), new THREE.Vector3(x, y, zMid), new THREE.Vector3(x, y, zOuter - 0.008)], 0.0025, false);
      b.add(seamZ(X(back.frontX + lean * 0.94) - s * 0.004, back.top - 0.05), pal.vinylRed);
      // Horizontal seam where the seat cushion meets the back.
      b.add(seamZ(X(back.frontX) - s * 0.004, seat.top + 0.006), pal.vinylRed);
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
