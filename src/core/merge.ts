/**
 * Collects geometry per material and emits one mesh per material, so a room
 * full of trim, rails and boxes costs a handful of draw calls instead of
 * hundreds. Also records AABB colliders for the player.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { metricUv } from "./upholstery";

export interface Collider {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export type V3 = [number, number, number];

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

  /** Sharp axis-aligned box from min to max corners, in world space. */
  box(material: THREE.Material, min: V3, max: V3, opts: { collide?: boolean; uvScale?: number; metric?: boolean } = {}): void {
    const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
    const g = new THREE.BoxGeometry(w, h, d);
    if (opts.uvScale) scaleBoxUv(g, w, h, d, opts.uvScale);
    g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    if (opts.metric) metricUv(g);
    this.add(g, material);
    if (opts.collide) this.collider(min, max);
  }

  /**
   * Bevelled box: every edge rounded with `radius` (default 3 mm). Use for
   * anything the camera can get close to; razor edges read as CG.
   */
  rbox(material: THREE.Material, min: V3, max: V3, radius = 0.003, segments = 2, opts: { collide?: boolean; metric?: boolean } = {}): void {
    const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
    const r = Math.min(radius, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
    const g = r > 1e-4 ? new RoundedBoxGeometry(w, h, d, segments, r) : new THREE.BoxGeometry(w, h, d);
    g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    if (opts.metric) metricUv(g);
    this.add(g, material);
    if (opts.collide) this.collider(min, max);
  }

  collider(min: V3, max: V3): void {
    this.colliders.push({ min: new THREE.Vector3(...min), max: new THREE.Vector3(...max) });
  }

  /** Build meshes; every merged mesh casts and receives shadows unless told otherwise. */
  build(parent: THREE.Object3D, opts: { castShadow?: boolean; receiveShadow?: boolean; name?: string } = {}): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [material, list] of this.buckets) {
      // mergeGeometries needs a consistent index state across inputs.
      const anyNonIndexed = list.some((g) => !g.index);
      const normalised = anyNonIndexed ? list.map((g) => (g.index ? g.toNonIndexed() : g)) : list;
      const merged = normalised.length === 1 ? normalised[0] : mergeGeometries(normalised, false);
      if (!merged) continue;
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      if (opts.name) mesh.name = `${opts.name}:${material.name || material.uuid.slice(0, 6)}`;
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
