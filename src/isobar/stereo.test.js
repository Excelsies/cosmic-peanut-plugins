// @ts-check
import { describe, expect, it } from "vitest";
import { createStereo, energyBalance, stereoFrame } from "./stereo.js";

const N = 2048;
/** @param {(i: number) => number} f */
const sig = (f) => Float32Array.from({ length: N }, (_, i) => f(i));
// 32 whole cycles in 2048 samples, so sin and cos are exactly orthogonal over the window.
const W = (2 * Math.PI * 32) / N;
/** @param {number} a */
const sine = (a) => sig((i) => a * Math.sin(W * i));

describe("stereoFrame", () => {
  it("is 0 without stereo data (null channels) and fills the given object", () => {
    const st = createStereo();
    expect(stereoFrame(null, null, st)).toBe(st);
    expect([st.balance, st.width]).toEqual([0, 0]);
    stereoFrame(sine(0.5), null, st);
    expect([st.balance, st.width]).toEqual([0, 0]);
    stereoFrame(null, sine(0.5), st);
    expect([st.balance, st.width]).toEqual([0, 0]);
  });

  it("is exactly 0 for bit-identical channels (the app's synthetic sources) and for silence", () => {
    const st = createStereo();
    const l = sine(0.5);
    stereoFrame(l, l.slice(), st);
    expect([st.balance, st.width]).toEqual([0, 0]);
    stereoFrame(new Float32Array(N), new Float32Array(N), st);
    expect([st.balance, st.width]).toEqual([0, 0]);
  });

  it("balance is the RMS ratio: positive when the right is louder, ±1 for one-sided signals", () => {
    const st = createStereo();
    stereoFrame(sine(0.2), sine(0.6), st);
    expect(st.balance).toBeCloseTo(0.5, 5);
    stereoFrame(sine(0.6), sine(0.2), st);
    expect(st.balance).toBeCloseTo(-0.5, 5);
    stereoFrame(sine(1), new Float32Array(N), st);
    expect(st.balance).toBe(-1);
    expect(st.width).toBe(0);
    stereoFrame(new Float32Array(N), sine(1), st);
    expect(st.balance).toBe(1);
  });

  it("width is 1 − correlation, clamped to 1 for anti-phase channels", () => {
    const st = createStereo();
    stereoFrame(sine(1), sig((i) => -Math.sin(W * i)), st);
    expect(st.width).toBe(1);
    expect(st.balance).toBeCloseTo(0, 6);
    // corr(L, R) = 0.6 for R = 0.6 L + 0.8 L⊥ with |R| = |L|.
    stereoFrame(sine(1), sig((i) => 0.6 * Math.sin(W * i) + 0.8 * Math.cos(W * i)), st);
    expect(st.width).toBeCloseTo(0.4, 5);
    expect(st.balance).toBeCloseTo(0, 5);
    stereoFrame(sine(1), sine(0.5), st);
    expect(st.width).toBeCloseTo(0, 6);
  });
});

describe("energyBalance", () => {
  it("is the balance of the channel energies", () => {
    const st = createStereo();
    // R at half amplitude: RMS balance (0.5 − 1) / 1.5; energies 1 : 0.25 → (0.25 − 1) / 1.25 = −0.6.
    stereoFrame(sine(1), sine(0.5), st);
    expect(st.balance).toBeCloseTo(-1 / 3, 6);
    expect(energyBalance(st.balance)).toBeCloseTo(-0.6, 6);
    expect([energyBalance(0), energyBalance(1), energyBalance(-1)]).toEqual([0, 1, -1]);
  });
});
