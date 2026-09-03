/**
 * Parking-lot light standard (fix-pole): a tapered round steel pole on the System 3
 * poured pier, a swept davit arm that leaves the mast through a welded saddle (one tube
 * along a Catmull-Rom curve — no butt joint, no step at the elbow), and a shoebox area
 * luminaire with a real optic behind a flat glass: LED lens bumps on an aluminium
 * module inside a framed recess, photocell on top, slip-fitter with three set screws.
 *
 * Everything goes through the caller's MergedBuilder, so the whole standard is a few
 * buckets in the exterior group (`userData.lotCaster`, both shadow maps). Roughly
 * 3.6 k triangles per pole.
 *
 * Emissive: `Lighting.ts` scales the scene so 1 unit = 10,000 nits (K = 1e-4); the LED
 * lenses sit at ≈ 3,400 nits — lit at dusk, a long way under a sunlit white (~13,000).
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { MergedBuilder } from "../core/merge";

export interface LotLightMats {
  /** Grey-white paint over galvanised steel, streaked, rust-bloom at the base (canvas map). */
  paint: THREE.MeshStandardMaterial;
  /** Hot-dip galvanised hardware: bolts, nuts, handhole cover. */
  galv: THREE.MeshStandardMaterial;
  /** Dark steel: base plate. */
  steel: THREE.MeshStandardMaterial;
  /** Die-cast luminaire housing, dark bronze powder coat. */
  bronze: THREE.MeshStandardMaterial;
  /** LED module plate. */
  alu: THREE.MeshStandardMaterial;
  /** LED optics (emissive). */
  led: THREE.MeshStandardMaterial;
  /** Flat tempered lens glass. */
  glass: THREE.MeshPhysicalMaterial;
  /** Photocell dome. */
  photocell: THREE.MeshStandardMaterial;
  pier: THREE.Material;
  grout: THREE.Material;
  /** Materials that want the lot probe as their envMap. */
  env: THREE.Material[];
}

/* ---------------- pole paint: vertical streaks + rust bloom at the foot ---------------- */

function poleMap(): THREE.CanvasTexture {
  const W = 256, H = 1024;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  let seed = 0x5eed1234;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  // Per-column tone: slow variation + a few sharper dark runs (drip streaks), wrapping in u.
  const col = new Float32Array(W), rustLen = new Float32Array(W);
  const a1 = rnd() * 6.28, a2 = rnd() * 6.28, a3 = rnd() * 6.28;
  for (let x = 0; x < W; x++) {
    const u = (x / W) * Math.PI * 2;
    col[x] = 0.05 * Math.sin(u * 3 + a1) + 0.03 * Math.sin(u * 7 + a2) + 0.02 * Math.sin(u * 17 + a3);
    rustLen[x] = 0.045 + 0.02 * Math.sin(u * 5 + a2) + 0.015 * Math.sin(u * 13 + a1);
  }
  for (let k = 0; k < 14; k++) {
    const x0 = Math.floor(rnd() * W), w = 1 + Math.floor(rnd() * 4), amp = 0.05 + rnd() * 0.08;
    for (let i = 0; i < w; i++) col[(x0 + i) % W] -= amp;
    rustLen[x0 % W] += 0.03 + rnd() * 0.05; // the streaks carry rust further up
  }
  for (let y = 0; y < H; y++) {
    const v = 1 - y / H; // canvas row 0 is the pole top (CanvasTexture flipY)
    for (let x = 0; x < W; x++) {
      // Galvanised grey-white: albedo ≈ 0.58 (a white pole in desert sun clips at 0.8).
      const grain = (rnd() - 0.5) * 0.04;
      let r = 0.64 + col[x] + grain, g = 0.65 + col[x] + grain, b = 0.645 + col[x] * 0.9 + grain;
      // Weathering: chalkier / lighter toward the top, a touch of grime low down.
      const grime = Math.max(0, 0.14 - v) * 0.5;
      r -= grime; g -= grime; b -= grime * 0.9;
      // Rust bloom: brown-orange stain climbing from the base, per-column height, ragged edge.
      const rl = rustLen[x] + (rnd() - 0.5) * 0.01;
      if (v < rl) {
        const t = Math.pow(1 - v / rl, 1.4) * (0.55 + 0.45 * rnd());
        r = r * (1 - t) + 0.42 * t; g = g * (1 - t) + 0.22 * t; b = b * (1 - t) + 0.12 * t;
      }
      const i = (y * W + x) * 4;
      d[i] = Math.max(0, Math.min(255, r * 255)); d[i + 1] = Math.max(0, Math.min(255, g * 255)); d[i + 2] = Math.max(0, Math.min(255, b * 255)); d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

export function makeLotLightMats(pier: THREE.Material, grout: THREE.Material): LotLightMats {
  const paint = new THREE.MeshStandardMaterial({ map: poleMap(), color: 0xffffff, roughness: 0.38, metalness: 0.3 });
  const galv = new THREE.MeshStandardMaterial({ color: 0x9a9d9c, roughness: 0.5, metalness: 0.75 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4c4e, roughness: 0.55, metalness: 0.8 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x2d261f, roughness: 0.48, metalness: 0.35 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xc8cbcc, roughness: 0.32, metalness: 0.9 });
  const led = new THREE.MeshStandardMaterial({ color: 0xf2eee4, emissive: new THREE.Color(1.0, 0.9, 0.76), emissiveIntensity: 0.36, roughness: 0.25, metalness: 0 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1 });
  glass.userData.noCast = true; // a 6 mm pane must not cost a draw per shadow map
  const photocell = new THREE.MeshStandardMaterial({ color: 0x9aa3b0, roughness: 0.3, metalness: 0 });
  paint.name = "lotlight-paint"; bronze.name = "lotlight-bronze"; led.name = "lotlight-led"; glass.name = "lotlight-glass";
  return { paint, galv, steel, bronze, alu, led, glass, photocell, pier, grout, env: [paint, galv, steel, bronze, alu, glass, photocell] };
}

/* ---------------- tapered tube along a curve (TubeGeometry's layout and winding) ---------------- */

function taperedTube(curve: THREE.Curve<THREE.Vector3>, tubular: number, radial: number, radiusAt: (t: number) => number): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(tubular, false);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const P = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, P);
    const N = frames.normals[i], B = frames.binormals[i];
    const r = radiusAt(t);
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2;
      const s = Math.sin(v), c = -Math.cos(v);
      const nx = c * N.x + s * B.x, ny = c * N.y + s * B.y, nz = c * N.z + s * B.z;
      pos.push(P.x + r * nx, P.y + r * ny, P.z + r * nz);
      nor.push(nx, ny, nz);
      uv.push(j / radial, 0.2 + 0.75 * t); // u around (the paint's streaks run along the arm), v clear of the rust band
    }
  }
  for (let i = 0; i < tubular; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = (i + 1) * (radial + 1) + j, c = b + 1, d = a + 1;
      idx.push(a, b, d, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Cylinder whose axis (local +y) is turned onto `dir`, centred at `at`. */
function cylAlong(rTop: number, rBot: number, len: number, seg: number, at: THREE.Vector3, dir: THREE.Vector3): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  g.applyQuaternion(q);
  g.translate(at.x, at.y, at.z);
  return g;
}

/**
 * One light standard. `px, pz` is the pole axis on the lot, `yLot` the lot grade; the arm
 * reaches toward -z (over the stall row). `yaw` turns the whole standard about its axis.
 */
export function buildLotLight(b: MergedBuilder, m: LotLightMats, px: number, pz: number, yLot: number, yaw = 0): void {
  const world = new THREE.Matrix4().makeTranslation(px, 0, pz).multiply(new THREE.Matrix4().makeRotationY(yaw));
  const put = (g: THREE.BufferGeometry, mat: THREE.Material) => b.add(g, mat, world);
  const rb = (mat: THREE.Material, min: [number, number, number], max: [number, number, number], r: number, seg = 2) => {
    const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
    const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
    g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    put(g, mat);
  };

  /* ---- System 3 pier: round poured pier Ø 0.6, 0.75 m above grade, 15 mm chamfer, grout collar ---- */
  const pierTop = yLot + 0.75;
  const pier = new THREE.CylinderGeometry(0.285, 0.3, 0.735, 28);
  pier.translate(0, yLot + 0.735 / 2, 0);
  put(pier, m.pier);
  const chamfer = new THREE.CylinderGeometry(0.27, 0.285, 0.015, 28);
  chamfer.translate(0, pierTop - 0.0075, 0);
  put(chamfer, m.pier);
  rb(m.grout, [-0.2, pierTop, -0.2], [0.2, pierTop + 0.03, 0.2], 0.004, 1); // grout collar
  const plateTop = pierTop + 0.03 + 0.028;
  rb(m.steel, [-0.21, pierTop + 0.03, -0.21], [0.21, plateTop, 0.21], 0.006, 2); // 420 mm base plate
  for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const bx = ax * 0.16, bz = az * 0.16;
    const washer = new THREE.CylinderGeometry(0.026, 0.026, 0.005, 12);
    washer.translate(bx, plateTop + 0.0025, bz);
    put(washer, m.galv);
    const nut = new THREE.CylinderGeometry(0.02, 0.02, 0.02, 6);
    nut.translate(bx, plateTop + 0.005 + 0.01, bz);
    put(nut, m.galv);
    const bolt = new THREE.CylinderGeometry(0.011, 0.011, 0.055, 10);
    bolt.translate(bx, plateTop + 0.0275, bz);
    put(bolt, m.galv);
  }

  /* ---- mast: tapered round steel, Ø 200 → Ø 100 over 8.2 m, on a flared shoe ---- */
  const H = 8.2, r0 = 0.1, r1 = 0.05;
  const yBase = plateTop, yTop = yBase + H;
  const rAt = (y: number) => r0 + (r1 - r0) * ((y - yBase) / H);
  const shoe = new THREE.CylinderGeometry(r0 + 0.006, r0 + 0.04, 0.09, 24);
  shoe.translate(0, yBase + 0.045, 0);
  put(shoe, m.paint);
  const mast = new THREE.CylinderGeometry(r1, r0, H, 24, 8, true);
  mast.translate(0, yBase + H / 2, 0);
  put(mast, m.paint);
  // Flat cap with a small lip
  const cap = new THREE.CylinderGeometry(r1 + 0.007, r1 + 0.007, 0.018, 24);
  cap.translate(0, yTop + 0.006, 0);
  put(cap, m.paint);
  const capDome = new THREE.SphereGeometry(r1 + 0.007, 24, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  capDome.scale(1, 0.25, 1);
  capDome.translate(0, yTop + 0.015, 0);
  put(capDome, m.paint);

  /* ---- handhole: 90 × 220 mm cover on two screws, 0.45 m up, facing the drive aisle ---- */
  {
    const yh = yBase + 0.45, az = Math.PI * 0.25; // toward (+x, -z)
    const dir = new THREE.Vector3(Math.sin(az), 0, -Math.cos(az));
    const cover = new RoundedBoxGeometry(0.09, 0.22, 0.012, 2, 0.006);
    cover.rotateY(-az);
    const rc = rAt(yh) - 0.002;
    cover.translate(dir.x * rc, yh, dir.z * rc);
    put(cover, m.galv);
    for (const dy of [-0.095, 0.095]) {
      const screw = cylAlong(0.006, 0.006, 0.006, 6, new THREE.Vector3(dir.x * (rc + 0.008), yh + dy, dir.z * (rc + 0.008)), dir);
      put(screw, m.steel);
    }
  }

  /* ---- davit arm: one swept tube from the mast axis to a level tenon 2.15 m out, 0.4 m up ---- */
  const yA = yTop - 0.55; // exits the mast here
  const curve = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0, yA, 0),
      new THREE.Vector3(0, yA + 0.03, -0.22),
      new THREE.Vector3(0, yA + 0.14, -0.6),
      new THREE.Vector3(0, yA + 0.3, -1.15),
      new THREE.Vector3(0, yA + 0.385, -1.7),
      new THREE.Vector3(0, yA + 0.4, -2.15),
    ],
    false,
    "centripetal",
  );
  put(taperedTube(curve, 28, 14, (t) => 0.046 - 0.016 * t), m.paint);
  // Welded saddle: a collar ring on the mast and a short boss the arm leaves through.
  const rSad = rAt(yA) + 0.012;
  const collar = new THREE.CylinderGeometry(rSad - 0.002, rSad, 0.26, 24);
  collar.translate(0, yA + 0.02, 0);
  put(collar, m.paint);
  const exitDir = curve.getTangentAt(0.04);
  const bossAt = curve.getPointAt(0.03).addScaledVector(exitDir, 0.06);
  put(cylAlong(0.058, 0.066, 0.13, 20, bossAt, exitDir), m.paint);
  const tip = curve.getPointAt(1);

  /* ---- slip-fitter + shoebox head (0.6 × 0.4 × 0.18, dark bronze) ---- */
  const zF0 = tip.z + 0.1, zF1 = tip.z - 0.16; // fitter sleeve over the tenon into the housing back
  put(cylAlong(0.043, 0.043, zF0 - zF1, 20, new THREE.Vector3(0, tip.y, (zF0 + zF1) / 2), new THREE.Vector3(0, 0, -1)), m.bronze);
  for (const a of [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3]) {
    // three hex set screws around the sleeve, 40 mm in from its mouth
    const rd = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    put(cylAlong(0.007, 0.007, 0.014, 6, new THREE.Vector3(rd.x * 0.046, tip.y + rd.y * 0.046, zF0 - 0.04), rd), m.galv);
  }
  const hw = 0.3, hd = 0.4, hh = 0.18;
  const zB = zF1 + 0.02, zFr = zB - hd; // housing back / front
  const yB = tip.y - 0.11, yT = yB + hh; // fitter enters the back at mid-height
  const yLip = yB + 0.045; // door frame height
  // Upper body: full plan, the frame's height above the lens opening
  rb(m.bronze, [-hw, yLip, zFr], [hw, yT, zB], 0.018, 3);
  // Door frame around the lens opening (0.5 × 0.31): four bars, rounded edges
  const ox = 0.25, oz0 = zFr + 0.045, oz1 = zB - 0.045;
  rb(m.bronze, [-hw, yB, zFr], [hw, yLip + 0.002, oz0], 0.012, 2);
  rb(m.bronze, [-hw, yB, oz1], [hw, yLip + 0.002, zB], 0.012, 2);
  rb(m.bronze, [-hw, yB, oz0 - 0.001], [-ox, yLip + 0.002, oz1 + 0.001], 0.012, 2);
  rb(m.bronze, [ox, yB, oz0 - 0.001], [hw, yLip + 0.002, oz1 + 0.001], 0.012, 2);
  // Optics: aluminium LED module plate inside the cavity, 5 × 3 TIR lenses hanging below it
  const yMod = yLip - 0.008;
  rb(m.alu, [-ox + 0.015, yMod - 0.008, oz0 + 0.012], [ox - 0.015, yMod, oz1 - 0.012], 0.002, 1);
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 3; j++) {
      const lens = new THREE.SphereGeometry(0.021, 12, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      lens.scale(1, 0.7, 1);
      lens.translate(-0.18 + i * 0.09, yMod - 0.008, oz0 + 0.06 + j * ((oz1 - oz0 - 0.12) / 2));
      put(lens, m.led);
    }
  // Flat tempered lens, flush in the frame, facing down
  const pane = new THREE.PlaneGeometry(ox * 2 - 0.004, oz1 - oz0 - 0.004);
  pane.rotateX(Math.PI / 2); // normal -y
  pane.translate(0, yB + 0.012, (oz0 + oz1) / 2);
  put(pane, m.glass);
  // Photocell: twist-lock receptacle + dome, top rear, offset from the fitter
  {
    const pcx = 0.17, pcz = zB - 0.09;
    const base = new THREE.CylinderGeometry(0.024, 0.026, 0.022, 14);
    base.translate(pcx, yT + 0.011, pcz);
    put(base, m.bronze);
    const dome = new THREE.SphereGeometry(0.02, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.8, 1);
    dome.translate(pcx, yT + 0.022, pcz);
    put(dome, m.photocell);
  }
}
