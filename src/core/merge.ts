/**
 * Collects geometry per material and emits one mesh per material, so a room
 * full of trim, rails and boxes costs a handful of draw calls instead of
 * hundreds. Also records AABB colliders for the player.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface Collider {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export class MergedBuilder {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  readonly colliders: Collider[] = [];

  /** Add a transformed geometry under a material. Geometry is consumed. */
  add(geometry: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4): void {
    if (matrix) geometry.applyMatrix4(matrix);
    let list = this.buckets.get(material);
    if (!list) this.buckets.set(material, (list = []));
    list.push(geometry);
  }

  /** Axis-aligned box from min to max corners, in world space. */
  box(
    material: THREE.Material,
    min: [number, number, number],
    max: [number, number, number],
    opts: { collide?: boolean; uvScale?: number } = {},
  ): void {
    const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
    const g = new THREE.BoxGeometry(w, h, d);
    if (opts.uvScale) scaleBoxUv(g, w, h, d, opts.uvScale);
    g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    this.add(g, material);
    if (opts.collide) {
      this.colliders.push({ min: new THREE.Vector3(...min), max: new THREE.Vector3(...max) });
    }
  }

  collider(min: [number, number, number], max: [number, number, number]): void {
    this.colliders.push({ min: new THREE.Vector3(...min), max: new THREE.Vector3(...max) });
  }

  /** Build meshes; every merged mesh casts and receives shadows unless told otherwise. */
  build(parent: THREE.Object3D, opts: { castShadow?: boolean; receiveShadow?: boolean; name?: string } = {}): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [material, list] of this.buckets) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      if (opts.name) mesh.name = `${opts.name}:${(material as THREE.Material).name || material.uuid.slice(0, 6)}`;
      parent.add(mesh);
      out.push(mesh);
    }
    this.buckets.clear();
    return out;
  }
}

/** Make box UVs metric (1 UV unit = `metresPerUv` m) so tiling textures stay consistent across box sizes. */
export function scaleBoxUv(g: THREE.BoxGeometry, w: number, h: number, d: number, metresPerUv: number): void {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z ; 4 verts each.
  const faceDims: Array<[number, number]> = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = faceDims[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * (su / metresPerUv), uv.getY(i) * (sv / metresPerUv));
    }
  }
  uv.needsUpdate = true;
}
