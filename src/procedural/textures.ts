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
