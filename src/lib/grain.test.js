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

  it("has streaky fibre (R smoother along x than y), white speckle (G) and soft wobble (B)", () => {
    const g = makeGrain(3);
    expect(roughness(g, 0, true)).toBeLessThan(roughness(g, 0, false) * 0.6);
    expect(roughness(g, 1, true)).toBeGreaterThan(40);
    expect(roughness(g, 2, true)).toBeLessThan(8);
    expect(g[3]).toBe(255);
  });
});
