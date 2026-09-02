/**
 * The radio behind the counter: quiet AM talk radio, tuned a little off.
 *
 * Not words, not music — the *rhythm* of two people talking. A sawtooth
 * "larynx" plus aspiration noise runs through three formant band-passes whose
 * centres jump per syllable (vowel table with jitter). The syllabic envelope
 * is 80–250 ms segments at 3–6 Hz with 6–12 dB peak-to-trough depth, grouped
 * into 1.5–3 s phrases separated by 0.3–1.0 s gaps in which only the receiver's
 * hiss remains (about -15 dB under speech). The fundamental drifts ±30 Hz
 * around 120–180 Hz. Two voices alternate, interject, now and then laugh.
 * The programme is band-limited like a real AM receiver (-3 dB ≈ 300 Hz and
 * 2.45 kHz; the set's own high-pass sits at 380 Hz), softly saturated like a
 * paper cone, and mixed with carrier hiss
 * and a faint hum whose level drifts as the signal fades.
 */
import { AudioEngine, type Vec3 } from "../AudioEngine";
import { dbToGain, makeSaturationCurve } from "../dsp";
import { AmbientLayer } from "../Layer";

interface Voice {
  f0: number;
  /** Formant scale: 1 for a male voice, ~1.15 for a lighter one. */
  formant: number;
  /** Speaking rate, syllables per second (centre of the 3–6 Hz range). */
  rate: number;
}

const VOICES: readonly Voice[] = [
  { f0: 128, formant: 1.0, rate: 4.0 },
  { f0: 172, formant: 1.12, rate: 4.6 },
];

/** F1/F2 of a few vowels (Hz, male). F3 wanders 2200–2600 per syllable. */
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

/** Measured with the harness: speech RMS at 1 m sits this far below the `level` gain. */
const CAL_DB = 7.5;

export interface RadioOptions {
  /** Output level at 1 m, dBFS RMS during speech. */
  levelDb?: number;
  reverbDb?: number;
}

export class Radio extends AmbientLayer {
  private readonly larynx: OscillatorNode;
  private readonly voiceGain: GainNode;
  private readonly breathGain: GainNode;
  private readonly formants: BiquadFilterNode[];
  private nextPhrase = -1;
  private speaker = 0;
  /** Slow random walk of the fundamental, Hz, clamped ±30. */
  private drift = 0;

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

    // Vibrato-ish jitter so held vowels aren't a static buzz.
    const jitter = ctx.createOscillator();
    jitter.type = "sine";
    jitter.frequency.value = 5.3;
    const jitterDepth = ctx.createGain();
    jitterDepth.gain.value = 2.5;
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
    const formantGains = [-3, 0, -3];
    const qs = [5, 7, 8];
    this.formants = formantGains.map((dbv, i) => {
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = qs[i];
      f.frequency.value = [520, 1190, 2400][i];
      const g = ctx.createGain();
      g.gain.value = dbToGain(dbv);
      excitation.connect(f);
      f.connect(g);
      g.connect(voiceSum);
      return f;
    });

    // ---- the set: AM band-limit, presence, paper-cone saturation, fader ---
    // Formant outputs are small (a Q-8 band-pass keeps a couple of saw
    // harmonics). Drive them into the saturator so it works as the receiver's
    // limiter: consonants flatten, vowels sit at a steady level.
    const drive = ctx.createGain();
    drive.gain.value = 7;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 380;
    hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2450;
    lp.Q.value = 0.707;
    const lp2 = ctx.createBiquadFilter();
    lp2.type = "lowpass";
    lp2.frequency.value = 3300;
    lp2.Q.value = 0.707;
    const presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 1500;
    presence.Q.value = 0.6;
    presence.gain.value = 3;
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeSaturationCurve(2.2);
    shaper.oversample = "none";
    const program = ctx.createGain();
    program.gain.value = 1.0;
    voiceSum.connect(drive);
    drive.connect(hp);
    hp.connect(presence);
    presence.connect(lp);
    lp.connect(lp2);
    lp2.connect(shaper);
    shaper.connect(program);
    // Signal fade: the carrier wanders in and out over tens of seconds.
    this.wander(program.gain, { min: 0.65, max: 1.0, minHold: 6, maxHold: 18, tau: 3.5 });

    // ---- carrier hiss and hum -----------------------------------------
    // The hiss is what's left in the gaps: ~-15 dB under speech.
    const hiss = engine.noiseSource("white", 0.97, t0);
    const hissBp = ctx.createBiquadFilter();
    hissBp.type = "bandpass";
    hissBp.frequency.value = 1600;
    hissBp.Q.value = 0.5;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.3;
    hiss.connect(hissBp);
    hissBp.connect(hissGain);
    // Hiss rises when the programme fades (AGC in the receiver).
    this.wander(hissGain.gain, { min: 0.22, max: 0.4, minHold: 5, maxHold: 15, tau: 3 });

    const hum = ctx.createOscillator();
    hum.type = "sine";
    hum.frequency.value = 60;
    const hum3 = ctx.createOscillator();
    hum3.type = "sine";
    hum3.frequency.value = 180;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.03;
    const hum3Gain = ctx.createGain();
    hum3Gain.gain.value = 0.008;
    hum.connect(humGain);
    hum3.connect(hum3Gain);
    hum.start(t0);
    hum3.start(t0);

    // ---- output -------------------------------------------------------
    const set = ctx.createGain();
    program.connect(set);
    hissGain.connect(set);
    humGain.connect(set);
    hum3Gain.connect(set);
    // A small speaker: nothing much below 250 Hz leaves the cabinet.
    const cabinet = ctx.createBiquadFilter();
    cabinet.type = "highpass";
    cabinet.frequency.value = 260;
    cabinet.Q.value = 0.7;
    set.connect(cabinet);
    const level = ctx.createGain();
    // Rev 3 live-mix calibration: −34 dBFS ⇒ ≈ −33 LUFS at 1 m (gated on speech). Was −32.
    level.gain.value = dbToGain((opts.levelDb ?? -34) + CAL_DB);
    cabinet.connect(level);
    engine.attach(level, position, this.bus);
  }

  override tick(now: number, lookahead: number): void {
    super.tick(now, lookahead);
    if (this.nextPhrase < 0) this.nextPhrase = now + this.rng.range(0.3, 1.0);
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
    // The fundamental drifts: random walk, clamped ±30 Hz.
    this.drift = Math.max(-30, Math.min(30, this.drift + rng.range(-16, 16)));

    const roll = rng.next();
    let end: number;
    if (roll < 0.07) {
      end = this.scheduleLaugh(t, voice);
    } else if (roll < 0.2) {
      // Short interjection from the other voice ("mm-hm", "right").
      end = this.schedulePhrase(t, VOICES[1 - this.speaker], rng.range(0.4, 0.9));
    } else {
      end = this.schedulePhrase(t, voice, rng.range(1.5, 3.0));
    }

    // Gap: 0.3–1.0 s of hiss; now and then a longer breath.
    if (rng.chance(0.12)) return end + rng.range(1.5, 2.5);
    return end + rng.range(0.3, 1.0);
  }

  /** A phrase of `seconds` of syllables; returns its end time. */
  private schedulePhrase(t: number, voice: Voice, seconds: number): number {
    const rng = this.rng;
    const f0Base = voice.f0 + this.drift + rng.range(-14, 14);
    // Intonation: where the phrase starts and how far it falls vary per phrase.
    const startPitch = rng.range(1.0, 1.16);
    const fall = rng.range(0.1, 0.24);
    const end = t + seconds;
    let time = t;
    let wordLeft = 1 + Math.floor(rng.range(0, 3.6));
    const depthDb = -rng.range(6, 12); // trough under peak, this phrase
    this.engine.logEvent("radio.phrase", t, seconds);

    while (time < end) {
      const progress = (time - t) / seconds;
      // Declination: pitch falls over the phrase, with the odd rise (a question).
      const contour = startPitch - fall * progress + (rng.chance(0.08) ? 0.1 : 0);
      const stressed = rng.chance(0.28);
      // Syllable period 167–333 ms (3–6 Hz), voiced segment 80–250 ms of it.
      const period = 1 / (voice.rate * rng.range(0.78, 1.28));
      const seg = Math.max(0.08, Math.min(0.25, period * (stressed ? 0.8 : 0.62)));
      const f0 = f0Base * contour * rng.range(0.93, 1.07);
      this.scheduleSyllable(time, seg, f0, voice, stressed ? 1.0 : 0.75, depthDb);
      time += period;
      if (--wordLeft <= 0) {
        // Word boundary: a slightly longer trough, sometimes an audible breath.
        time += rng.range(0.04, 0.16);
        wordLeft = 1 + Math.floor(rng.range(0, 3.6));
        if (rng.chance(0.2)) this.scheduleBreath(time - 0.06, 0.1);
      }
    }
    // Phrase end: voice fully off.
    this.voiceGain.gain.setTargetAtTime(0, time, 0.04);
    return time;
  }

  private scheduleLaugh(t: number, voice: Voice): number {
    const rng = this.rng;
    const n = 4 + Math.floor(rng.range(0, 4));
    let time = t;
    let f0 = (voice.f0 + this.drift) * 1.4;
    this.engine.logEvent("radio.laugh", t, n * 0.16);
    for (let i = 0; i < n; i++) {
      const period = rng.range(0.14, 0.19);
      // "ha ha ha": open vowel, heavy aspiration, falling pitch, fading level.
      this.scheduleSyllable(time, period * 0.55, f0, voice, 0.95 - i * 0.08, -10, VOWELS[0], 0.9);
      f0 *= rng.range(0.93, 0.98);
      time += period;
    }
    this.voiceGain.gain.setTargetAtTime(0, time, 0.04);
    return time;
  }

  /**
   * One syllable: voiced segment of `seg` seconds at `level`, then a trough
   * `depthDb` below it until the next syllable.
   */
  private scheduleSyllable(
    t: number,
    seg: number,
    f0: number,
    voice: Voice,
    level: number,
    depthDb: number,
    vowel: readonly [number, number] = this.rng.pick(VOWELS),
    breathiness = 0.35,
  ): void {
    const rng = this.rng;
    const [f1, f2] = vowel;
    const scale = voice.formant * rng.range(0.94, 1.06);
    const glide = 0.03;
    this.formants[0].frequency.setTargetAtTime(f1 * scale, t, glide);
    this.formants[1].frequency.setTargetAtTime(f2 * scale, t, glide);
    this.formants[2].frequency.setTargetAtTime(rng.range(2200, 2600) * voice.formant, t, glide);

    // Pitch: start a little above the target and glide ~10 % down through the
    // syllable, so no harmonic sits still long enough to read as a line.
    const fr = this.larynx.frequency;
    fr.cancelScheduledValues(t);
    fr.setValueAtTime(f0 * 1.05, t);
    fr.linearRampToValueAtTime(f0 * 0.95, t + seg);
    fr.setTargetAtTime(f0 * 0.9, t + seg, 0.15);

    // Voicing: attack, hold, then down to the trough (not silence) for the rest of the period.
    const peak = 0.55 * level;
    const trough = peak * dbToGain(depthDb);
    const g = this.voiceGain.gain;
    g.setTargetAtTime(peak, t, 0.012);
    g.setTargetAtTime(trough, t + seg, 0.02);

    // Consonant onset (fricative burst) about half the time, then a little steady aspiration.
    const b = this.breathGain.gain;
    if (rng.chance(0.5)) {
      b.setTargetAtTime(0.35 * breathiness, t - 0.03, 0.004);
      b.setTargetAtTime(0.03 * breathiness, t + 0.02, 0.02);
    } else {
      b.setTargetAtTime(0.03 * breathiness, t, 0.02);
    }
    b.setTargetAtTime(0.01 * breathiness, t + seg, 0.03);
  }

  private scheduleBreath(t: number, dur: number): void {
    const b = this.breathGain.gain;
    b.setTargetAtTime(0.09, t, 0.03);
    b.setTargetAtTime(0.01, t + dur, 0.05);
  }
}
