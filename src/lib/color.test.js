// @ts-check
import { expect, it } from "vitest";
import { hexOr, hexToRgb } from "./color.js";

it("parses #rrggbb into 0–1 floats in place", () => {
  const out = new Float32Array(3);
  expect(hexToRgb("#ff8000", out)).toBe(out);
  expect(out[0]).toBeCloseTo(1);
  expect(out[1]).toBeCloseTo(128 / 255);
  expect(out[2]).toBeCloseTo(0);
});

it("falls back to white for anything that isn't #rrggbb", () => {
  const out = new Float32Array(3);
  hexToRgb("red", out);
  expect(Array.from(out)).toEqual([1, 1, 1]);
});

it("hexOr keeps a valid colour and replaces anything else with the fallback", () => {
  expect(hexOr("#33FF66", "#000000")).toBe("#33FF66");
  expect(hexOr("#33ff6", "#102030")).toBe("#102030");
  expect(hexOr(42, "#102030")).toBe("#102030");
  expect(hexOr(undefined, "#102030")).toBe("#102030");
});
