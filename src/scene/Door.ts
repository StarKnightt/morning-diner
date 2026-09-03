/**
 * Front door: a single dark-bronze aluminium-framed glass leaf hung on its own
 * hinged Group so System 7 can rotate `door.rotation.y` to swing it. The leaf
 * sits inside the jambs with a 4 mm reveal and closes against the exterior
 * stop built in Shell.ts. Static for now.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { DECAL, atlasQuad } from "../core/shapes";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DOOR, ROOM } from "./layout";
import { buildGlazing } from "./Glazing";

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
  b.add(bar, pal.chromeBar); // hand-worn grip zone toward the latch side (System 5)
  for (const x of [stile + 0.02, leafW - stile - 0.02]) {
    // Cast standoff: 45 × 60 mm rose on the stile, tapered post out to a saddle under the bar.
    // Satin stainless, not mirror chrome: a mirror this close to the dark-bronze stile
    // reflects nothing but bronze and reads as copper (System 3 rev 1 critic).
    // Rev 2 (System 5 critic): the posts and saddles are chrome like the bar; only the rose
    // against the bronze stile stays satin — the same brushed stainless as the kick plate, so
    // the door has one satin-steel bucket instead of two.
    b.rbox(pal.kickPlate, [x - 0.0225, barY - 0.03, z0 - 0.01], [x + 0.0225, barY + 0.03, z0], 0.004);
    const post = new THREE.CylinderGeometry(0.012, 0.016, 0.052, 20);
    post.rotateX(Math.PI / 2);
    post.translate(x, barY, z0 - 0.036);
    b.add(post, pal.chromeBar);
    const saddle = new THREE.CylinderGeometry(0.019, 0.019, 0.03, 24);
    saddle.rotateZ(Math.PI / 2);
    saddle.translate(x, barY, z0 - 0.07);
    b.add(saddle, pal.chromeBar);
  }
  // Pull handle (exterior side, +z): vertical chrome bar
  const pull = new THREE.CylinderGeometry(0.014, 0.014, 0.45, 20);
  pull.translate(leafW - stile / 2, barY, z1 + 0.06);
  b.add(pull, pal.chromeBar);
  for (const y of [barY - 0.19, barY + 0.19]) {
    b.rbox(pal.chromeBar, [leafW - stile / 2 - 0.012, y - 0.012, z1], [leafW - stile / 2 + 0.012, y + 0.012, z1 + 0.06], 0.004);
  }
  // Kick plate (System 5): 8" (203 mm) satin stainless on the push side, door width less 2",
  // screwed to the bottom rail — standard commercial hardware (ANSI/BHMA A156.6 protective plates).
  // Rev 3: the plate wears its own canvas (pal.kickPlateWorn: brushing, boot rubber, mop
  // film); twelve Ø 8 mm oval-head PHILLIPS screws on the standard template — one row along
  // the top and one along the bottom, 25 mm in, at ~150 mm centres (5 per row), plus one at
  // mid-height on each end; and the plate's bottom edge is bent out over 160 mm toward the
  // latch side where a heel caught it — a lip standing 2.5 mm off the door, the plate face
  // dished into it.
  const kx0 = stile + 0.023, kx1 = leafW - stile - 0.023, ky0 = y0 + 0.012, ky1 = ky0 + 0.203;
  b.rbox(pal.kickPlateWorn, [kx0, ky0, z0 - 0.0015], [kx1, ky1, z0], 0.0012, 2);
  {
    // Lifted lip: a strip of plate 14 mm tall along the bottom edge, hinged at its top,
    // rotated out 10°, over a 160 mm run ending 90 mm from the latch end; the dish above it
    // is a shallow wedge (2 mm proud at the strip, fading over 30 mm).
    const lx1 = kx1 - 0.09, lx0 = lx1 - 0.16, lipH = 0.014, lift = THREE.MathUtils.degToRad(10);
    // The sheet carries the plate's own canvas: its UVs are the plate-face UVs of the spot it
    // covers (the RoundedBox −z face runs u from the +x end, v up), so the brushing and the
    // rubber continue across the bend instead of a patch of clean metal.
    // (+z is the door's exterior; the plate face is at z0 − 0.0015 on the interior side, so
    // "out" is −z.) One bent sheet, not boxes: a 24 × 8 grid over 160 × 48 mm whose stand-off
    // from the plate face is a bell along the run (nothing at the ends — a dent has no step)
    // times a profile up the plate: 1 at the lip's bend line, the lip below it swinging out
    // a further 10°, fading to nothing 48 mm up.
    const dishH = 0.048, nx = 24, ny = 8;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const fx = i / nx, fy = j / ny;
        const x = lx0 + (lx1 - lx0) * fx, y = ky0 + dishH * fy;
        const bell = Math.sin(Math.PI * fx) ** 1.5;
        const yl = y - (ky0 + lipH); // height above the bend line
        const prof = yl >= 0 ? 1 - yl / (dishH - lipH) : 1 + (-yl / lipH) * (lipH * Math.tan(lift)) / 0.0025;
        const out = 0.0025 * bell * Math.max(0, prof);
        pos.push(x, y, z0 - 0.0015 - out);
        uv.push((kx1 - x) / (kx1 - kx0), (y - ky0) / (ky1 - ky0));
        // wound to face −z (the room)
        if (i < nx && j < ny) { const k = j * (nx + 1) + i; idx.push(k, k + nx + 1, k + 1, k + 1, k + nx + 1, k + nx + 2); }
      }
    const dent = new THREE.BufferGeometry();
    dent.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    dent.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    dent.setIndex(idx);
    dent.computeVertexNormals();
    b.add(dent.toNonIndexed(), pal.kickPlateWorn);
  }
  const screwAt = (sx: number, sy: number) => {
    const screw = new THREE.SphereGeometry(0.004, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    screw.scale(1, 0.45, 1);
    screw.rotateX(-Math.PI / 2);
    screw.translate(sx, sy, z0 - 0.0015);
    b.add(screw, pal.chromeBar);
    // Phillips recess: two dark hairlines crossing at the crown
    b.box(pal.darkMetal, [sx - 0.0022, sy - 0.0003, z0 - 0.0034], [sx + 0.0022, sy + 0.0003, z0 - 0.0015]);
    b.box(pal.darkMetal, [sx - 0.0003, sy - 0.0022, z0 - 0.0034], [sx + 0.0003, sy + 0.0022, z0 - 0.0015]);
  };
  const nCol = 5;
  for (let i = 0; i < nCol; i++) {
    const sx = kx0 + 0.025 + ((kx1 - kx0 - 0.05) * i) / (nCol - 1);
    screwAt(sx, ky0 + 0.025);
    screwAt(sx, ky1 - 0.025);
  }
  screwAt(kx0 + 0.025, (ky0 + ky1) / 2);
  screwAt(kx1 - 0.025, (ky0 + ky1) / 2);
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
  // Two-leaf glazing like the windows (System 4 rev 6, Glazing.ts).
  hinge.add(buildGlazing(g, { pane: pal.glassDoor, reflectIn: pal.glassDoorReflectIn, reflectOut: pal.glassDoorReflectOut }, "door-glass"));
  // Greasy handprints around push-bar height: the roughness map frosts the transmission
  // behind them; this 1 mm-proud haze decal (same print layout) adds the faint whitish
  // forward-scatter that makes a print visible against a bright lot.
  const smudgeGeo = g.clone();
  smudgeGeo.translate(0, 0, -0.001);
  const smudge = new THREE.Mesh(smudgeGeo, pal.glassSmudge);
  smudge.renderOrder = 11;
  smudge.name = "door-smudge";
  hinge.add(smudge);

  // Dressing (System 5 rev 2): one atlas material (materials.ts decal, FrontSide), quads
  // 1.5 mm inside the glass, every quad facing the room. Everything is applied to the
  // INSIDE face, as diners do to keep vinyl out of the weather. The rule for what the room
  // sees: vinyl meant for the street (hours, card-acceptance sticker) is applied reversed,
  // so from inside it reads mirrored (`mirrorU`); the PUSH sticker is for people leaving,
  // so it reads forwards. The OPEN sign is a two-sided flip card on suction hooks: at 8 AM
  // OPEN faces the lot, so the room sees its back — SORRY WE'RE CLOSED — reading forwards.
  // The OPEN face is a second quad facing the street (culled from inside).
  // (Inside is also the only place decals can be: three.js's transmission buffer holds
  // opaque objects only, so a transparent decal on the far side of transmissive glass
  // never shows.)
  //
  // Draw order against the glazing (fix-sign-car, after System 4 rev 6). Every quad sits
  // 1.5–2.5 mm on the ROOM side of the pane, and the pane's transmission leaf writes depth
  // (Glazing.ts: the haze march reads it). So the room-facing quads are in FRONT of the pane
  // for a viewer in the room and draw after it (renderOrder 12 — decal over glass, as before),
  // but the street-facing OPEN face is BEHIND the pane for a viewer on the lot: drawn after the
  // pane it fails the depth test everywhere the pane has written, and only survived at a
  // distance because the decal material's polygonOffset slope term (−1 × dz/dpixel) happens to
  // exceed 1.5 mm when a pixel spans a few mm of glass — which is why the sign "vanished" as
  // the camera closed in. The physically right order for something seen THROUGH glass is
  // decal first, pane over it, so the OPEN quad is its own mesh at renderOrder 9 (< the pane's
  // 10) and the pane's alpha/Fresnel and the lot reflection leaf composite over it exactly as
  // over the room behind it. Nothing else changes: same material, same quads, same offsets.
  const roomDecals: THREE.BufferGeometry[] = [];
  const streetDecals: THREE.BufferGeometry[] = [];
  const stick = (w: number, h: number, x: number, y: number, region: readonly [number, number, number, number], mirrored: boolean, z = -0.0015, faceStreet = false) => {
    const g = atlasQuad(w, h, region, mirrored);
    if (!faceStreet) g.rotateY(Math.PI); // face −z (the room)
    g.translate(x, y, z);
    (faceStreet ? streetDecals : roomDecals).push(g);
  };
  const glassMidX = leafW / 2;
  stick(0.3, 0.2, glassMidX + 0.05, gy1 - 0.16, DECAL.open, false, -0.0015, true);
  stick(0.3, 0.2, glassMidX + 0.05, gy1 - 0.16, DECAL.closed, false, -0.0025);
  stick(0.12, 0.05, glassMidX, barY + 0.095, DECAL.push, false);
  stick(0.2, 0.26, gx1 - 0.15, 1.45, DECAL.hours, true);
  stick(0.085, 0.055, gx1 - 0.09, 1.12, DECAL.cards, true);
  const decalMesh = new THREE.Mesh(mergeGeometries(roomDecals, false)!, pal.decal);
  decalMesh.renderOrder = 12; // in front of the pane from the room: over the glass
  decalMesh.name = "door-decals";
  hinge.add(decalMesh);
  const streetMesh = new THREE.Mesh(mergeGeometries(streetDecals, false)!, pal.decal);
  streetMesh.renderOrder = 9; // behind the pane from the lot: under the glass, seen through it
  streetMesh.name = "door-decals-street";
  hinge.add(streetMesh);

  parent.add(hinge);
  return hinge;
}
