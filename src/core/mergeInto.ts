/**
 * Append a MergedBuilder's buckets to merged meshes that already exist in the scene
 * (same material → same mesh), so late geometry costs no new draw calls. A bucket
 * with no host — a material nothing else uses, or a host whose vertex layout differs
 * (vertex colours) — is built as its own mesh under `parent`, as `build` would.
 *
 * Hosts are the `name:material` meshes MergedBuilder.build emits (never an
 * InstancedMesh, never a stand-alone prop like the pour mug, which share materials
 * with the merged buckets but move).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MergedBuilder } from "./merge";

export function mergeIntoHosts(root: THREE.Object3D, parent: THREE.Object3D, b: MergedBuilder, name: string): { hosted: number; own: THREE.Mesh[] } {
  const staging = new THREE.Group();
  const meshes = b.build(staging, { name });
  const own: THREE.Mesh[] = [];
  let hosted = 0;
  for (const mesh of meshes) {
    const host = findHost(root, mesh.material as THREE.Material);
    const merged = host ? appendGeometry(host.geometry, mesh.geometry) : null;
    if (host && merged) {
      host.geometry.dispose();
      host.geometry = merged;
      mesh.geometry.dispose();
      hosted++;
    } else {
      parent.add(mesh);
      own.push(mesh);
    }
  }
  return { hosted, own };
}

const IDENTITY = new THREE.Matrix4();
const EPS = 1e-6;

/**
 * A host must sit at the world origin with no rotation or scale: the bucket geometry is
 * authored in world space, and a merged mesh inside a placed prop group (rev 1's
 * `blackPlastic` host was the napkin dispenser's) would carry it off to wherever the
 * group is. Hidden hosts are skipped too.
 */
function findHost(root: THREE.Object3D, material: THREE.Material): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (found) return;
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || m.material !== material) return;
    if (!m.name.includes(":") || !m.visible) return;
    const e = m.matrixWorld.elements, i = IDENTITY.elements;
    for (let k = 0; k < 16; k++) if (Math.abs(e[k] - i[k]) > EPS) return;
    found = m;
  });
  return found;
}

function appendGeometry(host: THREE.BufferGeometry, add: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const keysA = Object.keys(host.attributes).sort().join(), keysB = Object.keys(add.attributes).sort().join();
  if (keysA !== keysB) return null;
  let a = host, c = add;
  if (!!a.index !== !!c.index) {
    a = a.index ? a.toNonIndexed() : a;
    c = c.index ? c.toNonIndexed() : c;
  }
  const merged = mergeGeometries([a, c], false);
  if (!merged) return null;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
