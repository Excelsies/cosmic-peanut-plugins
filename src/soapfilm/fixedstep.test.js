// @ts-check
import { describe, expect, it } from "vitest";
import { createFixedStep } from "./fixedstep.js";

/** Total steps over `seconds` at `hz` frames per second. @param {number} hz @param {number} seconds */
function totalSteps(hz, seconds = 1) {
  const fs = createFixedStep(1 / 120, 4);
  let n = 0;
  for (let i = 0; i < Math.round(hz * seconds); i++) n += fs.advance(1 / hz).steps;
  return n;
}

describe("createFixedStep", () => {
  it("takes the same number of steps over 1 s at 60 Hz and 120 Hz", () => {
    expect(totalSteps(60)).toBe(120);
    expect(totalSteps(120)).toBe(120);
    expect(totalSteps(144, 2)).toBe(240);
  });

  it("never takes more than the cap in one frame and drops the backlog", () => {
    const fs = createFixedStep(1 / 120, 4);
    expect(fs.advance(0.1).steps).toBe(4);
    expect(fs.advance(1 / 120).steps).toBe(1);
  });

  it("reports the leftover fraction as alpha in a reused object", () => {
    const fs = createFixedStep(1 / 120, 4);
    const a = fs.advance(1 / 240);
    expect(a.steps).toBe(0);
    expect(a.alpha).toBeCloseTo(0.5);
    const b = fs.advance(1 / 240);
    expect(b).toBe(a);
    expect(b.steps).toBe(1);
    expect(b.alpha).toBeCloseTo(0, 5);
  });

  it("ignores zero and negative dt", () => {
    const fs = createFixedStep(1 / 120, 4);
    expect(fs.advance(0).steps).toBe(0);
    expect(fs.advance(-1).steps).toBe(0);
  });
});
