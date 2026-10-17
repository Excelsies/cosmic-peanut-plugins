// @ts-check
import { describe, expect, it } from "vitest";
import manifest from "../../tidalviz.json";
import {
  createParams,
  DEFAULT_CHATTER,
  DEFAULT_SPEED,
  GRID_OPTIONS,
  INK_OPTIONS,
  INKS,
  inkStyle,
  PAPER_OPTIONS,
  PHRASE_OPTIONS,
  REDUCED_SPEED,
  resolveParams,
} from "./plotter-params.js";

const entry = /** @type {{ params: any[] }} */ (manifest.visualizers.find((v) => v.id === "plotter"));
/** @type {Record<string, any>} */
const defaults = Object.fromEntries(entry.params.map((/** @type {any} */ p) => [p.id, p.default]));
const byId = Object.fromEntries(entry.params.map((/** @type {any} */ p) => [p.id, p]));

describe("plotter params", () => {
  it("pins the manifest defaults and option order the code keys off", () => {
    expect(defaults.speed).toBe(DEFAULT_SPEED);
    expect(defaults.chatter).toBe(DEFAULT_CHATTER);
    expect(byId.grid.options).toEqual(GRID_OPTIONS);
    expect(byId.phrase.options).toEqual(PHRASE_OPTIONS);
    expect(byId.paper.options).toEqual(PAPER_OPTIONS);
    expect(byId.inks.options).toEqual(INK_OPTIONS);
  });

  it("resolves the defaults", () => {
    const p = resolveParams(defaults, false, createParams());
    expect(p).toMatchObject({ cols: 4, rows: 3, phraseBars: 4, paper: 0, inks: 0, weight: 1, chatter: 0.5, speed: 1 });
  });

  it("falls back to defaults for stale or malformed values", () => {
    const p = resolveParams({ grid: "rings", phrase: "16", paper: "bars", inks: 32, weight: 0.25, chatter: "x", speed: NaN }, false, createParams());
    expect(p).toMatchObject({ cols: 4, rows: 3, phraseBars: 4, paper: 0, inks: 0, weight: 0.5, chatter: 0.5, speed: 1 });
    expect(resolveParams({}, false, createParams())).toMatchObject({ cols: 4, rows: 3, weight: 1, speed: 1 });
    expect(resolveParams({ weight: 9, chatter: -1, speed: 0.1 }, false, createParams())).toMatchObject({ weight: 3, chatter: 0, speed: 0.25 });
  });

  it("parses every grid and phrase option", () => {
    const p = createParams();
    expect(resolveParams({ grid: "6x4", phrase: "8 bars" }, false, p)).toMatchObject({ cols: 6, rows: 4, phraseBars: 8 });
    expect(resolveParams({ grid: "1x1", phrase: "2 bars" }, false, p)).toMatchObject({ cols: 1, rows: 1, phraseBars: 2 });
    expect(resolveParams({ grid: "3x2" }, false, p)).toMatchObject({ cols: 3, rows: 2 });
  });

  it("with Reduce motion, slows the default speed and halves the default chatter, but honours chosen values", () => {
    expect(resolveParams(defaults, true, createParams())).toMatchObject({ speed: REDUCED_SPEED, chatter: 0.25 });
    expect(REDUCED_SPEED).toBe(0.6);
    expect(resolveParams({ ...defaults, speed: 1.5, chatter: 0.8 }, true, createParams())).toMatchObject({ speed: 1.5, chatter: 0.8 });
  });

  it("picks light inks for blueprint and none, dark inks for cream and white", () => {
    expect(inkStyle(0, 0, 0)).toBe("#f4f1e8");
    expect(inkStyle(3, 0, 0)).toBe("#f4f1e8");
    expect(inkStyle(1, 0, 3)).toBe("#a3172f");
    expect(inkStyle(2, 1, 0)).toBe("#3d2b1f");
    expect(inkStyle(0, 2, 2)).toBe("#f4f4f4");
    expect(inkStyle(1, 2, 1)).toBe("#1a1a1a");
    for (const set of INKS) for (const variant of set) expect(variant).toHaveLength(4);
  });
});
