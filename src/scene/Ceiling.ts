/**
 * Drop ceiling: acoustic tile plane, T-bar grid, recessed 2×4 troffers, and
 * the ceiling fan (returned so the scene can spin it).
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { CEILING, FAN, ROOM } from "./layout";

export interface CeilingResult {
  fanRotor: THREE.Group;
  trofferCenters: Array<[number, number]>;
}

export function buildCeiling(parent: THREE.Group, pal: Palette): CeilingResult {
  const b = new MergedBuilder();
  const { halfX, zBack, zFront, height: H } = ROOM;
  const w = halfX * 2, d = zFront - zBack;
  const tile = CEILING.tile;

  /* ---- tile plane ---- */
  {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(Math.PI / 2); // faces down
    g.translate(0, H, (zFront + zBack) / 2);
    const map = pal.ceilingTile.map!;
    map.repeat.set(w / tile, d / tile);
    pal.ceilingTile.roughnessMap!.repeat.copy(map.repeat);
    const mesh = new THREE.Mesh(g, pal.ceilingTile);
    mesh.receiveShadow = true;
    mesh.name = "ceiling-tiles";
    parent.add(mesh);
  }

  /* ---- T-bar grid ---- */
  {
    const rw = CEILING.railWidth, rd = CEILING.railDrop;
    for (let k = 1; k * tile < w - 0.01; k++) {
      const x = -halfX + k * tile;
      b.box(pal.tbar, [x - rw / 2, H - rd, zBack], [x + rw / 2, H, zFront]);
    }
    for (let k = 1; k * tile < d - 0.01; k++) {
      const z = zBack + k * tile;
      b.box(pal.tbar, [-halfX, H - rd, z - rw / 2], [halfX, H, z + rw / 2]);
    }
    // Wall angle around the perimeter.
    b.box(pal.tbar, [-halfX, H - rd, zBack], [-halfX + rw, H, zFront]);
    b.box(pal.tbar, [halfX - rw, H - rd, zBack], [halfX, H, zFront]);
    b.box(pal.tbar, [-halfX, H - rd, zBack], [halfX, H, zBack + rw]);
    b.box(pal.tbar, [-halfX, H - rd, zFront - rw], [halfX, H, zFront]);
  }

  /* ---- troffers ---- */
  const trofferCenters: Array<[number, number]> = [];
  {
    const { w: tw, d: td } = CEILING.troffer;
    const fw = 0.045; // frame flange
    for (const [cx, cz] of CEILING.troffers) {
      trofferCenters.push([cx, cz]);
      const x0 = cx - tw / 2, x1 = cx + tw / 2, z0 = cz - td / 2, z1 = cz + td / 2;
      const y0 = H - 0.012, y1 = H + 0.001;
      // Frame (white steel flange, sits just below the tile plane)
      b.box(pal.fixtureWhite, [x0, y0, z0], [x0 + fw, y1, z1]);
      b.box(pal.fixtureWhite, [x1 - fw, y0, z0], [x1, y1, z1]);
      b.box(pal.fixtureWhite, [x0 + fw, y0, z0], [x1 - fw, y1, z0 + fw]);
      b.box(pal.fixtureWhite, [x0 + fw, y0, z1 - fw], [x1 - fw, y1, z1]);
      // Lens, recessed 8 mm
      const g = new THREE.PlaneGeometry(tw - fw * 2, td - fw * 2);
      g.rotateX(Math.PI / 2);
      g.translate(cx, H - 0.004, cz);
      b.add(g, pal.fixtureLens);
    }
  }

  b.build(parent, { name: "ceiling", castShadow: false });

  /* ---- ceiling fan ---- */
  const fan = new THREE.Group();
  fan.name = "ceiling-fan";
  fan.position.set(FAN.x, H, FAN.z);
  const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.05, 24), pal.darkMetal);
  canopy.position.y = -0.025;
  fan.add(canopy);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, FAN.downrod, 12), pal.darkMetal);
  rod.position.y = -0.05 - FAN.downrod / 2;
  fan.add(rod);
  const motorY = -0.05 - FAN.downrod - 0.08;
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.16, 32), pal.darkMetal);
  motor.position.y = motorY;
  fan.add(motor);
  const rotor = new THREE.Group();
  rotor.position.y = motorY - 0.06;
  fan.add(rotor);
  const bladeLen = FAN.bladeSpan / 2 - 0.1;
  const bladeGeo = new THREE.BoxGeometry(bladeLen, 0.007, 0.13);
  bladeGeo.translate(0.1 + bladeLen / 2, 0, 0);
  const ironGeo = new THREE.BoxGeometry(0.16, 0.012, 0.05);
  ironGeo.translate(0.12, 0.01, 0);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = (i / 4) * Math.PI * 2;
    const blade = new THREE.Mesh(bladeGeo, pal.fanBlade);
    blade.rotation.x = THREE.MathUtils.degToRad(12);
    blade.castShadow = true;
    arm.add(blade);
    const iron = new THREE.Mesh(ironGeo, pal.darkMetal);
    arm.add(iron);
    rotor.add(arm);
  }
  for (const m of [canopy, rod, motor]) m.castShadow = true;
  parent.add(fan);

  return { fanRotor: rotor, trofferCenters };
}
