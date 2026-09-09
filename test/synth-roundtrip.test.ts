import { describe, expect, it } from 'vitest';
import { renderChord } from '../src/audio/synth';
import { analyseBuffer, verdictsFrom } from '../src/audio/pipeline';
import { getShape, resolveShape } from '../src/music/shapes';
import { buildEarCards, buildDeck, knownShapes, Scheduler } from '../src/srs/scheduler';
import { DEFAULT_SETTINGS, type Card } from '../src/srs/types';
import { Rating } from 'ts-fsrs';

const SR = 44100;

/**
 * Minimal stand-in for a BaseAudioContext. `renderChord` only needs sampleRate and
 * createBuffer, so this keeps the round-trip test out of a browser.
 */
const fakeCtx = (sampleRate = SR) =>
  ({
    sampleRate,
    createBuffer: (_ch: number, length: number, sr: number) => {
      const data = new Float32Array(length);
      return {
        length,
        sampleRate: sr,
        numberOfChannels: 1,
        getChannelData: () => data,
      };
    },
  }) as unknown as BaseAudioContext;

/**
 * The strongest check available on the playback synthesiser: render a chord with it, feed
 * the result to the detector, and require the detector to name it correctly. If the synth
 * produced wrong pitches, or an envelope with no usable attack, this fails.
 */
describe('ear-training playback round-trips through the detector', () => {
  for (const id of ['C_0003', 'Am_2000', 'F_2010', 'G7_0212']) {
    it(`renders ${getShape(id).name} well enough for the detector to accept it`, () => {
      const notes = resolveShape(getShape(id)).perString;
      const buffer = renderChord(fakeCtx(), notes, { durationSec: 2 });
      const samples = buffer.getChannelData(0);

      // Pad the front so the onset detector has a quiet run-up, as it would in a room.
      const padded = new Float32Array(samples.length + SR * 0.25);
      padded.set(samples, Math.floor(SR * 0.25));

      const verdicts = verdictsFrom(analyseBuffer(padded, SR, id));
      expect(verdicts.length, 'expected an onset and a verdict').toBeGreaterThan(0);
      expect(verdicts[0]!.verdict.kind).toBe('correct');
    });
  }

  it('is not simply accepting anything — a different chord is rejected', () => {
    const notes = resolveShape(getShape('G7_0212')).perString;
    const buffer = renderChord(fakeCtx(), notes, { durationSec: 2 });
    const samples = buffer.getChannelData(0);
    const padded = new Float32Array(samples.length + SR * 0.25);
    padded.set(samples, Math.floor(SR * 0.25));
    const verdicts = verdictsFrom(analyseBuffer(padded, SR, 'C_0003'));
    expect(verdicts[0]?.verdict.kind).not.toBe('correct');
  });
});

describe('ear-training deck', () => {
  const scheduler = new Scheduler(0.9);
  const now = new Date('2026-01-01T09:00:00Z');
  const settings = { ...DEFAULT_SETTINGS, maxTier: 1, earTraining: true };

  const mature = (card: Card): Card => ({
    ...card,
    fsrs: { ...scheduler.grade(card, Rating.Good, now).fsrs, scheduled_days: 10 },
  });

  it('adds nothing when the setting is off', () => {
    const deck = buildDeck(scheduler, settings, now).map(mature);
    const off = { ...settings, earTraining: false };
    expect(buildEarCards(scheduler, off, knownShapes(deck), now)).toHaveLength(0);
  });

  it('waits until a chord can actually be played', () => {
    const deck = buildDeck(scheduler, settings, now);
    expect(buildEarCards(scheduler, settings, knownShapes(deck), now)).toHaveLength(0);
  });

  it('adds one card per known chord once unlocked', () => {
    const deck = buildDeck(scheduler, settings, now).map(mature);
    const cards = buildEarCards(scheduler, settings, knownShapes(deck), now);
    expect(cards).toHaveLength(4);
    expect(cards.every((c) => c.presentation === 'ear_to_play')).toBe(true);
  });

  it('does not let ear cards gate their own unlocking', () => {
    // Ear cards are excluded from the "is this chord known" check. Including them would be
    // circular: they can never mature before they exist, so nothing would ever unlock.
    const deck = buildDeck(scheduler, settings, now).map(mature);
    const withEar = [...deck, ...buildEarCards(scheduler, settings, knownShapes(deck), now)];
    expect(knownShapes(withEar).size).toBe(4);
  });
});
