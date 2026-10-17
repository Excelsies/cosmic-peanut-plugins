// @ts-check
import { describe, expect, it } from "vitest";
import { hash01 } from "./hash.js";
import { createPlates, joltAngle, joltMagnitude } from "./plates.js";

/** Largest offset length over the three plates. @param {Float32Array} o */
const maxLen = (o) => Math.max(Math.hypot(o[0], o[1]), Math.hypot(o[2], o[3]), Math.hypot(o[4], o[5]));

/** @param {number} hz @param {number} seconds @param {number} magnitude */
function run(hz, seconds, magnitude) {
  const p = createPlates();
  p.kick(magnitude, 3);
  let peak = 0;
  for (let i = 0; i < Math.round(seconds * hz); i++) {
    p.step(1 / hz);
    peak = Math.max(peak, maxLen(p.offset));
  }
  return { p, peak };
}

describe("plates", () => {
  it("throws each plate about `magnitude` px and settles under 0.5 px within 1 s", () => {
    const { p, peak } = run(60, 1, 10);
    expect(peak).toBeGreaterThan(9.5);
    expect(peak).toBeLessThan(10.5);
    expect(maxLen(p.offset)).toBeLessThan(0.5);
  });

  it("ends in the identical state at 60 Hz and 120 Hz", () => {
    const a = run(60, 0.75, 6).p;
    const b = run(120, 0.75, 6).p;
    for (let i = 0; i < 6; i++) expect(a.offset[i]).toBe(b.offset[i]);
  });

  it("does not move at all for a zero kick", () => {
    const { peak } = run(60, 1, 0);
    expect(peak).toBe(0);
  });

  it("scales the kick with misregister, onset strength and bass (CSS px × pxScale)", () => {
    expect(joltMagnitude(0, 1, 2, 2)).toBe(0);
    expect(joltMagnitude(1, 0, 1, 1)).toBeCloseTo(8 * 0.6, 9);
    expect(joltMagnitude(1, 1, 2, 1)).toBeCloseTo(20, 9);
    expect(joltMagnitude(1, 1, 5, 1)).toBeCloseTo(20, 9);
    expect(joltMagnitude(0.5, 0.5, 1.5, 2)).toBeCloseTo(0.5 * 14 * 0.8 * 2, 9);
    // Bigger kicks throw the plates further, proportionally.
    expect(run(60, 1, 4).peak / run(60, 1, 8).peak).toBeCloseTo(0.5, 6);
  });

  it("throws a typical kick 4–8 px at the default misregister on a dpr-1 display", () => {
    // Host onsetStrength (odf / decaying peak) is 0.4–0.9 on real kicks; bassAtt − 1 is 0.2–0.5.
    for (const s of [0.4, 0.65, 0.9]) {
      for (const b of [1.2, 1.35, 1.5]) {
        const m = joltMagnitude(0.5, s, b, 1);
        expect(m).toBeGreaterThanOrEqual(4);
        expect(m).toBeLessThanOrEqual(8);
      }
    }
  });

  it("pushes the plates 120° apart with ±30° deterministic jitter", () => {
    for (let n = 0; n < 50; n++) {
      for (let i = 0; i < 3; i++) {
        const deg = (joltAngle(i, n) * 180) / Math.PI - (90 + 120 * i);
        expect(Math.abs(deg)).toBeLessThanOrEqual(30 + 1e-9);
        expect(joltAngle(i, n)).toBe(joltAngle(i, n));
      }
    }
    expect(joltAngle(0, 1)).not.toBe(joltAngle(0, 2));
    for (let n = 0; n < 1000; n++) {
      const h = hash01(n);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});
