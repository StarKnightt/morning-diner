/**
 * Per-pass GPU timing with EXT_disjoint_timer_query_webgl2. Queries are
 * allocated once (a small ring per label) and read back a few frames later;
 * nothing is allocated per frame. `timings()` returns an EMA in milliseconds
 * per label, or null when the extension is unavailable (ANGLE/D3D11 on the
 * 4060 exposes it; SwiftShader does not, which is another reason to assert
 * the GPU before trusting numbers).
 */
interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
  QUERY_RESULT_AVAILABLE_EXT?: number;
}

const RING = 6;

interface Slot {
  queries: WebGLQuery[];
  pending: boolean[];
  head: number;
  ema: number;
  last: number;
  samples: number;
}

export class GpuTimer {
  readonly available: boolean;
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: TimerExt | null;
  private readonly slots = new Map<string, Slot>();
  private active: Slot | null = null;
  private order: string[] = [];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExt | null;
    this.available = !!this.ext;
  }

  private slot(label: string): Slot {
    let s = this.slots.get(label);
    if (!s) {
      const queries: WebGLQuery[] = [];
      for (let i = 0; i < RING; i++) queries.push(this.gl.createQuery()!);
      s = { queries, pending: new Array(RING).fill(false), head: 0, ema: 0, last: 0, samples: 0 };
      this.slots.set(label, s);
      this.order.push(label);
    }
    return s;
  }

  begin(label: string): void {
    if (!this.ext || this.active) return;
    const s = this.slot(label);
    this.collect(s);
    if (s.pending[s.head]) return; // ring full: skip this frame's measurement
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, s.queries[s.head]);
    this.active = s;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    const s = this.active;
    s.pending[s.head] = true;
    s.head = (s.head + 1) % RING;
    this.active = null;
  }

  private collect(s: Slot): void {
    const gl = this.gl, ext = this.ext!;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
    for (let i = 0; i < RING; i++) {
      if (!s.pending[i]) continue;
      const q = s.queries[i];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
      s.pending[i] = false;
      if (disjoint) continue;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      const ms = ns / 1e6;
      s.last = ms;
      s.samples++;
      s.ema = s.samples === 1 ? ms : s.ema + (ms - s.ema) * 0.08;
    }
  }

  /** { label: { ema, last, samples } } in ms, in first-seen order. */
  timings(): Record<string, { ema: number; last: number; samples: number }> | null {
    if (!this.ext) return null;
    const out: Record<string, { ema: number; last: number; samples: number }> = {};
    for (const label of this.order) {
      const s = this.slots.get(label)!;
      this.collect(s);
      out[label] = { ema: s.ema, last: s.last, samples: s.samples };
    }
    return out;
  }

  reset(): void {
    for (const s of this.slots.values()) {
      s.ema = 0;
      s.last = 0;
      s.samples = 0;
    }
  }
}
