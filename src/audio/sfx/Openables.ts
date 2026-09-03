/**
 * The openables' voices (System 9): the under-counter cabinet doors and the
 * kitchen swing door. Spatialised one-shots at the object (equal-power, near).
 *
 * cabinetCatch(at, "release")  the magnetic catch letting go: a small plastic tick
 *                              (1.8–2.6 kHz, 4 ms) over a laminate-door body thock
 *                              (250–400 Hz, 12 ms) as the door leaves the carcass.
 * cabinetCatch(at, "close")    the catch snapping home: a sharper steel click (3–4 kHz)
 *                              and the door slapping the frame (150–300 Hz, 25 ms),
 *                              a hair of hollow-box resonance behind it.
 * cabinetStop(at)              the soft stop at full open: a dull hinge-bind bump.
 * kitchenDoorPush(at)          a palm on the leaf: a soft broadband thud, 220–500 Hz.
 * kitchenDoorPass(at, speed)   the leaf sweeping through the frame: a 180–1400 Hz air
 *                              whoosh, 0.2–0.35 s, scaled by the angular speed.
 * kitchenDoorSettle(at)        the leaf coming to rest in the frame: rubber-bumper thud
 *                              (120–200 Hz) with a short 900 Hz frame rattle.
 * Everything lands ≈ −24…−28 dBFS at 1 m — clear, not foley-loud.
 */
import { AudioEngine, type Vec3 } from "../AudioEngine";
import { dbToGain } from "../dsp";
import { scheduleCleanup } from "./Coffee";

export class OpenablesSfx {
  readonly bus: GainNode;
  private readonly engine: AudioEngine;

  constructor(engine: AudioEngine, opts: { reverbDb?: number } = {}) {
    this.engine = engine;
    this.bus = engine.createBus("sfx-openables", opts.reverbDb ?? -14);
  }

  cabinetCatch(at: Vec3, phase: "release" | "close"): void {
    const engine = this.engine;
    const ctx = engine.ctx;
    const rng = engine.rng;
    const t = engine.now + 0.005;
    engine.logEvent(`sfx.cabinet-${phase}`, t, 0.25);
    const out = ctx.createGain();
    out.gain.value = dbToGain(phase === "close" ? -9 : -7);
    const spatial = engine.attach(out, at, this.bus, { model: "equalpower" });

    // Click: the catch (plastic on release, steel on close).
    const click = engine.noiseSource("white", 1, t);
    const cbp = ctx.createBiquadFilter();
    cbp.type = "bandpass";
    cbp.frequency.value = phase === "close" ? rng.range(3000, 4000) : rng.range(1800, 2600);
    cbp.Q.value = phase === "close" ? 2.5 : 1.4;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, t);
    cg.gain.linearRampToValueAtTime(phase === "close" ? 0.6 : 0.35, t + 0.001);
    cg.gain.setTargetAtTime(0, t + 0.003, phase === "close" ? 0.004 : 0.003);
    click.connect(cbp);
    cbp.connect(cg);
    cg.connect(out);
    click.stop(t + 0.15);

    // Body: the laminate door / carcass.
    const tb = t + (phase === "close" ? 0.004 : 0.008);
    const body = engine.noiseSource("brown", 1, tb);
    const bbp = ctx.createBiquadFilter();
    bbp.type = "bandpass";
    bbp.frequency.value = phase === "close" ? rng.range(150, 300) : rng.range(250, 400);
    bbp.Q.value = 1.2;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, tb);
    bg.gain.linearRampToValueAtTime(phase === "close" ? 3.0 : 1.4, tb + 0.003);
    bg.gain.setTargetAtTime(0, tb + 0.006, phase === "close" ? 0.012 : 0.007);
    body.connect(bbp);
    bbp.connect(bg);
    bg.connect(out);
    body.stop(tb + 0.3);

    // Hollow box behind a closing door: a short resonant tail.
    let last: AudioScheduledSourceNode = body;
    if (phase === "close") {
      const ring = ctx.createOscillator();
      ring.type = "sine";
      ring.frequency.value = rng.range(110, 150);
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(0, tb);
      rg.gain.linearRampToValueAtTime(0.12, tb + 0.006);
      rg.gain.setTargetAtTime(0, tb + 0.01, 0.03);
      ring.connect(rg);
      rg.connect(out);
      ring.start(tb);
      ring.stop(tb + 0.3);
      last = ring;
    }
    scheduleCleanup(last, tb + 0.3, spatial, engine);
  }

  /** The door reaching its soft stop at full open: a dull bump, no click. */
  cabinetStop(at: Vec3): void {
    const engine = this.engine;
    const ctx = engine.ctx;
    const rng = engine.rng;
    const t = engine.now + 0.005;
    engine.logEvent("sfx.cabinet-stop", t, 0.12);
    const out = ctx.createGain();
    out.gain.value = dbToGain(-14);
    const spatial = engine.attach(out, at, this.bus, { model: "equalpower" });
    const body = engine.noiseSource("brown", 1, t);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = rng.range(180, 320);
    bp.Q.value = 1.0;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.6, t + 0.005);
    g.gain.setTargetAtTime(0, t + 0.01, 0.012);
    body.connect(bp);
    bp.connect(g);
    g.connect(out);
    body.stop(t + 0.25);
    scheduleCleanup(body, t + 0.25, spatial, engine);
  }

  kitchenDoorPush(at: Vec3): void {
    const engine = this.engine;
    const ctx = engine.ctx;
    const rng = engine.rng;
    const t = engine.now + 0.005;
    engine.logEvent("sfx.kdoor-push", t, 0.15);
    const out = ctx.createGain();
    out.gain.value = dbToGain(-12);
    const spatial = engine.attach(out, at, this.bus, { model: "equalpower" });
    const thud = engine.noiseSource("brown", 1, t);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = rng.range(220, 500);
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.8, t + 0.006);
    g.gain.setTargetAtTime(0, t + 0.012, 0.02);
    thud.connect(bp);
    bp.connect(g);
    g.connect(out);
    thud.stop(t + 0.3);
    scheduleCleanup(thud, t + 0.3, spatial, engine);
  }

  /** The leaf sweeping through the frame; `speed` 0..1 scales level and length. */
  kitchenDoorPass(at: Vec3, speed = 1): void {
    const engine = this.engine;
    const ctx = engine.ctx;
    const rng = engine.rng;
    const s = Math.max(0.15, Math.min(1, speed));
    const t = engine.now + 0.005;
    const dur = 0.2 + 0.15 * s;
    engine.logEvent("sfx.kdoor-pass", t, dur);
    const out = ctx.createGain();
    out.gain.value = dbToGain(-16) * s;
    const spatial = engine.attach(out, at, this.bus, { model: "equalpower" });
    const air = engine.noiseSource("pink", 1, t);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(rng.range(180, 260), t);
    bp.frequency.exponentialRampToValueAtTime(rng.range(900, 1400), t + dur * 0.45);
    bp.frequency.exponentialRampToValueAtTime(rng.range(200, 300), t + dur);
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.2, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0, t + dur);
    air.connect(bp);
    bp.connect(g);
    g.connect(out);
    air.stop(t + dur + 0.05);
    scheduleCleanup(air, t + dur + 0.05, spatial, engine);
  }

  kitchenDoorSettle(at: Vec3): void {
    const engine = this.engine;
    const ctx = engine.ctx;
    const rng = engine.rng;
    const t = engine.now + 0.005;
    engine.logEvent("sfx.kdoor-settle", t, 0.2);
    const out = ctx.createGain();
    out.gain.value = dbToGain(-17);
    const spatial = engine.attach(out, at, this.bus, { model: "equalpower" });
    const bump = engine.noiseSource("brown", 1, t);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = rng.range(120, 200);
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(2.2, t + 0.005);
    g.gain.setTargetAtTime(0, t + 0.01, 0.018);
    bump.connect(bp);
    bp.connect(g);
    g.connect(out);
    bump.stop(t + 0.3);
    // Frame rattle: a short 900 Hz sliver.
    const rattle = engine.noiseSource("white", 1, t + 0.006);
    const rbp = ctx.createBiquadFilter();
    rbp.type = "bandpass";
    rbp.frequency.value = rng.range(800, 1000);
    rbp.Q.value = 3;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0, t + 0.006);
    rg.gain.linearRampToValueAtTime(0.25, t + 0.008);
    rg.gain.setTargetAtTime(0, t + 0.012, 0.01);
    rattle.connect(rbp);
    rbp.connect(rg);
    rg.connect(out);
    rattle.stop(t + 0.2);
    scheduleCleanup(bump, t + 0.3, spatial, engine);
  }

  /**
   * feat-blinds-f: a venetian blind running on its cords for `dur` seconds — a soft 1.2–3 kHz
   * cord/slat rustle (pink noise, gentle swell) with a train of small ratchet ticks (the cord
   * lock's pawl, ~11/s) riding on it. ≈ −30 dBFS at 1 m; a texture, not an event.
   */
  blindRustle(at: Vec3, dur = 1.5): void {
    const engine = this.engine;
    const ctx = engine.ctx;
    const rng = engine.rng;
    const t = engine.now + 0.005;
    engine.logEvent("sfx.blind-rustle", t, dur);
    const out = ctx.createGain();
    out.gain.value = dbToGain(-16);
    const spatial = engine.attach(out, at, this.bus, { model: "equalpower" });
    const air = engine.noiseSource("pink", 1, t);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(rng.range(1200, 1600), t);
    bp.frequency.linearRampToValueAtTime(rng.range(2200, 3000), t + dur * 0.6);
    bp.frequency.linearRampToValueAtTime(rng.range(1400, 1800), t + dur);
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.12);
    g.gain.setValueAtTime(0.5, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, t + dur);
    air.connect(bp);
    bp.connect(g);
    g.connect(out);
    air.stop(t + dur + 0.05);
    // Ratchet ticks: short 2.5–4 kHz clicks every ~90 ms, slightly irregular.
    const ticks = engine.noiseSource("white", 1, t);
    const tbp = ctx.createBiquadFilter();
    tbp.type = "bandpass";
    tbp.frequency.value = rng.range(2500, 4000);
    tbp.Q.value = 3;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0, t);
    for (let tt = t + 0.1; tt < t + dur * 0.85; tt += 0.075 + rng.range(0, 0.03)) {
      tg.gain.setValueAtTime(0, tt);
      tg.gain.linearRampToValueAtTime(rng.range(0.15, 0.3), tt + 0.001);
      tg.gain.setTargetAtTime(0, tt + 0.002, 0.003);
    }
    ticks.connect(tbp);
    tbp.connect(tg);
    tg.connect(out);
    ticks.stop(t + dur + 0.05);
    scheduleCleanup(air, t + dur + 0.05, spatial, engine);
  }

  /**
   * feat-blinds-f: the slats seating on the bottom rail — a burst of 8–12 thin aluminium clicks
   * (3–6 kHz, 3 ms) over 0.25 s, densest at the start, with the rail's soft thud under them.
   */
  blindClatter(at: Vec3): void {
    const engine = this.engine;
    const ctx = engine.ctx;
    const rng = engine.rng;
    const t = engine.now + 0.005;
    engine.logEvent("sfx.blind-clatter", t, 0.3);
    const out = ctx.createGain();
    out.gain.value = dbToGain(-13);
    const spatial = engine.attach(out, at, this.bus, { model: "equalpower" });
    const thud = engine.noiseSource("brown", 1, t);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = rng.range(160, 260);
    bp.Q.value = 1.0;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.4, t + 0.005);
    g.gain.setTargetAtTime(0, t + 0.01, 0.015);
    thud.connect(bp);
    bp.connect(g);
    g.connect(out);
    thud.stop(t + 0.3);
    const clicks = engine.noiseSource("white", 1, t);
    const cbp = ctx.createBiquadFilter();
    cbp.type = "bandpass";
    cbp.frequency.value = rng.range(3000, 6000);
    cbp.Q.value = 4;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, t);
    const n = 8 + Math.floor(rng.range(0, 5));
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const tt = t + 0.25 * u * u + rng.range(0, 0.01); // densest at the start
      cg.gain.setValueAtTime(0, tt);
      cg.gain.linearRampToValueAtTime(rng.range(0.3, 0.6) * (1 - 0.5 * u), tt + 0.001);
      cg.gain.setTargetAtTime(0, tt + 0.003, 0.004);
    }
    clicks.connect(cbp);
    cbp.connect(cg);
    cg.connect(out);
    clicks.stop(t + 0.35);
    scheduleCleanup(thud, t + 0.35, spatial, engine);
  }
}
