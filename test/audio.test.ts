import { describe, expect, it } from 'vitest';
import { computeActivation, topNotes } from '../src/audio/activation';
import { OnsetDetector } from '../src/audio/onset';
import { SpectrumAnalyser } from '../src/audio/spectrum';
import { analyseBuffer, verdictsFrom } from '../src/audio/pipeline';
import { CONFIG } from '../src/config';
import { getShape, resolveShape } from '../src/music/shapes';
import { noteName } from '../src/music/pitch';
import { midi } from '../src/types';
import { concat, pluck, silence, strum } from './synth';

const SR = 44100;
const opts = { sampleRate: SR, durationSec: 1.2 };

const analyseAt = (buf: Float32Array, offsetSec: number) => {
  const a = new SpectrumAnalyser(SR);
  const start = Math.floor(offsetSec * SR);
  return a.analyse(buf.subarray(start, start + CONFIG.analysis.frameSize));
};

describe('spectrum', () => {
  it('finds the fundamental of a single plucked note', () => {
    const buf = pluck(60, opts, 0);
    const spec = analyseAt(buf, 0.05);
    const act = computeActivation(spec);
    const top = topNotes(act, 3);
    expect(top[0]?.note).toBe(60);
  });

  it('reports RMS that tracks amplitude', () => {
    const loud = analyseAt(pluck(60, { ...opts, amplitude: 0.4 }, 0), 0.05);
    const quiet = analyseAt(pluck(60, { ...opts, amplitude: 0.02 }, 0), 0.05);
    expect(loud.rms).toBeGreaterThan(quiet.rms * 5);
  });
});

describe('note activation', () => {
  it('recovers all notes of a strummed C chord', () => {
    const target = resolveShape(getShape('C_0003'));
    const buf = strum(target.perString, opts, 0.05);
    const spec = analyseAt(buf, 0.2);
    const act = computeActivation(spec);
    const found = new Set(topNotes(act, 6, 0.3).map((t) => t.note));
    for (const n of target.notes) {
      expect(found, `expected ${noteName(n)} in ${[...found].map(noteName).join(', ')}`).toContain(n);
    }
  });

  it('separates a real octave from an octave ghost', () => {
    // A lone C4 puts real energy at C5 (its 2nd partial) and G5 (its 3rd). Peeling
    // subtracts a *modelled* amount rather than clearing those bins, deliberately
    // under-subtracting so that a genuinely played octave survives — C major on a
    // ukulele is C4 and C5 together, so erasing octaves would break the default deck.
    // The property that matters is therefore comparative, not an absolute ceiling.
    const lone = computeActivation(analyseAt(pluck(60, opts, 0), 0.05));
    const both = computeActivation(
      analyseAt(pluck(72, opts, 0, 1, pluck(60, opts, 0)), 0.05),
    );
    const idx = midi(72) - CONFIG.range.lowNote;
    expect(both.values[idx]!).toBeGreaterThan(lone.values[idx]! * 1.5);
  });

  it('keeps the fifth ghost below the notes that caused it', () => {
    // G5 is C4's 3rd partial. It must never outrank C4 itself.
    const act = computeActivation(analyseAt(pluck(60, opts, 0), 0.05));
    const c4 = act.values[midi(60) - CONFIG.range.lowNote]!;
    const g5 = act.values[midi(79) - CONFIG.range.lowNote]!;
    expect(g5).toBeLessThan(c4 * 0.75);
  });

  it('distinguishes a semitone', () => {
    const specB = analyseAt(pluck(71, opts, 0), 0.05);
    const act = computeActivation(specB);
    const b4 = act.values[71 - CONFIG.range.lowNote]!;
    const c5 = act.values[72 - CONFIG.range.lowNote]!;
    expect(b4).toBeGreaterThan(0.9);
    expect(c5).toBeLessThan(0.6);
  });
});

describe('onset detection', () => {
  it('reports one onset per strum, not one per string', () => {
    const target = resolveShape(getShape('C_0003'));
    const buf = concat(
      silence(0.15, SR),
      strum(target.perString, { ...opts, durationSec: 1.0 }, 0.02),
      silence(0.1, SR),
    );
    const det = new OnsetDetector(SR);
    const a = new SpectrumAnalyser(SR);
    let count = 0;
    for (let i = 0; i + CONFIG.analysis.frameSize <= buf.length; i += CONFIG.analysis.hopSize) {
      const spec = a.analyse(buf.subarray(i, i + CONFIG.analysis.frameSize));
      if (det.push(spec, i).onset) count++;
    }
    expect(count).toBe(1);
  });

  it('does not fire on silence', () => {
    const buf = silence(1.0, SR);
    const det = new OnsetDetector(SR);
    const a = new SpectrumAnalyser(SR);
    let count = 0;
    for (let i = 0; i + CONFIG.analysis.frameSize <= buf.length; i += CONFIG.analysis.hopSize) {
      const spec = a.analyse(buf.subarray(i, i + CONFIG.analysis.frameSize));
      if (det.push(spec, i).onset) count++;
    }
    expect(count).toBe(0);
  });
});

describe('end-to-end verdicts', () => {
  const play = (shapeId: string, notes: readonly (number | null)[]) => {
    const buf = concat(silence(0.2, SR), strum(notes, { ...opts, durationSec: 1.0 }, 0.02));
    return verdictsFrom(analyseBuffer(buf, SR, shapeId));
  };

  it('accepts a correctly played C', () => {
    const v = play('C_0003', resolveShape(getShape('C_0003')).perString);
    expect(v).toHaveLength(1);
    expect(v[0]?.verdict.kind).toBe('correct');
  });

  it('accepts all Tier 1 chords', () => {
    for (const id of ['C_0003', 'Am_2000', 'F_2010', 'G7_0212']) {
      const v = play(id, resolveShape(getShape(id)).perString);
      expect(v[0]?.verdict.kind, `${id} should be accepted`).toBe('correct');
    }
  });

  it('rejects C played with the ring finger one fret flat', () => {
    // 0002 instead of 0003 — B4 where C5 belongs. The single most common C error.
    const v = play('C_0003', [67, 60, 64, 71]);
    expect(v[0]?.verdict.kind).not.toBe('correct');
  });

  it('rejects a different chord entirely', () => {
    const v = play('C_0003', resolveShape(getShape('G7_0212')).perString);
    expect(v[0]?.verdict.kind).not.toBe('correct');
  });

  it('diagnoses which string is wrong', () => {
    const v = play('C_0003', [67, 60, 64, 71]);
    const verdict = v[0]?.verdict;
    expect(verdict?.kind).toBe('incorrect');
    if (verdict?.kind !== 'incorrect') throw new Error('expected incorrect');
    const bad = verdict.perString.find((d) => d.fault.kind === 'wrong_fret');
    expect(bad?.string).toBe(3);
    if (bad?.fault.kind !== 'wrong_fret') throw new Error('expected wrong_fret');
    expect(bad.fault.expected).toBe(72);
    expect(bad.fault.heard).toBe(71);
    expect(bad.fault.fretDelta).toBe(-1);
  });

  it('returns unclear rather than a grade for near-silence', () => {
    const buf = concat(
      silence(0.2, SR),
      strum(resolveShape(getShape('C_0003')).perString, {
        ...opts,
        durationSec: 1.0,
        amplitude: 0.0009,
      }, 0.02),
    );
    const v = verdictsFrom(analyseBuffer(buf, SR, 'C_0003'));
    for (const e of v) expect(e.verdict.kind).not.toBe('correct');
  });

  it('produces a verdict inside the latency budget', () => {
    const v = play('C_0003', resolveShape(getShape('C_0003')).perString);
    expect(v[0]!.msFromOnset).toBeLessThanOrEqual(300);
  });
});
