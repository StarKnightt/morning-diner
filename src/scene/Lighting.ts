/**
 * PLACEHOLDER lighting so System 1 geometry can be judged. System 4 replaces
 * this file wholesale: sun through blinds, sky dome, bounce, proper troffers.
 */
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { CEILING, ROOM, trofferCenter } from "./layout";

export interface LightingResult {
  sun: THREE.DirectionalLight;
}

/**
 * Placeholder sun: 8 AM, 35° elevation, 38° off the window normal toward the door
 * end. Unit vector pointing FROM the scene TOWARD the sun; System 3's sky dome
 * and blind tilt read it from here so the window relationship stays consistent.
 * (REFERENCE §1 has the Flagstaff numbers System 4 will swap in: el 31.1°, az 82°.)
 */
export function sunDirection(): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(35);
  const az = THREE.MathUtils.degToRad(38);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

export function buildLighting(scene: THREE.Scene): LightingResult {
  const dir = sunDirection();
  const sun = new THREE.DirectionalLight(0xfff1dc, 5.0);
  sun.position.copy(dir).multiplyScalar(30).add(new THREE.Vector3(0, 1.2, 0));
  sun.target.position.set(0, 1.2, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const cam = sun.shadow.camera;
  // Frustum fitted to the room (every interior receiver must stay inside it, or it
  // renders sunlit) plus the first stall row of the lot so the two parked vehicles
  // cast onto the asphalt: 13.4 × 10.4 m over 4096² → 3.3 × 2.5 mm texels, which
  // resolves the 11 mm dark / 14 mm light blind stripes (24.8 mm pitch on the floor).
  cam.left = -6.7;
  cam.right = 6.7;
  cam.top = 4.7;
  cam.bottom = -5.7;
  cam.near = 10;
  cam.far = 58;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.014; // 3.3 mm texels: 14 mm keeps sunlit planes acne-free
  sun.shadow.radius = 1;
  scene.add(sun, sun.target);

  // `?nofill` renders the sun alone — a diagnostic for checking where direct
  // light actually lands, used by the capture harness during review.
  if (new URLSearchParams(location.search).has("nofill")) return { sun };

  // Sky / ground fill. Deliberately low: a real interior at 8 AM sits several
  // stops under the sunlit patches, and that contrast is the picture.
  // The warm ground colour stands in for bounce off the sunlit floor and
  // tables until System 4 does it properly.
  const hemi = new THREE.HemisphereLight(0xcfe0f5, 0xbdb3a4, 1.0);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0xfff2e2, 0.1));

  // Fluorescent troffers: low-intensity rect area lights under each lens.
  RectAreaLightUniformsLib.init();
  for (const cell of CEILING.troffers) {
    const [x, z] = trofferCenter(cell);
    const l = new THREE.RectAreaLight(0xfff0d8, 3.2, CEILING.tile * 2 - 0.09, CEILING.tile - 0.09);
    l.position.set(x, ROOM.height - CEILING.teeDepth + 0.015, z);
    l.lookAt(x, 0, z);
    scene.add(l);
  }

  return { sun };
}
