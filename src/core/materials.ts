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
  vinylRed: THREE.MeshStandardMaterial;
  formica: THREE.MeshStandardMaterial;
  formicaEdge: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  alum: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  laminateWood: THREE.MeshStandardMaterial;
  kickPanel: THREE.MeshStandardMaterial;
  fixtureWhite: THREE.MeshStandardMaterial;
  fixtureLens: THREE.MeshStandardMaterial;
  fanBlade: THREE.MeshStandardMaterial;
  voidBlack: THREE.MeshBasicMaterial;
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

  return {
    wallPaint,
    wallPaintExt,
    ceilingTile,
    tbar: new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.55, metalness: 0.2 }),
    floor,
    baseboard: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6, metalness: 0 }),
    trimPaint: new THREE.MeshStandardMaterial({ color: 0xf1ede2, roughness: 0.5, metalness: 0 }),
    vinylRed: new THREE.MeshStandardMaterial({ color: 0x8a1a1a, roughness: 0.45, metalness: 0 }),
    formica: new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.35, metalness: 0 }),
    formicaEdge: new THREE.MeshStandardMaterial({ color: 0xc9c9c9, roughness: 0.25, metalness: 0.9 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, metalness: 1.0 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.5, metalness: 0.8 }),
    alum: new THREE.MeshStandardMaterial({ color: 0x9a9da0, roughness: 0.4, metalness: 0.9 }),
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
    asphalt,
    concrete,
    acUnit: new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.6, metalness: 0.2 }),
    stainless: new THREE.MeshStandardMaterial({ color: 0xb8bcbe, roughness: 0.35, metalness: 0.95 }),
  };
}
