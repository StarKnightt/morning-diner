/**
 * TextureBank — runs the procedural canvas generators off the main thread.
 *
 * `bank.proxy(texModule, "tex")` returns a drop-in replacement for the module:
 * calling `tex.woodVeneer(1024, 0.5, opts)` on it returns the same *shape* of
 * result ({ map, roughnessMap, normalMap }) immediately, but the textures are
 * empty placeholders and the generator itself runs in a Web Worker on an
 * OffscreenCanvas. When the worker replies, the ImageBitmap and the sampler
 * state land in the placeholders (`applyProps`) and `needsUpdate` is raised.
 * Call sites therefore stay exactly as they were (materials.ts and Exterior.ts
 * only swap the module they call), and nothing renders before `ready()`.
 *
 * Guarantees:
 *  - Output is pixel-identical to the synchronous path: every generator seeds
 *    its own PRNG and the 2D canvas rasteriser is the same in a worker.
 *  - A generator that is not in SHAPES (e.g. one added later) falls through to
 *    the synchronous call — correct, just not parallel. `?debug` logs it.
 *  - No Worker / OffscreenCanvas support, or a worker failure, falls back to
 *    running the job on the main thread inside `ready()`, one job per frame.
 *  - After `ready()` resolves the bank closes and every further call is
 *    synchronous, so textures redrawn at runtime keep a real canvas.
 */
import * as THREE from "three";
import { applyProps, propsOf, type JobReply, type JobRequest } from "./texProtocol";
import { yieldToPaint } from "./scheduler";

type Shape = "direct" | readonly string[];

/** Result shape of every generator that may run in a worker (module → function → texture keys). */
const SHAPES: Record<string, Record<string, Shape>> = {
  tex: {
    checkerFloor: ["map", "roughnessMap", "normalMap"],
    paintedWall: ["map", "roughnessMap"],
    acousticTile: ["map", "roughnessMap", "normalMap"],
    vinylSurface: ["normalMap", "roughnessMap", "map"],
    formicaBoomerang: ["map", "roughnessMap"],
    woodVeneer: ["map", "roughnessMap", "normalMap"],
    prismLens: ["normalMap", "map"],
    trofferLens: ["emissiveMap"],
    formicaSpeckle: ["map"],
    glazeSpeckle: ["map"],
    brushedRoughness: "direct",
    speckleRoughness: "direct",
    asphalt: ["map"],
    concrete: ["map"],
    // System 5 (materials branch): wear and dressing maps
    floorGrout: "direct",
    wallStipple: ["normalMap", "aoMap"],
    teePaint: ["map", "roughnessMap"],
    laminateWear: ["map", "roughnessMap"],
    scuffRoughness: "direct",
    handWear: "direct",
    fingerprints: "direct",
    carafeScratches: "direct",
    tideLineAlpha: "direct",
    baseboardScuff: ["map", "roughnessMap"],
    doorDecals: "direct",
    // System 5 rev 3
    vinylCrazeAtlas: ["map"],
    kickPlateWear: ["map", "roughnessMap"],
  },
  ext: {
    lotSurface: ["map", "roughnessMap"],
    asphaltDetail: ["normalMap", "roughnessMap"],
    glassDust: "direct",
    handprintAlpha: "direct",
    slatDust: ["roughnessMap", "map"],
    desertDirt: "direct",
    blockWall: ["map", "roughnessMap"],
    contactShadowAlpha: "direct",
  },
  // System 9 (src/procedural/presence.ts): the apron / cardigan / newspaper / plate atlas.
  pres: {
    presenceAtlas: ["map", "roughnessMap", "normalMap"],
  },
};

/** Loader stage labels ("Generating <label>…"). */
const LABELS: Record<string, string> = {
  checkerFloor: "checker floor",
  paintedWall: "painted walls",
  acousticTile: "ceiling tile",
  vinylSurface: "vinyl grain",
  formicaBoomerang: "boomerang laminate",
  woodVeneer: "wood veneer",
  prismLens: "troffer lenses",
  trofferLens: "fluorescent tubes",
  formicaSpeckle: "speckle laminate",
  glazeSpeckle: "china glaze",
  brushedRoughness: "brushed steel",
  speckleRoughness: "granular sugar",
  asphalt: "asphalt",
  concrete: "concrete",
  lotSurface: "the parking lot",
  asphaltDetail: "asphalt aggregate",
  glassDust: "window dust",
  handprintAlpha: "handprints",
  slatDust: "blind slats",
  desertDirt: "desert dirt",
  blockWall: "block wall",
  contactShadowAlpha: "contact shadows",
  floorGrout: "grout joints",
  wallStipple: "roller stipple",
  teePaint: "grid tees",
  laminateWear: "laminate scratches",
  scuffRoughness: "chrome scuffs",
  handWear: "hand-worn chrome",
  fingerprints: "fingerprints",
  carafeScratches: "decanter scratches",
  tideLineAlpha: "coffee tide line",
  baseboardScuff: "cove base",
  doorDecals: "door signage",
  vinylCrazeAtlas: "cracked vinyl",
  kickPlateWear: "kick plate",
  presenceAtlas: "the apron and the paper",
};

/** Rough pixel count so the pool starts the big jobs first (longest-processing-time first). */
function estimateCost(fn: string, args: unknown[]): number {
  const n = (i: number) => (typeof args[i] === "number" ? (args[i] as number) : 1);
  switch (fn) {
    case "checkerFloor":
      return n(0) * n(1) * n(2) * n(2) * 3 + 1024 * 1024; // + its 2 × 2-tile grout normal
    case "wallStipple":
    case "acousticTile":
      return n(0) * n(0) * 2.5;
    case "laminateWear":
      return n(0) * n(0) * 1.5;
    case "lotSurface":
      return n(0) * n(0) * 0.5 * 3;
    case "vinylSurface":
      return n(0) * n(0) * 3;
    case "vinylCrazeAtlas":
      return n(0) * n(0) * 2;
    case "woodVeneer":
      return n(0) * n(0) * 3;
    case "formicaBoomerang":
      return n(0) * n(0) * 1.5;
    case "slatDust":
      return n(0) * n(0) / 8;
    case "blockWall":
      return n(0) * n(0) / 2;
    default:
      return n(0) * n(0);
  }
}

interface Job {
  id: number;
  mod: string;
  fn: string;
  args: unknown[];
  shape: Shape;
  cost: number;
  /** The synchronous generator, for the main-thread fallback. */
  run: (...args: unknown[]) => unknown;
  /** Placeholder textures keyed by result field ("" for a direct texture). */
  targets: Map<string, THREE.Texture>;
  ms?: number;
  where?: "worker" | "main";
  /** performance.now() when the job was handed to a worker (or run on the main thread). */
  start?: number;
}

export interface TextureBankOptions {
  /** Worker count; default `hardwareConcurrency - 2` clamped to [2, 8]. 0 forces the main-thread path. */
  workers?: number;
  onProgress?: (done: number, total: number, label: string) => void;
  debug?: boolean;
}

export interface TextureBankStats {
  workers: number;
  /** `start` is ms since time origin; `ms` is the generator's own run time. */
  jobs: Array<{ fn: string; start: number; ms: number; where: "worker" | "main" }>;
  /** Wall time from the first dispatch to the last arrival. */
  wallMs: number;
}

export class TextureBank {
  private readonly jobs = new Map<number, Job>();
  private readonly queue: Job[] = [];
  private readonly mainQueue: Job[] = [];
  private readonly workers: Array<{ worker: Worker; busy: Job | null }> = [];
  private readonly workerCount: number;
  private readonly onProgress?: (done: number, total: number, label: string) => void;
  private readonly debug: boolean;
  private nextId = 1;
  private done = 0;
  private closed = false;
  private tFirst = 0;
  private tLast = 0;
  /** `ready()` parks here while workers are busy; every state change wakes it. */
  private waiters: Array<() => void> = [];

  constructor(opts: TextureBankOptions = {}) {
    const supported = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
    const hc = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    this.workerCount = supported ? (opts.workers ?? Math.min(8, Math.max(2, hc - 2))) : 0;
    this.onProgress = opts.onProgress;
    this.debug = !!opts.debug;
  }

  /** Total jobs dispatched so far. */
  get total(): number {
    return this.jobs.size;
  }

  /** Jobs still generating. */
  get pending(): number {
    return this.jobs.size - this.done;
  }

  /**
   * Wrap a generator module. Functions listed in SHAPES return placeholders and
   * run in a worker; everything else is passed through untouched.
   */
  proxy<T extends object>(mod: T, name: keyof typeof SHAPES & string): T {
    const shapes = SHAPES[name] ?? {};
    // Module namespace objects are exotic; proxy a plain copy so the trap invariants hold.
    const target = { ...mod } as Record<string, unknown>;
    return new Proxy(target, {
      get: (t, prop) => {
        const value = t[prop as string];
        const shape = shapes[prop as string];
        if (typeof value !== "function" || !shape || this.closed) {
          if (typeof value === "function" && shape === undefined && this.debug && !this.closed) {
            console.log(`[tex] ${name}.${String(prop)} has no SHAPES entry — running synchronously`);
          }
          return value;
        }
        return (...args: unknown[]) => this.dispatch(name, prop as string, value as Job["run"], args, shape);
      },
    }) as T;
  }

  /**
   * Resolve when every dispatched job has landed in its placeholders. Jobs that
   * must run on the main thread (no workers, or a worker failed) run here, one
   * per painted frame, so the loading bar keeps moving. Closes the bank.
   */
  async ready(): Promise<void> {
    for (;;) {
      const job = this.mainQueue.shift() ?? (this.workerCount === 0 ? this.queue.shift() : undefined);
      if (job) {
        this.runOnMain(job);
        await yieldToPaint();
        continue;
      }
      if (this.done === this.jobs.size) break;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.closed = true;
    for (const w of this.workers) w.worker.terminate();
    this.workers.length = 0;
  }

  stats(): TextureBankStats {
    return {
      workers: this.workerCount,
      jobs: [...this.jobs.values()].map((j) => ({ fn: j.fn, start: Math.round(j.start ?? 0), ms: Math.round(j.ms ?? 0), where: j.where ?? "main" })),
      wallMs: Math.round(this.tLast - this.tFirst),
    };
  }

  /* ------------------------------------------------------------------ */

  private dispatch(mod: string, fn: string, run: Job["run"], args: unknown[], shape: Shape): unknown {
    if (!this.tFirst) this.tFirst = performance.now();
    const targets = new Map<string, THREE.Texture>();
    let result: unknown;
    if (shape === "direct") {
      const t = new THREE.Texture();
      t.name = fn;
      targets.set("", t);
      result = t;
    } else {
      const set: Record<string, THREE.Texture> = {};
      for (const key of shape) {
        const t = new THREE.Texture();
        t.name = `${fn}.${key}`;
        targets.set(key, t);
        set[key] = t;
      }
      result = set;
    }
    const job: Job = { id: this.nextId++, mod, fn, args, shape, cost: estimateCost(fn, args), run, targets };
    this.jobs.set(job.id, job);
    if (this.workerCount === 0) this.queue.push(job);
    else {
      this.queue.push(job);
      this.queue.sort((a, b) => b.cost - a.cost);
      this.pump();
    }
    return result;
  }

  private pump(): void {
    while (this.workers.length < this.workerCount && this.queue.length > this.workers.length) this.spawn();
    for (const w of this.workers) {
      if (w.busy || !this.queue.length) continue;
      const job = this.queue.shift()!;
      w.busy = job;
      job.start = performance.now();
      const msg: JobRequest = { id: job.id, mod: job.mod, fn: job.fn, args: job.args };
      w.worker.postMessage(msg);
    }
  }

  private spawn(): void {
    const worker = new Worker(new URL("../procedural/texWorker.ts", import.meta.url), { type: "module", name: `tex-${this.workers.length}` });
    const slot = { worker, busy: null as Job | null };
    worker.onmessage = (e: MessageEvent<JobReply>) => {
      const job = slot.busy;
      slot.busy = null;
      if (!job || job.id !== e.data.id) {
        console.warn("[tex] stray worker reply", e.data.id);
        this.pump();
        return;
      }
      if (e.data.error) {
        console.warn(`[tex] ${job.fn} failed in worker (${e.data.error}); running on the main thread`);
        this.mainQueue.push(job);
        this.wake();
      } else {
        for (const entry of e.data.entries) {
          const t = job.targets.get(entry.key);
          if (!t) {
            console.warn(`[tex] ${job.fn} returned unexpected field "${entry.key}"`);
            continue;
          }
          applyProps(t, entry.bitmap, entry.props);
        }
        for (const [key, t] of job.targets) {
          if (!t.image) console.warn(`[tex] ${job.fn}.${key || "(direct)"} received no image`);
        }
        this.finish(job, e.data.ms, "worker");
      }
      this.pump();
    };
    worker.onerror = (ev) => {
      console.warn(`[tex] worker error (${ev.message}); ${slot.busy ? `re-running ${slot.busy.fn} on the main thread` : "no job in flight"}`);
      ev.preventDefault();
      const job = slot.busy;
      slot.busy = null;
      if (job) this.mainQueue.push(job);
      worker.terminate();
      const i = this.workers.indexOf(slot);
      if (i >= 0) this.workers.splice(i, 1);
      // Anything still queued for a pool that keeps failing runs on the main thread.
      if (this.workers.length === 0) this.mainQueue.push(...this.queue.splice(0));
      else this.pump();
      this.wake();
    };
    this.workers.push(slot);
  }

  private runOnMain(job: Job): void {
    const t0 = performance.now();
    job.start = t0;
    const result = job.run(...job.args);
    if (job.shape === "direct") {
      const real = result as THREE.Texture;
      applyProps(job.targets.get("")!, real.image as HTMLCanvasElement, propsOf(real));
    } else {
      const set = result as Record<string, THREE.Texture>;
      for (const [key, t] of job.targets) {
        const real = set[key];
        if (!real) {
          console.warn(`[tex] ${job.fn} did not return "${key}"`);
          continue;
        }
        applyProps(t, real.image as HTMLCanvasElement, propsOf(real));
      }
    }
    this.finish(job, performance.now() - t0, "main");
  }

  private finish(job: Job, ms: number, where: "worker" | "main"): void {
    job.ms = ms;
    job.where = where;
    this.done++;
    this.tLast = performance.now();
    if (this.debug) console.log(`[tex] ${job.fn.padEnd(18)} ${ms.toFixed(0).padStart(5)} ms  (${where})`);
    this.onProgress?.(this.done, this.jobs.size, LABELS[job.fn] ?? job.fn);
    this.wake();
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const resolve of w) resolve();
  }
}
