import type { CalibrationOutcome } from './calibration';
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

export class AudioEngine {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private handlers: EngineHandlers = {};
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
  }): void {
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
