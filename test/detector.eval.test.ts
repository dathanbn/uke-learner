import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeWav } from '../src/audio/wav';
import { analyseBuffer, verdictsFrom } from '../src/audio/pipeline';
import { confusionSet } from '../src/music/confusion';
import { getShape, resolveShape } from '../src/music/shapes';
import { SHAPES } from '../src/music/shapes';
import type { MidiNote } from '../src/types';
import { concat, silence, strum } from './synth';

/**
 * The evaluation harness.
 *
 * Right now it runs on synthesised audio, which is cleaner than any real room — treat
 * these numbers as a floor on difficulty, not a measure of field accuracy. The moment
 * test/fixtures/ holds real WAVs, point this at them too (see docs/AUDIO_ENGINE.md);
 * the analysis path is identical, so the same code scores both.
 *
 * The asymmetry in the CI floors is deliberate. A false reject annoys the user and they
 * strum again. A false accept teaches them the wrong chord shape, silently, which is the
 * one thing the app exists to prevent.
 */

const SR = 44100;
const MIN_TRUE_ACCEPT = 0.95;
const MAX_FALSE_ACCEPT = 0.02;

interface Case {
  shapeId: string;
  notes: readonly (MidiNote | null)[];
  shouldAccept: boolean;
  description: string;
  seed: number;
  amplitude: number;
  noiseFloor: number;
  strumMs: number;
}

/**
 * Playing conditions each take is rendered under.
 *
 * Varying these — not just the RNG seed — is what makes the score mean something. With
 * one condition per chord the metric swings several points on nothing but a different
 * random gain balance, which is enough to make parameter tuning chase noise.
 */
const CONDITIONS = [
  { amplitude: 0.5, noiseFloor: 0.0012, strumMs: 18, label: 'normal' },
  { amplitude: 0.08, noiseFloor: 0.0012, strumMs: 16, label: 'quiet' },
  { amplitude: 0.92, noiseFloor: 0.0008, strumMs: 22, label: 'loud' },
  { amplitude: 0.35, noiseFloor: 0.006, strumMs: 14, label: 'noisy room' },
  { amplitude: 0.5, noiseFloor: 0.0012, strumMs: 26, label: 'slow strum' },
  { amplitude: 0.5, noiseFloor: 0.002, strumMs: 11, label: 'fast strum' },
] as const;

/** Correct takes, plus every near miss the confusion generator knows how to produce. */
const buildCases = (): Case[] => {
  const cases: Case[] = [];
  let seed = 1;
  for (const shape of SHAPES.filter((s) => s.tier <= 3)) {
    const target = resolveShape(shape);
    for (const cond of CONDITIONS) {
      cases.push({
        shapeId: shape.id,
        notes: target.perString,
        shouldAccept: true,
        description: `${shape.name} correct (${cond.label})`,
        seed: seed++,
        amplitude: cond.amplitude,
        noiseFloor: cond.noiseFloor,
        strumMs: cond.strumMs,
      });
    }
    for (const hyp of confusionSet(shape)) {
      const cond = CONDITIONS[seed % CONDITIONS.length]!;
      cases.push({
        shapeId: shape.id,
        notes: hyp.target.perString,
        shouldAccept: false,
        description: `${shape.name}: ${hyp.label}`,
        seed: seed++,
        amplitude: cond.amplitude,
        noiseFloor: cond.noiseFloor,
        strumMs: cond.strumMs,
      });
    }
  }
  return cases;
};

const runCase = (c: Case) => {
  const buf = concat(
    silence(0.2, SR),
    strum(
      c.notes,
      {
        sampleRate: SR,
        durationSec: 1.0,
        seed: c.seed,
        amplitude: c.amplitude,
        noiseFloor: c.noiseFloor,
      },
      0.02,
      c.strumMs,
    ),
  );
  return verdictsFrom(analyseBuffer(buf, SR, c.shapeId))[0];
};

/**
 * Real recordings, when there are any.
 *
 * `test/fixtures/<tuning>/<CHORD>_<correct|wrong-description>_NN.wav` — the naming the
 * in-app fixture recorder produces, so files can be dropped straight in. Nothing here is
 * required to exist; the suite reports the corpus as empty and passes, so the repo works
 * before anyone has picked up an instrument. But the synthetic numbers are a floor on
 * difficulty, not a measure of field accuracy, and only these files can tell you which.
 */
const FIXTURE_ROOT = join(__dirname, 'fixtures');

interface Fixture {
  path: string;
  tuningId: string;
  shapeId: string;
  shouldAccept: boolean;
  description: string;
}

const findFixtures = (): Fixture[] => {
  if (!existsSync(FIXTURE_ROOT)) return [];
  const out: Fixture[] = [];
  for (const tuningId of readdirSync(FIXTURE_ROOT)) {
    const dir = join(FIXTURE_ROOT, tuningId);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of entries) {
      if (!file.toLowerCase().endsWith('.wav')) continue;
      const [chord, kind] = file.replace(/\.wav$/i, '').split('_');
      if (!chord || !kind) continue;
      const shape = SHAPES.find((sh) => sh.name === chord);
      if (!shape) continue;
      out.push({
        path: join(dir, file),
        tuningId,
        shapeId: shape.id,
        shouldAccept: kind === 'correct',
        description: file,
      });
    }
  }
  return out;
};

describe('detector evaluation on real recordings', () => {
  const fixtures = findFixtures();

  it.skipIf(fixtures.length === 0)('meets the accuracy floor on real audio', () => {
    let truePos = 0;
    let falseNeg = 0;
    let falsePos = 0;
    let trueNeg = 0;
    const failures: string[] = [];

    for (const f of fixtures) {
      const { samples, sampleRate } = decodeWav(
        readFileSync(f.path).buffer as ArrayBuffer,
      );
      const ev = verdictsFrom(
        analyseBuffer(samples, sampleRate, f.shapeId, undefined, f.tuningId),
      )[0];
      const kind = ev?.verdict.kind ?? 'none';
      if (f.shouldAccept) {
        kind === 'correct' ? truePos++ : (falseNeg++, failures.push(`FALSE REJECT [${kind}] ${f.description}`));
      } else {
        kind === 'correct' ? (falsePos++, failures.push(`FALSE ACCEPT ${f.description}`)) : trueNeg++;
      }
    }

    const trueAccept = truePos / Math.max(1, truePos + falseNeg);
    const falseAccept = falsePos / Math.max(1, trueNeg + falsePos);
    console.log(
      [
        '',
        `  real corpus: ${fixtures.length} files`,
        `    true-accept  ${(trueAccept * 100).toFixed(1)}%  (${truePos}/${truePos + falseNeg})`,
        `    false-accept ${(falseAccept * 100).toFixed(1)}%  (${falsePos}/${trueNeg + falsePos})`,
        ...failures.slice(0, 20).map((x) => `    ${x}`),
      ].join('\n'),
    );

    if (truePos + falseNeg > 0) expect(trueAccept).toBeGreaterThanOrEqual(MIN_TRUE_ACCEPT);
    if (trueNeg + falsePos > 0) expect(falseAccept).toBeLessThanOrEqual(MAX_FALSE_ACCEPT);
  });

  it('says so when the corpus is empty', () => {
    if (fixtures.length === 0) {
      console.log(
        '\n  No real recordings yet. Every accuracy number in this repo is synthetic —\n' +
          '  use the fixture recorder on the debug page to start a real corpus.\n',
      );
    }
    expect(true).toBe(true);
  });
});

describe('detector evaluation', () => {
  it('meets the accuracy floor', () => {
    const cases = buildCases();
    let truePos = 0;
    let falseNeg = 0;
    let falsePos = 0;
    let trueNeg = 0;
    let unclearOnCorrect = 0;
    let unclearOnWrong = 0;
    const failures: string[] = [];

    for (const c of cases) {
      const ev = runCase(c);
      const kind = ev?.verdict.kind ?? 'none';
      if (c.shouldAccept) {
        if (kind === 'correct') truePos++;
        else {
          falseNeg++;
          if (kind === 'unclear') unclearOnCorrect++;
          failures.push(`FALSE REJECT [${kind}] ${c.description}`);
        }
      } else {
        if (kind === 'correct') {
          falsePos++;
          failures.push(`FALSE ACCEPT ${c.description}`);
        } else {
          trueNeg++;
          if (kind === 'unclear') unclearOnWrong++;
        }
      }
    }

    const positives = truePos + falseNeg;
    const negatives = trueNeg + falsePos;
    const trueAcceptRate = truePos / positives;
    const falseAcceptRate = falsePos / negatives;

    const table = [
      '',
      '  ┌─ detector confusion matrix ───────────────────────────┐',
      `  │ correct takes      ${String(positives).padStart(4)}                            │`,
      `  │   accepted         ${String(truePos).padStart(4)}   true-accept  ${(trueAcceptRate * 100).toFixed(1).padStart(5)}%  │`,
      `  │   rejected         ${String(falseNeg).padStart(4)}   (${unclearOnCorrect} unclear)             │`,
      '  ├───────────────────────────────────────────────────────┤',
      `  │ wrong takes        ${String(negatives).padStart(4)}                            │`,
      `  │   rejected         ${String(trueNeg).padStart(4)}   (${unclearOnWrong} unclear)             │`,
      `  │   accepted         ${String(falsePos).padStart(4)}   false-accept ${(falseAcceptRate * 100).toFixed(1).padStart(5)}%  │`,
      '  └───────────────────────────────────────────────────────┘',
      ...failures.slice(0, 20).map((f) => `    ${f}`),
      failures.length > 20 ? `    ... and ${failures.length - 20} more` : '',
    ].filter(Boolean);
    console.log(table.join('\n'));

    expect(trueAcceptRate).toBeGreaterThanOrEqual(MIN_TRUE_ACCEPT);
    expect(falseAcceptRate).toBeLessThanOrEqual(MAX_FALSE_ACCEPT);
  });

  it('never mistakes one Tier 1 chord for another', () => {
    // The most damaging possible failure: accepting F when C was asked for.
    const tier1 = ['C_0003', 'Am_2000', 'F_2010', 'G7_0212'];
    for (const asked of tier1) {
      for (const played of tier1) {
        if (asked === played) continue;
        const ev = runCase({
          shapeId: asked,
          notes: resolveShape(getShape(played)).perString,
          shouldAccept: false,
          description: `${asked} vs ${played}`,
          seed: 700,
          amplitude: 0.3,
          noiseFloor: 0.0012,
          strumMs: 18,
        });
        expect(ev?.verdict.kind, `asked ${asked}, played ${played}`).not.toBe('correct');
      }
    }
  });
});
