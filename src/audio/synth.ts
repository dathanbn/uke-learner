import { CONCERT, midiToHz, type PitchReference } from '../music/pitch';
import type { MidiNote } from '../types';

/**
 * Plucked-string synthesis, for playing a chord to the learner.
 *
 * Used by ear-training cards: hear the chord, then find it. Deliberately shares its
 * partial model with `test/synth.ts` — a plucked nylon string has a weak fundamental and a
 * strong second partial, and a chord rendered as plain sine waves sounds so unlike a
 * ukulele that matching it by ear teaches the wrong target.
 *
 * This is a genuine simplification, not a stand-in for a sample library: no body
 * resonance, no fret or pick noise, no string coupling. Good enough to recognise a chord
 * by; nobody will mistake it for a recording.
 */

/**
 * Deterministic, well-spread phase in [0, 2π) for a given string and partial.
 * A cheap integer hash — good decorrelation is all that's needed here.
 */
const hashPhase = (stringIndex: number, harmonic: number): number => {
  let x = (stringIndex * 73_856_093) ^ (harmonic * 19_349_663);
  x = Math.imul(x ^ (x >>> 16), 2_246_822_519);
  x = Math.imul(x ^ (x >>> 13), 3_266_489_917);
  x = (x ^ (x >>> 16)) >>> 0;
  return (x / 0xffffffff) * Math.PI * 2;
};

/** Relative partial amplitudes of a plucked nylon string. */
const PARTIALS = [0.55, 1.0, 0.78, 0.46, 0.31, 0.22, 0.15, 0.1] as const;

export interface PluckOptions {
  /** Seconds between successive strings — a strum, not a block chord. */
  strumMs?: number;
  amplitude?: number;
  durationSec?: number;
  reference?: PitchReference;
}

/** Render a chord into an AudioBuffer. */
export const renderChord = (
  ctx: BaseAudioContext,
  notes: readonly (MidiNote | null)[],
  opts: PluckOptions = {},
): AudioBuffer => {
  const {
    strumMs = 26,
    amplitude = 0.22,
    durationSec = 2.4,
    reference = CONCERT,
  } = opts;
  const sr = ctx.sampleRate;
  const length = Math.floor(durationSec * sr);
  const buffer = ctx.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);

  notes.forEach((note, stringIndex) => {
    if (note === null) return;
    const f0 = midiToHz(note, reference);
    const start = Math.floor(((stringIndex * strumMs) / 1000) * sr);
    const attack = Math.floor(0.004 * sr);

    for (let h = 1; h <= PARTIALS.length; h++) {
      const f = f0 * h;
      if (f >= sr / 2) break;
      const amp = PARTIALS[h - 1]! * amplitude;
      // Higher partials decay faster; this is what makes a pluck sound plucked rather
      // than like an organ.
      const tau = 1.9 / Math.pow(h, 0.62);
      const w = (2 * Math.PI * f) / sr;
      // Decorrelated phase per (string, partial). A tidy formula like `h * k + string`
      // leaves the partials correlated, and where two strings share a frequency — C4 and
      // C5 both put energy at 523Hz in an open C — they can cancel outright, erasing the
      // evidence the detector needs for the upper note. Real strings are never in
      // lockstep. Deterministic so playback is reproducible.
      const phase = hashPhase(stringIndex, h);
      for (let i = start; i < length; i++) {
        const t = (i - start) / sr;
        const env = i - start < attack ? (i - start) / attack : 1;
        data[i]! += amp * env * Math.exp(-t / tau) * Math.sin(w * (i - start) + phase);
      }
    }
  });

  // Fade the tail so playback never ends on a step, which clicks.
  const fade = Math.floor(0.08 * sr);
  for (let i = 0; i < fade; i++) {
    data[length - fade + i]! *= 0.5 * (1 + Math.cos((Math.PI * i) / fade));
  }
  return buffer;
};

/**
 * Play a chord through an existing context.
 *
 * Shares the practice session's AudioContext rather than opening its own: a second context
 * on iOS can be refused outright, and on every platform it risks the microphone stream
 * being reconfigured mid-session.
 */
export const playChord = (
  ctx: BaseAudioContext & { destination: AudioDestinationNode },
  notes: readonly (MidiNote | null)[],
  opts: PluckOptions = {},
): AudioBufferSourceNode => {
  const source = new AudioBufferSourceNode(ctx as BaseAudioContext, {
    buffer: renderChord(ctx, notes, opts),
  });
  source.connect(ctx.destination);
  source.start();
  return source;
};
