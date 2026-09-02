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
import { buildEnvironment } from "../procedural/environment";
import { buildBlinds } from "./Blinds";
import { buildBooths } from "./Booths";
import { buildCeiling } from "./Ceiling";
import { buildCounter } from "./Counter";
import { buildDoor } from "./Door";
import { buildExterior } from "./Exterior";
import { buildLighting, installShadowMasks, sunDirection } from "./Lighting";
import { buildProps } from "./Props";
import { buildShell } from "./Shell";
import { FAN } from "./layout";

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
  /** Named props later systems animate: the mug that gets filled, the decanter that pours. */
  pourMug!: THREE.Mesh;
  coffeePot!: THREE.Group;
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
    await hooks.stage("Setting the tables", 6 / 8);
    buildBlinds(this.group, this.palette);
    await hooks.stage("Hanging the blinds", 7 / 8);
    const exterior = buildExterior(this.group, this.palette, sunDirection(), this.bank);
    this.pourMug = props.pourMug;
    this.coffeePot = props.coffeePot;
    this.fanRotor = ceiling.fanRotor;
    this.colliders.push(...shell.colliders, ...booths.colliders, ...counter.colliders);

    scene.add(this.group);
    const lights = buildLighting(scene);
    this.sun = lights.sun;
    this.sunLot = lights.sunLot;
    // Interior casters stay out of the lot sun's shadow map: the cone occluder already
    // blacks the whole building out of that light, and this saves ~120 depth draws/frame.
    installShadowMasks(renderer, this.group, lights);

    scene.background = new THREE.Color(0x9cc0ea);
    // Atmospheric perspective for the desert: linear fog to the sky's horizon colour from
    // 40 m (nothing inside the building or the lot is within reach) to 200 m, so the dirt
    // plane, scrub and both ridge rings dissolve into the sky instead of meeting it on a
    // hard line (the dirt plane's edge at 210 m is fully fogged).
    scene.fog = new THREE.Fog(new THREE.Color(0.9, 0.915, 0.93), 40, 200);
    await hooks.stage("Paving the lot", 8 / 8);
    hooks.mark("geometry");
    await hooks.stage("Lighting the room", 1);

    // Reflection environment: a one-time CubeCamera capture of the real interior
    // from counter height between the stools, PMREM-filtered. The chrome then
    // carries the actual checker floor, red seats and window wall. During that
    // capture pass the metals borrow the procedural room map so they are not
    // black in their own reflections. Metals take the result at full strength;
    // dielectrics only at ~0.1 (materials.ts) so the sun/fill balance holds.
    scene.environment = buildEnvironment(renderer);
    scene.environmentIntensity = 1;
    hooks.mark("environment");
    await hooks.stage("Compiling shaders", 1);
    {
      const pmrem = new THREE.PMREMGenerator(renderer);
      // The red band is muted for the probes only: small chrome fittings otherwise read as copper.
      const vinyls = [this.palette.vinylRed, this.palette.vinylRedCrazed];
      const saved = vinyls.map((v) => v.color.clone());
      for (const v of vinyls) v.color.set("#6a1c20");
      const cubeRT = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: false });
      const cubeCam = new THREE.CubeCamera(0.05, 80, cubeRT);
      const probe = (x: number, y: number, z: number) => {
        cubeCam.position.set(x, y, z);
        scene.add(cubeCam);
        cubeCam.update(renderer, scene);
        scene.remove(cubeCam);
        return pmrem.fromCubemap(cubeRT.texture).texture;
      };
      // For the prop probe the checker is swapped for a plain grey floor (see below).
      const floorMesh = scene.getObjectByName("floor") as THREE.Mesh | undefined;
      const plainFloor = new THREE.MeshStandardMaterial({ color: 0x8c8780, roughness: 0.6 });
      const floorMat = floorMesh?.material;

      // Every program the scene will ever need is issued here, at once, so the driver
      // links them all in parallel while the texture workers are still drawing
      // (core/compile.ts). Variants B (canvas) and C (render target: the transmission
      // pass behind the window and door glass) run against the probes, which do not
      // exist yet. A program keys on the environment map's PMREM *height*, never its
      // content, so a blank cubemap of the probes' size stands in; the real probes
      // reuse the very same programs from the cache. C used to link lazily the first
      // time a pane of glass entered the view — a multi-second hitch mid-walk.
      //
      // The stand-in is made first, while the driver's link queue is still empty: the
      // PMREM generator's own small programs link synchronously, and a synchronous link
      // queued behind the scene's programs waits for all of them (~2 s).
      renderer.setRenderTarget(cubeRT, 0);
      renderer.clear();
      renderer.setRenderTarget(null);
      const standIn = pmrem.fromCubemap(cubeRT.texture);
      const roomMap = scene.environment;
      hooks.mark("stand-in");
      await hooks.stage("Compiling shaders", 1);

      // Variant A — render target + procedural room environment — is what the probe
      // pass uses; both floor materials are in the batch.
      if (floorMesh) floorMesh.material = plainFloor;
      issueCompile(renderer, scene, hooks.camera, cubeRT);
      if (floorMesh && floorMat) floorMesh.material = floorMat;
      issueCompile(renderer, scene, hooks.camera, cubeRT);
      // Variants B and C against the stand-in.
      scene.environment = standIn.texture;
      issueCompile(renderer, scene, hooks.camera, null);
      issueCompile(renderer, scene, hooks.camera, cubeRT);
      scene.environment = roomMap;
      standIn.dispose();
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

      // Room probe (aisle, counter height): chrome, stools, footrail, T-mould.
      const roomEnv = probe(-2.3, 0.8, 0.95);
      await hooks.probes(1);
      // Prop probe: taken 0.5 m in front of the brewer at 1.1 m, so the back-counter
      // props (decanter glass, coffee, mugs) reflect cabinets, wall and counter top —
      // NOT the checker floor, which from there is hidden behind the counter. The
      // room probe's lower hemisphere is half checkerboard and it printed straight
      // through the glassware in rev 3.
      // For this probe the checker is swapped for a plain grey floor: the pattern is
      // physically visible from there, but on a Ø 170 glass it prints as a sharp
      // checkerboard inside the decanter and reads as a CG artefact.
      if (floorMesh) floorMesh.material = plainFloor;
      const propEnv = probe(-1.7, 1.15, -1.9);
      await hooks.probes(2);
      // Lot probe: sky, facade and asphalt for the vehicles' paint, glass and chrome.
      const lotEnv = probe(1.0, 1.4, 8.0);
      if (floorMesh && floorMat) floorMesh.material = floorMat;
      plainFloor.dispose();
      vinyls.forEach((v, i) => v.color.copy(saved[i]));
      scene.environment.dispose();
      scene.environment = roomEnv;
      for (const m of [this.palette.glassClear, this.palette.glassCarafe, this.palette.glassFluted, this.palette.coffee, this.palette.coffeeStain, this.palette.ceramic, this.palette.bisque, this.palette.chromeSoft, this.palette.sugar, this.palette.salt]) {
        m.envMap = propEnv;
        m.needsUpdate = true;
      }
      for (const m of exterior.envMaterials) {
        (m as THREE.MeshStandardMaterial).envMap = lotEnv;
        m.needsUpdate = true;
      }
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
