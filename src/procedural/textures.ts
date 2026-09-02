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
  const gloss = new Float32Array(tilesX * tilesY); // per-tile roughness offset (batch/glaze drift)
  // One replaced tile (a later batch: whiter, cooler, glossier), in the aisle short of the door.
  const replaced = wear ? [Math.floor((DOOR.centerX - 1.35 - wear.originX) / wear.metresPerTile), Math.floor((1.24 - wear.originZ) / wear.metresPerTile)] : [-1, -1];
  if (wear && (replaced[0] + replaced[1]) % 2 === 0) replaced[0] += 1; // must land on a white
  for (let ty = 0; ty < tilesY; ty++)
    for (let tx = 0; tx < tilesX; tx++) {
      const black = (tx + ty) % 2 === 0;
      const v = (rng() - 0.5) * 2; // −1..1 tone
      const hue = (rng() - 0.5) * 2; // −1 cool .. +1 warm
      isBlack[ty * tilesX + tx] = black ? 1 : 0;
      tone[ty * tilesX + tx] = v;
      gloss[ty * tilesX + tx] = (rng() - 0.5) * 0.12;
      let r: number, g: number, b: number;
      if (black) {
        // Blue-black glaze, ±8 % between tiles, some pulled brownish, some bluer
        const base = 26 * (1 + v * 0.08);
        r = base * (0.96 + hue * 0.06); g = base * 0.98; b = base * (1.05 - hue * 0.06);
      } else if (tx === replaced[0] && ty === replaced[1]) {
        r = 236; g = 236; b = 234;
        gloss[ty * tilesX + tx] = -0.1;
      } else {
        // Warm off-white, ±3.5 % between tiles, and a warm/cool split (cream vs. grey-white)
        const base = 220 * (1 + v * 0.035);
        r = base * (1 + hue * 0.012); g = base * 0.985; b = base * (0.95 - hue * 0.025);
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
      let r = inGrout ? 0.9 : (black ? 0.47 : 0.37) + gloss[ty * tilesX + tx] + n * 0.12 + fine * 0.04;
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
          // Dust and mop residue fill the joint near the walls: pale, matte. In the lanes the
          // joint goes darker (ground-in grime).
          const dr = 194, dg = 186, db = 172;
          const a = dust * 0.8;
          d[o] = d[o] * (1 - a) + dr * a; d[o + 1] = d[o + 1] * (1 - a) + dg * a; d[o + 2] = d[o + 2] * (1 - a) + db * a;
          k *= 1 - lane * 0.2;
          r = 0.9 + dust * 0.08;
        } else {
          // Traffic: the glaze dulls (roughness up), whites grey off by a clear step (rev 2:
          // 0.1 → 0.24 — rev 1's 4 % was lost under tone mapping), blacks scuff to a grey haze.
          r += lane * 0.3 - shelter * 0.12;
          greyMix = lane * (black ? 0.24 : 0.32);
          k *= 1 + dust * 0.03 * (black ? 2 : 1); // a dust film reads lighter on the blacks
        }
      }
      if (greyMix > 0) {
        const gr = 138, gg = 134, gb = 128;
        d[o] = d[o] * (1 - greyMix) + gr * greyMix; d[o + 1] = d[o + 1] * (1 - greyMix) + gg * greyMix; d[o + 2] = d[o + 2] * (1 - greyMix) + gb * greyMix;
      }
      d[o] = Math.min(255, d[o] * k); d[o + 1] = Math.min(255, d[o + 1] * k); d[o + 2] = Math.min(255, d[o + 2] * k);
      rough[i] = r;
    }
  }
  ctx.putImageData(img, 0, 0);

  if (wear) {
    // Rubber transfer (rev 2): hard-edged black marks left by shoe soles — no blur, each one
    // its own width (4–14 mm), length (20–180 mm), curvature (straight drags to tight hooks)
    // and weight. They land where feet go: 85 % are drawn from the lanes, weighted by lane
    // strength, so the aisle and the door fan carry most, the counter standing zone some,
    // and the sheltered floor under the booths almost none. On the black glaze rubber does
    // not show; there the sole leaves a grey abrasion haze instead.
    const toPx = (wx: number, wz: number): [number, number] => [(wx - wear.originX) / mPerPx, (wz - wear.originZ) / mPerPx];
    const laneW = wear.lanes.map((L) => L.k * L.k);
    const laneTot = laneW.reduce((a, b) => a + b, 0);
    ctx.lineCap = "butt";
    for (let s = 0; s < 340; s++) {
      let wx: number, wz: number;
      if (rng() < 0.85 && wear.lanes.length) {
        let pick = rng() * laneTot, li = 0;
        while (li < laneW.length - 1 && pick > laneW[li]) { pick -= laneW[li]; li++; }
        const L = wear.lanes[li];
        const seg = Math.floor(rng() * (L.pts.length - 1));
        const t = rng();
        // Gaussian-ish across the lane: most marks near the centre line
        const across = (rng() + rng() - 1) * L.half * 1.6;
        const dx = L.pts[seg + 1][0] - L.pts[seg][0], dz = L.pts[seg + 1][1] - L.pts[seg][1], ln = Math.hypot(dx, dz) || 1;
        wx = L.pts[seg][0] + dx * t - (dz / ln) * across;
        wz = L.pts[seg][1] + dz * t + (dx / ln) * across;
      } else {
        wx = wear.originX + rng() * w * mPerPx;
        wz = wear.originZ + rng() * h * mPerPx;
        let shelter = false;
        for (const [x0, z0, x1, z1] of wear.sheltered) if (wx > x0 && wx < x1 && wz > z0 && wz < z1) shelter = true;
        if (shelter && rng() < 0.9) continue;
      }
      const [px, py] = toPx(wx, wz);
      if (px < 2 || py < 2 || px > w - 2 || py > h - 2) continue;
      const black = isBlack[Math.floor(py / tilePx) * tilesX + Math.floor(px / tilePx)] === 1;
      const kind = rng();
      const len = (kind < 0.15 ? 0.12 + rng() * 0.16 : 0.02 + rng() * 0.09) / mPerPx; // a few long skids
      const ang = rng() * Math.PI * 2;
      const bend = kind < 0.4 ? (rng() - 0.5) * 0.3 : (rng() - 0.5) * 2.6; // straight drags vs hooks
      const wMm = kind < 0.15 ? 3 + rng() * 5 : 4 + rng() * 10;
      ctx.lineWidth = Math.max(0.8, wMm / (mPerPx * 1000));
      ctx.strokeStyle = black ? `rgba(160,156,150,${0.12 + rng() * 0.2})` : `rgba(24,20,17,${0.45 + rng() * 0.5})`;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + Math.cos(ang + bend) * len * 0.5, py + Math.sin(ang + bend) * len * 0.5, px + Math.cos(ang) * len, py + Math.sin(ang) * len);
      ctx.stroke();
    }
    // Hairline crack: a jittered polyline through several tiles — one dark line over a faint
    // wider shadow. (Rev 2: no offset light "catch" line — two 1-texel lines a fraction of a
    // texel apart beat against the texel grid and the crack rendered as a twisted rope.)
    // The dark line itself is a 2 mm ribbon mesh in Shell.ts (floorCrackPath — same polyline):
    // at 3.75 mm per texel a 1-texel antialiased diagonal magnifies into a string of beads.
    // The map carries only its soft shadow and a faint darkening so it survives at distance.
    const path: Array<[number, number]> = floorCrackPath(wear).map(([x, z]) => toPx(x, z));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const [col, off, lw] of [["rgba(40,34,28,0.16)", 0, 2.6], ["rgba(22,18,14,0.3)", 0, 1.2]] as Array<[string, number, number]>) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      path.forEach(([px, py], i) => (i ? ctx.lineTo(px + off, py + off) : ctx.moveTo(px + off, py + off)));
      ctx.stroke();
    }
    // The crack also breaks the glaze: matte along it. Anti-aliased by distance to the
    // polyline — a 3×3 texel stamp at rounded positions gave a stair-stepped matte band whose
    // jaggies beat against the dark line and read as a twisted rope in specular.
    for (let k = 0; k + 1 < path.length; k++) {
      const [ax, ay] = path[k], [bx, by] = path[k + 1];
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx)) - 2), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx)) + 2);
      const y0 = Math.max(0, Math.floor(Math.min(ay, by)) - 2), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by)) + 2);
      const vx = bx - ax, vy = by - ay, vv = vx * vx + vy * vy || 1;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * vx + (y + 0.5 - ay) * vy) / vv));
        const d = Math.hypot(x + 0.5 - ax - vx * t, y + 0.5 - ay - vy * t);
        const m = 1 - THREE.MathUtils.smoothstep(d, 0.5, 1.6);
        if (m > 0) { const i = y * w + x; rough[i] = Math.max(rough[i], rough[i] + (0.62 - rough[i]) * m); }
      }
    }
  }
  return { map: finish(c, true, anisotropy), roughnessMap: greyFromField(rough, w, h, anisotropy), normalMap: floorGrout(1024, wear?.seed ?? 1234) };
}

/**
 * The hairline crack's polyline in world metres (x, z): a gentle two-frequency wander about
 * the heading in `wear.crack`. Shared by the floor map (shadow + matte band) and the 2 mm
 * ribbon Shell.ts lays on the tile so both stay registered.
 */
export function floorCrackPath(wear: FloorWear): Array<[number, number]> {
  const { x, z, len, deg } = wear.crack;
  const a = THREE.MathUtils.degToRad(deg);
  const steps = 22;
  const pts: Array<[number, number]> = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const wob = Math.sin(t * 9.1) * 0.008 + Math.sin(t * 4.3 + 1.3) * 0.006 + Math.sin(t * 23.7 + 0.4) * 0.0012;
    pts.push([x + Math.cos(a) * len * t - Math.sin(a) * wob, z + Math.sin(a) * len * t + Math.cos(a) * wob]);
  }
  return pts;
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
      // Aisle: worn z ≈ 0.85–1.65, leaving an unworn strip against the booth plinths and under
      // the stool seats (rev 2: half 0.42 → 0.3 so the step is visible from the door end).
      { pts: [[-halfX + 0.4, aisleZ], [COUNTER.xMax + 0.3, aisleZ], [doorX - 0.3, aisleZ + 0.15]], half: 0.3, k: 1 },
      { pts: [[doorX, zFront - 0.05], [doorX - 0.1, zFront - 0.7], [doorX - 0.35, aisleZ + 0.15]], half: 0.32, k: 1 },
      // The door fan: everyone steps in and turns toward the counter, spreading the wear.
      { pts: [[doorX, zFront - 0.1], [doorX - 0.75, zFront - 0.75]], half: 0.3, k: 0.8 },
      { pts: [[doorX - 0.05, zFront - 0.15], [doorX - 0.5, zFront - 1.0], [COUNTER.xMax + 0.2, stoolZ + 0.35]], half: 0.28, k: 0.7 },
      { pts: [[COUNTER.xMin + 0.5, stoolZ + 0.36], [COUNTER.xMax - 0.2, stoolZ + 0.36]], half: 0.14, k: 0.5 },
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
    // Where the slab moved at the counter's end, across the aisle (in floor-macro and length).
    crack: { x: COUNTER.xMax + 0.45, z: stoolZ + 0.45, len: 0.85, deg: 112 },
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
    // Rev 2. What a wall behind seating actually carries is one thing, not a stack of
    // streaks: a diffuse grey band where shoulders, jackets and chair backs polish and dirty
    // the paint (v0–v1, ≈ 0.95–1.12 m, densest in the middle, patchy along the wall), with a
    // darker paint-transfer line at contact height — the booth cap's arris, ~65 % up the
    // band — 6–9 mm tall, broken into runs, wandering ±3 mm. A few small dark knocks sit in
    // the band. Nothing above or below it. Burnished paint under the band is glossier.
    const { v0, v1, perMetre } = opts.scuff;
    const yTop = (1 - v1) * size, yBot = (1 - v0) * size, yMid = (yTop + yBot) / 2, half = (yBot - yTop) / 2;
    const yLine = yBot - (yBot - yTop) * 0.65;
    const along = makeFbm(seed + 41, 5, 3);
    const gate = makeFbm(seed + 43, 18, 2);
    const img2 = ctx.getImageData(0, Math.max(0, Math.floor(yTop - half)), size, Math.min(size, Math.ceil(yBot + half)) - Math.max(0, Math.floor(yTop - half)));
    const y0 = Math.max(0, Math.floor(yTop - half));
    const d2 = img2.data;
    for (let yy = 0; yy < img2.height; yy++) {
      const y = y0 + yy;
      // Band profile: raised cosine across v0..v1, tail a little beyond
      const t = Math.abs(y - yMid) / (half * 1.15);
      const prof = t >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * t);
      // Contact line: 6–9 mm tall, wobbling ±3 mm
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const patch = 0.35 + 0.65 * along(u, 0.3); // where people sit more
        const aBand = prof * prof * 0.24 * patch;
        const wob = (gate(u, 0.8) - 0.5) * 0.006 * pxPerM;
        const lh = (0.006 + 0.003 * along(u, 0.1)) * pxPerM / 2;
        const dl = Math.abs(y - (yLine + wob)) / lh;
        const open = smoothstep(0.42, 0.55, gate(u, 0.5)); // broken into runs
        const aLine = dl >= 1 ? 0 : (1 - dl * dl) * 0.3 * open * patch;
        const i = (yy * size + x) * 4;
        // Band: grey-brown grime; line: darker transfer (wood finish + grime)
        let r = d2[i], g = d2[i + 1], b = d2[i + 2];
        r = r * (1 - aBand) + 120 * aBand; g = g * (1 - aBand) + 112 * aBand; b = b * (1 - aBand) + 100 * aBand;
        r = r * (1 - aLine) + 72 * aLine; g = g * (1 - aLine) + 60 * aLine; b = b * (1 - aLine) + 48 * aLine;
        d2[i] = r; d2[i + 1] = g; d2[i + 2] = b;
        rough[y * size + x] -= aBand * 1.1 + aLine * 0.3; // burnished under the band
      }
    }
    ctx.putImageData(img2, 0, y0);
    // Knocks: small dark ragged ellipses in the band
    const n = Math.round(perMetre * metres);
    for (let s = 0; s < n; s++) {
      const x = rng() * size, y = yTop + rng() * (yBot - yTop);
      const len = (0.005 + rng() * 0.02) * pxPerM, lw = 0.004 * pxPerM, ang = (rng() - 0.5) * 0.4;
      ctx.fillStyle = `rgba(40,34,28,${0.25 + rng() * 0.25})`;
      ctx.beginPath();
      ctx.ellipse(x, y, len * 0.5, lw * 0.5, ang, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return { map: finish(c, true, 4), roughnessMap: greyFromField(rough, size, size, 4) };
}

/**
 * Roller stipple: a 3/8" nap leaves 1–3 mm domes of paint at ~60 % coverage,
 * 0.1–0.3 mm high (why flat walls still glint at grazing light). Detail canvas
 * covering 0.3 m (rev 2: was 0.6 m — at 0.59 mm/texel a 1 mm dome was two texels
 * and the relief blurred away); tiled with repeat = metres / 0.3 on the wall UVs.
 * Cells on a jittered 2.2 mm grid, each a dome of random height, 15 % skipped,
 * on a 0.05 mm fbm swell so the field never reads as a regular dot screen.
 */
export const WALL_STIPPLE_M = 0.3;
export function wallStipple(size: number, seed: number): { normalMap: THREE.Texture; aoMap: THREE.Texture } {
  const mmPerPx = (WALL_STIPPLE_M * 1000) / size;
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
      cr[k] = (0.7 + rng() * 1.0) / mmPerPx; // dome radius 0.7–1.7 mm
      ch[k] = rng() < 0.15 ? 0 : 0.1 + rng() * 0.2; // height mm
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
  // Occlusion between the domes (rev 2): the valleys of an orange-peel film sit in their
  // own shade whatever the light does, so the relief keeps a lighting-independent presence
  // (the normal alone vanished under a flat rig). 0.84 in the deepest valley, 1 on a dome top.
  const ao = new Float32Array(size * size);
  for (let i = 0; i < ao.length; i++) ao[i] = 0.84 + 0.16 * clamp01(hf[i] / 0.25);
  return { normalMap: normalFromHeight(hf, size, size, 0.5 / mmPerPx, 4), aoMap: greyFromField(ao, size, size, 4) };
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
  if (!stain) {
    ctx.putImageData(img, 0, 0);
    return { map: finish(c, true, 4), roughnessMap: greyFromField(rough, size, size, 4), normalMap: normalFromHeight(hf, size, size, 0.5 / mmPerPx, 4) };
  }
  // Stained variant (rev 2): a 2 × 1 atlas — two different stains on the same base tile,
  // so the two stained tiles in the room do not share an outline (Ceiling.ts picks u halves).
  // A real ceiling-tile leak: an irregular, lobed outline (the union of two or three blobs
  // whose radius wanders with angle and grows a few tongues), a thin dark-brown perimeter
  // line where the minerals dried, a pale tan interior lighter than the rim, and inside it
  // the board has swelled (a low dome in the height field) and the paint crazed (fine
  // dark cracks). An older, fainter tide line sits off-centre inside — the first leak.
  const W = size * 2;
  const { c: c2, ctx: ctx2 } = canvas(W, size);
  const img2 = ctx2.createImageData(W, size);
  const d2 = img2.data;
  const rough2 = new Float32Array(W * size), hf2 = new Float32Array(W * size);
  for (let y = 0; y < size; y++)
    for (let k = 0; k < 2; k++) {
      d2.set(d.subarray(y * size * 4, (y + 1) * size * 4), (y * W + k * size) * 4);
      rough2.set(rough.subarray(y * size, (y + 1) * size), y * W + k * size);
      hf2.set(hf.subarray(y * size, (y + 1) * size), y * W + k * size);
    }
  for (let k = 0; k < 2; k++) {
    const srng = makeRng(seed * 7 + k * 131);
    const wob = makeFbm(seed + 9 + k * 5, 3, 2);
    // Blobs: [cx, cy, R, lobe phase, lobe count]. Variant 0 is the big one under the AC line
    // (two overlapping leaks + a tongue running toward one edge); variant 1 a smaller single leak.
    const blobs: Array<[number, number, number, number, number]> = [];
    const px = (mm: number) => (mm / 600) * size;
    if (k === 0) {
      const cx = size * 0.5, cy = size * 0.48;
      blobs.push([cx, cy, px(150), srng() * 6.3, 3]);
      blobs.push([cx + px(95), cy - px(60), px(105), srng() * 6.3, 4]);
      blobs.push([cx - px(60), cy + px(130), px(70), srng() * 6.3, 2]); // tongue
    } else {
      const cx = size * 0.42, cy = size * 0.55;
      blobs.push([cx, cy, px(110), srng() * 6.3, 4]);
      blobs.push([cx + px(70), cy + px(40), px(60), srng() * 6.3, 3]);
    }
    // Older inner tide: a smaller blob, off-centre, only its rim
    const inner: [number, number, number, number, number] = [blobs[0][0] - px(30), blobs[0][1] + px(20), blobs[0][2] * 0.58, srng() * 6.3, 3];
    const field = (bl: Array<[number, number, number, number, number]>, x: number, y: number, wobK: number) => {
      // Signed "inside-ness": max over blobs of 1 − r/R(θ). > 0 inside.
      let best = -1e9;
      for (const [cx, cy, R, ph, lobes] of bl) {
        const dx = x - cx, dy = y - cy;
        const ang = Math.atan2(dy, dx);
        const lobe = 1 + 0.18 * Math.cos(lobes * ang + ph) + 0.1 * Math.cos((lobes * 2 + 1) * ang - ph);
        const w = 0.8 + 0.5 * wob(wobK + 0.3 * Math.cos(ang), wobK + 0.3 * Math.sin(ang)); // periodic in θ
        best = Math.max(best, 1 - Math.hypot(dx, dy) / (R * lobe * w));
      }
      return best;
    };
    const craze = makeFbm(seed + 21 + k, 40, 3);
    const mottle = makeFbm(seed + 33 + k, 9, 3);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const s = field(blobs, x, y, 0.3 + k);
        if (s < -0.06) continue;
        const i = (y * W + k * size + x) * 4, j = y * W + k * size + x;
        // Perimeter: a 3–5 mm dark brown line just inside the edge, sharper outside
        const edge = smoothstep(-0.02, 0.0, s) * (1 - smoothstep(0.012, 0.045, s));
        // Interior wash: pale tan, weaker toward the centre (dried from the middle out),
        // with a darker mottled halo band a little inside the rim
        const inside = smoothstep(0.0, 0.02, s);
        const halo = inside * (1 - smoothstep(0.05, 0.16, s)) * (0.5 + 0.5 * mottle(x / size, y / size));
        const wash = inside * (0.10 + 0.08 * (1 - smoothstep(0.1, 0.5, s)) + 0.06 * mottle(x / size + 3, y / size));
        // Older tide line inside: fainter, its own outline
        const si = field([inner], x, y, 0.7 + k);
        const tide = smoothstep(-0.02, 0.0, si) * (1 - smoothstep(0.008, 0.03, si)) * inside;
        // Blend: perimeter in dark brown, wash/halo in tan
        const aLine = Math.min(1, edge * 0.85 + tide * 0.35);
        const aWash = Math.min(1, wash + halo * 0.22);
        let r = d2[i], g = d2[i + 1], b = d2[i + 2];
        r = r * (1 - aWash) + 196 * aWash; g = g * (1 - aWash) + 168 * aWash; b = b * (1 - aWash) + 118 * aWash;
        r = r * (1 - aLine) + 104 * aLine; g = g * (1 - aLine) + 72 * aLine; b = b * (1 - aLine) + 38 * aLine;
        // Swelling: the board domes up to 1.2 mm inside the stain; crazing: dark hairline
        // cracks where the paint film broke over the swell (thresholded noise ridges)
        const dome = inside * smoothstep(0.0, 0.25, s) * 1.2;
        const cz = craze(x / size, y / size);
        const crack = inside * smoothstep(0.0, 0.1, s) * (1 - smoothstep(0.012, 0.03, Math.abs(cz - 0.5)));
        hf2[j] += dome - crack * 0.5;
        const ck = crack * 0.35;
        r = r * (1 - ck) + 90 * ck; g = g * (1 - ck) + 70 * ck; b = b * (1 - ck) + 48 * ck;
        // Flaked paint: a few lighter chalky patches where the film lifted
        const flake = inside * smoothstep(0.62, 0.7, mottle(x / size + 7, y / size + 2));
        r = r * (1 - flake * 0.5) + 232 * flake * 0.5; g = g * (1 - flake * 0.5) + 226 * flake * 0.5; b = b * (1 - flake * 0.5) + 214 * flake * 0.5;
        d2[i] = r; d2[i + 1] = g; d2[i + 2] = b;
        rough2[j] = Math.max(rough2[j] - aWash * 0.15 - aLine * 0.1 + flake * 0.1, 0.7);
      }
  }
  ctx2.putImageData(img2, 0, 0);
  return { map: finish(c2, true, 4), roughnessMap: greyFromField(rough2, W, size, 4), normalMap: normalFromHeight(hf2, W, size, 0.5 / mmPerPx, 4) };
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
  // Tee faces are 24 mm wide with metric UVs (v 0–0.024): with flipY that is the LAST 2.4 % of
  // rows. Rev 2: 7–12 chips per metre, 3–12 mm long along the tee × 1.5–4 mm tall (a tile
  // pushed up drags the flange edge), showing grey zinc with a dark rim and a rust bloom that
  // spreads 1.5× beyond the chip; plus a grime drift along the face (finger-grey at 0–3 %).
  const faceRows = Math.max(4, Math.round(size * 0.024));
  const y0 = size - faceRows;
  const chips = 7 + Math.floor(rng() * 6);
  for (let k = 0; k < chips; k++) {
    const x = rng() * size, y = y0 + faceRows * (0.15 + rng() * 0.7);
    const L = (3 + rng() * 9) * pxPerMm, Hc = (1.5 + rng() * 2.5) * pxPerMm, ang = (rng() - 0.5) * 0.25;
    // Rust bloom first (under the chip edge), then the bare zinc, then the dark rim
    ctx.fillStyle = "rgba(150,82,34,0.55)";
    ctx.beginPath(); ctx.ellipse(x, y, L * 0.8, Hc * 0.9, ang, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(120,60,25,0.35)";
    ctx.beginPath(); ctx.ellipse(x + L * 0.2, y + Hc * 0.4, L * 0.7, Hc * 0.8, ang, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgb(132,134,136)";
    ctx.beginPath(); ctx.ellipse(x, y, L * 0.5, Hc * 0.5, ang, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(60,50,40,0.8)";
    ctx.lineWidth = Math.max(0.6, 0.3 * pxPerMm);
    ctx.beginPath(); ctx.ellipse(x, y, L * 0.5, Hc * 0.5, ang, 0, Math.PI * 2); ctx.stroke();
    for (let dy = -Hc; dy <= Hc; dy++)
      for (let dx = -L; dx <= L; dx++) {
        const i = ((Math.round(y + dy) + size) % size) * size + ((Math.round(x + dx) + size) % size);
        const inChip = (dx * dx) / (L * L * 0.25) + (dy * dy) / (Hc * Hc * 0.25) < 1;
        rough[i] = inChip ? 0.64 : 1.35; // × 0.55 paint → 0.35 bare zinc; rust matte
      }
  }
  // Grime drift along the face: a few darker runs where the tile edges rub the flange
  const grime = makeFbm(seed + 3, 9, 2);
  const im2 = ctx.getImageData(0, y0, size, faceRows);
  for (let yy = 0; yy < faceRows; yy++)
    for (let x = 0; x < size; x++) {
      const g = smoothstep(0.5, 0.75, grime(x / size, yy / faceRows)) * 0.06;
      const i = (yy * size + x) * 4;
      im2.data[i] *= 1 - g; im2.data[i + 1] *= 1 - g * 0.9; im2.data[i + 2] *= 1 - g * 0.8;
    }
  ctx.putImageData(im2, 0, y0);
  return { map: finish(c, true, 4), roughnessMap: greyFromField(rough, size, size, 4) };
}

export interface VinylSet {
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  /** sRGB: the vinyl's red, burnished blotches a shade darker, pale cotton scrim in the crack floors. */
  map: THREE.Texture;
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
        // Rev 2: on the welt-cracked panel the general patches are halved so the seam bands
        // lead (the panel's u repeats per channel, and repeated patches read as a print).
        let presence = Math.min(1, Math.max(0, (p - 0.5) / 0.14)) * (weltCracks ? 0.45 : 1);
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
  const { c: mc, ctx: mctx } = canvas(size, size);
  const mimg = mctx.createImageData(size, size);
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
      // wherever a metric panel's jitter puts them — drop up to 0.18 in 5–12 cm blotches
      // (rev 2: was 0.1; also a shade darker in the albedo, as polished vinyl is).
      const worn = smoothstep(0.54, 0.7, polish(x / size, y / size));
      const r = 0.45 + (H(x, y) - crack[i]) * 0.06 + crack[i] * 0.07 + crease[i] * 0.04 - worn * 0.18;
      const rv = Math.min(255, Math.max(0, r * 255));
      rimg.data[o] = rv; rimg.data[o + 1] = rv; rimg.data[o + 2] = rv; rimg.data[o + 3] = 255;
      // Albedo (sRGB): #AA1A15 vinyl; burnished −10 %; the floor of a through-crack is the
      // pale cotton scrim the vinyl was cast on (rev 2 — the critic's "scrim in the crack").
      const k = 1 - 0.1 * worn;
      const scrim = smoothstep(0.35, 0.85, crack[i]);
      mimg.data[o] = 170 * k * (1 - scrim) + 206 * scrim;
      mimg.data[o + 1] = 26 * k * (1 - scrim) + 196 * scrim;
      mimg.data[o + 2] = 21 * k * (1 - scrim) + 176 * scrim;
      mimg.data[o + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  mctx.putImageData(mimg, 0, 0);
  return { normalMap: finish(nc, false, 8), roughnessMap: finish(rc, false, 8), map: finish(mc, true, 8) };
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
  // Gold flecks in the print: soft 1.5 mm dots at 0.3/cm² (rev 2: the 1-texel hard dots at
  // 0.8/cm² aliased into a regular halftone screen under minification).
  ctx.fillStyle = "rgba(216,194,138,0.55)";
  for (let k = 0; k < areaCm2 * 0.3; k++) { ctx.beginPath(); ctx.arc(rng() * size, rng() * size, 0.75 * pxPerMm, 0, Math.PI * 2); ctx.fill(); }

  // Use (rev 2, in the albedo — the roughness alone never read): wipe haze — the last rag's
  // sweeps left a faint greyer film in long arcs; two or three cup rings (coffee residue,
  // usually incomplete); fine scratches, light where the print's clear coat scattered, one
  // or two dark where something dug in.
  const wipe = makeFbm(seed + 5, 6, 3);
  const rimg = rctx.createImageData(size, size);
  const arcs: Array<[number, number, number, number, number]> = [];
  for (let k = 0; k < 4; k++) arcs.push([rng() * size, size * (0.3 + rng() * 0.7), size * (0.3 + rng() * 0.4), rng() * Math.PI * 2, 0.6 + rng() * 0.9]);
  ctx.lineCap = "round";
  for (const [ax, ay, ar, a0, sweep] of arcs) {
    for (let p = 0; p < 5; p++) {
      ctx.strokeStyle = `rgba(150,146,140,${0.035 + rng() * 0.03})`;
      ctx.lineWidth = (8 + rng() * 16) * pxPerMm;
      ctx.beginPath();
      ctx.arc(ax, ay, ar + (p - 2) * 14 * pxPerMm, a0, a0 + sweep);
      ctx.stroke();
    }
  }
  const rings: Array<[number, number, number, number]> = [];
  for (let k = 0; k < 3; k++) {
    const rx = size * (0.15 + rng() * 0.7), ry = size * (0.15 + rng() * 0.7), rr = (34 + rng() * 10) * pxPerMm;
    rings.push([rx, ry, rr, rng() * Math.PI * 2]);
    const a0 = rng() * Math.PI * 2, gap = rng() < 0.7 ? 0.5 + rng() * 1.2 : 0;
    ctx.strokeStyle = "rgba(118,86,48,0.16)";
    ctx.lineWidth = 3.5 * pxPerMm;
    ctx.beginPath(); ctx.arc(rx, ry, rr, a0 + gap, a0 + Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(118,86,48,0.28)"; // the dried outer edge is denser
    ctx.lineWidth = 0.9 * pxPerMm;
    ctx.beginPath(); ctx.arc(rx, ry, rr + 1.6 * pxPerMm, a0 + gap + 0.1, a0 + Math.PI * 2 - 0.1); ctx.stroke();
  }
  ctx.lineCap = "butt";
  const scr: Array<[number, number, number, number]> = [];
  for (let k = 0; k < 11; k++) {
    const sx = rng() * size, sy = rng() * size, len = (40 + rng() * 180) * pxPerMm, ang = rng() * Math.PI;
    const dark = k < 2;
    ctx.strokeStyle = dark ? "rgba(70,60,50,0.5)" : `rgba(255,255,255,${0.3 + rng() * 0.25})`;
    ctx.lineWidth = dark ? 1.1 : 0.9;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len); ctx.stroke();
    scr.push([sx, sy, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len]);
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = wipe(x / size, (y / size) * 0.15) - 0.5;
      let r = 0.18 + n * 0.1;
      for (const [rx, ry, rr] of rings) { const dd = Math.abs(Math.hypot(x - rx, y - ry) - rr); if (dd < 2.5 * pxPerMm) r += 0.3 * (1 - dd / (2.5 * pxPerMm)); }
      const v = Math.min(255, Math.max(0, r * 255));
      const o = (y * size + x) * 4;
      rimg.data[o] = v; rimg.data[o + 1] = v; rimg.data[o + 2] = v; rimg.data[o + 3] = 255;
    }
  rctx.putImageData(rimg, 0, 0);
  // The same haze arcs and scratches in the roughness (lighter = duller), so the albedo marks
  // and the gloss breaks coincide — one map pair, one UV offset per table (Booths.ts).
  rctx.lineCap = "round";
  for (const [ax, ay, ar, a0, sweep] of arcs) {
    rctx.strokeStyle = "rgba(255,255,255,0.14)";
    rctx.lineWidth = 60 * pxPerMm;
    rctx.beginPath(); rctx.arc(ax, ay, ar, a0, a0 + sweep); rctx.stroke();
  }
  rctx.lineCap = "butt";
  rctx.strokeStyle = "rgba(255,255,255,0.6)";
  rctx.lineWidth = 1;
  for (const [sx, sy, ex, ey] of scr) { rctx.beginPath(); rctx.moveTo(sx, sy); rctx.lineTo(ex, ey); rctx.stroke(); }
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
    const cx = rng() * size, cy = rng() * size, ra = (2.5 + rng() * 5) * pxPerMm, rb = ra * (0.45 + rng() * 0.5), ang = rng() * Math.PI; // 5–15 mm (rev 2: was 3–8)
    const R = Math.ceil(Math.max(ra, rb) * 1.6);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const u = (dx * Math.cos(ang) + dy * Math.sin(ang)) / ra, v = (-dx * Math.sin(ang) + dy * Math.cos(ang)) / rb;
        const dd = Math.hypot(u, v);
        if (dd > 1.6) continue;
        const x = (Math.round(cx + dx) + size) % size, y = (Math.round(cy + dy) + size) % size, i = y * size + x, idx = i * 4;
        const inside = 1 - smoothstep(0.7, 1.05, dd), ring = smoothstep(0.85, 1.05, dd) * (1 - smoothstep(1.2, 1.6, dd));
        heights[i] -= inside * 0.6;
        const k2 = 1 - inside * 0.26 + ring * 0.09;
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
      f[y * size + x] = base + s * band * 0.3 + (haze(x / size, y / size) - 0.5) * 0.04 + (rng() - 0.5) * 0.01;
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
  // Rev 2: shorter (2–10 % of the girth) and dimmer (+0.06–0.12) — rev 1's long bright
  // streaks read as chalk lines on the glass.
  for (let s = 0; s < 30; s++) {
    const x0 = rng() * size, y0 = (0.05 + rng() * 0.4) * size, len = (0.02 + rng() * 0.08) * size, ang = (rng() - 0.5) * 0.9;
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < len; k++) pts.push([(x0 + Math.cos(ang) * k) % size, y0 + Math.sin(ang) * k * 0.4]);
    strokeField(f, size, pts, 0.06 + rng() * 0.06, 1);
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
 * Cove base in service (rev 2: absolute colour, the material is white): black vinyl
 * (#2a2724) with a grey dust film over the bottom 25 mm (the broom never quite reaches
 * the toe), a pale mineral mop tide line 30–45 mm up — a wavering horizontal deposit
 * with drips, where the mop water sat and dried night after night — and light-grey heel
 * scuffs along the run. Metric UVs (1 canvas = 1 m of base, jittered per run).
 * Roughness is × the material value (scuffs matte 1.25, mop residue matte, dust matte).
 */
export function baseboardScuff(size: number, seed: number): TextureSet {
  const rng = makeRng(seed);
  const { c, ctx } = canvas(size, size / 4);
  const h = size / 4;
  const mottle = makeFbm(seed, 6, 3);
  const tideWob = makeFbm(seed + 2, 5, 2);
  const img = ctx.createImageData(size, h);
  const rough = new Float32Array(size * h);
  const mmPerRow = 100 / h; // the cove is ≈ 100 mm tall; v 0 at the floor
  for (let y = 0; y < h; y++) {
    const v = 1 - y / h;
    const mm = v * 100;
    const toe = 1 - smoothstep(12, 30, mm);
    for (let x = 0; x < size; x++) {
      const m = mottle(x / size, y / h) - 0.5;
      // Base vinyl with a ±6 % mottle
      let r = 42 * (1 + m * 0.12), g = 39 * (1 + m * 0.12), b = 36 * (1 + m * 0.12);
      // Dust film: grey, denser at the very toe
      const dust = toe * (0.45 + 0.5 * (mottle(x / size + 0.3, y / h) - 0.5) * 2) * 0.55;
      r = r * (1 - dust) + 118 * dust; g = g * (1 - dust) + 114 * dust; b = b * (1 - dust) + 108 * dust;
      // Mop tide line: centre wanders 32–44 mm, 3–5 mm tall, denser on its upper edge
      const tc = 38 + (tideWob(x / size, 0.5) - 0.5) * 12, th = 2 + tideWob(x / size, 0.2) * 3;
      const dt = (mm - tc) / th;
      const tide = dt > -1 && dt < 1 ? (1 - dt * dt) * (0.55 + 0.45 * smoothstep(-0.2, 0.6, dt)) * smoothstep(0.35, 0.6, tideWob(x / size, 0.8)) : 0;
      const ta = tide * 0.55;
      r = r * (1 - ta) + 165 * ta; g = g * (1 - ta) + 160 * ta; b = b * (1 - ta) + 150 * ta;
      const o = (y * size + x) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      rough[y * size + x] = 1 + dust * 0.35 + ta * 0.3 - m * 0.2;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.lineCap = "round";
  // Drips below the tide line where the mop water ran
  for (let d = 0; d < 14; d++) {
    const x = rng() * size, top = h * (1 - 0.42 + rng() * 0.05);
    ctx.strokeStyle = `rgba(165,160,150,${0.25 + rng() * 0.25})`;
    ctx.lineWidth = 1 + rng() * 1.5;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + (rng() - 0.5) * 3, top + (6 + rng() * 14) / mmPerRow); ctx.stroke();
  }
  for (let s = 0; s < 26; s++) {
    // Heel/broom scuffs: light grey streaks, mostly along the run
    const x = rng() * size, y = (0.1 + rng() * 0.6) * h, len = (0.02 + rng() * 0.1) * size, ang = (rng() - 0.5) * 0.5;
    ctx.strokeStyle = `rgba(200,196,190,${0.2 + rng() * 0.3})`;
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
 * RGBA atlas for the door and window dressing (sRGB, clamp). Regions in 2048-space, each
 * with the aspect of the quad it dresses (core/shapes.ts DECAL is the same table in UV):
 *  open   [0,0]–[1024,683]          flip sign, STREET face: OPEN (300 × 200 mm card)
 *  closed [1024,0]–[2048,683]       flip sign, ROOM face: SORRY WE'RE CLOSED
 *  hours  [0,683]–[800,1723]        hours vinyl (white lettering, 200 × 260 mm)
 *  push   [800,683]–[1760,1083]     PUSH sticker (120 × 50 mm, red)
 *  cards  [800,1083]–[1480,1523]    card-acceptance sticker (85 × 55 mm, generic marks)
 *  film   [1480,1083]–[2048,1651]   window-film edge: clear, with the 3 mm cut-back line
 *                                   at the frame and a lifted corner
 * Text is drawn with the platform sans. After drawing, the colour of every opaque texel is
 * dilated into the transparent surround (rev 2): the atlas is not premultiplied, so with
 * black-transparent neighbours every mip level below 0 pulled the letters toward black and
 * the hours vinyl read as a grey blur from 3 m — the rev 1 "blurred decals".
 */
export function doorDecals(size: number): THREE.Texture {
  const { c, ctx } = canvas(size, size);
  ctx.clearRect(0, 0, size, size);
  const S = size / 2048;
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
  /** Draw `t` centred at (cx, cy) in `px` font, shrinking until it fits `maxW`. */
  const fit = (t: string, cx: number, cy: number, px: number, maxW: number, weight = "bold") => {
    let p = px;
    ctx.font = font(p, weight);
    while (ctx.measureText(t).width > maxW * S && p > 8) { p *= 0.94; ctx.font = font(p, weight); }
    ctx.fillText(t, cx * S, cy * S);
  };
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const M = 8; // transparent margin inside each region (bilinear guard at the quad edge)

  // Flip sign: one 300 × 200 mm card, both faces the same yellowed stock with a red border,
  // two suction-hook discs and a sag of string at the top. OPEN face red, CLOSED face black
  // with a red SORRY, as on the ubiquitous drugstore sign.
  const card = (x0: number, y0: number, w: number, h: number, draw: () => void) => {
    const x = (x0 + M) * S, y = (y0 + M) * S, cw = (w - 2 * M) * S, ch = (h - 2 * M) * S;
    ctx.fillStyle = "#f3eee0";
    rr(x, y, cw, ch, 14 * S); ctx.fill();
    // Slight age: a warm tint towards the bottom corners and a faint scuff
    const g = ctx.createLinearGradient(x, y, x, y + ch);
    g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(180,150,90,0.10)");
    ctx.fillStyle = g; rr(x, y, cw, ch, 14 * S); ctx.fill();
    ctx.lineWidth = 16 * S; ctx.strokeStyle = "#b5262a";
    rr(x + 34 * S, y + 34 * S, cw - 68 * S, ch - 68 * S, 8 * S); ctx.stroke();
    // Hooks + string: two grey suction discs at the top corners, thin white cord down to the card
    ctx.fillStyle = "rgba(180,180,178,0.95)";
    for (const hx of [x + 80 * S, x + cw - 80 * S]) { ctx.beginPath(); ctx.arc(hx, y + 10 * S, 22 * S, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = "rgba(120,118,112,0.8)"; ctx.lineWidth = 3 * S;
    ctx.beginPath(); ctx.moveTo(x + 80 * S, y + 10 * S); ctx.lineTo(x + 80 * S, y + 40 * S); ctx.moveTo(x + cw - 80 * S, y + 10 * S); ctx.lineTo(x + cw - 80 * S, y + 40 * S); ctx.stroke();
    draw();
  };
  card(0, 0, 1024, 683, () => {
    ctx.fillStyle = "#2a2622";
    fit("COME IN — WE'RE", 512, 118, 62, 760, "normal");
    ctx.fillStyle = "#b5262a";
    fit("OPEN", 512, 350, 420, 800);
    ctx.fillStyle = "#2a2622";
    fit("BREAKFAST ALL DAY", 512, 586, 54, 760, "normal");
  });
  card(1024, 0, 1024, 683, () => {
    ctx.fillStyle = "#b5262a";
    fit("SORRY", 1536, 110, 76, 760);
    ctx.fillStyle = "#2a2622";
    fit("WE'RE", 1536, 190, 62, 760, "normal");
    fit("CLOSED", 1536, 380, 330, 820);
    fit("PLEASE CALL AGAIN", 1536, 586, 50, 760, "normal");
  });

  // Hours: white vinyl letters, 200 × 260 mm at 4 px/mm, 1 mm dark keyline so they still
  // read against a bright lot. Drawn forwards here; Door.ts mirrors the quad's UVs because
  // this vinyl is applied reversed on the inside face to read from the street.
  {
    const cx = 400, top = 683 + 120;
    const line = (t: string, dy: number, px: number, weight = "bold") => {
      ctx.font = font(px, weight);
      ctx.lineWidth = 5 * S; ctx.strokeStyle = "rgba(30,28,26,0.85)";
      ctx.strokeText(t, cx * S, (top + dy) * S);
      ctx.fillStyle = "#e9e7e1"; // adhesive side of white vinyl, a touch grey from inside
      ctx.fillText(t, cx * S, (top + dy) * S);
    };
    line("HOURS", 0, 124);
    line("MON – SAT", 170, 76);
    line("6 AM – 3 PM", 262, 76, "normal");
    line("SUNDAY", 420, 76);
    line("7 AM – 2 PM", 512, 76, "normal");
    line("CLOSED HOLIDAYS", 690, 56, "normal");
  }
  // PUSH: red sticker (120 × 50 mm at 8 px/mm), white text, one corner lifting
  {
    const x = (800 + M) * S, y = (683 + M) * S, w = (960 - 2 * M) * S, h = (400 - 2 * M) * S;
    ctx.fillStyle = "#c0292c";
    rr(x, y, w, h, 24 * S); ctx.fill();
    ctx.fillStyle = "#f6f2ea";
    fit("PUSH", 1280, 683 + 208, 300, 860);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath(); ctx.moveTo(x + w, y + h); ctx.lineTo(x + w - 80 * S, y + h); ctx.lineTo(x + w, y + h - 80 * S); ctx.fill();
  }
  // Card sticker (85 × 55 mm at 8 px/mm): "WE ACCEPT" over four generic marks (no trademarks)
  {
    const k = 2.93;
    const x = (800 + M) * S, y = (1083 + M) * S, w = (680 - 2 * M) * S, h = (440 - 2 * M) * S;
    ctx.fillStyle = "#f5f3ee";
    rr(x, y, w, h, 20 * S); ctx.fill();
    ctx.fillStyle = "#2a2a30";
    fit("WE ACCEPT", 800 + 340, 1083 + 78, 74, 600);
    const marks: Array<[string, string]> = [["#1a3f8f", "#f0b323"], ["#d12b2b", "#f39c12"], ["#0a6fb5", "#f4f4f2"], ["#0d7a4a", "#f4f4f2"]];
    marks.forEach(([bg, fg], i) => {
      const mx = x + (14 + i * 54) * k * S, my = y + 52 * k * S, mw = 46 * k * S, mh = 30 * k * S;
      ctx.fillStyle = bg; rr(mx, my, mw, mh, 10 * S); ctx.fill();
      ctx.fillStyle = fg;
      if (i === 1) { ctx.beginPath(); ctx.arc(mx + 18 * k * S, my + mh / 2, 9 * k * S, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#e8b41a"; ctx.beginPath(); ctx.arc(mx + 29 * k * S, my + mh / 2, 9 * k * S, 0, Math.PI * 2); ctx.fill(); }
      else if (i === 0) ctx.fillRect(mx + 8 * k * S, my + 18 * k * S, 30 * k * S, 5 * k * S);
      else { ctx.font = font(14 * k); ctx.fillText(i === 2 ? "CARD" : "DEBIT", mx + mw / 2, my + mh / 2 + 2 * S); }
    });
    ctx.fillStyle = "#6a6a70";
    fit("$10 MINIMUM", 800 + 340, 1083 + 122 * k, 46, 600, "normal");
  }
  // Window film edge — transparent; the film stops 3 mm short of the frame (a brighter
  // hairline where bare glass shows), one lifted corner with a trapped-air sheen.
  {
    const x = 1480 * S, y = 1083 * S, w = 568 * S, h = 568 * S;
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 3 * S;
    ctx.strokeRect(x + 6 * S, y + 6 * S, w - 12 * S, h - 12 * S);
    ctx.fillStyle = "rgba(235,240,245,0.22)";
    ctx.beginPath(); ctx.moveTo(x + w - 6 * S, y + 6 * S); ctx.lineTo(x + w - 120 * S, y + 6 * S); ctx.lineTo(x + w - 6 * S, y + 160 * S); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2 * S;
    ctx.beginPath(); ctx.moveTo(x + w - 120 * S, y + 6 * S); ctx.lineTo(x + w - 6 * S, y + 160 * S); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    const rng = makeRng(77);
    for (let k = 0; k < 14; k++) { ctx.beginPath(); ctx.arc(x + 12 * S + rng() * (w - 24 * S), y + 12 * S + rng() * (h - 24 * S), (1 + 2 * rng()) * S, 0, Math.PI * 2); ctx.fill(); }
  }

  // Mip guard: push each opaque texel's colour into the transparent surround (6 texel
  // dilation), then give the rest a neutral light stock, so no mip level averages in black.
  {
    const img = ctx.getImageData(0, 0, size, size);
    const d = img.data;
    const n = size * size;
    const done = new Uint8Array(n);
    for (let i = 0; i < n; i++) done[i] = d[i * 4 + 3] > 0 ? 1 : 0;
    const passes = Math.max(3, Math.round(6 * S));
    for (let p = 0; p < passes; p++) {
      const next = new Uint8Array(done);
      for (let yy = 0; yy < size; yy++) {
        for (let xx = 0; xx < size; xx++) {
          const i = yy * size + xx;
          if (done[i]) continue;
          const nb = [xx > 0 ? i - 1 : -1, xx < size - 1 ? i + 1 : -1, yy > 0 ? i - size : -1, yy < size - 1 ? i + size : -1];
          let r = 0, g = 0, b = 0, cnt = 0;
          for (const j of nb) if (j >= 0 && done[j]) { r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; cnt++; }
          if (cnt) { d[i * 4] = r / cnt; d[i * 4 + 1] = g / cnt; d[i * 4 + 2] = b / cnt; next[i] = 1; }
        }
      }
      done.set(next);
    }
    for (let i = 0; i < n; i++) if (!done[i]) { d[i * 4] = 236; d[i * 4 + 1] = 234; d[i * 4 + 2] = 228; }
    ctx.putImageData(img, 0, 0);
  }
  const t = finish(c, true, 8);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
