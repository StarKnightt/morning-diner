/**
 * System 4 rev 6 — analytic slat shadow.
 *
 * The venetian blinds are a known periodic 1-D structure, so the interior sun's shadow through
 * them is computed in closed form per fragment instead of being read from the 4096² PCSS map
 * (ported pattern: jungle-trail `canopyTransmit` / `patchCanopyLight`, src/render/canopy.js —
 * their canopy is not in the shadow map either). Why: every stripe the map produced was
 * filtered by a disc that could not go below 1.75 texels (6.6 mm) plus a camera-footprint floor
 * of up to 12 texels (45 mm), against a 16 mm stripe period measured across the beam — the
 * troughs inside the sun patches filled to 60–85 % of full sun (rev 4 critics) and the stripes'
 * contrast depended on the filter, not on the physics. Here it depends on one thing: the
 * receiver's distance `t` to the blind plane along the sun ray.
 *
 * Model. Sun ray from the receiver `p` toward the sun `s` meets the blind plane z = SLAT_Z at
 * `h = p + s·t`. In the vertical plane ⊥ the window (z, y) the beam direction is `e`; every
 * quantity is projected onto `n ⊥ e` — the coordinate `u` is constant along a sun ray, which is
 * what makes a stripe a stripe. Slat k occupies u ∈ [k·du ± hw] with du = e.z·pitch and
 * hw = ½ w · |n · chord(tilt)|; the gaps between are open. Transmittance = the fraction of the
 * 0.53° sun disc (radius R = t · tan 0.265° = 4.6 mm/m, measured ⊥ the beam) that sees a gap:
 * Σ over the five nearest gaps of the disc's straight-edge coverage A((b−u)/R) − A((a−u)/R),
 * A(q) = ½ + (q√(1−q²) + asin q)/π — a box ⊗ disc, the trapezoid the brief asked for, with the
 * pixel footprint added in quadrature as anti-aliasing. Past R ≈ 2 periods (t ≈ 7 m) the disc
 * spans more gaps than are summed and the result is blended to the duty cycle, which is where
 * the physics has already put it: a 47 % square wave of period P convolved with a disc of
 * diameter D keeps full amplitude to D = P (1.7 m from the blinds), is gone at D = 2P (3.5 m).
 *
 * Extent. Outside a window's clear opening, above the top slat (headrail) and below the lowest
 * hanging slat (stacked slats + bottom rail) the term is 1 / 1 / 0 — frame, mullions, rails
 * and the furniture stay in the shadow map, so only the slat meshes leave the caster list.
 * Per-slat sag, tilt jitter (±2.5°), the one creased slat and the ladder cords are not in the
 * term (they are sub-texel at every receiver anyway).
 *
 * Blind state. The layout (tilt, drop, hanging count per window) is derived by `blindLayout`
 * from the same seeded generator Blinds.ts uses, and baked into the GLSL as constants at
 * module load — the post pipeline (beams.ts) needs the function before the scene is built.
 * The blinds are static in this build (no System 9 openable touches them). If a blind is ever
 * raised or tilted at run time, the fallback is: put that window's slats back on the caster
 * list (`castShadow = true`) and drop the window from `blindLayout` so the term is 1 there.
 */
import * as THREE from "three";
import { makeRng } from "../core/rng";
import { ROOM, WINDOW } from "./layout";

/** Blind geometry shared with Blinds.ts (BLIND there re-exports these numbers). */
export const SLAT = {
  width: 0.025,
  pitch: 0.022,
  tiltDeg: 25,
  zCentre: ROOM.zFront + 0.04,
  headrailH: 0.038,
  bottomRailH: 0.019,
  frameFace: 0.04,
} as const;

export interface BlindState {
  /** Window index and clear opening in x. */
  wi: number;
  cx: number;
  x0: number;
  x1: number;
  /** Tilt (radians, street edge up) and how far the blind was pulled up from fully lowered (m). */
  tilt: number;
  raised: number;
  /** Centre height of the top slat and of the lowest hanging slat; bottom rail centre. */
  yFirst: number;
  yLow: number;
  yRail: number;
  hanging: number;
  stacked: number;
  countFull: number;
  /** The per-blind generator, positioned after the two draws above (Blinds.ts continues it). */
  rng: () => number;
}

/** Per-window blind state, deterministic (seed 3301 + 7919·wi, first two draws: tilt, drop). */
export function blindLayout(): BlindState[] {
  const fw = SLAT.frameFace;
  const openW = WINDOW.width - 2 * fw;
  const yHeadTop = WINDOW.head - fw;
  const yHead0 = yHeadTop - SLAT.headrailH;
  const yFirst = yHead0 - 0.012;
  const yStopFull = WINDOW.sill + fw + 0.03;
  const countFull = Math.floor((yFirst - yStopFull) / SLAT.pitch) + 1;
  return WINDOW.centersX.map((cx, wi) => {
    const rng = makeRng(3301 + wi * 7919);
    const tilt = THREE.MathUtils.degToRad(SLAT.tiltDeg + (rng() - 0.5) * 10);
    const raised = wi === 1 || wi === 3 ? 0 : wi === WINDOW.centersX.length - 1 ? 0.15 + rng() * 0.15 : 0.03 + rng() * 0.05;
    const yRail = yStopFull - 0.018 + raised;
    const hanging = Math.floor((yFirst - (yRail + SLAT.bottomRailH / 2 + 0.012)) / SLAT.pitch) + 1;
    return { wi, cx, x0: cx - openW / 2, x1: cx + openW / 2, tilt, raised, yFirst, yLow: yFirst - (hanging - 1) * SLAT.pitch, yRail, hanging, stacked: countFull - hanging, countFull, rng };
  });
}

/**
 * GLSL: `float slatTransmit( vec3 p, vec3 s, float aa )` — p world position, s unit vector toward
 * the sun (world), aa the pixel footprint in metres (0 for a march). Needs `PI` (three's common).
 */
/**
 * Fraction of the sun's beam the nominal blind passes (the shader's `open` term at the
 * distance where the slat shadows have merged): 1 − 2·hw/du with hw the slat half-width and
 * du the slat period, both measured across the beam. 25° slats under a 35° sun sit 10° off
 * edge-on to it and pass ≈ 0.76 — not the 0.5 rev 2 assumed for the patch illuminance.
 */
export function slatBeamOpen(sun: THREE.Vector3, tilt = THREE.MathUtils.degToRad(SLAT.tiltDeg)): number {
  const e = new THREE.Vector2(sun.z, sun.y).normalize();
  const hw = (SLAT.width / 2) * Math.abs(e.x * Math.sin(tilt) - e.y * Math.cos(tilt));
  const du = e.x * SLAT.pitch;
  return Math.max(0, 1 - (2 * hw) / du);
}

/**
 * feat-blinds-f: per-window drop, 1 = hanging as built, 0 = fully raised (stacked under the
 * headrail). One Float32Array shared by reference with every lit program (`installBlindDropUniform`
 * in Blinds.ts registers it on the ShaderLib entries; the post shaders add `uBlindDrop` to their
 * own uniforms) — write into `BLIND_DROP.value[i]` and every shader sees it on its next draw.
 */
export const BLIND_DROP = { value: new Float32Array(WINDOW.centersX.length).fill(1) };

export function slatShadowGlsl(): string {
  const wins = blindLayout();
  const f = (v: number) => v.toFixed(5);
  const arr = wins.map((w) => `vec4( ${f(w.x0)}, ${f(w.x1)}, ${f(w.tilt)}, ${f(w.yLow)} )`).join(", ");
  return /* glsl */ `
	// ---- analytic venetian-blind transmittance (src/scene/slatShadow.ts) ----
	#ifndef PI
	#define PI 3.141592653589793
	#endif
	#define SLAT_N ${wins.length}
	const vec4 SLAT_WIN[SLAT_N] = vec4[SLAT_N]( ${arr} ); // x0, x1, tilt, y of the lowest hanging slat
	uniform float uBlindDrop[SLAT_N];                  // feat-blinds-f: 1 hanging … 0 raised (BLIND_DROP)
	const float SLAT_STACK_H = ${f(wins[0].countFull * 0.0014 + SLAT.bottomRailH + 0.006)}; // full stack + bottom rail
	const float SLAT_Z = ${f(SLAT.zCentre)};
	const float SLAT_Y0 = ${f(wins[0].yFirst)};
	const float SLAT_P = ${f(SLAT.pitch)};
	const float SLAT_HW = ${f(SLAT.width / 2)};
	const float SLAT_SUN_TAN = ${Math.tan(THREE.MathUtils.degToRad(0.265)).toFixed(6)};
	// Fraction of a disc of radius R lying below a straight edge at signed distance x.
	float slatEdge( float x, float R ) {
		float q = clamp( x / R, -1.0, 1.0 );
		return 0.5 + ( q * sqrt( 1.0 - q * q ) + asin( q ) ) / PI;
	}
	float slatTransmit( vec3 p, vec3 s, float aa ) {
		if ( s.z <= 1e-4 ) return 1.0;
		float t = ( SLAT_Z - p.z ) / s.z;
		if ( t <= 0.0 ) return 1.0;
		vec3 h = p + s * t;
		vec4 win = vec4( 0.0 );
		float drop = 1.0;
		bool hit = false;
		for ( int i = 0; i < SLAT_N; i ++ ) {
			if ( h.x > SLAT_WIN[ i ].x && h.x < SLAT_WIN[ i ].y ) { win = SLAT_WIN[ i ]; drop = uBlindDrop[ i ]; hit = true; }
		}
		if ( ! hit ) return 1.0;
		if ( h.y > SLAT_Y0 + 0.5 * SLAT_P ) return 1.0; // headrail: in the shadow map
		// feat-blinds-f: a blind being raised hangs only down to yLow' — the stripe region shrinks
		// from the sill upward with the lowest slat; under it the growing stack + bottom rail are
		// opaque and the glass below that is clear (term 1, full sun patch). Over the last 12 % of
		// the raise the stripes fade to 1 as the last slats close up into the stack.
		float yLow = mix( SLAT_Y0 + 0.5 * SLAT_P, win.w, drop );
		if ( h.y < yLow - 0.5 * SLAT_P ) {
			if ( drop >= 0.999 ) return 0.0;             // as built: stacked slats on the bottom rail
			float stackH = mix( SLAT_STACK_H, 0.0, drop );
			return h.y < yLow - 0.5 * SLAT_P - stackH ? 1.0 : 0.0;
		}
		vec2 e = normalize( vec2( s.z, s.y ) );          // beam in the (z, y) plane
		float u = e.x * ( h.y - SLAT_Y0 );               // coordinate across the beam, 0 at slat 0
		float du = e.x * SLAT_P;                         // slat period across the beam
		float hw = SLAT_HW * abs( e.x * sin( win.z ) - e.y * cos( win.z ) ); // slat half-width across the beam
		float R = SLAT_SUN_TAN * t;                      // sun-disc radius at this distance
		R = sqrt( R * R + 0.34 * aa * aa ) + 1e-5;       // + pixel footprint (box ≈ disc of 0.58 aa)
		float k0 = floor( u / du );
		float T = 0.0;
		for ( int j = -2; j <= 2; j ++ ) {
			float k = k0 + float( j );
			float a = k * du + hw, b = ( k + 1.0 ) * du - hw;
			if ( b > a ) T += slatEdge( b - u, R ) - slatEdge( a - u, R );
		}
		float open = max( 0.0, 1.0 - 2.0 * hw / du );
		T = mix( T, open, smoothstep( 1.6, 2.0, R / du ) );
		T = mix( 1.0, T, smoothstep( 0.0, 0.12, drop ) );  // feat-blinds-f: nearly / fully raised → no stripes
		return clamp( T, 0.0, 1.0 );
	}
`;
}
