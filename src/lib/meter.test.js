// @ts-check
import { describe, expect, it } from "vitest";
import { createMeter } from "./meter.js";

const DT = 1 / 60;

/** Feed a clean beatPhase ramp at `bpm` for `seconds`; returns the counted beat frames. */
function ramp(/** @type {number} */ bpm, /** @type {number} */ seconds, jitter = 0) {
  const m = createMeter();
  const frames = [];
  for (let f = 0; f < seconds * 60; f++) {
    const t = f * DT;
    let phase = ((t * bpm) / 60) % 1;
    // A small backwards wobble just after each beat (tempo trackers re-anchor like this).
    if (jitter && t > 0.25 && phase > 0.02 && phase < 0.06) phase = 0.99;
    if (m.step(bpm, phase, DT)) frames.push(f);
  }
  return { m, frames };
}

describe("createMeter", () => {
  it("counts one beat per beatPhase wrap", () => {
    // 120 bpm for 4 s: wraps at 0.5 s, 1 s, … 3.5 s (the first frame only arms the counter).
    const { m, frames } = ramp(120, 4);
    expect(m.beats).toBe(7);
    expect(frames[0]).toBe(30);
    expect(frames[1] - frames[0]).toBe(30);
  });

  it("ignores jitter wraps that come under 0.4 beat after a counted beat", () => {
    expect(ramp(120, 4.01, 1).m.beats).toBe(8);
    expect(ramp(120, 4.01, 0).m.beats).toBe(8);
  });

  it("ignores small backwards jitter in the phase", () => {
    const m = createMeter();
    m.step(120, 0.5, DT);
    expect(m.step(120, 0.45, DT)).toBe(false);
    expect(m.beats).toBe(0);
  });

  it("counts nothing while bpm is 0", () => {
    const m = createMeter();
    for (let f = 0; f < 300; f++) expect(m.step(0, (f / 30) % 1, DT)).toBe(false);
    expect(m.beats).toBe(0);
  });

  it("does not invent a beat when the tempo returns", () => {
    const m = createMeter();
    expect(m.step(0, 0.9, DT)).toBe(false);
    expect(m.step(120, 0.1, DT)).toBe(false);
    expect(m.step(120, 0.6, DT)).toBe(false);
    expect(m.step(120, 0.05, DT)).toBe(true);
    expect(m.beats).toBe(1);
  });
});
