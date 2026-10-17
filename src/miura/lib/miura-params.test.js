// @ts-check
// @ts-expect-error -- a Node builtin (tests run in Node); the web tsconfig has no @types/node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOLD,
  DEFAULT_REACTIVITY,
  effectiveMotion,
  LIGHTS,
  PAPERS,
  PLEATS,
  resolveParams,
  SHEETS,
} from "./miura-params.js";

const manifest = JSON.parse(readFileSync(new URL("../../../tidalviz.json", import.meta.url), "utf8"));
/** @type {Record<string, any>} */
const spec = Object.fromEntries(
  manifest.visualizers.find((/** @type {any} */ v) => v.id === "miura").params.map((/** @type {any} */ p) => [p.id, p]),
);
const defaults = Object.fromEntries(Object.entries(spec).map(([k, p]) => [k, p.default]));

describe("resolveParams", () => {
  it("passes the manifest defaults through", () => {
    expect(resolveParams(defaults, {})).toEqual({
      paper: "washi",
      pleat: "classic",
      sheet: "fill",
      fold: 1,
      reactivity: 1,
      light: "window",
      shadows: true,
    });
  });

  it("keeps the option lists in manifest order", () => {
    expect(spec.paper.options).toEqual(PAPERS);
    expect(spec.pleat.options).toEqual(PLEATS);
    expect(spec.sheet.options).toEqual(SHEETS);
    expect(spec.light.options).toEqual(LIGHTS);
  });

  it("pins the manifest defaults the reduce-motion code keys off", () => {
    expect(spec.fold.default).toBe(DEFAULT_FOLD);
    expect(spec.reactivity.default).toBe(DEFAULT_REACTIVITY);
  });

  it("clamps numbers and maps unknown or stale values to the defaults (flip test)", () => {
    const p = resolveParams(
      { ...defaults, mode: "rings", paper: "rings", pleat: "32", sheet: 16, light: null, fold: 0.1, reactivity: 9, shadows: "yes" },
      {},
    );
    expect(p).toEqual({ paper: "washi", pleat: "classic", sheet: "fill", fold: 0.2, reactivity: 2, light: "window", shadows: true });
    expect(resolveParams({ fold: "x", reactivity: NaN }, {})).toMatchObject({ fold: 1, reactivity: 1 });
    expect(resolveParams({ shadows: false }, {}).shadows).toBe(false);
  });

  it("fills and returns the object it is given", () => {
    const out = {};
    expect(resolveParams(defaults, out)).toBe(out);
  });
});

describe("effectiveMotion", () => {
  const p = resolveParams(defaults, {});

  it("is full motion normally", () => {
    expect(effectiveMotion(p, false, {})).toEqual({ waveEff: 1, speedEff: 1, swell: 1, rustle: 1, barsPerTurn: 8 });
  });

  it("is gentler under reduce motion while fold and reactivity are at their defaults", () => {
    expect(effectiveMotion(p, true, {})).toEqual({ waveEff: 0.5, speedEff: 0.6, swell: 0, rustle: 0, barsPerTurn: 16 });
  });

  it("gives the user's own fold or reactivity back under reduce motion", () => {
    expect(effectiveMotion({ ...p, reactivity: 1.5 }, true, {}).waveEff).toBe(1);
    expect(effectiveMotion({ ...p, fold: 1.2 }, true, {}).barsPerTurn).toBe(8);
  });
});
