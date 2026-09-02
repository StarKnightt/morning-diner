/**
 * The radio behind the counter: quiet AM talk radio, tuned a little off.
 *
 * Not words, not music — the *rhythm* of two people talking. A sawtooth
 * "larynx" plus aspiration noise runs through three formant band-passes whose
 * centres jump per syllable (vowel table with jitter), gated by syllable
 * envelopes at 3–5 Hz, grouped into words, phrases and pauses. A second voice
 * alternates, interjects, and now and then laughs. The whole programme is then
 * band-limited to ~300–3000 Hz, softly saturated like a paper cone, and mixed
 * with carrier hiss and a 60 Hz hum whose level drifts as the signal fades.
 *
 * Target level ≈ -32 dBFS RMS at 1 m during speech.
 */
import { AudioEngine, type Vec3 } from "../AudioEngine";
import { dbToGain, envelope, makeSaturationCurve } from "../dsp";
import { AmbientLayer } from "../Layer";

interface Voice {
  f0: number;
  /** Formant scale: 1 for a male voice, ~1.15 for a lighter one. */
  formant: number;
  /** Speaking-rate bias (syllables per second). */
  rate: number;
}

const VOICES: readonly Voice[] = [
  { f0: 112, formant: 1.0, rate: 4.0 },
  { f0: 178, formant: 1.14, rate: 4.5 },
];

/** F1/F2 of a few vowels (Hz, male). F3 sits around 2500 and barely moves. */
const VOWELS: ReadonlyArray<readonly [number, number]> = [
  [730, 1090], // a
  [660, 1720], // æ
  [530, 1840], // e
  [390, 1990], // ɪ
  [300, 2290], // i
  [570, 840], // o
  [440, 1020], // ʊ
  [300, 870], // u
  [520, 1190], // ə
  [640, 1190], // ʌ
];

export interface RadioOptions {
  /** Output level at 1 m, dBFS RMS during speech. */
  levelDb?: number;
  reverbDb?: number;
}

/** Measured with the harness: speech RMS at 1 m sits this far below the `level` gain. */
const CAL_DB = 8;

export class Radio extends AmbientLayer {
  private readonly larynx: OscillatorNode;
  private readonly voiceGain: GainNode;
  private readonly breathGain: GainNode;
  private readonly formants: BiquadFilterNode[];
  private readonly hissGain: GainNode;
  private nextPhrase = -1;
  private speaker = 0;

  constructor(engine: AudioEngine, position: Vec3, opts: RadioOptions = {}) {
    super(engine, "radio", opts.reverbDb ?? -14);
    const ctx = engine.ctx;
    const t0 = engine.now;

    // ---- voice source -------------------------------------------------
    this.larynx = ctx.createOscillator();
    this.larynx.type = "sawtooth";
    this.larynx.frequency.value = VOICES[0].f0;
    this.larynx.start(t0);
    this.voiceGain = ctx.createGain();
    this.voiceGain.gain.value = 0;
    this.larynx.connect(this.voiceGain);

    // Slow pitch jitter so held vowels aren't a static buzz.
    const jitter = ctx.createOscillator();
    jitter.type = "sine";
    jitter.frequency.value = 5.3;
    const jitterDepth = ctx.createGain();
    jitterDepth.gain.value = 2.2;
    jitter.connect(jitterDepth);
    jitterDepth.connect(this.larynx.frequency);
    jitter.start(t0);

    const breath = engine.noiseSource("white", 1, t0);
    this.breathGain = ctx.createGain();
    this.breathGain.gain.value = 0;
    breath.connect(this.breathGain);

    const excitation = ctx.createGain();
    this.voiceGain.connect(excitation);
    this.breathGain.connect(excitation);

    // ---- formants (parallel band-passes) ------------------------------
    const voiceSum = ctx.createGain();
    const formantGains = [0, -1.5, -5];
    const qs = [7, 9, 10];
    this.formants = formantGains.map((db, i) => {
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = qs[i];
      f.frequency.value = [520, 1190, 2500][i];
      const g = ctx.createGain();
      g.gain.value = dbToGain(db);
      excitation.connect(f);
      f.connect(g);
      g.connect(voiceSum);
      return f;
    });

    // ---- the set: band-limit, paper-cone saturation, programme fader ---
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 320;
    hp.Q.value = 0.8;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2900;
    lp.Q.value = 0.9;
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeSaturationCurve(2.2);
    shaper.oversample = "none";
    const program = ctx.createGain();
    program.gain.value = 1.0;
    // Formant outputs are small (a Q-8 band-pass keeps only a couple of saw
    // harmonics). Drive them into the saturator so it works as the receiver's
    // limiter: consonants flatten, vowels sit at a steady level.
    const drive = ctx.createGain();
    drive.gain.value = 7;
    voiceSum.connect(drive);
    drive.connect(hp);
    hp.connect(lp);
    lp.connect(shaper);
    shaper.connect(program);

    // Signal fade: the carrier wanders in and out over tens of seconds.
    this.wander(program.gain, { min: 0.6, max: 1.0, minHold: 6, maxHold: 18, tau: 3.5 });

    // ---- carrier hiss and hum -----------------------------------------
    const hiss = engine.noiseSource("white", 0.97, t0);
    const hissBp = ctx.createBiquadFilter();
    hissBp.type = "bandpass";
    hissBp.frequency.value = 1900;
    hissBp.Q.value = 0.45;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0.05;
    hiss.connect(hissBp);
    hissBp.connect(this.hissGain);
    // Hiss rises when the programme fades (AGC in the receiver).
    this.wander(this.hissGain.gain, { min: 0.035, max: 0.09, minHold: 5, maxHold: 15, tau: 3 });

    const hum = ctx.createOscillator();
    hum.type = "sine";
    hum.frequency.value = 60;
    const hum3 = ctx.createOscillator();
    hum3.type = "sine";
    hum3.frequency.value = 180;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.04;
    const hum3Gain = ctx.createGain();
    hum3Gain.gain.value = 0.018;
    hum.connect(humGain);
    hum3.connect(hum3Gain);
    hum.start(t0);
    hum3.start(t0);

    // ---- output -------------------------------------------------------
    const set = ctx.createGain();
    program.connect(set);
    this.hissGain.connect(set);
    humGain.connect(set);
    hum3Gain.connect(set);
    // A small speaker: nothing much below 250 Hz leaves the cabinet.
    const cabinet = ctx.createBiquadFilter();
    cabinet.type = "highpass";
    cabinet.frequency.value = 240;
    cabinet.Q.value = 0.7;
    set.connect(cabinet);
    const level = ctx.createGain();
    level.gain.value = dbToGain((opts.levelDb ?? -32) + CAL_DB);
    cabinet.connect(level);
    engine.attach(level, position, this.bus);
  }

  override tick(now: number, lookahead: number): void {
    super.tick(now, lookahead);
    if (this.nextPhrase < 0) this.nextPhrase = now + this.rng.range(0.4, 1.5);
    while (this.nextPhrase < now + lookahead) {
      this.nextPhrase = this.scheduleUtterance(this.nextPhrase);
    }
  }

  /** Schedule one utterance starting at `t`; returns when the next one may start. */
  private scheduleUtterance(t: number): number {
    const rng = this.rng;
    // Who talks: mostly the same host, hand-offs about a third of the time.
    if (rng.chance(0.32)) this.speaker = 1 - this.speaker;
    const voice = VOICES[this.speaker];

    const roll = rng.next();
    let end: number;
    if (roll < 0.07) {
      end = this.scheduleLaugh(t, voice);
    } else if (roll < 0.2) {
      // Short interjection from the other voice ("mm-hm", "right").
      end = this.schedulePhrase(t, VOICES[1 - this.speaker], 1 + Math.floor(rng.range(0, 2.4)));
    } else {
      end = this.schedulePhrase(t, voice, 3 + Math.floor(rng.range(0, 12)));
    }

    // Breathing room. Talk radio is mostly gaps; every so often a long one.
    if (rng.chance(0.14)) return end + rng.range(2.4, 5.0);
    return end + rng.range(0.25, 1.4);
  }

  private schedulePhrase(t: number, voice: Voice, syllables: number): number {
    const rng = this.rng;
    const f0Base = voice.f0 * rng.range(0.95, 1.06);
    let time = t;
    let inWord = 0;
    const wordLen = 1 + Math.floor(rng.range(0, 3.6));
    let currentWord = wordLen;

    for (let i = 0; i < syllables; i++) {
      const progress = i / Math.max(1, syllables - 1);
      // Declination: pitch drifts down over the phrase, with a rise for a question now and then.
      const contour = 1.08 - 0.16 * progress + (rng.chance(0.08) ? 0.1 : 0);
      const stressed = rng.chance(0.28);
      const period = 1 / (voice.rate * rng.range(0.82, 1.2)); // 3–5 Hz
      const dur = period * (stressed ? 0.85 : 0.62);
      const f0 = f0Base * contour * rng.range(0.96, 1.04);
      this.scheduleSyllable(time, dur, f0, voice, stressed ? 1.0 : 0.72);
      time += period;
      inWord++;
      if (inWord >= currentWord) {
        // Word boundary: a tiny pause, sometimes a breath.
        time += rng.range(0.05, 0.22);
        inWord = 0;
        currentWord = 1 + Math.floor(rng.range(0, 3.6));
        if (rng.chance(0.25)) this.scheduleBreath(time - 0.05, 0.12);
      }
    }
    return time + 0.1;
  }

  private scheduleLaugh(t: number, voice: Voice): number {
    const rng = this.rng;
    const n = 4 + Math.floor(rng.range(0, 4));
    let time = t;
    let f0 = voice.f0 * 1.45;
    for (let i = 0; i < n; i++) {
      const gap = rng.range(0.13, 0.19);
      // "ha ha ha": open vowel, heavy aspiration, falling pitch, fading level.
      this.scheduleSyllable(time, gap * 0.55, f0, voice, 0.9 - i * 0.08, VOWELS[0], 0.9);
      f0 *= rng.range(0.93, 0.98);
      time += gap;
    }
    return time + 0.2;
  }

  private scheduleSyllable(
    t: number,
    dur: number,
    f0: number,
    voice: Voice,
    level: number,
    vowel: readonly [number, number] = this.rng.pick(VOWELS),
    breathiness = 0.35,
  ): void {
    const rng = this.rng;
    const [f1, f2] = vowel;
    const scale = voice.formant * rng.range(0.94, 1.06);
    const glide = 0.03;
    this.formants[0].frequency.setTargetAtTime(f1 * scale, t, glide);
    this.formants[1].frequency.setTargetAtTime(f2 * scale, t, glide);
    this.formants[2].frequency.setTargetAtTime(2500 * scale * rng.range(0.96, 1.04), t, glide);

    // Pitch: land on the target, sag slightly through the syllable.
    this.larynx.frequency.setTargetAtTime(f0, t, 0.02);
    this.larynx.frequency.setTargetAtTime(f0 * 0.965, t + dur * 0.45, 0.06);

    // Voicing envelope.
    envelope(this.voiceGain.gain, t, 0.55 * level, 0.018, Math.max(0.02, dur - 0.06), 0.07);

    // Consonant onset (fricative burst) about half the time, then a little steady aspiration.
    if (rng.chance(0.5)) {
      envelope(this.breathGain.gain, t - 0.03, 0.35 * breathiness, 0.004, 0.025, 0.05, 0.02 * breathiness);
    } else {
      this.breathGain.gain.setTargetAtTime(0.03 * breathiness, t, 0.02);
    }
    this.breathGain.gain.setTargetAtTime(0, t + dur, 0.04);
  }

  private scheduleBreath(t: number, dur: number): void {
    envelope(this.breathGain.gain, t, 0.09, 0.03, dur, 0.08);
  }
}
