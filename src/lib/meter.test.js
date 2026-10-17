// @ts-check
import { describe, expect, it } from "vitest";
import { createMeter, meterStep } from "./meter.js";

/** Feed a clean beatPhase ramp at `bpm` for `seconds`; returns the counted beat times. */
function ramp(/** @type {number} */ bpm, /** @type {number} */ seconds, jitter = 0) {
  const m = createMeter();
  const dt = 1 / 60;
  const times = [];
  for (let f = 0; f < seconds * 60; f++) {
    const t = f * dt;
    let phase = (t * bpm) / 60 % 1;
    // A small backwards wobble just after each beat (tempo trackers re-anchor like this).
    if (jitter && t > 0.25 && phase > 0.02 && phase < 0.06) phase = 0.99;
    if (meterStep(m, phase, bpm, dt)) times.push(t);
  }
  return { m, times };
}

describe("meter", () => {
  it("counts one beat per beatPhase wrap", () => {
    const { m, times } = ramp(120, 4.01);
    expect(m.beats).toBe(8);
    expect(times[1] - times[0]).toBeCloseTo(0.5, 1);
  });

  it("ignores jitter wraps that come under 0.4 beat after a counted beat", () => {
    const { m } = ramp(120, 4.01, 1);
    expect(m.beats).toBe(8);
  });

  it("counts nothing while bpm is 0", () => {
    const m = createMeter();
    for (let f = 0; f < 300; f++) expect(meterStep(m, (f / 30) % 1, 0, 1 / 60)).toBe(false);
    expect(m.beats).toBe(0);
  });
});
