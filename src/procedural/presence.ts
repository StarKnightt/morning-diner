/**
 * System 9 "implied presence" atlas — one canvas set (map / roughness / normal) for
 * the soft things that suggest a person who just stepped away: the waitress's
 * cotton-canvas waist apron, a knit cardigan, a folded newspaper, and what is
 * left on a breakfast plate. Four regions on a 2 × 2 grid (`PRESENCE_UV`, v up):
 *
 *   cotton     cream 2/1 basket-weave canvas; the weave lives mostly in the normal map,
 *              with hand-wipe grime toward the pocket line and two coffee spots
 *   knit       rust stockinette with the V of every stitch, 10 px ribs, fuzz
 *   newsprint  aged page: masthead bar, a headline of word-blocks, a deck, four columns
 *              of 2 px body lines with ragged word gaps, one halftone photo block
 *   food       toast top with crumb pores and a darker crust band (left half) and a
 *              dried egg-yolk smear, semi-gloss, with a darker skin edge (right half)
 *
 * Pure function of `size` (seeded), so it runs in the texture worker (`pres` module in
 * texWorker.ts, `presenceAtlas` in the TextureBank SHAPES).
 */
import * as THREE from "three";
import { makeFbm, makeRng } from "../core/rng";

export interface PresenceSet {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalMap: THREE.Texture;
}

/** [u0, v0, u1, v1] per region, v up (CanvasTexture flipY). */
export const PRESENCE_UV = {
  cotton: [0.0, 0.5, 0.5, 1.0],
  knit: [0.5, 0.5, 1.0, 1.0],
  newsprint: [0.0, 0.0, 0.5, 0.5],
  toast: [0.5, 0.0, 0.75, 0.5],
  yolk: [0.75, 0.0625, 1.0, 0.5],
  /** Flat waxy lipstick red (the cup's rim mark samples its centre) — keeps the mark in this bucket. */
  lipstick: [0.75, 0.0, 1.0, 0.0625],
} as const satisfies Record<string, readonly [number, number, number, number]>;

function canvas(w: number, h: number) {
  const c = (typeof document === "undefined" ? new OffscreenCanvas(w, h) : document.createElement("canvas")) as HTMLCanvasElement;
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas context unavailable");
  return { c, ctx };
}

function finish(c: HTMLCanvasElement, srgb: boolean, anisotropy: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function presenceAtlas(size = 1024): PresenceSet {
  const S = size, R = S / 2; // region size
  const { c, ctx } = canvas(S, S);
  const rough = new Float32Array(S * S);
  const height = new Float32Array(S * S);
  const img = ctx.createImageData(S, S);
  const px = (x: number, y: number, r: number, g: number, b: number) => {
    const o = (y * S + x) * 4;
    img.data[o] = r * 255;
    img.data[o + 1] = g * 255;
    img.data[o + 2] = b * 255;
    img.data[o + 3] = 255;
  };
  const rng = makeRng(9009);
  const fbmA = makeFbm(91, 6, 4), fbmB = makeFbm(92, 24, 3), fbmC = makeFbm(93, 60, 2);

  /* ---------------- cotton canvas (top-left) ---------------- */
  for (let y = 0; y < R; y++)
    for (let x = 0; x < R; x++) {
      const u = x / R, v = y / R;
      // 2/1 basket weave: 3 px threads; warp over weft in alternating cells.
      const cellX = Math.floor(x / 3), cellY = Math.floor(y / 3);
      const over = (cellX + cellY) % 2 === 0;
      const fx = (x % 3) / 3, fy = (y % 3) / 3;
      const bulge = over ? Math.sin(fx * Math.PI) : Math.sin(fy * Math.PI); // thread crown across its width
      const weave = 0.93 + 0.07 * bulge;
      const tone = 0.97 + 0.06 * (fbmA(u, v) - 0.5);
      // Grime: hand wipes gather low (the pocket line) and toward the middle.
      const grime = clamp01((fbmB(u, v) - 0.45) * 2.2) * (0.35 + 0.65 * v) * 0.22;
      let r = 0.91 * weave * tone, g = 0.88 * weave * tone, b = 0.80 * weave * tone;
      r = r * (1 - grime) + 0.42 * grime;
      g = g * (1 - grime) + 0.36 * grime;
      b = b * (1 - grime) + 0.28 * grime;
      // Two old coffee spots: faint fills with a slightly darker, ragged tide line.
      for (const [sx, sy, sr] of [[0.36, 0.71, 0.05], [0.62, 0.8, 0.03]]) {
        const rag = 1 + 0.55 * (fbmB(u * 5 + 3, v * 5) - 0.5) + 0.3 * (fbmC(u * 2, v * 2) - 0.5);
        const d = (Math.hypot(u - sx, (v - sy) * 1.3) / sr) * rag;
        if (d < 1) {
          const tide = clamp01((d - 0.7) / 0.3); // soft tide line, no hard rim
          const blot = 0.5 + 0.5 * fbmB(u * 9, v * 9 + 7);
          const k = (0.35 * blot + 0.65 * tide * tide) * 0.14;
          r = r * (1 - k) + 0.36 * k;
          g = g * (1 - k) + 0.24 * k;
          b = b * (1 - k) + 0.14 * k;
        }
      }
      px(x, y, r, g, b);
      rough[y * S + x] = 0.86 + 0.06 * bulge + 0.05 * grime;
      height[y * S + x] = bulge * 0.6 + 0.4 * (over ? 1 : 0);
    }

  /* ---------------- knit (top-right) ---------------- */
  for (let y = 0; y < R; y++)
    for (let x = 0; x < R; x++) {
      const u = x / R, v = y / R;
      const X = x + R;
      // Stockinette: 10 px wales, 7 px courses; every stitch is a V (two legs).
      const wale = (x % 10) / 10, course = (y % 7) / 7;
      const leg = Math.abs(wale - 0.5) * 2; // 0 at the centre of the wale, 1 at the edges
      const vShape = clamp01(1 - Math.abs(course - 0.5 - 0.35 * (leg - 0.5)) * 2.6);
      const stitch = 0.78 + 0.22 * vShape * (0.6 + 0.4 * (1 - leg));
      const fuzz = 1 + 0.08 * (fbmC(u, v) - 0.5);
      const tone = 1 + 0.08 * (fbmA(u * 0.7, v * 0.7) - 0.5);
      const k = stitch * fuzz * tone;
      px(X, y, 0.56 * k, 0.29 * k, 0.15 * k);
      rough[y * S + X] = 0.96;
      height[y * S + X] = vShape * (1 - 0.5 * leg);
    }

  /* ---------------- newsprint (bottom-left) ---------------- */
  {
    const Y0 = R;
    for (let y = 0; y < R; y++)
      for (let x = 0; x < R; x++) {
        const u = x / R, v = y / R;
        const grain = 1 + 0.05 * (fbmC(u, v) - 0.5) + 0.03 * (fbmA(u, v) - 0.5);
        // Yellowed toward the edges (it sat in the sun on the sill).
        const edge = clamp01(Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2 - 0.55) * 0.5;
        px(x, Y0 + y, (0.74 - 0.04 * edge) * grain, (0.71 - 0.06 * edge) * grain, (0.62 - 0.1 * edge) * grain);
        rough[(Y0 + y) * S + x] = 0.82 + 0.04 * (fbmC(u, v) - 0.5);
        height[(Y0 + y) * S + x] = 0.5 + 0.05 * (fbmC(u, v) - 0.5);
      }
    ctx.putImageData(img, 0, 0);
    // Ink work with the 2D API on top of the paper field.
    const m = 14; // margin
    const ink = (a: number) => `rgba(28,26,24,${a})`;
    // Masthead bar with a white rule and a name block.
    ctx.fillStyle = ink(0.92);
    ctx.fillRect(m, Y0 + m, R - 2 * m, 30);
    ctx.fillStyle = "rgba(200,194,180,0.95)";
    ctx.fillRect(m + 8, Y0 + m + 6, 170, 18);
    ctx.fillStyle = ink(0.9);
    for (let i = 0, x = m + 12; i < 3; i++) {
      const w = 40 + rng() * 25;
      ctx.fillRect(x, Y0 + m + 9, w, 12);
      x += w + 8;
    }
    ctx.fillStyle = ink(0.8);
    ctx.fillRect(m, Y0 + m + 34, R - 2 * m, 1.5);
    // Headline: two lines of big word blocks.
    const wordLine = (y: number, h: number, x0: number, x1: number, a: number, gap: number) => {
      ctx.fillStyle = ink(a);
      let x = x0;
      while (x < x1 - 6) {
        const w = Math.min(x1 - x, h * (1.2 + rng() * 2.4));
        ctx.fillRect(x, y, w, h);
        x += w + gap;
      }
    };
    wordLine(Y0 + m + 46, 24, m, R - m, 0.9, 9);
    wordLine(Y0 + m + 78, 24, m, R - m - 90, 0.9, 9);
    // Deck.
    wordLine(Y0 + m + 112, 9, m, R - m - 40, 0.7, 5);
    ctx.fillStyle = ink(0.55);
    ctx.fillRect(m, Y0 + m + 128, R - 2 * m, 1);
    // Body: four columns of 2 px lines; a halftone photo in column 3–4.
    const cols = 4, gutter = 10, colW = (R - 2 * m - gutter * (cols - 1)) / cols;
    const bodyTop = Y0 + m + 136, bodyBottom = Y0 + R - m;
    const photo = { x: m + 2 * (colW + gutter), y: bodyTop, w: 2 * colW + gutter, h: 130 };
    for (let ci = 0; ci < cols; ci++) {
      const x0 = m + ci * (colW + gutter);
      let y = bodyTop;
      if (ci >= 2) y = photo.y + photo.h + 10;
      // Subhead every so often.
      while (y < bodyBottom - 4) {
        if (rng() < 0.06) {
          wordLine(y, 6, x0, x0 + colW, 0.85, 3);
          y += 11;
          continue;
        }
        const last = rng() < 0.12; // paragraph end: short line + gap
        wordLine(y, 2, x0, last ? x0 + colW * (0.3 + 0.5 * rng()) : x0 + colW, 0.7, 2);
        y += last ? 7 : 4;
      }
    }
    // Photo: grey halftone field with a darker subject mass and a hairline border.
    const pimg = ctx.getImageData(photo.x, photo.y, photo.w, photo.h);
    const pf = makeFbm(97, 3, 4);
    for (let y = 0; y < photo.h; y++)
      for (let x = 0; x < photo.w; x++) {
        const u = x / photo.w, v = y / photo.h;
        const subject = clamp01(1 - Math.hypot((u - 0.45) * 1.3, (v - 0.55) * 1.1) * 1.6);
        let g = 0.62 - 0.35 * subject + 0.25 * (pf(u, v) - 0.5);
        // Halftone: a 3 px dot screen modulating the grey.
        const dot = ((x % 3) + (y % 3)) % 2 === 0 ? 0.06 : -0.06;
        g = clamp01(g + dot) * 0.86;
        const o = (y * photo.w + x) * 4;
        pimg.data[o] = g * 255 * 1.02;
        pimg.data[o + 1] = g * 255;
        pimg.data[o + 2] = g * 255 * 0.92;
        pimg.data[o + 3] = 255;
      }
    ctx.putImageData(pimg, photo.x, photo.y);
    ctx.strokeStyle = ink(0.8);
    ctx.lineWidth = 1;
    ctx.strokeRect(photo.x + 0.5, photo.y + 0.5, photo.w - 1, photo.h - 1);
    wordLine(photo.y + photo.h + 3, 2, photo.x, photo.x + photo.w * 0.8, 0.6, 2); // caption
    // Read the inked page back so the remaining regions can be written through `px`.
    const back = ctx.getImageData(0, 0, S, S);
    img.data.set(back.data);
  }

  /* ---------------- food (bottom-right): toast | yolk ---------------- */
  {
    const Y0 = R, X0 = R, half = R / 2;
    const pores = makeFbm(98, 40, 3), crumb = makeFbm(99, 14, 3), yolkN = makeFbm(100, 5, 3);
    for (let y = 0; y < R; y++)
      for (let x = 0; x < R; x++) {
        const X = X0 + x, Y = Y0 + y;
        if (x < half) {
          // Toast: golden top, crumb pores as darker pits, crust band at the region's edges.
          const u = x / half, v = y / R;
          const pore = clamp01((pores(u, v) - 0.56) * 4);
          const tone = 0.9 + 0.2 * (crumb(u, v) - 0.5);
          const edge = clamp01(Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2 - 0.72) / 0.28;
          const scorch = clamp01((crumb(u * 2, v * 2) - 0.55) * 3) * 0.5;
          let r = 0.78 * tone, g = 0.55 * tone, b = 0.26 * tone;
          const dark = pore * 0.45 + scorch * 0.5 + edge * 0.55;
          r *= 1 - dark * 0.7;
          g *= 1 - dark * 0.8;
          b *= 1 - dark * 0.85;
          px(X, Y, r, g, b);
          rough[Y * S + X] = 0.92;
          height[Y * S + X] = 0.6 - 0.6 * pore + 0.15 * (crumb(u, v) - 0.5);
        } else if (y >= R - R / 8) {
          // Lipstick strip (bottom 1/8 of the yolk column): waxy red, flat, semi-gloss.
          const n = yolkN(x / R + 3, y / R);
          px(X, Y, 0.6 + 0.05 * (n - 0.5), 0.07, 0.1);
          rough[Y * S + X] = 0.42;
          height[Y * S + X] = 0.5;
        } else {
          // Yolk: a dried smear — deep yellow, darker skin at the edge, a couple of streaks.
          const u = (x - half) / half, v = y / (R - R / 8);
          const n = yolkN(u, v);
          const edge = clamp01(Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2 - 0.7) / 0.3;
          const streak = clamp01(Math.sin((u * 3 + v * 7 + n) * Math.PI * 2) * 0.5 + 0.2) * 0.25;
          const k = 1 - 0.35 * edge - streak * 0.5;
          px(X, Y, (0.86 + 0.08 * (n - 0.5)) * k, (0.62 + 0.1 * (n - 0.5)) * k, 0.12 * k);
          rough[Y * S + X] = 0.35 + 0.3 * edge + 0.2 * streak;
          height[Y * S + X] = 0.5 + 0.3 * (n - 0.5) - 0.2 * edge;
        }
      }
  }

  ctx.putImageData(img, 0, 0);
  const map = finish(c, true, 8);

  // Roughness (linear grey).
  const rc = canvas(S, S);
  const rimg = rc.ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = clamp01(rough[i]) * 255;
    rimg.data[i * 4] = v;
    rimg.data[i * 4 + 1] = v;
    rimg.data[i * 4 + 2] = v;
    rimg.data[i * 4 + 3] = 255;
  }
  rc.ctx.putImageData(rimg, 0, 0);
  const roughnessMap = finish(rc.c, false, 8);

  // Normal from the height field (clamped, so no wrap across regions).
  const nc = canvas(S, S);
  const nimg = nc.ctx.createImageData(S, S);
  const H = (x: number, y: number) => height[Math.min(S - 1, Math.max(0, y)) * S + Math.min(S - 1, Math.max(0, x))];
  const scale = 1.4;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * scale, dy = (H(x, y + 1) - H(x, y - 1)) * scale;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * S + x) * 4;
      nimg.data[o] = ((-dx / len) * 0.5 + 0.5) * 255;
      nimg.data[o + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      nimg.data[o + 2] = (1 / len) * 255;
      nimg.data[o + 3] = 255;
    }
  nc.ctx.putImageData(nimg, 0, 0);
  const normalMap = finish(nc.c, false, 8);

  return { map, roughnessMap, normalMap };
}
