// @ts-check
import { describe, expect, it } from "vitest";
import {
  createSqueeze,
  createStriker,
  FALCON_DURATION,
  falconPosition,
  NONE,
  STRIKE,
  STRIKE_COOLDOWN,
  strikeGeometry,
  WEAK,
} from "./strike.js";

const DT = 1 / 60;

/** Rises of at least `threshold` from the lowest point since the last such fall. @param {number[]} v */
function flashStarts(v, threshold = 0.1) {
  /** @type {number[]} */
  const starts = [];
  let rising = false;
  let lo = v[0];
  let hi = v[0];
  for (let i = 1; i < v.length; i++) {
    if (!rising) {
      lo = Math.min(lo, v[i]);
      if (v[i] - lo >= threshold) {
        starts.push(i * DT);
        rising = true;
        hi = v[i];
      }
    } else {
      hi = Math.max(hi, v[i]);
      if (hi - v[i] >= threshold) {
        rising = false;
        lo = v[i];
      }
    }
  }
  return starts;
}

/** @param {number[]} starts */
function maxPerSecond(starts) {
  let best = 0;
  for (let i = 0; i < starts.length; i++) {
    let n = 0;
    for (let j = i; j < starts.length && starts[j] - starts[i] < 1; j++) n++;
    best = Math.max(best, n);
  }
  return best;
}

describe("createStriker", () => {
  it("strikes on a strong onset, then waits 1.2 s; onsets in between start weak waves", () => {
    expect(STRIKE_COOLDOWN).toBe(1.2);
    const s = createStriker();
    expect(s.step(true, 0.9, 1, true)).toBe(STRIKE);
    expect(s.step(true, 0.9, 1.5, true)).toBe(WEAK);
    expect(s.step(false, 0.9, 2.0, true)).toBe(NONE);
    expect(s.step(true, 0.9, 2.19, true)).toBe(WEAK);
    expect(s.step(true, 0.9, 2.21, true)).toBe(STRIKE);
    expect(s.count).toBe(2);
  });

  it("needs onsetStrength above 0.3 to strike", () => {
    const s = createStriker();
    expect(s.step(true, 0.3, 1, true)).toBe(WEAK);
    expect(s.step(true, 0.31, 1.1, true)).toBe(STRIKE);
  });

  it("never strikes with the falcon off", () => {
    const s = createStriker();
    for (let i = 0; i < 20; i++) expect(s.step(true, 1, i * 2, false)).toBe(WEAK);
    expect(s.count).toBe(0);
  });
});

describe("strike geometry", () => {
  it("puts the strike within 0.3 units of the flock centre and the entry on a frame edge", () => {
    const out = new Float64Array(4);
    for (let k = 0; k < 50; k++) {
      strikeGeometry(k, 1, -0.5, 5, 3, out);
      expect(Math.abs(out[0] - 1)).toBeLessThanOrEqual(0.3);
      expect(Math.abs(out[1] + 0.5)).toBeLessThanOrEqual(0.3);
      const onEdge = Math.abs(Math.abs(out[2]) - 5.2) < 1e-9 || Math.abs(Math.abs(out[3]) - 3.2) < 1e-9;
      expect(onEdge).toBe(true);
    }
  });

  it("is deterministic per strike index", () => {
    const a = new Float64Array(4);
    const b = new Float64Array(4);
    strikeGeometry(7, 0, 0, 5, 3, a);
    strikeGeometry(7, 0, 0, 5, 3, b);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("flies a straight line from the edge side through the strike point", () => {
    const g = new Float64Array([0, 0, -5.2, 0]);
    const p = new Float64Array(2);
    expect(FALCON_DURATION).toBe(0.6);
    falconPosition(0.15, g, p);
    expect(p[0]).toBeCloseTo(0, 9);
    expect(p[1]).toBeCloseTo(0, 9);
    falconPosition(0, g, p);
    expect(p[0]).toBeCloseTo(-1.2, 9);
    falconPosition(0.6, g, p);
    expect(p[0]).toBeGreaterThan(3);
    expect(p[1]).toBeCloseTo(0, 9);
  });
});

describe("createSqueeze", () => {
  it("rises within ~40 ms and relaxes over ~300 ms", () => {
    const sq = createSqueeze();
    let v = 0;
    for (let i = 0; i < 6; i++) v = sq.step(2.5, 1, DT, false);
    expect(v).toBeGreaterThan(0.9);
    for (let i = 0; i < 18; i++) v = sq.step(1, 1, DT, false);
    expect(v).toBeGreaterThan(0.25);
    expect(v).toBeLessThan(0.45);
  });

  it("scales with the gain and ignores a quiet bass", () => {
    const sq = createSqueeze();
    let v = 0;
    for (let i = 0; i < 60; i++) v = sq.step(0.6, 1, DT, false);
    expect(v).toBe(0);
    for (let i = 0; i < 60; i++) v = sq.step(1.75, 0.5, DT, false);
    expect(v).toBeCloseTo(0.25, 2);
  });

  it("gives at most 3 squeeze rises per second for a 10 Hz kick train with reduceFlashing", () => {
    /** @param {boolean} rf */
    const run = (rf) => {
      const sq = createSqueeze();
      const out = [];
      for (let i = 0; i < 240; i++) {
        const bassAtt = Math.floor(i * DT * 20) % 2 === 0 ? 2.5 : 1;
        out.push(sq.step(bassAtt, 1, DT, rf));
      }
      return out;
    };
    expect(maxPerSecond(flashStarts(run(false)))).toBeGreaterThan(3);
    const limited = flashStarts(run(true));
    expect(limited.length).toBeGreaterThan(3);
    expect(maxPerSecond(limited)).toBeLessThanOrEqual(3);
  });
});
