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
import { CRAZED_BOOTH, boothBackDims, boothVinylCrazeLayout, channelPanel, channelSeed, cushionGeometry, cylinderArcUv, metricUv, piping, plainColor, rollSeam, roundedRectPoints, ROLL_SEAM_R } from "../core/upholstery";
import { BOOTH, ROOM, WINDOW } from "./layout";

export function buildBooths(parent: THREE.Group, pal: Palette): { colliders: MergedBuilder["colliders"] } {
  const b = new MergedBuilder();
  const { zInner, zOuter, table, seat, back, divider, cap, kick, endPanel } = BOOTH;
  const zEnd0 = zInner - endPanel;
  const capHalf = cap.width / 2;
  const crazeLayout = boothVinylCrazeLayout();
  // Cap crossbar (over the end panels) z-range: centred on the end panel, 70 mm wide.
  const czMid = (zEnd0 + zInner) / 2;
  const cz0 = czMid - capHalf, cz1 = czMid + capHalf;

  // Cap rail 60 × 40 mm solid wood with a 16 mm bullnose, one continuous run per divider.
  // Vertex colours darken/polish the wood 8 % within 0.2 m of the aisle-end grip points.
  const capSlab = (pts: XZ[], grips: XZ[]) => {
    const [slab] = slabGeometry(pts, { radius: 0.008, y0: cap.y0, thickness: cap.y1 - cap.y0, bevel: cap.bullnose, curveSegments: 3 });
    const p = slab.attributes.position, nrm = slab.attributes.normal;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      let d = 1e9;
      for (const [gx, gz] of grips) d = Math.min(d, Math.hypot(p.getX(i) - gx, p.getZ(i) - gz));
      let k = 1 - 0.08 * (1 - THREE.MathUtils.smoothstep(d, 0.05, 0.22));
      // Edge wear (System 5): the bullnose arrises — vertices whose normal is neither flat
      // nor upright — have had the stain rubbed back toward bare wood: up to 9 % lighter,
      // patchy along the run (hash of position) and heaviest at the aisle end where sleeves drag.
      const ny = Math.abs(nrm.getY(i));
      const arris = ny > 0.2 && ny < 0.94 ? 1 : 0;
      if (arris) {
        const h = Math.sin(p.getX(i) * 37.1 + p.getZ(i) * 53.7) * 0.5 + 0.5;
        // Rev 2: 9 % → 20 % and warmer (the stain goes, the yellow wood shows).
        k *= 1 + 0.2 * (0.45 + 0.55 * h) * (0.5 + 0.5 * (1 - THREE.MathUtils.smoothstep(d, 0.05, 0.5)));
      }
      col[i * 3] = k; col[i * 3 + 1] = k * (arris ? 0.99 : 1); col[i * 3 + 2] = k * (arris ? 0.955 : 1);
    }
    slab.setAttribute("color", new THREE.BufferAttribute(col, 3));
    b.add(slab, pal.capWood);
  };
  // 130 mm scuff band at the base of a laminate panel face.
  const scuffBand = (x0: number, x1: number, y0: number, z0: number, z1: number) => {
    b.box(pal.laminateScuffed, [x0, y0, z0], [x1, y0 + 0.13, z1]);
  };

  WINDOW.centersX.forEach((cx, ti) => {
    /* ---- table ---- */
    {
      const zT0 = zInner + table.inset;
      const pts = rectXZ(cx - table.width / 2, zT0, cx + table.width / 2, zOuter);
      const [slab, band, grooves] = slabGeometry(pts, {
        radius: table.cornerR,
        y0: table.top - table.thickness,
        thickness: table.thickness,
        bevel: 0.012,
        bandHeight: table.band,
        bandProud: 0.0015,
        grooves: 3,
      });
      // Extrude UVs are world metres: with the 1.8 m booth pitch and 1.2 m laminate canvas,
      // tables 1/3/5 sampled the same boomerangs. Offset each top so every table is a
      // different sheet (and a different set of scratches / cup rings).
      const tuv = slab.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) + ti * 0.37, tuv.getY(i) + ti * 0.53);
      b.add(slab, pal.formica);
      if (band) b.add(band, pal.formicaEdgeBrushed);
      if (grooves) b.add(grooves, pal.alumGroove);
      // Pedestal on the table centroid: cast bell base Ø 470 (40 mm rim rising to a Ø 150 boss),
      // chrome column, 360 mm spider plate under the top.
      const pz = (zT0 + zOuter) / 2;
      const { bellR, bellRim, bossR, bossH, columnR, spider } = BOOTH.pedestal;
      // Domed cast profile: a 16 mm vertical rim, a fast shoulder, a long dome to a Ø 160
      // neck, then an 18 mm collar ring the chrome column drops into (not a flat disc).
      const V = (x: number, y: number) => new THREE.Vector2(x, y);
      const collarTop = 0.16;
      const bell = new THREE.LatheGeometry(
        [
          V(0, 0), V(bellR, 0), V(bellR, 0.016), V(bellR - 0.004, 0.03), V(bellR - 0.02, 0.045), V(bellR - 0.05, 0.062),
          V(bellR - 0.09, 0.08), V(bellR - 0.13, 0.096), V(bossR + 0.02, 0.108), V(bossR + 0.006, 0.118), V(bossR, 0.126),
          V(bossR + 0.004, 0.13), V(bossR + 0.004, 0.148), V(bossR - 0.004, 0.152), V(columnR + 0.006, 0.156), V(columnR, collarTop), V(0, collarTop),
        ],
        56,
      );
      void bellRim; void bossH;
      bell.translate(cx, 0, pz);
      b.add(bell, pal.castBaseDusty); // rev 2: dust film + kick marks at floor contact
      const colH = table.top - table.thickness - 0.02 - collarTop;
      const col = new THREE.CylinderGeometry(columnR, columnR, colH, 28);
      col.translate(cx, collarTop + colH / 2, pz);
      b.add(col, pal.chrome);
      // Table underside: dark-sealed particleboard (never pale laminate) — a 1.5 mm skin
      // inside the T-mould, plus the 5 mm dark-steel spider plate screwed flush to it.
      const yU = table.top - table.thickness;
      b.rbox(pal.darkSeal, [cx - table.width / 2 + 0.012, yU - 0.0015, zT0 + 0.012], [cx + table.width / 2 - 0.012, yU + 0.0005, zOuter - 0.012], 0.001);
      // Spider plate, arms and hub share the bells' castBaseDusty bucket (v pinned to the clean
      // part of its map) so the tables add no darkMetal bucket — +0 draw calls for the dust.
      const clean = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setY(i, 0.9);
        return g;
      };
      const plate = new THREE.CylinderGeometry(0.15, 0.15, 0.005, 40);
      plate.translate(cx, yU - 0.004, pz);
      b.add(clean(plate), pal.castBaseDusty);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const arm = new THREE.BoxGeometry(spider / 2 - columnR, 0.024, 0.04);
        arm.translate((spider / 2 + columnR) / 2, 0, 0);
        arm.rotateY(a);
        arm.translate(cx, yU - 0.0185, pz);
        b.add(clean(arm), pal.castBaseDusty);
        // Pan-head screw through the plate at each arm
        const screw = new THREE.CylinderGeometry(0.006, 0.0065, 0.003, 12);
        screw.translate(cx + Math.cos(a) * 0.125, yU - 0.008, pz - Math.sin(a) * 0.125);
        b.add(screw, pal.chromeSoft);
      }
      const hub = new THREE.CylinderGeometry(columnR + 0.012, columnR + 0.012, 0.03, 28);
      hub.translate(cx, yU - 0.0215, pz);
      b.add(clean(hub), pal.castBaseDusty);
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
          wear: 0.35,
          sags: [{ z: -0.3, depth: 0.007 }, { z: 0.3, depth: 0.007 }],
          burnish: 0.22, // rev 4: 0.16 → 0.22, plus the material's gloss/flatten response (materials.ts mkVinyl)
        });
        cush.translate((lo(seat.front, seatBack) + hi(seat.front, seatBack)) / 2, seat.top - seat.thickness / 2, zMid);
        b.add(cush, pal.vinylRed);
        // 5 mm welt around the top edge (seat-front roll) and a boxing seam 25 mm below the crown
        const welt = piping(
          roundedRectPoints(lo(seat.front, seatBack) + 0.01, zInner + 0.01, hi(seat.front, seatBack) - 0.01, zOuter - 0.01, seat.top - 0.014, seat.edgeR),
          0.0025,
          true,
        );
        b.add(plainColor(welt, 1.2), pal.vinylRed);
        const boxing = piping(
          roundedRectPoints(lo(seat.front, seatBack) + 0.0015, zInner + 0.0015, hi(seat.front, seatBack) - 0.0015, zOuter - 0.0015, seat.top - 0.026, seat.edgeR - 0.008),
          0.002,
          true,
        );
        b.add(plainColor(boxing, 1.2), pal.vinylRed);
        // Top-stitch line 7 mm under the welt: a fine dark thread line along the nose
        const stitch = piping(
          roundedRectPoints(lo(seat.front, seatBack) + 0.003, zInner + 0.003, hi(seat.front, seatBack) - 0.003, zOuter - 0.003, seat.top - 0.021, seat.edgeR - 0.004),
          0.0008,
          true,
          60,
        );
        b.add(plainColor(stitch, 0.62), pal.vinylRed);
      }
      // Plinth (laminate) and kick (rubber, recessed 30 mm)
      b.rbox(pal.laminatePanel, [lo(seat.front + 0.01, divider.x0), kick, zInner], [hi(seat.front + 0.01, divider.x0), seat.top - seat.thickness, zOuter], 0.003, 2, { metric: true });
      b.box(pal.baseboard, [lo(seat.front + 0.04, divider.x0), 0, zInner], [hi(seat.front + 0.04, divider.x0), kick, zOuter]);
      // Plinth reveal line under the cushion
      b.box(pal.baseboard, [lo(seat.front + 0.0104, divider.x0), seat.top - seat.thickness - 0.008, zInner], [hi(seat.front + 0.0104, divider.x0), seat.top - seat.thickness - 0.002, zOuter]);
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
      // Sewn channel back on the reclined face: ~120 mm channels (±10 %) crowning 30 mm, a
      // 3.5 mm welt cord in every valley, puckers at the roll. Panel base sits 3 mm inside the wedge.
      {
        const faceLen = Math.hypot(lean, back.top - yb0);
        // Rev 4: the panel runs from 20 mm above the seat seam to 2 mm past the roll's piped
        // seam, so the channels and their cords dive under the piping instead of stopping
        // 50 mm short of it on a bare strip (boothBackDims projects `seamPt` onto the face).
        const panelH = boothBackDims().panelH;
        const { geometry: panel, valleys } = channelPanel(cd - 0.03, panelH, 0.12, 0.02, channelSeed(ti, s));
        const ex = new THREE.Vector3(0, 0, s), ey = new THREE.Vector3(0, 1, 0), ez = new THREE.Vector3(-s, 0, 0);
        const m = new THREE.Matrix4().makeBasis(ex, ey, ez);
        m.premultiply(new THREE.Matrix4().makeRotationZ(-s * recl));
        const dirX = (s * lean) / faceLen, dirY = (back.top - yb0) / faceLen;
        const t = 0.02 + panelH / 2;
        m.setPosition(X(back.frontX) + dirX * t + s * 0.003, yb0 + dirY * t, zMid);
        // Rev 3: the crazed booth's panels and cords sample the non-repeating crazing atlas on
        // UV channel 1 (materials.ts); the panel's own metric UVs (channel 0) keep the grain.
        const crazed = ti === CRAZED_BOOTH;
        const region = crazeLayout.panels[s < 0 ? 0 : 1];
        if (crazed) {
          const puv = panel.attributes.uv as THREE.BufferAttribute;
          const uv1 = new Float32Array(puv.count * 2);
          for (let i = 0; i < puv.count; i++) { uv1[i * 2] = puv.getX(i); uv1[i * 2 + 1] = region.v0 + puv.getY(i); }
          panel.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
        }
        b.add(panel, crazed ? pal.vinylRedCrazed : pal.vinylRed, m);
        // 6 mm welt cord sewn ON every seam: centre 1 mm above the crown tangent line
        // (crowns at 20 mm), so it carries its own highlight and throws a line shadow
        // both sides (baked into the panel's vertex colour). The top end stops 1 mm short of
        // the piped seam's axis — its end disc lies inside the piping's cylinder — so the cord
        // runs under the seam; the bottom end is buried in the seat cushion's back edge.
        valleys.forEach((vx, vi) => {
          const cord = new THREE.CylinderGeometry(0.003, 0.003, panelH - 0.006, 14);
          const cuv = cord.attributes.uv as THREE.BufferAttribute;
          const uv0 = new Float32Array(cuv.count * 2), uv1 = new Float32Array(cuv.count * 2);
          const track = crazeLayout.cords.v0 + (s < 0 ? vi : crazeLayout.panels[0].valleys.length + vi) * crazeLayout.cords.pitch;
          for (let i = 0; i < cuv.count; i++) {
            // grain: metric along (v) and round (u) the bead; atlas strip: this cord's track
            uv0[i * 2] = cuv.getY(i) * (panelH - 0.006); uv0[i * 2 + 1] = cuv.getX(i) * 0.019;
            uv1[i * 2] = cuv.getY(i) * (panelH - 0.006); uv1[i * 2 + 1] = track + cuv.getX(i) * crazeLayout.cords.pitch;
          }
          cord.setAttribute("uv", new THREE.BufferAttribute(uv0, 2));
          if (crazed) cord.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
          cord.translate(vx, 0, 0.021);
          b.add(plainColor(cord, 1.08), crazed ? pal.vinylRedCrazed : pal.vinylRed, m);
        });
      }
      // Rolled top cushion (90 mm Ø), tucked against the divider, with a welt where it meets the face.
      const rollX = X(back.rearX - back.rollR + 0.02);
      const roll = new THREE.CylinderGeometry(back.rollR, back.rollR, cd - 0.01, 28);
      roll.rotateX(Math.PI / 2);
      // Rev 3: metric UVs run round the roll from the sewn seam (bottom-front, where the channels
      // dive under it) with the only join at the back against the divider — `metricUv` mirrored
      // the grain at the crest and the flip read as a horizontal seam along the roll.
      const rs = rollSeam();
      const seamPt = [X(rs.x), rs.y];
      const seamAng = Math.atan2(seamPt[1] - back.top, seamPt[0] - rollX);
      roll.rotateZ(seamAng - Math.PI / 2);
      roll.translate(rollX, back.top, zMid);
      const arc = cylinderArcUv(roll, back.rollR, 0.25 / (2 * Math.PI * back.rollR));
      if (ti === CRAZED_BOOTH) {
        const rp = roll.attributes.position;
        const uv1 = new Float32Array(rp.count * 2);
        for (let i = 0; i < rp.count; i++) { uv1[i * 2] = rp.getZ(i) - (zInner + 0.005); uv1[i * 2 + 1] = crazeLayout.roll.v0 + crazeLayout.roll.arcHalf + arc[i]; }
        roll.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
        b.add(plainColor(roll), pal.vinylRedCrazed);
      } else b.add(plainColor(roll), pal.vinylRed);
      const seamZ = (x: number, y: number, r: number) => piping([new THREE.Vector3(x, y, zInner + 0.008), new THREE.Vector3(x, y, zMid), new THREE.Vector3(x, y, zOuter - 0.008)], r, false);
      // 6 mm piped seam where the channels dive under the head roll, proud of the junction
      b.add(plainColor(seamZ(seamPt[0], seamPt[1], ROLL_SEAM_R), 1.15), pal.vinylRed);
      // Rev 4: its top-stitch row, 4.5 mm up the roll from the piping on the visible (front)
      // side — a 0.8 mm dark thread line, the same treatment as the seat nose's stitch.
      {
        const da = 0.0045 / back.rollR, front = Math.sign(seamPt[0] - rollX);
        const cand = [seamAng + da, seamAng - da].map((a) => [rollX + Math.cos(a) * (back.rollR + 0.0004), back.top + Math.sin(a) * (back.rollR + 0.0004)]);
        const st = (cand[0][0] - rollX) * front > (cand[1][0] - rollX) * front ? cand[0] : cand[1];
        b.add(plainColor(seamZ(st[0], st[1], 0.0008), 0.62), pal.vinylRed);
      }
      // Boxing seam welt where the seat cushion meets the back.
      b.add(plainColor(seamZ(X(back.frontX) - s * 0.008, seat.top + 0.004, 0.003), 1.2), pal.vinylRed);
      // Aisle-end panel: from the seat front to the divider, under the cap.
      b.rbox(pal.laminatePanel, [lo(seat.front - 0.02, divider.x0), kick, zEnd0], [hi(seat.front - 0.02, divider.x0), cap.y0, zInner], 0.003, 2, { metric: true });
      b.box(pal.baseboard, [lo(seat.front + 0.01, divider.x0 - 0.005), 0, zEnd0 + 0.012], [hi(seat.front + 0.01, divider.x0 - 0.005), kick, zInner]);
      scuffBand(lo(seat.front - 0.02, divider.x0) + 0.004, hi(seat.front - 0.02, divider.x0) - 0.004, kick + 0.002, zEnd0 - 0.0006, zEnd0);
      // 2 mm PVC edge band on the panel's outer vertical edge (seat-front side)
      b.box(pal.edgeBand, [X(seat.front - 0.02) - 0.0011, kick, zEnd0 - 0.0003], [X(seat.front - 0.02) + 0.0011, cap.y0, zInner]);
      b.collider([lo(seat.front - 0.05, divider.x0), 0, cz0], [hi(seat.front - 0.05, divider.x0), cap.y1, zOuter]);
    }
  });

  /* ---- dividers between back-to-back benches, with one T-shaped cap each ---- */
  const dividerBody = (x0: number, x1: number) => {
    b.rbox(pal.laminatePanel, [x0, kick, zEnd0], [x1, cap.y0, zOuter], 0.003, 2, { metric: true });
    b.box(pal.baseboard, [x0 + 0.005, 0, zEnd0 + 0.012], [x1 - 0.005, kick, zOuter]);
    scuffBand(x0 + 0.002, x1 - 0.002, kick + 0.002, zEnd0 - 0.0006, zEnd0);
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
    ], [[xa, czMid], [xb, czMid]]);
  }
  // Left end: 40 mm partition with an L cap; a lower wall-return filler closes the gap to the wall.
  {
    const cx = WINDOW.centersX[0];
    const xd = cx - divider.x0 - 0.02;
    dividerBody(xd - 0.02, xd + 0.02);
    const xb = cx - seat.front + 0.02 + 0.015;
    capSlab([[xd - capHalf, cz0], [xb, cz0], [xb, cz1], [xd + capHalf, cz1], [xd + capHalf, zOuter], [xd - capHalf, zOuter]], [[xb, czMid]]);
    b.rbox(pal.laminatePanel, [-ROOM.halfX + 0.012, kick, zEnd0], [xd - 0.02, cap.y0 - 0.03, zOuter], 0.003, 2, { metric: true });
    b.box(pal.baseboard, [-ROOM.halfX + 0.012, 0, zEnd0 + 0.012], [xd - 0.02, kick, zOuter]);
    b.collider([-ROOM.halfX, 0, cz0], [xd, cap.y1, zOuter]);
  }
  // Right end: partition toward the door with an L cap (the vestibule side).
  {
    const cx = WINDOW.centersX[n - 1];
    const xd = cx + divider.x0 + 0.02;
    dividerBody(xd - 0.02, xd + 0.02);
    const xa = cx + seat.front - 0.02 - 0.015;
    capSlab([[xa, cz0], [xd + capHalf, cz0], [xd + capHalf, zOuter], [xd - capHalf, zOuter], [xd - capHalf, cz1], [xa, cz1]], [[xa, czMid]]);
  }

  b.build(parent, { name: "booths" });
  return { colliders: b.colliders };
}
