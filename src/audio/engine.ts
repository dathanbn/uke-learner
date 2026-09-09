import type { CalibrationOutcome, StringReading } from './calibration';
import { playChord } from './synth';
import type { MidiNote } from '../types';
import type { StringIndex } from '../types';
import type { Verdict } from '../types';
import type { ScoredHypothesis } from './verdict';
import workletUrl from './worklet/detector-worklet.ts?worker&url';

/**
 * Browser-side wiring: microphone → AudioWorklet → callbacks.
 *
 * Everything here is glue. All the analysis lives in pipeline.ts, which is why the same
 * detector can be tested headlessly.
 */

export interface FrameUpdate {
  rms: number;
  flux: number;
  activation: Float32Array;
}

export interface VerdictUpdate {
  verdict: Verdict;
  msFromOnset: number;
  targetConfidence: number;
  ranked: readonly ScoredHypothesis[];
  activation: Float32Array;
}

export interface EngineHandlers {
  onFrame?: (f: FrameUpdate) => void;
  onOnset?: () => void;
  onVerdict?: (v: VerdictUpdate) => void;
  onCalibration?: (o: CalibrationOutcome) => void;
  onArpeggioProgress?: (r: StringReading, next: StringIndex | null) => void;
}

export interface MicStatus {
  /** True when the browser honoured our request to disable voice processing. */
  rawAudio: boolean;
  applied: MediaTrackSettings;
  deviceLabel: string;
  /** Set when the input is a device known to mangle musical signal. */
  warning: string | null;
}

const BAD_INPUT_HINTS = ['airpods', 'bluetooth', 'headset', 'hands-free', 'hfp'];

export interface SelfTestResult {
  ok: boolean;
  detail: string;
  verdicts: number;
}

/**
 * Run the whole detection chain without a microphone.
 *
 * Renders a chord, pushes it through the *built* AudioWorklet in an OfflineAudioContext,
 * and checks a correct verdict comes back. This verifies the one thing unit tests cannot:
 * that the worklet module actually loads and registers in a browser. Everything else is
 * pure TypeScript and covered headlessly, but a broken worklet URL or a build that drops
 * the processor would leave the app silently unable to grade anything, and the first
 * person to find out would be a user with a ukulele in their hands.
 *
 * Also worth offering to users: it separates "the app is broken" from "my microphone is
 * not working", which are otherwise indistinguishable from the outside.
 */
export const runSelfTest = async (shapeId = 'C_0003'): Promise<SelfTestResult> => {
  try {
    const sampleRate = 44100;
    const seconds = 3;
    const ctx = new OfflineAudioContext(1, sampleRate * seconds, sampleRate);
    await ctx.audioWorklet.addModule(workletUrl);

    const node = new AudioWorkletNode(ctx, 'uke-detector', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });

    let verdicts = 0;
    let correct = 0;
    node.port.onmessage = (e: MessageEvent<{ kind: string; verdict?: Verdict }>) => {
      if (e.data.kind !== 'verdict') return;
      verdicts++;
      if (e.data.verdict?.kind === 'correct') correct++;
    };
    node.port.postMessage({ type: 'target', shapeId });

    const { resolveShape, getShape } = await import('../music/shapes');
    const notes = resolveShape(getShape(shapeId)).perString;
    const { renderChord } = await import('./synth');

    // Leading silence so the onset detector has a quiet run-up, as it would in a room.
    const chord = renderChord(ctx, notes, { durationSec: 2.5 });
    const padded = ctx.createBuffer(1, sampleRate * seconds, sampleRate);
    padded.getChannelData(0).set(chord.getChannelData(0), Math.floor(sampleRate * 0.3));

    const source = new AudioBufferSourceNode(ctx, { buffer: padded });
    source.connect(node);
    node.connect(ctx.destination);
    source.start();
    await ctx.startRendering();

    // Message delivery from the worklet is asynchronous to rendering completion.
    await new Promise((r) => setTimeout(r, 120));

    if (verdicts === 0) {
      return { ok: false, detail: 'The audio worklet loaded but produced no verdict.', verdicts };
    }
    if (correct === 0) {
      return {
        ok: false,
        detail: `Got ${verdicts} verdict(s), but none matched the test chord.`,
        verdicts,
      };
    }
    return { ok: true, detail: 'Detection is working.', verdicts };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { ok: false, detail: `${err.name}: ${err.message}`, verdicts: 0 };
  }
};

export class AudioEngine {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private handlers: EngineHandlers = {};
  private recorded: Float32Array[] = [];
  status: MicStatus | null = null;

  get running(): boolean {
    return this.node !== null;
  }

  get sampleRate(): number {
    return this.context?.sampleRate ?? 44100;
  }

  /** Latency the browser reports on the input path, in ms. Informational. */
  get inputLatencyMs(): number {
    const ctx = this.context;
    return ctx ? (ctx.baseLatency ?? 0) * 1000 : 0;
  }

  /** Replace handlers on a running engine, so screens can take over the callbacks. */
  setHandlers(handlers: EngineHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  async start(handlers: EngineHandlers): Promise<MicStatus> {
    this.handlers = handlers;

    // These default to true and are tuned for speech. Noise suppression eats sustained
    // harmonic content and AGC flattens the decay envelope the onset detector reads.
    // Leaving them on is the single most common reason browser audio "just doesn't work"
    // (CLAUDE.md invariant 2).
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    const track = this.stream.getAudioTracks()[0];
    const applied = track?.getSettings() ?? {};

    // Some browsers accept the constraint and ignore it. Check rather than assume, and
    // tell the user, because the failure is otherwise silent and looks like a bad detector.
    const rawAudio =
      applied.echoCancellation !== true &&
      applied.noiseSuppression !== true &&
      applied.autoGainControl !== true;

    const deviceLabel = track?.label ?? 'unknown input';
    const lower = deviceLabel.toLowerCase();
    const warning = BAD_INPUT_HINTS.some((h) => lower.includes(h))
      ? `“${deviceLabel}” looks like a Bluetooth mic. Those are mono, heavily processed and laggy — the built-in mic will work much better.`
      : null;

    // AudioContext must be created inside a user gesture on iOS Safari.
    this.context = new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
    await this.context.audioWorklet.addModule(workletUrl);

    const source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, 'uke-detector', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    this.node.port.onmessage = (e) => this.dispatch(e.data);
    source.connect(this.node);

    this.status = { rawAudio, applied, deviceLabel, warning };
    return this.status;
  }

  private dispatch(msg: {
    kind: string;
    rms?: number;
    flux?: number;
    activation?: number[];
    verdict?: Verdict;
    msFromOnset?: number;
    targetConfidence?: number;
    ranked?: ScoredHypothesis[];
    outcome?: CalibrationOutcome;
    reading?: StringReading;
    next?: StringIndex | null;
    samples?: Float32Array;
  }): void {
    if (msg.kind === 'pcm') {
      if (msg.samples) this.recorded.push(msg.samples);
      return;
    }
    if (msg.kind === 'frame') {
      this.handlers.onFrame?.({
        rms: msg.rms ?? 0,
        flux: msg.flux ?? 0,
        activation: Float32Array.from(msg.activation ?? []),
      });
    } else if (msg.kind === 'onset') {
      this.handlers.onOnset?.();
    } else if (msg.kind === 'calibration' && msg.outcome) {
      this.handlers.onCalibration?.(msg.outcome);
    } else if (msg.kind === 'arpeggio' && msg.reading) {
      this.handlers.onArpeggioProgress?.(msg.reading, msg.next ?? null);
    } else if (msg.kind === 'verdict' && msg.verdict) {
      this.handlers.onVerdict?.({
        verdict: msg.verdict,
        msFromOnset: msg.msFromOnset ?? 0,
        targetConfidence: msg.targetConfidence ?? 0,
        ranked: msg.ranked ?? [],
        activation: Float32Array.from(msg.activation ?? []),
      });
    }
  }

  setTarget(shapeId: string | null): void {
    this.node?.port.postMessage({ type: 'target', shapeId });
  }

  /**
   * Start a guided arpeggio: the next four onsets are read as single strings in order.
   * Pass null to cancel.
   */
  calibrateArpeggio(tuningId: string | null): void {
    this.node?.port.postMessage({ type: 'arpeggio', tuningId });
  }

  /** Tell the detector which instrument it is listening to, and how lenient to be. */
  configure(tuningId: string, sensitivity: number): void {
    this.node?.port.postMessage({ type: 'configure', tuningId, sensitivity });
  }

  /**
   * Arm calibration. The next strum is read as four open strings — used at the start of a
   * session and whenever drift tracking says the instrument has moved.
   */
  calibrate(tuningId: string): void {
    this.node?.port.postMessage({ type: 'calibrate', tuningId });
  }

  /** Apply a calibrated reference so the detector follows the instrument, not A440. */
  setReferenceOffset(offsetCents: number): void {
    this.node?.port.postMessage({ type: 'reference', offsetCents });
  }

  /**
   * Start capturing raw PCM, for building the real fixture corpus.
   *
   * Raw rather than MediaRecorder: that produces Opus, and a lossy codec discards exactly
   * the high-partial detail the peeling stage depends on. A corpus that had been through
   * Opus would be measuring the codec as much as it measures the instrument.
   */
  startRecording(): void {
    this.recorded = [];
    this.node?.port.postMessage({ type: 'record', on: true });
  }

  /** Stop capturing and return everything gathered, as one contiguous buffer. */
  stopRecording(): { samples: Float32Array; sampleRate: number } {
    this.node?.port.postMessage({ type: 'record', on: false });
    const total = this.recorded.reduce((n, c) => n + c.length, 0);
    const samples = new Float32Array(total);
    let at = 0;
    for (const chunk of this.recorded) {
      samples.set(chunk, at);
      at += chunk.length;
    }
    this.recorded = [];
    return { samples, sampleRate: this.sampleRate };
  }

  /**
   * Play a chord to the learner, for ear-training cards.
   *
   * Uses the session's own AudioContext. Opening a second one risks being refused on iOS
   * and can reconfigure the microphone stream mid-session.
   *
   * The playback is audible to the microphone, so detection is paused for its duration —
   * otherwise the app hears its own chord and marks the card correct before the learner
   * has touched the instrument.
   */
  playChord(notes: readonly (MidiNote | null)[], durationSec = 2.4): Promise<void> {
    const ctx = this.context;
    if (!ctx) return Promise.resolve();
    this.setTarget(null);
    playChord(ctx, notes, { durationSec });
    return new Promise((resolve) => {
      setTimeout(
        () => {
          this.resetDetection();
          resolve();
        },
        durationSec * 1000 + 120,
      );
    });
  }

  /** Clear in-flight state between cards, so a ringing chord can't leak into the next. */
  resetDetection(): void {
    this.node?.port.postMessage({ type: 'reset' });
  }

  async stop(): Promise<void> {
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    await this.context?.close();
    this.context = null;
    this.status = null;
  }
}
