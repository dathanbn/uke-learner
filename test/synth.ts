/**
 * Synthetic plucked-string audio.
 *
 * This is NOT a substitute for the real fixture corpus in docs/AUDIO_ENGINE.md — a
 * synthesiser cannot reproduce room reverb, fret buzz, a cheap instrument's intonation,
 * or a phone mic's response, and tuning thresholds against it alone would produce a
 * detector that only works on synthetic audio.
 *
 * What it *is*: a way to test the maths deterministically in CI, on a machine with no
 * microphone and no ukulele, and to catch regressions the moment they appear.
 */

export interface PluckOptions {
  sampleRate: number;
  durationSec: number;
  /** Reference pitch, so calibration can be tested by detuning the whole instrument. */
  a4Hz?: number;
  /**
   * Target *peak* level of the finished take, in [0, 1].
   *
   * Peak rather than per-partial gain, because four plucked strings summing at random
   * phases routinely exceed full scale — earlier versions of this corpus peaked above 3.0,
   * which no microphone can produce: a real preamp clips first. Testing the detector on
   * signals with 3x headroom made the corpus quietly unrepresentative.
   */
  amplitude?: number;
  noiseFloor?: number;
  seed?: number;
}

/** Deterministic PRNG — a flaky audio test is worse than no audio test. */
const rng = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
};

export const midiToFreq = (midi: number, a4Hz = 440): number =>
  a4Hz * Math.pow(2, (midi - 69) / 12);

/**
 * Nylon strings have a weak fundamental and a strong 2nd/3rd partial — the opposite of
 * the naive sine-plus-decaying-harmonics model, and the reason the detector uses
 * harmonic summation rather than fundamental peak-picking.
 */
const NYLON_PARTIALS = [0.55, 1.0, 0.78, 0.46, 0.31, 0.22, 0.15, 0.1];

export const pluck = (
  midi: number,
  opts: PluckOptions,
  startSec = 0,
  gain = 1,
  out?: Float32Array,
): Float32Array => {
  const { sampleRate, durationSec, a4Hz = 440, amplitude = 0.3, seed = 12345 } = opts;
  const n = Math.floor(durationSec * sampleRate);
  const buf = out ?? new Float32Array(n);
  const rand = rng(seed + midi * 7919);
  const f0 = midiToFreq(midi, a4Hz);
  const start = Math.floor(startSec * sampleRate);
  const attackSamples = Math.floor(0.003 * sampleRate);

  for (let h = 1; h <= NYLON_PARTIALS.length; h++) {
    const f = f0 * h;
    if (f >= sampleRate / 2) break;
    const amp = NYLON_PARTIALS[h - 1]! * amplitude * gain;
    // Higher partials decay faster — this is what makes a pluck sound plucked.
    const tau = 1.9 / Math.pow(h, 0.62);
    const phase = rand() * Math.PI * 2;
    const w = (2 * Math.PI * f) / sampleRate;
    for (let i = start; i < n; i++) {
      const t = (i - start) / sampleRate;
      const attack = i - start < attackSamples ? (i - start) / attackSamples : 1;
      buf[i]! += amp * attack * Math.exp(-t / tau) * Math.sin(w * (i - start) + phase);
    }
  }
  return buf;
};

/**
 * A strum: the same notes, offset in time the way a thumb across four strings actually
 * sounds. The stagger matters — it's what the onset detector's refractory period exists
 * to collapse back into a single event.
 */
export const strum = (
  notes: readonly (number | null)[],
  opts: PluckOptions,
  startSec = 0.1,
  strumMs = 18,
): Float32Array => {
  const { sampleRate, durationSec, noiseFloor = 0.0012, seed = 12345 } = opts;
  const n = Math.floor(durationSec * sampleRate);
  const buf = new Float32Array(n);
  const rand = rng(seed);
  notes.forEach((note, i) => {
    if (note === null) return;
    // Real strums aren't even across the strings.
    const gain = 0.82 + rand() * 0.36;
    pluck(note, opts, startSec + (i * strumMs) / 1000, gain, buf);
  });
  // Normalise before adding noise, so a quiet take genuinely has a worse signal-to-noise
  // ratio — which is exactly what a quiet strum in the same room sounds like.
  normalisePeak(buf, Math.min(1, opts.amplitude ?? 0.3));
  for (let i = 0; i < n; i++) buf[i]! += (rand() - 0.5) * 2 * noiseFloor;
  return fadeOut(buf, sampleRate);
};

/**
 * Fade the last few milliseconds to zero.
 *
 * Without this, concatenating a still-ringing buffer with silence creates a step
 * discontinuity — a broadband click that the onset detector correctly fires on, because
 * it looks exactly like an attack. Real recordings don't contain step edges, so a
 * synthetic corpus that does would be testing an artefact rather than the instrument.
 */
export const fadeOut = (buf: Float32Array, sampleRate: number, ms = 150): Float32Array => {
  const n = Math.min(buf.length, Math.floor((ms / 1000) * sampleRate));
  for (let i = 0; i < n; i++) {
    const k = buf.length - n + i;
    // Raised cosine, and long. A short linear ramp is amplitude modulation: it splatters
    // energy into bins that were empty, which the onset detector reads — correctly — as
    // new spectral content, and fires a second onset on the fade of the first strum.
    buf[k]! *= 0.5 * (1 + Math.cos((Math.PI * i) / n));
  }
  return buf;
};

/** Scale a buffer so its loudest sample sits at `target`. */
export const normalisePeak = (buf: Float32Array, target: number): Float32Array => {
  let peak = 0;
  for (const x of buf) peak = Math.max(peak, Math.abs(x));
  if (peak > 0) {
    const g = target / peak;
    for (let i = 0; i < buf.length; i++) buf[i]! *= g;
  }
  return buf;
};

/** Silence, for padding between strums. */
export const silence = (sec: number, sampleRate: number): Float32Array =>
  new Float32Array(Math.floor(sec * sampleRate));

export const concat = (...parts: readonly Float32Array[]): Float32Array => {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** Detune individual strings, to test the relative-vs-global calibration distinction. */
export const strumDetuned = (
  notes: readonly (number | null)[],
  centsPerString: readonly number[],
  opts: PluckOptions,
  startSec = 0.1,
): Float32Array => {
  const { sampleRate, durationSec, a4Hz = 440, noiseFloor = 0.0012, seed = 999 } = opts;
  const n = Math.floor(durationSec * sampleRate);
  const buf = new Float32Array(n);
  const rand = rng(seed);
  notes.forEach((note, i) => {
    if (note === null) return;
    const detuned = note + (centsPerString[i] ?? 0) / 100;
    pluck(detuned, { ...opts, a4Hz }, startSec + (i * 18) / 1000, 0.85 + rand() * 0.3, buf);
  });
  normalisePeak(buf, Math.min(1, opts.amplitude ?? 0.3));
  for (let i = 0; i < n; i++) buf[i]! += (rand() - 0.5) * 2 * noiseFloor;
  return fadeOut(buf, sampleRate);
};
