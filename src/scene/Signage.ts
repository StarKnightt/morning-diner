/**
 * Exterior signage (feat-signage): the roadside pylon sign at the lot entrance, the
 * channel letters on the parapet and the small enamel panels at the door. Everything is
 * procedural — text is drawn on main-thread canvases at boot (three small canvases plus
 * one 2048 atlas for the letters; well under 100 ms) — and the whole set lives inside the
 * `exterior` group so it takes the lot probe, the lot sun (`SUN_SKIP_SPOT0`) and the
 * `lotCaster` flag exactly like the cars and the light standards (Exterior.ts / Diner.ts).
 *
 * Emissives are in Lighting.ts units (1 unit = 10,000 nits, K = 1e-4): the pylon's backlit
 * acrylic face sits at ≈ 2,000 nits, the reader board at ≈ 1,500, the channel-letter faces at
 * ≈ 1,500, the neon outline at ≈ 6,000 and the arrow bulbs at ≈ 10,000 (tiny, bloom-friendly).
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { makeRng } from "../core/rng";
import { DOOR, ROOM } from "./layout";
import { LOT } from "./Exterior";

/** The name on every sign. Change it here. */
export const DINER_NAME = "STARLITE DINER";
/** Fascia letters: the full name if it fits the parapet width, else the first word. */
const FASCIA_TEXT = DINER_NAME;
const READER_TEXT = "OPEN 24 HRS  \u2022  BREAKFAST ALL DAY";

/** 1 scene unit = 10,000 nits (Lighting.ts K). */
const nits = (n: number) => n * 1e-4;
/** ≈ 4,000 K warm white, in sRGB. */
const WARM_WHITE = new THREE.Color().setRGB(1.0, 0.86, 0.7, THREE.SRGBColorSpace);
const BULB = new THREE.Color().setRGB(1.0, 0.72, 0.42, THREE.SRGBColorSpace);

const CONDENSED = '"Arial Narrow", "Impact", "Franklin Gothic Medium Cond", "Roboto Condensed", sans-serif';
const SCRIPT = '"Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive';
const SANS = '"Arial", "Helvetica", sans-serif';

export interface SignageResult {
  group: THREE.Group;
}

/* ------------------------------------------------------------------------- */
/* canvas helpers                                                              */
/* ------------------------------------------------------------------------- */

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, opts: { srgb?: boolean; repeat?: boolean } = {}): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  else t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/** Fit `text` into `maxW` px at `px` size (shrinks the font if the name is long). */
function fitFont(ctx: CanvasRenderingContext2D, text: string, family: string, px: number, maxW: number, weight = "bold"): number {
  let size = px;
  for (let i = 0; i < 12; i++) {
    ctx.font = `${weight} ${size}px ${family}`;
    const w = ctx.measureText(text).width;
    if (w <= maxW) break;
    size = Math.floor(size * (maxW / w) * 0.98);
  }
  return size;
}

/** Sprinkle enamel chips (grey primer + dark rust rim) along the edges of a panel. */
function chipEdges(ctx: CanvasRenderingContext2D, w: number, h: number, rng: () => number, n: number, maxR: number): void {
  for (let i = 0; i < n; i++) {
    const side = Math.floor(rng() * 4);
    const t = rng();
    const inset = rng() * rng() * 0.08;
    let x = 0, y = 0;
    if (side === 0) { x = t * w; y = inset * h; }
    else if (side === 1) { x = t * w; y = h - inset * h; }
    else if (side === 2) { x = inset * w; y = t * h; }
    else { x = w - inset * w; y = t * h; }
    const r = (0.3 + rng() * 0.7) * maxR;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.5 + rng() * 0.6), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fillStyle = "#5a3a22";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.7, r * 0.5, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fillStyle = rng() < 0.6 ? "#8a8073" : "#6b4a2c";
    ctx.fill();
  }
}

/** Vertical rust streaks from `y0` down, fading; used on the pole (below the cabinet seams) and the panels. */
function rustStreaks(ctx: CanvasRenderingContext2D, w: number, y0: number, len: number, rng: () => number, n: number, alpha = 0.55): void {
  for (let i = 0; i < n; i++) {
    const x = rng() * w;
    const L = len * (0.4 + rng() * 0.6);
    const sw = 2 + rng() * 6;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + L);
    g.addColorStop(0, `rgba(120,60,25,${alpha})`);
    g.addColorStop(0.3, `rgba(150,80,35,${alpha * 0.7})`);
    g.addColorStop(1, "rgba(150,80,35,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - sw / 2, y0, sw, L);
  }
}

/* ------------------------------------------------------------------------- */
/* textures                                                                    */
/* ------------------------------------------------------------------------- */

/** Pylon cabinet face: translucent white acrylic with red channel-letter name. 2048 × 1280. */
function cabinetFace(rng: () => number): THREE.CanvasTexture {
  return canvasTexture(2048, 1280, (ctx, w, h) => {
    // Acrylic: slightly yellowed white with a faint mottle (uneven lamp spacing behind it).
    ctx.fillStyle = "#f4efe3";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {
      const g = ctx.createRadialGradient(w * (0.1 + i * 0.16), h * 0.5, 0, w * (0.1 + i * 0.16), h * 0.5, h * 0.75);
      g.addColorStop(0, "rgba(255,252,242,0.35)");
      g.addColorStop(1, "rgba(255,252,242,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    // Grime at the bottom retainer; dust wash at the top edge.
    let g = ctx.createLinearGradient(0, h * 0.86, 0, h);
    g.addColorStop(0, "rgba(90,80,60,0)");
    g.addColorStop(1, "rgba(90,80,60,0.35)");
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.86, w, h * 0.14);
    g = ctx.createLinearGradient(0, 0, 0, h * 0.08);
    g.addColorStop(0, "rgba(140,125,95,0.4)");
    g.addColorStop(1, "rgba(140,125,95,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h * 0.08);
    // The name: two lines if it has a space, condensed bold, red with a darker return shadow.
    const words = DINER_NAME.split(" ");
    const lines = words.length > 1 ? [words[0], words.slice(1).join(" ")] : [DINER_NAME];
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lineH = lines.length === 1 ? h * 0.6 : h * 0.4;
    lines.forEach((line, i) => {
      const cy = lines.length === 1 ? h * 0.5 : h * (0.3 + i * 0.4);
      const size = fitFont(ctx, line, CONDENSED, lineH * 1.05, w * 0.88);
      ctx.font = `bold ${size}px ${CONDENSED}`;
      // Letter shadow (the channel's depth seen through the face)
      ctx.fillStyle = "rgba(90,10,10,0.35)";
      ctx.fillText(line, w / 2 + size * 0.02, cy + size * 0.03);
      ctx.fillStyle = "#c8161d";
      ctx.fillText(line, w / 2, cy);
      // Sun-faded top of every letter: a lighter red band across the upper third
      ctx.save();
      ctx.globalCompositeOperation = "source-atop";
      const fg = ctx.createLinearGradient(0, cy - size * 0.4, 0, cy + size * 0.1);
      fg.addColorStop(0, "rgba(255,120,110,0.22)");
      fg.addColorStop(1, "rgba(255,120,110,0)");
      ctx.fillStyle = fg;
      ctx.fillRect(0, cy - size * 0.5, w, size);
      ctx.restore();
    });
    // A few dark specks (dead flies, dirt) inside the acrylic
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(40,30,20,${0.3 + rng() * 0.5})`;
      ctx.beginPath();
      ctx.arc(rng() * w, h * (0.9 + rng() * 0.09), 2 + rng() * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Reader board: white translucent panel with black plastic snap letters, uneven spacing, one tilted. 2048 × 512. */
function readerBoard(rng: () => number): THREE.CanvasTexture {
  return canvasTexture(2048, 512, (ctx, w, h) => {
    ctx.fillStyle = "#ece7da";
    ctx.fillRect(0, 0, w, h);
    // Track lines the letters clip into
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = 3;
    for (const y of [h * 0.24, h * 0.76]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    const size = 220;
    ctx.font = `bold ${size}px ${SANS}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    // Measure with base tracking, then centre
    const chars = Array.from(READER_TEXT);
    const gaps = chars.map(() => 6 + (rng() - 0.5) * 14); // uneven snap spacing
    let total = 0;
    const widths = chars.map((c, i) => { const cw = ctx.measureText(c).width; total += cw + gaps[i]; return cw; });
    let x = (w - total) / 2;
    const tilted = 7 + Math.floor(rng() * (chars.length - 12));
    chars.forEach((c, i) => {
      const cw = widths[i];
      ctx.save();
      ctx.translate(x + cw / 2, h / 2 + (rng() - 0.5) * 6);
      if (i === tilted && c !== " ") ctx.rotate(-0.12);
      // plastic letters: near-black with a faint highlight on the top edge
      ctx.fillStyle = "#1c1a18";
      ctx.fillText(c, -cw / 2, 0);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillText(c, -cw / 2, -3);
      ctx.fillStyle = "#1c1a18";
      ctx.fillText(c, -cw / 2, 1);
      ctx.restore();
      x += cw + gaps[i];
    });
    // Water stain band at the bottom
    const g = ctx.createLinearGradient(0, h * 0.82, 0, h);
    g.addColorStop(0, "rgba(120,100,70,0)");
    g.addColorStop(1, "rgba(120,100,70,0.3)");
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.82, w, h * 0.18);
  });
}

/** Pole: galvanised steel with rust streaks running down from the cabinet seams (top of the map). 256 × 1024. */
function poleSkin(rng: () => number): THREE.CanvasTexture {
  return canvasTexture(256, 1024, (ctx, w, h) => {
    ctx.fillStyle = "#8e9194";
    ctx.fillRect(0, 0, w, h);
    // galv spangle
    for (let i = 0; i < 1500; i++) {
      ctx.fillStyle = `rgba(${rng() < 0.5 ? "255,255,255" : "40,45,50"},${0.04 + rng() * 0.08})`;
      ctx.fillRect(rng() * w, rng() * h, 3 + rng() * 10, 3 + rng() * 10);
    }
    // rust from the cabinet saddle at the top; a weep band at the very top
    ctx.fillStyle = "rgba(120,60,25,0.6)";
    ctx.fillRect(0, 0, w, 14);
    rustStreaks(ctx, w, 0, h * 0.45, rng, 26, 0.6);
    // splash rust at the base (bottom of the map)
    const g = ctx.createLinearGradient(0, h * 0.9, 0, h);
    g.addColorStop(0, "rgba(110,60,30,0)");
    g.addColorStop(1, "rgba(110,60,30,0.5)");
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.9, w, h * 0.1);
  }, { repeat: true });
}

/** Painted sheet-metal star: red enamel with chipped edges and a dust/rust wash. 512². */
function starSkin(rng: () => number): THREE.CanvasTexture {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = "#c21d22";
    ctx.fillRect(0, 0, w, h);
    // faded top, dusty
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(255,150,130,0.25)");
    g.addColorStop(0.5, "rgba(255,150,130,0)");
    g.addColorStop(1, "rgba(60,20,10,0.25)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // chips: weighted to the outer radius (the tips and edges of the star)
    for (let i = 0; i < 90; i++) {
      const a = rng() * Math.PI * 2, r = (0.55 + rng() * 0.45) * w * 0.5;
      const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r;
      const cr = 3 + rng() * 9;
      ctx.beginPath(); ctx.ellipse(x, y, cr, cr * 0.6, a, 0, Math.PI * 2);
      ctx.fillStyle = "#6b4a2c"; ctx.fill();
      ctx.beginPath(); ctx.ellipse(x, y, cr * 0.65, cr * 0.4, a, 0, Math.PI * 2);
      ctx.fillStyle = rng() < 0.5 ? "#9a948a" : "#7a4a28"; ctx.fill();
    }
  });
}

/** Channel letters atlas, 2048 × 256 → 8:1. Three layers: returns (white), faces (red), neon stroke. */
function letterAtlases(): { returns: THREE.CanvasTexture; face: THREE.CanvasTexture; neon: THREE.CanvasTexture; textW: number } {
  let textFrac = 0.9;
  const draw = (mode: "returns" | "face" | "neon") => canvasTexture(2048, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    // cap height 0.5 m of a 0.7 m canvas → 183 px; bold condensed cap height ≈ 0.72 em
    const size = fitFont(ctx, FASCIA_TEXT, CONDENSED, 254, w * 0.96, "900");
    ctx.font = `900 ${size}px ${CONDENSED}`;
    textFrac = Math.min(0.98, ctx.measureText(FASCIA_TEXT).width / w + 0.02);
    const baseline = h * 0.5 + size * 0.36;
    if (mode === "neon") {
      ctx.lineJoin = "round";
      ctx.lineWidth = 9;
      ctx.strokeStyle = "#ff6a6a";
      ctx.strokeText(FASCIA_TEXT, w / 2, baseline);
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#ffd7d0";
      ctx.strokeText(FASCIA_TEXT, w / 2, baseline);
    } else {
      ctx.fillStyle = mode === "face" ? "#c8161d" : "#ece8df";
      ctx.fillText(FASCIA_TEXT, w / 2, baseline);
      if (mode === "returns") {
        // dust and rust runs on the returns (they are read at grazing angles)
        ctx.save();
        ctx.globalCompositeOperation = "source-atop";
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "rgba(130,110,80,0.35)");
        g.addColorStop(0.4, "rgba(130,110,80,0)");
        g.addColorStop(1, "rgba(90,55,30,0.4)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    }
  });
  const returns = draw("returns");
  const face = draw("face");
  const neon = draw("neon");
  return { returns, face, neon, textW: textFrac };
}

/** "AIR CONDITIONED" enamel: white ground, blue script, blue border, chips. 1024 × 384. */
function airConditioned(rng: () => number): THREE.CanvasTexture {
  return canvasTexture(1024, 384, (ctx, w, h) => {
    ctx.fillStyle = "#eef0ec";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#1c3f8a";
    ctx.lineWidth = 14;
    ctx.strokeRect(18, 18, w - 36, h - 36);
    ctx.fillStyle = "#1c3f8a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const size = fitFont(ctx, "Air Conditioned", SCRIPT, 200, w * 0.8, "normal");
    ctx.font = `normal ${size}px ${SCRIPT}`;
    ctx.fillText("Air Conditioned", w / 2, h * 0.5);
    ctx.font = `bold 34px ${SANS}`;
    ctx.fillText("FOR YOUR COMFORT", w / 2, h * 0.84);
    chipEdges(ctx, w, h, rng, 14, 12);
    rustStreaks(ctx, w, 30, h * 0.4, rng, 5, 0.25);
  });
}

/** Welcome panel: cream enamel, red border, WELCOME + script. 512 × 640. */
function welcomePanel(rng: () => number): THREE.CanvasTexture {
  return canvasTexture(512, 640, (ctx, w, h) => {
    ctx.fillStyle = "#f1e9d6";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#b8202a";
    ctx.lineWidth = 10;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.lineWidth = 3;
    ctx.strokeRect(30, 30, w - 60, h - 60);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#b8202a";
    const s1 = fitFont(ctx, "WELCOME", CONDENSED, 120, w * 0.8);
    ctx.font = `bold ${s1}px ${CONDENSED}`;
    ctx.fillText("WELCOME", w / 2, h * 0.27);
    ctx.fillStyle = "#2a2a2a";
    ctx.font = `bold 28px ${SANS}`;
    ctx.fillText("\u2014  TO THE  \u2014", w / 2, h * 0.42);
    const s2 = fitFont(ctx, DINER_NAME, CONDENSED, 60, w * 0.8);
    ctx.font = `bold ${s2}px ${CONDENSED}`;
    ctx.fillText(DINER_NAME, w / 2, h * 0.52);
    ctx.fillStyle = "#1c3f8a";
    const s3 = fitFont(ctx, "Please Seat Yourself", SCRIPT, 66, w * 0.82, "normal");
    ctx.font = `normal ${s3}px ${SCRIPT}`;
    ctx.fillText("Please Seat Yourself", w / 2, h * 0.72);
    ctx.fillStyle = "#2a2a2a";
    ctx.font = `bold 22px ${SANS}`;
    ctx.fillText("THANK YOU  \u2022  COME AGAIN", w / 2, h * 0.87);
    chipEdges(ctx, w, h, rng, 12, 9);
    // screw-hole rust bleed at the corners
    for (const [cx, cy] of [[34, 34], [w - 34, 34], [34, h - 34], [w - 34, h - 34]]) {
      const g = ctx.createRadialGradient(cx, cy, 4, cx, cy + 20, 40);
      g.addColorStop(0, "rgba(120,60,25,0.55)");
      g.addColorStop(1, "rgba(120,60,25,0)");
      ctx.fillStyle = g;
      ctx.fillRect(cx - 40, cy - 40, 80, 100);
    }
  });
}

/* ------------------------------------------------------------------------- */
/* geometry                                                                    */
/* ------------------------------------------------------------------------- */

function starShape(rOuter: number, rInner: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? rOuter : rInner;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

/** A plane with the ±z faces textured, as two single-sided planes (front +z, back −z). */
function twoSided(b: MergedBuilder, mat: THREE.Material, w: number, h: number, cx: number, cy: number, z0: number, z1: number, m?: THREE.Matrix4): void {
  const f = new THREE.PlaneGeometry(w, h);
  f.translate(cx, cy, z1);
  if (m) f.applyMatrix4(m);
  b.add(f, mat);
  const k = new THREE.PlaneGeometry(w, h);
  k.rotateY(Math.PI);
  k.translate(cx, cy, z0);
  if (m) k.applyMatrix4(m);
  b.add(k, mat);
}

export function buildSignage(diner: THREE.Group, pal: Palette): SignageResult {
  const exterior = (diner.getObjectByName("exterior") as THREE.Group | undefined) ?? diner;
  const group = new THREE.Group();
  group.name = "signage";
  exterior.add(group);
  const rng = makeRng(7701);
  const b = new MergedBuilder();
  const T = ROOM.wallThickness;
  const zFace = ROOM.zFront + T; // exterior stucco face
  const yLot = LOT.y;
  // Bulb positions gathered while the pylon is built (world space after the pylon's matrix).
  const arrowBulbs: THREE.Vector3[] = [];
  let bulbTips: THREE.Vector3[] = [];

  /* ---------------- shared materials ---------------- */
  // Cabinet / raceway / brackets: baked-enamel sheet steel, a dark maroon that has chalked.
  const cabinetPaint = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.36, 0.09, 0.1, THREE.SRGBColorSpace), roughness: 0.55, metalness: 0.15 });
  cabinetPaint.name = "signCabinet";
  const trimCream = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.86, 0.82, 0.72, THREE.SRGBColorSpace), roughness: 0.5, metalness: 0.1 });
  trimCream.name = "signTrim";
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x3a3c3e, roughness: 0.6, metalness: 0.8 });
  steelDark.name = "signSteel";
  const dust = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.62, 0.56, 0.46, THREE.SRGBColorSpace), roughness: 1, metalness: 0 });
  dust.name = "signDust";
  dust.userData.noCast = true;
  const enamelEdge = new THREE.MeshStandardMaterial({ color: 0xdedbd2, roughness: 0.35, metalness: 0.1 });
  enamelEdge.name = "enamelEdge";

  /* ======================================================================= */
  /* 1. roadside pylon at the lot entrance                                    */
  /* ======================================================================= */
  {
    // Beside the CMU wall's entrance gap (x −6…1 at LOT.wallZ), on the +x side, set back
    // 1.6 m from the wall line so the arrow points into the lot. Faces turned 32° off the
    // building line: read obliquely from the road (drivers along x) AND from the facade.
    const sx = 2.9, sz = LOT.wallZ - 1.9, yaw = -0.56;
    const M = new THREE.Matrix4().makeRotationY(yaw).setPosition(sx, 0, sz);
    const local = new MergedBuilder();

    // Concrete footing: 0.9 × 0.9 × 0.4 with a 20 mm chamfer, top sloped by the chamfer only.
    local.rbox(pal.concrete, [-0.45, yLot - 0.05, -0.45], [0.45, yLot + 0.4, 0.45], 0.02, 3);
    // Pole: Ø 0.32 tapering to 0.28, 4.6 m from the footing to the cabinet saddle.
    const poleTex = poleSkin(rng);
    const poleMat = new THREE.MeshStandardMaterial({ map: poleTex, roughness: 0.5, metalness: 0.75 });
    poleMat.name = "signPole";
    const poleY0 = yLot + 0.4, poleY1 = yLot + 4.6;
    {
      const g = new THREE.CylinderGeometry(0.14, 0.16, poleY1 - poleY0, 20, 1, false);
      g.translate(0, (poleY0 + poleY1) / 2, 0);
      local.add(g, poleMat);
      // base flange + saddle plate
      const fl = new THREE.CylinderGeometry(0.2, 0.24, 0.05, 20);
      fl.translate(0, poleY0 + 0.025, 0);
      local.add(fl, steelDark);
    }
    // Cabinet: 2.4 × 1.5 × 0.36, sitting on a 0.3 m saddle above the pole.
    const cw = 2.4, ch = 1.5, cd = 0.36;
    const cy0 = poleY1 + 0.3, cy1 = cy0 + ch;
    local.box(steelDark, [-0.22, poleY1 - 0.02, -0.12], [0.22, cy0 + 0.01, 0.12]); // saddle
    // Frame: four rails around the face aperture, on both faces, plus top / bottom / ends.
    const lip = 0.09;
    local.rbox(cabinetPaint, [-cw / 2, cy0, -cd / 2], [cw / 2, cy0 + lip, cd / 2], 0.01, 2); // bottom rail
    local.rbox(cabinetPaint, [-cw / 2, cy1 - lip, -cd / 2], [cw / 2, cy1, cd / 2], 0.01, 2); // top rail
    local.rbox(cabinetPaint, [-cw / 2, cy0, -cd / 2], [-cw / 2 + lip, cy1, cd / 2], 0.01, 2); // ends
    local.rbox(cabinetPaint, [cw / 2 - lip, cy0, -cd / 2], [cw / 2, cy1, cd / 2], 0.01, 2);
    // Inner box (the lamp housing behind the faces, seen as the dark reveal behind the retainers)
    local.box(steelDark, [-cw / 2 + 0.02, cy0 + 0.02, -cd / 2 + 0.05], [cw / 2 - 0.02, cy1 - 0.02, cd / 2 - 0.05]);
    // Retainer trim: cream 25 mm angle around the acrylic on both faces
    for (const s of [-1, 1]) {
      const z0 = s > 0 ? cd / 2 - 0.02 : -cd / 2 - 0.004, z1 = s > 0 ? cd / 2 + 0.004 : -cd / 2 + 0.02;
      local.rbox(trimCream, [-cw / 2 + lip, cy0 + lip, z0], [cw / 2 - lip, cy0 + lip + 0.025, z1], 0.003, 1);
      local.rbox(trimCream, [-cw / 2 + lip, cy1 - lip - 0.025, z0], [cw / 2 - lip, cy1 - lip, z1], 0.003, 1);
      local.rbox(trimCream, [-cw / 2 + lip, cy0 + lip, z0], [-cw / 2 + lip + 0.025, cy1 - lip, z1], 0.003, 1);
      local.rbox(trimCream, [cw / 2 - lip - 0.025, cy0 + lip, z0], [cw / 2 - lip, cy1 - lip, z1], 0.003, 1);
    }
    // Dust on the top rail: a 4 mm skin, sand-coloured, drawn only on the top.
    local.box(dust, [-cw / 2 + 0.01, cy1, -cd / 2 + 0.01], [cw / 2 - 0.01, cy1 + 0.004, cd / 2 - 0.01]);
    // The lit acrylic faces (both sides): 2,000 nits warm white through the map.
    const faceTex = cabinetFace(rng);
    const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, emissiveMap: faceTex, emissive: WARM_WHITE.clone(), emissiveIntensity: nits(2000), roughness: 0.35, metalness: 0 });
    faceMat.name = "signFace";
    faceMat.userData.noCast = true;
    twoSided(local, faceMat, cw - 2 * lip - 0.05, ch - 2 * lip - 0.05, 0, (cy0 + cy1) / 2, -cd / 2 + 0.03, cd / 2 - 0.03);

    // Reader board below: 2.0 × 0.55 × 0.3 on two straps from the cabinet's bottom rail.
    const rw = 2.0, rh = 0.55, rd = 0.3;
    const ry1 = cy0 - 0.14, ry0 = ry1 - rh;
    for (const x of [-0.7, 0.7]) local.box(steelDark, [x - 0.03, ry1 - 0.02, -0.02], [x + 0.03, cy0 + 0.02, 0.02]);
    local.rbox(cabinetPaint, [-rw / 2, ry0, -rd / 2], [rw / 2, ry0 + 0.06, rd / 2], 0.008, 2);
    local.rbox(cabinetPaint, [-rw / 2, ry1 - 0.06, -rd / 2], [rw / 2, ry1, rd / 2], 0.008, 2);
    local.rbox(cabinetPaint, [-rw / 2, ry0, -rd / 2], [-rw / 2 + 0.06, ry1, rd / 2], 0.008, 2);
    local.rbox(cabinetPaint, [rw / 2 - 0.06, ry0, -rd / 2], [rw / 2, ry1, rd / 2], 0.008, 2);
    local.box(steelDark, [-rw / 2 + 0.02, ry0 + 0.02, -rd / 2 + 0.05], [rw / 2 - 0.02, ry1 - 0.02, rd / 2 - 0.05]);
    const readerTex = readerBoard(rng);
    const readerMat = new THREE.MeshStandardMaterial({ map: readerTex, emissiveMap: readerTex, emissive: WARM_WHITE.clone(), emissiveIntensity: nits(1500), roughness: 0.4, metalness: 0 });
    readerMat.name = "readerFace";
    readerMat.userData.noCast = true;
    twoSided(local, readerMat, rw - 0.16, rh - 0.16, 0, (ry0 + ry1) / 2, -rd / 2 + 0.03, rd / 2 - 0.03);

    // Star on top: 5-point sheet-metal star, 0.6 m across, 60 mm deep, on a stub.
    {
      const starMat = new THREE.MeshStandardMaterial({ map: starSkin(rng), roughness: 0.55, metalness: 0.2 });
      starMat.name = "signStar";
      starMat.map!.repeat.set(1 / 1.3, 1 / 1.3);
      starMat.map!.offset.set(0.5, 0.5);
      starMat.map!.wrapS = starMat.map!.wrapT = THREE.RepeatWrapping;
      const g = new THREE.ExtrudeGeometry(starShape(0.62, 0.26), { depth: 0.06, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: 1 });
      g.computeVertexNormals();
      g.translate(0, cy1 + 0.72, -0.03);
      g.rotateY(0.0);
      local.add(g, starMat);
      const stub = new THREE.CylinderGeometry(0.03, 0.03, 0.2, 10);
      stub.translate(0, cy1 + 0.1, 0);
      local.add(stub, steelDark);
      // small bulbs at the five tips (two dead)
      const tips: THREE.Vector3[] = [];
      for (let i = 0; i < 5; i++) {
        const a = Math.PI / 2 + (i * 2 * Math.PI) / 5;
        tips.push(new THREE.Vector3(Math.cos(a) * 0.55, cy1 + 0.72 + Math.sin(a) * 0.55, 0.045));
      }
      bulbTips = tips;
    }

    // Arrow strip in the sign's plane: from under the cabinet's +x end, sloping 26° down
    // toward local −x — which, with the pylon's yaw, points at the entrance gap and the lot.
    {
      const L = 1.7, ah = 0.2, ad = 0.1;
      const arrow = new THREE.Matrix4().makeRotationZ(0.45).setPosition(cw / 2 - 0.25, cy0 - 0.03, 0);
      // strip body (cream), red chevron head
      const body = new THREE.BoxGeometry(L, ah, ad);
      body.translate(-L / 2, -ah / 2, 0);
      body.applyMatrix4(arrow);
      local.add(body, trimCream);
      const head = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-L + 0.02, -ah - 0.1), new THREE.Vector2(-L - 0.32, -ah / 2), new THREE.Vector2(-L + 0.02, 0.1)]), { depth: ad, bevelEnabled: false });
      head.translate(0, 0, -ad / 2);
      head.applyMatrix4(arrow);
      local.add(head, cabinetPaint);
      // bulb sockets: 9 per face, both faces, in the arrow's local frame
      const socket = new THREE.CylinderGeometry(0.02, 0.022, 0.012, 8);
      for (let i = 0; i < 9; i++) {
        const x = -0.12 - i * ((L - 0.24) / 8);
        for (const s of [-1, 1]) {
          const sg = socket.clone();
          sg.rotateX(Math.PI / 2);
          sg.translate(x, -ah / 2, s * (ad / 2 + 0.004));
          sg.applyMatrix4(arrow);
          local.add(sg, steelDark);
          arrowBulbs.push(new THREE.Vector3(x, -ah / 2, s * (ad / 2 + 0.028)).applyMatrix4(arrow));
        }
      }
    }

    // Merge the pylon into the signage builder in world space.
    const meshes = local.build(new THREE.Group());
    for (const m of meshes) {
      m.geometry.applyMatrix4(M);
      b.add(m.geometry, m.material as THREE.Material);
    }
    for (const p of arrowBulbs) p.applyMatrix4(M);
    for (const p of bulbTips) p.applyMatrix4(M);

    // Bulbs: one InstancedMesh of lit spheres (≈ 10,000 nits) + a second for the dead ones.
    const all = [...arrowBulbs, ...bulbTips];
    const dead = new Set<number>([3, 11, all.length - 2]);
    const lit = all.filter((_, i) => !dead.has(i)), off = all.filter((_, i) => dead.has(i));
    const bulbGeo = new THREE.SphereGeometry(0.024, 10, 8);
    const bulbLit = new THREE.MeshStandardMaterial({ color: 0xfff1dc, emissive: BULB.clone(), emissiveIntensity: nits(10000), roughness: 0.3, metalness: 0 });
    bulbLit.name = "bulbLit";
    const bulbDead = new THREE.MeshStandardMaterial({ color: 0x9a9690, roughness: 0.25, metalness: 0 });
    bulbDead.name = "bulbDead";
    const place = (pts: THREE.Vector3[], mat: THREE.Material, name: string) => {
      if (!pts.length) return;
      const im = new THREE.InstancedMesh(bulbGeo, mat, pts.length);
      const mm = new THREE.Matrix4();
      pts.forEach((p, i) => { mm.makeTranslation(p.x, p.y, p.z); im.setMatrixAt(i, mm); });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = false;
      im.receiveShadow = true;
      im.name = name;
      group.add(im);
    };
    place(lit, bulbLit, "sign-bulbs");
    place(off, bulbDead, "sign-bulbs-dead");
  }

  /* ======================================================================= */
  /* 2. channel letters on the parapet + AIR CONDITIONED enamel over the door */
  /* ======================================================================= */
  {
    const H = ROOM.height;
    const zPar = zFace + 0.25; // parapet face (Shell.ts roof slab)
    const atlas = letterAtlases();
    const atlasW = 5.6, atlasH = 0.7; // 8:1 canvas → metres at 0.5 m cap height
    const textW = atlasW * atlas.textW;
    const cx = 0.6; // slightly toward the door end; the whole width reads from the lot
    // Raceway: 150 × 150 painted steel channel on the parapet, as long as the text.
    const rw = textW + 0.5;
    b.rbox(cabinetPaint, [cx - rw / 2, H + 0.02, zPar], [cx + rw / 2, H + 0.17, zPar + 0.15], 0.006, 2);
    // Returns: 11 slices over 120 mm, alpha-tested white letters (they read as extruded sides
    // from every lot angle, and cast the letters' shadows on the stucco).
    const retMat = new THREE.MeshStandardMaterial({ map: atlas.returns, alphaTest: 0.5, roughness: 0.5, metalness: 0.1 });
    retMat.name = "letterReturns";
    const y0 = H + 0.17 + 0.02; // letters sit on the raceway; atlas baseline puts the caps in the lower 0.5 m
    const zBack = zPar + 0.15;
    const depth = 0.12, slices = 11;
    for (let i = 0; i <= slices; i++) {
      const g = new THREE.PlaneGeometry(atlasW, atlasH);
      g.translate(cx, y0 + atlasH * 0.5 - 0.1, zBack + (depth * i) / slices);
      b.add(g, retMat);
    }
    // Face: red acrylic, lit from inside (≈ 1,500 nits), 3 mm proud of the last slice.
    const faceMat = new THREE.MeshStandardMaterial({ map: atlas.face, emissiveMap: atlas.face, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: nits(1500), alphaTest: 0.5, roughness: 0.3, metalness: 0 });
    faceMat.name = "letterFace";
    faceMat.userData.noCast = true;
    {
      const g = new THREE.PlaneGeometry(atlasW, atlasH);
      g.translate(cx, y0 + atlasH * 0.5 - 0.1, zBack + depth + 0.003);
      b.add(g, faceMat);
    }
    // Neon outline: an emissive stroke 8 mm proud of the face (≈ 6,000 nits: blooms).
    const neonMat = new THREE.MeshStandardMaterial({ map: atlas.neon, emissiveMap: atlas.neon, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: nits(6000), alphaTest: 0.4, roughness: 0.2, metalness: 0 });
    neonMat.name = "letterNeon";
    neonMat.userData.noCast = true;
    {
      const g = new THREE.PlaneGeometry(atlasW, atlasH);
      g.translate(cx, y0 + atlasH * 0.5 - 0.1, zBack + depth + 0.011);
      b.add(g, neonMat);
    }
    // Conduit drops from the raceway to the roof (two, at the ends)
    for (const x of [cx - rw / 2 + 0.2, cx + rw / 2 - 0.2]) {
      const g = new THREE.CylinderGeometry(0.012, 0.012, 0.35, 8);
      g.translate(x, H + 0.35 - 0.16, zPar - 0.02);
      b.add(g, steelDark);
    }

    // AIR CONDITIONED: enamel panel hanging on two short chains from a wall bracket over the door.
    const acTex = airConditioned(rng);
    const acMat = new THREE.MeshStandardMaterial({ map: acTex, roughness: 0.3, metalness: 0.05 });
    acMat.name = "enamelAC";
    const dx = DOOR.centerX, ay = 2.78;
    b.rbox(steelDark, [dx - 0.015, ay - 0.015, zFace - 0.01], [dx + 0.015, ay + 0.015, zFace + 0.42], 0.004, 1); // arm
    b.rbox(steelDark, [dx - 0.05, ay - 0.06, zFace], [dx + 0.05, ay + 0.06, zFace + 0.012], 0.003, 1); // wall plate
    const pw = 0.6, ph = 0.22, pz = zFace + 0.36;
    const py1 = ay - 0.07, py0 = py1 - ph;
    for (const x of [dx - 0.24, dx + 0.24]) {
      const g = new THREE.CylinderGeometry(0.004, 0.004, 0.07, 6);
      g.translate(x, ay - 0.035, pz);
      b.add(g, steelDark);
    }
    b.box(enamelEdge, [dx - pw / 2, py0, pz - 0.006], [dx + pw / 2, py1, pz + 0.006]);
    twoSided(b, acMat, pw - 0.004, ph - 0.004, dx, (py0 + py1) / 2, pz - 0.0065, pz + 0.0065);
  }

  /* ======================================================================= */
  /* 3. WELCOME panel beside the door                                          */
  /* ======================================================================= */
  {
    const wTex = welcomePanel(rng);
    const wMat = new THREE.MeshStandardMaterial({ map: wTex, roughness: 0.3, metalness: 0.05 });
    wMat.name = "enamelWelcome";
    // Handle side of the door (leaf swings from hingeX toward +x): the pier between the jamb
    // and the building's end, 0.55 m wide → a 0.34 × 0.42 panel at eye height.
    const px = DOOR.hingeX + DOOR.width + DOOR.jamb + 0.27, py = 1.52, pw = 0.34, ph = 0.42;
    b.box(enamelEdge, [px - pw / 2, py - ph / 2, zFace + 0.002], [px + pw / 2, py + ph / 2, zFace + 0.012]);
    {
      const g = new THREE.PlaneGeometry(pw - 0.004, ph - 0.004);
      g.translate(px, py, zFace + 0.0125);
      b.add(g, wMat);
    }
    // Four screws with a rust bleed under each (the bleed is in the map)
    for (const [ox, oy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const g = new THREE.CylinderGeometry(0.005, 0.005, 0.004, 8);
      g.rotateX(Math.PI / 2);
      g.translate(px + ox * (pw / 2 - 0.022), py + oy * (ph / 2 - 0.022), zFace + 0.0145);
      b.add(g, steelDark);
    }
  }

  const meshes = b.build(group, { name: "signage" });
  for (const m of meshes) m.frustumCulled = true;
  group.traverse((o) => { o.userData.lotCaster = true; });
  return { group };
}
