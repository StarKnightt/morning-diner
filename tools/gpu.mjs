/**
 * Shared GPU launch flags and hardware-renderer assertion for the harnesses.
 *
 * Playwright's default headless mode launches chrome-headless-shell, which has
 * no GPU stack and silently falls back to SwiftShader. `channel: "chromium"`
 * launches full Chromium in new-headless mode, which does reach the adapter.
 * ANGLE-over-D3D11 is the path that lands on the NVIDIA card on Windows.
 *
 * Never add --enable-unsafe-swiftshader, --disable-gpu or --use-gl=swiftshader.
 */

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software\s*rasteriz|microsoft basic render|basic render/i;

export function launchOptions() {
  return {
    channel: "chromium",
    headless: true,
    args: [
      "--use-angle=d3d11",
      "--use-gl=angle",
      "--enable-gpu",
      "--enable-gpu-rasterization",
      "--ignore-gpu-blocklist",
      "--force_high_performance_gpu",
      "--hide-scrollbars",
      "--mute-audio",
    ],
  };
}

export function isSoftwareRenderer(renderer) {
  return SOFTWARE_RENDERER.test(String(renderer ?? ""));
}

/** Reads the renderer string from a throwaway WebGL2 context on the page. */
export async function readLaunchRenderer(page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2", { powerPreference: "high-performance" }) ??
      canvas.getContext("webgl", { powerPreference: "high-performance" });
    if (!gl) return "no webgl context";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
}

/**
 * Reads the renderer string from the LIVE context three.js drew with (via
 * window.__stats, installed by src/capture/pose.ts). Throws on software.
 */
export async function assertSceneGpu(page, tag = "shoot") {
  const stats = await page.evaluate(() => (window.__stats ? window.__stats() : null));
  if (!stats) throw new Error(`[${tag}] window.__stats missing - page did not boot`);
  console.log(`[gpu] ${stats.renderer}`);
  if (isSoftwareRenderer(stats.renderer)) {
    throw new Error(`[${tag}] refusing to capture on a software rasteriser: ${stats.renderer}`);
  }
  return stats;
}
