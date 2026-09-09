/**
 * In-place iterative radix-2 Cooley-Tukey FFT.
 *
 * Hand-rolled rather than pulled in: it runs inside an AudioWorklet, where the module
 * graph is constrained, and it needs to be identical in the realtime and offline paths
 * (CLAUDE.md invariant 6).
 */
export class Fft {
  readonly size: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;

  constructor(size: number) {
    if ((size & (size - 1)) !== 0) throw new Error(`FFT size must be a power of two: ${size}`);
    this.size = size;
    const half = size >> 1;
    this.cos = new Float64Array(half);
    this.sin = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
    this.rev = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** Transforms `re`/`im` in place. Both must be `size` long. */
  transform(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i]!;
      if (j > i) {
        const tr = re[i]!;
        re[i] = re[j]!;
        re[j] = tr;
        const ti = im[i]!;
        im[i] = im[j]!;
        im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const step = n / len;
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const tw = k * step;
          const wr = this.cos[tw]!;
          const wi = this.sin[tw]!;
          const a = i + k;
          const b = a + half;
          const xr = re[b]! * wr - im[b]! * wi;
          const xi = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - xr;
          im[b] = im[a]! - xi;
          re[a] = re[a]! + xr;
          im[a] = im[a]! + xi;
        }
      }
    }
  }
}

export const hannWindow = (n: number): Float64Array => {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
};
