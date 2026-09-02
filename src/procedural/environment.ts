/**
 * A dim sky/ground gradient environment for image-based lighting so chrome and
 * glass reflect something plausible without flooding the interior with flat
 * fill. Values are linear radiance; the sun (DirectionalLight) must stay ~10×
 * brighter than anything here. System 4 replaces this with the real exterior.
 */
import * as THREE from "three";

export function makeSkyGroundEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 48, 24);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const zenith = new THREE.Color(0.16, 0.30, 0.62);
  const horizon = new THREE.Color(0.62, 0.66, 0.72);
  const ground = new THREE.Color(0.22, 0.19, 0.15);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 50; // -1..1
    if (y >= 0) {
      tmp.copy(horizon).lerp(zenith, Math.pow(y, 0.6));
    } else {
      tmp.copy(horizon).lerp(ground, Math.min(1, -y * 6));
    }
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  scene.add(new THREE.Mesh(geo, mat));

  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0).texture;
  pmrem.dispose();
  geo.dispose();
  mat.dispose();
  return tex;
}
