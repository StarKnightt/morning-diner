/**
 * The building shell: floor, walls with window / door / pass-through / kitchen
 * door openings (reveals show the 250 mm wall), window frames with transom and
 * glass stops, sills with aprons, cove base, supply register, roof slab,
 * kitchen void, and the exterior ground the player starts on.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { DOOR, KITCHEN_DOOR, PASS_THROUGH, REGISTER, ROOM, WINDOW } from "./layout";

export interface Opening {
  a0: number; // along-wall start
  a1: number; // along-wall end
  y0: number;
  y1: number;
}

/**
 * Emits axis-aligned boxes filling a wall rectangle [a0,a1]×[y0,y1] minus the
 * openings. Columns are cut at every opening edge; each column has at most one
 * opening, so it becomes one box below and one above.
 */
export function punchedWall(
  a0: number,
  a1: number,
  y0: number,
  y1: number,
  openings: Opening[],
  emit: (a0: number, a1: number, y0: number, y1: number) => void,
): void {
  const edges = new Set<number>([a0, a1]);
  for (const o of openings) {
    if (o.a0 > a0 && o.a0 < a1) edges.add(o.a0);
    if (o.a1 > a0 && o.a1 < a1) edges.add(o.a1);
  }
  const xs = [...edges].sort((p, q) => p - q);
  for (let i = 0; i < xs.length - 1; i++) {
    const c0 = xs[i], c1 = xs[i + 1];
    const mid = (c0 + c1) / 2;
    const o = openings.find((op) => mid > op.a0 && mid < op.a1);
    if (!o) {
      emit(c0, c1, y0, y1);
      continue;
    }
    if (o.y0 > y0) emit(c0, c1, y0, o.y0);
    if (o.y1 < y1) emit(c0, c1, o.y1, y1);
  }
}

export function buildShell(parent: THREE.Group, pal: Palette): { colliders: MergedBuilder["colliders"] } {
  const b = new MergedBuilder();
  const { halfX, zBack, zFront, height: H, wallThickness: T, slabDrop } = ROOM;
  const yLow = -slabDrop;
  const uv = { uvScale: 2 };

  /* ---------------- floor ---------------- */
  {
    const w = halfX * 2, d = zFront - zBack;
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, (zFront + zBack) / 2);
    const floor = new THREE.Mesh(g, pal.floor);
    // 40 × 20 tiles on the canvas; tiles are 0.3 m.
    const map = pal.floor.map!;
    map.repeat.set(w / 0.3 / 40, d / 0.3 / 20);
    pal.floor.roughnessMap!.repeat.copy(map.repeat);
    floor.receiveShadow = true;
    floor.name = "floor";
    parent.add(floor);
  }

  /* ---------------- front (window) wall, +z ---------------- */
  const windowOpenings: Opening[] = WINDOW.centersX.map((cx) => ({
    a0: cx - WINDOW.width / 2,
    a1: cx + WINDOW.width / 2,
    y0: WINDOW.sill,
    y1: WINDOW.head,
  }));
  const doorOpening: Opening = { a0: DOOR.hingeX, a1: DOOR.hingeX + DOOR.width, y0: yLow, y1: DOOR.height };
  const frontOpenings = [...windowOpenings, doorOpening];
  const zMid = zFront + T / 2;
  punchedWall(-halfX, halfX, yLow, H, frontOpenings, (x0, x1, y0, y1) => {
    b.box(pal.wallPaint, [x0, y0, zFront], [x1, y1, zMid], uv);
    b.box(pal.wallPaintExt, [x0, y0, zMid], [x1, y1, zFront + T], uv);
  });
  // Solid collision for the whole wall except the door opening (the leaf is
  // walk-through until System 7 gives it a hinge).
  b.collider([-halfX, 0, zFront], [DOOR.hingeX, H, zFront + T]);
  b.collider([DOOR.hingeX + DOOR.width, 0, zFront], [halfX, H, zFront + T]);

  /* ---------------- back partition to the kitchen, -z ---------------- */
  const pass: Opening = {
    a0: PASS_THROUGH.centerX - PASS_THROUGH.width / 2,
    a1: PASS_THROUGH.centerX + PASS_THROUGH.width / 2,
    y0: PASS_THROUGH.sill,
    y1: PASS_THROUGH.sill + PASS_THROUGH.height,
  };
  const kdoor: Opening = {
    a0: KITCHEN_DOOR.centerX - KITCHEN_DOOR.width / 2,
    a1: KITCHEN_DOOR.centerX + KITCHEN_DOOR.width / 2,
    y0: yLow,
    y1: KITCHEN_DOOR.height,
  };
  punchedWall(-halfX, halfX, yLow, H, [pass, kdoor], (x0, x1, y0, y1) => {
    b.box(pal.wallPaint, [x0, y0, zBack - T], [x1, y1, zBack], uv);
  });
  b.collider([-halfX, 0, zBack - T], [halfX, H, zBack]);

  /* ---------------- end walls, ±x ---------------- */
  b.box(pal.wallPaint, [-halfX - T / 2, yLow, zBack - T], [-halfX, H, zFront + T], uv);
  b.box(pal.wallPaintExt, [-halfX - T, yLow, zBack - T], [-halfX - T / 2, H, zFront + T], uv);
  b.box(pal.wallPaint, [halfX, yLow, zBack - T], [halfX + T / 2, H, zFront + T], uv);
  b.box(pal.wallPaintExt, [halfX + T / 2, yLow, zBack - T], [halfX + T, H, zFront + T], uv);
  b.collider([-halfX - T, 0, zBack - T], [-halfX, H, zFront + T]);
  b.collider([halfX, 0, zBack - T], [halfX + T, H, zFront + T]);

  /* ---------------- supply register, high on the -x wall ---------------- */
  {
    const { z, w, h, top } = REGISTER;
    const z0 = z - w / 2, z1 = z + w / 2, y1 = top, y0 = top - h;
    const xf = -halfX; // wall face
    // Recess (dark) behind the louvres
    b.box(pal.kickPanel, [xf - 0.03, y0 + 0.02, z0 + 0.02], [xf + 0.001, y1 - 0.02, z1 - 0.02]);
    // Painted frame, 25 mm face
    const f = 0.025;
    b.rbox(pal.trimPaint, [xf, y0, z0], [xf + 0.012, y1, z0 + f], 0.002);
    b.rbox(pal.trimPaint, [xf, y0, z1 - f], [xf + 0.012, y1, z1], 0.002);
    b.rbox(pal.trimPaint, [xf, y0, z0 + f], [xf + 0.012, y0 + f, z1 - f], 0.002);
    b.rbox(pal.trimPaint, [xf, y1 - f, z0 + f], [xf + 0.012, y1, z1 - f], 0.002);
    // Louvres: angled slats every 25 mm
    for (let y = y0 + f + 0.012; y < y1 - f - 0.01; y += 0.025) {
      const g = new THREE.BoxGeometry(0.018, 0.004, z1 - z0 - 2 * f - 0.004);
      g.rotateZ(THREE.MathUtils.degToRad(-35));
      g.translate(xf + 0.004, y, z);
      b.add(g, pal.trimPaint);
    }
  }

  /* ---------------- window frames, transoms, stops, glass, sills ---------------- */
  const fw = 0.04; // frame face
  const fd = 0.06; // frame depth (z)
  const zF0 = zMid - fd / 2, zF1 = zMid + fd / 2;
  const stop = 0.015;
  const glassGeos: THREE.BufferGeometry[] = [];
  const pane = (x0: number, x1: number, y0: number, y1: number) => {
    const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, zMid);
    glassGeos.push(g);
    // Glass stops on both faces
    for (const [za, zb] of [
      [zF0 - stop, zF0],
      [zF1, zF1 + stop],
    ]) {
      b.box(pal.alum, [x0, y0, za], [x1, y0 + stop, zb]);
      b.box(pal.alum, [x0, y1 - stop, za], [x1, y1, zb]);
      b.box(pal.alum, [x0, y0 + stop, za], [x0 + stop, y1 - stop, zb]);
      b.box(pal.alum, [x1 - stop, y0 + stop, za], [x1, y1 - stop, zb]);
    }
  };
  for (const o of windowOpenings) {
    const { a0: x0, a1: x1, y0, y1 } = o;
    // Perimeter frame members
    b.box(pal.alum, [x0, y0, zF0], [x0 + fw, y1, zF1]);
    b.box(pal.alum, [x1 - fw, y0, zF0], [x1, y1, zF1]);
    b.box(pal.alum, [x0 + fw, y1 - fw, zF0], [x1 - fw, y1, zF1]);
    b.box(pal.alum, [x0 + fw, y0, zF0], [x1 - fw, y0 + fw, zF1]);
    // Transom bar
    const ty = WINDOW.transomY;
    b.box(pal.alum, [x0 + fw, ty - fw / 2, zF0], [x1 - fw, ty + fw / 2, zF1]);
    // Panes
    pane(x0 + fw, x1 - fw, y0 + fw, ty - fw / 2);
    pane(x0 + fw, x1 - fw, ty + fw / 2, y1 - fw);
    // Interior sill: 40 mm nosing, projects 100 mm, meets the frame; apron below.
    b.rbox(pal.trimPaint, [x0 - 0.06, y0 - 0.04, zFront - 0.1], [x1 + 0.06, y0, zF0], 0.008, 3);
    b.rbox(pal.trimPaint, [x0 - 0.05, y0 - 0.12, zFront - 0.016], [x1 + 0.05, y0 - 0.04, zFront], 0.003);
    // Casing around the reveal on the interior face (60 × 12 mm)
    const cw = 0.06, ct = 0.012;
    b.rbox(pal.trimPaint, [x0 - cw, y0 - 0.12, zFront - ct], [x0, y1 + cw, zFront], 0.002);
    b.rbox(pal.trimPaint, [x1, y0 - 0.12, zFront - ct], [x1 + cw, y1 + cw, zFront], 0.002);
    b.rbox(pal.trimPaint, [x0, y1, zFront - ct], [x1, y1 + cw, zFront], 0.002);
  }

  /* ---------------- door frame (leaf is built in Door.ts) ---------------- */
  {
    const x0 = doorOpening.a0, x1 = doorOpening.a1;
    const jw = DOOR.jamb, jd = 0.1;
    const z0 = zMid - jd / 2, z1 = zMid + jd / 2;
    // Jambs and head sit inside the rough opening, so the wall reveal shows around them.
    b.box(pal.alum, [x0, 0, z0], [x0 + jw, DOOR.height, z1]);
    b.box(pal.alum, [x1 - jw, 0, z0], [x1, DOOR.height, z1]);
    b.box(pal.alum, [x0 + jw, DOOR.height - jw, z0], [x1 - jw, DOOR.height, z1]);
    // Threshold plate across the full wall depth
    b.rbox(pal.alum, [x0, -0.002, zFront - 0.02], [x1, 0.012, zFront + T + 0.02], 0.003);
  }

  /* ---------------- kitchen swing door (closed, inside its opening) ---------------- */
  {
    const { a0: x0, a1: x1, y1: h } = kdoor;
    const cx = (x0 + x1) / 2;
    const zLeaf0 = zBack - T / 2 - 0.02, zLeaf1 = zBack - T / 2 + 0.02;
    // Leaf
    b.rbox(pal.laminateWood, [x0 + 0.005, 0.015, zLeaf0], [x1 - 0.005, h - 0.008, zLeaf1], 0.003);
    // Kick plate and push plate (dining side, +z)
    b.rbox(pal.stainless, [x0 + 0.03, 0.03, zLeaf1], [x1 - 0.03, 0.4, zLeaf1 + 0.003], 0.001);
    b.rbox(pal.stainless, [x0 + 0.03, 0.9, zLeaf1], [x1 - 0.03, 0.96, zLeaf1 + 0.02], 0.003);
    // Vision window into the dark kitchen
    const vw = 0.25, vh = 0.35, vy = 1.6;
    const port = new THREE.BoxGeometry(vw, vh, 0.05);
    port.translate(cx, vy, (zLeaf0 + zLeaf1) / 2);
    b.add(port, pal.voidBlack);
    const vf = 0.02;
    b.rbox(pal.stainless, [cx - vw / 2 - vf, vy - vh / 2 - vf, zLeaf0 - 0.002], [cx + vw / 2 + vf, vy - vh / 2, zLeaf1 + 0.006], 0.002);
    b.rbox(pal.stainless, [cx - vw / 2 - vf, vy + vh / 2, zLeaf0 - 0.002], [cx + vw / 2 + vf, vy + vh / 2 + vf, zLeaf1 + 0.006], 0.002);
    b.rbox(pal.stainless, [cx - vw / 2 - vf, vy - vh / 2, zLeaf0 - 0.002], [cx - vw / 2, vy + vh / 2, zLeaf1 + 0.006], 0.002);
    b.rbox(pal.stainless, [cx + vw / 2, vy - vh / 2, zLeaf0 - 0.002], [cx + vw / 2 + vf, vy + vh / 2, zLeaf1 + 0.006], 0.002);
    // Painted jamb casings (100 mm) and header on the dining face
    const j = KITCHEN_DOOR.jamb, ct = 0.015;
    b.rbox(pal.trimPaint, [x0 - j, 0, zBack], [x0, h + j, zBack + ct], 0.002);
    b.rbox(pal.trimPaint, [x1, 0, zBack], [x1 + j, h + j, zBack + ct], 0.002);
    b.rbox(pal.trimPaint, [x0, h, zBack], [x1, h + j, zBack + ct], 0.002);
  }

  /* ---------------- pass-through liner, shelf, header ---------------- */
  {
    const j = PASS_THROUGH.jamb;
    const z0 = zBack - T - 0.005, z1 = zBack + 0.005;
    b.rbox(pal.stainless, [pass.a0 - j, pass.y0, z0], [pass.a0, pass.y1 + j, z1], 0.002);
    b.rbox(pal.stainless, [pass.a1, pass.y0, z0], [pass.a1 + j, pass.y1 + j, z1], 0.002);
    b.rbox(pal.stainless, [pass.a0, pass.y1, z0], [pass.a1, pass.y1 + j, z1], 0.002);
    // 250 mm shelf, projecting into the dining side
    b.rbox(pal.stainless, [pass.a0 - j - 0.02, pass.y0 - 0.03, zBack - T + 0.03], [pass.a1 + j + 0.02, pass.y0, zBack - T + 0.03 + PASS_THROUGH.shelfDepth], 0.004, 3);
  }

  /* ---------------- cove base (100 × 12 mm) ---------------- */
  {
    const bh = 0.1, bt = 0.012;
    const base = (min: [number, number, number], max: [number, number, number]) => b.rbox(pal.baseboard, min, max, 0.004, 2);
    base([-halfX, 0, zFront - bt], [DOOR.hingeX, bh, zFront]);
    base([DOOR.hingeX + DOOR.width, 0, zFront - bt], [halfX, bh, zFront]);
    base([-halfX, 0, zBack], [kdoor.a0 - KITCHEN_DOOR.jamb, bh, zBack + bt]);
    base([kdoor.a1 + KITCHEN_DOOR.jamb, 0, zBack], [halfX, bh, zBack + bt]);
    base([-halfX, 0, zBack], [-halfX + bt, bh, zFront]);
    base([halfX - bt, 0, zBack], [halfX, bh, zFront]);
  }

  /* ---------------- roof slab / parapet (exterior only) ---------------- */
  b.box(pal.wallPaintExt, [-halfX - T - 0.2, H, zBack - T - 0.2], [halfX + T + 0.2, H + 0.35, zFront + T + 0.25], uv);

  /* ---------------- kitchen void ---------------- */
  {
    const g = new THREE.BoxGeometry(halfX * 2 + 0.4, H + slabDrop, 3.4);
    g.translate(0, (H - slabDrop) / 2, zBack - T - 1.7);
    const voidMat = pal.voidBlack.clone();
    voidMat.side = THREE.BackSide;
    const voidBox = new THREE.Mesh(g, voidMat);
    voidBox.name = "kitchen-void";
    parent.add(voidBox);
    // A dark shape: range hood silhouette, barely distinguishable from the void.
    const hood = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.9), new THREE.MeshBasicMaterial({ color: 0x0c0b0a }));
    hood.position.set(-0.5, 2.15, zBack - T - 1.6);
    parent.add(hood);
    const range = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.95, 0.8), new THREE.MeshBasicMaterial({ color: 0x0a0909 }));
    range.position.set(-0.5, 0.475, zBack - T - 1.6);
    parent.add(range);
  }

  /* ---------------- exterior ground ---------------- */
  {
    b.box(pal.concrete, [-halfX - 1.5, yLow, zFront + T], [halfX + 1.5, 0, zFront + T + 1.8], { uvScale: 1 });
    const g = new THREE.PlaneGeometry(90, 90);
    g.rotateX(-Math.PI / 2);
    g.translate(0, yLow, 0);
    const lot = new THREE.Mesh(g, pal.asphalt);
    lot.receiveShadow = true;
    lot.name = "lot";
    parent.add(lot);
  }

  // Glass last: one transparent mesh for all panes.
  const glass = new THREE.Mesh(mergeGeometries(glassGeos, false)!, pal.glass);
  glass.renderOrder = 10;
  glass.name = "window-glass";
  parent.add(glass);

  b.build(parent, { name: "shell" });
  return { colliders: b.colliders };
}
