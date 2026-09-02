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
 * baked, 10 × 6 mm lift-cord route slots at the three ladder positions, per-slat
 * ±2.5° tilt and ±0.3 mm drop jitter, ±4 % tone, 3–4 kinked slats per blind);
 * ladders (1.3 mm braided cords front + rear with a rung under every slat), lift
 * cords through the slots, 40 × 25 headrail with valance lip, 25 × 12 bottom rail
 * with end caps, 0.5 m tilt wand on the left jamb, two pull cords + tassel on the
 * right hanging to sill height — all merged per material.
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
  bottomRail: { h: 0.0125, d: 0.025 },
  ladderOffsets: [-0.42, 0, 0.42],
} as const;

/**
 * Curved slat strip: chord `w`, sagitta 2 mm, convex face up, gentle 1 mm sag between the
 * three ladders, and a 10 × 6 mm route slot punched at each ladder position for the lift cord.
 */
function slatGeometry(length: number, w: number, slotsX: readonly number[]): THREE.BufferGeometry {
  const along = 112, across = 8;
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
  const cellW = length / along;
  for (let i = 0; i < along; i++) {
    const xc = (i + 0.5) / along * length - length / 2;
    const inSlot = slotsX.some((sx) => Math.abs(xc - sx) < cellW * 0.5 + 1e-6);
    for (let j = 0; j < across; j++) {
      if (inSlot && (j === 3 || j === 4)) continue; // the slot: middle 2 of 8 rows ≈ 6 mm
      const p = i * (across + 1) + j, q = p + across + 1;
      idx.push(p, q, p + 1, q, q + 1, p + 1);
    }
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

  const slatGeo = slatGeometry(slatLen, BLIND.slatWidth, BLIND.ladderOffsets);
  const slats = new THREE.InstancedMesh(slatGeo, pal.slat, count * WINDOW.centersX.length);
  slats.castShadow = true;
  slats.receiveShadow = true;
  slats.name = "blind-slats";
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
  const rung = new THREE.CylinderGeometry(0.00035, 0.00035, BLIND.slatWidth - 0.002, 5);
  rung.rotateX(Math.PI / 2);
  const cordR = 0.00065; // 1.3 mm braided ladder / lift cord
  let inst = 0;

  for (const cx of WINDOW.centersX) {
    const x0 = cx - openW / 2, x1 = cx + openW / 2;
    // Headrail: 40 × 25 steel channel, almond; end caps; a valance lip on the room face
    b.rbox(pal.slatRail, [x0 + 0.003, yHead0, zc - BLIND.headrail.d / 2], [x1 - 0.003, yHeadTop, zc + BLIND.headrail.d / 2], 0.002);
    b.rbox(pal.slatRail, [x0 + 0.003, yHead0 - 0.004, zc - BLIND.headrail.d / 2 - 0.002], [x1 - 0.003, yHead0 + 0.012, zc - BLIND.headrail.d / 2], 0.001);
    // 3–4 kinked slats per blind (bent once by a hand or a mop handle)
    const kinks = new Set<number>();
    const nK = 3 + Math.floor(rng() * 2);
    while (kinks.size < nK) kinks.add(3 + Math.floor(rng() * (count - 6)));
    for (let k = 0; k < count; k++) {
      const y = yFirst - k * BLIND.pitch + (rng() - 0.5) * 0.0006;
      // ±2.5° tilt jitter: each slat catches the sun a little differently → visible tone steps
      let rx = -tilt + THREE.MathUtils.degToRad((rng() - 0.5) * 5.0);
      let dz = 0;
      if (kinks.has(k)) {
        rx += THREE.MathUtils.degToRad((rng() < 0.5 ? -1 : 1) * (5 + rng() * 7));
        dz = (rng() - 0.5) * 0.01;
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
    const cordLen = yHead0 - yRail;
    for (const lo of BLIND.ladderOffsets) {
      // Ladder cords: same 1.3 mm gauge front and rear, hugging the slat edges
      for (const zs of [-1, 1]) {
        const zcord = zc + zs * (BLIND.slatWidth / 2 * Math.cos(tilt) + 0.0006);
        const cord = new THREE.CylinderGeometry(cordR, cordR, cordLen, 6);
        cord.translate(cx + lo, yRail + cordLen / 2, zcord);
        b.add(cord, pal.cord);
      }
      // Lift cord: straight down through the route slots to the bottom rail
      const lift = new THREE.CylinderGeometry(cordR, cordR, cordLen + 0.006, 6);
      lift.translate(cx + lo, yRail + cordLen / 2, zc);
      b.add(lift, pal.cord);
    }
    // Bottom rail 25 × 12.5 mm (1" × ½") with a slight crown, plastic end caps
    b.rbox(pal.slatRail, [x0 + 0.006, yRail - BLIND.bottomRail.h / 2, zc - BLIND.bottomRail.d / 2], [x1 - 0.006, yRail + BLIND.bottomRail.h / 2, zc + BLIND.bottomRail.d / 2], 0.003, 3);
    for (const [ex0, ex1] of [[x0 + 0.003, x0 + 0.014], [x1 - 0.014, x1 - 0.003]])
      b.rbox(pal.slatCap, [ex0, yRail - BLIND.bottomRail.h / 2 - 0.001, zc - BLIND.bottomRail.d / 2 - 0.001], [ex1, yRail + BLIND.bottomRail.h / 2 + 0.001, zc + BLIND.bottomRail.d / 2 + 0.001], 0.002, 2);
    // Tilt wand: 12 mm tan acrylic rod, 0.5 m, on a swivel hook under the headrail at the
    // left jamb. Hangs 30 mm in front of the slat edges so it silhouettes against the glass
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
      wand.translate(wx, wTop - 0.046 - 0.25, wz);
      b.add(wand, pal.wand);
      const tip = new THREE.CylinderGeometry(0.0065, 0.004, 0.014, 12);
      tip.translate(wx, wTop - 0.046 - 0.5 - 0.006, wz);
      b.add(tip, pal.slatCap);
    }
    // Pull cords (two, 1.3 mm) out of the cord lock at the right jamb, hanging 35 mm in front
    // of the slats, through a cord equaliser into one tassel whose tip stops 15 mm above the
    // sill stool — so it hangs BELOW the bottom rail instead of hiding inside it (rev 1 bug).
    {
      const lx = x1 - 0.08, yT = WINDOW.sill + fw + 0.068, zp = zc - 0.035;
      const yEq = yT + 0.06;
      for (const dx of [-0.003, 0.003]) {
        const cord = new THREE.CylinderGeometry(cordR, cordR, yHead0 - yEq, 6);
        cord.translate(lx + dx, (yHead0 + yEq) / 2, zp);
        b.add(cord, pal.cord);
      }
      b.rbox(pal.slatCap, [lx - 0.008, yEq - 0.012, zp - 0.004], [lx + 0.008, yEq + 0.004, zp + 0.004], 0.0015, 2); // equaliser
      const single = new THREE.CylinderGeometry(cordR, cordR, yEq - 0.012 - yT, 6);
      single.translate(lx, (yEq - 0.012 + yT) / 2, zp);
      b.add(single, pal.cord);
      // Acorn tassel, turned wood: 20 mm Ø × 50 mm with a waist and a rounded tip
      const tassel = new THREE.LatheGeometry(
        // bottom → top (LatheGeometry needs increasing y for outward normals)
        [[0, -0.053], [0.003, -0.052], [0.008, -0.044], [0.0105, -0.03], [0.0085, -0.02], [0.01, -0.006], [0.007, 0], [0, 0]].map(([r, y]) => new THREE.Vector2(r, y)),
        16,
      );
      tassel.translate(lx, yT, zp);
      b.add(tassel, pal.tassel);
    }
  }
  slats.instanceMatrix.needsUpdate = true;
  if (slats.instanceColor) slats.instanceColor.needsUpdate = true;
  slats.computeBoundingSphere();
  parent.add(slats);
  b.build(parent, { name: "blinds" });
  return { slats };
}
