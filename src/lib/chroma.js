// @ts-check
/**
 * Chroma: how much of each of the 12 pitch classes is sounding, from the host's magnitude
 * spectrum. Shared by the Fieldwork visualizers.
 *
 * 1. Only bins whose centre i·sr/2048 Hz lies in 200–4000 Hz are searched (the bin range is a
 *    table rebuilt when the sample rate changes).
 * 2. Local maxima above 0.15 × the frame's maximum in that range are peaks; each is refined with
 *    a parabola through its neighbours, falling back to the bin centre on a clipped plateau.
 * 3. Each peak's fractional midi note gives a fractional pitch class; magnitude^0.5 is split
 *    linearly between the two nearest pitch classes.
 * 4. Every pitch class gives up 0.3 × the weight of the one a major third below (a note's 5th
 *    harmonic lands two octaves and a major third up, which biases chroma towards the third).
 * 5. The result is normalised by its maximum into a reused Float32Array(12).
 *
 * `update` allocates nothing.
 */

export const CHROMA_LO_HZ = 200;
export const CHROMA_HI_HZ = 4000;
/** Peaks below this fraction of the frame maximum are ignored. */
export const PEAK_FLOOR = 0.15;
/** Fraction of a pitch class's weight removed from the pitch class a major third above. */
export const THIRD_DAMP = 0.3;
const MAX_PEAKS = 64;

export function createChroma() {
  const out = new Float32Array(12);
  const raw = new Float32Array(12);
  const peakBins = new Float32Array(MAX_PEAKS);
  let rate = 0;
  let lo = 1;
  let hi = 0;

  const state = {
    out,
    /** Refined bin positions of this frame's peaks (first `peakCount` entries). */
    peakBins,
    peakCount: 0,
    /** How many times the bin table was (re)built: for tests. */
    tableBuilds: 0,

    /**
     * @param {Float32Array} spectrum `audio.spectrum` (bin i ≈ i·sampleRate/2048 Hz)
     * @param {number} sampleRate `audio.sampleRate`
     * @param {boolean} silent `audio.silent`
     * @returns {Float32Array} the shared 12-entry chroma, 0–1, max 1 (all 0 when nothing sounds)
     */
    update(spectrum, sampleRate, silent) {
      out.fill(0);
      state.peakCount = 0;
      if (silent || !(sampleRate > 0)) return out;
      const n = spectrum.length;
      if (sampleRate !== rate) {
        rate = sampleRate;
        lo = Math.max(1, Math.ceil((CHROMA_LO_HZ * 2048) / sampleRate));
        hi = Math.min(n - 2, Math.floor((CHROMA_HI_HZ * 2048) / sampleRate));
        state.tableBuilds++;
      }
      let max = 0;
      for (let i = lo; i <= hi; i++) if (spectrum[i] > max) max = spectrum[i];
      if (!(max > 0)) return out;

      raw.fill(0);
      const floor = PEAK_FLOOR * max;
      const binHz = sampleRate / 2048;
      for (let i = lo; i <= hi; i++) {
        const b = spectrum[i];
        if (b <= floor) continue;
        const a = spectrum[i - 1];
        const c = spectrum[i + 1];
        if (!(b > a && b >= c)) continue;
        const den = a - 2 * b + c;
        // A plateau (b === c, e.g. clipped at 1) has no single top: use the bin centre.
        const delta = b === c || den >= 0 ? 0 : (0.5 * (a - c)) / den;
        const bin = i + delta;
        if (state.peakCount < MAX_PEAKS) peakBins[state.peakCount++] = bin;
        const midi = 69 + 12 * Math.log2((bin * binHz) / 440);
        const pc = ((midi % 12) + 12) % 12;
        const k = Math.floor(pc);
        const frac = pc - k;
        const w = Math.sqrt(b);
        raw[k % 12] += (1 - frac) * w;
        raw[(k + 1) % 12] += frac * w;
      }

      let top = 0;
      for (let p = 0; p < 12; p++) {
        const v = raw[p] - THIRD_DAMP * raw[(p + 8) % 12];
        out[p] = v > 0 ? v : 0;
        if (out[p] > top) top = out[p];
      }
      if (top > 0) for (let p = 0; p < 12; p++) out[p] /= top;
      return out;
    },
  };
  return state;
}
