/**
 * fix-rear: the building's back-of-house and its side elevation.
 *
 * Shell.ts's kitchen partition used to back onto a BackSide black box 3.4 m deep ("kitchen
 * void") that was never enclosed: from the lot the player saw an open black crate with the
 * lit kitchen slice floating in it. This module closes the footprint with a real kitchen box
 * — rear wall + end-wall continuations in the shell's stucco, the same roof slab (Shell.ts
 * extends it), a concrete base course all round — and dresses it like a roadside diner's
 * back and side: steel service door on a step, hood vent cap with its grease streak, barred
 * frosted windows, hose bibs, downspouts with scuppers and splash blocks, the electrical
 * service (meter, panel, riser, weatherhead and the drop to the road's utility pole),
 * a wall condenser on brackets, a dryer vent, a weathered ghost sign, tide-line grime and
 * patched cracks; on the roof a packaged HVAC unit on a curb with its line set and conduit
 * down the wall, vent stacks and the kitchen's mushroom exhaust fan; on the ground a walkway
 * strip, a gravel service strip, a CMU dumpster enclosure with steel gates round the
 * dumpster on its stained pad, milk crates, a mop bucket, a propane cage, pallets and a
 * scooter.
 *
 * Lighting: everything here is in the `diner` group like the shell's own outer skins
 * (`wallPaintExt`, `concrete`), so it takes the interior sun split (the spot + its PCSS
 * shadow map: the building's own shadow falls on these walls and props, and the −x wall is
 * in the building's shade) and the lot probe as ambient (`envMaterials` → Diner.ts). The
 * lot sun's map stops at the sidewalk and has no building casters, so exterior-group props
 * on the shaded side would have been sunlit against a shaded wall. Nothing here moves:
 * shadow-once covers it. `BUILDING` (layout.ts) is the box the sun cone should contain.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder, type Collider, type V3 } from "../core/merge";
import type { TextureBank } from "../core/textureBank";
import * as extModule from "../procedural/exterior";
import * as texModule from "../procedural/textures";
import { punchedWall, type Opening } from "./Shell";
import { BUILDING, REAR, ROOM } from "./layout";

export interface RearResult {
  colliders: Collider[];
  /** Outdoor materials: Diner.ts hands them the lot probe. */
  envMaterials: THREE.MeshStandardMaterial[];
}

const yLot = -0.27; // Exterior.ts LOT.y
const yApron = -0.12;

/* ---------------- small canvas helpers (main thread; each is tiny) ---------------- */
function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
/** Grey-alpha streak running DOWN from the top centre: a drip / grease run. */
function streakAlpha(w: number, h: number, seed: number, spread: number): THREE.CanvasTexture {
  return canvasTex(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w - 0.5, v = y / h;
      const width = spread * (0.35 + 0.65 * v) * (0.8 + 0.4 * hash(seed, Math.floor(y / 6)));
      const core = Math.max(0, 1 - Math.abs(u) / width);
      const fade = Math.pow(1 - v, 0.6) * (0.7 + 0.3 * hash(Math.floor(x / 3) + seed, Math.floor(y / 3)));
      const a = Math.pow(core, 1.6) * fade;
      const o = (y * w + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = Math.min(255, a * 255);
    }
    ctx.putImageData(img, 0, 0);
  });
}
/** Splash grime along a wall's foot: dark at the bottom, ragged top edge. */
function tideAlpha(w: number, h: number, seed: number): THREE.CanvasTexture {
  return canvasTex(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = 1 - y / h; // v 0 at the bottom
      const ragged = 0.55 + 0.35 * (hash(Math.floor(u * 40) + seed, 1) * 0.5 + hash(Math.floor(u * 9) + seed, 2) * 0.5);
      const a = Math.max(0, 1 - v / ragged) * (0.75 + 0.25 * hash(Math.floor(x / 2), Math.floor(y / 2) + seed));
      const o = (y * w + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = Math.min(255, Math.pow(a, 1.4) * 255);
    }
    ctx.putImageData(img, 0, 0);
  });
}
/** Weathered painted lettering: alpha carries the paint that is left (erosion by noise). */
function ghostSign(w: number, h: number, lines: string[], seed: number): { map: THREE.CanvasTexture; alphaMap: THREE.CanvasTexture } {
  const map = canvasTex(w, h, (ctx) => {
    ctx.fillStyle = "#b9352a"; ctx.fillRect(0, 0, w, h); // sign red, faded
    ctx.fillStyle = "#efe6d2";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    lines.forEach((s, i) => {
      ctx.font = `bold ${Math.floor(h / lines.length * 0.62)}px Impact, "Arial Narrow", sans-serif`;
      ctx.fillText(s, w / 2, (h / lines.length) * (i + 0.5), w * 0.92);
    });
  });
  const alphaMap = canvasTex(w, h, (ctx) => {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    lines.forEach((s, i) => {
      ctx.font = `bold ${Math.floor(h / lines.length * 0.62)}px Impact, "Arial Narrow", sans-serif`;
      ctx.fillText(s, w / 2, (h / lines.length) * (i + 0.5), w * 0.92);
    });
    // erosion: two scales of noise thin the paint everywhere and eat it away in patches
    const img = ctx.getImageData(0, 0, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (!img.data[o]) continue;
      const n1 = hash(Math.floor(x / 5) + seed, Math.floor(y / 5)), n2 = hash(Math.floor(x / 23) + seed * 3, Math.floor(y / 23));
      const runs = hash(Math.floor(x / 2) + seed * 7, 0.3); // vertical rain wash streaks
      let a = 0.5 * (0.55 + 0.45 * n1) * (0.4 + 0.6 * n2) * (0.7 + 0.3 * runs);
      if (n2 < 0.18) a *= 0.2;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.min(255, a * 255);
    }
    ctx.putImageData(img, 0, 0);
  });
  alphaMap.colorSpace = THREE.NoColorSpace;
  return { map, alphaMap };
}

export function buildRear(diner: THREE.Group, pal: Palette, bank?: TextureBank): RearResult {
  const ext = bank ? bank.proxy(extModule, "ext") : extModule;
  const tex = bank ? bank.proxy(texModule, "tex") : texModule;
  const group = new THREE.Group();
  group.name = "rear";
  diner.add(group);
  const b = new MergedBuilder();
  const env: THREE.MeshStandardMaterial[] = [];
  const outdoor = <M extends THREE.MeshStandardMaterial>(m: M, name: string): M => { m.name = name; env.push(m); return m; };

  const { halfX, height: H, wallThickness: T, zFront, zBack, slabDrop } = ROOM;
  const yLow = -slabDrop;
  const zIn = zBack - T, zFar = REAR.zFar, zOut = REAR.zOuter;
  const xW = -halfX - T, xE = halfX + T; // exterior faces of the end walls
  const roof = BUILDING.roof;
  const uv = { uvScale: 2 };
  const stucco = pal.wallPaintExt;

  /* ---------------- materials ---------------- */
  const concrete = outdoor(pal.concrete.clone(), "concreteRear"); // own material: the shell's `concrete` is a lot-sun receiver
  const cmuTex = ext.blockWall(1024, 3390);
  cmuTex.map.repeat.set(1 / 3.2, 1 / 0.8); cmuTex.roughnessMap.repeat.copy(cmuTex.map.repeat);
  const cmu = outdoor(new THREE.MeshStandardMaterial({ map: cmuTex.map, roughnessMap: cmuTex.roughnessMap, roughness: 1, metalness: 0 }), "cmuRear");
  const cap = outdoor(new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.85, metalness: 0 }), "cmuCap");
  const gravelTex = ext.desertDirt(512, 3391);
  gravelTex.wrapS = gravelTex.wrapT = THREE.RepeatWrapping;
  gravelTex.repeat.set(12, 1.5);
  const gravel = outdoor(new THREE.MeshStandardMaterial({ map: gravelTex, color: 0x8f8a80, roughness: 1, metalness: 0 }), "gravel");
  const galv = outdoor(new THREE.MeshStandardMaterial({ color: 0x9a9d9c, roughness: 0.42, metalness: 0.75 }), "galvanized");
  const galvDull = outdoor(new THREE.MeshStandardMaterial({ color: 0x7e8280, roughness: 0.6, metalness: 0.7 }), "galvDull");
  const doorPaint = outdoor(new THREE.MeshStandardMaterial({ color: 0x4b524a, roughness: 0.55, metalness: 0.1 }), "doorPaint"); // hollow-metal door, sage-grey enamel
  const frameBrown = outdoor(new THREE.MeshStandardMaterial({ color: 0x5a4e42, roughness: 0.6, metalness: 0.1 }), "frameBronze");
  const black = outdoor(new THREE.MeshStandardMaterial({ color: 0x1b1b1a, roughness: 0.7, metalness: 0.3 }), "blackIron");
  const dumpsterGreen = outdoor(new THREE.MeshStandardMaterial({ color: 0x2f4a33, roughness: 0.62, metalness: 0.25 }), "dumpsterGreen");
  const dumpsterLid = outdoor(new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 0.8, metalness: 0 }), "dumpsterLid");
  const rust = outdoor(new THREE.MeshStandardMaterial({ color: 0x6b3d22, roughness: 0.95, metalness: 0.1 }), "rust");
  const grey = outdoor(new THREE.MeshStandardMaterial({ color: 0x8a8d8c, roughness: 0.5, metalness: 0.4 }), "utilityGrey"); // meter base / panel / disconnect
  const hvacBeige = outdoor(new THREE.MeshStandardMaterial({ color: 0xb6b1a3, roughness: 0.5, metalness: 0.35 }), "hvacCabinet");
  const hvacDark = outdoor(new THREE.MeshStandardMaterial({ color: 0x2c2c2b, roughness: 0.7, metalness: 0.3 }), "hvacGrille");
  const abs = outdoor(new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.55, metalness: 0 }), "absPipe");
  const frosted = outdoor(new THREE.MeshStandardMaterial({ color: 0xc9d1d3, roughness: 0.32, metalness: 0, emissive: 0x2a2f31, emissiveIntensity: 0.4 }), "frostedGlass");
  const meterGlass = outdoor(new THREE.MeshStandardMaterial({ color: 0xd4dadc, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.55 }), "meterGlass");
  const stainlessOut = outdoor(new THREE.MeshStandardMaterial({ color: 0xc9ccce, roughness: 0.35, metalness: 0.9 }), "stainlessRear");
  const brass = outdoor(new THREE.MeshStandardMaterial({ color: 0xa08442, roughness: 0.45, metalness: 0.85 }), "brass");
  const crateBlue = outdoor(new THREE.MeshStandardMaterial({ color: 0x1e3a78, roughness: 0.75, metalness: 0 }), "crate");
  const bucketYellow = outdoor(new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.7, metalness: 0 }), "mopBucket");
  const wood = outdoor(new THREE.MeshStandardMaterial({ color: 0x9d8a6b, roughness: 0.95, metalness: 0 }), "palletWood");
  const cage = outdoor(new THREE.MeshStandardMaterial({ color: 0xb9bcbc, roughness: 0.45, metalness: 0.7 }), "cage");
  const propane = outdoor(new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.5, metalness: 0.2 }), "propaneTank");
  const scooterRed = outdoor(new THREE.MeshStandardMaterial({ color: 0x8a1f1a, roughness: 0.4, metalness: 0.3 }), "scooter");
  const tyre = outdoor(new THREE.MeshStandardMaterial({ color: 0x1a1a19, roughness: 0.9, metalness: 0 }), "scooterTyre");
  const patch = outdoor(new THREE.MeshStandardMaterial({ color: 0xbdb3a0, roughness: 0.95, metalness: 0 }), "stuccoPatch");
  const kp = tex.kickPlateWear(512, 128, 0.9, 0.2, 131, 0.5);
  const kick = outdoor(new THREE.MeshStandardMaterial({ map: kp.map, roughnessMap: kp.roughnessMap, roughness: 1, metalness: 0.9 }), "kickRear");
  const stain = (alpha: THREE.Texture, opacity: number, color = 0x14110d) => {
    const m = new THREE.MeshBasicMaterial({ color, alphaMap: alpha, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    m.userData.noCast = true;
    return m;
  };
  const greaseMat = stain(streakAlpha(64, 256, 3, 0.35), 0.7, 0x120e08);
  const dripMat = stain(streakAlpha(64, 256, 11, 0.28), 0.45, 0x2b2620);
  const tideMat = stain(tideAlpha(1024, 128, 5), 0.5, 0x2a241c);
  const padStainMat = stain(streakAlpha(256, 256, 17, 0.9), 0.55, 0x0f0c08);

  /* ---------------- helpers ---------------- */
  const cyl = (mat: THREE.Material, r0: number, r1: number, h: number, seg: number, at: V3, rot?: [number, number, number]) => {
    const g = new THREE.CylinderGeometry(r0, r1, h, seg);
    if (rot) { g.rotateX(rot[0]); g.rotateY(rot[1]); g.rotateZ(rot[2]); }
    g.translate(at[0], at[1], at[2]);
    b.add(g, mat);
  };
  const lathe = (mat: THREE.Material, pts: Array<[number, number]>, seg: number, at: V3) => {
    const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
    g.translate(at[0], at[1], at[2]);
    b.add(g, mat);
  };
  /** Decal plane on a wall face; `n` is the face normal (±x or ±z), offset 1.5 mm proud. */
  const decal = (mat: THREE.Material, w: number, h: number, center: V3, n: "x-" | "x+" | "z-" | "z+", proud = 0.0015) => {
    const g = new THREE.PlaneGeometry(w, h);
    if (n === "x-") { g.rotateY(-Math.PI / 2); g.translate(center[0] - proud, center[1], center[2]); }
    else if (n === "x+") { g.rotateY(Math.PI / 2); g.translate(center[0] + proud, center[1], center[2]); }
    else if (n === "z-") { g.rotateY(Math.PI); g.translate(center[0], center[1], center[2] - proud); }
    else g.translate(center[0], center[1], center[2] + proud);
    b.add(g, mat);
  };
  /** Louvre grille: `n` slanted blades in a frame, on a −x or −z face. */
  const louvres = (mat: THREE.Material, x0: number, y0: number, z0: number, w: number, h: number, face: "x-" | "z-", frame = 0.02) => {
    const d = 0.02;
    if (face === "z-") {
      b.rbox(mat, [x0, y0, z0 - 0.03], [x0 + w, y0 + frame, z0], 0.002);
      b.rbox(mat, [x0, y0 + h - frame, z0 - 0.03], [x0 + w, y0 + h, z0], 0.002);
      b.rbox(mat, [x0, y0, z0 - 0.03], [x0 + frame, y0 + h, z0], 0.002);
      b.rbox(mat, [x0 + w - frame, y0, z0 - 0.03], [x0 + w, y0 + h, z0], 0.002);
      for (let y = y0 + frame + 0.02; y < y0 + h - frame - 0.01; y += 0.03) {
        const g = new THREE.BoxGeometry(w - 2 * frame - 0.004, 0.003, 0.03);
        g.rotateX(THREE.MathUtils.degToRad(40));
        g.translate(x0 + w / 2, y, z0 - 0.014);
        b.add(g, mat);
      }
      b.box(hvacDark, [x0 + frame, y0 + frame, z0 - 0.002], [x0 + w - frame, y0 + h - frame, z0 + 0.03 - d]);
    } else {
      b.rbox(mat, [x0 - 0.03, y0, z0], [x0, y0 + frame, z0 + w], 0.002);
      b.rbox(mat, [x0 - 0.03, y0 + h - frame, z0], [x0, y0 + h, z0 + w], 0.002);
      b.rbox(mat, [x0 - 0.03, y0, z0], [x0, y0 + h, z0 + frame], 0.002);
      b.rbox(mat, [x0 - 0.03, y0, z0 + w - frame], [x0, y0 + h, z0 + w], 0.002);
      for (let y = y0 + frame + 0.02; y < y0 + h - frame - 0.01; y += 0.03) {
        const g = new THREE.BoxGeometry(0.03, 0.003, w - 2 * frame - 0.004);
        g.rotateZ(THREE.MathUtils.degToRad(-40));
        g.translate(x0 - 0.014, y, z0 + w / 2);
        b.add(g, mat);
      }
      b.box(hvacDark, [x0 - 0.002, y0 + frame, z0 + frame], [x0 + 0.03 - d, y0 + h - frame, z0 + w - frame]);
    }
  };

  /* =====================================================================================
   * 1. The kitchen box shell: rear wall, end-wall continuations, base course
   * ===================================================================================== */
  const door = REAR.door;
  const rearOpenings: Opening[] = [
    { a0: door.x0, a1: door.x1, y0: yLow, y1: door.height },
    { a0: -1.3, a1: -0.7, y0: 1.7, y1: 2.3 }, // barred frosted window
  ];
  punchedWall(xW, xE, yLow, H, rearOpenings, (x0, x1, y0, y1) => {
    b.box(stucco, [x0, y0, zOut], [x1, y1, zFar], uv);
  });
  b.collider([xW, 0, zOut], [xE, H, zFar]);
  // End walls continue from the partition line to the rear face.
  b.box(stucco, [xW, yLow, zOut], [xW + T, H, zIn + 0.001], uv);
  b.box(stucco, [xE - T, yLow, zOut], [xE, H, zIn + 0.001], uv);
  b.collider([xW, 0, zOut], [xW + T, H, zIn]);
  b.collider([xE - T, 0, zOut], [xE, H, zIn]);
  // Nothing inside the box is ever seen: the slice (Openables.ts) and the pass-through box
  // (Shell.ts) are sealed rooms, and the door / window openings are filled below.
  // Concrete base course, 12 mm proud, from the dirt (yLot − 0.05) to 300 mm, round the three
  // outdoor walls (the front has its apron slab). It closes the gap between the shell's slab
  // line (−0.15) and the desert plane (−0.31).
  const cb = 0.012, cy0 = yLot - 0.05, cy1 = 0.3;
  b.rbox(concrete, [xW - cb, cy0, zOut - cb], [xE + cb, cy1, zOut], 0.004, 2, { metric: true });
  b.rbox(concrete, [xW - cb, cy0, zOut - cb], [xW, cy1, zFront + T], 0.004, 2, { metric: true });
  b.rbox(concrete, [xE, cy0, zOut - cb], [xE + cb, cy1, zFront + T], 0.004, 2, { metric: true });
  // Stucco below the shell's slab line down to the base course top is covered by the course;
  // the rear/end walls themselves start at yLow, so nothing shows behind it.

  /* =====================================================================================
   * 2. Rear wall dressing (faces −z; things are proud toward −z)
   * ===================================================================================== */
  {
    // Steel service door: hollow-metal frame filling the reveal, flush leaf 45 mm with a 4 mm
    // reveal, 16" kick plate, lever + deadbolt, a closer on the head, a 150 mm concrete step.
    const { x0, x1, height: h } = door;
    const j = 0.05, fz0 = zOut - 0.01, fz1 = zFar + 0.01;
    b.rbox(doorPaint, [x0, yLow, fz0], [x0 + j, h, fz1], 0.002);
    b.rbox(doorPaint, [x1 - j, yLow, fz0], [x1, h, fz1], 0.002);
    b.rbox(doorPaint, [x0 + j, h - j, fz0], [x1 - j, h, fz1], 0.002);
    const lt = 0.045, lz0 = zOut + T / 2 - lt / 2, lz1 = lz0 + lt; // leaf in the frame's mid-depth
    const lx0 = x0 + j + 0.004, lx1 = x1 - j - 0.004;
    b.rbox(doorPaint, [lx0, 0.012, lz0], [lx1, h - j - 0.004, lz1], 0.003);
    // stop on the exterior side (the leaf swings in), 16 mm
    b.box(doorPaint, [x0 + j, 0.02, lz0 - 0.016], [x0 + j + 0.016, h - j, lz0]);
    b.box(doorPaint, [x1 - j - 0.016, 0.02, lz0 - 0.016], [x1 - j, h - j, lz0]);
    b.box(doorPaint, [x0 + j, h - j - 0.016, lz0 - 0.016], [x1 - j, h - j, lz0]);
    // kick plate 1.5 mm proud, 0.7 mm radius
    b.rbox(kick, [lx0 + 0.02, 0.03, lz0 - 0.0015], [lx1 - 0.02, 0.03 + 0.406, lz0], 0.0007, 2);
    // lever handle + rose + deadbolt at 1.0 / 1.15 m on the +x (latch) side
    cyl(galv, 0.03, 0.03, 0.01, 20, [lx1 - 0.07, 1.0, lz0 - 0.005], [Math.PI / 2, 0, 0]);
    cyl(galv, 0.011, 0.011, 0.06, 12, [lx1 - 0.07, 1.0, lz0 - 0.035], [Math.PI / 2, 0, 0]);
    b.rbox(galv, [lx1 - 0.19, 0.99, lz0 - 0.072], [lx1 - 0.07, 1.01, lz0 - 0.052], 0.006, 2);
    cyl(galv, 0.02, 0.02, 0.012, 16, [lx1 - 0.07, 1.16, lz0 - 0.006], [Math.PI / 2, 0, 0]);
    // closer body on the head (exterior)
    b.rbox(black, [x0 + j + 0.1, h - j - 0.08, lz0 - 0.06], [x0 + j + 0.36, h - j - 0.02, lz0 - 0.005], 0.003);
    // concrete step: 150 mm rise from the base-course line to the sill
    b.rbox(concrete, [x0 - 0.15, cy0, zOut - 0.45], [x1 + 0.15, -0.005, zOut + 0.02], 0.006, 2, { metric: true });
    // grate mat on the step
    b.box(black, [x0 + 0.05, -0.005, zOut - 0.4], [x1 - 0.05, 0.007, zOut - 0.05]);
    // light over the door: a jelly-jar wall pack on a round box
    cyl(black, 0.06, 0.06, 0.02, 20, [(x0 + x1) / 2, h + 0.25, zOut - 0.01], [Math.PI / 2, 0, 0]);
    cyl(black, 0.02, 0.05, 0.05, 16, [(x0 + x1) / 2, h + 0.19, zOut - 0.06]);
    lathe(frosted, [[0, 0], [0.035, 0], [0.04, 0.03], [0.04, 0.12], [0.03, 0.14], [0, 0.145]], 20, [(x0 + x1) / 2, h + 0.02, zOut - 0.06]);
    // cigarette butts on the step, by the jamb
    for (let i = 0; i < 6; i++) {
      const g = new THREE.CylinderGeometry(0.004, 0.004, 0.028, 8);
      g.rotateZ(Math.PI / 2); g.rotateY(hash(i, 1) * Math.PI);
      g.translate(x1 + 0.05 + hash(i, 2) * 0.25, -0.001, zOut - 0.08 - hash(i, 3) * 0.3);
      b.add(g, pal.fixtureWhite);
    }

    // Hood exhaust vent cap on the wall with its grease streak (the hood's duct also goes up to
    // the roof fan; this is the make-up-air / dishwasher exhaust cap): a hooded louvre 400 × 400.
    louvres(galvDull, -5.2, 2.35, zOut, 0.4, 0.4, "z-");
    b.rbox(galvDull, [-5.22, 2.75, zOut - 0.12], [-4.78, 2.78, zOut], 0.003); // hood top
    decal(greaseMat, 0.5, 1.4, [-5.0, 1.6, zOut], "z-");

    // Hose bib: ½" brass sillcock on a stub, escutcheon, wheel handle; a hose coiled below.
    cyl(galv, 0.02, 0.02, 0.006, 16, [-4.2, 0.5, zOut - 0.003], [Math.PI / 2, 0, 0]);
    cyl(brass, 0.011, 0.011, 0.09, 12, [-4.2, 0.5, zOut - 0.045], [Math.PI / 2, 0, 0]);
    cyl(brass, 0.016, 0.016, 0.03, 12, [-4.2, 0.485, zOut - 0.085], [0, 0, 0]);
    lathe(brass, [[0, 0], [0.02, 0], [0.025, 0.004], [0.012, 0.006], [0.008, 0.02], [0.012, 0.024], [0, 0.026]], 12, [-4.2, 0.52, zOut - 0.075]);
    cyl(pal.fixtureWhite, 0.02, 0.02, 0.03, 12, [-4.2, 0.485, zOut - 0.11], [0, 0, 0]);
    {
      const hose = new THREE.TorusGeometry(0.22, 0.011, 8, 40);
      hose.rotateX(Math.PI / 2); hose.translate(-4.35, yLot + 0.02, zOut - 0.35);
      b.add(hose, dumpsterGreen);
    }

    // Barred frosted window (restroom / storage): the opening is punched; painted frame lines
    // the reveal, frosted pane 100 mm in, 5 vertical bars Ø 12 on two flats, 40 mm proud.
    const [wx0, wx1, wy0, wy1] = [-1.3, -0.7, 1.7, 2.3];
    const fr = 0.04;
    b.rbox(frameBrown, [wx0, wy0, zOut - 0.005], [wx0 + fr, wy1, zOut + 0.12], 0.002);
    b.rbox(frameBrown, [wx1 - fr, wy0, zOut - 0.005], [wx1, wy1, zOut + 0.12], 0.002);
    b.rbox(frameBrown, [wx0, wy1 - fr, zOut - 0.005], [wx1, wy1, zOut + 0.12], 0.002);
    b.rbox(frameBrown, [wx0, wy0, zOut - 0.005], [wx1, wy0 + fr, zOut + 0.12], 0.002);
    b.box(frosted, [wx0 + fr, wy0 + fr, zOut + 0.1], [wx1 - fr, wy1 - fr, zOut + 0.106]);
    b.box(pal.voidBlack, [wx0 + 0.01, wy0 + 0.01, zOut + 0.11], [wx1 - 0.01, wy1 - 0.01, zFar - 0.02]);
    b.rbox(concrete, [wx0 - 0.03, wy0 - 0.03, zOut - 0.035], [wx1 + 0.03, wy0, zOut], 0.004, 2, { metric: true }); // sill
    for (const fy of [wy0 + 0.1, wy1 - 0.1]) b.rbox(black, [wx0 - 0.02, fy - 0.015, zOut - 0.045], [wx1 + 0.02, fy + 0.015, zOut - 0.03], 0.002);
    for (let i = 0; i < 5; i++) cyl(black, 0.006, 0.006, wy1 - wy0 + 0.04, 10, [wx0 + 0.05 + i * (wx1 - wx0 - 0.1) / 4, (wy0 + wy1) / 2, zOut - 0.0375]);

    // Tide line of splash grime along the foot of the rear wall (over the base course + stucco)
    decal(tideMat, xE - xW - 0.1, 0.55, [(xW + xE) / 2, cy0 + 0.275 + 0.02, zOut - cb], "z-", 0.002);
    decal(tideMat, xE - xW - 0.1, 0.45, [(xW + xE) / 2, cy1 + 0.2, zOut], "z-", 0.002);
  }

  /* =====================================================================================
   * 3. The −x side elevation (faces −x; things are proud toward −x). The road view.
   * ===================================================================================== */
  const sideZ0 = zOut, sideZ1 = zFront + T;
  {
    // Downspouts: 3 × 4 in rectangular galvanized from a conductor head under a parapet scupper
    // to a 45° kick-out elbow over a splash block; straps every 1.2 m.
    const downspout = (z: number) => {
      const w = 0.075, d = 0.1;
      const x1 = xW - 0.02, x0 = x1 - d;
      b.rbox(galv, [x0, 0.42, z - w / 2], [x1, H - 0.4, z + w / 2], 0.006, 2);
      // conductor head under the roof slab's overhang (the fascia is 0.2 m proud of the wall),
      // fed by a scupper spout through the fascia; its open top is a dark slot.
      b.rbox(galv, [xW - 0.2, H - 0.4, z - 0.15], [xW - 0.02, H - 0.08, z + 0.15], 0.006, 2);
      b.box(black, [xW - 0.19, H - 0.081, z - 0.14], [xW - 0.03, H - 0.079, z + 0.14]);
      b.rbox(galv, [xW - 0.3, H + 0.03, z - 0.1], [xW - 0.19, H + 0.11, z + 0.1], 0.004); // scupper spout out of the fascia
      // kick-out elbow: 45° stub aiming away from the wall
      {
        const g = new THREE.BoxGeometry(d, 0.32, w);
        g.rotateZ(THREE.MathUtils.degToRad(35));
        g.translate(x0 - 0.06, 0.3, z);
        b.add(g, galv);
        const g2 = new THREE.BoxGeometry(d + 0.004, 0.06, w + 0.004);
        g2.rotateZ(THREE.MathUtils.degToRad(35));
        g2.translate(x0 - 0.135, 0.19, z);
        b.add(g2, galv);
      }
      for (const y of [1.0, 2.2, 3.1]) b.rbox(galvDull, [x0 - 0.004, y, z - w / 2 - 0.02], [x1 + 0.03, y + 0.025, z + w / 2 + 0.02], 0.002);
      // splash block: a concrete wedge trough on the walkway
      {
        const sh = new THREE.Shape();
        sh.moveTo(0, 0); sh.lineTo(0.6, 0); sh.lineTo(0.6, 0.035); sh.lineTo(0, 0.08); sh.closePath();
        const g = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
        g.computeVertexNormals();
        g.rotateY(Math.PI); // extrude along −z → profile runs −x
        g.translate(x0 - 0.05, yApron, z + 0.15);
        b.add(g, concrete);
      }
    };
    downspout(sideZ1 - 0.35);
    downspout(sideZ0 + 0.35);

    // Electrical service at z 1.6–2.3: meter base with its glass dome, panel beside it, riser
    // conduit up through a weatherhead 0.9 m above the roof; the drop is drawn later (needs
    // the utility pole). A disconnect for the rooftop unit hangs under its conduit.
    const mz = 1.65;
    b.rbox(grey, [xW - 0.12, 1.4, mz - 0.11], [xW, 1.75, mz + 0.11], 0.006, 2);
    {
      const dome = new THREE.SphereGeometry(0.075, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.rotateZ(Math.PI / 2); // the +y cap → points −x, out of the meter base
      dome.translate(xW - 0.12, 1.6, mz);
      b.add(dome, meterGlass);
      cyl(grey, 0.085, 0.085, 0.02, 24, [xW - 0.13, 1.6, mz], [0, 0, Math.PI / 2]); // its ring
    }
    b.rbox(grey, [xW - 0.1, 0.95, mz + 0.2], [xW, 1.65, mz + 0.56], 0.006, 2); // panel
    b.box(hvacDark, [xW - 0.101, 1.0, mz + 0.24], [xW - 0.1, 1.6, mz + 0.52]); // door shadow line
    b.rbox(galv, [xW - 0.07, 1.75, mz - 0.03], [xW - 0.01, roof + 0.9, mz + 0.03], 0.01, 3); // riser Ø 60
    cyl(galv, 0.03, 0.03, 0.025, 16, [xW - 0.04, roof + 0.9, mz]);
    lathe(galv, [[0, 0], [0.045, 0], [0.05, 0.01], [0.035, 0.1], [0, 0.11]], 16, [xW - 0.04, roof + 0.9, mz]); // weatherhead
    b.rbox(galv, [xW - 0.07, 1.2, mz + 0.05], [xW - 0.01, 1.35, mz + 0.2], 0.008, 2); // meter → panel nipple
    for (const y of [2.2, 2.9]) b.rbox(galvDull, [xW - 0.08, y, mz - 0.045], [xW + 0.001, y + 0.03, mz + 0.045], 0.002); // straps
    b.rbox(grey, [xW - 0.09, 1.55, mz + 0.62], [xW, 1.85, mz + 0.84], 0.005, 2); // disconnect
    b.rbox(galv, [xW - 0.05, 1.85, mz + 0.71], [xW - 0.02, roof + 0.02, mz + 0.74], 0.006, 2); // its conduit up over the parapet

    // Hose bib on the side wall too, low by the walkway.
    cyl(brass, 0.011, 0.011, 0.09, 12, [xW - 0.045, 0.45, 0.7], [0, 0, Math.PI / 2]);
    lathe(brass, [[0, 0], [0.02, 0], [0.025, 0.004], [0.012, 0.006], [0.008, 0.02], [0.012, 0.024], [0, 0.026]], 12, [xW - 0.075, 0.47, 0.7]);
    cyl(galv, 0.02, 0.02, 0.006, 16, [xW - 0.003, 0.45, 0.7], [0, 0, Math.PI / 2]);

    // Restroom window: block frame proud of the stucco, frosted lite, bars.
    {
      const z0 = 0.35, z1 = 0.95, y0 = 1.8, y1 = 2.3, fr = 0.045, px = 0.06;
      b.rbox(frameBrown, [xW - px, y0, z0], [xW + 0.001, y1, z0 + fr], 0.003);
      b.rbox(frameBrown, [xW - px, y0, z1 - fr], [xW + 0.001, y1, z1], 0.003);
      b.rbox(frameBrown, [xW - px, y1 - fr, z0], [xW + 0.001, y1, z1], 0.003);
      b.rbox(frameBrown, [xW - px, y0, z0], [xW + 0.001, y0 + fr, z1], 0.003);
      b.box(frosted, [xW - 0.025, y0 + fr, z0 + fr], [xW - 0.019, y1 - fr, z1 - fr]);
      b.rbox(concrete, [xW - 0.09, y0 - 0.035, z0 - 0.03], [xW, y0, z1 + 0.03], 0.004, 2, { metric: true });
      for (const fy of [y0 + 0.08, y1 - 0.08]) b.rbox(black, [xW - px - 0.03, fy - 0.015, z0 - 0.02], [xW - px - 0.015, fy + 0.015, z1 + 0.02], 0.002);
      for (let i = 0; i < 5; i++) cyl(black, 0.006, 0.006, y1 - y0 + 0.04, 10, [xW - px - 0.0225, (y0 + y1) / 2, z0 + 0.05 + i * (z1 - z0 - 0.1) / 4]);
    }

    // Wall condenser on two angle brackets, fan grille facing out, drip stain below.
    {
      const z0 = -4.6, z1 = -3.8, y0 = 2.15, y1 = 2.7, d = 0.3;
      b.rbox(hvacBeige, [xW - 0.1 - d, y0, z0], [xW - 0.1, y1, z1], 0.008, 2);
      for (const z of [z0 + 0.1, z1 - 0.1]) {
        b.rbox(black, [xW - 0.1 - d - 0.02, y0 - 0.04, z - 0.02], [xW, y0, z + 0.02], 0.003);
        b.rbox(black, [xW - 0.03, y0 - 0.04, z - 0.02], [xW, y0 + 0.35, z + 0.02], 0.003);
      }
      cyl(hvacDark, 0.2, 0.2, 0.01, 32, [xW - 0.1 - d - 0.004, (y0 + y1) / 2, z0 + 0.28], [0, 0, Math.PI / 2]);
      for (let i = 0; i < 12; i++) { // fan guard ribs
        const g = new THREE.TorusGeometry(0.03 + i * 0.015, 0.0015, 6, 40);
        g.rotateY(Math.PI / 2); g.translate(xW - 0.1 - d - 0.012, (y0 + y1) / 2, z0 + 0.28);
        b.add(g, galv);
      }
      louvres(hvacBeige, xW - 0.1 - d + 0.03, y0 + 0.06, z0 + 0.52, 0.24, 0.42, "x-", 0.015);
      decal(dripMat, 0.5, 1.9, [xW, 1.15, z0 + 0.28], "x-");
      // line set + drain from the unit into the wall (a sleeve)
      b.rbox(galvDull, [xW - 0.06, y0 + 0.1, z1 - 0.06], [xW, y0 + 0.2, z1 + 0.04], 0.004);
    }

    // Dryer / exhaust vent grille, small and hooded.
    louvres(galvDull, xW, 2.35, -5.75, 0.3, 0.3, "x-");
    b.rbox(galvDull, [xW - 0.1, 2.65, -5.77], [xW, 2.68, -5.43], 0.003);

    // Ghost sign on the upper wall facing the road: 30–40 % of the paint left.
    {
      const sign = ghostSign(1024, 256, ["AIR CONDITIONED", "GOOD FOOD  ·  EAT"], 9);
      const m = outdoor(new THREE.MeshStandardMaterial({ map: sign.map, alphaMap: sign.alphaMap, transparent: true, roughness: 0.9, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), "ghostSign");
      m.userData.noCast = true;
      decal(m, 3.8, 0.95, [xW, 2.4, -1.5], "x-", 0.001);
    }

    // Tide line grime along the foot of the side wall: over the base course, and on the stucco
    // above it (its own plane, on the stucco face).
    decal(tideMat, sideZ1 - sideZ0 - 0.1, 0.55, [xW - cb, cy0 + 0.275 + 0.02, (sideZ0 + sideZ1) / 2], "x-", 0.002);
    decal(tideMat, sideZ1 - sideZ0 - 0.1, 0.45, [xW, cy1 + 0.2, (sideZ0 + sideZ1) / 2], "x-", 0.002);

    // Patched cracks: two diagonal skim patches, 1 mm proud, a shade off the stucco.
    for (const [z, y, len, ang] of [[-2.9, 1.1, 1.3, 68], [2.6, 0.9, 0.9, 105]] as const) {
      const g = new THREE.BoxGeometry(0.002, len, 0.035);
      g.rotateX(THREE.MathUtils.degToRad(ang));
      g.translate(xW - 0.0012, y, z);
      b.add(g, patch);
    }
  }

  /* =====================================================================================
   * 4. Rooftop: packaged HVAC on a curb, line set + conduit down the wall, vent stacks,
   *    the kitchen's mushroom exhaust fan (over the hood duct).
   * ===================================================================================== */
  {
    // RTU: curb 2.1 × 1.3 × 0.35 (galv), cabinet 2.0 × 1.0 × 1.2 grey-beige with panel seams,
    // condenser section at the −z end: top fan grille (ring + guard + hub), louvred coil
    // panels on both long sides; supply/return hood at the +z end.
    const cx = -2.4, cz = 1.9, x0 = cx - 1.0, x1 = cx + 1.0, z0 = cz - 0.6, z1 = cz + 0.6;
    b.rbox(galv, [x0 - 0.05, roof, z0 - 0.05], [x1 + 0.05, roof + 0.35, z1 + 0.05], 0.006, 2);
    const y0 = roof + 0.35, y1 = y0 + 1.15;
    b.rbox(hvacBeige, [x0, y0, z0], [x1, y1, z1], 0.012, 3);
    // panel seams + latches
    for (const x of [x0 + 0.7, x0 + 1.35]) b.box(hvacDark, [x - 0.002, y0 + 0.05, z0 - 0.001], [x + 0.002, y1 - 0.05, z1 + 0.001]);
    b.box(hvacDark, [x0 - 0.001, y0 + 0.55, z0 + 0.05], [x1 + 0.001, y0 + 0.554, z1 - 0.05]);
    // condenser fan on top, −z half: raised ring, wire guard as concentric tori + spokes, hub
    {
      const fx = x0 + 0.5, fz = cz;
      const ring = new THREE.TorusGeometry(0.36, 0.03, 10, 48);
      ring.rotateX(Math.PI / 2); ring.translate(fx, y1 + 0.02, fz);
      b.add(ring, hvacBeige);
      cyl(hvacDark, 0.34, 0.34, 0.01, 40, [fx, y1 - 0.06, fz]); // the dark well
      for (let i = 1; i <= 7; i++) {
        const t = new THREE.TorusGeometry(0.05 * i, 0.002, 6, 48);
        t.rotateX(Math.PI / 2); t.translate(fx, y1 + 0.02, fz);
        b.add(t, galv);
      }
      for (let i = 0; i < 8; i++) {
        const g = new THREE.BoxGeometry(0.72, 0.004, 0.006);
        g.rotateY((i / 8) * Math.PI); g.translate(fx, y1 + 0.022, fz);
        b.add(g, galv);
      }
      cyl(hvacDark, 0.06, 0.06, 0.04, 20, [fx, y1 + 0.0, fz]);
      for (let i = 0; i < 4; i++) { // blades, under the guard
        const g = new THREE.BoxGeometry(0.26, 0.004, 0.09);
        g.rotateX(0.5); g.rotateY((i / 4) * Math.PI * 2); g.translate(fx + Math.cos((i / 4) * Math.PI * 2) * 0.18, y1 - 0.03, fz + Math.sin((i / 4) * Math.PI * 2) * 0.18);
        b.add(g, hvacDark);
      }
    }
    louvres(hvacBeige, x0 + 0.08, y0 + 0.15, z0, 0.85, 0.75, "z-", 0.02);
    louvres(hvacBeige, x0 - 0.0, y0 + 0.15, z0 + 0.08, 0.9, 0.75, "x-", 0.02);
    // supply/return duct hood at the +z end, and a rain hood on the economiser
    b.rbox(hvacBeige, [x1 - 0.5, y0 + 0.3, z1], [x1 - 0.1, y0 + 0.9, z1 + 0.35], 0.01, 2);
    b.rbox(galv, [x1 - 0.55, y0 + 0.9, z1 - 0.02], [x1 - 0.05, y0 + 0.95, z1 + 0.42], 0.006, 2);
    // Line set (two insulated tubes) + conduit: cabinet → along the roof → over the parapet →
    // down the −x wall to the disconnect at z 2.4 (built above).
    const runZ = 2.36;
    for (const [dz, r, mat] of [[-0.04, 0.02, abs], [0.02, 0.014, abs], [0.075, 0.012, galv]] as Array<[number, number, THREE.Material]>) {
      const y = roof + 0.06 + r;
      cyl(mat, r, r, x0 - xW - 0.1, 12, [(x0 + xW - 0.1) / 2, y, runZ + dz], [0, 0, Math.PI / 2]);
      cyl(mat, r, r, 0.25, 12, [x0 - 0.1, y + 0.12, runZ + dz]); // riser out of the cabinet
      cyl(mat, r, r, roof - 1.85 + 0.02, 12, [xW - 0.05, (roof + 0.02 + 1.85) / 2, runZ + dz]); // down the wall
    }
    for (let x = x0 - 0.5; x > xW + 0.2; x -= 0.9) b.rbox(galvDull, [x - 0.02, roof, runZ - 0.08], [x + 0.02, roof + 0.1, runZ + 0.11], 0.003); // pipe stands
    // Vent stacks: Ø 75 ABS in a boot flashing, 0.6 m tall
    for (const [vx, vz] of [[-4.6, -4.0], [-0.8, -5.8], [3.2, -1.0]]) {
      lathe(galvDull, [[0, 0], [0.16, 0], [0.16, 0.01], [0.06, 0.12], [0.045, 0.14], [0.045, 0.2], [0, 0.2]], 20, [vx, roof, vz]);
      cyl(abs, 0.038, 0.038, 0.62, 16, [vx, roof + 0.3, vz]);
    }
    // Kitchen exhaust: upblast mushroom fan on a curb over the hood's duct (Openables.ts hood at x −5.05..−3.55, duct centre ≈ −4.3, z ≈ −6.55)
    {
      const fx = -4.3, fz = -6.55;
      b.rbox(galv, [fx - 0.4, roof, fz - 0.4], [fx + 0.4, roof + 0.3, fz + 0.4], 0.006, 2);
      lathe(galv, [[0, 0], [0.42, 0], [0.42, 0.04], [0.3, 0.3], [0.3, 0.36], [0, 0.36]], 32, [fx, roof + 0.3, fz]); // base cone / venturi
      lathe(galv, [[0, 0], [0.5, 0], [0.5, 0.03], [0.44, 0.1], [0.3, 0.2], [0.14, 0.26], [0, 0.28]], 32, [fx, roof + 0.66, fz]); // domed shroud
      b.box(black, [fx - 0.34, roof + 0.62, fz - 0.34], [fx + 0.34, roof + 0.66, fz + 0.34]); // the dark gap under the dome
      // grease streak down the curb and on the roof deck round it
      cyl(hvacDark, 0.55, 0.55, 0.003, 32, [fx, roof + 0.0015, fz]);
    }
  }

  /* =====================================================================================
   * 5. Ground: walkway along the side, gravel strip at the back, the dumpster enclosure
   *    and the rest of the service yard.
   * ===================================================================================== */
  {
    // Concrete walkway 1.0 m along the −x wall, level with the front sidewalk (−0.12).
    b.rbox(concrete, [xW - 1.0, yLot - 0.05, zOut - 0.3], [xW, yApron, zFront + T], 0.006, 2, { metric: true });
    // Gravel strip 1.4 m along the rear wall, 2 cm over the desert plane.
    {
      const g = new THREE.PlaneGeometry(xE - xW + 1.0, 1.4);
      g.rotateX(-Math.PI / 2);
      g.translate((xW + xE) / 2, yLot - 0.02, zOut - 0.7);
      b.add(g, gravel);
    }
    // Dumpster enclosure at the −x rear corner: three CMU walls 1.65 m high with a cap course,
    // steel gates on the +x side (one leaf swung open), a broom-finish pad with a grease stain.
    const ex0 = xW - 0.2, ex1 = -4.0, ez0 = -9.6, ez1 = zOut - 0.3;
    b.rbox(concrete, [ex0, yLot - 0.05, ez0], [ex1 + 0.6, yApron, ez1 + 0.3], 0.004, 2, { metric: true }); // pad
    const wt = 0.2, wh = 1.65;
    b.box(cmu, [ex0, yApron - 0.05, ez0], [ex1, yApron + wh, ez0 + wt], { metric: true }); // back
    b.box(cmu, [ex0, yApron - 0.05, ez0], [ex0 + wt, yApron + wh, ez1], { metric: true }); // −x side
    b.box(cmu, [ex0, yApron - 0.05, ez1 - wt], [ex1, yApron + wh, ez1], { metric: true }); // building side (a return, off the stucco)
    for (const [a, c] of [[[ex0 - 0.025, ez0 - 0.025], [ex1 + 0.025, ez0 + wt + 0.025]], [[ex0 - 0.025, ez0], [ex0 + wt + 0.025, ez1 + 0.025]], [[ex0, ez1 - wt - 0.025], [ex1 + 0.025, ez1 + 0.025]]] as Array<[[number, number], [number, number]]>) {
      b.rbox(cap, [a[0], yApron + wh, a[1]], [c[0], yApron + wh + 0.09, c[1]], 0.01, 2);
    }
    b.collider([ex0, 0, ez0], [ex1, wh, ez0 + wt]);
    b.collider([ex0, 0, ez0], [ex0 + wt, wh, ez1]);
    b.collider([ex0, 0, ez1 - wt], [ex1, wh, ez1]);
    // steel gate posts + two frame-and-sheet leaves (angle frame, corrugated-look sheet as
    // a bevelled panel); the near leaf stands open at 80°.
    const gateOpen = (ez1 - wt) - (ez0 + wt);
    for (const z of [ez0 + wt, ez1 - wt]) cyl(black, 0.045, 0.045, wh + 0.1, 16, [ex1 - 0.05, yApron + (wh + 0.1) / 2, z]);
    const leaf = (hingeZ: number, dir: 1 | -1, angle: number) => {
      const L = gateOpen / 2 - 0.05, g = new MergedBuilder();
      const m = new THREE.Matrix4().makeRotationY(angle).setPosition(ex1 - 0.05, 0, hingeZ);
      const geo = (min: V3, max: V3, mat: THREE.Material, r = 0.003) => { g.rbox(mat, min, max, r); };
      // local: hinge at origin, leaf runs along +z*dir, faces ±x
      const z0 = dir > 0 ? 0.05 : -L - 0.05, z1 = dir > 0 ? L + 0.05 : -0.05;
      geo([-0.02, yApron + 0.1, z0], [0.02, yApron + 0.14, z1], black); // bottom rail
      geo([-0.02, yApron + wh - 0.1, z0], [0.02, yApron + wh - 0.06, z1], black); // top rail
      geo([-0.02, yApron + 0.1, z0], [0.02, yApron + wh - 0.06, z0 + 0.04], black);
      geo([-0.02, yApron + 0.1, z1 - 0.04], [0.02, yApron + wh - 0.06, z1], black);
      geo([-0.004, yApron + 0.14, z0 + 0.04], [0.004, yApron + wh - 0.1, z1 - 0.04], galvDull, 0.001); // sheet
      for (const gg of (g as unknown as { buckets: Map<THREE.Material, THREE.BufferGeometry[]> }).buckets) for (const geom of gg[1]) b.add(geom, gg[0], m);
    };
    leaf(ez0 + wt, 1, 0);
    leaf(ez1 - wt, -1, THREE.MathUtils.degToRad(-80));
    // Dumpster: 2-yard front-load, 1.8 × 1.2 × 1.3, sloped front, two hinged lids (closed), fork
    // pockets each side, casters, rust on the pockets and the lower seams.
    {
      const dx0 = ex0 + 0.45, dx1 = dx0 + 1.8, dz0 = ez0 + wt + 0.3, dz1 = dz0 + 1.2, dy0 = yApron + 0.14, dy1 = dy0 + 1.2;
      b.rbox(dumpsterGreen, [dx0, dy0, dz0], [dx1, dy1, dz1], 0.012, 2);
      b.collider([dx0 - 0.15, 0, dz0], [dx1 + 0.15, dy1, dz1]);
      // sloped front (toward +z / the gates? the front faces +x: the loading side)
      for (const z of [dz0 + 0.15, dz1 - 0.15]) {
        b.rbox(rust, [dx0 - 0.02, dy0 + 0.35, z - 0.09], [dx1 + 0.02, dy0 + 0.55, z + 0.09], 0.006, 2); // fork pockets through the body
      }
      // lids: two, 45 mm, black poly, a lip along the front edge, on a piano hinge at the back
      for (const [a, c] of [[dx0 + 0.01, (dx0 + dx1) / 2 - 0.01], [(dx0 + dx1) / 2 + 0.01, dx1 - 0.01]]) {
        b.rbox(dumpsterLid, [a, dy1, dz0 - 0.03], [c, dy1 + 0.045, dz1 + 0.03], 0.012, 2);
        b.rbox(dumpsterLid, [a, dy1 + 0.045, dz1 - 0.02], [c, dy1 + 0.07, dz1 + 0.03], 0.006, 2); // lip
      }
      cyl(galvDull, 0.012, 0.012, dx1 - dx0 - 0.02, 10, [(dx0 + dx1) / 2, dy1 + 0.02, dz0 - 0.03], [0, 0, Math.PI / 2]); // hinge pin
      // casters
      for (const [x, z] of [[dx0 + 0.15, dz0 + 0.15], [dx1 - 0.15, dz0 + 0.15], [dx0 + 0.15, dz1 - 0.15], [dx1 - 0.15, dz1 - 0.15]]) {
        cyl(black, 0.06, 0.06, 0.04, 16, [x, yApron + 0.06, z], [0, 0, Math.PI / 2]);
        b.box(black, [x - 0.03, yApron + 0.06, z - 0.05], [x + 0.03, dy0, z + 0.05]);
      }
      // rust streaks under the pockets and a rust band at the floor seam
      b.box(rust, [dx0 + 0.005, dy0 + 0.005, dz0 - 0.001], [dx1 - 0.005, dy0 + 0.05, dz0 + 0.002]);
      b.box(rust, [dx0 + 0.005, dy0 + 0.005, dz1 - 0.002], [dx1 - 0.005, dy0 + 0.06, dz1 + 0.001]);
      // grease stain on the pad in front of the dumpster and under it
      {
        const g = new THREE.PlaneGeometry(2.2, 1.6);
        g.rotateX(-Math.PI / 2); g.rotateY(0.3); g.translate((dx0 + dx1) / 2 + 0.3, yApron + 0.002, dz1 + 0.2);
        b.add(g, padStainMat);
      }
    }
    // Milk crates: three stacked by the service door, one on its side; open lattice sides.
    {
      const crate = (x: number, y: number, z: number, rot: number) => {
        const s = 0.33, h = 0.28, g = new MergedBuilder(), m = new THREE.Matrix4().makeRotationY(rot).setPosition(x, y, z);
        g.rbox(crateBlue, [-s / 2, 0, -s / 2], [s / 2, 0.012, s / 2], 0.003); // floor
        for (const [a, c] of [[-s / 2, -s / 2 + 0.012], [s / 2 - 0.012, s / 2]]) {
          g.rbox(crateBlue, [a, 0, -s / 2], [c, 0.05, s / 2], 0.002); g.rbox(crateBlue, [a, h - 0.03, -s / 2], [c, h, s / 2], 0.002);
          g.rbox(crateBlue, [-s / 2, 0, a], [s / 2, 0.05, c], 0.002); g.rbox(crateBlue, [-s / 2, h - 0.03, a], [s / 2, h, c], 0.002);
          for (let k = 0; k < 6; k++) { const p = -s / 2 + 0.03 + k * (s - 0.06) / 5; g.box(crateBlue, [a, 0.05, p - 0.006], [c, h - 0.03, p + 0.006]); g.box(crateBlue, [p - 0.006, 0.05, a], [p + 0.006, h - 0.03, c]); }
        }
        for (const gg of (g as unknown as { buckets: Map<THREE.Material, THREE.BufferGeometry[]> }).buckets) for (const geom of gg[1]) b.add(geom, gg[0], m);
      };
      const cx = door.x1 + 0.55, cz = zOut - 0.35;
      crate(cx, yLot - 0.02, cz, 0.1); crate(cx, yLot + 0.26, cz, -0.15); crate(cx, yLot + 0.54, cz, 0.3);
      crate(cx + 0.45, yLot - 0.02, cz - 0.2, 0.7);
      b.collider([cx - 0.4, 0, cz - 0.45], [cx + 0.7, 0.9, cz + 0.2]);
    }
    // Mop bucket with wringer, mop leaning on the wall by the door.
    {
      const mx = door.x0 - 0.45, mz = zOut - 0.35;
      lathe(bucketYellow, [[0, 0], [0.19, 0], [0.2, 0.01], [0.2, 0.42], [0.21, 0.44], [0.19, 0.44], [0.18, 0.02], [0, 0.02]], 28, [mx, yLot - 0.02, mz]);
      b.rbox(bucketYellow, [mx - 0.12, yLot + 0.44, mz - 0.14], [mx + 0.12, yLot + 0.66, mz + 0.14], 0.008, 2); // wringer
      b.rbox(galvDull, [mx - 0.02, yLot + 0.66, mz - 0.14], [mx + 0.25, yLot + 0.68, mz - 0.11], 0.004); // handle
      const mop = new THREE.CylinderGeometry(0.012, 0.012, 1.45, 10);
      mop.rotateX(0.18); mop.translate(mx + 0.3, yLot + 0.75, zOut - 0.12);
      b.add(mop, wood);
      lathe(pal.fixtureWhite, [[0, 0], [0.06, 0], [0.09, 0.12], [0.05, 0.2], [0, 0.2]], 14, [mx + 0.3, yLot + 1.42, zOut - 0.25]);
      b.collider([mx - 0.22, 0, mz - 0.22], [mx + 0.22, 0.7, mz + 0.22]);
    }
    // Propane exchange cage: a mesh cage of expanded metal on a frame, four 20 lb tanks inside.
    {
      const px0 = door.x1 + 1.4, px1 = px0 + 0.9, pz0 = zOut - 0.85, pz1 = zOut - 0.15, py0 = yLot - 0.02, py1 = py0 + 1.35;
      for (const [x, z] of [[px0, pz0], [px1, pz0], [px0, pz1], [px1, pz1]]) b.rbox(cage, [x - 0.015, py0, z - 0.015], [x + 0.015, py1, z + 0.015], 0.003);
      b.rbox(cage, [px0, py1 - 0.03, pz0], [px1, py1, pz1], 0.003);
      b.rbox(cage, [px0, py0 + 0.03, pz0], [px1, py0 + 0.06, pz1], 0.003);
      const meshMat = new THREE.MeshStandardMaterial({ color: 0x6f7372, roughness: 0.5, metalness: 0.6, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
      meshMat.userData.noCast = true; outdoor(meshMat, "cageMesh");
      for (const [a, c] of [[[px0, py0 + 0.06, pz0], [px1, py1 - 0.03, pz0 + 0.001]], [[px0, py0 + 0.06, pz1], [px1, py1 - 0.03, pz1 + 0.001]], [[px0, py0 + 0.06, pz0], [px0 + 0.001, py1 - 0.03, pz1]], [[px1, py0 + 0.06, pz0], [px1 + 0.001, py1 - 0.03, pz1]]] as Array<[V3, V3]>) b.box(meshMat, a, c);
      for (let i = 0; i < 4; i++) {
        const tx = px0 + 0.22 + (i % 2) * 0.46, tz = pz0 + 0.2 + Math.floor(i / 2) * 0.32;
        lathe(propane, [[0, 0], [0.1, 0], [0.155, 0.05], [0.155, 0.35], [0.1, 0.42], [0.07, 0.43], [0.07, 0.5], [0, 0.5]], 20, [tx, py0 + 0.06, tz]);
      }
      b.collider([px0, 0, pz0], [px1, py1, pz1]);
    }
    // Pallets: two stacked against the rear wall past the propane cage.
    {
      const x0 = door.x1 + 2.6, z0 = zOut - 1.1;
      for (let s = 0; s < 2; s++) {
        const y = yLot - 0.02 + s * 0.145;
        for (const dz of [0, 0.4, 0.8]) b.rbox(wood, [x0, y, z0 + dz], [x0 + 1.2, y + 0.09, z0 + dz + 0.1], 0.003);
        for (let k = 0; k < 7; k++) b.rbox(wood, [x0 + k * 0.17, y + 0.09, z0], [x0 + k * 0.17 + 0.1, y + 0.12, z0 + 0.9], 0.002);
      }
      b.collider([x0, 0, z0], [x0 + 1.2, 0.3, z0 + 0.9]);
    }
    // Employee scooter on its stand by the side walkway: deck, two small wheels, steering column, bars.
    {
      const sx = xW - 0.55, sz = -6.2;
      b.rbox(scooterRed, [sx - 0.07, yLot + 0.09, sz - 0.4], [sx + 0.07, yLot + 0.13, sz + 0.35], 0.01, 2);
      for (const z of [sz - 0.42, sz + 0.42]) { const g = new THREE.TorusGeometry(0.07, 0.03, 10, 24); g.rotateY(Math.PI / 2); g.translate(sx, yLot + 0.1, z); b.add(g, tyre); cyl(galv, 0.045, 0.045, 0.02, 16, [sx, yLot + 0.1, z], [0, 0, Math.PI / 2]); }
      const col = new THREE.CylinderGeometry(0.016, 0.016, 0.95, 12); col.rotateX(-0.25); col.translate(sx, yLot + 0.58, sz + 0.34); b.add(col, scooterRed);
      cyl(black, 0.012, 0.012, 0.44, 10, [sx, yLot + 1.05, sz + 0.44], [0, 0, Math.PI / 2]);
      cyl(galvDull, 0.006, 0.006, 0.25, 8, [sx + 0.07, yLot + 0.12, sz - 0.1], [0.4, 0, 0]); // kick-stand
      b.collider([sx - 0.15, 0, sz - 0.5], [sx + 0.15, 1.0, sz + 0.5]);
    }
    // A patch of the service yard is dirt anyway: an ice machine would want a wall outlet by the
    // kitchen door — its stainless twin lives indoors; outside stands a chest with a dented lid.
    {
      const ix0 = door.x0 - 1.7, iz0 = zOut - 0.9;
      b.rbox(stainlessOut, [ix0, yLot + 0.02, iz0], [ix0 + 1.0, yLot + 0.95, iz0 + 0.75], 0.01, 3);
      b.rbox(stainlessOut, [ix0 - 0.01, yLot + 0.95, iz0 - 0.01], [ix0 + 1.01, yLot + 1.0, iz0 + 0.76], 0.012, 3);
      b.box(hvacDark, [ix0 + 0.03, yLot + 0.949, iz0 + 0.03], [ix0 + 0.97, yLot + 0.951, iz0 + 0.72]);
      b.rbox(black, [ix0 + 0.35, yLot + 1.0, iz0 + 0.68], [ix0 + 0.65, yLot + 1.03, iz0 + 0.78], 0.006);
      b.collider([ix0, 0, iz0], [ix0 + 1.0, 1.0, iz0 + 0.75]);
    }
  }

  const meshes = b.build(group, { name: "rear" });
  // The base course / gravel / walkway are ground: don't let them cast (thin slabs → shadow acne).
  for (const m of meshes) if ((m.material as THREE.Material) === gravel) m.castShadow = false;

  /* ---------------- the service drop: weatherhead → the road's utility pole ---------------- */
  {
    const mz = 1.65, head = new THREE.Vector3(xW - 0.04, roof + 0.96, mz);
    // Exterior.ts's nearest pole: the insulator bucket (colour bfc8cc) holds four pins per pole;
    // pick the pin cluster whose x is nearest the building and take its top.
    let target = new THREE.Vector3(0, yLot + 9.21, 3.25 + 0.25 + 1.8 + 14 + 16 + 3.6 + 1.4 + 0.12);
    const exterior = diner.getObjectByName("exterior");
    exterior?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat.isMeshStandardMaterial || mat.color.getHex() !== 0xbfc8cc) return;
      const p = mesh.geometry.attributes.position as THREE.BufferAttribute;
      let best: THREE.Vector3 | null = null;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (z < 30 || Math.abs(x) > 12) continue;
        if (!best || Math.abs(x - xW) < Math.abs(best.x - xW) - 0.5 || (Math.abs(Math.abs(x - xW) - Math.abs(best.x - xW)) <= 0.5 && y > best.y)) best = new THREE.Vector3(x, y, z);
      }
      if (best) target = best;
    });
    const pts: number[] = [];
    for (const [dy, dz] of [[0, -0.03], [0.02, 0.03], [-0.03, 0]]) {
      const a = head.clone().add(new THREE.Vector3(0, dy, dz)), c = target.clone().add(new THREE.Vector3(0, dy, dz));
      for (let s = 0; s < 24; s++) {
        const t0 = s / 24, t1 = (s + 1) / 24, sag = (t: number) => -1.6 * 4 * t * (1 - t);
        pts.push(a.x + (c.x - a.x) * t0, a.y + (c.y - a.y) * t0 + sag(t0), a.z + (c.z - a.z) * t0, a.x + (c.x - a.x) * t1, a.y + (c.y - a.y) * t1 + sag(t1), a.z + (c.z - a.z) * t1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const drop = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2a2826, transparent: true, opacity: 0.7 }));
    drop.name = "service-drop";
    drop.frustumCulled = false;
    group.add(drop);
  }

  return { colliders: b.colliders, envMaterials: env };
}
