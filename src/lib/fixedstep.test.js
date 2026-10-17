// @ts-check
import { describe, expect, it } from "vitest";
import { createFixedStep } from "./fixedstep.js";

/**
 * Total steps over `seconds` fed at `hz` frames per second.
 * @param {number} step @param {number} max @param {number} hz @param {number} seconds
 */
function total(step, max, hz, seconds) {
  const fs = createFixedStep(step, max);
  let n = 0;
  for (let i = 0; i < Math.round(hz * seconds); i++) n += fs.advance(1 / hz);
  return n;
}

describe("createFixedStep", () => {
  it("takes the same number of steps at 30, 60, 120 and 144 Hz", () => {
    expect(total(1 / 120, 4, 60, 1)).toBe(120);
    expect(total(1 / 120, 4, 120, 1)).toBe(120);
    expect(total(1 / 120, 4, 144, 2)).toBe(240);
    expect(total(1 / 60, 2, 144, 1)).toBe(60);
    for (const hz of [30, 60, 120, 144]) expect(total(1 / 600, 40, hz, 2)).toBe(1200);
  });

  it("does not floor 1/60 s one step short", () => {
    const a = createFixedStep(1 / 120, 8);
    expect([a.advance(1 / 60), a.advance(1 / 60), a.advance(1 / 60)]).toEqual([2, 2, 2]);
    const b = createFixedStep(1 / 600, 40);
    expect(b.advance(1 / 60)).toBe(10);
  });

  it("carries the fraction of a step to the next frame and reports it as alpha", () => {
    const fs = createFixedStep(1 / 600, 40);
    expect(fs.advance(0.0025)).toBe(1);
    expect(fs.alpha).toBeCloseTo(0.5, 6);
    expect(fs.advance(0.0025)).toBe(2);
    expect(fs.alpha).toBeCloseTo(0, 5);
  });

  it("caps the steps per frame and drops the backlog", () => {
    const a = createFixedStep(1 / 120, 4);
    expect(a.advance(0.1)).toBe(4);
    expect(a.alpha).toBe(0);
    expect(a.advance(1 / 120)).toBe(1);
    const b = createFixedStep(1 / 600, 40);
    expect(b.advance(0.1)).toBe(40);
    expect(b.advance(1 / 60)).toBe(10);
  });

  it("ignores zero, negative and non-finite dt", () => {
    const fs = createFixedStep(1 / 60, 2);
    expect(fs.advance(0)).toBe(0);
    expect(fs.advance(-1)).toBe(0);
    expect(fs.advance(NaN)).toBe(0);
    expect(fs.advance(Infinity)).toBe(0);
    expect(fs.alpha).toBe(0);
  });

  it("reset forgets the carried fraction", () => {
    const fs = createFixedStep(1 / 600, 40);
    fs.advance(0.0025);
    fs.reset();
    expect(fs.alpha).toBe(0);
    expect(fs.advance(0.0025)).toBe(1);
  });
});
