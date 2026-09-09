import { CONFIG } from '../config';
import type { Spectrum } from './spectrum';

/**
 * Spectral-flux onset detector.
 *
 * Continuous classification is the obvious approach and it is wrong: the previous chord
 * is still ringing, and the instant of the strum is mostly broadband pick noise. Anchor
 * analysis to onsets instead, and the "did they actually play something" gate comes free
 * — background noise never produces a verdict.
 */
export class OnsetDetector {
  private prev: Float64Array | null = null;
  private history: number[] = [];
  private lastOnsetSample = -Infinity;
  private armed = true;

  constructor(private readonly sampleRate: number) {}

  reset(): void {
    this.prev = null;
    this.history = [];
    this.lastOnsetSample = -Infinity;
    this.armed = true;
  }

  /**
   * Feed one frame. `sampleIndex` is the frame's start offset in the stream, used for
   * the refractory period so one strum yields one onset rather than four string attacks.
   */
  push(spec: Spectrum, sampleIndex: number): { onset: boolean; flux: number } {
    const mag = spec.mag;
    let flux = 0;
    if (this.prev) {
      // Half-wave rectified: only energy *increases* indicate an attack. Counting
      // decreases would fire on every note release.
      for (let k = 0; k < mag.length; k++) {
        const d = mag[k]! - this.prev[k]!;
        if (d > 0) flux += d;
      }
    }
    if (!this.prev) this.prev = new Float64Array(mag.length);
    this.prev.set(mag);

    const { medianWindow, thresholdMultiplier, thresholdFloor, refractoryMs, rearmRatio } =
      CONFIG.onset;
    this.history.push(flux);
    if (this.history.length > medianWindow) this.history.shift();

    const sorted = [...this.history].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
    const threshold = median * thresholdMultiplier + thresholdFloor;

    if (!this.armed && flux < threshold * rearmRatio) this.armed = true;

    const refractorySamples = (refractoryMs / 1000) * this.sampleRate;
    const ready = sampleIndex - this.lastOnsetSample >= refractorySamples;
    // Needs a full history window, or the first frame of any recording is an "onset".
    const warm = this.history.length >= Math.min(5, medianWindow);
    const onset = warm && ready && this.armed && flux > threshold;
    if (onset) {
      this.lastOnsetSample = sampleIndex;
      this.armed = false;
    }

    return { onset, flux };
  }
}
