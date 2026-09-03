/**
 * The kitchen proper (feat-kitchen): the walkable back-of-house behind the swing door and the
 * pass-through. Replaces the System 9 "slice" (Openables.ts rev 2–4: a 2.7 m pass-through
 * with a prep table, a hood and a fluorescent strip) with the whole enclosed box that
 * fix-rear's REAR constants describe from the outside — same footprint; the finished faces
 * sit 1.2 mm inside the shell's inner planes (see "walls" below — ON them they z-fight):
 *
 *   depth  4.2 m behind the partition's kitchen face   (REAR.kitchenDepth)
 *   width  the full rear section, x ∈ [-ROOM.halfX, ROOM.halfX]
 *   ceiling 2.7 m (a drop grid under the 2.9 m shell)
 *   back service door on the rear wall, x ∈ [-3.55, -2.6], 2.1 m (REAR.door)
 *
 * Everything INSIDE that volume is here: quarry-tile floor with grease lanes and a drain,
 * FRP / glazed tile to 1.5 m with stainless corner guards, painted uppers, vinyl-faced drop
 * ceiling with two 2×4 troffers (the diner's lens material, so they are ON), the line under
 * an exhaust hood behind the pass (griddle, 6-burner range, fryer, sandwich prep unit), a
 * prep table, a two-door reach-in, wire shelving with #10 cans, a dish pit (3-compartment
 * sink, hood-type dish machine, soiled table), the back door's inside face with an EXIT sign,
 * hand sink, clock, posters, ticket rail. Its own MergedBuilder (one mesh per material, all of
 * it culled from the dining room's spawn view). Colliders: the walls and every station; the
 * partition's collider is split around the swing door in Shell.ts so the player walks through.
 *
 * Light: the kitchen is a separate room. Lighting.ts is untouched — the fill is here: the
 * openables' 5000 K spot at the door (Openables.ts), two shadowless point fills under the
 * troffers, warm hood lights, and a modest emissive ambient term on the kitchen's own
 * material clones (the room probe barely reaches it).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Palette } from "../core/materials";
import { MergedBuilder, type Collider } from "../core/merge";
import { PRESENCE_UV } from "../procedural/presence";
import { KITCHEN_DOOR, PASS_THROUGH, ROOM } from "./layout";
import { nits } from "./Lighting";
import { lathe, tiledRect, uvIntoRect } from "./Presence";

/** The kitchen box (interior). Mirrors fix-rear's `REAR` so the two skins meet. */
export const KITCHEN = {
  depth: 4.2,
  /** Interior face of the partition (kitchen side). */
  zIn: ROOM.zBack - ROOM.wallThickness,
  /** Interior face of the rear wall. */
  zFar: ROOM.zBack - ROOM.wallThickness - 4.2,
  x0: -ROOM.halfX,
  x1: ROOM.halfX,
  ceiling: 2.7,
  /** Back service door on the rear wall (rough opening). */
  door: { x0: -3.55, x1: -2.6, height: 2.1 },
  /** Tile height on every wall. */
  tileTop: 1.5,
} as const;

export interface KitchenResult {
  colliders: Collider[];
  /** Stainless that takes a station probe captured inside the kitchen (Diner.ts). */
  envMetals: THREE.MeshStandardMaterial[];
  /** Where the ambience emitters belong: the fryer/hood and the reach-in compressor. */
  points: { hood: THREE.Vector3; reachIn: THREE.Vector3; sink: THREE.Vector3 };
  lights: THREE.Light[];
}

type V3 = [number, number, number];
const V2 = (x: number, y: number) => new THREE.Vector2(x, y);
const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const WALL_TILE_CELL = 4 * 0.1016;
const QUARRY_CELL = 4 * 0.1524;

/* ---------------- canvas sheet: signs, labels, slips (one 512 × 512 texture) ---------------- */
/** UV rects (u0, v0, u1, v1; v up) on the sheet. */
const SHEET = {
  exit: [0, 0.875, 0.5, 1] as const,
  handwash: [0.5, 0.75, 0.75, 1] as const,
  health: [0.75, 0.75, 1, 1] as const,
  slip: [0, 0.75, 0.125, 0.875] as const,
  schedule: [0.125, 0.75, 0.375, 0.875] as const,
  wetFloor: [0.375, 0.75, 0.5, 0.875] as const,
  canA: [0, 0.5, 0.5, 0.75] as const,
  canB: [0.5, 0.5, 1, 0.75] as const,
  clock: [0, 0.25, 0.25, 0.5] as const,
  bottle: [0.25, 0.25, 0.5, 0.5] as const,
};
function sheetTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const R = (r: readonly [number, number, number, number]) => ({ x: r[0] * S, y: (1 - r[3]) * S, w: (r[2] - r[0]) * S, h: (r[3] - r[1]) * S });
  const text = (s: string, x: number, y: number, px: number, color: string, weight = "bold", align: CanvasTextAlign = "center", font = "Arial") => {
    g.fillStyle = color;
    g.font = `${weight} ${px}px ${font}`;
    g.textAlign = align;
    g.textBaseline = "middle";
    g.fillText(s, x, y);
  };
  g.fillStyle = "#f4f2ea";
  g.fillRect(0, 0, S, S);
  // EXIT sign: red letters on white, a thin border.
  {
    const r = R(SHEET.exit);
    g.fillStyle = "#f6f6f4";
    g.fillRect(r.x, r.y, r.w, r.h);
    g.strokeStyle = "#b32020";
    g.lineWidth = 4;
    g.strokeRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
    text("EXIT", r.x + r.w / 2, r.y + r.h / 2 + 2, 50, "#c8251f", "900");
  }
  // Hand-washing sign: blue header, lines of text, a hand pictogram.
  {
    const r = R(SHEET.handwash);
    g.fillStyle = "#ffffff";
    g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = "#1f4e9c";
    g.fillRect(r.x, r.y, r.w, 26);
    text("EMPLOYEES MUST", r.x + r.w / 2, r.y + 13, 11, "#ffffff");
    text("WASH HANDS", r.x + r.w / 2, r.y + 44, 18, "#1f4e9c", "900");
    text("before returning to work", r.x + r.w / 2, r.y + 64, 9, "#333333", "normal");
    g.fillStyle = "#1f4e9c";
    g.beginPath();
    g.ellipse(r.x + r.w / 2, r.y + 98, 16, 22, 0, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 4; i++) g.fillRect(r.x + r.w / 2 - 14 + i * 8, r.y + 68, 5, 22);
    text("LAVE SUS MANOS", r.x + r.w / 2, r.y + r.h - 8, 8, "#1f4e9c");
  }
  // Health code poster: green header, dense grey text lines, a stamp.
  {
    const r = R(SHEET.health);
    g.fillStyle = "#fbfbf6";
    g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = "#2c6e3f";
    g.fillRect(r.x, r.y, r.w, 22);
    text("FOOD SAFETY", r.x + r.w / 2, r.y + 11, 11, "#ffffff");
    text("COUNTY HEALTH DEPT.", r.x + r.w / 2, r.y + 32, 7, "#2c6e3f");
    g.fillStyle = "#777";
    for (let i = 0; i < 12; i++) g.fillRect(r.x + 10, r.y + 44 + i * 6, r.w - 20 - (i % 3) * 14, 2);
    g.strokeStyle = "#b32020";
    g.lineWidth = 2;
    g.strokeRect(r.x + 26, r.y + r.h - 24, r.w - 52, 16);
    text("PASSED", r.x + r.w / 2, r.y + r.h - 16, 9, "#b32020");
  }
  // Order slip: a pale green ticket with pen scrawl.
  {
    const r = R(SHEET.slip);
    g.fillStyle = "#e8f0dc";
    g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = "#c9d6b8";
    g.fillRect(r.x, r.y, r.w, 8);
    text("#0412", r.x + r.w / 2, r.y + 14, 9, "#444", "normal");
    g.strokeStyle = "#1b2a6b";
    g.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(r.x + 6, r.y + 24 + i * 8);
      for (let k = 1; k <= 6; k++) g.lineTo(r.x + 6 + k * 8, r.y + 24 + i * 8 + Math.sin(i * 3 + k) * 2.2);
      g.stroke();
    }
  }
  // Schedule sheet on the reach-in: a table grid.
  {
    const r = R(SHEET.schedule);
    g.fillStyle = "#ffffff";
    g.fillRect(r.x, r.y, r.w, r.h);
    text("WEEK OF 9/1", r.x + r.w / 2, r.y + 8, 8, "#222");
    g.strokeStyle = "#999";
    g.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      g.beginPath();
      g.moveTo(r.x + 6, r.y + 16 + i * 9);
      g.lineTo(r.x + r.w - 6, r.y + 16 + i * 9);
      g.stroke();
    }
    for (let i = 0; i <= 7; i++) {
      g.beginPath();
      g.moveTo(r.x + 6 + (i * (r.w - 12)) / 7, r.y + 16);
      g.lineTo(r.x + 6 + (i * (r.w - 12)) / 7, r.y + 61);
      g.stroke();
    }
    g.fillStyle = "#333";
    for (let i = 0; i < 5; i++) for (let k = 0; k < 7; k++) if ((i * 7 + k) % 3 !== 1) g.fillRect(r.x + 8 + (k * (r.w - 12)) / 7, r.y + 19 + i * 9, 10, 3);
  }
  // Wet floor sign face: yellow, black pictogram.
  {
    const r = R(SHEET.wetFloor);
    g.fillStyle = "#f2c11a";
    g.fillRect(r.x, r.y, r.w, r.h);
    text("CAUTION", r.x + r.w / 2, r.y + 12, 10, "#111", "900");
    text("WET FLOOR", r.x + r.w / 2, r.y + r.h - 10, 8, "#111", "900");
    g.fillStyle = "#111";
    g.beginPath();
    g.moveTo(r.x + r.w / 2 - 4, r.y + 24);
    g.lineTo(r.x + r.w / 2 + 6, r.y + 30);
    g.lineTo(r.x + r.w / 2 + 2, r.y + 48);
    g.lineTo(r.x + r.w / 2 - 6, r.y + 46);
    g.fill();
  }
  // #10 can labels: two brands (tomatoes red, beans blue) round the can.
  const can = (rr: readonly [number, number, number, number], bg: string, band: string, name: string, sub: string) => {
    const r = R(rr);
    g.fillStyle = bg;
    g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = band;
    g.fillRect(r.x, r.y + r.h * 0.3, r.w, r.h * 0.4);
    text(name, r.x + r.w * 0.28, r.y + r.h / 2, 16, "#ffffff", "900");
    text(sub, r.x + r.w * 0.28, r.y + r.h * 0.83, 9, "#222", "normal");
    text("NET WT 6 LB 6 OZ (102 OZ)", r.x + r.w * 0.28, r.y + r.h * 0.93, 6, "#222", "normal");
    text(name, r.x + r.w * 0.78, r.y + r.h / 2, 16, "#ffffff", "900");
    g.fillStyle = "#222";
    for (let i = 0; i < 14; i++) g.fillRect(r.x + r.w * 0.55 + i * 3, r.y + r.h * 0.8, 1 + (i % 3 === 0 ? 1 : 0), 16);
  };
  can(SHEET.canA, "#e9e3d2", "#b8231d", "CRUSHED TOMATOES", "ITALIAN STYLE • FOOD SERVICE");
  can(SHEET.canB, "#f0ece0", "#1d3f8f", "PINTO BEANS", "IN BRINE • FOOD SERVICE");
  // Clock face: white dial, ticks, hands at 8:04 (PROPS.clock in the dining room agrees).
  {
    const r = R(SHEET.clock);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = r.w / 2 - 2;
    g.fillStyle = "#fbfbf8";
    g.beginPath();
    g.arc(cx, cy, rad, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#222";
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2, L = i % 5 === 0 ? 8 : 3;
      g.lineWidth = i % 5 === 0 ? 2 : 1;
      g.beginPath();
      g.moveTo(cx + Math.sin(a) * (rad - 4), cy - Math.cos(a) * (rad - 4));
      g.lineTo(cx + Math.sin(a) * (rad - 4 - L), cy - Math.cos(a) * (rad - 4 - L));
      g.stroke();
    }
    const hand = (a: number, len: number, w: number) => {
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len);
      g.stroke();
    };
    hand(((8 + 4 / 60) / 12) * Math.PI * 2, rad * 0.5, 4);
    hand((4 / 60) * Math.PI * 2, rad * 0.75, 3);
    g.strokeStyle = "#c8251f";
    hand((37 / 60) * Math.PI * 2, rad * 0.8, 1);
  }
  // Squeeze-bottle label strip.
  {
    const r = R(SHEET.bottle);
    g.fillStyle = "#ffffff";
    g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = "#c8251f";
    g.fillRect(r.x, r.y, r.w, r.h * 0.5);
    text("KETCHUP", r.x + r.w / 2, r.y + r.h * 0.25, 18, "#ffffff", "900");
    text("MUSTARD", r.x + r.w / 2, r.y + r.h * 0.75, 18, "#b58a00", "900");
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A quad carrying one sheet rect, facing `normal`, centred at `p`, `w × h` metres. */
function sheetQuad(w: number, h: number, rect: readonly [number, number, number, number], p: V3, normal: "+z" | "-z" | "+x" | "-x" | "+y"): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  uvIntoRect(g, rect as unknown as [number, number, number, number]);
  if (normal === "-z") g.rotateY(Math.PI);
  else if (normal === "+x") g.rotateY(Math.PI / 2);
  else if (normal === "-x") g.rotateY(-Math.PI / 2);
  else if (normal === "+y") g.rotateX(-Math.PI / 2);
  g.translate(p[0], p[1], p[2]);
  return g;
}

/** Clone a palette material for kitchen use with a small emissive ambient term (the kitchen's own fill). */
function ambient<T extends THREE.MeshStandardMaterial>(m: T, name: string, nit: number): T {
  const c = m.clone() as T;
  c.name = name;
  if (c.map) {
    c.emissiveMap = c.map;
    c.emissive = new THREE.Color(1, 1, 1);
  } else {
    c.emissive = c.color.clone();
  }
  c.emissiveIntensity = nits(nit);
  return c;
}

export function buildKitchen(parent: THREE.Group, pal: Palette, cloth: THREE.MeshStandardMaterial): KitchenResult {
  const s = new MergedBuilder();
  const { zIn, zFar, x0: kx0, x1: kx1, ceiling: CH, tileTop, door: BD } = KITCHEN;
  const H = ROOM.height;
  const dx0 = KITCHEN_DOOR.centerX - KITCHEN_DOOR.width / 2, dx1 = KITCHEN_DOOR.centerX + KITCHEN_DOOR.width / 2;
  const dj = KITCHEN_DOOR.jamb;
  const pa0 = PASS_THROUGH.centerX - PASS_THROUGH.width / 2, pa1 = PASS_THROUGH.centerX + PASS_THROUGH.width / 2;
  const pj = PASS_THROUGH.jamb, pSill = PASS_THROUGH.sill, pHead = PASS_THROUGH.sill + PASS_THROUGH.height;

  /* ---------------- materials ---------------- */
  // Tile / quarry: the presence atlas, cloned so the kitchen's ambient term stays in the kitchen.
  const tileMat = ambient(cloth, "kitchenTile", 40);
  const paint = ambient(pal.wallPaint, "kitchenPaint", 42);
  const ceilingMat = ambient(pal.ceilingTile, "kitchenCeiling", 24);
  // Stainless: the palette recipe (brushed roughness map + anisotropy, shaderPatches' frame) on a
  // station probe captured inside the kitchen (Diner.ts, via envMetals + userData.probePos).
  const steel = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.55, 0.57, 0.58, THREE.LinearSRGBColorSpace),
    roughnessMap: pal.stainless.roughnessMap,
    roughness: 1,
    metalness: 1,
    anisotropy: 0.55,
    envMapIntensity: 1.2,
  });
  steel.name = "kitchenSteel";
  steel.userData.probePos = vec(0.2, 1.3, zIn - 1.7);
  // Grease-filmed stainless for the hood, the griddle's splash and the fryer: duller, warmer.
  const greasy = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.42, 0.42, 0.4, THREE.LinearSRGBColorSpace),
    roughnessMap: pal.stainless.roughnessMap,
    roughness: 1,
    metalness: 0.92,
    anisotropy: 0.35,
    envMapIntensity: 0.9,
  });
  greasy.name = "kitchenGreasy";
  greasy.userData.probePos = vec(-0.6, 1.4, zIn - 1.4);
  const seasoned = new THREE.MeshStandardMaterial({ color: 0x1d1a17, roughness: 0.45, metalness: 0.6 });
  const oil = new THREE.MeshPhysicalMaterial({ color: 0xa8741c, roughness: 0.05, metalness: 0, transmission: 0, ior: 1.47, clearcoat: 1 });
  const grate = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.7, metalness: 0.5 });
  const poly = ambient(pal.fixtureWhite, "kitchenPoly", 30); // white poly cutting boards, dispensers
  const black = ambient(pal.blackPowder, "kitchenBlack", 12);
  const plastic = pal.blackPlastic;
  const rubber = ambient(pal.rubberMat, "kitchenRubber", 8);
  const chrome = pal.chrome;
  const lens = pal.fixtureLens;
  const white = ambient(pal.fixtureWhite, "kitchenWhite", 34);
  const sheetTex = sheetTexture();
  const paper = new THREE.MeshStandardMaterial({ map: sheetTex, roughness: 0.8, metalness: 0, emissiveMap: sheetTex, emissive: 0xffffff, emissiveIntensity: nits(30) });
  paper.name = "kitchenPaper";
  paper.userData.noCast = true;
  const exitMat = new THREE.MeshStandardMaterial({ map: sheetTex, roughness: 0.4, metalness: 0, emissiveMap: sheetTex, emissive: 0xffffff, emissiveIntensity: nits(900) });
  exitMat.name = "kitchenExit";
  exitMat.userData.noCast = true;
  const hoodLamp = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: new THREE.Color().setRGB(1, 0.9, 0.72, THREE.SRGBColorSpace), emissiveIntensity: nits(9000), roughness: 0.3 });
  hoodLamp.name = "kitchenHoodLamp";
  hoodLamp.userData.noCast = true;
  const veg = {
    pickle: new THREE.MeshStandardMaterial({ color: 0x5d7a2a, roughness: 0.55 }),
    tomato: new THREE.MeshStandardMaterial({ color: 0xc8352a, roughness: 0.45 }),
    onion: new THREE.MeshStandardMaterial({ color: 0xf1e9d8, roughness: 0.5 }),
    soup: new THREE.MeshStandardMaterial({ color: 0xb8742e, roughness: 0.3 }),
  };

  const wallTile = PRESENCE_UV.wallTile, quarry = PRESENCE_UV.quarry;
  const tile = (a: V3, c: V3, n: THREE.Vector3) => s.add(tiledRect(a, c, n, WALL_TILE_CELL, wallTile), tileMat);

  /* ---------------- floor: quarry tile, grease lanes, the drain ---------------- */
  s.add(tiledRect([kx0, 0, zFar], [kx1, 0, zIn], vec(0, 1, 0), QUARRY_CELL, quarry), tileMat);
  s.add(tiledRect([dx0 - 0.02, 0, zIn], [dx1 + 0.02, 0, ROOM.zBack], vec(0, 1, 0), QUARRY_CELL, quarry), tileMat); // through the swing door
  {
    // Grease-darkened lanes where the cook stands: a multiply-dark translucent film 3 mm up.
    const lane = new THREE.MeshStandardMaterial({ color: 0x120e0a, transparent: true, opacity: 0.32, roughness: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    lane.name = "kitchenGrease";
    lane.userData.noCast = true;
    for (const [x0, x1, z0, z1] of [[-2.0, 1.9, zIn - 1.55, zIn - 0.9], [-1.4, 0.6, zIn - 1.7, zIn - 1.5], [4.2, 4.95, zIn - 2.6, zIn - 0.6]] as const) {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      g.rotateX(-Math.PI / 2);
      g.translate((x0 + x1) / 2, 0.002, (z0 + z1) / 2);
      s.add(g, lane);
    }
    // Floor drain: 200 mm square grate, recessed 12 mm, in the aisle.
    const gx = 0.0, gz = zIn - 1.75;
    s.box(black, [gx - 0.1, -0.03, gz - 0.1], [gx + 0.1, -0.005, gz + 0.1]);
    s.rbox(steel, [gx - 0.115, -0.006, gz - 0.115], [gx + 0.115, 0.004, gz + 0.115], 0.002);
    for (let i = 0; i < 7; i++) s.box(black, [gx - 0.09, -0.004, gz - 0.09 + i * 0.03 + 0.008], [gx + 0.09, 0.006, gz - 0.09 + i * 0.03 + 0.022]);
    // Rubber anti-fatigue mats in front of the line and at the dish pit.
    for (const [x0, x1, z0, z1] of [[-1.9, -0.2, zIn - 1.5, zIn - 0.92], [-0.1, 1.7, zIn - 1.5, zIn - 0.92], [4.6, 5.7, zIn - 2.4, zIn - 0.8]] as const) {
      s.rbox(rubber, [x0, 0, z0], [x1, 0.016, z1], 0.006, 2);
      for (let i = 0; i < 5; i++) for (let k = 0; k < 3; k++) s.box(black, [x0 + 0.1 + i * ((x1 - x0 - 0.2) / 5), 0.016, z0 + 0.1 + k * ((z1 - z0 - 0.2) / 3)], [x0 + 0.1 + i * ((x1 - x0 - 0.2) / 5) + 0.06, 0.018, z0 + 0.1 + k * ((z1 - z0 - 0.2) / 3) + 0.06]);
    }
  }

  /* ---------------- walls: tile to 1.5, paint above, corner guards ---------------- */
  // Every finished face sits PROUD mm inside the shell's own inner face. Rear.ts's stucco
  // solids (rear wall to zFar, end walls to ±halfX) and the partition (Shell.ts, to zIn) are
  // opaque boxes whose kitchen-side faces lie exactly on these planes; a tile plane or paint
  // box ON the same plane z-fights them, and with 4× MSAA the fight reads as the whole wall
  // dissolving into stucco and back with every centimetre the camera moves (fix-kitchen-
  // flicker: "the whole kitchen flickers if I move a little"). 1.2 mm is ≥ 7 depth steps at
  // the far end of the room (24-bit depth, near 0.05) and invisible as an offset.
  const PROUD = 0.0012;
  const zRear = zFar + PROUD, xWest = kx0 + PROUD, xEast = kx1 - PROUD;
  // Rear wall, punched for the service door.
  tile([kx0, 0, zRear], [BD.x0 - 0.05, tileTop, zRear], vec(0, 0, 1));
  tile([BD.x1 + 0.05, 0, zRear], [kx1, tileTop, zRear], vec(0, 0, 1));
  s.box(paint, [kx0, tileTop, zFar - 0.05], [BD.x0 - 0.05, H, zRear]);
  s.box(paint, [BD.x1 + 0.05, tileTop, zFar - 0.05], [kx1, H, zRear]);
  s.box(paint, [BD.x0 - 0.05, BD.height + 0.05, zFar - 0.05], [BD.x1 + 0.05, H, zRear]);
  s.collider([kx0, 0, zFar - 0.3], [BD.x0, H, zFar]);
  s.collider([BD.x1, 0, zFar - 0.3], [kx1, H, zFar]);
  // The end walls.
  tile([xWest, 0, zFar], [xWest, tileTop, zIn], vec(1, 0, 0));
  s.box(paint, [kx0 - 0.05, tileTop, zFar], [xWest, H, zIn]);
  tile([xEast, 0, zFar], [xEast, tileTop, zIn], vec(-1, 0, 0));
  s.box(paint, [xEast, tileTop, zFar], [kx1 + 0.05, H, zIn]);
  s.collider([kx0 - 0.3, 0, zFar], [kx0, H, zIn]);
  s.collider([kx1, 0, zFar], [kx1 + 0.3, H, zIn]);
  // The partition's kitchen face: around the swing door casing and the pass-through.
  const zFace = zIn - PROUD;
  tile([kx0, 0, zFace], [dx0 - dj, tileTop, zFace], vec(0, 0, -1));
  tile([dx1 + dj, 0, zFace], [pa0 - pj, tileTop, zFace], vec(0, 0, -1));
  tile([pa0 - pj, 0, zFace], [pa1 + pj, pSill - 0.035, zFace], vec(0, 0, -1));
  tile([pa1 + pj, 0, zFace], [kx1, tileTop, zFace], vec(0, 0, -1));
  s.box(paint, [kx0, tileTop, zFace], [dx0 - dj, H, zIn]);
  s.box(paint, [dx1 + dj, tileTop, zFace], [pa0 - pj, H, zIn]);
  s.box(paint, [pa0 - pj, pHead + pj, zFace], [pa1 + pj, H, zIn]);
  s.box(paint, [pa1 + pj, tileTop, zFace], [kx1, H, zIn]);
  s.box(paint, [dx0 - dj, KITCHEN_DOOR.height + dj, zFace], [dx1 + dj, H, zIn]);
  // Casing on the kitchen face of the swing door (Shell.ts trims the dining side).
  s.rbox(pal.trimPaint, [dx0 - dj, 0, zIn - 0.015], [dx0, KITCHEN_DOOR.height + dj, zIn], 0.002);
  s.rbox(pal.trimPaint, [dx1, 0, zIn - 0.015], [dx1 + dj, KITCHEN_DOOR.height + dj, zIn], 0.002);
  s.rbox(pal.trimPaint, [dx0, KITCHEN_DOOR.height, zIn - 0.015], [dx1, KITCHEN_DOOR.height + dj, zIn], 0.002);
  // Stainless corner guards (1.2 m, 50 × 50) on the two rear corners and the pass jambs' lower edge.
  for (const [x, sx] of [[kx0, 1], [kx1, -1]] as const) {
    s.rbox(steel, [x, 0.05, zFar], [x + sx * 0.05, 1.25, zFar + 0.002], 0.001);
    s.rbox(steel, [x, 0.05, zFar], [x + sx * 0.002, 1.25, zFar + 0.05], 0.001);
  }

  /* ---------------- drop ceiling at 2.7: vinyl-faced tiles, two 2 × 4 troffers ---------------- */
  {
    const troffers: Array<[number, number]> = [[-3.0, zIn - 2.1], [2.6, zIn - 2.1]]; // centres; 1.2 × 0.6, long axis x
    s.box(ceilingMat, [kx0, CH, zFar], [kx1, CH + 0.03, zIn], { uvScale: 0.6 });
    // Grid: main tees along x every 0.6 in z, cross tees every 1.2 in x, 24 mm faces, 6 mm under the tiles.
    for (let z = zFar + 0.6; z < zIn - 0.01; z += 0.6) s.box(pal.tbar, [kx0, CH - 0.006, z - 0.012], [kx1, CH, z + 0.012]);
    for (let x = kx0 + 0.6; x < kx1 - 0.01; x += 1.2) s.box(pal.tbar, [x - 0.0075, CH - 0.006, zFar], [x + 0.0075, CH, zIn]);
    for (const [tx, tz] of troffers) {
      const x0 = tx - 0.59, x1 = tx + 0.59, z0 = tz - 0.29, z1 = tz + 0.29, f = 0.025;
      s.rbox(white, [x0, CH - 0.01, z0], [x0 + f, CH + 0.01, z1], 0.002);
      s.rbox(white, [x1 - f, CH - 0.01, z0], [x1, CH + 0.01, z1], 0.002);
      s.rbox(white, [x0 + f, CH - 0.01, z0], [x1 - f, CH + 0.01, z0 + f], 0.002);
      s.rbox(white, [x0 + f, CH - 0.01, z1 - f], [x1 - f, CH + 0.01, z1], 0.002);
      const g = new THREE.PlaneGeometry(x1 - x0 - 2 * f, z1 - z0 - 2 * f);
      g.rotateX(Math.PI / 2);
      g.translate(tx, CH + 0.003, tz);
      s.add(g, lens);
    }
  }

  /* ---------------- back service door: steel leaf (inside face), push bar, kick plate, EXIT ---------------- */
  {
    const { x0, x1, height: h } = BD;
    const zd = zFar + 0.02; // leaf face (in the rear wall's plane; fix-rear owns the outside face)
    const grey = new THREE.MeshStandardMaterial({ color: 0x8d9195, roughness: 0.5, metalness: 0.3 });
    grey.name = "kitchenSteelDoor";
    s.rbox(grey, [x0 + 0.05, 0.01, zd - 0.02], [x1 - 0.05, h - 0.01, zd + 0.025], 0.003, 2); // hollow-metal leaf, grey primer
    s.rbox(pal.trimPaint, [x0, 0, zd - 0.02], [x0 + 0.05, h + 0.05, zd + 0.05], 0.002); // frame
    s.rbox(pal.trimPaint, [x1 - 0.05, 0, zd - 0.02], [x1, h + 0.05, zd + 0.05], 0.002);
    s.rbox(pal.trimPaint, [x0, h, zd - 0.02], [x1, h + 0.05, zd + 0.05], 0.002);
    s.rbox(steel, [x0 + 0.07, 0.03, zd + 0.025], [x1 - 0.07, 0.43, zd + 0.027], 0.001); // kick plate
    s.rbox(steel, [x0 + 0.1, 0.98, zd + 0.06], [x1 - 0.1, 1.04, zd + 0.11], 0.004, 2); // push bar
    for (const bx of [x0 + 0.13, x1 - 0.13]) s.rbox(steel, [bx - 0.03, 0.96, zd + 0.027], [bx + 0.03, 1.06, zd + 0.06], 0.003);
    // Closer on the head, a peephole, an EXIT sign above the frame (lit).
    s.rbox(black, [x0 + 0.15, h - 0.08, zd + 0.03], [x0 + 0.45, h - 0.02, zd + 0.1], 0.002);
    s.add(sheetQuad(0.32, 0.16, SHEET.exit, [(x0 + x1) / 2, h + 0.2, zd + 0.02], "+z"), exitMat);
    s.rbox(black, [(x0 + x1) / 2 - 0.17, h + 0.11, zd - 0.01], [(x0 + x1) / 2 + 0.17, h + 0.29, zd + 0.018], 0.003);
    s.collider([x0, 0, zFar - 0.3], [x1, h, zd + 0.06]); // the leaf is closed
    // Hand sink beside the door (wall-hung, 430 × 380), soap and towel dispensers, the two signs.
    const sx = x1 + 0.5, sz = zFar;
    s.rbox(steel, [sx - 0.215, 0.85, sz], [sx + 0.215, 0.95, sz + 0.38], 0.006, 2);
    s.box(steel, [sx - 0.19, 0.78, sz + 0.03], [sx + 0.19, 0.85, sz + 0.35]);
    s.rbox(steel, [sx - 0.215, 0.95, sz], [sx + 0.215, 1.05, sz + 0.03], 0.004); // backsplash
    const tap = new THREE.CylinderGeometry(0.008, 0.008, 0.16, 12);
    tap.translate(sx, 1.05, sz + 0.03);
    s.add(tap, chrome);
    const spout = new THREE.TorusGeometry(0.07, 0.007, 8, 20, Math.PI);
    spout.rotateY(Math.PI / 2);
    spout.translate(sx, 1.13, sz + 0.1);
    s.add(spout, chrome);
    s.rbox(poly, [sx - 0.3, 1.25, sz], [sx - 0.18, 1.45, sz + 0.11], 0.006, 2); // soap
    s.rbox(poly, [sx + 0.15, 1.3, sz], [sx + 0.45, 1.7, sz + 0.24], 0.008, 2); // towel dispenser
    s.collider([sx - 0.23, 0, sz - 0.3], [sx + 0.23, 1.0, sz + 0.4]);
    s.add(sheetQuad(0.28, 0.36, SHEET.handwash, [sx - 0.05, 1.8, sz + 0.004], "+z"), paper);
    s.add(sheetQuad(0.3, 0.42, SHEET.health, [sx + 0.9, 1.75, sz + 0.004], "+z"), paper);
    // Wall clock over the door on the rear wall; 300 mm dial in a black rim.
    const cx = (x0 + x1) / 2 + 1.3, cy = 2.25;
    const rim = new THREE.TorusGeometry(0.15, 0.012, 8, 40);
    rim.translate(cx, cy, zFar + 0.02);
    s.add(rim, black);
    s.add(sheetQuad(0.29, 0.29, SHEET.clock, [cx, cy, zFar + 0.02], "+z"), paper);
  }

  /* ---------------- the line, against the partition behind the pass ---------------- */
  const lineD = 0.85; // equipment depth off the wall
  const lz0 = zIn - lineD, lz1 = zIn - 0.02;
  const lineY = 0.9;
  const knob = (x: number, y: number, z: number) => {
    const k = new THREE.CylinderGeometry(0.02, 0.023, 0.025, 16);
    k.rotateX(Math.PI / 2);
    k.translate(x, y, z);
    s.add(k, plastic);
    const ind = new THREE.BoxGeometry(0.004, 0.012, 0.004);
    ind.translate(x, y + 0.006, z - 0.014);
    s.add(ind, white);
  };
  const legs = (x0: number, x1: number, z0: number, z1: number, h: number, r = 0.02) => {
    for (const [lx, lz] of [[x0 + 0.06, z0 + 0.06], [x1 - 0.06, z0 + 0.06], [x0 + 0.06, z1 - 0.06], [x1 - 0.06, z1 - 0.06]]) {
      const leg = new THREE.CylinderGeometry(r, r, h, 14);
      leg.translate(lx, h / 2, lz);
      s.add(leg, steel);
      const foot = new THREE.CylinderGeometry(r + 0.01, r + 0.012, 0.02, 14);
      foot.translate(lx, 0.01, lz);
      s.add(foot, black);
    }
  };
  // Griddle: 36" flat-top, seasoned plate, grease trough at the front, splash guard at the back, 4 knobs.
  {
    const x0 = -1.9, x1 = x0 + 0.914;
    s.rbox(steel, [x0, 0.2, lz0 + 0.05], [x1, lineY - 0.06, lz1], 0.004, 2);
    legs(x0, x1, lz0 + 0.05, lz1, 0.2);
    s.rbox(steel, [x0, lineY - 0.06, lz0], [x1, lineY, lz1], 0.004, 2);
    s.box(seasoned, [x0 + 0.03, lineY, lz0 + 0.12], [x1 - 0.03, lineY + 0.02, lz1 - 0.03]); // the plate
    s.box(black, [x0 + 0.03, lineY - 0.03, lz0 + 0.03], [x1 - 0.03, lineY + 0.005, lz0 + 0.12]); // trough
    s.rbox(greasy, [x0, lineY, lz1 - 0.03], [x1, lineY + 0.32, lz1], 0.003); // back splash
    s.rbox(greasy, [x0, lineY, lz0 + 0.12], [x0 + 0.03, lineY + 0.1, lz1], 0.002);
    s.rbox(greasy, [x1 - 0.03, lineY, lz0 + 0.12], [x1, lineY + 0.1, lz1], 0.002);
    for (let i = 0; i < 4; i++) knob(x0 + 0.13 + i * 0.22, lineY - 0.12, lz0 + 0.048);
    // Spatula and scraper resting on the splash, a grease cup hooked under the trough.
    s.rbox(steel, [x0 + 0.5, lineY + 0.02, lz0 + 0.5], [x0 + 0.6, lineY + 0.024, lz0 + 0.65], 0.001);
    s.rbox(black, [x0 + 0.54, lineY + 0.02, lz0 + 0.65], [x0 + 0.56, lineY + 0.04, lz0 + 0.86], 0.002);
    const cup = new THREE.CylinderGeometry(0.06, 0.055, 0.12, 20, 1, true);
    cup.translate(x0 + 0.2, lineY - 0.1, lz0 - 0.05);
    s.add(cup, steel);
    s.collider([x0, 0, lz0 - 0.02], [x1, lineY + 0.3, lz1]);
  }
  // 6-burner range with oven: 36" body, black grates, oven door with a bar handle.
  {
    const x0 = -0.95, x1 = x0 + 0.914;
    s.rbox(steel, [x0, 0.15, lz0 + 0.05], [x1, lineY - 0.1, lz1], 0.004, 2);
    legs(x0, x1, lz0 + 0.05, lz1, 0.15, 0.025);
    s.rbox(black, [x0 + 0.02, 0.32, lz0 + 0.02], [x1 - 0.02, lineY - 0.16, lz0 + 0.06], 0.004, 2); // oven door
    s.rbox(steel, [x0 + 0.06, lineY - 0.22, lz0 - 0.02], [x1 - 0.06, lineY - 0.19, lz0 + 0.02], 0.003); // handle
    s.rbox(steel, [x0, lineY - 0.1, lz0], [x1, lineY - 0.02, lz1], 0.004, 2); // manifold / top
    s.box(black, [x0 + 0.02, lineY - 0.02, lz0 + 0.1], [x1 - 0.02, lineY - 0.005, lz1 - 0.02]); // burner tray
    s.rbox(greasy, [x0, lineY - 0.02, lz1 - 0.03], [x1, lineY + 0.32, lz1], 0.003); // back riser
    s.box(steel, [x0 - 0.002, lineY + 0.25, lz1 - 0.26], [x1 + 0.002, lineY + 0.32, lz1]); // high shelf
    for (let i = 0; i < 6; i++) knob(x0 + 0.1 + i * 0.145, lineY - 0.16, lz0 + 0.048);
    for (let gx = 0; gx < 3; gx++)
      for (let gz = 0; gz < 2; gz++) {
        const cx = x0 + 0.16 + gx * 0.3, cz = lz0 + 0.28 + gz * 0.32;
        for (let k = 0; k < 5; k++) s.box(grate, [cx - 0.13, lineY - 0.005, cz - 0.13 + k * 0.065], [cx + 0.13, lineY + 0.01, cz - 0.12 + k * 0.065]);
        for (const sx of [-0.13, 0.12]) s.box(grate, [cx + sx, lineY - 0.005, cz - 0.13], [cx + sx + 0.01, lineY + 0.01, cz + 0.13]);
        const cap = new THREE.CylinderGeometry(0.04, 0.045, 0.012, 20);
        cap.translate(cx, lineY - 0.005, cz);
        s.add(cap, black);
      }
    // A sauté pan on the front-left burner, a stockpot on the back-right.
    const pan = lathe([V2(0, 0), V2(0.1, 0), V2(0.13, 0.05), V2(0.135, 0.052), V2(0.128, 0.048), V2(0.1, 0.003), V2(0, 0.003)], 32);
    pan.translate(x0 + 0.16, lineY + 0.01, lz0 + 0.28);
    s.add(pan, steel);
    s.rbox(steel, [x0 + 0.29, lineY + 0.045, lz0 + 0.27], [x0 + 0.5, lineY + 0.06, lz0 + 0.29], 0.004);
    const pot = new THREE.CylinderGeometry(0.15, 0.15, 0.3, 32, 1, true);
    pot.translate(x0 + 0.76, lineY + 0.16, lz0 + 0.6);
    s.add(pot, steel);
    const potBase = new THREE.CircleGeometry(0.15, 32);
    potBase.rotateX(-Math.PI / 2);
    potBase.translate(x0 + 0.76, lineY + 0.012, lz0 + 0.6);
    s.add(potBase, steel);
    const lid = lathe([V2(0, 0.02), V2(0.03, 0.02), V2(0.12, 0.012), V2(0.155, 0), V2(0.155, -0.006), V2(0.14, -0.006)], 32);
    lid.translate(x0 + 0.76, lineY + 0.31, lz0 + 0.6);
    s.add(lid, steel);
    s.collider([x0, 0, lz0 - 0.02], [x1, lineY + 0.3, lz1]);
  }
  // 2-basket fryer: 40 lb, oil visible in the vat, baskets hanging from the back rail.
  {
    const x0 = 0.0, x1 = x0 + 0.4;
    s.rbox(steel, [x0, 0.15, lz0 + 0.05], [x1, lineY - 0.25, lz1], 0.004, 2);
    legs(x0, x1, lz0 + 0.05, lz1, 0.15);
    s.rbox(black, [x0 + 0.02, 0.3, lz0 + 0.02], [x1 - 0.02, lineY - 0.3, lz0 + 0.06], 0.004, 2); // access door
    s.rbox(greasy, [x0, lineY - 0.25, lz0], [x1, lineY - 0.02, lz1], 0.004, 2); // vat body
    s.box(black, [x0 + 0.03, lineY - 0.24, lz0 + 0.06], [x1 - 0.03, lineY - 0.04, lz1 - 0.08]);
    s.box(oil, [x0 + 0.032, lineY - 0.09, lz0 + 0.062], [x1 - 0.032, lineY - 0.085, lz1 - 0.082]); // oil surface
    s.rbox(greasy, [x0, lineY - 0.02, lz1 - 0.1], [x1, lineY + 0.42, lz1], 0.003); // back splash
    s.rbox(steel, [x0 + 0.03, lineY + 0.3, lz1 - 0.13], [x1 - 0.03, lineY + 0.32, lz1 - 0.1], 0.003); // basket rail
    for (const bx of [x0 + 0.04, x0 + 0.21]) {
      // Basket: a mesh box hanging on its hook, handle up.
      s.rbox(grate, [bx, lineY + 0.02, lz1 - 0.34], [bx + 0.15, lineY + 0.03, lz1 - 0.13], 0.002);
      for (const [a, c] of [[[bx, lineY + 0.03, lz1 - 0.34], [bx + 0.15, lineY + 0.16, lz1 - 0.335]], [[bx, lineY + 0.03, lz1 - 0.135], [bx + 0.15, lineY + 0.16, lz1 - 0.13]], [[bx, lineY + 0.03, lz1 - 0.34], [bx + 0.005, lineY + 0.16, lz1 - 0.13]], [[bx + 0.145, lineY + 0.03, lz1 - 0.34], [bx + 0.15, lineY + 0.16, lz1 - 0.13]]] as const)
        s.box(grate, a as V3, c as V3);
      const hook = new THREE.BoxGeometry(0.02, 0.2, 0.006);
      hook.translate(bx + 0.075, lineY + 0.24, lz1 - 0.12);
      s.add(hook, steel);
      const handle = new THREE.CylinderGeometry(0.012, 0.012, 0.2, 10);
      handle.translate(bx + 0.075, lineY + 0.42, lz1 - 0.12);
      s.add(handle, plastic);
    }
    knob(x0 + 0.2, lineY - 0.34, lz0 + 0.048);
    s.collider([x0, 0, lz0 - 0.02], [x1, lineY + 0.3, lz1]);
  }
  // Refrigerated sandwich prep unit: 48" body, cutting board along the front, 8 inserts with lids up.
  {
    const x0 = 0.5, x1 = x0 + 1.22;
    s.rbox(steel, [x0, 0.15, lz0 + 0.05], [x1, lineY - 0.03, lz1], 0.004, 2);
    legs(x0, x1, lz0 + 0.05, lz1, 0.15);
    for (const dx of [0.03, 0.62]) {
      s.rbox(steel, [x0 + dx, 0.2, lz0 + 0.02], [x0 + dx + 0.57, lineY - 0.1, lz0 + 0.05], 0.004, 2);
      s.rbox(steel, [x0 + dx + 0.12, lineY - 0.32, lz0 - 0.01], [x0 + dx + 0.45, lineY - 0.3, lz0 + 0.02], 0.003); // handles
    }
    s.rbox(steel, [x0, lineY - 0.03, lz0], [x1, lineY, lz1], 0.004, 2);
    s.rbox(poly, [x0 + 0.01, lineY, lz0 + 0.02], [x1 - 0.01, lineY + 0.013, lz0 + 0.3], 0.004, 2); // cutting board
    s.box(black, [x0 + 0.02, lineY, lz0 + 0.32], [x1 - 0.02, lineY + 0.004, lz1 - 0.02]); // rail well
    s.rbox(steel, [x0, lineY, lz1 - 0.25], [x1, lineY + 0.03, lz1], 0.003); // rear ledge (lid hinge)
    const fill: Array<keyof typeof veg | null> = ["pickle", "tomato", "onion", null, "pickle", null, "tomato", "onion"];
    for (let i = 0; i < 8; i++) {
      const ix0 = x0 + 0.03 + i * 0.147, ix1 = ix0 + 0.14;
      s.rbox(steel, [ix0, lineY - 0.1, lz0 + 0.34], [ix1, lineY + 0.005, lz1 - 0.27], 0.002, 1);
      const v = fill[i];
      if (v) {
        // Discs: pickles, tomato slices and onion rings, heaped a little above the rim.
        for (let k = 0; k < 6; k++) {
          const r = v === "pickle" ? 0.022 : 0.032;
          const disc = new THREE.CylinderGeometry(r, r, 0.005, 16);
          disc.rotateX((k % 2) * 0.35);
          disc.translate(ix0 + 0.035 + (k % 3) * 0.035, lineY - 0.02 + Math.floor(k / 3) * 0.006, lz0 + 0.42 + Math.floor(k / 2) * 0.03);
          s.add(disc, veg[v]);
        }
      } else {
        // Lid down over the insert.
        s.rbox(steel, [ix0 - 0.003, lineY + 0.005, lz0 + 0.335], [ix1 + 0.003, lineY + 0.012, lz1 - 0.265], 0.002);
      }
    }
    s.collider([x0, 0, lz0 - 0.02], [x1, lineY + 0.2, lz1]);
    // Wall shelf over the prep unit at 1.55: squeeze bottles, shakers, a spatula / tongs rack.
    const sy = 1.55;
    s.rbox(steel, [x0, sy, lz1 - 0.3], [x1, sy + 0.02, lz1], 0.003);
    for (const bx of [x0 + 0.08, x0 + 0.3]) s.box(steel, [bx, sy - 0.25, lz1 - 0.28], [bx + 0.02, sy, lz1 - 0.26]);
    const bottleGeo = (h: number) => lathe([V2(0, 0), V2(0.03, 0), V2(0.032, 0.01), V2(0.032, h - 0.04), V2(0.018, h - 0.02), V2(0.006, h), V2(0, h)], 20);
    const red = new THREE.MeshStandardMaterial({ color: 0xc8241c, roughness: 0.4 }), yellow = new THREE.MeshStandardMaterial({ color: 0xe0b010, roughness: 0.4 });
    for (const [bx, m] of [[x0 + 0.1, red], [x0 + 0.18, red], [x0 + 0.27, yellow], [x0 + 0.36, yellow], [x0 + 0.46, poly]] as const) {
      const b = bottleGeo(0.2);
      b.translate(bx, sy + 0.02, lz1 - 0.13);
      s.add(b, m as THREE.Material);
    }
    for (let i = 0; i < 4; i++) {
      const sh = new THREE.CylinderGeometry(0.03, 0.028, 0.11, 16);
      sh.translate(x0 + 0.62 + i * 0.08, sy + 0.075, lz1 - 0.14);
      s.add(sh, i % 2 ? steel : poly);
      const cap = new THREE.CylinderGeometry(0.031, 0.031, 0.015, 16);
      cap.translate(x0 + 0.62 + i * 0.08, sy + 0.137, lz1 - 0.14);
      s.add(cap, steel);
    }
    // Rack under the shelf: a bar with spatula, tongs, a whisk hanging.
    const bar = new THREE.CylinderGeometry(0.008, 0.008, 0.5, 10);
    bar.rotateZ(Math.PI / 2);
    bar.translate(x0 + 0.72, sy - 0.05, lz1 - 0.1);
    s.add(bar, steel);
    for (let i = 0; i < 4; i++) {
      const hx = x0 + 0.52 + i * 0.13;
      s.box(black, [hx - 0.012, sy - 0.32, lz1 - 0.1], [hx + 0.012, sy - 0.06, lz1 - 0.085]); // handles
      s.rbox(steel, [hx - 0.04 + (i % 2) * 0.02, sy - 0.48, lz1 - 0.1], [hx + 0.04 - (i % 2) * 0.02, sy - 0.32, lz1 - 0.096], 0.001);
    }
  }
  // Plate warmer with a stack of plates, and a bain-marie with a soup insert and ladle, at the +x end.
  {
    const x0 = 1.8, x1 = 2.35;
    s.rbox(steel, [x0, 0.15, lz0 + 0.15], [x1, lineY, lz1], 0.004, 2);
    legs(x0, x1, lz0 + 0.15, lz1, 0.15);
    s.rbox(black, [x0 + 0.02, 0.3, lz0 + 0.12], [x1 - 0.02, lineY - 0.15, lz0 + 0.15], 0.004, 2);
    const plates: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 14; i++) {
      const p = lathe([V2(0, 0), V2(0.09, 0), V2(0.125, 0.018), V2(0.13, 0.022), V2(0.125, 0.02), V2(0.088, 0.004), V2(0, 0.004)], 32);
      p.translate((x0 + x1) / 2, lineY + i * 0.012, lz0 + 0.5);
      plates.push(p);
    }
    s.add(mergeGeometries(plates)!, pal.ceramic);
    const bx0 = 2.45, bx1 = 3.05;
    s.rbox(steel, [bx0, 0.15, lz0 + 0.2], [bx1, lineY, lz1], 0.004, 2);
    legs(bx0, bx1, lz0 + 0.2, lz1, 0.15);
    s.rbox(steel, [bx0 + 0.03, lineY - 0.2, lz0 + 0.25], [bx1 - 0.03, lineY + 0.003, lz1 - 0.05], 0.003, 1); // well
    const ins = new THREE.CylinderGeometry(0.13, 0.12, 0.2, 32, 1, true);
    ins.translate((bx0 + bx1) / 2, lineY - 0.1, lz0 + 0.5);
    s.add(ins, steel);
    const soup = new THREE.CircleGeometry(0.125, 32);
    soup.rotateX(-Math.PI / 2);
    soup.translate((bx0 + bx1) / 2, lineY - 0.04, lz0 + 0.5);
    s.add(soup, veg.soup);
    const ladle = new THREE.CylinderGeometry(0.006, 0.006, 0.3, 10);
    ladle.rotateZ(0.5);
    ladle.translate((bx0 + bx1) / 2 + 0.1, lineY + 0.1, lz0 + 0.5);
    s.add(ladle, steel);
    knob(bx0 + 0.3, lineY - 0.3, lz0 + 0.2);
    s.collider([x0, 0, lz0 + 0.1], [bx1, lineY + 0.2, lz1]);
  }
  // Ticket rail with order slips over the pass (kitchen side), heat-lamp shelf above it is Shell.ts'.
  {
    const ry = pHead + 0.12, rz = zIn - 0.06;
    s.rbox(steel, [pa0 - 0.1, ry - 0.03, rz - 0.015], [pa1 + 0.1, ry, rz + 0.015], 0.003);
    s.rbox(black, [pa0 - 0.1, ry - 0.045, rz - 0.02], [pa1 + 0.1, ry - 0.03, rz + 0.02], 0.002); // the grip strip
    for (let i = 0; i < 4; i++) s.add(sheetQuad(0.09, 0.15, SHEET.slip, [pa0 + 0.15 + i * 0.22, ry - 0.11, rz - 0.022 - (i % 2) * 0.002], "-z"), paper);
  }
  // Exhaust hood over the whole line: 3.1 × 1.2 m canopy, grease trough lip, baffle filters, two hood lights.
  {
    const hx0 = -1.98, hx1 = 1.8, hz0 = zIn - 1.2, hz1 = zIn;
    s.rbox(greasy, [hx0, 1.95, hz0], [hx1, CH, hz1], 0.005, 2);
    s.rbox(greasy, [hx0, 1.89, hz0], [hx1, 1.955, hz0 + 0.07], 0.004, 2); // front lip / trough
    for (const x of [hx0, hx1 - 0.06]) s.rbox(greasy, [x, 1.89, hz0], [x + 0.06, 1.955, hz1], 0.004, 2);
    // The canopy's underside is open: a recessed dark plenum with the filter bank slanted at the back.
    s.box(black, [hx0 + 0.06, 1.95, hz0 + 0.07], [hx1 - 0.06, 1.96, hz1 - 0.05]);
    const nF = 7;
    for (let i = 0; i < nF; i++) {
      const fx = hx0 + 0.32 + i * 0.5;
      const parts: THREE.BufferGeometry[] = [new THREE.BoxGeometry(0.46, 0.5, 0.012)];
      for (let k = 0; k < 7; k++) {
        const rib = new THREE.BoxGeometry(0.014, 0.48, 0.02);
        rib.translate(-0.2 + k * 0.066, 0, -0.012);
        parts.push(rib);
      }
      const filter = mergeGeometries(parts)!;
      filter.rotateX(THREE.MathUtils.degToRad(-50));
      filter.translate(fx, 2.2, hz1 - 0.42);
      s.add(filter, steel);
    }
    // Two vapour-proof hood lights: glass jar lenses under a cage, warm and ON.
    for (const lx of [hx0 + 0.9, hx1 - 0.9]) {
      const jar = new THREE.CylinderGeometry(0.055, 0.05, 0.1, 20);
      jar.translate(lx, 1.9, hz0 + 0.45);
      s.add(jar, hoodLamp);
      const cage = new THREE.TorusGeometry(0.062, 0.004, 6, 24);
      cage.rotateX(Math.PI / 2);
      cage.translate(lx, 1.88, hz0 + 0.45);
      s.add(cage, steel);
    }
    s.collider([hx0, 1.85, hz0], [hx1, CH, hz1]);
  }

  /* ---------------- prep table in the middle, reach-in and shelving on the rear wall ---------------- */
  {
    // 30 × 72 in work table with an undershelf: cutting board, knife roll, a bus tub of onions, a scale.
    const tx0 = -1.55, tx1 = tx0 + 1.83, tz1 = zIn - 2.3, tz0 = tz1 - 0.76, top = 0.9;
    s.rbox(steel, [tx0, top - 0.04, tz0], [tx1, top, tz1], 0.004, 2);
    legs(tx0, tx1, tz0, tz1, top - 0.04);
    s.rbox(steel, [tx0 + 0.04, 0.25, tz0 + 0.04], [tx1 - 0.04, 0.28, tz1 - 0.04], 0.003);
    s.rbox(poly, [tx0 + 0.15, top, tz0 + 0.12], [tx0 + 0.75, top + 0.015, tz0 + 0.57], 0.006, 2); // board
    s.rbox(black, [tx0 + 0.85, top, tz0 + 0.1], [tx1 - 0.55, top + 0.06, tz0 + 0.5], 0.02, 3); // knife roll
    for (let i = 0; i < 3; i++) s.rbox(steel, [tx0 + 0.2 + i * 0.05, top + 0.014, tz0 + 0.15], [tx0 + 0.215 + i * 0.05, top + 0.017, tz0 + 0.45], 0.001);
    s.rbox(poly, [tx1 - 0.5, top, tz0 + 0.15], [tx1 - 0.05, top + 0.18, tz0 + 0.6], 0.008, 2); // bus tub
    for (let i = 0; i < 9; i++) {
      const onion = new THREE.SphereGeometry(0.045, 16, 12);
      onion.translate(tx1 - 0.43 + (i % 3) * 0.15, top + 0.16 + Math.floor(i / 3) * 0.01, tz0 + 0.24 + Math.floor(i / 3) * 0.13);
      s.add(onion, veg.onion);
    }
    s.rbox(steel, [tx0 + 0.9, top, tz0 + 0.55], [tx0 + 1.2, top + 0.05, tz1 - 0.05], 0.006, 2); // scale
    s.rbox(steel, [tx0 + 0.92, top + 0.05, tz0 + 0.57], [tx0 + 1.18, top + 0.053, tz1 - 0.07], 0.002);
    s.rbox(steel, [tx0 + 0.36, 0.28, tz0 + 0.1], [tx0 + 0.86, 0.5, tz1 - 0.1], 0.004, 2); // Cambro on the undershelf
    s.collider([tx0, 0, tz0], [tx1, top, tz1]);

    // Two-door reach-in on the rear wall: 54" wide, 2.0 m, stainless doors with pull handles.
    const rx0 = -1.5, rx1 = rx0 + 1.37, rz0 = zFar + 0.01, rz1 = rz0 + 0.82;
    s.rbox(steel, [rx0, 0.15, rz0], [rx1, 2.0, rz1], 0.006, 2);
    legs(rx0, rx1, rz0, rz1, 0.15, 0.03);
    for (const dx of [0.02, 0.69]) {
      s.rbox(steel, [rx0 + dx, 0.25, rz1], [rx0 + dx + 0.66, 1.95, rz1 + 0.02], 0.004, 2);
      const hx = dx < 0.5 ? rx0 + dx + 0.6 : rx0 + dx + 0.06;
      s.rbox(black, [hx - 0.015, 0.8, rz1 + 0.02], [hx + 0.015, 1.5, rz1 + 0.06], 0.006, 2);
    }
    s.box(black, [rx0 + 0.01, 0.02, rz0 + 0.1], [rx1 - 0.01, 0.15, rz1 - 0.1]); // compressor housing under
    s.add(sheetQuad(0.22, 0.28, SHEET.schedule, [rx0 + 0.35, 1.6, rz1 + 0.021], "+z"), paper);
    for (const [mx, my] of [[rx0 + 0.27, 1.72], [rx0 + 0.43, 1.72]]) {
      const mag = new THREE.CylinderGeometry(0.012, 0.012, 0.006, 12);
      mag.rotateX(Math.PI / 2);
      mag.translate(mx, my, rz1 + 0.024);
      s.add(mag, pal.pilotRed);
    }
    s.collider([rx0, 0, zFar - 0.3], [rx1, 2.0, rz1 + 0.07]);

    // Wire shelving on the rear wall: two 48 × 24 in chrome units with #10 cans (instanced) and bulk bins.
    const wire = (wx0: number, wz0: number) => {
      const wx1 = wx0 + 1.22, wz1 = wz0 + 0.61;
      for (const [px, pz] of [[wx0, wz0], [wx1, wz0], [wx0, wz1], [wx1, wz1]]) {
        const post = new THREE.CylinderGeometry(0.0125, 0.0125, 1.85, 12);
        post.translate(px, 0.925, pz);
        s.add(post, chrome);
      }
      for (const y of [0.15, 0.6, 1.05, 1.5]) {
        s.rbox(chrome, [wx0, y, wz0], [wx1, y + 0.03, wz1], 0.004, 1);
        for (let k = 1; k < 6; k++) s.box(chrome, [wx0, y + 0.028, wz0 + k * (0.61 / 6) - 0.003], [wx1, y + 0.034, wz0 + k * (0.61 / 6) + 0.003]);
      }
      s.collider([wx0 - 0.02, 0, zFar - 0.3], [wx1 + 0.02, 1.9, wz1 + 0.02]);
      return { wx0, wx1, wz0, wz1 };
    };
    const A = wire(0.4, zFar + 0.02), B = wire(1.8, zFar + 0.02);
    // #10 cans: one instanced mesh for the tin (bodies + chimes merged), one for the labels (two brands).
    {
      const R = 0.0785, Hc = 0.178;
      const tinParts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(R - 0.001, R - 0.001, Hc, 24, 1, true)];
      tinParts[0].translate(0, Hc / 2, 0);
      for (const ry of [0.0025, Hc - 0.0025]) {
        const chime = new THREE.TorusGeometry(R - 0.0015, 0.0025, 6, 24);
        chime.rotateX(Math.PI / 2);
        chime.translate(0, ry, 0);
        tinParts.push(chime);
      }
      const lidG = new THREE.CircleGeometry(R - 0.003, 24);
      lidG.rotateX(-Math.PI / 2);
      lidG.translate(0, Hc - 0.004, 0);
      tinParts.push(lidG);
      const tinGeo = mergeGeometries(tinParts.map((g) => (g.index ? g.toNonIndexed() : g)))!;
      const labelA = new THREE.CylinderGeometry(R, R, 0.15, 24, 1, true);
      uvIntoRect(labelA, SHEET.canA as unknown as [number, number, number, number]);
      labelA.translate(0, Hc / 2 - 0.002, 0);
      const labelB = new THREE.CylinderGeometry(R, R, 0.15, 24, 1, true);
      uvIntoRect(labelB, SHEET.canB as unknown as [number, number, number, number]);
      labelB.translate(0, Hc / 2 - 0.002, 0);
      const places: Array<[number, number, number, number]> = []; // x, y, z, turn
      for (const u of [A, B]) {
        for (const [y, n] of [[1.53, 6], [1.08, 6], [0.63, 4]] as const) {
          for (let i = 0; i < n; i++) places.push([u.wx0 + 0.12 + i * 0.19, y, u.wz0 + 0.14, 0.4 * i + (y > 1.2 ? 0.7 : 0)]);
          if (y > 1.0) for (let i = 0; i < n; i++) places.push([u.wx0 + 0.12 + i * 0.19, y, u.wz0 + 0.42, 1.1 * i]);
        }
      }
      const tins = new THREE.InstancedMesh(tinGeo, steel, places.length);
      const nA = Math.ceil(places.length / 2);
      const labA = new THREE.InstancedMesh(labelA, paper, nA), labB = new THREE.InstancedMesh(labelB, paper, places.length - nA);
      const m = new THREE.Matrix4();
      places.forEach(([x, y, z, turn], i) => {
        m.makeRotationY(turn).setPosition(x, y, z);
        tins.setMatrixAt(i, m);
        if (i % 2 === 0) labA.setMatrixAt(i >> 1, m);
        else labB.setMatrixAt(i >> 1, m);
      });
      for (const im of [tins, labA, labB]) {
        im.name = "kitchen-cans";
        im.castShadow = im === tins;
        im.receiveShadow = true;
        im.instanceMatrix.needsUpdate = true;
        parent.add(im);
      }
    }
    // Bulk bins (flour / sugar, white poly with clear lids) under the second unit, and a stack of Cambros.
    for (const bx of [B.wx0 + 0.02, B.wx0 + 0.55]) s.rbox(poly, [bx, 0.18, B.wz0 + 0.03], [bx + 0.48, 0.58, B.wz1 - 0.03], 0.01, 3);
    for (let i = 0; i < 3; i++) s.rbox(poly, [A.wx0 + 0.1, 0.18 + i * 0.14, A.wz0 + 0.06], [A.wx0 + 0.55, 0.31 + i * 0.14, A.wz1 - 0.06], 0.006, 2);
  }

  /* ---------------- the -x end: shelving with dry goods, mop bucket, wet-floor sign, trash ---------------- */
  {
    // Wire unit on the -x wall, deep in the room, past the swing of the door.
    const wx1 = kx0 + 0.63, wx0 = kx0 + 0.02, wz1 = zIn - 1.3, wz0 = wz1 - 1.22;
    for (const [px, pz] of [[wx0, wz0], [wx1, wz0], [wx0, wz1], [wx1, wz1]]) {
      const post = new THREE.CylinderGeometry(0.0125, 0.0125, 1.85, 12);
      post.translate(px, 0.925, pz);
      s.add(post, chrome);
    }
    for (const y of [0.15, 0.6, 1.05, 1.5]) {
      s.rbox(chrome, [wx0, y, wz0], [wx1, y + 0.03, wz1], 0.004, 1);
      s.rbox(poly, [wx0 + 0.04, y + 0.03, wz0 + 0.06], [wx1 - 0.04, y + 0.03 + 0.15, wz0 + 0.55], 0.008, 2);
      s.rbox(poly, [wx0 + 0.04, y + 0.03, wz1 - 0.55], [wx1 - 0.04, y + 0.03 + 0.15, wz1 - 0.06], 0.008, 2);
    }
    s.collider([kx0, 0, wz0 - 0.02], [wx1 + 0.02, 1.9, wz1 + 0.02]);
    // Mop bucket with wringer on casters, the mop standing in it; a wet-floor A-frame beside it.
    const mx = kx0 + 0.45, mz = zFar + 0.55;
    const bucket = lathe([V2(0, 0.06), V2(0.18, 0.06), V2(0.19, 0.08), V2(0.21, 0.5), V2(0.215, 0.52), V2(0.2, 0.52), V2(0.195, 0.09), V2(0, 0.09)], 28);
    bucket.translate(mx, 0, mz);
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe8b21c, roughness: 0.55 });
    s.add(bucket, yellow);
    s.rbox(yellow, [mx - 0.14, 0.5, mz - 0.22], [mx + 0.14, 0.72, mz - 0.02], 0.01, 2); // wringer
    for (const [cx, cz] of [[mx - 0.15, mz - 0.15], [mx + 0.15, mz - 0.15], [mx - 0.15, mz + 0.15], [mx + 0.15, mz + 0.15]]) {
      const caster = new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12);
      caster.rotateZ(Math.PI / 2);
      caster.translate(cx, 0.035, cz);
      s.add(caster, black);
    }
    const mop = new THREE.CylinderGeometry(0.012, 0.012, 1.4, 10);
    mop.rotateX(0.12);
    mop.translate(mx + 0.05, 0.95, mz + 0.05);
    s.add(mop, pal.laminateWood);
    s.collider([mx - 0.22, 0, mz - 0.24], [mx + 0.22, 0.7, mz + 0.22]);
    const sx = kx0 + 1.15, sz = zFar + 0.6;
    for (const side of [-1, 1]) {
      const face = new THREE.BoxGeometry(0.3, 0.62, 0.012);
      face.rotateX(side * 0.22);
      face.translate(sx, 0.31, sz + side * 0.075);
      s.add(face, yellow);
    }
    s.add(sheetQuad(0.24, 0.42, SHEET.wetFloor, [sx, 0.33, sz + 0.148], "+z"), paper);
    s.collider([sx - 0.16, 0, sz - 0.16], [sx + 0.16, 0.6, sz + 0.16]);
    // 32-gallon trash can with a bag turned over the rim, against the partition right of the door casing.
    const cxT = dx1 + 0.5, czT = zIn - 0.33;
    const body = lathe([V2(0, 0.01), V2(0.2, 0.01), V2(0.205, 0), V2(0.215, 0), V2(0.242, 0.66), V2(0.25, 0.68), V2(0.242, 0.7), V2(0.232, 0.7), V2(0.225, 0.68), V2(0, 0.68)], 36);
    body.translate(cxT, 0, czT);
    s.add(body, black);
    const liner = lathe([V2(0.2, 0.66), V2(0.238, 0.705), V2(0.252, 0.695), V2(0.256, 0.65), V2(0.25, 0.58), V2(0.246, 0.56)], 36);
    liner.translate(cxT, 0, czT);
    s.add(liner, plastic);
    s.collider([cxT - 0.26, 0, czT - 0.26], [cxT + 0.26, 0.7, czT + 0.26]);
  }

  /* ---------------- dish pit along the +x wall ---------------- */
  {
    const wx = kx1; // wall face
    // 3-compartment sink: 2.3 m along the wall, 3 bowls, a pre-rinse sprayer on a riser, drainboards both ends.
    const sz1 = zIn - 0.4, sz0 = sz1 - 2.3, sx0 = wx - 0.76, sx1 = wx - 0.01, top = 0.9;
    s.rbox(steel, [sx0, top - 0.06, sz0], [sx1, top, sz1], 0.004, 2);
    s.rbox(steel, [sx1 - 0.03, top, sz0], [sx1, top + 0.25, sz1], 0.003); // backsplash
    legs(sx0, sx1, sz0, sz1, top - 0.06, 0.02);
    for (let i = 0; i < 3; i++) {
      const bz0 = sz0 + 0.45 + i * 0.5, bz1 = bz0 + 0.45;
      s.box(black, [sx0 + 0.08, top - 0.35, bz0], [sx1 - 0.08, top - 0.005, bz1]);
      s.rbox(steel, [sx0 + 0.08, top - 0.36, bz0 - 0.005], [sx1 - 0.08, top - 0.34, bz1 + 0.005], 0.002); // bowl floor
      for (const [a, c] of [[[sx0 + 0.07, top - 0.36, bz0 - 0.005], [sx0 + 0.08, top, bz1 + 0.005]], [[sx1 - 0.08, top - 0.36, bz0 - 0.005], [sx1 - 0.07, top, bz1 + 0.005]], [[sx0 + 0.07, top - 0.36, bz0 - 0.005], [sx1 - 0.07, top, bz0]], [[sx0 + 0.07, top - 0.36, bz1], [sx1 - 0.07, top, bz1 + 0.005]]] as const)
        s.box(steel, a as V3, c as V3);
      // Water in the middle bowl.
      if (i === 1) {
        const water = new THREE.PlaneGeometry(sx1 - sx0 - 0.18, bz1 - bz0 - 0.02);
        water.rotateX(-Math.PI / 2);
        water.translate((sx0 + sx1) / 2, top - 0.12, (bz0 + bz1) / 2);
        s.add(water, pal.glassClear);
      }
    }
    // Faucets: two swing spouts on the splash; the pre-rinse riser with its coiled hose and spray valve.
    for (const fz of [sz0 + 0.925, sz0 + 1.675]) {
      const riser = new THREE.CylinderGeometry(0.012, 0.012, 0.25, 12);
      riser.translate(sx1 - 0.05, top + 0.12, fz);
      s.add(riser, chrome);
      const spout = new THREE.TorusGeometry(0.16, 0.009, 8, 24, Math.PI); // arc in XY: stands off the wall
      spout.translate(sx1 - 0.21, top + 0.25, fz);
      s.add(spout, chrome);
    }
    const pr = new THREE.CylinderGeometry(0.014, 0.014, 0.9, 12);
    pr.translate(sx1 - 0.05, top + 0.45, sz0 + 1.2);
    s.add(pr, chrome);
    const coil = new THREE.CylinderGeometry(0.03, 0.03, 0.45, 12, 1, true);
    coil.translate(sx1 - 0.05, top + 0.5, sz0 + 1.2);
    s.add(coil, plastic);
    const spring = new THREE.TorusGeometry(0.025, 0.006, 6, 20);
    spring.translate(sx1 - 0.05, top + 0.9, sz0 + 1.2);
    s.add(spring, chrome);
    s.rbox(black, [sx1 - 0.12, top + 0.42, sz0 + 1.25], [sx1 - 0.04, top + 0.52, sz0 + 1.33], 0.004, 2); // spray valve
    s.collider([sx0, 0, sz0], [sx1, top + 0.2, sz1]);
    // Dish rack of clean glasses on the wall shelf over the sink.
    const shy = 1.6;
    s.rbox(steel, [wx - 0.35, shy, sz0 + 0.1], [wx - 0.001, shy + 0.02, sz1 - 0.1], 0.003);
    for (const rz of [sz0 + 0.3, sz0 + 0.9]) {
      s.rbox(pal.laminatePanel, [wx - 0.33, shy + 0.02, rz], [wx - 0.03, shy + 0.12, rz + 0.5], 0.006, 2); // grey rack
      const glasses: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 4; i++)
        for (let k = 0; k < 6; k++) {
          const g = new THREE.CylinderGeometry(0.03, 0.026, 0.11, 12, 1, true);
          g.translate(wx - 0.29 + i * 0.075, shy + 0.175, rz + 0.05 + k * 0.08);
          glasses.push(g);
        }
      s.add(mergeGeometries(glasses)!, pal.glassClear);
    }
    // Hood-type dish machine in the rear corner, hood up, a rack half in on its table.
    const mx0 = wx - 0.72, mx1 = wx - 0.02, mz0 = zFar + 0.02, mz1 = mz0 + 0.7;
    s.rbox(steel, [mx0, 0.1, mz0], [mx1, 0.85, mz1], 0.005, 2); // base / tank
    legs(mx0, mx1, mz0, mz1, 0.1, 0.02);
    s.rbox(black, [mx0 + 0.04, 0.3, mz1 - 0.02], [mx0 + 0.3, 0.75, mz1], 0.004, 2); // control panel
    s.rbox(steel, [mx0 - 0.02, 1.35, mz0 - 0.02], [mx1 + 0.02, 1.95, mz1 + 0.02], 0.005, 2); // hood (raised)
    for (const [px, pz] of [[mx0 + 0.04, mz0 + 0.04], [mx1 - 0.04, mz0 + 0.04]]) {
      const post = new THREE.CylinderGeometry(0.02, 0.02, 1.25, 12);
      post.translate(px, 0.85 + 0.625, pz);
      s.add(post, steel);
    }
    s.rbox(steel, [mx0 + 0.02, 1.15, mz1], [mx1 - 0.02, 1.18, mz1 + 0.1], 0.004); // hood pull handle
    s.rbox(steel, [mx0, 0.85, mz1], [mx1, 0.88, mz1 + 0.6], 0.004, 2); // clean-side table
    s.rbox(pal.laminatePanel, [mx0 + 0.1, 0.88, mz1 - 0.25], [mx1 - 0.1, 0.98, mz1 + 0.25], 0.006, 2); // rack half in
    s.collider([mx0, 0, zFar - 0.3], [mx1, 2.0, mz1 + 0.6]);
    // Soiled dish table between the machine and the sink, a stack of dirty plates and a bus tub.
    const tz0 = mz1 + 0.6, tz1 = sz0 - 0.02;
    s.rbox(steel, [wx - 0.76, 0.84, tz0], [wx - 0.01, 0.9, tz1], 0.004, 2);
    legs(wx - 0.76, wx - 0.01, tz0, tz1, 0.84);
    s.rbox(steel, [wx - 0.03, 0.9, tz0], [wx - 0.001, 1.05, tz1], 0.003);
    const dirty: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const p = lathe([V2(0, 0), V2(0.09, 0), V2(0.125, 0.018), V2(0.13, 0.022), V2(0.125, 0.02), V2(0.088, 0.004), V2(0, 0.004)], 28);
      p.rotateY(i * 0.7);
      p.translate(wx - 0.4 + Math.sin(i) * 0.008, 0.9 + i * 0.013, tz0 + 0.3);
      dirty.push(p);
    }
    s.add(mergeGeometries(dirty)!, pal.ceramic);
    s.rbox(pal.laminatePanel, [wx - 0.7, 0.9, tz1 - 0.55], [wx - 0.1, 1.08, tz1 - 0.05], 0.008, 2);
    s.collider([wx - 0.78, 0, tz0], [wx, 1.0, tz1]);
  }

  /* ---------------- coffee / back-bar shelf on the partition between the pass and the sink ---------------- */
  {
    const bx0 = 3.4, bx1 = 4.4, bz1 = zIn - 0.01, bz0 = bz1 - 0.6;
    s.rbox(steel, [bx0, 0.15, bz0], [bx1, 0.9, bz1], 0.004, 2);
    legs(bx0, bx1, bz0, bz1, 0.15);
    s.rbox(steel, [bx0, 0.86, bz0 - 0.05], [bx1, 0.9, bz1], 0.004, 2);
    s.rbox(steel, [bx0, 1.5, bz1 - 0.3], [bx1, 1.52, bz1], 0.003); // shelf
    for (let i = 0; i < 3; i++) {
      const dec = new THREE.CylinderGeometry(0.075, 0.07, 0.17, 20, 1, true);
      dec.translate(bx0 + 0.2 + i * 0.3, 0.985, bz1 - 0.3);
      s.add(dec, pal.glassClear);
    }
    s.rbox(black, [bx0 + 0.15, 0.9, bz1 - 0.42], [bx1 - 0.15, 0.92, bz1 - 0.15], 0.004); // warmer plate
    s.collider([bx0, 0, bz0 - 0.05], [bx1, 0.9, bz1]);
  }

  /* ---------------- build ---------------- */
  const group = new THREE.Group();
  group.name = "kitchen";
  s.build(group, { name: "kitchen" });
  parent.add(group);

  /* ---------------- fill light: two shadowless fills under the troffers, one warm under the hood ---------------- */
  // Lighting.ts is untouched (its owner's); the kitchen's fill lives here. 4100 K troffer white at
  // the two troffer centres (each 2 × 32 W ≈ 5,600 lm) and a warm 2 × 60 W pool under the hood.
  const lights: THREE.Light[] = [];
  const TROFFER = new THREE.Color().setRGB(1, 0.97, 0.9, THREE.SRGBColorSpace);
  for (const [tx, tz] of [[-3.0, zIn - 2.1], [2.6, zIn - 2.1]] as const) {
    const l = new THREE.PointLight(TROFFER, nits(3 * 5600 / (4 * Math.PI)), 7, 2);
    l.position.set(tx, CH - 0.15, tz);
    l.name = "kitchen-troffer";
    lights.push(l);
  }
  {
    const l = new THREE.PointLight(new THREE.Color().setRGB(1, 0.86, 0.66, THREE.SRGBColorSpace), nits(1600 / (4 * Math.PI)), 3.5, 2);
    l.position.set(-0.1, 1.85, zIn - 0.7);
    l.name = "kitchen-hood-lamps";
    lights.push(l);
  }
  for (const l of lights) {
    l.castShadow = false;
    parent.add(l);
  }

  return {
    colliders: s.colliders,
    envMetals: [steel, greasy],
    points: { hood: vec(0.2, 1.4, zIn - 0.6), reachIn: vec(-0.8, 0.3, zFar + 0.4), sink: vec(kx1 - 0.4, 1.0, zIn - 1.6) },
    lights,
  };
}
