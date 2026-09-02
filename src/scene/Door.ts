/**
 * Front door: a single dark-bronze aluminium-framed glass leaf hung on its own
 * hinged Group so System 7 can rotate `door.rotation.y` to swing it. The leaf
 * sits inside the jambs with a 4 mm reveal and closes against the exterior
 * stop built in Shell.ts. Static for now.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { DOOR, ROOM } from "./layout";

export function buildDoor(parent: THREE.Group, pal: Palette): THREE.Group {
  const hinge = new THREE.Group();
  hinge.name = "front-door";
  const zMid = ROOM.zFront + ROOM.wallThickness / 2;
  hinge.position.set(DOOR.hingeX + DOOR.jamb + DOOR.reveal, 0, zMid);

  const b = new MergedBuilder();
  const clearW = DOOR.width - 2 * DOOR.jamb;
  const clearH = DOOR.height - DOOR.jamb;
  const leafW = clearW - 2 * DOOR.reveal;
  const leafH = clearH - DOOR.reveal - 0.012; // 12 mm over the threshold saddle
  const y0 = 0.012;
  const t = 0.045; // leaf thickness
  const z0 = -t / 2, z1 = t / 2;
  const stile = 0.1, bottomRail = 0.26, topRail = 0.12;

  // Frame (dark bronze), 2 mm bevels; bottom rail is the same section as the stiles
  b.rbox(pal.alum, [0, y0, z0], [stile, leafH, z1], 0.002);
  b.rbox(pal.alum, [leafW - stile, y0, z0], [leafW, leafH, z1], 0.002);
  b.rbox(pal.alum, [stile - 0.002, y0, z0], [leafW - stile + 0.002, y0 + bottomRail, z1], 0.002);
  b.rbox(pal.alum, [stile - 0.002, leafH - topRail, z0], [leafW - stile + 0.002, leafH, z1], 0.002);
  // Glazing beads (15 mm) around the light, both faces
  const gx0 = stile, gx1 = leafW - stile, gy0 = y0 + bottomRail, gy1 = leafH - topRail;
  for (const [za, zb] of [
    [z0 - 0.012, z0],
    [z1, z1 + 0.012],
  ]) {
    b.box(pal.alum, [gx0 - 0.005, gy0 - 0.005, za], [gx1 + 0.005, gy0 + 0.015, zb]);
    b.box(pal.alum, [gx0 - 0.005, gy1 - 0.015, za], [gx1 + 0.005, gy1 + 0.005, zb]);
    b.box(pal.alum, [gx0 - 0.005, gy0 + 0.015, za], [gx0 + 0.015, gy1 - 0.015, zb]);
    b.box(pal.alum, [gx1 - 0.015, gy0 + 0.015, za], [gx1 + 0.005, gy1 - 0.015, zb]);
  }
  // Push bar (interior side, -z) at 1.02 m, on two brackets
  const barY = 1.02;
  const bar = new THREE.CylinderGeometry(0.014, 0.014, leafW - stile * 2 + 0.06, 24);
  bar.rotateZ(Math.PI / 2);
  bar.translate(leafW / 2, barY, z0 - 0.07);
  b.add(bar, pal.chrome);
  for (const x of [stile + 0.02, leafW - stile - 0.02]) {
    // Cast standoff: 45 × 60 mm rose on the stile, tapered post out to a saddle under the bar
    b.rbox(pal.chrome, [x - 0.0225, barY - 0.03, z0 - 0.01], [x + 0.0225, barY + 0.03, z0], 0.004);
    const post = new THREE.CylinderGeometry(0.012, 0.016, 0.052, 20);
    post.rotateX(Math.PI / 2);
    post.translate(x, barY, z0 - 0.036);
    b.add(post, pal.chrome);
    const saddle = new THREE.CylinderGeometry(0.019, 0.019, 0.03, 24);
    saddle.rotateZ(Math.PI / 2);
    saddle.translate(x, barY, z0 - 0.07);
    b.add(saddle, pal.chrome);
  }
  // Pull handle (exterior side, +z): vertical chrome bar
  const pull = new THREE.CylinderGeometry(0.014, 0.014, 0.45, 20);
  pull.translate(leafW - stile / 2, barY, z1 + 0.06);
  b.add(pull, pal.chrome);
  for (const y of [barY - 0.19, barY + 0.19]) {
    b.rbox(pal.chrome, [leafW - stile / 2 - 0.012, y - 0.012, z1], [leafW - stile / 2 + 0.012, y + 0.012, z1 + 0.06], 0.004);
  }
  // Surface closer on the top rail (interior side) with its arm reaching the head bracket
  const cy0 = leafH - topRail + 0.02, cy1 = leafH - 0.015;
  b.rbox(pal.darkMetal, [0.12, cy0, z0 - 0.06], [0.36, cy1, z0], 0.004);
  const armY = (cy0 + cy1) / 2;
  const arm1 = new THREE.BoxGeometry(0.03, 0.012, 0.16);
  arm1.rotateY(THREE.MathUtils.degToRad(35));
  arm1.translate(0.2, armY + 0.02, z0 - 0.12);
  b.add(arm1, pal.darkMetal);
  const arm2 = new THREE.BoxGeometry(0.03, 0.012, 0.14);
  arm2.rotateY(THREE.MathUtils.degToRad(-40));
  arm2.translate(0.25, armY + 0.034, z0 - 0.19);
  b.add(arm2, pal.darkMetal);
  // Offset pivots at top and bottom of the hinge stile
  for (const y of [y0 + 0.02, leafH - 0.02]) {
    const piv = new THREE.CylinderGeometry(0.012, 0.012, 0.05, 16);
    piv.translate(0.02, y, z0 - 0.012);
    b.add(piv, pal.darkMetal);
  }
  b.build(hinge, { name: "door" });

  // Glass panel
  const g = new THREE.PlaneGeometry(gx1 - gx0, gy1 - gy0);
  g.translate(leafW / 2, (gy0 + gy1) / 2, 0);
  const glass = new THREE.Mesh(g, pal.glassDoor);
  glass.renderOrder = 10;
  glass.name = "door-glass";
  hinge.add(glass);
  // Greasy handprints around push-bar height: the roughness map frosts the transmission
  // behind them; this 1 mm-proud haze decal (same print layout) adds the faint whitish
  // forward-scatter that makes a print visible against a bright lot.
  const smudgeGeo = g.clone();
  smudgeGeo.translate(0, 0, -0.001);
  const smudge = new THREE.Mesh(smudgeGeo, pal.glassSmudge);
  smudge.renderOrder = 11;
  smudge.name = "door-smudge";
  hinge.add(smudge);

  parent.add(hinge);
  return hinge;
}
