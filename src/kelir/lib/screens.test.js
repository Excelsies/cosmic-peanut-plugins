// @ts-check
import { describe, expect, it } from "vitest";
import { SCREENS } from "./kelir-params.js";
import { PALETTES, contrast, screenColours } from "./screens.js";

describe("screen palettes", () => {
  it("has one palette per screen option, in option order", () => {
    expect(PALETTES.map((p) => p.id)).toEqual(SCREENS);
  });

  it("keeps a near shadow at 7:1 or more against the lit screen", () => {
    const c = new Float32Array(9);
    for (let i = 0; i < 3; i++) {
      screenColours(i, c);
      const hot = [c[0], c[1], c[2]];
      // A near shadow covers the screen at 0.96 opacity.
      const shadow = [0, 1, 2].map((k) => hot[k] + (c[6 + k] - hot[k]) * 0.96);
      expect(contrast(hot, shadow)).toBeGreaterThanOrEqual(7);
    }
  });

  it("writes the lamp's amber, umber and brown-black", () => {
    const c = new Float32Array(9);
    screenColours(0, c);
    expect(Array.from(c).map((v) => Math.round(v * 255))).toEqual([0xff, 0xd7, 0x9a, 0x6b, 0x3f, 0x1c, 0x1a, 0x0f, 0x08]);
  });

  it("marks the reiniger screen as a vertical gradient with a tighter blur range, and none as clear", () => {
    expect(PALETTES[2].vertical).toBe(true);
    expect(PALETTES[2].reiniger).toBe(true);
    expect(PALETTES[3].clear).toBe(true);
    expect(PALETTES[0].clear || PALETTES[0].vertical || PALETTES[0].reiniger).toBe(false);
  });
});
