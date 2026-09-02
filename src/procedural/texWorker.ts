/**
 * Texture worker. Runs the canvas generators from textures.ts / exterior.ts
 * unchanged — `canvas()` in those modules creates an OffscreenCanvas when there
 * is no `document` — and posts every resulting canvas back to the main thread
 * as a transferred ImageBitmap plus the sampler state the generator set.
 *
 * The generators are pure functions of their arguments (each seeds its own
 * PRNG), so the output is byte-identical to the main-thread path; the
 * TextureBank keeps that path as the fallback.
 */
import type * as THREE from "three";
import * as ext from "./exterior";
import * as pres from "./presence";
import * as tex from "./textures";
import { propsOf, type JobReply, type JobRequest, type PackedTexture } from "../core/texProtocol";

type Generator = (...args: never[]) => unknown;
const MODULES: Record<string, Record<string, Generator>> = {
  tex: tex as unknown as Record<string, Generator>,
  ext: ext as unknown as Record<string, Generator>,
  pres: pres as unknown as Record<string, Generator>,
};

function isTexture(v: unknown): v is THREE.Texture {
  return !!v && typeof v === "object" && (v as { isTexture?: boolean }).isTexture === true;
}

/**
 * WebGL ignores UNPACK_FLIP_Y_WEBGL / UNPACK_PREMULTIPLY_ALPHA_WEBGL for ImageBitmap
 * sources (the bitmap's own orientation and alpha state are used), so the flip
 * and alpha handling a CanvasTexture normally gets at upload time are baked into
 * the bitmap here instead, and the main-thread texture is marked flipY=false.
 * A vertical flip and an un-premultiply are the same operations the canvas
 * upload path performs, so the texels that reach the GPU are the same bytes.
 */
async function pack(key: string, t: THREE.Texture, transfer: Transferable[]): Promise<PackedTexture> {
  const canvas = t.image as OffscreenCanvas;
  const bitmap = await createImageBitmap(canvas, {
    imageOrientation: t.flipY ? "flipY" : "none",
    premultiplyAlpha: t.premultiplyAlpha ? "premultiply" : "none",
    colorSpaceConversion: "none",
  });
  transfer.push(bitmap);
  const props = propsOf(t);
  props.flipY = false;
  return { key, bitmap, props };
}

self.onmessage = async (e: MessageEvent<JobRequest>) => {
  const { id, mod, fn, args } = e.data;
  const t0 = performance.now();
  const transfer: Transferable[] = [];
  let reply: JobReply;
  try {
    const generator = MODULES[mod]?.[fn];
    if (!generator) throw new Error(`texWorker: unknown generator ${mod}.${fn}`);
    const result = generator(...(args as never[]));
    const entries: PackedTexture[] = [];
    let direct = false;
    if (isTexture(result)) {
      direct = true;
      entries.push(await pack("", result, transfer));
    } else if (result && typeof result === "object") {
      for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
        if (isTexture(value)) entries.push(await pack(key, value, transfer));
      }
    } else {
      throw new Error(`texWorker: ${mod}.${fn} returned no textures`);
    }
    reply = { id, ms: performance.now() - t0, direct, entries };
  } catch (err) {
    reply = { id, ms: performance.now() - t0, direct: false, entries: [], error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(reply, { transfer });
};
