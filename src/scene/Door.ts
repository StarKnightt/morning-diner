/**
 * Front door: a single aluminium-framed glass leaf hung on its own hinged
 * Group so System 7 can rotate `door.rotation.y` to swing it. Static for now.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { DOOR, ROOM } from "./layout";

export function buildDoor(parent: THREE.Group, pal: Palette): THREE.Group {
  const hinge = new THREE.Group();
  hinge.name = "front-door";
  const zMid = ROOM.zFront + ROOM.wallThickness / 2;
  hinge.position.set(DOOR.hingeX + 0.015, 0, zMid);

  const b = new MergedBuilder();
  const leafW = DOOR.width - 0.03; // clearance to jambs
  const leafH = DOOR.height - 0.02;
  const t = 0.045; // leaf thickness
  const z0 = -t / 2, z1 = t / 2;
  const stile = 0.1, bottomRail = 0.28, topRail = 0.12;

  // Frame (aluminium)
  b.box(pal.alum, [0, 0.012, z0], [stile, leafH, z1]);
  b.box(pal.alum, [leafW - stile, 0.012, z0], [leafW, leafH, z1]);
  b.box(pal.alum, [stile, 0.012, z0], [leafW - stile, bottomRail, z1]);
  b.box(pal.alum, [stile, leafH - topRail, z0], [leafW - stile, leafH, z1]);
  // Kick plate (dark brushed) on both faces of the bottom rail
  b.box(pal.darkMetal, [stile + 0.01, 0.02, z0 - 0.002], [leafW - stile - 0.01, bottomRail - 0.03, z0]);
  b.box(pal.darkMetal, [stile + 0.01, 0.02, z1], [leafW - stile - 0.01, bottomRail - 0.03, z1 + 0.002]);
  // Push bar (interior side, -z) at 1.0 m, on two brackets
  const barY = 1.0;
  const bar = new THREE.CylinderGeometry(0.016, 0.016, leafW - stile * 2 + 0.06, 18);
  bar.rotateZ(Math.PI / 2);
  bar.translate(leafW / 2, barY, z0 - 0.07);
  b.add(bar, pal.chrome);
  for (const x of [stile + 0.02, leafW - stile - 0.02]) {
    b.box(pal.chrome, [x - 0.015, barY - 0.015, z0 - 0.07], [x + 0.015, barY + 0.015, z0]);
  }
  // Pull handle (exterior side, +z): vertical chrome bar
  const pull = new THREE.CylinderGeometry(0.014, 0.014, 0.45, 18);
  pull.translate(leafW - stile / 2, barY, z1 + 0.06);
  b.add(pull, pal.chrome);
  for (const y of [barY - 0.19, barY + 0.19]) {
    b.box(pal.chrome, [leafW - stile / 2 - 0.012, y - 0.012, z1], [leafW - stile / 2 + 0.012, y + 0.012, z1 + 0.06]);
  }
  b.build(hinge, { name: "door" });

  // Glass panel
  const g = new THREE.PlaneGeometry(leafW - stile * 2, leafH - bottomRail - topRail);
  g.translate(leafW / 2, bottomRail + (leafH - bottomRail - topRail) / 2, 0);
  const glass = new THREE.Mesh(g, pal.glass);
  glass.renderOrder = 10;
  glass.name = "door-glass";
  hinge.add(glass);

  parent.add(hinge);
  return hinge;
}
