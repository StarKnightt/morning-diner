/**
 * System 9 openables: the two under-counter cabinet doors in the back bar (the bay
 * `BACK_BAR.cabinet` that Counter.ts leaves open) and the kitchen swing door at the -x
 * end of the back wall (Shell.ts keeps only its casings).
 *
 * Everything static — the cabinet carcass, its shelf and contents, the dim vestibule
 * behind the kitchen door — goes into the shared `statics` builder and is appended to
 * the scene's existing material buckets (core/mergeInto.ts), so it costs no draw calls.
 * Only the leaves are their own meshes, each hung on a hinge Group the interactions
 * rotate: a laminate slab + chrome wire pull per cabinet door, and one vertex-coloured
 * mesh for the kitchen leaf (paint, dark lite, grey plates, dark pivots) — six own draw
 * calls in all (twelve in poses where the transmission pass draws the opaques twice).
 * A 4 mm dark reveal on the die face frames the cabinet pair so it reads in the flat
 * service-side light.
 *
 * Hinge conventions (rotation.y, radians, positive = the leaf's free edge toward -z):
 *   cabinet left   hinge at the bay's -x edge, leaf along +x, opens toward the aisle (+z) → NEGATIVE angles
 *   cabinet right  hinge at the bay's +x edge, leaf along -x, opens toward +z → POSITIVE angles
 *   kitchen        hinge at the -x jamb, leaf along +x; pushed from the dining room it swings into
 *                  the kitchen (-z) → POSITIVE angles; the spring's back-swing is negative.
 * `HingedLeaf.sign` carries that so an interaction can think in "degrees open".
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { BACK_BAR, KITCHEN_DOOR, ROOM } from "./layout";

export interface HingedLeaf {
  hinge: THREE.Group;
  /** Multiply "degrees open" (≥ 0 toward the player) by this to get `hinge.rotation.y`. */
  sign: 1 | -1;
  /** Where the player looks to get the prompt (world). */
  focus: THREE.Vector3;
  /** Where its sounds come from (world, on the leaf near the free edge when closed). */
  voice: THREE.Vector3;
  /** Leaf width from the hinge, m. */
  width: number;
}

export interface OpenablesResult {
  cabinet: [HingedLeaf, HingedLeaf];
  kitchenDoor: HingedLeaf;
}

const V2 = (x: number, y: number) => new THREE.Vector2(x, y);

function saucerGeometry(): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    [V2(0, 0.003), V2(0.03, 0.003), V2(0.033, 0), V2(0.045, 0), V2(0.05, 0.005), V2(0.072, 0.014), V2(0.078, 0.018), V2(0.074, 0.019), V2(0.052, 0.011), V2(0.042, 0.008), V2(0, 0.008)],
    40,
  );
}

/** Give a geometry a flat vertex colour (for the one vertex-coloured leaf material). */
export function tint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

export function buildOpenables(parent: THREE.Group, pal: Palette, statics: MergedBuilder): OpenablesResult {
  return {
    cabinet: buildCabinet(parent, pal, statics),
    kitchenDoor: buildKitchenDoor(parent, pal, statics),
  };
}

/* ------------------------------------------------------------------------------------ */
/* Under-counter cabinet                                                                  */
/* ------------------------------------------------------------------------------------ */

function buildCabinet(parent: THREE.Group, pal: Palette, s: MergedBuilder): [HingedLeaf, HingedLeaf] {
  const [x0, x1] = BACK_BAR.cabinet;
  const zFront = BACK_BAR.zFront, zBack = zFront - BACK_BAR.depth;
  const y0 = 0.1, y1 = BACK_BAR.height - 0.03 - 0.02; // the bay Counter.ts cuts: kick to under the top
  const t = 0.018; // carcass panel
  const lam = pal.laminateCabinet;

  // Carcass: 1 mm inside the cut faces so nothing ties with the die; back 20 mm off the wall.
  const zi0 = zBack + 0.02, zi1 = zFront - 0.002;
  s.box(lam, [x0 + 0.001, y0 + 0.001, zi0], [x0 + 0.001 + t, y1 - 0.001, zi1], { metric: true });
  s.box(lam, [x1 - 0.001 - t, y0 + 0.001, zi0], [x1 - 0.001, y1 - 0.001, zi1], { metric: true });
  s.box(lam, [x0 + 0.001, y0 + 0.001, zi0], [x1 - 0.001, y0 + 0.001 + t, zi1], { metric: true }); // bottom
  s.box(lam, [x0 + 0.001, y1 - 0.001 - t, zi0], [x1 - 0.001, y1 - 0.001, zi1], { metric: true }); // top
  s.box(lam, [x0 + 0.001 + t, y0 + 0.001, zi0], [x1 - 0.001 - t, y1 - 0.001, zi0 + t], { metric: true }); // back
  // One adjustable shelf at 470 mm, 50 mm short of the doors.
  const shelfY = 0.47;
  s.box(lam, [x0 + 0.001 + t, shelfY, zi0 + t], [x1 - 0.001 - t, shelfY + t, zi1 - 0.05], { metric: true });
  const floorY = y0 + 0.001 + t;

  // Contents. Bottom: a stack of five saucers and a roll of paper towels on its side.
  {
    const saucer = saucerGeometry();
    const sx = x0 + 0.2, sz = zBack + 0.33;
    for (let i = 0; i < 5; i++) {
      const g = saucer.clone();
      g.rotateY(i * 0.7);
      g.translate(sx + (i % 2) * 0.002, floorY + i * 0.011, sz + ((i * 7) % 3) * 0.001);
      s.add(g, pal.ceramic);
    }
    const roll = new THREE.CylinderGeometry(0.056, 0.056, 0.28, 28);
    roll.rotateZ(Math.PI / 2);
    roll.translate(x1 - 0.32, floorY + 0.056, zBack + 0.36);
    s.add(roll, pal.napkin);
    const core = new THREE.CylinderGeometry(0.02, 0.02, 0.282, 16, 1, true);
    core.rotateZ(Math.PI / 2);
    core.translate(x1 - 0.32, floorY + 0.056, zBack + 0.36);
    s.add(core, pal.trayBrown);
  }
  // Shelf: the box of filters (open, filters fanned above the lid line) and a spray bottle.
  {
    const bx = x0 + 0.27, bz = zBack + 0.3, bw = 0.19, bd = 0.13, bh = 0.155;
    const top = shelfY + t;
    s.rbox(pal.napkin, [bx - bw / 2, top, bz - bd / 2], [bx + bw / 2, top + bh, bz + bd / 2], 0.002);
    // Printed band and a brown "coffee filters" block on the front face, 0.5 mm proud.
    s.box(pal.darkSeal, [bx - bw / 2 - 0.0005, top + 0.045, bz - bd / 2 - 0.0005], [bx + bw / 2 + 0.0005, top + 0.075, bz + bd / 2 + 0.0005]);
    s.box(pal.trayBrown, [bx - 0.06, top + 0.09, bz + bd / 2], [bx + 0.06, top + 0.125, bz + bd / 2 + 0.0006]);
    // Filters: a squat fluted cylinder standing proud of the open top.
    const filters = new THREE.CylinderGeometry(0.058, 0.05, 0.05, 36, 1, false);
    filters.translate(bx, top + bh - 0.02, bz);
    s.add(filters, pal.napkin);

    const px = x1 - 0.22, pz = zBack + 0.32;
    const body = new THREE.LatheGeometry(
      [V2(0, 0), V2(0.036, 0), V2(0.04, 0.012), V2(0.041, 0.09), V2(0.038, 0.14), V2(0.026, 0.175), V2(0.016, 0.19), V2(0.016, 0.215), V2(0, 0.215)],
      32,
    );
    body.translate(px, top, pz);
    s.add(body, pal.fixtureWhite);
    // Trigger head (black plastic) with the nozzle toward the doors, the lever hanging under it.
    s.rbox(pal.blackPlastic, [px - 0.017, top + 0.212, pz - 0.02], [px + 0.017, top + 0.252, pz + 0.05], 0.004);
    const lever = new THREE.BoxGeometry(0.02, 0.05, 0.008);
    lever.rotateX(THREE.MathUtils.degToRad(-18));
    lever.translate(px, top + 0.19, pz + 0.045);
    s.add(lever, pal.blackPlastic);
  }

  // Doors: full-overlay, 18 mm laminate on the die face, lapping the opening 8 mm each side
  // (shadow lines all round, so they read as doors and not as more die), meeting gap 3 mm;
  // each on its own hinge at its outer edge.
  const lap = 0.008;
  const w = (x1 - x0) / 2 + lap - 0.0015;
  const dz0 = 0.001, dz1 = 0.019;
  const zHinge = zFront;
  // Shadow gap: a 4 mm dark reveal around the pair, on the die face, so the doors read as
  // doors in the flat service-side light (the carcass shows dark through the meeting gap).
  {
    const g = 0.004, dk = pal.darkSeal;
    const ox0 = x0 - lap, ox1 = x1 + lap, oy0 = y0 - lap, oy1 = y1 + lap;
    s.box(dk, [ox0 - g, oy0 - g, zFront], [ox0, oy1 + g, zFront + 0.0006]);
    s.box(dk, [ox1, oy0 - g, zFront], [ox1 + g, oy1 + g, zFront + 0.0006]);
    s.box(dk, [ox0, oy1, zFront], [ox1, oy1 + g, zFront + 0.0006]);
    s.box(dk, [ox0, oy0 - g, zFront], [ox1, oy0, zFront + 0.0006]);
  }
  const make = (side: -1 | 1): HingedLeaf => {
    const hinge = new THREE.Group();
    hinge.name = side < 0 ? "cabinet-door-left" : "cabinet-door-right";
    const hx = side < 0 ? x0 - lap : x1 + lap;
    hinge.position.set(hx, 0, zHinge);
    const b = new MergedBuilder();
    // Local x runs from the hinge toward the meeting stile; mirrored for the right door.
    const X = (u: number) => (side < 0 ? u : -u);
    const xa = X(0), xb = X(w);
    const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
    const ya = y0 - lap, yb = y1 + lap;
    b.rbox(lam, [lo, ya, dz0], [hi, yb, dz1], 0.0025, 2, { metric: true });
    // Chrome wire pull, 96 mm centres, vertical, 45 mm in from the meeting stile at ⅔ height
    // (second bucket per door: the pulls are what make the pair read as doors from the aisle).
    const pxl = side < 0 ? hi - 0.045 : lo + 0.045;
    const pyc = ya + (yb - ya) * 0.66;
    const bar = new THREE.CylinderGeometry(0.005, 0.005, 0.12, 14);
    bar.translate(pxl, pyc, dz1 + 0.03);
    b.add(bar, pal.chrome);
    for (const py of [pyc - 0.048, pyc + 0.048]) {
      const post = new THREE.CylinderGeometry(0.0045, 0.0045, 0.03, 12);
      post.rotateX(Math.PI / 2);
      post.translate(pxl, py, dz1 + 0.015);
      b.add(post, pal.chrome);
    }
    b.build(hinge, { name: hinge.name });
    parent.add(hinge);
    const mid = (ya + yb) / 2;
    return {
      hinge,
      sign: side < 0 ? -1 : 1,
      focus: new THREE.Vector3(hx + X(w * 0.6), mid, zFront),
      voice: new THREE.Vector3(hx + X(w * 0.9), yb - 0.03, zFront),
      width: w,
    };
  };
  return [make(-1), make(1)];
}

/* ------------------------------------------------------------------------------------ */
/* Kitchen swing door                                                                     */
/* ------------------------------------------------------------------------------------ */

function buildKitchenDoor(parent: THREE.Group, pal: Palette, s: MergedBuilder): HingedLeaf {
  const T = ROOM.wallThickness, zBack = ROOM.zBack;
  const x0 = KITCHEN_DOOR.centerX - KITCHEN_DOOR.width / 2, x1 = KITCHEN_DOOR.centerX + KITCHEN_DOOR.width / 2;
  const h = KITCHEN_DOOR.height;
  const zMid = zBack - T / 2;

  const hinge = new THREE.Group();
  hinge.name = "kitchen-door";
  hinge.position.set(x0 + 0.006, 0, zMid);
  const w = x1 - x0 - 0.012;
  const b = new MergedBuilder();
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.06 });
  leafMat.name = "kitchenLeaf";
  // Leaf: painted (light, so it reads against the dark cabinets) with a dark vision lite.
  const slab = new THREE.BoxGeometry(w - 0.01, h - 0.023, 0.04);
  slab.translate(w / 2, (0.015 + h - 0.008) / 2, 0);
  b.add(tint(slab, 0xf2f1ec), leafMat);
  const { w: vw, h: vh, centerY: vy } = KITCHEN_DOOR.lite;
  const cx = w / 2;
  const port = new THREE.BoxGeometry(vw, vh, 0.044);
  port.translate(cx, vy, 0);
  b.add(tint(port, 0x17181a), leafMat);
  // Lite frame both faces, 8" kick plates both faces, push plates at 0.9 m both faces — all in
  // the leaf's vertex-coloured material (a light satin grey reads as the aluminium plates from
  // the aisle; a real stainless bucket would be a second draw call on a moving mesh).
  const plate = (a: readonly [number, number, number], c: readonly [number, number, number]) => {
    const g = new THREE.BoxGeometry(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    g.translate((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
    b.add(tint(g, 0xc4c8cc), leafMat);
  };
  const vf = 0.02;
  for (const [za, zb] of [[-0.024, -0.02], [0.02, 0.024]] as const) {
    plate([cx - vw / 2 - vf, vy - vh / 2 - vf, za], [cx + vw / 2 + vf, vy - vh / 2, zb]);
    plate([cx - vw / 2 - vf, vy + vh / 2, za], [cx + vw / 2 + vf, vy + vh / 2 + vf, zb]);
    plate([cx - vw / 2 - vf, vy - vh / 2, za], [cx - vw / 2, vy + vh / 2, zb]);
    plate([cx + vw / 2, vy - vh / 2, za], [cx + vw / 2 + vf, vy + vh / 2, zb]);
    plate([0.03, 0.03, za], [w - 0.03, 0.233, zb]);
    plate([0.05, 0.9, za], [w - 0.05, 0.96, zb]);
  }
  // Pivots: top and bottom on the hinge stile (dark, same bucket).
  for (const y of [0.05, h - 0.06]) {
    const piv = new THREE.CylinderGeometry(0.012, 0.012, 0.06, 16);
    piv.translate(0.006, y, 0);
    b.add(tint(piv, 0x2b2b2d), leafMat);
  }
  b.build(hinge, { name: "kitchen-door" });
  parent.add(hinge);

  // The dim volume beyond: a vestibule the door opens into, in the pass-through's kitchen
  // material (self-lit a little, so it reads as a room and not the void). No lights.
  {
    const dim = pal.kitchenDim;
    const zIn = zBack - T, zFar = zIn - 1.6;
    const vx0 = x0 - 0.35, vx1 = x1 + 0.9;
    const H = ROOM.height;
    s.box(dim, [vx0, 0, zFar - 0.05], [vx1, H, zFar]); // back wall
    s.box(dim, [vx0 - 0.05, 0, zFar], [vx0, H, zIn]); // side walls
    s.box(dim, [vx1, 0, zFar], [vx1 + 0.05, H, zIn]);
    s.box(dim, [vx0, -0.05, zFar], [vx1, 0, zIn]); // floor
    s.box(dim, [vx0, H - 0.03, zFar], [vx1, H, zIn]); // ceiling
    // The wall's kitchen face around the opening (the shell's cut faces are thin; give the reveal a room side).
    s.box(dim, [vx0, 0, zIn - 0.02], [x0 - 0.02, H, zIn]);
    s.box(dim, [x1 + 0.02, 0, zIn - 0.02], [vx1, H, zIn]);
    s.box(dim, [x0 - 0.02, h + 0.02, zIn - 0.02], [x1 + 0.02, H, zIn]);
    // Silhouettes: a wire shelving unit on the +x side, a mop bucket by the wall.
    for (const y of [0.3, 0.75, 1.2, 1.65]) s.box(dim, [x1 + 0.3, y, zFar + 0.05], [vx1 - 0.05, y + 0.03, zFar + 0.5]);
    for (const [px, pz] of [[x1 + 0.3, zFar + 0.05], [vx1 - 0.05, zFar + 0.05], [x1 + 0.3, zFar + 0.5], [vx1 - 0.05, zFar + 0.5]]) {
      s.box(dim, [px - 0.012, 0, pz - 0.012], [px + 0.012, 1.8, pz + 0.012]);
    }
    const bucket = new THREE.CylinderGeometry(0.17, 0.15, 0.36, 20);
    bucket.translate(vx0 + 0.3, 0.18, zFar + 0.4);
    s.add(bucket, dim);
    // Warm glow: a fixture around the corner — a strip along the back wall at head height, and
    // the lit slit of the kitchen-proper doorway in the +x wall (so the volume reads as a room).
    s.box(pal.rockerLit, [vx0 + 0.2, 2.05, zFar - 0.001], [vx1 - 0.2, 2.08, zFar + 0.012]);
    s.box(pal.rockerLit, [vx1 - 0.012, 0.02, zFar + 0.9], [vx1 + 0.001, 2.0, zFar + 0.93]);
  }

  return {
    hinge,
    sign: 1,
    focus: new THREE.Vector3((x0 + x1) / 2, 1.05, zBack),
    voice: new THREE.Vector3(x1 - 0.15, 1.0, zBack - 0.05),
    width: w,
  };
}