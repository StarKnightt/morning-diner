/**
 * PLACEHOLDER lighting so System 1–3 geometry can be judged. System 4 replaces
 * this file wholesale: sun through blinds, sky dome, bounce, proper troffers.
 *
 * Sun = two lights with the same direction and colour, split by REGION, not by
 * intensity (System 3 rev 2 — see BUILD.md → Lessons):
 *
 *   `sun`     SpotLight 150 m out along the sun vector, decay 0 (no falloff), cone
 *             just wide enough to hold the whole building. Its perspective shadow
 *             map (4096², ≈ 3.5 mm texels at the room) makes the blind stripes.
 *             Outside the cone the spot contributes nothing — that is the mask.
 *   `sunLot`  DirectionalLight with a wide orthographic shadow frustum over the
 *             lot (poles, wall, cars, stops, ≈ 8 × 5 mm texels). A caster-only
 *             CONE (layer 3, invisible to every camera) sits exactly on the spot's
 *             cone, so `sunLot` is shadowed wherever `sun` shines and the two tile
 *             the world with a seam that is a shadow-map edge, not a lit/dark step.
 *
 * Why not one big frustum: 31 × 20 m at 4096² is 7.6 × 4.9 mm texels and the
 * 11 mm stripes go soft. Why not CSM: every cascade is another full shadow pass
 * and the draw-call budget (< 350) does not have room for three of them.
 * three.js cannot mask a LIGHT per object (layers are tested against the render
 * camera, even in the shadow pass), so `installShadowMasks` wraps
 * `renderer.shadowMap.render` to run one light at a time and flips `castShadow`
 * between them — a per-MAP caster list with no wasted depth draws:
 *   cone occluder — casts into `sunLot`'s map only
 *   interior      — casts into `sun`'s map only (the cone already blacks the
 *                   building out of `sunLot`; skipping it saves ~120 depth draws)
 *   exterior      — casts into both (cars inside the cone shade the near stalls)
 */
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { CEILING, ROOM, trofferCenter } from "./layout";

export interface LightingResult {
  sun: THREE.SpotLight;
  sunLot: THREE.DirectionalLight;
  /** Caster-only cone on the spot's cone; masks `sunLot` out of the building. */
  cone: THREE.Mesh;
}

/**
 * Per-light caster lists. `renderer.shadowMap.render` is wrapped to render one light's
 * map at a time; between maps the interior meshes and the cone occluder swap
 * `castShadow`. Everything flagged `userData.lotCaster` (Exterior.ts) casts into both.
 *
 * Shadow-once (Diner.ts sets `shadowMap.autoUpdate = false` and raises `needsUpdate`
 * through `Diner.invalidateShadows()`): WebGLShadowMap.render returns early when
 * neither flag is set and clears `needsUpdate` at the end of a pass, so with the
 * per-light split the flag has to be re-raised before every light's pass or only the
 * first map in the list would ever be rendered. The wrapper mirrors the early return
 * and the final clear itself.
 */
export function installShadowMasks(renderer: THREE.WebGLRenderer, root: THREE.Object3D, lights: LightingResult): void {
  const interior: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.castShadow && !o.userData.lotCaster) interior.push(o);
  });
  const shadowMap = renderer.shadowMap as THREE.WebGLShadowMap & { render: (l: THREE.Light[], s: THREE.Scene, c: THREE.Camera) => void };
  const original = shadowMap.render.bind(shadowMap);
  shadowMap.render = (list: THREE.Light[], scene: THREE.Scene, camera: THREE.Camera) => {
    if (!shadowMap.enabled) return;
    if (!shadowMap.autoUpdate && !shadowMap.needsUpdate) return;
    for (const light of list) {
      const lot = light === lights.sunLot;
      for (const o of interior) o.castShadow = !lot;
      lights.cone.castShadow = lot;
      shadowMap.needsUpdate = true;
      original([light], scene, camera);
    }
    for (const o of interior) o.castShadow = true;
    shadowMap.needsUpdate = false;
  };
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

const SUN_COLOR = 0xfff1dc;
const SUN_INTENSITY = 5.0;
/** Spot apex distance from the building centre. Ray directions across the room vary by ±2.3°. */
const SPOT_DIST = 150;

export function buildLighting(scene: THREE.Scene): LightingResult {
  const dir = sunDirection();
  const T = ROOM.wallThickness;
  // Building box incl. walls and the apron slab; the spot cone must contain all of it.
  const bx0 = -ROOM.halfX - T - 0.3, bx1 = ROOM.halfX + T + 0.3;
  const by0 = -0.2, by1 = ROOM.height + 0.25;
  const bz0 = ROOM.zBack - T - 0.3, bz1 = ROOM.zFront + T + 0.3;
  const centre = new THREE.Vector3((bx0 + bx1) / 2, (by0 + by1) / 2, (bz0 + bz1) / 2);
  let radius = 0;
  const tmp = new THREE.Vector3();
  for (const x of [bx0, bx1]) for (const y of [by0, by1]) for (const z of [bz0, bz1]) {
    tmp.set(x, y, z).sub(centre);
    const along = tmp.dot(dir);
    radius = Math.max(radius, Math.sqrt(Math.max(0, tmp.lengthSq() - along * along)));
  }
  radius += 0.25;
  const halfAngle = Math.atan(radius / SPOT_DIST);

  /* ---------------- interior sun: distant narrow spot ---------------- */
  const sun = new THREE.SpotLight(SUN_COLOR, SUN_INTENSITY, 0, halfAngle, 0, 0);
  sun.position.copy(centre).addScaledVector(dir, SPOT_DIST);
  sun.target.position.copy(centre);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  // Depth range just around the building + cone footprint: 2 × 3.5 mm texels on the floor.
  sun.shadow.camera.near = SPOT_DIST - 20;
  sun.shadow.camera.far = SPOT_DIST + 22;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.014; // ≈ 3.5 mm texels: 14 mm keeps sunlit planes acne-free
  sun.shadow.radius = 1;
  scene.add(sun, sun.target);

  /* ---------------- exterior sun: wide directional over the lot ---------------- */
  const sunLot = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  // Apex of the spot cone must lie inside this frustum (rays have to cross the cone's
  // lateral surface before they reach a receiver), so the light sits beyond the apex.
  const lotDist = SPOT_DIST + 15;
  sunLot.position.copy(centre).addScaledVector(dir, lotDist);
  sunLot.target.position.copy(centre);
  sunLot.castShadow = true;
  sunLot.shadow.mapSize.set(4096, 4096);
  {
    // Fit the ortho frustum to the lot box (kerb → CMU wall, pole tops) plus the building.
    const cam = sunLot.shadow.camera;
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, dir).normalize(); // camera +x in world
    const camUp = new THREE.Vector3().crossVectors(dir, right).normalize(); // camera +y
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    const pts: THREE.Vector3[] = [];
    for (const x of [-17, 17]) for (const y of [-0.5, 8.8]) for (const z of [ROOM.zFront, ROOM.zFront + 21]) pts.push(new THREE.Vector3(x, y, z));
    for (const x of [bx0, bx1]) for (const y of [by0, by1]) for (const z of [bz0, bz1]) pts.push(new THREE.Vector3(x, y, z));
    for (const p of pts) {
      tmp.copy(p).sub(centre);
      const u = tmp.dot(right), v = tmp.dot(camUp);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    // Matrix4.lookAt(eye, target, up): camera +x = up × (eye − target) = `right` above.
    cam.left = u0 - 0.5;
    cam.right = u1 + 0.5;
    cam.bottom = v0 - 0.5;
    cam.top = v1 + 0.5;
    cam.near = 1;
    cam.far = lotDist + 20;
    cam.updateProjectionMatrix();
  }
  sunLot.shadow.bias = -0.0001;
  sunLot.shadow.normalBias = 0.03; // ≈ 8 mm texels
  sunLot.shadow.radius = 1;
  scene.add(sunLot, sunLot.target);

  /* ---------------- cone occluder: masks `sunLot` out of the spot's cone ---------------- */
  let cone3: THREE.Mesh;
  {
    const L = SPOT_DIST + 40; // apex → base, well past the ground under the far side of the room
    const cone = new THREE.ConeGeometry(Math.tan(halfAngle) * L, L, 96, 1, true);
    cone.translate(0, -L / 2, 0); // apex at the origin, axis down −y
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); // −y → −dir
    // Invisible to every colour pass (nothing written) but a real caster for `sunLot`.
    const mesh = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: false, depthTest: false }));
    mesh.material.shadowSide = THREE.DoubleSide;
    mesh.quaternion.copy(q);
    mesh.position.copy(sun.position);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = -20;
    mesh.name = "sun-cone-occluder";
    scene.add(mesh);
    cone3 = mesh;
  }

  // Diagnostics for the capture harness: `?nofill` renders the suns alone, `?nospot` /
  // `?nolot` switch one of the two suns off so the cone seam and each map can be checked.
  const q = new URLSearchParams(location.search);
  if (q.has("nospot")) sun.intensity = 0;
  if (q.has("nolot")) sunLot.intensity = 0;
  if (q.has("nofill")) return { sun, sunLot, cone: cone3 };

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

  return { sun, sunLot, cone: cone3 };
}
