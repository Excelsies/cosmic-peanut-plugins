// @ts-check
import { describe, expect, it } from "vitest";
import { intervalRatio, RATIOS } from "./interval.js";

/** @param {Record<number, number>} levels pitch class → level, others 0.05 */
function chroma(levels) {
  const c = new Float64Array(12).fill(0.05);
  for (const [pc, v] of Object.entries(levels)) c[Number(pc)] = v;
  return c;
}

describe("interval", () => {
  it("maps C and G to a 3:2 fifth", () => {
    expect(intervalRatio(chroma({ 0: 1, 7: 0.8 }))).toBe(3 / 2);
  });

  it("maps C and C# to a 16:15 semitone", () => {
    expect(intervalRatio(chroma({ 0: 1, 1: 0.7 }))).toBe(16 / 15);
  });

  it("measures from the strongest class upward (G then C is a fourth)", () => {
    expect(intervalRatio(chroma({ 7: 1, 0: 0.8 }))).toBe(4 / 3);
  });

  it("falls back to 2:1 for a flat or empty chroma (drums, noise, silence)", () => {
    expect(intervalRatio(new Float64Array(12).fill(0.3))).toBe(2);
    expect(intervalRatio(new Float64Array(12))).toBe(2);
    // max/mean just under 1.5
    expect(intervalRatio(chroma({ 0: 0.07, 7: 0.07 }))).toBe(2);
  });

  it("has a just ratio for every interval", () => {
    expect(Array.from(RATIOS)).toEqual([2, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 16 / 9, 15 / 8]);
  });
});
