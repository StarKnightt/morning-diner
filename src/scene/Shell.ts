/**
 * The building shell: floor, walls with window / door / pass-through / kitchen
 * door openings (reveals show the 250 mm wall), window frames with transom and
 * glass stops, sills with aprons, cove base, supply register, roof slab,
 * kitchen void, and the exterior ground the player starts on.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { DECAL, atlasQuad } from "../core/shapes";
import { makeRng } from "../core/rng";
import { dinerFloorWear, floorCrackSegments } from "../procedural/textures";
import { DOOR, KITCHEN_DOOR, PASS_THROUGH, REGISTER, ROOM, WINDOW } from "./layout";
import { buildGlazing } from "./Glazing";

export interface Opening {
  a0: number; // along-wall start
  a1: number; // along-wall end
  y0: number;
  y1: number;
}

/**
 * Emits axis-aligned boxes filling a wall rectangle [a0,a1]×[y0,y1] minus the
 * openings. Columns are cut at every opening edge; each column has at most one
 * opening, so it becomes one box below and one above.
 */
export function punchedWall(
  a0: number,
  a1: number,
  y0: number,
  y1: number,
  openings: Opening[],
  emit: (a0: number, a1: number, y0: number, y1: number) => void,
): void {
  const edges = new Set<number>([a0, a1]);
  for (const o of openings) {
    if (o.a0 > a0 && o.a0 < a1) edges.add(o.a0);
    if (o.a1 > a0 && o.a1 < a1) edges.add(o.a1);
  }
  const xs = [...edges].sort((p, q) => p - q);
  for (let i = 0; i < xs.length - 1; i++) {
    const c0 = xs[i], c1 = xs[i + 1];
    const mid = (c0 + c1) / 2;
    const o = openings.find((op) => mid > op.a0 && mid < op.a1);
    if (!o) {
      emit(c0, c1, y0, y1);
      continue;
    }
    if (o.y0 > y0) emit(c0, c1, y0, o.y0);
    if (o.y1 < y1) emit(c0, c1, o.y1, y1);
  }
}

export function buildShell(parent: THREE.Group, pal: Palette): { colliders: MergedBuilder["colliders"] } {
  const b = new MergedBuilder();
  const { halfX, zBack, zFront, height: H, wallThickness: T, slabDrop } = ROOM;
  const yLow = -slabDrop;
  // Interior paint: world-anchored UVs (merge.ts worldBoxUv), 1 UV unit = 2.4 m — the wall
  // canvas period — so drywall seams and the scuff band are continuous across the punched
  // wall's pieces. The window wall uses the 1.8 m window-pitch canvas with u = 0.5 on every
  // window centre (see materials.ts wallPaintWindow). Exterior faces keep box-relative UVs.
  const uv = { uvScale: 2 };
  const uvIn = { worldUv: 2.4 };
  const winPitch = WINDOW.centersX[1] - WINDOW.centersX[0];
  const uvWin: { worldUv: number; uvOffset: [number, number] } = { worldUv: winPitch, uvOffset: [0.5 - WINDOW.centersX[0] / winPitch, 0] };

  /* ---------------- floor ---------------- */
  {
    const w = halfX * 2, d = zFront - zBack;
    const g0 = new THREE.PlaneGeometry(w, d);
    g0.rotateX(-Math.PI / 2);
    g0.translate(0, 0, (zFront + zBack) / 2);
    // The tile also runs through the door opening to the threshold saddle, on the same grid.
    const dx0 = DOOR.hingeX - DOOR.jamb, dx1 = DOOR.hingeX + DOOR.width + DOOR.jamb, dz1 = zFront + T / 2;
    const g1 = new THREE.PlaneGeometry(dx1 - dx0, dz1 - zFront);
    g1.rotateX(-Math.PI / 2);
    g1.translate((dx0 + dx1) / 2, 0, (zFront + dz1) / 2);
    const uv1 = g1.attributes.uv as THREE.BufferAttribute, p1 = g1.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p1.count; i++) uv1.setXY(i, (p1.getX(i) + halfX) / w, (zFront - p1.getZ(i)) / d);
    // The crack's lips (rev 3): the slab moved and one side of the VCT sits 0.9–2.2 mm proud of
    // the other, so each side of the dark floor is a 4.5 mm ramp — a lit edge and a shadow edge
    // under the sun — merged into the floor mesh (same material, same UVs; +0 draw calls).
    const wear = dinerFloorWear();
    const segs = floorCrackSegments(wear);
    const lips: THREE.BufferGeometry[] = [];
    const floorUv = (x: number, z: number): [number, number] => [(x + halfX) / w, (zFront - z) / d];
    segs.forEach((seg, si) => {
      if (seg.length < 2) return;
      const lipW = 0.0045;
      // which side stands proud flips between segments (the slab tilts either way); the floor
      // map's pale/dark edge strokes (textures.ts) follow the same parity.
      const hiL = si % 2 === 0 ? 0.0022 : 0.0009, hiR = si % 2 === 0 ? 0.0009 : 0.0022;
      for (const side of [-1, 1]) {
        const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
        const hi = side < 0 ? hiL : hiR;
        for (let i = 0; i < seg.length; i++) {
          const [x, z, hw] = seg[i];
          const [px, pz] = seg[Math.max(0, i - 1)], [nx, nz] = seg[Math.min(seg.length - 1, i + 1)];
          const dx = nx - px, dz = nz - pz, l = Math.hypot(dx, dz) || 1;
          const ox = (-dz / l) * side, oz = (dx / l) * side; // unit perpendicular, this side
          const taper = Math.min(1, i / 2, (seg.length - 1 - i) / 2);
          // wider gap → the tile moved more → the lip stands higher
          const h = 0.0003 + (hi - 0.0003) * taper * (0.6 + 0.4 * Math.min(1, hw / 0.0014));
          // inner edge (at the dark floor) high, outer edge down on the tile
          pos.push(x + ox * hw, h, z + oz * hw, x + ox * (hw + lipW), 0.0003, z + oz * (lipW + hw));
          const slope = (h - 0.0003) / lipW;
          const nl = Math.hypot(slope, 1);
          nrm.push(-ox * slope / nl, 1 / nl, -oz * slope / nl, -ox * slope / nl, 1 / nl, -oz * slope / nl);
          const [u0, v0] = floorUv(x + ox * hw, z + oz * hw), [u1, v1] = floorUv(x + ox * (hw + lipW), z + oz * (hw + lipW));
          uv.push(u0, v0, u1, v1);
          if (i) { const k = i * 2; if (side < 0) idx.push(k - 2, k, k - 1, k - 1, k, k + 1); else idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
        }
        const lg = new THREE.BufferGeometry();
        lg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        lg.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
        lg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        lg.setIndex(idx);
        lips.push(lg.toNonIndexed());
      }
    });
    const g = mergeGeometries([g0.toNonIndexed(), g1.toNonIndexed(), ...lips], false)!;
    const floor = new THREE.Mesh(g, pal.floor);
    // 40 × 20 tiles on the canvas; tiles are 0.3 m.
    const map = pal.floor.map!;
    map.repeat.set(w / 0.3 / 40, d / 0.3 / 20);
    pal.floor.roughnessMap!.repeat.copy(map.repeat);
    // Grout relief is a 2 × 2-tile detail canvas (textures.ts floorGrout): one repeat per 0.6 m.
    pal.floor.normalMap!.repeat.set(w / 0.6, d / 0.6);
    floor.receiveShadow = true;
    floor.name = "floor";
    parent.add(floor);

    // The hairline crack (System 5): a 2 mm ribbon 0.6 mm proud of the tile along the same
    // polyline the floor map shades. Drawn in the map alone it beaded — one antialiased texel
    // (3.75 mm) magnified through bilinear filtering — so the dark floor of the crack is
    // geometry. Folded into the cove-base bucket: the top strip of that map is plain matte
    // black vinyl, which is what a crack floor looks like. +0 draw calls.
    // Rev 3: the dark floor is one ribbon per segment (the crack breaks at a third of the seams
    // it crosses), its half-width the segment's own (0.3–1.0 mm), sunk 0.2 mm below the lips'
    // inner edges so it reads as the bottom of the gap.
    // Rev 4: the ribbon was wound clockwise from above and back-face culled — it had never
    // drawn; the "crack" the critic saw in rev 2/3 was the floor map's feathered strokes.
    for (const seg of segs) {
      if (seg.length < 2) continue;
      const y = 0.0006;
      const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
      for (let i = 0; i < seg.length; i++) {
        const [x, z, hw] = seg[i];
        const [px, pz] = seg[Math.max(0, i - 1)], [nx, nz] = seg[Math.min(seg.length - 1, i + 1)];
        const dx = nx - px, dz = nz - pz, l = Math.hypot(dx, dz) || 1;
        const taper = Math.min(1, 0.15 + i / 2, 0.15 + (seg.length - 1 - i) / 2);
        const ox = (-dz / l) * hw * taper, oz = (dx / l) * hw * taper;
        pos.push(x + ox, y, z + oz, x - ox, y, z - oz);
        nrm.push(0, 1, 0, 0, 1, 0);
        uv.push(i / (seg.length - 1) * 3, 0.96, i / (seg.length - 1) * 3, 0.95);
        if (i) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      b.add(g, pal.baseboardWorn);
    }
    // Rev 5: the CHIPS are geometry too. A 3–6 mm bite out of a VCT lip is one texel of the
    // 3.75 mm floor map (it never resolved in two revs of trying); here each is a ragged
    // 5–8-gon of pale matte almond (`pal.cord`: a fresh through-colour break is the tile's own
    // body a shade lighter and dead matte) laid 0.4 mm over the lip, 2–3 clustered at every
    // segment end (the joint, where the tile broke) and one every 60–120 mm along the run.
    {
      const crng = makeRng(wear.seed + 79);
      // two buckets: almond bites on the cream tiles, a dull grey lift on the charcoal ones
      // (the map's canvas row y runs with world z from `originZ`; (tx + ty) even = charcoal)
      const buckets = [{ pos: [] as number[], nrm: [] as number[], idx: [] as number[] }, { pos: [] as number[], nrm: [] as number[], idx: [] as number[] }];
      const onBlack = (x: number, z: number) => (Math.floor((x - wear.originX) / wear.metresPerTile) + Math.floor((z - wear.originZ) / wear.metresPerTile)) % 2 === 0;
      const chip = (x: number, z: number, r: number, ang: number) => {
        const { pos, nrm, idx } = buckets[onBlack(x, z) ? 1 : 0];
        const n = 5 + Math.floor(crng() * 4), base = pos.length / 3;
        pos.push(x, 0.0004, z); nrm.push(0, 1, 0);
        for (let j = 0; j < n; j++) {
          const a = ang + (j / n) * Math.PI * 2;
          const rj = r * (0.5 + crng() * 0.7) * (1 + 0.6 * Math.abs(Math.cos(a - ang)));
          pos.push(x + Math.cos(a) * rj, 0.0004, z + Math.sin(a) * rj); nrm.push(0, 1, 0);
        }
        for (let j = 1; j <= n; j++) idx.push(base, base + (j % n) + 1, base + j); // CCW from above
      };
      for (const seg of segs) {
        if (seg.length < 3) continue;
        let since = 0.06 + crng() * 0.06;
        for (let i = 0; i + 1 < seg.length; i++) {
          const [ax, az, hw] = seg[i], [bx, bz] = seg[i + 1];
          const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
          const end = i === 0 || i + 2 === seg.length;
          since -= l;
          if (!end && since > 0) continue;
          if (!end) since = 0.06 + crng() * 0.06;
          const count = end ? 2 + Math.floor(crng() * 2) : 1;
          for (let c = 0; c < count; c++) {
            const side = crng() < 0.5 ? -1 : 1, t = end ? crng() * 0.6 : crng();
            const r = (end ? 0.002 : 0.0015) + crng() * 0.0025;
            const off = hw + 0.001 + r * 0.6;
            chip(ax + dx * t + (-dz / l) * side * off, az + dz * t + (dx / l) * side * off, r, Math.atan2(dz, dx));
          }
        }
      }
      buckets.forEach(({ pos, nrm, idx }, k) => {
        if (!idx.length) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
        g.setIndex(idx);
        b.add(g, k ? pal.tileBacking : pal.cord);
      });
    }
  }

  /* ---------------- front (window) wall, +z ---------------- */
  const windowOpenings: Opening[] = WINDOW.centersX.map((cx) => ({
    a0: cx - WINDOW.width / 2,
    a1: cx + WINDOW.width / 2,
    y0: WINDOW.sill,
    y1: WINDOW.head,
  }));
  const doorOpening: Opening = { a0: DOOR.hingeX, a1: DOOR.hingeX + DOOR.width, y0: yLow, y1: DOOR.height };
  const frontOpenings = [...windowOpenings, doorOpening];
  const zMid = zFront + T / 2;
  punchedWall(-halfX, halfX, yLow, H, frontOpenings, (x0, x1, y0, y1) => {
    b.box(pal.wallPaintWindow, [x0, y0, zFront], [x1, y1, zMid], uvWin);
    b.box(pal.wallPaintExt, [x0, y0, zMid], [x1, y1, zFront + T], uv);
  });
  // Solid collision for the whole wall except the door opening (the leaf is
  // walk-through until System 7 gives it a hinge).
  b.collider([-halfX, 0, zFront], [DOOR.hingeX, H, zFront + T]);
  b.collider([DOOR.hingeX + DOOR.width, 0, zFront], [halfX, H, zFront + T]);

  /* ---------------- back partition to the kitchen, -z ---------------- */
  const pass: Opening = {
    a0: PASS_THROUGH.centerX - PASS_THROUGH.width / 2,
    a1: PASS_THROUGH.centerX + PASS_THROUGH.width / 2,
    y0: PASS_THROUGH.sill,
    y1: PASS_THROUGH.sill + PASS_THROUGH.height,
  };
  const kdoor: Opening = {
    a0: KITCHEN_DOOR.centerX - KITCHEN_DOOR.width / 2,
    a1: KITCHEN_DOOR.centerX + KITCHEN_DOOR.width / 2,
    y0: yLow,
    y1: KITCHEN_DOOR.height,
  };
  punchedWall(-halfX, halfX, yLow, H, [pass, kdoor], (x0, x1, y0, y1) => {
    b.box(pal.wallPaint, [x0, y0, zBack - T], [x1, y1, zBack], uvIn);
  });
  b.collider([-halfX, 0, zBack - T], [halfX, H, zBack]);

  /* ---------------- end walls, ±x ---------------- */
  b.box(pal.wallPaint, [-halfX - T / 2, yLow, zBack - T], [-halfX, H, zFront + T], uvIn);
  b.box(pal.wallPaintExt, [-halfX - T, yLow, zBack - T], [-halfX - T / 2, H, zFront + T], uv);
  b.box(pal.wallPaint, [halfX, yLow, zBack - T], [halfX + T / 2, H, zFront + T], uvIn);
  b.box(pal.wallPaintExt, [halfX + T / 2, yLow, zBack - T], [halfX + T, H, zFront + T], uv);
  b.collider([-halfX - T, 0, zBack - T], [-halfX, H, zFront + T]);
  b.collider([halfX, 0, zBack - T], [halfX + T, H, zFront + T]);

  /* ---------------- supply register, high on the -x wall ---------------- */
  {
    const { z, w, h, top } = REGISTER;
    const z0 = z - w / 2, z1 = z + w / 2, y1 = top, y0 = top - h;
    const xf = -halfX; // wall face
    // Recess (dark) behind the louvres
    b.box(pal.kickPanel, [xf - 0.03, y0 + 0.02, z0 + 0.02], [xf + 0.001, y1 - 0.02, z1 - 0.02]);
    // Painted frame, 25 mm face
    const f = 0.025;
    b.rbox(pal.trimPaint, [xf, y0, z0], [xf + 0.012, y1, z0 + f], 0.002);
    b.rbox(pal.trimPaint, [xf, y0, z1 - f], [xf + 0.012, y1, z1], 0.002);
    b.rbox(pal.trimPaint, [xf, y0, z0 + f], [xf + 0.012, y0 + f, z1 - f], 0.002);
    b.rbox(pal.trimPaint, [xf, y1 - f, z0 + f], [xf + 0.012, y1, z1 - f], 0.002);
    // Louvres: angled slats every 25 mm
    for (let y = y0 + f + 0.012; y < y1 - f - 0.01; y += 0.025) {
      const g = new THREE.BoxGeometry(0.018, 0.004, z1 - z0 - 2 * f - 0.004);
      g.rotateZ(THREE.MathUtils.degToRad(-35));
      g.translate(xf + 0.004, y, z);
      b.add(g, pal.trimPaint);
    }
  }

  /* ---------------- window frames, transoms, stops, glass, sills ---------------- */
  const fw = 0.04; // frame face
  const fd = 0.06; // frame depth (z)
  const zF0 = zMid - fd / 2, zF1 = zMid + fd / 2;
  const stop = 0.015;
  const glassGeos: THREE.BufferGeometry[] = [];
  const filmGeos: THREE.BufferGeometry[] = [];
  const pane = (x0: number, x1: number, y0: number, y1: number) => {
    const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, zMid);
    glassGeos.push(g);
    // Glass stops on both faces
    for (const [za, zb] of [
      [zF0 - stop, zF0],
      [zF1, zF1 + stop],
    ]) {
      b.box(pal.alum, [x0, y0, za], [x1, y0 + stop, zb]);
      b.box(pal.alum, [x0, y1 - stop, za], [x1, y1, zb]);
      b.box(pal.alum, [x0, y0 + stop, za], [x0 + stop, y1 - stop, zb]);
      b.box(pal.alum, [x1 - stop, y0 + stop, za], [x1, y1 - stop, zb]);
    }
  };
  for (const o of windowOpenings) {
    const { a0: x0, a1: x1, y0, y1 } = o;
    // Perimeter frame members
    b.box(pal.alum, [x0, y0, zF0], [x0 + fw, y1, zF1]);
    b.box(pal.alum, [x1 - fw, y0, zF0], [x1, y1, zF1]);
    b.box(pal.alum, [x0 + fw, y1 - fw, zF0], [x1 - fw, y1, zF1]);
    b.box(pal.alum, [x0 + fw, y0, zF0], [x1 - fw, y0 + fw, zF1]);
    // Transom bar
    const ty = WINDOW.transomY;
    b.box(pal.alum, [x0 + fw, ty - fw / 2, zF0], [x1 - fw, ty + fw / 2, zF1]);
    // Panes
    pane(x0 + fw, x1 - fw, y0 + fw, ty - fw / 2);
    pane(x0 + fw, x1 - fw, ty + fw / 2, y1 - fw);
    // Solar film on the lower lights (interior face): its 3 mm cut-back from the stops and one
    // lifted corner are the only things that show — a quad carrying the atlas "film" region.
    {
      const fx0 = x0 + fw + stop, fx1 = x1 - fw - stop, fy0 = y0 + fw + stop, fy1 = ty - fw / 2 - stop;
      const film = atlasQuad(fx1 - fx0, fy1 - fy0, DECAL.film);
      film.rotateY(Math.PI); // decal material is FrontSide: face the room (−z)
      film.translate((fx0 + fx1) / 2, (fy0 + fy1) / 2, zMid - 0.0015);
      filmGeos.push(film);
    }
    // Interior sill board: 22 mm thick, rounded nose, projects 90 mm, meets the frame; distinct apron below.
    b.rbox(pal.trimPaint, [x0 - 0.07, y0 - 0.022, zFront - 0.09], [x1 + 0.07, y0, zF0], 0.01, 3);
    b.rbox(pal.trimPaint, [x0 - 0.06, y0 - 0.11, zFront - 0.018], [x1 + 0.06, y0 - 0.022, zFront], 0.003);
    // Casing around the reveal on the interior face (60 × 12 mm)
    const cw = 0.06, ct = 0.012;
    b.rbox(pal.trimPaint, [x0 - cw, y0 - 0.11, zFront - ct], [x0, y1 + cw, zFront], 0.002);
    b.rbox(pal.trimPaint, [x1, y0 - 0.11, zFront - ct], [x1 + cw, y1 + cw, zFront], 0.002);
    b.rbox(pal.trimPaint, [x0, y1, zFront - ct], [x1, y1 + cw, zFront], 0.002);
  }

  /* ---------------- window head bulkhead (blind pocket) between head trim and grid ---------------- */
  {
    const { bottom, depth } = WINDOW.headSoffit;
    b.box(pal.wallPaint, [-halfX, bottom, zFront - depth], [halfX, H, zFront], uvIn);
  }

  /* ---------------- door frame (leaf is built in Door.ts) ---------------- */
  {
    const x0 = doorOpening.a0, x1 = doorOpening.a1;
    const jw = DOOR.jamb;
    // Jambs and head fill the full wall depth inside the rough opening (visible returns).
    const z0 = zFront - 0.005, z1 = zFront + T + 0.005;
    b.rbox(pal.alum, [x0, 0, z0], [x0 + jw, DOOR.height, z1], 0.002);
    b.rbox(pal.alum, [x1 - jw, 0, z0], [x1, DOOR.height, z1], 0.002);
    b.rbox(pal.alum, [x0 + jw, DOOR.height - jw, z0], [x1 - jw, DOOR.height, z1], 0.002);
    // Door stop on the exterior side of the leaf, so the 4 mm reveal reads dark.
    const leafT = 0.045;
    const zs0 = zMid + leafT / 2 + 0.002, zs1 = zs0 + 0.018;
    const st = 0.02;
    b.box(pal.alum, [x0 + jw, 0.02, zs0], [x0 + jw + st, DOOR.height - jw, zs1]);
    b.box(pal.alum, [x1 - jw - st, 0.02, zs0], [x1 - jw, DOOR.height - jw, zs1]);
    b.box(pal.alum, [x0 + jw, DOOR.height - jw - st, zs0], [x1 - jw, DOOR.height - jw, zs1]);
    // 100 × 12 mm aluminium threshold saddle under the leaf; concrete slab fills the opening below it
    // 4" (100 mm) saddle, set 20 mm toward the interior so its top face reads past the leaf from inside
    // 4.5" × ½" ribbed aluminium saddle: crowned body with 5 raised ribs (1.5 mm) and a
    // dark groove between each pair, so it throws a line shadow across the opening.
    b.rbox(pal.alumBright, [x0 + jw, -0.002, zMid - 0.08], [x1 - jw, 0.0125, zMid + 0.034], 0.004, 3);
    for (let k = 0; k < 5; k++) {
      const zr = zMid - 0.058 + k * 0.0175;
      b.rbox(pal.alumBright, [x0 + jw + 0.002, 0.012, zr - 0.004], [x1 - jw - 0.002, 0.014, zr + 0.004], 0.001);
      if (k < 4) b.box(pal.alumGroove, [x0 + jw + 0.002, 0.0122, zr + 0.0065], [x1 - jw - 0.002, 0.0128, zr + 0.011]);
    }
    // Floor tile runs through the opening to the saddle; outside it the concrete step is 120 mm down.
    b.box(pal.concrete, [x0, yLow, zMid], [x1, -0.12, zFront + T], { uvScale: 1 });
    b.box(pal.concrete, [x0, -0.12, zMid], [x1, -0.005, zMid + 0.06], { uvScale: 1 });
    // Closer bracket on the head (interior side); the arm lives on the leaf in Door.ts
    b.rbox(pal.darkMetal, [x0 + jw + 0.08, DOOR.height - jw - 0.004, zFront + 0.01], [x0 + jw + 0.34, DOOR.height - jw, zFront + 0.07], 0.002);
  }

  /* ---------------- kitchen swing door casings (the leaf itself swings: Openables.ts, System 9) ---------------- */
  {
    const { a0: x0, a1: x1, y1: h } = kdoor;
    // Painted jamb casings (100 mm) and header on the dining face
    const j = KITCHEN_DOOR.jamb, ct = 0.015;
    b.rbox(pal.trimPaint, [x0 - j, 0, zBack], [x0, h + j, zBack + ct], 0.002);
    b.rbox(pal.trimPaint, [x1, 0, zBack], [x1 + j, h + j, zBack + ct], 0.002);
    b.rbox(pal.trimPaint, [x0, h, zBack], [x1, h + j, zBack + ct], 0.002);
  }

  /* ---------------- pass-through liner, shelf, heat lamp, header ---------------- */
  {
    const j = PASS_THROUGH.jamb;
    const z0 = zBack - T - 0.005, z1 = zBack + 0.005;
    // Painted wood surround (matches the wall trim) that LINES the reveal: it reaches 3 mm
    // into the opening so its faces sit in front of the wall's cut faces. Rev 6 put the
    // jambs beside the opening with their inner face on the reveal plane — the two
    // coplanar faces z-fought and read as speckled concrete (rev 7 flicker audit).
    const lip = 0.003;
    b.rbox(pal.trimPaint, [pass.a0 - j, pass.y0 - lip, z0], [pass.a0 + lip, pass.y1 + j, z1], 0.002);
    b.rbox(pal.trimPaint, [pass.a1 - lip, pass.y0 - lip, z0], [pass.a1 + j, pass.y1 + j, z1], 0.002);
    b.rbox(pal.trimPaint, [pass.a0 - j, pass.y1 - lip, z0], [pass.a1 + j, pass.y1 + j, z1], 0.002);
    // 350 mm stainless shelf through the opening at sill height (100 mm into the dining side)
    const sd = PASS_THROUGH.shelfDepth;
    const zs1 = zBack + 0.1, zs0 = zs1 - sd;
    b.rbox(pal.stainless, [pass.a0 - j - 0.02, pass.y0 - 0.03, zs0], [pass.a1 + j + 0.02, pass.y0 + 0.002, zs1], 0.004, 3); // 2 mm above the sill cut so the two up-faces never tie
    // Heat-lamp bar 450 mm above the shelf, on the kitchen side of the opening
    const hy = pass.y0 + PASS_THROUGH.heatLampAbove;
    const hz = zBack - T - 0.12;
    b.rbox(pal.stainless, [pass.a0 + 0.05, hy - 0.03, hz - 0.03], [pass.a1 - 0.05, hy + 0.03, hz + 0.03], 0.004);
    for (const lx of [pass.a0 + 0.35, pass.a1 - 0.35]) {
      const shade = new THREE.CylinderGeometry(0.075, 0.045, 0.09, 24, 1, true);
      shade.translate(lx, hy - 0.075, hz);
      b.add(shade, pal.darkMetal);
      // System 4 rev 2: the red R40 bulb itself, its face 5 mm below the shade's mouth —
      // emissive (materials.ts heatLampBulb, ≈ 8,000 nits) so the pass-through reads as
      // lit from the dining room. The light it throws on the shelf is Lighting.ts "heat-lamp".
      const bulb = new THREE.CylinderGeometry(0.04, 0.038, 0.02, 20);
      bulb.translate(lx, hy - 0.125, hz);
      b.add(bulb, pal.heatLampBulb);
    }
  }

  /* ---------------- shallow kitchen interior behind the pass-through ---------------- */
  {
    const { kitchenDepth: kd, kitchenHalfWidth: kw } = PASS_THROUGH;
    const cx = PASS_THROUGH.centerX;
    const zIn = zBack - T, zFar = zIn - kd;
    const x0 = cx - kw, x1 = cx + kw;
    const dim = pal.kitchenDim;
    b.box(dim, [x0, 0, zFar - 0.05], [x1, H, zFar]); // back wall
    b.box(dim, [x0 - 0.05, 0, zFar], [x0, H, zIn]); // side walls
    b.box(dim, [x1, 0, zFar], [x1 + 0.05, H, zIn]);
    b.box(dim, [x0, -0.05, zFar], [x1, 0, zIn]); // floor
    b.box(dim, [x0, H - 0.03, zFar], [x1, H, zIn]); // ceiling; its soffit sits 30 mm under the void box's top (was coplanar)
    // Dim silhouettes: a work table under the heat lamps, a range + hood on the back wall
    b.box(pal.kitchenDim, [cx - 0.9, 0.86, zIn - 0.75], [cx + 0.9, 0.9, zIn - 0.15]);
    for (const [lx, lz] of [[cx - 0.85, zIn - 0.7], [cx + 0.85, zIn - 0.7], [cx - 0.85, zIn - 0.2], [cx + 0.85, zIn - 0.2]]) {
      b.box(pal.kitchenDim, [lx - 0.02, 0, lz - 0.02], [lx + 0.02, 0.86, lz + 0.02]);
    }
    b.box(pal.kitchenDim, [cx - 0.75, 0, zFar], [cx + 0.75, 0.92, zFar + 0.8]);
    b.box(pal.kitchenDim, [cx - 0.9, 1.9, zFar], [cx + 0.9, 2.4, zFar + 0.95]);
  }

  /* ---------------- cove base (100 × 12 mm) ---------------- */
  {
    const bh = 0.1, bt = 0.012;
    // Metric UVs (jittered per run) carry the mop marks and heel scuffs of baseboardWorn.
    const base = (min: [number, number, number], max: [number, number, number]) => b.rbox(pal.baseboardWorn, min, max, 0.004, 2, { metric: true });
    base([-halfX, 0, zFront - bt], [DOOR.hingeX, bh, zFront]);
    base([DOOR.hingeX + DOOR.width, 0, zFront - bt], [halfX, bh, zFront]);
    base([-halfX, 0, zBack], [kdoor.a0 - KITCHEN_DOOR.jamb, bh, zBack + bt]);
    base([kdoor.a1 + KITCHEN_DOOR.jamb, 0, zBack], [halfX, bh, zBack + bt]);
    base([-halfX, 0, zBack], [-halfX + bt, bh, zFront]);
    base([halfX - bt, 0, zBack], [halfX, bh, zFront]);
  }

  /* ---------------- roof slab / parapet (exterior only) ---------------- */
  b.box(pal.wallPaintExt, [-halfX - T - 0.2, H, zBack - T - 0.2], [halfX + T + 0.2, H + 0.35, zFront + T + 0.25], uv);

  /* ---------------- kitchen void ---------------- */
  {
    const g = new THREE.BoxGeometry(halfX * 2 + 0.4, H + slabDrop, 3.4);
    g.translate(0, (H - slabDrop) / 2, zBack - T - 1.7);
    const voidMat = pal.voidBlack.clone();
    voidMat.side = THREE.BackSide;
    const voidBox = new THREE.Mesh(g, voidMat);
    voidBox.name = "kitchen-void";
    parent.add(voidBox);
  }

  /* ---------------- exterior ground: apron slab one 120 mm step below the floor ---------------- */
  {
    // Sidewalk slab to the kerb line; the lot, kerb and everything beyond is Exterior.ts (System 3).
    b.box(pal.concrete, [-halfX - 1.5, yLow - 0.15, zFront + T], [halfX + 1.5, -0.12, zFront + T + 1.8], { uvScale: 1 });
  }

  // Glass last: one geometry for all panes, three coincident leaves (System 4 rev 6,
  // Glazing.ts: alpha transmission + additive reflection per face; no transmission buffer, so
  // the blinds are drawn at full resolution from the lot as well — GlassResolution.ts retired).
  parent.add(buildGlazing(mergeGeometries(glassGeos, false)!, { pane: pal.glass, reflectIn: pal.glassReflectIn, reflectOut: pal.glassReflectOut }, "window-glass"));
  const film = new THREE.Mesh(mergeGeometries(filmGeos, false)!, pal.decal);
  film.renderOrder = 12;
  film.name = "window-film";
  parent.add(film);

  b.build(parent, { name: "shell" });
  return { colliders: b.colliders };
}
