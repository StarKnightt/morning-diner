/**
 * Procedural canvas textures. System 1 placeholders: enough variation that
 * surfaces do not read as flat CG, nothing more. System 5 replaces these with
 * the real material set.
 */
import * as THREE from "three";
import { makeFbm, makeFbm2, makeRng, makeValueNoise2 } from "../core/rng";
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
 * 12-inch (300 mm) vinyl composition tile, butt-joined (rev 3 — the diner setting: VCT, not
 * quarry tile; see BUILD.md "VCT"). Seams are a 1–2 mm hairline holding grime, no bevel, no
 * grout. `tilesX` × `tilesY` tiles on the canvas, `tilePx` per tile, so one canvas is the
 * whole floor and everything in `wear` is authored where it happens: lanes (wax dulled,
 * greyed whites / hazed blacks), factory sheen under the booths, mop residue along the
 * walls, rubber transfer, one crack. Tile-to-tile tone ±3.5 % (whites) / ±8 % (blacks); the
 * through-body chip mottle of VCT (2–6 mm streaks, laid a quarter-turn per tile) at ±4 %.
 * Seam relief lives in `normalMap`, a separate 2 × 2-tile canvas (`floorGrout`) — this
 * canvas is 3.75 mm/texel.
 */
export function checkerFloor(tilesX: number, tilesY: number, tilePx: number, anisotropy: number, wear?: FloorWear): TextureSet {
  const w = tilesX * tilePx, h = tilesY * tilePx;
  const { c, ctx } = canvas(w, h);
  const rng = makeRng(wear?.seed ?? 1234);
  const fbm = makeFbm(77, 8, 4);
  const dirt = makeFbm(78, 40, 3);
  // VCT chip mottle: streaky at ~4 mm, stretched 3:1, alternating direction per tile.
  const chipH = makeValueNoise2(79, Math.round(w / 3), Math.round(h / 1.2));
  const chipV = makeValueNoise2(80, Math.round(w / 1.2), Math.round(h / 3));
  const mPerPx = wear ? wear.metresPerTile / tilePx : 0.3 / tilePx;
  const toWorld = (px: number, py: number): [number, number] =>
    wear ? [wear.originX + px * mPerPx, wear.originZ + py * mPerPx] : [px * mPerPx, py * mPerPx];

  const isBlack = new Uint8Array(tilesX * tilesY);
  const gloss = new Float32Array(tilesX * tilesY); // per-tile roughness offset (batch/wax drift)
  // One replaced tile (a later batch: whiter, cooler, glossier), in the aisle short of the door.
  const replaced = wear ? [Math.floor((DOOR.centerX - 1.35 - wear.originX) / wear.metresPerTile), Math.floor((1.24 - wear.originZ) / wear.metresPerTile)] : [-1, -1];
  if (wear && (replaced[0] + replaced[1]) % 2 === 0) replaced[0] += 1; // must land on a white
  for (let ty = 0; ty < tilesY; ty++)
    for (let tx = 0; tx < tilesX; tx++) {
      const black = (tx + ty) % 2 === 0;
      const v = (rng() - 0.5) * 2; // −1..1 tone
      const hue = (rng() - 0.5) * 2; // −1 cool .. +1 warm
      isBlack[ty * tilesX + tx] = black ? 1 : 0;
      gloss[ty * tilesX + tx] = (rng() - 0.5) * 0.1;
      let r: number, g: number, b: number;
      if (black) {
        // Charcoal VCT, ±8 % between tiles, some pulled brownish, some bluer
        const base = 30 * (1 + v * 0.08);
        r = base * (0.98 + hue * 0.05); g = base * 0.98; b = base * (1.02 - hue * 0.05);
      } else if (tx === replaced[0] && ty === replaced[1]) {
        r = 236; g = 236; b = 234;
        gloss[ty * tilesX + tx] = -0.1;
      } else {
        // Warm off-white, ±3.5 % between tiles, and a warm/cool split (cream vs. grey-white)
        const base = 220 * (1 + v * 0.035);
        r = base * (1 + hue * 0.012); g = base * 0.985; b = base * (0.95 - hue * 0.025);
      }
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(tx * tilePx, ty * tilePx, tilePx, tilePx);
    }

  // The slow fields (fbm, lane distances, wall distances) live on a 4 px grid — 15 mm on the
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

  // Rubber transfer (rev 3): a sole dragging over waxed VCT leaves a SMEAR, not a stroke — a
  // dense core, feathered edges, broken along its length where the sole lifted, its width and
  // weight varying along. Authored as a float transfer field T (0..1) and MULTIPLIED into the
  // albedo: black rubber on the white tile is a dark grey mark, on the charcoal tile it is
  // all but invisible (the same physics for both — no per-substrate colour). Where the rubber
  // sits the wax is dulled (roughness up). 85 % of the marks fall in the lanes, weighted by
  // lane strength; the sheltered floor under the booths gets almost none.
  const T = new Float32Array(w * h);
  if (wear) {
    const toPx = (wx: number, wz: number): [number, number] => [(wx - wear.originX) / mPerPx, (wz - wear.originZ) / mPerPx];
    const laneW = wear.lanes.map((L) => L.k * L.k);
    const laneTot = laneW.reduce((a, b) => a + b, 0);
    const smearN = makeFbm(wear.seed + 7, 64, 2);
    for (let s = 0; s < 560; s++) {
      let wx: number, wz: number;
      if (rng() < 0.85 && wear.lanes.length) {
        let pick = rng() * laneTot, li = 0;
        while (li < laneW.length - 1 && pick > laneW[li]) { pick -= laneW[li]; li++; }
        const L = wear.lanes[li];
        const seg = Math.floor(rng() * (L.pts.length - 1));
        const t = rng();
        const across = (rng() + rng() - 1) * L.half * 1.6; // most marks near the centre line
        const dx = L.pts[seg + 1][0] - L.pts[seg][0], dz = L.pts[seg + 1][1] - L.pts[seg][1], ln = Math.hypot(dx, dz) || 1;
        wx = L.pts[seg][0] + dx * t - (dz / ln) * across;
        wz = L.pts[seg][1] + dz * t + (dx / ln) * across;
      } else {
        wx = wear.originX + rng() * w * mPerPx;
        wz = wear.originZ + rng() * h * mPerPx;
        let shelter = false;
        for (const [x0, z0, x1, z1] of wear.sheltered) if (wx > x0 && wx < x1 && wz > z0 && wz < z1) shelter = true;
        if (shelter && rng() < 0.92) continue;
      }
      const [px, py] = toPx(wx, wz);
      if (px < 2 || py < 2 || px > w - 2 || py > h - 2) continue;
      const kind = rng();
      const lenM = kind < 0.15 ? 0.1 + rng() * 0.18 : 0.02 + rng() * 0.08; // a few long skids
      const ang = rng() * Math.PI * 2;
      const bend = kind < 0.4 ? (rng() - 0.5) * 0.3 : (rng() - 0.5) * 2.4; // straight drags vs hooks
      const wMm = 10 + rng() * rng() * 32; // 10–42 mm, mostly narrow (a sole edge is ~12 mm)
      const weight = 0.35 + rng() * 0.65;
      const seed2 = rng() * 10;
      // March along the quadratic with a step of ~1 texel; the core density and the width
      // vary along; gaps where the sole lifted.
      const lenPx = lenM / mPerPx;
      const cxp = px + Math.cos(ang + bend) * lenPx * 0.5, cyp = py + Math.sin(ang + bend) * lenPx * 0.5;
      const exp_ = px + Math.cos(ang) * lenPx, eyp = py + Math.sin(ang) * lenPx;
      const steps = Math.max(3, Math.ceil(lenPx * 1.2));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const qx = (1 - t) * (1 - t) * px + 2 * (1 - t) * t * cxp + t * t * exp_;
        const qy = (1 - t) * (1 - t) * py + 2 * (1 - t) * t * cyp + t * t * eyp;
        const along = smearN(t * 0.6 + seed2, seed2 * 0.3); // 0..1 along the mark
        const gap = smoothstep(0.36, 0.44, along); // 0 where the sole lifted
        if (gap <= 0) continue;
        const ends = smoothstep(0, 0.12, t) * smoothstep(1, 0.85, t);
        const widthPx = (wMm / 1000 / mPerPx) * (0.55 + 0.45 * smearN(t * 1.3 + seed2 + 3, 0.7)) * (0.5 + 0.5 * ends);
        const R = Math.ceil(widthPx / 2 + 1);
        const dens = weight * gap * ends;
        for (let dy = -R; dy <= R; dy++)
          for (let dx = -R; dx <= R; dx++) {
            const xx = Math.round(qx) + dx, yy = Math.round(qy) + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const dd = Math.hypot(xx - qx, yy - qy) / (widthPx / 2 + 0.5);
            if (dd > 1) continue;
            // dense core, feathered edge: (1 − d²)^1.5, streaked ALONG the drag (the noise is
            // sampled in the mark's own frame, stretched 8:1 along it) so it is neither a tube
            // nor a ladder of cross-stripes. MAX, not sum: successive steps overlap the same
            // texels and a sum saturates every core to black (rev 3 first pass).
            const perp = ((xx - qx) * -(eyp - py) + (yy - qy) * (exp_ - px)) / (lenPx || 1);
            const streak = smearN(t * lenPx * 0.02 + seed2 * 3, perp * 0.16 + seed2);
            const prof = (1 - dd * dd) ** 1.5 * (0.5 + 1.0 * streak);
            const i = yy * w + xx;
            T[i] = Math.max(T[i], Math.min(1, dens * prof));
          }
      }
    }
  }

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const rough = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ty = Math.floor(y / tilePx);
    for (let x = 0; x < w; x++) {
      const tx = Math.floor(x / tilePx);
      const i = y * w + x, o = i * 4;
      const black = isBlack[ty * tilesX + tx] === 1;
      const n = sample(gN, x, y);
      const fine = sample(gFine, x, y);
      // Chip mottle (quarter-turn per tile): ±4 % on the whites, grey flecks +18 % on the blacks.
      const chip = ((tx + ty) & 1 ? chipH : chipV)(x / w, y / h) - 0.5;
      // Roughness (× material 1.0): waxed VCT ~0.3 (whites) / 0.36 (blacks, the wax haze shows),
      // seams 0.7. Whole-floor mottle ±0.06.
      let r = (black ? 0.36 : 0.3) + gloss[ty * tilesX + tx] + n * 0.1 + fine * 0.04;
      let k = (1 + n * 0.04) * (black ? 1 + Math.max(0, chip) * 0.36 : 1 + chip * 0.08);
      let greyMix = 0; // pull toward the dirt-grey of a walked lane
      if (wear) {
        const [wx, wz] = toWorld(x, y);
        const lane = sample(gLane, x, y);
        let shelter = 0;
        for (const [x0, z0, x1, z1] of wear.sheltered)
          if (wx > x0 && wx < x1 && wz > z0 && wz < z1) shelter = 1;
        const dust = sample(gDust, x, y);
        // Traffic: the wax dulls (roughness up), whites grey off by a clear step (rev 2:
        // 0.5), blacks abrade to a grey haze. Mop residue near the walls: a dust film that
        // reads lighter on the blacks.
        r += lane * 0.32 - shelter * 0.08;
        greyMix = lane * (black ? 0.4 : 0.62);
        k *= 1 + dust * 0.03 * (black ? 2 : 1);
      }
      if (greyMix > 0) {
        const gr = 130, gg = 126, gb = 120;
        d[o] = d[o] * (1 - greyMix) + gr * greyMix; d[o + 1] = d[o + 1] * (1 - greyMix) + gg * greyMix; d[o + 2] = d[o + 2] * (1 - greyMix) + gb * greyMix;
      }
      // Rubber transfer multiplies (see T above): × 0.42 at full density (a smear, not paint).
      const t = T[i];
      k *= 1 - 0.58 * t;
      r += t * 0.3;
      d[o] = Math.min(255, d[o] * k); d[o + 1] = Math.min(255, d[o + 1] * k); d[o + 2] = Math.min(255, d[o + 2] * k);
      rough[i] = r;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Seams: butt joints, a 1.5 mm grime line — drawn as a sub-texel stroke so the canvas's
  // coverage antialiasing gives the texel the right mean darkness (a whole dark texel would
  // be a 3.75 mm grout line). Rougher along the seam (matte grime).
  ctx.strokeStyle = "rgba(38,34,30,0.85)";
  ctx.lineWidth = 1.5 / (mPerPx * 1000);
  ctx.beginPath();
  for (let tx = 1; tx < tilesX; tx++) { ctx.moveTo(tx * tilePx, 0); ctx.lineTo(tx * tilePx, h); }
  for (let ty = 1; ty < tilesY; ty++) { ctx.moveTo(0, ty * tilePx); ctx.lineTo(w, ty * tilePx); }
  ctx.stroke();
  for (let ty = 1; ty < tilesY; ty++) for (let x = 0; x < w; x++) { const i = ty * tilePx * w + x; rough[i] += 0.3; rough[i - w] += 0.3; }
  for (let tx = 1; tx < tilesX; tx++) for (let y = 0; y < h; y++) { const i = y * w + tx * tilePx; rough[i] += 0.3; rough[i - 1] += 0.3; }

  if (wear) {
    // The crack (rev 3, `floorCrackSegments`): the dark floor and the two lips are geometry in
    // Shell.ts; the map carries a soft shadow band beside it and a matte break in the wax so the
    // line survives at distance and in the roughness.
    const toPx = (wx: number, wz: number): [number, number] => [(wx - wear.originX) / mPerPx, (wz - wear.originZ) / mPerPx];
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    floorCrackSegments(wear).forEach((seg, si) => {
      const path = seg.map(([x, z]) => toPx(x, z));
      // The proud lip (Shell.ts alternates the side per segment) has a pale worn edge — the wax
      // scuffed white where feet catch it — and the low side sits in its shadow: a light stroke
      // offset one texel to the proud side, a dark one to the other, then the grime in the gap.
      const side = si % 2 === 0 ? -1 : 1;
      const offs = (o: number) => path.map(([px, py], i) => {
        const [ax, ay] = path[Math.max(0, i - 1)], [bx, by] = path[Math.min(path.length - 1, i + 1)];
        const l = Math.hypot(bx - ax, by - ay) || 1;
        return [px + (-(by - ay) / l) * o * side, py + ((bx - ax) / l) * o * side] as [number, number];
      });
      const stroke = (pts: [number, number][], style: string, wdt: number) => {
        ctx.strokeStyle = style; ctx.lineWidth = wdt; ctx.beginPath();
        pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.stroke();
      };
      stroke(offs(1.0), "rgba(235,228,215,0.26)", 1.1);
      stroke(offs(-1.0), "rgba(30,26,22,0.3)", 1.4);
      stroke(path, "rgba(40,34,28,0.32)", 0.9);
      for (let k = 0; k + 1 < path.length; k++) {
        const [ax, ay] = path[k], [bx, by] = path[k + 1];
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx)) - 2), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx)) + 2);
        const y0 = Math.max(0, Math.floor(Math.min(ay, by)) - 2), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by)) + 2);
        const vx = bx - ax, vy = by - ay, vv = vx * vx + vy * vy || 1;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * vx + (y + 0.5 - ay) * vy) / vv));
          const dd = Math.hypot(x + 0.5 - ax - vx * t, y + 0.5 - ay - vy * t);
          const m = 1 - THREE.MathUtils.smoothstep(dd, 0.5, 1.8);
          if (m > 0) { const i = y * w + x; rough[i] = Math.max(rough[i], rough[i] + (0.62 - rough[i]) * m); }
        }
      }
    });
  }
  return { map: finish(c, true, anisotropy), roughnessMap: greyFromField(rough, w, h, anisotropy), normalMap: floorGrout(1024, wear?.seed ?? 1234) };
}

/**
 * The crack (rev 3): where the slab moved, the VCT above split — a jagged line (a random
 * walk about the heading in `wear.crack`, steps ~12 mm, heading wandering ±25° with a pull
 * back to the mean), its half-width `hw` varying 0.4–1.8 mm along and tapering at the ends.
 * At every tile seam it crosses it does what a crack in tile does: runs along the seam for
 * 5–25 mm before continuing (the seam is the weak line), and one crossing in three is a clean
 * break — the crack stops and restarts a few mm over. Segments are `[x, z, hw]` polylines in
 * world metres, shared by the floor map (shadow + matte band) and the ribbon + lips Shell.ts
 * lays on the tile, so both stay registered.
 */
export function floorCrackSegments(wear: FloorWear): Array<Array<[number, number, number]>> {
  const { x, z, len, deg } = wear.crack;
  const rng = makeRng(wear.seed + 31);
  const a0 = THREE.MathUtils.degToRad(deg);
  const tile = wear.metresPerTile;
  const cellX = (px: number) => Math.floor((px - wear.originX) / tile), cellZ = (pz: number) => Math.floor((pz - wear.originZ) / tile);
  const segs: Array<Array<[number, number, number]>> = [];
  let cur: Array<[number, number, number]> = [];
  let px = x, pz = z, ang = a0, dist = 0;
  const step = 0.012;
  const hwAt = (t: number) => {
    const taper = Math.min(1, t / 0.06, (len - t) / 0.06);
    const wander = 0.5 + 0.5 * Math.sin(t * 37 + 1.1) * Math.sin(t * 13.3 + 0.4) * 0.8 + (rng() - 0.5) * 0.2;
    return (0.0004 + 0.0014 * wander) * Math.max(0.2, taper);
  };
  cur.push([px, pz, hwAt(0)]);
  while (dist < len) {
    ang += (rng() - 0.5) * 0.9 + (a0 - ang) * 0.35;
    const nx = px + Math.cos(ang) * step, nz = pz + Math.sin(ang) * step;
    dist += step;
    const crossX = cellX(nx) !== cellX(px), crossZ = cellZ(nz) !== cellZ(pz);
    if (crossX || crossZ) {
      // the seam line and the crossing point on it
      const seamX = wear.originX + Math.max(cellX(nx), cellX(px)) * tile, seamZ = wear.originZ + Math.max(cellZ(nz), cellZ(pz)) * tile;
      const tX = crossX ? (seamX - px) / (nx - px) : 2, tZ = crossZ ? (seamZ - pz) / (nz - pz) : 2;
      const t = Math.min(tX, tZ);
      const cx = px + (nx - px) * t, cz = pz + (nz - pz) * t;
      cur.push([cx, cz, hwAt(dist)]);
      const alongSeam = (0.005 + rng() * 0.02) * (rng() < 0.5 ? 1 : -1);
      const ox = tX < tZ ? 0 : alongSeam, oz = tX < tZ ? alongSeam : 0;
      if (rng() < 0.33) {
        // clean break: end here, restart a few mm over
        segs.push(cur);
        cur = [];
        px = cx + ox + Math.cos(ang) * 0.004; pz = cz + oz + Math.sin(ang) * 0.004;
        cur.push([px, pz, hwAt(dist) * 0.5]);
      } else {
        // run along the seam (a hairline; the seam itself is the crack here)
        cur.push([cx + ox, cz + oz, Math.min(0.0006, hwAt(dist))]);
        px = cx + ox; pz = cz + oz;
      }
      continue;
    }
    px = nx; pz = nz;
    cur.push([px, pz, hwAt(dist)]);
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}

/** Flattened crack polyline (x, z) for callers that only need the line. */
export function floorCrackPath(wear: FloorWear): Array<[number, number]> {
  return floorCrackSegments(wear).flat().map(([x, z]) => [x, z]);
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
 * Seam relief for `checkerFloor`: a 2 × 2-tile canvas (`size` px over 600 mm →
 * 0.59 mm/texel) tiled with repeat = tiles / 2.
 */
export function floorGrout(size: number, seed: number): THREE.Texture {
  // Rev 3 (VCT): a 1.5 mm butt seam 0.4 mm deep (the tiles' cut edges), the edges curled up
  // 0.12 mm over the outer 5 mm (old VCT lifts at the seams), ±0.1 mm lippage between the
  // four tiles, the sheet's own ±0.03 mm waviness at ~30 mm and a 0.01 mm speckle.
  const mmPerPx = 600 / size;
  const tile = size / 2;
  const seamPx = 1.5 / mmPerPx, curl = 5 / mmPerPx;
  const rng = makeRng(seed + 99);
  const wave = makeFbm(seed + 3, 20, 3);
  const lip = [0.1, -0.06, 0.04, -0.1].map((v) => v + (rng() - 0.5) * 0.04);
  const hf = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const tx = Math.floor(x / tile), ty = Math.floor(y / tile);
      // Distance to the nearest seam centre line (seams run along the tile boundaries).
      const ex = Math.min(x % tile, tile - (x % tile)), ey = Math.min(y % tile, tile - (y % tile));
      const e = Math.min(ex, ey); // px from the tile edge
      const half = seamPx / 2;
      let hgt: number;
      if (e < half) hgt = -0.4 * (1 - (e / half) ** 2); // V seam
      else hgt = 0.12 * (1 - smoothstep(half, half + curl, e)) + lip[ty * 2 + tx];
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
  /** sRGB: the vinyl's red, a shade darker in the crease valleys where grime sits. */
  map: THREE.Texture;
}

/**
 * Expanded-vinyl upholstery surface: embossed leather micro-grain at 0.4–0.7 mm
 * pebbles with 0.1 mm creases and a 1.5 mm swell (normal + roughness; the map only
 * darkens the creases a few % where dirt sits). Tiles over `metres`. Rev 3: the
 * burnish blotches and the crazing left this tiling map — a seat's shine is one zone
 * (vertex colour, Booths.ts) and the crazing is the non-repeating `vinylCrazeAtlas`
 * on UV channel 1.
 */
export function vinylSurface(size: number, metres: number): VinylSet {
  const pxPerMm = size / (metres * 1000);
  const { c: nc, ctx: nctx } = canvas(size, size);
  const { c: rc, ctx: rctx } = canvas(size, size);
  const rng = makeRng(2025);
  const grain = makeFbm(61, 128, 3); // ~1.5 mm swell under the pebbles
  const height = new Float32Array(size * size);
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
      // Roughness around 0.5 (material scales it); the creases hold dirt (+0.04).
      const r = 0.45 + H(x, y) * 0.06 + crease[i] * 0.04;
      const rv = Math.min(255, Math.max(0, r * 255));
      rimg.data[o] = rv; rimg.data[o + 1] = rv; rimg.data[o + 2] = rv; rimg.data[o + 3] = 255;
      // Albedo (sRGB): #AA1A15 vinyl, the creases 4 % darker with grime.
      const k = 1 - 0.04 * crease[i];
      mimg.data[o] = 170 * k;
      mimg.data[o + 1] = 26 * k;
      mimg.data[o + 2] = 21 * k;
      mimg.data[o + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  mctx.putImageData(mimg, 0, 0);
  return { normalMap: finish(nc, false, 8), roughnessMap: finish(rc, false, 8), map: finish(mc, true, 8) };
}

/** Where each crazed vinyl piece sits in the `vinylCrazeAtlas` (all metres, u right / v up). */
export interface VinylCrazeLayout {
  /** Head roll unrolled: `len` along u from u = 0; arc length around the roll on v, the sewn seam at v0 + arcHalf. */
  roll: { v0: number; len: number; arcHalf: number };
  /** Channelled back panels, `w` × `h` from (0, v0); `valleys` = u of each sewn channel seam. */
  panels: Array<{ v0: number; w: number; h: number; valleys: number[] }>;
  /** Welt cords: `tracks` strips of `pitch` (the cord's circumference) stacked from v0, `len` along u. */
  cords: { v0: number; tracks: number; pitch: number; len: number };
}

/**
 * Non-repeating crazing atlas for one booth's vinyl (rev 3), sampled on UV channel 1 so
 * the 0.5 mm pebble grain can keep tiling on channel 0. One square canvas = `metres`.
 *
 * Plasticiser-starved vinyl cracks where it is flexed: the model is sequential
 * fragmentation, not a Voronoi print. Primary hairlines start at the flex lines (the
 * sewn welt beside every channel cord, the head-roll seam, the tuck under the roll, the
 * seat seam) and grow outward, wandering, fading, stopping when they meet another
 * crack; secondaries branch off them sideways and stop at the next crack. Spacing along
 * the seam is 2–6 mm where the strain is high, so cells are 2–4 mm there and open to
 * 8–15 mm where the primaries have thinned out; the strain is gated along the seam by
 * noise so there are stretches with nothing. The roll crest (sun-baked) carries a
 * sparse coarse net. Cracks are dark (the vinyl's own colour × 0.35–0.5, the crack floor
 * is in shadow). Where the surface has actually flaked, the pale cotton scrim shows in
 * fuzzy islands 3–8 mm across with a lighter lifted rim and an inner shadow. The welt
 * carries transverse cracks and the stitch line (holes + thread dashes 3.5 mm pitch)
 * runs 3.5 mm out from every cord.
 */
export function vinylCrazeAtlas(size: number, metres: number, layout: VinylCrazeLayout): { map: THREE.Texture } {
  const pxPerM = size / metres;
  const rng = makeRng(4099);
  const gate = makeFbm(4101, 8, 3); // strain gating along seams (period = canvas)
  const wob = makeFbm(4102, 64, 2); // crack wander
  const crack = new Float32Array(size * size); // darkness 0..1
  const occ = new Int32Array(size * size); // id of the crack that owns this texel (join test), 0 = none
  const scrim = new Float32Array(size * size); // 1 inside a flaked island
  const rim = new Float32Array(size * size); // +: lifted lit rim, −: inner shadow
  const stitch = new Float32Array(size * size); // −: hole, +: thread
  let wid = 0;
  const toPx = (u: number, v: number): [number, number] => [Math.floor(u * pxPerM), Math.floor((metres - v) * pxPerM)];
  const inside = (px: number, py: number) => px >= 0 && py >= 0 && px < size && py < size;
  const mark = (px: number, py: number, d: number) => {
    if (!inside(px, py)) return;
    const i = py * size + px;
    crack[i] = Math.max(crack[i], d);
    if (!occ[i]) occ[i] = wid;
  };
  /** Another crack (not this walk's own trail) within one texel. */
  const occupied = (px: number, py: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = px + dx, yy = py + dy;
        if (!inside(xx, yy)) continue;
        const o = occ[yy * size + xx];
        if (o && o !== wid) return true;
      }
    return false;
  };
  interface Region { u0: number; u1: number; v0: number; v1: number }
  const inRegion = (r: Region, u: number, v: number) => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1;
  /** One crack: from (u,v) at angle `ang`, up to `len` m, darkness `dark`, `wide` = old crack (2 px). Returns its points. */
  const walk = (r: Region, u: number, v: number, ang: number, len: number, dark: number, wide: boolean, wobble: number): Array<[number, number]> => {
    const step = 0.35 / 1000;
    const n = Math.round(len / step);
    const pts: Array<[number, number]> = [];
    let lastPx = -1, lastPy = -1;
    wid++;
    const seedW = rng() * 10;
    for (let i = 0; i < n; i++) {
      ang += (rng() - 0.5) * wobble + (wob(u * 6 + seedW, v * 6) - 0.5) * wobble * 1.8;
      u += Math.cos(ang) * step;
      v += Math.sin(ang) * step;
      if (!inRegion(r, u, v)) break;
      const [px, py] = toPx(u, v);
      if (px === lastPx && py === lastPy) continue;
      if (i > 6 && occupied(px, py)) { mark(px, py, dark * 0.8); break; } // joined an older crack
      const fade = 1 - 0.4 * (i / n) ** 2; // hairlines thin toward the tip
      mark(px, py, dark * fade);
      // soften: a third of the darkness onto the neighbour across the step so the line
      // reads continuous instead of a chain of texels
      const ax = Math.abs(Math.cos(ang)) > Math.abs(Math.sin(ang));
      mark(ax ? px : px + 1, ax ? py + 1 : py, dark * fade * 0.35);
      if (wide) { mark(px + 1, py, dark * fade * 0.7); mark(px, py + 1, dark * fade * 0.7); }
      pts.push([u, v]);
      lastPx = px; lastPy = py;
    }
    return pts;
  };
  /**
   * Sequential fragmentation: `count` secondary cracks each start on a random point of the
   * cracks already in `pool` and run off in a random direction until they meet another crack
   * (or `maxLen`); their own points join the pool so the net closes into cells. Cells come
   * out 2–4 mm where the pool is dense (beside a seam) and 8–15 mm where it thins.
   */
  const fragment = (r: Region, pool: Array<[number, number]>, count: number, maxLen: number, dark: number) => {
    for (let k = 0; k < count && pool.length; k++) {
      const [u, v] = pool[Math.floor(rng() * pool.length)];
      const ang = rng() * Math.PI * 2;
      const sub = walk(r, u, v, ang, maxLen * (0.3 + rng() * 0.7), dark * (0.6 + rng() * 0.4), false, 0.35);
      if (sub.length > 6) for (let j = 2; j < sub.length; j += 3) pool.push(sub[j]);
    }
  };
  /**
   * A flex seam: a straight line from (ua,va) to (ub,vb) inside region `r`; primary cracks
   * start `off` out from it on `sides` (+1/−1 or both) and grow away, perpendicular ± fan,
   * then the band fragments into cells. `strength` scales spacing (1 = 1.5–5 mm) and length
   * (reach ≈ 8–40 mm); `gateSeed` picks the noise that leaves stretches uncracked.
   */
  const seam = (r: Region, ua: number, va: number, ub: number, vb: number, off: number, sides: number[], strength: number, reach: number, gateSeed: number) => {
    const L = Math.hypot(ub - ua, vb - va);
    const tx = (ub - ua) / L, ty = (vb - va) / L; // along
    const nx = -ty, ny = tx; // normal
    const pool: Array<[number, number]> = [];
    let t = rng() * 0.003;
    while (t < L) {
      const g = gate(t * 2.3 + gateSeed, gateSeed * 0.37);
      const s = Math.min(1, Math.max(0, (g - 0.36) / 0.24)) * strength; // 0 = quiet stretch
      if (s < 0.08) { t += 0.004; continue; }
      const spacing = (0.0015 + rng() * 0.0035) / Math.max(0.5, s);
      t += spacing;
      for (const side of sides) {
        if (rng() > 0.55 + 0.45 * s) continue;
        const u = ua + tx * t + nx * side * off, v = va + ty * t + ny * side * off;
        const baseAng = Math.atan2(ny * side, nx * side) + (rng() - 0.5) * 0.9;
        const len = reach * Math.sqrt(s) * (0.3 + rng() * 0.7);
        const old = rng() < 0.07 * s;
        const dark = (0.7 + rng() * 0.3) * (0.7 + 0.3 * s);
        const pts = walk(r, u, v, baseAng, len, dark, old, 0.28);
        for (let j = 3; j < pts.length; j += 3) pool.push(pts[j]);
      }
    }
    fragment(r, pool, Math.round(L * 900 * strength * sides.length), reach * 0.45, 0.85);
  };
  /** Flaked island of scrim at (u,v), radius rr (m), irregular outline. */
  const island = (u: number, v: number, rr: number) => {
    const [cx, cy] = toPx(u, v);
    const R = Math.ceil((rr * 1.6) * pxPerM);
    const seedI = rng() * 100;
    for (let py = cy - R; py <= cy + R; py++)
      for (let px = cx - R; px <= cx + R; px++) {
        if (!inside(px, py)) continue;
        const dx = (px - cx) / pxPerM, dy = (py - cy) / pxPerM;
        const a = Math.atan2(dy, dx);
        const d = Math.hypot(dx, dy);
        // outline wobbles ±35 % with two angular harmonics + fine noise
        const edge = rr * (1 + 0.22 * Math.sin(a * 2 + seedI) + 0.14 * Math.sin(a * 5 + seedI * 1.7) + 0.2 * (wob(px / size * 3 + seedI, py / size * 3) - 0.5));
        const i = py * size + px;
        if (d < edge - 0.0006) scrim[i] = Math.max(scrim[i], 1);
        else if (d < edge) { scrim[i] = Math.max(scrim[i], 0.5); rim[i] -= 0.5; } // shadow just inside the lifted edge
        else if (d < edge + 0.0009) rim[i] += 0.7 * (1 - (d - edge) / 0.0009); // lifted vinyl edge catches the light
      }
  };

  /* ---- head roll: seam band both sides, sun-baked crest net ---- */
  {
    const R = layout.roll;
    // Nothing within 20 mm of the unrolled edges (v0, v0 + 2·arcHalf meet at the back of the
    // roll against the divider): the atlas edge must not draw a line there.
    const reg: Region = { u0: 0.002, u1: R.len - 0.002, v0: R.v0 + 0.02, v1: R.v0 + 2 * R.arcHalf - 0.02 };
    const vs = R.v0 + R.arcHalf;
    seam(reg, 0, vs, R.len, vs, 0.0035, [1, -1], 1, 0.03, 3.1);
    // crest: coarse sparse net 0.06–0.11 m from the seam on either side, random directions
    for (const side of [1, -1]) {
      const pool: Array<[number, number]> = [];
      const n = Math.round(R.len * 60);
      for (let k = 0; k < n; k++) {
        const u = rng() * R.len;
        const g = gate(u * 1.7 + side, 0.61 + side * 0.2);
        if (g < 0.46) continue; // stretches with no crazing
        const v = vs + side * (0.055 + rng() * 0.06);
        const ang = rng() * Math.PI * 2;
        const pts = walk(reg, u, v, ang, 0.015 + rng() * 0.035, 0.7 + rng() * 0.3, rng() < 0.1, 0.3);
        for (let j = 2; j < pts.length; j += 3) pool.push(pts[j]);
      }
      fragment(reg, pool, Math.round(R.len * 700), 0.014, 0.8);
    }
    // a few flaked islands on the seam band
    const ni = Math.round(R.len * 4);
    for (let k = 0; k < ni; k++) {
      const u = rng() * R.len;
      if (gate(u * 2.3 + 3.1, 3.1 * 0.37) < 0.62) continue;
      island(u, vs + (rng() < 0.5 ? 1 : -1) * (0.005 + rng() * 0.012), 0.0025 + rng() * 0.004);
    }
  }
  /* ---- channelled panels ---- */
  layout.panels.forEach((P, pi) => {
    const reg: Region = { u0: 0.001, u1: P.w - 0.001, v0: P.v0 + 0.001, v1: P.v0 + P.h - 0.001 };
    P.valleys.forEach((vx, vi) => {
      const gs = 7 + pi * 13 + vi * 1.7;
      // not every seam has gone: the middle of the bench (where people lean) worst, 0.3–1
      const mid = 1 - Math.abs(vx / P.w - 0.5) * 1.2;
      seam(reg, vx, P.v0, vx, P.v0 + P.h, 0.004, [1, -1], 0.3 + 0.7 * mid * (0.4 + 0.6 * rng()), 0.028, gs);
      // one or two long cracks running parallel to the cord 5–9 mm out, in stretches
      for (const side of [1, -1]) {
        if (rng() < 0.45) continue;
        const off = 0.005 + rng() * 0.004;
        const v0 = P.v0 + rng() * P.h * 0.5, len = 0.04 + rng() * P.h * 0.5;
        const pts = walk(reg, vx + side * off, v0, Math.PI / 2, len, 0.85, rng() < 0.4, 0.12);
        fragment(reg, pts.filter((_, j) => j % 3 === 0), 8, 0.01, 0.7);
      }
      // stitch line 3.5 mm out both sides: 0.6 mm holes at 3.5 mm pitch, thread dashes between
      for (const side of [1, -1]) {
        const su = vx + side * 0.0035;
        for (let v = P.v0 + 0.006 + rng() * 0.002; v < P.v0 + P.h - 0.006; v += 0.0035) {
          const [hx, hy] = toPx(su, v);
          if (inside(hx, hy)) stitch[hy * size + hx] -= 1;
          for (let k = 1; k <= 3; k++) {
            const [tx, ty] = toPx(su, v + (k / 5) * 0.0035);
            if (inside(tx, ty)) stitch[ty * size + tx] += 0.6;
          }
        }
      }
      // flaked islands beside the most-flexed cords (the middle of the bench)
      if (rng() < 0.5) {
        const n = 1 + Math.floor(rng() * 2);
        for (let k = 0; k < n; k++) island(vx + (rng() < 0.5 ? 1 : -1) * (0.006 + rng() * 0.01), P.v0 + 0.05 + rng() * (P.h - 0.1), 0.002 + rng() * 0.004);
      }
    });
    // tuck under the roll (top) and the seat seam (bottom): cracks grow down/up from them
    seam(reg, 0, P.v0 + P.h, P.w, P.v0 + P.h, 0.003, [-1], 0.7, 0.025, 21 + pi);
    seam(reg, 0, P.v0, P.w, P.v0, 0.003, [1], 0.5, 0.018, 29 + pi);
  });
  /* ---- welt cords: transverse cracks around the bead in stretches ---- */
  {
    const C = layout.cords;
    for (let t = 0; t < C.tracks; t++) {
      const v0 = C.v0 + t * C.pitch;
      const reg: Region = { u0: 0, u1: C.len, v0, v1: v0 + C.pitch };
      for (let u = rng() * 0.004; u < C.len; ) {
        const g = gate(u * 3.1 + t * 0.71, 0.9 + t * 0.05);
        const s = Math.min(1, Math.max(0, (g - 0.45) / 0.2));
        if (s < 0.1) { u += 0.005; continue; }
        u += (0.0025 + rng() * 0.006) / Math.max(0.4, s);
        const va = v0 + rng() * C.pitch * 0.3;
        walk(reg, u, va, Math.PI / 2 + (rng() - 0.5) * 0.5, C.pitch * (0.3 + rng() * 0.6), (0.5 + rng() * 0.5) * s, rng() < 0.08, 0.3);
      }
    }
  }

  /* ---- compose ---- */
  const { c, ctx } = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const tone = makeFbm(4103, 6, 3);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x, o = i * 4;
      const k = 1 - 0.05 * (tone(x / size, y / size) - 0.5);
      let r = 170 * k, g = 26 * k, b = 21 * k;
      // dark hairline: the crack floor is in shadow (× 0.25 at full darkness)
      const cd = Math.min(1, crack[i]);
      const m = 1 - 0.75 * cd;
      r *= m; g *= m; b *= m;
      // flaked scrim: pale cotton, fuzzy (the 0.5 ring half-mixes)
      const sc = Math.min(1, scrim[i]);
      r = r * (1 - sc) + 208 * sc; g = g * (1 - sc) + 198 * sc; b = b * (1 - sc) + 178 * sc;
      // lifted rim (+light) / inner shadow (−)
      const rm = Math.max(-1, Math.min(1, rim[i]));
      const lm = rm > 0 ? 1 + 0.16 * rm : 1 + 0.3 * rm;
      r *= lm; g *= lm; b *= lm;
      // stitch: holes near-black, thread a lighter red (matching thread, catches light)
      const st = stitch[i];
      if (st < 0) { r *= 0.35; g *= 0.35; b *= 0.35; }
      else if (st > 0) { const tm = 1 + 0.22 * Math.min(1, st); r *= tm; g *= tm; b *= tm; }
      img.data[o] = Math.min(255, r); img.data[o + 1] = Math.min(255, g); img.data[o + 2] = Math.min(255, b); img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = finish(c, true, 8);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return { map: t };
}


/**
 * Formica 6942 "Skylark" boomerang laminate on a plain cream field. Each shape is
 * a genuine boomerang bent 100–130°, tapered from the elbow to rounded tips (drawn
 * as a chain of discs along the centre line). Rev 3: two size classes — large 20–30 mm
 * tip to tip and small 10–16 mm — four tones at low contrast, ~6 per 100 cm² with a
 * third of them overlapping a neighbour (the print's tones cross), ~12 % outline-only,
 * random rotation. One canvas = `metres` (use ≥ 1.2 m so a whole table shows no repeat).
 *
 * Use (rev 3, albedo + roughness from one generator so the marks coincide): a milky,
 * featureless wipe haze in broad irregular patches (roughness 0.3 → 0.55, albedo 6 %
 * toward grey-white; dithered — the rev 2 gradient quantised into contour lines that
 * rendered as a fingerprint under the sun), a few hundred micro-scratches 5–60 mm at
 * random angles weighted to one wiping direction, two dark gouges, and cup rings as
 * partial arcs with a sharp dense outer edge fading inward over 3 mm. Roughness never
 * below 0.28 (specular aliasing under the sun at 0.13).
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
  const tones = ["#CBBB9F", "#A3A8AC", "#FBF9F4", "#B9AD9A"];
  const areaCm2 = metres * metres * 1e4;
  const target = Math.round(areaCm2 * 0.06);
  const placed: Array<[number, number, number]> = [];
  const torusDist = (ax: number, ay: number, bx: number, by: number) => {
    let dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    dx = Math.min(dx, size - dx); dy = Math.min(dy, size - dy);
    return Math.hypot(dx, dy);
  };
  const wraps = [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size], [size, size], [-size, -size], [size, -size], [-size, size]];
  let attempts = 0;
  while (placed.length < target && attempts < 90000) {
    attempts++;
    const x = rng() * size, y = rng() * size;
    const big = rng() < 0.55;
    // Large class: arm 10–14 mm (20–30 mm tip to tip with caps); small: 4.5–7 mm (10–16 mm).
    const arm = (big ? 10 + rng() * 4 : 4.5 + rng() * 2.5) * pxPerMm;
    const reach = arm + 3 * pxPerMm;
    // A third may overlap a neighbour (the print's tones cross); the rest keep a 4 mm gap.
    const overlap = rng() < 0.33;
    if (!overlap && placed.some(([px, py, pr]) => torusDist(x, y, px, py) < reach + pr + 4 * pxPerMm)) continue;
    if (overlap && placed.some(([px, py, pr]) => torusDist(x, y, px, py) < (reach + pr) * 0.35)) continue;
    placed.push([x, y, reach]);
    const half = THREE.MathUtils.degToRad(50 + rng() * 15); // arm half-angle (100–130° included)
    const wMax = (big ? 2.4 + rng() * 0.8 : 1.6 + rng() * 0.5) * pxPerMm; // elbow half-width
    const rot = rng() * Math.PI * 2;
    const outline = rng() < 0.12;
    const tone = tones[Math.floor(rng() * tones.length)];
    const steps = 40;
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
      if (outline) { ctx.fillStyle = "#EDE6D6"; draw(px, py, 0.9 * pxPerMm); } // 0.9 mm outline stroke
    }
  }
  // Gold flecks in the print: soft 1.5 mm dots at 0.3/cm² (rev 2: the 1-texel hard dots at
  // 0.8/cm² aliased into a regular halftone screen under minification).
  ctx.fillStyle = "rgba(216,194,138,0.55)";
  for (let k = 0; k < areaCm2 * 0.3; k++) { ctx.beginPath(); ctx.arc(rng() * size, rng() * size, 0.75 * pxPerMm, 0, Math.PI * 2); ctx.fill(); }

  /* ---- use ---- */
  // Haze: where the last rag left a film, the clear coat is dulled — broad irregular patches
  // (fbm at ~0.2–0.4 m, isotropic, no coherent direction) — and where years of sleeves and
  // rags have rubbed, a general soft dulling. Micro-scratches: 1-texel streaks.
  const hazeN = makeFbm(seed + 5, 5, 3);
  const grainN = makeFbm(seed + 7, 256, 1);
  const rough = new Float32Array(size * size);
  const hazeF = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const h = smoothstep(0.42, 0.66, hazeN(x / size, y / size));
      hazeF[i] = h;
      rough[i] = 0.3 + 0.24 * h + (grainN(x / size, y / size) - 0.5) * 0.02;
    }
  // Scratches (roughness up, albedo a touch lighter — the clear coat scatters); angles weighted
  // to one wiping direction ± 35° with a quarter fully random. Two dark gouges.
  const wipeDir = rng() * Math.PI;
  const scratches: Array<[number, number, number, number, number, boolean]> = [];
  for (let k = 0; k < 320; k++) {
    const sx = rng() * size, sy = rng() * size;
    const len = (5 + rng() * rng() * 55) * pxPerMm;
    const ang = rng() < 0.75 ? wipeDir + (rng() - 0.5) * 1.2 : rng() * Math.PI;
    scratches.push([sx, sy, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len, 0.25 + rng() * 0.45, k < 2]);
  }
  const linePts = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.7));
    return Array.from({ length: n + 1 }, (_, k) => [x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n] as [number, number]);
  };
  for (const [x0, y0, x1, y1, a, dark] of scratches) strokeField(rough, size, linePts(x0, y0, x1, y1), dark ? 0.35 : 0.3 * a, dark ? 1.6 : 1);
  // Cup rings: coffee residue dries from the outside in — a sharp dense outer edge (the
  // tide line) fading inward over ~3 mm; partial arcs (the cup was lifted before it dried).
  const rings: Array<[number, number, number, number, number]> = [];
  for (let k = 0; k < 3; k++) {
    const rx = size * (0.15 + rng() * 0.7), ry = size * (0.15 + rng() * 0.7), rr = (34 + rng() * 10) * pxPerMm;
    const a0 = rng() * Math.PI * 2, sweep = 3.5 + rng() * 2.6; // 200–350°
    rings.push([rx, ry, rr, a0, sweep]);
  }
  const rimg = rctx.createImageData(size, size);
  const rg = makeRng(seed + 11);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x, o = i * 4;
      let r = rough[i];
      for (const [rx, ry, rr, a0, sweep] of rings) {
        const d = Math.hypot(x - rx, y - ry) - rr; // + outside
        let ang = Math.atan2(y - ry, x - rx) - a0;
        ang = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        if (ang > sweep) continue;
        if (d > -3 * pxPerMm && d < 0.6 * pxPerMm) r += 0.3 * (d > -0.8 * pxPerMm ? 1 : 0.4 * (1 + d / (3 * pxPerMm)));
      }
      // dither: ±0.6/255 breaks the 8-bit contours that drew rev 2's fingerprint
      const v = Math.min(255, Math.max(0, r * 255 + (rg() - 0.5) * 1.2));
      rimg.data[o] = v; rimg.data[o + 1] = v; rimg.data[o + 2] = v; rimg.data[o + 3] = 255;
    }
  rctx.putImageData(rimg, 0, 0);
  // Albedo side of the same marks.
  const aimg = ctx.getImageData(0, 0, size, size);
  const ad = aimg.data;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x, o = i * 4;
      const h = hazeF[i] * 0.06; // milky film: toward grey-white
      ad[o] = ad[o] * (1 - h) + 214 * h; ad[o + 1] = ad[o + 1] * (1 - h) + 210 * h; ad[o + 2] = ad[o + 2] * (1 - h) + 204 * h;
      for (const [rx, ry, rr, a0, sweep] of rings) {
        const d = Math.hypot(x - rx, y - ry) - rr;
        if (d < -3.2 * pxPerMm || d > 0.7 * pxPerMm) continue;
        let ang = Math.atan2(y - ry, x - rx) - a0;
        ang = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        if (ang > sweep) continue;
        const k = d > -0.8 * pxPerMm ? 0.32 : 0.14 * (1 + d / (3 * pxPerMm));
        ad[o] = ad[o] * (1 - k) + 118 * k; ad[o + 1] = ad[o + 1] * (1 - k) + 86 * k; ad[o + 2] = ad[o + 2] * (1 - k) + 48 * k;
      }
    }
  ctx.putImageData(aimg, 0, 0);
  for (const [x0, y0, x1, y1, a, dark] of scratches) {
    ctx.strokeStyle = dark ? "rgba(70,60,50,0.5)" : `rgba(255,255,255,${(0.2 * a).toFixed(3)})`;
    ctx.lineWidth = dark ? 1.1 : 0.9;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
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

/**
 * Emissive map of a lit 2×4 troffer lens (System 4 rev 2): `tubes` T8 lamps run along u
 * behind a K12 prismatic lens. Through the lens each lamp is a soft band ~70 mm wide,
 * roughly 2.2× brighter than the valley between lamps (lamp Ø 25 mm, 60–90 mm behind the
 * lens; the prisms spread it, they do not hide it), the bands stop ~30 mm short of the
 * housing ends and the lens darkens a little along its long edges under the housing walls.
 * A prism-pitch modulation (`cells` across u, 6 mm on a 1.11 m lens) keeps the lens
 * reading as a prism sheet even where it is near clipping. Normalised so the mean over
 * the canvas is 1.0: the material's `emissiveIntensity` is then the lens's MEAN nits × K
 * and the peaks sit at ≈ 1.5× it. sRGB colour space, no repeat (one canvas = one lens).
 */
export const TROFFER_LENS_HEADROOM = 1.6;
export function trofferLens(w: number, h: number, tubes: number, cells: number): { emissiveMap: THREE.Texture } {
  const { c, ctx } = canvas(w, h);
  const img = ctx.createImageData(w, h);
  const vals = new Float32Array(w * h);
  const sigma = 0.07; // band half-width as a fraction of the lens's short side (0.51 m → ≈ 36 mm)
  let sum = 0;
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    // Lamp bands: `tubes` gaussians centred at (k + 0.5) / tubes, on a diffuse floor.
    let band = 0.55;
    for (let k = 0; k < tubes; k++) {
      const d = (v - (k + 0.5) / tubes) / sigma;
      band += 1.05 * Math.exp(-0.5 * d * d);
    }
    // Housing walls along the long edges shade the outermost 25 mm of lens.
    const edge = smoothstep(0.0, 0.05, v) * smoothstep(1.0, 0.95, v);
    band *= 0.7 + 0.3 * edge;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      // Lamps end 30 mm short of the housing ends; the lens keeps ~45 % there from scatter.
      const ends = 0.45 + 0.55 * smoothstep(0.0, 0.035, u) * smoothstep(1.0, 0.965, u);
      // Prism-pitch modulation: square-pyramid facets, ridges darker, ±12 %.
      const cu = ((u * cells) % 1) * 2 - 1, cv = ((v * cells * (h / w)) % 1) * 2 - 1;
      const ridge = Math.max(Math.abs(cu), Math.abs(cv));
      const prism = 1.0 - 0.24 * Math.pow(ridge, 6);
      const val = band * ends * prism;
      vals[y * w + x] = val;
      sum += val;
    }
  }
  const norm = (w * h) / sum;
  for (let i = 0; i < w * h; i++) {
    // Encode linear radiance as sRGB (the map is read back as an sRGB colour texture).
    const lin = Math.min(1, (vals[i] * norm) / TROFFER_LENS_HEADROOM); // peaks ≈ 1.5× mean → 0.94 of the encodable range
    const s = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
    const o = i * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round(s * 255);
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = finish(c, true, 4);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return { emissiveMap: t };
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
export function laminateWear(size: number, metres: number, base: number, seed: number, rings: number): { map: THREE.Texture; roughnessMap: THREE.Texture } {
  const rng = makeRng(seed);
  const pxPerM = size / metres;
  // Rev 3: isotropic haze patches (the rev 2 wipe field was stretched 6.7:1 along v and its
  // slow gradient quantised into contour bands), a fine grain, and a ±0.6/255 dither.
  const wipe = makeFbm(seed + 5, 5, 3);
  const grainN = makeFbm(seed + 9, 256, 1);
  const dith = makeRng(seed + 13);
  const f = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const h = smoothstep(0.44, 0.64, wipe(x / size, y / size));
      f[y * size + x] = base - 0.02 + h * 0.1 + (grainN(x / size, y / size) - 0.5) * 0.02 + (dith() - 0.5) * (1.2 / 255);
    }
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
  // Rev 2: the same wear in albedo. Roughness alone was invisible under a flat env (see the
  // System 5 rev 2 root cause); the deposits of a cup ring and the grime in a scratch are also
  // darker than the sheet, the wipe haze a shade lighter. Multiplies the material colour.
  const { c, ctx } = canvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const d = f[i] - base; // wipe haze ±0.04, scratches +0.18..0.32, rings +0.1..0.15
    const v = Math.round(255 * clamp01(1 - Math.max(0, d) * 0.9 + Math.max(0, -d) * 0.6));
    const o = i * 4;
    img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { map: finish(c, true, 8), roughnessMap: greyFromField(f, size, size, 8) };
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
