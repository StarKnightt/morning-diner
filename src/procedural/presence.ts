/**
 * System 9 "implied presence" atlas (rev 2) — one canvas set (map with alpha / roughness /
 * normal) for the soft props and the kitchen slice behind the swing door. Regions
 * (`PRESENCE_UV`, v up):
 *
 *   cotton      cream cotton canvas at apron scale (the skirt maps 1:1): a barely-there 2 px
 *               twill in the height field, fibre grain, hand-wipe grime, two coffee blots with
 *               a dark ragged tide line and a lighter interior, and the contact shadow the patch
 *               pocket throws on the skirt under its top edge
 *   pocket      the same canvas for the pocket face, hem rows and a stitch line 3 mm in from
 *               the edge, grime at the mouth
 *   wallTile    4 × 4 white 4" ceramic wall tiles, cushion edges, grey grout (kitchen slice)
 *   quarry      4 × 4 red 6" quarry floor tiles, dark grout, mottled (kitchen slice)
 *   lipstick    an upper-lip print (two lobes, cupid's bow, lip lines), pink-red, ALPHA —
 *               pressure fades at the outline; lower contact edge strongest
 *   yolkFilm    a thin dried egg-yolk film, ALPHA, feathered, four tine drag streaks
 *   crumb       toast-crumb colour for the flakes
 *   contactAO   soft dark disc, ALPHA (the cup's contact shadow in the saucer well)
 *   residue     coffee residue ring for the inside of the cup, ALPHA, ragged tide line
 *   label       printed band for the filter box: brand block, word lines, a filter graphic
 *
 * Alpha only matters to the transparent decal material (Presence.ts `presenceDecal`); the
 * opaque `presence` bucket ignores it. Pure function of `size` (seeded), so it runs in the
 * texture worker (`pres` module in texWorker.ts, `presenceAtlas` in the TextureBank SHAPES).
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
  pocket: [0.5, 0.5, 0.75, 0.75],
  lipstick: [0.5, 0.75, 0.75, 1.0],
  yolkFilm: [0.75, 0.75, 1.0, 1.0],
  label: [0.75, 0.6875, 1.0, 0.75],
  residue: [0.75, 0.625, 1.0, 0.6875],
  crumb: [0.75, 0.5, 0.875, 0.625],
  contactAO: [0.875, 0.5, 1.0, 0.625],
  quarry: [0.0, 0.0, 0.5, 0.5],
  wallTile: [0.5, 0.0, 1.0, 0.5],
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
const smooth01 = (v: number) => {
  v = clamp01(v);
  return v * v * (3 - 2 * v);
};

export function presenceAtlas(size = 1024): PresenceSet {
  const S = size, R = S / 2, Q = S / 4, E = S / 8;
  const { c, ctx } = canvas(S, S);
  const rough = new Float32Array(S * S).fill(0.9);
  const height = new Float32Array(S * S).fill(0.5);
  const img = ctx.createImageData(S, S);
  const px = (x: number, y: number, r: number, g: number, b: number, a = 1) => {
    const o = (y * S + x) * 4;
    img.data[o] = clamp01(r) * 255;
    img.data[o + 1] = clamp01(g) * 255;
    img.data[o + 2] = clamp01(b) * 255;
    img.data[o + 3] = clamp01(a) * 255;
  };
  const rng = makeRng(9009);
  const fbmA = makeFbm(91, 6, 4), fbmB = makeFbm(92, 24, 3), fbmC = makeFbm(93, 60, 2), grainN = makeFbm(94, 180, 2);

  /* ---------------- cotton canvas (top-left, R × R) — the skirt maps 1:1 ---------------- */
  // Pocket footprint on the skirt (t down, s across → u = s, v = 1 − t; canvas y = 1 − v = t).
  const POCKET = { t0: 0.44, t1: 0.8, s0: 0.55, s1: 0.9 };
  const cottonPixel = (u: number, v: number, x: number, y: number) => {
    // Twill: a 2 px diagonal in the height field only (albedo ± 1.5 %) — sub-texel at frame
    // scale, so the mips average it to a matte surface; fibre grain on top.
    const twill = 0.5 + 0.5 * Math.sin(((x + y) / 2) * Math.PI);
    const grain = grainN(u, v) - 0.5;
    const tone = 0.985 + 0.04 * (fbmA(u, v) - 0.5) + 0.03 * twill * 0.5 + 0.05 * grain;
    // Grime: hand wipes gather at the pocket line and mid-height.
    const grime = clamp01((fbmB(u, v) - 0.47) * 2.2) * (0.25 + 0.75 * smooth01((v - 0.15) / 0.5) * (1 - smooth01((v - 0.75) / 0.25))) * 0.2;
    let r = 0.9 * tone, g = 0.87 * tone, b = 0.79 * tone;
    r = r * (1 - grime) + 0.44 * grime;
    g = g * (1 - grime) + 0.37 * grime;
    b = b * (1 - grime) + 0.28 * grime;
    let ro = 0.9 + 0.04 * grain + 0.04 * grime;
    return { r, g, b, ro, h: 0.5 + 0.22 * (twill - 0.5) + 0.06 * grain };
  };
  for (let y = 0; y < R; y++)
    for (let x = 0; x < R; x++) {
      const u = x / R, v = y / R; // v here is canvas-down (t of the skirt)
      const p = cottonPixel(u, 1 - v, x, y);
      let { r, g, b } = p;
      // Two old coffee blots: dark ragged tide line, lighter mottled interior.
      for (const [sx, sy, sr, k0] of [[0.34, 0.62, 0.055, 1], [0.66, 0.33, 0.032, 0.8]]) {
        const rag = 1 + 0.5 * (fbmB(u * 5 + 3, v * 5) - 0.5) + 0.35 * (fbmC(u * 2, v * 2) - 0.5);
        const d = (Math.hypot(u - sx, (v - sy) * 1.25) / sr) * rag;
        if (d < 1.05) {
          const tide = Math.exp(-Math.pow((d - 0.93) / 0.07, 2)); // the ring
          const inner = clamp01((0.93 - d) / 0.93) * (0.35 + 0.35 * fbmB(u * 9, v * 9 + 7));
          const k = (0.16 * inner + 0.42 * tide) * k0 * clamp01((1.05 - d) / 0.08);
          r = r * (1 - k) + 0.33 * k;
          g = g * (1 - k) + 0.2 * k;
          b = b * (1 - k) + 0.1 * k;
        }
      }
      // The pocket's shadow on the skirt: a soft band under its top edge (the mouth gapes and
      // shows the skirt there) and a faint line down its sides.
      if (u > POCKET.s0 - 0.01 && u < POCKET.s1 + 0.01 && v > POCKET.t0 - 0.005 && v < POCKET.t1) {
        const under = Math.exp(-Math.max(0, v - POCKET.t0) / 0.035) * clamp01((v - POCKET.t0 + 0.005) / 0.01);
        const side = Math.max(Math.exp(-Math.abs(u - POCKET.s0) / 0.008), Math.exp(-Math.abs(u - POCKET.s1) / 0.008));
        const k = clamp01(0.55 * under + 0.35 * side * clamp01((v - POCKET.t0) / 0.05));
        r *= 1 - 0.45 * k;
        g *= 1 - 0.47 * k;
        b *= 1 - 0.5 * k;
      }
      px(x, y, r, g, b);
      rough[y * S + x] = p.ro;
      height[y * S + x] = p.h;
    }

  /* ---------------- pocket face (Q × Q at x R.., y R..): canvas + hem rows + stitch line ---------------- */
  {
    const X0 = R, Y0 = R;
    for (let y = 0; y < Q; y++)
      for (let x = 0; x < Q; x++) {
        const u = x / Q, v = y / Q;
        const p = cottonPixel(0.62 + u * 0.3, 0.2 + v * 0.3, x, y);
        let { r, g, b } = p, h = p.h, ro = p.ro;
        // Mouth grime (hands): a soft dark band under the top hem.
        const mouth = 0.14 * Math.exp(-Math.pow((v - 0.09) / 0.06, 2)) * (0.6 + 0.4 * fbmB(u * 3, v * 3 + 5));
        r = r * (1 - mouth) + 0.4 * mouth;
        g = g * (1 - mouth) + 0.33 * mouth;
        b = b * (1 - mouth) + 0.25 * mouth;
        // Stitch lines: 3 mm in from the sides and bottom, two rows at the top hem — a dashed
        // dark thread in a slight furrow.
        const inset = 0.028;
        const dSide = Math.min(Math.abs(u - inset), Math.abs(u - (1 - inset)));
        const dBot = Math.abs(v - (1 - inset));
        const dTop = Math.min(Math.abs(v - 0.02), Math.abs(v - 0.055));
        const d = Math.min(dSide, dBot, dTop);
        if (d < 0.006) {
          const along = d === dSide ? v : u;
          const dash = (Math.sin(along * Math.PI * 2 * 34) > -0.2 ? 1 : 0.35) * (d === dTop ? 1 : v > 0.05 ? 1 : 0);
          const k = clamp01(1 - d / 0.006) * 0.55 * dash;
          r *= 1 - k;
          g *= 1 - k;
          b *= 1 - k;
          h -= 0.25 * k;
          ro = Math.min(1, ro + 0.05 * k);
        }
        px(X0 + x, Y0 + y, r, g, b);
        rough[(Y0 + y) * S + X0 + x] = ro;
        height[(Y0 + y) * S + X0 + x] = h;
      }
  }

  /* ---------------- lipstick print (Q × Q at x R.., y 0..) — 24 mm square, alpha ---------------- */
  {
    const X0 = R, Y0 = 0;
    const W = 0.355; // half-width → 17 mm of the 24 mm tile
    const lipN = makeFbm(101, 9, 3);
    for (let y = 0; y < Q; y++)
      for (let x = 0; x < Q; x++) {
        const u = x / Q, v = 1 - y / Q; // v up
        const xi = (u - 0.5) / W;
        let a = 0;
        if (Math.abs(xi) < 1.15) {
          const e = Math.sqrt(Math.max(0, 1 - Math.min(1, xi * xi)));
          // Upper lip: two lobes with the cupid's bow dip between them; the lower edge (contact
          // line) is nearly straight with the tubercle's bulge at the centre.
          const top = 0.5 + 0.135 * e * (1 - 0.38 * Math.exp(-Math.pow(xi / 0.17, 2))) + 0.01 * (lipN(u * 2, v) - 0.5);
          const bot = 0.5 - 0.03 - 0.035 * Math.sqrt(e) - 0.045 * Math.exp(-Math.pow(xi / 0.32, 2));
          const inside = Math.min(top - v, v - bot); // > 0 inside
          const soft = 0.018;
          a = smooth01((inside + soft) / (2 * soft)) * clamp01((1.03 - Math.abs(xi)) / 0.06);
          // Pressure: strongest at the contact edge, lighter at the lobe tops; lip lines — thin
          // vertical creases where less colour transferred.
          const pressure = 0.55 + 0.45 * clamp01(1 - (v - bot) / Math.max(0.02, top - bot));
          const creases = Math.pow(clamp01(Math.sin(u * Math.PI * 2 * 21 + 3 * (lipN(u, v * 0.3) - 0.5)) * 0.5 + 0.5), 6);
          a *= pressure * (1 - 0.55 * creases) * (0.8 + 0.4 * lipN(u * 3, v * 3));
          // A faint transferred halo just outside the print.
          a = Math.max(a, 0.07 * smooth01((inside + 0.05) / 0.05) * clamp01((1.08 - Math.abs(xi)) / 0.1) * lipN(u * 4, v * 4));
        }
        const n = lipN(u * 5 + 1, v * 5);
        px(X0 + x, Y0 + y, 0.8 + 0.06 * (n - 0.5), 0.16 + 0.05 * (n - 0.5), 0.22 + 0.04 * (n - 0.5), clamp01(a * 0.9));
        rough[(Y0 + y) * S + X0 + x] = 0.38;
        height[(Y0 + y) * S + X0 + x] = 0.5;
      }
  }

  /* ---------------- yolk film (Q × Q at x R+Q.., y 0..) — 50 mm square, alpha ---------------- */
  {
    const X0 = R + Q, Y0 = 0;
    const yN = makeFbm(102, 4, 4), yF = makeFbm(103, 14, 3);
    for (let y = 0; y < Q; y++)
      for (let x = 0; x < Q; x++) {
        const u = x / Q, v = 1 - y / Q;
        // Irregular blob, feathered.
        const cx = 0.5 + 0.06 * (yN(0.2, 0.7) - 0.5), cy = 0.5;
        const ang = Math.atan2(v - cy, u - cx);
        const rr = 0.3 * (1 + 0.32 * (yN(Math.cos(ang) * 0.5 + 0.5, Math.sin(ang) * 0.5 + 0.5) - 0.5) * 2 + 0.12 * Math.sin(ang * 3 + 1));
        const d = Math.hypot(u - cx, (v - cy) * 1.2) / Math.max(0.05, rr);
        let a = smooth01((1.08 - d) / 0.25) * (0.28 + 0.3 * yF(u, v));
        // Fork drag: four tine streaks 7 mm apart (0.14 of the tile), curving, where the film
        // was scraped thin — a slightly thicker ridge beside each.
        const along = u * 0.9 + v * 0.45 + 0.06 * (yN(u, v) - 0.5);
        const across = -u * 0.45 + v * 0.9;
        const tine = ((across * 7.2 + 0.3) % 1 + 1) % 1; // 0..1 across each 7 mm lane
        const scrape = Math.exp(-Math.pow((tine - 0.5) / 0.09, 2)) * clamp01((along - 0.25) / 0.1) * clamp01((0.95 - along) / 0.1);
        const ridge = Math.exp(-Math.pow((tine - 0.66) / 0.05, 2)) * clamp01((along - 0.25) / 0.1);
        a *= 1 - 0.75 * scrape;
        a += 0.14 * ridge * smooth01((1.0 - d) / 0.2);
        const thick = clamp01(a / 0.6);
        px(X0 + x, Y0 + y, 0.88 + 0.06 * (yF(u * 2, v * 2) - 0.5), 0.66 + 0.1 * (yF(u * 2, v * 2) - 0.5) - 0.12 * thick, 0.16 + 0.06 * thick, clamp01(a));
        rough[(Y0 + y) * S + X0 + x] = 0.22 + 0.15 * (1 - thick);
        height[(Y0 + y) * S + X0 + x] = 0.5 + 0.18 * thick - 0.12 * scrape;
      }
  }

  /* ---------------- label band (2Q × E at x R+Q.., y Q..) ---------------- */
  {
    const X0 = R + Q, Y0 = Q, W = Q, H = E;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const u = x / W, v = y / H;
        // Cream ground, brown left block (brand), red disc, a white fluted filter graphic.
        let r = 0.93, g = 0.88, b = 0.78;
        if (u < 0.38) {
          r = 0.38;
          g = 0.22;
          b = 0.12;
          const dx = (u - 0.19) / 0.14, dy = (v - 0.5) / 0.75;
          const rd = Math.hypot(dx, dy);
          if (rd < 1) {
            // Filter: white pleated disc (flutes as alternating tone), a brown centre.
            const flute = 0.86 + 0.12 * Math.sin(Math.atan2(dy, dx) * 28);
            r = rd < 0.42 ? 0.58 : flute;
            g = rd < 0.42 ? 0.42 : flute - 0.02;
            b = rd < 0.42 ? 0.3 : flute - 0.08;
          }
        } else if (u > 0.86) {
          // Red count block.
          r = 0.72;
          g = 0.12;
          b = 0.1;
        }
        px(X0 + x, Y0 + y, r, g, b);
        rough[(Y0 + y) * S + X0 + x] = 0.55;
        height[(Y0 + y) * S + X0 + x] = 0.5;
      }
    // Word lines (blocks read as print at distance) in the cream field and the red block —
    // drawn with the 2D API on a scratch canvas (opaque), then copied in, so the alpha regions
    // already in `img` never round-trip through the canvas's premultiplied store.
    const sc = canvas(W, H);
    sc.ctx.clearRect(0, 0, W, H);
    const word = (x0: number, x1: number, y: number, h: number, a: string, gap: number) => {
      sc.ctx.fillStyle = a;
      let x = x0;
      while (x < x1 - 4) {
        const w = Math.min(x1 - x, h * (1.1 + rng() * 2.2));
        sc.ctx.fillRect(x, y, w, h);
        x += w + gap;
      }
    };
    const lx0 = W * 0.41, lx1 = W * 0.84;
    word(lx0, lx1, 10, 14, "rgb(60,32,18)", 6); // COFFEE FILTERS
    word(lx0, lx1 - 30, 30, 7, "rgb(70,40,22)", 4);
    word(lx0, lx1 - 60, 42, 5, "rgb(80,48,28)", 3);
    sc.ctx.fillStyle = "rgb(250,244,230)";
    sc.ctx.fillRect(W * 0.885, 14, W * 0.09, 18); // "500"
    sc.ctx.fillRect(W * 0.895, 38, W * 0.07, 8); // "CT"
    const ink = sc.ctx.getImageData(0, 0, W, H).data;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        if (ink[o + 3] > 0) px(X0 + x, Y0 + y, ink[o] / 255, ink[o + 1] / 255, ink[o + 2] / 255);
      }
  }

  /* ---------------- residue ring (2Q × E at x R+Q.., y Q+E..), alpha; u tiles by fold-back ---------------- */
  {
    const X0 = R + Q, Y0 = Q + E, W = Q, H = E;
    const rN = makeFbm(104, 6, 3);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const u = x / W, v = 1 - y / H; // v up: 0 at the coffee surface, 1 highest
        const tide = 0.55 + 0.3 * (rN(u * 2, 0.3) - 0.5) * 2; // ragged top of the ring
        const band = clamp01((tide - v) / 0.08); // 1 below the tide line
        const line = Math.exp(-Math.pow((v - tide) / 0.035, 2)); // the dark line at the tide
        const film = 0.35 * band * (0.6 + 0.4 * rN(u * 4, v * 4)) * (1 - 0.5 * v / Math.max(0.1, tide));
        const a = clamp01(film + 0.5 * line + 0.3 * clamp01((0.12 - v) / 0.12)); // heaviest right at the surface
        px(X0 + x, Y0 + y, 0.26, 0.15, 0.08, a);
        rough[(Y0 + y) * S + X0 + x] = 0.35;
        height[(Y0 + y) * S + X0 + x] = 0.5;
      }
  }

  /* ---------------- crumb (E × E at x R+Q.., y Q+2E..) and contact AO (E × E at x R+Q+E..) ---------------- */
  {
    const Y0 = Q + 2 * E;
    const pores = makeFbm(98, 30, 3), crumb = makeFbm(99, 10, 3);
    for (let y = 0; y < E; y++)
      for (let x = 0; x < E; x++) {
        const u = x / E, v = y / E;
        const pore = clamp01((pores(u, v) - 0.55) * 4);
        const tone = 0.9 + 0.25 * (crumb(u, v) - 0.5);
        const scorch = clamp01((crumb(u * 2 + 1, v * 2) - 0.5) * 3) * 0.6;
        const dark = pore * 0.5 + scorch;
        px(R + Q + x, Y0 + y, 0.8 * tone * (1 - 0.7 * dark), 0.56 * tone * (1 - 0.8 * dark), 0.26 * tone * (1 - 0.85 * dark));
        rough[(Y0 + y) * S + R + Q + x] = 0.92;
        height[(Y0 + y) * S + R + Q + x] = 0.5 - 0.3 * pore;
        // Contact AO: a soft dark disc, alpha 0.55 to 80 % of the radius, then fading to 0 (the
        // cup's foot covers the middle; the visible ring just outside it is the dark part).
        const d = Math.hypot(u - 0.5, v - 0.5) * 2;
        const a = 0.55 * smooth01((1 - d) / 0.22);
        px(R + Q + E + x, Y0 + y, 0.05, 0.04, 0.03, a);
        rough[(Y0 + y) * S + R + Q + E + x] = 0.9;
        height[(Y0 + y) * S + R + Q + E + x] = 0.5;
      }
  }

  /* ---------------- quarry floor (bottom-left, R × R): 4 × 4 red 6" tiles ---------------- */
  {
    const Y0 = R, N = 4, T = R / N;
    const mott = makeFbm(105, 10, 3), tileTone = makeRng(77);
    const tones: number[] = [];
    for (let i = 0; i < N * N; i++) tones.push(0.9 + 0.2 * tileTone());
    for (let y = 0; y < R; y++)
      for (let x = 0; x < R; x++) {
        const u = x / R, v = y / R;
        const tx = Math.floor(x / T), ty = Math.floor(y / T);
        const fx = (x % T) / T, fy = (y % T) / T;
        const grout = 0.035; // 5 mm of 152
        const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
        const inGrout = edge < grout;
        const bevel = smooth01((edge - grout) / 0.03);
        const tone = tones[ty * N + tx] * (0.92 + 0.16 * (mott(u * 2, v * 2) - 0.5)) * (0.95 + 0.1 * (grainN(u, v) - 0.5));
        if (inGrout) {
          const gt = 0.95 + 0.1 * (grainN(u * 3, v * 3) - 0.5);
          px(x, Y0 + y, 0.22 * gt, 0.2 * gt, 0.18 * gt);
          rough[(Y0 + y) * S + x] = 0.95;
          height[(Y0 + y) * S + x] = 0.3;
        } else {
          px(x, Y0 + y, 0.46 * tone, 0.23 * tone, 0.16 * tone);
          rough[(Y0 + y) * S + x] = 0.72 + 0.08 * (mott(u * 3, v * 3) - 0.5);
          height[(Y0 + y) * S + x] = 0.3 + 0.2 * bevel + 0.03 * (mott(u * 4, v * 4) - 0.5);
        }
      }
  }

  /* ---------------- white wall tile (bottom-right, R × R): 4 × 4 glossy 4" tiles ---------------- */
  {
    const X0 = R, Y0 = R, N = 4, T = R / N;
    const tileTone = makeRng(78);
    const tones: number[] = [];
    for (let i = 0; i < N * N; i++) tones.push(0.97 + 0.04 * tileTone());
    for (let y = 0; y < R; y++)
      for (let x = 0; x < R; x++) {
        const u = x / R, v = y / R;
        const tx = Math.floor(x / T), ty = Math.floor(y / T);
        const fx = (x % T) / T, fy = (y % T) / T;
        const grout = 0.025; // 2.5 mm of 102
        const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
        const inGrout = edge < grout;
        const cushion = smooth01((edge - grout) / 0.06); // rounded tile edge
        if (inGrout) {
          const gt = 0.95 + 0.1 * (grainN(u * 3, v * 3) - 0.5);
          px(X0 + x, Y0 + y, 0.62 * gt, 0.61 * gt, 0.58 * gt);
          rough[(Y0 + y) * S + X0 + x] = 0.92;
          height[(Y0 + y) * S + X0 + x] = 0.25;
        } else {
          const tone = tones[ty * N + tx] * (0.99 + 0.02 * (grainN(u * 2, v * 2) - 0.5));
          px(X0 + x, Y0 + y, 0.93 * tone, 0.93 * tone, 0.9 * tone);
          rough[(Y0 + y) * S + X0 + x] = 0.17 + 0.03 * (grainN(u * 5, v * 5) - 0.5);
          height[(Y0 + y) * S + X0 + x] = 0.25 + 0.4 * cushion;
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
