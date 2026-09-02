/**
 * Debug / capture surface used by tools/shoot.mjs. Nothing here is UI: it is a
 * handful of globals on `window` that the headless harness drives.
 *
 *   window.__SCENE_READY            true once two frames have rendered
 *   window.__setPose({x,y?,z,yaw,pitch})  teleport the camera; angles in degrees
 *   window.__stats()                { calls, triangles, renderer }
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

declare global {
  interface Window {
    __SCENE_READY?: boolean;
    __setPose?: (p: Pose) => void;
    __stats?: () => { calls: number; triangles: number; renderer: string };
    __APP?: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera };
  }
}

export function gpuRendererString(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  return dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
}

export function installCaptureApi(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  player: FirstPerson,
): void {
  window.__SCENE_READY = false;
  window.__APP = { renderer, scene, camera };
  window.__setPose = (p: Pose) => player.setPose(p.x, p.y, p.z, p.yaw, p.pitch);
  window.__stats = () => ({
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    renderer: gpuRendererString(renderer),
  });
}

export function markSceneReady(): void {
  window.__SCENE_READY = true;
}
