// @ts-check
import { describe, expect, it } from "vitest";
import {
  BACKDROPS,
  createParams,
  DEFAULT_DRAINAGE,
  DEFAULT_REACTIVITY,
  DEFAULT_SWIRL,
  LIGHTS,
  REDIPS,
  resolveParams,
} from "./soapfilm-params.js";

const defaults = { backdrop: "velvet", light: "softbox", thickness: 1, swirl: 1, drainage: 1, redip: "16 bars", reactivity: 1 };

describe("resolveParams", () => {
  it("resolves the manifest defaults", () => {
    const p = resolveParams(defaults, false, createParams());
    expect(p).toMatchObject({ backdrop: 0, light: 0, thickness: 1, swirl: 1, drainage: 1, redip: 0, reactivity: 1 });
    expect(p).toMatchObject({ swirlEff: 1, drainEff: 1, riseEff: 1, tilt: true });
  });

  it("indexes the options in manifest order", () => {
    expect(BACKDROPS).toEqual(["velvet", "studio", "none"]);
    expect(LIGHTS).toEqual(["softbox", "sky", "warm"]);
    expect(REDIPS).toEqual(["16 bars", "32 bars", "when black"]);
    const p = resolveParams({ ...defaults, backdrop: "none", light: "warm", redip: "when black" }, false, createParams());
    expect([p.backdrop, p.light, p.redip]).toEqual([2, 2, 2]);
  });

  it("maps unknown or stale selects to the default and clamps numbers (harness flip test)", () => {
    for (const mode of ["rings", "bars", "16", "32", "#33ff66", 3, undefined]) {
      const p = resolveParams({ ...defaults, backdrop: mode, light: mode, redip: mode }, false, createParams());
      expect([p.backdrop, p.light, p.redip]).toEqual([0, 0, 0]);
    }
    const p = resolveParams({ ...defaults, thickness: 0.25, swirl: -1, drainage: 0.1, reactivity: 9 }, false, createParams());
    expect([p.thickness, p.swirl, p.drainage, p.reactivity]).toEqual([0.5, 0, 0.2, 2]);
    const q = resolveParams({ ...defaults, thickness: "x", swirl: NaN, drainage: Infinity, reactivity: null }, false, createParams());
    expect([q.thickness, q.swirl, q.drainage, q.reactivity]).toEqual([1, 1, 1, 1]);
  });

  it("calms motion under Reduce motion only while each param is at its default", () => {
    expect([DEFAULT_SWIRL, DEFAULT_DRAINAGE, DEFAULT_REACTIVITY]).toEqual([1, 1, 1]);
    const p = resolveParams(defaults, true, createParams());
    expect(p).toMatchObject({ swirlEff: 0.5, drainEff: 0.6, riseEff: 0.6, tilt: false, reactivity: 1 });
    const q = resolveParams({ ...defaults, swirl: 1.5, drainage: 2, reactivity: 0.5 }, true, createParams());
    expect(q).toMatchObject({ swirlEff: 1.5, drainEff: 2, riseEff: 0.5, tilt: false });
  });

  it("fills the given object in place", () => {
    const out = createParams();
    expect(resolveParams(defaults, false, out)).toBe(out);
  });
});
