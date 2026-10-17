// @ts-check
import { describe, expect, it } from "vitest";
import { createFixedStep } from "./fixedstep.js";

/** @param {number} hz @param {number} seconds */
function stepsAt(hz, seconds) {
  const fs = createFixedStep(1 / 60, 2);
  let steps = 0;
  for (let i = 0; i < Math.round(hz * seconds); i++) steps += fs.advance(1 / hz);
  return { steps, alpha: fs.alpha };
}

describe("createFixedStep", () => {
  it("runs the same number of steps at 60 and 120 Hz display rates", () => {
    expect(stepsAt(60, 1).steps).toBe(60);
    expect(stepsAt(120, 1).steps).toBe(60);
    expect(stepsAt(144, 1).steps).toBe(60);
  });

  it("reports the leftover fraction as the interpolation alpha", () => {
    const fs = createFixedStep(1 / 60, 2);
    expect(fs.advance(1 / 120)).toBe(0);
    expect(fs.alpha).toBeCloseTo(0.5, 6);
    expect(fs.advance(1 / 120)).toBe(1);
    expect(fs.alpha).toBeCloseTo(0, 6);
  });

  it("caps the steps per frame and drops the backlog", () => {
    const fs = createFixedStep(1 / 60, 2);
    expect(fs.advance(0.1)).toBe(2);
    expect(fs.alpha).toBeGreaterThanOrEqual(0);
    expect(fs.alpha).toBeLessThan(1);
    expect(fs.advance(0)).toBe(0);
  });

  it("ignores negative or non-finite dt", () => {
    const fs = createFixedStep(1 / 60, 2);
    expect(fs.advance(-1)).toBe(0);
    expect(fs.advance(NaN)).toBe(0);
    expect(fs.alpha).toBe(0);
  });
});
