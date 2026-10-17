// @ts-check
/**
 * Pitch-class profile (chroma) from the host's 1024-bin magnitude spectrum.
 *
 * Peaks (local maxima above a small floor) are located to a fraction of a bin by parabolic
 * interpolation of the log magnitude, converted to a fractional pitch class and their level split
 * linearly between the two nearest classes. Only peaks between 200 Hz and 4 kHz count. A peak
 * that sits at 3, 5 or 6 times the frequency of a stronger, lower peak (searched from 50 Hz) is a
 * harmonic that would read as a fifth or a third of the real note, so it is damped to 20 %.
 * `harmonicChromaUpdate` keeps an exponential average with a 2 s time constant.
 */

const LO_HZ = 200;
const HI_HZ = 4000;
/** Lowest frequency searched for fundamentals of in-range harmonics. */
const FUND_HZ = 50;
const FLOOR = 1e-3;
const MAX_PEAKS = 96;
const HARMONIC_TOL = 0.03;
const HARMONIC_DAMP = 0.2;
const TAU = 2;

export function createHarmonicChroma() {
  return {
    /** Smoothed chroma (EMA, 2 s). */
    pcs: new Float64Array(12),
    /** The latest frame's chroma. */
    frame: new Float64Array(12),
    peakHz: new Float64Array(MAX_PEAKS),
    peakMag: new Float64Array(MAX_PEAKS),
  };
}

/** @param {number} v */
const ln = (v) => Math.log(v > 1e-9 ? v : 1e-9);

/**
 * One frame's chroma into `st.frame`. Allocates nothing.
 * @param {Float32Array} spectrum bin i ≈ i · sampleRate / 2048 Hz
 * @param {number} sampleRate
 * @param {ReturnType<typeof createHarmonicChroma>} st
 */
export function harmonicChromaFrame(spectrum, sampleRate, st) {
  const out = st.frame;
  out.fill(0);
  const bin = (sampleRate || 48000) / 2048;
  const k0 = Math.max(1, Math.floor(FUND_HZ / bin));
  const k1 = Math.min(spectrum.length - 2, Math.ceil(HI_HZ / bin));
  let n = 0;
  for (let k = k0; k <= k1 && n < MAX_PEAKS; k++) {
    const b = spectrum[k];
    if (!(b > FLOOR) || b <= spectrum[k - 1] || b < spectrum[k + 1]) continue;
    const la = ln(spectrum[k - 1]);
    const lb = ln(b);
    const lc = ln(spectrum[k + 1]);
    const den = la - 2 * lb + lc;
    let p = den < 0 ? (0.5 * (la - lc)) / den : 0;
    p = p < -0.5 ? -0.5 : p > 0.5 ? 0.5 : p;
    st.peakHz[n] = (k + p) * bin;
    st.peakMag[n] = b;
    n++;
  }
  for (let j = 0; j < n; j++) {
    const f = st.peakHz[j];
    if (f < LO_HZ || f > HI_HZ) continue;
    let m = st.peakMag[j];
    for (let i = 0; i < j; i++) {
      if (st.peakMag[i] <= m) continue;
      const h = f / st.peakHz[i];
      if (Math.abs(h - 3) < 3 * HARMONIC_TOL || Math.abs(h - 5) < 5 * HARMONIC_TOL || Math.abs(h - 6) < 6 * HARMONIC_TOL) {
        m *= HARMONIC_DAMP;
        break;
      }
    }
    // MIDI note number mod 12 (C = 0).
    let pc = (12 * Math.log2(f / 440) + 69) % 12;
    if (pc < 0) pc += 12;
    const lo = Math.floor(pc);
    const frac = pc - lo;
    out[lo % 12] += m * (1 - frac);
    out[(lo + 1) % 12] += m * frac;
  }
  return out;
}

/**
 * Add one frame to the 2 s average `st.pcs`. Allocates nothing.
 * @param {ReturnType<typeof createHarmonicChroma>} st
 * @param {Float32Array} spectrum
 * @param {number} sampleRate
 * @param {number} dt
 */
export function harmonicChromaUpdate(st, spectrum, sampleRate, dt) {
  const c = harmonicChromaFrame(spectrum, sampleRate, st);
  const a = 1 - Math.exp(-dt / TAU);
  for (let i = 0; i < 12; i++) st.pcs[i] += (c[i] - st.pcs[i]) * a;
  return st.pcs;
}
