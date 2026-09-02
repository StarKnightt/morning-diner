/**
 * System 2 props: table sets (napkin dispenser, sugar pourer, salt & pepper) on
 * every booth table and at every second stool; heavy ceramic mugs (instanced)
 * inverted on a stainless drip tray, inverted on saucers at two stools, and
 * the named upright `pourMug`; a BUNN VPR-class brewer with the glass decanter
 * `coffeePot`; a tray stack; a wall clock with bezel and glass.
 * Static geometry is merged per material; the mugs are InstancedMeshes.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { makeRng } from "../core/rng";
import { BACK_BAR, BOOTH, COUNTER, PROPS, ROOM, WINDOW } from "./layout";

export interface PropsResult {
  pourMug: THREE.Mesh;
  coffeePot: THREE.Group;
}

const V2 = (x: number, y: number) => new THREE.Vector2(x, y);
const MUG_H = 0.089;

/**
 * Victor-style heavy mug: 89 mm tall, Ø 82 with a clear waist, 6 mm walls, a
 * 3.5 mm rounded rim, tapered foot, heavy C-handle. Origin at the foot; the
 * unglazed foot ring is a separate geometry (see `mugFootGeometry`).
 */
function mugGeometry(): THREE.BufferGeometry {
  const body = new THREE.LatheGeometry(
    [
      V2(0, 0.003), V2(0.03, 0.003), V2(0.034, 0.005), V2(0.039, 0.012), V2(0.041, 0.02),
      V2(0.0395, 0.034), V2(0.038, 0.046), V2(0.0385, 0.058), V2(0.0405, 0.072), V2(0.041, 0.081),
      V2(0.0405, 0.0865), V2(0.0385, 0.089), V2(0.0365, 0.0885), V2(0.035, 0.085),
      V2(0.0345, 0.075), V2(0.0325, 0.05), V2(0.034, 0.02), V2(0.03, 0.011), V2(0, 0.011),
    ],
    48,
  );
  const handle = new THREE.TorusGeometry(0.023, 0.0078, 12, 28, 1.25 * Math.PI);
  handle.rotateZ(-0.625 * Math.PI);
  handle.scale(1, 1.15, 1);
  handle.translate(0.058, 0.047, 0);
  return mergeGeometries([body.toNonIndexed(), handle.toNonIndexed()], false)!;
}

/** Unglazed foot ring, 3 mm tall, matching the mug's base. */
function mugFootGeometry(): THREE.BufferGeometry {
  return new THREE.LatheGeometry([V2(0.024, 0.0002), V2(0.026, 0), V2(0.031, 0), V2(0.0315, 0.003), V2(0.0235, 0.003), V2(0.024, 0.0002)], 40);
}

function saucerGeometry(): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    [V2(0, 0.003), V2(0.03, 0.003), V2(0.033, 0), V2(0.045, 0), V2(0.05, 0.005), V2(0.072, 0.014), V2(0.078, 0.018), V2(0.074, 0.019), V2(0.052, 0.011), V2(0.042, 0.008), V2(0, 0.008)],
    40,
  );
}

export function buildProps(parent: THREE.Group, pal: Palette): PropsResult {
  const b = new MergedBuilder();
  const rng = makeRng(4321);

  /* ---------------- napkin dispenser + condiments ---------------- */
  // Dispenser (Tablecraft 221 pattern): 117 W × 98 D × 184 H brushed-stainless body, lid
  // seam 12 mm below the top, and on both long faces a spring faceplate with an arched
  // cut-out at the bottom through which the white napkin stack shows; one tip out 9 mm.
  const dispenser = (x: number, z: number, yTop: number, yaw: number) => {
    const m = new THREE.Matrix4().makeRotationY(yaw);
    m.setPosition(x, yTop, z);
    const W = 0.117, D = 0.098, H = 0.184, t = 0.004;
    const add = (g: THREE.BufferGeometry, mat: THREE.Material) => b.add(g, mat, m);
    const box = (mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      add(g, mat);
    };
    // End panels, bottom, lipped cap; dark seam line where the lid meets the body
    box(pal.chromeBrushed, -W / 2, 0.002, -D / 2, -W / 2 + t, H - 0.012, D / 2);
    box(pal.chromeBrushed, W / 2 - t, 0.002, -D / 2, W / 2, H - 0.012, D / 2);
    box(pal.chromeBrushed, -W / 2, 0.002, -D / 2, W / 2, 0.002 + t, D / 2);
    const cap = new RoundedBoxGeometry(W + 0.003, 0.012, D + 0.003, 2, 0.002);
    cap.translate(0, H - 0.006, 0);
    add(cap, pal.chromeBrushed);
    box(pal.blackPlastic, -W / 2 - 0.0005, H - 0.0135, -D / 2 - 0.0005, W / 2 + 0.0005, H - 0.012, D / 2 + 0.0005);
    // Napkin stack: white block filling the body (its face shows through the arch)
    box(pal.napkin, -W / 2 + t + 0.002, 0.008, -D / 2 + 0.007, W / 2 - t - 0.002, H - 0.02, D / 2 - 0.007);
    for (const s of [-1, 1]) {
      const zf = s * (D / 2 - 0.002); // plate face, recessed 2 mm
      // Faceplate with an arched cut-out: 44 mm wide, 30 mm tall, rounded top
      // The arch is a notch in the plate's outline (a hole crossing the outer edge would
      // break the triangulation): 52 mm wide, 42 mm tall, round-topped.
      const plate = new THREE.Shape();
      const hw = W / 2 - t, y0 = 0.006, y1 = H - 0.014;
      const aw = 0.026, ah = 0.042;
      plate.moveTo(-hw, y0);
      plate.lineTo(-aw, y0);
      plate.lineTo(-aw, y0 + ah - aw);
      plate.absarc(0, y0 + ah - aw, aw, Math.PI, 0, true);
      plate.lineTo(aw, y0);
      plate.lineTo(hw, y0);
      plate.lineTo(hw, y1);
      plate.lineTo(-hw, y1);
      plate.closePath();
      const pg = new THREE.ExtrudeGeometry(plate, { depth: 0.0025, bevelEnabled: false, curveSegments: 10 });
      if (s < 0) pg.rotateY(Math.PI);
      pg.translate(0, 0, s > 0 ? zf - 0.0025 : zf + 0.0025);
      add(pg, pal.chromeBrushed);
      // One napkin tip out through the arch, curling down
      const tip = new THREE.BoxGeometry(0.03, 0.011, 0.0012);
      tip.translate(0, -0.0055, 0);
      tip.rotateX(-s * THREE.MathUtils.degToRad(35));
      tip.translate(0.002 * s, y0 + 0.011, s * (D / 2 + 0.003));
      add(tip, pal.napkin);
    }
    add(new THREE.BoxGeometry(W - 0.01, 0.002, D - 0.01).translate(0, 0.001, 0), pal.blackPlastic);
  };
  // Sugar pourer: fluted clear glass Ø 78 × 105 (12 flutes), sugar to 65 % as an inner
  // mesh with a flat top, brushed-chrome lid with a side flap.
  const sugarCaddy = (x: number, z: number, y: number, yaw = 0) => {
    const m = new THREE.Matrix4().makeRotationY(yaw);
    m.setPosition(x, y, z);
    const add = (g: THREE.BufferGeometry, mat: THREE.Material) => b.add(g, mat, m);
    const core = 0.031, fluteR = 0.0085, jarH = 0.105;
    const glassParts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(core, core - 0.002, jarH, 36).translate(0, jarH / 2, 0)];
    for (let k = 0; k < 12; k++) {
      const f = new THREE.CylinderGeometry(fluteR, fluteR - 0.001, jarH - 0.01, 12);
      f.translate(core - 0.0005, jarH / 2 - 0.002, 0);
      f.rotateY((k / 12) * Math.PI * 2);
      glassParts.push(f);
    }
    add(mergeGeometries(glassParts.map((g) => g.toNonIndexed()), false)!, pal.glassClear);
    add(new THREE.CylinderGeometry(core - 0.004, core - 0.0055, jarH * 0.65, 28).translate(0, 0.004 + (jarH * 0.65) / 2, 0), pal.sugar);
    // Lid: 28 mm brushed chrome with a knurled band, side flap on a hinge
    add(new THREE.CylinderGeometry(0.0395, 0.039, 0.02, 36).translate(0, jarH + 0.01, 0), pal.chromeSoft);
    add(new THREE.CylinderGeometry(0.036, 0.0395, 0.006, 36).translate(0, jarH + 0.023, 0), pal.chromeSoft);
    add(new THREE.CylinderGeometry(0.03, 0.036, 0.004, 36).translate(0, jarH + 0.028, 0), pal.chromeSoft);
    const flap = new THREE.BoxGeometry(0.02, 0.003, 0.03);
    flap.translate(0, jarH + 0.031, 0.026);
    add(flap, pal.chromeSoft);
    const hinge = new THREE.CylinderGeometry(0.003, 0.003, 0.022, 10);
    hinge.rotateZ(Math.PI / 2);
    hinge.translate(0, jarH + 0.03, 0.038);
    add(hinge, pal.chromeSoft);
  };
  // Salt / pepper: clear glass Ø 30 with a visible glass margin around the fill, 30 mm perforated chrome cap.
  const shaker = (x: number, z: number, y: number, contents: THREE.Material) => {
    const add = (g: THREE.BufferGeometry, mat: THREE.Material) => b.add(g.translate(x, y, z), mat);
    add(new THREE.CylinderGeometry(0.015, 0.0135, 0.058, 28).translate(0, 0.029, 0), pal.glassClear);
    add(new THREE.CylinderGeometry(0.0108, 0.0098, 0.036, 20).translate(0, 0.021, 0), contents);
    add(new THREE.CylinderGeometry(0.015, 0.015, 0.012, 28).translate(0, 0.064, 0), pal.chromeSoft);
    const dome = new THREE.SphereGeometry(0.015, 28, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.4, 1);
    dome.translate(0, 0.07, 0);
    add(dome, pal.chromeSoft);
    for (let k = 0; k < 7; k++) {
      const r = k === 0 ? 0 : 0.0075, a = (k / 6) * Math.PI * 2;
      const hole = new THREE.CylinderGeometry(0.0013, 0.0013, 0.002, 6);
      hole.translate(Math.cos(a) * r, k === 0 ? 0.0755 : 0.0745, Math.sin(a) * r);
      add(hole, pal.blackPlastic);
    }
  };
  const tableSet = (cx: number, cz: number, y: number, yaw: number) => {
    // Local frame along the table's wall edge: caddy centred, dispenser one side, S&P the other.
    const rot = new THREE.Matrix4().makeRotationY(yaw);
    const at = (dx: number, dz: number) => new THREE.Vector3(dx, 0, dz).applyMatrix4(rot).add(new THREE.Vector3(cx, 0, cz));
    const c = at((rng() - 0.5) * 0.01, (rng() - 0.5) * 0.01);
    sugarCaddy(c.x, c.z, y, yaw + rng() * Math.PI);
    const d = at(-0.13 + (rng() - 0.5) * 0.01, (rng() - 0.5) * 0.01);
    dispenser(d.x, d.z, y, yaw + Math.PI / 2 + (rng() - 0.5) * 0.1);
    const s1 = at(0.075, 0.01 + (rng() - 0.5) * 0.02), s2 = at(0.115, -0.012 + (rng() - 0.5) * 0.02);
    shaker(s1.x, s1.z, y, pal.sugar);
    shaker(s2.x, s2.z, y, pal.pepper);
  };
  for (const cx of WINDOW.centersX) tableSet(cx, BOOTH.zOuter - 0.1, BOOTH.table.top, 0);
  // Counter: sets toward the back edge of the top at every second stool, dispenser faces the stools.
  for (const x of PROPS.napkinCounterX) tableSet(x, PROPS.napkinCounterZ, COUNTER.height, Math.PI / 2);

  /* ---------------- mugs ---------------- */
  const mugGeo = mugGeometry();
  const footGeo = mugFootGeometry();
  const yBar = BACK_BAR.height;
  const ledge = PROPS.mugLedge;
  {
    // Stainless drip tray: 12 mm pan with a ribbed grate, dark well underneath the ribs.
    b.rbox(pal.stainless, [ledge.x0, yBar, ledge.z0], [ledge.x1, yBar + 0.004, ledge.z1], 0.002);
    const wall = 0.004;
    b.rbox(pal.stainless, [ledge.x0, yBar, ledge.z0], [ledge.x0 + wall, yBar + 0.014, ledge.z1], 0.001);
    b.rbox(pal.stainless, [ledge.x1 - wall, yBar, ledge.z0], [ledge.x1, yBar + 0.014, ledge.z1], 0.001);
    b.rbox(pal.stainless, [ledge.x0, yBar, ledge.z0], [ledge.x1, yBar + 0.014, ledge.z0 + wall], 0.001);
    b.rbox(pal.stainless, [ledge.x0, yBar, ledge.z1 - wall], [ledge.x1, yBar + 0.014, ledge.z1], 0.001);
    b.box(pal.rubberMat, [ledge.x0 + wall, yBar + 0.004, ledge.z0 + wall], [ledge.x1 - wall, yBar + 0.006, ledge.z1 - wall]);
    const ribs = Math.round((ledge.x1 - ledge.x0) / 0.012);
    for (let k = 0; k < ribs; k++) {
      const xr = ledge.x0 + wall + 0.006 + k * ((ledge.x1 - ledge.x0 - 2 * wall - 0.012) / (ribs - 1));
      b.box(pal.stainless, [xr - 0.0015, yBar + 0.006, ledge.z0 + wall + 0.004], [xr + 0.0015, yBar + 0.014, ledge.z1 - wall - 0.004]);
    }
  }
  const mugPoses: THREE.Matrix4[] = [];
  const mugAt = (x: number, y: number, z: number, yaw: number, inverted: boolean) => {
    const m = new THREE.Matrix4().makeRotationY(yaw);
    if (inverted) m.premultiply(new THREE.Matrix4().makeRotationX(Math.PI)).setPosition(x, y + MUG_H, z);
    else m.setPosition(x, y, z);
    mugPoses.push(m);
  };
  // Drip tray: four 140 mm saucers with inverted mugs (random handle angle, ±6 mm scatter)
  const saucerGeo = saucerGeometry();
  const trayCols = 2, trayRows = 2;
  for (let i = 0; i < trayCols * trayRows; i++) {
    const col = i % trayCols, row = Math.floor(i / trayCols);
    const sx = ledge.x0 + 0.1 + col * 0.16 + (rng() - 0.5) * 0.012;
    const sz = ledge.z0 + 0.075 + row * 0.15 + (rng() - 0.5) * 0.012;
    const sc = saucerGeo.clone();
    sc.translate(sx, yBar + 0.014, sz);
    b.add(sc, pal.ceramic);
    mugAt(sx + (rng() - 0.5) * 0.006, yBar + 0.014 + 0.009, sz + (rng() - 0.5) * 0.006, rng() * Math.PI * 2, true);
  }
  // Three loose mugs standing upright beside the tray, jittered
  for (let i = 0; i < 3; i++) {
    mugAt(ledge.x1 + 0.07 + i * 0.1 + (rng() - 0.5) * 0.03, yBar, ledge.z0 + 0.09 + (rng() - 0.5) * 0.08, rng() * Math.PI * 2, false);
  }
  // Inverted mugs on saucers at two stools
  for (const x of PROPS.saucerStoolX) {
    const s = saucerGeo.clone();
    s.translate(x, COUNTER.height, PROPS.saucerZ);
    b.add(s, pal.ceramic);
    mugAt(x, COUNTER.height + 0.009, PROPS.saucerZ, Math.PI * (0.9 + rng() * 0.3), true);
  }
  for (const [geo, mat, name] of [[mugGeo, pal.ceramic, "mugs"], [footGeo, pal.bisque, "mug-feet"]] as const) {
    const im = new THREE.InstancedMesh(geo, mat, mugPoses.length);
    mugPoses.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = im.receiveShadow = true;
    im.name = name;
    parent.add(im);
  }
  // The pour mug: its own mesh so System 7 can find and fill it.
  const pourMug = new THREE.Mesh(mugGeo, pal.ceramic);
  pourMug.name = "pourMug";
  pourMug.position.set(PROPS.pourMug.x, yBar, PROPS.pourMug.z);
  pourMug.rotation.y = -0.6;
  pourMug.castShadow = pourMug.receiveShadow = true;
  const pourFoot = new THREE.Mesh(footGeo, pal.bisque);
  pourMug.add(pourFoot);
  parent.add(pourMug);

  /* ---------------- BUNN VPR-class brewer + decanter ---------------- */
  const coffeePot = new THREE.Group();
  {
    const { x, zBack, width, depth, height } = PROPS.brewer;
    const x0 = x - width / 2, x1 = x + width / 2;
    const zBody = zBack + depth; // 203 mm body
    const zBase = zBack + 0.32; // warmer apron runs forward of the body
    const yTop = yBar + height, yHead = yTop - 0.11;
    const zW = zBack + 0.21; // lower warmer centre, under the funnel
    // Base with ONE lower warmer; black front panel with pilot light and rocker switches
    b.rbox(pal.stainless, [x0, yBar, zBack], [x1, yBar + 0.05, zBase], 0.004, 3);
    b.box(pal.blackPlastic, [x0 + 0.004, yBar + 0.006, zBase - 0.003], [x1 - 0.004, yBar + 0.046, zBase + 0.001]);
    b.rbox(pal.pilotRed, [x + 0.116, yBar + 0.022, zBase - 0.002], [x + 0.124, yBar + 0.03, zBase + 0.004], 0.002);
    b.rbox(pal.chromeSoft, [x + 0.14, yBar + 0.018, zBase - 0.002], [x + 0.17, yBar + 0.034, zBase + 0.006], 0.003);
    b.rbox(pal.chromeSoft, [x - 0.17, yBar + 0.018, zBase - 0.002], [x - 0.14, yBar + 0.034, zBase + 0.006], 0.003);
    const ring = new THREE.CylinderGeometry(0.09, 0.09, 0.004, 48);
    ring.translate(x, yBar + 0.052, zW);
    b.add(ring, pal.stainless);
    const plate = new THREE.CylinderGeometry(0.084, 0.084, 0.004, 48);
    plate.translate(x, yBar + 0.056, zW);
    b.add(plate, pal.darkMetal);
    // Body: stainless wrap, full width, 203 deep; brushed front so the dark coffee reads against it
    b.rbox(pal.stainless, [x0, yBar + 0.05, zBack], [x1, yHead, zBody], 0.004, 3);
    b.box(pal.chromeBrushed, [x0 + 0.004, yBar + 0.06, zBody - 0.002], [x1 - 0.004, yHead - 0.004, zBody + 0.001]);
    // Head: overhangs the warmer; fill lid at the back with a visible seam; blank badge plate on the front
    b.rbox(pal.stainless, [x0, yHead, zBack], [x1, yTop, zBack + 0.3], 0.005, 3);
    b.box(pal.blackPlastic, [x0 + 0.004, yHead + 0.01, zBack + 0.297], [x1 - 0.004, yTop - 0.01, zBack + 0.301]);
    b.rbox(pal.stainless, [x0 + 0.006, yTop - 0.001, zBack + 0.006], [x1 - 0.006, yTop + 0.004, zBack + 0.118], 0.002);
    b.box(pal.darkMetal, [x0 + 0.004, yTop - 0.0005, zBack + 0.118], [x1 - 0.004, yTop + 0.0015, zBack + 0.1195]);
    b.rbox(pal.chromeSoft, [x - 0.04, yHead + 0.045, zBack + 0.3], [x + 0.04, yHead + 0.068, zBack + 0.303], 0.0015);
    // ONE upper warmer plate on the head
    const upperRing = new THREE.CylinderGeometry(0.088, 0.088, 0.004, 48);
    upperRing.translate(x, yTop + 0.002, zBack + 0.19);
    b.add(upperRing, pal.stainless);
    const upperPlate = new THREE.CylinderGeometry(0.082, 0.082, 0.004, 48);
    upperPlate.translate(x, yTop + 0.006, zBack + 0.19);
    b.add(upperPlate, pal.darkMetal);
    // Brew funnel: deep black SplashGard bowl (Ø 200 × 60) with a flat rim flange, sliding in
    // stainless rails under the head; handle bar forward
    for (const s of [-1, 1]) {
      b.box(pal.stainless, [x + s * 0.108 - 0.004, yHead - 0.03, zBack + 0.06], [x + s * 0.108 + 0.004, yHead, zBack + 0.29]);
      b.box(pal.stainless, [x + s * 0.108 - 0.014, yHead - 0.03, zBack + 0.06], [x + s * 0.108 + 0.014, yHead - 0.026, zBack + 0.29]);
    }
    // Funnel bowl: 4" (100 mm) deep, Ø 200 rim flange tapering to a Ø 70 spout boss
    const funnel = new THREE.LatheGeometry(
      [V2(0, -0.104), V2(0.03, -0.104), V2(0.036, -0.1), V2(0.055, -0.088), V2(0.082, -0.05), V2(0.096, -0.014), V2(0.1, -0.002), V2(0.106, -0.002), V2(0.106, 0.004), V2(0.095, 0.004), V2(0.094, -0.008), V2(0.08, -0.046), V2(0.052, -0.083), V2(0.034, -0.095), V2(0, -0.097)],
      48,
    );
    funnel.translate(x, yHead - 0.008, zW);
    b.add(funnel, pal.blackPlastic);
    b.rbox(pal.blackPlastic, [x - 0.014, yHead - 0.03, zW + 0.09], [x + 0.014, yHead - 0.012, zW + 0.17], 0.004);
    // Decanter on the warmer: 173 Ø × 178, 55 % full, black handle + spout collar, stainless base ring
    const px = x, pz = zW, py = yBar + 0.058;
    const R = 0.0865, Hd = 0.178;
    const glass = new THREE.LatheGeometry(
      [
        V2(0, 0.001), V2(0.045, 0.001), V2(0.066, 0.006), V2(0.079, 0.02), V2(R - 0.002, 0.045), V2(R, 0.08), V2(R - 0.003, 0.11), V2(0.074, 0.14), V2(0.064, 0.158), V2(0.06, 0.168), V2(0.063, Hd), V2(0.06, Hd),
        V2(0.0575, 0.168), V2(0.0615, 0.158), V2(0.0715, 0.14), V2(R - 0.0055, 0.11), V2(R - 0.0025, 0.08), V2(R - 0.0045, 0.045), V2(0.0765, 0.02), V2(0.064, 0.0085), V2(0.045, 0.0035), V2(0, 0.0035),
      ],
      64,
    );
    const glassMesh = new THREE.Mesh(glass, pal.glassClear);
    glassMesh.name = "coffeePot:glass";
    // Coffee to 55 % as an opaque dark body: fills the inner profile with a meniscus curling up at the wall
    const fillY = 0.098;
    const coffee = new THREE.LatheGeometry(
      [V2(0, 0.0035), V2(0.045, 0.0035), V2(0.064, 0.0085), V2(0.0765, 0.02), V2(R - 0.0045, 0.045), V2(R - 0.0025, 0.08), V2(R - 0.0031, fillY + 0.0018), V2(R - 0.005, fillY + 0.0014), V2(R - 0.014, fillY + 0.0002), V2(0, fillY)],
      64,
    );
    const coffeeMesh = new THREE.Mesh(coffee, pal.coffee);
    coffeeMesh.name = "coffeePot:coffee";
    // Tide-line stain just above the fill, inside the glass
    const stain = new THREE.CylinderGeometry(R - 0.0035, R - 0.0033, 0.014, 64, 1, true);
    stain.translate(0, fillY + 0.0085, 0);
    const stainMesh = new THREE.Mesh(stain, pal.coffeeStain);
    // Black spout collar and 25 mm handle bonded to the body
    const collar = new THREE.CylinderGeometry(0.0655, 0.062, 0.03, 48, 1, true);
    collar.translate(0, 0.156, 0);
    const collarRing = new THREE.TorusGeometry(0.0645, 0.0045, 10, 48);
    collarRing.rotateX(Math.PI / 2);
    collarRing.translate(0, 0.142, 0);
    // D-handle: 12 mm black bar 40 mm off the glass, from the collar down to mid-body, with two arms bonded to the body.
    const handleBar = new THREE.CylinderGeometry(0.0125, 0.0125, 0.105, 16);
    handleBar.translate(R + 0.028, 0.105, 0);
    const armTop = new THREE.CylinderGeometry(0.011, 0.011, 0.05, 12);
    armTop.rotateZ(Math.PI / 2);
    armTop.translate(R + 0.004, 0.155, 0);
    const armBot = new THREE.CylinderGeometry(0.011, 0.011, 0.045, 12);
    armBot.rotateZ(Math.PI / 2);
    armBot.translate(R - 0.006, 0.058, 0);
    const knuckleT = new THREE.SphereGeometry(0.0125, 14, 10);
    knuckleT.translate(R + 0.028, 0.155, 0);
    const knuckleB = new THREE.SphereGeometry(0.0125, 14, 10);
    knuckleB.translate(R + 0.028, 0.056, 0);
    const handle = mergeGeometries([handleBar.toNonIndexed(), armTop.toNonIndexed(), armBot.toNonIndexed(), knuckleT.toNonIndexed(), knuckleB.toNonIndexed()], false)!;
    const bond = new THREE.BoxGeometry(0.02, 0.05, 0.03);
    bond.translate(0.078, 0.145, 0);
    const handleMesh = new THREE.Mesh(mergeGeometries([collar.toNonIndexed(), collarRing.toNonIndexed(), handle.toNonIndexed(), bond.toNonIndexed()], false)!, pal.blackPlastic);
    handleMesh.name = "coffeePot:handle";
    const baseRing = new THREE.TorusGeometry(0.06, 0.004, 10, 48);
    baseRing.rotateX(Math.PI / 2);
    baseRing.translate(0, 0.003, 0);
    const baseMesh = new THREE.Mesh(baseRing, pal.stainless);
    coffeePot.add(glassMesh, coffeeMesh, stainMesh, handleMesh, baseMesh);
    coffeePot.name = "coffeePot";
    coffeePot.position.set(px, py, pz);
    coffeePot.rotation.y = -0.4; // handle to the right, quartered toward the service aisle; spout to the wall
    coffeePot.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    parent.add(coffeePot);
  }

  /* ---------------- tray station ---------------- */
  {
    const { x, z, count } = PROPS.trays;
    for (let i = 0; i < count; i++) {
      const m = new THREE.Matrix4().makeRotationY((rng() - 0.5) * 0.1);
      m.setPosition(x + (rng() - 0.5) * 0.012, yBar + i * 0.02, z + (rng() - 0.5) * 0.012);
      const tray = new THREE.BoxGeometry(0.35, 0.02, 0.45);
      tray.translate(0, 0.01, 0);
      b.add(tray, pal.trayBrown, m);
      const well = new THREE.BoxGeometry(0.31, 0.006, 0.41);
      well.translate(0, 0.02, 0);
      b.add(well, pal.rubberMat, m);
    }
  }

  /* ---------------- wall clock ---------------- */
  {
    const { x, y, radius, hour, minute } = PROPS.clock;
    const z = ROOM.zBack + 0.04;
    const shell = new THREE.CylinderGeometry(radius, radius - 0.004, 0.04, 48);
    shell.rotateX(Math.PI / 2);
    shell.translate(x, y, z - 0.02);
    b.add(shell, pal.blackPlastic);
    // Chrome bezel ring holding a domed glass
    const bezel = new THREE.TorusGeometry(radius - 0.005, 0.007, 12, 64);
    bezel.translate(x, y, z);
    b.add(bezel, pal.chromeSoft);
    const face = new THREE.CylinderGeometry(radius - 0.01, radius - 0.01, 0.004, 48);
    face.rotateX(Math.PI / 2);
    face.translate(x, y, z - 0.008);
    b.add(face, pal.clockFace);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const tick = new THREE.BoxGeometry(k % 3 === 0 ? 0.008 : 0.005, 0.016, 0.002);
      tick.rotateZ(-a);
      tick.translate(x + Math.sin(a) * (radius - 0.03), y + Math.cos(a) * (radius - 0.03), z - 0.005);
      b.add(tick, pal.blackPlastic);
    }
    const hand = (len: number, w: number, angle: number, mat: THREE.Material, zOff: number) => {
      const h = new THREE.BoxGeometry(w, len, 0.0015);
      h.translate(0, len / 2 - 0.012, 0);
      h.rotateZ(-angle);
      h.translate(x, y, z + zOff);
      b.add(h, mat);
    };
    const minA = (minute / 60) * Math.PI * 2, hourA = ((hour % 12) / 12 + minute / 720) * Math.PI * 2;
    hand(radius * 0.55, 0.008, hourA, pal.blackPlastic, -0.003);
    hand(radius * 0.8, 0.006, minA, pal.blackPlastic, -0.001);
    hand(radius * 0.85, 0.002, (37 / 60) * Math.PI * 2, pal.pilotRed, 0.001);
    const hub = new THREE.CylinderGeometry(0.006, 0.006, 0.006, 16);
    hub.rotateX(Math.PI / 2);
    hub.translate(x, y, z - 0.001);
    b.add(hub, pal.blackPlastic);
    // Glass: a shallow dome in front of the hands
    const glass = new THREE.SphereGeometry(radius - 0.006, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    glass.scale(1, 0.12, 1);
    glass.rotateX(Math.PI / 2);
    glass.translate(x, y, z + 0.004);
    b.add(glass, pal.glass);
  }

  b.build(parent, { name: "props" });
  return { pourMug, coffeePot };
}
