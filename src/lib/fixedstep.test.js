// @ts-check
import { describe, expect, it } from "vitest";
import { createFixedStep } from "./fixedstep.js";

describe("createFixedStep", () => {
  it("runs the same number of fixed steps per second at 60 and 120 Hz", () => {
    for (const hz of [60, 120, 144]) {
      const fs = createFixedStep(1 / 120, 8);
      let n = 0;
      for (let i = 0; i < hz; i++) n += fs.advance(1 / hz);
      expect(Math.abs(n - 120)).toBeLessThanOrEqual(1);
    }
    const fs = createFixedStep(1 / 120, 8);
    expect([fs.advance(1 / 60), fs.advance(1 / 60), fs.advance(1 / 60)]).toEqual([2, 2, 2]);
  });

  it("caps the steps per frame and drops the backlog after a stall", () => {
    const fs = createFixedStep(1 / 120, 8);
    expect(fs.advance(1)).toBe(8);
    expect(fs.advance(1 / 120)).toBe(1);
  });

  it("does nothing for dt 0 and keeps the remainder", () => {
    const fs = createFixedStep(1 / 120, 8);
    expect(fs.advance(0)).toBe(0);
    expect(fs.advance(0.5 / 120)).toBe(0);
    expect(fs.alpha).toBeCloseTo(0.5, 6);
    expect(fs.advance(0.5 / 120)).toBe(1);
  });
});
