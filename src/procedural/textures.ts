/**
 * Procedural canvas textures. System 1 placeholders: enough variation that
 * surfaces do not read as flat CG, nothing more. System 5 replaces these with
 * the real material set.
 */
import * as THREE from "three";
import { makeFbm, makeFbm2, makeRng } from "../core/rng";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
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
}

/**
 * Black/white checkerboard, `tilesX` × `tilesY` tiles over the canvas, with
 * per-tile value variation and a thin grout line. One canvas texel = 1/tilePx
 * of a tile; the caller sets `repeat` so a tile is exactly 0.3 m.
 */
export function checkerFloor(tilesX: number, tilesY: number, tilePx: number, anisotropy: number): TextureSet {
  const w = tilesX * tilePx, h = tilesY * tilePx;
  const { c, ctx } = canvas(w, h);
  const { c: rc, ctx: rctx } = canvas(w, h);
  const rng = makeRng(1234);
  const fbm = makeFbm(77, 8, 4);
  const grout = Math.max(1, Math.round(tilePx * 0.035));

  ctx.fillStyle = "#6a655c";
  ctx.fillRect(0, 0, w, h);
  rctx.fillStyle = "#b0b0b0";
  rctx.fillRect(0, 0, w, h);

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const black = (tx + ty) % 2 === 0;
      const v = (rng() - 0.5) * 2; // -1..1 per-tile variation
      let base: number, tint: number;
      if (black) {
        base = 28 + v * 6;
        tint = 0.96;
      } else {
        base = 218 + v * 9;
        tint = 0.98;
      }
      const r = Math.round(base), g = Math.round(base * tint), b = Math.round(base * tint * 0.97);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(tx * tilePx + grout, ty * tilePx + grout, tilePx - grout * 2, tilePx - grout * 2);
      // Roughness: whites slightly glossier than blacks, plus tile-level variation.
      const rough = Math.round((black ? 120 : 95) + v * 15);
      rctx.fillStyle = `rgb(${rough},${rough},${rough})`;
      rctx.fillRect(tx * tilePx + grout, ty * tilePx + grout, tilePx - grout * 2, tilePx - grout * 2);
    }
  }

  // Low-frequency mottling / wear across the whole floor.
  const img = ctx.getImageData(0, 0, w, h);
  const rimg = rctx.getImageData(0, 0, w, h);
  const d = img.data, rd = rimg.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm(x / w, y / h) - 0.5; // -0.5..0.5
      const i = (y * w + x) * 4;
      const k = 1 + n * 0.12;
      d[i] = Math.min(255, d[i] * k);
      d[i + 1] = Math.min(255, d[i + 1] * k);
      d[i + 2] = Math.min(255, d[i + 2] * k);
      rd[i] = Math.min(255, Math.max(0, rd[i] + n * 60));
      rd[i + 1] = rd[i];
      rd[i + 2] = rd[i];
    }
  }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return { map: finish(c, true, anisotropy), roughnessMap: finish(rc, false, anisotropy) };
}

/** Subtle mottled paint / plaster. `hex` is the base colour. */
export function paintedWall(hex: string, size: number, seed: number, strength = 0.06): TextureSet {
  const { c, ctx } = canvas(size, size);
  const fbm = makeFbm(seed, 6, 5);
  const fine = makeFbm(seed + 7, 64, 2);
  const base = new THREE.Color(hex);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = (fbm(x / size, y / size) - 0.5) * strength + (fine(x / size, y / size) - 0.5) * strength * 0.5;
      const i = (y * size + x) * 4;
      d[i] = Math.min(255, Math.max(0, (base.r * (1 + n)) * 255));
      d[i + 1] = Math.min(255, Math.max(0, (base.g * (1 + n)) * 255));
      d[i + 2] = Math.min(255, Math.max(0, (base.b * (1 + n)) * 255));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: finish(c, true, 4) };
}

/** One acoustic ceiling tile with pinhole/fissure texture; tiles via repeat. */
export function acousticTile(size: number): TextureSet {
  const { c, ctx } = canvas(size, size);
  const { c: rc, ctx: rctx } = canvas(size, size);
  const rng = makeRng(555);
  const fbm = makeFbm(31, 4, 4);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = (fbm(x / size, y / size) - 0.5) * 0.08;
      const v = 232 * (1 + n);
      const i = (y * size + x) * 4;
      d[i] = v; d[i + 1] = v * 0.985; d[i + 2] = v * 0.955; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Pinholes and fissures.
  ctx.fillStyle = "rgba(90,85,78,0.4)";
  for (let i = 0; i < size * 3; i++) {
    const x = rng() * size, y = rng() * size, r = 0.6 + rng() * 1.4;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = "rgba(110,104,96,0.5)";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 140; i++) {
    const x = rng() * size, y = rng() * size, len = 3 + rng() * 10, a = rng() * Math.PI;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
  }
  // Bevelled edge shading.
  const edge = Math.round(size * 0.02);
  const g = ctx.createLinearGradient(0, 0, 0, edge);
  g.addColorStop(0, "rgba(0,0,0,0.25)"); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, edge);
  const g2 = ctx.createLinearGradient(0, 0, edge, 0);
  g2.addColorStop(0, "rgba(0,0,0,0.25)"); g2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g2; ctx.fillRect(0, 0, edge, size);

  rctx.fillStyle = "#e6e6e6";
  rctx.fillRect(0, 0, size, size);
  return { map: finish(c, true, 4), roughnessMap: finish(rc, false, 4) };
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
export function vinylSurface(size: number, metres: number, crazed: boolean): VinylSet {
  const pxPerMm = size / (metres * 1000);
  const { c: nc, ctx: nctx } = canvas(size, size);
  const { c: rc, ctx: rctx } = canvas(size, size);
  const rng = makeRng(crazed ? 2024 : 2025);
  const grain = makeFbm(61, 128, 3); // ~1.5 mm leather grain
  const patch = makeFbm(62, 4, 3); // where the crazing lives
  const height = new Float32Array(size * size);
  const crack = new Float32Array(size * size);
  // Micro-grain: per-cell jitter at ~1 px (0.4 mm) plus the fbm grain.
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      height[i] = (grain(x / size, y / size) - 0.5) * 0.35 + (rng() - 0.5) * 0.22;
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
        const presence = Math.min(1, Math.max(0, (p - 0.5) / 0.14));
        const w = 0.2 + p * 0.25; // crack half-width in mm
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
      // Roughness around 0.5 (material scales it), cracks a little matter (≤ 15 %).
      const r = 0.45 + (H(x, y) - crack[i]) * 0.06 + crack[i] * 0.07;
      const rv = Math.min(255, Math.max(0, r * 255));
      rimg.data[o] = rv; rimg.data[o + 1] = rv; rimg.data[o + 2] = rv; rimg.data[o + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return { normalMap: finish(nc, false, 8), roughnessMap: finish(rc, false, 8) };
}

/**
 * Formica 6942 "Skylark" boomerang laminate: plain cream field, sparse (~30 %)
 * smooth bent chevrons — two rounded lobes meeting at a soft elbow, ~60 mm long ×
 * 12 mm wide, drawn as a round-capped, round-joined stroke — in tan, grey-blue and
 * white at low contrast, random rotation, none touching. One canvas = `metres`.
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
  // Tones pulled 20 % toward the cream so the contrast stays under ~30 %.
  const tones = ["#CFC0A8", "#A7ACAF", "#FBF9F4"];
  const areaCm2 = metres * metres * 1e4;
  const target = Math.round((areaCm2 * 0.3) / 7.2); // ≈ 7.2 cm² per shape
  const placed: Array<[number, number]> = [];
  const minD = 52 * pxPerMm; // centre spacing: no two shapes touch
  const wraps = [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size], [size, size], [-size, -size], [size, -size], [-size, size]];
  const torusDist = (ax: number, ay: number, bx: number, by: number) => {
    let dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    dx = Math.min(dx, size - dx); dy = Math.min(dy, size - dy);
    return Math.hypot(dx, dy);
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  let attempts = 0;
  while (placed.length < target && attempts < 40000) {
    attempts++;
    const x = rng() * size, y = rng() * size;
    if (placed.some(([px, py]) => torusDist(x, y, px, py) < minD)) continue;
    placed.push([x, y]);
    const L = (56 + rng() * 12) * pxPerMm; // tip-to-tip along the arms
    const w = (11 + rng() * 2) * pxPerMm;
    const rot = rng() * Math.PI * 2;
    const half = THREE.MathUtils.degToRad(52 + rng() * 8); // arm half-angle (104–120° included)
    const La = L / 2 - w / 2; // stroke caps add w/2 at each tip
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const T = (lx: number, ly: number, px: number, py: number): [number, number] => [px + lx * cr - ly * sr, py + lx * sr + ly * cr];
    ctx.strokeStyle = tones[Math.floor(rng() * tones.length)];
    ctx.lineWidth = w;
    for (const [ox, oy] of wraps) {
      const px = x + ox, py = y + oy;
      if (px < -L || px > size + L || py < -L || py > size + L) continue;
      const t1 = T(La * Math.cos(half), La * Math.sin(half), px, py);
      const el = T(-w * 0.15, 0, px, py);
      const t2 = T(La * Math.cos(half), -La * Math.sin(half), px, py);
      ctx.beginPath();
      ctx.moveTo(t1[0], t1[1]);
      ctx.lineTo(el[0], el[1]);
      ctx.lineTo(t2[0], t2[1]);
      ctx.stroke();
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
  /** Latewood darkening, 0.07 (maple laminate) … 0.2 (solid oak). */
  contrast: number;
  /** Base roughness of the finish. */
  rough: number;
  /** Open-pore length in mm (0 for a printed laminate). */
  pore: number;
  /** Grain runs along v when true (upright panels), else along u. */
  vertical: boolean;
  /** Lattice cells along / across the grain per canvas: across sets the band pitch. */
  along: number;
  across: number;
  /** Domain-warp strength (0–1): varies the grain frequency across the panel. */
  warp: number;
  /** Cathedral bending (0–1): bands arch along the grain. */
  figure: number;
}

/**
 * Veneer / plank grain from domain-warped anisotropic value noise — no periodic
 * function anywhere, so the band pitch drifts across the panel. Bands are a soft
 * threshold of the noise; fibre detail rides on top; pores (if any) dent the normal.
 */
export function woodVeneer(size: number, metres: number, o: WoodOpts): WoodSet {
  const { c, ctx } = canvas(size, size);
  const { c: rc, ctx: rctx } = canvas(size, size);
  const { c: nc, ctx: nctx } = canvas(size, size);
  // Parse the sRGB hex directly: THREE.Color would convert it to linear.
  const base = { r: parseInt(o.hex.slice(1, 3), 16) / 255, g: parseInt(o.hex.slice(3, 5), 16) / 255, b: parseInt(o.hex.slice(5, 7), 16) / 255 };
  const rng = makeRng(o.seed);
  const pxPerMm = size / (metres * 1000);
  const grain = makeFbm2(o.seed, o.along, o.across, 3);
  const warpA = makeFbm2(o.seed + 11, 2, 2, 2);
  const warpC = makeFbm2(o.seed + 23, 2, 3, 2);
  const arch = makeFbm2(o.seed + 37, 1, 2, 2);
  const fibre = makeFbm2(o.seed + 3, o.along * 6, o.across * 6, 2);
  const smooth = (a: number, b: number, t: number) => {
    const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  const img = ctx.createImageData(size, size);
  const rimg = rctx.createImageData(size, size);
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const a = o.vertical ? y : x, cc = o.vertical ? x : y;
      const ua = a / size, uc = cc / size;
      const wa = (warpA(ua, uc) - 0.5) * o.warp * 0.12;
      const wc = (warpC(ua, uc) - 0.5) * o.warp * 0.18 + (arch(ua, uc) - 0.5) * o.figure * 0.25;
      const g = grain(ua + wa, uc + wc);
      const late = smooth(0.5, 0.68, g) * (0.7 + 0.3 * smooth(0.6, 0.8, g));
      const fine = (fibre(ua, uc) - 0.5) * 0.35;
      const k = 1 - o.contrast * late + o.contrast * fine;
      const idx = (y * size + x) * 4;
      img.data[idx] = Math.min(255, Math.max(0, base.r * 255 * k));
      img.data[idx + 1] = Math.min(255, Math.max(0, base.g * 255 * k));
      img.data[idx + 2] = Math.min(255, Math.max(0, base.b * 255 * k));
      img.data[idx + 3] = 255;
      const poreHit = o.pore > 0 && rng() < 0.01 * late ? 1 : 0;
      heights[y * size + x] = -late * 0.15 - poreHit * 0.7;
      const rv = Math.min(255, Math.max(0, (o.rough + late * 0.05 + poreHit * 0.2) * 255));
      rimg.data[idx] = rv; rimg.data[idx + 1] = rv; rimg.data[idx + 2] = rv; rimg.data[idx + 3] = 255;
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
