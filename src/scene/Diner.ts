/**
 * Composes the diner: shell, booths, counter, ceiling, door, placeholder
 * lighting. Owns per-frame animation (ceiling fan) and the collider list.
 */
import * as THREE from "three";
import { createPalette, type Palette } from "../core/materials";
import type { Collider } from "../core/merge";
import { buildEnvironment } from "../procedural/environment";
import { buildBlinds } from "./Blinds";
import { buildBooths } from "./Booths";
import { buildCeiling } from "./Ceiling";
import { buildCounter } from "./Counter";
import { buildDoor } from "./Door";
import { buildExterior } from "./Exterior";
import { buildLighting, sunDirection } from "./Lighting";
import { buildProps } from "./Props";
import { buildShell } from "./Shell";
import { FAN } from "./layout";

export class Diner {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  readonly palette: Palette;
  readonly door: THREE.Group;
  readonly sun: THREE.DirectionalLight;
  /** Named props later systems animate: the mug that gets filled, the decanter that pours. */
  readonly pourMug: THREE.Mesh;
  readonly coffeePot: THREE.Group;
  private fanRotor: THREE.Group;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.palette = createPalette(renderer.capabilities.getMaxAnisotropy());
    this.group.name = "diner";

    const shell = buildShell(this.group, this.palette);
    const booths = buildBooths(this.group, this.palette);
    const counter = buildCounter(this.group, this.palette);
    const ceiling = buildCeiling(this.group, this.palette);
    this.door = buildDoor(this.group, this.palette);
    const props = buildProps(this.group, this.palette);
    buildBlinds(this.group, this.palette);
    const exterior = buildExterior(this.group, this.palette, sunDirection());
    this.pourMug = props.pourMug;
    this.coffeePot = props.coffeePot;
    this.fanRotor = ceiling.fanRotor;
    this.colliders.push(...shell.colliders, ...booths.colliders, ...counter.colliders);

    scene.add(this.group);
    this.sun = buildLighting(scene).sun;

    scene.background = new THREE.Color(0x9cc0ea);
    // Atmospheric perspective for the desert: linear fog to the sky's horizon colour from
    // 45 m (nothing inside the building or the lot is within reach) to 260 m, so the dirt
    // plane, scrub and ridge dissolve into the sky instead of meeting it on a hard line.
    scene.fog = new THREE.Fog(new THREE.Color(0.9, 0.915, 0.93), 45, 260);

    // Reflection environment: a one-time CubeCamera capture of the real interior
    // from counter height between the stools, PMREM-filtered. The chrome then
    // carries the actual checker floor, red seats and window wall. During that
    // capture pass the metals borrow the procedural room map so they are not
    // black in their own reflections. Metals take the result at full strength;
    // dielectrics only at ~0.1 (materials.ts) so the sun/fill balance holds.
    scene.environment = buildEnvironment(renderer);
    scene.environmentIntensity = 1;
    {
      const pmrem = new THREE.PMREMGenerator(renderer);
      // The red band is muted for the probes only: small chrome fittings otherwise read as copper.
      const vinyls = [this.palette.vinylRed, this.palette.vinylRedCrazed];
      const saved = vinyls.map((v) => v.color.clone());
      for (const v of vinyls) v.color.set("#6a1c20");
      const probe = (x: number, y: number, z: number) => {
        const cubeRT = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: false });
        const cubeCam = new THREE.CubeCamera(0.05, 80, cubeRT);
        cubeCam.position.set(x, y, z);
        scene.add(cubeCam);
        cubeCam.update(renderer, scene);
        scene.remove(cubeCam);
        const env = pmrem.fromCubemap(cubeRT.texture).texture;
        cubeRT.dispose();
        return env;
      };
      // Room probe (aisle, counter height): chrome, stools, footrail, T-mould.
      const roomEnv = probe(-2.3, 0.8, 0.95);
      // Prop probe: taken 0.5 m in front of the brewer at 1.1 m, so the back-counter
      // props (decanter glass, coffee, mugs) reflect cabinets, wall and counter top —
      // NOT the checker floor, which from there is hidden behind the counter. The
      // room probe's lower hemisphere is half checkerboard and it printed straight
      // through the glassware in rev 3.
      // For this probe the checker is swapped for a plain grey floor: the pattern is
      // physically visible from there, but on a Ø 170 glass it prints as a sharp
      // checkerboard inside the decanter and reads as a CG artefact.
      const floorMesh = scene.getObjectByName("floor") as THREE.Mesh | undefined;
      const plainFloor = new THREE.MeshStandardMaterial({ color: 0x8c8780, roughness: 0.6 });
      const floorMat = floorMesh?.material;
      if (floorMesh) floorMesh.material = plainFloor;
      const propEnv = probe(-1.7, 1.15, -1.9);
      // Lot probe: sky, facade and asphalt for the vehicles' paint, glass and chrome.
      const lotEnv = probe(1.0, 1.4, 8.0);
      if (floorMesh && floorMat) floorMesh.material = floorMat;
      plainFloor.dispose();
      vinyls.forEach((v, i) => v.color.copy(saved[i]));
      scene.environment.dispose();
      scene.environment = roomEnv;
      for (const m of [this.palette.glassClear, this.palette.glassFluted, this.palette.coffee, this.palette.coffeeStain, this.palette.ceramic, this.palette.bisque, this.palette.chromeSoft, this.palette.sugar, this.palette.salt]) {
        m.envMap = propEnv;
        m.needsUpdate = true;
      }
      for (const m of exterior.envMaterials) {
        (m as THREE.MeshStandardMaterial).envMap = lotEnv;
        m.needsUpdate = true;
      }
      pmrem.dispose();
    }
  }

  update(dt: number): void {
    this.fanRotor.rotation.y -= dt * (FAN.rpm / 60) * Math.PI * 2;
  }
}
