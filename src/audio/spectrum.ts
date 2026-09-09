import { CONFIG } from '../config';
import { type Hz } from '../types';
import { Fft, hannWindow } from './fft';

/** Magnitude spectrum of one analysis frame, with the geometry needed to look up pitches. */
export interface Spectrum {
  readonly mag: Float64Array;
  readonly sampleRate: number;
  readonly fftSize: number;
  /** Hz per bin. */
  readonly binWidth: number;
  readonly rms: number;
}

/**
 * Reusable analyser. Allocation-free after construction, because this runs in the
 * audio thread where a GC pause is a missed strum.
 */
export class SpectrumAnalyser {
  private readonly fft: Fft;
  private readonly win: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly mag: Float64Array;
  readonly frameSize: number;
  readonly fftSize: number;

  constructor(
    readonly sampleRate: number,
    frameSize = CONFIG.analysis.frameSize,
    fftSize = CONFIG.analysis.fftSize,
  ) {
    this.frameSize = frameSize;
    this.fftSize = fftSize;
    this.fft = new Fft(fftSize);
    this.win = hannWindow(frameSize);
    this.re = new Float64Array(fftSize);
    this.im = new Float64Array(fftSize);
    this.mag = new Float64Array(fftSize / 2);
  }

  /** `frame` must be exactly frameSize long. The returned Spectrum aliases internal state. */
  analyse(frame: Float32Array): Spectrum {
    const { re, im, win, mag, fftSize, frameSize } = this;
    re.fill(0);
    im.fill(0);
    let sumSq = 0;
    for (let i = 0; i < frameSize; i++) {
      const x = frame[i]!;
      sumSq += x * x;
      re[i] = x * win[i]!;
    }
    this.fft.transform(re, im);
    // Zero-padding scales magnitudes by fftSize/frameSize; divide it back out so
    // thresholds stay meaningful across window configurations.
    const scale = 2 / frameSize;
    for (let k = 0; k < mag.length; k++) {
      mag[k] = Math.hypot(re[k]!, im[k]!) * scale;
    }
    return {
      mag,
      sampleRate: this.sampleRate,
      fftSize,
      binWidth: this.sampleRate / fftSize,
      rms: Math.sqrt(sumSq / frameSize),
    };
  }
}

/**
 * Peak magnitude within a frequency window, with parabolic interpolation across the
 * three bins around the maximum. The interpolation matters: at 44.1kHz with an 8192
 * FFT the bins are ~5.4Hz apart, which is a third of a semitone down at C4.
 */
export const peakNear = (spec: Spectrum, centre: Hz, toleranceCents: number): number => {
  const lo = centre * Math.pow(2, -toleranceCents / 1200);
  const hi = centre * Math.pow(2, toleranceCents / 1200);
  let kLo = Math.max(1, Math.floor(lo / spec.binWidth));
  let kHi = Math.min(spec.mag.length - 2, Math.ceil(hi / spec.binWidth));
  if (kHi < kLo) {
    kLo = Math.min(kLo, spec.mag.length - 2);
    kHi = kLo;
  }
  let best = 0;
  let bestK = kLo;
  for (let k = kLo; k <= kHi; k++) {
    const m = spec.mag[k]!;
    if (m > best) {
      best = m;
      bestK = k;
    }
  }
  const a = spec.mag[bestK - 1] ?? 0;
  const b = spec.mag[bestK] ?? 0;
  const c = spec.mag[bestK + 1] ?? 0;
  const denom = a - 2 * b + c;
  if (denom === 0) return b;
  const shift = (0.5 * (a - c)) / denom;
  return Math.abs(shift) <= 1 ? b - 0.25 * (a - c) * shift : b;
};

/** Frequency of the strongest bin in a window, interpolated. Used by the tuner. */
export const peakFrequencyNear = (
  spec: Spectrum,
  centre: Hz,
  toleranceCents: number,
): { frequency: number; magnitude: number } => {
  const lo = centre * Math.pow(2, -toleranceCents / 1200);
  const hi = centre * Math.pow(2, toleranceCents / 1200);
  const kLo = Math.max(1, Math.floor(lo / spec.binWidth));
  const kHi = Math.min(spec.mag.length - 2, Math.ceil(hi / spec.binWidth));
  let best = 0;
  let bestK = kLo;
  for (let k = kLo; k <= kHi; k++) {
    const m = spec.mag[k]!;
    if (m > best) {
      best = m;
      bestK = k;
    }
  }
  const a = spec.mag[bestK - 1] ?? 0;
  const b = spec.mag[bestK] ?? 0;
  const c = spec.mag[bestK + 1] ?? 0;
  const denom = a - 2 * b + c;
  const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
  return {
    frequency: (bestK + (Math.abs(shift) <= 1 ? shift : 0)) * spec.binWidth,
    magnitude: b,
  };
};
