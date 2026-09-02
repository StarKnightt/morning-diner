/**
 * Debug / capture surface used by tools/shoot.mjs. Nothing here is UI: it is a
 * handful of globals on `window` that the headless harness drives.
 *
 *   window.__ready                  Promise that resolves once the scene has rendered
 *                                   (probes baked, two frames drawn); installed before
 *                                   any async boot work starts
 *   window.__SCENE_READY            true at the same moment (polled by the harness)
 *   window.__setPose({x,y?,z,yaw,pitch})  teleport the camera; angles in degrees
 *   window.__stats()                { calls, triangles, renderer }
 *   window.__perf()                 boot timeline: [{ name, ms, dt }] plus texture-worker stats
 */
import type * as THREE from "three";
import type { FirstPerson } from "../player/FirstPerson";

export interface Pose {
  x: number;
  y?: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface PerfReport {
  marks: Array<{ name: string; ms: number; dt: number }>;
  textures: { workers: number; wallMs: number; jobs: Array<{ fn: string; ms: number; where: string }> };
  programs: number;
  parallelCompile: boolean;
}

declare global {
  interface Window {
    __ready?: Promise<void>;
    __SCENE_READY?: boolean;
    __setPose?: (p: Pose) => void;
    __stats?: () => { calls: number; triangles: number; renderer: string };
    __perf?: () => PerfReport;
    __APP?: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera };
  }
}

export function gpuRendererString(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  return dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
}

/** Install `__ready` / `__SCENE_READY` first thing, so a harness can await them before the scene exists. */
export function installReadyPromise(): () => void {
  window.__SCENE_READY = false;
  let resolve!: () => void;
  window.__ready = new Promise<void>((r) => (resolve = r));
  return () => {
    window.__SCENE_READY = true;
    resolve();
  };
}

export function installCaptureApi(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  player: FirstPerson,
  perf: () => PerfReport,
): void {
  window.__APP = { renderer, scene, camera };
  window.__setPose = (p: Pose) => player.setPose(p.x, p.y, p.z, p.yaw, p.pitch);
  window.__stats = () => ({
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    renderer: gpuRendererString(renderer),
  });
  window.__perf = perf;
}
