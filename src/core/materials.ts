/**
 * Shared material palette. System 1 values are plausible placeholders; System 5
 * owns the real surfaces. Everything is created once and reused so the merged
 * builders can group geometry by material.
 */
import * as THREE from "three";
import * as tex from "../procedural/textures";

export interface Palette {
  wallPaint: THREE.MeshStandardMaterial;
  wallPaintExt: THREE.MeshStandardMaterial;
  ceilingTile: THREE.MeshStandardMaterial;
  tbar: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  baseboard: THREE.MeshStandardMaterial;
  trimPaint: THREE.MeshStandardMaterial;
  /** Booth/stool vinyl: vertex colours carry edge wear, so every geometry in this bucket needs a colour attribute. */
  vinylRed: THREE.MeshPhysicalMaterial;
  vinylRedCrazed: THREE.MeshPhysicalMaterial;
  /** Table laminate (cream boomerang). */
  formica: THREE.MeshPhysicalMaterial;
  /** Counter laminate (grey speckle). */
  formicaCounter: THREE.MeshPhysicalMaterial;
  formicaEdge: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  chromeSoft: THREE.MeshStandardMaterial;
  alumGroove: THREE.MeshStandardMaterial;
  chromeBrushed: THREE.MeshPhysicalMaterial;
  ceramic: THREE.MeshStandardMaterial;
  bisque: THREE.MeshStandardMaterial;
  coffeeStain: THREE.MeshStandardMaterial;
  capWood: THREE.MeshPhysicalMaterial;
  laminatePanel: THREE.MeshStandardMaterial;
  laminateCabinet: THREE.MeshStandardMaterial;
  laminateScuffed: THREE.MeshStandardMaterial;
  edgeBand: THREE.MeshStandardMaterial;
  glassClear: THREE.MeshPhysicalMaterial;
  coffee: THREE.MeshPhysicalMaterial;
  blackPlastic: THREE.MeshStandardMaterial;
  orangeBand: THREE.MeshStandardMaterial;
  pilotRed: THREE.MeshStandardMaterial;
  napkin: THREE.MeshStandardMaterial;
  sugar: THREE.MeshStandardMaterial;
  pepper: THREE.MeshStandardMaterial;
  trayBrown: THREE.MeshStandardMaterial;
  clockFace: THREE.MeshStandardMaterial;
  rubberMat: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  alum: THREE.MeshStandardMaterial;
  alumBright: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  laminateWood: THREE.MeshStandardMaterial;
  kickPanel: THREE.MeshStandardMaterial;
  tileBacking: THREE.MeshStandardMaterial;
  fixtureWhite: THREE.MeshStandardMaterial;
  fixtureLens: THREE.MeshStandardMaterial;
  fanBlade: THREE.MeshStandardMaterial;
  voidBlack: THREE.MeshBasicMaterial;
  kitchenDim: THREE.MeshStandardMaterial;
  darkGlass: THREE.MeshStandardMaterial;
  asphalt: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  acUnit: THREE.MeshStandardMaterial;
  stainless: THREE.MeshPhysicalMaterial;
}

export function createPalette(maxAnisotropy: number): Palette {
  const aniso = Math.min(8, maxAnisotropy);

  const floorTex = tex.checkerFloor(40, 20, 51, aniso);
  const wallTex = tex.paintedWall("#e9e2d2", 1024, 11);
  const extWallTex = tex.paintedWall("#d9cfbd", 1024, 12, 0.08);
  const tileTex = tex.acousticTile(512);
  const asphaltTex = tex.asphalt(1024);
  const concreteTex = tex.concrete(1024);

  const floor = new THREE.MeshStandardMaterial({
    map: floorTex.map,
    roughnessMap: floorTex.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
  });

  // Wall boxes get metric UVs from scaleBoxUv (1 UV unit = 2 m), so repeat stays 1.
  const wallPaint = new THREE.MeshStandardMaterial({ map: wallTex.map, roughness: 0.82, metalness: 0 });
  const wallPaintExt = new THREE.MeshStandardMaterial({ map: extWallTex.map, roughness: 0.92, metalness: 0 });

  const ceilingTile = new THREE.MeshStandardMaterial({
    map: tileTex.map,
    roughnessMap: tileTex.roughnessMap,
    roughness: 1.0,
    metalness: 0,
  });

  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTex.map, roughness: 0.95, metalness: 0 });
  asphaltTex.map.repeat.set(12, 12);
  const concrete = new THREE.MeshStandardMaterial({ map: concreteTex.map, roughness: 0.9, metalness: 0 });
  concreteTex.map.repeat.set(4, 1);

  /* ---- System 2 surfaces (REFERENCE.md §4 + critic rev 2) ---- */
  // Vinyl: canvas covers 0.4 m; upholstery geometry carries metric UVs (1 unit = 1 m).
  // Two variants share colour/gloss; only the head roll and channel crowns craze.
  const vinylColor = new THREE.Color("#AD161E");
  const mkVinyl = (crazed: boolean) => {
    const t = tex.vinylSurface(1024, 0.4, crazed);
    t.normalMap.repeat.set(2.5, 2.5);
    t.roughnessMap.repeat.set(2.5, 2.5);
    return new THREE.MeshPhysicalMaterial({
      color: vinylColor,
      normalMap: t.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: t.roughnessMap,
      roughness: 0.9, // × map (0.35–0.55) → ≈ 0.4
      metalness: 0,
      specularIntensity: 0.5,
      clearcoat: 0.25,
      clearcoatRoughness: 0.2,
      vertexColors: true,
    });
  };
  const vinylRed = mkVinyl(false);
  const vinylRedCrazed = mkVinyl(true);

  // Laminates: ExtrudeGeometry UVs are in metres; one canvas = 0.5 m.
  const boomerang = tex.formicaBoomerang(1024, 0.5, 31);
  boomerang.map.repeat.set(2, 2);
  boomerang.roughnessMap!.repeat.set(2, 2);
  const formica = new THREE.MeshPhysicalMaterial({
    map: boomerang.map,
    roughnessMap: boomerang.roughnessMap,
    roughness: 1, // × map ≈ 0.18
    metalness: 0,
    clearcoat: 0.2,
    clearcoatRoughness: 0.15,
  });
  const speckle = tex.formicaSpeckle(1024, 44);
  speckle.map.repeat.set(2, 2);
  const formicaCounter = new THREE.MeshPhysicalMaterial({
    map: speckle.map,
    roughness: 0.28,
    metalness: 0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.2,
  });

  // Woods: solid cap (varnished, fine pores, grain along u) vs printed laminates.
  // Three different grain sources (domain-warped noise, nothing periodic):
  // quarter-sawn oak caps (fine, straight), walnut-look laminate on panels and the
  // counter die (broad, low contrast, vertical), flat-cut maple laminate on cabinets.
  const capTex = tex.woodVeneer(1024, 0.5, { hex: "#6E4A2E", seed: 501, contrast: 0.2, rough: 0.25, pore: 0.6, vertical: false, along: 3, across: 72, warp: 0.25, figure: 0.1 });
  const panelTex = tex.woodVeneer(1024, 0.5, { hex: "#7A5236", seed: 502, contrast: 0.11, rough: 0.55, pore: 0, vertical: true, along: 2, across: 14, warp: 0.8, figure: 0.6 });
  const cabTex = tex.woodVeneer(1024, 0.5, { hex: "#B98E5E", seed: 503, contrast: 0.07, rough: 0.5, pore: 0, vertical: true, along: 2, across: 20, warp: 0.6, figure: 0.3 });
  for (const t of [capTex, panelTex, cabTex]) for (const m of [t.map, t.roughnessMap, t.normalMap]) m.repeat.set(2, 2);
  const capWood = new THREE.MeshPhysicalMaterial({
    map: capTex.map, roughnessMap: capTex.roughnessMap, normalMap: capTex.normalMap, normalScale: new THREE.Vector2(0.4, 0.4),
    roughness: 1, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.2, vertexColors: true,
  });
  const laminatePanel = new THREE.MeshStandardMaterial({
    map: panelTex.map, roughnessMap: panelTex.roughnessMap, normalMap: panelTex.normalMap, normalScale: new THREE.Vector2(0.25, 0.25),
    roughness: 1, metalness: 0,
  });
  const laminateCabinet = new THREE.MeshStandardMaterial({
    map: cabTex.map, roughnessMap: cabTex.roughnessMap, normalMap: cabTex.normalMap, normalScale: new THREE.Vector2(0.25, 0.25),
    roughness: 1, metalness: 0,
  });
  const laminateScuffed = new THREE.MeshStandardMaterial({ color: 0x6a4630, roughness: 0.75, metalness: 0 });
  const edgeBand = new THREE.MeshStandardMaterial({ color: 0x94623f, roughness: 0.4, metalness: 0 });

  // Metals: the environment is a PMREM of the real interior (Diner.ts); colours from §4.
  const chrome = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.62, 0.65, 0.68, THREE.LinearSRGBColorSpace), roughness: 0.07, metalness: 1 });
  // Small chrome fittings (caps, lids, bezels): a touch rougher so the room's red band blurs to a warm grey.
  const chromeSoft = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.58, 0.63, 0.7, THREE.LinearSRGBColorSpace), roughness: 0.22, metalness: 1 });
  const chromeBrushed = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.52, 0.58, 0.66, THREE.LinearSRGBColorSpace), // cool tint offsets the warm room reflection
    roughnessMap: tex.brushedRoughness(512, 0.32, 91),
    roughness: 1,
    metalness: 1,
    anisotropy: 0.8,
  });
  const alumGroove = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.22, 0.23, 0.24, THREE.LinearSRGBColorSpace), roughness: 0.5, metalness: 1 });
  const stainless = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.5, 0.52, 0.53, THREE.LinearSRGBColorSpace),
    roughnessMap: tex.brushedRoughness(512, 0.34, 92),
    roughness: 1,
    metalness: 1,
    anisotropy: 0.6,
  });

  const ceramic = new THREE.MeshStandardMaterial({ color: 0xf2eee6, roughness: 0.14, metalness: 0 });
  const bisque = new THREE.MeshStandardMaterial({ color: 0xe1d7c8, roughness: 0.75, metalness: 0 });
  const glassClear = new THREE.MeshPhysicalMaterial({
    color: 0xf6f8f7,
    roughness: 0.05,
    metalness: 0,
    transmission: 0.95,
    ior: 1.5,
    thickness: 0.003,
    specularIntensity: 1,
  });
  // Coffee is OPAQUE on purpose: three renders transmissive objects in their own
  // pass, so a transmissive liquid inside a transmissive decanter is invisible.
  const coffee = new THREE.MeshPhysicalMaterial({
    color: 0x2a1408,
    roughness: 0.08,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.06,
  });
  const coffeeStain = new THREE.MeshStandardMaterial({ color: 0x4a2a12, roughness: 0.6, metalness: 0, transparent: true, opacity: 0.55 });
  const lens = tex.prismLens(256, 8);
  // 8 cells per canvas × 25 repeats over the 1.2 m lens = 6 mm prisms (real K12 lens pitch)
  lens.normalMap.repeat.set(25, 12);
  lens.map.repeat.set(25, 12);

  const palette: Palette = {
    wallPaint,
    wallPaintExt,
    ceilingTile,
    tbar: new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.55, metalness: 0.2 }),
    floor,
    baseboard: new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.55, metalness: 0 }),
    trimPaint: new THREE.MeshStandardMaterial({ color: 0xf1ede2, roughness: 0.5, metalness: 0 }),
    vinylRed,
    vinylRedCrazed,
    formica,
    formicaCounter,
    capWood,
    laminatePanel,
    laminateCabinet,
    laminateScuffed,
    edgeBand,
    // Bright grooved aluminium T-mould
    formicaEdge: new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.66, 0.68, 0.7, THREE.LinearSRGBColorSpace), roughness: 0.2, metalness: 1 }),
    alumGroove,
    chrome,
    chromeSoft,
    chromeBrushed,
    ceramic,
    bisque,
    coffeeStain,
    glassClear,
    coffee,
    blackPlastic: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.45, metalness: 0 }),
    orangeBand: new THREE.MeshStandardMaterial({ color: 0xb85a1e, roughness: 0.5, metalness: 0 }),
    pilotRed: new THREE.MeshStandardMaterial({ color: 0xff2a1a, roughness: 0.4, metalness: 0, emissive: 0xff2010, emissiveIntensity: 3 }),
    napkin: new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.95, metalness: 0 }),
    sugar: new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9, metalness: 0 }),
    pepper: new THREE.MeshStandardMaterial({ color: 0x3a3430, roughness: 0.9, metalness: 0 }),
    trayBrown: new THREE.MeshStandardMaterial({ color: 0x4a2c1a, roughness: 0.55, metalness: 0 }),
    clockFace: new THREE.MeshStandardMaterial({ color: 0xf6f3ea, roughness: 0.5, metalness: 0 }),
    rubberMat: new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.9, metalness: 0 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x3a3836, roughness: 0.5, metalness: 0.6 }),
    alum: new THREE.MeshStandardMaterial({ color: 0x4f4841, roughness: 0.45, metalness: 0.55 }),
    alumBright: new THREE.MeshStandardMaterial({ color: 0xb4b8bc, roughness: 0.38, metalness: 0.7 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xdfe8ea,
      roughness: 0.02,
      metalness: 0,
      transparent: true,
      opacity: 0.14,
      envMapIntensity: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    laminateWood: new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.5, metalness: 0 }),
    kickPanel: new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.6, metalness: 0.3 }),
    tileBacking: new THREE.MeshStandardMaterial({ color: 0x5a5650, roughness: 1, metalness: 0 }),
    fixtureWhite: new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.4, metalness: 0.1 }),
    fixtureLens: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.35,
      metalness: 0,
      emissive: 0xfff3dc,
      emissiveIntensity: 1.4, // low enough that the prism cells survive tone mapping
      map: lens.map,
      emissiveMap: lens.map,
      normalMap: lens.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
    }),
    fanBlade: new THREE.MeshStandardMaterial({ map: capTex.map, roughnessMap: capTex.roughnessMap, normalMap: capTex.normalMap, color: 0x8a7060, roughness: 1, metalness: 0 }),
    voidBlack: new THREE.MeshBasicMaterial({ color: 0x040404 }),
    // Nothing lights the kitchen box, so a little emissive stands in for its own ambient: dark, not black.
    kitchenDim: new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 0.95, metalness: 0, emissive: 0x3a3632, emissiveIntensity: 0.55 }),
    darkGlass: new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.15, metalness: 0.4 }),
    asphalt,
    concrete,
    acUnit: new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.6, metalness: 0.2 }),
    stainless,
  };

  // The procedural environment is bright enough for metals to read as metal.
  // Dielectrics only take a whisper of it so the sun/fill balance from System 1
  // stays intact (System 4 owns the real light rig).
  for (const m of Object.values(palette)) {
    if (m instanceof THREE.MeshStandardMaterial) m.envMapIntensity = m.metalness >= 0.5 ? 1 : 0.1;
  }
  // Glossy dielectrics still want visible reflections in their specular lobe.
  // Glassware: reflections kept modest so the contents read; the coffee body is
  // near-black and would otherwise turn the glass into a mirror of the probe.
  palette.glassClear.envMapIntensity = 0.45;
  palette.coffee.envMapIntensity = 0.25;
  palette.glass.envMapIntensity = 0.5;
  palette.alum.envMapIntensity = 0.3;
  palette.ceramic.envMapIntensity = 0.35;
  palette.formica.envMapIntensity = 0.3;
  palette.formicaCounter.envMapIntensity = 0.3;
  palette.vinylRed.envMapIntensity = 0.35;
  palette.vinylRedCrazed.envMapIntensity = 0.35;
  palette.capWood.envMapIntensity = 0.3;
  // Laminates are semi-matt: cut the room reflection so grazing views don't turn the die into a mirror.
  palette.laminatePanel.envMapIntensity = 0.3;
  palette.laminateCabinet.envMapIntensity = 0.3;
  palette.ceramic.envMapIntensity = 0.2; // ivory china: gloss from the lights, only a hint of room reflection
  return palette;
}
