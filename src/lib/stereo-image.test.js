// @ts-check
import { describe, expect, it } from "vitest";
import { stereoImage } from "./stereo.js";

const N = 2048;
const sine = (/** @type {number} */ a) => Float32Array.from({ length: N }, (_, i) => a * Math.sin(i * 0.05));

describe("stereoImage", () => {
  it("is 0 when either channel is null (mono source)", () => {
    const s = stereoImage(null, sine(0.5));
    expect([s.balance, s.width]).toEqual([0, 0]);
    expect(stereoImage(sine(0.5), null).balance).toBe(0);
  });

  it("is 0 when both channels are bit-identical (the app's synthetic sources)", () => {
    const l = sine(0.5);
    const s = stereoImage(l, Float32Array.from(l));
    expect([s.balance, s.width]).toEqual([0, 0]);
  });

  it("gives balance +1 and full width for a left-only signal", () => {
    const s = stereoImage(sine(0.5), new Float32Array(N));
    expect(s.balance).toBeCloseTo(1);
    expect(s.width).toBeCloseTo(1);
  });

  it("gives balance -1 for right-only and 0 for silence on both", () => {
    expect(stereoImage(new Float32Array(N), sine(0.5)).balance).toBeCloseTo(-1);
    const s = stereoImage(new Float32Array(N), new Float32Array(N));
    expect([s.balance, s.width]).toEqual([0, 0]);
  });

  it("returns the same object every call", () => {
    expect(stereoImage(null, null)).toBe(stereoImage(sine(1), sine(0.5)));
  });
});
