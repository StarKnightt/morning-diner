/**
 * Counter run: L-shaped grey-speckle formica top (bullnose + chrome band) on a
 * 400 mm die with a 300 mm knee overhang, cove base and toe recess, 36 mm
 * chrome footrail on cast brackets, ten bolted chrome stools with domed red
 * vinyl cushions (built per stool into the merged buckets so every seat differs),
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

export function buildCounter(parent: THREE.Group, pal: Palette): { colliders: MergedBuilder["colliders"]; stoolSeats: THREE.Group[] } {
  const b = new MergedBuilder();
  /**
   * One Group per stool holding its seat top (swivel plate, cushion, welt, seam, chrome band),
   * pivoted on the column axis at the floor, so the seat can swivel under a seated player
   * (interactions/Sit.ts). `userData.seatHeight` is that stool's cushion top (±6 mm).
   */
  const stoolSeats: THREE.Group[] = [];

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
    const [slab, band, grooves] = slabGeometry(pts, {
      radius: [0.002, 0.04, 0.04, 0.03, 0.02, 0.002],
      y0: height - tt,
      thickness: tt,
      bevel: 0.012,
      bandHeight: 0.05, // 2" fluted aluminium T-mould, as on the tables
      bandProud: 0.002,
      grooves: 4,
      curveSegments: 8,
    });
    b.add(slab, pal.formicaCounterWorn);
    if (band) b.add(band, pal.formicaEdgeBrushed);
    if (grooves) b.add(grooves, pal.alumGroove);
    // Laminate sheet seams every 3.6 m across the top, perpendicular to the front edge. Rev 3:
    // a butt joint's hairline gap fills with dark grime — a 2 mm matte near-black line, flush
    // (polygon-offset overlay, no proud edge to catch light). Rev 2's 0.8 mm satin-aluminium
    // strip 0.3 mm proud was sub-pixel at the counter pose and its highlight aliased into a
    // dashed line. 2 mm is ≥ 1.3 px at the counter pose, so the line stays continuous.
    for (let sx = xMin + 3.6; sx < xMax; sx += 3.6) b.box(pal.plinthLine, [sx - 0.001, height - 0.001, dieBack + 0.02], [sx + 0.001, height + 0.00005, topFrontZ - 0.03]);
    // 100 mm stainless backsplash lip along the service edge of the top (System 4 rev 4:
    // satin `stainlessLip`, a palette member so it takes the metals' sun-on probe).
    b.rbox(pal.stainlessLip, [xMin, height - 0.004, dieBack - 0.006], [xMax + 0.006, height + 0.1, dieBack + 0.014], 0.003);

    // Die (woodgrain laminate, metric UVs) with a 100 mm recessed toe kick faced in cove base, main run and L-return.
    const kickH = COUNTER.kickHeight, kickIn = COUNTER.kickRecess;
    b.box(pal.laminatePanel, [xMin, kickH, dieBack], [xMax, height - tt, dieFront], { metric: true });
    b.rbox(pal.baseboard, [xMin, 0, dieBack], [xMax, kickH, dieFront - kickIn], 0.004);
    b.box(pal.laminatePanel, [xMax, kickH, lReturnZEnd], [lDieX1, height - tt, dieBack], { metric: true });
    b.rbox(pal.baseboard, [xMax, 0, lReturnZEnd + kickIn], [lDieX1 - kickIn, kickH, dieBack], 0.004);
    // 130 mm scuff band and a plinth line at the base of the die faces
    b.box(pal.laminateScuffed, [xMin + 0.002, kickH + 0.002, dieFront], [xMax, kickH + 0.132, dieFront + 0.0006]);
    b.box(pal.laminateScuffed, [lDieX1, kickH + 0.002, lReturnZEnd + 0.002], [lDieX1 + 0.0006, kickH + 0.132, dieBack]);
    b.box(pal.plinthLine, [xMin + 0.002, kickH + 0.132, dieFront], [xMax, kickH + 0.138, dieFront + 0.0015]);
    b.box(pal.plinthLine, [lDieX1, kickH + 0.132, lReturnZEnd + 0.002], [lDieX1 + 0.0015, kickH + 0.138, dieBack]);
    // Work-side shelf under the main counter (open, laminate), on the SERVICE side of the die,
    // let 10 mm into it, and 20 mm short of both die ends. Rev 6 had it buried inside the die
    // with its end faces exactly coplanar with the die's end faces — the maple sawtoothed
    // through the walnut at the L-return corner (rev 7 flicker audit).
    b.box(pal.laminateCabinet, [xMin + 0.02, 0.5, dieBack - 0.3], [xMax - 0.02, 0.52, dieBack + 0.01], { metric: true });

    // Footrail: 36 mm chrome tube 130 mm off the die face at 230 mm AFF, brackets every 1.2 m.
    const tubeZ = dieFront + footrest.gap + footrest.tubeR;
    const tubeX = lDieX1 + footrest.gap + footrest.tubeR; // corner of the L
    // Cylinder UVs run v 0→1 over the whole length: scale to 0.5 m per repeat so the
    // scuff map (System 5, chromeScuffed) is at true scale along the 8 m of rail.
    const scaleV = (g: THREE.BufferGeometry, len: number) => {
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (len / 0.5));
      return g;
    };
    const rail = scaleV(new THREE.CylinderGeometry(footrest.tubeR, footrest.tubeR, tubeX - (xMin + 0.05), 20), tubeX - (xMin + 0.05));
    rail.rotateZ(Math.PI / 2);
    rail.translate((xMin + 0.05 + tubeX) / 2, footrest.y, tubeZ);
    b.add(rail, pal.chromeScuffed);
    // Near end: elbow and a return into the die face rather than a bare cut
    const endElbow = new THREE.SphereGeometry(footrest.tubeR, 16, 12);
    endElbow.translate(xMin + 0.05, footrest.y, tubeZ);
    b.add(endElbow, pal.chrome);
    const ret = new THREE.CylinderGeometry(footrest.tubeR, footrest.tubeR, tubeZ - dieFront, 20);
    ret.rotateX(Math.PI / 2);
    ret.translate(xMin + 0.05, footrest.y, (dieFront + tubeZ) / 2);
    b.add(ret, pal.chrome);
    const retFlange = new THREE.CylinderGeometry(footrest.tubeR + 0.012, footrest.tubeR + 0.012, 0.006, 20);
    retFlange.rotateX(Math.PI / 2);
    retFlange.translate(xMin + 0.05, footrest.y, dieFront + 0.003);
    b.add(retFlange, pal.chrome);
    for (let x = xMin + 0.3; x < xMax; x += footrest.bracketPitch) {
      // Cast bracket: 70 × 110 mm base plate on the die, tapered arm out to a saddle under the tube
      b.rbox(pal.chrome, [x - 0.035, footrest.y - 0.055, dieFront - 0.002], [x + 0.035, footrest.y + 0.055, dieFront + 0.01], 0.004);
      b.rbox(pal.chrome, [x - 0.014, footrest.y - 0.03, dieFront], [x + 0.014, footrest.y - 0.006, tubeZ + 0.012], 0.004);
      b.rbox(pal.chrome, [x - 0.02, footrest.y - 0.032, tubeZ - 0.014], [x + 0.02, footrest.y + 0.004, tubeZ + 0.014], 0.005);
    }
    // L-return footrest along z
    const rail2 = scaleV(new THREE.CylinderGeometry(footrest.tubeR, footrest.tubeR, tubeZ - lReturnZEnd - 0.05, 20), tubeZ - lReturnZEnd - 0.05);
    rail2.rotateX(Math.PI / 2);
    rail2.translate(tubeX, footrest.y, (lReturnZEnd + 0.05 + tubeZ) / 2);
    b.add(rail2, pal.chromeScuffed);
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
    const r = STOOL.seatDiameter / 2;
    const { seatHeight, seatThickness: st, columnR, baseR, footringY, footringR } = STOOL;

    // Flared base: lathe profile from a 420 mm dome down to the column.
    // Bell base: a steep outer flank (it mirrors the floor around it) easing into the column.
    const baseProfile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(baseR, 0),
      new THREE.Vector2(baseR + 0.002, 0.018), // vertical/slightly concave rim band: mirrors the floor around the stool
      new THREE.Vector2(baseR + 0.001, 0.034),
      new THREE.Vector2(baseR - 0.006, 0.046),
      new THREE.Vector2(baseR - 0.024, 0.058),
      new THREE.Vector2(baseR - 0.05, 0.07),
      new THREE.Vector2(baseR - 0.088, 0.084),
      new THREE.Vector2(columnR + 0.025, 0.096),
      new THREE.Vector2(columnR + 0.008, 0.106),
      new THREE.Vector2(columnR, 0.11),
      new THREE.Vector2(0, 0.11),
    ];
    const base = new THREE.LatheGeometry(baseProfile, 56);
    // Footring: torus Ø 0.42 at 290 mm AFF, 20 mm tube, fixed to a collar by four spokes.
    const footring = new THREE.TorusGeometry(footringR, STOOL.footringTube, 14, 56);
    {
      // Torus u runs once around the 1.3 m ring: ×3 puts the scuff canvas at ~0.45 m per repeat.
      const uv = footring.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 3);
    }
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
    // Seat cushion (3.5"): vinyl rim band below a 1" chrome band (2 mm shadow gap under it), then
    // the upholstered top with a 6 mm welt cord around the perimeter and a 25 mm domed crown.
    const bandY0 = 0.03, bandY1 = 0.0554, crown = st - (bandY1 + 0.022); // 90 − 77.4 → 12.6 mm crown over the roll; total dome from the band 22.6 mm
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
      // 10 mm soft roll above the welt, then the crown: 18 mm dome with a shoulder (x^1.8)
      ...[0.15, 0.35, 0.6, 0.85, 1.0].map((k) => {
        const a = (k * Math.PI) / 2;
        return new THREE.Vector2(r - 0.004 - 0.01 * (1 - Math.cos(a)), bandY1 + 0.012 + 0.01 * Math.sin(a));
      }),
      ...[0.9, 0.78, 0.64, 0.48, 0.3, 0.12, 0].map((f) => new THREE.Vector2((r - 0.014) * f, st - crown + crown * (1 - f ** 1.8))),
    ];
    const cushion = plainColor(new THREE.LatheGeometry(seatProfile, 56));
    cushion.translate(0, seatHeight - st, 0);
    // 1" chrome band around the rim, 2 mm shadow gap below it
    const seatBand = new THREE.CylinderGeometry(r + 0.0025, r + 0.0025, bandY1 - bandY0, 56, 1, true);
    seatBand.translate(0, seatHeight - st + (bandY0 + bandY1) / 2, 0);
    // 6 mm welt cord sewn around the seat perimeter right above the chrome band
    const seatWelt = plainColor(new THREE.TorusGeometry(r - 0.0015, 0.003, 10, 64), 1.1);
    seatWelt.rotateX(Math.PI / 2);
    seatWelt.translate(0, seatHeight - st + bandY1 + 0.0055, 0);
    // Vertical boxing seam on the vinyl rim (one per seat) so each stool's swivel reads
    const rimSeam = plainColor(new THREE.CylinderGeometry(0.0018, 0.0018, bandY0 - 0.008, 8), 1.1);
    rimSeam.translate(r - 0.0005, seatHeight - st + 0.004 + (bandY0 - 0.008) / 2, 0);

    // Bolt caps: four chrome acorn caps on the base shoulder (the floor bolts).
    const boltCap = new THREE.SphereGeometry(0.0065, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    boltCap.scale(1, 0.75, 1);
    // Welt junction: where the cord's two ends overlap, a 22 mm doubled-up bump.
    const junction = plainColor(new THREE.TorusGeometry(r - 0.0015, 0.0042, 10, 12, 0.11), 1.06);
    junction.rotateX(Math.PI / 2);
    junction.rotateY(-0.02);
    junction.translate(0, seatHeight - st + bandY1 + 0.0065, 0);

    const chromes = [pal.chrome, pal.chromeWorn, pal.chromeWorn2];
    const baseParts: Array<[THREE.BufferGeometry, THREE.Material | null]> = [
      [base, null], [footring, pal.chromeScuffed], [collar, null], [spokes[0], null], [spokes[1], null], [spokes[2], null], [spokes[3], null],
    ];
    const seatParts: Array<[THREE.BufferGeometry, THREE.Material | null]> = [
      [swivel, pal.darkMetal], [cushion, pal.vinylRed], [rimSeam, pal.vinylRed], [seatWelt, pal.vinylRed], [junction, pal.vinylRed], [seatBand, null],
    ];
    // Every stool is built as its own geometry (merged into the room buckets — cheaper than
    // 13 instanced draws) so each one can differ visibly: seat height ±6 mm via the column,
    // any swivel yaw (the welt junction + boxing seam travel with it), ±5 % cushion squash,
    // a 250 × 200 mm sit-dent 6–9 mm deep offset toward the seam, one seat tilted 2.5° on a worn
    // swivel and the rest ±0.8°, three chrome wear grades, and two stools nudged off pitch.
    const rng = makeRng(808);
    const nudge = new Map<number, number>([[2, 0.03], [6, -0.022]]);
    const worn = 3;
    STOOL.centersX.forEach((x, i) => {
      const yaw = rng() * Math.PI * 2;
      const dx = (rng() - 0.5) * 0.02 + (nudge.get(i) ?? 0);
      const dz = (rng() - 0.5) * 0.05;
      const dh = (rng() - 0.5) * 0.012; // seat height ±6 mm
      const chrome = chromes[(i * 2 + Math.floor(rng() * 3)) % 3];
      const baseM = new THREE.Matrix4().makeRotationY(yaw);
      baseM.setPosition(x + dx, 0, STOOL.z + dz);
      for (const [g, mat] of baseParts) b.add(g.clone(), mat ?? chrome, baseM);
      for (let k = 0; k < 4; k++) {
        const cap = boltCap.clone();
        cap.translate(baseR - 0.03, 0.057, 0);
        cap.rotateY((k / 4) * Math.PI * 2 + 0.4);
        b.add(cap, chrome, baseM);
      }
      const colLen = seatHeight - st - 0.11 - 0.02 + dh;
      const col = new THREE.CylinderGeometry(columnR, columnR, colLen, 28);
      col.translate(0, 0.11 + colLen / 2, 0);
      b.add(col, chrome, baseM);

      const tiltMag = i === worn ? 2.5 : 1.6 * (rng() - 0.5);
      const tilt = THREE.MathUtils.degToRad(tiltMag), tiltZ = THREE.MathUtils.degToRad(i === worn ? 0.6 : 1.6 * (rng() - 0.5));
      const squash = 1 + (rng() - 0.5) * 0.1;
      const yb = seatHeight - st - 0.02; // pivot on the column top
      const seatM = new THREE.Matrix4()
        .compose(
          new THREE.Vector3(x + dx, yb + dh, STOOL.z + dz),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw + (rng() - 0.5) * 0.9, tiltZ)),
          new THREE.Vector3(1 + (rng() - 0.5) * 0.03, squash, 1 + (rng() - 0.5) * 0.03),
        )
        .multiply(new THREE.Matrix4().makeTranslation(0, -yb, 0));
      // The seat top goes into its own builder → a Group pivoted on the column axis (world
      // geometry shifted back by the stool centre), so Sit.ts can swivel it. Materials are the
      // room's, so the probes and shadow masks treat it exactly like the merged buckets.
      const seatGroup = new THREE.Group();
      seatGroup.name = `stool-seat:${i}`;
      seatGroup.position.set(x + dx, 0, STOOL.z + dz);
      seatGroup.userData.seatHeight = seatHeight + dh;
      const seatM_local = new THREE.Matrix4().makeTranslation(-(x + dx), 0, -(STOOL.z + dz)).multiply(seatM);
      const sb = new MergedBuilder();
      for (const [g, mat] of seatParts) {
        const geo = g.clone();
        if (g === cushion) {
          // Sit-dent: an elliptical hollow 4 mm deep, centred 20 mm toward the seam (+x local).
          const pos = geo.attributes.position as THREE.BufferAttribute;
          const col = geo.attributes.color as THREE.BufferAttribute;
          const cy = seatHeight - st, dentDepth = 0.006 + rng() * 0.003, ox = 0.025 + rng() * 0.015;
          for (let v = 0; v < pos.count; v++) {
            const py = pos.getY(v) - cy;
            if (py < st - crown - 0.002) continue; // only the upholstered top
            const ex = (pos.getX(v) - ox) / 0.125, ez = pos.getZ(v) / 0.1;
            const d2 = ex * ex + ez * ez;
            if (d2 < 1) {
              const k = (1 - d2) ** 2;
              pos.setY(v, pos.getY(v) - dentDepth * k);
              // The hollow sits in its own soft shade (worn, compressed vinyl reads darker).
              col.setXYZ(v, col.getX(v) * (1 - 0.24 * k), col.getY(v) * (1 - 0.24 * k), col.getZ(v) * (1 - 0.24 * k));
            }
          }
          geo.computeVertexNormals();
        }
        sb.add(geo, mat ?? chrome, seatM_local);
      }
      sb.build(seatGroup, { name: `stool-seat:${i}` });
      parent.add(seatGroup);
      stoolSeats.push(seatGroup);
    });
    for (const x of STOOL.centersX) {
      b.collider([x - r, 0, STOOL.z - r], [x + r, seatHeight, STOOL.z + r]);
    }
  }

  /* ---------------- back bar ---------------- */
  {
    const { zFront, depth, height, xMin, xMax, coffeeX } = BACK_BAR;
    const zBack = zFront - depth;
    const kickH = 0.1, topT = 0.03;
    const openings = [BACK_BAR.cooler, BACK_BAR.drawers, BACK_BAR.cabinet]; // the cabinet bay's carcass + doors: Openables.ts (System 9)
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
    for (const [a0, a1] of [BACK_BAR.cooler, BACK_BAR.drawers]) {
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
  return { colliders: b.colliders, stoolSeats };
}
