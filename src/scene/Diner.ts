/**
 * Composes the diner: shell, booths, counter, ceiling, door, placeholder
 * lighting. Owns per-frame animation (ceiling fan) and the collider list.
 */
import * as THREE from "three";
import { createPalette, type Palette } from "../core/materials";
import type { Collider } from "../core/merge";
import { buildEnvironment } from "../procedural/environment";
import { buildBooths } from "./Booths";
import { buildCeiling } from "./Ceiling";
import { buildCounter } from "./Counter";
import { buildDoor } from "./Door";
import { buildLighting } from "./Lighting";
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
    this.pourMug = props.pourMug;
    this.coffeePot = props.coffeePot;
    this.fanRotor = ceiling.fanRotor;
    this.colliders.push(...shell.colliders, ...booths.colliders, ...counter.colliders);

    scene.add(this.group);
    this.sun = buildLighting(scene).sun;

    // Procedural reflection environment shaped like this room (see
    // procedural/environment.ts). Metals take it at full strength; dielectrics
    // only at ~0.1 (materials.ts) so the sun/fill balance is unchanged.
    scene.environment = buildEnvironment(renderer);
    scene.environmentIntensity = 1;

    scene.background = new THREE.Color(0x9cc0ea);
  }

  update(dt: number): void {
    this.fanRotor.rotation.y -= dt * (FAN.rpm / 60) * Math.PI * 2;
  }
}
