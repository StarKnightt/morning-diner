/**
 * Shared material palette. System 1 values are plausible placeholders; System 5
 * owns the real surfaces. Everything is created once and reused so the merged
 * builders can group geometry by material.
 */
import * as THREE from "three";
import * as texModule from "../procedural/textures";
import * as extModule from "../procedural/exterior";
import { WINDOW } from "../scene/layout";
import { VINYL_CRAZE_METRES, boothVinylCrazeLayout } from "./upholstery";
import { FLUORESCENT, TROFFER_LENS_NITS, luminance, nits } from "../scene/Lighting";
import type { TextureBank } from "./textureBank";

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
  chromeWorn: THREE.MeshStandardMaterial;
  chromeWorn2: THREE.MeshStandardMaterial;
  chromeSoft: THREE.MeshStandardMaterial;
  plinthLine: THREE.MeshStandardMaterial;
  alumGroove: THREE.MeshStandardMaterial;
  chromeBrushed: THREE.MeshPhysicalMaterial;
  ceramic: THREE.MeshPhysicalMaterial;
  bisque: THREE.MeshStandardMaterial;
  coffeeStain: THREE.MeshStandardMaterial;
  capWood: THREE.MeshPhysicalMaterial;
  laminatePanel: THREE.MeshStandardMaterial;
  laminateCabinet: THREE.MeshStandardMaterial;
  laminateScuffed: THREE.MeshStandardMaterial;
  edgeBand: THREE.MeshStandardMaterial;
  glassClear: THREE.MeshPhysicalMaterial;
  glassFluted: THREE.MeshPhysicalMaterial;
  coffee: THREE.MeshPhysicalMaterial;
  blackPlastic: THREE.MeshStandardMaterial;
  orangeBand: THREE.MeshStandardMaterial;
  pilotRed: THREE.MeshStandardMaterial;
  napkin: THREE.MeshStandardMaterial;
  sugar: THREE.MeshStandardMaterial;
  salt: THREE.MeshStandardMaterial;
  napkinFold: THREE.MeshStandardMaterial;
  darkSeal: THREE.MeshStandardMaterial;
  rockerLit: THREE.MeshStandardMaterial;
  pepper: THREE.MeshStandardMaterial;
  trayBrown: THREE.MeshStandardMaterial;
  clockFace: THREE.MeshStandardMaterial;
  rubberMat: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  alum: THREE.MeshStandardMaterial;
  alumBright: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  glassDoor: THREE.MeshPhysicalMaterial;
  glassSmudge: THREE.MeshBasicMaterial;
  slat: THREE.MeshStandardMaterial;
  slatRail: THREE.MeshStandardMaterial;
  slatCap: THREE.MeshStandardMaterial;
  cord: THREE.MeshStandardMaterial;
  wand: THREE.MeshStandardMaterial;
  tassel: THREE.MeshStandardMaterial;
  laminateWood: THREE.MeshStandardMaterial;
  kickPanel: THREE.MeshStandardMaterial;
  tileBacking: THREE.MeshStandardMaterial;
  fixtureWhite: THREE.MeshStandardMaterial;
  fixtureLens: THREE.MeshStandardMaterial;
  fanBlade: THREE.MeshStandardMaterial;
  voidBlack: THREE.MeshBasicMaterial;
  kitchenDim: THREE.MeshStandardMaterial;
  /** Red-coated R40 heat-lamp bulb face over the pass-through shelf (System 4 rev 2). */
  heatLampBulb: THREE.MeshStandardMaterial;
  darkGlass: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  acUnit: THREE.MeshStandardMaterial;
  stainless: THREE.MeshPhysicalMaterial;
  /** Smooth directional brushed stainless for appliances/dispensers (no mottle). */
  stainlessBrushed: THREE.MeshPhysicalMaterial;
  stainlessCool: THREE.MeshPhysicalMaterial;
  /** Matte black powder coat (brewer body). */
  blackPowder: THREE.MeshStandardMaterial;

  /* ---- System 5 (materials branch): wear variants and dressing ---- */
  /** Window-wall interior paint: same latex, canvas keyed to the 1.8 m window pitch so the sun-fade halo sits beside every jamb. */
  wallPaintWindow: THREE.MeshStandardMaterial;
  /** Two water-stained tiles (own mesh, +1 draw). */
  ceilingTileStained: THREE.MeshStandardMaterial;
  /** Grid tee with paint chips; replaces `tbar` on the tees (derived from it). */
  tbarPainted: THREE.MeshStandardMaterial;
  /** Counter laminate with wipe scratches and cup rings (derived from `formicaCounter`). */
  formicaCounterWorn: THREE.MeshPhysicalMaterial;
  /** T-mould with brushing streaks (derived from `formicaEdge`). */
  formicaEdgeBrushed: THREE.MeshStandardMaterial;
  /** Footring / footrail chrome scuffed by shoes (derived from `chrome`). */
  chromeScuffed: THREE.MeshStandardMaterial;
  /** Push bar / pull handle chrome with a hand-worn grip zone (derived from `chrome`). */
  chromeBar: THREE.MeshStandardMaterial;
  /** Crazed back vinyl with cracking beside the welts — one booth's back panels (u = distance from the welt). */
  vinylRedWeltCracked: THREE.MeshPhysicalMaterial;
  /** Brushed stainless with fingerprints (derived from `stainlessBrushed`). */
  stainlessTouched: THREE.MeshPhysicalMaterial;
  /** Decanter glass with scratches and dishwasher etch (derived from `glassClear`). */
  glassCarafe: THREE.MeshPhysicalMaterial;
  /** Cove base with mop marks and heel scuffs (derived from `baseboard`; metric UVs). */
  baseboardWorn: THREE.MeshStandardMaterial;
  /** Door kick plate: satin (0.45) brushed stainless, lighter than the brewer trim (derived from `stainlessCool`). */
  kickPlate: THREE.MeshPhysicalMaterial;
  /** Cast pedestal bells: dark metal with a grey dust film and kick marks over the bottom 30 mm (derived from `darkMetal`). */
  castBaseDusty: THREE.MeshStandardMaterial;
  /** Door/window dressing atlas: OPEN sign, hours, PUSH, card sticker, film edge. */
  decal: THREE.MeshStandardMaterial;
}

/** Palette fields that are derived from tuned base materials after the env-intensity pass. */
type DerivedKey = "tbarPainted" | "formicaCounterWorn" | "formicaEdgeBrushed" | "chromeScuffed" | "chromeBar" | "stainlessTouched" | "glassCarafe" | "baseboardWorn" | "vinylRedWeltCracked" | "kickPlate" | "castBaseDusty";

export function createPalette(maxAnisotropy: number, bank?: TextureBank): Palette {
  const aniso = Math.min(8, maxAnisotropy);
  // With a TextureBank the generators run in workers and return placeholders that
  // fill in later (see core/textureBank.ts); without one they run synchronously.
  const tex = bank ? bank.proxy(texModule, "tex") : texModule;
  const ext = bank ? bank.proxy(extModule, "ext") : extModule;

  // System 5: the floor canvas is the whole room (40 × 20 tiles ≥ 38.7 × 19.5), so wear is
  // authored in world metres (textures.ts dinerFloorWear); grout relief is a 2 × 2-tile
  // detail normal whose repeat Shell.ts sets alongside the map's.
  const floorTex = tex.checkerFloor(40, 20, 80, aniso, texModule.dinerFloorWear());
  // Walls: canvas = 2.4 m (two 1.2 m drywall joints per tile; horizontal joint at 1.2 m),
  // world-anchored UVs (merge.ts worldBoxUv) so seams and the 0.95–1.12 m scuff band run
  // through every pier and spandrel. Stipple relief is a 0.6 m detail normal (repeat 4).
  const WALL_M = 2.4;
  const wallTex = tex.paintedWall("#e9e2d2", 2048, 11, 0.06, { metres: WALL_M, seamsU: [0, 0.5], seamsV: [0.5], scuff: { v0: 0.95 / WALL_M, v1: 1.12 / WALL_M, perMetre: 3 } });
  // Window wall: canvas = the 1.8 m window pitch, u 0.5 on every window centre (Shell.ts
  // offsets the UVs), so the sun-fade halo lands beside each jamb (u 0.125 / 0.875).
  const WIN_M = WINDOW.centersX[1] - WINDOW.centersX[0]; // 1.8
  const winWallTex = tex.paintedWall("#e9e2d2", 2048, 13, 0.06, {
    metres: WIN_M,
    seamsV: [1.2 / WIN_M],
    scuff: { v0: 0.95 / WIN_M, v1: 1.12 / WIN_M, perMetre: 2 },
    fade: { jambsU: [0.5 - WINDOW.width / 2 / WIN_M, 0.5 + WINDOW.width / 2 / WIN_M], reach: 0.22 / WIN_M, v0: WINDOW.sill / WIN_M, v1: WINDOW.head / WIN_M, amount: 0.028 },
  });
  const extWallTex = tex.paintedWall("#d9cfbd", 1024, 12, 0.08);
  const stipple = tex.wallStipple(1024, 14);
  stipple.normalMap.repeat.set(WALL_M / texModule.WALL_STIPPLE_M, WALL_M / texModule.WALL_STIPPLE_M);
  stipple.aoMap.repeat.copy(stipple.normalMap.repeat);
  const stippleWin = tex.wallStipple(1024, 15);
  stippleWin.normalMap.repeat.set(WIN_M / texModule.WALL_STIPPLE_M, WIN_M / texModule.WALL_STIPPLE_M);
  stippleWin.aoMap.repeat.copy(stippleWin.normalMap.repeat);
  const tileTex = tex.acousticTile(1024);
  const tileStainTex = tex.acousticTile(1024, 556, true);
  const concreteTex = tex.concrete(1024);

  const floor = new THREE.MeshStandardMaterial({
    map: floorTex.map,
    roughnessMap: floorTex.roughnessMap,
    normalMap: floorTex.normalMap,
    normalScale: new THREE.Vector2(1, 1),
    roughness: 1.0,
    metalness: 0.0,
  });

  // Wall boxes get world-anchored metric UVs (1 UV unit = WALL_M / WIN_M), so repeat stays 1.
  const wallPaint = new THREE.MeshStandardMaterial({ map: wallTex.map, roughnessMap: wallTex.roughnessMap, normalMap: stipple.normalMap, aoMap: stipple.aoMap, aoMapIntensity: 1, normalScale: new THREE.Vector2(1.3, 1.3), roughness: 0.82, metalness: 0 });
  const wallPaintWindow = new THREE.MeshStandardMaterial({ map: winWallTex.map, roughnessMap: winWallTex.roughnessMap, normalMap: stippleWin.normalMap, aoMap: stippleWin.aoMap, aoMapIntensity: 1, normalScale: new THREE.Vector2(1.3, 1.3), roughness: 0.82, metalness: 0 });
  const wallPaintExt = new THREE.MeshStandardMaterial({ map: extWallTex.map, roughness: 0.92, metalness: 0 });

  const ceilingTile = new THREE.MeshStandardMaterial({
    map: tileTex.map,
    roughnessMap: tileTex.roughnessMap,
    normalMap: tileTex.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 1.0,
    metalness: 0,
  });
  const ceilingTileStained = new THREE.MeshStandardMaterial({
    map: tileStainTex.map,
    roughnessMap: tileStainTex.roughnessMap,
    normalMap: tileStainTex.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 1.0,
    metalness: 0,
  });

  const concrete = new THREE.MeshStandardMaterial({ map: concreteTex.map, roughness: 0.9, metalness: 0 });
  concreteTex.map.repeat.set(4, 1);

  /* ---- System 2 surfaces (REFERENCE.md §4 + critic rev 2) ---- */
  // Vinyl: canvas covers 0.4 m; upholstery geometry carries metric UVs (1 unit = 1 m).
  // Two variants share colour/gloss; only the head roll and channel crowns craze.
  // #A8141C (System 2) had B > G — a crimson that the bluish window fill pushed to magenta,
  // and AgX then rendered its sunlit stripes pink. Warmed to a cherry red (G ≥ B) so the
  // sunlit crowns roll off toward orange-white and the shade stays a deep red (System 4).
  // Vinyl red #AA1A15 (reads ≈ #AF1C17 after the crown vertex tint) — baked into the map below.
  // System 5: authored at the displayed scale — repeat 4 on metric UVs shows one canvas per
  // 0.25 m, so `metres` is 0.25 and the 0.55 mm pebble grain is true size. One grain set
  // serves both materials (rev 3: the crazing is no longer in the tiling maps).
  const vinylGrain = tex.vinylSurface(1024, 0.25);
  const mkVinyl = (map: THREE.Texture) => {
    const t = vinylGrain;
    t.normalMap.repeat.set(4, 4);
    t.roughnessMap.repeat.set(4, 4);
    t.map.repeat.set(4, 4);
    return new THREE.MeshPhysicalMaterial({
      // Rev 2: the red moved into the map.
      color: 0xffffff,
      map,
      normalMap: t.normalMap,
      // 0.8 (was 1.25): at 1.25 the 0.1 mm/texel grain under a 0.3-rough clearcoat sparkled —
      // pixel-scale highlights that changed with every camera step read as flicker (rev 7).
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: t.roughnessMap,
      roughness: 0.9, // × map (0.35–0.55) → ≈ 0.32–0.5
      metalness: 0,
      specularIntensity: 0.4,
      clearcoat: 0.1,
      clearcoatRoughness: 0.45,
      vertexColors: true,
    });
  };
  const vinylRed = mkVinyl(vinylGrain.map);
  // Rev 3: the crazed booth samples a non-repeating 2048² atlas (0.68 mm/texel over 1.4 m)
  // on UV channel 1 — dark hairline fractures grown from the flex lines, flaked scrim
  // islands, the stitch lines — while the 0.5 mm grain keeps tiling on channel 0.
  // Booths.ts lays the head roll, both channel panels and the welt cords out in it.
  const crazeMap = tex.vinylCrazeAtlas(2048, VINYL_CRAZE_METRES, boothVinylCrazeLayout()).map;
  crazeMap.channel = 1;
  crazeMap.repeat.set(1 / VINYL_CRAZE_METRES, 1 / VINYL_CRAZE_METRES);
  const vinylRedCrazed = mkVinyl(crazeMap);

  // Laminates: ExtrudeGeometry UVs are in metres; one canvas = 0.5 m.
  // One 2048 canvas covers 1.2 m: a whole table top without a visible repeat.
  const boomerang = tex.formicaBoomerang(2048, 1.2, 31);
  boomerang.map.repeat.set(1 / 1.2, 1 / 1.2);
  boomerang.roughnessMap!.repeat.set(1 / 1.2, 1 / 1.2);
  // System 5 rev 2: the table's use (wipe haze, cup rings, scratches) lives in the boomerang
  // canvas itself — albedo AND roughness from one generator, so the marks coincide (rev 1 had
  // them in a separate roughness-only map at a different period: invisible under this light,
  // and misaligned with anything that could have shown). Booths.ts offsets each table's UVs.
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
  // Authored in mm on a 0.5 m canvas (repeat 2 on metric UVs): grain lines every
  // 1.5–2.5 mm, latewood bands every 9–13 mm, a few mm of drift, one cathedral arch
  // per canvas, luminance contrast ≤ 9 %. Every metric panel gets its own UV offset
  // and a coin-flip 180° turn in MergedBuilder so no two panels share a feature.
  const capTex = tex.woodVeneer(1024, 0.5, { hex: "#6E4A2E", seed: 501, contrast: 0.09, rough: 0.3, pore: 0.4, vertical: false, pitch: 1.5, ring: 9, warp: 2, figure: 12, dings: 7 });
  const panelTex = tex.woodVeneer(1024, 0.5, { hex: "#7A5236", seed: 502, contrast: 0.09, rough: 0.5, pore: 0, vertical: true, pitch: 2, ring: 11, warp: 4, figure: 22 });
  const cabTex = tex.woodVeneer(1024, 0.5, { hex: "#B98E5E", seed: 503, contrast: 0.06, rough: 0.5, pore: 0, vertical: true, pitch: 2.5, ring: 13, warp: 3, figure: 18 });
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
  // Overlay materials: these sit 0.2–1 mm proud of a parent face (scuff bands, plinth lines,
  // door edge bands, T-mould grooves, sheet seams). polygonOffset pulls them a depth unit
  // toward the camera so they cannot z-fight the face under them at grazing angles.
  // They also never cast shadows (userData.noCast, read by MergedBuilder.build): an overlay
  // lies on a face that already casts, so its own depth draw would only cost draw calls.
  const overlay = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, userData: { noCast: true } };
  const laminateScuffed = new THREE.MeshStandardMaterial({ color: 0x6a4630, roughness: 0.75, metalness: 0, ...overlay });
  const edgeBand = new THREE.MeshStandardMaterial({ color: 0x94623f, roughness: 0.4, metalness: 0, ...overlay });
  const plinthLine = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.6, metalness: 0, ...overlay });

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
  const alumGroove = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.22, 0.23, 0.24, THREE.LinearSRGBColorSpace), roughness: 0.5, metalness: 1, ...overlay });
  // Stool chrome comes in three wear grades so no two neighbours mirror the room identically.
  const chromeWorn = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.6, 0.63, 0.66, THREE.LinearSRGBColorSpace), roughness: 0.12, metalness: 1 });
  const chromeWorn2 = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.58, 0.61, 0.64, THREE.LinearSRGBColorSpace), roughness: 0.17, metalness: 1 });
  const stainless = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.5, 0.52, 0.53, THREE.LinearSRGBColorSpace),
    roughnessMap: tex.brushedRoughness(512, 0.34, 92),
    roughness: 1,
    metalness: 1,
    anisotropy: 0.6,
  });
  const stainlessBrushed = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.42, 0.44, 0.46, THREE.LinearSRGBColorSpace), // darker albedo: sunlit steel must not read as white plastic
    roughness: 0.2, // tight so the room reads in the panel
    metalness: 1,
    anisotropy: 0.4, // at 1.0 the sun's stretched lobe whited out the whole sunlit face
    anisotropyRotation: Math.PI / 2, // brushing runs vertically on upright panels
  });
  // System 4 rev 2: #141414 is a 0.6 % albedo — no paint is that black (black powder coat
  // measures 3–5 %); under the physical rig the brewer body sat at 35 nits, −5.6 EV, a hole
  // in every frame. #383838 ≈ 4 % keeps it black and puts it in the curve's toe (≈ sRGB 20–30).
  // (dawn-station NOTES case 34 is the same defect: a black authored as a display number.)
  const blackPowder = new THREE.MeshStandardMaterial({ color: 0x383838, roughness: 0.55, metalness: 0.1 });
  // Light brushed stainless for the brewer hood, funnel and base plate: albedo ≈ 0.6 with a
  // hint of blue. Deliberately left on the ROOM probe (not the prop probe under the
  // cabinets): the prop probe's ceiling is the dark cabinet underside, which turned the
  // hood top into a bronze gradient in rev 5.
  const stainlessCool = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.58, 0.6, 0.64, THREE.LinearSRGBColorSpace),
    roughnessMap: tex.brushedRoughness(512, 0.3, 93),
    roughness: 1,
    metalness: 1,
    anisotropy: 0.6,
  });

  // Glazed ivory china: opaque, tight gloss from a clearcoat layer over a satin base.
  const ceramic = new THREE.MeshPhysicalMaterial({ color: 0xf2eee6, roughness: 0.15, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.12 });
  // Unglazed foot ring: bare stoneware, noticeably darker than the glaze.
  const bisque = new THREE.MeshStandardMaterial({ color: 0x8e7e6e, roughness: 0.88, metalness: 0 });
  // Clear glass: transmission 1 (at 0.95 the remaining 5 % was a diffuse white skin that
  // read as a milky veil over the sugar in rev 6), roughness 0 so the transmission pass is
  // not blurred, thin refraction thickness, no attenuation. Ribs are geometry, not maps.
  const glassClear = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0,
    metalness: 0,
    transmission: 1,
    ior: 1.5,
    thickness: 0.0015,
    specularIntensity: 1,
    envMapIntensity: 0.7,
  });
  const glassFluted = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0,
    metalness: 0,
    transmission: 1,
    ior: 1.5,
    thickness: 0.004,
    specularIntensity: 1,
    envMapIntensity: 0.7,
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
  // Coffee tide line inside the decanter. NOT transparent (rev 2): three.js's transmission
  // buffer holds opaque objects only, so a transparent band behind the transmissive glass
  // never rendered — the rev 1 "no tide line". Opaque with an alphaTest cut-out instead; the
  // alpha map (System 5) shapes the band into a dense line thinning upward with drips.
  const coffeeStain = new THREE.MeshStandardMaterial({ color: 0x3a1f0c, roughness: 0.7, metalness: 0, alphaTest: 0.35, side: THREE.DoubleSide });
  const lens = tex.prismLens(256, 8);
  // 8 cells per canvas × 25 repeats over the 1.2 m lens = 6 mm prisms (real K12 lens pitch)
  lens.normalMap.repeat.set(25, 12);
  lens.map.repeat.set(25, 12);

  const palette: Omit<Palette, DerivedKey> = {
    wallPaint,
    wallPaintWindow,
    wallPaintExt,
    ceilingTile,
    ceilingTileStained,
    // Door / window dressing: an RGBA atlas on thin quads 1.5 mm off the glass. Opaque
    // regions only where a sign or sticker is; drawn after the glass (renderOrder in Door.ts).
    // FrontSide: every quad is built facing the room (mirrored UVs where the vinyl is meant
    // for the street), and the flip sign's two faces are two quads, so a DoubleSide quad
    // would show the wrong face through the other.
    decal: new THREE.MeshStandardMaterial({
      map: tex.doorDecals(2048),
      transparent: true,
      alphaTest: 0.02,
      roughness: 0.55,
      metalness: 0,
      side: THREE.FrontSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    }),
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
    // Fluted aluminium T-mould: neutral bright aluminium (rev 2: was a blue-grey), brushed
    // roughness map added below; the flutes are geometry (slabGeometry grooves).
    formicaEdge: new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.8, 0.8, 0.78, THREE.LinearSRGBColorSpace), roughness: 0.3, metalness: 1 }),
    alumGroove,
    chrome,
    chromeWorn,
    chromeWorn2,
    chromeSoft,
    chromeBrushed,
    plinthLine,
    ceramic,
    bisque,
    coffeeStain,
    glassClear,
    glassFluted,
    coffee,
    blackPlastic: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.45, metalness: 0 }),
    orangeBand: new THREE.MeshStandardMaterial({ color: 0xb85a1e, roughness: 0.5, metalness: 0 }),
    pilotRed: new THREE.MeshStandardMaterial({ color: 0xff2a1a, roughness: 0.4, metalness: 0, emissive: 0xff2010, emissiveIntensity: 3 }),
    napkin: new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.95, metalness: 0 }),
    sugar: new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughnessMap: tex.speckleRoughness(256, 0.86, 0.1, 71), roughness: 1, metalness: 0 }),
    salt: new THREE.MeshStandardMaterial({ color: 0xd2d7de, roughness: 1, metalness: 0 }), // faint grey-blue so it separates from the pale sill AND from the sugar
    napkinFold: new THREE.MeshStandardMaterial({ color: 0xbdb8ae, roughness: 1, metalness: 0 }),
    darkSeal: new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 0.7, metalness: 0 }),
    rockerLit: new THREE.MeshStandardMaterial({ color: 0xffb060, emissive: 0xff9a30, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0 }),
    pepper: new THREE.MeshStandardMaterial({ color: 0x3a3430, roughness: 0.9, metalness: 0 }),
    trayBrown: new THREE.MeshStandardMaterial({ color: 0x4a2c1a, roughness: 0.55, metalness: 0 }),
    clockFace: new THREE.MeshStandardMaterial({ color: 0xf6f3ea, roughness: 0.5, metalness: 0 }),
    // Dusty black rubber is a 3–4 % albedo (was #1e1e1e, 1.3 %) — see blackPowder (System 4 rev 2).
    rubberMat: new THREE.MeshStandardMaterial({ color: 0x363636, roughness: 0.9, metalness: 0 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x3a3836, roughness: 0.5, metalness: 0.6 }),
    alum: new THREE.MeshStandardMaterial({ color: 0x4f4841, roughness: 0.45, metalness: 0.55 }),
    alumBright: new THREE.MeshStandardMaterial({ color: 0xb4b8bc, roughness: 0.38, metalness: 0.7 }),
    // Window glass (System 3): clear 6 mm float — T 0.88, IOR 1.52, faint green-grey body
    // tint, 4 %/surface Fresnel reflection of the room probe, dust haze that thickens
    // toward the lower edge and corners (roughness map 0.008–0.045, REFERENCE §4).
    // transmission stays 1 and the 12 % loss lives in `color`: any transmission < 1
    // leaves a lit diffuse skin over the pane that reads as a milky veil (rev 1 lesson).
    // System 4 rev 2: #e2ebe6 (linear 0.76/0.83/0.79, +9 % green) turned the sky through the
    // panes grey-green in the sys4 frames; face-on, 6 mm clear float is (0.85/0.87/0.86) —
    // the green lives in the edges. Measured in-page (rev 2, sky through the door pane with
    // the pane shown / hidden): three r185 renders a DoubleSide transmissive surface's back
    // face into the transmission buffer first (WebGLRenderer.renderTransmissionPass), so a
    // single pane applies `color` and the Fresnel term TWICE — #edf0ee passed 0.69, not 0.88.
    // Two Fresnel losses are right for a pane (two surfaces, (1 − 0.042)² = 0.92); the body
    // absorption must not be squared, so `color` is its square root: #f9fbfa (0.955/0.968/0.96)²
    // × 0.92 = 0.86 total, the 6 mm float value, with 1.5 % of green.
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xf9fbfa,
      roughness: 1,
      roughnessMap: ext.glassDust(1024, 3320, false),
      metalness: 0,
      transmission: 1,
      ior: 1.52,
      thickness: 0.006,
      attenuationColor: new THREE.Color(0.7, 0.86, 0.8),
      attenuationDistance: 0.6,
      envMapIntensity: 1,
      specularIntensity: 1,
      side: THREE.DoubleSide,
    }),
    // Door glass: same pane with palm/finger smudges around push-bar height.
    glassDoor: new THREE.MeshPhysicalMaterial({
      color: 0xf9fbfa,
      roughness: 1,
      roughnessMap: ext.glassDust(1024, 3321, true),
      metalness: 0,
      transmission: 1,
      ior: 1.52,
      thickness: 0.006,
      attenuationColor: new THREE.Color(0.7, 0.86, 0.8),
      attenuationDistance: 0.6,
      envMapIntensity: 1,
      specularIntensity: 1,
      side: THREE.DoubleSide,
    }),
    glassSmudge: (() => {
      // Greasy palm-smear haze on the door pane. Forward scatter from a grease film is
      // strongest at grazing view angles, so the alpha is scaled by a Fresnel-like term
      // (0.3 at normal incidence → 1 at grazing): the smear brightens as you look along the
      // pane and nearly disappears face-on, which is how a real smudge behaves (rev 3).
      const m = new THREE.MeshBasicMaterial({ color: 0xf4f2ec, transparent: true, opacity: 0.2, alphaMap: ext.handprintAlpha(1024, 3321), depthWrite: false, side: THREE.DoubleSide });
      m.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vSmN; varying vec3 vSmV;")
          .replace("#include <fog_vertex>", "#include <fog_vertex>\nvSmN = normalize(normalMatrix * normal); vSmV = normalize(-(modelViewMatrix * vec4(position, 1.0)).xyz);");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vSmN; varying vec3 vSmV;")
          .replace("#include <alphamap_fragment>", "#include <alphamap_fragment>\n{ float g = 1.0 - abs(dot(normalize(vSmN), normalize(vSmV))); diffuseColor.a *= 0.3 + 0.7 * g * g; }");
      };
      m.customProgramCacheKey = () => "glassSmudgeFresnel";
      return m;
    })(),
    // 1" venetian slats: baked-enamel aluminium, alabaster (238,232,218) slightly yellowed,
    // 20–30 GU → roughness ~0.45 (dielectric paint, F0 4 %), dust streaks on the up-face.
    slat: (() => {
      const d = ext.slatDust(1024, 3322);
      return new THREE.MeshStandardMaterial({ map: d.map, roughnessMap: d.roughnessMap, roughness: 1, metalness: 0.1, envMapIntensity: 0.7, side: THREE.DoubleSide });
    })(),
    slatRail: new THREE.MeshStandardMaterial({ color: 0xe6dfcc, roughness: 0.42, metalness: 0.25 }),
    // Moulded plastic end caps, tassel, equaliser, wand tip: almond a shade darker than the rail
    slatCap: new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.55, metalness: 0 }),
    cord: new THREE.MeshStandardMaterial({ color: 0xd9d2c0, roughness: 0.95, metalness: 0 }),
    // Tilt wand: opaque almond acrylic (rev 2 — a clear rod disappeared against the slats)
    wand: new THREE.MeshStandardMaterial({ color: 0xc4b08a, roughness: 0.18, metalness: 0 }),
    // Acorn tassel on the pull cords: cream plastic, a shade lighter than the slats so it
    // separates from them (rev 3's almond tassel vanished into the slat stack; rev 2's
    // turned-wood one read as a curtain tassel). Glossier than the caps.
    tassel: new THREE.MeshStandardMaterial({ color: 0xece4cf, roughness: 0.3, metalness: 0 }),
    laminateWood: new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.5, metalness: 0 }),
    kickPanel: new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.6, metalness: 0.3 }),
    tileBacking: new THREE.MeshStandardMaterial({ color: 0x5a5650, roughness: 1, metalness: 0 }),
    fixtureWhite: new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.4, metalness: 0.1 }),
    // Prismatic lens of a lit 2×4 troffer (System 4 rev 2): mean luminance TROFFER_LENS_NITS
    // (7,500 lm Lambertian over 1.11 × 0.51 m ≈ 4,200 nits, +2.0 EV over middle grey) in the
    // lamp's own 4100 K green-biased tint (Lighting.ts FLUORESCENT, shared with the spot under
    // it). The emissive map (textures.ts trofferLens) carries the four T8 tube images through
    // the K12 prisms — ≈ 1.5× the mean under each tube (≈ 6,300 nits, +2.6 EV: near the camera
    // curve's clip, not on it), ≈ 0.65× between, dark 30 mm at the housing ends — normalised
    // to mean 1 / TROFFER_LENS_HEADROOM in the texture, so the intensity is (nits × K ×
    // headroom) / the tint's luminance. The colour map keeps the prism pitch in the albedo.
    fixtureLens: (() => {
      const tint = FLUORESCENT.clone();
      const lum = 0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b;
      const tubes = tex.trofferLens(1024, 512, 4, 185); // 185 cells across 1.11 m = 6 mm prisms
      return new THREE.MeshStandardMaterial({
        color: 0xf4f2ee,
        roughness: 0.35,
        metalness: 0,
        emissive: tint,
        emissiveIntensity: (nits(TROFFER_LENS_NITS) * texModule.TROFFER_LENS_HEADROOM) / lum,
        map: lens.map,
        emissiveMap: tubes.emissiveMap,
        normalMap: lens.normalMap,
        normalScale: new THREE.Vector2(0.8, 0.8),
      });
    })(),
    fanBlade: new THREE.MeshStandardMaterial({ map: capTex.map, roughnessMap: capTex.roughnessMap, normalMap: capTex.normalMap, color: 0x8a7060, roughness: 1, metalness: 0 }),
    voidBlack: new THREE.MeshBasicMaterial({ color: 0x040404 }),
    // Nothing lights the kitchen box, so a little emissive stands in for its own ambient: dark, not black.
    kitchenDim: new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 0.95, metalness: 0, emissive: 0x3a3632, emissiveIntensity: 0.55 }),
    heatLampBulb: new THREE.MeshStandardMaterial({ color: 0x3a0c06, roughness: 0.3, metalness: 0, emissive: 0xff5a22, emissiveIntensity: 1 }),
    darkGlass: new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.15, metalness: 0.4 }),
    concrete,
    acUnit: new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.6, metalness: 0.2 }),
    stainless,
    stainlessBrushed,
    stainlessCool,
    blackPowder,
  };

  // System 4: the environment maps are CubeCamera probes of the physically lit scene
  // (Diner.ts), so they ARE the indirect light — diffuse bounce and specular reflection
  // alike — and every material samples them at full strength. The System 1–3 per-class
  // attenuation (0.1 for dielectrics, 0.3–0.7 for gloss) existed to hold the balance
  // against an over-bright synthetic room map; under a probe in nits it would just
  // remove the bounce light from the room.
  for (const m of Object.values(palette)) {
    if (m instanceof THREE.MeshStandardMaterial) m.envMapIntensity = 1;
  }
  // Emissives in nits × K (Lighting.ts: 1 unit = 10,000 nits); the radiance is intensity ×
  // the emissive colour's luminance. Lit rocker switch ≈ 700 nits, red pilot lamp ≈ 700 nits.
  // The troffer lens is set at its construction above (TROFFER_LENS_NITS).
  palette.rockerLit.emissiveIntensity = 0.15;
  palette.pilotRed.emissiveIntensity = 0.3;
  // Kitchen box (System 4 rev 2): rev 1 gave it 30 nits, "grey paint under a 300-lux
  // fluorescent" — but that is a −4.3 EV hole at this exposure (GREY_NITS ≈ 600), and both
  // critics read the pass-through as unlit. A working kitchen at 8 AM runs 500 lux at the
  // work plane (IES kitchen standard) with the walls at 250–350 lux and a lot of stainless;
  // as an emissive stand-in for the surfaces the heat-lamp spot (Lighting.ts) does not
  // reach: 0.45 albedo × 450 lux / π ≈ 65 nits, −3.2 EV — dark, but in the camera curve's
  // toe rather than under it, so the range hood and table read as shapes.
  palette.kitchenDim.emissiveIntensity = nits(65) / luminance(palette.kitchenDim.emissive);
  // Heat-lamp bulb face: a 250 W red R40 runs ≈ 2,800 K behind a red coating; the visible
  // face of the reflector bulb is ≈ 8,000 nits (a 60 W frosted bulb is ≈ 12,000 nits; the
  // coating passes ~15 % but the reflector concentrates it). +3.7 EV: clips to the paper
  // white with a red fringe, as heat lamps do in every diner photograph.
  palette.heatLampBulb.emissiveIntensity = nits(8_000) / luminance(palette.heatLampBulb.emissive);

  /* ---- System 5: wear variants, derived from the tuned base materials ----
   * Each clone inherits colour, gloss and envMapIntensity from its base *as tuned above*
   * (so the lighting pass's numbers propagate — System 4 sets every probe-lit material to
   * envMapIntensity 1) and only adds a map. Where a roughness map
   * is added to a material that had a scalar, the scalar moves into the map's `base`
   * argument and `roughness` becomes 1 — same mean, now varying. */
  const withRough = <M extends THREE.MeshStandardMaterial>(m: M, map: THREE.Texture): M => {
    m.roughnessMap = map;
    m.roughness = 1;
    return m;
  };
  // Brushing streaks on the T-mould (the band's extrude UVs run along its length).
  const formicaEdgeBrushed = withRough(palette.formicaEdge.clone(), tex.brushedRoughness(512, palette.formicaEdge.roughness, 95));
  // Shoes on chrome: footrings and the footrail (Counter.ts scales their UVs to ~0.5 m).
  const chromeScuffed = withRough(palette.chrome.clone(), tex.scuffRoughness(512, palette.chrome.roughness, 61));
  // Hands on chrome: the push bar and pull handle (v along the bar).
  const chromeBar = withRough(palette.chrome.clone(), tex.handWear(512, palette.chrome.roughness, 62));
  // Rev 3: the welt-cracked panels and the crazed roll are one atlas, one material (−1 draw call).
  const vinylRedWeltCracked = palette.vinylRedCrazed;
  // Kick plate: satin brushed stainless — a looser finish than the brewer trim (0.45) so it
  // scatters the room into a light grey instead of mirroring the dark floor (rev 1 read as
  // a flat mauve-brown rectangle), horizontal brushing along the plate.
  const kickPlate = withRough(palette.stainlessCool.clone(), tex.brushedRoughness(512, 0.5, 96));
  // Slightly cool: the warm room env otherwise tints the plate mauve. Anisotropy along the
  // brushing (vertical grain on a kick plate) smears the reflection into satin streaks.
  kickPlate.color.setRGB(0.74, 0.77, 0.8, THREE.LinearSRGBColorSpace);
  kickPlate.anisotropy = 0.7;
  kickPlate.anisotropyRotation = Math.PI / 2;
  // Pedestal bells at floor contact (rev 2): the LatheGeometry's v runs up the profile, the
  // rim and shoulder are v ≲ 0.2. A 64 × 64 DataTexture (no worker) carries the cast's own
  // colour with a grey dust film and mop splash over the bottom, patchy around the base, and
  // lighter grey kick marks (shoe rubber shows pale on dark paint); roughness up under the dust.
  const castBaseDusty = palette.darkMetal.clone();
  {
    const N = 64, rgba = new Uint8Array(N * N * 4), rgh = new Uint8Array(N * N * 4);
    let seed = 4242;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const kicks = Array.from({ length: 9 }, () => [rnd() * N, 2 + rnd() * 9, 2 + rnd() * 5, 1 + rnd() * 1.5] as const);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const v = y / N; // texture row 0 = v 0 (DataTexture flipY false)
        const dust = (1 - THREE.MathUtils.smoothstep(v, 0.14, 0.36)) * (0.7 + 0.3 * rnd());
        let r = 58, g = 56, b = 54;
        r += (158 - r) * dust * 0.9; g += (152 - g) * dust * 0.9; b += (144 - b) * dust * 0.9;
        let kick = 0;
        for (const [kx, ky, kw, kh] of kicks) { const dx = Math.min(Math.abs(x - kx), N - Math.abs(x - kx)) / kw, dy = (y - ky) / kh; kick = Math.max(kick, Math.max(0, 1 - dx * dx - dy * dy)); }
        r += (185 - r) * kick * 0.6; g += (180 - g) * kick * 0.6; b += (174 - b) * kick * 0.6;
        const o = (y * N + x) * 4;
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
        // G = roughness (× material 1), B = metalness: dust and rubber are dielectric, so the
        // film goes diffuse grey where the cast's 0.6 metalness would otherwise mirror the floor.
        const ro = Math.min(255, 255 * (0.5 + dust * 0.35 + kick * 0.3));
        const me = Math.max(0, 255 * 0.6 * (1 - dust * 0.85 - kick * 0.7));
        rgh[o] = ro; rgh[o + 1] = ro; rgh[o + 2] = me; rgh[o + 3] = 255;
      }
    const mk = (d: Uint8Array, srgb: boolean) => { const t = new THREE.DataTexture(d, N, N); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = THREE.RepeatWrapping; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
    castBaseDusty.color.set(0xffffff);
    castBaseDusty.map = mk(rgba, true);
    const rm = mk(rgh, false);
    castBaseDusty.roughnessMap = rm;
    castBaseDusty.roughness = 1;
    castBaseDusty.metalnessMap = rm;
    castBaseDusty.metalness = 1;
  }
  // Fingerprints on the napkin dispensers and brewer trim (one canvas per face).
  const stainlessTouched = withRough(palette.stainlessBrushed.clone(), tex.fingerprints(512, palette.stainlessBrushed.roughness, 63));
  // Decanter: scratches + dishwasher etch over clear glass (base roughness 0).
  const glassCarafe = withRough(palette.glassClear.clone(), tex.carafeScratches(512, palette.glassClear.roughness, 64));
  // Counter top: wipe arcs, long scratches, cup rings; 2.05 m period along the 7.8 m top.
  const counterWear = tex.laminateWear(2048, 2.05, palette.formicaCounter.roughness, 33, 6);
  counterWear.roughnessMap.repeat.set(1 / 2.05, 1 / 2.05);
  counterWear.map.repeat.set(1 / 2.05, 1 / 2.05);
  const formicaCounterWorn = withRough(palette.formicaCounter.clone(), counterWear.roughnessMap);
  // Rev 2: the rings, haze and scratches also darken the sheet. formicaCounter keeps its
  // speckle map (a different repeat), so the wear rides in aoMap (same UV channel), which
  // scales the indirect light the counter mostly lives in.
  formicaCounterWorn.aoMap = counterWear.map;
  formicaCounterWorn.aoMapIntensity = 1;
  // Grid tees: chips and yellowing over the same enamel (uvScale 1 on the tee boxes).
  const tee = tex.teePaint(2048, 21); // rev 2: 2 px/mm so a 3 mm chip is a shape, not a texel
  const tbarPainted = palette.tbar.clone();
  tbarPainted.map = tee.map;
  tbarPainted.roughnessMap = tee.roughnessMap!;
  // Cove base: mop tide marks and heel scuffs (metric UVs, 1 m canvas, jittered per run).
  const cove = tex.baseboardScuff(1024, 23);
  const baseboardWorn = palette.baseboard.clone();
  baseboardWorn.color.set(0xffffff); // rev 2: the map carries the black (a multiplier could never show a grey dust band)
  baseboardWorn.map = cove.map;
  baseboardWorn.roughnessMap = cove.roughnessMap!;
  // Decanter tide line: an alpha map turns the flat 55 % band into a dense line thinning
  // upward with drips (additive param on the existing material).
  palette.coffeeStain.alphaMap = tex.tideLineAlpha(512, 65);

  return { ...palette, formicaEdgeBrushed, chromeScuffed, chromeBar, stainlessTouched, glassCarafe, formicaCounterWorn, tbarPainted, baseboardWorn, vinylRedWeltCracked, kickPlate, castBaseDusty };
}
