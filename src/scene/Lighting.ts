/**
 * PLACEHOLDER lighting so System 1 geometry can be judged. System 4 replaces
 * this file wholesale: sun through blinds, sky dome, bounce, proper troffers.
 */
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { CEILING, ROOM } from "./layout";

export interface LightingResult {
  sun: THREE.DirectionalLight;
}

export function buildLighting(scene: THREE.Scene): LightingResult {
  // Sun: 8 AM, ~35° elevation, coming in from the parking-lot side (+z), a
  // little from the door end (+x) so window piers throw long angled stripes.
  const el = THREE.MathUtils.degToRad(35);
  const az = THREE.MathUtils.degToRad(38);
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const sun = new THREE.DirectionalLight(0xfff1dc, 5.0);
  sun.position.copy(dir).multiplyScalar(30).add(new THREE.Vector3(0, 1.2, 0));
  sun.target.position.set(0, 1.2, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const cam = sun.shadow.camera;
  cam.left = -9;
  cam.right = 9;
  cam.top = 7;
  cam.bottom = -7;
  cam.near = 10;
  cam.far = 55;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.015;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);

  // `?nofill` renders the sun alone — a diagnostic for checking where direct
  // light actually lands, used by the capture harness during review.
  if (new URLSearchParams(location.search).has("nofill")) return { sun };

  // Sky / ground fill. Deliberately low: a real interior at 8 AM sits several
  // stops under the sunlit patches, and that contrast is the picture.
  // The warm ground colour stands in for bounce off the sunlit floor and
  // tables until System 4 does it properly.
  const hemi = new THREE.HemisphereLight(0xcfe0f5, 0xa8977f, 1.0);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0xfff2e2, 0.1));

  // Fluorescent troffers: low-intensity rect area lights under each lens.
  RectAreaLightUniformsLib.init();
  for (const [x, z] of CEILING.troffers) {
    const l = new THREE.RectAreaLight(0xfff0d8, 2.8, CEILING.troffer.w - 0.09, CEILING.troffer.d - 0.09);
    l.position.set(x, ROOM.height - 0.01, z);
    l.lookAt(x, 0, z);
    scene.add(l);
  }

  return { sun };
}
