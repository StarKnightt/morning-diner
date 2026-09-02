/**
 * Crop 400×400 regions out of capture frames for close inspection.
 *
 *   node tools/crop.mjs shots/sys2-counter.png 360,420 shots/crops/stool-base.png [size]
 *
 * x,y is the crop CENTRE in the source PNG; the crop is clamped to the image.
 * Optional 4th arg is the crop size (default 400). Output is written with pngjs,
 * upscaled ×2 (nearest) so 1080p detail is legible in a viewer.
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const [src, centre, out, sizeArg] = process.argv.slice(2);
if (!src || !centre || !out) {
  console.error("usage: node tools/crop.mjs <src.png> <cx,cy> <out.png> [size]");
  process.exit(2);
}
const size = Number(sizeArg ?? 400);
const [cx, cy] = centre.split(",").map(Number);
const png = PNG.sync.read(fs.readFileSync(src));
const x0 = Math.max(0, Math.min(png.width - size, Math.round(cx - size / 2)));
const y0 = Math.max(0, Math.min(png.height - size, Math.round(cy - size / 2)));
const scale = 2;
const outPng = new PNG({ width: size * scale, height: size * scale });
for (let y = 0; y < size * scale; y++) {
  for (let x = 0; x < size * scale; x++) {
    const si = ((y0 + Math.floor(y / scale)) * png.width + (x0 + Math.floor(x / scale))) * 4;
    const di = (y * size * scale + x) * 4;
    outPng.data[di] = png.data[si];
    outPng.data[di + 1] = png.data[si + 1];
    outPng.data[di + 2] = png.data[si + 2];
    outPng.data[di + 3] = 255;
  }
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, PNG.sync.write(outPng));
console.log(`[crop] ${src} @ (${x0},${y0}) ${size}px -> ${out}`);
