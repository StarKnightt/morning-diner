/**
 * World-layer textures that are cheap enough to draw on the main thread (a 256² grain
 * normal is ~20 ms) — anything bigger goes through the TextureBank worker pool.
 */
import * as THREE from "three";
import { makeFbm } from "../core/rng";

/** Tileable detail normal for the desert ground: sand grain + pebble bumps. */
export function grainNormal(size = 256, seed = 4401): THREE.Texture {
  const fine = makeFbm(seed, 24, 3), coarse = makeFbm(seed + 7, 6, 2);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let s = fine(u, v) * 0.55 + coarse(u, v) * 0.45;
      // Pebbles: threshold the coarse field into a few raised lumps.
      const p = coarse(u * 2 + 0.3, v * 2 + 0.7);
      s += Math.max(0, p - 0.62) * 2.2;
      h[y * size + x] = s;
    }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const k = 2.2 * size / 256;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
      const d = h[((y - 1 + size) % size) * size + x], u = h[((y + 1) % size) * size + x];
      const nx = -(r - l) * k, ny = -(u - d) * k;
      const len = Math.hypot(nx, ny, 1);
      const o = (y * size + x) * 4;
      img.data[o] = 128 + (nx / len) * 127;
      img.data[o + 1] = 128 + (ny / len) * 127;
      img.data[o + 2] = 128 + (1 / len) * 127;
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
