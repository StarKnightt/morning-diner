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
  /** Table laminate (cream boomerang). */
  formica: THREE.MeshPhysicalMaterial;
  /** Counter laminate (grey speckle). */
  formicaCounter: THREE.MeshPhysicalMaterial;
  formicaEdge: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  chromeBrushed: THREE.MeshStandardMaterial;
  ceramic: THREE.MeshStandardMaterial;
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
  stainless: THREE.MeshStandardMaterial;
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

  /* ---- System 2 first-pass surfaces (REFERENCE.md §4) ---- */
  // Vinyl: canvas covers 0.4 m; upholstery geometry carries metric UVs (1 unit = 1 m).
  const vinylTex = tex.vinylCrazing(1024, 0.4);
  for (const t of [vinylTex.map, vinylTex.normalMap, vinylTex.roughnessMap]) t.repeat.set(2.5, 2.5);
  const vinylRed = new THREE.MeshPhysicalMaterial({
    // sRGB (150, 25, 32), divided by the 0.8-grey (0.6 linear) carried in the map
    color: new THREE.Color().setRGB(150 / 255, 25 / 255, 32 / 255, THREE.SRGBColorSpace).multiplyScalar(1 / 0.6),
    map: vinylTex.map,
    normalMap: vinylTex.normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughnessMap: vinylTex.roughnessMap,
    roughness: 1,
    metalness: 0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.35,
    vertexColors: true,
  });

  // Laminates: ExtrudeGeometry UVs are in metres; one canvas = 0.5 m.
  const boomerang = tex.formicaBoomerang(1024, 0.5, "rgb(235,225,205)", ["rgb(246,240,226)", "rgb(214,200,172)", "rgb(226,214,190)"], 0.13, 31);
  boomerang.map.repeat.set(2, 2);
  boomerang.roughnessMap!.repeat.set(2, 2);
  const formica = new THREE.MeshPhysicalMaterial({
    map: boomerang.map,
    roughnessMap: boomerang.roughnessMap,
    roughness: 1,
    metalness: 0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.3,
  });
  const speckle = tex.formicaSpeckle(1024, 44);
  speckle.map.repeat.set(2, 2);
  const formicaCounter = new THREE.MeshPhysicalMaterial({
    map: speckle.map,
    roughness: 0.32,
    metalness: 0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.25,
  });

  // Metals need the procedural PMREM (Diner.ts) to read; colours from §4.
  const chrome = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.6, 0.63, 0.66, THREE.LinearSRGBColorSpace), roughness: 0.18, metalness: 1 });
  const chromeBrushed = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(0.56, 0.58, 0.6, THREE.LinearSRGBColorSpace),
    roughnessMap: tex.brushedRoughness(512, 0.3, 91),
    roughness: 1,
    metalness: 1,
  });
  const stainless = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(0.5, 0.52, 0.53, THREE.LinearSRGBColorSpace),
    roughnessMap: tex.brushedRoughness(512, 0.34, 92),
    roughness: 1,
    metalness: 1,
  });

  const ceramic = new THREE.MeshStandardMaterial({ map: tex.glazeSpeckle(256).map, roughness: 0.16, metalness: 0 });
  const glassClear = new THREE.MeshPhysicalMaterial({
    color: 0xf4f7f6,
    roughness: 0.05,
    metalness: 0,
    transmission: 0.95,
    ior: 1.47,
    thickness: 0.004,
    specularIntensity: 1,
  });
  const coffee = new THREE.MeshPhysicalMaterial({
    color: 0x2a1408,
    roughness: 0.03,
    metalness: 0,
    transmission: 0.35,
    ior: 1.33,
    thickness: 0.06,
    attenuationColor: new THREE.Color(110 / 255, 45 / 255, 12 / 255),
    attenuationDistance: 0.01,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
  });

  const palette: Palette = {
    wallPaint,
    wallPaintExt,
    ceilingTile,
    tbar: new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.55, metalness: 0.2 }),
    floor,
    baseboard: new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.55, metalness: 0 }),
    trimPaint: new THREE.MeshStandardMaterial({ color: 0xf1ede2, roughness: 0.5, metalness: 0 }),
    vinylRed,
    formica,
    formicaCounter,
    // Ribbed aluminium T-mould: slightly duller than chrome
    formicaEdge: new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.55, 0.56, 0.57, THREE.LinearSRGBColorSpace), roughness: 0.28, metalness: 1 }),
    chrome,
    chromeBrushed,
    ceramic,
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
      roughness: 0.6,
      metalness: 0,
      emissive: 0xfff3dc,
      emissiveIntensity: 2.2,
    }),
    fanBlade: new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.55, metalness: 0 }),
    voidBlack: new THREE.MeshBasicMaterial({ color: 0x040404 }),
    kitchenDim: new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 0.95, metalness: 0 }),
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
  palette.glassClear.envMapIntensity = 0.7;
  palette.coffee.envMapIntensity = 0.7;
  palette.glass.envMapIntensity = 0.5;
  palette.alum.envMapIntensity = 0.3;
  palette.ceramic.envMapIntensity = 0.35;
  palette.formica.envMapIntensity = 0.3;
  palette.formicaCounter.envMapIntensity = 0.3;
  palette.vinylRed.envMapIntensity = 0.3;
  return palette;
}
