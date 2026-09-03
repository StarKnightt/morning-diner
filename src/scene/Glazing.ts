/**
 * System 4 rev 6 — storefront glazing without three's transmission pass.
 *
 * Ported from dawn-station `src/gen/buildingGlazing.ts` (`applyGlazingFresnel`) and the
 * two-leaf pane of its BuildingSystem: a pane is two coincident meshes —
 *
 *   1. the TRANSMISSION leaf: alpha-blended, black body, alpha coupled to Fresnel so the frame
 *      buffer behind it is multiplied by exactly (1 − F)(1 − a0), F the air/glass Fresnel at the
 *      view angle and a0 the 12 % body loss of 6 mm float; it also writes depth (the post
 *      pipeline's haze march reads the pane plane from the depth buffer);
 *   2. the REFLECTION leaf: additive, black dielectric with the pane's dust / smudge roughness
 *      map, ior 1.52 — three's own Fresnel'd specular of the probe it is given. One per face:
 *      the room-facing face reflects the metals' room probe, the lot-facing face the lot probe.
 *
 * Why (rev 4 critics, survey #5): three's `transmission` renders what is behind the pane into a
 * separate buffer — at half resolution (the blinds "melted" from the lot, fix-glass), with
 * `color` and Fresnel applied twice on a DoubleSide pane (materials.ts note, measured 0.69 for
 * 0.88), tone-mapped as a texture so the exterior seen from a correctly exposed interior sat
 * 1.5–2.5 EV darker than the same sky seen through the open door. Alpha blending shows the lot
 * at its full HDR value × one physical factor, at full resolution, for the price of a blend.
 * No sibling project uses `transmission` for architectural glass; it stays on the carafe, sugar
 * and mug glass here, where refraction matters and the buffer is the room.
 *
 * Lost: refraction (none visible through a flat pane) and the dust map's blur of the view
 * (kept as roughness on the reflection leaf, where a dusty pane's haze actually lives).
 */
import * as THREE from "three";

/**
 * Couple a pane's alpha to Fresnel (dawn-station `applyGlazingFresnel`, verbatim model).
 * Under alpha blending the frame gets `out = bg · (1 − a) + tint · a`; the physics wants the
 * background coefficient to be `(1 − F)(1 − a0)`, so `a = 1 − (1 − F)(1 − a0)`, and the body tint
 * is rescaled to keep `tint · a = tint0 · (1 − F) · a0` so a grazing pane does not show its own
 * body at full weight. F0 is taken from the material's `ior` so it cannot drift from the
 * reflection leaf's BRDF. Injected at `normal_fragment_maps` — the first point with a shading
 * normal, before `opaque_fragment` consumes the alpha, and scene-referred.
 */
export function applyGlazingFresnel(material: THREE.MeshPhysicalMaterial, key: string): THREE.MeshPhysicalMaterial {
  const n = material.ior ?? 1.5;
  const f0 = ((n - 1) / (n + 1)) ** 2;
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    prior.call(this, shader, renderer);
    shader.uniforms.uBgF0 = { value: f0 };
    const needle = "#include <normal_fragment_maps>";
    if (!shader.fragmentShader.includes(needle)) throw new Error(`applyGlazingFresnel(${key}): shader has no '${needle}' to inject into`);
    shader.fragmentShader = `uniform float uBgF0;\n` + shader.fragmentShader.replace(needle, `${needle}
      {
        float bgCos = clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 );
        float bgF = uBgF0 + ( 1.0 - uBgF0 ) * pow( 1.0 - bgCos, 5.0 );
        float bgA0 = diffuseColor.a;
        float bgA = 1.0 - ( 1.0 - bgF ) * ( 1.0 - bgA0 );
        diffuseColor.rgb *= ( 1.0 - bgF ) * bgA0 / max( bgA, 1e-4 );
        diffuseColor.a = bgA;
      }`);
  };
  material.customProgramCacheKey = () => `bgfres:${key}`;
  material.needsUpdate = true;
  return material;
}

export interface PaneMaterials {
  /** Transmission leaf (the palette's `glass` / `glassDoor`). */
  pane: THREE.MeshPhysicalMaterial;
  /** Reflection leaves: room-facing (BackSide of the +z pane) and lot-facing (FrontSide). */
  reflectIn: THREE.MeshPhysicalMaterial;
  reflectOut: THREE.MeshPhysicalMaterial;
}

/**
 * The three materials of one glazing type. `roughnessMap` is the pane's dust / smudge map
 * (0.008–0.045 clear → hazed); `bodyLoss` the fraction of light the 6 mm sheet absorbs (0.12).
 */
export function makePaneMaterials(key: string, roughnessMap: THREE.Texture, bodyLoss = 0.12): PaneMaterials {
  const pane = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    roughness: 1,
    metalness: 0,
    specularIntensity: 0,
    envMapIntensity: 0,
    ior: 1.52,
    transparent: true,
    opacity: bodyLoss,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  pane.name = key;
  applyGlazingFresnel(pane, key);
  const reflect = (side: THREE.Side, suffix: string) => {
    const m = new THREE.MeshPhysicalMaterial({
      color: 0x000000,
      roughness: 1,
      roughnessMap,
      metalness: 0,
      specularIntensity: 1,
      ior: 1.52,
      envMapIntensity: 1,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side,
    });
    m.name = `${key}-${suffix}`;
    return m;
  };
  // PlaneGeometry panes face +z (the lot): FrontSide is the lot-facing face.
  return { pane, reflectIn: reflect(THREE.BackSide, "reflect-in"), reflectOut: reflect(THREE.FrontSide, "reflect-out") };
}

/**
 * The three coincident meshes of a pane. The transmission leaf draws first (renderOrder 10,
 * writes depth), the additive reflections over it (10.5, LessEqual depth passes on the same
 * surface); decals on the glass keep their 11–12.
 */
export function buildGlazing(geometry: THREE.BufferGeometry, mats: PaneMaterials, name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const pane = new THREE.Mesh(geometry, mats.pane);
  pane.renderOrder = 10;
  pane.name = name;
  const rin = new THREE.Mesh(geometry, mats.reflectIn);
  rin.renderOrder = 10.5;
  rin.name = `${name}-reflect-in`;
  const rout = new THREE.Mesh(geometry, mats.reflectOut);
  rout.renderOrder = 10.5;
  rout.name = `${name}-reflect-out`;
  for (const m of [pane, rin, rout]) { m.castShadow = false; m.receiveShadow = false; }
  g.add(pane, rin, rout);
  return g;
}
