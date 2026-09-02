/**
 * System 9 — implied presence. No figures: the things a person leaves in the
 * two minutes they are out of the room.
 *
 *   apron      the waitress's cotton-canvas waist apron on a chrome hook beside the
 *              pass-through jamb, gathered at the waistband, six pleats opening to the
 *              hem, a gaping patch pocket, two ties hanging past the hem
 *   cardigan   a rust knit cardigan dropped over the seat of the fifth stool: a mound
 *              over the cushion, a flap falling over the front edge in folds, one sleeve
 *              hanging to the footring with its ribbed cuff, three shell buttons
 *   plate      booth 2, aisle end: a plate with a toast crust, a dried yolk smear, a fork
 *              across the rim, a few crumbs; the folded newspaper beside it
 *   cup        a mug on a saucer at stool 3 with two centimetres of coffee left and a
 *              lipstick mark on the rim
 *
 * Every soft surface is a lofted grid (`loft`): catenary-ish pleats along one axis,
 * amplitude growing with the fall, so the folds read as cloth under gravity and not
 * as a wavy sheet. Cloth, paper and food share one atlas material (procedural/
 * presence.ts) — the only new bucket; everything else (ceramic, stainless, chrome,
 * coffee, vinyl for the lipstick) is appended to the scene's existing merged meshes
 * through the shared `statics` builder (core/mergeInto.ts) at no draw-call cost.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import type { MergedBuilder } from "../core/merge";
import type { TextureBank } from "../core/textureBank";
import * as presMod from "../procedural/presence";
import { PRESENCE_UV } from "../procedural/presence";
import { BOOTH, COUNTER, PASS_THROUGH, PROPS, ROOM, STOOL, WINDOW } from "./layout";

type UvRect = readonly [number, number, number, number];
const V2 = (x: number, y: number) => new THREE.Vector2(x, y);
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export interface PresenceResult {
  /** The atlas material (for the debug HUD / material counts). */
  material: THREE.MeshStandardMaterial;
  /** Where the props sit, for the `sys9-*` capture poses. */
  points: { apron: THREE.Vector3; cardigan: THREE.Vector3; plate: THREE.Vector3; cup: THREE.Vector3 };
}

export function buildPresence(statics: MergedBuilder, pal: Palette, bank?: TextureBank): PresenceResult {
  const pres = bank ? bank.proxy(presMod, "pres") : presMod;
  const set = pres.presenceAtlas(1024);
  const cloth = new THREE.MeshStandardMaterial({
    map: set.map,
    roughnessMap: set.roughnessMap,
    normalMap: set.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  cloth.name = "presence";

  const apron = buildApron(statics, pal, cloth);
  const cardigan = buildCardigan(statics, pal, cloth);
  const plate = buildPlateAndPaper(statics, pal, cloth);
  const cup = buildLipstickCup(statics, pal);
  return { material: cloth, points: { apron, cardigan, plate, cup } };
}

/* ------------------------------------------------------------------------------------ */
/* Lofts                                                                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * rows × cols grid surface. `P(t, s, out)` gives the point for t (0 top/start … 1) and
 * s (0 … 1 across); UVs fill `rect` (u along s, v along 1 − t). Indexed, smooth normals.
 */
function loft(rows: number, cols: number, P: (t: number, s: number, out: THREE.Vector3) => void, rect: UvRect, uvRepeat: [number, number] = [1, 1]): THREE.BufferGeometry {
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const p = new THREE.Vector3();
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const t = r / (rows - 1), s = c / (cols - 1);
      P(t, s, p);
      const i = r * cols + c;
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      // Repeats fold back and forth inside the region (no wrap across the atlas).
      const fu = tri(s * uvRepeat[0]), fv = tri((1 - t) * uvRepeat[1]);
      uv[i * 2] = rect[0] + fu * (rect[2] - rect[0]);
      uv[i * 2 + 1] = rect[1] + fv * (rect[3] - rect[1]);
    }
  const idx: number[] = [];
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Triangle wave 0..1..0 with period 2 (so a repeat of 3 gives 1.5 back-and-forth passes). */
function tri(x: number): number {
  const f = x % 2;
  return f <= 1 ? f : 2 - f;
}

/** Map a geometry's UVs into an atlas region by face orientation: caps (|n·axis| > 0.7) by their plane, sides into `edge`. */
function uvByNormal(g: THREE.BufferGeometry, axis: THREE.Vector3, cap: UvRect, edge: UvRect, capScale: number | [number, number]): void {
  const [scaleX, scaleY] = typeof capScale === "number" ? [capScale, capScale] : capScale;
  const pos = g.attributes.position, nrm = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const n = new THREE.Vector3(), p = new THREE.Vector3();
  const ex = new THREE.Vector3(), ey = new THREE.Vector3();
  // A basis in the cap plane.
  ex.set(1, 0, 0);
  if (Math.abs(axis.dot(ex)) > 0.9) ex.set(0, 0, 1);
  ex.sub(axis.clone().multiplyScalar(ex.dot(axis))).normalize();
  ey.crossVectors(axis, ex);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const c = bb.getCenter(new THREE.Vector3());
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nrm, i);
    p.fromBufferAttribute(pos, i).sub(c);
    if (Math.abs(n.dot(axis)) > 0.7) {
      const u = 0.5 + (p.dot(ex) / scaleX) * 0.5, v = 0.5 + (p.dot(ey) / scaleY) * 0.5;
      uv[i * 2] = cap[0] + Math.min(1, Math.max(0, u)) * (cap[2] - cap[0]);
      uv[i * 2 + 1] = cap[1] + Math.min(1, Math.max(0, v)) * (cap[3] - cap[1]);
    } else {
      const u = 0.5 + 0.5 * Math.sin(Math.atan2(p.dot(ey), p.dot(ex)) * 3);
      uv[i * 2] = edge[0] + u * (edge[2] - edge[0]);
      uv[i * 2 + 1] = edge[1] + (0.5 + p.dot(axis) * 20) * (edge[3] - edge[1]);
    }
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/* ------------------------------------------------------------------------------------ */
/* Apron                                                                                  */
/* ------------------------------------------------------------------------------------ */

function buildApron(s: MergedBuilder, pal: Palette, cloth: THREE.Material): THREE.Vector3 {
  // Hook on the wall strip between the pass-through jamb and the brewer, at 1.92 m.
  const wallZ = ROOM.zBack;
  const hx = PASS_THROUGH.centerX - PASS_THROUGH.width / 2 - PASS_THROUGH.jamb - 0.08; // ≈ −1.325
  const hy = 1.92;
  const R = PRESENCE_UV.cotton;

  // Chrome hook: a rose on the wall and a J-hook standing 40 mm out.
  const rose = new THREE.CylinderGeometry(0.018, 0.02, 0.006, 20);
  rose.rotateX(Math.PI / 2);
  rose.translate(hx, hy, wallZ + 0.003);
  s.add(rose, pal.chrome);
  const shank = new THREE.CylinderGeometry(0.005, 0.005, 0.045, 12);
  shank.rotateX(Math.PI / 2);
  shank.translate(hx, hy, wallZ + 0.0285);
  s.add(shank, pal.chrome);
  const hook = new THREE.TorusGeometry(0.014, 0.005, 10, 20, Math.PI);
  hook.rotateY(Math.PI / 2);
  hook.translate(hx, hy + 0.014, wallZ + 0.05);
  s.add(hook, pal.chrome);

  // Skirt: waistband gathered on the hook, 6 pleats opening toward the hem 0.44 m down. The
  // cloth falls nearly straight (a hung apron spreads only ~1.7×), heavier on the right
  // where the pocket is, so the hem is not a symmetric bell.
  const fall = 0.44, wTop = 0.13, wHem = 0.34;
  const skirt = (t: number, sx: number, out: THREE.Vector3, lift = 0) => {
    const w = wTop + (wHem - wTop) * Math.pow(smooth(t), 0.6);
    const x = hx + (sx - 0.5) * w + 0.035 * t * t - 0.012 * t * Math.sin(sx * Math.PI);
    // Pleats: six across, deepening with the fall; a finer gather at the band; hem swings out.
    const amp = 0.03 * Math.pow(t, 0.8);
    const gather = 0.006 * (1 - t) * Math.sin(sx * Math.PI * 16 + 0.3);
    const pleat = amp * (0.55 + 0.45 * Math.sin(sx * Math.PI * 6 + 0.4)) + amp * 0.35 * Math.sin(sx * Math.PI * 11 + 1.7) + amp * 0.5 * Math.sin(sx * Math.PI * 2.3 + 0.9);
    const z = wallZ + 0.055 + gather + pleat + 0.03 * t * t + lift;
    const y = hy - 0.012 - t * fall + 0.009 * t * Math.sin(sx * Math.PI * 6 + 0.4) - 0.012 * t * Math.sin(sx * Math.PI);
    out.set(x, y, z);
  };
  s.add(loft(28, 49, (t, sx, o) => skirt(t, sx, o), R), cloth);
  // Waistband: a doubled strip over the top 35 mm, 3 mm proud.
  s.add(loft(4, 49, (t, sx, o) => skirt(t * 0.08, sx, o, 0.003), R), cloth);
  // Patch pocket, right of centre, its mouth gaping 10 mm.
  s.add(
    loft(10, 14, (t, sx, o) => {
      const tt = 0.36 + t * 0.36, ss = 0.56 + sx * 0.33;
      const gape = 0.011 * (1 - t) * Math.sin(sx * Math.PI);
      skirt(tt, ss, o, 0.004 + gape);
    }, R),
    cloth,
  );
  // Ties: two 25 mm tapes from the hook, past the hem, with a lazy S.
  for (const side of [-1, 1]) {
    s.add(
      loft(22, 3, (t, sx, o) => {
        const x = hx + side * (0.075 + 0.02 * Math.sin(t * Math.PI * 1.4 + side)) + (sx - 0.5) * 0.025;
        const y = hy + 0.01 - t * 0.6;
        const z = wallZ + 0.03 + 0.006 * Math.sin(t * Math.PI * 3 + side) + 0.01 * t;
        o.set(x, y, z);
      }, R, [0.05, 1]),
      cloth,
    );
  }
  return new THREE.Vector3(hx, hy - 0.2, wallZ + 0.06);
}

/* ------------------------------------------------------------------------------------ */
/* Cardigan                                                                               */
/* ------------------------------------------------------------------------------------ */

function buildCardigan(s: MergedBuilder, pal: Palette, cloth: THREE.Material): THREE.Vector3 {
  const cx = STOOL.centersX[4], cz = STOOL.z;
  const top = STOOL.seatHeight;
  const seatR = STOOL.seatDiameter / 2;
  const R = PRESENCE_UV.knit;

  // A folded-over bundle on the cushion: low (a cardigan is 2–3 cm of knit), its outline
  // pushed out where the body is doubled and pulled in at the armholes, a collar roll
  // running across it, and the edge rolling over the cushion's welt.
  const outline = (a: number) => 1 + 0.1 * Math.sin(2 * a + 1.0) + 0.05 * Math.sin(5 * a + 0.4) - 0.06 * Math.max(0, Math.cos(a - 2.6));
  s.add(
    loft(12, 48, (t, sa, o) => {
      const a = sa * Math.PI * 2;
      const rMax = (seatR + 0.015) * outline(a);
      const r = t * rMax;
      const over = smooth((t - 0.86) / 0.14); // 0 on the cushion, 1 past the edge
      const q = r / (seatR * outline(a));
      const dome = 0.012 * (1 - q * q) + 0.02;
      // Collar roll: a ridge across the top, diagonal, 2 cm high, softened.
      const d = Math.abs((r * Math.cos(a - 0.5)) - 0.03);
      const roll = 0.018 * Math.exp(-(d * d) / (2 * 0.035 * 0.035)) * (1 - over);
      const wrinkle = 0.004 * Math.sin(a * 5 + r * 60) + 0.003 * Math.sin(a * 9 - r * 30);
      const y = top + dome + roll + wrinkle - over * 0.05;
      o.set(cx + r * Math.cos(a) * (1 + 0.06 * over), y, cz + r * Math.sin(a) * (1 + 0.06 * over));
    }, R, [2, 1]),
    cloth,
  );
  // Flap: the front falls over the +z / +x quadrant (seen from the aisle), buttons down its middle.
  const a0 = -0.15, a1 = 1.85;
  const flapR = (t: number, a: number) => (seatR + 0.015) * outline(a) + 0.012 * t + 0.02 * Math.pow(t, 0.8) * Math.sin(a * 7 + t * 2.5) + 0.006 * t * Math.sin(a * 13);
  const flapY = (t: number, a: number) => top - 0.015 - t * 0.26 + 0.01 * t * Math.sin(a * 7 + t * 2.5);
  s.add(
    loft(16, 30, (t, sa, o) => {
      const a = a0 + sa * (a1 - a0);
      const r = flapR(t, a);
      o.set(cx + r * Math.cos(a), flapY(t, a), cz + r * Math.sin(a));
    }, R, [1.5, 1]),
    cloth,
  );
  for (let i = 0; i < 3; i++) {
    const a = (a0 + a1) / 2 - 0.15;
    const t = 0.25 + i * 0.25;
    const r = flapR(t, a) + 0.003;
    const btn = new THREE.CylinderGeometry(0.007, 0.007, 0.0025, 14);
    btn.rotateZ(Math.PI / 2);
    btn.rotateY(-a);
    btn.translate(cx + r * Math.cos(a), flapY(t, a), cz + r * Math.sin(a));
    s.add(btn, pal.ceramic);
  }
  // Sleeve: a tube from the +x edge (beside the flap) to just above the footring, the cuff flared.
  const sa0 = -0.75;
  const sx0 = cx + (seatR + 0.005) * Math.cos(sa0), sz0 = cz + (seatR + 0.005) * Math.sin(sa0);
  s.add(
    loft(18, 18, (t, sa, o) => {
      const a = sa * Math.PI * 2;
      const cxT = sx0 + 0.04 * Math.sin(t * Math.PI * 0.9) + 0.02 * t;
      const czT = sz0 - 0.04 * Math.sin(t * Math.PI) - 0.02 * t;
      const cyT = top - 0.01 - t * 0.36;
      const cuff = smooth((t - 0.85) / 0.15);
      const rad = 0.047 - 0.012 * t + 0.008 * cuff + 0.003 * Math.sin(a * 3 + t * 9);
      const squash = 1 - 0.25 * (1 - t); // flattened where it leaves the seat
      o.set(cxT + rad * Math.cos(a), cyT + 0.004 * Math.sin(a * 2 + t * 6), czT + rad * squash * Math.sin(a));
    }, R, [1.5, 2]),
    cloth,
  );
  return new THREE.Vector3(cx, top + 0.05, cz);
}

/* ------------------------------------------------------------------------------------ */
/* Booth 2: plate, fork, crust, yolk, crumbs, newspaper                                    */
/* ------------------------------------------------------------------------------------ */

function buildPlateAndPaper(s: MergedBuilder, pal: Palette, cloth: THREE.Material): THREE.Vector3 {
  const bx = WINDOW.centersX[2];
  const tableTop = BOOTH.table.top;
  const px = bx - 0.14, pz = BOOTH.zInner + 0.4; // the −x bench's place, nearest the aisle (across from the sit pose)
  // Plate: 250 mm, shallow well, rolled rim.
  const plate = new THREE.LatheGeometry(
    [V2(0, 0.004), V2(0.07, 0.004), V2(0.078, 0.001), V2(0.084, 0), V2(0.09, 0.002), V2(0.1, 0.012), V2(0.12, 0.02), V2(0.126, 0.021), V2(0.125, 0.0225), V2(0.118, 0.0215), V2(0.098, 0.0135), V2(0.084, 0.007), V2(0.075, 0.0065), V2(0, 0.0065)],
    56,
  );
  plate.translate(px, tableTop, pz);
  s.add(plate, pal.ceramic);

  // Toast crust: the last quarter of a slice, bitten, standing on its crust edge against the rim.
  {
    const shape = new THREE.Shape();
    const ro = 0.052, ri = 0.03;
    shape.absarc(0, 0, ro, 0.1, 1.85, false);
    shape.absarc(0, 0, ri, 1.85, 0.1, true);
    shape.closePath();
    const crust = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 18 });
    uvByNormal(crust, new THREE.Vector3(0, 0, 1), PRESENCE_UV.toast, [PRESENCE_UV.toast[0], PRESENCE_UV.toast[1], PRESENCE_UV.toast[2], PRESENCE_UV.toast[1] + 0.04], 0.06);
    crust.rotateX(-Math.PI / 2); // lying flat, top up
    crust.rotateY(0.6);
    crust.rotateZ(0.12); // propped on the rim
    crust.translate(px - 0.035, tableTop + 0.008, pz - 0.02);
    s.add(crust, cloth);
  }
  // Dried yolk smear: an irregular blob 0.5 mm over the well, with a drag toward the crust.
  {
    const blob = new THREE.Shape();
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 0.028 * (1 + 0.28 * Math.sin(a * 3 + 0.5) + 0.14 * Math.sin(a * 5 + 2) + 0.35 * Math.max(0, Math.cos(a - 0.9)));
      const x = r * Math.cos(a), y = r * Math.sin(a) * 0.8;
      if (i === 0) blob.moveTo(x, y);
      else blob.lineTo(x, y);
    }
    const g = new THREE.ShapeGeometry(blob, 12);
    uvByNormal(g, new THREE.Vector3(0, 0, 1), PRESENCE_UV.yolk, PRESENCE_UV.yolk, 0.04);
    g.rotateX(-Math.PI / 2);
    g.translate(px + 0.025, tableTop + 0.0072, pz + 0.012);
    s.add(g, cloth);
  }
  // Fork across the rim, tines on the plate, handle on the table.
  {
    const handle = new THREE.BoxGeometry(0.1, 0.003, 0.018);
    handle.translate(0.05, 0, 0);
    const neck = new THREE.BoxGeometry(0.03, 0.0025, 0.012);
    neck.translate(-0.015, 0.001, 0);
    const head = new THREE.BoxGeometry(0.012, 0.0022, 0.024);
    head.translate(-0.036, 0.0015, 0);
    const parts = [handle, neck, head];
    for (let i = 0; i < 4; i++) {
      const tine = new THREE.BoxGeometry(0.048, 0.0018, 0.0028);
      tine.translate(-0.066, 0.0015, -0.0105 + i * 0.007);
      parts.push(tine);
    }
    for (const g of parts) {
      g.rotateZ(THREE.MathUtils.degToRad(6)); // handle up on the rim
      g.rotateY(-0.7);
      g.translate(px + 0.075, tableTop + 0.011, pz + 0.075);
      s.add(g, pal.stainless);
    }
  }
  // Crumbs: toast-textured specks on the plate and two on the table.
  {
    const spots: Array<[number, number, number]> = [[px + 0.01, tableTop + 0.0065, pz - 0.045], [px + 0.05, tableTop + 0.0065, pz - 0.03], [px - 0.06, tableTop + 0.0065, pz + 0.04], [px + 0.16, tableTop, pz + 0.02], [px + 0.2, tableTop, pz - 0.06], [px - 0.01, tableTop + 0.0065, pz + 0.05]];
    spots.forEach(([x, y, z], i) => {
      const g = new THREE.BoxGeometry(0.004 + 0.002 * (i % 3), 0.002, 0.003 + 0.002 * ((i + 1) % 3));
      uvByNormal(g, new THREE.Vector3(0, 1, 0), PRESENCE_UV.toast, PRESENCE_UV.toast, 0.01);
      g.rotateY(i * 1.1);
      g.translate(x, y + 0.001, z);
      s.add(g, cloth);
    });
  }
  // Newspaper: a tabloid folded in half, three thicknesses, dropped at a slight angle.
  {
    const nx = bx - 0.1, nz = BOOTH.zInner + 0.8;
    const yaw = THREE.MathUtils.degToRad(-14);
    const page = PRESENCE_UV.newsprint;
    const edge: UvRect = [page[0], page[1] + 0.01, page[0] + 0.012, page[1] + 0.02]; // blank paper margin
    const layers: Array<[number, number, number, number]> = [
      [0.3, 0.2, 0.008, 0],
      [0.298, 0.196, 0.006, 0.008],
      [0.296, 0.192, 0.005, 0.014],
    ];
    layers.forEach(([w, d, h, y0], i) => {
      const g = new THREE.BoxGeometry(w, h, d);
      // The front page fills the region: u along the 300 mm, v along the 200 mm (masthead at −z).
      uvByNormal(g, new THREE.Vector3(0, 1, 0), page, edge, [w / 2, d / 2]);
      g.translate(0.003 * i, y0 + h / 2, -0.004 * i);
      g.rotateY(yaw + 0.02 * i);
      g.translate(nx, tableTop, nz);
      s.add(g, cloth);
    });
    // The fold: a half-round along the −x long edge, the paper's own thickness.
    const fold = new THREE.CylinderGeometry(0.0095, 0.0095, 0.2, 12, 1, false, 0, Math.PI);
    fold.rotateX(Math.PI / 2);
    fold.rotateY(Math.PI / 2);
    uvByNormal(fold, new THREE.Vector3(1, 0, 0), edge, edge, 0.1);
    fold.translate(-0.15, 0.0095, 0);
    fold.rotateY(yaw);
    fold.translate(nx, tableTop, nz);
    s.add(fold, cloth);
  }
  return new THREE.Vector3(px - 0.05, tableTop + 0.02, pz + 0.05);
}

/* ------------------------------------------------------------------------------------ */
/* Lipstick cup                                                                           */
/* ------------------------------------------------------------------------------------ */

function buildLipstickCup(s: MergedBuilder, pal: Palette): THREE.Vector3 {
  const x = STOOL.centersX[2], z = PROPS.saucerZ, y = COUNTER.height;
  const saucer = new THREE.LatheGeometry(
    [V2(0, 0.003), V2(0.03, 0.003), V2(0.033, 0), V2(0.045, 0), V2(0.05, 0.005), V2(0.072, 0.014), V2(0.078, 0.018), V2(0.074, 0.019), V2(0.052, 0.011), V2(0.042, 0.008), V2(0, 0.008)],
    40,
  );
  saucer.translate(x, y, z);
  s.add(saucer, pal.ceramic);
  const my = y + 0.009;
  const body = new THREE.LatheGeometry(
    [
      V2(0, 0.003), V2(0.031, 0.003), V2(0.036, 0.006), V2(0.04, 0.014), V2(0.041, 0.024), V2(0.0395, 0.038), V2(0.0385, 0.05), V2(0.039, 0.062), V2(0.0405, 0.074), V2(0.041, 0.082),
      V2(0.0405, 0.0875), V2(0.0385, 0.089), V2(0.0355, 0.089), V2(0.034, 0.0875), V2(0.0335, 0.084), V2(0.0325, 0.072), V2(0.0315, 0.05), V2(0.032, 0.03), V2(0.03, 0.016), V2(0.026, 0.013), V2(0, 0.013),
    ],
    48,
  );
  const handle = new THREE.TorusGeometry(0.019, 0.0075, 12, 28, 1.2 * Math.PI);
  handle.rotateZ(-0.6 * Math.PI);
  handle.scale(1, 1.25, 1);
  handle.translate(0.052, 0.048, 0);
  const yaw = 2.4; // handle away from the counter edge, to the right hand
  for (const g of [body, handle]) {
    g.rotateY(yaw);
    g.translate(x, my, z);
    s.add(g, pal.ceramic);
  }
  const foot = new THREE.LatheGeometry([V2(0.024, 0.0002), V2(0.026, 0), V2(0.031, 0), V2(0.0315, 0.003), V2(0.0235, 0.003), V2(0.024, 0.0002)], 40);
  foot.translate(x, my, z);
  s.add(foot, pal.bisque);
  // Two centimetres of coffee left, gone still.
  const coffee = new THREE.CircleGeometry(0.0318, 40);
  coffee.rotateX(-Math.PI / 2);
  coffee.translate(x, my + 0.033, z);
  s.add(coffee, pal.coffee);
  // Lipstick: a crescent on the rim opposite the handle, on the outer lip, 1.8 mm thick.
  const mark = new THREE.TorusGeometry(0.0378, 0.0024, 6, 18, 0.7);
  mark.scale(1, 0.5, 1); // flattened onto the rim
  mark.rotateX(-Math.PI / 2);
  mark.rotateY(yaw + Math.PI - 0.27);
  mark.translate(x, my + 0.0885, z);
  s.add(mark, pal.vinylRed);
  return new THREE.Vector3(x, my + 0.05, z);
}
