/**
 * Procedural reflection environment: a room-shaped emissive box that mimics
 * THIS diner (warm cream walls, pale ceiling with two troffer bars, checkered
 * floor, a bright window strip broken by piers, a red booth band under it) so
 * chrome reflects a room rather than a generic studio. PMREM-filtered once at
 * startup. Not an external asset: everything here is geometry and colour.
 */
import * as THREE from "three";

function lin(r: number, g: number, b: number): THREE.Color {
  return new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
}

function emissive(color: THREE.Color, side: THREE.Side = THREE.FrontSide): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, side });
}

function checkerTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  for (let j = 0; j < 8; j++)
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = (i + j) % 2 ? "#c6c4be" : "#3c3c3e";
      ctx.fillRect(i * 8, j * 8, 8, 8);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2.5, 1.4);
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  // The PMREM cube camera sits at the origin: put the room's mid height there.
  const room = new THREE.Group();
  room.position.y = -1.1;
  scene.add(room);
  const W = 12, H = 2.9, D = 6.5;
  const plane = (w: number, h: number, mat: THREE.Material, pos: [number, number, number], rot: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(...pos);
    m.rotation.set(...rot);
    room.add(m);
    return m;
  };
  // Ceiling: pale warm grey with two long troffer bars.
  plane(W, D, emissive(lin(0.62, 0.6, 0.56)), [0, H, 0], [Math.PI / 2, 0, 0]);
  for (const z of [-1.4, 1.4]) {
    for (const x of [-3.6, 0, 3.6]) plane(1.2, 0.6, emissive(lin(3.2, 3.0, 2.6)), [x, H - 0.01, z], [Math.PI / 2, 0, 0]);
  }
  // Floor: checker, seen by every stool column and footrail.
  plane(W, D, new THREE.MeshBasicMaterial({ map: checkerTexture() }), [0, 0, 0], [-Math.PI / 2, 0, 0]);
  // Walls: cream, kitchen wall slightly darker, with a brown counter/cabinet band.
  plane(W, H, emissive(lin(0.42, 0.38, 0.32)), [0, H / 2, -D / 2], [0, 0, 0]);
  plane(W, 0.9, emissive(lin(0.12, 0.07, 0.04)), [0, 0.5, -D / 2 + 0.01], [0, 0, 0]);
  plane(D, H, emissive(lin(0.5, 0.46, 0.4)), [-W / 2, H / 2, 0], [0, Math.PI / 2, 0]);
  plane(D, H, emissive(lin(0.5, 0.46, 0.4)), [W / 2, H / 2, 0], [0, -Math.PI / 2, 0]);
  // Window wall: cream piers, five bright window panes, red booth band, brown cap line.
  plane(W, H, emissive(lin(0.55, 0.5, 0.43)), [0, H / 2, D / 2], [0, Math.PI, 0]);
  for (let i = 0; i < 5; i++) {
    const x = -3.6 + i * 1.8;
    plane(1.35, 1.75, emissive(lin(7.5, 8.2, 9.5)), [x, 1.72, D / 2 - 0.01], [0, Math.PI, 0]);
  }
  plane(W, 0.55, emissive(lin(0.25, 0.02, 0.025)), [0, 0.72, D / 2 - 0.02], [0, Math.PI, 0]);
  plane(W, 0.06, emissive(lin(0.1, 0.06, 0.035)), [0, 1.06, D / 2 - 0.03], [0, Math.PI, 0]);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02, 0.1, 50);
  pmrem.dispose();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return rt.texture;
}
