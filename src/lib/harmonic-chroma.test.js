// @ts-check
import { describe, expect, it } from "vitest";
import { createHarmonicChroma, harmonicChromaFrame, harmonicChromaUpdate } from "./harmonic-chroma.js";

const SR = 48000;
const BIN = SR / 2048;

/** A spectrum with a little floor and triangular peaks at `freqs` (with their levels). */
function spectrum(/** @type {[number, number][]} */ peaks) {
  const s = new Float32Array(1024).fill(1e-4);
  for (const [f, a] of peaks) {
    const k = f / BIN;
    const k0 = Math.floor(k);
    const frac = k - k0;
    s[k0] += a * (1 - frac);
    s[k0 + 1] += a * frac;
  }
  return s;
}

const argmax = (/** @type {Float64Array} */ c) => c.indexOf(Math.max(...c));

describe("chroma", () => {
  it("puts a 440 Hz peak on A", () => {
    const st = createHarmonicChroma();
    const c = harmonicChromaFrame(spectrum([[440, 0.5]]), SR, st);
    expect(c).toBe(st.frame);
    expect(argmax(c)).toBe(9);
  });

  it("splits a quarter-tone peak between the two nearest classes", () => {
    const st = createHarmonicChroma();
    const f = 440 * 2 ** (0.5 / 12);
    const c = harmonicChromaFrame(spectrum([[f, 0.5]]), SR, st);
    expect(c[9] + c[10]).toBeGreaterThan(0.9 * c.reduce((a, b) => a + b, 0));
    expect(Math.abs(c[9] - c[10])).toBeLessThan(0.35 * (c[9] + c[10]));
  });

  it("ignores peaks outside 200-4000 Hz", () => {
    const st = createHarmonicChroma();
    const c = harmonicChromaFrame(spectrum([[110, 0.9], [6000, 0.9]]), SR, st);
    expect(Math.max(...c)).toBe(0);
  });

  it("damps a third harmonic so a single note does not read as its own fifth", () => {
    const st = createHarmonicChroma();
    // C4 (261.6 Hz) with its 3rd harmonic G5 (784.9 Hz) at 60 %.
    const c = harmonicChromaFrame(spectrum([[261.63, 0.5], [784.88, 0.3]]), SR, st);
    expect(argmax(c)).toBe(0);
    expect(c[7]).toBeLessThan(0.25 * c[0]);
  });

  it("averages frames with a 2 s time constant", () => {
    const st = createHarmonicChroma();
    const a = spectrum([[440, 0.5]]);
    for (let f = 0; f < 120; f++) harmonicChromaUpdate(st, a, SR, 1 / 60);
    const after2s = st.pcs[9];
    for (let f = 0; f < 1200; f++) harmonicChromaUpdate(st, a, SR, 1 / 60);
    expect(after2s / st.pcs[9]).toBeCloseTo(1 - Math.exp(-1), 2);
  });
});
