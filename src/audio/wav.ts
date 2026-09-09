/**
 * Minimal 16-bit PCM WAV encode/decode.
 *
 * Uncompressed on purpose. The fixture corpus is the ground truth the detector is tuned
 * against, and a lossy codec — which is what MediaRecorder would give us — discards
 * exactly the high-partial detail the peeling stage depends on. A corpus that has been
 * through Opus would be measuring the codec as much as the instrument.
 */

export const encodeWav = (samples: Float32Array, sampleRate: number): Blob => {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }
  return new Blob([buffer], { type: 'audio/wav' });
};

export interface DecodedWav {
  samples: Float32Array;
  sampleRate: number;
}

/**
 * Decode a mono or multi-channel PCM WAV. Multi-channel input is mixed down, since the
 * detector is mono and a stereo fixture would otherwise be read as garbage.
 *
 * Chunks are walked rather than assumed at fixed offsets: recorders routinely insert LIST
 * or fact chunks before `data`, and a decoder that assumes byte 44 reads metadata as audio.
 */
export const decodeWav = (bytes: ArrayBuffer): DecodedWav => {
  const view = new DataView(bytes);
  const tag = (o: number) =>
    String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));

  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');

  let offset = 12;
  let channels = 1;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let format = 1;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= view.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      dataOffset = body;
      dataLength = size;
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }

  if (dataOffset < 0) throw new Error('no data chunk');
  if (format !== 1 && format !== 3) throw new Error(`unsupported WAV format ${format}`);

  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.floor(dataLength / (bytesPerSample * channels));
  const out = new Float32Array(frames);

  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const at = dataOffset + (f * channels + c) * bytesPerSample;
      if (format === 3) sum += view.getFloat32(at, true);
      else if (bitsPerSample === 16) sum += view.getInt16(at, true) / 0x8000;
      else if (bitsPerSample === 8) sum += (view.getUint8(at) - 128) / 128;
      else if (bitsPerSample === 32) sum += view.getInt32(at, true) / 0x80000000;
      else throw new Error(`unsupported bit depth ${bitsPerSample}`);
    }
    out[f] = sum / channels;
  }

  return { samples: out, sampleRate };
};
