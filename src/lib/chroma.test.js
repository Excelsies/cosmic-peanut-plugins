// @ts-check
import { describe, expect, it } from "vitest";
import { CHROMA_HI_HZ, CHROMA_LO_HZ, createChroma } from "./chroma.js";

const N = 1024;

/** Midi note number → Hz. @param {number} m */
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

/**
 * A magnitude spectrum with a smeared peak (Hann-like main lobe) at each frequency.
 * @param {number[]} freqs
 * @param {number} sr
 */
function spectrumOf(freqs, sr) {
  const s = new Float32Array(N);
  for (const f of freqs) {
    const b = (f * 2048) / sr;
    for (let i = Math.max(0, Math.floor(b) - 3); i <= Math.min(N - 1, Math.ceil(b) + 3); i++) {
      const d = Math.abs(i - b);
      const v = d < 2 ? 0.5 + 0.5 * Math.cos((Math.PI * d) / 2) : 0;
      s[i] = Math.max(s[i], 0.8 * v);
    }
  }
  return s;
}

/** Indices of the k largest values. @param {Float32Array} a @param {number} k */
function topK(a, k) {
  return [...a.keys()].sort((x, y) => a[y] - a[x]).slice(0, k).sort((x, y) => x - y);
}

describe("createChroma", () => {
  it.each([44100, 48000])("finds C, E and G as the top three of a C major triad at %i Hz", (sr) => {
    const c = createChroma();
    const out = c.update(spectrumOf([hz(60), hz(64), hz(67)], sr), sr, false);
    expect(topK(out, 3)).toEqual([0, 4, 7]);
    expect(Math.max(...out)).toBeCloseTo(1, 6);
  });

  it("refines peaks between bins (an off-centre A4 still lands on A)", () => {
    const c = createChroma();
    const out = c.update(spectrumOf([440], 48000), 48000, false);
    expect(topK(out, 1)).toEqual([9]);
    expect(c.peakCount).toBe(1);
    expect(c.peakBins[0]).toBeCloseTo((440 * 2048) / 48000, 1);
  });

  it("falls back to the bin centre on a clipped plateau", () => {
    const c = createChroma();
    const s = new Float32Array(N);
    s[39] = 0.4;
    s[40] = 1;
    s[41] = 1;
    s[42] = 0.4;
    c.update(s, 48000, false);
    expect(c.peakCount).toBe(1);
    expect(c.peakBins[0]).toBe(40);
  });

  it("only looks at 200–4000 Hz and ignores peaks under 0.15 × the frame maximum", () => {
    const c = createChroma();
    const sr = 48000;
    expect(c.update(spectrumOf([100, 6000], sr), sr, false).every((v) => v === 0)).toBe(true);
    const s = spectrumOf([hz(60)], sr);
    const weak = spectrumOf([hz(66)], sr);
    for (let i = 0; i < N; i++) s[i] = Math.max(s[i], weak[i] * 0.1);
    c.update(s, sr, false);
    expect(c.peakCount).toBe(1);
    expect(CHROMA_LO_HZ).toBe(200);
    expect(CHROMA_HI_HZ).toBe(4000);
  });

  it("damps the major third that a note's 5th harmonic adds", () => {
    const c = createChroma();
    const out = c.update(spectrumOf([hz(60), hz(64)], 48000), 48000, false);
    // Equal C and E peaks (off-centre bins, so not exactly equal weights): E loses 0.3 × C's.
    expect(out[0]).toBeCloseTo(1, 6);
    expect(out[4]).toBeCloseTo(0.7, 1);
  });

  it("splits a note between quarter tones' two nearest pitch classes", () => {
    const c = createChroma();
    // Halfway between C and C# (no third above either has weight, so no damping applies to them).
    const out = c.update(spectrumOf([hz(60.5)], 48000), 48000, false);
    expect(out[0]).toBeGreaterThan(0.3);
    expect(out[1]).toBeGreaterThan(0.3);
  });

  it("rebuilds its bin table only when the sample rate changes", () => {
    const c = createChroma();
    const s = spectrumOf([hz(60)], 48000);
    c.update(s, 48000, false);
    c.update(s, 48000, false);
    expect(c.tableBuilds).toBe(1);
    c.update(s, 44100, false);
    c.update(s, 44100, false);
    expect(c.tableBuilds).toBe(2);
    c.update(s, 0, false);
    expect(c.tableBuilds).toBe(2);
  });

  it("gives zeros (no NaN) for silent, all-zero or rate-0 input", () => {
    const c = createChroma();
    const zero = new Float32Array(N);
    for (const out of [
      c.update(zero, 48000, false),
      c.update(spectrumOf([hz(60)], 48000), 48000, true),
      c.update(spectrumOf([hz(60)], 48000), 0, false),
    ]) {
      expect(out.every((v) => v === 0)).toBe(true);
    }
  });

  it("returns the same array every call", () => {
    const c = createChroma();
    const a = c.update(spectrumOf([hz(60)], 48000), 48000, false);
    const b = c.update(new Float32Array(N), 48000, true);
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(Float32Array);
    expect(a.length).toBe(12);
  });
});
