/**
 * System 9 "implied presence" atlas (rev 3) — one canvas set (map with alpha / roughness /
 * normal) for the prop decals and the kitchen slice behind the swing door. Regions
 * (`PRESENCE_UV`, v up):
 *
 *   scuff       MULTIPLY map for the kitchen door's rubber scuffs, two 0.9 × 0.45 m bands
 *               (dining face / kitchen face): bumper arcs, corner scrapes, crumbs, a palm smear
 *               (rev 1–2's apron cotton lived here; the apron was cut)
 *   canLabel    a #10 food-service can label: cream paper, red band with white word blocks,
 *               green produce block, weight line, fine print, paper seam (kitchen shelf)
 *   wallTile    4 × 4 white 4" ceramic wall tiles, cushion edges, grey grout (kitchen slice)
 *   quarry      4 × 4 red 6" quarry floor tiles, dark grout, mottled (kitchen slice)
 *   lipstick    an upper-lip print (two lobes, cupid's bow, lip lines), pink-red, ALPHA —
 *               pressure fades at the outline; lower contact edge strongest
 *   yolkFilm    a thin dried egg-yolk film, ALPHA, feathered, four tine drag streaks
 *   crumb       toast-crumb colour for the flakes
 *   contactAO   soft dark disc, ALPHA (the cup's contact shadow in the saucer well)
 *   dreg        cold coffee, opaque, gloss 0.08 (the 4 mm left in the cup - hosted by the decal
 *               bucket because `pal.coffee` lives only on the pot and the pour mug)
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
  scuff: [0.0, 0.5, 0.5, 1.0],
  canLabel: [0.5, 0.5, 0.75, 0.75],
  lipstick: [0.5, 0.75, 0.75, 1.0],
  yolkFilm: [0.75, 0.75, 1.0, 1.0],
  label: [0.75, 0.65625, 1.0, 0.75],
  residue: [0.75, 0.59375, 1.0, 0.65625],
  crumb: [0.75, 0.5, 0.84375, 0.59375],
  contactAO: [0.84375, 0.5, 0.9375, 0.59375],
  dreg: [0.9375, 0.5, 1.0, 0.59375],
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
  const S = size, R = S / 2, Q = S / 4;
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
  const grainN = makeFbm(94, 180, 2);

  /* ---------------- scuff transfer (top-left, R × R): a MULTIPLY map for the kitchen door ---------------- */
  // 1 where the paint is clean, the rubber transfer's darkening where it is not; two bands of
  // 0.9 × 0.45 m (1.76 mm/px) — rows 0..R/2 the dining face (busier: carts come through
  // loaded), rows R/2..R the kitchen face. Motifs, each placed once from the seed: bumper arcs
  // (a cart corner swinging in), straight corner scrapes at odd angles, crumb clusters where a
  // bumper hit, a broad faint palm smear. Drawn with the 2D API on a scratch canvas over white.
  {
    const sc = canvas(R, R);
    const c = sc.ctx;
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, R, R);
    c.lineCap = "round";
    const rubber = (a: number) => `rgba(38,36,34,${a.toFixed(3)})`;
    const dolly = (a: number) => `rgba(74,58,44,${a.toFixed(3)})`;
    const arc = (x: number, y: number, r: number, a0: number, a1: number, w: number, col: string) => {
      c.strokeStyle = col;
      c.lineWidth = w;
      c.beginPath();
      c.arc(x, y, r, a0, a1);
      c.stroke();
    };
    const scrape = (x: number, y: number, len: number, ang: number, w: number, col: string) => {
      c.strokeStyle = col;
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      c.stroke();
    };
    const crumbs = (x: number, y: number, n: number, spread: number) => {
      for (let i = 0; i < n; i++) {
        c.fillStyle = rubber(0.2 + 0.35 * rng());
        c.beginPath();
        c.ellipse(x + (rng() - 0.5) * spread, y + (rng() - 0.5) * spread * 0.6, 1 + 2.5 * rng(), 0.8 + 1.5 * rng(), rng() * Math.PI, 0, Math.PI * 2);
        c.fill();
      }
    };
    // Soft strokes: three passes, wide and faint to narrow and darker — rubber transfer has no
    // hard edge at 1.8 mm/px.
    const softArc = (x: number, y: number, r: number, a0: number, a1: number, w: number, a: number, col: (a: number) => string) => {
      arc(x, y, r, a0, a1, w * 2.4, col(a * 0.22));
      arc(x, y, r, a0, a1, w * 1.5, col(a * 0.4));
      arc(x, y, r, a0, a1, w, col(a));
    };
    const softScrape = (x: number, y: number, len: number, ang: number, w: number, a: number, col: (a: number) => string) => {
      scrape(x, y, len, ang, w * 3, col(a * 0.2));
      scrape(x, y, len, ang, w, col(a));
    };
    // A rub: a short thick smear where a bumper slid along the leaf — the commonest mark.
    const rub = (x: number, y: number, len: number, hh: number, ang: number, a: number, col: (a: number) => string) => {
      for (const [k, f] of [[2.0, 0.18], [1.4, 0.35], [1.0, 1.0]] as const) {
        c.fillStyle = col(a * f);
        c.beginPath();
        c.ellipse(x, y, (len / 2) * (0.9 + 0.1 * k), (hh / 2) * k, ang, 0, Math.PI * 2);
        c.fill();
      }
    };
    const band = (y0: number, busy: number) => {
      const yb = (v: number) => y0 + v * (R / 2); // v 0 top .. 1 bottom of the band
      // Rubs: 40–130 mm long, 8–20 mm tall, at the bumper's height, a few higher.
      const nRub = Math.round(busy * (3 + rng() * 2));
      for (let i = 0; i < nRub; i++) {
        const x = R * (0.1 + 0.8 * rng()), y = yb(0.45 + 0.45 * rng());
        rub(x, y, 22 + 50 * rng(), 4.5 + 7 * rng(), (rng() - 0.5) * 0.3, 0.1 + 0.14 * rng(), rng() < 0.25 ? dolly : rubber);
      }
      // Bumper arcs: a cart's corner bumper (r ≈ 40–70 mm) swinging in, transfers on the swing.
      const nArc = Math.round(busy * (2 + rng() * 2));
      for (let i = 0; i < nArc; i++) {
        const x = R * (0.15 + 0.7 * rng()), y = yb(0.5 + 0.4 * rng()), r = 22 + 20 * rng();
        const a0 = Math.PI * (0.9 + 0.3 * rng()), span = 0.5 + 0.9 * rng();
        softArc(x, y, r, a0, a0 + span, 4 + 6 * rng(), 0.12 + 0.16 * rng(), rubber);
      }
      // Corner scrapes: thin lines at 5–25° off horizontal, either way, with a faint halo.
      const nScr = Math.round(busy * (1 + rng() * 3));
      for (let i = 0; i < nScr; i++) {
        const x = R * (0.05 + 0.6 * rng()), y = yb(0.3 + 0.6 * rng());
        const ang = (rng() < 0.5 ? 1 : -1) * (0.09 + 0.35 * rng());
        softScrape(x, y, 50 + 150 * rng(), ang, 1.2 + 1.6 * rng(), 0.12 + 0.2 * rng(), rng() < 0.3 ? dolly : rubber);
      }
      // A crumb cluster at one hit.
      if (rng() < 0.7 * busy) crumbs(R * (0.2 + 0.6 * rng()), yb(0.55 + 0.35 * rng()), 4 + Math.floor(rng() * 5), 22 + 20 * rng());
      // A palm smear high in the band: several faint offset blobs, not a disc.
      if (rng() < 0.8) {
        const x = R * (0.55 + 0.3 * rng()), y = yb(0.12 + 0.15 * rng());
        for (let i = 0; i < 5; i++) {
          c.fillStyle = rubber(0.025 + 0.02 * rng());
          c.beginPath();
          c.ellipse(x + (rng() - 0.5) * 30, y + (rng() - 0.5) * 16, 18 + 22 * rng(), 9 + 9 * rng(), (rng() - 0.5) * 1.2, 0, Math.PI * 2);
          c.fill();
        }
      }
    };
    band(0, 1.0);
    band(R / 2, 0.55);
    const ink = c.getImageData(0, 0, R, R).data;
    for (let y = 0; y < R; y++)
      for (let x = 0; x < R; x++) {
        const o = (y * R + x) * 4;
        px(x, y, ink[o] / 255, ink[o + 1] / 255, ink[o + 2] / 255);
        rough[y * S + x] = 0.9;
        height[y * S + x] = 0.5;
      }
  }

  /* ---------------- #10 can label (Q × Q at x R.., y Q..): u round the can, v up the label ---------------- */
  // A commodity food-service can: cream paper, a red band round the middle carrying the product
  // name as white word blocks, a green produce block with a red disc (the picture), a black
  // net-weight line, fine print at the foot, and a 12 mm paper seam. Drawn per pixel, the type
  // as blocks on a scratch canvas.
  {
    const X0 = R, Y0 = Q, W = Q, H = Q;
    const paperN = makeFbm(96, 12, 3);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const u = x / W, v = 1 - y / H; // v up
        const n = paperN(u * 2, v * 2) - 0.5;
        let r = 0.92 + 0.04 * n, g = 0.88 + 0.04 * n, b = 0.78 + 0.03 * n;
        // Red band 0.36–0.66 with a thin gold rule at each edge.
        if (v > 0.36 && v < 0.66) {
          r = 0.72 + 0.04 * n;
          g = 0.1;
          b = 0.08;
        }
        if (Math.abs(v - 0.36) < 0.006 || Math.abs(v - 0.66) < 0.006) {
          r = 0.82;
          g = 0.66;
          b = 0.28;
        }
        // Produce block on the front (u 0.1–0.42, v 0.68–0.94): green ground, a red disc with a
        // highlight, a stem.
        if (u > 0.1 && u < 0.42 && v > 0.68 && v < 0.94) {
          r = 0.2 + 0.05 * n;
          g = 0.45 + 0.06 * n;
          b = 0.16;
          const d = Math.hypot((u - 0.26) / 0.11, (v - 0.8) / 0.09);
          if (d < 1) {
            const hl = Math.exp(-Math.pow(Math.hypot(u - 0.23, v - 0.84) / 0.03, 2));
            r = 0.8 + 0.2 * hl;
            g = 0.12 + 0.5 * hl;
            b = 0.08 + 0.4 * hl;
          }
          if (Math.abs(u - 0.26) < 0.008 && v > 0.87 && v < 0.93) {
            r = 0.25;
            g = 0.4;
            b = 0.12;
          }
        }
        // Paper seam (overlap) at u = 0.97: a shade line and a step.
        const seam = Math.exp(-Math.pow((u - 0.97) / 0.006, 2));
        r *= 1 - 0.25 * seam;
        g *= 1 - 0.25 * seam;
        b *= 1 - 0.25 * seam;
        px(X0 + x, Y0 + y, r, g, b);
        rough[(Y0 + y) * S + X0 + x] = 0.55 + 0.05 * n;
        height[(Y0 + y) * S + X0 + x] = 0.5 - 0.15 * (u > 0.97 ? 1 : 0);
      }
    // Type as blocks: the name on the band (twice round, front and back), a weight line, fine print.
    const sc = canvas(W, H);
    sc.ctx.clearRect(0, 0, W, H);
    const word = (x0: number, x1: number, y: number, h: number, a: string, gap: number) => {
      sc.ctx.fillStyle = a;
      let x = x0;
      while (x < x1 - 3) {
        const w = Math.min(x1 - x, h * (0.9 + rng() * 1.6));
        sc.ctx.fillRect(x, y, w, h);
        x += w + gap;
      }
    };
    const Y = (v: number) => H * (1 - v);
    word(W * 0.08, W * 0.46, Y(0.6), H * 0.09, "rgb(250,244,230)", 5); // CRUSHED TOMATOES
    word(W * 0.1, W * 0.4, Y(0.47), H * 0.045, "rgb(250,244,230)", 3);
    word(W * 0.56, W * 0.94, Y(0.6), H * 0.09, "rgb(250,244,230)", 5); // repeated on the back
    word(W * 0.58, W * 0.88, Y(0.47), H * 0.045, "rgb(250,244,230)", 3);
    word(W * 0.46, W * 0.9, Y(0.9), H * 0.05, "rgb(40,30,24)", 4); // brand over the band
    word(W * 0.1, W * 0.5, Y(0.3), H * 0.035, "rgb(40,30,24)", 3); // NET WT 6 LB 6 OZ
    for (let i = 0; i < 4; i++) word(W * 0.55, W * 0.92, Y(0.3 - i * 0.055), H * 0.02, "rgb(60,50,44)", 2); // fine print
    sc.ctx.fillStyle = "rgb(40,30,24)";
    sc.ctx.fillRect(W * 0.12, Y(0.2), W * 0.14, H * 0.09); // barcode block
    sc.ctx.fillStyle = "rgb(250,244,230)";
    for (let i = 0; i < 9; i++) sc.ctx.fillRect(W * (0.125 + i * 0.015), Y(0.2), W * 0.004, H * 0.09);
    const ink = sc.ctx.getImageData(0, 0, W, H).data;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        if (ink[o + 3] > 0) px(X0 + x, Y0 + y, ink[o] / 255, ink[o + 1] / 255, ink[o + 2] / 255);
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
          // 17 × 7.5 mm: lobe tops at v ≈ 0.69, contact line at ≈ 0.38.
          const top = 0.5 + 0.19 * e * (1 - 0.36 * Math.exp(-Math.pow(xi / 0.17, 2))) + 0.01 * (lipN(u * 2, v) - 0.5);
          const bot = 0.5 - 0.035 - 0.04 * Math.sqrt(e) - 0.05 * Math.exp(-Math.pow(xi / 0.32, 2));
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
          // Rev 3: the wet inner lip leaves a faint, broken trace above the lobe tops — the part
          // of the print that laps over the rim onto the inside of the cup (v 0.69 … 0.77).
          const over = v - top;
          if (over > 0 && over < 0.1)
            a = Math.max(a, 0.26 * smooth01(over / 0.015) * smooth01((0.085 - over) / 0.035) * clamp01((0.95 - Math.abs(xi)) / 0.12) * Math.pow(lipN(u * 6, v * 2 + 3), 1.4));
        }
        const n = lipN(u * 5 + 1, v * 5);
        // Rev 3: ~15 % toward luminance (a worn lipstick, not a fresh swatch).
        px(X0 + x, Y0 + y, 0.73 + 0.05 * (n - 0.5), 0.19 + 0.05 * (n - 0.5), 0.24 + 0.04 * (n - 0.5), clamp01(a * 0.9));
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

  // Right-top quadrant under the yolk tile (x R+Q.., y Q..R): label 256 × 96, residue 256 × 64,
  // crumb 96 × 96 and contact AO 96 × 96 — the canvas rows match PRESENCE_UV (flipY: UV v = 1 − y/S).
  const LH = 96, RH = 64, CE = 96;
  /* ---------------- label band (Q × LH at x R+Q.., y Q..) ---------------- */
  {
    const X0 = R + Q, Y0 = Q, W = Q, H = LH;
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
    word(lx0, lx1, H * 0.08, H * 0.11, "rgb(60,32,18)", 6); // COFFEE FILTERS
    word(lx0, lx1 - 30, H * 0.24, H * 0.055, "rgb(70,40,22)", 4);
    word(lx0, lx1 - 60, H * 0.33, H * 0.04, "rgb(80,48,28)", 3);
    sc.ctx.fillStyle = "rgb(250,244,230)";
    sc.ctx.fillRect(W * 0.885, H * 0.11, W * 0.09, H * 0.14); // "500"
    sc.ctx.fillRect(W * 0.895, H * 0.3, W * 0.07, H * 0.06); // "CT"
    const ink = sc.ctx.getImageData(0, 0, W, H).data;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        if (ink[o + 3] > 0) px(X0 + x, Y0 + y, ink[o] / 255, ink[o + 1] / 255, ink[o + 2] / 255);
      }
  }

  /* ---------------- residue ring (Q × RH at x R+Q.., y Q+LH..), alpha; u tiles by fold-back ---------------- */
  {
    const X0 = R + Q, Y0 = Q + LH, W = Q, H = RH;
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

  /* ---------------- crumb (CE × CE at x R+Q.., y Q+LH+RH..) and contact AO (CE × CE at x R+Q+CE..) ---------------- */
  {
    const Y0 = Q + LH + RH, E = CE;
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
    // Dreg: cold coffee - a little lighter and browner at the meniscus (thinner film over the
    // pale glaze), a skin of dust dulling the middle. Its tile is the last 64 px of the row
    // (PRESENCE_UV.dreg), NOT another CE: drawn CE wide it ran off the canvas edge and `px`
    // wrapped the overflow into x 0..31 of the next rows — a 30 px coffee-brown bar on the
    // tile to its left (rev 2 saw it as a dark strip up the apron's selvedge).
    const DX = R + Q + 2 * E, DW = S - DX;
    for (let y = 0; y < E; y++)
      for (let x = 0; x < DW; x++) {
        const u = x / DW, v = y / E;
        const d = Math.hypot(u - 0.5, v - 0.5) * 2;
        const rim = clamp01((d - 0.82) / 0.16);
        const skin = 0.5 + 0.5 * crumb(u * 3 + 5, v * 3);
        px(DX + x, Y0 + y, 0.17 + 0.14 * rim, 0.09 + 0.07 * rim, 0.04 + 0.03 * rim, 1);
        rough[(Y0 + y) * S + DX + x] = 0.06 + 0.1 * skin;
        height[(Y0 + y) * S + DX + x] = 0.5;
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
          px(X0 + x, Y0 + y, 0.9 * tone, 0.92 * tone, 0.93 * tone); // a cool white: the glaze must not read cream under 4100 K
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
