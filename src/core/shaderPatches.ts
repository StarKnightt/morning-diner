/**
 * Global patch to three's physical shading chunk, installed once before any program compiles
 * (materials.ts calls `installShaderPatches()` at palette creation), so every MeshPhysical
 * material in the scene — merged buckets, clones, System 9's `onBeforeCompile` leaf materials —
 * gets it without per-material hooks. Lambert / Phong shaders and Lighting.ts are untouched.
 *
 * Anisotropy tangent frame (the counter-edge beads, fix-counter-door).
 *   Without a `tangent` attribute three builds the anisotropy frame from screen-space
 *   derivatives (`getTangentFrame`), which scales T and B by ONE shared factor — the longer of
 *   the two. On a face whose UVs are stretched, the other axis comes out nearly zero: the
 *   counter's 100 mm stainless backsplash lip is a 7.8 × 0.1 m RoundedBox face with 0..1 UVs
 *   both ways (78:1), so its tangent was ≈ 0.013 long. `D_GGX_Anisotropic` divides by the half
 *   vector's projection onto that frame, so wherever the half vector crossed the plane of the
 *   missing axis the lobe spiked to 10³–10⁴× — once per light along the lip (the per-booth
 *   sun-bounce spots lit its aisle-side round-over from below), independent of roughness (a
 *   roughness-1 lip still beaded), and the bloom grew each spike into a 30 px blob. Rebuilding
 *   the missing axis as N × (the good one) makes the frame orthonormal: the spikes are gone and
 *   the brushing runs along the u direction it was authored for on every anisotropic material
 *   (the lip, kick plate, brewer hood, napkin dispensers, stool bands).
 *
 * A/B switch: `?anisofix=0`.
 */
import * as THREE from "three";

const ANISO_T = "material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;";
const ANISO_B = "material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;";
const ANISO_FRAME = /* glsl */ `
	// Orthonormal anisotropy frame (shaderPatches.ts): getTangentFrame() scales T and B by one
	// shared factor, so on a UV-stretched face one of them is ~0 and D_GGX_Anisotropic spikes.
	// Keep the longer axis, rebuild the other as a cross product with the normal (same handedness).
	vec3 anisoT = tbn[ 0 ];
	vec3 anisoB = tbn[ 1 ];
	{
		float lenT2 = dot( anisoT, anisoT ), lenB2 = dot( anisoB, anisoB );
		if ( max( lenT2, lenB2 ) < 1e-12 ) {
			vec3 up = abs( normal.y ) < 0.99 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			anisoT = normalize( cross( up, normal ) );
			anisoB = cross( normal, anisoT );
		} else if ( lenT2 >= lenB2 ) {
			anisoT = normalize( anisoT - normal * dot( normal, anisoT ) );
			vec3 c = cross( normal, anisoT );
			anisoB = dot( c, anisoB ) < 0.0 ? - c : c;
		} else {
			anisoB = normalize( anisoB - normal * dot( normal, anisoB ) );
			vec3 c = cross( anisoB, normal );
			anisoT = dot( c, anisoT ) < 0.0 ? - c : c;
		}
	}
	material.anisotropyT = anisoT * anisotropyV.x + anisoB * anisotropyV.y;
	material.anisotropyB = anisoB * anisotropyV.x - anisoT * anisotropyV.y;`;

function patchAnisotropyFrame(): boolean {
  const chunk = THREE.ShaderChunk.lights_physical_fragment;
  if (!chunk.includes(ANISO_T) || !chunk.includes(ANISO_B)) {
    console.warn("[shaderPatches] anisotropy frame lines not found in lights_physical_fragment; patch skipped");
    return false;
  }
  THREE.ShaderChunk.lights_physical_fragment = chunk.replace(ANISO_T, ANISO_FRAME).replace(ANISO_B, "");
  return true;
}

let installed = false;

/** Patch the chunk once (idempotent). `?anisofix=0` skips it for A/B captures. */
export function installShaderPatches(): { anisotropyFrame: boolean } {
  const result = { anisotropyFrame: false };
  if (installed) return result;
  installed = true;
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
  if (q?.get("anisofix") !== "0") result.anisotropyFrame = patchAnisotropyFrame();
  return result;
}
