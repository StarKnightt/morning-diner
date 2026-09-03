/**
 * The work side of the counter (fix-backcounter). The counter die's service face was a bare
 * walnut panel over an empty 300 mm laminate ledge — nothing a working diner counter has.
 * This fills the volume between the die's back face (z = -0.55) and the service aisle with a
 * 0.9 m-high stainless under-counter run (320 mm deep, the existing ledge becomes its mid
 * shelf): a two-door reach-in cooler (dented, fingerprinted doors, pulls, hinge plates, gasket
 * line, temperature dial), open shelving with plate / saucer stacks, inverted mugs on a mat,
 * a glass rack of inverted tumblers, a bus tub with dishes, a cutlery caddy, receipt paper,
 * napkins and a straw box; black diamond-plate anti-fatigue mats on the aisle floor; and on
 * the counter's service side a cash register (L-return), a pie case with two pies, a tip jar,
 * a ticket rail with order slips, a menu stand and a condiment rack; a chalkboard specials
 * board above the brewer bay and a framed health certificate under the door-end cabinets.
 * Everything is merged per material into the interior group (casts / receives, in before the
 * probe bake). Colliders: the base cabinets only — mats do not collide.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { MergedBuilder, type V3 } from "../core/merge";
import { makeRng } from "../core/rng";
import { BACK_BAR, CABINETS, COUNTER, PROPS, ROOM } from "./layout";

type XY = [number, number];

const lathe = (profile: XY[], segments: number): THREE.BufferGeometry => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0): THREE.BufferGeometry => {
  if (yaw) g.rotateY(yaw);
  g.translate(x, y, z);
  return g;
};

/* ---------------- canvas atlas for every bit of text ---------------- */

interface Region {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/**
 * One 1024² canvas holds every printed thing (chalk, certificate, labels, slips, menu card)
 * so all of them share one material — one draw. Regions are pixel rectangles.
 */
function drawAtlas(): { texture: THREE.CanvasTexture; region: Record<string, Region> } {
  const S = 1024;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const c = cv.getContext("2d")!;
  const region: Record<string, Region> = {};
  const rect = (name: string, x: number, y: number, w: number, h: number) => {
    region[name] = { u0: x / S, v0: 1 - (y + h) / S, u1: (x + w) / S, v1: 1 - y / S };
    return { x, y, w, h };
  };
  // Chalkboard 600 × 450 mm → 512 × 384 px
  {
    const r = rect("chalk", 0, 0, 512, 384);
    c.fillStyle = "#22282a";
    c.fillRect(r.x, r.y, r.w, r.h);
    // ghost of the last week's wipe
    c.globalAlpha = 0.16;
    for (let i = 0; i < 40; i++) {
      c.strokeStyle = "#d8d8d0";
      c.lineWidth = 14 + Math.random() * 20;
      c.beginPath();
      const y = r.y + Math.random() * r.h;
      c.moveTo(r.x + Math.random() * 60, y);
      c.bezierCurveTo(r.x + 150, y + 30 * (Math.random() - 0.5), r.x + 350, y - 30 * (Math.random() - 0.5), r.x + r.w - Math.random() * 60, y + 20);
      c.stroke();
    }
    c.globalAlpha = 1;
    c.fillStyle = "#f3efe2";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "bold 44px 'Segoe Print', 'Comic Sans MS', cursive";
    c.save();
    c.translate(r.x + r.w / 2, r.y + 70);
    c.rotate(-0.02);
    c.fillText("TODAY'S SPECIAL", 0, 0);
    c.restore();
    c.strokeStyle = "#f3efe2";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(r.x + 70, r.y + 110);
    c.lineTo(r.x + r.w - 60, r.y + 114);
    c.stroke();
    c.fillStyle = "#f6d98a";
    c.font = "bold 58px 'Segoe Print', 'Comic Sans MS', cursive";
    c.save();
    c.translate(r.x + r.w / 2, r.y + 190);
    c.rotate(0.015);
    c.fillText("MEATLOAF", 0, 0);
    c.restore();
    c.fillStyle = "#f3efe2";
    c.font = "bold 50px 'Segoe Print', 'Comic Sans MS', cursive";
    c.fillText("$9.95", r.x + r.w / 2, r.y + 265);
    c.font = "28px 'Segoe Print', 'Comic Sans MS', cursive";
    c.fillStyle = "#cfe3d2";
    c.fillText("w/ mashed + green beans", r.x + r.w / 2, r.y + 325);
    c.fillStyle = "#e8a3a3";
    c.font = "24px 'Segoe Print', 'Comic Sans MS', cursive";
    c.fillText("pie of the day: cherry", r.x + r.w / 2, r.y + 360);
  }
  // Health certificate 280 × 220 mm → 256 × 200 px
  {
    const r = rect("cert", 520, 0, 256, 200);
    c.fillStyle = "#f2eee0";
    c.fillRect(r.x, r.y, r.w, r.h);
    c.strokeStyle = "#7a8a6a";
    c.lineWidth = 6;
    c.strokeRect(r.x + 8, r.y + 8, r.w - 16, r.h - 16);
    c.fillStyle = "#2c3a2c";
    c.textAlign = "center";
    c.font = "bold 20px Georgia, serif";
    c.fillText("COUNTY HEALTH DEPARTMENT", r.x + r.w / 2, r.y + 40);
    c.font = "bold 30px Georgia, serif";
    c.fillText("FOOD SERVICE", r.x + r.w / 2, r.y + 80);
    c.fillText("PERMIT", r.x + r.w / 2, r.y + 112);
    c.font = "14px Georgia, serif";
    c.fillText("Morning Diner   ·   Grade A", r.x + r.w / 2, r.y + 145);
    c.font = "11px Georgia, serif";
    c.fillText("Expires 12/31 — post in public view", r.x + r.w / 2, r.y + 168);
    c.strokeStyle = "#a83232";
    c.lineWidth = 3;
    c.beginPath();
    c.arc(r.x + r.w - 44, r.y + r.h - 44, 22, 0, Math.PI * 2);
    c.stroke();
  }
  // Order slips (three, 90 × 140 mm each) → 96 × 150 px
  for (let k = 0; k < 3; k++) {
    const r = rect(`slip${k}`, 520 + k * 104, 210, 96, 150);
    c.fillStyle = k === 1 ? "#f0f2e4" : "#f6f3e8";
    c.fillRect(r.x, r.y, r.w, r.h);
    c.strokeStyle = "#c8c3b0";
    c.lineWidth = 1;
    for (let y = 30; y < r.h; y += 18) {
      c.beginPath();
      c.moveTo(r.x + 6, r.y + y);
      c.lineTo(r.x + r.w - 6, r.y + y);
      c.stroke();
    }
    c.fillStyle = "#a83232";
    c.font = "bold 11px Arial";
    c.textAlign = "left";
    c.fillText(`No. ${41827 + k * 3}`, r.x + 8, r.y + 16);
    c.fillStyle = "#2a3a6a";
    c.font = "16px 'Segoe Print', 'Comic Sans MS', cursive";
    const lines = [["2 eggs ovr ez", "hash br", "wht toast", "coffee"], ["#4 - bacon", "pancakes", "OJ sm"], ["BLT no mayo", "fries", "coke"]][k];
    lines.forEach((t, i) => c.fillText(t, r.x + 8, r.y + 44 + i * 27));
  }
  // Menu card 150 × 210 mm → 160 × 224 px
  {
    const r = rect("menu", 520, 380, 160, 224);
    c.fillStyle = "#fbf7ea";
    c.fillRect(r.x, r.y, r.w, r.h);
    c.fillStyle = "#a83232";
    c.fillRect(r.x, r.y, r.w, 34);
    c.fillStyle = "#fbf7ea";
    c.textAlign = "center";
    c.font = "bold 18px Georgia, serif";
    c.fillText("BREAKFAST", r.x + r.w / 2, r.y + 24);
    c.fillStyle = "#333";
    c.textAlign = "left";
    c.font = "11px Arial";
    const items: Array<[string, string]> = [["Two Eggs Any Style", "5.25"], ["Short Stack", "4.95"], ["Country Omelette", "7.50"], ["Biscuits & Gravy", "5.75"], ["Corned Beef Hash", "7.25"], ["Bottomless Coffee", "1.50"]];
    items.forEach(([n, p], i) => {
      c.fillText(n, r.x + 10, r.y + 60 + i * 26);
      c.textAlign = "right";
      c.fillText(p, r.x + r.w - 10, r.y + 60 + i * 26);
      c.textAlign = "left";
    });
  }
  // Straw box label 200 × 100 mm → 200 × 100 px
  {
    const r = rect("straws", 700, 380, 200, 100);
    c.fillStyle = "#c9a26a";
    c.fillRect(r.x, r.y, r.w, r.h);
    c.fillStyle = "#1e3f7a";
    c.fillRect(r.x + 10, r.y + 10, r.w - 20, 40);
    c.fillStyle = "#fff";
    c.textAlign = "center";
    c.font = "bold 26px Arial";
    c.fillText("JUMBO STRAWS", r.x + r.w / 2, r.y + 40);
    c.fillStyle = "#1e1e1e";
    c.font = "14px Arial";
    c.fillText("WRAPPED · 7¾ in · 500 CT", r.x + r.w / 2, r.y + 75);
  }
  // Tip jar label
  {
    const r = rect("tips", 700, 490, 120, 60);
    c.fillStyle = "#fff8e8";
    c.fillRect(r.x, r.y, r.w, r.h);
    c.fillStyle = "#333";
    c.font = "bold 26px 'Segoe Print', 'Comic Sans MS', cursive";
    c.textAlign = "center";
    c.fillText("TIPS :)", r.x + r.w / 2, r.y + 40);
  }
  // Register display (emissive material samples this region too)
  {
    const r = rect("display", 0, 400, 240, 60);
    c.fillStyle = "#081008";
    c.fillRect(r.x, r.y, r.w, r.h);
    c.fillStyle = "#7cff8a";
    c.font = "bold 40px 'Courier New', monospace";
    c.textAlign = "right";
    c.fillText("12.45", r.x + r.w - 12, r.y + 45);
    c.font = "bold 16px 'Courier New', monospace";
    c.textAlign = "left";
    c.fillText("TOTAL", r.x + 10, r.y + 36);
  }
  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return { texture, region };
}

/** A plane with UVs cut to an atlas region, facing +z, `w × h`, centred at the origin. */
function atlasQuad(w: number, h: number, r: Region): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  uv.setXY(0, r.u0, r.v1);
  uv.setXY(1, r.u1, r.v1);
  uv.setXY(2, r.u0, r.v0);
  uv.setXY(3, r.u1, r.v0);
  return g;
}

/** Diamond-plate rubber mat bump map: raised rhombus pattern, 100 mm repeat. */
function matBump(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const c = cv.getContext("2d")!;
  c.fillStyle = "#606060";
  c.fillRect(0, 0, S, S);
  const cell = S / 4;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const cx = i * cell + cell / 2, cy = j * cell + cell / 2;
      const grd = c.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.42);
      grd.addColorStop(0, "#c8c8c8");
      grd.addColorStop(0.8, "#a0a0a0");
      grd.addColorStop(1, "#606060");
      c.fillStyle = grd;
      c.beginPath();
      c.moveTo(cx, cy - cell * 0.42);
      c.lineTo(cx + cell * 0.42, cy);
      c.lineTo(cx, cy + cell * 0.42);
      c.lineTo(cx - cell * 0.42, cy);
      c.closePath();
      c.fill();
    }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function buildBackCounter(parent: THREE.Group, pal: Palette): { colliders: MergedBuilder["colliders"] } {
  const b = new MergedBuilder();
  const rng = makeRng(4171);
  const { texture: atlasTex, region: R } = drawAtlas();

  // Local materials (props that have no palette member). Every one is a bucket = one draw.
  const decal = new THREE.MeshStandardMaterial({ map: atlasTex, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  decal.name = "bcDecal";
  decal.userData.noCast = true;
  const display = new THREE.MeshStandardMaterial({ map: atlasTex, emissiveMap: atlasTex, emissive: 0xffffff, emissiveIntensity: 6, roughness: 0.3, metalness: 0, color: 0x202020 });
  display.name = "bcDisplay";
  display.userData.noCast = true;
  const greyPlastic = new THREE.MeshStandardMaterial({ color: 0x6d7073, roughness: 0.6, metalness: 0 });
  greyPlastic.name = "bcGreyPlastic";
  const beige = new THREE.MeshStandardMaterial({ color: 0xcfc6b2, roughness: 0.55, metalness: 0 });
  beige.name = "bcBeige";
  const keyGrey = pal.darkMetal;
  const ketchup = new THREE.MeshStandardMaterial({ color: 0x9e130e, roughness: 0.3, metalness: 0 });
  ketchup.name = "bcKetchup";
  const mustard = new THREE.MeshStandardMaterial({ color: 0xd9a41b, roughness: 0.35, metalness: 0 });
  mustard.name = "bcMustard";
  const crust = new THREE.MeshStandardMaterial({ color: 0xb8803c, roughness: 0.75, metalness: 0 });
  crust.name = "bcCrust";
  const matTex = matBump();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 0.95, metalness: 0, bumpMap: matTex, bumpScale: 0.6, roughnessMap: matTex });
  mat.name = "bcMat";
  const matWorn = mat; // one bucket; the wear reads through the lifted corner + rotation
  const coin = pal.alumBright;

  /* ---------------- the under-counter run ---------------- */
  const dieBack = COUNTER.topFrontZ - COUNTER.overhang - COUNTER.dieDepth; // -0.55
  const xMin = COUNTER.xMin + 0.02, xMax = COUNTER.xMax - 0.02;
  const FRONT = dieBack - 0.32; // -0.87: carcass face
  const TOP = 0.9, KICK = 0.1, DECK = 0.12;
  const shelfY = 0.52; // top of the existing laminate ledge (Counter.ts), now the mid shelf
  const zLiner = dieBack - 0.004;

  // Stainless work top with a bevelled nosing (20 mm proud of the face), a 40 mm rear lip
  // against the die so the joint reads as an upstand rather than a butt.
  b.rbox(pal.stainlessBrushed, [xMin, TOP - 0.03, FRONT - 0.02], [xMax, TOP, dieBack], 0.005, 3);
  b.rbox(pal.stainless, [xMin, TOP, dieBack - 0.012], [xMax, TOP + 0.04, dieBack], 0.002);
  // Toe kick, recessed 40 mm, black powder-coated
  b.rbox(pal.blackPowder, [xMin, 0, FRONT + 0.04], [xMax, KICK, dieBack], 0.003);
  // Deck (bottom shelf) and stainless back liner over the walnut
  b.rbox(pal.stainless, [xMin, KICK, FRONT + 0.005], [xMax, DECK, dieBack], 0.003);
  b.box(pal.stainless, [xMin, DECK, zLiner - 0.002], [xMax, TOP - 0.03, zLiner]);

  // Sections along x (kitchen door end → register end)
  const sections: Array<{ x0: number; x1: number; kind: "glass" | "cooler" | "plates" | "tub" | "paper" }> = [
    { x0: xMin, x1: -4.35, kind: "glass" },
    { x0: -4.35, x1: -2.95, kind: "cooler" },
    { x0: -2.95, x1: -1.45, kind: "plates" },
    { x0: -1.45, x1: -0.05, kind: "tub" },
    { x0: -0.05, x1: 0.95, kind: "cooler" },
    { x0: 0.95, x1: xMax, kind: "paper" },
  ];
  // Dividers / end panels: 18 mm stainless-clad uprights at every boundary
  const bounds = [xMin, ...sections.slice(1).map((s) => s.x0), xMax];
  for (const x of bounds) {
    const x0 = x === xMin ? x : x === xMax ? x - 0.018 : x - 0.009;
    b.rbox(pal.stainless, [x0, KICK, FRONT], [x0 + 0.018, TOP - 0.03, dieBack], 0.002);
  }
  // A 2 mm dark shadow line where the open shelves' front edges meet the top / uprights
  // Lip on the existing ledge's front edge (it sits 20 mm behind the face): stainless edge trim
  for (const s of sections) {
    if (s.kind === "cooler") continue;
    b.rbox(pal.stainless, [s.x0 + 0.01, shelfY - 0.024, FRONT + 0.016], [s.x1 - 0.01, shelfY + 0.002, FRONT + 0.03], 0.002);
  }

  /* ---- reach-in coolers: two doors each, dented + fingerprinted fronts ---- */
  const coolerDoor = (x0: number, x1: number, hingeLeft: boolean, seed: number) => {
    const y0 = KICK + 0.03, y1 = TOP - 0.06;
    const w = x1 - x0, h = y1 - y0;
    // slab
    b.rbox(pal.stainlessTouched, [x0, y0, FRONT - 0.024], [x1, y1, FRONT], 0.006, 3);
    // face: a subdivided plane 0.5 mm proud, with two or three shallow dents (a keg
    // trolley's corner, a dropped rack) pushed in and re-normalled
    const face = new THREE.PlaneGeometry(w - 0.02, h - 0.02, 28, 40);
    const pos = face.attributes.position as THREE.BufferAttribute;
    const r = makeRng(seed);
    const dents = Array.from({ length: 2 + Math.floor(r() * 2) }, () => ({ x: (r() - 0.5) * (w - 0.16), y: (r() - 0.5) * (h - 0.2), rad: 0.035 + r() * 0.05, d: 0.0015 + r() * 0.0025 }));
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i);
      let z = 0;
      for (const d of dents) {
        const q = ((px - d.x) ** 2 + (py - d.y) ** 2) / (d.rad * d.rad);
        if (q < 1) z -= d.d * (1 - q) ** 2;
      }
      pos.setZ(i, z);
    }
    face.computeVertexNormals();
    face.rotateY(Math.PI); // faces -z (toward the aisle)
    face.translate((x0 + x1) / 2, (y0 + y1) / 2, FRONT - 0.0245);
    b.add(face, pal.stainlessTouched);
    // gasket: 10 mm dark rubber line behind the door perimeter
    b.rbox(pal.darkSeal, [x0 - 0.006, y0 - 0.006, FRONT - 0.004], [x1 + 0.006, y1 + 0.006, FRONT + 0.002], 0.002);
    // hinge plates on the hinge stile, top and bottom
    const hx = hingeLeft ? x0 + 0.012 : x1 - 0.062;
    for (const hy of [y0 + 0.04, y1 - 0.1]) b.rbox(pal.chrome, [hx, hy, FRONT - 0.034], [hx + 0.05, hy + 0.06, FRONT - 0.02], 0.003);
    // vertical pull: 16 mm chrome tube on two standoffs, on the free stile
    const px = hingeLeft ? x1 - 0.07 : x0 + 0.07;
    const pull = new THREE.CylinderGeometry(0.008, 0.008, 0.36, 16);
    pull.translate(px, (y0 + y1) / 2, FRONT - 0.062);
    b.add(pull, pal.chrome);
    for (const py of [(y0 + y1) / 2 - 0.15, (y0 + y1) / 2 + 0.15]) b.rbox(pal.chrome, [px - 0.01, py - 0.01, FRONT - 0.062], [px + 0.01, py + 0.01, FRONT - 0.024], 0.003);
  };
  for (const s of sections) {
    if (s.kind !== "cooler") continue;
    const mid = (s.x0 + s.x1) / 2;
    // frame head with a temperature dial and a louvred grille at the kick
    b.rbox(pal.stainless, [s.x0 + 0.009, TOP - 0.06, FRONT - 0.01], [s.x1 - 0.009, TOP - 0.03, FRONT + 0.005], 0.002);
    const dial = new THREE.CylinderGeometry(0.022, 0.024, 0.012, 24);
    dial.rotateX(Math.PI / 2);
    dial.translate(mid, TOP - 0.045, FRONT - 0.016);
    b.add(dial, pal.alumBright);
    const dialFace = new THREE.CircleGeometry(0.016, 24);
    dialFace.rotateY(Math.PI);
    dialFace.translate(mid, TOP - 0.045, FRONT - 0.0225);
    b.add(dialFace, pal.blackPlastic);
    const needle = new THREE.BoxGeometry(0.002, 0.012, 0.001);
    needle.rotateZ(0.6);
    needle.translate(mid + 0.003, TOP - 0.042, FRONT - 0.0232);
    b.add(needle, pal.pilotRed);
    b.rbox(pal.stainless, [s.x0 + 0.009, 0.015, FRONT - 0.012], [s.x1 - 0.009, KICK + 0.03, FRONT], 0.002);
    for (let k = 0; k < 5; k++) b.box(pal.blackPowder, [s.x0 + 0.06, 0.04 + k * 0.015, FRONT - 0.0125], [s.x1 - 0.06, 0.045 + k * 0.015, FRONT - 0.011]);
    coolerDoor(s.x0 + 0.015, mid - 0.004, true, 11 + Math.round(mid * 10));
    coolerDoor(mid + 0.004, s.x1 - 0.015, false, 23 + Math.round(mid * 10));
  }

  /* ---- shared prop geometries ---- */
  // 10" plate: rim 254 mm, 22 mm tall, foot ring
  const plateProfile: XY[] = [[0, 0.004], [0.058, 0.004], [0.061, 0], [0.069, 0], [0.072, 0.005], [0.09, 0.009], [0.112, 0.017], [0.124, 0.022], [0.127, 0.021], [0.126, 0.018], [0.11, 0.013], [0.088, 0.007], [0.07, 0.006], [0.062, 0.006], [0.05, 0.007], [0, 0.007]];
  const plate = lathe(plateProfile, 40);
  const saucer = lathe(plateProfile.map(([r, y]) => [r * 0.6, y * 0.75]), 32);
  const mugProfile: XY[] = [[0, 0], [0.036, 0], [0.04, 0.004], [0.041, 0.03], [0.04, 0.09], [0.042, 0.094], [0.038, 0.094], [0.036, 0.09], [0.036, 0.008], [0, 0.008]];
  const mug = lathe(mugProfile, 28);
  const handle = new THREE.TorusGeometry(0.022, 0.006, 8, 16, Math.PI);
  handle.rotateZ(-Math.PI / 2);
  handle.translate(0.048, 0.05, 0);
  const tumbler = lathe([[0, 0.004], [0.026, 0.004], [0.028, 0], [0.03, 0.002], [0.034, 0.125], [0.032, 0.125], [0.028, 0.008], [0, 0.008]], 24);

  const stack = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, n: number, pitch: number, jit = 0.0015) => {
    for (let i = 0; i < n; i++) b.add(at(g.clone(), x + (rng() - 0.5) * jit, y + i * pitch, z + (rng() - 0.5) * jit, rng() * Math.PI * 2), m);
  };

  for (const s of sections) {
    const cx = (s.x0 + s.x1) / 2;
    const zMid = (FRONT + dieBack) / 2 + 0.01;
    if (s.kind === "plates") {
      // three stacks of 10" plates on the deck, saucers + inverted mugs on a mat on the ledge
      for (const [dx, n] of [[-0.42, 9], [-0.14, 7], [0.14, 11]] as Array<[number, number]>) stack(plate, pal.ceramic, cx + dx, DECK, zMid, n, 0.0135);
      stack(saucer, pal.ceramic, cx + 0.44, DECK, zMid, 12, 0.0105);
      b.rbox(pal.rubberMat, [s.x0 + 0.05, shelfY, FRONT + 0.05], [s.x1 - 0.05, shelfY + 0.006, dieBack - 0.03], 0.002);
      for (let i = 0; i < 12; i++) {
        const mx = s.x0 + 0.13 + (i % 6) * 0.115 + (rng() - 0.5) * 0.01;
        const mz = FRONT + 0.11 + Math.floor(i / 6) * 0.12 + (rng() - 0.5) * 0.01;
        const inv = new THREE.Matrix4().compose(new THREE.Vector3(mx, shelfY + 0.006 + 0.094, mz), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, rng() * Math.PI * 2, 0)), new THREE.Vector3(1, 1, 1));
        b.add(mug.clone(), pal.ceramic, inv);
        b.add(handle.clone(), pal.ceramic, inv);
      }
    } else if (s.kind === "glass") {
      // Black plastic glass rack (peg grid) on the deck with inverted tumblers; a second, empty
      // rack and a stack of two more on the ledge
      const rack = (x0: number, z0: number, y: number, cols: number, rows: number, fill: boolean) => {
        const pitch = 0.075, w = cols * pitch, d = rows * pitch;
        b.rbox(pal.blackPlastic, [x0, y, z0], [x0 + w, y + 0.012, z0 + d], 0.003);
        for (let i = 0; i <= cols; i++) b.box(pal.blackPlastic, [x0 + i * pitch - 0.003, y + 0.012, z0], [x0 + i * pitch + 0.003, y + 0.09, z0 + d]);
        for (let j = 0; j <= rows; j++) b.box(pal.blackPlastic, [x0, y + 0.012, z0 + j * pitch - 0.003], [x0 + w, y + 0.09, z0 + j * pitch + 0.003]);
        if (!fill) return;
        for (let i = 0; i < cols; i++)
          for (let j = 0; j < rows; j++) {
            if (rng() < 0.15) continue; // a couple of empty cells
            const inv = new THREE.Matrix4().compose(new THREE.Vector3(x0 + (i + 0.5) * pitch, y + 0.012 + 0.125, z0 + (j + 0.5) * pitch), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0)), new THREE.Vector3(1, 1, 1));
            b.add(tumbler.clone(), pal.glassClear, inv);
          }
      };
      rack(s.x0 + 0.06, FRONT + 0.03, DECK, 5, 3, true);
      rack(s.x0 + 0.5, FRONT + 0.03, DECK, 5, 3, true);
      rack(s.x0 + 0.1, FRONT + 0.04, shelfY, 5, 3, false);
      rack(s.x0 + 0.1, FRONT + 0.04, shelfY + 0.09, 5, 3, false);
      rack(s.x0 + 0.62, FRONT + 0.04, shelfY, 5, 3, true);
    } else if (s.kind === "tub") {
      // Grey bus tub on the deck with a few dishes in it; cutlery caddy + spare mugs on the ledge
      const tx0 = cx - 0.3, tx1 = cx + 0.2, tz0 = FRONT + 0.02, tz1 = dieBack - 0.02, ty = DECK, th = 0.16;
      const wall = 0.006;
      b.rbox(greyPlastic, [tx0, ty, tz0], [tx1, ty + wall, tz1], 0.004);
      b.rbox(greyPlastic, [tx0, ty, tz0], [tx0 + wall, ty + th, tz1], 0.003);
      b.rbox(greyPlastic, [tx1 - wall, ty, tz0], [tx1, ty + th, tz1], 0.003);
      b.rbox(greyPlastic, [tx0, ty, tz0], [tx1, ty + th, tz0 + wall], 0.003);
      b.rbox(greyPlastic, [tx0, ty, tz1 - wall], [tx1, ty + th, tz1], 0.003);
      b.rbox(greyPlastic, [tx0 - 0.008, ty + th - 0.012, tz0 - 0.008], [tx1 + 0.008, ty + th, tz1 + 0.008], 0.003); // rolled rim
      stack(plate, pal.ceramic, cx - 0.05, ty + wall, (tz0 + tz1) / 2, 4, 0.0135, 0.02);
      const tilted = new THREE.Matrix4().compose(new THREE.Vector3(cx + 0.1, ty + 0.05, (tz0 + tz1) / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.6, 1.2)), new THREE.Vector3(1, 1, 1));
      b.add(mug.clone(), pal.ceramic, tilted);
      b.add(handle.clone(), pal.ceramic, tilted);
      b.add(at(mug.clone(), cx - 0.18, ty + wall, tz1 - 0.07, 1.1), pal.ceramic);
      b.add(at(handle.clone(), cx - 0.18, ty + wall, tz1 - 0.07, 1.1), pal.ceramic);
      // cutlery caddy: 4 bins, handles up
      const kx0 = s.x0 + 0.08, kz0 = FRONT + 0.06, kw = 0.34, kd = 0.18, kh = 0.11;
      b.rbox(pal.blackPlastic, [kx0, shelfY, kz0], [kx0 + kw, shelfY + 0.006, kz0 + kd], 0.003);
      for (const x of [kx0, kx0 + kw - 0.006]) b.rbox(pal.blackPlastic, [x, shelfY, kz0], [x + 0.006, shelfY + kh, kz0 + kd], 0.002);
      for (const z of [kz0, kz0 + kd - 0.006]) b.rbox(pal.blackPlastic, [kx0, shelfY, z], [kx0 + kw, shelfY + kh, z + 0.006], 0.002);
      for (let i = 1; i < 4; i++) b.box(pal.blackPlastic, [kx0 + (i * kw) / 4 - 0.002, shelfY, kz0], [kx0 + (i * kw) / 4 + 0.002, shelfY + kh - 0.01, kz0 + kd]);
      for (let i = 0; i < 4; i++)
        for (let k = 0; k < 14; k++) {
          const cxk = kx0 + (i + 0.5) * (kw / 4) + (rng() - 0.5) * 0.05, czk = kz0 + kd / 2 + (rng() - 0.5) * 0.11;
          const stem = new THREE.BoxGeometry(0.007, 0.15 + rng() * 0.03, 0.0025);
          stem.rotateX((rng() - 0.5) * 0.3);
          stem.rotateZ((rng() - 0.5) * 0.3);
          stem.rotateY(rng() * Math.PI);
          stem.translate(cxk, shelfY + 0.085, czk);
          b.add(stem, pal.chromeBrushed);
        }
      stack(mug, pal.ceramic, s.x1 - 0.15, shelfY, FRONT + 0.12, 1, 0);
      b.add(at(handle.clone(), s.x1 - 0.15, shelfY, FRONT + 0.12, 0.4), pal.ceramic);
    } else if (s.kind === "paper") {
      // receipt rolls, a stack of paper napkins, a straw box (label decal), to-go cups
      const roll = new THREE.CylinderGeometry(0.04, 0.04, 0.08, 28);
      const core = new THREE.CylinderGeometry(0.009, 0.009, 0.082, 12);
      for (let i = 0; i < 3; i++) {
        const rx = s.x0 + 0.1 + i * 0.09, rz = FRONT + 0.1;
        const m = new THREE.Matrix4().compose(new THREE.Vector3(rx, shelfY + 0.04, rz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), new THREE.Vector3(1, 1, 1));
        b.add(roll.clone(), pal.napkin, m);
        b.add(core.clone(), pal.darkMetal, m);
      }
      {
        const m = new THREE.Matrix4().compose(new THREE.Vector3(s.x0 + 0.145, shelfY + 0.04 + 0.075, FRONT + 0.1), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), new THREE.Vector3(1, 1, 1));
        b.add(roll.clone(), pal.napkin, m);
        b.add(core.clone(), pal.darkMetal, m);
      }
      // napkin stack: 170 × 170, 60 tall, a few sheets fanned
      const nx = s.x0 + 0.5, nz = FRONT + 0.13;
      b.rbox(pal.napkin, [nx - 0.085, shelfY, nz - 0.085], [nx + 0.085, shelfY + 0.055, nz + 0.085], 0.004);
      b.add(at(new THREE.BoxGeometry(0.17, 0.008, 0.17), nx + 0.008, shelfY + 0.059, nz - 0.005, 0.12), pal.napkin);
      // straw box on the deck with the label toward the aisle
      const bx0 = s.x0 + 0.08, bz0 = FRONT + 0.06;
      b.rbox(pal.trayBrown, [bx0, DECK, bz0], [bx0 + 0.24, DECK + 0.13, bz0 + 0.22], 0.003);
      b.add(at(atlasQuad(0.2, 0.1, R.straws).rotateY(Math.PI), bx0 + 0.12, DECK + 0.065, bz0 - 0.0008), decal);
      // sleeve of to-go cups on the deck
      const cup = lathe([[0, 0.004], [0.035, 0.004], [0.037, 0], [0.038, 0.002], [0.045, 0.11], [0.047, 0.112], [0.043, 0.112], [0.036, 0.008], [0, 0.008]], 24);
      for (let i = 0; i < 3; i++) b.add(at(cup.clone(), s.x1 - 0.2, DECK + i * 0.014, FRONT + 0.14), pal.napkin);
      stack(saucer, pal.ceramic, s.x1 - 0.5, DECK, FRONT + 0.14, 8, 0.0105);
    }
  }
  // Collider: the base cabinets only (mats do not collide)
  b.collider([xMin, 0, FRONT - 0.03], [xMax, TOP, dieBack]);

  /* ---------------- anti-fatigue mats on the aisle floor ---------------- */
  {
    const z0 = FRONT - 0.06, z1 = BACK_BAR.zFront + 0.08; // 0.9 m wide
    for (const [mx, len, yawDeg, m] of [[-4.6, 1.5, 0.8, matWorn], [-1.7, 1.5, -0.5, mat], [1.2, 1.5, 1.4, matWorn]] as Array<[number, number, number, THREE.Material]>) {
      const g = new THREE.BoxGeometry(len, 0.012, z0 - z1, 1, 1, 1);
      // metric UVs for the 100 mm diamond repeat
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (len / 0.1), uv.getY(i) * ((z0 - z1) / 0.1));
      // a lifted corner: the +x/-z corner rises 18 mm
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) if (pos.getX(i) > 0 && pos.getZ(i) < 0) pos.setY(i, pos.getY(i) + (m === matWorn ? 0.018 : 0.006));
      g.computeVertexNormals();
      g.rotateY(THREE.MathUtils.degToRad(yawDeg));
      g.translate(mx, 0.006, (z0 + z1) / 2);
      b.add(g, m);
    }
  }

  /* ---------------- on the counter, service side ---------------- */
  const topY = COUNTER.height;
  {
    // Cash register on the L-return: beige body, sloped key deck, green display, drawer
    const rx = 2.35, rz = -0.85, w = 0.42, d = 0.44, yaw = THREE.MathUtils.degToRad(-8);
    const M = new THREE.Matrix4().makeRotationY(yaw).setPosition(rx, topY, rz);
    const put = (g: THREE.BufferGeometry, mtl: THREE.Material) => b.add(g, mtl, M);
    const rb = (mtl: THREE.Material, min: V3, max: V3, r = 0.004) => {
      const g = new RoundedBoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2], 2, Math.min(r, (max[1] - min[1]) / 2 - 1e-4));
      g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
      put(g, mtl);
    };
    // cash drawer
    rb(keyGrey, [-w / 2, 0.0, -d / 2], [w / 2, 0.11, d / 2]);
    rb(beige, [-w / 2 + 0.004, 0.012, -d / 2 - 0.006], [w / 2 - 0.004, 0.1, -d / 2 + 0.002]); // drawer front (toward the aisle, -z)
    rb(pal.chrome, [-0.03, 0.05, -d / 2 - 0.02], [0.03, 0.062, -d / 2 - 0.006]);
    // body: lower box + sloped key deck
    rb(beige, [-w / 2 + 0.01, 0.11, -d / 2 + 0.02], [w / 2 - 0.01, 0.2, d / 2 - 0.02]);
    const deck = new THREE.BoxGeometry(w - 0.03, 0.02, 0.24);
    deck.rotateX(-0.22); // slopes down toward the aisle (-z)
    deck.translate(0, 0.22, -0.03);
    put(deck, beige);
    // keys: 5 × 5 grid on the deck
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++) {
        const k = new THREE.BoxGeometry(0.02, 0.01, 0.02);
        k.rotateX(-0.22);
        const zz = -0.11 + j * 0.036;
        k.translate(-0.13 + i * 0.038, 0.235 + (zz + 0.03) * 0.224, zz);
        put(k, i === 4 && j > 2 ? pal.blackPlastic : keyGrey);
      }
    // display housing at the back with the green readout facing the aisle
    rb(beige, [-0.14, 0.2, 0.09], [0.14, 0.31, d / 2 - 0.02]);
    put(atlasQuad(0.24, 0.06, R.display).rotateY(Math.PI).translate(0, 0.26, 0.089), display);
    // receipt slot + paper tongue
    rb(pal.blackPlastic, [0.05, 0.2, -0.02], [0.13, 0.215, 0.09]);
    const tongue = new THREE.BoxGeometry(0.06, 0.0008, 0.07);
    tongue.rotateX(0.5);
    tongue.translate(0.09, 0.235, -0.04);
    put(tongue, pal.napkin);
    // rubber feet
    for (const [fx, fz] of [[-0.18, -0.19], [0.18, -0.19], [-0.18, 0.19], [0.18, 0.19]]) put(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 12).translate(fx, 0.002, fz), pal.blackPlastic);
  }
  {
    // Pie case: acrylic box on a stainless base, two pies in foil tins on a doily
    const px = 1.25, pz = -0.33, w = 0.46, d = 0.34, h = 0.28;
    b.rbox(pal.stainlessBrushed, [px - w / 2, topY, pz - d / 2], [px + w / 2, topY + 0.02, pz + d / 2], 0.004);
    {
      const iw = w - 0.02, id = d - 0.02, t = 0.004, y0 = topY + 0.02;
      const pane = (min: V3, max: V3) => {
        const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
        g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
        b.add(g, pal.glassClear);
      };
      pane([px - iw / 2, y0, pz - id / 2], [px - iw / 2 + t, y0 + h, pz + id / 2]);
      pane([px + iw / 2 - t, y0, pz - id / 2], [px + iw / 2, y0 + h, pz + id / 2]);
      pane([px - iw / 2, y0, pz - id / 2], [px + iw / 2, y0 + h, pz - id / 2 + t]);
      pane([px - iw / 2, y0, pz + id / 2 - t], [px + iw / 2, y0 + h, pz + id / 2]);
      pane([px - iw / 2, y0 + h - t, pz - id / 2], [px + iw / 2, y0 + h, pz + id / 2]);
    }
    // aluminium frame edges
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.rbox(pal.alumBright, [px + (x * (w - 0.02)) / 2 - 0.004, topY + 0.02, pz + (z * (d - 0.02)) / 2 - 0.004], [px + (x * (w - 0.02)) / 2 + 0.004, topY + 0.02 + h, pz + (z * (d - 0.02)) / 2 + 0.004], 0.002);
    b.rbox(pal.alumBright, [px - w / 2 + 0.006, topY + 0.02 + h - 0.006, pz - d / 2 + 0.006], [px + w / 2 - 0.006, topY + 0.02 + h + 0.002, pz + d / 2 - 0.006], 0.002);
    b.rbox(pal.chrome, [px - 0.03, topY + 0.02 + h, pz - 0.006], [px + 0.03, topY + 0.02 + h + 0.03, pz + 0.006], 0.003); // lid knob bar
    for (const dx of [-0.11, 0.11]) {
      const tin = lathe([[0, 0], [0.095, 0], [0.115, 0.032], [0.125, 0.034], [0.122, 0.036], [0.11, 0.034], [0.093, 0.003], [0, 0.003]], 36);
      b.add(at(tin, px + dx, topY + 0.022, pz), pal.alumBright);
      const pie = lathe([[0, 0.003], [0.092, 0.003], [0.108, 0.032], [0.112, 0.046], [0.1, 0.05], [0.07, 0.044], [0.04, 0.047], [0, 0.045]], 36);
      b.add(at(pie, px + dx, topY + 0.022, pz, rng() * 3), crust);
    }
  }
  {
    // Tip jar: glass jar, a paper label, coins and a bill
    const jx = 1.75, jz = -0.4;
    const jar = lathe([[0, 0.003], [0.05, 0.003], [0.055, 0.008], [0.056, 0.13], [0.045, 0.145], [0.047, 0.155], [0.042, 0.155], [0.04, 0.147], [0.052, 0.132], [0.05, 0.012], [0, 0.012]], 28);
    b.add(at(jar, jx, topY, jz), pal.glassClear);
    {
      const label = new THREE.CylinderGeometry(0.0572, 0.0572, 0.04, 16, 1, true, Math.PI - 0.7, 1.4);
      const uv = label.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, R.tips.u0 + uv.getX(i) * (R.tips.u1 - R.tips.u0), R.tips.v0 + uv.getY(i) * (R.tips.v1 - R.tips.v0));
      label.translate(jx, topY + 0.085, jz);
      b.add(label, decal);
    }
    for (let i = 0; i < 9; i++) {
      const c = new THREE.CylinderGeometry(0.011, 0.011, 0.0018, 16);
      c.rotateX((rng() - 0.5) * 0.6);
      c.rotateY(rng() * 3);
      c.translate(jx + (rng() - 0.5) * 0.06, topY + 0.014 + i * 0.004, jz + (rng() - 0.5) * 0.06);
      b.add(c, coin);
    }
    const bill = new THREE.BoxGeometry(0.066, 0.0006, 0.156);
    bill.rotateX(0.9);
    bill.rotateY(0.7);
    bill.translate(jx, topY + 0.09, jz);
    b.add(bill, pal.napkin);
  }
  {
    // Ticket rail on the stainless lip: aluminium bar with three slips under spring clips
    const y = topY + 0.09, z = dieBack - 0.006;
    b.rbox(pal.alumBright, [-0.35, y - 0.008, z - 0.014], [0.55, y + 0.008, z], 0.003);
    for (let k = 0; k < 3; k++) {
      const sx = -0.22 + k * 0.28;
      b.rbox(pal.chrome, [sx - 0.02, y - 0.006, z - 0.02], [sx + 0.02, y + 0.012, z - 0.012], 0.002);
      const slip = atlasQuad(0.09, 0.14, R[`slip${k}`]);
      slip.rotateY(Math.PI);
      slip.rotateZ((rng() - 0.5) * 0.12);
      slip.translate(sx, y - 0.07, z - 0.017);
      b.add(slip, decal);
    }
  }
  {
    // Menu stand: bent acrylic L with the card leaning in it
    const mx = -1.15, mz = -0.36;
    const base = new THREE.BoxGeometry(0.16, 0.004, 0.09);
    base.translate(mx, topY + 0.002, mz);
    b.add(base, pal.glassClear);
    const back = new THREE.BoxGeometry(0.16, 0.22, 0.004);
    back.rotateX(-0.2);
    back.translate(mx, topY + 0.11, mz + 0.04);
    b.add(back, pal.glassClear);
    const card = atlasQuad(0.15, 0.21, R.menu);
    card.rotateX(-0.2);
    card.rotateY(Math.PI);
    card.translate(mx, topY + 0.108, mz + 0.017);
    b.add(card, decal);
  }
  {
    // Condiment rack: black wire basket with three ketchups and three mustards, refilled
    const cx = 0.55, cz = -0.38;
    b.rbox(pal.blackPowder, [cx - 0.16, topY, cz - 0.07], [cx + 0.16, topY + 0.006, cz + 0.07], 0.002);
    for (const x of [cx - 0.16, cx + 0.16 - 0.005]) b.rbox(pal.blackPowder, [x, topY, cz - 0.07], [x + 0.005, topY + 0.1, cz + 0.07], 0.002);
    for (const z of [cz - 0.07, cz + 0.07 - 0.005]) b.rbox(pal.blackPowder, [cx - 0.16, topY + 0.08, z], [cx + 0.16, topY + 0.1, z + 0.005], 0.002);
    const bottle = lathe([[0, 0.002], [0.028, 0.002], [0.03, 0.006], [0.03, 0.12], [0.026, 0.14], [0.012, 0.155], [0.012, 0.17], [0, 0.17]], 24);
    const cap = lathe([[0, 0.17], [0.014, 0.17], [0.014, 0.185], [0.005, 0.195], [0, 0.195]], 16);
    for (let i = 0; i < 6; i++) {
      const bx = cx - 0.125 + i * 0.05 + (rng() - 0.5) * 0.004, bz = cz + (rng() - 0.5) * 0.01;
      const m = i % 2 === 0 ? ketchup : mustard;
      b.add(at(bottle.clone(), bx, topY + 0.006, bz), m);
      b.add(at(cap.clone(), bx, topY + 0.006, bz), i % 2 === 0 ? pal.blackPlastic : mustard);
    }
  }

  /* ---------------- back-bar wall ---------------- */
  {
    // Chalkboard above the brewer bay (the wall between the cabinet run and the pass-through)
    const cx = PROPS.brewer.x + 0.05, cy = 1.95, z = ROOM.zBack + 0.004, w = 0.6, h = 0.45, f = 0.03;
    b.rbox(pal.capWood, [cx - w / 2 - f, cy - h / 2 - f, z], [cx + w / 2 + f, cy + h / 2 + f, z + 0.022], 0.004);
    b.box(pal.blackPlastic, [cx - w / 2, cy - h / 2, z + 0.02], [cx + w / 2, cy + h / 2, z + 0.023]);
    b.add(atlasQuad(w, h, R.chalk).translate(cx, cy, z + 0.0236), decal);
    // chalk ledge with two stubs
    b.rbox(pal.capWood, [cx - w / 2 - f, cy - h / 2 - f - 0.02, z], [cx + w / 2 + f, cy - h / 2 - f, z + 0.045], 0.003);
    for (const [dx, len] of [[-0.12, 0.04], [0.05, 0.025]]) b.add(at(new THREE.CylinderGeometry(0.005, 0.005, len, 10).rotateZ(Math.PI / 2), cx + dx, cy - h / 2 - f + 0.005, z + 0.034, 0.3), pal.napkin);
  }
  {
    // Health permit in a black frame under the door-end upper cabinets
    const cx = 1.7, cy = (BACK_BAR.height + 0.1 + CABINETS.bottom - 0.04) / 2, z = ROOM.zBack + 0.004, w = 0.28, h = 0.22, f = 0.018;
    b.rbox(pal.blackPlastic, [cx - w / 2 - f, cy - h / 2 - f, z], [cx + w / 2 + f, cy + h / 2 + f, z + 0.016], 0.003);
    b.add(atlasQuad(w, h, R.cert).translate(cx, cy, z + 0.0164), decal);
    const glass = new THREE.BoxGeometry(w, h, 0.002);
    glass.translate(cx, cy, z + 0.0176);
    b.add(glass, pal.glassClear);
  }

  b.build(parent, { name: "backcounter" });
  return { colliders: b.colliders };
}
