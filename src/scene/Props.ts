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
 * Victor-style heavy mug: 89 mm tall, Ø 80 with a slight mid-body waist, 6 mm
 * walls, rounded rim, small C-handle. Origin at the foot; the unglazed foot
 * ring is a separate geometry (see `mugFootGeometry`).
 */
function mugGeometry(): THREE.BufferGeometry {
  const body = new THREE.LatheGeometry(
    [
      V2(0, 0.004), V2(0.034, 0.004), V2(0.038, 0.007), V2(0.04, 0.014),
      V2(0.0395, 0.03), V2(0.0385, 0.048), V2(0.0392, 0.066), V2(0.04, 0.08), V2(0.039, 0.0865), V2(0.0365, MUG_H), V2(0.0335, 0.087),
      V2(0.033, 0.078), V2(0.0325, 0.05), V2(0.033, 0.016), V2(0.03, 0.012), V2(0, 0.012),
    ],
    40,
  );
  const handle = new THREE.TorusGeometry(0.02, 0.006, 10, 24, 1.3 * Math.PI);
  handle.rotateZ(-0.65 * Math.PI);
  handle.translate(0.054, 0.046, 0);
  return mergeGeometries([body.toNonIndexed(), handle.toNonIndexed()], false)!;
}

/** Unglazed foot ring, 4 mm tall, matching the mug's base. */
function mugFootGeometry(): THREE.BufferGeometry {
  return new THREE.LatheGeometry([V2(0.028, 0.0002), V2(0.03, 0), V2(0.036, 0), V2(0.0365, 0.004), V2(0.0275, 0.004), V2(0.028, 0.0002)], 40);
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
  // Dispenser: 117 W × 98 D × 184 H, brushed stainless. Side panels + bottom, lipped top cap,
  // face plates inset 2 mm on both broad faces (±z) with a real opening, and a folded napkin
  // stack inside whose layered edges show through the opening.
  const dispenser = (x: number, z: number, yTop: number, yaw: number) => {
    const m = new THREE.Matrix4().makeRotationY(yaw);
    m.setPosition(x, yTop, z);
    const W = 0.117, D = 0.098, H = 0.178, t = 0.0035;
    const add = (g: THREE.BufferGeometry, mat: THREE.Material) => b.add(g, mat, m);
    const box = (mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      add(g, mat);
    };
    // Sides, bottom
    box(pal.chromeBrushed, -W / 2, 0.003, -D / 2, -W / 2 + t, H, D / 2);
    box(pal.chromeBrushed, W / 2 - t, 0.003, -D / 2, W / 2, H, D / 2);
    box(pal.chromeBrushed, -W / 2, 0.003, -D / 2, W / 2, 0.003 + t, D / 2);
    // Lipped top cap: 2 mm larger all round, 10 mm skirt
    add(new THREE.BoxGeometry(W + 0.004, 0.01, D + 0.004).translate(0, H + 0.001, 0), pal.chromeBrushed);
    // Face plates (inset 2 mm) with an 84 × 96 opening from y 0.038 to 0.134
    const oW = 0.084, oY0 = 0.038, oY1 = 0.134;
    for (const s of [-1, 1]) {
      const zf0 = s * (D / 2 - 0.002 - t), zf1 = s * (D / 2 - 0.002);
      const [za, zb] = zf0 < zf1 ? [zf0, zf1] : [zf1, zf0];
      box(pal.chromeBrushed, -W / 2 + t, 0.003 + t, za, W / 2 - t, oY0, zb);
      box(pal.chromeBrushed, -W / 2 + t, oY1, za, W / 2 - t, H, zb);
      box(pal.chromeBrushed, -W / 2 + t, oY0, za, -oW / 2, oY1, zb);
      box(pal.chromeBrushed, oW / 2, oY0, za, W / 2 - t, oY1, zb);
    }
    // Napkin stack: 9 folded layers filling the depth between the plates, edges jittered ±1 mm
    // so they read as separate sheets; the outer sheet on each face pokes 3 mm out of the slot.
    const layers = 9, span = D - 2 * (0.002 + t) - 0.002;
    const th = span / layers;
    for (let k = 0; k < layers; k++) {
      const zc = -span / 2 + th * (k + 0.5);
      const g = new THREE.BoxGeometry(oW - 0.012 + (rng() - 0.5) * 0.002, 0.086 + (rng() - 0.5) * 0.003, th * 0.92);
      g.translate((rng() - 0.5) * 0.002, 0.086 + (rng() - 0.5) * 0.002, zc);
      add(g, pal.napkin);
    }
    for (const s of [-1, 1]) {
      const sheet = new THREE.BoxGeometry(oW - 0.014, 0.08, 0.0012);
      sheet.rotateX(s * THREE.MathUtils.degToRad(4));
      sheet.translate(0, 0.084, s * (D / 2 + 0.0015));
      add(sheet, pal.napkin);
      const tab = new THREE.BoxGeometry(0.048, 0.024, 0.0012);
      tab.translate(0, -0.012, 0);
      tab.rotateX(-s * THREE.MathUtils.degToRad(30));
      tab.translate(0.004 * s, 0.05, s * (D / 2 + 0.006));
      add(tab, pal.napkin);
    }
    // Rubber feet line
    add(new THREE.BoxGeometry(W - 0.01, 0.003, D - 0.01).translate(0, 0.0015, 0), pal.blackPlastic);
  };
  // Sugar pourer: clear glass Ø 60 × 100, 80 % full, ribbed chrome cap with a flip spout.
  const sugarCaddy = (x: number, z: number, y: number, yaw = 0) => {
    const m = new THREE.Matrix4().makeRotationY(yaw);
    m.setPosition(x, y, z);
    const add = (g: THREE.BufferGeometry, mat: THREE.Material) => b.add(g, mat, m);
    add(new THREE.CylinderGeometry(0.03, 0.028, 0.1, 32).translate(0, 0.05, 0), pal.glassClear);
    add(new THREE.CylinderGeometry(0.0272, 0.0255, 0.078, 24).translate(0, 0.041, 0), pal.sugar);
    add(new THREE.CylinderGeometry(0.031, 0.031, 0.022, 32).translate(0, 0.109, 0), pal.chrome);
    for (let k = 0; k < 16; k++) {
      const rib = new THREE.BoxGeometry(0.0035, 0.018, 0.003);
      rib.translate(0, 0.108, 0.031);
      rib.rotateY((k / 16) * Math.PI * 2);
      add(rib, pal.chrome);
    }
    add(new THREE.CylinderGeometry(0.029, 0.031, 0.004, 32).translate(0, 0.122, 0), pal.chrome);
    // Flip spout: chute + hinged flap
    add(new THREE.BoxGeometry(0.014, 0.01, 0.03).translate(0, 0.121, 0.02), pal.chrome);
    const flap = new THREE.CylinderGeometry(0.009, 0.009, 0.014, 12);
    flap.rotateZ(Math.PI / 2);
    flap.translate(0, 0.129, 0.006);
    add(flap, pal.chrome);
  };
  // Salt / pepper: clear glass Ø 30, 30 mm perforated chrome cap with seven holes.
  const shaker = (x: number, z: number, y: number, contents: THREE.Material) => {
    const add = (g: THREE.BufferGeometry, mat: THREE.Material) => b.add(g.translate(x, y, z), mat);
    add(new THREE.CylinderGeometry(0.015, 0.014, 0.055, 24).translate(0, 0.0275, 0), pal.glassClear);
    add(new THREE.CylinderGeometry(0.0125, 0.0115, 0.038, 16).translate(0, 0.02, 0), contents);
    add(new THREE.CylinderGeometry(0.015, 0.015, 0.014, 24).translate(0, 0.062, 0), pal.chrome);
    const dome = new THREE.SphereGeometry(0.015, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.4, 1);
    dome.translate(0, 0.069, 0);
    add(dome, pal.chrome);
    for (let k = 0; k < 7; k++) {
      const r = k === 0 ? 0 : 0.0075, a = (k / 6) * Math.PI * 2;
      const hole = new THREE.CylinderGeometry(0.0012, 0.0012, 0.002, 6);
      hole.translate(Math.cos(a) * r, k === 0 ? 0.0745 : 0.0735, Math.sin(a) * r);
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
  for (let i = 0; i < 6; i++) {
    const col = i % 3, row = Math.floor(i / 3);
    mugAt(ledge.x0 + 0.1 + col * 0.11 + (rng() - 0.5) * 0.01, yBar + 0.014, ledge.z0 + 0.07 + row * 0.13 + (rng() - 0.5) * 0.01, rng() * Math.PI * 2, true);
  }
  // Inverted mugs on saucers at two stools
  const saucerGeo = saucerGeometry();
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
    const wL = x - 0.1025, wR = x + 0.1025, zW = zBack + 0.21; // warmer centres
    // Base with the two lower warmers; black front panel with pilot light and rocker switch
    b.rbox(pal.stainless, [x0, yBar, zBack], [x1, yBar + 0.05, zBase], 0.004, 3);
    b.box(pal.blackPlastic, [x0 + 0.004, yBar + 0.006, zBase - 0.003], [x1 - 0.004, yBar + 0.046, zBase + 0.001]);
    b.rbox(pal.pilotRed, [x - 0.004, yBar + 0.022, zBase - 0.002], [x + 0.004, yBar + 0.03, zBase + 0.004], 0.002);
    b.rbox(pal.chrome, [x + 0.03, yBar + 0.018, zBase - 0.002], [x + 0.06, yBar + 0.034, zBase + 0.006], 0.003);
    b.rbox(pal.chrome, [x - 0.06, yBar + 0.018, zBase - 0.002], [x - 0.03, yBar + 0.034, zBase + 0.006], 0.003);
    for (const wx of [wL, wR]) {
      const ring = new THREE.CylinderGeometry(0.086, 0.086, 0.004, 40);
      ring.translate(wx, yBar + 0.052, zW);
      b.add(ring, pal.stainless);
      const plate = new THREE.CylinderGeometry(0.08, 0.08, 0.004, 40);
      plate.translate(wx, yBar + 0.056, zW);
      b.add(plate, pal.darkMetal);
    }
    // Body: stainless wrap with a black front panel, full width, 203 deep
    b.rbox(pal.stainless, [x0, yBar + 0.05, zBack], [x1, yHead, zBody], 0.004, 3);
    b.box(pal.blackPlastic, [x0 + 0.004, yBar + 0.06, zBody - 0.003], [x1 - 0.004, yHead - 0.004, zBody + 0.001]);
    // Head: overhangs the warmers; fill lid at the back with a visible seam; badge plate on the front
    b.rbox(pal.stainless, [x0, yHead, zBack], [x1, yTop, zBack + 0.3], 0.005, 3);
    b.box(pal.blackPlastic, [x0 + 0.004, yHead + 0.01, zBack + 0.297], [x1 - 0.004, yTop - 0.01, zBack + 0.301]);
    b.rbox(pal.stainless, [x0 + 0.006, yTop - 0.001, zBack + 0.006], [x1 - 0.006, yTop + 0.004, zBack + 0.118], 0.002);
    b.box(pal.darkMetal, [x0 + 0.004, yTop - 0.0005, zBack + 0.118], [x1 - 0.004, yTop + 0.0015, zBack + 0.1195]);
    b.rbox(pal.chrome, [x - 0.035, yHead + 0.045, zBack + 0.3], [x + 0.035, yHead + 0.065, zBack + 0.302], 0.001);
    // Upper warmer plate on the head, over the right lower warmer
    const upperRing = new THREE.CylinderGeometry(0.084, 0.084, 0.004, 40);
    upperRing.translate(wR, yTop + 0.002, zBack + 0.19);
    b.add(upperRing, pal.stainless);
    const upperPlate = new THREE.CylinderGeometry(0.078, 0.078, 0.004, 40);
    upperPlate.translate(wR, yTop + 0.006, zBack + 0.19);
    b.add(upperPlate, pal.darkMetal);
    // Brew funnel: black 200 × 60 sliding in stainless rails under the head, over the left warmer
    for (const s of [-1, 1]) {
      b.box(pal.stainless, [wL + s * 0.104 - 0.004, yHead - 0.03, zBack + 0.06], [wL + s * 0.104 + 0.004, yHead, zBack + 0.29]);
      b.box(pal.stainless, [wL + s * 0.104 - 0.012, yHead - 0.03, zBack + 0.06], [wL + s * 0.104 + 0.012, yHead - 0.026, zBack + 0.29]);
    }
    b.rbox(pal.blackPlastic, [wL - 0.1, yHead - 0.06, zBack + 0.08], [wL + 0.1, yHead - 0.004, zBack + 0.28], 0.006, 3);
    const funnelCone = new THREE.CylinderGeometry(0.08, 0.03, 0.03, 32);
    funnelCone.translate(wL, yHead - 0.075, zW);
    b.add(funnelCone, pal.blackPlastic);
    b.rbox(pal.blackPlastic, [wL - 0.012, yHead - 0.05, zBack + 0.28], [wL + 0.012, yHead - 0.032, zBack + 0.35], 0.004);
    // Decanter on the left lower warmer: 170 Ø × 180, half full, black collar + handle, tide line
    const px = wL, pz = zW, py = yBar + 0.058;
    const R = 0.085;
    const glass = new THREE.LatheGeometry(
      [
        V2(0, 0), V2(0.05, 0), V2(0.072, 0.007), V2(R - 0.003, 0.035), V2(R, 0.075), V2(R - 0.004, 0.11), V2(0.068, 0.15), V2(0.06, 0.165), V2(0.064, 0.178), V2(0.062, 0.18),
        V2(0.058, 0.167), V2(0.064, 0.15), V2(R - 0.007, 0.11), V2(R - 0.003, 0.075), V2(R - 0.006, 0.035), V2(0.07, 0.01), V2(0.05, 0.003), V2(0, 0.003),
      ],
      48,
    );
    const glassMesh = new THREE.Mesh(glass, pal.glassClear);
    glassMesh.name = "coffeePot:glass";
    // Coffee to 50 %: fills the inner profile, meniscus curls up 1.5 mm at the wall
    const fillY = 0.09;
    const coffee = new THREE.LatheGeometry(
      [V2(0, 0.004), V2(0.05, 0.004), V2(0.069, 0.011), V2(R - 0.0065, 0.035), V2(R - 0.0035, 0.075), V2(R - 0.0035, fillY + 0.0015), V2(R - 0.0055, fillY + 0.0012), V2(R - 0.012, fillY), V2(0, fillY - 0.0005)],
      48,
    );
    const coffeeMesh = new THREE.Mesh(coffee, pal.coffee);
    coffeeMesh.name = "coffeePot:coffee";
    // Tide-line stain just above the fill, inside the glass
    const stain = new THREE.CylinderGeometry(R - 0.0035, R - 0.0036, 0.012, 48, 1, true);
    stain.translate(0, fillY + 0.0065, 0);
    const stainMesh = new THREE.Mesh(stain, pal.coffeeStain);
    const collar = new THREE.CylinderGeometry(0.068, 0.066, 0.028, 32, 1, true);
    collar.translate(0, 0.158, 0);
    const collarRing = new THREE.TorusGeometry(0.067, 0.004, 8, 32);
    collarRing.rotateX(Math.PI / 2);
    collarRing.translate(0, 0.145, 0);
    const handle = new THREE.TorusGeometry(0.052, 0.009, 10, 28, 1.05 * Math.PI);
    handle.rotateZ(-0.6 * Math.PI);
    handle.scale(1, 1.25, 1);
    handle.translate(0.1, 0.1, 0);
    const handleMesh = new THREE.Mesh(mergeGeometries([collar.toNonIndexed(), collarRing.toNonIndexed(), handle.toNonIndexed()], false)!, pal.blackPlastic);
    handleMesh.name = "coffeePot:handle";
    coffeePot.add(glassMesh, coffeeMesh, stainMesh, handleMesh);
    coffeePot.name = "coffeePot";
    coffeePot.position.set(px, py, pz);
    coffeePot.rotation.y = 0.35; // handle toward the service aisle
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
    b.add(bezel, pal.chrome);
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
