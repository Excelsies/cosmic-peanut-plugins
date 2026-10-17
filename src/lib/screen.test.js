// @ts-check
import { describe, expect, it } from "vitest";
import { SCREEN_ANGLES, shimmerAmount, shimmerOffsets } from "./screen.js";

describe("screen", () => {
  it("prints the plates at the classic 15°, 75° and 0° screen angles", () => {
    expect(SCREEN_ANGLES).toEqual([15, 75, 0]);
  });

  it("shimmers 0.08 cell × clamp(trebAtt − 1, 0, 2)", () => {
    expect(shimmerAmount(0.5, 1)).toBe(0);
    expect(shimmerAmount(1.5, 1)).toBeCloseTo(0.04, 9);
    expect(shimmerAmount(9, 1)).toBeCloseTo(0.16, 9);
    expect(shimmerAmount(9, 0)).toBe(0);
  });

  it("moves each plate's screen phase by bounded, smooth, deterministic hash noise", () => {
    const a = new Float32Array(6);
    const b = new Float32Array(6);
    let maxStep = 0;
    let prev = new Float32Array(6);
    for (let i = 0; i < 600; i++) {
      shimmerOffsets(i / 60, 0.16, a);
      for (let k = 0; k < 3; k++) expect(Math.hypot(a[k * 2], a[k * 2 + 1])).toBeLessThanOrEqual(0.16 * Math.SQRT2 + 1e-6);
      if (i > 0) for (let k = 0; k < 6; k++) maxStep = Math.max(maxStep, Math.abs(a[k] - prev[k]));
      prev = a.slice();
    }
    expect(maxStep).toBeLessThan(0.05);
    shimmerOffsets(3.3, 0.16, a);
    shimmerOffsets(3.3, 0.16, b);
    expect([...a]).toEqual([...b]);
    expect(a[0]).not.toBe(a[2]);
    shimmerOffsets(3.3, 0, a);
    expect([...a]).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
