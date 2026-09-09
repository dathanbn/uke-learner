import { writeFileSync } from 'node:fs';
import { encodeWav } from './src/audio/wav';
import { getTuning } from './src/music/tunings';
import { getShape, resolveShape } from './src/music/shapes';
import { concat, silence, strum } from './test/synth';

const SR = 48000; // Chromium's fake capture device runs at 48k
const parts: Float32Array[] = [silence(1.5, SR)];

// Calibration: all four open strings.
parts.push(
  strum([...getTuning('high-g').openNotes], { sampleRate: SR, durationSec: 1.6, amplitude: 0.55 }, 0.05),
  silence(1.2, SR),
);

// The deck introduces diagram-then-name per shape, capped at 5 new cards.
const order = ['C_0003', 'C_0003', 'Am_2000', 'Am_2000', 'F_2010', 'F_2010', 'G7_0212', 'G7_0212'];
for (const id of order) {
  const notes = resolveShape(getShape(id)).perString;
  parts.push(
    strum(notes, { sampleRate: SR, durationSec: 1.8, amplitude: 0.55, seed: id.length * 31 }, 0.05),
    silence(1.4, SR),
  );
}

const buf = concat(...parts);
const blob = encodeWav(buf, SR);
const bytes = new Uint8Array(await blob.arrayBuffer());
writeFileSync('/tmp/fake-mic.wav', bytes);
console.log(`wrote /tmp/fake-mic.wav — ${(buf.length / SR).toFixed(1)}s @ ${SR}Hz`);
