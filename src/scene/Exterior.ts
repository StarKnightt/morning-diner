/**
 * System 3: everything seen through the glass. Concrete kerb and sidewalk, a
 * parking lot with a nose-in stall row, drive aisle and a CMU wall at the far
 * edge, two light standards, two boxy 80s–90s vehicles, desert dirt, low scrub,
 * a hazed mesa/ridge silhouette and a procedural sky dome with the sun glare.
 *
 * Everything is procedural and merged per material; the scrub is one
 * InstancedMesh. Exterior materials carry a small sky-fill emissive: the interior
 * hemisphere fill is deliberately low (REFERENCE §2 — do not put the outdoor
 * 10 klux hemisphere inside the room) and lights cannot be masked per object,
 * so the lot's diffuse sky light is approximated here. System 4 replaces it.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { makeRng, makeFbm } from "../core/rng";
import * as ext from "../procedural/exterior";
import { ROOM } from "./layout";

const T = ROOM.wallThickness;
export const LOT = {
  /** Sidewalk: building face to kerb. */
  kerbZ: ROOM.zFront + T + 1.8,
  kerbH: 0.15,
  /** Lot surface height (apron top is −0.12). */
  y: -0.12 - 0.15,
  /** Detailed lot canvas extent. */
  x0: -14,
  w: 28,
  d: 14,
  stallDepth: 5.5,
  stallPitch: 2.7,
  wallZ: ROOM.zFront + T + 1.8 + 14,
} as const;

export interface ExteriorResult {
  /** Materials whose envMap should be the lot probe (sky + facade). */
  envMaterials: THREE.Material[];
  sky: THREE.Mesh;
}

function skyFill(mat: THREE.MeshStandardMaterial, k: number): THREE.MeshStandardMaterial {
  // Diffuse sky fill approximation: emissive = albedo × k (placeholder until System 4).
  if (mat.map) { mat.emissiveMap = mat.map; mat.emissive.setScalar(k); }
  else mat.emissive.copy(mat.color).multiplyScalar(k);
  return mat;
}

/** Sky dome: horizon-white → pale desaturated blue, glare + 0.53° disc around the sun. */
function buildSky(sunDir: THREE.Vector3): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      sunDir: { value: sunDir.clone().normalize() },
      horizon: { value: new THREE.Color(0.9, 0.915, 0.93) },
      zenith: { value: new THREE.Color(0.34, 0.5, 0.8) },
      ground: { value: new THREE.Color(0.62, 0.6, 0.58) },
      sunColor: { value: new THREE.Color(1.0, 0.94, 0.84) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir, horizon, zenith, ground, sunColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        // Washed-out morning sky: the horizon band stays near white for the first ~12°.
        vec3 col = mix(horizon, zenith, pow(h, 0.55));
        float c = clamp(dot(d, sunDir), 0.0, 1.0);
        float glow = pow(c, 6.0) * 0.18 + pow(c, 40.0) * 0.45 + pow(c, 400.0) * 1.5;
        float disc = smoothstep(0.999975, 0.999992, c) * 40.0;
        col += sunColor * (glow + disc);
        if (d.y < 0.0) col = mix(horizon, ground, clamp(-d.y * 6.0, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(170, 48, 24), mat);
  sky.name = "sky";
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

/** Far terrain: a ring of low rises with one mesa and a serrated ridge, hazed toward the sky. */
function buildHorizon(parent: THREE.Group): void {
  const R = 135, segs = 360;
  const noise = makeFbm(7101, 24, 3);
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const haze = new THREE.Color(0.86, 0.87, 0.89);
  const rock = new THREE.Color(0.36, 0.3, 0.28);
  const tmp = new THREE.Color();
  const profile = (a: number) => {
    // a in radians, 0 = +z (straight out the windows). Mesa 20°–58° left of centre, ridge elsewhere.
    const deg = THREE.MathUtils.radToDeg(a);
    const mesaL = deg > -62 && deg < -24 ? 1 : 0;
    const mesaEdge = mesaL ? Math.min(1, Math.min(deg + 62, -24 - deg) / 6) : 0;
    const mesa = 16 * Math.pow(mesaEdge, 0.6);
    const ridge = 3.5 + 5 * noise(a / (Math.PI * 2), 0.3) + 2.5 * Math.abs(Math.sin(deg * 0.35)) * noise(a / (Math.PI * 2) + 0.5, 0.7);
    return Math.max(mesa, ridge);
  };
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2 - Math.PI;
    const x = Math.sin(a) * R, z = Math.cos(a) * R;
    const h = profile(a);
    const fade = 0.45 + 0.15 * (1 - Math.min(1, h / 16));
    pos.push(x, -0.35, z, x, h - 0.35, z);
    tmp.copy(rock).lerp(haze, fade);
    // Foot is hazier than the top.
    col.push(tmp.r * 0.97 + haze.r * 0.06, tmp.g * 0.97 + haze.g * 0.06, tmp.b * 0.97 + haze.b * 0.06);
    tmp.copy(rock).lerp(haze, fade - 0.06);
    col.push(tmp.r, tmp.g, tmp.b);
  }
  for (let i = 0; i < segs; i++) {
    const p = i * 2;
    idx.push(p, p + 2, p + 1, p + 2, p + 3, p + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  m.name = "horizon";
  m.frustumCulled = false;
  parent.add(m);
}

/** Radial falloff alpha for the vehicles' contact shadows. */
function contactShadowAlpha(size: number): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0.72)");
  g.addColorStop(0.55, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Boxy vehicle from a side profile (z along length, nose at z = 0) extruded across x. */
interface CarSpec {
  profile: Array<[number, number]>;
  width: number;
  length: number;
  wheelR: number;
  wheelZ: [number, number];
  track: number;
  beltY: number;
  paint: THREE.Material;
  glass: Array<{ z0: number; z1: number; y0: number; y1: number; side: "L" | "R" | "F" | "B"; slope?: [number, number] }>;
  bed?: { z0: number; z1: number; y: number };
}

function buildCar(b: MergedBuilder, parent: THREE.Object3D, spec: CarSpec, mats: { glass: THREE.Material; chrome: THREE.Material; tyre: THREE.Material; hub: THREE.Material; dark: THREE.Material; lamp: THREE.Material; tail: THREE.Material; shadow: THREE.Material }, at: THREE.Vector3, yaw: number): void {
  const M = new THREE.Matrix4().makeRotationY(yaw).setPosition(at);
  const place = (g: THREE.BufferGeometry, mat: THREE.Material) => {
    b.add(g, mat, M);
  };
  const box = (mat: THREE.Material, min: [number, number, number], max: [number, number, number]) => {
    const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    place(g, mat);
  };
  // Body: extruded silhouette (shape X = −z so the nose faces −z after rotateY(π/2))
  const shape = new THREE.Shape();
  spec.profile.forEach(([z, y], i) => (i ? shape.lineTo(-z, y) : shape.moveTo(-z, y)));
  shape.closePath();
  const body = new THREE.ExtrudeGeometry(shape, { depth: spec.width, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, steps: 1 });
  body.rotateY(Math.PI / 2);
  body.translate(-spec.width / 2 - 0.03, 0, 0);
  body.computeVertexNormals();
  place(body, spec.paint);
  // The bevel grows the silhouette 30 mm all round: flanks sit at ±(hw + 0.03), nose at z = −0.03.
  const hw = spec.width / 2, flank = spec.width / 2 + 0.03, nose = -0.03, tail = spec.length + 0.03;
  /** Box hung off a flank: xa..xb measured outward from the flank plane on side sx. */
  const sbox = (mat: THREE.Material, sx: number, xa: number, xb: number, y0: number, y1: number, z0: number, z1: number) => {
    const xs = [sx * (flank + xa), sx * (flank + xb)].sort((p, q) => p - q) as [number, number];
    box(mat, [xs[0], y0, z0], [xs[1], y1, z1]);
  };
  // Glass panels: side windows as slim boxes 6 mm proud of the flanks; wind/rear screens as
  // slanted quads pushed 6 mm outside the bevelled body surface along its outward normal.
  for (const gl of spec.glass) {
    if (gl.side === "L" || gl.side === "R") {
      sbox(mats.glass, gl.side === "L" ? -1 : 1, -0.006, 0.006, gl.y0, gl.y1, gl.z0, gl.z1);
    } else {
      const [za, zb] = gl.slope ?? [gl.z0, gl.z1]; // z at y0, z at y1
      const dz = zb - za, dy = gl.y1 - gl.y0, L = Math.hypot(dz, dy);
      const g = new THREE.PlaneGeometry(spec.width - 0.16, L);
      g.rotateX(Math.atan2(dz, dy));
      const nz = dz > 0 ? -dy / L : dy / L, ny = Math.abs(dz) / L; // outward normal (0, ny, nz)
      g.translate(0, (gl.y0 + gl.y1) / 2 + ny * 0.036, (za + zb) / 2 + nz * 0.036);
      place(g, mats.glass);
    }
  }
  // Wheels: tyre outer face 5 mm proud of the flank, hubcap outboard, dark wheel-well ring behind
  for (const wz of spec.wheelZ)
    for (const sx of [-1, 1]) {
      const x = sx * (flank + 0.005 - 0.11);
      const tyre = new THREE.CylinderGeometry(spec.wheelR, spec.wheelR, 0.22, 24);
      tyre.rotateZ(Math.PI / 2);
      tyre.translate(x, spec.wheelR, wz);
      place(tyre, mats.tyre);
      const hub = new THREE.CylinderGeometry(spec.wheelR * 0.56, spec.wheelR * 0.56, 0.02, 20);
      hub.rotateZ(Math.PI / 2);
      hub.translate(x + sx * 0.108, spec.wheelR, wz);
      place(hub, mats.hub);
      const arch = new THREE.RingGeometry(spec.wheelR + 0.004, spec.wheelR + 0.075, 24, 1, 0, Math.PI);
      arch.rotateY(sx > 0 ? Math.PI / 2 : -Math.PI / 2);
      arch.translate(sx * (flank + 0.002), spec.wheelR, wz);
      place(arch, mats.dark);
    }
  // Chrome belt line, mirrors, door handles
  for (const sx of [-1, 1]) {
    sbox(mats.chrome, sx, -0.002, 0.005, spec.beltY - 0.012, spec.beltY + 0.012, 0.35, spec.length - 0.3);
    sbox(mats.chrome, sx, 0.0, 0.1, spec.beltY + 0.25, spec.beltY + 0.33, spec.glass[0].z0 - 0.04, spec.glass[0].z0 + 0.12); // mirror
    sbox(mats.chrome, sx, 0.0, 0.006, spec.beltY - 0.11, spec.beltY - 0.08, spec.glass[0].z0 + 0.2, spec.glass[0].z0 + 0.36); // handle
  }
  box(mats.chrome, [-hw - 0.05, 0.4, nose - 0.08], [hw + 0.05, 0.52, nose + 0.05]); // front bumper
  box(mats.chrome, [-hw - 0.05, 0.4, tail - 0.05], [hw + 0.05, 0.52, tail + 0.08]); // rear bumper
  box(mats.dark, [-hw + 0.35, 0.58, nose - 0.02], [hw - 0.35, 0.76, nose + 0.02]); // grille
  box(mats.chrome, [-hw + 0.33, 0.66, nose - 0.026], [hw - 0.33, 0.685, nose + 0.02]); // grille bar
  for (const sx of [-1, 1]) {
    box(mats.chrome, [sx * (hw - 0.22) - 0.125, 0.575, nose - 0.012], [sx * (hw - 0.22) + 0.125, 0.745, nose + 0.02]); // lamp bezel
    box(mats.lamp, [sx * (hw - 0.22) - 0.11, 0.59, nose - 0.016], [sx * (hw - 0.22) + 0.11, 0.73, nose + 0.02]); // headlamp lens
    box(mats.tail, [sx * (hw - 0.25) - 0.15, 0.6, tail - 0.02], [sx * (hw - 0.25) + 0.15, 0.76, tail + 0.02]); // tail lamp
  }
  box(mats.dark, [-hw + 0.02, 0.05, 0.05], [hw - 0.02, 0.38, spec.length - 0.05]); // underbody shadow mass
  if (spec.bed) box(mats.dark, [-hw + 0.08, spec.bed.y + 0.03, spec.bed.z0], [hw - 0.08, spec.bed.y + 0.036, spec.bed.z1]);
  // Contact shadow decal: its own mesh so it never casts
  const decal = new THREE.PlaneGeometry(spec.width + 0.5, spec.length + 0.5);
  decal.rotateX(-Math.PI / 2);
  decal.translate(0, 0.004, spec.length / 2);
  decal.applyMatrix4(M);
  const dm = new THREE.Mesh(decal, mats.shadow);
  dm.renderOrder = 2;
  dm.name = "car-shadow";
  parent.add(dm);
}

export function buildExterior(parent: THREE.Group, pal: Palette, sunDir: THREE.Vector3): ExteriorResult {
  const rng = makeRng(3302);
  const b = new MergedBuilder();
  const envMaterials: THREE.Material[] = [];
  const halfX = ROOM.halfX;
  const yApron = -0.12;
  const yLot = LOT.y;

  /* ---------------- kerb + sidewalk edge ---------------- */
  const kerb = skyFill(new THREE.MeshStandardMaterial({ map: pal.concrete.map, roughness: 0.85, metalness: 0 }), 0.22);
  // Kerb face and top nose along the apron edge; slight batter
  b.rbox(kerb, [-halfX - 1.5, yLot, LOT.kerbZ - 0.16], [halfX + 1.5, yApron + 0.003, LOT.kerbZ], 0.012, 3);
  // Sidewalk beyond the diner's ends, both sides (the apron slab itself is in Shell.ts)
  b.box(kerb, [-halfX - 7, yLot - 0.02, ROOM.zFront + T], [-halfX - 1.5, yApron, LOT.kerbZ]);
  b.box(kerb, [halfX + 1.5, yLot - 0.02, ROOM.zFront + T], [halfX + 7, yApron, LOT.kerbZ]);

  /* ---------------- lot: detailed near plane + plain surround ---------------- */
  const stallLinesX: number[] = [];
  for (let x = -13.5; x <= 13.5 + 1e-6; x += LOT.stallPitch) stallLinesX.push(x);
  const layout: ext.LotLayout = { x0: LOT.x0, z0: LOT.kerbZ, w: LOT.w, d: LOT.d, stallLinesX, stallDepth: LOT.stallDepth };
  const lotTex = ext.lotSurface(2048, layout, 3310);
  const detail = ext.asphaltDetail(512, 3311);
  const asphalt = skyFill(new THREE.MeshStandardMaterial({
    map: lotTex.map,
    roughnessMap: lotTex.roughnessMap,
    roughness: 1,
    normalMap: detail.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    metalness: 0,
  }), 0.2);
  detail.normalMap.repeat.set(LOT.w / 0.5, LOT.d / 0.5);
  {
    const g = new THREE.PlaneGeometry(LOT.w, LOT.d);
    g.rotateX(-Math.PI / 2);
    g.translate(LOT.x0 + LOT.w / 2, yLot, LOT.kerbZ + LOT.d / 2);
    const m = new THREE.Mesh(g, asphalt);
    m.receiveShadow = true;
    m.name = "lot";
    parent.add(m);
  }
  const plainAsphalt = skyFill(new THREE.MeshStandardMaterial({ color: 0x67655f, roughness: 0.9, metalness: 0, normalMap: detail.normalMap, normalScale: new THREE.Vector2(0.6, 0.6) }), 0.2);
  {
    // Surround: everything paved from x ±40 and from behind the building line out to the wall
    const g = new THREE.PlaneGeometry(80, LOT.d + 6);
    g.rotateX(-Math.PI / 2);
    g.translate(0, yLot - 0.01, LOT.kerbZ - 6 + (LOT.d + 6) / 2);
    const m = new THREE.Mesh(g, plainAsphalt);
    m.receiveShadow = true;
    m.name = "lot-surround";
    parent.add(m);
  }

  /* ---------------- kerb stops at the stall heads ---------------- */
  const stopMat = skyFill(new THREE.MeshStandardMaterial({ color: 0xa9a49a, roughness: 0.9, metalness: 0 }), 0.22);
  for (let i = 0; i < stallLinesX.length - 1; i++) {
    if (i % 2 === 1 && rng() < 0.5) continue;
    const cx = (stallLinesX[i] + stallLinesX[i + 1]) / 2 + (rng() - 0.5) * 0.08;
    const z = LOT.kerbZ + 0.55 + (rng() - 0.5) * 0.05;
    b.rbox(stopMat, [cx - 0.9, yLot, z - 0.08], [cx + 0.9, yLot + 0.14, z + 0.08], 0.02, 3);
  }

  /* ---------------- CMU wall at the far edge, with a cap and a gap for the entrance ---------------- */
  const wallTex = ext.blockWall(512, 3312);
  const cmu = skyFill(new THREE.MeshStandardMaterial({ map: wallTex.map, roughnessMap: wallTex.roughnessMap, roughness: 1, metalness: 0 }), 0.22);
  wallTex.map.repeat.set(1 / 1.2, 1 / 0.6);
  wallTex.roughnessMap.repeat.copy(wallTex.map.repeat);
  for (const [xa, xb] of [[-40, -6], [1, 40]] as Array<[number, number]>) {
    b.box(cmu, [xa, yLot - 0.05, LOT.wallZ], [xb, yLot + 0.85, LOT.wallZ + 0.2], { metric: true });
    b.box(stopMat, [xa, yLot + 0.85, LOT.wallZ - 0.015], [xb, yLot + 0.9, LOT.wallZ + 0.215]);
  }

  /* ---------------- light standards ---------------- */
  const galv = new THREE.MeshStandardMaterial({ color: 0x8b8e90, roughness: 0.45, metalness: 0.7 });
  envMaterials.push(galv);
  for (const px of [-6.7, 5.4]) {
    const pz = LOT.kerbZ + LOT.stallDepth + 0.6;
    b.rbox(stopMat, [px - 0.35, yLot, pz - 0.35], [px + 0.35, yLot + 0.6, pz + 0.35], 0.03, 3);
    const pole = new THREE.CylinderGeometry(0.06, 0.1, 7.5, 12);
    pole.translate(px, yLot + 0.6 + 3.75, pz);
    b.add(pole, galv);
    const arm = new THREE.CylinderGeometry(0.035, 0.05, 1.9, 8);
    arm.rotateX(Math.PI / 2 - 0.25);
    arm.translate(px, yLot + 8.0, pz - 0.85);
    b.add(arm, galv);
    b.rbox(pal.darkMetal, [px - 0.14, yLot + 8.05, pz - 2.2], [px + 0.14, yLot + 8.25, pz - 1.45], 0.03, 3);
    b.box(new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.4 }), [px - 0.1, yLot + 8.03, pz - 2.1], [px + 0.1, yLot + 8.05, pz - 1.55]);
  }

  /* ---------------- vehicles ---------------- */
  const carMats = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0f1518, roughness: 0.08, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.25, metalness: 1 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95, metalness: 0 }),
    hub: new THREE.MeshStandardMaterial({ color: 0x9a9ea2, roughness: 0.35, metalness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.9, metalness: 0 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xaeb4b8, roughness: 0.08, metalness: 0.6 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x8a1212, roughness: 0.2, metalness: 0 }),
    shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, alphaMap: contactShadowAlpha(128), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  };
  carMats.glass.side = THREE.DoubleSide;
  const whitePaint = skyFill(new THREE.MeshPhysicalMaterial({ color: 0xd6d3c8, roughness: 0.55, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.45, envMapIntensity: 0.6 }), 0.2);
  const maroonPaint = skyFill(new THREE.MeshPhysicalMaterial({ color: 0x4d161c, roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.9 }), 0.2);
  envMaterials.push(carMats.glass, carMats.chrome, carMats.hub, whitePaint, maroonPaint);

  // Dusty white single-cab pickup (5.2 m, 1.8 wide, 1.78 tall), nose to the kerb stop
  const pickup: CarSpec = {
    profile: [
      [0.0, 0.42], [0.0, 0.62], [0.06, 0.78], [0.1, 0.9], [1.5, 0.98], [1.62, 1.02],
      [2.2, 1.74], [2.28, 1.78], [3.32, 1.78], [3.4, 1.74], [3.44, 1.14], [3.5, 1.08],
      [5.16, 1.08], [5.2, 1.0], [5.2, 0.44], [4.7, 0.4], [0.5, 0.4],
    ],
    width: 1.82, length: 5.2, wheelR: 0.37, wheelZ: [0.95, 4.05], track: 1.62, beltY: 0.95, paint: whitePaint,
    glass: [
      { side: "L", z0: 1.75, z1: 3.3, y0: 1.12, y1: 1.66 },
      { side: "R", z0: 1.75, z1: 3.3, y0: 1.12, y1: 1.66 },
      { side: "F", z0: 1.62, z1: 2.2, y0: 1.05, y1: 1.7, slope: [1.62, 2.2] },
      { side: "B", z0: 3.4, z1: 3.44, y0: 1.18, y1: 1.7, slope: [3.42, 3.4] },
    ],
    bed: { z0: 3.6, z1: 5.05, y: 1.08 },
  };
  // Maroon 3-box sedan (4.9 m, 1.78 wide, 1.4 tall)
  const sedan: CarSpec = {
    profile: [
      [0.0, 0.4], [0.0, 0.6], [0.05, 0.72], [0.12, 0.76], [1.75, 0.86], [1.85, 0.9],
      [2.4, 1.36], [2.5, 1.4], [3.55, 1.4], [3.65, 1.36], [4.1, 1.02], [4.2, 0.98],
      [4.85, 0.96], [4.9, 0.88], [4.9, 0.44], [4.4, 0.4], [0.5, 0.4],
    ],
    width: 1.78, length: 4.9, wheelR: 0.33, wheelZ: [0.9, 3.75], track: 1.5, beltY: 0.86, paint: maroonPaint,
    glass: [
      { side: "L", z0: 1.95, z1: 3.6, y0: 1.0, y1: 1.3 },
      { side: "R", z0: 1.95, z1: 3.6, y0: 1.0, y1: 1.3 },
      { side: "F", z0: 1.85, z1: 2.4, y0: 0.92, y1: 1.34, slope: [1.85, 2.4] },
      { side: "B", z0: 3.65, z1: 4.1, y0: 1.0, y1: 1.34, slope: [4.1, 3.65] },
    ],
  };
  const stall = (i: number) => (stallLinesX[i] + stallLinesX[i + 1]) / 2;
  buildCar(b, parent, pickup, carMats, new THREE.Vector3(stall(4) + 0.12, yLot, LOT.kerbZ + 0.62), THREE.MathUtils.degToRad(1.5));
  buildCar(b, parent, sedan, carMats, new THREE.Vector3(stall(6) - 0.08, yLot, LOT.kerbZ + 0.7), THREE.MathUtils.degToRad(-2));

  /* ---------------- desert dirt, scrub, horizon, sky ---------------- */
  const dirtTex = ext.desertDirt(1024, 3313);
  dirtTex.repeat.set(60, 60);
  const dirt = skyFill(new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1, metalness: 0 }), 0.22);
  {
    const g = new THREE.PlaneGeometry(420, 420);
    g.rotateX(-Math.PI / 2);
    g.translate(0, yLot - 0.04, 0);
    const m = new THREE.Mesh(g, dirt);
    m.name = "desert";
    parent.add(m);
  }
  {
    // Scrub: noise-jittered low blobs, one InstancedMesh, colour per instance
    const base = new THREE.IcosahedronGeometry(0.5, 1);
    const p = base.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const k = 0.8 + rng() * 0.45;
      p.setXYZ(i, p.getX(i) * k, Math.max(-0.05, p.getY(i) * 0.55 * k), p.getZ(i) * k);
    }
    base.computeVertexNormals();
    const mat = skyFill(new THREE.MeshStandardMaterial({ color: 0x8a8870, roughness: 1, metalness: 0 }), 0.22);
    const N = 420;
    const scrub = new THREE.InstancedMesh(base, mat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), c = new THREE.Color();
    let placed = 0, tries = 0;
    while (placed < N && tries < 5000) {
      tries++;
      const r = 22 + Math.pow(rng(), 0.7) * 100, a = rng() * Math.PI * 2;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (z < LOT.wallZ + 1.5 && Math.abs(x) < 42) continue; // not in the lot
      if (z < ROOM.zBack - 4 && Math.abs(x) < 12) continue; // not behind the kitchen
      const sc = 0.6 + rng() * 1.0;
      s.set(sc * (0.9 + rng() * 0.4), sc * (0.6 + rng() * 0.5), sc * (0.9 + rng() * 0.4));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      pos.set(x, yLot - 0.03, z);
      m.compose(pos, q, s);
      scrub.setMatrixAt(placed, m);
      c.setRGB(0.5 + rng() * 0.14, 0.5 + rng() * 0.12, 0.36 + rng() * 0.1);
      scrub.setColorAt(placed, c);
      placed++;
    }
    scrub.count = placed;
    scrub.instanceMatrix.needsUpdate = true;
    if (scrub.instanceColor) scrub.instanceColor.needsUpdate = true;
    scrub.name = "scrub";
    scrub.frustumCulled = false;
    parent.add(scrub);
  }
  buildHorizon(parent);
  const sky = buildSky(sunDir);
  parent.add(sky);

  b.build(parent, { name: "exterior" });
  return { envMaterials, sky };
}
