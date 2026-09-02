/**
 * Drop ceiling: tegular acoustic tiles (instanced), a real T-bar layout (main
 * tees every 1.2 m, cross tees butting into them, none running through a
 * troffer), wall angle, six 2×4 troffers with door frames and recessed lenses,
 * and the ceiling fan (rotor returned so the scene can spin it).
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { metricUv } from "../core/upholstery";
import { BACK_BAR, CABINETS, CEILING, FAN, ROOM, WINDOW, cellX, cellZ } from "./layout";

export interface CeilingResult {
  fanRotor: THREE.Group;
}

export function buildCeiling(parent: THREE.Group, pal: Palette): CeilingResult {
  const b = new MergedBuilder();
  const { halfX, zBack, zFront, height: H } = ROOM;
  const w = halfX * 2, d = zFront - zBack;
  const { tile, teeDepth, mainFace, crossFace, tegularDrop } = CEILING;
  const nx = Math.ceil(w / tile - 1e-6), nz = Math.ceil(d / tile - 1e-6);
  const teeY0 = H - teeDepth;

  // Which troffer (index) owns a cell, if any.
  const owner = new Map<string, number>();
  CEILING.troffers.forEach(([i, j], t) => {
    owner.set(`${i},${j}`, t);
    owner.set(`${i + 1},${j}`, t);
  });
  const own = (i: number, j: number) => owner.get(`${i},${j}`);
  const cellX1 = (i: number) => Math.min(cellX(i + 1), halfX);
  const cellZ1 = (j: number) => Math.min(cellZ(j + 1), zFront);

  /* ---- backing plane (dark, seen only through reveals) ---- */
  {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(Math.PI / 2);
    g.translate(0, H, (zFront + zBack) / 2);
    const mesh = new THREE.Mesh(g, pal.tileBacking);
    mesh.name = "ceiling-backing";
    parent.add(mesh);
  }

  /* ---- tegular tiles, instanced ---- */
  {
    const cells: Array<[number, number]> = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (own(i, j) === undefined) cells.push([i, j]);
    const tileT = 0.015;
    const geo = new THREE.BoxGeometry(tile - 0.02, tileT, tile - 0.02);
    const im = new THREE.InstancedMesh(geo, pal.ceilingTile, cells.length);
    im.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    cells.forEach(([i, j], k) => {
      const x0 = cellX(i), x1 = cellX1(i), z0 = cellZ(j), z1 = cellZ1(j);
      p.set((x0 + x1) / 2, teeY0 - tegularDrop + tileT / 2, (z0 + z1) / 2);
      s.set((x1 - x0 - 0.02) / (tile - 0.02), 1, (z1 - z0 - 0.02) / (tile - 0.02));
      // Rotate whole tiles by quarter turns so the speckle does not repeat visibly.
      const full = x1 - x0 > tile - 1e-3 && z1 - z0 > tile - 1e-3;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), full ? ((i * 7 + j * 3) % 4) * (Math.PI / 2) : 0);
      m.compose(p, q, s);
      im.setMatrixAt(k, m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.name = "ceiling-tiles";
    parent.add(im);
  }

  /* ---- T-bar grid ---- */
  {
    // Cross-tee end clip: a slightly deeper, wider stub where a cross tee meets a main.
    const joint = (x0: number, z0: number, x1: number, z1: number) => b.box(pal.tbar, [x0, teeY0 - 0.002, z0], [x1, teeY0, z1]);
    // Tees running along z at each x line (1.2 m cross tees, 15 mm face), with a joint at each end
    for (let i = 1; i < nx; i++) {
      const x = cellX(i);
      for (let j = 0; j < nz; j++) {
        const a = own(i - 1, j), c = own(i, j);
        if (a !== undefined && a === c) continue; // inside a troffer
        const z0 = cellZ(j), z1 = cellZ1(j);
        b.box(pal.tbar, [x - crossFace / 2, teeY0, z0], [x + crossFace / 2, H, z1]);
        joint(x - crossFace / 2 - 0.001, z0, x + crossFace / 2 + 0.001, z0 + 0.012);
        joint(x - crossFace / 2 - 0.001, z1 - 0.012, x + crossFace / 2 + 0.001, z1);
      }
    }
    // Tees running along x at each z line: main tees (24 mm) every 1.2 m run through; 0.6 m cross tees (15 mm) between, with joints
    for (let j = 1; j < nz; j++) {
      const z = cellZ(j);
      const main = j % 2 === 0;
      const face = main ? mainFace : crossFace;
      for (let i = 0; i < nx; i++) {
        const a = own(i, j - 1), c = own(i, j);
        if (a !== undefined && a === c) continue;
        const x0 = cellX(i), x1 = cellX1(i);
        b.box(pal.tbar, [x0, teeY0, z - face / 2], [x1, H, z + face / 2]);
        if (!main) {
          joint(x0, z - face / 2 - 0.001, x0 + 0.012, z + face / 2 + 0.001);
          joint(x1 - 0.012, z - face / 2 - 0.001, x1, z + face / 2 + 0.001);
        }
      }
    }
    // Wall angle (25 mm face, 3 mm below the tee face so it reads) around the perimeter,
    // along the cabinet bulkhead and along the window head bulkhead.
    const wa = 0.025, wy = teeY0 - 0.003;
    const zw = zFront - WINDOW.headSoffit.depth;
    b.box(pal.tbar, [-halfX, wy, zBack], [-halfX + wa, H, zw]);
    b.box(pal.tbar, [halfX - wa, wy, zBack], [halfX, H, zw]);
    b.box(pal.tbar, [-halfX, wy, zBack], [halfX, H, zBack + wa]);
    b.box(pal.tbar, [-halfX, wy, zw - wa], [halfX, H, zw]);
    const zs = zBack + CABINETS.soffitDepth;
    b.box(pal.tbar, [BACK_BAR.xMin, wy, zs], [BACK_BAR.xMax, H, zs + wa]);
    b.box(pal.tbar, [BACK_BAR.xMin - wa, wy, zBack], [BACK_BAR.xMin, H, zs]);
    b.box(pal.tbar, [BACK_BAR.xMax, wy, zBack], [BACK_BAR.xMax + wa, H, zs]);
  }

  /* ---- troffers: whole cells, 20 mm door frame, recessed lens ---- */
  for (const [i, j] of CEILING.troffers) {
    // Door frame lip sits 8 mm inside the tees and 4 mm below their face, leaving a shadow gap.
    const gap = 0.013; // 13 mm reveal between tee and door frame
    const x0 = cellX(i) + crossFace / 2 + gap, x1 = cellX(i + 2) - crossFace / 2 - gap;
    const z0 = cellZ(j) + mainFace / 2 + gap, z1 = cellZ(j + 1) - mainFace / 2 - gap;
    const f = 0.025; // 1" white door frame
    const yF0 = teeY0 - 0.004, yF1 = teeY0 + 0.01;
    b.rbox(pal.fixtureWhite, [x0, yF0, z0], [x0 + f, yF1, z1], 0.002);
    b.rbox(pal.fixtureWhite, [x1 - f, yF0, z0], [x1, yF1, z1], 0.002);
    b.rbox(pal.fixtureWhite, [x0 + f, yF0, z0], [x1 - f, yF1, z0 + f], 0.002);
    b.rbox(pal.fixtureWhite, [x0 + f, yF0, z1 - f], [x1 - f, yF1, z1], 0.002);
    // Housing walls from the frame's outer edge up to the backing plane (the shadow gap sees these)
    const hw = 0.006;
    b.box(pal.fixtureWhite, [x0, yF1, z0], [x0 + hw, H, z1]);
    b.box(pal.fixtureWhite, [x1 - hw, yF1, z0], [x1, H, z1]);
    b.box(pal.fixtureWhite, [x0, yF1, z0], [x1, H, z0 + hw]);
    b.box(pal.fixtureWhite, [x0, yF1, z1 - hw], [x1, H, z1]);
    // Lens, recessed ½" (12.7 mm) behind the frame face
    const g = new THREE.PlaneGeometry(x1 - x0 - 2 * f, z1 - z0 - 2 * f);
    g.rotateX(Math.PI / 2);
    g.translate((x0 + x1) / 2, yF0 + 0.0127, (z0 + z1) / 2);
    b.add(g, pal.fixtureLens);
  }

  b.build(parent, { name: "ceiling", castShadow: false });

  /* ---- ceiling fan ---- */
  const fan = new THREE.Group();
  fan.name = "ceiling-fan";
  fan.position.set(FAN.x, teeY0 - tegularDrop, FAN.z);
  const canopyH = 0.04;
  // Escutcheon plate against the tile, then the canopy bell
  const escutcheon = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.006, 32), pal.darkMetal);
  escutcheon.position.y = -0.003;
  fan.add(escutcheon);
  const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, canopyH, 28), pal.darkMetal);
  canopy.position.y = -0.006 - canopyH / 2;
  fan.add(canopy);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, FAN.downrod, 16), pal.darkMetal);
  rod.position.y = -canopyH - FAN.downrod / 2;
  fan.add(rod);
  const housingH = 0.15;
  const housingY = -canopyH - FAN.downrod - housingH / 2;
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(FAN.housingR, FAN.housingR * 0.96, housingH, 40), pal.darkMetal);
  housing.position.y = housingY;
  fan.add(housing);
  const topCap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, FAN.housingR + 0.004, 0.02, 40), pal.darkMetal);
  topCap.position.y = housingY + housingH / 2 + 0.01;
  fan.add(topCap);
  const bottomCap = new THREE.Mesh(new THREE.CylinderGeometry(FAN.housingR * 0.7, 0.045, 0.035, 40), pal.darkMetal);
  bottomCap.position.y = housingY - housingH / 2 - 0.0175;
  fan.add(bottomCap);

  const rotor = new THREE.Group();
  rotor.position.y = housingY - housingH / 2 + 0.03;
  fan.add(rotor);
  // Blade irons: cast arms from the motor flange out under the blade root (visible from below),
  // 12 mm thick, 55 mm wide, with a wider foot at the blade end.
  const ironR0 = FAN.housingR - 0.01, ironR1 = FAN.housingR + 0.21;
  const bladeR0 = FAN.housingR + 0.08, bladeR1 = FAN.bladeSpan / 2;
  // Cast iron in plan: 50 mm at the flange, waisting to 30 mm, flaring into a rounded
  // 75 mm spade foot under the blade root; 10 mm thick with a 2 mm bevel, two screw bosses.
  const ironShape = new THREE.Shape();
  ironShape.moveTo(ironR0, -0.025);
  ironShape.lineTo(ironR0 + 0.03, -0.022);
  ironShape.quadraticCurveTo(ironR0 + 0.11, -0.014, ironR1 - 0.1, -0.02);
  ironShape.quadraticCurveTo(ironR1 - 0.06, -0.038, ironR1 - 0.025, -0.036);
  ironShape.absarc(ironR1 - 0.025, 0, 0.036, -Math.PI / 2, Math.PI / 2, false);
  ironShape.quadraticCurveTo(ironR1 - 0.06, 0.038, ironR1 - 0.1, 0.02);
  ironShape.quadraticCurveTo(ironR0 + 0.11, 0.014, ironR0 + 0.03, 0.022);
  ironShape.lineTo(ironR0, 0.025);
  ironShape.closePath();
  const ironBody = new THREE.ExtrudeGeometry(ironShape, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 10 });
  ironBody.rotateX(Math.PI / 2); // extrude along −y (under the blade)
  ironBody.translate(0, -0.006, 0);
  const bosses: THREE.BufferGeometry[] = [ironBody];
  for (const dx of [-0.03, 0.015]) {
    const boss = new THREE.CylinderGeometry(0.006, 0.006, 0.004, 12);
    boss.translate(ironR1 - 0.025 + dx, -0.018, 0);
    bosses.push(boss.toNonIndexed());
  }
  const ironGeo = mergeGeometries(bosses.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
  // Blades: constant 130 mm width, 14 mm thick, rounded edges, wood grain along the blade;
  // each blade gets its own veneer offset so the four don't share a figure.
  const bladeBase = new RoundedBoxGeometry(bladeR1 - bladeR0, 0.014, 0.13, 2, 0.006);
  bladeBase.translate((bladeR0 + bladeR1) / 2, 0, 0);
  for (let i = 0; i < 4; i++) {
    const bladeGeo = bladeBase.clone();
    metricUv(bladeGeo, { u: 0.37 * i + 0.11, v: 0.61 * i + 0.23, flip: i % 2 === 1 });
    const arm = new THREE.Group();
    arm.rotation.y = (i / 4) * Math.PI * 2;
    arm.rotation.z = THREE.MathUtils.degToRad(-4); // slight droop
    const iron = new THREE.Mesh(ironGeo, pal.darkMetal);
    iron.castShadow = true;
    arm.add(iron);
    const blade = new THREE.Mesh(bladeGeo, pal.fanBlade);
    blade.rotation.x = THREE.MathUtils.degToRad(12);
    iron.rotation.x = THREE.MathUtils.degToRad(12);
    blade.castShadow = true;
    arm.add(blade);
    rotor.add(arm);
  }
  for (const m of [canopy, rod, housing, topCap, bottomCap]) m.castShadow = true;
  parent.add(fan);

  return { fanRotor: rotor };
}
