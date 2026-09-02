/**
 * Composes the diner: shell, booths, counter, ceiling, door, placeholder
 * lighting. Owns per-frame animation (ceiling fan) and the collider list.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createPalette, type Palette } from "../core/materials";
import type { Collider } from "../core/merge";
import { buildBooths } from "./Booths";
import { buildCeiling } from "./Ceiling";
import { buildCounter } from "./Counter";
import { buildDoor } from "./Door";
import { buildLighting } from "./Lighting";
import { buildShell } from "./Shell";
import { FAN } from "./layout";

export class Diner {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  readonly palette: Palette;
  readonly door: THREE.Group;
  readonly sun: THREE.DirectionalLight;
  private fanRotor: THREE.Group;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.palette = createPalette(renderer.capabilities.getMaxAnisotropy());
    this.group.name = "diner";

    const shell = buildShell(this.group, this.palette);
    const booths = buildBooths(this.group, this.palette);
    const counter = buildCounter(this.group, this.palette);
    const ceiling = buildCeiling(this.group, this.palette);
    this.door = buildDoor(this.group, this.palette);
    this.fanRotor = ceiling.fanRotor;
    this.colliders.push(...shell.colliders, ...booths.colliders, ...counter.colliders);

    scene.add(this.group);
    this.sun = buildLighting(scene).sun;

    // Neutral procedural environment so chrome and glass have something to
    // reflect. RoomEnvironment is BRIGHT: at 0.25 it out-lit the sun and
    // flattened every frame (measured with ?nofill). Reflection-only level here.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.05;
    pmrem.dispose();

    scene.background = new THREE.Color(0x9cc0ea);
  }

  update(dt: number): void {
    this.fanRotor.rotation.y -= dt * (FAN.rpm / 60) * Math.PI * 2;
  }
}
