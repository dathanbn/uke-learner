/// <reference types="@types/audioworklet" />
/**
 * AudioWorklet host for the detection pipeline.
 *
 * All DSP runs here, on the audio thread, not on the main thread (CLAUDE.md invariant 3).
 * A layout or React render on the main thread while a strum arrives would drop the frame
 * that contained the attack, and a missed onset is a card that never advances.
 *
 * This file is loaded by URL rather than imported, so it must stay dependency-light —
 * the pipeline it imports is pure TypeScript with no DOM or Web Audio references.
 */
import { CONFIG } from '../../config';
import { referenceFromOffset } from '../../music/pitch';
import { cents } from '../../types';
import { DetectionPipeline, type PipelineEvent } from '../pipeline';

interface SetTargetMessage {
  type: 'target';
  shapeId: string | null;
}
interface SetReferenceMessage {
  type: 'reference';
  offsetCents: number;
}
interface ResetMessage {
  type: 'reset';
}
interface CalibrateMessage {
  type: 'calibrate';
  tuningId: string;
}
interface ConfigureMessage {
  type: 'configure';
  tuningId: string;
  sensitivity: number;
}
type InboundMessage =
  | SetTargetMessage
  | SetReferenceMessage
  | ResetMessage
  | CalibrateMessage
  | ConfigureMessage;

class DetectorProcessor extends AudioWorkletProcessor {
  private readonly pipeline: DetectionPipeline;
  private readonly ring: Float32Array;
  private write = 0;
  private sinceHop = 0;
  private totalSamples = 0;

  constructor() {
    super();
    this.pipeline = new DetectionPipeline({ sampleRate, targetShapeId: null });
    this.ring = new Float32Array(CONFIG.analysis.frameSize);
    this.port.onmessage = (e: MessageEvent<InboundMessage>) => {
      const msg = e.data;
      if (msg.type === 'target') this.pipeline.targetShapeId = msg.shapeId;
      else if (msg.type === 'reference') this.pipeline.setReference(referenceFromOffset(cents(msg.offsetCents)));
      else if (msg.type === 'reset') this.pipeline.reset();
      else if (msg.type === 'calibrate') this.pipeline.armCalibration(msg.tuningId);
      else if (msg.type === 'configure') {
        this.pipeline.tuningId = msg.tuningId;
        this.pipeline.sensitivity = msg.sensitivity;
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    const { frameSize, hopSize } = CONFIG.analysis;
    for (let i = 0; i < channel.length; i++) {
      this.ring[this.write] = channel[i]!;
      this.write = (this.write + 1) % frameSize;
      this.sinceHop++;
      this.totalSamples++;

      if (this.sinceHop >= hopSize) {
        this.sinceHop = 0;
        // Unwrap the ring into a contiguous frame, oldest sample first.
        const frame = new Float32Array(frameSize);
        for (let k = 0; k < frameSize; k++) {
          frame[k] = this.ring[(this.write + k) % frameSize]!;
        }
        const events = this.pipeline.pushFrame(frame, this.totalSamples - frameSize);
        this.emit(events);
      }
    }
    return true;
  }

  /**
   * Frame events fire ~43 times a second and carry a 29-float activation each. Posting
   * every one is affordable; posting the whole spectrum would not be.
   */
  private emit(events: readonly PipelineEvent[]): void {
    for (const ev of events) {
      if (ev.kind === 'frame') {
        this.port.postMessage({
          kind: 'frame',
          rms: ev.rms,
          flux: ev.flux,
          activation: Array.from(ev.activation.values),
        });
      } else if (ev.kind === 'onset') {
        this.port.postMessage({ kind: 'onset' });
      } else if (ev.kind === 'calibration') {
        this.port.postMessage({ kind: 'calibration', outcome: ev.outcome });
      } else {
        this.port.postMessage({
          kind: 'verdict',
          verdict: ev.verdict,
          msFromOnset: ev.msFromOnset,
          targetConfidence: ev.score.targetConfidence,
          ranked: ev.score.ranked.slice(0, 5),
          activation: Array.from(ev.activation.values),
        });
      }
    }
  }
}

registerProcessor('uke-detector', DetectorProcessor);
