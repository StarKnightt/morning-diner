/**
 * Procedural textures for System 3: the parking lot seen through the glass,
 * window/door glass dust and smudges, and venetian slat dust. Everything is
 * drawn on canvases at build time; no files.
 */
import * as THREE from "three";
import { makeFbm, makeFbm2, makeRng } from "../core/rng";

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

function finish(c: HTMLCanvasElement, srgb: boolean, anisotropy: number, wrap = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface LotLayout {
  /** World x of the canvas' left edge and z of its top row (the kerb line). */
  x0: number;
  z0: number;
  /** Metres covered in x and z. */
  w: number;
  d: number;
  /** Stall line x positions (world) and stall depth from the kerb (m). */
  stallLinesX: number[];
  stallDepth: number;
}

export interface LotTextures {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
}

/**
 * The lot's colour and roughness at ~14 mm/texel: aged asphalt sRGB ≈ (98,96,93)
 * with large-scale tonal drift and a coarse aggregate speckle, alligator-crack
 * patches (Voronoi cells 150–400 mm), long meandering longitudinal cracks — some
 * filled with black sealant (glossy), some with light dust — a utility-cut
 * sealcoat patch, oil drips at the stall heads, and parking lines: an old faded
 * set (30–50 % coverage) under a brighter re-stripe offset 60–90 mm.
 */
export function lotSurface(size: number, layout: LotLayout, seed: number): LotTextures {
  const W = size, H = Math.round((size * layout.d) / layout.w);
  const { c, ctx } = canvas(W, H);
  const { c: rc, ctx: rctx } = canvas(W, H);
  const rng = makeRng(seed);
  const pxPerM = W / layout.w;
  const toPx = (x: number, z: number): [number, number] => [(x - layout.x0) * pxPerM, (z - layout.z0) * pxPerM];

  // ---- base tone + speckle --------------------------------------------------------------
  const drift = makeFbm(seed + 1, 3, 4);
  const traffic = makeFbm(seed + 2, 2, 2);
  const speck = makeFbm(seed + 3, 512, 2);
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const rough = new Float32Array(W * H).fill(0.86);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / W;
      const zM = y / pxPerM; // metres from the kerb
      // Polished/bleached band where tyres run in the drive aisle (5.5–12 m out).
      const aisle = Math.exp(-(((zM - 8.7) / 2.2) ** 2)) * (0.6 + 0.4 * traffic(u * 3, v));
      const n = (drift(u, v) - 0.5) * 0.22 + (speck(u, v) - 0.5) * 0.42 + aisle * 0.1;
      const g = 96 * (1 + n);
      const i = (y * W + x) * 4;
      d[i] = g * 1.02; d[i + 1] = g; d[i + 2] = g * 0.96; d[i + 3] = 255;
      rough[y * W + x] = 0.86 + (speck(u, v) - 0.5) * 0.1 - aisle * 0.08;
    }
  }
  ctx.putImageData(img, 0, 0);

  // ---- sealcoat patch (utility cut) ----------------------------------------------------
  {
    const [px, py] = toPx(layout.x0 + layout.w * 0.62, layout.z0 + 9.5);
    ctx.save();
    ctx.translate(px, py); ctx.rotate(0.06);
    ctx.fillStyle = "rgba(52,52,54,0.92)";
    ctx.fillRect(-1.1 * pxPerM, -0.6 * pxPerM, 2.2 * pxPerM, 1.2 * pxPerM);
    ctx.restore();
    for (let y = Math.max(0, py - 0.65 * pxPerM); y < Math.min(H, py + 0.65 * pxPerM); y++)
      for (let x = Math.max(0, px - 1.15 * pxPerM); x < Math.min(W, px + 1.15 * pxPerM); x++) rough[(y | 0) * W + (x | 0)] = 0.7;
  }

  // ---- alligator cracking: elliptical patches of Voronoi cells --------------------------
  const patches = [
    { x: layout.x0 + layout.w * 0.28, z: layout.z0 + 8.4, rx: 2.4, rz: 1.2, rot: 0.1 },
    { x: layout.x0 + layout.w * 0.55, z: layout.z0 + 9.2, rx: 1.8, rz: 1.0, rot: -0.2 },
    { x: layout.x0 + layout.w * 0.82, z: layout.z0 + 7.6, rx: 2.0, rz: 1.4, rot: 0.3 },
    { x: layout.x0 + layout.w * 0.12, z: layout.z0 + 3.2, rx: 1.4, rz: 1.6, rot: 0.0 },
  ];
  const cell = 0.26 * pxPerM; // ≈ 260 mm cells
  const pts: Array<[number, number]> = [];
  const gridW = Math.ceil(W / cell) + 1, gridH = Math.ceil(H / cell) + 1;
  for (let j = 0; j < gridH; j++)
    for (let i = 0; i < gridW; i++) pts.push([(i + 0.15 + rng() * 0.7) * cell, (j + 0.15 + rng() * 0.7) * cell]);
  const dark = ctx.createImageData(W, H); // alpha overlay for crack lines
  const dd = dark.data;
  for (const p of patches) {
    const [cx, cy] = toPx(p.x, p.z);
    const rx = p.rx * pxPerM, rz = p.rz * pxPerM;
    const R = Math.max(rx, rz) + cell;
    for (let y = Math.max(0, cy - R); y < Math.min(H, cy + R); y++) {
      for (let x = Math.max(0, cx - R); x < Math.min(W, cx + R); x++) {
        const lx = (x - cx) * Math.cos(p.rot) + (y - cy) * Math.sin(p.rot);
        const ly = -(x - cx) * Math.sin(p.rot) + (y - cy) * Math.cos(p.rot);
        const e = Math.hypot(lx / rx, ly / rz);
        if (e > 1) continue;
        const presence = clamp((1 - e) / 0.35, 0, 1) * (0.55 + 0.45 * drift(x / W, y / W));
        const gi = Math.floor(x / cell), gj = Math.floor(y / cell);
        let f1 = 1e9, f2 = 1e9;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = gi + di, jj = gj + dj;
            if (ii < 0 || jj < 0 || ii >= gridW || jj >= gridH) continue;
            const [px, py] = pts[jj * gridW + ii];
            const dist = Math.hypot(px - x, py - y);
            if (dist < f1) { f2 = f1; f1 = dist; } else if (dist < f2) f2 = dist;
          }
        const edge = f2 - f1; // px from the cell boundary
        const inCrack = edge < 0.9 ? 1 - edge / 0.9 : 0;
        if (inCrack <= 0) continue;
        const o = (y * W + x) * 4;
        const a = clamp(presence * inCrack * 0.85, 0, 1);
        dd[o] = 40; dd[o + 1] = 39; dd[o + 2] = 38; dd[o + 3] = Math.max(dd[o + 3], a * 255);
        rough[y * W + x] = 0.9;
      }
    }
  }
  // ---- long meandering cracks: random walks, some sealed (black, glossy), some dusty ------
  const walkCracks: Array<{ pts: Array<[number, number]>; sealed: boolean; width: number }> = [];
  const walk = (x: number, y: number, ang: number, base: number, steps: number, sealed: boolean, width: number, depth: number) => {
    const path: Array<[number, number]> = [[x, y]];
    for (let s = 0; s < steps; s++) {
      ang += (rng() - 0.5) * 0.5;
      ang = base + clamp(ang - base, -0.9, 0.9);
      x += Math.cos(ang) * 0.35 * pxPerM;
      y += Math.sin(ang) * 0.35 * pxPerM;
      if (x < 0 || x >= W || y < 0 || y >= H) break;
      path.push([x, y]);
      // Branches: a thinner crack leaves at 35–70°, itself allowed one more fork
      if (depth < 2 && s > 8 && rng() < 0.035) {
        const side = rng() < 0.5 ? 1 : -1;
        walk(x, y, ang + side * (0.6 + rng() * 0.6), ang + side * 0.8, 12 + Math.floor(rng() * 30), sealed && rng() < 0.6, width * 0.7, depth + 1);
      }
    }
    walkCracks.push({ pts: path, sealed, width });
  };
  for (let k = 0; k < 12; k++) {
    const sealed = rng() < 0.5;
    const along = rng() < 0.6; // longitudinal (with traffic, along z) or transverse
    const x = along ? rng() * W : 0, y = along ? 0 : rng() * H;
    const base = along ? Math.PI / 2 : 0;
    // Sealed cracks carry a 3–4 cm band of black filler; open ones are a dusty hairline
    walk(x, y, base, base, 60 + Math.floor(rng() * 80), sealed, sealed ? (0.03 + rng() * 0.01) * pxPerM : 1.1, 0);
  }
  // Composite the crack overlay through a temp canvas (putImageData would replace alpha).
  {
    const { c: oc, ctx: octx } = canvas(W, H);
    octx.putImageData(dark, 0, 0);
    ctx.drawImage(oc, 0, 0);
  }
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const cr of walkCracks) {
    ctx.beginPath();
    cr.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.lineWidth = cr.width;
    ctx.strokeStyle = cr.sealed ? "rgba(22,22,22,0.95)" : "rgba(150,142,128,0.7)";
    ctx.stroke();
    if (cr.sealed) {
      // Sealant band is glossy; mark roughness along the path.
      const rr = Math.ceil(cr.width / 2);
      for (const [x, y] of cr.pts)
        for (let dy = -rr; dy <= rr; dy++)
          for (let dx = -rr; dx <= rr; dx++) {
            const xx = (x | 0) + dx, yy = (y | 0) + dy;
            if (xx >= 0 && yy >= 0 && xx < W && yy < H && dx * dx + dy * dy <= rr * rr) rough[yy * W + xx] = 0.4;
          }
    }
  }

  // ---- oil drips at the stall heads -------------------------------------------------------
  for (let i = 0; i < layout.stallLinesX.length - 1; i++) {
    if (rng() < 0.45) continue;
    const sx = (layout.stallLinesX[i] + layout.stallLinesX[i + 1]) / 2 + (rng() - 0.5) * 0.5;
    const sz = layout.z0 + 1.2 + rng() * 1.2;
    const [px, py] = toPx(sx, sz);
    const rx = (0.2 + rng() * 0.2) * pxPerM, rz = (0.3 + rng() * 0.25) * pxPerM;
    const g = ctx.createRadialGradient(px, py, 0, px, py, Math.max(rx, rz));
    g.addColorStop(0, "rgba(28,26,24,0.75)");
    g.addColorStop(0.55, "rgba(40,38,36,0.45)");
    g.addColorStop(1, "rgba(60,58,56,0)");
    ctx.save(); ctx.translate(px, py); ctx.scale(rx / Math.max(rx, rz), rz / Math.max(rx, rz)); ctx.translate(-px, -py);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, Math.max(rx, rz), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    for (let y = Math.max(0, py - rz); y < Math.min(H, py + rz); y++)
      for (let x = Math.max(0, px - rx); x < Math.min(W, px + rx); x++) {
        const e = Math.hypot((x - px) / rx, (y - py) / rz);
        if (e < 1) rough[(y | 0) * W + (x | 0)] = Math.min(rough[(y | 0) * W + (x | 0)], 0.55 + e * 0.3);
      }
  }

  // ---- one big oil blotch at a stall head + tyre scuff marks ------------------------------
  {
    const i = Math.floor(layout.stallLinesX.length / 2) - 2; // the stall by the pickup
    const sx = (layout.stallLinesX[i] + layout.stallLinesX[i + 1]) / 2 + 0.15;
    const [px, py] = toPx(sx, layout.z0 + 1.7);
    const rx = 0.32 * pxPerM, rz = 0.5 * pxPerM;
    const g = ctx.createRadialGradient(px, py, 0, px, py, rz);
    g.addColorStop(0, "rgba(18,16,15,0.9)");
    g.addColorStop(0.5, "rgba(30,28,26,0.7)");
    g.addColorStop(0.8, "rgba(48,46,44,0.3)");
    g.addColorStop(1, "rgba(60,58,56,0)");
    ctx.save(); ctx.translate(px, py); ctx.scale(rx / rz, 1); ctx.translate(-px, -py);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rz, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Drip trail toward the aisle
    ctx.strokeStyle = "rgba(24,22,20,0.55)"; ctx.lineWidth = 0.04 * pxPerM;
    ctx.beginPath(); ctx.moveTo(px + rx * 0.2, py + rz * 0.8); ctx.quadraticCurveTo(px + rx * 0.6, py + rz * 1.6, px + rx * 0.3, py + rz * 2.4); ctx.stroke();
    for (let y = Math.max(0, py - rz); y < Math.min(H, py + rz); y++)
      for (let x = Math.max(0, px - rx); x < Math.min(W, px + rx); x++) {
        const e = Math.hypot((x - px) / rx, (y - py) / rz);
        if (e < 1) rough[(y | 0) * W + (x | 0)] = Math.min(rough[(y | 0) * W + (x | 0)], 0.42 + e * 0.35);
      }
  }
  // Tyre scuffs: dark 15–22 cm arcs where cars swing into the stalls and brake at the stops
  ctx.lineCap = "butt";
  for (let k = 0; k < 14; k++) {
    const i = Math.floor(rng() * (layout.stallLinesX.length - 1));
    const sx = (layout.stallLinesX[i] + layout.stallLinesX[i + 1]) / 2 + (rng() - 0.5) * 1.4;
    const sz = layout.z0 + 0.9 + rng() * 4.2;
    const [px, py] = toPx(sx, sz);
    const len = (0.5 + rng() * 1.1) * pxPerM, bend = (rng() - 0.5) * 0.8 * pxPerM;
    ctx.strokeStyle = `rgba(30,29,28,${(0.16 + rng() * 0.16).toFixed(3)})`;
    ctx.lineWidth = (0.15 + rng() * 0.07) * pxPerM;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + bend, py - len * 0.5, px + bend * 0.4, py - len); ctx.stroke();
  }
  ctx.lineCap = "round";

  // ---- parking lines: faded originals + offset re-stripe ------------------------------------
  const lineW = 0.1 * pxPerM;
  const drawLine = (x: number, z0: number, z1: number, color: [number, number, number], coverage: number, wobble: number) => {
    const [px0, py0] = toPx(x, z0);
    const [, py1] = toPx(x, z1);
    const segs = 40;
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs, t1 = (s + 1) / segs;
      // Lines erode most at the aisle end (t → 1) and where wheels cross them.
      const wear = coverage * (1 - 0.55 * t0 ** 2) * (0.75 + 0.5 * rng());
      const a = clamp(wear, 0, 1);
      if (a < 0.06) continue;
      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${a.toFixed(3)})`;
      const wx = (rng() - 0.5) * wobble;
      const y0 = py0 + (py1 - py0) * t0, y1 = py0 + (py1 - py0) * t1;
      ctx.fillRect(px0 - lineW / 2 + wx, y0, lineW, y1 - y0 + 0.5);
    }
    // Erosion: punch small holes back to asphalt
    ctx.fillStyle = "rgba(96,94,91,0.85)";
    for (let k = 0; k < 18 * (1.2 - coverage); k++) {
      const yy = py0 + rng() * (py1 - py0);
      ctx.beginPath(); ctx.arc(px0 + (rng() - 0.5) * lineW, yy, (0.2 + rng() * 0.6) * lineW, 0, Math.PI * 2); ctx.fill();
    }
  };
  const zEnd = layout.z0 + layout.stallDepth;
  for (const lx of layout.stallLinesX) drawLine(lx, layout.z0 + 0.25, zEnd, [190, 184, 170], 0.42, 1.2);
  for (const lx of layout.stallLinesX) drawLine(lx + 0.075 + (rng() - 0.5) * 0.03, layout.z0 + 0.25, zEnd, [222, 219, 208], 0.8, 0.6);
  // Faded stall-end tick marks were re-striped too: an aisle-side stop line across the row.
  {
    const [px0, py] = toPx(layout.stallLinesX[0], zEnd);
    const [px1] = toPx(layout.stallLinesX[layout.stallLinesX.length - 1], zEnd);
    ctx.fillStyle = "rgba(200,194,178,0.28)";
    ctx.fillRect(px0, py - lineW / 2, px1 - px0, lineW);
  }

  // ---- roughness canvas ------------------------------------------------------------------
  const rimg = rctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const v = clamp(rough[i], 0, 1) * 255;
    const o = i * 4;
    rimg.data[o] = v; rimg.data[o + 1] = v; rimg.data[o + 2] = v; rimg.data[o + 3] = 255;
  }
  rctx.putImageData(rimg, 0, 0);
  return { map: finish(c, true, 8, false), roughnessMap: finish(rc, false, 8, false) };
}

/**
 * Tiled asphalt micro-detail (1 texel ≈ 1 mm): exposed aggregate as 2–6 mm domes in
 * a fine sand matrix → normal map + roughness. Tiles every `metres` (0.5 m).
 */
export function asphaltDetail(size: number, seed: number): { normalMap: THREE.Texture; roughnessMap: THREE.Texture } {
  const { c: nc, ctx: nctx } = canvas(size, size);
  const { c: rc, ctx: rctx } = canvas(size, size);
  const rng = makeRng(seed);
  const fine = makeFbm(seed + 1, 128, 3);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) height[y * size + x] = (fine(x / size, y / size) - 0.5) * 0.4;
  // aggregate domes, tiled
  const n = Math.round(size * size * 0.0018);
  for (let k = 0; k < n; k++) {
    const cx = rng() * size, cy = rng() * size, r = 1.2 + rng() * 2.6, h = 0.5 + rng() * 0.8;
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const dx = x - cx, dy = y - cy, dd = dx * dx + dy * dy;
        if (dd > r * r) continue;
        const i = ((y + size) % size) * size + ((x + size) % size);
        height[i] = Math.max(height[i], h * Math.sqrt(1 - dd / (r * r)));
      }
  }
  const Hh = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  const nimg = nctx.createImageData(size, size), rimg = rctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const dx = (Hh(x + 1, y) - Hh(x - 1, y)) * 1.4, dy = (Hh(x, y + 1) - Hh(x, y - 1)) * 1.4;
      const len = Math.hypot(dx, dy, 1);
      nimg.data[o] = ((-dx / len) * 0.5 + 0.5) * 255; nimg.data[o + 1] = ((dy / len) * 0.5 + 0.5) * 255; nimg.data[o + 2] = (1 / len) * 255; nimg.data[o + 3] = 255;
      const r = clamp(0.5 + (0.5 - Hh(x, y)) * 0.12, 0, 1) * 255; // stones a little smoother than the matrix; material scales
      rimg.data[o] = r; rimg.data[o + 1] = r; rimg.data[o + 2] = r; rimg.data[o + 3] = 255;
    }
  nctx.putImageData(nimg, 0, 0); rctx.putImageData(rimg, 0, 0);
  return { normalMap: finish(nc, false, 8), roughnessMap: finish(rc, false, 8) };
}

/**
 * Glass dust/smudge roughness map (material roughness scales it, so values are
 * absolute here): clean 0.02, a 1–3 % dust haze that thickens toward the lower
 * edge and corners, horizontal wipe streaks, and — for the door — palm and finger
 * prints around push-bar height (v ≈ 0.44 of the pane).
 */
export function glassDust(size: number, seed: number, door: boolean): THREE.Texture {
  const { c, ctx } = canvas(size, size);
  const rng = makeRng(seed);
  const haze = makeFbm(seed + 1, 5, 3);
  const wipe = makeFbm2(seed + 2, 4, 48, 2);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = 1 - y / size; // v up
      const lower = Math.exp(-((v / 0.22) ** 2)) * 0.6 + Math.exp(-(((1 - v) / 0.15) ** 2)) * 0.2;
      const corner = Math.exp(-((Math.min(u, 1 - u) / 0.12) ** 2)) * 0.35;
      const h = (haze(u, v) - 0.35) * 0.03 * (0.4 + lower + corner);
      const streak = (wipe(u, v) - 0.5) * 0.01;
      const r = clamp(0.004 + Math.max(0, h) + Math.max(0, streak), 0.003, 0.03);
      const o = (y * size + x) * 4;
      const vv = r * 255;
      img.data[o] = vv; img.data[o + 1] = vv; img.data[o + 2] = vv; img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  if (door) drawPrints(ctx, size, rng, (a) => `rgba(${Math.round(a * 255)},${Math.round(a * 255)},${Math.round(a * 255)},0.85)`, 0.2, 0.1);
  return finish(c, false, 4, false);
}

/**
 * Palm + four finger lobes + thumb, smeared (3.5 px ≈ 3 mm blur), at push-bar height on the
 * pull side of the door pane. `tone(a)` maps the print's strength to a fill style so the
 * same layout drives the roughness map (glassDust) and the haze decal (handprintAlpha).
 */
function drawPrints(ctx: CanvasRenderingContext2D, size: number, rng: () => number, tone: (a: number) => string, base: number, spread: number): void {
  // rev 3: the rev 2 layout (four upright palm prints in a row) read as four evenly spaced
  // ghost bars. Real door glass at push-bar height carries a smeared *arc* — the heel of a
  // palm dragged as the door swings — plus scattered fingertip dabs of unequal pressure and
  // a few short drag streaks. Nothing periodic, nothing upright.
  const P = (u: number, v: number) => [u * size, (1 - v) * size] as const;
  const dab = (u: number, v: number, rx: number, ry: number, rot: number, a: number) => {
    const [px, py] = P(u, v);
    ctx.save(); ctx.translate(px, py); ctx.rotate(rot);
    ctx.fillStyle = tone(a);
    ctx.beginPath(); ctx.ellipse(0, 0, rx * size, ry * size, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  // 1) Palm-heel smear arc on the pull side: centre off to the right, radius ~16 % of the
  //    pane, sweeping ~70°, drawn as many faint jittered arc strokes so the edge is ragged
  //    and the density varies along the sweep (hardest where the hand first landed).
  ctx.filter = "blur(2.5px)";
  ctx.lineCap = "round";
  const cu = 0.66 + rng() * 0.08, cv = 0.36 + rng() * 0.04, R = 0.14 + rng() * 0.04;
  const a0 = -2.4 + rng() * 0.3, a1 = a0 + 1.1 + rng() * 0.3;
  for (let s = 0; s < 22; s++) {
    const t = s / 21;
    const jit = (rng() - 0.5) * 0.02;
    const [cx, cy] = P(cu + jit, cv + (rng() - 0.5) * 0.015);
    ctx.strokeStyle = tone(base * (0.35 + 0.65 * (1 - t) ** 1.5) + rng() * spread * 0.4);
    ctx.lineWidth = size * (0.006 + rng() * 0.012);
    ctx.beginPath();
    ctx.arc(cx, cy, (R + t * 0.035 + (rng() - 0.5) * 0.01) * size, a0 + t * 0.15, a1 - t * 0.2);
    ctx.stroke();
  }
  // 2) Fingertip dabs: 9–13 of them, clustered where fingers land above the bar, random
  //    pressure (alpha), random slight rotation, two or three smeared into short tails.
  const n = 9 + Math.floor(rng() * 5);
  for (let k = 0; k < n; k++) {
    const u = 0.5 + rng() * 0.38, v = 0.4 + rng() * 0.16;
    const a = base * (0.3 + rng() * 1.1);
    dab(u, v, 0.008 + rng() * 0.006, 0.012 + rng() * 0.008, (rng() - 0.5) * 1.2, a);
    if (rng() < 0.3) {
      ctx.strokeStyle = tone(a * 0.5); ctx.lineWidth = size * 0.012;
      const [x0, y0] = P(u, v), dx = (rng() - 0.5) * 0.08 * size, dy = (rng() * 0.05 + 0.01) * size;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + dx, y0 + dy); ctx.stroke();
    }
  }
  // 3) One flat palm dab near the bar (the hand that pushes), lower pressure.
  dab(0.32 + rng() * 0.08, 0.43 + rng() * 0.03, 0.045, 0.036, (rng() - 0.5) * 0.6, base * 0.55);
  // 4) Three long faint drag streaks (a sleeve or a rag) — diagonal, not vertical.
  ctx.filter = "blur(4px)";
  for (let k = 0; k < 3; k++) {
    const [x0, y0] = P(0.25 + rng() * 0.5, 0.3 + rng() * 0.3);
    ctx.strokeStyle = tone(base * 0.25); ctx.lineWidth = size * (0.02 + rng() * 0.02);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + (0.1 + rng() * 0.15) * size, y0 + (rng() - 0.3) * 0.12 * size); ctx.stroke();
  }
  ctx.filter = "none";
}

/**
 * Egg-crate grille for the vehicles (rev 3): a dark recessed field behind a fine bright
 * lattice, `cols × rows` cells. `chrome` picks a bright-metal lattice (sedan) or a
 * painted argent one (pickup). Returned as an sRGB colour map; the geometry is a flat quad.
 */
export function grilleTexture(size: number, cols: number, rows: number, chrome: boolean, seed: number): { map: THREE.Texture; roughnessMap: THREE.Texture } {
  const w = size, h = Math.round((size * rows) / cols);
  const { c, ctx } = canvas(w, h);
  const { c: rc, ctx: rctx } = canvas(w, h);
  const rng = makeRng(seed);
  ctx.fillStyle = "#0a0b0c"; ctx.fillRect(0, 0, w, h); // the shadowed radiator behind
  rctx.fillStyle = "#909090"; rctx.fillRect(0, 0, w, h);
  const cw = w / cols, ch = h / rows, bar = Math.max(2, cw * 0.18);
  const lat = chrome ? "#c9ccd0" : "#8d9096", shade = chrome ? "#6d7278" : "#4e5257";
  for (let r = 0; r <= rows; r++) {
    const y = r * ch;
    ctx.fillStyle = shade; ctx.fillRect(0, y - bar / 2, w, bar);
    ctx.fillStyle = lat; ctx.fillRect(0, y - bar / 2, w, bar * 0.45); // top face catches sky
  }
  for (let cI = 0; cI <= cols; cI++) {
    const x = cI * cw;
    ctx.fillStyle = shade; ctx.fillRect(x - bar / 2, 0, bar, h);
    ctx.fillStyle = lat; ctx.fillRect(x - bar / 2, 0, bar * 0.4, h);
  }
  // Dust in the recesses: a few cells caked paler
  for (let k = 0; k < cols * rows * 0.15; k++) {
    const cx = Math.floor(rng() * cols) * cw, cy = Math.floor(rng() * rows) * ch;
    ctx.fillStyle = `rgba(120,108,90,${(0.15 + rng() * 0.2).toFixed(2)})`;
    ctx.fillRect(cx + bar / 2, cy + bar / 2, cw - bar, ch - bar);
  }
  rctx.fillStyle = chrome ? "#303030" : "#707070";
  for (let r = 0; r <= rows; r++) rctx.fillRect(0, r * ch - bar / 2, w, bar);
  for (let cI = 0; cI <= cols; cI++) rctx.fillRect(cI * cw - bar / 2, 0, bar, h);
  return { map: finish(c, true, 8, false), roughnessMap: finish(rc, false, 8, false) };
}

/**
 * Licence plate (rev 3): a 12 × 6" plate, pale field with a faint sun-faded gradient, dark
 * embossed serial (drawn twice with a 1 px offset to fake the emboss shadow), a small state
 * legend on top and a registration sticker. Any legible text is generic — no real state.
 */
export function plateTexture(size: number, serial: string, dark: boolean, seed: number): THREE.Texture {
  const w = size, h = size / 2;
  const { c, ctx } = canvas(w, h);
  const rng = makeRng(seed);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, dark ? "#1d2a52" : "#ece6d3");
  g.addColorStop(1, dark ? "#26356a" : "#d9d0b6");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = dark ? "#0e1530" : "#b6ab8f"; ctx.lineWidth = w * 0.012;
  ctx.strokeRect(w * 0.015, h * 0.03, w * 0.97, h * 0.94);
  const ink = dark ? "#e8e4d8" : "#233a7a";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.round(h * 0.46)}px sans-serif`;
  ctx.fillStyle = dark ? "#0b1128" : "#7d8aa6"; ctx.fillText(serial, w * 0.5 + w * 0.006, h * 0.56 + h * 0.012);
  ctx.fillStyle = ink; ctx.fillText(serial, w * 0.5, h * 0.56);
  ctx.font = `${Math.round(h * 0.13)}px sans-serif`;
  ctx.fillStyle = dark ? "#f0d9a8" : "#8a2a2a"; ctx.fillText("HIGH DESERT", w * 0.5, h * 0.15);
  ctx.fillStyle = dark ? "#7fb2e0" : "#d9a13a"; ctx.fillRect(w * 0.86, h * 0.78, w * 0.08, h * 0.14); // sticker
  // dust film heavier at the bottom edge and a couple of dings
  const dg = ctx.createLinearGradient(0, h * 0.5, 0, h);
  dg.addColorStop(0, "rgba(150,130,100,0)"); dg.addColorStop(1, "rgba(150,130,100,0.35)");
  ctx.fillStyle = dg; ctx.fillRect(0, 0, w, h);
  for (let k = 0; k < 3; k++) { ctx.fillStyle = "rgba(60,55,50,0.25)"; ctx.beginPath(); ctx.arc(rng() * w, rng() * h, w * 0.01, 0, Math.PI * 2); ctx.fill(); }
  return finish(c, true, 8, false);
}

/**
 * Car-paint roughness + dust film (rev 3). The lofted body is UV-mapped u = along the car,
 * v = around the section from the sill (0) over the roof (0.5) back to the other sill (1).
 * Dust cakes on the lower body (both sills) and settles on the roof/hood (v ≈ 0.5);
 * the doors' upper flanks stay cleanest, keeping the clearcoat sky reflection there.
 */
export function carDust(size: number, seed: number): { roughnessMap: THREE.Texture; map: THREE.Texture } {
  const w = size, h = size / 2;
  const { c, ctx } = canvas(w, h);
  const { c: rc, ctx: rctx } = canvas(w, h);
  const fbm = makeFbm(seed, 6, 3);
  const grit = makeFbm(seed + 3, 90, 2);
  const img = ctx.createImageData(w, h), rimg = rctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const sill = Math.exp(-((Math.min(v, 1 - v) / 0.09) ** 2));
      const top = Math.exp(-(((v - 0.5) / 0.08) ** 2)) * 0.5;
      const n = fbm(u, v);
      const dust = clamp(sill * (0.45 + n * 0.5) + top * (0.3 + n * 0.5) + (grit(u, v) - 0.6) * 0.5, 0, 1);
      const o = (y * w + x) * 4;
      const r = clamp(0.32 + dust * 0.55, 0, 1) * 255;
      rimg.data[o] = r; rimg.data[o + 1] = r; rimg.data[o + 2] = r; rimg.data[o + 3] = 255;
      // colour: white = base tint (multiplied against the paint colour), dust pulls it toward tan
      const k = 1 - dust * 0.28;
      img.data[o] = 255 * (k + dust * 0.22); img.data[o + 1] = 255 * (k + dust * 0.17); img.data[o + 2] = 255 * (k + dust * 0.09); img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0); rctx.putImageData(rimg, 0, 0);
  return { map: finish(c, true, 8, false), roughnessMap: finish(rc, false, 8, false) };
}

/** Alpha for the greasy-haze decal on the door pane: the same prints as glassDust(door), white on black. */
export function handprintAlpha(size: number, seed: number): THREE.Texture {
  const { c, ctx } = canvas(size, size);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  drawPrints(ctx, size, makeRng(seed), (a) => `rgba(255,255,255,${(a * 3).toFixed(3)})`, 0.2, 0.1);
  return finish(c, false, 4, false);
}

/** Slat finish: baked enamel with dust streaks along the slat (u) — roughness + a faint albedo dulling. */
export function slatDust(size: number, seed: number): { roughnessMap: THREE.Texture; map: THREE.Texture } {
  const { c, ctx } = canvas(size, size / 8);
  const { c: rc, ctx: rctx } = canvas(size, size / 8);
  const h = size / 8;
  const streak = makeFbm2(seed, 24, 3, 3);
  const img = ctx.createImageData(size, h), rimg = rctx.createImageData(size, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / h;
      // Sparse dust streaks along the slat, heaviest at the centre of the up-face; the
      // baked enamel itself is a smooth 0.3 so the curved profile carries a crown highlight.
      const dust = clamp((streak(u, v) - 0.55) * 2.4, 0, 1) * (0.3 + 0.7 * Math.sin(Math.PI * v) ** 0.7);
      const o = (y * size + x) * 4;
      const r = clamp(0.3 + dust * 0.3, 0, 1) * 255;
      rimg.data[o] = r; rimg.data[o + 1] = r; rimg.data[o + 2] = r; rimg.data[o + 3] = 255;
      const k = 1 - dust * 0.06;
      img.data[o] = 224 * k; img.data[o + 1] = 216 * k; img.data[o + 2] = 196 * k; img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0); rctx.putImageData(rimg, 0, 0);
  return { map: finish(c, true, 8), roughnessMap: finish(rc, false, 8) };
}

/** Desert dirt: pale tan with fine gravel speckle and faint drainage streaks. */
export function desertDirt(size: number, seed: number): THREE.Texture {
  const { c, ctx } = canvas(size, size);
  const fbm = makeFbm(seed, 6, 4);
  const grain = makeFbm(seed + 1, 160, 2);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n = (fbm(u, v) - 0.5) * 0.18 + (grain(u, v) - 0.5) * 0.16;
      const o = (y * size + x) * 4;
      img.data[o] = 176 * (1 + n); img.data[o + 1] = 158 * (1 + n); img.data[o + 2] = 132 * (1 + n * 1.1); img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return finish(c, true, 8);
}

/** CMU block wall: 400 × 200 mm blocks with recessed mortar joints; tiles every 3.2 × 0.8 m (8 × 4 blocks). */
export function blockWall(size: number, seed: number): { map: THREE.Texture; roughnessMap: THREE.Texture } {
  const w = size, h = size / 4;
  const { c, ctx } = canvas(w, h);
  const { c: rc, ctx: rctx } = canvas(w, h);
  const rng = makeRng(seed);
  const grain = makeFbm(seed + 1, 64, 2);
  const cols = 8, rows = 4;
  const bw = w / cols, bh = h / rows, joint = w / 320;
  ctx.fillStyle = "#8f877a"; ctx.fillRect(0, 0, w, h); // mortar
  rctx.fillStyle = "#e6e6e6"; rctx.fillRect(0, 0, w, h);
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bw / 2 : 0;
    for (let cI = -1; cI <= cols; cI++) {
      const x = cI * bw + off + joint / 2, y = r * bh + joint / 2;
      // Per-block tone: mostly ±6 %, one block in eight noticeably darker or lighter (different pallet)
      const t = (0.94 + rng() * 0.12) * (rng() < 0.12 ? (rng() < 0.5 ? 0.86 : 1.1) : 1);
      ctx.fillStyle = `rgb(${Math.round(171 * t)},${Math.round(160 * t)},${Math.round(142 * t)})`;
      ctx.fillRect(x, y, bw - joint, bh - joint);
      rctx.fillStyle = `rgb(${Math.round(215 * (0.95 + rng() * 0.1))},0,0)`;
      rctx.fillRect(x, y, bw - joint, bh - joint);
    }
  }
  const img = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const n = 1 + (grain(x / w, y / h) - 0.5) * 0.14;
      const o = (y * w + x) * 4;
      img.data[o] *= n; img.data[o + 1] *= n; img.data[o + 2] *= n;
    }
  ctx.putImageData(img, 0, 0);
  const rimg = rctx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) { const o = i * 4; rimg.data[o + 1] = rimg.data[o]; rimg.data[o + 2] = rimg.data[o]; }
  rctx.putImageData(rimg, 0, 0);
  return { map: finish(c, true, 8), roughnessMap: finish(rc, false, 8) };
}

/** Radial falloff alpha for the vehicles' and scrub patches' contact-shadow decals. */
export function contactShadowAlpha(size: number): THREE.Texture {
  const { c, ctx } = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0.72)");
  g.addColorStop(0.55, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
