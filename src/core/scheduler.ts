/**
 * Cooperative scheduling for the boot sequence.
 *
 * The room is built by ~30 synchronous generators (canvas textures, merged
 * geometry, cube-map probes, shader links). Run back to back they block the
 * main thread for tens of seconds and the loading screen never paints. The
 * boot pipeline instead awaits `yieldToPaint()` between tasks so the browser
 * gets one frame per task, and reports weighted progress through `Progress`.
 *
 * Nothing here changes what any task produces — only when it runs.
 */

/**
 * Resolve after the browser has had a chance to paint: wait for the next
 * animation frame, then let the paint that follows it happen (a task queued
 * from inside rAF runs after the frame is presented). Hidden tabs do not get
 * animation frames, so a 120 ms timer keeps the pipeline moving there.
 */
export function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(() => setTimeout(finish, 0));
    setTimeout(finish, 120);
  });
}

/** Plain macrotask yield (no paint guarantee) — for tight polling loops. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ProgressListener {
  (fraction: number, label: string): void;
}

/**
 * Weighted progress model. Each named part has a weight and a completion
 * fraction in [0, 1]; the overall fraction is the weighted mean. Parts that
 * run concurrently (worker textures vs main-thread geometry) each move their
 * own fraction and the bar stays monotonic.
 */
export class Progress {
  private readonly parts = new Map<string, { weight: number; done: number }>();
  private label = "";
  private last = -1;

  constructor(
    weights: Record<string, number>,
    private readonly listener: ProgressListener,
  ) {
    for (const [name, weight] of Object.entries(weights)) this.parts.set(name, { weight, done: 0 });
  }

  /** Set a part's completion (clamped, never decreasing) and optionally the stage label. */
  set(part: string, fraction: number, label?: string): void {
    const p = this.parts.get(part);
    if (!p) throw new Error(`Progress: unknown part "${part}"`);
    p.done = Math.max(p.done, Math.min(1, Math.max(0, fraction)));
    if (label !== undefined) this.label = label;
    this.emit();
  }

  /** Mark a part complete. */
  complete(part: string, label?: string): void {
    this.set(part, 1, label);
  }

  /** Change the stage label without moving the bar. */
  stage(label: string): void {
    this.label = label;
    this.emit();
  }

  get fraction(): number {
    let sum = 0, total = 0;
    for (const p of this.parts.values()) {
      sum += p.weight * p.done;
      total += p.weight;
    }
    return total > 0 ? sum / total : 1;
  }

  private emit(): void {
    const f = this.fraction;
    // Only forward changes the DOM can show (the bar is ~1000 px wide at most).
    if (Math.abs(f - this.last) < 0.0005 && this.lastLabel === this.label) return;
    this.last = f;
    this.lastLabel = this.label;
    this.listener(f, this.label);
  }
  private lastLabel = "";
}

/** Boot timeline: `performance.now()` marks per stage, exposed as `window.__perf()` for the harness. */
export class BootTimeline {
  private readonly t0 = performance.now();
  private readonly marks: Array<{ name: string; ms: number; dt: number }> = [];
  private lastMs = 0;

  mark(name: string): void {
    const ms = performance.now() - this.t0;
    this.marks.push({ name, ms: Math.round(ms), dt: Math.round(ms - this.lastMs) });
    this.lastMs = ms;
    performance.mark(`boot:${name}`);
  }

  list(): Array<{ name: string; ms: number; dt: number }> {
    return this.marks.slice();
  }

  get elapsedMs(): number {
    return performance.now() - this.t0;
  }
}
