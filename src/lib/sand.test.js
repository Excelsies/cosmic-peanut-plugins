// @ts-check
import { describe, expect, it } from "vitest";
import { createHop, createPlateDrive, flightTime, GRAIN_FLOATS, HAZE_PEAK, hopVz0, MIN_HOP_GAP, seedGrains } from "./sand.js";

const DT = 1 / 60;

/** Flash onsets in an envelope (rise ≥ threshold from the last low): builtin flash.test.js's helper. @param {number[]} values @param {number} dt */
function flashStarts(values, dt, threshold = 0.1) {
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

/** Most events in any 1-second window. @param {number[]} times */
function maxPerSecond(times) {
  let best = 0;
  for (let i = 0; i < times.length; i++) {
    let n = 0;
    for (let j = i; j < times.length && times[j] - times[i] < 1; j++) n++;
    best = Math.max(best, n);
  }
  return best;
}

/**
 * Run createHop on a kick train (one confirmed kick every `period` s, on whole frames).
 * @param {number} period @param {boolean} reduce @param {number} dt
 */
function kickTrain(period, reduce, dt = DT, seconds = 4, strength = 1) {
  const hop = createHop();
  /** @type {number[]} */ const hops = [];
  /** @type {number[]} */ const haze = [];
  const every = Math.round(period / dt);
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    const h = hop.step(i % every === 0, strength, 1, dt, reduce);
    if (h.impulse > 0) hops.push(i * dt);
    haze.push(h.haze);
  }
  return { hops, haze };
}

describe("hop", () => {
  it("exports the gap and the haze peak", () => {
    expect([MIN_HOP_GAP, HAZE_PEAK]).toEqual([0.4, 0.5]);
  });

  it("launches grains for a 0.15 s flight at Hop 1 and full strength", () => {
    expect(flightTime(hopVz0(1, 1))).toBeCloseTo(0.15, 6);
    expect(flightTime(hopVz0(1, 0))).toBeCloseTo(0.06, 6);
    expect(hopVz0(0, 1)).toBe(0);
  });

  it("keeps hops at least 0.4 s apart: a 4 kicks/s train hops on every other kick, flashing limited or not", () => {
    for (const reduce of [false, true]) {
      const { hops } = kickTrain(0.25, reduce);
      expect(hops).toHaveLength(8);
      hops.forEach((t, i) => expect(t).toBeCloseTo(0.5 * i, 9));
    }
  });

  it("hops on every kick 0.45 s apart, and on every kick exactly 0.4 s apart", () => {
    for (const reduce of [false, true]) {
      expect(kickTrain(0.45, reduce, 1 / 60, 4.5).hops).toHaveLength(10);
      expect(kickTrain(0.4, reduce, 1 / 60).hops).toHaveLength(10);
      expect(kickTrain(0.4, reduce, 1 / 120).hops).toHaveLength(10);
    }
  });

  it("stays within 3 hops and 3 flashes per second under a 10 Hz kick train with reduce flashing", () => {
    for (const dt of [1 / 60, 1 / 120]) {
      const { hops, haze } = kickTrain(0.1, true, dt);
      expect(hops.length).toBeGreaterThan(4); // still reacts
      expect(maxPerSecond(hops)).toBeLessThanOrEqual(3);
      expect(maxPerSecond(flashStarts(haze, dt, 0.05))).toBeLessThanOrEqual(3);
    }
  });

  it("raises the haze to 0.5·(0.4 + 0.6·strength) on the hop frame, then decays it with τ 0.15 s", () => {
    for (const [s, peak] of [
      [1, 0.5],
      [0, 0.2],
      [2, 0.5],
    ]) {
      const hop = createHop();
      expect(hop.step(true, s, 1, DT, true).haze).toBeCloseTo(peak, 9);
      expect(hop.step(false, s, 1, DT, true).haze).toBeCloseTo(peak * Math.exp(-DT / 0.15), 9);
    }
  });

  it("never raises the haze without a hop", () => {
    const hop = createHop();
    hop.step(true, 1, 1, DT, true);
    const strengths = [0.9, 0.1, 1, 0.4, 0.7, 0, 0.55, 0.3];
    let last = hop.step(false, 1, 1, DT, true).haze;
    for (let i = 0; i < 300; i++) {
      const h = hop.step(false, strengths[i % strengths.length], 1, DT, i % 2 === 0).haze;
      expect(h).toBeLessThanOrEqual(last);
      last = h;
    }
  });

  it("reports the impulse once per admitted kick with scatter and a new sequence number", () => {
    const hop = createHop();
    const a = hop.step(true, 0.5, 2, DT, true);
    expect(a.impulse).toBeCloseTo(hopVz0(2, 0.5));
    expect(a.scatter).toBeCloseTo(0.25 * 0.5 * 2);
    expect(a.seq).toBe(1);
    const b = hop.step(false, 0, 2, DT, true);
    expect(b).toBe(a);
    expect([b.impulse, b.scatter, b.seq]).toEqual([0, 0, 1]);
  });

  it("does nothing at Hop 0", () => {
    const hop = createHop();
    for (let i = 0; i < 60; i++) {
      const h = hop.step(i % 30 === 0, 1, 0, DT, false);
      expect([h.impulse, h.haze, h.seq]).toEqual([0, 0, 0]);
    }
  });
});

/** @param {Partial<Record<string, any>>} over */
const audio = (over = {}) => ({ midAtt: 1, rms: 0.1, silent: false, trebAtt: 1, flux: 0, bassAtt: 1, ...over });

describe("createPlateDrive", () => {
  it("drives clamp(0.5·min(midAtt, 2) + 4·rms, 0, 2.5) · reactivity, frame-rate independent", () => {
    for (const hz of [60, 120]) {
      const d = createPlateDrive();
      let s = d.step(audio({ midAtt: 3, rms: 0.2 }), 0, 1, true, 1 / hz);
      for (let i = 1; i < hz; i++) s = d.step(audio({ midAtt: 3, rms: 0.2 }), 0, 1, true, 1 / hz);
      expect(s.drive).toBeCloseTo(1.8, 3);
    }
    const d = createPlateDrive();
    let s = d.step(audio({ midAtt: 2, rms: 1 }), 0, 0.5, true, 1);
    expect(s.drive).toBeCloseTo(1.25, 3);
    s = d.step(audio({ midAtt: 2, rms: 1 }), 0, 0.5, true, 0.0001);
    expect(s.drive).toBeCloseTo(1.25, 3);
  });

  it("falls to rest within 0.3 s of silence, fizz and all", () => {
    const d = createPlateDrive();
    for (let i = 0; i < 60; i++) d.step(audio({ midAtt: 2, rms: 0.3, trebAtt: 2, flux: 1 }), 0, 1, true, DT);
    let s = d.step(audio({ silent: true }), 0, 1, true, DT);
    expect(s.fizz).toBe(0);
    for (let i = 1; i < 18; i++) s = d.step(audio({ silent: true, rms: 0 }), 0, 1, true, DT);
    expect(s.drive).toBeLessThan(0.1);
  });

  it("fizz = clamp(trebAtt − 1, 0, 2) · 0.5 + flux · 0.5", () => {
    const d = createPlateDrive();
    expect(d.step(audio({ trebAtt: 4, flux: 0.4 }), 0, 1, true, DT).fizz).toBeCloseTo(1.2);
    expect(d.step(audio({ trebAtt: 0.5, flux: 0 }), 0, 1, true, DT).fizz).toBe(0);
  });

  it("tilts with balance and bass, and stays exactly level for mono sources", () => {
    const d = createPlateDrive();
    let s = d.step(audio(), 0, 1, true, DT);
    for (let i = 0; i < 300; i++) s = d.step(audio({ bassAtt: 1 }), 0, 1, true, DT);
    expect([s.tiltX, s.tiltY]).toEqual([0, 0]);
    for (let i = 0; i < 600; i++) s = d.step(audio({ bassAtt: 3 }), 1, 1, true, DT);
    expect(s.tiltX).toBeCloseTo(0.6, 3);
    expect(s.tiltY).toBeCloseTo(0.15, 3);
    for (let i = 0; i < 600; i++) s = d.step(audio({ bassAtt: 3 }), 1, 1, false, DT);
    expect(s.tiltY).toBeCloseTo(0, 3);
  });

  it("treats missing fields as neutral", () => {
    const d = createPlateDrive();
    const s = d.step({ midAtt: NaN, rms: undefined, silent: false, trebAtt: undefined, flux: NaN, bassAtt: undefined }, 0, 1, true, DT);
    expect(Number.isFinite(s.drive) && Number.isFinite(s.fizz) && Number.isFinite(s.tiltY)).toBe(true);
  });
});

describe("seedGrains", () => {
  it("scatters grains uniformly on the plate, at rest, deterministically", () => {
    const n = 4096;
    const a = seedGrains(new Float32Array(n * GRAIN_FLOATS), n);
    const b = seedGrains(new Float32Array(n * GRAIN_FLOATS), n);
    expect(a).toEqual(b);
    let sx = 0;
    for (let i = 0; i < n; i++) {
      const o = i * GRAIN_FLOATS;
      expect(a[o] > 0 && a[o] < 1 && a[o + 1] > 0 && a[o + 1] < 1).toBe(true);
      expect([a[o + 2], a[o + 3], a[o + 4], a[o + 5]]).toEqual([0, 0, 0, 0]);
      sx += a[o];
    }
    expect(sx / n).toBeCloseTo(0.5, 1);
  });
});
