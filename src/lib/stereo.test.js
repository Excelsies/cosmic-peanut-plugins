// @ts-check
import { describe, expect, it } from "vitest";
import { createStereo, stereoFrame } from "./stereo.js";

const N = 2048;
/** @param {(i: number) => number} f */
const sig = (f) => Float32Array.from({ length: N }, (_, i) => f(i));
// 32 whole cycles in 2048 samples, so sin and cos are exactly orthogonal over the window.
const W = (2 * Math.PI * 32) / N;

describe("stereo", () => {
  it("gives width 0 and balance 0 for a mono source (null channels)", () => {
    const st = createStereo();
    expect(stereoFrame(null, null, st)).toBe(st);
    expect([st.width, st.balance]).toEqual([0, 0]);
  });

  it("gives width 0 and balance 0 for bit-identical channels", () => {
    const st = createStereo();
    const l = sig((i) => Math.sin(W * i));
    stereoFrame(l, l.slice(), st);
    expect(st.width).toBe(0);
    expect(st.balance).toBe(0);
  });

  it("clamps width to 1 for anti-phase channels", () => {
    const st = createStereo();
    stereoFrame(sig((i) => Math.sin(W * i)), sig((i) => -Math.sin(W * i)), st);
    expect(st.width).toBe(1);
    expect(st.balance).toBeCloseTo(0, 6);
  });

  it("gives width 1 - correlation for mixed signals, and balance from the channel energies", () => {
    const st = createStereo();
    // corr(L, R) = 0.6 for R = 0.6 L + 0.8 L⊥ with |R| = |L|.
    stereoFrame(sig((i) => Math.sin(W * i)), sig((i) => 0.6 * Math.sin(W * i) + 0.8 * Math.cos(W * i)), st);
    expect(st.width).toBeCloseTo(0.4, 5);
    expect(st.balance).toBeCloseTo(0, 5);
    // R at half amplitude: energies 1 : 0.25 → balance (0.25 - 1) / 1.25 = -0.6 (left heavy).
    stereoFrame(sig((i) => Math.sin(W * i)), sig((i) => 0.5 * Math.sin(W * i)), st);
    expect(st.width).toBeCloseTo(0, 6);
    expect(st.balance).toBeCloseTo(-0.6, 5);
  });

  it("treats silence as centred mono", () => {
    const st = createStereo();
    stereoFrame(new Float32Array(N), new Float32Array(N), st);
    expect([st.width, st.balance]).toEqual([0, 0]);
  });
});
