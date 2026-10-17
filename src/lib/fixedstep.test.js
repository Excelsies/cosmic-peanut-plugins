// @ts-check
import { describe, expect, it } from "vitest";
import { createFixedStep, takeSteps } from "./fixedstep.js";

/** Total steps over `seconds` fed at `hz` frame rate. */
function total(/** @type {number} */ hz, /** @type {number} */ seconds, rate = 600, max = 40) {
  const fs = createFixedStep(rate, max);
  let n = 0;
  for (let f = 0; f < Math.round(seconds * hz); f++) n += takeSteps(fs, 1 / hz);
  return n;
}

describe("fixed step", () => {
  it("takes the same number of steps at 30, 60, 120 and 144 Hz", () => {
    expect(total(30, 2)).toBe(1200);
    expect(total(60, 2)).toBe(1200);
    expect(total(120, 2)).toBe(1200);
    expect(total(144, 2)).toBe(1200);
  });

  it("carries the fraction of a step to the next frame", () => {
    const fs = createFixedStep(600, 40);
    expect(takeSteps(fs, 0.0025)).toBe(1);
    expect(takeSteps(fs, 0.0025)).toBe(2);
  });

  it("caps the steps per frame and drops the backlog", () => {
    const fs = createFixedStep(600, 40);
    expect(takeSteps(fs, 0.1)).toBe(40);
    expect(takeSteps(fs, 1 / 60)).toBe(10);
  });

  it("reset forgets the carried fraction", () => {
    const fs = createFixedStep(600, 40);
    takeSteps(fs, 0.0025);
    fs.acc = 0;
    expect(takeSteps(fs, 0.0025)).toBe(1);
  });
});
