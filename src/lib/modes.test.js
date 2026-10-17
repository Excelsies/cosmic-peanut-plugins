// @ts-check
import { describe, expect, it } from "vitest";
import { buildModeTable, createCrossfade, MODE_COUNT, MODE_STRIDE, modeK2, START_MODE } from "./modes.js";

/** Entries of a table as [n1, m1, n2, m2, sign] tuples. @param {Float32Array} t */
const entries = (t) => Array.from({ length: MODE_COUNT }, (_, i) => Array.from(t.subarray(i * MODE_STRIDE, i * MODE_STRIDE + 5)));

describe("buildModeTable", () => {
  it("keeps 32 entries sorted by k² with n, m in 1..12", () => {
    for (const aspect of [0.3, 1, 1.78, 3.5]) {
      const t = buildModeTable(aspect, new Float32Array(64 * MODE_STRIDE));
      const es = entries(t);
      expect(es).toHaveLength(32);
      let prev = 0;
      for (let i = 0; i < MODE_COUNT; i++) {
        const [n1, m1, n2, m2, sign] = es[i];
        for (const v of [n1, m1]) expect(v >= 1 && v <= 12 && Number.isInteger(v)).toBe(true);
        if (sign !== 0) for (const v of [n2, m2]) expect(v >= 1 && v <= 12 && Number.isInteger(v)).toBe(true);
        expect([-1, 0, 1]).toContain(sign);
        const k2 = modeK2(t, i, aspect);
        expect(k2).toBeGreaterThanOrEqual(prev);
        prev = k2;
      }
    }
  });

  it("pairs only near-degenerate terms (|Δk²| / k² < 0.08)", () => {
    for (const aspect of [0.3, 1, 1.78, 3.5]) {
      const t = buildModeTable(aspect, new Float32Array(64 * MODE_STRIDE));
      for (const [n1, m1, n2, m2, sign] of entries(t)) {
        if (sign === 0) continue;
        const a = (n1 / aspect) ** 2 + m1 ** 2;
        const b = (n2 / aspect) ** 2 + m2 ** 2;
        expect(Math.abs(a - b) / ((a + b) / 2)).toBeLessThan(0.08);
      }
    }
  });

  it("reproduces the classic square-plate figures at aspect 1", () => {
    const es = entries(buildModeTable(1, new Float32Array(64 * MODE_STRIDE)));
    const has = (/** @type {number} */ n, /** @type {number} */ m, /** @type {number} */ s) =>
      es.some(([n1, m1, n2, m2, sign]) => sign === s && ((n1 === n && m1 === m && n2 === m && m2 === n) || (n1 === m && m1 === n && n2 === n && m2 === m)));
    expect(has(1, 2, 1) || has(1, 2, -1)).toBe(true);
    // Both the cross (−) and the diamond (+) figure of several classic pairs.
    let classic = 0;
    for (let n = 1; n <= 12; n++) for (let m = n + 1; m <= 12; m++) if (has(n, m, 1) || has(n, m, -1)) classic++;
    expect(classic).toBeGreaterThanOrEqual(8);
    expect(es.some(([, , , , s]) => s === 1)).toBe(true);
    expect(es.some(([, , , , s]) => s === -1)).toBe(true);
    expect(es.some(([, , , , s]) => s === 0)).toBe(true); // a few plain lattices
  });

  it("spans coarse to fine figures", () => {
    const t = buildModeTable(1.78, new Float32Array(64 * MODE_STRIDE));
    expect(Math.sqrt(modeK2(t, 0, 1.78))).toBeLessThan(3.5);
    expect(Math.sqrt(modeK2(t, MODE_COUNT - 1, 1.78))).toBeGreaterThan(9);
  });

  it("writes into and returns the preallocated array, the same for the same aspect", () => {
    const buf = new Float32Array(64 * MODE_STRIDE);
    expect(buildModeTable(1.78, buf)).toBe(buf);
    const copy = Float32Array.from(buf);
    buildModeTable(0.3, buf);
    buildModeTable(1.78, buf);
    expect(buf).toEqual(copy);
  });

  it("starts on a paired figure so atonal input still shows a shape", () => {
    const t = buildModeTable(1.78, new Float32Array(64 * MODE_STRIDE));
    expect(START_MODE).toBe(6);
    expect(t[START_MODE * MODE_STRIDE + 4]).not.toBe(0);
  });
});

describe("createCrossfade", () => {
  it("moves B to A, sets the new B and blends 0→1 over 0.4 s", () => {
    const x = createCrossfade(6);
    expect([x.a, x.b, x.blend]).toEqual([6, 6, 1]);
    x.switchTo(9, false);
    expect([x.a, x.b, x.blend]).toEqual([6, 9, 0]);
    for (let i = 0; i < 12; i++) x.step(1 / 60);
    expect(x.blend).toBeCloseTo(0.5);
    for (let i = 0; i < 12; i++) x.step(1 / 60);
    expect(x.blend).toBe(1);
  });

  it("takes 1 s under reduce motion and ignores a switch to the current mode", () => {
    const x = createCrossfade(6);
    x.switchTo(6, false);
    expect(x.blend).toBe(1);
    x.switchTo(3, true);
    for (let i = 0; i < 30; i++) x.step(1 / 60);
    expect(x.blend).toBeCloseTo(0.5);
  });
});
