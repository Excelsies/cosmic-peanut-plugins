// @ts-check
import { describe, expect, it } from "vitest";
import { hexToRgb, parseHex } from "./color.js";

describe("parseHex", () => {
  it("parses #rrggbb into 0-1 floats", () => {
    const out = new Float32Array(3);
    expect(parseHex("#ff8000", "#000000", out)).toBe(true);
    expect(Array.from(out)).toEqual([1, 128 / 255, 0].map((v) => Math.fround(v)));
  });

  it("falls back to the given default for anything else", () => {
    const out = new Float32Array(3);
    for (const bad of ["red", "#fff", 7, null, "#gggggg"]) {
      expect(parseHex(bad, "#ece6da", out)).toBe(false);
      expect(out[0]).toBeCloseTo(0xec / 255, 6);
      expect(out[2]).toBeCloseTo(0xda / 255, 6);
    }
  });
});

describe("hexToRgb", () => {
  it("parses #rrggbb into 0–1 floats in place", () => {
    const out = new Float32Array(3);
    expect(hexToRgb("#ff8000", out)).toBe(out);
    expect(out[0]).toBeCloseTo(1);
    expect(out[1]).toBeCloseTo(128 / 255);
    expect(out[2]).toBeCloseTo(0);
  });

  it("falls back to white for anything that isn't #rrggbb", () => {
    const out = [0, 0, 0];
    hexToRgb("red", out);
    expect(out).toEqual([1, 1, 1]);
  });
});
