/**
 * The building shell: floor, walls with window / door / pass-through / AC
 * openings, window frames and glass, sills, baseboards, roof slab, kitchen
 * void, and the exterior ground the player starts on.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { AC_UNIT, DOOR, KITCHEN_DOOR, PASS_THROUGH, ROOM, WINDOW } from "./layout";

interface Opening {
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
function punchedWall(
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
    y1: WINDOW.sill + WINDOW.height,
  }));
  const doorOpening: Opening = { a0: DOOR.hingeX, a1: DOOR.hingeX + DOOR.width, y0: yLow, y1: DOOR.height };
  const frontOpenings = [...windowOpenings, doorOpening];
  const zMid = zFront + T / 2;
  punchedWall(-halfX, halfX, yLow, H, frontOpenings, (x0, x1, y0, y1) => {
    b.box(pal.wallPaint, [x0, y0, zFront], [x1, y1, zMid], uv);
    b.box(pal.wallPaintExt, [x0, y0, zMid], [x1, y1, zFront + T], uv);
  });
  // Solid collision for the whole wall (door leaf is walk-through until System 7
  // gives it a hinge; the opening itself stays open in the collider set).
  for (const seg of [
    [-halfX, DOOR.hingeX],
    [DOOR.hingeX + DOOR.width, halfX],
  ]) {
    b.collider([seg[0], 0, zFront], [seg[1], H, zFront + T]);
  }

  /* ---------------- back partition to the kitchen, -z ---------------- */
  const pass: Opening = {
    a0: PASS_THROUGH.centerX - PASS_THROUGH.width / 2,
    a1: PASS_THROUGH.centerX + PASS_THROUGH.width / 2,
    y0: PASS_THROUGH.sill,
    y1: PASS_THROUGH.sill + PASS_THROUGH.height,
  };
  punchedWall(-halfX, halfX, yLow, H, [pass], (x0, x1, y0, y1) => {
    b.box(pal.wallPaint, [x0, y0, zBack - T], [x1, y1, zBack], uv);
  });
  b.collider([-halfX, 0, zBack - T], [halfX, H, zBack]);

  /* ---------------- end walls, ±x ---------------- */
  const acOpening: Opening = {
    a0: AC_UNIT.z - AC_UNIT.w / 2,
    a1: AC_UNIT.z + AC_UNIT.w / 2,
    y0: AC_UNIT.centerY - AC_UNIT.h / 2,
    y1: AC_UNIT.centerY + AC_UNIT.h / 2,
  };
  punchedWall(zBack - T, zFront + T, yLow, H, [acOpening], (z0, z1, y0, y1) => {
    b.box(pal.wallPaint, [-halfX - T / 2, y0, z0], [-halfX, y1, z1], uv);
    b.box(pal.wallPaintExt, [-halfX - T, y0, z0], [-halfX - T / 2, y1, z1], uv);
  });
  b.box(pal.wallPaint, [halfX, yLow, zBack - T], [halfX + T / 2, H, zFront + T], uv);
  b.box(pal.wallPaintExt, [halfX + T / 2, yLow, zBack - T], [halfX + T, H, zFront + T], uv);
  b.collider([-halfX - T, 0, zBack - T], [-halfX, H, zFront + T]);
  b.collider([halfX, 0, zBack - T], [halfX + T, H, zFront + T]);

  /* ---------------- window AC unit ---------------- */
  {
    const x0 = -halfX - 0.45, x1 = -halfX + 0.15;
    const z0 = acOpening.a0, z1 = acOpening.a1, y0 = acOpening.y0, y1 = acOpening.y1;
    b.box(pal.acUnit, [x0, y0, z0], [x1, y1, z1]);
    // Interior face: recessed grey louvre grille with horizontal slats, and a
    // control strip along the bottom.
    b.box(pal.kickPanel, [x1 - 0.004, y0 + 0.09, z0 + 0.03], [x1 + 0.002, y1 - 0.03, z1 - 0.03]);
    for (let y = y0 + 0.11; y < y1 - 0.04; y += 0.03) {
      b.box(pal.acUnit, [x1 + 0.002, y, z0 + 0.03], [x1 + 0.012, y + 0.012, z1 - 0.03]);
    }
    b.box(pal.darkMetal, [x1 - 0.002, y0 + 0.03, z0 + 0.03], [x1 + 0.004, y0 + 0.07, z1 - 0.03]);
  }

  /* ---------------- window frames, glass, sills, casing ---------------- */
  const fw = 0.05; // frame member width
  const fd = 0.1; // frame depth (z)
  const zF0 = zMid - fd / 2, zF1 = zMid + fd / 2;
  const glassGeos: THREE.BufferGeometry[] = [];
  for (const o of windowOpenings) {
    const { a0: x0, a1: x1, y0, y1 } = o;
    b.box(pal.alum, [x0, y0, zF0], [x0 + fw, y1, zF1]);
    b.box(pal.alum, [x1 - fw, y0, zF0], [x1, y1, zF1]);
    b.box(pal.alum, [x0 + fw, y1 - fw, zF0], [x1 - fw, y1, zF1]);
    b.box(pal.alum, [x0 + fw, y0, zF0], [x1 - fw, y0 + fw, zF1]);
    // Glass pane
    const g = new THREE.PlaneGeometry(x1 - x0 - fw * 2, y1 - y0 - fw * 2);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, zMid);
    glassGeos.push(g);
    // Interior sill: painted wood, projects 0.12 m into the room.
    b.box(pal.trimPaint, [x0 - 0.07, y0 - 0.04, zFront - 0.12], [x1 + 0.07, y0, zFront + 0.01]);
    // Interior casing around the opening.
    const cw = 0.07, ct = 0.015;
    b.box(pal.trimPaint, [x0 - cw, y0 - 0.04, zFront - ct], [x0, y1 + cw, zFront]);
    b.box(pal.trimPaint, [x1, y0 - 0.04, zFront - ct], [x1 + cw, y1 + cw, zFront]);
    b.box(pal.trimPaint, [x0, y1, zFront - ct], [x1, y1 + cw, zFront]);
  }
  {
    // One mesh for all panes (transparent, drawn after opaque).
    const mergedGlass = new THREE.Mesh(mergeGeometries(glassGeos, false)!, pal.glass);
    mergedGlass.renderOrder = 10;
    mergedGlass.name = "window-glass";
    parent.add(mergedGlass);
  }

  /* ---------------- door frame (leaf is built in Door.ts) ---------------- */
  {
    const x0 = doorOpening.a0, x1 = doorOpening.a1;
    const jw = 0.05, jd = 0.12;
    const z0 = zMid - jd / 2, z1 = zMid + jd / 2;
    b.box(pal.alum, [x0 - jw, 0, z0], [x0, DOOR.height + jw, z1]);
    b.box(pal.alum, [x1, 0, z0], [x1 + jw, DOOR.height + jw, z1]);
    b.box(pal.alum, [x0, DOOR.height, z0], [x1, DOOR.height + jw, z1]);
    // Threshold plate
    b.box(pal.alum, [x0, -0.002, zFront - 0.02], [x1, 0.012, zFront + T + 0.02]);
  }

  /* ---------------- kitchen swing door (closed, in the partition) ---------------- */
  {
    const { centerX, width, height } = KITCHEN_DOOR;
    const x0 = centerX - width / 2, x1 = centerX + width / 2;
    const z0 = zBack, z1 = zBack + 0.045;
    // Painted frame casing
    b.box(pal.trimPaint, [x0 - 0.06, 0, z0], [x0, height + 0.06, z1 + 0.01]);
    b.box(pal.trimPaint, [x1, 0, z0], [x1 + 0.06, height + 0.06, z1 + 0.01]);
    b.box(pal.trimPaint, [x0, height, z0], [x1, height + 0.06, z1 + 0.01]);
    // Leaf: laminate with a stainless kick plate and a small porthole into the dark kitchen
    b.box(pal.laminateWood, [x0 + 0.005, 0.015, z0 + 0.001], [x1 - 0.005, height - 0.005, z1]);
    b.box(pal.stainless, [x0 + 0.03, 0.03, z1], [x1 - 0.03, 0.4, z1 + 0.003]);
    b.box(pal.stainless, [x0 + 0.03, 0.9, z1], [x1 - 0.03, 0.96, z1 + 0.02]); // push plate rail
    const port = new THREE.BoxGeometry(0.3, 0.4, 0.02);
    port.translate(centerX, 1.55, z1);
    b.add(port, pal.voidBlack);
    b.box(pal.stainless, [centerX - 0.17, 1.33, z1 - 0.001], [centerX + 0.17, 1.35, z1 + 0.012]);
    b.box(pal.stainless, [centerX - 0.17, 1.75, z1 - 0.001], [centerX + 0.17, 1.77, z1 + 0.012]);
    b.box(pal.stainless, [centerX - 0.17, 1.33, z1 - 0.001], [centerX - 0.15, 1.77, z1 + 0.012]);
    b.box(pal.stainless, [centerX + 0.15, 1.33, z1 - 0.001], [centerX + 0.17, 1.77, z1 + 0.012]);
  }

  /* ---------------- pass-through shelf ---------------- */
  {
    const x0 = pass.a0 - 0.06, x1 = pass.a1 + 0.06;
    b.box(pal.stainless, [x0, pass.y0 - 0.03, zBack - T - 0.05], [x1, pass.y0, zBack + 0.12]);
    // Stainless jamb liner
    b.box(pal.stainless, [pass.a0 - 0.02, pass.y0, zBack - T - 0.005], [pass.a0, pass.y1 + 0.02, zBack + 0.005]);
    b.box(pal.stainless, [pass.a1, pass.y0, zBack - T - 0.005], [pass.a1 + 0.02, pass.y1 + 0.02, zBack + 0.005]);
    b.box(pal.stainless, [pass.a0 - 0.02, pass.y1, zBack - T - 0.005], [pass.a1 + 0.02, pass.y1 + 0.02, zBack + 0.005]);
  }

  /* ---------------- baseboards (black rubber) ---------------- */
  {
    const bh = 0.1, bt = 0.012;
    // Front wall, either side of the door.
    b.box(pal.baseboard, [-halfX, 0, zFront - bt], [DOOR.hingeX - 0.05, bh, zFront]);
    b.box(pal.baseboard, [DOOR.hingeX + DOOR.width + 0.05, 0, zFront - bt], [halfX, bh, zFront]);
    // Back partition (behind the back bar; visible only at the open end).
    b.box(pal.baseboard, [-halfX, 0, zBack], [halfX, bh, zBack + bt]);
    // End walls.
    b.box(pal.baseboard, [-halfX, 0, zBack], [-halfX + bt, bh, zFront]);
    b.box(pal.baseboard, [halfX - bt, 0, zBack], [halfX, bh, zFront]);
  }

  /* ---------------- roof slab / parapet (exterior only) ---------------- */
  b.box(pal.wallPaintExt, [-halfX - T - 0.2, H, zBack - T - 0.2], [halfX + T + 0.2, H + 0.35, zFront + T + 0.25], uv);

  /* ---------------- kitchen void ---------------- */
  {
    const g = new THREE.BoxGeometry(halfX * 2 + 0.4, H + slabDrop, 3.4);
    g.translate(0, (H - slabDrop) / 2, zBack - T - 1.7);
    const voidBox = new THREE.Mesh(g, pal.voidBlack);
    (voidBox.material as THREE.MeshBasicMaterial).side = THREE.BackSide;
    voidBox.name = "kitchen-void";
    parent.add(voidBox);
    // A dark shape: range hood silhouette, barely distinguishable from the void.
    const hood = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.5, 0.9),
      new THREE.MeshBasicMaterial({ color: 0x0c0b0a }),
    );
    hood.position.set(-0.5, 2.15, zBack - T - 1.6);
    parent.add(hood);
    const range = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.95, 0.8),
      new THREE.MeshBasicMaterial({ color: 0x0a0909 }),
    );
    range.position.set(-0.5, 0.475, zBack - T - 1.6);
    parent.add(range);
  }

  /* ---------------- exterior ground ---------------- */
  {
    // Concrete apron in front of the diner, top flush with the interior floor.
    b.box(pal.concrete, [-halfX - 1.5, yLow, zFront + T], [halfX + 1.5, 0, zFront + T + 1.8], { uvScale: 1 });
    const g = new THREE.PlaneGeometry(90, 90);
    g.rotateX(-Math.PI / 2);
    g.translate(0, yLow, 0);
    const lot = new THREE.Mesh(g, pal.asphalt);
    lot.receiveShadow = true;
    lot.name = "lot";
    parent.add(lot);
  }

  b.build(parent, { name: "shell" });
  return { colliders: b.colliders };
}
