/**
 * Drop ceiling: tegular acoustic tiles (instanced), a real T-bar layout (main
 * tees every 1.2 m, cross tees butting into them, none running through a
 * troffer), wall angle, six 2×4 troffers with door frames and recessed lenses,
 * and the ceiling fan (rotor returned so the scene can spin it).
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { CEILING, FAN, ROOM, cellX, cellZ } from "./layout";

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
    // Tees running along z at each x line (1.2 m cross tees, 15 mm face)
    for (let i = 1; i < nx; i++) {
      const x = cellX(i);
      for (let j = 0; j < nz; j++) {
        const a = own(i - 1, j), c = own(i, j);
        if (a !== undefined && a === c) continue; // inside a troffer
        b.box(pal.tbar, [x - crossFace / 2, teeY0, cellZ(j)], [x + crossFace / 2, H, cellZ1(j)]);
      }
    }
    // Tees running along x at each z line: main tees (24 mm) every 1.2 m, 0.6 m cross tees (15 mm) between
    for (let j = 1; j < nz; j++) {
      const z = cellZ(j);
      const face = j % 2 === 0 ? mainFace : crossFace;
      for (let i = 0; i < nx; i++) {
        const a = own(i, j - 1), c = own(i, j);
        if (a !== undefined && a === c) continue;
        b.box(pal.tbar, [cellX(i), teeY0, z - face / 2], [cellX1(i), H, z + face / 2]);
      }
    }
    // Wall angle around the perimeter (22 mm face)
    const wa = 0.022;
    b.box(pal.tbar, [-halfX, teeY0, zBack], [-halfX + wa, H, zFront]);
    b.box(pal.tbar, [halfX - wa, teeY0, zBack], [halfX, H, zFront]);
    b.box(pal.tbar, [-halfX, teeY0, zBack], [halfX, H, zBack + wa]);
    b.box(pal.tbar, [-halfX, teeY0, zFront - wa], [halfX, H, zFront]);
  }

  /* ---- troffers: whole cells, 20 mm door frame, recessed lens ---- */
  for (const [i, j] of CEILING.troffers) {
    const x0 = cellX(i) + crossFace / 2, x1 = cellX(i + 2) - crossFace / 2;
    const z0 = cellZ(j) + mainFace / 2, z1 = cellZ(j + 1) - mainFace / 2;
    const f = 0.02;
    const yF0 = teeY0, yF1 = teeY0 + 0.012;
    b.rbox(pal.fixtureWhite, [x0, yF0, z0], [x0 + f, yF1, z1], 0.002);
    b.rbox(pal.fixtureWhite, [x1 - f, yF0, z0], [x1, yF1, z1], 0.002);
    b.rbox(pal.fixtureWhite, [x0 + f, yF0, z0], [x1 - f, yF1, z0 + f], 0.002);
    b.rbox(pal.fixtureWhite, [x0 + f, yF0, z1 - f], [x1 - f, yF1, z1], 0.002);
    // Housing walls up to the backing plane
    const hw = 0.006;
    b.box(pal.fixtureWhite, [x0 + f - hw, yF1, z0 + f - hw], [x0 + f, H, z1 - f + hw]);
    b.box(pal.fixtureWhite, [x1 - f, yF1, z0 + f - hw], [x1 - f + hw, H, z1 - f + hw]);
    b.box(pal.fixtureWhite, [x0 + f, yF1, z0 + f - hw], [x1 - f, H, z0 + f]);
    b.box(pal.fixtureWhite, [x0 + f, yF1, z1 - f], [x1 - f, H, z1 - f + hw]);
    // Lens, recessed 20 mm behind the frame face
    const g = new THREE.PlaneGeometry(x1 - x0 - 2 * f, z1 - z0 - 2 * f);
    g.rotateX(Math.PI / 2);
    g.translate((x0 + x1) / 2, teeY0 + 0.02, (z0 + z1) / 2);
    b.add(g, pal.fixtureLens);
  }

  b.build(parent, { name: "ceiling", castShadow: false });

  /* ---- ceiling fan ---- */
  const fan = new THREE.Group();
  fan.name = "ceiling-fan";
  fan.position.set(FAN.x, teeY0 - tegularDrop, FAN.z);
  const canopyH = 0.04;
  const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, canopyH, 28), pal.darkMetal);
  canopy.position.y = -canopyH / 2;
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
  const ironR0 = FAN.housingR - 0.01, ironR1 = FAN.housingR + 0.13;
  const bladeR0 = FAN.housingR + 0.09, bladeR1 = FAN.bladeSpan / 2;
  const ironGeo = new THREE.BoxGeometry(ironR1 - ironR0, 0.008, 0.05);
  ironGeo.translate((ironR0 + ironR1) / 2, 0, 0);
  const bladeGeo = new THREE.BoxGeometry(bladeR1 - bladeR0, 0.007, 0.13);
  bladeGeo.translate((bladeR0 + bladeR1) / 2, -0.012, 0);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = (i / 4) * Math.PI * 2;
    arm.rotation.z = THREE.MathUtils.degToRad(-4); // slight droop
    const iron = new THREE.Mesh(ironGeo, pal.darkMetal);
    iron.castShadow = true;
    arm.add(iron);
    const blade = new THREE.Mesh(bladeGeo, pal.fanBlade);
    blade.rotation.x = THREE.MathUtils.degToRad(12);
    blade.castShadow = true;
    arm.add(blade);
    rotor.add(arm);
  }
  for (const m of [canopy, rod, housing, topCap, bottomCap]) m.castShadow = true;
  parent.add(fan);

  return { fanRotor: rotor };
}
