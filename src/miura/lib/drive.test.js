// @ts-check
import { describe, expect, it } from "vitest";
import {
  createFold,
  createSweep,
  ease,
  headingFor,
  rustleAmp,
  rustleBucket,
  rustleNoise,
  START_HEADING,
  swellAmp,
  swellWave,
} from "./drive.js";

/**
 * Times of rises of at least `threshold` from the lowest point since the last fall of at least
 * `threshold` (as builtin flash.test.js counts flashes).
 * @param {number[]} values @param {number} dt @param {number} threshold
 */
function riseStarts(values, dt, threshold) {
  /** @type {number[]} */
  const starts = [];
  let rising = false;
  let lo = values[0];
  let hi = values[0];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (!rising) {
      if (v < lo) lo = v;
      if (v - lo >= threshold) {
        starts.push(i * dt);
        rising = true;
        hi = v;
      }
    } else {
      hi = Math.max(hi, v);
      if (hi - v >= threshold) {
        rising = false;
        lo = v;
      }
    }
  }
  return starts;
}

/** Most rises in any 1-second window. @param {number[]} starts */
function maxPerSecond(starts) {
  let best = 0;
  for (let i = 0; i < starts.length; i++) {
    let n = 0;
    for (let j = i; j < starts.length && starts[j] - starts[i] < 1 - 1e-9; j++) n++; // float slack
    best = Math.max(best, n);
  }
  return best;
}

describe("ease", () => {
  it("is exponential and frame-rate independent", () => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 60; i++) a = ease(a, 1, 1 / 60, 0.3);
    for (let i = 0; i < 120; i++) b = ease(b, 1, 1 / 120, 0.3);
    expect(a).toBeCloseTo(1 - Math.exp(-1 / 0.3), 9);
    expect(b).toBeCloseTo(a, 9);
    expect(ease(0.4, 1, 0, 0.3)).toBe(0.4);
  });
});

describe("createFold", () => {
  /** @param {number} hz @param {(t: number) => number} bass @param {number} seconds */
  function run(hz, bass, seconds, { silent = false, reduce = false, fold = 1, reactivity = 1 } = {}) {
    const f = createFold();
    const dt = 1 / hz;
    const out = [];
    // The bass over each frame's interval is sampled at its start, so both rates see the same signal.
    for (let i = 1; i <= Math.round(seconds * hz); i++) out.push(f.step(bass((i - 1) * dt), silent, fold, reactivity, dt, reduce));
    return out;
  }

  it("rests at 0.35 fold and folds to 0.9 fold on heavy bass", () => {
    expect(run(60, () => 1, 3).at(-1)).toBeCloseTo(0.35, 6);
    expect(run(60, () => 3, 3).at(-1)).toBeCloseTo(0.9, 6);
    expect(run(60, () => 3, 3, { fold: 1.5 }).at(-1)).toBeCloseTo(1.35, 6);
    expect(run(60, () => 3, 3, { reactivity: 0 }).at(-1)).toBeCloseTo(0.35, 6);
  });

  it("attacks in 120 ms and releases in 0.6 s, the same at 60 and 120 Hz", () => {
    const step = (/** @type {number} */ t) => (t < 1 ? 2.2 : 1);
    const a = run(60, step, 2);
    const b = run(120, step, 2);
    for (let i = 0; i < a.length; i++) expect(b[i * 2 + 1]).toBeCloseTo(a[i], 6);
    // a[j] is the fold at t = (j + 1) / 60: tau 120 ms up, tau 0.6 s down.
    expect((a[6] - 0.35) / 0.55).toBeCloseTo(1 - Math.exp(-7 / 60 / 0.12), 6);
    const top = 1 - Math.exp(-1 / 0.12);
    expect((a[59] - 0.35) / 0.55).toBeCloseTo(top, 6);
    expect((a[95] - 0.35) / 0.55).toBeCloseTo(top * Math.exp(-1), 6);
  });

  it("starts at most 3 deepening folds per second under a 10 Hz bass strobe with reduce flashing", () => {
    const strobe = (/** @type {number} */ t) => (Math.floor(t * 20) % 2 === 0 ? 2.2 : 1);
    const free = run(60, strobe, 4);
    const limited = run(60, strobe, 4, { reduce: true });
    expect(maxPerSecond(riseStarts(free, 1 / 60, 0.02))).toBeGreaterThan(5);
    // The limiter lets a new rise start every 1/3 s (20 frames at 60 Hz): rises never come closer
    // than that, so no 1 s window holds more than 3.
    for (const threshold of [0.02, 0.005]) {
      const starts = riseStarts(limited, 1 / 60, threshold);
      expect(starts.length).toBeGreaterThan(3);
      // (A rise that grows over a few frames crosses the threshold a frame or two late.)
      for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThan(1 / 3 - 2.5 / 60);
      expect(maxPerSecond(starts.filter((t) => t > 0.1))).toBeLessThanOrEqual(3);
    }
  });

  it("relaxes to 0.3 fold over 1.5 s in silence", () => {
    const f = createFold();
    for (let i = 0; i < 180; i++) f.step(3, false, 1, 1, 1 / 60, true);
    let t0 = 0;
    for (let i = 0; i < 90; i++) t0 = f.step(0, true, 1, 1, 1 / 60, true);
    expect((t0 - 0.3) / (0.9 - 0.3)).toBeCloseTo(Math.exp(-1), 2);
    for (let i = 0; i < 1200; i++) t0 = f.step(0, true, 1, 1, 1 / 60, true);
    expect(t0).toBeCloseTo(0.3, 4);
  });
});

describe("swell and rustle", () => {
  it("swells only with mids above 0.5 and saturates at 1.5", () => {
    expect(swellAmp(0.4)).toBe(0);
    expect(swellAmp(1)).toBeCloseTo(0.06, 9);
    expect(swellAmp(3)).toBeCloseTo(0.12, 9);
  });

  it("is a travelling wave plus a half-amplitude octave", () => {
    expect(swellWave(0, 0, 0)).toBe(0);
    const x = 1.3;
    const y = -0.7;
    const t = 2.1;
    const ph = 2 * Math.PI * (0.15 * x + 0.1 * y - 0.08 * t);
    expect(swellWave(x, y, t)).toBeCloseTo(Math.sin(ph) + 0.5 * Math.sin(2 * ph), 9);
  });

  it("rustles with hats above 1, up to 0.03 rad", () => {
    expect(rustleAmp(0.8)).toBe(0);
    expect(rustleAmp(2)).toBeCloseTo(0.015, 9);
    expect(rustleAmp(5)).toBeCloseTo(0.03, 9);
  });

  it("steps the rustle at 12 Hz, or 3 Hz under reduce flashing", () => {
    expect(rustleBucket(1, false)).toBe(12);
    expect(rustleBucket(1.09, false)).toBe(13);
    expect(rustleBucket(1, true)).toBe(3);
    expect(rustleBucket(1.3, true)).toBe(3);
    expect(rustleBucket(1.34, true)).toBe(4);
  });

  it("hashes each vertex and bucket to -0.5..0.5, deterministically", () => {
    let sum = 0;
    for (let v = 0; v < 500; v++) {
      const n = rustleNoise(v, 77);
      expect(n).toBeGreaterThanOrEqual(-0.5);
      expect(n).toBeLessThan(0.5);
      expect(rustleNoise(v, 77)).toBe(n);
      sum += n;
    }
    expect(Math.abs(sum / 500)).toBeLessThan(0.06);
    expect(rustleNoise(3, 1)).not.toBe(rustleNoise(3, 2));
  });
});

describe("createSweep", () => {
  /** @param {number} hz @param {number} bpm @param {number} seconds @param {number} bars */
  function run(hz, bpm, seconds, bars = 8) {
    const s = createSweep();
    const dt = 1 / hz;
    const out = [];
    for (let i = 1; i <= Math.round(seconds * hz); i++) {
      const t = i * dt;
      out.push(s.step(bpm, bpm > 0 ? ((t * bpm) / 60) % 1 : 0, dt, bars));
    }
    return out;
  }

  it("starts upper left and picks headings from a fixed sequence in 70-200 degrees", () => {
    expect(START_HEADING).toBe(135);
    for (let k = 1; k < 50; k++) {
      expect(headingFor(k)).toBeGreaterThanOrEqual(70);
      expect(headingFor(k)).toBeLessThan(200);
      expect(headingFor(k)).toBe(headingFor(k));
    }
  });

  it("turns every 8 bars (32 beats) and eases over 4 s", () => {
    const az = run(60, 120, 40); // 32 beats = 16 s
    expect(az[Math.round(15.9 * 60) - 1]).toBe(135);
    const target = headingFor(1);
    expect(Math.abs(az[Math.round(18 * 60) - 1] - (135 + target) / 2)).toBeLessThan(1.5);
    expect(az[Math.round(20.2 * 60) - 1]).toBeCloseTo(target, 6);
    expect(az[Math.round(31.9 * 60) - 1]).toBeCloseTo(target, 6);
    expect(az[Math.round(36.5 * 60) - 1]).toBeCloseTo(headingFor(2), 6);
  });

  it("turns every 16 s while the tempo is unknown, every 32 s at 16 bars", () => {
    const az = run(60, 0, 40);
    expect(az[Math.round(15.9 * 60) - 1]).toBe(135);
    expect(az[Math.round(20.5 * 60) - 1]).toBeCloseTo(headingFor(1), 6);
    const slow = run(60, 0, 40, 16);
    expect(slow[Math.round(31.9 * 60) - 1]).toBe(135);
    expect(slow[Math.round(36.5 * 60) - 1]).toBeCloseTo(headingFor(1), 6);
  });

  it("is the same at 60 and 120 Hz", () => {
    const a = run(60, 0, 24);
    const b = run(120, 0, 24);
    for (let i = 0; i < a.length; i += 7) expect(Math.abs(b[i * 2 + 1] - a[i])).toBeLessThan(0.5);
  });
});
