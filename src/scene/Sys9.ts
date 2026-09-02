/**
 * System 9 build entry: the openables (Openables.ts) and the implied-presence props
 * (Presence.ts) share one static builder whose buckets are appended to the scene's
 * existing merged meshes (core/mergeInto.ts). Called once from Diner.build after the
 * props, so every host mesh exists; `own` lists the buckets that had to become meshes
 * of their own (the presence atlas, and anything whose host has a different vertex layout).
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { MergedBuilder } from "../core/merge";
import { mergeIntoHosts } from "../core/mergeInto";
import type { TextureBank } from "../core/textureBank";
import { buildOpenables, type OpenablesResult } from "./Openables";
import { buildPresence, type PresenceResult } from "./Presence";

export interface System9 {
  openables: OpenablesResult;
  presence: PresenceResult;
  /** Buckets that became their own meshes (draw-call accounting). */
  own: THREE.Mesh[];
  hosted: number;
}

export function buildSystem9(root: THREE.Group, pal: Palette, bank?: TextureBank): System9 {
  const statics = new MergedBuilder();
  const openables = buildOpenables(root, pal, statics);
  const presence = buildPresence(statics, pal, bank);
  const group = new THREE.Group();
  group.name = "sys9";
  root.add(group);
  const { hosted, own } = mergeIntoHosts(root, group, statics, "sys9");
  return { openables, presence, own, hosted };
}
