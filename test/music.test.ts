import { describe, expect, it } from 'vitest';
import { confusionSet } from '../src/music/confusion';
import { centsBetween, midiToHz, noteName, referenceFromOffset, referenceOffsetCents } from '../src/music/pitch';
import { getShape, resolveShape } from '../src/music/shapes';
import { getTuning } from '../src/music/tunings';
import { cents, hz, midi } from '../src/types';

describe('pitch maths', () => {
  it('anchors A4 at the reference', () => {
    expect(midiToHz(midi(69))).toBeCloseTo(440, 6);
    expect(midiToHz(midi(60))).toBeCloseTo(261.6256, 3);
    expect(midiToHz(midi(67))).toBeCloseTo(392.0, 1);
    expect(midiToHz(midi(64))).toBeCloseTo(329.6276, 3);
  });

  it('round-trips a reference offset', () => {
    const ref = referenceFromOffset(cents(-40));
    expect(referenceOffsetCents(ref)).toBeCloseTo(-40, 6);
    // A uniformly flat instrument keeps every interval intact.
    expect(centsBetween(midiToHz(midi(64), ref), midiToHz(midi(60), ref))).toBeCloseTo(400, 6);
  });

  it('names notes', () => {
    expect(noteName(midi(60))).toBe('C4');
    expect(noteName(midi(69))).toBe('A4');
    expect(noteName(midi(88))).toBe('E6');
  });

  it('measures cents between frequencies', () => {
    expect(centsBetween(hz(440), hz(220))).toBeCloseTo(1200, 6);
  });
});

describe('tunings', () => {
  it('models high-G as reentrant', () => {
    const t = getTuning('high-g');
    expect(t.reentrant).toBe(true);
    // The 4th string sounds above the 3rd. This is why there is no bass note.
    expect(t.openNotes[0]).toBeGreaterThan(t.openNotes[1]);
    expect(t.openNotes[0]).toBeGreaterThan(t.openNotes[2]);
  });

  it('models low-G as not reentrant', () => {
    const t = getTuning('low-g');
    expect(t.reentrant).toBe(false);
    expect(t.openNotes[0]).toBeLessThan(t.openNotes[1]);
  });
});

describe('shape resolution', () => {
  it('resolves the Tier 1 chords to the right pitches', () => {
    expect(resolveShape(getShape('C_0003')).perString).toEqual([67, 60, 64, 72]);
    expect(resolveShape(getShape('Am_2000')).perString).toEqual([69, 60, 64, 69]);
    expect(resolveShape(getShape('F_2010')).perString).toEqual([69, 60, 65, 69]);
    expect(resolveShape(getShape('G7_0212')).perString).toEqual([67, 62, 65, 71]);
  });

  it('collapses duplicate pitches into the target note set', () => {
    // Am sounds A on two strings; the detector should target three distinct notes.
    expect(resolveShape(getShape('Am_2000')).notes).toEqual([60, 64, 69]);
  });

  it('confirms the ambiguity that forces verification over identification', () => {
    // All open strings: C6 and Am7 are the same four notes. There is no signal-side
    // fix for this, which is why the detector always scores against a known target.
    const am7 = resolveShape(getShape('Am7_0000'));
    expect([...am7.notes].map((n) => n % 12).sort()).toEqual([0, 4, 7, 9]);
  });
});

describe('confusion set', () => {
  const set = confusionSet(getShape('C_0003'));

  it('generates plausible near misses', () => {
    expect(set.length).toBeGreaterThan(8);
    expect(set.some((h) => h.label.includes('fret'))).toBe(true);
    expect(set.some((h) => h.label.includes('muted'))).toBe(true);
  });

  it('never includes a hypothesis identical to the target', () => {
    const target = resolveShape(getShape('C_0003')).notes.join(',');
    expect(set.some((h) => h.target.notes.join(',') === target)).toBe(false);
  });

  it('includes the classic C error: ring finger on the wrong fret', () => {
    const notes = set.map((h) => h.target.notes.join(','));
    // A string fretted at 2 instead of 3 gives B4 (71) rather than C5 (72).
    expect(notes).toContain([60, 64, 67, 71].join(','));
  });

  it('is deterministic', () => {
    expect(confusionSet(getShape('C_0003')).map((h) => h.id)).toEqual(set.map((h) => h.id));
  });
});
