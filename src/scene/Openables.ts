/**
 * System 9 openables (rev 2): the two under-counter cabinet doors in the back bar (the bay
 * `BACK_BAR.cabinet` that Counter.ts leaves open) and the kitchen swing door at the -x end
 * of the back wall (Shell.ts keeps only its casings), with the lit kitchen slice behind it.
 *
 * Everything static — the cabinet carcass, its shelf and contents, the kitchen slice — goes
 * into the shared `statics` builder and is appended to the scene's existing material buckets
 * (core/mergeInto.ts), so it costs no draw calls; the tile and the filter-box label are in
 * the System 9 atlas material (`cloth`, Presence.ts). Own meshes: ONE mesh for both cabinet
 * doors (laminate slabs baked through their hinges on the CPU; wire pulls and Euro hinge cups
 * are chrome by vertex alpha), ONE vertex-coloured kitchen leaf (paint, rubber lite moulding,
 * pivots, scuffs; kick plates and push plates as stainless by vertex alpha) and the vision
 * panel's blended pane (`makePaneGlass` — not transmissive, so the opaque list is drawn once).
 * Three own meshes.
 *
 * Kitchen slice (rev 2 — rev 1's dim vestibule read as a black void with an orange stripe):
 * a 2.7 m deep room in white 4" wall tile to 1.5 m over a red quarry floor, a stainless prep
 * table with a shelf over it along the -x wall, a range under a stainless hood on the far
 * wall, a fluorescent strip fixture on the -x wall (palette `fixtureLens` emissive, the
 * troffers' tube tint) and one shadowless 5000 K spot at the ceiling (16,000 lm,
 * aimed down and away from the door so its cone stops inside the kitchen — no light on the
 * dining-room floor). Lit surfaces reach the probe, so the vision glass shows them too.
 *
 * Hinge conventions (rotation.y, radians, positive = the leaf's free edge toward -z):
 *   cabinet left   hinge at the bay's -x edge, leaf along +x, opens toward the aisle (+z) → NEGATIVE angles
 *   cabinet right  hinge at the bay's +x edge, leaf along -x, opens toward +z → POSITIVE angles
 *   kitchen        hinge at the -x jamb, leaf along +x; pushed from the dining room it swings into
 *                  the kitchen (-z) → POSITIVE angles; the spring's back-swing is negative.
 * `HingedLeaf.sign` carries that so an interaction can think in "degrees open".
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { makePaneGlass } from "./Exterior";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { PRESENCE_UV } from "../procedural/presence";
import { KITCHEN } from "./Kitchen";
import { BACK_BAR, CABINETS, KITCHEN_DOOR, ROOM } from "./layout";
import { nits } from "./Lighting";
import { lathe, ribbon, SAUCER_PROFILE, uvIntoRect } from "./Presence";

export interface HingedLeaf {
  hinge: THREE.Group;
  /** Multiply "degrees open" (≥ 0 toward the player) by this to get `hinge.rotation.y`. */
  sign: 1 | -1;
  /** Where the player looks to get the prompt (world). */
  focus: THREE.Vector3;
  /** Where its sounds come from (world, on the leaf near the free edge when closed). */
  voice: THREE.Vector3;
  /** Leaf width from the hinge, m. */
  width: number;
}

export interface OpenablesResult {
  cabinet: [HingedLeaf, HingedLeaf];
  /**
   * fix-cabinets: the upper wall cabinets' doors (CABINETS.runs, -x run first, doors -x → +x;
   * `hinge.name` is `upper-cabinet-<run>-<k>`). Every cabinet door in the scene is openable.
   */
  upper: HingedLeaf[];
  kitchenDoor: HingedLeaf;
  /** The kitchen slice's fluorescent spot (Lighting-independent; here so Diner can count it). */
  kitchenLight: THREE.SpotLight;
  /** Door materials whose metal lives in the vertex alpha: Diner gives them the metal probe. */
  envMetals: THREE.MeshStandardMaterial[];
}

const V2 = (x: number, y: number) => new THREE.Vector2(x, y);
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/**
 * Vertex alpha 0 -> polished metal (metalness 1, roughness `rough`, colour from the vertex, the
 * maps ignored); alpha 1 -> the material as authored. Lets one vertex-coloured bucket hold paint
 * and stainless, or laminate and chrome.
 */
function metalByVertexAlpha(m: THREE.MeshStandardMaterial, rough: number, key: string): void {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <metalnessmap_fragment>",
        [
          "#include <metalnessmap_fragment>",
          "#ifdef USE_COLOR_ALPHA",
          `if ( vColor.a < 0.5 ) { metalnessFactor = 1.0; roughnessFactor = ${rough.toFixed(3)}; diffuseColor.rgb = vColor.rgb; }`,
          "diffuseColor.a = 1.0;",
          "#endif",
        ].join("\n"),
      )
      // A MeshPhysicalMaterial's anisotropy (brushed metal) is a material-wide constant; gate
      // it by the same flag so the paint around the plates stays isotropic.
      .replace("vec2 anisotropyV = anisotropyVector;", "vec2 anisotropyV = anisotropyVector * ( 1.0 - step( 0.5, vColor.a ) );");
  };
  m.customProgramCacheKey = () => key;
}

/** Vertex-alpha flags for `tint`: paint 1, metal brushed along local y (push plates, screws) 0, along local x (kick plates) 0.25. */
export const BRUSH_Y = 0, BRUSH_X = 0.25;

/**
 * Rev 4 — the kitchen leaf's plates. Rev 3's plates (metalness 1, roughness 0.35, three's
 * `anisotropy`, the room probe) measured as flat taupe: the room probe is captured 3 m away
 * with unprojected directions, so a 0.4 m plate returned one colour, and `anisotropy` bends
 * the lookup by a single normal — no streaks. This is the System 5 rev 4 kick-plate recipe
 * (`kickPlateWorn`): the material takes a probe captured AT THE DOOR (`userData.probePos`,
 * Diner.ts), each environment tap is PARALLAX-CORRECTED against the room box, and the satin
 * finish is a 9-tap Gaussian fan of taps along the brush direction (world y on the push
 * plates, the leaf's x on the kick plates — carried by the vertex alpha) with the lookup
 * roughness lowered across it: a stretched mirror, floor at the bottom, wall and ceiling at
 * the top, a bright hairline where the round-over turns. Brushing runs 0.8 / 2.5 mm wide
 * modulate the roughness ±0.06 texel by texel so the streaks break up run by run. Paint
 * (alpha 1) renders as authored; the whole leaf stays one bucket.
 */
function brushedPlatesByVertexAlpha(m: THREE.MeshStandardMaterial, rough: number, key: string, probePos: THREE.Vector3): void {
  m.userData.probePos = probePos;
  // The station probe feeds the plates only; the paint keeps `envMap` (the metals' room probe)
  // so its ambient is the one the rest of the room was balanced against. Diner.ts fills this.
  const kpEnv: { value: THREE.Texture | null } = { value: null };
  m.userData.stationEnv = kpEnv;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uKpEnv = kpEnv;
    shader.uniforms.uKpProbe = { value: probePos };
    shader.uniforms.uKpBoxMin = { value: new THREE.Vector3(-ROOM.halfX, 0, ROOM.zBack - ROOM.wallThickness - KITCHEN_DEPTH) };
    shader.uniforms.uKpBoxMax = { value: new THREE.Vector3(ROOM.halfX, ROOM.height, ROOM.zFront) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vKpPos, vKpLocal, vKpBrush;")
      .replace(
        "#include <worldpos_vertex>",
        [
          "#include <worldpos_vertex>",
          "vKpPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;",
          "vKpLocal = transformed;",
          "vKpBrush = normalize( ( modelMatrix * vec4( color.a < 0.125 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 ), 0.0 ) ).xyz );",
        ].join("\n"),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
varying vec3 vKpPos, vKpLocal, vKpBrush;
uniform vec3 uKpProbe, uKpBoxMin, uKpBoxMax;
uniform sampler2D uKpEnv;
float kpHash( float x ) { return fract( sin( x * 127.1 ) * 43758.5453 ); }
vec3 kpBoxDir( vec3 R ) {
	vec3 rbmax = ( uKpBoxMax - vKpPos ) / R, rbmin = ( uKpBoxMin - vKpPos ) / R;
	vec3 rb = mix( rbmin, rbmax, step( vec3( 0.0 ), R ) );
	float d = max( 0.05, min( min( rb.x, rb.y ), rb.z ) );
	return normalize( vKpPos + R * d - uKpProbe );
}`,
      )
      .replace(
        "#include <metalnessmap_fragment>",
        [
          "#include <metalnessmap_fragment>",
          "#ifdef USE_COLOR_ALPHA",
          "if ( vColor.a < 0.5 ) {",
          "	metalnessFactor = 1.0;",
          "	diffuseColor.rgb = vColor.rgb;",
          "	float across = vColor.a < 0.125 ? vKpLocal.x : vKpLocal.y;",
          "	float run = 0.6 * kpHash( floor( across * 400.0 ) ) + 0.4 * kpHash( floor( across * 1300.0 + 7.0 ) );",
          `	roughnessFactor = ${rough.toFixed(3)} + ( run - 0.5 ) * 0.12;`,
          "}",
          "diffuseColor.a = 1.0;",
          "#endif",
        ].join("\n"),
      )
      // (the chunk includes are expanded after onBeforeCompile, so the edited chunk is inlined)
      .replace(
        "#include <lights_fragment_maps>",
        THREE.ShaderChunk.lights_fragment_maps.replace(
          "radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );",
          /* glsl */ `if ( vColor.a < 0.5 ) {
	vec3 R = reflect( - geometryViewDir, geometryNormal );
	R = transformDirectionByInverseViewMatrix( R, viewMatrix );
	// Nine taps up a Gaussian fan (±spread at 2σ) along the brush; the lookup roughness is
	// lowered across it — the stretched mirror of a satin finish.
	float spread = 1.6 * material.roughness;
	float lr = 0.8 * material.roughness;
	vec3 acc = vec3( 0.0 );
	float wsum = 0.0;
	for ( int k = -4; k <= 4; k ++ ) {
		float f = float( k ) / 4.0;
		float wgt = exp( - 2.0 * f * f );
		vec3 Rk = normalize( R + vKpBrush * ( f * spread ) );
		acc += wgt * textureCubeUV( uKpEnv, envMapRotation * kpBoxDir( Rk ), lr ).rgb;
		wsum += wgt;
	}
	radiance += acc * ( 1.4 * envMapIntensity / wsum ); // the station probe's near-field weight (cf. ROOM_PROBE_INTENSITY)
} else {
	radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
}`,
        ),
      );
  };
  m.customProgramCacheKey = () => key;
}



/**
 * Give a geometry a flat vertex colour (RGBA) for a vertex-coloured leaf material. Alpha is a
 * flag, not opacity: `metal` writes 0, and `metalByVertexAlpha` renders those vertices as
 * polished metal in the vertex's colour - so a painted door and its stainless plates, or a
 * laminate door and its chrome pull, are one bucket and one draw call.
 */
export function tint(g: THREE.BufferGeometry, hex: number, metal = false, brush = BRUSH_Y): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 4);
  const a = metal ? brush : 1;
  for (let i = 0; i < n; i++) {
    arr[i * 4] = c.r;
    arr[i * 4 + 1] = c.g;
    arr[i * 4 + 2] = c.b;
    arr[i * 4 + 3] = a;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 4));
  return g;
}

export function buildOpenables(parent: THREE.Group, pal: Palette, statics: MergedBuilder, cloth: THREE.Material): OpenablesResult {
  const kitchen = buildKitchenDoor(parent, pal, statics, cloth);
  const cabinet = buildCabinet(parent, pal, statics, cloth);
  const upper = buildUpperCabinets(parent, pal, statics, cloth);
  return {
    cabinet: cabinet.leaves,
    upper: upper.leaves,
    kitchenDoor: kitchen.leaf,
    kitchenLight: kitchen.light,
    envMetals: [cabinet.material, upper.material, ...kitchen.materials],
  };
}

/** Flat RGBA vertex colour for the vertex-coloured door buckets (alpha 0 = chrome, see `metalByVertexAlpha`). */
function colour4(g: THREE.BufferGeometry, c: [number, number, number, number]): THREE.BufferGeometry {
  const n = g.attributes.position.count, arr = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) arr.set(c, i * 4);
  g.setAttribute("color", new THREE.BufferAttribute(arr, 4));
  return g;
}

/**
 * A door leaf's geometry in its hinge frame: the laminate slab, a chrome wire pull and two Euro
 * hinge cups on the inner face — collapsed into one vertex-coloured geometry.
 *   `side`  -1: hinge at the -x edge, leaf along +x (opens toward +z with NEGATIVE angles)
 *           +1: hinge at the +x edge, leaf along -x (POSITIVE angles)
 *   `pull`  the pull's centre height and length (upper doors: low, 100 mm; lower: ⅔ height, 120 mm)
 */
function leafGeometry(
  pal: Palette,
  lam: THREE.Material,
  side: -1 | 1,
  w: number,
  ya: number,
  yb: number,
  pull: { y: number; len: number },
  hingeYs: number[],
): THREE.BufferGeometry {
  const dz0 = 0.001, dz1 = 0.019;
  const b = new MergedBuilder();
  const X = (u: number) => (side < 0 ? u : -u);
  const xa = X(0), xb = X(w);
  const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
  b.rbox(lam, [lo, ya, dz0], [hi, yb, dz1], 0.0025, 2, { metric: true });
  // Chrome wire pull, vertical, 45 mm in from the free edge.
  const pxl = side < 0 ? hi - 0.045 : lo + 0.045;
  const bar = new THREE.CylinderGeometry(0.005, 0.005, pull.len, 14);
  bar.translate(pxl, pull.y, dz1 + 0.03);
  b.add(bar, pal.chrome);
  for (const py of [pull.y - pull.len * 0.4, pull.y + pull.len * 0.4]) {
    const post = new THREE.CylinderGeometry(0.0045, 0.0045, 0.03, 12);
    post.rotateX(Math.PI / 2);
    post.translate(pxl, py, dz1 + 0.015);
    b.add(post, pal.chrome);
  }
  // Concealed Euro hinges on the inner face (35 mm cup in a 48 × 60 flange, the arm back to the plate).
  for (const hy of hingeYs) {
    const cx = X(0.0465);
    const flange = new THREE.BoxGeometry(0.048, 0.06, 0.0015);
    flange.translate(cx, hy, dz0 - 0.00075);
    b.add(flange, pal.chrome);
    const cup = new THREE.CylinderGeometry(0.0175, 0.0175, 0.011, 24);
    cup.rotateX(Math.PI / 2);
    cup.translate(cx, hy, dz0 - 0.0015 - 0.0055);
    b.add(cup, pal.chrome);
    for (const sy of [-0.021, 0.021]) {
      const screw = new THREE.CylinderGeometry(0.0035, 0.0035, 0.001, 10);
      screw.rotateX(Math.PI / 2);
      screw.translate(cx, hy + sy, dz0 - 0.002);
      b.add(screw, pal.chrome);
    }
    const armLo = Math.min(X(0.0465), X(-0.004)), armHi = Math.max(X(0.0465), X(-0.004));
    b.rbox(pal.chrome, [armLo, hy - 0.009, dz0 - 0.0125], [armHi, hy + 0.009, dz0 - 0.0035], 0.001);
  }
  const chromeC = pal.chrome.color;
  const CHROME: [number, number, number, number] = [chromeC.r, chromeC.g, chromeC.b, 0];
  const LAM: [number, number, number, number] = [1, 1, 1, 1];
  const staging = new THREE.Group();
  const built = b.build(staging);
  const pieces = built.map((m) => colour4(m.geometry.index ? m.geometry.toNonIndexed() : m.geometry, m.material === lam ? LAM : CHROME));
  return mergeGeometries(pieces, false)!;
}

/* ------------------------------------------------------------------------------------ */
/* Upper wall cabinets (fix-cabinets)                                                     */
/* ------------------------------------------------------------------------------------ */

/**
 * The two runs of upper cabinets over the back bar (`CABINETS.runs`; Counter.ts keeps their end
 * panels, light rail and soffit). Each run is an open laminate carcass — top, bottom, back,
 * a partition every two doors, two shelves — stocked with what a diner keeps up high: stacked
 * white plates, bowls, glass tumblers, mugs, boxes (cereal / tea / sugar packets with faded
 * printed labels from the System 9 atlas) and a roll of paper towels. All of it goes into the
 * static buckets (no draw calls); the doors are ONE baked mesh like the under-counter pair
 * (`bakedLeaves`): +1 draw. Door modules are equal, 3 mm gaps, hinged at alternating edges so
 * the pulls pair up (even k: hinge -x; odd k: hinge +x).
 */
function buildUpperCabinets(parent: THREE.Group, pal: Palette, s: MergedBuilder, cloth: THREE.Material): { leaves: HingedLeaf[]; material: THREE.MeshStandardMaterial } {
  const { bottom, top, depth, doorWidth, runs } = CABINETS;
  const zWall = ROOM.zBack, zFace = zWall + depth;
  const t = 0.018;
  const lam = pal.laminateCabinet;
  const doorMat = lam.clone();
  doorMat.vertexColors = true;
  doorMat.name = "upperCabinetDoors";
  metalByVertexAlpha(doorMat, 0.08, "cabinet-doors");

  const leaves: HingedLeaf[] = [];
  const parts: Array<{ hinge: THREE.Group; geo: THREE.BufferGeometry }> = [];
  // Doors sit in front of the carcass: 20 mm slabs from zFace-0.02 to zFace; the carcass front edge is at zFace-0.02.
  const zDoorBack = zFace - 0.02;
  const zi0 = zWall + 0.02, zi1 = zDoorBack - 0.001;
  const shelfYs = [bottom + t + 0.3, bottom + t + 0.6];
  const hingeYs = [bottom + 0.1, top - 0.1];

  runs.forEach(([x0, x1], run) => {
    const inner0 = x0 + t, inner1 = x1 - t;
    // Carcass: bottom, top, back; partitions every second door.
    s.box(lam, [inner0, bottom, zi0], [inner1, bottom + t, zi1], { metric: true });
    s.box(lam, [inner0, top - t, zi0], [inner1, top, zi1], { metric: true });
    s.box(lam, [inner0, bottom + t, zi0], [inner1, top - t, zi0 + t], { metric: true });
    const count = Math.max(1, Math.round((inner1 - inner0) / doorWidth));
    const w = (inner1 - inner0) / count;
    const bays: Array<[number, number]> = [];
    for (let k = 0; k < count; k += 2) {
      const bx0 = inner0 + k * w, bx1 = inner0 + Math.min(count, k + 2) * w;
      bays.push([bx0, bx1]);
      if (k + 2 < count) s.box(lam, [bx1 - t / 2, bottom + t, zi0 + t], [bx1 + t / 2, top - t, zi1], { metric: true });
    }
    // Shelves, 40 mm short of the doors, per bay.
    for (const [bx0, bx1] of bays) for (const sy of shelfYs) s.box(lam, [bx0 + t / 2, sy, zi0 + t], [bx1 - t / 2, sy + t, zi1 - 0.04], { metric: true });
    // Stock per bay: three "shelves" (the bottom and the two shelves), mixed by bay so no two read alike.
    bays.forEach(([bx0, bx1], bay) => {
      const levels = [bottom + t, shelfYs[0] + t, shelfYs[1] + t];
      const zc = zWall + depth * 0.5;
      const variant = (run * 3 + bay) % 4;
      stockUpper(s, pal, cloth, bx0 + t / 2, bx1 - t / 2, levels, zc, variant);
    });
    // Doors.
    for (let k = 0; k < count; k++) {
      const dx0 = inner0 + k * w + 0.0015, dx1 = inner0 + (k + 1) * w - 0.0015;
      const side: -1 | 1 = k % 2 === 0 ? -1 : 1;
      const hx = side < 0 ? dx0 : dx1;
      const hinge = new THREE.Group();
      hinge.name = `upper-cabinet-${run}-${k}`;
      hinge.position.set(hx, 0, zDoorBack);
      const ya = bottom + 0.0015, yb = top - 0.003;
      const lw = dx1 - dx0;
      parts.push({ hinge, geo: leafGeometry(pal, lam, side, lw, ya, yb, { y: bottom + 0.11, len: 0.1 }, hingeYs) });
      parent.add(hinge);
      const X = (u: number) => (side < 0 ? u : -u);
      leaves.push({
        hinge,
        sign: side,
        // Focus at the door's centre, 100 mm below mid-height (a standing player looks up at it).
        focus: new THREE.Vector3(hx + X(lw * 0.5), (ya + yb) / 2 - 0.1, zFace),
        voice: new THREE.Vector3(hx + X(lw * 0.9), bottom + 0.15, zFace),
        width: lw,
      });
    }
  });
  bakedLeaves(parent, parts, doorMat, "upper-cabinet-doors");
  return { leaves, material: doorMat };
}

/**
 * Stock for one upper bay (between x0..x1, three levels at `levels`, centred at z `zc`). Plates
 * are a stack of 8 (260 mm, a slight taper and a foot); bowls nest four high; tumblers stand in
 * a row; mugs in pairs; boxes carry a faded printed band (atlas `label` / `canLabel`); the paper
 * towel roll lies on its side. `variant` shuffles which level gets what.
 */
function stockUpper(s: MergedBuilder, pal: Palette, cloth: THREE.Material, x0: number, x1: number, levels: number[], zc: number, variant: number): void {
  const W = x1 - x0;
  const plates = (x: number, y: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const g = lathe([V2(0, 0), V2(0.055, 0), V2(0.06, 0.006), V2(0.1, 0.018), V2(0.095, 0.02), V2(0.055, 0.01), V2(0, 0.01)], 40);
      g.rotateY(i * 0.9);
      g.translate(x + ((i * 7) % 3) * 0.001, y + i * 0.017, zc + ((i * 5) % 3) * 0.001);
      s.add(g, pal.ceramic);
    }
  };
  const bowls = (x: number, y: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const g = lathe([V2(0, 0), V2(0.04, 0), V2(0.045, 0.004), V2(0.08, 0.055), V2(0.083, 0.06), V2(0.078, 0.058), V2(0.042, 0.008), V2(0, 0.008)], 36);
      g.translate(x, y + i * 0.034, zc);
      s.add(g, pal.ceramic);
    }
  };
  const tumblers = (x: number, y: number, n: number, dz = 0) => {
    for (let i = 0; i < n; i++) {
      const g = lathe([V2(0, 0), V2(0.03, 0), V2(0.032, 0.004), V2(0.036, 0.12), V2(0.033, 0.12), V2(0.03, 0.006), V2(0, 0.006)], 28);
      g.translate(x + i * 0.078, y, zc + dz);
      s.add(g, pal.glassClear);
    }
  };
  const mugs = (x: number, y: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const mx = x + i * 0.115;
      const body = lathe([V2(0, 0), V2(0.036, 0), V2(0.04, 0.004), V2(0.04, 0.092), V2(0.037, 0.095), V2(0.034, 0.09), V2(0.034, 0.008), V2(0, 0.008)], 28);
      body.translate(mx, y, zc);
      s.add(body, pal.ceramic);
      // Handle: a half torus standing on the mug's wall, bulging out along ±x (alternating).
      const handle = new THREE.TorusGeometry(0.024, 0.006, 8, 20, Math.PI);
      handle.rotateZ(i % 2 ? Math.PI / 2 : -Math.PI / 2);
      handle.translate(mx + (i % 2 ? -0.038 : 0.038), y + 0.05, zc);
      s.add(handle, pal.ceramic);
    }
  };
  const box = (x: number, y: number, w: number, d: number, h: number, band: readonly [number, number, number, number], turn = 0) => {
    s.rbox(pal.napkin, [x - w / 2, y, zc - d / 2], [x + w / 2, y + h, zc + d / 2], 0.002);
    // A faded printed band round the box, 0.3 mm proud of the front and sides.
    const lh = Math.min(0.045, h * 0.35);
    const put = (pw: number, cx: number, cz: number, rotY: number) => {
      const g = uvIntoRect(new THREE.PlaneGeometry(pw, lh), band);
      g.rotateY(rotY + turn);
      g.translate(cx, y + h * 0.45, cz);
      s.add(g, cloth);
    };
    put(w - 0.006, x, zc + d / 2 + 0.0003, 0);
    put(d - 0.006, x + w / 2 + 0.0003, zc, Math.PI / 2);
    put(d - 0.006, x - w / 2 - 0.0003, zc, -Math.PI / 2);
  };
  const towelRoll = (x: number, y: number) => {
    const roll = new THREE.CylinderGeometry(0.056, 0.056, 0.28, 28);
    roll.rotateZ(Math.PI / 2);
    roll.translate(x, y + 0.056, zc);
    s.add(roll, pal.napkin);
    const core = new THREE.CylinderGeometry(0.02, 0.02, 0.282, 16, 1, true);
    core.rotateZ(Math.PI / 2);
    core.translate(x, y + 0.056, zc);
    s.add(core, pal.trayBrown);
  };
  const [y0, y1, y2] = levels;
  const c = (x0 + x1) / 2;
  const wide = W > 0.7;
  switch (variant) {
    case 0:
      plates(x0 + 0.17, y0, 8);
      if (wide) bowls(x0 + 0.5, y0, 4);
      mugs(x0 + 0.08, y1, wide ? 4 : 2);
      box(x1 - 0.14, y1, 0.19, 0.07, 0.27, PRESENCE_UV.label); // cereal
      tumblers(x0 + 0.06, y2, wide ? 6 : 3);
      break;
    case 1:
      towelRoll(x0 + 0.2, y0);
      if (wide) plates(x1 - 0.2, y0, 6);
      tumblers(x0 + 0.06, y1, wide ? 5 : 3);
      box(x1 - 0.12, y1, 0.14, 0.09, 0.1, PRESENCE_UV.canLabel); // tea
      bowls(x0 + 0.12, y2, 4);
      if (wide) mugs(c + 0.05, y2, 3);
      break;
    case 2:
      mugs(x0 + 0.08, y0, wide ? 5 : 2);
      box(x1 - 0.1, y0, 0.12, 0.08, 0.12, PRESENCE_UV.canLabel, 0.1); // sugar packets
      plates(x0 + 0.17, y1, 7);
      if (wide) bowls(x1 - 0.2, y1, 3);
      box(x0 + 0.13, y2, 0.19, 0.07, 0.27, PRESENCE_UV.label); // cereal
      if (wide) tumblers(c + 0.02, y2, 4);
      break;
    default:
      bowls(x0 + 0.12, y0, 4);
      if (wide) plates(x1 - 0.2, y0, 8);
      mugs(x0 + 0.08, y1, wide ? 4 : 2);
      towelRoll(x1 - 0.2, y2);
      if (wide) tumblers(x0 + 0.06, y2, 4);
      break;
  }
}

/* ------------------------------------------------------------------------------------ */
/* Under-counter cabinet                                                                  */
/* ------------------------------------------------------------------------------------ */

function buildCabinet(parent: THREE.Group, pal: Palette, s: MergedBuilder, cloth: THREE.Material): { leaves: [HingedLeaf, HingedLeaf]; material: THREE.MeshStandardMaterial } {
  const [x0, x1] = BACK_BAR.cabinet;
  const zFront = BACK_BAR.zFront, zBack = zFront - BACK_BAR.depth;
  const y0 = 0.1, y1 = BACK_BAR.height - 0.03 - 0.02; // the bay Counter.ts cuts: kick to under the top
  const t = 0.018; // carcass panel
  const lam = pal.laminateCabinet;

  // Carcass: 1 mm inside the cut faces so nothing ties with the die; back 20 mm off the wall.
  const zi0 = zBack + 0.02, zi1 = zFront - 0.002;
  s.box(lam, [x0 + 0.001, y0 + 0.001, zi0], [x0 + 0.001 + t, y1 - 0.001, zi1], { metric: true });
  s.box(lam, [x1 - 0.001 - t, y0 + 0.001, zi0], [x1 - 0.001, y1 - 0.001, zi1], { metric: true });
  s.box(lam, [x0 + 0.001, y0 + 0.001, zi0], [x1 - 0.001, y0 + 0.001 + t, zi1], { metric: true }); // bottom
  s.box(lam, [x0 + 0.001, y1 - 0.001 - t, zi0], [x1 - 0.001, y1 - 0.001, zi1], { metric: true }); // top
  s.box(lam, [x0 + 0.001 + t, y0 + 0.001, zi0], [x1 - 0.001 - t, y1 - 0.001, zi0 + t], { metric: true }); // back
  // One adjustable shelf at 470 mm, 50 mm short of the doors.
  const shelfY = 0.47;
  s.box(lam, [x0 + 0.001 + t, shelfY, zi0 + t], [x1 - 0.001 - t, shelfY + t, zi1 - 0.05], { metric: true });
  const floorY = y0 + 0.001 + t;

  // Euro hinge mounting plates on the side panels' inner faces, 37 mm back from the front edge,
  // 100 mm from the top and bottom of the door (nickel: the chrome bucket).
  const hingeYs = [y0 + 0.1 - 0.008, y1 - 0.1 + 0.008];
  for (const hy of hingeYs) {
    s.rbox(pal.chrome, [x0 + 0.001 + t, hy - 0.02, zi1 - 0.057], [x0 + 0.001 + t + 0.003, hy + 0.02, zi1 - 0.017], 0.001);
    s.rbox(pal.chrome, [x1 - 0.001 - t - 0.003, hy - 0.02, zi1 - 0.057], [x1 - 0.001 - t, hy + 0.02, zi1 - 0.017], 0.001);
  }

  // Contents. Bottom: a stack of five saucers (the diner saucer profile: foot ring, well, rolled
  // rim) and a roll of paper towels on its side.
  {
    const saucer = lathe(SAUCER_PROFILE, 44);
    const sx = x0 + 0.2, sz = zBack + 0.33;
    for (let i = 0; i < 5; i++) {
      const g = saucer.clone();
      g.rotateY(i * 0.7);
      g.translate(sx + (i % 2) * 0.002 - 0.001 * (i % 3), floorY + i * 0.0165, sz + ((i * 7) % 3) * 0.0015);
      s.add(g, pal.ceramic);
    }
    const roll = new THREE.CylinderGeometry(0.056, 0.056, 0.28, 28);
    roll.rotateZ(Math.PI / 2);
    roll.translate(x1 - 0.32, floorY + 0.056, zBack + 0.36);
    s.add(roll, pal.napkin);
    const core = new THREE.CylinderGeometry(0.02, 0.02, 0.282, 16, 1, true);
    core.rotateZ(Math.PI / 2);
    core.translate(x1 - 0.32, floorY + 0.056, zBack + 0.36);
    s.add(core, pal.trayBrown);
  }
  // Shelf: the box of filters (open, filters fanned above the lid line) and a spray bottle.
  {
    const bx = x0 + 0.27, bz = zBack + 0.3, bw = 0.19, bd = 0.13, bh = 0.155;
    const top = shelfY + t;
    s.rbox(pal.napkin, [bx - bw / 2, top, bz - bd / 2], [bx + bw / 2, top + bh, bz + bd / 2], 0.002);
    // Printed label band round the box (the atlas `label` tile: brand block, word lines, red
    // logo, fluted-filter graphic), 0.3 mm proud on the front and both sides.
    const band = (w: number, h: number, cx: number, cy: number, cz: number, rotY: number) => {
      const g = uvIntoRect(new THREE.PlaneGeometry(w, h), PRESENCE_UV.label);
      g.rotateY(rotY);
      g.translate(cx, cy, cz);
      s.add(g, cloth);
    };
    const lh = 0.042;
    band(bw - 0.006, lh, bx, top + 0.06, bz + bd / 2 + 0.0003, 0);
    band(bd - 0.006, lh, bx + bw / 2 + 0.0003, top + 0.06, bz, Math.PI / 2);
    band(bd - 0.006, lh, bx - bw / 2 - 0.0003, top + 0.06, bz, -Math.PI / 2);
    // Filters: a squat fluted cylinder standing proud of the open top.
    const filters = new THREE.CylinderGeometry(0.058, 0.05, 0.05, 36, 1, false);
    filters.translate(bx, top + bh - 0.02, bz);
    s.add(filters, pal.napkin);

    // Spray bottle: a 32 oz trigger sprayer — waisted body, threaded neck collar, the trigger
    // head (nozzle forward, toward the doors) with the lever curving down under it, a dip tube.
    const px = x1 - 0.22, pz = zBack + 0.32;
    const body = lathe(
      [V2(0, 0), V2(0.036, 0), V2(0.04, 0.012), V2(0.041, 0.09), V2(0.038, 0.14), V2(0.028, 0.168), V2(0.02, 0.182), V2(0.017, 0.19), V2(0.017, 0.2), V2(0, 0.2)],
      32,
    );
    body.translate(px, top, pz);
    s.add(body, pal.fixtureWhite);
    const collar = new THREE.CylinderGeometry(0.019, 0.019, 0.022, 24);
    collar.translate(px, top + 0.209, pz);
    s.add(collar, pal.blackPlastic);
    // Head: a wedge housing from the collar forward to the nozzle, its top sloping down to the front.
    const head: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const q = i / 8;
      head.push(V3(px, top + 0.238 - 0.02 * q * q, pz - 0.014 + q * 0.07));
    }
    s.add(ribbon(head, (q) => 0.0165 - 0.006 * q, (q) => 0.017 - 0.009 * q * q, V3(0, 1, 0), PRESENCE_UV.crumb, { ring: 8, power: 3.5 }), pal.blackPlastic);
    const nozzle = new THREE.CylinderGeometry(0.0055, 0.007, 0.012, 14);
    nozzle.rotateX(Math.PI / 2);
    nozzle.translate(px, top + 0.226, pz + 0.062);
    s.add(nozzle, pal.blackPlastic);
    // Trigger lever: curves down and back from under the head.
    const lever: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const q = i / 6;
      lever.push(V3(px, top + 0.216 - 0.05 * q, pz + 0.04 + 0.014 * Math.sin(q * Math.PI * 0.9) - 0.006 * q));
    }
    s.add(ribbon(lever, () => 0.009, () => 0.0035, V3(0, 0, 1), PRESENCE_UV.crumb, { ring: 8, power: 3 }), pal.blackPlastic);

    // fix-cabinets — under-counter stock: a 4 qt saucepan with its lid on, mid-shelf at the back,
    // and a 5 lb bag of flour standing on the floor behind the towel roll.
    {
      const cx = (x0 + x1) / 2 + 0.02, cz = zBack + 0.2;
      const pot = lathe([V2(0, 0), V2(0.085, 0), V2(0.09, 0.005), V2(0.09, 0.11), V2(0.093, 0.112), V2(0.087, 0.112), V2(0.085, 0.006), V2(0, 0.006)], 36);
      pot.translate(cx, top, cz);
      s.add(pot, pal.stainless);
      const lid = lathe([V2(0, 0), V2(0.092, 0), V2(0.092, 0.004), V2(0.06, 0.018), V2(0.012, 0.026), V2(0.012, 0.04), V2(0, 0.04)], 36);
      lid.translate(cx, top + 0.112, cz);
      s.add(lid, pal.stainless);
      const grip = new THREE.CylinderGeometry(0.016, 0.014, 0.012, 16);
      grip.translate(cx, top + 0.158, cz);
      s.add(grip, pal.blackPlastic);
      const hdl = new THREE.CylinderGeometry(0.008, 0.008, 0.16, 12);
      hdl.rotateZ(Math.PI / 2);
      hdl.translate(cx + 0.17, top + 0.1, cz);
      s.add(hdl, pal.blackPlastic);
      // Flour bag: a soft paper block with a folded top, a faded printed band (atlas `label`).
      const fx = x0 + 0.5, fz = zBack + 0.14, fw = 0.15, fd = 0.09, fh = 0.26;
      s.rbox(pal.napkin, [fx - fw / 2, floorY, fz - fd / 2], [fx + fw / 2, floorY + fh, fz + fd / 2], 0.012, 3);
      s.rbox(pal.napkin, [fx - fw / 2 + 0.01, floorY + fh - 0.005, fz - fd / 2 + 0.02], [fx + fw / 2 - 0.01, floorY + fh + 0.02, fz + fd / 2 - 0.02], 0.006, 2);
      const lbl = uvIntoRect(new THREE.PlaneGeometry(fw - 0.02, 0.045), PRESENCE_UV.label);
      lbl.translate(fx, floorY + fh * 0.55, fz + fd / 2 + 0.0003);
      s.add(lbl, cloth);
    }
  }

  // Doors: full-overlay, 18 mm laminate on the die face, lapping the opening 8 mm each side
  // (shadow lines all round, so they read as doors and not as more die), meeting gap 3 mm;
  // each on its own hinge at its outer edge.
  const lap = 0.008;
  const w = (x1 - x0) / 2 + lap - 0.0015;
  const dz0 = 0.001, dz1 = 0.019;
  const zHinge = zFront;
  // Shadow gap: a 4 mm dark reveal around the pair, on the die face, so the doors read as
  // doors in the flat service-side light (the carcass shows dark through the meeting gap).
  {
    const g = 0.004, dk = pal.darkSeal;
    const ox0 = x0 - lap, ox1 = x1 + lap, oy0 = y0 - lap, oy1 = y1 + lap;
    s.box(dk, [ox0 - g, oy0 - g, zFront], [ox0, oy1 + g, zFront + 0.0006]);
    s.box(dk, [ox1, oy0 - g, zFront], [ox1 + g, oy1 + g, zFront + 0.0006]);
    s.box(dk, [ox0, oy1, zFront], [ox1, oy1 + g, zFront + 0.0006]);
    s.box(dk, [ox0, oy0 - g, zFront], [ox1, oy0, zFront + 0.0006]);
  }
  // Both doors are ONE mesh (one draw call — rev 1 spent four: two leaves × {laminate, chrome},
  // doubled by the transmission pass). Each door's geometry is authored in its hinge's local
  // frame and baked to world whenever that hinge moves (a CPU transform of ~1.5 k vertices in
  // `updateMatrixWorld`, so the shadow pass and the main pass see the same frame). The material
  // is the carcass laminate cloned with vertex colours; vertex alpha 0 flags the chrome parts
  // (pull, hinge cups), which the fragment shader renders as metal in the vertex's colour.
  const chromeC = pal.chrome.color;
  const CHROME: [number, number, number, number] = [chromeC.r, chromeC.g, chromeC.b, 0];
  const LAM: [number, number, number, number] = [1, 1, 1, 1];
  const colour4 = (g: THREE.BufferGeometry, c: [number, number, number, number]) => {
    const n = g.attributes.position.count, arr = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) arr.set(c, i * 4);
    g.setAttribute("color", new THREE.BufferAttribute(arr, 4));
    return g;
  };
  const doorMat = lam.clone();
  doorMat.vertexColors = true;
  doorMat.name = "cabinetDoors";
  metalByVertexAlpha(doorMat, 0.08, "cabinet-doors");

  const parts: Array<{ hinge: THREE.Group; geo: THREE.BufferGeometry }> = [];
  const make = (side: -1 | 1): HingedLeaf => {
    const hinge = new THREE.Group();
    hinge.name = side < 0 ? "cabinet-door-left" : "cabinet-door-right";
    const hx = side < 0 ? x0 - lap : x1 + lap;
    hinge.position.set(hx, 0, zHinge);
    const b = new MergedBuilder();
    // Local x runs from the hinge toward the meeting stile; mirrored for the right door.
    const X = (u: number) => (side < 0 ? u : -u);
    const xa = X(0), xb = X(w);
    const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
    const ya = y0 - lap, yb = y1 + lap;
    b.rbox(lam, [lo, ya, dz0], [hi, yb, dz1], 0.0025, 2, { metric: true });
    // Chrome wire pull, 96 mm centres, vertical, 45 mm in from the meeting stile at ⅔ height
    // (the pulls are what make the pair read as doors from the aisle).
    const pxl = side < 0 ? hi - 0.045 : lo + 0.045;
    const pyc = ya + (yb - ya) * 0.66;
    const bar = new THREE.CylinderGeometry(0.005, 0.005, 0.12, 14);
    bar.translate(pxl, pyc, dz1 + 0.03);
    b.add(bar, pal.chrome);
    for (const py of [pyc - 0.048, pyc + 0.048]) {
      const post = new THREE.CylinderGeometry(0.0045, 0.0045, 0.03, 12);
      post.rotateX(Math.PI / 2);
      post.translate(pxl, py, dz1 + 0.015);
      b.add(post, pal.chrome);
    }
    // Two concealed Euro hinges on the inner face (35 mm cup in a 48 × 60 flange, its body 11 mm
    // proud of the face; the arm runs from the cup back past the hinge edge to the carcass plate).
    // Cup centre 46.5 mm from the hinge edge — clear of the 18 mm side panel the door overlays.
    for (const hy of hingeYs) {
      const cx = X(0.0465);
      const flange = new THREE.BoxGeometry(0.048, 0.06, 0.0015);
      flange.translate(cx, hy, dz0 - 0.00075);
      b.add(flange, pal.chrome);
      const cup = new THREE.CylinderGeometry(0.0175, 0.0175, 0.011, 24);
      cup.rotateX(Math.PI / 2);
      cup.translate(cx, hy, dz0 - 0.0015 - 0.0055);
      b.add(cup, pal.chrome);
      for (const sy of [-0.021, 0.021]) {
        const screw = new THREE.CylinderGeometry(0.0035, 0.0035, 0.001, 10);
        screw.rotateX(Math.PI / 2);
        screw.translate(cx, hy + sy, dz0 - 0.002);
        b.add(screw, pal.chrome);
      }
      const armLo = Math.min(X(0.0465), X(-0.004)), armHi = Math.max(X(0.0465), X(-0.004));
      b.rbox(pal.chrome, [armLo, hy - 0.009, dz0 - 0.0125], [armHi, hy + 0.009, dz0 - 0.0035], 0.001);
    }
    // Collapse the two buckets into one vertex-coloured geometry (hinge-local).
    const staging = new THREE.Group();
    const built = b.build(staging);
    const pieces = built.map((m) => colour4(m.geometry.index ? m.geometry.toNonIndexed() : m.geometry, m.material === lam ? LAM : CHROME));
    const geo = mergeGeometries(pieces, false)!;
    parts.push({ hinge, geo });
    parent.add(hinge);
    const mid = (ya + yb) / 2;
    return {
      hinge,
      sign: side < 0 ? -1 : 1,
      focus: new THREE.Vector3(hx + X(w * 0.6), mid, zFront),
      voice: new THREE.Vector3(hx + X(w * 0.9), yb - 0.03, zFront),
      width: w,
    };
  };
  const leaves: [HingedLeaf, HingedLeaf] = [make(-1), make(1)];
  bakedLeaves(parent, parts, doorMat, "cabinet-doors");
  return { leaves, material: doorMat };
}

/**
 * One mesh for a set of hinged leaves, baked to world space from the hinges' matrices whenever
 * one of them turns (a CPU transform of a few k vertices in `updateMatrixWorld`, so the shadow
 * pass and the main pass see the same frame). Each `geo` is authored in its hinge's local frame.
 */
function bakedLeaves(parent: THREE.Group, parts: Array<{ hinge: THREE.Group; geo: THREE.BufferGeometry }>, doorMat: THREE.Material, name: string): THREE.Mesh {
  const merged = mergeGeometries(parts.map((p) => p.geo), false)!;
  const local = { pos: (merged.attributes.position.array as Float32Array).slice(), nrm: (merged.attributes.normal.array as Float32Array).slice() };
  const ranges: Array<[number, number]> = [];
  for (let i = 0, at = 0; i < parts.length; i++) {
    const n = parts[i].geo.attributes.position.count;
    ranges.push([at, at + n]);
    at += n;
  }
  const doors = new THREE.Mesh(merged, doorMat);
  doors.name = name;
  doors.castShadow = true;
  doors.receiveShadow = true;
  doors.frustumCulled = false; // bounds change with the doors; the mesh is small and always near the counter
  parent.add(doors);
  const M = new THREE.Matrix4(), N = new THREE.Matrix3(), v = new THREE.Vector3();
  const bake = () => {
    const pos = merged.attributes.position as THREE.BufferAttribute, nrm = merged.attributes.normal as THREE.BufferAttribute;
    const P = pos.array as Float32Array, Nn = nrm.array as Float32Array;
    for (let d = 0; d < parts.length; d++) {
      M.copy(parts[d].hinge.matrixWorld);
      N.getNormalMatrix(M);
      const [a, b2] = ranges[d];
      for (let i = a; i < b2; i++) {
        v.fromArray(local.pos, i * 3).applyMatrix4(M).toArray(P, i * 3);
        v.fromArray(local.nrm, i * 3).applyMatrix3(N).normalize().toArray(Nn, i * 3);
      }
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
  };
  const last = [NaN, NaN];
  for (let d = 0; d < parts.length; d++) {
    const hinge = parts[d].hinge;
    const base = hinge.updateMatrixWorld.bind(hinge);
    hinge.updateMatrixWorld = (force?: boolean) => {
      base(force);
      if (last[d] !== hinge.rotation.y) {
        last[d] = hinge.rotation.y;
        bake();
      }
    };
  }
  return doors;
}

/* ------------------------------------------------------------------------------------ */
/* Kitchen swing door                                                                     */
/* ------------------------------------------------------------------------------------ */

/** 9 × 14 in vision panel, its centre at 1.5 m (eye height through the glass). */
const VISION = { w: 0.229, h: 0.356, centerY: 1.5 };
/** Kitchen depth (m) behind the partition — the real kitchen's (Kitchen.ts, = fix-rear's REAR). */
const KITCHEN_DEPTH = KITCHEN.depth;

function buildKitchenDoor(parent: THREE.Group, _pal: Palette, _s: MergedBuilder, cloth: THREE.Material): { leaf: HingedLeaf; light: THREE.SpotLight; materials: THREE.MeshStandardMaterial[] } {
  const T = ROOM.wallThickness, zBack = ROOM.zBack;
  const x0 = KITCHEN_DOOR.centerX - KITCHEN_DOOR.width / 2, x1 = KITCHEN_DOOR.centerX + KITCHEN_DOOR.width / 2;
  const h = KITCHEN_DOOR.height;
  const zMid = zBack - T / 2;

  const hinge = new THREE.Group();
  hinge.name = "kitchen-door";
  hinge.position.set(x0 + 0.006, 0, zMid);
  const w = x1 - x0 - 0.012;
  const b = new MergedBuilder();
  // Rev 4: the plates are a box-projected, brush-stretched mirror of a probe captured at the
  // door (`brushedPlatesByVertexAlpha`; rev 3's `anisotropy` + room probe read as paint).
  // Roughness 0.27 ± 0.06 in brushing runs; the probe station is 0.35 m into the dining room
  // at the height between the plates, captured once at boot with the leaf closed.
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.06 });
  leafMat.name = "kitchenLeaf";
  brushedPlatesByVertexAlpha(leafMat, 0.3, "kitchen-leaf", new THREE.Vector3(KITCHEN_DOOR.centerX, 1.0, zBack + 0.35));
  const PAINT = 0xf2f1ec, RUBBER = 0x141416, PIVOT = 0x2b2b2d;
  const cx = w / 2;
  const { w: vw, h: vh, centerY: vy } = VISION;
  const th = 0.04; // leaf thickness
  const slabW = w - 0.01, yBot = 0.015, yTop = h - 0.008;
  const sx0 = cx - slabW / 2, sx1 = cx + slabW / 2;
  // Leaf: painted, in four slabs round the vision-panel opening (the opening is real: the
  // glass is a pane in it, the kitchen shows through).
  const slab = (a: readonly [number, number, number], c: readonly [number, number, number], hex: number) => {
    const g = new THREE.BoxGeometry(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    g.translate((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
    b.add(tint(g, hex), leafMat);
  };
  const ox0 = cx - vw / 2, ox1 = cx + vw / 2, oy0 = vy - vh / 2, oy1 = vy + vh / 2;
  slab([sx0, yBot, -th / 2], [sx1, oy0, th / 2], PAINT);
  slab([sx0, oy1, -th / 2], [sx1, yTop, th / 2], PAINT);
  slab([sx0, oy0, -th / 2], [ox0, oy1, th / 2], PAINT);
  slab([ox1, oy0, -th / 2], [sx1, oy1, th / 2], PAINT);
  // Black rubber vision moulding: lines the opening (6 mm) and laps 22 mm onto both faces, 3 mm proud.
  {
    const m = 0.022, lip = 0.003, r = 0.006;
    for (const [za, zb] of [[-th / 2 - lip, -th / 2], [th / 2, th / 2 + lip]] as const) {
      slab([ox0 - m, oy0 - m, za], [ox1 + m, oy0, zb], RUBBER);
      slab([ox0 - m, oy1, za], [ox1 + m, oy1 + m, zb], RUBBER);
      slab([ox0 - m, oy0, za], [ox0, oy1, zb], RUBBER);
      slab([ox1, oy0, za], [ox1 + m, oy1, zb], RUBBER);
    }
    slab([ox0, oy0, -th / 2], [ox1, oy0 + r, th / 2], RUBBER);
    slab([ox0, oy1 - r, -th / 2], [ox1, oy1, th / 2], RUBBER);
    slab([ox0, oy0, -th / 2], [ox0 + r, oy1, th / 2], RUBBER);
    slab([ox1 - r, oy0, -th / 2], [ox1, oy1, th / 2], RUBBER);
  }
  // Scuffs (rev 3): rubber transfer in the albedo, as a MULTIPLY decal — an unlit pane over
  // each face whose texture is 1 where the paint is clean and the transfer's darkening where
  // it is not (atlas `scuff`, two bands: dining face / kitchen face). Multiplying the lit paint
  // cannot flip sign with the view or the light: rev 2's proud vertex-coloured streaks read
  // dark on the closed leaf and bright on the open one (their own shading against a face in
  // shadow), and repeated a 3-parallel-stroke motif. The tile has bumper arcs, corner scrapes,
  // crumbs and a hand smear, each drawn once. Its own mesh: +1 draw when the leaf is in view.
  {
    const scuffMat = new THREE.MeshBasicMaterial({
      map: (cloth as THREE.MeshStandardMaterial).map,
      blending: THREE.MultiplyBlending,
      premultipliedAlpha: true, // r185: multiply is dst × (src·a + 1 − a); the tile's a = 1 → dst × src
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    scuffMat.name = "kitchenScuffs";
    scuffMat.userData.noCast = true;
    const R = PRESENCE_UV.scuff, midV = (R[1] + R[3]) / 2;
    const bandY: [number, number] = [0.47, 0.92]; // cart bumpers to the low hand marks; the plates are clear of it
    const face = (z: number, flip: boolean, band: readonly [number, number]) => {
      const g = new THREE.PlaneGeometry(slabW - 0.04, bandY[1] - bandY[0]);
      uvIntoRect(g, [R[0], band[0], R[2], band[1]]);
      if (flip) g.rotateY(Math.PI);
      g.translate(cx, (bandY[0] + bandY[1]) / 2, z);
      b.add(g, scuffMat);
    };
    face(th / 2 + 0.0004, false, [midV, R[3]]); // dining face: the upper band of the tile
    face(-th / 2 - 0.0004, true, [R[1], midV]); // kitchen face: the lower band
  }
  // Pivots: top and bottom on the hinge stile (dark, same bucket).
  for (const y of [0.05, h - 0.06]) {
    const piv = new THREE.CylinderGeometry(0.012, 0.012, 0.06, 16);
    piv.translate(0.006, y, 0);
    b.add(tint(piv, PIVOT), leafMat);
  }
  // Stainless: 16" kick plates on both faces, 4 × 16 in push plates at 1.0–1.4 m near the free
  // edge on both faces (a double-acting door is pushed from either side), 1.5 mm proud with a
  // 0.7 mm radiused edge that catches the light, fixed with pan-head screws on the usual
  // template (kick: three along the top and the bottom edge, 25 mm in; push: four corners).
  // Rev 2 passed the stainless colour as a hex of LINEAR values and `tint` read it as sRGB —
  // a 0.30 albedo, the charcoal the critic measured. `getHex()` returns sRGB.
  {
    // Rev 4: satin aluminium / 430 stainless F0 (238/240/243 sRGB) — the probe supplies the value.
    const STEEL = 0xeef0f3;
    const SCREW = new THREE.Color().setRGB(0.5, 0.5, 0.52, THREE.LinearSRGBColorSpace).getHex();
    const proud = 0.0015;
    const plate = (a: readonly [number, number, number], c: readonly [number, number, number], brush: number) => {
      const g = new RoundedBoxGeometry(c[0] - a[0], c[1] - a[1], c[2] - a[2], 2, 0.0007);
      g.translate((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
      b.add(tint(g, STEEL, true, brush), leafMat);
    };
    const screw = (x: number, y: number, zFace: number, out: 1 | -1) => {
      const head = new THREE.CylinderGeometry(0.0038, 0.0042, 0.0014, 14);
      head.rotateX(Math.PI / 2);
      head.translate(x, y, zFace + out * 0.0007);
      b.add(tint(head, SCREW, true), leafMat);
      const slot = new THREE.BoxGeometry(0.0055, 0.0008, 0.0006);
      slot.rotateZ(0.6 + 1.1 * Math.sin(x * 37 + y * 91)); // slots at odd angles, as driven
      slot.translate(x, y, zFace + out * 0.0014);
      b.add(tint(slot, 0x1a1a1c), leafMat);
    };
    for (const [za, zb, out] of [[-th / 2 - proud, -th / 2, -1], [th / 2, th / 2 + proud, 1]] as const) {
      const kx0 = sx0 + 0.02, kx1 = sx1 - 0.02, ky0 = yBot + 0.012, ky1 = ky0 + 0.406;
      plate([kx0, ky0, za], [kx1, ky1, zb], BRUSH_X); // kick plates brushed horizontally
      const zFace = out > 0 ? zb : za;
      for (const fx of [0.025, 0.5, 0.975]) for (const fy of [0.025, 0.975]) screw(kx0 + fx * (kx1 - kx0), ky0 + fy * (ky1 - ky0), zFace, out);
      const px0 = w - 0.06 - 0.1, px1 = w - 0.06, py0 = 1.0, py1 = 1.4;
      plate([px0, py0, za], [px1, py1, zb], BRUSH_Y); // push plates brushed vertically
      for (const fx of [0.13, 0.87]) for (const fy of [0.04, 0.96]) screw(px0 + fx * (px1 - px0), py0 + fy * (py1 - py0), zFace, out);
    }
  }
  // The vision glass: a 6 mm pane in the leaf's mid-plane. Not the transmissive palette glass -
  // that would switch the transmission pass on (every opaque draw twice) at poses where no
  // window is in view. A blended dielectric pane instead (System 3's car glass): 6 % base
  // reflectance rising with Fresnel, the lit kitchen shows straight through the blend.
  // Rev 3: the pane takes the metal probe (envMetals) at 1.6× — as a dielectric it otherwise
  // read scene.environment at the room's ambient weight and showed no reflection at all.
  const pane = makePaneGlass(0.08, 1.6);
  {
    const g = new THREE.PlaneGeometry(vw - 0.012, vh - 0.012);
    g.translate(cx, vy, 0);
    pane.transparent = true;
    pane.forceSinglePass = true; // one draw, not back + front passes
    pane.userData.noCast = true; // glass does not shadow the kitchen
    pane.name = "kitchenVisionGlass";
    b.add(g, pane);
  }
  b.build(hinge, { name: "kitchen-door" });
  parent.add(hinge);
  // feat-kitchen: the slice (rev 2–4's floor, tile, prep table, range, hood, shelving, strip
  // light) is gone — the whole walkable kitchen is Kitchen.ts. The leaf and its swing stay.

  // One shadowless 5000 K spot for the kitchen: 16,000 lm (four 2-lamp strips — a working
  // kitchen's 600+ lux) at the ceiling just inside the door header, aimed 43° down into the
  // kitchen. Its 46° cone covers the far wall, the floor, the table and the -x wall beside
  // the door (what the vision glass shows); its +z edge misses every dining-room point
  // (≥ 52° off-axis at the wall's foot, through the partition — there is no shadow map), so
  // no light pools on the dining floor. `distance` 6 m clips the rest.
  // Cooler than the dining room's FLUORESCENT (a 5000 K "daylight" tube against the 3500 K
  // troffers): the mixed-light cast through the doorway is what says "kitchen" in a photo.
  const zIn = zBack - T, kx0 = -ROOM.halfX, H = KITCHEN.ceiling;
  const KITCHEN_TUBE = new THREE.Color().setRGB(232 / 255, 241 / 255, 1, THREE.SRGBColorSpace);
  const light = new THREE.SpotLight(KITCHEN_TUBE, nits(16_000 / Math.PI), 6, THREE.MathUtils.degToRad(46), 0.35, 2);
  light.castShadow = false;
  light.name = "kitchen-fluorescent";
  light.position.set(kx0 + 0.3, H - 0.1, zIn - 0.2);
  light.target.position.set(kx0 + 0.3, 0.4, zIn - 2.45);
  parent.add(light, light.target);

  return {
    leaf: {
      hinge,
      sign: 1,
      focus: new THREE.Vector3((x0 + x1) / 2, 1.05, zBack),
      voice: new THREE.Vector3(x1 - 0.15, 1.0, zBack - 0.05),
      width: w,
    },
    light,
    materials: [leafMat, pane],
  };
}
