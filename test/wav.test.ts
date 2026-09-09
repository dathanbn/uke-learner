import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav } from '../src/audio/wav';
import { pluck } from './synth';

const toArrayBuffer = async (blob: Blob) => blob.arrayBuffer();

describe('WAV round-trip', () => {
  it('preserves the signal within 16-bit quantisation', async () => {
    const original = pluck(60, { sampleRate: 44100, durationSec: 0.5 });
    const decoded = decodeWav(await toArrayBuffer(encodeWav(original, 44100)));
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.samples.length).toBe(original.length);
    let maxErr = 0;
    for (let i = 0; i < original.length; i++) {
      maxErr = Math.max(maxErr, Math.abs(original[i]! - decoded.samples[i]!));
    }
    // One LSB at 16 bits is ~3e-5.
    expect(maxErr).toBeLessThan(1e-4);
  });

  it('survives a fixture passing through the detector unchanged', async () => {
    const { analyseBuffer, verdictsFrom } = await import('../src/audio/pipeline');
    const { resolveShape, getShape } = await import('../src/music/shapes');
    const { concat, silence, strum } = await import('./synth');

    const notes = resolveShape(getShape('C_0003')).perString;
    const buf = concat(silence(0.2, 44100), strum(notes, { sampleRate: 44100, durationSec: 1 }, 0.02));
    const direct = verdictsFrom(analyseBuffer(buf, 44100, 'C_0003'))[0];

    const decoded = decodeWav(await toArrayBuffer(encodeWav(buf, 44100)));
    const viaWav = verdictsFrom(analyseBuffer(decoded.samples, 44100, 'C_0003'))[0];

    expect(direct?.verdict.kind).toBe('correct');
    expect(viaWav?.verdict.kind).toBe(direct?.verdict.kind);
  });

  it('rejects a file that is not a WAV', () => {
    const bogus = new ArrayBuffer(64);
    expect(() => decodeWav(bogus)).toThrow(/RIFF/);
  });

  it('finds the data chunk even when other chunks come first', async () => {
    // Recorders routinely insert LIST or fact chunks; a decoder that assumes byte 44 would
    // read that metadata as audio.
    const base = new Uint8Array(await toArrayBuffer(encodeWav(new Float32Array([0.5, -0.5]), 8000)));
    const listChunk = new Uint8Array(12);
    listChunk.set([0x4c, 0x49, 0x53, 0x54]); // "LIST"
    new DataView(listChunk.buffer).setUint32(4, 4, true);
    const merged = new Uint8Array(base.length + listChunk.length);
    merged.set(base.subarray(0, 36));
    merged.set(listChunk, 36);
    merged.set(base.subarray(36), 36 + listChunk.length);
    new DataView(merged.buffer).setUint32(4, merged.length - 8, true);

    const decoded = decodeWav(merged.buffer);
    expect(decoded.samples.length).toBe(2);
    expect(decoded.samples[0]!).toBeCloseTo(0.5, 3);
  });
});
