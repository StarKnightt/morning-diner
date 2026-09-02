/**
 * System 3: 1" aluminium venetian blinds, inside-mounted in every front-window
 * reveal, fully lowered, slats tilted ~25° outer-edge-up.
 *
 * Why 25° and not the 45° "half open" of the brief: the placeholder sun (el 35°,
 * az 38° off the window normal) has a profile angle β ≈ 41.6° in the window's
 * vertical plane. Stripe darkness is w·|sin(β − θ)| / (p·cos β) (REFERENCE §1); at
 * θ = 45° the slats are parallel to the beam and pass it as one sheet with hairline
 * shadows. θ = 25° blocks ≈ 43 % → legible 11 mm dark / 14 mm light stripes at
 * 24.8 mm pitch on the floor. System 4 re-tunes θ with the final sun.
 *
 * Geometry: one InstancedMesh for all slats (curved 25 × 0.2 mm strip, 1 mm sag
 * baked, per-slat ±0.5° tilt and ±0.3 mm drop jitter, two kinked slats per
 * blind); ladder cords, rungs, rails, tilt wand and lift cords merged per material.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { makeRng } from "../core/rng";
import { ROOM, WINDOW } from "./layout";

export const BLIND = {
  slatWidth: 0.025,
  pitch: 0.022,
  /** Outer (street-side) edge raised by this angle from horizontal. */
  tiltDeg: 25,
  /** Slat stack centre-line z: 40 mm in from the interior wall plane, 85 mm inside the glass. */
  zCentre: ROOM.zFront + 0.04,
  headrail: { h: 0.04, d: 0.025 },
  bottomRail: { h: 0.01, d: 0.025 },
  ladderOffsets: [-0.42, 0, 0.42],
} as const;

/** Curved slat strip: chord `w`, sagitta 2 mm, convex face up, gentle 1 mm sag between the three ladders. */
function slatGeometry(length: number, w: number): THREE.BufferGeometry {
  const along = 28, across = 6;
  const R = (w * w / 4 + 0.002 * 0.002) / (2 * 0.002);
  const a = Math.asin(w / 2 / R);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= along; i++) {
    const u = i / along;
    const x = (u - 0.5) * length;
    // Three supports at 1/6, 1/2, 5/6 → sag between them, tiny droop at the free ends.
    const s = Math.abs(Math.sin(Math.PI * 3 * (u - 1 / 6))) * (u > 1 / 6 && u < 5 / 6 ? 1 : 0.4);
    const sag = -0.001 * s;
    for (let j = 0; j <= across; j++) {
      const v = j / across;
      const phi = -a + 2 * a * v;
      const z = R * Math.sin(phi);
      const y = R * Math.cos(phi) - R * Math.cos(a) + sag;
      pos.push(x, y, z);
      nor.push(0, Math.cos(phi), Math.sin(phi));
      uv.push(u, v);
    }
  }
  for (let i = 0; i < along; i++)
    for (let j = 0; j < across; j++) {
      const p = i * (across + 1) + j, q = p + across + 1;
      idx.push(p, q, p + 1, q, q + 1, p + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export interface BlindsResult {
  slats: THREE.InstancedMesh;
}

export function buildBlinds(parent: THREE.Group, pal: Palette): BlindsResult {
  const rng = makeRng(3301);
  const b = new MergedBuilder();
  const fw = 0.04; // window frame face (Shell.ts)
  const openW = WINDOW.width - 2 * fw; // clear between frame members
  const slatLen = openW - 0.012;
  const zc = BLIND.zCentre;
  const tilt = THREE.MathUtils.degToRad(BLIND.tiltDeg);

  const yHeadTop = WINDOW.head - fw; // underside of the head frame member
  const yHead0 = yHeadTop - BLIND.headrail.h;
  const yFirst = yHead0 - 0.012;
  const yStop = WINDOW.sill + fw + 0.03; // keep the bottom rail clear of the sill frame
  const count = Math.floor((yFirst - yStop) / BLIND.pitch) + 1;
  const yLast = yFirst - (count - 1) * BLIND.pitch;
  const yRail = yLast - 0.02; // bottom rail centre

  const slatGeo = slatGeometry(slatLen, BLIND.slatWidth);
  const slats = new THREE.InstancedMesh(slatGeo, pal.slat, count * WINDOW.centersX.length);
  slats.castShadow = true;
  slats.receiveShadow = true;
  slats.name = "blind-slats";
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
  const rung = new THREE.BoxGeometry(0.0008, 0.0008, BLIND.slatWidth - 0.002);
  let inst = 0;

  for (const cx of WINDOW.centersX) {
    const x0 = cx - openW / 2, x1 = cx + openW / 2;
    // Headrail: 40 × 25 steel channel, almond; end caps; a valance lip on the room face
    b.rbox(pal.slatRail, [x0 + 0.003, yHead0, zc - BLIND.headrail.d / 2], [x1 - 0.003, yHeadTop, zc + BLIND.headrail.d / 2], 0.002);
    b.rbox(pal.slatRail, [x0 + 0.003, yHead0 - 0.004, zc - BLIND.headrail.d / 2 - 0.002], [x1 - 0.003, yHead0 + 0.012, zc - BLIND.headrail.d / 2], 0.001);
    // Two kinked slats per blind
    const kinks = new Set<number>();
    while (kinks.size < 2) kinks.add(4 + Math.floor(rng() * (count - 8)));
    for (let k = 0; k < count; k++) {
      const y = yFirst - k * BLIND.pitch + (rng() - 0.5) * 0.0006;
      let rx = -tilt + THREE.MathUtils.degToRad((rng() - 0.5) * 1.0);
      let dz = 0;
      if (kinks.has(k)) {
        rx += THREE.MathUtils.degToRad((rng() - 0.5) * 8);
        dz = (rng() - 0.5) * 0.008;
      }
      e.set(rx, 0, THREE.MathUtils.degToRad((rng() - 0.5) * 0.2));
      q.setFromEuler(e);
      p.set(cx + (rng() - 0.5) * 0.002, y, zc + dz);
      m.compose(p, q, s);
      slats.setMatrixAt(inst, m);
      // ±4 % per-slat tone: no two neighbours share a value, so the stack is not one flat sheet
      const tone = 0.96 + rng() * 0.08;
      slats.setColorAt(inst, col.setRGB(tone, tone * (0.995 + rng() * 0.01), tone * (0.99 + rng() * 0.02)));
      inst++;
      // Ladder rungs: one thread under each slat at each ladder, following the slat's tilt
      for (const lo of BLIND.ladderOffsets) {
        const rm = new THREE.Matrix4().compose(new THREE.Vector3(cx + lo, y - 0.0009, zc + dz), q, s);
        b.add(rung.clone(), pal.cord, rm);
      }
    }
    // Ladder cords: two per ladder, at the slat edges, headrail to bottom rail
    for (const lo of BLIND.ladderOffsets)
      for (const zs of [-1, 1]) {
        const zcord = zc + zs * (BLIND.slatWidth / 2 * Math.cos(tilt) + 0.0006);
        // cords shift up/down with the tilted edge they hug
        b.box(pal.cord, [cx + lo - 0.00075, yRail, zcord - 0.00075], [cx + lo + 0.00075, yHead0, zcord + 0.00075]);
      }
    // Bottom rail 25 × 10 mm with a slight crown, end caps
    b.rbox(pal.slatRail, [x0 + 0.004, yRail - BLIND.bottomRail.h / 2, zc - BLIND.bottomRail.d / 2], [x1 - 0.004, yRail + BLIND.bottomRail.h / 2, zc + BLIND.bottomRail.d / 2], 0.003, 3);
    // Tilt wand: 8 mm clear plastic rod, 0.6 m, hung from the headrail at the left end
    {
      const wx = x0 + 0.06, wTop = yHead0 - 0.002;
      const hook = new THREE.CylinderGeometry(0.0025, 0.0025, 0.03, 8);
      hook.translate(wx, wTop - 0.015, zc - 0.014);
      b.add(hook, pal.darkMetal);
      const wand = new THREE.CylinderGeometry(0.004, 0.004, 0.6, 6);
      wand.translate(wx, wTop - 0.03 - 0.3, zc - 0.016);
      b.add(wand, pal.wand);
    }
    // Lift cords (two, 1.6 mm) at the right end, down to ~1.35 m with a tassel
    {
      const lx = x1 - 0.05, yT = 1.32;
      for (const dx of [-0.004, 0.004]) b.box(pal.cord, [lx + dx - 0.0008, yT, zc - 0.0158], [lx + dx + 0.0008, yHead0, zc - 0.0142]);
      const tassel = new THREE.CylinderGeometry(0.006, 0.009, 0.045, 10);
      tassel.translate(lx, yT - 0.02, zc - 0.015);
      b.add(tassel, pal.wand);
    }
  }
  slats.instanceMatrix.needsUpdate = true;
  if (slats.instanceColor) slats.instanceColor.needsUpdate = true;
  slats.computeBoundingSphere();
  parent.add(slats);
  b.build(parent, { name: "blinds" });
  return { slats };
}
