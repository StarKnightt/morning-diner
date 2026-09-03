/**
 * System 8 settings: one plain object, live-editable at runtime.
 *
 *   window.__post.settings.dust.intensity = 2;   // takes effect next frame
 *   ?post=0                                      // whole pipeline off (plain renderer.render)
 *   ?dust=0&haze=0                               // a module off
 *   ?dust.count=3000&finish.grain=0.01           // any leaf by dotted path
 *   ?aa=msaa8 | msaa4 | smaa | msaa4+smaa | none
 *   ?tonemap=camera | aces | agx | neutral | none  (camera = System 4's curve, Lighting.ts)
 *   ?exposure=0.3                                // overrides renderer.toneMappingExposure
 *
 * Every number here is a placeholder-lighting default (System 4 has not run):
 * the sun/haze/dust brightness are all expressed relative to the sun light's own
 * colour × intensity, so re-lighting scales them for free; the absolute knobs
 * (bloom threshold, steam colour) are the ones the lighting pass will retune.
 */

export type AAMode = "none" | "msaa4" | "msaa8" | "smaa" | "msaa4+smaa";
export type ToneMap = "aces" | "agx" | "neutral" | "camera" | "none";

export interface PostSettings {
  /** Master switch. false → renderer.render straight to the canvas, nothing else runs. */
  enabled: boolean;
  aa: AAMode;
  dust: {
    enabled: boolean;
    /** Motes spawned inside the beam volumes (2 000–6 000). Changing it calls for `respawn()`. */
    count: number;
    /** Mote radiance as a fraction of the sun's radiance when viewed 25° off the sun axis (looking toward a window). */
    intensity: number;
    /** Rendered disc diameter range, px at DPR 1 (a 30 µm mote is the lens PSF, 1–3 px). */
    sizeMin: number;
    sizeMax: number;
    /** Extra bokeh growth for motes closer than ~0.8 m (px at 0.3 m). */
    bokeh: number;
    /** Drift amplitude (m) and characteristic period (s) of the Brownian sum-of-sines. */
    drift: number;
    driftPeriod: number;
    /** Convective rise, m/s, superposed on the drift (bounded so motes stay in the beam). */
    rise: number;
    /** Henyey-Greenstein asymmetry of the *visible* lobe (normalised at 25° off-axis): 0.55 → 90° ≈ 0.12×, 135° ≈ 0.05×. */
    g: number;
    /** Twinkle depth 0–1 (flake rotation → brightness modulation). */
    twinkle: number;
    /** Fraction of motes that are the bright 'sparkly' 30–50 µm class. */
    brightFraction: number;
  };
  haze: {
    enabled: boolean;
    /** In-scatter per metre of lit beam, as a fraction of sun radiance (REFERENCE §5: ≤ 0.02). */
    strength: number;
    g: number;
    steps: number;
    /** Render the march at half resolution (recommended; upsampled depth-aware). */
    halfRes: boolean;
  };
  shimmer: {
    enabled: boolean;
    /** Peak displacement, px at 1080p. */
    amplitude: number;
    /** Horizontal cycles across the screen width. */
    frequency: number;
    /** Temporal turbulence, Hz. */
    speed: number;
    /** Upward scroll, screen heights per second. */
    scroll: number;
    /** View-space depth (m) below which a pixel can never shimmer (the interior). */
    minDepth: number;
    /** Height above the lot (m) at which the near-ground boost has faded out. */
    heightFade: number;
  };
  steam: {
    enabled: boolean;
    /** Global multiplier on the decanter emitter's alpha. */
    strength: number;
    count: number;
    /** Column rise (m) over one particle life (s). */
    rise: number;
    life: number;
    /** Emitter position offset from the decanter opening (m), for retuning without code. */
    offset: [number, number, number];
  };
  bloom: {
    enabled: boolean;
    /** Scene-linear luminance where bloom starts (soft knee below it). */
    threshold: number;
    knee: number;
    /** Added fraction of the blurred bright pass. */
    strength: number;
    /** Blur radius multiplier (1 = 13-tap at quarter res). */
    radius: number;
  };
  finish: {
    /** null → follow renderer.toneMapping (ACES in main.ts today). */
    tonemap: ToneMap | null;
    /** null → follow renderer.toneMappingExposure. */
    exposure: number | null;
    /** Corner falloff in EV (35 mm at f/5.6 ≈ 0.3–0.5). */
    vignetteEV: number;
    vignettePower: number;
    /** Lateral chromatic aberration at the frame corner, px. */
    ca: number;
    /** Corner softness radius (px) and where (normalised radius) it starts. */
    cornerSoft: number;
    cornerSoftStart: number;
    /** Grain amplitude at mid grey (fraction of display code value), chroma fraction, size in px. */
    grain: number;
    grainChroma: number;
    grainSize: number;
    /** ACES pushes clipped reds to orange; this desaturates above ~0.8 (REFERENCE §2). 0 = off. */
    highlightDesat: number;
  };
  debug: {
    /** 0 off · 1 shimmer mask · 2 haze buffer · 3 beam/aperture test · 4 bloom buffer · 5 motes without shadow test · 6 all motes */
    view: number;
  };
}

export function defaultSettings(): PostSettings {
  return {
    enabled: true,
    aa: "msaa4",
    dust: {
      enabled: true,
      count: 5000,
      // System 4 rev 4: every mote is a soft disc ≥ 3 px (the PSF of a 30–50 µm flake at f/5.6
      // never lands on one pixel) and the peak is capped near +1 EV over the beam it floats in.
      // Rev 3's 1-px points at intensity 0.4 read as 1–2 px fireflies (+2 … +3 EV) on the
      // shaded walls behind the beams in `door` and `length` (both critics).
      intensity: 0.02,
      sizeMin: 3.0,
      sizeMax: 4.5,
      bokeh: 3.0,
      drift: 0.06,
      driftPeriod: 14,
      rise: 0.012,
      g: 0.55,
      twinkle: 0.55,
      brightFraction: 0.18,
    },
    haze: { enabled: true, strength: 0.012, g: 0.55, steps: 24, halfRes: true },
    shimmer: { enabled: true, amplitude: 1.2, frequency: 11, speed: 0.9, scroll: 0.45, minDepth: 8, heightFade: 2.2 },
    // Offset: 5 cm toward the front of the machine so the wisp clears the brew basket above the decanter.
    steam: { enabled: true, strength: 0.8, count: 28, rise: 0.4, life: 3.6, offset: [0, 0.02, 0.05] },
    bloom: { enabled: true, threshold: 2.2, knee: 0.6, strength: 0.045, radius: 1.0 },
    finish: {
      tonemap: null,
      exposure: null,
      vignetteEV: 0.3,
      vignettePower: 2.4,
      ca: 0.5,
      cornerSoft: 0.7,
      cornerSoftStart: 0.55,
      grain: 0.015,
      grainChroma: 0.3,
      grainSize: 1.0,
      highlightDesat: 0.0,
    },
    debug: { view: 0 },
  };
}

const GROUP_SHORTHAND = ["dust", "haze", "shimmer", "steam", "bloom"] as const;

/** Apply `?post=0`, `?aa=`, `?tonemap=`, `?exposure=`, `?<group>=0/1` and `?a.b.c=value` overrides. */
export function applyUrlOverrides(s: PostSettings, search = location.search): PostSettings {
  const q = new URLSearchParams(search);
  const parse = (v: string): unknown => {
    if (v === "" || v === "1" || v === "true" || v === "on") return true;
    if (v === "0" || v === "false" || v === "off") return false;
    if (v === "null") return null;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
    if (v.startsWith("[")) {
      try {
        return JSON.parse(v);
      } catch {
        /* fall through */
      }
    }
    return v;
  };
  for (const [key, raw] of q.entries()) {
    const v = parse(raw);
    if (key === "post") {
      if (v === false) s.enabled = false;
      continue;
    }
    if (key === "aa" && typeof v === "string") {
      s.aa = v.replace(/\s/g, "+") as AAMode; // '+' in a query string decodes to a space
      continue;
    }
    if (key === "tonemap" && typeof v === "string") {
      s.finish.tonemap = v as ToneMap;
      continue;
    }
    if (key === "exposure" && typeof v === "number") {
      s.finish.exposure = v;
      continue;
    }
    if (key === "grain" && typeof v === "number") {
      s.finish.grain = v;
      continue;
    }
    if ((GROUP_SHORTHAND as readonly string[]).includes(key) && typeof v === "boolean") {
      (s as unknown as Record<string, { enabled: boolean }>)[key].enabled = v;
      continue;
    }
    if (key.includes(".")) setPath(s as unknown as Record<string, unknown>, key.replace(/^post\./, ""), v);
  }
  return s;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (typeof next !== "object" || next === null) return; // unknown group: ignore silently
    cur = next as Record<string, unknown>;
  }
  const leaf = parts[parts.length - 1];
  if (!(leaf in cur)) return; // unknown knob: ignore
  const old = cur[leaf];
  if (typeof old === "number" && typeof value === "boolean") cur[leaf] = value ? 1 : 0;
  else if (typeof old === "boolean" && typeof value === "number") cur[leaf] = value !== 0;
  else cur[leaf] = value;
}
