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
import { BACK_BAR, KITCHEN_DOOR, REAR, ROOM } from "./layout";
import { nits } from "./Lighting";
import { lathe, ribbon, SAUCER_PROFILE, tiledRect, uvIntoRect } from "./Presence";

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

/** 4 × 4" wall tiles and 4 × 6" quarry tiles per atlas cell. */
const WALL_TILE_CELL = 4 * 0.1016;
const QUARRY_CELL = 4 * 0.1524;

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
  return {
    cabinet: cabinet.leaves,
    kitchenDoor: kitchen.leaf,
    kitchenLight: kitchen.light,
    envMetals: [cabinet.material, ...kitchen.materials],
  };
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

  // One mesh for both, baked to world space from the hinges' matrices.
  const merged = mergeGeometries(parts.map((p) => p.geo), false)!;
  const local = { pos: (merged.attributes.position.array as Float32Array).slice(), nrm: (merged.attributes.normal.array as Float32Array).slice() };
  const ranges: Array<[number, number]> = [];
  for (let i = 0, at = 0; i < parts.length; i++) {
    const n = parts[i].geo.attributes.position.count;
    ranges.push([at, at + n]);
    at += n;
  }
  const doors = new THREE.Mesh(merged, doorMat);
  doors.name = "cabinet-doors";
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
  return { leaves, material: doorMat };
}

/* ------------------------------------------------------------------------------------ */
/* Kitchen swing door                                                                     */
/* ------------------------------------------------------------------------------------ */

/** 9 × 14 in vision panel, its centre at 1.5 m (eye height through the glass). */
const VISION = { w: 0.229, h: 0.356, centerY: 1.5 };
/** Kitchen slice depth (m) behind the partition: the whole enclosed kitchen box (layout.ts REAR, fix-rear; was a 2.7 m slice in a void). */
const KITCHEN_DEPTH = REAR.kitchenDepth;

function buildKitchenDoor(parent: THREE.Group, pal: Palette, s: MergedBuilder, cloth: THREE.Material): { leaf: HingedLeaf; light: THREE.SpotLight; materials: THREE.MeshStandardMaterial[] } {
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
  // Kitchen metals (rev 3): a satin half-metal so the 16,000 lm spot lights them — bowls, pans,
  // table, hood. Pure metal (`pal.stainless`) only mirrors the dining-room probe, which does not
  // see into the kitchen, and read as charcoal with 1 px rims. Own bucket, all of it in the
  // kitchen, so it is culled from the spawn; +1 draw with the door in view.
  // Rev 4: real stainless (metalness 0.9, roughness 0.28) on its own probe captured inside the
  // slice (`userData.probePos`, Diner.ts), so the bowls mirror the lit tile and the fixture
  // instead of reading as matte melamine under the half-metal of rev 3.
  const steel = new THREE.MeshStandardMaterial({ color: 0xe4e6e8, metalness: 0.85, roughness: 0.36, envMapIntensity: 1.2 });
  steel.name = "kitchenSteel";
  steel.userData.probePos = new THREE.Vector3(KITCHEN_DOOR.centerX, 1.05, zBack - T - 0.9);

  /* ---------------- the kitchen slice ---------------- */
  const zIn = zBack - T, zFar = zIn - KITCHEN_DEPTH;
  const kx0 = -ROOM.halfX, kx1 = x1 + 1.6; // the building's end wall continues; 1.6 m past the +x jamb
  const H = ROOM.height;
  const tileTop = 1.5;
  const wallTile = PRESENCE_UV.wallTile, quarry = PRESENCE_UV.quarry;
  const paint = pal.wallPaint;
  const tile = (a: readonly [number, number, number], c: readonly [number, number, number], n: THREE.Vector3) => s.add(tiledRect(a, c, n, WALL_TILE_CELL, wallTile), cloth);
  // Floor: quarry tile from the far wall through the opening to the dining floor's edge.
  s.add(tiledRect([kx0, 0, zFar], [kx1, 0, zIn], V3(0, 1, 0), QUARRY_CELL, quarry), cloth);
  s.add(tiledRect([x0 - 0.02, 0, zIn], [x1 + 0.02, 0, zBack], V3(0, 1, 0), QUARRY_CELL, quarry), cloth);
  // Walls: tile to 1.5 m, paint above; ceiling in the same paint.
  tile([kx0, 0, zFar], [kx1, tileTop, zFar], V3(0, 0, 1)); // far wall
  s.box(paint, [kx0, tileTop, zFar - 0.05], [kx1, H, zFar]);
  tile([kx0, 0, zFar], [kx0, tileTop, zIn], V3(1, 0, 0)); // -x wall
  s.box(paint, [kx0 - 0.05, tileTop, zFar], [kx0, H, zIn]);
  tile([kx1, 0, zFar], [kx1, tileTop, zIn], V3(-1, 0, 0)); // +x wall
  s.box(paint, [kx1, tileTop, zFar], [kx1 + 0.05, H, zIn]);
  s.box(paint, [kx0, H - 0.03, zFar], [kx1, H, zIn]); // ceiling
  // The partition's kitchen face either side of the door casing (KITCHEN_DOOR.jamb) and above it.
  const j = KITCHEN_DOOR.jamb, zFace = zIn - 0.0012; // 1.2 mm off the shell's cut face: no tie
  tile([kx0, 0, zFace], [x0 - j, tileTop, zFace], V3(0, 0, -1));
  tile([x1 + j, 0, zFace], [kx1, tileTop, zFace], V3(0, 0, -1));
  s.box(paint, [kx0, tileTop, zFace], [x0 - j, H, zIn]);
  s.box(paint, [x1 + j, tileTop, zFace], [kx1, H, zIn]);
  s.box(paint, [x0 - j, h + j, zFace], [x1 + j, H, zIn]);
  // Casing on the kitchen face (Shell.ts trims the dining side): the same 100 mm painted architrave.
  s.rbox(pal.trimPaint, [x0 - j, 0, zIn - 0.015], [x0, h + j, zIn], 0.002);
  s.rbox(pal.trimPaint, [x1, 0, zIn - 0.015], [x1 + j, h + j, zIn], 0.002);
  s.rbox(pal.trimPaint, [x0, h, zIn - 0.015], [x1, h + j, zIn], 0.002);

  // Prep table along the -x wall: 30 × 60 in stainless top with a 40 mm turned-down edge and a
  // 100 mm upstand at the wall, 1⅝" legs, an undershelf; on it a stack of sheet pans at each
  // end and a white poly cutting board between; a round trash can on the floor between the
  // partition right of the door (rev 3 — the "black cube" was a bus tub on the undershelf; the
  // "beige box" a Cambro; neither read as anything).
  {
    const ss = steel;
    const tx0 = kx0 + 0.02, tx1 = tx0 + 0.76, tz1 = zIn - 1.0, tz0 = tz1 - 1.52, top = 0.9;
    s.rbox(ss, [tx0, top - 0.04, tz0], [tx1, top, tz1], 0.004, 2);
    s.box(ss, [tx0, top, tz0], [tx0 + 0.02, top + 0.1, tz1]); // upstand
    for (const [lx, lz] of [[tx0 + 0.05, tz0 + 0.05], [tx1 - 0.05, tz0 + 0.05], [tx0 + 0.05, tz1 - 0.05], [tx1 - 0.05, tz1 - 0.05]]) {
      const leg = new THREE.CylinderGeometry(0.02, 0.02, top - 0.04, 16);
      leg.translate(lx, (top - 0.04) / 2, lz);
      s.add(leg, ss);
    }
    s.rbox(ss, [tx0 + 0.04, 0.25, tz0 + 0.04], [tx1 - 0.04, 0.28, tz1 - 0.04], 0.003);
    // Sheet pans (half size, 13 × 18 in): a 25 mm flared rim on a 2 mm floor, nested 14 mm apart.
    // Rev 4: each pan's walls flare 3 mm wider than the one below and carry a 3 mm rolled bead at
    // the top, so the stack reads as several thin lips stepping up, not one thick-rimmed tray.
    const panStack = (x: number, z: number, n: number, y: number) => {
      for (let i = 0; i < n; i++) {
        const y0 = y + i * 0.014, f = i * 0.003, W = 0.33, D = 0.46, rim = 0.025, t = 0.0025;
        const ax = x - f, az = z - f, cx2 = x + W + f, cz2 = z + D + f;
        if (i === 0) s.rbox(ss, [ax, y0, az], [cx2, y0 + 0.002, cz2], 0.001, 1);
        s.rbox(ss, [ax, y0 + 0.003, az], [cx2, y0 + rim, az + t], 0.001, 1);
        s.rbox(ss, [ax, y0 + 0.003, cz2 - t], [cx2, y0 + rim, cz2], 0.001, 1);
        s.rbox(ss, [ax, y0 + 0.003, az], [ax + t, y0 + rim, cz2], 0.001, 1);
        s.rbox(ss, [cx2 - t, y0 + 0.003, az], [cx2, y0 + rim, cz2], 0.001, 1);
        // Rolled bead round the rim, 1.5 mm proud of the wall.
        s.rbox(ss, [ax - 0.0015, y0 + rim - 0.003, az - 0.0015], [cx2 + 0.0015, y0 + rim, cz2 + 0.0015], 0.0014, 1);
      }
    };
    panStack(tx0 + 0.12, tz0 + 0.1, 3, top); // far end
    panStack(tx0 + 0.18, tz1 - 0.52, 6, top); // near end, where the Cambro was
    s.rbox(pal.fixtureWhite, [tx0 + 0.2, top, tz0 + 0.65], [tx0 + 0.65, top + 0.015, tz0 + 1.0], 0.006, 2); // cutting board
    // 20-gallon round trash can against the partition's kitchen face right of the door casing —
    // a peek past the +x jamb, not a black mass in the opening: a tapered body with two ribs and
    // a rolled rim, a bin liner turned over the rim.
    {
      const cxT = x1 + 0.42, czT = zIn - 0.33;
      const body = lathe([V2(0, 0.01), V2(0.2, 0.01), V2(0.205, 0), V2(0.215, 0), V2(0.242, 0.6), V2(0.25, 0.62), V2(0.242, 0.64), V2(0.232, 0.64), V2(0.225, 0.62), V2(0, 0.62)], 40);
      body.translate(cxT, 0, czT);
      s.add(body, pal.blackPowder);
      for (const ry of [0.2, 0.4]) {
        const rib = new THREE.TorusGeometry(0.215 + 0.045 * (ry / 0.6), 0.006, 8, 40);
        rib.rotateX(Math.PI / 2);
        rib.translate(cxT, ry, czT);
        s.add(rib, pal.blackPowder);
      }
      const liner = lathe([V2(0.2, 0.6), V2(0.238, 0.645), V2(0.252, 0.635), V2(0.256, 0.59), V2(0.25, 0.52), V2(0.246, 0.5)], 40);
      liner.translate(cxT, 0, czT);
      s.add(liner, pal.blackPlastic);
    }
    // Wall shelf over the table at 1.55 m, 300 deep, two brackets; three #10 cans and a stack of bowls on it.
    const sy = 1.55;
    s.rbox(ss, [kx0 + 0.001, sy, tz0 + 0.1], [kx0 + 0.3, sy + 0.02, tz1 - 0.1], 0.003);
    s.box(ss, [kx0 + 0.001, sy - 0.02, tz0 + 0.1], [kx0 + 0.3, sy, tz0 + 0.13]);
    s.box(ss, [kx0 + 0.001, sy - 0.02, tz1 - 0.13], [kx0 + 0.3, sy, tz1 - 0.1]);
    // #10 cans: tinplate body with the chimes (seam rims) top and bottom, a recessed lid, and a
    // paper label (atlas `canLabel`) round the middle 150 mm — the third can turned a little.
    for (const [cz, turn] of [[tz0 + 0.3, 0.4], [tz0 + 0.5, 2.9], [tz0 + 0.7, 1.7]] as const) {
      const cx = kx0 + 0.15, cy = sy + 0.02, R = 0.0785, H = 0.178;
      const tin = new THREE.CylinderGeometry(R - 0.001, R - 0.001, H, 28, 1, true);
      tin.translate(cx, cy + H / 2, cz);
      s.add(tin, ss);
      for (const ry of [0.0025, H - 0.0025]) {
        const chime = new THREE.TorusGeometry(R - 0.0015, 0.0025, 8, 28);
        chime.rotateX(Math.PI / 2);
        chime.translate(cx, cy + ry, cz);
        s.add(chime, ss);
      }
      const lid = new THREE.CircleGeometry(R - 0.003, 28);
      lid.rotateX(-Math.PI / 2);
      lid.translate(cx, cy + H - 0.004, cz);
      s.add(lid, ss);
      const label = new THREE.CylinderGeometry(R, R, 0.15, 28, 1, true);
      uvIntoRect(label, PRESENCE_UV.canLabel);
      label.rotateY(turn);
      label.translate(cx, cy + H / 2 - 0.002, cz);
      s.add(label, cloth);
    }
    // Mixing bowls, nested four high: a 4 mm rolled bead at the rim so the rim reads as a rim.
    for (let i = 0; i < 4; i++) {
      const bowl = lathe([V2(0, 0), V2(0.05, 0), V2(0.085, 0.045), V2(0.09, 0.052), V2(0.088, 0.056), V2(0.083, 0.052), V2(0.081, 0.047), V2(0.047, 0.005), V2(0, 0.005)], 36);
      bowl.translate(kx0 + 0.15, sy + 0.02 + i * 0.03, tz1 - 0.35);
      s.add(bowl, ss);
    }
  }
  // Fluorescent strip on the -x wall over the table at 1.95 m: a 4 ft vapour-tight housing with
  // its diffuser facing the room — the troffer lens material (a two-tube band of its map), so it
  // glows at the troffers' 4100 K luminance and reaches the probe / the vision glass.
  const lampZ = zIn - 1.76;
  {
    const fy = 1.95, fx = kx0 + 0.001;
    s.rbox(pal.fixtureWhite, [fx, fy - 0.07, lampZ - 0.62], [fx + 0.09, fy + 0.07, lampZ + 0.62], 0.008, 2);
    const lens = uvIntoRect(new THREE.PlaneGeometry(1.2, 0.1), [0, 0, 1, 1], [0.3, 0.72]);
    lens.rotateY(Math.PI / 2);
    lens.translate(fx + 0.0905, fy, lampZ);
    s.add(lens, pal.fixtureLens);
  }
  // Range under a stainless hood on the far wall, right of the table's line (rev 2 had it
  // behind the table's far end, through the pans), the duct up.
  {
    const ss = steel;
    const rx0 = kx0 + 0.95, rx1 = rx0 + 0.9; // its -x end in the door's line of sight, clear of the table
    s.rbox(pal.blackPowder, [rx0, 0.1, zFar], [rx1, 0.9, zFar + 0.8], 0.006, 2);
    s.box(pal.blackPowder, [rx0 + 0.05, 0, zFar + 0.05], [rx1 - 0.05, 0.1, zFar + 0.75]);
    s.rbox(ss, [rx0 - 0.002, 0.9, zFar - 0.001], [rx1 + 0.002, 0.93, zFar + 0.8], 0.004, 2); // top
    s.rbox(ss, [rx0, 0.93, zFar], [rx1, 1.3, zFar + 0.08], 0.004, 2); // back riser
    for (let i = 0; i < 4; i++) {
      const knob = new THREE.CylinderGeometry(0.018, 0.02, 0.02, 16);
      knob.rotateX(Math.PI / 2);
      knob.translate(rx0 + 0.15 + i * 0.2, 0.86, zFar + 0.81);
      s.add(knob, pal.blackPlastic);
    }
    // Hood: canopy 1.5 m wide × 0.95 deep, bottom at 1.95, a 60 mm lip (grease trough) along the
    // front edge, and a row of three baffle filters slanted 50° under it, each with its six
    // vertical baffle ribs and a frame — the grille lines the eye expects under a hood.
    const hx0 = kx0 + 0.75, hx1 = hx0 + 1.5;
    s.rbox(ss, [hx0, 1.95, zFar], [hx1, 2.4, zFar + 0.95], 0.005, 2);
    s.rbox(ss, [hx0, 1.89, zFar + 0.9], [hx1, 1.955, zFar + 0.97], 0.004, 2); // lip / trough
    s.box(ss, [hx0 + 0.5, 2.4, zFar + 0.25], [hx0 + 1.0, H, zFar + 0.75]); // duct
    for (let i = 0; i < 3; i++) {
      const fx = hx0 + 0.3 + i * 0.45;
      const parts: THREE.BufferGeometry[] = [new THREE.BoxGeometry(0.4, 0.5, 0.012)];
      for (let k = 0; k < 6; k++) {
        const rib = new THREE.BoxGeometry(0.014, 0.48, 0.02);
        rib.translate(-0.175 + k * 0.07, 0, -0.012);
        parts.push(rib);
      }
      for (const sx of [-1, 1]) {
        const rail = new THREE.BoxGeometry(0.012, 0.5, 0.024);
        rail.translate(sx * 0.194, 0, -0.008);
        parts.push(rail);
      }
      const filter = mergeGeometries(parts)!;
      filter.rotateX(THREE.MathUtils.degToRad(-50));
      filter.translate(fx, 2.15, zFar + 0.32);
      s.add(filter, ss);
    }
  }
  // Wire shelving on the +x wall, chrome, with white bus tubs — the kitchen proper beyond.
  {
    const wx1 = kx1 - 0.02, wx0 = wx1 - 0.46, wz0 = zIn - 0.6, wz1 = wz0 - 1.2;
    for (const [px, pz] of [[wx0, wz0], [wx1, wz0], [wx0, wz1], [wx1, wz1]]) {
      const post = new THREE.CylinderGeometry(0.0125, 0.0125, 1.85, 12);
      post.translate(px, 0.925, pz);
      s.add(post, pal.chrome);
    }
    for (const y of [0.15, 0.6, 1.05, 1.5]) {
      s.rbox(pal.chrome, [wx0, y, wz1], [wx1, y + 0.035, wz0], 0.004, 1);
      s.rbox(pal.fixtureWhite, [wx0 + 0.03, y + 0.035, wz1 + 0.1], [wx1 - 0.03, y + 0.035 + 0.15, wz1 + 0.5], 0.008, 2);
      s.rbox(pal.fixtureWhite, [wx0 + 0.03, y + 0.035, wz0 - 0.55], [wx1 - 0.03, y + 0.035 + 0.15, wz0 - 0.1], 0.008, 2);
    }
  }

  // One shadowless 5000 K spot for the slice: 16,000 lm (four 2-lamp strips — a working
  // kitchen's 600+ lux) at the ceiling just inside the door header, aimed 43° down into the
  // kitchen. Its 46° cone covers the far wall, the floor, the table and the -x wall beside
  // the door (what the vision glass shows); its +z edge misses every dining-room point
  // (≥ 52° off-axis at the wall's foot, through the partition — there is no shadow map), so
  // no light pools on the dining floor. `distance` 6 m clips the rest.
  // Cooler than the dining room's FLUORESCENT (a 5000 K "daylight" tube against the 3500 K
  // troffers): the mixed-light cast through the doorway is what says "kitchen" in a photo.
  const KITCHEN_TUBE = new THREE.Color().setRGB(232 / 255, 241 / 255, 1, THREE.SRGBColorSpace);
  const light = new THREE.SpotLight(KITCHEN_TUBE, nits(16_000 / Math.PI), 6, THREE.MathUtils.degToRad(46), 0.35, 2);
  light.castShadow = false;
  light.name = "kitchen-fluorescent";
  light.position.set(kx0 + 0.3, H - 0.1, zIn - 0.2);
  light.target.position.set(kx0 + 0.3, 0.4, zIn - 2.45);
  parent.add(light, light.target);
  // fix-rear: the slice is the full 4.2 m kitchen box now, so a second strip (housing + lens on
  // the -x wall at the far half) and its shadowless spot light the range wall and the back
  // floor, which the first light's 6 m cutoff and inverse square left at ~15 %. Aimed down and
  // toward -z from z = zIn - 2.6, so its +z-most ray still travels away from the dining room.
  {
    const lampZ2 = zIn - 3.4, fy = 1.95, fx = kx0 + 0.001;
    s.rbox(pal.fixtureWhite, [fx, fy - 0.07, lampZ2 - 0.62], [fx + 0.09, fy + 0.07, lampZ2 + 0.62], 0.008, 2);
    const lens2 = uvIntoRect(new THREE.PlaneGeometry(1.2, 0.1), [0, 0, 1, 1], [0.3, 0.72]);
    lens2.rotateY(Math.PI / 2);
    lens2.translate(fx + 0.0905, fy, lampZ2);
    s.add(lens2, pal.fixtureLens);
    const light2 = new THREE.SpotLight(KITCHEN_TUBE, nits(12_000 / Math.PI), 6, THREE.MathUtils.degToRad(46), 0.35, 2);
    light2.castShadow = false;
    light2.name = "kitchen-fluorescent-2";
    light2.position.set(kx0 + 0.6, H - 0.1, zIn - 2.6);
    light2.target.position.set(kx0 + 1.2, 0.4, zFar + 0.3);
    parent.add(light2, light2.target);
  }

  return {
    leaf: {
      hinge,
      sign: 1,
      focus: new THREE.Vector3((x0 + x1) / 2, 1.05, zBack),
      voice: new THREE.Vector3(x1 - 0.15, 1.0, zBack - 0.05),
      width: w,
    },
    light,
    materials: [leafMat, steel, pane],
  };
}
