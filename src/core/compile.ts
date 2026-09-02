/**
 * Parallel shader compilation.
 *
 * On ANGLE/D3D11 every three.js program is an HLSL compile of a large physical
 * shader: ~0.25–0.5 s each, and this room needs ~80 programs *per variant*.
 * There are three variants, because program parameters include the output
 * (canvas: ACES + sRGB, vs. render target: linear, no tone mapping) and the
 * environment map's PMREM height:
 *
 *   A  render target + procedural room env   → the three CubeCamera probes
 *   B  canvas        + probe env             → the main pass
 *   C  render target + probe env             → the transmission pass (window
 *                                              and door glass, glassware) —
 *                                              lazily compiled mid-walk before,
 *                                              a multi-second hitch
 *
 * Linked one at a time on first use that was ~43 s of a ~49 s cold start.
 * `renderer.compile()` issues every link at once; with KHR_parallel_shader_compile
 * (exposed by Chromium) ANGLE links on a thread pool and `WebGLProgram.isReady()`
 * polls COMPLETION_STATUS_KHR without blocking. Diner.build() issues all three
 * variants back to back (B and C against a blank stand-in environment of the
 * probes' PMREM size — the program key only carries the height) so the whole
 * set links while the texture workers are still drawing. Nothing about the
 * programs changes — only when they are linked.
 */
import * as THREE from "three";
import { sleep } from "./scheduler";

/**
 * Create every program the scene needs for the given output. Passing a render
 * target compiles the render-target variant (used by the probes and the
 * transmission pass); `null` compiles the canvas variant. Returns immediately —
 * the links proceed in the driver's worker threads.
 */
export function issueCompile(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, target: THREE.WebGLRenderTarget | null): void {
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target, 0);
  renderer.compile(scene, camera);
  renderer.setRenderTarget(previous);
}

interface ProgramLike {
  isReady(): boolean;
}

/** Number of programs in the renderer's cache and how many have finished linking. */
export function programStatus(renderer: THREE.WebGLRenderer): { ready: number; total: number } {
  const programs = renderer.info.programs as unknown as ProgramLike[] | null;
  if (!programs) return { ready: 0, total: 0 };
  let ready = 0;
  for (const p of programs) if (p.isReady()) ready++;
  return { ready, total: programs.length };
}

/**
 * Resolve when every issued program has linked. Polls at ~20 ms so the loader
 * can show real progress; without the parallel-compile extension `isReady()`
 * blocks per program, which still only costs what first use would have.
 */
export async function waitForPrograms(renderer: THREE.WebGLRenderer, onProgress?: (ready: number, total: number) => void): Promise<{ ready: number; total: number }> {
  for (;;) {
    const s = programStatus(renderer);
    onProgress?.(s.ready, s.total);
    if (s.ready >= s.total) return s;
    await sleep(20);
  }
}

/** Whether the live context can link in parallel (informational; the pipeline works either way). */
export function hasParallelCompile(renderer: THREE.WebGLRenderer): boolean {
  return renderer.getContext().getExtension("KHR_parallel_shader_compile") !== null;
}
