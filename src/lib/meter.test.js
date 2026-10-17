// @ts-check
import { describe, expect, it } from "vitest";
import { createMeter } from "./meter.js";

describe("createMeter", () => {
  it("counts one beat each time beatPhase wraps", () => {
    const m = createMeter();
    const beats = [];
    for (let i = 0; i < 240; i++) {
      const t = i / 60;
      if (m.step(120, (t * 2) % 1)) beats.push(i);
    }
    // 120 bpm for 4 s: wraps at 0.5 s, 1 s, … 3.5 s.
    expect(m.beats).toBe(7);
    expect(beats[0]).toBe(30);
    expect(beats[1] - beats[0]).toBe(30);
  });

  it("counts nothing while bpm is 0 and does not invent a beat when tempo returns", () => {
    const m = createMeter();
    expect(m.step(0, 0.9)).toBe(false);
    expect(m.step(0, 0.1)).toBe(false);
    expect(m.step(120, 0.1)).toBe(false);
    expect(m.step(120, 0.6)).toBe(false);
    expect(m.step(120, 0.05)).toBe(true);
    expect(m.beats).toBe(1);
  });

  it("ignores small backwards jitter in the phase", () => {
    const m = createMeter();
    m.step(120, 0.5);
    expect(m.step(120, 0.45)).toBe(false);
    expect(m.beats).toBe(0);
  });
});
