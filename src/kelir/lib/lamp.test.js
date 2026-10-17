// @ts-check
import { describe, expect, it } from "vitest";
import { MAX_DIP, createLamp, valueNoise } from "./lamp.js";

/**
 * Run a lamp for `seconds` at `hz` with constant inputs; return f and gain per frame.
 * @param {{ treb?: number, flux?: number, flicker?: number, reduce?: boolean, hz?: number, seconds?: number }} o
 */
function run({ treb = 2, flux = 0.5, flicker = 1, reduce = true, hz = 60, seconds = 10 }) {
  const lamp = createLamp();
  const f = [];
  const gain = [];
  const dt = 1 / hz;
  for (let i = 0; i < seconds * hz; i++) {
    lamp.step(treb, flux, dt, flicker, reduce, 1);
    f.push(lamp.f);
    gain.push(lamp.gain);
  }
  return { lamp, f, gain };
}

/** Local extrema in a sequence (direction changes). @param {number[]} v */
function extrema(v) {
  let n = 0;
  for (let i = 1; i < v.length - 1; i++) if ((v[i] - v[i - 1]) * (v[i + 1] - v[i]) < 0) n++;
  return n;
}

describe("valueNoise", () => {
  it("is smooth, in -1..1, and hits the lattice values", () => {
    let prev = valueNoise(0, 1);
    for (let i = 1; i < 1000; i++) {
      const v = valueNoise(i / 100, 1);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.1);
      prev = v;
    }
    expect(valueNoise(3, 1)).not.toBe(valueNoise(3, 2));
  });
});

describe("createLamp", () => {
  it("caps the flicker at 3 Hz under reduce flashing and runs at 7 Hz without", () => {
    const capped = extrema(run({ reduce: true }).f);
    const free = extrema(run({ reduce: false }).f);
    expect(capped).toBeLessThanOrEqual(31);
    expect(capped).toBeGreaterThan(5);
    expect(free).toBeGreaterThan(31);
  });

  it("never dims the screen by more than 5%", () => {
    for (const reduce of [true, false]) {
      const { gain } = run({ treb: 3, flux: 1, flicker: 1, reduce });
      expect(Math.min(...gain)).toBeGreaterThanOrEqual(1 - MAX_DIP - 1e-9);
      expect(Math.max(...gain)).toBeLessThanOrEqual(1);
    }
  });

  it("flickers harder with hats and flux, and not at all at flicker 0", () => {
    const amp = (/** @type {number[]} */ v) => Math.max(...v.map(Math.abs));
    expect(amp(run({ treb: 3, flux: 1 }).f)).toBeGreaterThan(amp(run({ treb: 1, flux: 0 }).f) * 2);
    const off = run({ flicker: 0 });
    expect(amp(off.f)).toBe(0);
    expect(Math.min(...off.gain)).toBe(1);
    expect(Math.abs(off.lamp.ox) + Math.abs(off.lamp.oy)).toBe(0);
  });

  it("moves the flame by at most 6 px times the pixel scale", () => {
    const lamp = createLamp();
    let max = 0;
    for (let i = 0; i < 600; i++) {
      lamp.step(3, 1, 1 / 60, 1, false, 2);
      max = Math.max(max, Math.hypot(lamp.ox, lamp.oy));
    }
    expect(max).toBeGreaterThan(0.5);
    expect(max).toBeLessThanOrEqual(6 * 2 * Math.SQRT2 * 1.3);
  });

  it("is the same at 60 and 120 Hz", () => {
    const a = run({ hz: 60, seconds: 3 });
    const b = run({ hz: 120, seconds: 3 });
    for (let i = 10; i < 180; i += 7) expect(a.f[i]).toBeCloseTo(b.f[i * 2 + 1], 2);
  });

  it("limits the dips to 3 a second under reduce flashing", () => {
    const { gain } = run({ treb: 3, flux: 1, reduce: false, seconds: 4 });
    const lim = run({ treb: 3, flux: 1, reduce: true, seconds: 4 });
    // Count starts of a darkening of at least 1% (a rise of the dip envelope).
    const dips = (/** @type {number[]} */ g) => {
      const t = [];
      let hi = g[0];
      let falling = false;
      for (let i = 1; i < g.length; i++) {
        if (!falling && hi - g[i] >= 0.01) {
          t.push(i / 60);
          falling = true;
        }
        if (falling && g[i] > g[i - 1]) {
          falling = false;
          hi = g[i];
        }
        if (!falling) hi = Math.max(hi, g[i]);
      }
      return t;
    };
    const perSecond = (/** @type {number[]} */ s) =>
      Math.max(0, ...s.map((t0) => s.filter((t) => t >= t0 && t - t0 < 1).length));
    expect(perSecond(dips(lim.gain))).toBeLessThanOrEqual(3);
    expect(dips(gain).length).toBeGreaterThan(0);
  });
});
