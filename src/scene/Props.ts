/**
 * System 2 props: napkin dispensers, sugar caddies and shakers on every table
 * and along the counter; heavy ceramic mugs (instanced) on a stainless ledge,
 * on saucers at two stools, and the named `pourMug`; a two-burner drip brewer
 * with the glass decanter `coffeePot`; a tray stack; a plain wall clock.
 * Static geometry is merged per material; the mugs are one InstancedMesh.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { makeRng } from "../core/rng";
import { prismXY } from "../core/shapes";
import { BACK_BAR, BOOTH, COUNTER, PROPS, ROOM, WINDOW } from "./layout";

export interface PropsResult {
  pourMug: THREE.Mesh;
  coffeePot: THREE.Group;
}

const V2 = (x: number, y: number) => new THREE.Vector2(x, y);

/** Victor-style heavy mug: 89 mm tall, Ø 80, 6 mm wall, foot ring, C-handle. Origin at the foot. */
function mugGeometry(): THREE.BufferGeometry {
  const body = new THREE.LatheGeometry(
    [
      V2(0, 0.004), V2(0.027, 0.004), V2(0.03, 0), V2(0.036, 0), V2(0.04, 0.006),
      V2(0.041, 0.03), V2(0.041, 0.07), V2(0.04, 0.083), V2(0.0375, 0.089), V2(0.0345, 0.087),
      V2(0.034, 0.075), V2(0.034, 0.014), V2(0.03, 0.011), V2(0, 0.011),
    ],
    40,
  );
  const handle = new THREE.TorusGeometry(0.028, 0.0075, 10, 28, 1.3 * Math.PI);
  handle.rotateZ(-0.65 * Math.PI);
  handle.translate(0.062, 0.046, 0);
  return mergeGeometries([body.toNonIndexed(), handle.toNonIndexed()], false)!;
}

function saucerGeometry(): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    [V2(0, 0.003), V2(0.03, 0.003), V2(0.033, 0), V2(0.045, 0), V2(0.05, 0.005), V2(0.072, 0.014), V2(0.078, 0.018), V2(0.074, 0.019), V2(0.052, 0.011), V2(0.04, 0.008), V2(0, 0.008)],
    40,
  );
}

export function buildProps(parent: THREE.Group, pal: Palette): PropsResult {
  const b = new MergedBuilder();
  const rng = makeRng(4321);

  /* ---------------- napkin dispenser + condiments ---------------- */
  // Dispenser: 110 wide (tapering to 90 at the top) × 150 × 190, openings on both broad faces.
  // Local frame: broad faces at ±z, taper in x; `facing` rotates it.
  const dispenser = (x: number, z: number, yTop: number, yaw: number) => {
    const m = new THREE.Matrix4().makeRotationY(yaw);
    m.setPosition(x, yTop, z);
    const body = prismXY([[-0.055, 0], [0.055, 0], [0.045, 0.19], [-0.045, 0.19]], -0.075, 0.075, 0.004);
    b.add(body, pal.chromeBrushed, m);
    // Rolled top cap
    const cap = new THREE.BoxGeometry(0.094, 0.006, 0.154);
    cap.translate(0, 0.192, 0);
    b.add(cap, pal.chromeBrushed, m);
    for (const s of [-1, 1]) {
      // Opening (dark) with the napkin stack showing inside a 6 mm shadow gap and the
      // top napkin's corner curling out of the slot
      const slot = new THREE.BoxGeometry(0.084, 0.1, 0.003);
      slot.translate(0, 0.095, s * 0.0755);
      b.add(slot, pal.blackPlastic, m);
      const nap = new THREE.BoxGeometry(0.066, 0.08, 0.006);
      nap.rotateY(THREE.MathUtils.degToRad(1.5 * s));
      nap.translate(0.001 * s, 0.093, s * 0.079);
      b.add(nap, pal.napkin, m);
      const tab = new THREE.BoxGeometry(0.05, 0.028, 0.0015);
      tab.translate(0, -0.012, 0);
      tab.rotateX(-s * THREE.MathUtils.degToRad(28));
      tab.translate(0.006 * s, 0.062, s * 0.084);
      b.add(tab, pal.napkin, m);
    }
    // Base feet line
    const foot = new THREE.BoxGeometry(0.1, 0.003, 0.14);
    foot.translate(0, -0.0015, 0);
    b.add(foot, pal.blackPlastic, m);
  };
  const sugarCaddy = (x: number, z: number, y: number) => {
    const jar = new THREE.CylinderGeometry(0.03, 0.028, 0.095, 28);
    jar.translate(x, y + 0.0475, z);
    b.add(jar, pal.glassClear);
    const fill = new THREE.CylinderGeometry(0.0265, 0.0245, 0.06, 20);
    fill.translate(x, y + 0.032, z);
    b.add(fill, pal.sugar);
    const lid = new THREE.CylinderGeometry(0.032, 0.031, 0.02, 28);
    lid.translate(x, y + 0.105, z);
    b.add(lid, pal.chrome);
    // Flip spout
    const spout = new THREE.BoxGeometry(0.014, 0.012, 0.03);
    spout.translate(x, y + 0.118, z + 0.02);
    b.add(spout, pal.chrome);
    const flap = new THREE.CylinderGeometry(0.009, 0.009, 0.014, 12);
    flap.rotateZ(Math.PI / 2);
    flap.translate(x, y + 0.126, z + 0.005);
    b.add(flap, pal.chrome);
  };
  const shaker = (x: number, z: number, y: number, contents: THREE.Material) => {
    const jar = new THREE.CylinderGeometry(0.017, 0.016, 0.055, 20);
    jar.translate(x, y + 0.0275, z);
    b.add(jar, pal.glassClear);
    const fill = new THREE.CylinderGeometry(0.0145, 0.0135, 0.04, 16);
    fill.translate(x, y + 0.021, z);
    b.add(fill, contents);
    const cap = new THREE.CylinderGeometry(0.0175, 0.0175, 0.017, 20);
    cap.translate(x, y + 0.0635, z);
    b.add(cap, pal.chrome);
    const dome = new THREE.SphereGeometry(0.0175, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.35, 1);
    dome.translate(x, y + 0.072, z);
    b.add(dome, pal.chrome);
    // Perforations: a dark disc under the dome centre reads as the hole cluster
    const holes = new THREE.CylinderGeometry(0.007, 0.007, 0.002, 12);
    holes.translate(x, y + 0.0775, z);
    b.add(holes, pal.blackPlastic);
  };

  // Tables: dispenser at the wall end with broad faces toward the diners (±x), caddy and shakers beside it.
  for (const cx of WINDOW.centersX) {
    const y = BOOTH.table.top;
    const zWall = BOOTH.zOuter - 0.11;
    const j = (rng() - 0.5) * 0.02;
    dispenser(cx + j, zWall, y, Math.PI / 2 + (rng() - 0.5) * 0.12);
    // Caddy on the door (+x) side of every dispenser, shakers on the other: the way a
    // server resets tables, not a random scatter.
    sugarCaddy(cx + 0.13 + (rng() - 0.5) * 0.02, zWall + 0.01 + (rng() - 0.5) * 0.02, y);
    shaker(cx - 0.12, zWall - 0.005 + (rng() - 0.5) * 0.02, y, pal.sugar);
    shaker(cx - 0.165, zWall + 0.02 + (rng() - 0.5) * 0.02, y, pal.pepper);
  }
  // Counter: three dispensers facing the stools, shakers beside each.
  for (const x of PROPS.napkinCounterX) {
    const y = COUNTER.height;
    dispenser(x, PROPS.napkinCounterZ, y, (rng() - 0.5) * 0.1);
    shaker(x + 0.12, PROPS.napkinCounterZ + 0.02, y, pal.sugar);
    shaker(x + 0.165, PROPS.napkinCounterZ - 0.01, y, pal.pepper);
  }

  /* ---------------- mugs ---------------- */
  const mugGeo = mugGeometry();
  const yBar = BACK_BAR.height;
  const ledge = PROPS.mugLedge;
  {
    // Stainless ledge tray with a 20 mm back lip, rubber mat inside
    b.rbox(pal.stainless, [ledge.x0, yBar, ledge.z0], [ledge.x1, yBar + 0.012, ledge.z1], 0.003);
    b.rbox(pal.stainless, [ledge.x0, yBar, ledge.z0 - 0.004], [ledge.x1, yBar + 0.035, ledge.z0 + 0.008], 0.003);
    b.rbox(pal.rubberMat, [ledge.x0 + 0.015, yBar + 0.012, ledge.z0 + 0.02], [ledge.x1 - 0.015, yBar + 0.018, ledge.z1 - 0.015], 0.002);
  }
  const mugPoses: THREE.Matrix4[] = [];
  const mugAt = (x: number, y: number, z: number, yaw: number, inverted: boolean) => {
    const m = new THREE.Matrix4().makeRotationY(yaw);
    if (inverted) m.premultiply(new THREE.Matrix4().makeRotationX(Math.PI)).setPosition(x, y + 0.089, z);
    else m.setPosition(x, y, z);
    mugPoses.push(m);
  };
  for (let i = 0; i < 6; i++) {
    const col = i % 3, row = Math.floor(i / 3);
    mugAt(ledge.x0 + 0.1 + col * 0.11 + (rng() - 0.5) * 0.01, yBar + 0.018, ledge.z0 + 0.075 + row * 0.115 + (rng() - 0.5) * 0.01, rng() * Math.PI * 2, true);
  }
  // Mugs on saucers at two stools
  const saucerGeo = saucerGeometry();
  for (const x of PROPS.saucerStoolX) {
    const s = saucerGeo.clone();
    s.translate(x, COUNTER.height, PROPS.saucerZ);
    b.add(s, pal.ceramic);
    mugAt(x, COUNTER.height + 0.008, PROPS.saucerZ, Math.PI * (0.9 + rng() * 0.3), false);
  }
  const mugs = new THREE.InstancedMesh(mugGeo, pal.ceramic, mugPoses.length);
  mugPoses.forEach((m, i) => mugs.setMatrixAt(i, m));
  mugs.instanceMatrix.needsUpdate = true;
  mugs.castShadow = mugs.receiveShadow = true;
  mugs.name = "mugs";
  parent.add(mugs);
  // The pour mug: its own mesh so System 7 can find and fill it.
  const pourMug = new THREE.Mesh(mugGeo, pal.ceramic);
  pourMug.name = "pourMug";
  pourMug.position.set(PROPS.pourMug.x, yBar, PROPS.pourMug.z);
  pourMug.rotation.y = -0.6;
  pourMug.castShadow = pourMug.receiveShadow = true;
  parent.add(pourMug);

  /* ---------------- two-burner brewer + decanter ---------------- */
  const coffeePot = new THREE.Group();
  {
    const { x, zBack, width, towerDepth, baseDepth, height } = PROPS.brewer;
    const x0 = x - width / 2, x1 = x + width / 2;
    const zTower = zBack + towerDepth, zFront = zBack + baseDepth;
    // Base plate (stainless) with the lower warmer, black front panel with the pilot light
    b.rbox(pal.stainless, [x0, yBar, zBack], [x1, yBar + 0.04, zFront], 0.004, 3);
    b.box(pal.blackPlastic, [x0 + 0.004, yBar + 0.004, zFront - 0.003], [x1 - 0.004, yBar + 0.036, zFront + 0.001]);
    b.rbox(pal.pilotRed, [x1 - 0.03, yBar + 0.016, zFront - 0.002], [x1 - 0.022, yBar + 0.024, zFront + 0.004], 0.002);
    b.rbox(pal.chrome, [x0 + 0.02, yBar + 0.012, zFront - 0.002], [x0 + 0.05, yBar + 0.028, zFront + 0.006], 0.003); // rocker switch
    const lowerPlate = new THREE.CylinderGeometry(0.082, 0.082, 0.006, 40);
    lowerPlate.translate(x, yBar + 0.043, zFront - 0.105);
    b.add(lowerPlate, pal.darkMetal);
    // Tower: stainless sides, black front, brew head overhanging the lower warmer
    b.rbox(pal.stainless, [x0, yBar + 0.04, zBack], [x1, yBar + height - 0.14, zTower], 0.004, 3);
    b.box(pal.blackPlastic, [x0 + 0.004, yBar + 0.05, zTower - 0.003], [x1 - 0.004, yBar + height - 0.15, zTower + 0.001]);
    b.rbox(pal.stainless, [x0, yBar + height - 0.14, zBack], [x1, yBar + height, zFront - 0.02], 0.005, 3);
    b.box(pal.blackPlastic, [x0 + 0.004, yBar + height - 0.13, zFront - 0.023], [x1 - 0.004, yBar + height - 0.01, zFront - 0.019]);
    // Upper warmer plate on top of the head
    const upperPlate = new THREE.CylinderGeometry(0.075, 0.075, 0.008, 40);
    upperPlate.translate(x, yBar + height + 0.004, zBack + 0.11);
    b.add(upperPlate, pal.darkMetal);
    // Brew basket: black funnel under the head with a forward handle
    const funnel = new THREE.CylinderGeometry(0.072, 0.045, 0.085, 32);
    funnel.translate(x, yBar + height - 0.14 - 0.0425, zFront - 0.105);
    b.add(funnel, pal.blackPlastic);
    b.rbox(pal.blackPlastic, [x - 0.012, yBar + height - 0.165, zFront - 0.105], [x + 0.012, yBar + height - 0.148, zFront + 0.03], 0.004);
    // Decanter: 165 Ø × 180 tall borosilicate, half full, black collar + handle with an orange-brown band
    const px = x, pz = zFront - 0.105, py = yBar + 0.046;
    const glass = new THREE.LatheGeometry(
      [V2(0, 0), V2(0.05, 0), V2(0.07, 0.008), V2(0.081, 0.04), V2(0.083, 0.075), V2(0.078, 0.115), V2(0.064, 0.15), V2(0.058, 0.165), V2(0.062, 0.178), V2(0.06, 0.18), V2(0.056, 0.167), V2(0.062, 0.15), V2(0.076, 0.115), V2(0.081, 0.075), V2(0.079, 0.04), V2(0.068, 0.01), V2(0.05, 0.003), V2(0, 0.003)],
      48,
    );
    const glassMesh = new THREE.Mesh(glass, pal.glassClear);
    glassMesh.name = "coffeePot:glass";
    const coffee = new THREE.LatheGeometry(
      [V2(0, 0.004), V2(0.049, 0.004), V2(0.067, 0.011), V2(0.078, 0.04), V2(0.08, 0.075), V2(0.0785, 0.085), V2(0.0775, 0.0855), V2(0.07, 0.0835), V2(0, 0.083)],
      48,
    );
    const coffeeMesh = new THREE.Mesh(coffee, pal.coffee);
    coffeeMesh.name = "coffeePot:coffee";
    const collar = new THREE.CylinderGeometry(0.066, 0.064, 0.026, 32, 1, true);
    collar.translate(0, 0.158, 0);
    const band = new THREE.CylinderGeometry(0.0665, 0.0665, 0.006, 32, 1, true);
    band.translate(0, 0.149, 0);
    const handle = new THREE.TorusGeometry(0.052, 0.009, 10, 28, 1.05 * Math.PI);
    handle.rotateZ(-0.6 * Math.PI);
    handle.scale(1, 1.25, 1);
    handle.translate(0.098, 0.1, 0);
    const handleMesh = new THREE.Mesh(mergeGeometries([collar.toNonIndexed(), handle.toNonIndexed()], false)!, pal.blackPlastic);
    handleMesh.name = "coffeePot:handle";
    const bandMesh = new THREE.Mesh(band, pal.orangeBand);
    coffeePot.add(glassMesh, coffeeMesh, handleMesh, bandMesh);
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
    const z = ROOM.zBack + 0.035;
    const shell = new THREE.CylinderGeometry(radius, radius, 0.035, 48);
    shell.rotateX(Math.PI / 2);
    shell.translate(x, y, z - 0.0175);
    b.add(shell, pal.blackPlastic);
    const bezel = new THREE.TorusGeometry(radius - 0.006, 0.008, 10, 48);
    bezel.translate(x, y, z);
    b.add(bezel, pal.blackPlastic);
    const face = new THREE.CylinderGeometry(radius - 0.01, radius - 0.01, 0.004, 48);
    face.rotateX(Math.PI / 2);
    face.translate(x, y, z - 0.002);
    b.add(face, pal.clockFace);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const tick = new THREE.BoxGeometry(0.006, 0.016, 0.002);
      tick.rotateZ(-a);
      tick.translate(x + Math.sin(a) * (radius - 0.03), y + Math.cos(a) * (radius - 0.03), z + 0.001);
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
    hand(radius * 0.55, 0.008, hourA, pal.blackPlastic, 0.003);
    hand(radius * 0.8, 0.006, minA, pal.blackPlastic, 0.005);
    hand(radius * 0.85, 0.002, (37 / 60) * Math.PI * 2, pal.pilotRed, 0.007);
    const hub = new THREE.CylinderGeometry(0.006, 0.006, 0.006, 16);
    hub.rotateX(Math.PI / 2);
    hub.translate(x, y, z + 0.006);
    b.add(hub, pal.blackPlastic);
  }

  b.build(parent, { name: "props" });
  return { pourMug, coffeePot };
}
