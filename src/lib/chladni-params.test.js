// @ts-check
import { describe, expect, it } from "vitest";
import { BACKDROPS, createResolved, DEFAULT_REACTIVITY, GRAIN_OPTIONS, PALETTES, paletteColors, resolveParams } from "./chladni-params.js";

const defaults = { palette: "brass", backdrop: "plate", grains: "64k", complexity: 1, reactivity: 1, hop: 1 };

describe("resolveParams", () => {
  it("passes defaults through", () => {
    const r = resolveParams(defaults, "high", false, createResolved());
    expect(r).toEqual({ palette: 0, backdrop: 0, grains: 65536, complexity: 1, reactivity: 1, hop: 1, bassTilt: true, reduceMotion: false });
  });

  it("falls back to defaults for the harness flip-test values", () => {
    const flip = { palette: "rings", backdrop: "16", grains: "32", complexity: 0.25, reactivity: 0, hop: 0, mode: "bars" };
    const r = resolveParams(flip, "high", false, createResolved());
    expect([r.palette, r.backdrop, r.grains]).toEqual([0, 0, 65536]);
    expect([r.complexity, r.reactivity, r.hop]).toEqual([0.5, 0, 0]);
    const junk = resolveParams({ palette: 3, complexity: "x", reactivity: NaN, hop: Infinity }, "high", false, createResolved());
    expect([junk.palette, junk.complexity, junk.reactivity, junk.hop]).toEqual([0, 1, 1, 1]);
  });

  it("clamps numbers to the manifest ranges", () => {
    const r = resolveParams({ ...defaults, complexity: 9, reactivity: -1, hop: 3 }, "high", false, createResolved());
    expect([r.complexity, r.reactivity, r.hop]).toEqual([2, 0, 2]);
  });

  it("maps selects to their option index and grain count", () => {
    const r = resolveParams({ ...defaults, palette: "mono", backdrop: "none", grains: "128k" }, "high", false, createResolved());
    expect([r.palette, r.backdrop, r.grains]).toEqual([3, 1, 131072]);
    expect(PALETTES).toEqual(["brass", "slate", "cobalt", "mono"]);
    expect(BACKDROPS).toEqual(["plate", "none"]);
    expect(GRAIN_OPTIONS).toEqual(["32k", "64k", "128k"]);
  });

  it("uses 32k grains on battery while Grains is at its default", () => {
    expect(resolveParams(defaults, "battery", false, createResolved()).grains).toBe(32768);
    expect(resolveParams({ ...defaults, grains: "128k" }, "battery", false, createResolved()).grains).toBe(131072);
  });

  it("calms the plate under reduce motion only while Reactivity is at its default", () => {
    expect(DEFAULT_REACTIVITY).toBe(1);
    const r = resolveParams(defaults, "high", true, createResolved());
    expect([r.reactivity, r.hop, r.bassTilt, r.reduceMotion]).toEqual([0.5, 0.5, false, true]);
    const moved = resolveParams({ ...defaults, reactivity: 1.5 }, "high", true, createResolved());
    expect([moved.reactivity, moved.hop, moved.bassTilt, moved.reduceMotion]).toEqual([1.5, 1, true, true]);
  });

  it("writes into and returns the object it is given", () => {
    const out = createResolved();
    expect(resolveParams(defaults, "high", false, out)).toBe(out);
  });
});

describe("paletteColors", () => {
  it("gives plate gradient, grain colour and the light grain colour for backdrop none", () => {
    const c = paletteColors(0, new Float32Array(12));
    const hex = (/** @type {number} */ i) => "#" + Array.from(c.subarray(i, i + 3), (v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
    expect([hex(0), hex(3), hex(6), hex(9)]).toEqual(["#6b4a1f", "#a8823f", "#1d1712", "#d9b56a"]);
    const lights = [0, 1, 2, 3].map((i) => (paletteColors(i, c), hex(9)));
    expect(lights).toEqual(["#d9b56a", "#e9dcc0", "#8fb0ff", "#f2f2f2"]);
    paletteColors(2, c);
    expect(hex(6)).toBe("#1f3fa0");
  });
});
