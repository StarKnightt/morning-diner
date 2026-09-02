/**
 * Wire format between the texture worker (src/procedural/texWorker.ts) and the
 * main-thread TextureBank. The worker runs a generator from
 * procedural/textures.ts or procedural/exterior.ts on an OffscreenCanvas and
 * ships each resulting canvas back as an ImageBitmap together with the sampler
 * state `finish()` (and the generator itself) set on the THREE.Texture.
 */
import type * as THREE from "three";

export interface TexProps {
  wrapS: THREE.Wrapping;
  wrapT: THREE.Wrapping;
  colorSpace: string;
  anisotropy: number;
  generateMipmaps: boolean;
  minFilter: THREE.MinificationTextureFilter;
  magFilter: THREE.MagnificationTextureFilter;
  flipY: boolean;
  premultiplyAlpha: boolean;
  unpackAlignment: number;
  format: THREE.AnyPixelFormat;
  type: THREE.TextureDataType;
  repeat: [number, number];
  offset: [number, number];
  center: [number, number];
  rotation: number;
}

export interface JobRequest {
  id: number;
  mod: string;
  fn: string;
  args: unknown[];
}

export interface PackedTexture {
  key: string;
  bitmap: ImageBitmap;
  props: TexProps;
}

export interface JobReply {
  id: number;
  ms: number;
  /** True when the generator returned a single texture rather than a set. */
  direct: boolean;
  entries: PackedTexture[];
  error?: string;
}

export function propsOf(t: THREE.Texture): TexProps {
  return {
    wrapS: t.wrapS,
    wrapT: t.wrapT,
    colorSpace: t.colorSpace,
    anisotropy: t.anisotropy,
    generateMipmaps: t.generateMipmaps,
    minFilter: t.minFilter,
    magFilter: t.magFilter,
    flipY: t.flipY,
    premultiplyAlpha: t.premultiplyAlpha,
    unpackAlignment: t.unpackAlignment,
    format: t.format,
    type: t.type,
    repeat: [t.repeat.x, t.repeat.y],
    offset: [t.offset.x, t.offset.y],
    center: [t.center.x, t.center.y],
    rotation: t.rotation,
  };
}

/**
 * Fill a placeholder texture with a generated image and the generator's sampler
 * state. UV transform fields are only taken from the generator if the call site
 * has not already set them on the placeholder: `materials.ts` does
 * `boomerang.map.repeat.set(...)` right after the (asynchronous) call, and the
 * call site must win over the generator's own default, exactly as it does when
 * the generator runs synchronously.
 */
export function applyProps(target: THREE.Texture, image: ImageBitmap | HTMLCanvasElement | OffscreenCanvas, p: TexProps): void {
  target.image = image;
  target.wrapS = p.wrapS;
  target.wrapT = p.wrapT;
  target.colorSpace = p.colorSpace;
  target.anisotropy = p.anisotropy;
  target.generateMipmaps = p.generateMipmaps;
  target.minFilter = p.minFilter;
  target.magFilter = p.magFilter;
  target.flipY = p.flipY;
  target.premultiplyAlpha = p.premultiplyAlpha;
  target.unpackAlignment = p.unpackAlignment;
  target.format = p.format;
  target.type = p.type;
  if (target.repeat.x === 1 && target.repeat.y === 1) target.repeat.set(p.repeat[0], p.repeat[1]);
  if (target.offset.x === 0 && target.offset.y === 0) target.offset.set(p.offset[0], p.offset[1]);
  if (target.center.x === 0 && target.center.y === 0) target.center.set(p.center[0], p.center[1]);
  if (target.rotation === 0) target.rotation = p.rotation;
  target.needsUpdate = true;
}
