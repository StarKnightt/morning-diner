/**
 * Procedural canvas textures. System 1 placeholders: enough variation that
 * surfaces do not read as flat CG, nothing more. System 5 replaces these with
 * the real material set.
 */
import * as THREE from "three";
import { makeFbm, makeFbm2, makeRng } from "../core/rng";
import { BACK_BAR, BOOTH, COUNTER, DOOR, KITCHEN_DOOR, ROOM, STOOL, WINDOW } from "../scene/layout";

function canvas(w: number, h: number) {
  // Main thread: an HTMLCanvasElement. Inside the texture worker (no `document`): an
  // OffscreenCanvas — same 2D API, same rasteriser, byte-identical output.
  const c = (typeof document === "undefined" ? new OffscreenCanvas(w, h) : document.createElement("canvas")) as HTMLCanvasElement;
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas context unavailable");
  return { c, ctx };
}

function finish(c: HTMLCanvasElement, srgb: boolean, anisotropy: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

export interface TextureSet {
  map: THREE.Texture;
  roughnessMap?: THREE.Texture;
  normalMap?: THREE.Texture;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Wrapped height field (any unit) → tangent-space normal map, same encoding as
 * every other generator here (r = −∂h/∂x, g = +∂h/∂y in canvas rows). `scale`
 * converts height units per texel into slope.
 */
function normalFromHeight(hf: Float32Array, w: number, h: number, scale: number, aniso = 8): THREE.CanvasTexture {
  const { c, ctx } = canvas(w, h);
  const img = ctx.createImageData(w, h);
  const H = (x: number, y: number) => hf[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * scale, dy = (H(x, y + 1) - H(x, y - 1)) * scale;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * w + x) * 4;
      img.data[o] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[o + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[o + 2] = (1 / len) * 255;
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return finish(c, false, aniso);
}

/** Grey (0..1) field → linear single-channel canvas texture. */
function greyFromField(f: Float32Array, w: number, h: number, aniso = 8): THREE.CanvasTexture {
  const { c, ctx } = canvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = clamp01(f[i]) * 255;
    const o = i * 4;
    img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, false, aniso);
}

/** Distance (m) from a world point to a polyline. */
function polylineDist(pts: Array<[number, number]>, x: number, z: number): number {
  let best = 1e9;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / l2);
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

/**
 * Where the floor is walked, sheltered and swept — world metres, so the one
 * non-repeating floor canvas can carry the room's own history. Plain data so it
 * survives the worker boundary. See `dinerFloorWear()` for the diner's layout.
 */
export interface FloorWear {
  /** World x of canvas u = 0 and world z of canvas v = 0 (v runs toward −z). */
  originX: number;
  originZ: number;
  metresPerTile: number;
  /** Traffic lanes: centre polyline, half-width (m) and strength 0..1. */
  lanes: Array<{ pts: Array<[number, number]>; half: number; k: number }>;
  /** Interior wall/plinth lines the broom never quite reaches (dust gathers in the grout). */
  walls: Array<[number, number, number, number]>;
  /** Rectangles under furniture (x0, z0, x1, z1): never walked, keep their factory sheen. */
  sheltered: Array<[number, number, number, number]>;
  /** One hairline crack: start point, length (m), heading (deg). */
  crack: { x: number; z: number; len: number; deg: number };
  seed: number;
}

/**
 * 300 mm glazed ceramic checker with a 6 mm sanded grout joint (TCNA: 1/4" is
 * the standard joint for 12" quarry/ceramic floor tile; grout sits ~1.5 mm below
 * the glaze). `tilesX` × `tilesY` tiles on the canvas, `tilePx` per tile, so
 * one canvas is the whole floor and everything in `wear` is authored where it
 * happens: lanes (matte, greyed whites / scuffed-lighter blacks, heel marks),
 * factory sheen under the booths, dust-filled grout along the walls, one
 * hairline crack. Tile-to-tile tone ±1.5 % (whites) / ±3 % (blacks), a hint of
 * cream in the whites and blue-black in the blacks. The grout *depth* lives in
 * `normalMap`, a separate 2 × 2-tile detail canvas (see `floorGrout`) — this
 * canvas is 5.9 mm/texel, far too coarse for a joint profile.
 */
export function checkerFloor(tilesX: number, tilesY: number, tilePx: number, anisotropy: number, wear?: FloorWear): TextureSet {
  const w = tilesX * tilePx, h = tilesY * tilePx;
  const { c, ctx } = canvas(w, h);
  const rng = makeRng(wear?.seed ?? 1234);
  const fbm = makeFbm(77, 8, 4);
  const dirt = makeFbm(78, 40, 3);
  const grout = Math.max(1, Math.round(tilePx * 0.02)); // 6 mm at 51 px / 300 mm
  const mPerPx = wear ? wear.metresPerTile / tilePx : 0.3 / tilePx;
  const toWorld = (px: number, py: number): [number, number] =>
    wear ? [wear.originX + px * mPerPx, wear.originZ + py * mPerPx] : [px * mPerPx, py * mPerPx];

  // Grout: sanded cementitious grey, already a shade darker than it would be in the open
  // because the joint is a 1.5 mm trench (baked AO; the normal map supplies the slope).
  ctx.fillStyle = "#7c766c";
  ctx.fillRect(0, 0, w, h);
  const isBlack = new Uint8Array(tilesX * tilesY);
  const tone = new Float32Array(tilesX * tilesY);
  for (let ty = 0; ty < tilesY; ty++)
    for (let tx = 0; tx < tilesX; tx++) {
      const black = (tx + ty) % 2 === 0;
      const v = (rng() - 0.5) * 2;
      isBlack[ty * tilesX + tx] = black ? 1 : 0;
      tone[ty * tilesX + tx] = v;
      let r: number, g: number, b: number;
      if (black) {
        const base = 26 * (1 + v * 0.03);
        r = base * 0.96; g = base * 0.98; b = base * 1.05; // blue-black glaze
      } else {
        const base = 220 * (1 + v * 0.015);
        r = base; g = base * 0.985; b = base * 0.95; // warm off-white
      }
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(tx * tilePx + grout, ty * tilePx + grout, tilePx - grout * 2, tilePx - grout * 2);
    }

  // The slow fields (fbm, lane distances, wall distances) live on a 4 px grid — 23 mm on the
  // floor, well under the 0.3–0.4 m feather of any lane or dust falloff — and are bilinearly
  // sampled per pixel. (Per-pixel polyline distances were 10 s of the boot; this is 0.5 s.)
  const G = 4, gw = Math.ceil(w / G) + 1, gh = Math.ceil(h / G) + 1;
  const gN = new Float32Array(gw * gh), gFine = new Float32Array(gw * gh), gLane = new Float32Array(gw * gh), gDust = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      const x = gx * G, y = gy * G, u = x / w, v = y / h, k = gy * gw + gx;
      gN[k] = fbm(u, v) - 0.5;
      gFine[k] = dirt(u, v) - 0.5;
      if (!wear) continue;
      const [wx, wz] = toWorld(x, y);
      let lane = 0;
      for (const L of wear.lanes) {
        const dist = polylineDist(L.pts, wx, wz);
        lane = Math.max(lane, L.k * (1 - smoothstep(L.half * 0.5, L.half * 1.4, dist)));
      }
      gLane[k] = lane * (0.75 + 0.5 * dirt(u + 0.37, v));
      let wallD = 1e9;
      for (const [x0, z0, x1, z1] of wear.walls) wallD = Math.min(wallD, polylineDist([[x0, z0], [x1, z1]], wx, wz));
      gDust[k] = (1 - smoothstep(0.08, 0.4, wallD)) * (0.5 + 0.5 * dirt(u, v + 0.61));
    }
  const sample = (f: Float32Array, x: number, y: number) => {
    const fx = x / G, fy = y / G, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const k = y0 * gw + x0;
    return (f[k] * (1 - tx) + f[k + 1] * tx) * (1 - ty) + (f[k + gw] * (1 - tx) + f[k + gw + 1] * tx) * ty;
  };

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const rough = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ty = Math.floor(y / tilePx), gy = y % tilePx < grout || y % tilePx >= tilePx - grout;
    for (let x = 0; x < w; x++) {
      const tx = Math.floor(x / tilePx), gx = x % tilePx < grout || x % tilePx >= tilePx - grout;
      const i = y * w + x, o = i * 4;
      const inGrout = gx || gy;
      const black = isBlack[ty * tilesX + tx] === 1;
      const n = sample(gN, x, y);
      const fine = sample(gFine, x, y);
      // Roughness (× material 1.0): glazed whites ~0.37, blacks ~0.47 (dark glaze shows every
      // haze), grout 0.9. Whole-floor mottle ±0.06.
      let r = inGrout ? 0.9 : (black ? 0.47 : 0.37) + tone[ty * tilesX + tx] * 0.03 + n * 0.12 + fine * 0.04;
      let k = 1 + n * 0.04; // faint large-scale mottle in the glaze/dirt film
      let greyMix = 0; // pull toward the dirt-grey of a walked lane
      if (wear) {
        const [wx, wz] = toWorld(x, y);
        const lane = sample(gLane, x, y);
        let shelter = 0;
        for (const [x0, z0, x1, z1] of wear.sheltered)
          if (wx > x0 && wx < x1 && wz > z0 && wz < z1) shelter = 1;
        const dust = sample(gDust, x, y);
        if (inGrout) {
          // Dust and mop residue fill the joint near the walls: pale, matte.
          const dr = 194, dg = 186, db = 172;
          const a = dust * 0.8;
          d[o] = d[o] * (1 - a) + dr * a; d[o + 1] = d[o + 1] * (1 - a) + dg * a; d[o + 2] = d[o + 2] * (1 - a) + db * a;
          r = 0.9 + dust * 0.08;
        } else {
          // Traffic: the glaze dulls (roughness up), whites grey off, blacks scuff lighter.
          r += lane * 0.28 - shelter * 0.09;
          greyMix = lane * (black ? 0.16 : 0.1);
          k *= 1 + dust * 0.03 * (black ? 2 : 1); // a dust film reads lighter on the blacks
        }
      }
      if (greyMix > 0) {
        const gr = 128, gg = 124, gb = 118;
        d[o] = d[o] * (1 - greyMix) + gr * greyMix; d[o + 1] = d[o + 1] * (1 - greyMix) + gg * greyMix; d[o + 2] = d[o + 2] * (1 - greyMix) + gb * greyMix;
      }
      d[o] = Math.min(255, d[o] * k); d[o + 1] = Math.min(255, d[o + 1] * k); d[o + 2] = Math.min(255, d[o + 2] * k);
      rough[i] = r;
    }
  }
  ctx.putImageData(img, 0, 0);

  if (wear) {
    // Heel and chair-leg scuffs: short rubber arcs, dark on the whites and grey on the blacks,
    // two thirds of them inside the lanes.
    const toPx = (wx: number, wz: number): [number, number] => [(wx - wear.originX) / mPerPx, (wz - wear.originZ) / mPerPx];
    ctx.lineCap = "round";
    for (let s = 0; s < 220; s++) {
      let wx: number, wz: number;
      if (s % 3 !== 0 && wear.lanes.length) {
        const L = wear.lanes[Math.floor(rng() * wear.lanes.length)];
        const seg = Math.floor(rng() * (L.pts.length - 1));
        const t = rng();
        wx = L.pts[seg][0] + (L.pts[seg + 1][0] - L.pts[seg][0]) * t + (rng() - 0.5) * L.half * 2.2;
        wz = L.pts[seg][1] + (L.pts[seg + 1][1] - L.pts[seg][1]) * t + (rng() - 0.5) * L.half * 2.2;
      } else {
        wx = wear.originX + rng() * w * mPerPx;
        wz = wear.originZ + rng() * h * mPerPx;
      }
      const [px, py] = toPx(wx, wz);
      if (px < 2 || py < 2 || px > w - 2 || py > h - 2) continue;
      const black = isBlack[Math.floor(py / tilePx) * tilesX + Math.floor(px / tilePx)] === 1;
      const len = (0.03 + rng() * 0.12) / mPerPx, ang = rng() * Math.PI * 2, bend = (rng() - 0.5) * 1.2;
      ctx.strokeStyle = black ? `rgba(150,146,140,${0.14 + rng() * 0.18})` : `rgba(40,34,28,${0.16 + rng() * 0.22})`;
      ctx.lineWidth = 1 + rng() * 1.6; // 6–15 mm
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + Math.cos(ang + bend) * len * 0.5, py + Math.sin(ang + bend) * len * 0.5, px + Math.cos(ang) * len, py + Math.sin(ang) * len);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    // Hairline crack: a jittered polyline, dark with a light catch along one edge.
    const { x: cx, z: cz, len, deg } = wear.crack;
    const [sx, sy] = toPx(cx, cz);
    const a = THREE.MathUtils.degToRad(deg);
    const steps = 14;
    const path: Array<[number, number]> = [];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const wob = Math.sin(t * 9.1) * 0.006 + (rng() - 0.5) * 0.006;
      path.push([sx + (Math.cos(a) * len * t - Math.sin(a) * wob) / mPerPx, sy + (Math.sin(a) * len * t + Math.cos(a) * wob) / mPerPx]);
    }
    for (const [col, off, lw] of [["rgba(255,255,255,0.22)", 0.7, 0.8], ["rgba(28,24,20,0.7)", 0, 0.75]] as Array<[string, number, number]>) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      path.forEach(([px, py], i) => (i ? ctx.lineTo(px + off, py + off) : ctx.moveTo(px + off, py + off)));
      ctx.stroke();
    }
    // The crack also breaks the glaze: matte along it.
    for (const [px, py] of path) {
      const i = Math.round(py) * w + Math.round(px);
      if (i >= 0 && i < rough.length) rough[i] = Math.max(rough[i], 0.7);
    }
  }
  return { map: finish(c, true, anisotropy), roughnessMap: greyFromField(rough, w, h, anisotropy), normalMap: floorGrout(1024, wear?.seed ?? 1234) };
}

/**
 * The diner's floor history from the plan (layout.ts): the customer aisle between
 * the stools and the booths, the standing zone at the counter, the path in from
 * the door, the staff run behind the counter, dust along the wall lines and the
 * counter/booth plinths, factory sheen under the booth seats and the back bar,
 * one crack by the door where the slab moves. Not a texture generator: the
 * TextureBank passes it straight through.
 */
export function dinerFloorWear(): FloorWear {
  const { halfX, zBack, zFront } = ROOM;
  const stoolZ = STOOL.z;
  const aisleZ = (BOOTH.zInner + COUNTER.topFrontZ + STOOL.seatDiameter / 2 + 0.1) / 2; // ≈ 1.24
  const doorX = DOOR.centerX;
  const kitchenX = KITCHEN_DOOR.centerX;
  const staffZ = (BACK_BAR.zFront + (COUNTER.topFrontZ - COUNTER.overhang - COUNTER.dieDepth)) / 2; // ≈ −1.25
  return {
    originX: -halfX,
    originZ: zBack, // canvas row 0 = texture v 1 = the kitchen-side edge (flipY; Shell.ts puts v 0 at zFront)
    metresPerTile: 0.3,
    lanes: [
      { pts: [[-halfX + 0.4, aisleZ], [COUNTER.xMax + 0.3, aisleZ], [doorX - 0.3, aisleZ + 0.15]], half: 0.42, k: 1 },
      { pts: [[doorX, zFront - 0.05], [doorX - 0.1, zFront - 0.7], [doorX - 0.35, aisleZ + 0.15]], half: 0.32, k: 1 },
      { pts: [[COUNTER.xMin + 0.5, stoolZ + 0.32], [COUNTER.xMax - 0.2, stoolZ + 0.32]], half: 0.24, k: 0.55 },
      { pts: [[kitchenX, zBack + 0.05], [kitchenX + 0.2, staffZ], [BACK_BAR.xMax - 0.3, staffZ]], half: 0.34, k: 0.6 },
      // Short spurs from the aisle into each booth (people slide in and out).
      ...WINDOW.centersX.map((cx) => ({ pts: [[cx, aisleZ + 0.2], [cx, BOOTH.zInner + 0.1]] as Array<[number, number]>, half: 0.22, k: 0.45 })),
    ],
    walls: [
      [-halfX, zBack, halfX, zBack],
      [-halfX, zBack, -halfX, zFront],
      [halfX, zBack, halfX, zFront],
      [-halfX, zFront, halfX, zFront],
      // Counter die (customer face) and the booth plinth line
      [COUNTER.xMin, COUNTER.topFrontZ - COUNTER.overhang, COUNTER.xMax, COUNTER.topFrontZ - COUNTER.overhang],
      [-halfX, BOOTH.zInner, halfX, BOOTH.zInner],
      [BACK_BAR.xMin, BACK_BAR.zFront, BACK_BAR.xMax, BACK_BAR.zFront],
    ],
    sheltered: [
      [-halfX, BOOTH.zInner + 0.05, DOOR.hingeX - 0.9, zFront],
      [COUNTER.xMin, COUNTER.topFrontZ - COUNTER.overhang - COUNTER.dieDepth, COUNTER.xMax, COUNTER.topFrontZ - COUNTER.overhang],
      [BACK_BAR.xMin, zBack, BACK_BAR.xMax, BACK_BAR.zFront],
    ],
    crack: { x: doorX - 0.62, z: zFront - 0.95, len: 0.62, deg: 118 },
    seed: 1234,
  };
}

/**
 * Grout-joint relief for `checkerFloor`: a 2 × 2-tile canvas (`size` px over
 * 600 mm → 0.59 mm/texel) tiled with repeat = tiles / 2. Joint 6 mm wide, 1.5 mm
 * deep with a 1 mm rounded glaze arris, ±0.25 mm lippage between the four tiles,
 * orange-peel waviness on the glaze (±0.03 mm at ~30 mm) and a per-texel
 * 0.01 mm speckle so the glaze highlight never reads as a mirror.
 */
export function floorGrout(size: number, seed: number): THREE.Texture {
  const mmPerPx = 600 / size;
  const tile = size / 2;
  const groutPx = 6 / mmPerPx, arris = 1 / mmPerPx;
  const rng = makeRng(seed + 99);
  const wave = makeFbm(seed + 3, 20, 3);
  const lip = [0.25, -0.15, 0.1, -0.25].map((v) => v + (rng() - 0.5) * 0.1);
  const hf = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const tx = Math.floor(x / tile), ty = Math.floor(y / tile);
      // Distance to the nearest joint centre line (joints run along the tile boundaries).
      const ex = Math.min(x % tile, tile - (x % tile)), ey = Math.min(y % tile, tile - (y % tile));
      const e = Math.min(ex, ey); // px from the tile edge
      const half = groutPx / 2;
      let hgt: number;
      if (e < half) hgt = -1.5 + 0.3 * (1 - e / half) * (rng() - 0.5); // sandy joint floor
      else hgt = -1.5 * (1 - smoothstep(half, half + arris, e)) + lip[ty * 2 + tx];
      hgt += (wave(x / size, y / size) - 0.5) * 0.06 + (rng() - 0.5) * 0.01;
      hf[y * size + x] = hgt;
    }
  return normalFromHeight(hf, size, size, 0.5 / mmPerPx);
}

/** Layout of the things a painted wall carries; canvas u/v fractions, `metres` per canvas edge. */
export interface WallOpts {
  metres: number;
  /** Drywall joints (taped, feathered 250 mm compound) at these canvas u / v fractions. */
  seamsU?: number[];
  seamsV?: number[];
  /** Scuff band (chair backs, booth caps): v range and marks per metre of wall. */
  scuff?: { v0: number; v1: number; perMetre: number };
  /** Sun-fade halo beside window jambs: jamb u positions, reach (u), and the v range of the light. */
  fade?: { jambsU: number[]; reach: number; v0: number; v1: number; amount: number };
}

/**
 * Flat latex over roller-stippled drywall. `hex` is the base colour; the canvas
 * covers `opts.metres` (default 2 m). Albedo: ±strength mottle, feathered joint
 * compound a hair lighter (it takes paint flatter than the stippled field), dark
 * grey scuffs and rub marks in the chair-height band, a 2–3 % sun-fade halo beside
 * the window jambs. Roughness (× material): 1.0 over the field, 0.93 on the
 * seams (compound flashing), 0.84 where scuffs burnished the flat paint, ±0.03
 * sheen drift at 0.3–0.8 m. Stipple relief is `wallStipple`, a separate 0.6 m
 * detail canvas.
 */
export function paintedWall(hex: string, size: number, seed: number, strength = 0.06, opts?: WallOpts): TextureSet {
  const { c, ctx } = canvas(size, size);
  const metres = opts?.metres ?? 2;
  const pxPerM = size / metres;
  const rng = makeRng(seed + 17);
  const fbm = makeFbm(seed, 6, 5);
  const fine = makeFbm(seed + 7, 64, 2);
  const sheen = makeFbm(seed + 21, 4, 3);
  const base = new THREE.Color(hex);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const rough = new Float32Array(size * size);
  const seamW = 0.125 * pxPerM; // half-width of the feathered compound band (250 mm)
  const seamAt = (p: number, list: number[] | undefined) => {
    let k = 0;
    if (list) for (const s of list) {
      let dp = Math.abs(p - s * size);
      dp = Math.min(dp, size - dp);
      k = Math.max(k, 1 - smoothstep(seamW * 0.3, seamW, dp));
    }
    return k;
  };
  // Canvas row y is texture v = 1 - y / size (CanvasTexture flipY), i.e. wall height metres * (1 - y / size).
  for (let y = 0; y < size; y++) {
    const sv = seamAt(size - y, opts?.seamsV);
    const v = 1 - y / size;
    for (let x = 0; x < size; x++) {
      const n = (fbm(x / size, y / size) - 0.5) * strength + (fine(x / size, y / size) - 0.5) * strength * 0.5;
      const seam = Math.max(sv, seamAt(x, opts?.seamsU));
      let k = 1 + n + seam * 0.008;
      if (opts?.fade) {
        const f = opts.fade;
        if (v > f.v0 && v < f.v1) {
          let near = 0;
          for (const j of f.jambsU) {
            let du = Math.abs(x / size - j);
            du = Math.min(du, 1 - du);
            near = Math.max(near, 1 - smoothstep(0, f.reach, du));
          }
          k *= 1 + f.amount * near * smoothstep(f.v0, f.v0 + 0.08, v) * (1 - smoothstep(f.v1 - 0.08, f.v1, v));
        }
      }
      const i = (y * size + x) * 4;
      d[i] = Math.min(255, Math.max(0, base.r * k * 255));
      d[i + 1] = Math.min(255, Math.max(0, base.g * k * 255));
      d[i + 2] = Math.min(255, Math.max(0, base.b * k * 255));
      d[i + 3] = 255;
      rough[y * size + x] = 0.985 + (sheen(x / size, y / size) - 0.5) * 0.05 - seam * 0.07;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (opts?.scuff) {
    // Rub marks where chair backs and booth caps meet the wall: soft grey-brown smudges,
    // mostly horizontal, 20–150 mm long × 8–25 mm tall (a chair-back rail drags, it does not
    // scratch), plus a few small dark knocks. Burnished paint under a smudge is glossier.
    const { v0, v1, perMetre } = opts.scuff;
    const n = Math.round(perMetre * metres);
    ctx.lineCap = "round";
    const marks: Array<[number, number, number, number, number]> = [];
    ctx.lineCap = "butt";
    for (let s = 0; s < n; s++) {
      const x = rng() * size, y = (1 - (v0 + rng() * (v1 - v0))) * size;
      const dark = rng() < 0.25;
      const len = (dark ? 0.005 + rng() * 0.02 : 0.03 + rng() * 0.12) * pxPerM, ang = (rng() - 0.5) * 0.25;
      const lw = (dark ? 0.004 : 0.008 + rng() * 0.017) * pxPerM;
      if (dark) {
        // A knock: small, dark, slightly ragged
        ctx.fillStyle = `rgba(40,34,28,${0.25 + rng() * 0.25})`;
        ctx.beginPath();
        ctx.ellipse(x, y, len * 0.5, lw * 0.5, ang, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // A rub: a bundle of 6–10 thin, uneven, low-alpha passes with ragged ends, so the mark is
        // densest in the middle and feathers out — not a capsule.
        const passes = 6 + Math.floor(rng() * 5);
        for (let k = 0; k < passes; k++) {
          const oy = (rng() - 0.5) * lw, t0 = rng() * 0.3, t1 = 0.7 + rng() * 0.3;
          ctx.strokeStyle = `rgba(96,86,74,${0.025 + rng() * 0.04})`;
          ctx.lineWidth = lw * (0.15 + rng() * 0.3);
          ctx.shadowColor = ctx.strokeStyle;
          ctx.shadowBlur = lw * 0.3;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(ang) * len * t0, y + oy + Math.sin(ang) * len * t0);
          ctx.lineTo(x + Math.cos(ang) * len * t1, y + oy + Math.sin(ang) * len * t1 + (rng() - 0.5) * lw * 0.3);
          ctx.stroke();
        }
      }
      marks.push([x, y, len, ang, lw]);
    }
    ctx.shadowBlur = 0;
    for (const [x, y, len, ang, lw] of marks) {
      const R = Math.ceil(lw * 0.8);
      for (let t = 0; t < len; t += 1) {
        const px = Math.round(x + Math.cos(ang) * t) % size, py = Math.round(y + Math.sin(ang) * t) % size;
        for (let dy = -R; dy <= R; dy++) {
          const i = ((py + dy + size) % size) * size + ((px + size) % size);
          rough[i] = Math.min(rough[i], 0.86 + (Math.abs(dy) / (R + 1)) * 0.1);
        }
      }
    }
  }
  return { map: finish(c, true, 4), roughnessMap: greyFromField(rough, size, size, 4) };
}

/**
 * Roller stipple: a 3/8" nap leaves 1–3 mm domes of paint at ~60 % coverage,
 * 0.1–0.2 mm high (why flat walls still glint at grazing light). Detail canvas
 * covering 0.6 m; tiled with repeat = metres / 0.6 on the wall UVs. Cells on a
 * jittered 2.2 mm grid, each a dome of random height, 15 % skipped, on a 0.05 mm
 * fbm swell so the field never reads as a regular dot screen.
 */
export function wallStipple(size: number, seed: number): THREE.Texture {
  const mmPerPx = 600 / size;
  const rng = makeRng(seed);
  const swell = makeFbm(seed + 5, 12, 3);
  const cell = 2.2 / mmPerPx;
  const grid = Math.max(4, Math.round(size / cell));
  const step = size / grid;
  const cx = new Float32Array(grid * grid), cy = new Float32Array(grid * grid), cr = new Float32Array(grid * grid), ch = new Float32Array(grid * grid);
  for (let j = 0; j < grid; j++)
    for (let i = 0; i < grid; i++) {
      const k = j * grid + i;
      cx[k] = (i + 0.1 + rng() * 0.8) * step;
      cy[k] = (j + 0.1 + rng() * 0.8) * step;
      cr[k] = (0.6 + rng() * 0.9) / mmPerPx; // dome radius 0.6–1.5 mm
      ch[k] = rng() < 0.15 ? 0 : 0.06 + rng() * 0.14; // height mm
    }
  const hf = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const gj = Math.floor(y / step);
    for (let x = 0; x < size; x++) {
      const gi = Math.floor(x / step);
      let hgt = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ii = (gi + di + grid) % grid, jj = (gj + dj + grid) % grid, k = jj * grid + ii;
          const px = cx[k] + (gi + di - ii) * step, py = cy[k] + (gj + dj - jj) * step;
          const dd = Math.hypot(px - x, py - y) / cr[k];
          if (dd < 1) hgt = Math.max(hgt, ch[k] * Math.sqrt(1 - dd * dd));
        }
      hf[y * size + x] = hgt + (swell(x / size, y / size) - 0.5) * 0.1;
    }
  }
  return normalFromHeight(hf, size, size, 0.5 / mmPerPx, 4);
}

/**
 * One 600 mm mineral-fibre tile, fissured pattern (Armstrong Cortega / USG
 * Fissured class): random worm-track fissures 2–8 mm long × 0.5–1.2 mm wide,
 * 0.6–1.2 mm deep, ~1 per cm²; soft 1.5–2.5 mm perforations 1 mm deep at ~0.4
 * per cm²; painted white (Y ≈ 0.86) with a ±3 % fibre mottle. Depth is carried
 * as height → normal, and as shading (the fissure floor is out of the light), so
 * nothing is a black dot. All four tegular edges take the same faint reveal
 * shade (the old two-edge gradient rotated with the instance quarter-turns and
 * read as four different light directions). `stain`: a 25–40 cm water stain —
 * tan wash inside, dark tide line at the rim, two fainter inner tide lines.
 */
export function acousticTile(size: number, seed = 555, stain = false): TextureSet {
  const { c, ctx } = canvas(size, size);
  const rng = makeRng(seed);
  const fbm = makeFbm(seed - 524, 4, 4);
  const fibre = makeFbm(seed + 2, 90, 2);
  const mmPerPx = 600 / size;
  const hf = new Float32Array(size * size);
  // Fissures: quadratic worm tracks stamped into the height field with soft edges.
  const stamp = (x: number, y: number, r: number, depth: number) => {
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const dd = Math.hypot(dx, dy) / r;
        if (dd >= 1) continue;
        const i = ((y + dy + size) % size) * size + ((x + dx + size) % size);
        hf[i] = Math.min(hf[i], -depth * (1 - dd * dd));
      }
  };
  const fissures = Math.round(36 * 36 * 1.1);
  for (let f = 0; f < fissures; f++) {
    const x0 = rng() * size, y0 = rng() * size;
    const len = (2 + rng() * 6) / mmPerPx, a = rng() * Math.PI, bend = (rng() - 0.5) * 1.6;
    const wdt = (0.7 + rng() * 0.8) / mmPerPx / 2, depth = 0.7 + rng() * 0.7;
    const steps = Math.max(3, Math.round(len));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, aa = a + bend * (t - 0.5);
      stamp(Math.round(x0 + Math.cos(aa) * len * t), Math.round(y0 + Math.sin(aa) * len * t), wdt * (0.7 + 0.3 * Math.sin(t * Math.PI)), depth);
    }
  }
  for (let p = 0; p < Math.round(36 * 36 * 0.4); p++) stamp(Math.round(rng() * size), Math.round(rng() * size), (0.75 + rng() * 0.5) / mmPerPx, 1);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const rough = new Float32Array(size * size);
  const edge = 0.012 * size;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const n = (fbm(x / size, y / size) - 0.5) * 0.06 + (fibre(x / size, y / size) - 0.5) * 0.05;
      hf[i] += (fibre(x / size + 0.5, y / size) - 0.5) * 0.08; // fibre nap
      // Depth shading: the floor of a fissure is in its own shadow (a 1 mm-wide, 1 mm-deep slot
      // under diffuse light from above keeps roughly a third of the light off its floor).
      const shade = 1 + Math.max(-1.3, hf[i]) * 0.3;
      const e = Math.min(x, y, size - 1 - x, size - 1 - y);
      const reveal = 1 - 0.1 * (1 - smoothstep(0, edge, e));
      const v = 226 * (1 + n) * shade * reveal;
      d[i * 4] = v; d[i * 4 + 1] = v * 0.985; d[i * 4 + 2] = v * 0.955; d[i * 4 + 3] = 255;
      rough[i] = 0.9 + n * 0.5 - hf[i] * 0.04;
    }
  if (stain) {
    // Water stain: an off-centre blob whose radius wanders with angle; the wash inside is a
    // weak tan, the rim a darker tide line (minerals dry at the edge), plus 2 fainter inner rims.
    const cx = size * (0.38 + rng() * 0.2), cy = size * (0.4 + rng() * 0.2);
    const R = (0.13 + rng() * 0.07) / 0.6 * size; // 130–200 mm radius
    const wobble = makeFbm(seed + 9, 3, 2);
    const rings = [1, 0.78 + rng() * 0.08, 0.5 + rng() * 0.1];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy;
        const ang = Math.atan2(dy, dx);
        const rad = Math.hypot(dx, dy) / (R * (0.72 + 0.56 * wobble((ang + Math.PI) / (2 * Math.PI), 0.5)));
        if (rad > 1.05) continue;
        let a = 0.22 * (1 - smoothstep(0.96, 1.03, rad)); // wash
        for (let k = 0; k < rings.length; k++) {
          const w = k === 0 ? 0.035 : 0.02;
          const ring = Math.exp(-((rad - rings[k]) * (rad - rings[k])) / (w * w));
          a += ring * (k === 0 ? 0.42 : 0.14);
        }
        a = Math.min(0.75, a);
        const i = (y * size + x) * 4;
        d[i] = d[i] * (1 - a) + 168 * a; d[i + 1] = d[i + 1] * (1 - a) + 138 * a; d[i + 2] = d[i + 2] * (1 - a) + 92 * a;
        rough[y * size + x] = Math.max(rough[y * size + x] - a * 0.1, 0.75);
      }
  }
  ctx.putImageData(img, 0, 0);
  return { map: finish(c, true, 4), roughnessMap: greyFromField(rough, size, size, 4), normalMap: normalFromHeight(hf, size, size, 0.5 / mmPerPx, 4) };
}

/**
 * Baked-white grid tee (15/16" face). One metre of tee per canvas: enamel with
 * a ±2 % yellowing drift, chips where cross tees were dropped in — bare
 * galvanised grey (Ra 0.55) with a hairline of rust at one edge, 3–8 per metre
 * at 1–4 mm — and matching roughness (chip = bare metal, glossier than the paint).
 */
export function teePaint(size: number, seed: number): TextureSet {
  const { c, ctx } = canvas(size, size);
  const rng = makeRng(seed);
  const drift = makeFbm(seed + 1, 3, 2);
  const img = ctx.createImageData(size, size);
  const rough = new Float32Array(size * size).fill(1);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = (drift(x / size, y / size) - 0.5) * 0.04;
      const i = (y * size + x) * 4;
      img.data[i] = 242 * (1 + n); img.data[i + 1] = 240 * (1 + n * 0.8); img.data[i + 2] = 234 * (1 + n * 0.3); img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const pxPerMm = size / 1000;
  const chips = 3 + Math.floor(rng() * 6);
  for (let k = 0; k < chips; k++) {
    // Tee faces are 24 mm wide with metric UVs (v 0–0.024): with flipY that is the LAST 2.4 % of rows.
    const x = rng() * size, y = size - rng() * size * 0.024, r = (0.6 + rng() * 1.6) * pxPerMm;
    ctx.fillStyle = "rgb(138,140,142)";
    ctx.beginPath();
    ctx.ellipse(x, y, r * (1 + rng()), r, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(150,90,50,0.6)";
    ctx.beginPath();
    ctx.arc(x + r * 0.6, y + r * 0.3, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r * 2; dx <= r * 2; dx++) {
        const i = ((Math.round(y + dy) + size) % size) * size + ((Math.round(x + dx) + size) % size);
        rough[i] = 0.64; // × 0.55 paint → 0.35 bare zinc
      }
  }
  return { map: finish(c, true, 4), roughnessMap: greyFromField(rough, size, size, 4) };
}

export interface VinylSet {
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

/**
 * Expanded-vinyl upholstery surface. Always: embossed leather micro-grain at
 * 0.3–0.5 mm cells (shows only in the specular). With `crazed`: plasticiser
 * crazing in patches — polygonal cells 2–5 mm, hairline cracks, lips curled up
 * — carried in the normal and (≤ 15 %) roughness only; nothing in the diffuse.
 * One canvas covers `metres` of vinyl.
 */
export function vinylSurface(size: number, metres: number, crazed: boolean, weltCracks = false): VinylSet {
  const pxPerMm = size / (metres * 1000);
  const { c: nc, ctx: nctx } = canvas(size, size);
  const { c: rc, ctx: rctx } = canvas(size, size);
  const rng = makeRng(crazed ? 2024 : 2025);
  const grain = makeFbm(61, 128, 3); // ~1.5 mm swell under the pebbles
  const patch = makeFbm(62, 4, 3); // where the crazing lives
  const polish = makeFbm(63, 3, 2); // where hands and seats have burnished the grain
  const height = new Float32Array(size * size);
  const crack = new Float32Array(size * size);
  const crease = new Float32Array(size * size);
  // Pebble grain (System 5): embossed expanded vinyl is a field of flat-topped pebbles
  // 0.4–0.7 mm across separated by 0.1 mm creases (the emboss roll's negative of a
  // leather grain), not a noise field. Voronoi on a jittered 0.55 mm grid: each cell a
  // low dome of its own height, the boundary a narrow rounded crease.
  {
    const cellPx = 0.55 * pxPerMm;
    const g2 = Math.max(4, Math.round(size / cellPx));
    const st = size / g2;
    const sx = new Float32Array(g2 * g2), sy = new Float32Array(g2 * g2), sh = new Float32Array(g2 * g2);
    for (let j = 0; j < g2; j++)
      for (let i = 0; i < g2; i++) {
        sx[j * g2 + i] = (i + 0.15 + rng() * 0.7) * st;
        sy[j * g2 + i] = (j + 0.15 + rng() * 0.7) * st;
        sh[j * g2 + i] = rng();
      }
    for (let y = 0; y < size; y++) {
      const gj = Math.floor(y / st);
      for (let x = 0; x < size; x++) {
        const gi = Math.floor(x / st);
        let f1 = 1e9, f2 = 1e9, k1 = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = (gi + di + g2) % g2, jj = (gj + dj + g2) % g2, k = jj * g2 + ii;
            const px = sx[k] + (gi + di - ii) * st, py = sy[k] + (gj + dj - jj) * st;
            const dd = Math.hypot(px - x, py - y);
            if (dd < f1) { f2 = f1; f1 = dd; k1 = k; } else if (dd < f2) f2 = dd;
          }
        const cr = smoothstep(0, 0.4 * cellPx, f2 - f1); // 0 in the crease, 1 on the pebble top
        const dome = 1 - Math.min(1, f1 / (0.8 * cellPx)) ** 2;
        const i = y * size + x;
        crease[i] = 1 - cr;
        height[i] = (cr * 0.55 + dome * 0.2 + sh[k1] * 0.25 - 0.5) * 0.8 + (grain(x / size, y / size) - 0.5) * 0.3;
      }
    }
  }
  if (crazed) {
    const cell = 3.5 * pxPerMm; // mean cell ≈ 3.5 mm
    const grid = Math.max(4, Math.round(size / cell));
    const step = size / grid;
    const cx = new Float32Array(grid * grid), cy = new Float32Array(grid * grid);
    for (let j = 0; j < grid; j++)
      for (let i = 0; i < grid; i++) {
        cx[j * grid + i] = (i + 0.15 + rng() * 0.7) * step;
        cy[j * grid + i] = (j + 0.15 + rng() * 0.7) * step;
      }
    for (let y = 0; y < size; y++) {
      const gj = Math.floor(y / step);
      for (let x = 0; x < size; x++) {
        const gi = Math.floor(x / step);
        let f1 = 1e9, f2 = 1e9;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = (gi + di + grid) % grid, jj = (gj + dj + grid) % grid;
            const px = cx[jj * grid + ii] + (gi + di - ii) * step;
            const py = cy[jj * grid + ii] + (gj + dj - jj) * step;
            const d = Math.hypot(px - x, py - y);
            if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
          }
        const edge = (f2 - f1) / pxPerMm; // mm from the cell boundary
        const p = patch(x / size, y / size);
        let presence = Math.min(1, Math.max(0, (p - 0.5) / 0.14));
        let w = 0.2 + p * 0.25; // crack half-width in mm
        if (weltCracks) {
          // Seam cracking (System 5): the vinyl flexes along the sewn welt every time a back is
          // leaned on, and after years the plasticiser has gone: a 4–18 mm band beside the cord
          // is crazed through, wider cracks, with a few running along the seam. Booths.ts maps
          // this panel's u as the distance from the nearest welt, so u ≈ 0 (the canvas edge,
          // wrapping) is the cord line.
          const du = Math.min(x, size - x) / size * metres * 1000; // mm from the welt
          const band = (1 - smoothstep(6, 18, du)) * smoothstep(1.5, 4, du) * (0.6 + 0.4 * patch(x / size + 0.5, y / size));
          if (band > presence) { presence = band; w = 0.25 + band * 0.35; }
          // Long cracks parallel to the cord: a wandering line 5–9 mm out, present in stretches
          const line = 6.5 + (patch(0.25, y / size) - 0.5) * 5, stretch = smoothstep(0.45, 0.55, patch(0.7, y / size * 0.5));
          const dl = Math.abs(du - line);
          if (dl < 0.45 && stretch > presence) { presence = stretch; w = 0.45; }
        }
        const inCrack = edge < w ? 1 - edge / w : 0;
        const lip = edge >= w && edge < w + 0.8 ? 1 - (edge - w) / 0.8 : 0;
        const i = y * size + x;
        height[i] += presence * (-0.9 * inCrack + 0.35 * lip);
        crack[i] = presence * inCrack;
      }
    }
  }
  const nimg = nctx.createImageData(size, size);
  const rimg = rctx.createImageData(size, size);
  const H = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, o = i * 4;
      const dx = (H(x + 1, y) - H(x - 1, y)) * 1.6;
      const dy = (H(x, y + 1) - H(x, y - 1)) * 1.6;
      const len = Math.hypot(dx, dy, 1);
      nimg.data[o] = ((-dx / len) * 0.5 + 0.5) * 255;
      nimg.data[o + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      nimg.data[o + 2] = (1 / len) * 255;
      nimg.data[o + 3] = 255;
      // Roughness around 0.5 (material scales it), cracks a little matter (≤ 15 %), the creases
      // hold dirt (+0.04), and burnished patches — the seat nose, the grab points on the backs,
      // wherever a metric panel's jitter puts them — drop up to 0.1 in 5–12 cm blotches.
      const worn = smoothstep(0.54, 0.7, polish(x / size, y / size));
      const r = 0.45 + (H(x, y) - crack[i]) * 0.06 + crack[i] * 0.07 + crease[i] * 0.04 - worn * 0.1;
      const rv = Math.min(255, Math.max(0, r * 255));
      rimg.data[o] = rv; rimg.data[o + 1] = rv; rimg.data[o + 2] = rv; rimg.data[o + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return { normalMap: finish(nc, false, 8), roughnessMap: finish(rc, false, 8) };
}

/**
 * Formica 6942 "Skylark" boomerang laminate on a plain cream field. Each shape is
 * a genuine boomerang bent 100–130°, tapered from the elbow to rounded tips (drawn
 * as a chain of discs along the centre line). Two size classes — large 30–38 mm tip
 * to tip and small 16–21 mm — three tones at low contrast, ~15 % of the shapes drawn
 * outline-only, random rotation, ~3.5 per 100 cm² (≈ 8 % cover), none touching. One canvas = `metres` (use ≥ 1.2 m so a
 * whole table shows no repeat).
 */
export function formicaBoomerang(size: number, metres: number, seed: number): TextureSet {
  const { c, ctx } = canvas(size, size);
  const { c: rc, ctx: rctx } = canvas(size, size);
  const rng = makeRng(seed);
  const pxPerMm = size / (metres * 1000);
  ctx.fillStyle = "#EDE6D6";
  ctx.fillRect(0, 0, size, size);
  const fbm = makeFbm(seed + 1, 48, 2);
  const img = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = (fbm(x / size, y / size) - 0.5) * 0.012;
      const o = (y * size + x) * 4;
      img.data[o] *= 1 + n; img.data[o + 1] *= 1 + n; img.data[o + 2] *= 1 + n;
    }
  ctx.putImageData(img, 0, 0);
  const tones = ["#CBBB9F", "#A3A8AC", "#FBF9F4"];
  const areaCm2 = metres * metres * 1e4;
  const target = Math.round(areaCm2 * 0.04);
  const placed: Array<[number, number, number]> = [];
  const torusDist = (ax: number, ay: number, bx: number, by: number) => {
    let dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    dx = Math.min(dx, size - dx); dy = Math.min(dy, size - dy);
    return Math.hypot(dx, dy);
  };
  const wraps = [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size], [size, size], [-size, -size], [size, -size], [-size, size]];
  let attempts = 0;
  while (placed.length < target && attempts < 60000) {
    attempts++;
    const x = rng() * size, y = rng() * size;
    const big = rng() < 0.6;
    // Large class: arm 15–19 mm (30–38 mm tip to tip with caps); small: 7–9 mm (16–21 mm).
    const arm = (big ? 15 + rng() * 4 : 7 + rng() * 2) * pxPerMm;
    const reach = arm + 4 * pxPerMm;
    if (placed.some(([px, py, pr]) => torusDist(x, y, px, py) < reach + pr + 6 * pxPerMm)) continue;
    placed.push([x, y, reach]);
    const half = THREE.MathUtils.degToRad(50 + rng() * 15); // arm half-angle (100–130° included)
    const wMax = (big ? 3.4 + rng() * 1.0 : 2.2 + rng() * 0.5) * pxPerMm; // elbow half-width
    const rot = rng() * Math.PI * 2;
    const outline = rng() < 0.15;
    const tone = tones[Math.floor(rng() * tones.length)];
    const steps = 48;
    // Two straight arms from the elbow (origin) with a rounded knee: the middle 30 % of
    // the centre line is a quadratic blend through the elbow point.
    const T1: [number, number] = [arm * Math.cos(half), arm * Math.sin(half)];
    const T2: [number, number] = [arm * Math.cos(half), -arm * Math.sin(half)];
    const centre = (t: number): [number, number] => {
      if (t < 0.35) { const k = t / 0.35; return [T1[0] * (1 - 0.7 * k), T1[1] * (1 - 0.7 * k)]; }
      if (t > 0.65) { const k = (t - 0.65) / 0.35; return [T2[0] * (0.3 + 0.7 * k), T2[1] * (0.3 + 0.7 * k)]; }
      const k = (t - 0.35) / 0.3;
      const a: [number, number] = [T1[0] * 0.3, T1[1] * 0.3], c: [number, number] = [T2[0] * 0.3, T2[1] * 0.3];
      return [(1 - k) * (1 - k) * a[0] + k * k * c[0], (1 - k) * (1 - k) * a[1] + k * k * c[1]];
    };
    const draw = (px: number, py: number, shrink: number) => {
      ctx.beginPath();
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const [lx, ly] = centre(t);
        const w = wMax * (0.42 + 0.58 * (1 - Math.abs(2 * t - 1)) ** 0.5) - shrink;
        if (w <= 0.3) continue;
        const gx = px + lx * Math.cos(rot) - ly * Math.sin(rot);
        const gy = py + lx * Math.sin(rot) + ly * Math.cos(rot);
        ctx.moveTo(gx + w, gy);
        ctx.arc(gx, gy, w, 0, Math.PI * 2);
      }
      ctx.fill();
    };
    for (const [ox, oy] of wraps) {
      const px = x + ox, py = y + oy;
      if (px < -arm * 2 || px > size + arm * 2 || py < -arm * 2 || py > size + arm * 2) continue;
      ctx.fillStyle = tone;
      draw(px, py, 0);
      if (outline) { ctx.fillStyle = "#EDE6D6"; draw(px, py, 1.1 * pxPerMm); } // 1.1 mm outline stroke
    }
  }
  ctx.fillStyle = "#D8C28A";
  for (let k = 0; k < areaCm2 * 0.8; k++) ctx.fillRect(rng() * size, rng() * size, 1, 1);
  const wipe = makeFbm(seed + 5, 6, 3);
  const rimg = rctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = wipe(x / size, (y / size) * 0.15) - 0.5;
      const v = Math.min(255, Math.max(0, (0.18 + n * 0.1) * 255));
      const o = (y * size + x) * 4;
      rimg.data[o] = v; rimg.data[o + 1] = v; rimg.data[o + 2] = v; rimg.data[o + 3] = 255;
    }
  rctx.putImageData(rimg, 0, 0);
  return { map: finish(c, true, 8), roughnessMap: finish(rc, false, 8) };
}

export interface WoodSet {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalMap: THREE.Texture;
}

export interface WoodOpts {
  /** sRGB base colour, e.g. "#6E4A2E". */
  hex: string;
  seed: number;
  /** Peak luminance drop of the grain lines (0.08 ≈ 8 %). Rings add half that again at most. */
  contrast: number;
  /** Base roughness of the finish. */
  rough: number;
  /** Open-pore length in mm (0 for a printed laminate). */
  pore: number;
  /** Grain runs along v when true (upright panels), else along u. */
  vertical: boolean;
  /** Grain-line pitch in mm (1–3 for veneer). */
  pitch: number;
  /** Growth-ring band pitch in mm (8–14). */
  ring: number;
  /** Side-to-side drift of the lines along their length, mm (2–5: "mostly straight"). */
  warp: number;
  /** Depth of the single cathedral arch per canvas, mm (0 = plain straight grain). */
  figure: number;
  /** Dings per canvas: 3–8 mm dents where something hit the finish (crushed fibre reads darker, bruised varnish lighter at the rim). */
  dings?: number;
}

/**
 * Veneer grain at true scale. `metres` is the world span of one canvas edge, so
 * every feature is authored in millimetres: grain lines every `pitch` mm running
 * the full length of the panel (a long thin anisotropic lattice, so the lines are
 * continuous with soft ends), a coarser latewood band every `ring` mm at half the
 * contrast, a few mm of slow drift so nothing is ruler-straight, and ONE cathedral
 * arch per canvas: every line bends around a bump centred on the panel (nested
 * parabolas), zero at the edges so the tile still wraps. Fibre noise at ±contrast/6
 * breaks the lines up; pores (if any) dent the normal along the grain.
 */
export function woodVeneer(size: number, metres: number, o: WoodOpts): WoodSet {
  const { c, ctx } = canvas(size, size);
  const { c: rc, ctx: rctx } = canvas(size, size);
  const { c: nc, ctx: nctx } = canvas(size, size);
  const base = { r: parseInt(o.hex.slice(1, 3), 16) / 255, g: parseInt(o.hex.slice(3, 5), 16) / 255, b: parseInt(o.hex.slice(5, 7), 16) / 255 };
  const rng = makeRng(o.seed);
  const mm = metres * 1000;
  const pxPerMm = size / mm;
  const lineCells = Math.max(8, Math.round(mm / o.pitch));
  const ringCells = Math.max(4, Math.round(mm / o.ring));
  // (u = along the grain, v = across). Lines: 3 cells along so each runs ~1/3 of the canvas before fading.
  const lines = makeFbm2(o.seed, 3, lineCells, 2);
  const rings = makeFbm2(o.seed + 7, 2, ringCells, 2);
  const drift = makeFbm2(o.seed + 11, 4, 2, 2); // slow side-to-side wander of the whole line field
  const fibre = makeFbm2(o.seed + 3, 24, lineCells * 2, 1);
  const smooth = (a: number, b: number, t: number) => {
    const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  const img = ctx.createImageData(size, size);
  const rimg = rctx.createImageData(size, size);
  const heights = new Float32Array(size * size);
  const archW = 0.16; // gaussian half-width of the arch along the grain (fraction of canvas)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const a = o.vertical ? y : x, cc = o.vertical ? x : y;
      const ua = a / size, uc = cc / size;
      // Cathedral: lines near the arch axis (tile centre) bend by up to `figure` mm around a
      // bump along the grain; the bend decays across so the rest of the panel stays straight.
      // Both factors → 0 at the tile edges so the canvas still wraps.
      const da = ua - 0.5, dc = uc - 0.5;
      const bump = Math.exp(-(da * da) / (archW * archW)) * Math.exp(-(dc * dc) / 0.03);
      const shift = ((drift(ua, uc) - 0.5) * o.warp + bump * o.figure) / mm;
      const v = uc + shift;
      const l = lines(ua, v);
      const lineDark = smooth(0.56, 0.68, l); // ~25 % of the width is line
      const ringDark = smooth(0.52, 0.64, rings(ua, v)) * 0.5;
      const fine = (fibre(ua, v) - 0.5) / 3;
      const k = 1 - o.contrast * (lineDark + ringDark - fine);
      const idx = (y * size + x) * 4;
      img.data[idx] = Math.min(255, Math.max(0, base.r * 255 * k));
      img.data[idx + 1] = Math.min(255, Math.max(0, base.g * 255 * k));
      img.data[idx + 2] = Math.min(255, Math.max(0, base.b * 255 * k));
      img.data[idx + 3] = 255;
      const poreHit = o.pore > 0 && rng() < 0.012 * lineDark ? 1 : 0;
      heights[y * size + x] = -lineDark * 0.25 - poreHit * 0.7;
      const rv = Math.min(255, Math.max(0, (o.rough + lineDark * 0.06 + poreHit * 0.2) * 255));
      rimg.data[idx] = rv; rimg.data[idx + 1] = rv; rimg.data[idx + 2] = rv; rimg.data[idx + 3] = 255;
    }
  for (let k = 0; k < (o.dings ?? 0); k++) {
    // Elliptical dent: 0.4 mm deep, dark crushed floor, a paler bruised ring of finish around it.
    const cx = rng() * size, cy = rng() * size, ra = (1.5 + rng() * 2.5) * pxPerMm, rb = ra * (0.5 + rng() * 0.5), ang = rng() * Math.PI;
    const R = Math.ceil(Math.max(ra, rb) * 1.6);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const u = (dx * Math.cos(ang) + dy * Math.sin(ang)) / ra, v = (-dx * Math.sin(ang) + dy * Math.cos(ang)) / rb;
        const dd = Math.hypot(u, v);
        if (dd > 1.6) continue;
        const x = (Math.round(cx + dx) + size) % size, y = (Math.round(cy + dy) + size) % size, i = y * size + x, idx = i * 4;
        const inside = 1 - smoothstep(0.7, 1.05, dd), ring = smoothstep(0.85, 1.05, dd) * (1 - smoothstep(1.2, 1.6, dd));
        heights[i] -= inside * 0.4;
        const k2 = 1 - inside * 0.16 + ring * 0.07;
        img.data[idx] *= k2; img.data[idx + 1] *= k2; img.data[idx + 2] *= k2;
        rimg.data[idx] = Math.min(255, rimg.data[idx] + inside * 60);
        rimg.data[idx + 1] = rimg.data[idx]; rimg.data[idx + 2] = rimg.data[idx];
      }
  }
  const smeared = new Float32Array(size * size);
  const poreLen = Math.max(1, Math.round(o.pore * 3 * pxPerMm));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let m = 0;
      for (let k = 0; k < poreLen; k++) {
        const xx = o.vertical ? x : (x + k) % size, yy = o.vertical ? (y + k) % size : y;
        m = Math.min(m, heights[yy * size + xx]);
      }
      smeared[y * size + x] = m;
    }
  const nimg = nctx.createImageData(size, size);
  const H = (x: number, y: number) => smeared[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * 0.8, dy = (H(x, y + 1) - H(x, y - 1)) * 0.8;
      const len = Math.hypot(dx, dy, 1);
      const idx = (y * size + x) * 4;
      nimg.data[idx] = ((-dx / len) * 0.5 + 0.5) * 255;
      nimg.data[idx + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      nimg.data[idx + 2] = (1 / len) * 255;
      nimg.data[idx + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  nctx.putImageData(nimg, 0, 0);
  return { map: finish(c, true, 8), roughnessMap: finish(rc, false, 8), normalMap: finish(nc, false, 8) };
}

/**
 * Prismatic acrylic lens: square pyramids, `cells` per canvas edge. Returns a
 * normal map and a colour/emissive map whose cell ridges are slightly darker so
 * the pattern reads even on a self-lit lens.
 */
export function prismLens(size: number, cells: number): { normalMap: THREE.Texture; map: THREE.Texture } {
  const { c, ctx } = canvas(size, size);
  const { c: mc, ctx: m2 } = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const mimg = m2.createImageData(size, size);
  const cell = size / cells;
  const slope = 0.55;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = ((x % cell) / cell) * 2 - 1, v = ((y % cell) / cell) * 2 - 1;
      const gx = Math.abs(u) > Math.abs(v) ? Math.sign(u) : 0;
      const gy = Math.abs(v) >= Math.abs(u) ? Math.sign(v) : 0;
      const len = Math.hypot(gx * slope, gy * slope, 1);
      const o = (y * size + x) * 4;
      img.data[o] = ((-gx * slope) / len) * 0.5 * 255 + 127.5;
      img.data[o + 1] = ((gy * slope) / len) * 0.5 * 255 + 127.5;
      img.data[o + 2] = (1 / len) * 255;
      img.data[o + 3] = 255;
      // Ridges (cell edges) and the apex catch light differently: darker at the edges.
      const edge = Math.max(Math.abs(u), Math.abs(v));
      const shade = 255 - 110 * Math.pow(edge, 8) - 45 * Math.pow(1 - Math.abs(Math.abs(u) - Math.abs(v)), 3);
      mimg.data[o] = shade; mimg.data[o + 1] = shade; mimg.data[o + 2] = shade; mimg.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  m2.putImageData(mimg, 0, 0);
  return { normalMap: finish(c, false, 4), map: finish(mc, true, 4) };
}

/** Light grey speckle laminate (counter top). */
export function formicaSpeckle(size: number, seed: number): TextureSet {
  const { c, ctx } = canvas(size, size);
  const rng = makeRng(seed);
  ctx.fillStyle = "#bfbfba";
  ctx.fillRect(0, 0, size, size);
  const fbm = makeFbm(seed + 3, 8, 3);
  const img = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = (fbm(x / size, y / size) - 0.5) * 0.06;
      const o = (y * size + x) * 4;
      img.data[o] *= 1 + n; img.data[o + 1] *= 1 + n; img.data[o + 2] *= 1 + n;
    }
  ctx.putImageData(img, 0, 0);
  for (let k = 0; k < size * 14; k++) {
    const v = rng() < 0.55 ? 120 + rng() * 40 : 225 + rng() * 25;
    ctx.fillStyle = `rgb(${v},${v},${v * 0.98})`;
    const x = rng() * size, y = rng() * size, r = 0.6 + rng() * 1.3;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return { map: finish(c, true, 8) };
}

/** Off-white glaze with sparse iron speckles (diner mug). */
export function glazeSpeckle(size: number): TextureSet {
  const { c, ctx } = canvas(size, size);
  const rng = makeRng(77);
  ctx.fillStyle = "#F2EEE6";
  ctx.fillRect(0, 0, size, size);
  for (let k = 0; k < size * 0.6; k++) {
    const v = 120 + rng() * 60;
    ctx.fillStyle = `rgba(${v},${v * 0.9},${v * 0.8},0.6)`;
    const x = rng() * size, y = rng() * size, r = 0.4 + rng() * 0.8;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return { map: finish(c, true, 4) };
}

/** Brushed-metal roughness: fine streaks along u. */
export function brushedRoughness(size: number, base: number, seed: number): THREE.Texture {
  const { c, ctx } = canvas(size, size);
  const streak = makeFbm(seed, 4, 3);
  const fine = makeFbm(seed + 9, 256, 1);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = (streak((x / size) * 0.05, y / size) - 0.5) * 0.3 + (fine(x / size, y / size) - 0.5) * 0.08;
      const v = Math.min(255, Math.max(0, (base + n) * 255));
      const o = (y * size + x) * 4;
      img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return finish(c, false, 8);
}

/** Fine granular roughness (sugar, salt): per-texel speckle ±amp around base. */
export function speckleRoughness(size: number, base: number, amp: number, seed: number): THREE.Texture {
  const { c, ctx } = canvas(size, size);
  const rng = makeRng(seed);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.min(255, Math.max(0, (base + (rng() - 0.5) * 2 * amp) * 255));
    const o = i * 4;
    img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = finish(c, false, 4);
  t.repeat.set(6, 6);
  return t;
}

/** Coarse asphalt for the lot placeholder. */
export function asphalt(size: number): TextureSet {
  const { c, ctx } = canvas(size, size);
  const fbm = makeFbm(909, 8, 5);
  const grain = makeFbm(910, 128, 2);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = (fbm(x / size, y / size) - 0.5) * 0.25 + (grain(x / size, y / size) - 0.5) * 0.35;
      const v = 96 * (1 + n);
      const i = (y * size + x) * 4;
      d[i] = v * 1.02; d[i + 1] = v; d[i + 2] = v * 0.94; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: finish(c, true, 8) };
}

/** Concrete sidewalk with a faint aggregate speckle. */
export function concrete(size: number): TextureSet {
  const { c, ctx } = canvas(size, size);
  const fbm = makeFbm(4242, 6, 4);
  const grain = makeFbm(4243, 96, 2);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = (fbm(x / size, y / size) - 0.5) * 0.12 + (grain(x / size, y / size) - 0.5) * 0.14;
      const v = 178 * (1 + n);
      const i = (y * size + x) * 4;
      d[i] = v; d[i + 1] = v * 0.98; d[i + 2] = v * 0.93; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: finish(c, true, 8) };
}

/* ======================= System 5: wear and dressing ======================= */

/** Stamp a stroke into a float field with additive value `v` along a path of points. */
function strokeField(f: Float32Array, size: number, pts: Array<[number, number]>, v: number, width: number): void {
  const R = Math.ceil(width / 2);
  for (const [px, py] of pts)
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const dd = Math.hypot(dx, dy);
        if (dd > width / 2) continue;
        const i = ((Math.round(py) + dy + size) % size) * size + ((Math.round(px) + dx + size) % size);
        f[i] += v * (1 - dd / (width / 2 + 0.5));
      }
}

/**
 * Roughness of a high-pressure laminate top in service (× material roughness 1).
 * `base` is the factory gloss (Formica "58 matte" ≈ 0.18 post-clearcoat here);
 * over it: the circular wipe haze a rag leaves (arcs 30–200 mm radius, +0.1),
 * 6–10 long straight scratches (+0.28), and `rings` cup-ring ghosts — Ø 78 mm
 * (a diner mug's foot is 75–80 mm), 2.5 mm wide, broken into dashes where the
 * mug rocked, +0.12. One canvas is `metres` of top, so a table (0.7 × 1.2 m)
 * shows no repeat; the counter (7.8 m) repeats every canvas, which only
 * matters for the rings and is why they are faint.
 */
export function laminateWear(size: number, metres: number, base: number, seed: number, rings: number): THREE.Texture {
  const rng = makeRng(seed);
  const pxPerM = size / metres;
  const wipe = makeFbm(seed + 5, 6, 3);
  const f = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) f[y * size + x] = base + (wipe(x / size, (y / size) * 0.15) - 0.5) * 0.08;
  const arcs = Math.round(260 * metres * metres);
  for (let a = 0; a < arcs; a++) {
    const cx = rng() * size, cy = rng() * size, r = (0.03 + rng() * 0.17) * pxPerM;
    const a0 = rng() * Math.PI * 2, span = 0.3 + rng() * 1.3;
    const pts: Array<[number, number]> = [];
    const n = Math.max(6, Math.round(r * span));
    for (let k = 0; k <= n; k++) {
      const t = a0 + (span * k) / n;
      pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
    }
    strokeField(f, size, pts, 0.05 + rng() * 0.07, 1.2);
  }
  for (let s = 0; s < 6 + Math.floor(rng() * 5); s++) {
    const x0 = rng() * size, y0 = rng() * size, len = (0.08 + rng() * 0.32) * pxPerM, ang = rng() * Math.PI;
    const pts: Array<[number, number]> = [];
    const n = Math.round(len);
    for (let k = 0; k <= n; k++) pts.push([x0 + Math.cos(ang) * k, y0 + Math.sin(ang) * k]);
    strokeField(f, size, pts, 0.18 + rng() * 0.14, 1.1);
  }
  for (let r = 0; r < rings; r++) {
    const cx = rng() * size, cy = rng() * size, rad = 0.039 * pxPerM * (0.96 + rng() * 0.08);
    const n = Math.round(rad * 6.3);
    const gapAt = rng() * Math.PI * 2, gapW = rng() * 1.2;
    const pts: Array<[number, number]> = [];
    for (let k = 0; k <= n; k++) {
      const t = (k / n) * Math.PI * 2;
      const da = Math.abs(((t - gapAt + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da < gapW / 2 || rng() < 0.08) continue;
      pts.push([cx + Math.cos(t) * rad, cy + Math.sin(t) * rad * (0.97 + rng() * 0.06)]);
    }
    strokeField(f, size, pts, 0.1 + rng() * 0.05, 0.0025 * pxPerM);
  }
  return greyFromField(f, size, size, 8);
}

/**
 * Chrome roughness under shoes (stool footrings, the counter footrail): `base`
 * plating gloss, dulled in rub streaks along the ring (u) where heels ride —
 * 0.12–0.3 extra — and a fine dust/haze speckle. Rubber transfer marks cannot
 * be in a roughness map; the streaks alone read as scuffed plating.
 */
export function scuffRoughness(size: number, base: number, seed: number): THREE.Texture {
  const rng = makeRng(seed);
  const streak = makeFbm2(seed, 3, 40, 2);
  const haze = makeFbm(seed + 3, 5, 2);
  const f = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const s = smoothstep(0.52, 0.72, streak(x / size, y / size));
      // Heels ride the upper half of a rail/ring: v ∈ [0.55, 1) gets most of the scuffing.
      const band = 0.35 + 0.65 * smoothstep(0.45, 0.7, y / size);
      f[y * size + x] = base + s * band * 0.22 + (haze(x / size, y / size) - 0.5) * 0.04 + (rng() - 0.5) * 0.01;
    }
  return greyFromField(f, size, size, 8);
}

/**
 * Push-bar / pull-handle chrome: hands polish the grip zone bright but leave a
 * haze of skin oil either side of it, and where the plating has worn to the
 * nickel the lobe broadens. v runs along the bar. Grip zone (v 0.55–0.85 for a
 * right-handed push toward the latch side) `base` ×0.7; shoulders +0.12 haze;
 * finger smears (short ovals, +0.15) around it.
 */
export function handWear(size: number, base: number, seed: number): THREE.Texture {
  const rng = makeRng(seed);
  const haze = makeFbm(seed + 1, 6, 2);
  const f = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    const grip = smoothstep(0.5, 0.58, v) * (1 - smoothstep(0.82, 0.9, v));
    const shoulder = Math.max(smoothstep(0.38, 0.5, v) * (1 - smoothstep(0.5, 0.58, v)), smoothstep(0.82, 0.9, v) * (1 - smoothstep(0.9, 0.98, v)));
    for (let x = 0; x < size; x++) f[y * size + x] = base * (1 - 0.3 * grip) + shoulder * 0.12 + (haze(x / size, v) - 0.5) * 0.03;
  }
  for (let k = 0; k < 40; k++) {
    const cx = rng() * size, cy = (0.35 + rng() * 0.6) * size, ra = (0.01 + rng() * 0.02) * size, rb = ra * 0.6, ang = rng() * Math.PI;
    for (let dy = -ra; dy <= ra; dy++)
      for (let dx = -ra; dx <= ra; dx++) {
        const u = (dx * Math.cos(ang) + dy * Math.sin(ang)) / ra, w = (-dx * Math.sin(ang) + dy * Math.cos(ang)) / rb;
        const dd = Math.hypot(u, w);
        if (dd > 1) continue;
        const i = ((Math.round(cy + dy) + size) % size) * size + ((Math.round(cx + dx) + size) % size);
        f[i] += 0.12 * (1 - dd * dd);
      }
  }
  return greyFromField(f, size, size, 8);
}

/**
 * Brushed stainless that gets handled (napkin dispensers, brewer trim):
 * `base` satin over brushing streaks along u, plus 8–14 fingerprints — 12 × 18 mm
 * ovals of concentric ridge lines (+0.18, the skin-oil haze) and a few wiped
 * smears (+0.08 streaks). Prints cluster around v 0.3–0.8, where a hand lands.
 */
export function fingerprints(size: number, base: number, seed: number): THREE.Texture {
  const rng = makeRng(seed);
  const streak = makeFbm2(seed, 3, 96, 2);
  const f = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) f[y * size + x] = base + (streak(x / size, y / size) - 0.5) * 0.12;
  // Whole-face scale: the canvas covers one dispenser face (≈ 100 × 180 mm), so 1 mm ≈ size/140.
  const pxPerMm = size / 140;
  const prints = 8 + Math.floor(rng() * 7);
  for (let p = 0; p < prints; p++) {
    const cx = rng() * size, cy = (0.25 + rng() * 0.6) * size, ra = (5 + rng() * 2.5) * pxPerMm, rb = ra * 1.45, ang = (rng() - 0.5) * 1.2;
    const phase = rng() * 6;
    const R = Math.ceil(rb);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const u = (dx * Math.cos(ang) + dy * Math.sin(ang)) / ra, w = (-dx * Math.sin(ang) + dy * Math.cos(ang)) / rb;
        const dd = Math.hypot(u, w);
        if (dd > 1) continue;
        const ridge = 0.55 + 0.45 * Math.sin(dd * ra / (0.45 * pxPerMm) + phase); // 0.45 mm ridge pitch
        const i = ((Math.round(cy + dy) + size) % size) * size + ((Math.round(cx + dx) + size) % size);
        f[i] += 0.18 * ridge * (1 - dd ** 4);
      }
  }
  for (let s = 0; s < 5; s++) {
    const x0 = rng() * size, y0 = rng() * size, len = (20 + rng() * 40) * pxPerMm, ang = rng() * Math.PI;
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < len; k++) pts.push([x0 + Math.cos(ang) * k, y0 + Math.sin(ang) * k]);
    strokeField(f, size, pts, 0.05, 6 * pxPerMm);
  }
  return greyFromField(f, size, size, 8);
}

/**
 * Glass decanter roughness (× 1): `base` (0 for clear glass) with dishwasher
 * etching — a haze band over the bottom 25 mm of the body (+0.06) — and 20–30
 * fine scratches from the warmer plate and the sink (+0.2, hairline). v runs up
 * the lathe profile: 0 = bottom centre, ~0.5 = rim, so the body is v 0.05–0.45.
 */
export function carafeScratches(size: number, base: number, seed: number): THREE.Texture {
  const rng = makeRng(seed);
  const f = new Float32Array(size * size).fill(base);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    const etch = smoothstep(0.02, 0.05, v) * (1 - smoothstep(0.1, 0.2, v)) + smoothstep(0.52, 0.55, v) * (1 - smoothstep(0.55, 0.62, v));
    for (let x = 0; x < size; x++) f[y * size + x] += etch * (0.045 + rng() * 0.02);
  }
  for (let s = 0; s < 26; s++) {
    const x0 = rng() * size, y0 = (0.05 + rng() * 0.4) * size, len = (0.05 + rng() * 0.25) * size, ang = (rng() - 0.5) * 0.9;
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < len; k++) pts.push([(x0 + Math.cos(ang) * k) % size, y0 + Math.sin(ang) * k * 0.4]);
    strokeField(f, size, pts, 0.14 + rng() * 0.1, 1);
  }
  return greyFromField(f, size, size, 8);
}

/**
 * Alpha for the decanter's coffee tide line (the CylinderGeometry band above the
 * fill): dense at the bottom (v 0) where the level sits all morning, thinning
 * upward with 8–12 drips from earlier, fuller pots, and a mottled edge — not a
 * uniform 55 % band.
 */
export function tideLineAlpha(size: number, seed: number): THREE.Texture {
  const rng = makeRng(seed);
  const mottle = makeFbm(seed, 24, 2);
  const { c, ctx } = canvas(size, size / 4);
  const h = size / 4;
  const img = ctx.createImageData(size, h);
  for (let y = 0; y < h; y++) {
    const v = 1 - y / h; // canvas top = v 1 (flipY): top of the band
    const bandA = (1 - smoothstep(0.1, 0.6, v)) * 0.9;
    for (let x = 0; x < size; x++) {
      const a = bandA * (0.7 + 0.6 * (mottle(x / size, y / h) - 0.5));
      const o = (y * size + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      img.data[o + 3] = clamp01(a) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineCap = "round";
  for (let d = 0; d < 10; d++) {
    const x = rng() * size, top = (0.15 + rng() * 0.45) * h;
    ctx.lineWidth = 1 + rng() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + (rng() - 0.5) * 3, h);
    ctx.stroke();
  }
  const t = finish(c, false, 4);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/**
 * Cove base in service: black vinyl with mop-water tide marks and grey heel
 * scuffs along the top third, dust at the toe. Metric UVs (1 canvas = 1 m of
 * base, jittered per run). Albedo is a multiplier over the material colour so
 * the lighting pass keeps the base tone; roughness is × the material value
 * (scuffs matte: 1.25, mop sheen: 0.85).
 */
export function baseboardScuff(size: number, seed: number): TextureSet {
  const rng = makeRng(seed);
  const { c, ctx } = canvas(size, size / 4);
  const h = size / 4;
  const mottle = makeFbm(seed, 6, 3);
  const img = ctx.createImageData(size, h);
  const rough = new Float32Array(size * h);
  for (let y = 0; y < h; y++) {
    const v = 1 - y / h; // v 0 at the floor
    const toe = 1 - smoothstep(0.05, 0.3, v);
    for (let x = 0; x < size; x++) {
      const m = mottle(x / size, y / h) - 0.5;
      const k = 1 + m * 0.12 + toe * 0.25 * (0.5 + m); // dusty grey film at the toe
      const o = (y * size + x) * 4;
      img.data[o] = 255 * Math.min(1, k); img.data[o + 1] = 255 * Math.min(1, k * 0.99); img.data[o + 2] = 255 * Math.min(1, k * 0.97); img.data[o + 3] = 255;
      rough[y * size + x] = 1 + toe * 0.2 - m * 0.2;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.lineCap = "round";
  for (let s = 0; s < 26; s++) {
    // Heel/broom scuffs: light grey streaks, mostly along the run
    const x = rng() * size, y = (0.1 + rng() * 0.6) * h, len = (0.02 + rng() * 0.1) * size, ang = (rng() - 0.5) * 0.5;
    ctx.strokeStyle = `rgba(200,196,190,${0.15 + rng() * 0.25})`;
    ctx.lineWidth = 0.8 + rng() * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
    for (let t = 0; t < len; t++) {
      const i = ((Math.round(y + Math.sin(ang) * t) + h) % h) * size + ((Math.round(x + Math.cos(ang) * t) + size) % size);
      rough[i] = 1.25;
    }
  }
  return { map: finish(c, true, 4), roughnessMap: greyFromField(rough, size, h, 4) };
}

/**
 * RGBA atlas for the door and window dressing (sRGB, clamp). 1024²:
 *  A [0,0]–[512,512]      OPEN sign (300 × 200 mm card, hung inside the glass)
 *  B [512,0]–[1024,512]   hours decal (white vinyl lettering, ~200 × 260 mm)
 *  C [0,512]–[512,768]    PUSH sticker (120 × 50 mm, red)
 *  D [512,512]–[768,768]  card-acceptance sticker (85 × 55 mm, generic marks)
 *  E [768,512]–[1024,1024] window-film edge: clear, with the 3 mm cut-back line at the
 *                          frame and a lifted corner
 * Text is drawn with the platform sans; the regions are read by DOOR_ATLAS in Door.ts.
 */
export function doorDecals(size: number): THREE.Texture {
  const { c, ctx } = canvas(size, size);
  ctx.clearRect(0, 0, size, size);
  const S = size / 1024;
  const font = (px: number, weight = "bold") => `${weight} ${Math.round(px * S)}px Arial, Helvetica, sans-serif`;
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // A: OPEN — white card (slightly yellowed), red border, red block letters, small black line
  {
    const x = 16 * S, y = 60 * S, w = 480 * S, h = 320 * S;
    ctx.fillStyle = "#f4efe2";
    rr(x, y, w, h, 10 * S); ctx.fill();
    ctx.lineWidth = 9 * S; ctx.strokeStyle = "#b8262a";
    rr(x + 16 * S, y + 16 * S, w - 32 * S, h - 32 * S, 6 * S); ctx.stroke();
    ctx.fillStyle = "#b8262a";
    ctx.font = font(170);
    ctx.fillText("OPEN", x + w / 2, y + h * 0.46);
    ctx.fillStyle = "#2a2622";
    ctx.font = font(34, "normal");
    ctx.fillText("COME IN — WE'RE", x + w / 2, y + h * 0.14);
    ctx.font = font(30, "normal");
    ctx.fillText("BREAKFAST ALL DAY", x + w / 2, y + h * 0.86);
    // Suction-cup hooks: two grey discs at the top corners
    ctx.fillStyle = "rgba(190,190,186,0.9)";
    for (const hx of [x + 40 * S, x + w - 40 * S]) { ctx.beginPath(); ctx.arc(hx, y + 8 * S, 14 * S, 0, Math.PI * 2); ctx.fill(); }
  }
  // B: HOURS — white vinyl letters with a thin dark keyline so they read on a bright lot too
  {
    const cx = 768 * S, top = 60 * S;
    const line = (t: string, dy: number, px: number, weight = "bold") => {
      ctx.font = font(px, weight);
      ctx.lineWidth = 3 * S; ctx.strokeStyle = "rgba(30,28,26,0.55)";
      ctx.strokeText(t, cx, top + dy * S);
      ctx.fillStyle = "#f2f0ea";
      ctx.fillText(t, cx, top + dy * S);
    };
    line("HOURS", 40, 66);
    line("MON – SAT", 130, 42);
    line("6 AM – 3 PM", 180, 42, "normal");
    line("SUNDAY", 260, 42);
    line("7 AM – 2 PM", 310, 42, "normal");
    line("CLOSED HOLIDAYS", 400, 30, "normal");
  }
  // C: PUSH — red sticker, white text, one corner lifting (lighter triangle)
  {
    const x = 20 * S, y = 540 * S, w = 470 * S, h = 200 * S;
    ctx.fillStyle = "#c0292c";
    rr(x, y, w, h, 14 * S); ctx.fill();
    ctx.fillStyle = "#f6f2ea";
    ctx.font = font(150);
    ctx.fillText("PUSH", x + w / 2, y + h / 2 + 4 * S);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath(); ctx.moveTo(x + w, y + h); ctx.lineTo(x + w - 40 * S, y + h); ctx.lineTo(x + w, y + h - 40 * S); ctx.fill();
  }
  // D: card sticker — "WE ACCEPT" over four generic marks (no trademarks)
  {
    const x = 524 * S, y = 530 * S, w = 232 * S, h = 150 * S;
    ctx.fillStyle = "#f5f3ee";
    rr(x, y, w, h, 8 * S); ctx.fill();
    ctx.fillStyle = "#2a2a30";
    ctx.font = font(26);
    ctx.fillText("WE ACCEPT", x + w / 2, y + 26 * S);
    const marks: Array<[string, string]> = [["#1a3f8f", "#f0b323"], ["#d12b2b", "#f39c12"], ["#0a6fb5", "#f4f4f2"], ["#0d7a4a", "#f4f4f2"]];
    marks.forEach(([bg, fg], i) => {
      const mx = x + 14 * S + i * 54 * S, my = y + 52 * S;
      ctx.fillStyle = bg; rr(mx, my, 46 * S, 30 * S, 4 * S); ctx.fill();
      ctx.fillStyle = fg;
      if (i === 1) { ctx.beginPath(); ctx.arc(mx + 18 * S, my + 15 * S, 9 * S, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#e8b41a"; ctx.beginPath(); ctx.arc(mx + 29 * S, my + 15 * S, 9 * S, 0, Math.PI * 2); ctx.fill(); }
      else if (i === 0) ctx.fillRect(mx + 8 * S, my + 18 * S, 30 * S, 5 * S);
      else { ctx.font = font(14); ctx.fillText(i === 2 ? "CARD" : "DEBIT", mx + 23 * S, my + 16 * S); }
    });
    ctx.fillStyle = "#6a6a70";
    ctx.font = font(16, "normal");
    ctx.fillText("$10 MINIMUM", x + w / 2, y + 122 * S);
  }
  // E: window film edge — transparent; the film stops 3 mm short of the frame (a brighter
  // hairline where bare glass shows), one lifted corner with a trapped-air sheen.
  {
    const x = 768 * S, y = 512 * S, w = 256 * S, h = 512 * S;
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 2 * S;
    ctx.strokeRect(x + 5 * S, y + 5 * S, w - 10 * S, h - 10 * S);
    ctx.fillStyle = "rgba(235,240,245,0.22)";
    ctx.beginPath(); ctx.moveTo(x + w - 5 * S, y + 5 * S); ctx.lineTo(x + w - 60 * S, y + 5 * S); ctx.lineTo(x + w - 5 * S, y + 80 * S); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1.5 * S;
    ctx.beginPath(); ctx.moveTo(x + w - 60 * S, y + 5 * S); ctx.lineTo(x + w - 5 * S, y + 80 * S); ctx.stroke();
    // A few trapped dust motes under the film
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    const rng = makeRng(77);
    for (let k = 0; k < 14; k++) { ctx.beginPath(); ctx.arc(x + 10 * S + rng() * (w - 20 * S), y + 10 * S + rng() * (h - 20 * S), (0.6 + rng()) * S, 0, Math.PI * 2); ctx.fill(); }
  }
  const t = finish(c, true, 8);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
