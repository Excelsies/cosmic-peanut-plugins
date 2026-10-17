// @ts-check
import { describe, expect, it } from "vitest";
import { createPlumes, MAX_PLUMES } from "./plumes.js";

function frame() {
  return { onset: false, onsetStrength: 0, onsetAge: 10, bands: new Float32Array(64), silent: false };
}

/** Spawn one plume from a frame whose bands rose only in [lo, hi]. @param {number} lo @param {number} hi @param {number} [balance] */
function spawnFrom(lo, hi, balance = 0) {
  const pl = createPlumes();
  const a = frame();
  pl.step(a, 0, balance); // prev = zeros
  for (let i = lo; i <= hi; i++) a.bands[i] = 0.8;
  a.onset = true;
  a.onsetStrength = 0.9;
  a.onsetAge = 0.004;
  const slot = pl.step(a, 1 / 60, balance);
  expect(slot).toBeGreaterThanOrEqual(0);
  return pl.x[slot];
}

describe("plumes", () => {
  it("rise where the spectrum hit: kicks on the left, hats on the right", () => {
    expect(spawnFrom(0, 8)).toBeLessThan(0.3);
    expect(spawnFrom(50, 63)).toBeGreaterThan(0.7);
  });

  it("follow the strongest part of a mixed hit: a kick with hats still rises on the left", () => {
    const pl = createPlumes();
    const a = frame();
    pl.step(a, 0, 0);
    for (let i = 3; i <= 11; i++) a.bands[i] = 0.85 * Math.exp(-(((i - 7) / 3) ** 2));
    for (let i = 51; i <= 63; i++) a.bands[i] = (0.6 * (i - 51)) / 12;
    a.onset = true;
    a.onsetStrength = 0.9;
    const slot = pl.step(a, 1 / 60, 0);
    expect(pl.x[slot]).toBeLessThan(0.3);
  });

  it("follow the stereo balance: a louder left moves them left, linearly", () => {
    const mid = spawnFrom(28, 34, 0);
    const left = spawnFrom(28, 34, 1);
    const right = spawnFrom(28, 34, -1);
    expect(left).toBeCloseTo(mid - 0.15, 6);
    expect(right).toBeCloseTo(mid + 0.15, 6);
    expect(Math.abs(mid - (0.08 + 0.84 * 0.5))).toBeLessThan(0.05); // jitter is small
  });

  it("fall back to a hashed position when no band rose", () => {
    const pl = createPlumes();
    const a = frame();
    a.onset = true;
    a.onsetStrength = 0.5;
    const slot = pl.step(a, 0, 0);
    expect(pl.x[slot]).toBeGreaterThan(0.2);
    expect(pl.x[slot]).toBeLessThan(0.8);
  });

  it("recycles the oldest of 6 slots on the 7th spawn", () => {
    const pl = createPlumes();
    const a = frame();
    a.onset = true;
    a.onsetStrength = 0.5;
    a.onsetAge = 0;
    const slots = [];
    for (let k = 0; k < MAX_PLUMES + 1; k++) slots.push(pl.step(a, k * 0.1, 0));
    expect(new Set(slots.slice(0, 6)).size).toBe(6);
    expect(slots[6]).toBe(slots[0]);
    expect(pl.t0[slots[6]]).toBeCloseTo(0.6, 6);
  });

  it("place the head analytically, identical at 60 and 120 Hz for the same onset", () => {
    /** @param {number} hz */
    function run(hz) {
      const pl = createPlumes();
      const a = frame();
      const dt = 1 / hz;
      let y = NaN;
      for (let n = 0; n * dt <= 2 + 1e-9; n++) {
        const now = n * dt;
        a.onset = false;
        if (now >= 1 && now - dt < 1) {
          a.onset = true; // the first frame after the hit at t = 1 s
          a.onsetStrength = 0.7;
          a.onsetAge = now - 1;
        }
        pl.step(a, now, 0);
        pl.update(now, 0.1, 1, 1);
        if (Math.abs(now - 1.5) < 1e-9 || (now > 1.5 && Number.isNaN(y))) y = pl.uniforms[1];
      }
      return y;
    }
    const y60 = run(60);
    expect(y60).toBeLessThan(1.02);
    expect(y60).toBeCloseTo(run(120), 9);
  });

  it("die above the black front or after 5 s, and emit film only for 0.8 s", () => {
    const pl = createPlumes();
    const a = frame();
    a.onset = true;
    a.onsetStrength = 1;
    a.onsetAge = 0;
    const s = pl.step(a, 0, 0);
    pl.update(0.5, 0.1, 1, 1);
    expect(pl.src[s]).toBeCloseTo(0.5, 6);
    expect(pl.uniforms[s * 4 + 2]).toBeCloseTo(0.08, 6); // r
    pl.update(1, 0.1, 1, 1);
    expect(pl.src[s]).toBe(0);
    expect(pl.alive[s]).toBe(1);
    pl.update(4.5, 0.1, 1, 1); // y = 1.02 - 0.22 * 4.5 = 0.03 < 0.1 - 0.05
    expect(pl.alive[s]).toBe(0);
    expect(pl.uniforms[s * 4 + 2]).toBe(0);
  });

  it("never spawn while silent or on weak onsets", () => {
    const pl = createPlumes();
    const a = frame();
    a.onset = true;
    a.onsetStrength = 0.9;
    a.silent = true;
    expect(pl.step(a, 0, 0)).toBe(-1);
    a.silent = false;
    a.onsetStrength = 0.1;
    expect(pl.step(a, 0.1, 0)).toBe(-1);
    expect(Array.from(pl.alive)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
