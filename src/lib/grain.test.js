// @ts-check
import { describe, expect, it } from "vitest";
import { GRAIN_SIZE, makeGrain } from "./grain.js";

/** Mean absolute difference between neighbouring texels in one channel along x or y. @param {Uint8Array} g @param {number} ch @param {boolean} alongX */
function roughness(g, ch, alongX) {
  const n = GRAIN_SIZE;
  let s = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const a = g[(y * n + x) * 4 + ch];
      const b = alongX ? g[(y * n + ((x + 1) % n)) * 4 + ch] : g[(((y + 1) % n) * n + x) * 4 + ch];
      s += Math.abs(a - b);
    }
  }
  return s / (n * n);
}

describe("makeGrain", () => {
  it("is a deterministic 256 × 256 RGBA8 texture", () => {
    const a = makeGrain(7);
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.length).toBe(GRAIN_SIZE * GRAIN_SIZE * 4);
    expect([...makeGrain(7)]).toEqual([...a]);
    expect([...makeGrain(8)]).not.toEqual([...a]);
  });

  it("tiles seamlessly (the wrap is no rougher than the inside)", () => {
    const g = makeGrain(1);
    const n = GRAIN_SIZE;
    for (const ch of [0, 2]) {
      let seam = 0;
      for (let y = 0; y < n; y++) seam += Math.abs(g[(y * n + n - 1) * 4 + ch] - g[(y * n) * 4 + ch]);
      expect(seam / n).toBeLessThan(roughness(g, ch, true) * 3 + 1);
    }
  });

  it("has streaky fibre (R smoother along x than y) and an independent white speckle per plate (G, B, A)", () => {
    const g = makeGrain(3);
    const n = GRAIN_SIZE * GRAIN_SIZE;
    expect(roughness(g, 0, true)).toBeLessThan(roughness(g, 0, false) * 0.6);
    for (const ch of [1, 2, 3]) expect(roughness(g, ch, true)).toBeGreaterThan(40);
    /** Pearson correlation of two channels. @param {number} a @param {number} b */
    const corr = (a, b) => {
      let sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0;
      for (let i = 0; i < n; i++) {
        const x = g[i * 4 + a];
        const y = g[i * 4 + b];
        sa += x; sb += y; sab += x * y; saa += x * x; sbb += y * y;
      }
      const cov = sab / n - (sa / n) * (sb / n);
      return cov / Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2));
    };
    expect(Math.abs(corr(1, 2))).toBeLessThan(0.03);
    expect(Math.abs(corr(1, 3))).toBeLessThan(0.03);
    expect(Math.abs(corr(2, 3))).toBeLessThan(0.03);
  });
});
