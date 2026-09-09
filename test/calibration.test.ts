import { describe, expect, it } from 'vitest';
import { calibrate, describeCalibration, DriftTracker, readOpenStrings } from '../src/audio/calibration';
import { SpectrumAnalyser } from '../src/audio/spectrum';
import { CONFIG } from '../src/config';
import { CONCERT, referenceFromOffset } from '../src/music/pitch';
import { getTuning } from '../src/music/tunings';
import { cents } from '../src/types';
import { DetectionPipeline, type PipelineEvent } from '../src/audio/pipeline';
import { concat, fadeOut, pluck, silence, strumDetuned } from './synth';

const SR = 44100;
const OPEN = [...getTuning('high-g').openNotes];

const specOf = (centsPerString: readonly number[], a4Hz = 440, amplitude = 0.3) => {
  const buf = strumDetuned(OPEN, centsPerString, {
    sampleRate: SR,
    durationSec: 1.2,
    a4Hz,
    amplitude,
  });
  const a = new SpectrumAnalyser(SR);
  const start = Math.floor(0.32 * SR);
  return a.analyse(buf.subarray(start, start + CONFIG.analysis.frameSize));
};

describe('open-string reading', () => {
  it('measures each string to within a few cents', () => {
    const readings = readOpenStrings(specOf([0, 0, 0, 0]), 'high-g');
    for (const r of readings) {
      expect(r.deviationCents, `string ${r.string}`).not.toBeNull();
      expect(Math.abs(r.deviationCents!), `string ${r.string}`).toBeLessThan(8);
    }
  });

  it('detects a single detuned string', () => {
    const readings = readOpenStrings(specOf([0, 0, -30, 0]), 'high-g');
    const e = readings[2]!;
    expect(e.deviationCents!).toBeLessThan(-18);
    expect(e.deviationCents!).toBeGreaterThan(-45);
  });
});

describe('global vs relative tuning', () => {
  it('absorbs a uniformly flat instrument without asking the user to do anything', () => {
    // Every string 40 cents flat: the instrument is in tune WITH ITSELF, so every
    // interval — and therefore every chord — is still correct. Only our reference was
    // wrong. Making the user chase A440 here would be pure friction.
    const out = calibrate(specOf([-40, -40, -40, -40]), 'high-g');
    expect(out.kind).toBe('auto_adjusted');
    if (out.kind !== 'auto_adjusted') throw new Error('expected auto_adjusted');
    expect(out.offsetCents).toBeLessThan(-30);
    expect(out.offsetCents).toBeGreaterThan(-50);
    expect(describeCalibration(out)).toContain('adjusted');
  });

  it('says nothing when the instrument is already at concert pitch', () => {
    const out = calibrate(specOf([0, 0, 0, 0]), 'high-g');
    expect(out.kind).toBe('in_tune');
  });

  it('refuses to absorb per-string error and names the offending string', () => {
    // One string 35 cents off relative to the rest. The intervals themselves are wrong,
    // so chords genuinely sound bad. Shifting our expectations to match would mean
    // grading someone correct for a chord that sounds wrong, and training their ear on it.
    const out = calibrate(specOf([0, 0, 35, 0]), 'high-g');
    expect(out.kind).toBe('needs_tuning');
    if (out.kind !== 'needs_tuning') throw new Error('expected needs_tuning');
    expect(out.corrections[0]?.string).toBe(2);
    expect(out.corrections[0]!.cents).toBeLessThan(0); // must come down
    expect(describeCalibration(out)).toContain('E4');
  });

  it('is not fooled into blaming the wrong string by a mistuned majority', () => {
    // Three strings sharp, one at pitch. The median keeps the reference with the group,
    // so the odd one out is the one reported — a mean would smear the blame across all four.
    const out = calibrate(specOf([30, 30, 0, 30]), 'high-g');
    expect(out.kind).toBe('needs_tuning');
    if (out.kind !== 'needs_tuning') throw new Error('expected needs_tuning');
    expect(out.corrections[0]?.string).toBe(2);
  });

  it('gives up rather than guess when more than a semitone out', () => {
    const out = calibrate(specOf([-140, -140, -140, -140]), 'high-g');
    expect(out.kind).toBe('unusable');
    if (out.kind !== 'unusable') throw new Error('expected unusable');
    expect(out.reason).toBe('off_by_more_than_a_semitone');
  });

  it('reports no signal rather than a confident reading from noise', () => {
    const out = calibrate(specOf([0, 0, 0, 0], 440, 0.00002), 'high-g');
    expect(out.kind === 'unusable' || out.kind === 'in_tune').toBe(true);
  });
});

describe('drift tracking', () => {
  it('follows an instrument going flat during a session', () => {
    const tracker = new DriftTracker(cents(0));
    // Simulate the uke sliding 25 cents flat over a handful of chords.
    for (let i = 0; i < 12; i++) {
      const spec = specOf([-25, -25, -25, -25]);
      tracker.observe(spec, OPEN, CONCERT);
    }
    expect(tracker.offsetCents).toBeLessThan(-10);
    expect(tracker.needsRecheck(cents(0))).toBe(true);
  });

  it('stays quiet when the instrument holds pitch', () => {
    const tracker = new DriftTracker(cents(0));
    for (let i = 0; i < 12; i++) tracker.observe(specOf([0, 0, 0, 0]), OPEN, CONCERT);
    expect(Math.abs(tracker.offsetCents)).toBeLessThan(CONFIG.calibration.driftRecheckCents);
    expect(tracker.needsRecheck(cents(0))).toBe(false);
  });

  it('does not demand a re-check before it has enough observations', () => {
    const tracker = new DriftTracker(cents(0));
    tracker.observe(specOf([-60, -60, -60, -60]), OPEN, CONCERT);
    expect(tracker.needsRecheck(cents(0))).toBe(false);
  });
});

describe('detection under an absorbed offset', () => {
  it('keeps working on an instrument tuned away from A440', () => {
    // The whole point of auto-calibration: once the reference moves, a flat instrument
    // is scored exactly like an in-tune one.
    const ref = referenceFromOffset(cents(-40));
    const readings = readOpenStrings(specOf([-40, -40, -40, -40]), 'high-g');
    const offsets = readings.map((r) => r.deviationCents!).filter((x) => x !== null);
    expect(Math.max(...offsets)).toBeLessThan(-25);
    // And the reference we derive puts those strings back at zero.
    for (const note of OPEN) {
      const expectedHz = 440 * Math.pow(2, (note - 69) / 12) * Math.pow(2, -40 / 1200);
      const refHz = ref.a4Hz * Math.pow(2, (note - 69) / 12);
      expect(refHz).toBeCloseTo(expectedHz, 4);
    }
  });
});

describe('guided arpeggio', () => {
  const OPEN_NOTES = [...getTuning('high-g').openNotes];

  /** One string at a time, each with its own onset, as the guided flow asks for. */
  const arpeggioBuffer = (centsPerString: readonly number[], a4Hz = 440) => {
    const parts = OPEN_NOTES.map((note, i) => {
      const buf = pluck(note + (centsPerString[i] ?? 0) / 100, {
        sampleRate: SR,
        durationSec: 0.9,
        a4Hz,
        amplitude: 0.3,
        seed: 400 + i,
      });
      return fadeOut(buf, SR);
    });
    return concat(silence(0.2, SR), ...parts.flatMap((p) => [p, silence(0.15, SR)]));
  };

  const runArpeggio = (buf: Float32Array) => {
    const pipeline = new DetectionPipeline({ sampleRate: SR, targetShapeId: null });
    pipeline.armArpeggio('high-g');
    const events: PipelineEvent[] = [];
    for (let i = 0; i + CONFIG.analysis.frameSize <= buf.length; i += CONFIG.analysis.hopSize) {
      events.push(...pipeline.pushFrame(buf.subarray(i, i + CONFIG.analysis.frameSize), i));
    }
    return events;
  };

  it('reads all four strings and prompts for each in turn', () => {
    const events = runArpeggio(arpeggioBuffer([0, 0, 0, 0]));
    const progress = events.filter((e) => e.kind === 'arpeggio');
    expect(progress).toHaveLength(4);
    expect(progress.map((p) => (p.kind === 'arpeggio' ? p.next : undefined))).toEqual([
      1, 2, 3, null,
    ]);
    const final = events.find((e) => e.kind === 'calibration');
    expect(final?.kind === 'calibration' && final.outcome.kind).toBe('in_tune');
  });

  it('is far more precise than a strum on a single string', () => {
    const events = runArpeggio(arpeggioBuffer([0, 0, 0, 0]));
    for (const e of events) {
      if (e.kind !== 'arpeggio') continue;
      expect(Math.abs(e.reading.deviationCents ?? 999)).toBeLessThan(4);
    }
  });

  it('pinpoints which string is out', () => {
    const events = runArpeggio(arpeggioBuffer([0, 0, -30, 0]));
    const final = events.find((e) => e.kind === 'calibration');
    expect(final?.kind === 'calibration' && final.outcome.kind).toBe('needs_tuning');
    if (final?.kind !== 'calibration' || final.outcome.kind !== 'needs_tuning') {
      throw new Error('expected needs_tuning');
    }
    expect(final.outcome.corrections[0]?.string).toBe(2);
    expect(final.outcome.corrections[0]!.cents).toBeGreaterThan(0); // must come up
  });

  it('handles an instrument too far out for a strum to resolve', () => {
    // Every string 140 cents flat — beyond what a strum can untangle, because each string
    // has drifted into its neighbour's search window. One at a time, there are no
    // neighbours to confuse it with.
    const events = runArpeggio(arpeggioBuffer([-140, -140, -140, -140]));
    const progress = events.filter((e) => e.kind === 'arpeggio');
    expect(progress).toHaveLength(4);
    for (const e of progress) {
      if (e.kind !== 'arpeggio') continue;
      expect(e.reading.deviationCents ?? 0).toBeLessThan(-120);
      expect(e.reading.deviationCents ?? 0).toBeGreaterThan(-160);
    }
  });
});
