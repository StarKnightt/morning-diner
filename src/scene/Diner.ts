/**
 * Composes the diner: shell, booths, counter, ceiling, door, placeholder
 * lighting. Owns per-frame animation (ceiling fan) and the collider list.
 *
 * Construction is two-phase so the loading screen can paint between stages:
 * the constructor makes the palette (its canvas textures generate in workers
 * through the TextureBank), `build()` adds the geometry stage by stage and then
 * runs the GPU side — parallel shader links, the three reflection probes and
 * the shader variants the walk needs. Every stage produces exactly what the old
 * synchronous constructor produced; only the scheduling changed.
 */
import * as THREE from "three";
import { issueCompile, waitForPrograms } from "../core/compile";
import { createPalette, type Palette } from "../core/materials";
import type { Collider } from "../core/merge";
import type { TextureBank } from "../core/textureBank";
import { buildBlinds } from "./Blinds";
import { buildBooths } from "./Booths";
import { buildCeiling } from "./Ceiling";
import { buildCounter } from "./Counter";
import { buildDoor } from "./Door";
import { buildExterior } from "./Exterior";
import { ROOM_PROBE_INTENSITY, buildContactShadows, buildLighting, installShadowMasks, sunDirection } from "./Lighting";
import { buildProps } from "./Props";
import { buildShell } from "./Shell";
import { buildSignage } from "./Signage";
import { buildSystem9, type System9 } from "./Sys9";
import { DOOR, FAN, ROOM } from "./layout";

export interface BuildHooks {
  /** Main-pass camera; its program variant is compiled ahead of the first frame. */
  camera: THREE.Camera;
  /** A stage finished: `done` is 0..1 through the geometry part. Awaited so the loader can paint. */
  stage: (label: string, done: number) => Promise<void>;
  /** Textures are still generating in the workers (label shows the last one that landed). */
  textures: () => Promise<void>;
  /** Shader link progress, polled every ~20 ms while the textures are still generating. */
  shaders: (ready: number, total: number) => void;
  /** Reflection probes baked so far, out of 3. */
  probes: (done: number) => Promise<void>;
  /** Boot timeline marks. */
  mark: (name: string) => void;
}

export class Diner {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  readonly palette: Palette;
  door!: THREE.Group;
  /** Interior sun (narrow distant spot) and the lot sun (wide directional); see Lighting.ts. */
  sun!: THREE.SpotLight;
  sunLot!: THREE.DirectionalLight;
  /**
   * `sun`'s detached twin with a compare-mode (`sampler2DShadow`) copy of the building
   * shadow map, for the post pipeline's haze/dust march — `sun`'s own map is a raw depth
   * texture for the PCSS stripes. See Lighting.ts → LightingResult.sunBeam.
   */
  sunBeam!: THREE.SpotLight;
  /** Named props later systems animate: the mug that gets filled, the decanter that pours. */
  pourMug!: THREE.Mesh;
  pourMugShadow!: THREE.Mesh;
  coffeePot!: THREE.Group;
  /** System 9: the openables' hinges and the presence props (Sys9.ts). */
  sys9!: System9;
  private fanRotor!: THREE.Group;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly bank?: TextureBank,
  ) {
    this.palette = createPalette(renderer.capabilities.getMaxAnisotropy(), bank);
    this.group.name = "diner";
  }

  async build(hooks: BuildHooks): Promise<void> {
    const { scene, renderer } = this;
    const shell = buildShell(this.group, this.palette);
    await hooks.stage("Framing the shell", 1 / 8);
    const booths = buildBooths(this.group, this.palette);
    await hooks.stage("Upholstering the booths", 2 / 8);
    const counter = buildCounter(this.group, this.palette);
    await hooks.stage("Building the counter", 3 / 8);
    const ceiling = buildCeiling(this.group, this.palette);
    await hooks.stage("Hanging the ceiling", 4 / 8);
    this.door = buildDoor(this.group, this.palette);
    await hooks.stage("Fitting the door", 5 / 8);
    const props = buildProps(this.group, this.palette);
    this.sys9 = buildSystem9(this.group, this.palette, this.bank);
    await hooks.stage("Setting the tables", 6 / 8);
    buildBlinds(this.group, this.palette);
    await hooks.stage("Hanging the blinds", 7 / 8);
    const exterior = buildExterior(this.group, this.palette, sunDirection(), this.bank);
    // Exterior signage (Signage.ts): pylon, channel letters, door panels — added inside the
    // `exterior` group so it takes the lot probe, the lot sun and the lotCaster flag with it.
    buildSignage(this.group, this.palette);
    // System 4: baked contact occlusion along every base line (nothing else in the rig
    // shadows those regions) and, rev 2, under the mugs and saucers. Casts nothing, so it
    // stays out of the shadow-mask lists.
    buildContactShadows(this.group, props.contactDiscs);
    this.pourMug = props.pourMug;
    this.pourMugShadow = props.pourMugShadow;
    this.coffeePot = props.coffeePot;
    this.fanRotor = ceiling.fanRotor;
    this.colliders.push(...shell.colliders, ...booths.colliders, ...counter.colliders);

    scene.add(this.group);
    const lights = buildLighting(scene);
    this.sun = lights.sun;
    this.sunBeam = lights.sunBeam;
    this.sunLot = lights.sunLot;
    // Interior casters stay out of the lot sun's shadow map: the cone occluder already
    // blacks the whole building out of that light, and this saves ~120 depth draws/frame.
    installShadowMasks(renderer, this.group, lights, [this.palette.concrete]);

    // Background and fog in the sky's physical scale (Lighting.ts): the horizon colour.
    scene.background = lights.horizon.clone();
    // Atmospheric perspective for the desert: linear fog to the sky's horizon colour from
    // 40 m (nothing inside the building or the lot is within reach) to 200 m, so the dirt
    // plane, scrub and both ridge rings dissolve into the sky instead of meeting it on a
    // hard line (the dirt plane's edge at 210 m is fully fogged).
    scene.fog = new THREE.Fog(lights.horizon.clone(), 40, 200);
    await hooks.stage("Paving the lot", 8 / 8);
    hooks.mark("geometry");
    await hooks.stage("Lighting the room", 1);

    // Reflection environment = global illumination. Three CubeCamera probes of the real,
    // physically lit scene (room / props / lot), PMREM-filtered, are the diffuse AND
    // specular environment for every material at full strength (materials.ts): the
    // bounce off the sunlit floor and vinyl onto the ceiling and the undersides, the sky
    // through the windows, the lot's own sky dome — all come from there, not from a
    // uniform ambient. Two passes: pass 1 is captured under direct light only (a black
    // environment), pass 2 under pass 1's probes, so the result carries two bounces.
    scene.environmentIntensity = 1;
    hooks.mark("environment");
    await hooks.stage("Compiling shaders", 1);
    {
      const pmrem = new THREE.PMREMGenerator(renderer);
      // The red band is muted for the probes only: small chrome fittings otherwise read as copper.
      const vinyls = [this.palette.vinylRed, this.palette.vinylRedCrazed, this.palette.vinylRedWeltCracked];
      const saved = vinyls.map((v) => v.color.clone());
      for (const v of vinyls) v.color.set("#6a1c20");
      const cubeRT = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: false });
      // Far 250 m: the sky dome (r = 170 m) has to be in the lot probe.
      const cubeCam = new THREE.CubeCamera(0.05, 250, cubeRT);
      const probe = (x: number, y: number, z: number) => {
        cubeCam.position.set(x, y, z);
        scene.add(cubeCam);
        cubeCam.update(renderer, scene);
        scene.remove(cubeCam);
        return pmrem.fromCubemap(cubeRT.texture);
      };
      // For the prop probe the checker is swapped for a plain grey floor (see below).
      const floorMesh = scene.getObjectByName("floor") as THREE.Mesh | undefined;
      const plainFloor = new THREE.MeshStandardMaterial({ color: 0x8c8780, roughness: 0.6 });
      const floorMat = floorMesh?.material;
      // Every exterior surface samples the lot probe (sky + asphalt + facade). Exterior.ts
      // lists the car/glass/chrome materials; the asphalt, kerb, wall, dirt and scrub are
      // collected here so the outdoor sky light does not come from the room probe.
      const exteriorMats = new Set<THREE.MeshStandardMaterial>(exterior.envMaterials as THREE.MeshStandardMaterial[]);
      scene.getObjectByName("exterior")?.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
          if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) exteriorMats.add(mat as THREE.MeshStandardMaterial);
        }
      });
      // `glassCarafe` is System 5's scratched clone of `glassClear` (the decanter) — a clone has
      // its own envMap slot, so it is listed alongside its base.
      const propMats = [this.palette.glassClear, this.palette.glassCarafe, this.palette.glassFluted, this.palette.coffee, this.palette.coffeeStain, this.palette.ceramic, this.palette.bisque, this.palette.chromeSoft, this.palette.sugar, this.palette.salt];
      // Interior metals (chrome, stool rings, edge banding, T-bar): a mirror shows the room as
      // it is, sun stripes included, so they take the probe captured WITH the sun. Dielectrics
      // take `scene.environment`, captured with the interior sun off: their first bounce off
      // the sun patches comes from the per-booth bounce spots instead (Lighting.ts), which
      // fall off with distance — a probe cannot — and would otherwise be counted twice.
      const propSet = new Set<THREE.Material>(propMats);
      const metalMats: THREE.MeshStandardMaterial[] = [];
      for (const m of Object.values(this.palette)) {
        if (m instanceof THREE.MeshStandardMaterial && m.metalness >= 0.9 && !propSet.has(m) && !exteriorMats.has(m)) metalMats.push(m);
      }
      // System 9's two door materials carry their stainless / chrome in the vertex alpha
      // (one bucket per door): they take the metal probe so the plates and pulls mirror the room.
      metalMats.push(...this.sys9.openables.envMetals);
      // System 4 rev 6 glazing (Glazing.ts): the panes' room-facing reflection leaf mirrors the
      // room (metals' probe, sun on), the lot-facing one the lot; the alpha leaf has no probe.
      metalMats.push(this.palette.glassReflectIn, this.palette.glassDoorReflectIn);
      exteriorMats.add(this.palette.glassReflectOut);
      exteriorMats.add(this.palette.glassDoorReflectOut);
      // Rev 6.1 (facade critics): the shell's OUTER skins — stucco (`wallPaintExt`, the outer
      // half of every wall box and the roof slab) and the concrete base / apron — are built by
      // Shell.ts inside the room group, so they were taking `scene.environment`, the sun-off
      // room probe at 0.1: a facade shadow with the room's darkness as its only fill (Y ≈ 46,
      // 4.3 stops under the sunlit wall, warm) beside lot shadows 2.5 stops down and blue. They
      // are outdoors; they take the lot probe (sky + sunlit apron) at their own intensity 1.
      // Sun split unchanged: they still receive the interior spot (the roof's awning band and
      // the pole shadow are in its map).
      exteriorMats.add(this.palette.wallPaintExt);
      exteriorMats.add(this.palette.concrete);
      // 0.75: the probe sits 8 m out over the sunlit apron and hands a vertical wall more of the
      // ground's bounce than the strip of apron under the windows delivers; at 1.0 the awning
      // band measured 2.1 EV under the sunlit stucco, the critics' band is 2.5–3 (the lot's own
      // shadows in the frame are 2.5). The colour stays the albedo's: sky + sand fill on a
      // warm-beige stucco is warm-neutral, not blue like the same fill on asphalt.
      this.palette.wallPaintExt.envMapIntensity = 0.75;
      this.palette.concrete.envMapIntensity = 0.75;
      const assign = (mats: Iterable<THREE.MeshStandardMaterial>, env: THREE.Texture | null) => {
        for (const m of mats) {
          m.envMap = env;
          m.needsUpdate = true;
        }
      };

      // Every program the scene will ever need is issued here, at once, so the driver
      // links them all in parallel while the texture workers are still drawing
      // (core/compile.ts). Variants B (canvas) and C (render target: the probe passes and
      // the transmission pass behind the window and door glass) run against the probes,
      // which do not exist yet. A program keys on the environment map's PMREM *height*,
      // never its content, so a blank cubemap of the probes' size stands in; the real
      // probes reuse the very same programs from the cache. C used to link lazily the
      // first time a pane of glass entered the view — a multi-second hitch mid-walk.
      //
      // The stand-in is made first, while the driver's link queue is still empty: the
      // PMREM generator's own small programs link synchronously, and a synchronous link
      // queued behind the scene's programs waits for all of them (~2 s). It is black, and
      // doubles as the "no indirect light" environment of probe pass 1.
      renderer.setRenderTarget(cubeRT, 0);
      renderer.clear();
      renderer.setRenderTarget(null);
      const standIn = pmrem.fromCubemap(cubeRT.texture);
      scene.environment = standIn.texture;
      hooks.mark("stand-in");
      await hooks.stage("Compiling shaders", 1);

      // Render-target variant with both floor materials (the prop probe swaps the floor).
      if (floorMesh) floorMesh.material = plainFloor;
      issueCompile(renderer, scene, hooks.camera, cubeRT);
      if (floorMesh && floorMat) floorMesh.material = floorMat;
      issueCompile(renderer, scene, hooks.camera, cubeRT);
      // Canvas variant.
      issueCompile(renderer, scene, hooks.camera, null);
      hooks.mark("compile-issued");

      const linked = waitForPrograms(renderer, hooks.shaders);
      await hooks.textures();
      hooks.mark("textures");
      await linked;
      hooks.mark("shaders");

      // The sun never moves and nothing sunlit moves yet (the fan hangs above the window
      // head, out of the beam, and no longer casts), so both shadow maps are rendered once,
      // here — after every builder has run, so every caster exists — inside the first probe
      // face; every probe face and every frame after reuses them. See invalidateShadows().
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;

      let roomEnv: THREE.WebGLRenderTarget | null = null;
      let roomSpecEnv: THREE.WebGLRenderTarget | null = null;
      let propEnv: THREE.WebGLRenderTarget | null = null;
      let lotEnv: THREE.WebGLRenderTarget | null = null;
      for (let pass = 0; pass < 2; pass++) {
        // Metals' probe first, with the sun (both maps render inside its first face).
        const roomSpec = probe(-2.3, 1.3, -0.2);
        const sunIntensity = this.sun.intensity;
        this.sun.intensity = 0;
        // Rev 3: the lit lenses are not in the dielectrics' probe either. Their direct light is
        // the six troffer spots (Lighting.ts); a lens seen by the probe is that same light a
        // second time as ambient (rev 2 critics: "troffer lenses are in it — double counted").
        // Metals (roomSpec) and the counter laminate keep the lit lens for their reflections.
        const lens = this.palette.fixtureLens;
        const lensEmissive = lens.emissiveIntensity;
        lens.emissiveIntensity = 0;
        // Room probe: over the counter's front edge at 1.3 m. It is the far-field ambient of
        // the whole interior (walls, ceiling, floor, chrome, stools), so it must NOT sit over
        // the aisle sun patches — from there (rev 1: (-2.3, 0.8, 0.95)) the bounce off the
        // patches filled its lower hemisphere and every counter-side surface read 1.3 stops
        // over the daylight-factor estimate (REFERENCE §8). From the counter edge the patches
        // are 1.5–2.5 m away and oblique; the near-window sun bounce comes from the per-booth
        // bounce spots (Lighting.ts), which fall off with distance as it should, and the sky
        // through the windows is in this probe (it sees all five).
        const room = probe(-2.3, 1.3, -0.2);
        lens.emissiveIntensity = lensEmissive;
        this.sun.intensity = sunIntensity;
        if (pass === 0) await hooks.probes(1);
        // Prop probe: taken 0.5 m in front of the brewer at 1.1 m, so the back-counter
        // props (decanter glass, coffee, mugs) reflect cabinets, wall and counter top —
        // NOT the checker floor, which from there is hidden behind the counter. The
        // room probe's lower hemisphere is half checkerboard and it printed straight
        // through the glassware in rev 3.
        // For this probe the checker is swapped for a plain grey floor: the pattern is
        // physically visible from there, but on a Ø 170 glass it prints as a sharp
        // checkerboard inside the decanter and reads as a CG artefact.
        if (floorMesh) floorMesh.material = plainFloor;
        const propSunOff = new URLSearchParams(location.search).has("propsunoff");
        if (propSunOff) this.sun.intensity = 0;
        const prop = probe(-1.7, 1.15, -1.9);
        if (propSunOff) this.sun.intensity = sunIntensity;
        if (floorMesh && floorMat) floorMesh.material = floorMat;
        if (pass === 0) await hooks.probes(2);
        // Lot probe: sky dome, facade and asphalt for everything outdoors.
        const lot = probe(1.0, 1.4, 8.0);

        roomEnv?.dispose();
        roomSpecEnv?.dispose();
        propEnv?.dispose();
        lotEnv?.dispose();
        roomEnv = room;
        roomSpecEnv = roomSpec;
        propEnv = prop;
        lotEnv = lot;
        scene.environment = room.texture;
        // Near-field correction for a one-point probe (Lighting.ts ROOM_PROBE_INTENSITY). Note
        // three ignores a material's own envMapIntensity whenever its envMap comes from
        // scene.environment (WebGLRenderer: the uniform is overwritten with this value), so
        // this is the ONE knob on the dielectrics' ambient; per-material values only act on
        // the metals, props and exterior, which carry their own probes.
        scene.environmentIntensity = ROOM_PROBE_INTENSITY;
        assign(metalMats, roomSpec.texture);
        // Counter laminate: a semi-gloss sheet under six lit lenses shows their pools (rev 3
        // critics), so it takes the metals' probe (lit lenses, sun stripes) at the dielectrics'
        // near-field intensity — its own envMapIntensity applies because the map is its own.
        for (const m of [this.palette.formicaCounter, this.palette.formicaCounterWorn]) m.envMapIntensity = ROOM_PROBE_INTENSITY;
        assign([this.palette.formicaCounter, this.palette.formicaCounterWorn], roomSpec.texture);
        assign(propMats, prop.texture);
        assign(exteriorMats, lot.texture);
      }
      // Door probe (System 5 rev 4): the kick plate is a satin mirror facing the room from
      // the door, and from the room probe's station 7 m away its mirror direction (down and
      // into the room) lands on the kitchen partition, not on the checker floor a metre in
      // front of the door that it physically reflects. One more capture at the plate itself
      // (sun on, under the final probes; +6 face renders, once) for the materials that ask
      // for it (`userData.doorProbe`).
      {
        const doorMats = (Object.values(this.palette) as THREE.Material[]).filter((m): m is THREE.MeshStandardMaterial => (m as THREE.MeshStandardMaterial).isMeshStandardMaterial && m.userData.doorProbe === true);
        if (doorMats.length) {
          const p = (doorMats[0].userData.doorProbePos as THREE.Vector3 | undefined) ?? new THREE.Vector3(DOOR.hingeX + DOOR.width / 2, 0.35, ROOM.zFront - 0.22);
          const door = probe(p.x, p.y, p.z);
          assign(doorMats, door.texture);
        }
      }
      // Station probes (System 9 rev 4): a satin plate is a stretched mirror, and from the
      // metals' probe 3 m away its mirror directions land on the wrong walls (the kitchen
      // leaf's plates read as taupe paint). Materials that set `userData.probePos` take one
      // more capture at their own station — the kitchen leaf's plates from the dining side of
      // the closed door, the kitchen slice's steel from inside the slice — box-projected in
      // their shaders (Openables.ts `brushedPlatesByVertexAlpha`). Sun on, once, at boot.
      for (const m of this.sys9.openables.envMetals) {
        const p = m.userData.probePos as THREE.Vector3 | undefined;
        if (!p) continue;
        const station = probe(p.x, p.y, p.z).texture;
        const slot = m.userData.stationEnv as { value: THREE.Texture | null } | undefined;
        if (slot) slot.value = station; // the leaf: plates only, the paint keeps the room probe
        else assign([m], station);
      }
      standIn.dispose();
      plainFloor.dispose();
      vinyls.forEach((v, i) => v.color.copy(saved[i]));
      pmrem.dispose();
      cubeRT.dispose();
      await hooks.probes(3);
      hooks.mark("probes");
    }
  }

  /**
   * Shadow-once: `renderer.shadowMap.autoUpdate` is off, so call this whenever anything
   * sunlit changes — the door leaf swinging, a blind tilting, the decanter lifted off the
   * warmer, the sun moving (System 4) — and BOTH maps (interior spot + lot directional)
   * re-render on the next frame; `installShadowMasks` (Lighting.ts) re-raises the flag per
   * light so the second map is not skipped. Cheap to call every frame while something moves.
   */
  invalidateShadows(): void {
    this.renderer.shadowMap.needsUpdate = true;
  }

  update(dt: number): void {
    this.fanRotor.rotation.y -= dt * (FAN.rpm / 60) * Math.PI * 2;
  }
}
