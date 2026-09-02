/**
 * System 9 openables (rev 2): the two under-counter cabinet doors in the back bar (the bay
 * `BACK_BAR.cabinet` that Counter.ts leaves open) and the kitchen swing door at the -x end
 * of the back wall (Shell.ts keeps only its casings), with the lit kitchen slice behind it.
 *
 * Everything static — the cabinet carcass, its shelf and contents, the kitchen slice — goes
 * into the shared `statics` builder and is appended to the scene's existing material buckets
 * (core/mergeInto.ts), so it costs no draw calls; the tile and the filter-box label are in
 * the System 9 atlas material (`cloth`, Presence.ts). Own meshes: per cabinet door a laminate
 * slab + a chrome bucket (wire pull, two Euro hinge cups and arms); for the kitchen leaf a
 * vertex-coloured mesh (paint, rubber lite moulding, pivots, scuffs), a stainless mesh (kick
 * plates, push plates) and the vision-panel glass (palette `glass`, transmissive — it shows
 * the kitchen). Eight own meshes.
 *
 * Kitchen slice (rev 2 — rev 1's dim vestibule read as a black void with an orange stripe):
 * a 2.7 m deep room in white 4" wall tile to 1.5 m over a red quarry floor, a stainless prep
 * table with a shelf over it along the -x wall, a range under a stainless hood on the far
 * wall, a fluorescent strip fixture on the -x wall (palette `fixtureLens` emissive, the
 * troffers' tube tint) and one shadowless 5000 K spot at the ceiling (16,000 lm,
 * aimed down and away from the door so its cone stops inside the kitchen — no light on the
 * dining-room floor). Lit surfaces reach the probe, so the vision glass shows them too.
 *
 * Hinge conventions (rotation.y, radians, positive = the leaf's free edge toward -z):
 *   cabinet left   hinge at the bay's -x edge, leaf along +x, opens toward the aisle (+z) → NEGATIVE angles
 *   cabinet right  hinge at the bay's +x edge, leaf along -x, opens toward +z → POSITIVE angles
 *   kitchen        hinge at the -x jamb, leaf along +x; pushed from the dining room it swings into
 *                  the kitchen (-z) → POSITIVE angles; the spring's back-swing is negative.
 * `HingedLeaf.sign` carries that so an interaction can think in "degrees open".
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { makePaneGlass } from "./Exterior";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { PRESENCE_UV } from "../procedural/presence";
import { BACK_BAR, KITCHEN_DOOR, ROOM } from "./layout";
import { nits } from "./Lighting";
import { lathe, ribbon, SAUCER_PROFILE, tiledRect, uvIntoRect } from "./Presence";

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
  /** The kitchen slice's fluorescent spot (Lighting-independent; here so Diner can count it). */
  kitchenLight: THREE.SpotLight;
  /** Door materials whose metal lives in the vertex alpha: Diner gives them the metal probe. */
  envMetals: THREE.MeshStandardMaterial[];
}

const V2 = (x: number, y: number) => new THREE.Vector2(x, y);
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/**
 * Vertex alpha 0 -> polished metal (metalness 1, roughness `rough`, colour from the vertex, the
 * maps ignored); alpha 1 -> the material as authored. Lets one vertex-coloured bucket hold paint
 * and stainless, or laminate and chrome.
 */
function metalByVertexAlpha(m: THREE.MeshStandardMaterial, rough: number, key: string): void {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <metalnessmap_fragment>",
      [
        "#include <metalnessmap_fragment>",
        "#ifdef USE_COLOR_ALPHA",
        `if ( vColor.a < 0.5 ) { metalnessFactor = 1.0; roughnessFactor = ${rough.toFixed(3)}; diffuseColor.rgb = vColor.rgb; }`,
        "diffuseColor.a = 1.0;",
        "#endif",
      ].join("\n"),
    );
  };
  m.customProgramCacheKey = () => key;
}

/** 4 × 4" wall tiles and 4 × 6" quarry tiles per atlas cell. */
const WALL_TILE_CELL = 4 * 0.1016;
const QUARRY_CELL = 4 * 0.1524;

/**
 * Give a geometry a flat vertex colour (RGBA) for a vertex-coloured leaf material. Alpha is a
 * flag, not opacity: `metal` writes 0, and `metalByVertexAlpha` renders those vertices as
 * polished metal in the vertex's colour - so a painted door and its stainless plates, or a
 * laminate door and its chrome pull, are one bucket and one draw call.
 */
export function tint(g: THREE.BufferGeometry, hex: number, metal = false): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 4);
  const a = metal ? 0 : 1;
  for (let i = 0; i < n; i++) {
    arr[i * 4] = c.r;
    arr[i * 4 + 1] = c.g;
    arr[i * 4 + 2] = c.b;
    arr[i * 4 + 3] = a;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 4));
  return g;
}

export function buildOpenables(parent: THREE.Group, pal: Palette, statics: MergedBuilder, cloth: THREE.Material): OpenablesResult {
  const kitchen = buildKitchenDoor(parent, pal, statics, cloth);
  const cabinet = buildCabinet(parent, pal, statics, cloth);
  return {
    cabinet: cabinet.leaves,
    kitchenDoor: kitchen.leaf,
    kitchenLight: kitchen.light,
    envMetals: [cabinet.material, kitchen.material],
  };
}

/* ------------------------------------------------------------------------------------ */
/* Under-counter cabinet                                                                  */
/* ------------------------------------------------------------------------------------ */

function buildCabinet(parent: THREE.Group, pal: Palette, s: MergedBuilder, cloth: THREE.Material): { leaves: [HingedLeaf, HingedLeaf]; material: THREE.MeshStandardMaterial } {
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

  // Euro hinge mounting plates on the side panels' inner faces, 37 mm back from the front edge,
  // 100 mm from the top and bottom of the door (nickel: the chrome bucket).
  const hingeYs = [y0 + 0.1 - 0.008, y1 - 0.1 + 0.008];
  for (const hy of hingeYs) {
    s.rbox(pal.chrome, [x0 + 0.001 + t, hy - 0.02, zi1 - 0.057], [x0 + 0.001 + t + 0.003, hy + 0.02, zi1 - 0.017], 0.001);
    s.rbox(pal.chrome, [x1 - 0.001 - t - 0.003, hy - 0.02, zi1 - 0.057], [x1 - 0.001 - t, hy + 0.02, zi1 - 0.017], 0.001);
  }

  // Contents. Bottom: a stack of five saucers (the diner saucer profile: foot ring, well, rolled
  // rim) and a roll of paper towels on its side.
  {
    const saucer = lathe(SAUCER_PROFILE, 44);
    const sx = x0 + 0.2, sz = zBack + 0.33;
    for (let i = 0; i < 5; i++) {
      const g = saucer.clone();
      g.rotateY(i * 0.7);
      g.translate(sx + (i % 2) * 0.002 - 0.001 * (i % 3), floorY + i * 0.0165, sz + ((i * 7) % 3) * 0.0015);
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
    // Printed label band round the box (the atlas `label` tile: brand block, word lines, red
    // logo, fluted-filter graphic), 0.3 mm proud on the front and both sides.
    const band = (w: number, h: number, cx: number, cy: number, cz: number, rotY: number) => {
      const g = uvIntoRect(new THREE.PlaneGeometry(w, h), PRESENCE_UV.label);
      g.rotateY(rotY);
      g.translate(cx, cy, cz);
      s.add(g, cloth);
    };
    const lh = 0.042;
    band(bw - 0.006, lh, bx, top + 0.06, bz + bd / 2 + 0.0003, 0);
    band(bd - 0.006, lh, bx + bw / 2 + 0.0003, top + 0.06, bz, Math.PI / 2);
    band(bd - 0.006, lh, bx - bw / 2 - 0.0003, top + 0.06, bz, -Math.PI / 2);
    // Filters: a squat fluted cylinder standing proud of the open top.
    const filters = new THREE.CylinderGeometry(0.058, 0.05, 0.05, 36, 1, false);
    filters.translate(bx, top + bh - 0.02, bz);
    s.add(filters, pal.napkin);

    // Spray bottle: a 32 oz trigger sprayer — waisted body, threaded neck collar, the trigger
    // head (nozzle forward, toward the doors) with the lever curving down under it, a dip tube.
    const px = x1 - 0.22, pz = zBack + 0.32;
    const body = lathe(
      [V2(0, 0), V2(0.036, 0), V2(0.04, 0.012), V2(0.041, 0.09), V2(0.038, 0.14), V2(0.028, 0.168), V2(0.02, 0.182), V2(0.017, 0.19), V2(0.017, 0.2), V2(0, 0.2)],
      32,
    );
    body.translate(px, top, pz);
    s.add(body, pal.fixtureWhite);
    const collar = new THREE.CylinderGeometry(0.019, 0.019, 0.022, 24);
    collar.translate(px, top + 0.209, pz);
    s.add(collar, pal.blackPlastic);
    // Head: a wedge housing from the collar forward to the nozzle, its top sloping down to the front.
    const head: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const q = i / 8;
      head.push(V3(px, top + 0.238 - 0.02 * q * q, pz - 0.014 + q * 0.07));
    }
    s.add(ribbon(head, (q) => 0.0165 - 0.006 * q, (q) => 0.017 - 0.009 * q * q, V3(0, 1, 0), PRESENCE_UV.crumb, { ring: 8, power: 3.5 }), pal.blackPlastic);
    const nozzle = new THREE.CylinderGeometry(0.0055, 0.007, 0.012, 14);
    nozzle.rotateX(Math.PI / 2);
    nozzle.translate(px, top + 0.226, pz + 0.062);
    s.add(nozzle, pal.blackPlastic);
    // Trigger lever: curves down and back from under the head.
    const lever: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const q = i / 6;
      lever.push(V3(px, top + 0.216 - 0.05 * q, pz + 0.04 + 0.014 * Math.sin(q * Math.PI * 0.9) - 0.006 * q));
    }
    s.add(ribbon(lever, () => 0.009, () => 0.0035, V3(0, 0, 1), PRESENCE_UV.crumb, { ring: 8, power: 3 }), pal.blackPlastic);
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
  // Both doors are ONE mesh (one draw call — rev 1 spent four: two leaves × {laminate, chrome},
  // doubled by the transmission pass). Each door's geometry is authored in its hinge's local
  // frame and baked to world whenever that hinge moves (a CPU transform of ~1.5 k vertices in
  // `updateMatrixWorld`, so the shadow pass and the main pass see the same frame). The material
  // is the carcass laminate cloned with vertex colours; vertex alpha 0 flags the chrome parts
  // (pull, hinge cups), which the fragment shader renders as metal in the vertex's colour.
  const chromeC = pal.chrome.color;
  const CHROME: [number, number, number, number] = [chromeC.r, chromeC.g, chromeC.b, 0];
  const LAM: [number, number, number, number] = [1, 1, 1, 1];
  const colour4 = (g: THREE.BufferGeometry, c: [number, number, number, number]) => {
    const n = g.attributes.position.count, arr = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) arr.set(c, i * 4);
    g.setAttribute("color", new THREE.BufferAttribute(arr, 4));
    return g;
  };
  const doorMat = lam.clone();
  doorMat.vertexColors = true;
  doorMat.name = "cabinetDoors";
  metalByVertexAlpha(doorMat, 0.08, "cabinet-doors");

  const parts: Array<{ hinge: THREE.Group; geo: THREE.BufferGeometry }> = [];
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
    // (the pulls are what make the pair read as doors from the aisle).
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
    // Two concealed Euro hinges on the inner face (35 mm cup in a 48 × 60 flange, its body 11 mm
    // proud of the face; the arm runs from the cup back past the hinge edge to the carcass plate).
    // Cup centre 46.5 mm from the hinge edge — clear of the 18 mm side panel the door overlays.
    for (const hy of hingeYs) {
      const cx = X(0.0465);
      const flange = new THREE.BoxGeometry(0.048, 0.06, 0.0015);
      flange.translate(cx, hy, dz0 - 0.00075);
      b.add(flange, pal.chrome);
      const cup = new THREE.CylinderGeometry(0.0175, 0.0175, 0.011, 24);
      cup.rotateX(Math.PI / 2);
      cup.translate(cx, hy, dz0 - 0.0015 - 0.0055);
      b.add(cup, pal.chrome);
      for (const sy of [-0.021, 0.021]) {
        const screw = new THREE.CylinderGeometry(0.0035, 0.0035, 0.001, 10);
        screw.rotateX(Math.PI / 2);
        screw.translate(cx, hy + sy, dz0 - 0.002);
        b.add(screw, pal.chrome);
      }
      const armLo = Math.min(X(0.0465), X(-0.004)), armHi = Math.max(X(0.0465), X(-0.004));
      b.rbox(pal.chrome, [armLo, hy - 0.009, dz0 - 0.0125], [armHi, hy + 0.009, dz0 - 0.0035], 0.001);
    }
    // Collapse the two buckets into one vertex-coloured geometry (hinge-local).
    const staging = new THREE.Group();
    const built = b.build(staging);
    const pieces = built.map((m) => colour4(m.geometry.index ? m.geometry.toNonIndexed() : m.geometry, m.material === lam ? LAM : CHROME));
    const geo = mergeGeometries(pieces, false)!;
    parts.push({ hinge, geo });
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
  const leaves: [HingedLeaf, HingedLeaf] = [make(-1), make(1)];

  // One mesh for both, baked to world space from the hinges' matrices.
  const merged = mergeGeometries(parts.map((p) => p.geo), false)!;
  const local = { pos: (merged.attributes.position.array as Float32Array).slice(), nrm: (merged.attributes.normal.array as Float32Array).slice() };
  const ranges: Array<[number, number]> = [];
  for (let i = 0, at = 0; i < parts.length; i++) {
    const n = parts[i].geo.attributes.position.count;
    ranges.push([at, at + n]);
    at += n;
  }
  const doors = new THREE.Mesh(merged, doorMat);
  doors.name = "cabinet-doors";
  doors.castShadow = true;
  doors.receiveShadow = true;
  doors.frustumCulled = false; // bounds change with the doors; the mesh is small and always near the counter
  parent.add(doors);
  const M = new THREE.Matrix4(), N = new THREE.Matrix3(), v = new THREE.Vector3();
  const bake = () => {
    const pos = merged.attributes.position as THREE.BufferAttribute, nrm = merged.attributes.normal as THREE.BufferAttribute;
    const P = pos.array as Float32Array, Nn = nrm.array as Float32Array;
    for (let d = 0; d < parts.length; d++) {
      M.copy(parts[d].hinge.matrixWorld);
      N.getNormalMatrix(M);
      const [a, b2] = ranges[d];
      for (let i = a; i < b2; i++) {
        v.fromArray(local.pos, i * 3).applyMatrix4(M).toArray(P, i * 3);
        v.fromArray(local.nrm, i * 3).applyMatrix3(N).normalize().toArray(Nn, i * 3);
      }
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
  };
  const last = [NaN, NaN];
  for (let d = 0; d < parts.length; d++) {
    const hinge = parts[d].hinge;
    const base = hinge.updateMatrixWorld.bind(hinge);
    hinge.updateMatrixWorld = (force?: boolean) => {
      base(force);
      if (last[d] !== hinge.rotation.y) {
        last[d] = hinge.rotation.y;
        bake();
      }
    };
  }
  return { leaves, material: doorMat };
}

/* ------------------------------------------------------------------------------------ */
/* Kitchen swing door                                                                     */
/* ------------------------------------------------------------------------------------ */

/** 9 × 14 in vision panel, its centre at 1.5 m (eye height through the glass). */
const VISION = { w: 0.229, h: 0.356, centerY: 1.5 };
/** Kitchen slice depth and width (m) behind the partition. */
const KITCHEN_DEPTH = 2.7;

function buildKitchenDoor(parent: THREE.Group, pal: Palette, s: MergedBuilder, cloth: THREE.Material): { leaf: HingedLeaf; light: THREE.SpotLight; material: THREE.MeshStandardMaterial } {
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
  metalByVertexAlpha(leafMat, 0.28, "kitchen-leaf"); // the plates: brushed stainless, one bucket with the paint
  const PAINT = 0xf2f1ec, RUBBER = 0x141416, PIVOT = 0x2b2b2d;
  const cx = w / 2;
  const { w: vw, h: vh, centerY: vy } = VISION;
  const th = 0.04; // leaf thickness
  const slabW = w - 0.01, yBot = 0.015, yTop = h - 0.008;
  const sx0 = cx - slabW / 2, sx1 = cx + slabW / 2;
  // Leaf: painted, in four slabs round the vision-panel opening (the opening is real: the
  // glass is a pane in it, the kitchen shows through).
  const slab = (a: readonly [number, number, number], c: readonly [number, number, number], hex: number) => {
    const g = new THREE.BoxGeometry(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    g.translate((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
    b.add(tint(g, hex), leafMat);
  };
  const ox0 = cx - vw / 2, ox1 = cx + vw / 2, oy0 = vy - vh / 2, oy1 = vy + vh / 2;
  slab([sx0, yBot, -th / 2], [sx1, oy0, th / 2], PAINT);
  slab([sx0, oy1, -th / 2], [sx1, yTop, th / 2], PAINT);
  slab([sx0, oy0, -th / 2], [ox0, oy1, th / 2], PAINT);
  slab([ox1, oy0, -th / 2], [sx1, oy1, th / 2], PAINT);
  // Black rubber vision moulding: lines the opening (6 mm) and laps 22 mm onto both faces, 3 mm proud.
  {
    const m = 0.022, lip = 0.003, r = 0.006;
    for (const [za, zb] of [[-th / 2 - lip, -th / 2], [th / 2, th / 2 + lip]] as const) {
      slab([ox0 - m, oy0 - m, za], [ox1 + m, oy0, zb], RUBBER);
      slab([ox0 - m, oy1, za], [ox1 + m, oy1 + m, zb], RUBBER);
      slab([ox0 - m, oy0, za], [ox0, oy1, zb], RUBBER);
      slab([ox1, oy0, za], [ox1 + m, oy1, zb], RUBBER);
    }
    slab([ox0, oy0, -th / 2], [ox1, oy0 + r, th / 2], RUBBER);
    slab([ox0, oy1 - r, -th / 2], [ox1, oy1, th / 2], RUBBER);
    slab([ox0, oy0, -th / 2], [ox0 + r, oy1, th / 2], RUBBER);
    slab([ox1 - r, oy0, -th / 2], [ox1, oy1, th / 2], RUBBER);
  }
  // Scuffs: cart-bumper height (0.5–0.72 m, just over the kick plate) and hip / hand height
  // (0.85–1.1) — thin grey-brown streaks of unequal length, angle and depth, 0.2 mm proud,
  // clustered rather than spaced; more on the push (dining) face, a few on the kitchen face.
  {
    const r = (() => {
      let q = 0x51ab77;
      return () => ((q = (q * 1664525 + 1013904223) >>> 0) / 4294967296);
    })();
    const tones = [0xb9b3ab, 0xa9a39b, 0xc4beb5, 0x9d978f, 0xb1aba3, 0x8f8a83];
    const clusters: Array<[number, number, number]> = [
      [cx + 0.1, 0.56, 7], // cart bumpers
      [cx + 0.28, 0.66, 4],
      [cx - 0.08, 0.63, 3],
      [w - 0.14, 0.92, 5], // hands beside the push plate
      [cx + 0.02, 1.02, 3],
    ];
    // A streak is a 6 x 2 plane whose outer vertices carry the paint colour, so it fades to
    // nothing at its ends and edges - a smudge, not a bar.
    const streak = (len: number, hh: number, hex: number, ang: number, x: number, y: number, z: number, flip: boolean) => {
      const g = new THREE.PlaneGeometry(len, hh, 6, 2);
      const pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 4);
      const paint = new THREE.Color(PAINT), mark = new THREE.Color(hex);
      for (let i = 0; i < n; i++) {
        const u = pos.getX(i) / len, v = pos.getY(i) / hh; // -0.5 ... 0.5
        const k = Math.max(0, 1 - Math.pow(Math.abs(u) * 2, 1.5)) * (Math.abs(v) < 0.4 ? 1 : 0);
        col[i * 4] = paint.r + (mark.r - paint.r) * k;
        col[i * 4 + 1] = paint.g + (mark.g - paint.g) * k;
        col[i * 4 + 2] = paint.b + (mark.b - paint.b) * k;
        col[i * 4 + 3] = 1;
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 4));
      g.rotateZ(ang);
      if (flip) g.rotateY(Math.PI);
      g.translate(x, y, z);
      b.add(g, leafMat);
    };
    for (const [x, y, n] of clusters) {
      for (let i = 0; i < n; i++) {
        const len = 0.03 + 0.13 * r() * r(), hh = 0.004 + 0.009 * r();
        streak(len, hh, tones[Math.floor(r() * tones.length)], (r() - 0.5) * 0.5, x + (r() - 0.5) * 0.14, y + (r() - 0.5) * 0.09, th / 2 + 0.0002, false);
        if (r() < 0.35) streak(len * (0.5 + 0.5 * r()), hh, tones[Math.floor(r() * tones.length)], (r() - 0.5) * 0.5, w - x + (r() - 0.5) * 0.14, y + (r() - 0.5) * 0.09, -th / 2 - 0.0002, true);
      }
    }
  }
  // Pivots: top and bottom on the hinge stile (dark, same bucket).
  for (const y of [0.05, h - 0.06]) {
    const piv = new THREE.CylinderGeometry(0.012, 0.012, 0.06, 16);
    piv.translate(0.006, y, 0);
    b.add(tint(piv, PIVOT), leafMat);
  }
  // Stainless: 16" kick plates on both faces, 4 × 16 in push plates at 1.0–1.4 m near the free
  // edge on both faces (a double-acting door is pushed from either side), 1.2 mm proud.
  {
    const STEEL = pal.stainlessCool.color.getHex(THREE.LinearSRGBColorSpace);
    const plate = (a: readonly [number, number, number], c: readonly [number, number, number]) => {
      const g = new RoundedBoxGeometry(c[0] - a[0], c[1] - a[1], c[2] - a[2], 2, 0.0006);
      g.translate((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
      b.add(tint(g, STEEL, true), leafMat);
    };
    for (const [za, zb] of [[-th / 2 - 0.0012, -th / 2], [th / 2, th / 2 + 0.0012]] as const) {
      plate([sx0 + 0.02, yBot + 0.012, za], [sx1 - 0.02, yBot + 0.012 + 0.406, zb]);
      plate([w - 0.06 - 0.1, 1.0, za], [w - 0.06, 1.4, zb]);
    }
  }
  // The vision glass: a 6 mm pane in the leaf's mid-plane. Not the transmissive palette glass -
  // that would switch the transmission pass on (every opaque draw twice) at poses where no
  // window is in view. A blended dielectric pane instead (System 3's car glass): 6 % base
  // reflectance rising with Fresnel, the lit kitchen shows straight through the blend.
  {
    const g = new THREE.PlaneGeometry(vw - 0.012, vh - 0.012);
    g.translate(cx, vy, 0);
    const pane = makePaneGlass(0.06, 1.0);
    pane.transparent = true;
    pane.forceSinglePass = true; // one draw, not back + front passes
    pane.userData.noCast = true; // glass does not shadow the kitchen
    pane.name = "kitchenVisionGlass";
    b.add(g, pane);
  }
  b.build(hinge, { name: "kitchen-door" });
  parent.add(hinge);

  /* ---------------- the kitchen slice ---------------- */
  const zIn = zBack - T, zFar = zIn - KITCHEN_DEPTH;
  const kx0 = -ROOM.halfX, kx1 = x1 + 1.6; // the building's end wall continues; 1.6 m past the +x jamb
  const H = ROOM.height;
  const tileTop = 1.5;
  const wallTile = PRESENCE_UV.wallTile, quarry = PRESENCE_UV.quarry;
  const paint = pal.wallPaint;
  const tile = (a: readonly [number, number, number], c: readonly [number, number, number], n: THREE.Vector3) => s.add(tiledRect(a, c, n, WALL_TILE_CELL, wallTile), cloth);
  // Floor: quarry tile from the far wall through the opening to the dining floor's edge.
  s.add(tiledRect([kx0, 0, zFar], [kx1, 0, zIn], V3(0, 1, 0), QUARRY_CELL, quarry), cloth);
  s.add(tiledRect([x0 - 0.02, 0, zIn], [x1 + 0.02, 0, zBack], V3(0, 1, 0), QUARRY_CELL, quarry), cloth);
  // Walls: tile to 1.5 m, paint above; ceiling in the same paint.
  tile([kx0, 0, zFar], [kx1, tileTop, zFar], V3(0, 0, 1)); // far wall
  s.box(paint, [kx0, tileTop, zFar - 0.05], [kx1, H, zFar]);
  tile([kx0, 0, zFar], [kx0, tileTop, zIn], V3(1, 0, 0)); // -x wall
  s.box(paint, [kx0 - 0.05, tileTop, zFar], [kx0, H, zIn]);
  tile([kx1, 0, zFar], [kx1, tileTop, zIn], V3(-1, 0, 0)); // +x wall
  s.box(paint, [kx1, tileTop, zFar], [kx1 + 0.05, H, zIn]);
  s.box(paint, [kx0, H - 0.03, zFar], [kx1, H, zIn]); // ceiling
  // The partition's kitchen face either side of the door casing (KITCHEN_DOOR.jamb) and above it.
  const j = KITCHEN_DOOR.jamb, zFace = zIn - 0.0012; // 1.2 mm off the shell's cut face: no tie
  tile([kx0, 0, zFace], [x0 - j, tileTop, zFace], V3(0, 0, -1));
  tile([x1 + j, 0, zFace], [kx1, tileTop, zFace], V3(0, 0, -1));
  s.box(paint, [kx0, tileTop, zFace], [x0 - j, H, zIn]);
  s.box(paint, [x1 + j, tileTop, zFace], [kx1, H, zIn]);
  s.box(paint, [x0 - j, h + j, zFace], [x1 + j, H, zIn]);
  // Casing on the kitchen face (Shell.ts trims the dining side): the same 100 mm painted architrave.
  s.rbox(pal.trimPaint, [x0 - j, 0, zIn - 0.015], [x0, h + j, zIn], 0.002);
  s.rbox(pal.trimPaint, [x1, 0, zIn - 0.015], [x1 + j, h + j, zIn], 0.002);
  s.rbox(pal.trimPaint, [x0, h, zIn - 0.015], [x1, h + j, zIn], 0.002);

  // Prep table along the -x wall: 30 × 60 in stainless top with a 40 mm turned-down edge and a
  // 100 mm upstand at the wall, 1⅝" legs, an undershelf; on it a stack of sheet pans, a white
  // poly cutting board and a Cambro.
  {
    const ss = pal.stainless;
    const tx0 = kx0 + 0.02, tx1 = tx0 + 0.76, tz1 = zIn - 1.0, tz0 = tz1 - 1.52, top = 0.9;
    s.rbox(ss, [tx0, top - 0.04, tz0], [tx1, top, tz1], 0.004, 2);
    s.box(ss, [tx0, top, tz0], [tx0 + 0.02, top + 0.1, tz1]); // upstand
    for (const [lx, lz] of [[tx0 + 0.05, tz0 + 0.05], [tx1 - 0.05, tz0 + 0.05], [tx0 + 0.05, tz1 - 0.05], [tx1 - 0.05, tz1 - 0.05]]) {
      const leg = new THREE.CylinderGeometry(0.02, 0.02, top - 0.04, 16);
      leg.translate(lx, (top - 0.04) / 2, lz);
      s.add(leg, ss);
    }
    s.rbox(ss, [tx0 + 0.04, 0.25, tz0 + 0.04], [tx1 - 0.04, 0.28, tz1 - 0.04], 0.003);
    // Sheet pans (half size, 13 × 18 in), three stacked; a bus tub under the shelf.
    for (let i = 0; i < 3; i++) s.rbox(pal.stainless, [tx0 + 0.12, top + i * 0.02, tz0 + 0.1], [tx0 + 0.45, top + 0.025 + i * 0.02, tz0 + 0.56], 0.006, 2);
    s.rbox(pal.fixtureWhite, [tx0 + 0.2, top, tz1 - 0.6], [tx0 + 0.65, top + 0.015, tz1 - 0.15], 0.006, 2); // cutting board
    s.rbox(pal.fixtureWhite, [tx0 + 0.16, top + 0.015, tz1 - 0.5], [tx0 + 0.44, top + 0.165, tz1 - 0.32], 0.008, 2); // Cambro
    s.rbox(pal.blackPowder, [tx0 + 0.1, 0.28, tz0 + 0.3], [tx0 + 0.62, 0.43, tz0 + 0.86], 0.01, 2); // bus tub
    // Wall shelf over the table at 1.55 m, 300 deep, two brackets; #10 cans and a stack of bowls on it.
    const sy = 1.55;
    s.rbox(ss, [kx0 + 0.001, sy, tz0 + 0.1], [kx0 + 0.3, sy + 0.02, tz1 - 0.1], 0.003);
    s.box(ss, [kx0 + 0.001, sy - 0.02, tz0 + 0.1], [kx0 + 0.3, sy, tz0 + 0.13]);
    s.box(ss, [kx0 + 0.001, sy - 0.02, tz1 - 0.13], [kx0 + 0.3, sy, tz1 - 0.1]);
    for (const cz of [tz0 + 0.3, tz0 + 0.5, tz0 + 0.7]) {
      const can = new THREE.CylinderGeometry(0.0785, 0.0785, 0.178, 24);
      can.translate(kx0 + 0.15, sy + 0.02 + 0.089, cz);
      s.add(can, pal.stainless);
    }
    // Stainless mixing bowls, not ceramic: in the ceramic bucket their bounds stretched its sphere
    // from this shelf to booth 2's plate and it stopped culling at the spawn (+2 draws for nothing).
    for (let i = 0; i < 4; i++) {
      const bowl = lathe([V2(0, 0), V2(0.05, 0), V2(0.085, 0.045), V2(0.088, 0.05), V2(0.08, 0.048), V2(0.046, 0.004), V2(0, 0.004)], 32);
      bowl.translate(kx0 + 0.15, sy + 0.02 + i * 0.03, tz1 - 0.35);
      s.add(bowl, pal.stainless);
    }
  }
  // Fluorescent strip on the -x wall over the table at 1.95 m: a 4 ft vapour-tight housing with
  // its diffuser facing the room — the troffer lens material (a two-tube band of its map), so it
  // glows at the troffers' 4100 K luminance and reaches the probe / the vision glass.
  const lampZ = zIn - 1.76;
  {
    const fy = 1.95, fx = kx0 + 0.001;
    s.rbox(pal.fixtureWhite, [fx, fy - 0.07, lampZ - 0.62], [fx + 0.09, fy + 0.07, lampZ + 0.62], 0.008, 2);
    const lens = uvIntoRect(new THREE.PlaneGeometry(1.2, 0.1), [0, 0, 1, 1], [0.3, 0.72]);
    lens.rotateY(Math.PI / 2);
    lens.translate(fx + 0.0905, fy, lampZ);
    s.add(lens, pal.fixtureLens);
  }
  // Range under a stainless hood on the far wall (its -x end is what the door shows), the duct up.
  {
    const rx0 = kx0 + 0.15, rx1 = rx0 + 0.9;
    s.rbox(pal.blackPowder, [rx0, 0.1, zFar], [rx1, 0.9, zFar + 0.8], 0.006, 2);
    s.box(pal.blackPowder, [rx0 + 0.05, 0, zFar + 0.05], [rx1 - 0.05, 0.1, zFar + 0.75]);
    s.rbox(pal.stainless, [rx0 - 0.002, 0.9, zFar - 0.001], [rx1 + 0.002, 0.93, zFar + 0.8], 0.004, 2); // top
    s.rbox(pal.stainless, [rx0, 0.93, zFar], [rx1, 1.3, zFar + 0.08], 0.004, 2); // back riser
    for (let i = 0; i < 4; i++) {
      const knob = new THREE.CylinderGeometry(0.018, 0.02, 0.02, 16);
      knob.rotateX(Math.PI / 2);
      knob.translate(rx0 + 0.15 + i * 0.2, 0.86, zFar + 0.81);
      s.add(knob, pal.blackPlastic);
    }
    // Hood: canopy 1.5 m wide × 0.95 deep, bottom at 1.95, with a row of slanted baffle filters underneath.
    const hx0 = kx0 + 0.05, hx1 = hx0 + 1.5;
    s.rbox(pal.stainless, [hx0, 1.95, zFar], [hx1, 2.4, zFar + 0.95], 0.005, 2);
    s.box(pal.stainless, [hx0 + 0.5, 2.4, zFar + 0.25], [hx0 + 1.0, H, zFar + 0.75]); // duct
    for (let i = 0; i < 3; i++) {
      const baffle = new THREE.BoxGeometry(0.4, 0.5, 0.02);
      baffle.rotateX(THREE.MathUtils.degToRad(-50));
      baffle.translate(hx0 + 0.3 + i * 0.45, 2.15, zFar + 0.32);
      s.add(baffle, pal.stainless);
    }
  }
  // Wire shelving on the +x wall, chrome, with white bus tubs — the kitchen proper beyond.
  {
    const wx1 = kx1 - 0.02, wx0 = wx1 - 0.46, wz0 = zIn - 0.6, wz1 = wz0 - 1.2;
    for (const [px, pz] of [[wx0, wz0], [wx1, wz0], [wx0, wz1], [wx1, wz1]]) {
      const post = new THREE.CylinderGeometry(0.0125, 0.0125, 1.85, 12);
      post.translate(px, 0.925, pz);
      s.add(post, pal.chrome);
    }
    for (const y of [0.15, 0.6, 1.05, 1.5]) {
      s.rbox(pal.chrome, [wx0, y, wz1], [wx1, y + 0.035, wz0], 0.004, 1);
      s.rbox(pal.fixtureWhite, [wx0 + 0.03, y + 0.035, wz1 + 0.1], [wx1 - 0.03, y + 0.035 + 0.15, wz1 + 0.5], 0.008, 2);
      s.rbox(pal.fixtureWhite, [wx0 + 0.03, y + 0.035, wz0 - 0.55], [wx1 - 0.03, y + 0.035 + 0.15, wz0 - 0.1], 0.008, 2);
    }
  }

  // One shadowless 5000 K spot for the slice: 16,000 lm (four 2-lamp strips — a working
  // kitchen's 600+ lux) at the ceiling just inside the door header, aimed 43° down into the
  // kitchen. Its 46° cone covers the far wall, the floor, the table and the -x wall beside
  // the door (what the vision glass shows); its +z edge misses every dining-room point
  // (≥ 52° off-axis at the wall's foot, through the partition — there is no shadow map), so
  // no light pools on the dining floor. `distance` 6 m clips the rest.
  // Cooler than the dining room's FLUORESCENT (a 5000 K "daylight" tube against the 3500 K
  // troffers): the mixed-light cast through the doorway is what says "kitchen" in a photo.
  const KITCHEN_TUBE = new THREE.Color().setRGB(232 / 255, 241 / 255, 1, THREE.SRGBColorSpace);
  const light = new THREE.SpotLight(KITCHEN_TUBE, nits(16_000 / Math.PI), 6, THREE.MathUtils.degToRad(46), 0.35, 2);
  light.castShadow = false;
  light.name = "kitchen-fluorescent";
  light.position.set(kx0 + 0.3, H - 0.1, zIn - 0.2);
  light.target.position.set(kx0 + 0.3, 0.4, zIn - 2.45);
  parent.add(light, light.target);

  return {
    leaf: {
      hinge,
      sign: 1,
      focus: new THREE.Vector3((x0 + x1) / 2, 1.05, zBack),
      voice: new THREE.Vector3(x1 - 0.15, 1.0, zBack - 0.05),
      width: w,
    },
    light,
    material: leafMat,
  };
}
