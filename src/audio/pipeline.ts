import { CONFIG } from '../config';
import { CONCERT, type PitchReference } from '../music/pitch';
import { type Activation, type Verdict } from '../types';
import { averageActivations, computeActivation } from './activation';
import { calibrate, type CalibrationOutcome } from './calibration';
import { OnsetDetector } from './onset';
import { SpectrumAnalyser, type Spectrum } from './spectrum';
import { scoreAgainstTarget, type ScoreResult } from './verdict';

/**
 * The single analysis path, shared by the AudioWorklet and the offline test harness
 * (CLAUDE.md invariant 6). If these ever diverge, the fixture corpus stops testing the
 * thing that actually ships and the whole eval loop becomes decoration.
 */

export interface FrameEvent {
  kind: 'frame';
  sampleIndex: number;
  rms: number;
  flux: number;
  activation: Activation;
}

export interface OnsetEvent {
  kind: 'onset';
  sampleIndex: number;
}

export interface VerdictEvent {
  kind: 'verdict';
  /** Sample index of the onset this verdict belongs to. */
  onsetSample: number;
  msFromOnset: number;
  verdict: Verdict;
  score: ScoreResult;
  activation: Activation;
}

export interface CalibrationEvent {
  kind: 'calibration';
  outcome: CalibrationOutcome;
}

export type PipelineEvent = FrameEvent | OnsetEvent | VerdictEvent | CalibrationEvent;

interface PendingWindow {
  onsetSample: number;
  startSample: number;
  endSample: number;
  activations: Activation[];
  peakRms: number;
  /** Copy of the strongest in-window spectrum, kept only when calibration is armed. */
  calibrationSpectrum: Spectrum | null;
  calibrationRms: number;
}

export interface PipelineOptions {
  sampleRate: number;
  /** Shape the next strum will be scored against. Changing it mid-flight is fine. */
  targetShapeId: string | null;
  reference?: PitchReference;
  /** The instrument being played. High-G and low-G share fret patterns but not pitches. */
  tuningId?: string;
  /** User-facing leniency. 1 is the tuned default; above 1 relaxes the thresholds. */
  sensitivity?: number;
}

export class DetectionPipeline {
  private readonly analyser: SpectrumAnalyser;
  private readonly onsets: OnsetDetector;
  private pending: PendingWindow | null = null;
  private reference: PitchReference;

  targetShapeId: string | null;
  tuningId: string;
  sensitivity: number;
  private calibrationTuning: string | null = null;

  constructor(private readonly opts: PipelineOptions) {
    this.analyser = new SpectrumAnalyser(opts.sampleRate);
    this.onsets = new OnsetDetector(opts.sampleRate);
    this.targetShapeId = opts.targetShapeId;
    this.tuningId = opts.tuningId ?? 'high-g';
    this.sensitivity = opts.sensitivity ?? 1;
    this.reference = opts.reference ?? CONCERT;
  }

  get frameSize(): number {
    return this.analyser.frameSize;
  }

  setReference(ref: PitchReference): void {
    this.reference = ref;
  }

  getReference(): PitchReference {
    return this.reference;
  }

  /**
   * Arm calibration: the next strum is read as four open strings rather than scored as a
   * chord. Runs through the same onset detection and the same analysis window as a normal
   * card, so calibration cannot succeed on audio a card would have rejected.
   */
  armCalibration(tuningId: string): void {
    this.calibrationTuning = tuningId;
  }

  /** Discard in-flight state — call between cards so a ringing chord can't leak across. */
  reset(): void {
    this.onsets.reset();
    this.pending = null;
  }

  /**
   * Feed exactly one frame. Returns everything that happened, so the caller decides what
   * to render and what to ignore.
   */
  pushFrame(frame: Float32Array, sampleIndex: number): PipelineEvent[] {
    const events: PipelineEvent[] = [];
    const spec: Spectrum = this.analyser.analyse(frame);
    const { onset, flux } = this.onsets.push(spec, sampleIndex);
    const activation = computeActivation(spec, this.reference);

    events.push({ kind: 'frame', sampleIndex, rms: spec.rms, flux, activation });

    if (onset) {
      events.push({ kind: 'onset', sampleIndex });
      const sr = this.opts.sampleRate;
      this.pending = {
        onsetSample: sampleIndex,
        startSample: sampleIndex + (CONFIG.window.startMs / 1000) * sr,
        endSample: sampleIndex + (CONFIG.window.endMs / 1000) * sr,
        activations: [],
        peakRms: 0,
        calibrationSpectrum: null,
        calibrationRms: 0,
      };
    }

    const p = this.pending;
    if (p) {
      if (sampleIndex >= p.startSample && sampleIndex <= p.endSample) {
        p.activations.push({ lowNote: activation.lowNote, values: activation.values.slice() });
        p.peakRms = Math.max(p.peakRms, spec.rms);
        // The Spectrum aliases the analyser's internal buffer, so it must be copied to
        // outlive this frame. Only done when calibration is armed — it is an allocation
        // on the audio thread, which is exactly what the hot path avoids.
        if (this.calibrationTuning && spec.rms > p.calibrationRms) {
          p.calibrationRms = spec.rms;
          p.calibrationSpectrum = { ...spec, mag: Float64Array.from(spec.mag) };
        }
      }
      if (sampleIndex > p.endSample) {
        this.pending = null;
        if (this.calibrationTuning && p.calibrationSpectrum) {
          events.push({
            kind: 'calibration',
            outcome: calibrate(p.calibrationSpectrum, this.calibrationTuning),
          });
          this.calibrationTuning = null;
        } else {
          const ev = this.finalise(p, sampleIndex);
          if (ev) events.push(ev);
        }
      }
    }

    return events;
  }

  private finalise(p: PendingWindow, sampleIndex: number): VerdictEvent | null {
    if (p.activations.length === 0 || this.targetShapeId === null) return null;
    const averaged = averageActivations(p.activations);
    const score = scoreAgainstTarget(
      averaged,
      this.targetShapeId,
      p.peakRms,
      this.tuningId,
      this.sensitivity,
    );
    return {
      kind: 'verdict',
      onsetSample: p.onsetSample,
      msFromOnset: ((sampleIndex - p.onsetSample) / this.opts.sampleRate) * 1000,
      verdict: score.verdict,
      score,
      activation: averaged,
    };
  }
}

/**
 * Run the pipeline over a complete buffer. Used by the test harness and by anything
 * analysing a recorded file — same code, same constants, same answers as realtime.
 */
export const analyseBuffer = (
  samples: Float32Array,
  sampleRate: number,
  targetShapeId: string | null,
  reference: PitchReference = CONCERT,
  tuningId = 'high-g',
): PipelineEvent[] => {
  const pipeline = new DetectionPipeline({ sampleRate, targetShapeId, reference, tuningId });
  const { frameSize } = pipeline;
  const hop = CONFIG.analysis.hopSize;
  const out: PipelineEvent[] = [];
  for (let i = 0; i + frameSize <= samples.length; i += hop) {
    out.push(...pipeline.pushFrame(samples.subarray(i, i + frameSize), i));
  }
  return out;
};

/** The verdicts from a buffer, in order. */
export const verdictsFrom = (events: readonly PipelineEvent[]): VerdictEvent[] =>
  events.filter((e): e is VerdictEvent => e.kind === 'verdict');
