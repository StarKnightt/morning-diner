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
