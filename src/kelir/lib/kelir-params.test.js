// @ts-check
// @ts-expect-error -- a Node builtin (tests run in Node); the web tsconfig has no @types/node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CASTS,
  DEFAULT_CAST,
  DEFAULT_FLICKER,
  DEFAULT_REACTIVITY,
  SCREENS,
  resolveParams,
} from "./kelir-params.js";

const manifest = JSON.parse(readFileSync(new URL("../../../tidalviz.json", import.meta.url), "utf8"));
/** @type {Record<string, any>} */
const spec = Object.fromEntries(
  manifest.visualizers.find((/** @type {any} */ v) => v.id === "kelir").params.map((/** @type {any} */ p) => [p.id, p]),
);
const defaults = Object.fromEntries(Object.entries(spec).map(([k, p]) => [k, p.default]));

describe("resolveParams", () => {
  it("resolves the manifest defaults", () => {
    const o = resolveParams(defaults, false, {});
    expect(o).toMatchObject({
      screen: 0,
      cast: 0,
      reactivity: 1,
      flicker: 0.5,
      blur: 1,
      lace: 1,
      scenes: true,
      attack: 0.07,
      lungeEff: 1,
      swayEff: 1,
      spin: true,
    });
  });

  it("keeps the option lists and the defaults the code keys off in step with the manifest", () => {
    expect(spec.screen.options).toEqual(SCREENS);
    expect(spec.cast.options).toEqual(CASTS);
    expect(spec.cast.default).toBe(DEFAULT_CAST);
    expect(spec.reactivity.default).toBe(DEFAULT_REACTIVITY);
    expect(spec.flicker.default).toBe(DEFAULT_FLICKER);
  });

  it("maps options to their manifest index", () => {
    const o = resolveParams({ ...defaults, screen: "none", cast: "kayon" }, false, {});
    expect([o.screen, o.cast]).toEqual([3, 2]);
  });

  it("survives the harness flip test (stale selects, numbers below min, junk)", () => {
    /** @type {Record<string, unknown>} */
    const flipped = { mode: "rings" };
    for (const [k, p] of Object.entries(spec)) {
      if (p.type === "number") flipped[k] = p.min / 2 - 1;
      else if (p.type === "select") flipped[k] = "bars";
      else flipped[k] = p.default;
    }
    const o = resolveParams(flipped, false, {});
    expect([o.screen, o.cast]).toEqual([0, 0]);
    expect(o.reactivity).toBe(0);
    expect(o.flicker).toBe(0);
    expect(o.blur).toBe(0);
    expect(o.lace).toBe(0.5);
    const junk = resolveParams({ reactivity: "x", flicker: NaN, blur: Infinity, lace: null, scenes: "no" }, false, {});
    expect([junk.reactivity, junk.flicker, junk.blur, junk.lace, junk.scenes]).toEqual([1, 0.5, 1.5, 1, true]);
    const high = resolveParams({ ...defaults, reactivity: 9, flicker: 9, blur: 9, lace: 9 }, false, {});
    expect([high.reactivity, high.flicker, high.blur, high.lace]).toEqual([2, 1, 1.5, 2]);
  });

  it("turns scenes off only for an explicit false", () => {
    expect(resolveParams({ ...defaults, scenes: false }, false, {}).scenes).toBe(false);
  });

  it("is gentler under reduce motion while reactivity and flicker are untouched", () => {
    const o = resolveParams(defaults, true, {});
    expect(o.flicker).toBeCloseTo(0.15, 10);
    expect(o.attack).toBe(0.2);
    expect(o.lungeEff).toBe(0.7);
    expect(o.swayEff).toBe(0.5);
    expect(o.spin).toBe(false);
  });

  it("honours a user's own reactivity and flicker under reduce motion", () => {
    const o = resolveParams({ ...defaults, reactivity: 1.5, flicker: 0.8 }, true, {});
    expect(o.flicker).toBe(0.8);
    expect(o.attack).toBe(0.07);
    expect(o.lungeEff).toBe(1);
    expect(o.swayEff).toBe(1.5);
    expect(o.spin).toBe(true);
  });

  it("scales lunges down with low reactivity but never past a full lunge", () => {
    expect(resolveParams({ ...defaults, reactivity: 0.5 }, false, {}).lungeEff).toBe(0.5);
    expect(resolveParams({ ...defaults, reactivity: 2 }, false, {}).lungeEff).toBe(1);
  });

  it("writes into the object it is given", () => {
    const out = {};
    expect(resolveParams(defaults, false, out)).toBe(out);
  });
});
