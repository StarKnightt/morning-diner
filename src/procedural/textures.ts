/**
 * Procedural canvas textures. System 1 placeholders: enough variation that
 * surfaces do not read as flat CG, nothing more. System 5 replaces these with
 * the real material set.
 */
import * as THREE from "three";
import { makeFbm, makeRng } from "../core/rng";

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
  /** Lightening map: cracks expose the pale knit backing, so they are LIGHTER than the vinyl. */
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

/**
 * Expanded-vinyl upholstery: fine leather grain plus plasticiser crazing in
 * patches (polygonal cells 3–15 mm, cracks 0.3–1 mm, lips curled up). One
 * canvas covers `metres` of vinyl; the caller sets repeat from the UV scale.
 */
export function vinylCrazing(size: number, metres: number): VinylSet {
  const pxPerMm = size / (metres * 1000);
  const { c, ctx } = canvas(size, size);
  const { c: nc, ctx: nctx } = canvas(size, size);
  const { c: rc, ctx: rctx } = canvas(size, size);
  const rng = makeRng(2024);
  const grain = makeFbm(61, 96, 3); // ~1 mm leather grain
  const patch = makeFbm(62, 3, 3); // where the crazing lives
  const cell = 9 * pxPerMm; // mean cell ≈ 9 mm
  const grid = Math.max(4, Math.round(size / cell));
  const step = size / grid;
  // Jittered lattice of cell centres (tileable).
  const cx = new Float32Array(grid * grid), cy = new Float32Array(grid * grid);
  for (let j = 0; j < grid; j++)
    for (let i = 0; i < grid; i++) {
      cx[j * grid + i] = (i + 0.15 + rng() * 0.7) * step;
      cy[j * grid + i] = (j + 0.15 + rng() * 0.7) * step;
    }
  const height = new Float32Array(size * size);
  const crack = new Float32Array(size * size);
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
      const p = patch(x / size, y / size); // 0..1, crazing where > 0.55
      const presence = Math.min(1, Math.max(0, (p - 0.52) / 0.15));
      const w = 0.35 + p * 0.5; // crack half-width in mm
      const inCrack = edge < w ? 1 - edge / w : 0;
      const lip = edge >= w && edge < w + 1.2 ? 1 - (edge - w) / 1.2 : 0;
      const i = y * size + x;
      const g = (grain(x / size, y / size) - 0.5) * 0.25;
      height[i] = g + presence * (-1.4 * inCrack + 0.45 * lip);
      crack[i] = presence * inCrack;
    }
  }
  const img = ctx.createImageData(size, size);
  const nimg = nctx.createImageData(size, size);
  const rimg = rctx.createImageData(size, size);
  const H = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, o = i * 4;
      const dx = (H(x + 1, y) - H(x - 1, y)) * 2.2;
      const dy = (H(x, y + 1) - H(x, y - 1)) * 2.2;
      const len = Math.hypot(dx, dy, 1);
      nimg.data[o] = ((-dx / len) * 0.5 + 0.5) * 255;
      nimg.data[o + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      nimg.data[o + 2] = (1 / len) * 255;
      nimg.data[o + 3] = 255;
      // Colour: neutral 0.8 grey (the material colour is pre-divided), cracks toward pale backing.
      const k = crack[i];
      img.data[o] = 204 + k * 44; img.data[o + 1] = 204 + k * 38; img.data[o + 2] = 204 + k * 34; img.data[o + 3] = 255;
      // Roughness: grain modulation, cracks matte.
      const r = 0.5 + (H(x, y) - k) * 0.12 + k * 0.4;
      const rv = Math.min(255, Math.max(0, r * 255));
      rimg.data[o] = rv; rimg.data[o + 1] = rv; rimg.data[o + 2] = rv; rimg.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  nctx.putImageData(nimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return { map: finish(c, true, 8), normalMap: finish(nc, false, 8), roughnessMap: finish(rc, false, 8) };
}

/**
 * Formica "Skylark" boomerang laminate on a cream base. One canvas = `metres`
 * of laminate; boomerangs 20–40 mm, two low-contrast tones, wrapped for tiling.
 */
export function formicaBoomerang(size: number, metres: number, base: string, tones: string[], density: number, seed: number): TextureSet {
  const { c, ctx } = canvas(size, size);
  const { c: rc, ctx: rctx } = canvas(size, size);
  const rng = makeRng(seed);
  const pxPerMm = size / (metres * 1000);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  // Faint linen texture under the pattern.
  const fbm = makeFbm(seed + 1, 48, 2);
  const img = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = (fbm(x / size, y / size) - 0.5) * 0.05;
      const o = (y * size + x) * 4;
      img.data[o] *= 1 + n; img.data[o + 1] *= 1 + n; img.data[o + 2] *= 1 + n;
    }
  ctx.putImageData(img, 0, 0);
  const count = Math.round(metres * metres * 1e4 * density);
  ctx.lineCap = "round";
  for (let k = 0; k < count; k++) {
    const x = rng() * size, y = rng() * size;
    const len = (14 + rng() * 16) * pxPerMm, a = rng() * Math.PI * 2;
    const bend = 0.35 + rng() * 0.2;
    ctx.strokeStyle = tones[Math.floor(rng() * tones.length)];
    ctx.lineWidth = (2.8 + rng() * 1.5) * pxPerMm;
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size], [size, size], [-size, -size], [size, -size], [-size, size]]) {
      const px = x + ox, py = y + oy;
      const dx = Math.cos(a) * len / 2, dy = Math.sin(a) * len / 2;
      const nx = -Math.sin(a) * len * bend, ny = Math.cos(a) * len * bend;
      ctx.beginPath();
      ctx.moveTo(px - dx, py - dy);
      ctx.quadraticCurveTo(px + nx, py + ny, px + dx, py + dy);
      ctx.stroke();
    }
  }
  // Roughness: worn gloss with directional wipe streaks.
  const wipe = makeFbm(seed + 5, 6, 3);
  const rimg = rctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = wipe(x / size, (y / size) * 0.15) - 0.5;
      const v = Math.min(255, Math.max(0, (0.34 + n * 0.16) * 255));
      const o = (y * size + x) * 4;
      rimg.data[o] = v; rimg.data[o + 1] = v; rimg.data[o + 2] = v; rimg.data[o + 3] = 255;
    }
  rctx.putImageData(rimg, 0, 0);
  return { map: finish(c, true, 8), roughnessMap: finish(rc, false, 8) };
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
  ctx.fillStyle = "rgb(236,228,212)";
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
