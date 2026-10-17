// @ts-check
import { describe, expect, it } from "vitest";
import { createMeter } from "./meter.js";

const DT = 1 / 60;

describe("createMeter", () => {
  it("counts beatPhase wraps into a continuous beat count", () => {
    const m = createMeter();
    let beats = 0;
    for (let i = 0; i <= 240; i++) {
      const t = i * DT;
      beats = m.step(120, (t * 2) % 1, DT);
    }
    expect(beats).toBeCloseTo(8, 1);
  });

  it("runs a free clock at 1 beat/s when the tempo is unknown", () => {
    const m = createMeter();
    let beats = 0;
    for (let i = 0; i < 120; i++) beats = m.step(0, 0, DT);
    expect(beats).toBeCloseTo(2, 6);
  });

  it("never runs backwards and stays continuous when the tempo appears or drops out", () => {
    const m = createMeter();
    let prev = 0;
    for (let i = 0; i < 600; i++) {
      const t = i * DT;
      const bpm = t < 3 || t > 7 ? 0 : 120;
      const b = m.step(bpm, (t * 2 + 0.37) % 1, DT);
      expect(b).toBeGreaterThanOrEqual(prev);
      expect(b - prev).toBeLessThan(0.1);
      prev = b;
    }
  });

  it("treats a small backwards jitter in beatPhase as no motion", () => {
    const m = createMeter();
    m.step(120, 0.5, DT);
    const a = m.step(120, 0.52, DT);
    const b = m.step(120, 0.51, DT);
    expect(b).toBe(a);
  });
});
