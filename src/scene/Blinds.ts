/**
 * System 3: 1" aluminium venetian blinds, inside-mounted in every front-window
 * reveal, lowered (not all the way — see below), slats tilted ~25° outer-edge-up.
 *
 * Why 25° and not the 45° "half open" of the brief: the placeholder sun (el 35°,
 * az 38° off the window normal) has a profile angle β ≈ 41.6° in the window's
 * vertical plane. Stripe darkness is w·|sin(β − θ)| / (p·cos β) (REFERENCE §1); at
 * θ = 45° the slats are parallel to the beam and pass it as one sheet with hairline
 * shadows. θ = 25° blocks ≈ 43 % → legible 11 mm dark / 14 mm light stripes at
 * 24.8 mm pitch on the floor. System 4 re-tunes θ with the final sun.
 *
 * Rev 3: no two blinds are alike. Every blind has its own tilt (25 ± 5°), its own
 * drop (two hang to the sill, the others were pulled up 3–8 cm, so their bottom
 * slats lie stacked on the rail), its own sag amplitude (1–3 mm between ladders),
 * 1–3 slats with a real crease near one end (the far part tilted and drooping), and
 * the slats are generated per vertex — one merged BufferGeometry per blind (five draw
 * calls) with per-slat tone in the vertex colour — so the sag is a real curve and the
 * kinks are local bends, not whole-slat rotations. Route holes are 12 × 6 mm ovals
 * (rev 2 cut 22 mm slots — the dark dashes on the centre ladder in `window`).
 * Ladders (1.3 mm cords front + rear, a rung under every slat), lift cords through the
 * holes, 25 × 38 headrail with valance lip, closed-channel bottom rail with end caps and
 * cord buttons, tilt wand, two pull cords + equaliser + cream acorn tassel — merged per
 * material.
 *
 * Rev 4: the rev 3 variation was measured as invisible (every slat dead straight in
 * `window` at 1024 px — 1–3 mm of sag at 0.94 m is under a pixel). Now every blind has ONE
 * obviously sagging slat (6–10 mm between ladders ≈ 5–8 px in `window`) and ONE creased
 * slat whose outer 15–25 cm twists 14–25° and droops 8–15 mm (a tilt discontinuity the
 * eye reads as a bend, not a tone step); the last blind in the row is pulled up 15–30 cm.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { WINDOW } from "./layout";
import { installLotGroundFill } from "./Lighting";
import { BLIND_DROP, blindLayout, SLAT } from "./slatShadow";

/**
 * feat-blinds-f: make `uBlindDrop[]` (slatShadow.ts, declared in `lights_pars_begin` for every lit
 * program) a uniform of every built-in lit material. `WebGLPrograms.getUniforms` clones the
 * ShaderLib entry per material and `cloneUniforms` passes a Float32Array by REFERENCE, so all
 * programs read the one `BLIND_DROP.value` array. Idempotent; runs at module load (before any
 * material compiles — the first render is after the scene build).
 */
function installBlindDropUniform(): void {
  for (const id of ["standard", "physical", "phong", "lambert", "toon"] as const) {
    const lib = (THREE.ShaderLib as unknown as Record<string, { uniforms: Record<string, unknown> }>)[id];
    if (lib && !lib.uniforms.uBlindDrop) lib.uniforms.uBlindDrop = BLIND_DROP;
  }
}
installBlindDropUniform();

export const BLIND = {
  // Slat geometry lives in slatShadow.ts (System 4 rev 6): the analytic shadow term is baked
  // from the same numbers, so the two cannot drift apart.
  slatWidth: SLAT.width,
  pitch: SLAT.pitch,
  /** Outer (street-side) edge raised by this angle from horizontal (nominal; ±5° per blind). */
  tiltDeg: SLAT.tiltDeg,
  /** Slat stack centre-line z: 40 mm in from the interior wall plane, 85 mm inside the glass. */
  zCentre: SLAT.zCentre,
  headrail: { h: SLAT.headrailH, d: 0.025 },
  /** Closed steel channel, 1.5× the slat's tilted height (≈ 12.5 mm) so it reads as a rail, not another slat. */
  bottomRail: { h: SLAT.bottomRailH, d: 0.027 },
  /** Three ladders: the slats are 49.5" — 1" blinds go to four ladders above 52". The outer
   *  pair sits 3" from the ends as on the real thing; rev 4's 8" read as a second pair of
   *  frame verticals from the lot. */
  ladderOffsets: [-0.55, 0, 0.55],
  /** Route hole: oval, long axis along the slat, cord centred. */
  hole: { along: 0.012, across: 0.006 },
} as const;

/** Per-slat deformation the vertex generator evaluates along the slat. */
interface SlatShape {
  /** Slat centre-line height at the ladders (supports). */
  y: number;
  /** Base tilt (radians, negative = street edge up in this frame). */
  tilt: number;
  /** Sag amplitude between ladders (m) and cantilever droop at the free ends (m). */
  sag: number;
  droop: number;
  /** Optional crease: position along the slat, extra tilt beyond it, tip drop beyond it. */
  kink?: { x: number; dTilt: number; drop: number };
  /** x jitter of the whole slat. */
  dx: number;
  dz: number;
}

/**
 * One slat as a curved strip (chord `w`, sagitta 2 mm, convex face up) sampled every
 * ~15 mm along x, with an oval route hole at each ladder. Every vertex passes through
 * the same deformation (tilt(x), sag(x), kink) so the slat is a real bent sheet.
 * Returns positions / normals / uvs (non-indexed triangles) appended to the arrays.
 */
function appendSlat(out: { pos: number[]; nor: number[]; uv: number[]; col: number[] }, length: number, w: number, ladders: readonly number[], shape: SlatShape, tone: [number, number, number], cx: number, zc: number): void {
  const R = (w * w / 4 + 0.002 * 0.002) / (2 * 0.002);
  const aArc = Math.asin(w / 2 / R);
  const span = ladders[1] - ladders[0]; // ladder pitch (equal)
  const xEnd = length / 2;
  const kink = shape.kink;
  // Centre-line drop below the support height at x (sag between ladders, droop past the outer ones).
  const dropAt = (x: number): number => {
    const ax = Math.abs(x);
    if (ax <= ladders[ladders.length - 1] + 1e-9) {
      // Which span? Parabolic sag, zero at the supports.
      const t = ((x - ladders[0]) / span) % 1;
      const tt = t < 0 ? t + 1 : t;
      return shape.sag * 4 * tt * (1 - tt);
    }
    const over = (ax - ladders[ladders.length - 1]) / (xEnd - ladders[ladders.length - 1]);
    return shape.droop * over * over;
  };
  const tiltAt = (x: number): number => {
    let t = shape.tilt;
    if (kink) {
      const s = Math.sign(kink.x);
      const past = (x - kink.x) * s; // metres past the crease toward the end
      if (past > 0) t += kink.dTilt * Math.min(1, past / 0.02);
    }
    return t;
  };
  const kinkDrop = (x: number): number => {
    if (!kink) return 0;
    const s = Math.sign(kink.x);
    const past = (x - kink.x) * s;
    if (past <= 0) return 0;
    return kink.drop * past / (xEnd - Math.abs(kink.x));
  };
  // Vertex in the flat (x, v) slat plane → world.
  const P = (x: number, v: number, o: number[]) => {
    const phi = (v / (w / 2)) * aArc;
    const yy = R * Math.cos(phi) - R * Math.cos(aArc); // arc height above the chord
    const zz = R * Math.sin(phi);
    const t = tiltAt(x), c = Math.cos(t), s = Math.sin(t);
    const yr = yy * c - zz * s, zr = yy * s + zz * c;
    o.push(cx + shape.dx + x, shape.y - dropAt(x) - kinkDrop(x) + yr, zc + shape.dz + zr);
  };
  const N = (x: number, v: number, o: number[]) => {
    const phi = (v / (w / 2)) * aArc;
    const ny = Math.cos(phi), nz = Math.sin(phi);
    const t = tiltAt(x), c = Math.cos(t), s = Math.sin(t);
    o.push(0, ny * c - nz * s, ny * s + nz * c);
  };
  // Winding: every caller lists its corners counter-clockwise in the (x, v) chart, which in
  // world (x, z) is clockwise seen from +y — a geometric normal pointing DOWN, opposite the
  // authored normal N() (up, the crown's convex face). Emit c before b so the front face is
  // the up face. System 4 rev 3: with the two disagreeing, three's DoubleSide flip
  // (`normal *= faceDirection`) turned the room-facing up face's normal down-and-street for
  // every fragment, so the sun (which lights the up face at cos 0.26 through the gap above)
  // contributed nothing and the slats read as a dark grille from every interior pose.
  const tri = (a: [number, number], b: [number, number], c: [number, number]) => {
    for (const [x, v] of [a, c, b]) {
      P(x, v, out.pos);
      N(x, v, out.nor);
      out.uv.push((x + xEnd) / length, v / w + 0.5);
      out.col.push(tone[0], tone[1], tone[2]);
    }
  };
  const quad = (x0: number, x1: number, v0: number, v1: number) => {
    tri([x0, v0], [x1, v0], [x1, v1]);
    tri([x0, v0], [x1, v1], [x0, v1]);
  };
  const rows = 4; // across the slat: 4 cells carry the 2 mm crown
  const vAt = (j: number) => -w / 2 + (w * j) / rows;
  // Plain segments between hole patches; patches are 18 mm wide around each ladder.
  const halfPatch = 0.009;
  const cuts: number[] = [-xEnd];
  for (const lx of ladders) cuts.push(lx - halfPatch, lx + halfPatch);
  cuts.push(xEnd);
  for (let k = 0; k < cuts.length - 1; k += 2) {
    const xa = cuts[k], xb = cuts[k + 1];
    const n = Math.max(1, Math.round((xb - xa) / 0.02));
    for (let i = 0; i < n; i++) {
      const x0 = xa + ((xb - xa) * i) / n, x1 = xa + ((xb - xa) * (i + 1)) / n;
      for (let j = 0; j < rows; j++) quad(x0, x1, vAt(j), vAt(j + 1));
    }
  }
  // Hole patches: annulus between the patch rectangle and the oval, stitched by angle.
  const ha = BLIND.hole.along / 2, hb = BLIND.hole.across / 2;
  for (const lx of ladders) {
    const outer: Array<[number, number]> = [];
    const x0 = lx - halfPatch, x1 = lx + halfPatch;
    for (let j = 0; j <= rows; j++) outer.push([x1, vAt(j)]); // right column, bottom → top
    outer.push([lx, w / 2]); // top edge midpoint
    for (let j = rows; j >= 0; j--) outer.push([x0, vAt(j)]); // left column, top → bottom
    outer.push([lx, -w / 2]); // bottom edge midpoint
    const inner: Array<[number, number]> = [];
    const nIn = 16;
    for (let i = 0; i < nIn; i++) {
      const a = (i / nIn) * Math.PI * 2;
      inner.push([lx + ha * Math.cos(a), hb * Math.sin(a)]);
    }
    const ang = (p: [number, number]) => Math.atan2(p[1], p[0] - lx);
    const O = outer.map((p) => ({ p, a: ang(p) })).sort((p, q) => p.a - q.a);
    const I = inner.map((p) => ({ p, a: ang(p) })).sort((p, q) => p.a - q.a);
    // Merge-walk both loops by angle; each step emits one triangle across the annulus.
    let io = 0, ii = 0;
    const no = O.length, ni = I.length;
    while (io < no || ii < ni) {
      const ao = io < no ? O[io].a : Infinity, ai = ii < ni ? I[ii].a : Infinity;
      const oCur = O[io % no].p, iCur = I[ii % ni].p;
      if (ao <= ai) {
        const oNext = O[(io + 1) % no].p;
        tri(oCur, oNext, iCur);
        io++;
      } else {
        const iNext = I[(ii + 1) % ni].p;
        tri(oCur, iNext, iCur);
        ii++;
      }
    }
  }
}

/**
 * feat-blinds-f: one raisable blind. `setDrop(d)` (1 = hanging as built, 0 = fully raised) moves
 * the slats (they stack up from the bottom onto the rising bottom rail, flattening as they are
 * picked up), the bottom-rail assembly, and shortens the ladder / lift cords from the headrail;
 * it also writes `BLIND_DROP.value[wi]` so the analytic stripe term follows. Pull cords + tassel
 * stay static (noted in BUILD.md).
 */
export interface BlindRig {
  wi: number;
  /** Window centre / clear opening / a look-at point on the glass at eye height. */
  cx: number;
  x0: number;
  x1: number;
  focus: THREE.Vector3;
  /** Current drop 0..1. */
  drop: number;
  setDrop(d: number): void;
  /** Everything that casts (the rail assembly) — for the caller's shadow-once bookkeeping. */
  rail: THREE.Group;
}

export interface BlindsResult {
  /** One merged slat mesh per window. */
  slats: THREE.Mesh[];
  /** feat-blinds-f: per-window raise/lower rigs. */
  rigs: BlindRig[];
}

export function buildBlinds(parent: THREE.Group, pal: Palette): BlindsResult {
  const b = new MergedBuilder();
  const fw = SLAT.frameFace; // window frame face (Shell.ts)
  const openW = WINDOW.width - 2 * fw; // clear between frame members
  const layout = blindLayout(); // per-window tilt / drop, shared with the analytic shadow (slatShadow.ts)
  const slatLen = openW - 0.012;
  const zc = BLIND.zCentre;
  const slatMat = pal.slat.clone();
  slatMat.vertexColors = true;
  slatMat.name = "slat";
  (slatMat.defines ??= {}).SLAT_NO_ANALYTIC = 1; // a slat's own u-range is never inside a gap
  installLotGroundFill(slatMat); // System 4 rev 4: sunlit-lot bounce onto the undersides (Lighting.ts)

  const yHeadTop = WINDOW.head - fw; // underside of the head frame member
  const yHead0 = yHeadTop - BLIND.headrail.h;
  const yFirst = yHead0 - 0.012;
  const yStopFull = WINDOW.sill + fw + 0.03; // fully lowered: bottom rail clear of the sill frame
  const countFull = Math.floor((yFirst - yStopFull) / BLIND.pitch) + 1;

  // Rev 6: 0.5 mm rungs and 1.1 mm ladder cords (1.3 / 0.7 read as chunky "N" loops in blind-macro)
  const rung = new THREE.CylinderGeometry(0.00025, 0.00025, BLIND.slatWidth - 0.002, 5);
  rung.rotateX(Math.PI / 2);
  const cordR = 0.00055; // 1.1 mm braided ladder / lift cord
  const q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  const meshes: THREE.Mesh[] = [];
  const rigs: BlindRig[] = [];
  // feat-blinds-f: the stack a fully raised blind makes under the headrail (1.4 mm per slat).
  const stackPitch = 0.0014;
  const stackFullH = countFull * stackPitch;

  WINDOW.centersX.forEach((cx, wi) => {
    // feat-blinds-f: per-slat rest height / tilt and the vertex range each slat occupies in the
    // merged slat geometry (and in the per-window rung mesh), for the raise animation.
    const slatMeta: Array<{ y: number; tilt: number; v0: number; v1: number }> = [];
    const rungB = new MergedBuilder();
    const railB = new MergedBuilder();
    // Per-blind character: tilt 25 ± 5°; drop — two hang to the sill, two were pulled up 3–8 cm,
    // the last one in the row 15–30 cm (blindLayout draws both from this blind's generator).
    const { rng, x0, x1, tilt, raised, yRail, hanging, stacked } = layout[wi];
    const sagAmp = 0.001 + rng() * 0.002; // 1–3 mm between ladders (the general run)
    const droopAmp = 0.0004 + rng() * 0.0008;
    // Headrail: 25 × 38 steel channel in the slat colour; a valance lip on the room face
    b.rbox(pal.slatRail, [x0 + 0.003, yHead0, zc - BLIND.headrail.d / 2], [x1 - 0.003, yHeadTop, zc + BLIND.headrail.d / 2], 0.002);
    b.rbox(pal.slatRail, [x0 + 0.003, yHead0 - 0.004, zc - BLIND.headrail.d / 2 - 0.002], [x1 - 0.003, yHead0 + 0.012, zc - BLIND.headrail.d / 2], 0.001);
    // One creased slat per blind (bent by a hand or a mop handle 15–25 cm from one end): the
    // part past the crease twists 14–25° and its tip droops 8–15 mm — a visible discontinuity.
    // Plus one slat that lost its ladder tension and sags 6–10 mm between ladders.
    // Both sit in the bottom 4–20 hanging slats (y ≈ 1.0–1.35 m) — random heights, but always
    // in the band the `window` pose (bottom ~22 slats) and a seated eye see through the glass;
    // rev 4's 66–94 % band still put the crease just above that frame.
    const kinks = new Map<number, SlatShape["kink"]>();
    const bandK = () => Math.min(hanging - 4, Math.max(2, hanging - 4 - Math.floor(rng() * 16)));
    const kinkK = bandK();
    {
      // Crease 11–19 cm from one end: the part past it twists 22–34° and its tip BENDS UP
      // 20–28 mm (the outer ladder rung holds the slat from below, so a bent end rises off it
      // toward the slat above — the way abused mini-blinds actually look).
      // Always the −x end: the `window` pose (yaw 180, camera 0.1 m off the window's −x side)
      // clips the +x end at the frame edge, so a crease there is never in frame (rev 4/5 WIP).
      rng(); // keep the per-blind sequence (sag slat, tones) stable
      const side = -1;
      kinks.set(kinkK, { x: side * (0.43 + rng() * 0.08), dTilt: THREE.MathUtils.degToRad((rng() < 0.5 ? -1 : 1) * (22 + rng() * 12)), drop: -(0.02 + rng() * 0.008) });
    }
    let sagK = bandK();
    if (Math.abs(sagK - kinkK) < 3) sagK = kinkK + 4 < hanging - 1 ? kinkK + 4 : Math.max(2, kinkK - 4);
    const bigSag = 0.006 + rng() * 0.004;
    const out = { pos: [] as number[], nor: [] as number[], uv: [] as number[], col: [] as number[] };
    const slatAt = (k: number): { y: number; tilt: number } => {
      if (k < hanging) return { y: yFirst - k * BLIND.pitch, tilt };
      // Stacked on the bottom rail: 1.2 mm apart, nearly flat
      const i = k - hanging;
      return { y: yRail + BLIND.bottomRail.h / 2 + 0.003 + (stacked - 1 - i) * 0.0014, tilt: tilt * 0.3 };
    };
    for (let k = 0; k < countFull; k++) {
      const base = slatAt(k);
      const shape: SlatShape = {
        y: base.y + (rng() - 0.5) * 0.0008,
        // ±2.5° tilt jitter: each slat catches the sun a little differently → visible tone steps
        tilt: -base.tilt + THREE.MathUtils.degToRad((rng() - 0.5) * 5.0),
        sag: k === sagK ? bigSag : sagAmp * (0.7 + rng() * 0.6),
        droop: droopAmp * (0.6 + rng() * 0.8),
        kink: kinks.get(k),
        dx: (rng() - 0.5) * 0.002,
        dz: 0,
      };
      // ±4 % per-slat tone: no two neighbours share a value, so the stack is not one flat sheet
      const t = 0.96 + rng() * 0.08;
      const v0 = out.pos.length / 3;
      appendSlat(out, slatLen, BLIND.slatWidth, BLIND.ladderOffsets, shape, [t, t * (0.995 + rng() * 0.01), t * (0.99 + rng() * 0.02)], cx, zc);
      slatMeta.push({ y: shape.y, tilt: shape.tilt, v0, v1: out.pos.length / 3 });
      // Ladder rungs: one thread under each slat at each ladder, following the slat's tilt
      e.set(shape.tilt, 0, 0);
      q.setFromEuler(e);
      for (const lo of BLIND.ladderOffsets) {
        const rm = new THREE.Matrix4().compose(new THREE.Vector3(cx + lo + shape.dx, shape.y - 0.0009, zc), q, one);
        rungB.add(rung.clone(), pal.cord, rm);
      }
    }
    // feat-blinds-f: the rungs of this window as their own mesh (they ride with their slats).
    const rungMesh = rungB.build(parent, { name: `blind-rungs-${wi}`, castShadow: false })[0];
    const rungPer = rung.attributes.position.count * BLIND.ladderOffsets.length;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(out.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(out.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(out.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(out.col, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, slatMat);
    // System 4 rev 6: the slats are NOT in the sun's shadow map — their stripes are the analytic
    // term in slatShadow.ts (the map's PCSS filter floor was filling the stripe troughs). They
    // still receive the map (frame, headrail) and skip the analytic term on themselves.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = `blind-slats-${wi}`;
    parent.add(mesh);
    meshes.push(mesh);

    // feat-blinds-f: ladder + lift cords in a group hung from the headrail; `scale.y` shortens
    // them as the rail rises (the real cords bunch inside the stack).
    const cordLen = yHead0 - yRail;
    const cordGroup = new THREE.Group();
    cordGroup.name = `blind-cords-${wi}`;
    cordGroup.position.y = yHead0;
    parent.add(cordGroup);
    const cordB = new MergedBuilder();
    for (const lo of BLIND.ladderOffsets) {
      // Ladder cords: same 1.3 mm gauge front and rear, hugging the slat edges
      for (const zs of [-1, 1]) {
        const zcord = zc + zs * (BLIND.slatWidth / 2 * Math.cos(tilt) + 0.0006);
        const cord = new THREE.CylinderGeometry(cordR, cordR, cordLen, 6);
        cord.translate(cx + lo, -cordLen / 2, zcord);
        cordB.add(cord, pal.cord);
      }
      // Lift cord: straight down through the route holes to the bottom rail
      const lift = new THREE.CylinderGeometry(cordR, cordR, cordLen + 0.006, 6);
      lift.translate(cx + lo, -cordLen / 2, zc);
      cordB.add(lift, pal.cord);
    }
    cordB.build(cordGroup, { name: `blind-cords-${wi}` });
    // Bottom rail: closed 27 × 19 mm steel channel with a slight crown, plastic end caps, and a
    // cord button under each outer ladder where the lift cord is knotted off (the centre cord
    // ties inside the rail). feat-blinds-f: its own group so it can ride up with the blind.
    railB.rbox(pal.slatRail, [x0 + 0.006, yRail - BLIND.bottomRail.h / 2, zc - BLIND.bottomRail.d / 2], [x1 - 0.006, yRail + BLIND.bottomRail.h / 2, zc + BLIND.bottomRail.d / 2], 0.003, 3);
    for (const [ex0, ex1] of [[x0 + 0.003, x0 + 0.016], [x1 - 0.016, x1 - 0.003]])
      railB.rbox(pal.slatCap, [ex0, yRail - BLIND.bottomRail.h / 2 - 0.001, zc - BLIND.bottomRail.d / 2 - 0.001], [ex1, yRail + BLIND.bottomRail.h / 2 + 0.001, zc + BLIND.bottomRail.d / 2 + 0.001], 0.002, 2);
    for (const lo of [BLIND.ladderOffsets[0], BLIND.ladderOffsets[2]]) {
      const button = new THREE.CylinderGeometry(0.006, 0.0065, 0.0035, 14);
      button.translate(cx + lo, yRail - BLIND.bottomRail.h / 2 - 0.00175, zc);
      railB.add(button, pal.slatCap);
    }
    const railGroup = new THREE.Group();
    railGroup.name = `blind-rail-${wi}`;
    parent.add(railGroup);
    railB.build(railGroup, { name: `blind-rail-${wi}` });

    // feat-blinds-f: the rig. Rail travel from its rest height to the stack under the headrail;
    // slat k is picked up when the rising stack reaches it: y' = max(rest, stackBase + (N−1−k)·1.4 mm),
    // and flattens (tilt → 0.3×) over its first centimetre of lift, rotating about its own centre line.
    {
      const yRail0 = yRail;
      const yRailUp = yHead0 - 0.012 - stackFullH - 0.003 - BLIND.bottomRail.h / 2;
      const pos = g.attributes.position as THREE.BufferAttribute;
      const nor = g.attributes.normal as THREE.BufferAttribute;
      const pos0 = (pos.array as Float32Array).slice();
      const nor0 = (nor.array as Float32Array).slice();
      const rPos = rungMesh.geometry.attributes.position as THREE.BufferAttribute;
      const rNor = rungMesh.geometry.attributes.normal as THREE.BufferAttribute;
      const rPos0 = (rPos.array as Float32Array).slice();
      const rNor0 = (rNor.array as Float32Array).slice();
      // Culling bounds: the whole travel, fixed once (no per-frame bounding recompute).
      for (const gg of [g, rungMesh.geometry]) {
        gg.boundingBox!.min.y = Math.min(gg.boundingBox!.min.y, yRail0 - BLIND.bottomRail.h);
        gg.boundingBox!.max.y = Math.max(gg.boundingBox!.max.y, yHeadTop);
        gg.boundingBox!.getBoundingSphere(gg.boundingSphere!);
      }
      const move = (src: Float32Array, dst: Float32Array, nsrc: Float32Array, ndst: Float32Array, v0: number, v1: number, yc: number, dy: number, ang: number) => {
        const c = Math.cos(ang), s = Math.sin(ang);
        for (let v = v0; v < v1; v++) {
          const i = v * 3;
          const ry = src[i + 1] - yc, rz = src[i + 2] - zc;
          dst[i] = src[i];
          dst[i + 1] = yc + dy + ry * c - rz * s;
          dst[i + 2] = zc + ry * s + rz * c;
          const ny = nsrc[i + 1], nz = nsrc[i + 2];
          ndst[i] = nsrc[i];
          ndst[i + 1] = ny * c - nz * s;
          ndst[i + 2] = ny * s + nz * c;
        }
      };
      const rig: BlindRig = {
        wi,
        cx,
        x0,
        x1,
        focus: new THREE.Vector3(cx, 1.55, zc - 0.05),
        drop: 1,
        rail: railGroup,
        setDrop(dIn: number) {
          const d = Math.min(1, Math.max(-0.006, dIn));
          if (d === this.drop) return;
          this.drop = d;
          BLIND_DROP.value[wi] = Math.min(1, Math.max(0, d));
          const yR = yRail0 + (1 - d) * (yRailUp - yRail0);
          railGroup.position.y = yR - yRail0;
          cordGroup.scale.y = Math.max(0.002, (yHead0 - yR) / cordLen);
          const stackBase = yR + BLIND.bottomRail.h / 2 + 0.003;
          const dArr = pos.array as Float32Array, nArr = nor.array as Float32Array;
          const rdArr = rPos.array as Float32Array, rnArr = rNor.array as Float32Array;
          for (let k = 0; k < slatMeta.length; k++) {
            const m = slatMeta[k];
            const yStack = stackBase + (countFull - 1 - k) * stackPitch;
            const lift = Math.max(0, yStack - m.y);
            // Hanging slats carry tilt × 1; the built stack already has × 0.3. Flatten the lifted ones.
            const f = k < hanging ? Math.min(1, lift / 0.01) : 0;
            const ang = -0.7 * m.tilt * f;
            move(pos0, dArr, nor0, nArr, m.v0, m.v1, m.y, lift, ang);
            move(rPos0, rdArr, rNor0, rnArr, k * rungPer, (k + 1) * rungPer, m.y, lift, ang);
          }
          pos.needsUpdate = true;
          nor.needsUpdate = true;
          rPos.needsUpdate = true;
          rNor.needsUpdate = true;
        },
      };
      rigs.push(rig);
    }
    // Tilt wand: 12 mm tan acrylic rod, 0.5 m, on a swivel hook under the headrail at the
    // left jamb. Hangs 45 mm in front of the slat edges so it silhouettes against the glass
    // (rev 2: a clear rod 16 mm off the slats vanished into them at any distance).
    {
      const wx = x0 + 0.045, wTop = yHead0 - 0.002, wz = zc - 0.045;
      const hook = new THREE.CylinderGeometry(0.0025, 0.0025, 0.03, 8);
      hook.translate(wx, wTop - 0.015, wz + 0.002);
      b.add(hook, pal.darkMetal);
      const sleeve = new THREE.CylinderGeometry(0.0065, 0.0065, 0.02, 10);
      sleeve.translate(wx, wTop - 0.036, wz);
      b.add(sleeve, pal.slatCap);
      const wand = new THREE.CylinderGeometry(0.006, 0.006, 0.5, 12);
      // Wands hang a degree or two off plumb (the hook is a loose swivel)
      wand.rotateZ(THREE.MathUtils.degToRad((rng() - 0.5) * 3));
      wand.translate(wx, wTop - 0.046 - 0.25, wz);
      b.add(wand, pal.wand);
      const tip = new THREE.CylinderGeometry(0.0065, 0.004, 0.014, 12);
      tip.translate(wx, wTop - 0.046 - 0.5 - 0.006, wz);
      b.add(tip, pal.slatCap);
    }
    // Pull cords (two, 2 mm braided — 1.3 mm was under a pixel from the booth) out of the cord
    // lock at the right jamb, 6 mm apart, hanging 35 mm in front of the slats so they silhouette
    // against the glass, through a cord equaliser into one tassel. A blind that was pulled up
    // has that much more cord hanging: the tassel drops by the raised amount (never below the stool).
    {
      const lx = x1 - 0.08, zp = zc - 0.035, pullR = 0.001;
      const yT = Math.max(WINDOW.sill + fw + 0.02, WINDOW.sill + fw + 0.068 - raised * 0.6);
      const yEq = yT + 0.065;
      // The PAIR runs the whole way from the cord lock into the acorn (both cords are knotted
      // inside it); the equaliser is a small slide on the pair a hand's width above the tassel.
      for (const dx of [-0.003, 0.003]) {
        const cord = new THREE.CylinderGeometry(pullR, pullR, yHead0 - yT, 6);
        cord.translate(lx + dx, (yHead0 + yT) / 2, zp);
        b.add(cord, pal.cord);
      }
      b.rbox(pal.slatCap, [lx - 0.009, yEq - 0.014, zp - 0.0045], [lx + 0.009, yEq + 0.004, zp + 0.0045], 0.0015, 2); // equaliser
      // Cream acorn tassel: 20 mm Ø × 56 mm — a narrow neck under the cords flaring into a
      // full body, then tapering to a domed tip. Big enough to be read as an acorn at 2 m.
      const tassel = new THREE.LatheGeometry(
        // bottom → top (LatheGeometry needs increasing y for outward normals)
        [[0, -0.056], [0.004, -0.055], [0.007, -0.05], [0.0095, -0.04], [0.01, -0.028], [0.0095, -0.02], [0.008, -0.015], [0.0055, -0.012], [0.0045, -0.008], [0.0045, -0.003], [0.0035, 0], [0, 0]].map(([r, y]) => new THREE.Vector2(r, y)),
        16,
      );
      tassel.translate(lx, yT, zp);
      b.add(tassel, pal.tassel);
    }
  });
  b.build(parent, { name: "blinds" });
  return { slats: meshes, rigs };
}
