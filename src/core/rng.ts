/** Small deterministic PRNG (mulberry32) so every build produces identical textures. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D value noise in [0,1], tileable over `period` lattice cells. */
export function makeValueNoise(seed: number, period: number) {
  if (!Number.isInteger(period) || period < 1) throw new Error(`makeValueNoise: period must be a positive integer (got ${period})`);
  const rng = makeRng(seed);
  const lattice = new Float32Array(period * period);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
  const at = (ix: number, iy: number) =>
    lattice[((iy % period + period) % period) * period + ((ix % period + period) % period)];
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = fade(x - x0), fy = fade(y - y0);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
}

/** Fractal (tileable) noise in [0,1] over unit UV space. */
export function makeFbm(seed: number, basePeriod: number, octaves: number) {
  const layers: Array<{ n: (x: number, y: number) => number; freq: number; amp: number }> = [];
  let amp = 1, freq = basePeriod, total = 0;
  for (let o = 0; o < octaves; o++) {
    layers.push({ n: makeValueNoise(seed + o * 101, freq), freq, amp });
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return (u: number, v: number) => {
    let s = 0;
    for (const l of layers) s += l.n(u * l.freq, v * l.freq) * l.amp;
    return s / total;
  };
}
