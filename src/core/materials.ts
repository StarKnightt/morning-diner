/**
 * Shared material palette. System 1 values are plausible placeholders; System 5
 * owns the real surfaces. Everything is created once and reused so the merged
 * builders can group geometry by material.
 */
import * as THREE from "three";
import * as texModule from "../procedural/textures";
import * as extModule from "../procedural/exterior";
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
  darkGlass: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  acUnit: THREE.MeshStandardMaterial;
  stainless: THREE.MeshPhysicalMaterial;
  /** Smooth directional brushed stainless for appliances/dispensers (no mottle). */
  stainlessBrushed: THREE.MeshPhysicalMaterial;
  stainlessCool: THREE.MeshPhysicalMaterial;
  /** Matte black powder coat (brewer body). */
  blackPowder: THREE.MeshStandardMaterial;
}

export function createPalette(maxAnisotropy: number, bank?: TextureBank): Palette {
  const aniso = Math.min(8, maxAnisotropy);
  // With a TextureBank the generators run in workers and return placeholders that
  // fill in later (see core/textureBank.ts); without one they run synchronously.
  const tex = bank ? bank.proxy(texModule, "tex") : texModule;
  const ext = bank ? bank.proxy(extModule, "ext") : extModule;

  const floorTex = tex.checkerFloor(40, 20, 51, aniso);
  const wallTex = tex.paintedWall("#e9e2d2", 1024, 11);
  const extWallTex = tex.paintedWall("#d9cfbd", 1024, 12, 0.08);
  const tileTex = tex.acousticTile(512);
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

  const concrete = new THREE.MeshStandardMaterial({ map: concreteTex.map, roughness: 0.9, metalness: 0 });
  concreteTex.map.repeat.set(4, 1);

  /* ---- System 2 surfaces (REFERENCE.md §4 + critic rev 2) ---- */
  // Vinyl: canvas covers 0.4 m; upholstery geometry carries metric UVs (1 unit = 1 m).
  // Two variants share colour/gloss; only the head roll and channel crowns craze.
  const vinylColor = new THREE.Color("#A8141C"); // reads ≈ #AD161E after the crown vertex tint
  const mkVinyl = (crazed: boolean) => {
    const t = tex.vinylSurface(1024, 0.4, crazed);
    // Canvas covers 0.1 m so the ~1.5 mm leather grain lands at ~0.4 mm: highlights break up.
    t.normalMap.repeat.set(4, 4);
    t.roughnessMap.repeat.set(4, 4);
    return new THREE.MeshPhysicalMaterial({
      color: vinylColor,
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
  const vinylRed = mkVinyl(false);
  const vinylRedCrazed = mkVinyl(true);

  // Laminates: ExtrudeGeometry UVs are in metres; one canvas = 0.5 m.
  // One 2048 canvas covers 1.2 m: a whole table top without a visible repeat.
  const boomerang = tex.formicaBoomerang(2048, 1.2, 31);
  boomerang.map.repeat.set(1 / 1.2, 1 / 1.2);
  boomerang.roughnessMap!.repeat.set(1 / 1.2, 1 / 1.2);
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
  const capTex = tex.woodVeneer(1024, 0.5, { hex: "#6E4A2E", seed: 501, contrast: 0.09, rough: 0.3, pore: 0.4, vertical: false, pitch: 1.5, ring: 9, warp: 2, figure: 12 });
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
  const blackPowder = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.55, metalness: 0.1 });
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
    rubberMat: new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.9, metalness: 0 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x3a3836, roughness: 0.5, metalness: 0.6 }),
    alum: new THREE.MeshStandardMaterial({ color: 0x4f4841, roughness: 0.45, metalness: 0.55 }),
    alumBright: new THREE.MeshStandardMaterial({ color: 0xb4b8bc, roughness: 0.38, metalness: 0.7 }),
    // Window glass (System 3): clear 6 mm float — T 0.88, IOR 1.52, faint green-grey body
    // tint, 4 %/surface Fresnel reflection of the room probe, dust haze that thickens
    // toward the lower edge and corners (roughness map 0.008–0.045, REFERENCE §4).
    // transmission stays 1 and the 12 % loss lives in `color`: any transmission < 1
    // leaves a lit diffuse skin over the pane that reads as a milky veil (rev 1 lesson).
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xe2ebe6,
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
      color: 0xe2ebe6,
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
    concrete,
    acUnit: new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.6, metalness: 0.2 }),
    stainless,
    stainlessBrushed,
    stainlessCool,
    blackPowder,
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
  palette.glassFluted.envMapIntensity = 0.55;
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
  palette.ceramic.envMapIntensity = 0.45; // ivory china: the room's darks/lights shape the glossy body
  palette.stainlessBrushed.envMapIntensity = 0.55;
  palette.stainlessCool.envMapIntensity = 0.6;
  return palette;
}
