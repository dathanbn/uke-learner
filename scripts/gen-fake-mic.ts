/**
 * Renders a fake microphone feed for end-to-end testing: a calibration strum, then the
 * Tier 1 chords in the order the deck introduces them.
 *
 *   npx tsx scripts/gen-fake-mic.ts
 *   npm run build && npx vite preview
 *
 * then launch Chromium with:
 *   --use-fake-ui-for-media-stream
 *   --use-fake-device-for-media-capture
 *   --use-file-for-fake-audio-capture=/tmp/fake-mic.wav%noloop
 *
 * and the app should calibrate and advance through several cards by itself.
 *
 * UNVERIFIED. Written in a container with no audio device, where Chromium's fake capture
 * device fails to enumerate at all (getUserMedia throws NotFoundError), so the flow above
 * has never been run end to end. The WAV itself is sound — same synthesis as the test
 * corpus, and it round-trips through the detector — but whether Chromium accepts it as a
 * microphone is untested. Try it on a machine with working audio; if the flags need
 * adjusting, fix them and delete this paragraph.
 */
import { writeFileSync } from 'node:fs';
import { encodeWav } from '../src/audio/wav';
import { getTuning } from '../src/music/tunings';
import { getShape, resolveShape } from '../src/music/shapes';
import { concat, silence, strum } from '../test/synth';

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
