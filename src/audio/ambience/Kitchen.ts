/**
 * Kitchen presence (System 9): somebody is working behind the pass-through.
 *
 * Nothing in here is a word or a figure — it is the *evidence* of a person:
 *   murmur   a muffled radio / talk bed leaking through the opening. Pink noise through a
 *            wandering 300–700 Hz band-pass and a hard 900 Hz low-pass (the wall and the
 *            opening take everything above), shaped by a syllabic 3.5–5.5 Hz envelope
 *            (8–10 dB deep) inside 1.5–4 s phrases with 0.6–2.5 s gaps. No formants, no
 *            larynx: it can never resolve into speech. A lower 140–260 Hz register answers
 *            now and then (the cook). Continuous, ≈ −48 LUFS at the counter.
 *   dishes   every 20–60 s a cluster of 2–5 ceramic contacts (inharmonic partials
 *            2.2–4.5 kHz, low-passed at 3.8 kHz so they are heard through the opening,
 *            not in the room), sometimes a cutlery tinkle on top — plates being stacked.
 *   tap      every 20–60 s the sink runs for 3–6 s: a 1.6–2.8 kHz stream hiss with a
 *            300–600 Hz splash burble (8–14 Hz AM), a valve onset, a couple of drips after.
 * Two emitters, both just behind the pass-through opening (the sound reaches the room
 * there, not from inside the kitchen box): the sink to the −x side, the radio to +x.
 * Everything low-passed — the kitchen is another room.
 */
import { AudioEngine, type Vec3 } from "../AudioEngine";
import { dbToGain } from "../dsp";
import { AmbientLayer } from "../Layer";

export interface KitchenOptions {
  /** Murmur bed RMS at 1 m during a phrase, dBFS. */
  murmurDb?: number;
  /** Peak of a dish contact at 1 m, dBFS. */
  dishDb?: number;
  /** Tap stream RMS at 1 m, dBFS. */
  tapDb?: number;
  reverbDb?: number;
}

/** Murmur bed after the filters sits this far below the `murmurOut` gain (harness). */
const MURMUR_CAL_DB = 14;

export class Kitchen extends AmbientLayer {
  private readonly murmurOut: GainNode;
  private readonly murmurBp: BiquadFilterNode;
  private readonly murmurEnv: GainNode;
  private readonly lowBp: BiquadFilterNode;
  private readonly lowEnv: GainNode;
  private readonly sinkOut: GainNode;
  private readonly dishLevel: number;
  private readonly tapLevel: number;
  private phraseEnd = 0;

  constructor(engine: AudioEngine, sink: Vec3, radio: Vec3, opts: KitchenOptions = {}) {
    super(engine, "kitchen", opts.reverbDb ?? -16);
    const ctx = engine.ctx;
    const t0 = engine.now;
    this.dishLevel = dbToGain(opts.dishDb ?? -26);
    this.tapLevel = dbToGain(opts.tapDb ?? -30);

    // ---- murmur bed: noise → wandering BP → 900 Hz LP ×2 → syllabic envelope ----------------
    this.murmurOut = ctx.createGain();
    this.murmurOut.gain.value = dbToGain((opts.murmurDb ?? -35) + MURMUR_CAL_DB);
    const src = engine.noiseSource("pink", 0.97, t0);
    this.murmurBp = ctx.createBiquadFilter();
    this.murmurBp.type = "bandpass";
    this.murmurBp.frequency.value = 480;
    this.murmurBp.Q.value = 1.1;
    const lpA = ctx.createBiquadFilter();
    lpA.type = "lowpass";
    lpA.frequency.value = 900;
    lpA.Q.value = 0.707;
    const lpB = ctx.createBiquadFilter();
    lpB.type = "lowpass";
    lpB.frequency.value = 900;
    lpB.Q.value = 0.707;
    this.murmurEnv = ctx.createGain();
    this.murmurEnv.gain.value = 0;
    src.connect(this.murmurBp);
    this.murmurBp.connect(lpA);
    lpA.connect(lpB);
    lpB.connect(this.murmurEnv);
    this.murmurEnv.connect(this.murmurOut);
    this.wander(this.murmurBp.frequency, { min: 320, max: 700, minHold: 0.4, maxHold: 1.6, tau: 0.25 });

    // The cook's answer: a lower register, same construction, shorter phrases.
    const low = engine.noiseSource("brown", 1.02, t0);
    this.lowBp = ctx.createBiquadFilter();
    this.lowBp.type = "bandpass";
    this.lowBp.frequency.value = 190;
    this.lowBp.Q.value = 1.4;
    const lowLp = ctx.createBiquadFilter();
    lowLp.type = "lowpass";
    lowLp.frequency.value = 600;
    this.lowEnv = ctx.createGain();
    this.lowEnv.gain.value = 0;
    low.connect(this.lowBp);
    this.lowBp.connect(lowLp);
    lowLp.connect(this.lowEnv);
    this.lowEnv.connect(this.murmurOut);
    this.wander(this.lowBp.frequency, { min: 140, max: 260, minHold: 0.5, maxHold: 1.5, tau: 0.3 });

    // A receiver's carrier hiss under the talk, very faint, so the gaps are not silence.
    const hiss = engine.noiseSource("white", 0.99, t0);
    const hissBp = ctx.createBiquadFilter();
    hissBp.type = "bandpass";
    hissBp.frequency.value = 700;
    hissBp.Q.value = 0.5;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.05;
    hiss.connect(hissBp);
    hissBp.connect(hissGain);
    hissGain.connect(this.murmurOut);

    // ---- sink side: dishes and the tap share an output ----------------------------------------
    this.sinkOut = ctx.createGain();
    this.sinkOut.gain.value = 1;

    // Phrases: a new one whenever the last has ended (plus a gap).
    this.every(2.2, 5.5, (t) => this.schedulePhrase(t), 0.8);
    // Dishes and the tap: 20–60 s apart each, first ones inside the first half minute.
    this.every(20, 60, (t) => this.scheduleDishes(t), 6);
    this.every(20, 60, (t) => this.scheduleTap(t), 14);

    // Both emitters sit just behind the opening; default room model (−5 dB at 2.5 m, −9 at 4.5 m).
    engine.attach(this.murmurOut, radio, this.bus);
    engine.attach(this.sinkOut, sink, this.bus);
  }

  /** One talk phrase: 1.5–4 s of 3.5–5.5 Hz syllables, then silence until the next clock tick. */
  private schedulePhrase(t: number): void {
    const rng = this.rng;
    const start = Math.max(t, this.phraseEnd + rng.range(0.6, 2.5));
    const dur = rng.range(1.5, 4.0);
    const cook = rng.chance(0.3);
    const env = cook ? this.lowEnv.gain : this.murmurEnv.gain;
    const rate = rng.range(3.5, 5.5);
    const peak = cook ? 0.9 : 1.0;
    // Syllables: 80–250 ms segments, 8–10 dB peak-to-trough, a little slower toward the end.
    let time = start;
    env.setValueAtTime(0, start);
    while (time < start + dur) {
      const seg = (1 / rate) * rng.range(0.7, 1.3);
      const level = peak * rng.range(0.55, 1.0) * (1 - 0.25 * ((time - start) / dur));
      env.linearRampToValueAtTime(level, time + seg * 0.35);
      env.linearRampToValueAtTime(level * dbToGain(-rng.range(8, 10)), time + seg);
      time += seg;
      if (rng.chance(0.18)) time += rng.range(0.12, 0.3); // a breath between words
    }
    env.linearRampToValueAtTime(0, time + 0.08);
    this.phraseEnd = time + 0.08;
    this.engine.logEvent(cook ? "kitchen.cook" : "kitchen.murmur", start, this.phraseEnd - start);
  }

  /** Plates being stacked: 2–5 muffled ceramic contacts 60–220 ms apart, maybe a cutlery tinkle. */
  private scheduleDishes(t: number): void {
    const rng = this.rng;
    const n = 2 + Math.floor(rng.range(0, 4));
    let time = t;
    for (let i = 0; i < n; i++) {
      this.scheduleContact(time, rng.range(0.5, 1.0) * (i === 0 ? 1 : rng.range(0.4, 1.0)), false);
      time += rng.range(0.06, 0.22);
    }
    if (rng.chance(0.45)) {
      const tc = time + rng.range(0.1, 0.4);
      this.scheduleContact(tc, rng.range(0.3, 0.6), true);
      if (rng.chance(0.5)) this.scheduleContact(tc + rng.range(0.04, 0.09), 0.3, true);
      time = tc + 0.1;
    }
    this.engine.logEvent("kitchen.dishes", t, time - t + 0.2);
  }

  /** One ceramic (or, `cutlery`, steel) contact: inharmonic partials under a 3.8 kHz roof. */
  private scheduleContact(t: number, level: number, cutlery: boolean): void {
    const ctx = this.engine.ctx;
    const rng = this.rng;
    const out = ctx.createGain();
    out.gain.value = this.dishLevel * level;
    const roof = ctx.createBiquadFilter();
    roof.type = "lowpass";
    roof.frequency.value = 3800;
    roof.Q.value = 0.707;
    out.connect(roof);
    roof.connect(this.sinkOut);
    const base = cutlery ? rng.range(4200, 6500) : rng.range(2200, 3300);
    const partials = cutlery ? [1, 1.83, 2.71] : [1, 1.47, 2.36, 3.1];
    const decays = cutlery ? [0.16, 0.1, 0.06] : [0.12, 0.08, 0.05, 0.035];
    const amps = cutlery ? [0.6, 0.35, 0.2] : [0.65, 0.4, 0.22, 0.1];
    let last: OscillatorNode | null = null;
    partials.forEach((ratio, i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = base * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.3 * amps[i], t + 0.0015);
      g.gain.setTargetAtTime(0, t + 0.002, decays[i] / 4);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + 0.6);
      last = o;
    });
    // Body of the contact: a 10 ms broadband thock, 400 Hz–2 kHz.
    const thock = this.engine.noiseSource("white", 1, t);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = cutlery ? 1800 : 900;
    bp.Q.value = 0.6;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0, t);
    tg.gain.linearRampToValueAtTime(cutlery ? 0.25 : 0.7, t + 0.0012);
    tg.gain.setTargetAtTime(0, t + 0.004, 0.004);
    thock.connect(bp);
    bp.connect(tg);
    tg.connect(out);
    thock.stop(t + 0.1);
    if (last) (last as OscillatorNode).addEventListener("ended", () => out.disconnect(), { once: true });
  }

  /** The tap runs 3–6 s: valve onset, stream hiss + splash burble, fade, two drips. */
  private scheduleTap(t: number): void {
    const ctx = this.engine.ctx;
    const rng = this.rng;
    const dur = rng.range(3, 6);
    const out = ctx.createGain();
    out.gain.value = this.tapLevel;
    const roof = ctx.createBiquadFilter();
    roof.type = "lowpass";
    roof.frequency.value = 3500;
    out.connect(roof);
    roof.connect(this.sinkOut);

    // Stream hiss 1.6–2.8 kHz.
    const hiss = this.engine.noiseSource("white", 1, t);
    const hbp = ctx.createBiquadFilter();
    hbp.type = "bandpass";
    hbp.frequency.value = rng.range(1600, 2800);
    hbp.Q.value = 0.8;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0, t);
    hg.gain.linearRampToValueAtTime(1.0, t + 0.12); // valve opens
    hg.gain.setValueAtTime(1.0, t + dur - 0.25);
    hg.gain.linearRampToValueAtTime(0, t + dur); // and shuts
    hiss.connect(hbp);
    hbp.connect(hg);
    hg.connect(out);
    hiss.stop(t + dur + 0.1);

    // Splash burble 300–600 Hz with 8–14 Hz AM (water hitting the basin).
    const burble = this.engine.noiseSource("pink", 1, t);
    const bbp = ctx.createBiquadFilter();
    bbp.type = "bandpass";
    bbp.frequency.value = rng.range(300, 600);
    bbp.Q.value = 1.0;
    const am = ctx.createGain();
    am.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rng.range(8, 14);
    const depth = ctx.createGain();
    depth.gain.value = 0.4;
    lfo.connect(depth);
    depth.connect(am.gain);
    lfo.start(t);
    lfo.stop(t + dur + 0.1);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(1.6, t + 0.2);
    bg.gain.setValueAtTime(1.6, t + dur - 0.3);
    bg.gain.linearRampToValueAtTime(0, t + dur);
    burble.connect(bbp);
    bbp.connect(am);
    am.connect(bg);
    bg.connect(out);
    burble.stop(t + dur + 0.1);

    // Valve: a short dull click as it opens and again as it shuts.
    for (const tc of [t, t + dur - 0.02]) {
      const click = this.engine.noiseSource("white", 1, tc);
      const cbp = ctx.createBiquadFilter();
      cbp.type = "bandpass";
      cbp.frequency.value = 1200;
      cbp.Q.value = 1.2;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0, tc);
      cg.gain.linearRampToValueAtTime(0.5, tc + 0.002);
      cg.gain.setTargetAtTime(0, tc + 0.004, 0.006);
      click.connect(cbp);
      cbp.connect(cg);
      cg.connect(out);
      click.stop(tc + 0.1);
    }

    // Drips: two or three sine blips gliding 1.4 kHz → 900 Hz after the tap shuts.
    let td = t + dur + rng.range(0.4, 0.9);
    const nDrips = 1 + Math.floor(rng.range(0, 3));
    let lastDrip: OscillatorNode | null = null;
    for (let i = 0; i < nDrips; i++) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(rng.range(1200, 1600), td);
      o.frequency.exponentialRampToValueAtTime(rng.range(800, 1000), td + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, td);
      g.gain.linearRampToValueAtTime(0.5, td + 0.003);
      g.gain.setTargetAtTime(0, td + 0.006, 0.02);
      o.connect(g);
      g.connect(out);
      o.start(td);
      o.stop(td + 0.3);
      lastDrip = o;
      td += rng.range(0.5, 1.4);
    }
    this.engine.logEvent("kitchen.tap", t, td - t);
    if (lastDrip) lastDrip.addEventListener("ended", () => out.disconnect(), { once: true });
  }
}
