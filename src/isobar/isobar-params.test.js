// @ts-check
// @ts-expect-error -- a Node builtin (tests run in Node); the web tsconfig has no @types/node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHARTS, createParams, DEFAULT_SPEED, resolveParams } from "./isobar-params.js";

const DEFAULTS = {
  chart: "paper",
  reactivity: 1,
  speed: 1,
  fronts: true,
  barbs: true,
  labels: true,
  coastline: true,
  tints: true,
};

describe("resolveParams", () => {
  it("resolves the manifest defaults", () => {
    const p = resolveParams(DEFAULTS, false, createParams());
    expect(p).toMatchObject({
      chart: 0,
      reactivity: 1,
      speed: 1,
      fronts: true,
      barbs: true,
      labels: true,
      coastline: true,
      tints: true,
      speedEff: 1,
      pulseEff: 1,
      sweepEff: 1,
    });
    expect(DEFAULT_SPEED).toBe(1);
    expect(CHARTS).toEqual(["paper", "broadcast", "night", "none"]);
  });

  it("maps each chart to its index in manifest order", () => {
    for (let i = 0; i < CHARTS.length; i++) {
      expect(resolveParams({ ...DEFAULTS, chart: CHARTS[i] }, false, createParams()).chart).toBe(i);
    }
  });

  it("survives the harness flip test: stale selects, halved numbers, odd types", () => {
    const p = resolveParams(
      { chart: "rings", mode: "bars", reactivity: -1, speed: 0.1, fronts: "yes", barbs: 0, labels: null },
      false,
      createParams(),
    );
    expect(p.chart).toBe(0);
    expect(p.reactivity).toBe(0);
    expect(p.speed).toBe(0.2);
    expect(p.fronts).toBe(true);
    expect(p.barbs).toBe(true);
    expect(p.labels).toBe(true);
    expect(resolveParams({ reactivity: 9, speed: 9 }, false, createParams())).toMatchObject({
      reactivity: 2,
      speed: 2,
    });
    expect(resolveParams({ reactivity: NaN }, false, createParams()).reactivity).toBe(1);
  });

  it("passes booleans through", () => {
    const p = resolveParams({ ...DEFAULTS, fronts: false, barbs: false, labels: false, coastline: false, tints: false }, false, createParams());
    expect([p.fronts, p.barbs, p.labels, p.coastline, p.tints]).toEqual([false, false, false, false, false]);
  });

  it("calms drift, kicks and the front sweep under Reduce motion only at the default speed", () => {
    const p = resolveParams(DEFAULTS, true, createParams());
    expect([p.speedEff, p.pulseEff, p.sweepEff]).toEqual([0.5, 0.5, 0.5]);
    const q = resolveParams({ ...DEFAULTS, speed: 1.5 }, true, createParams());
    expect([q.speedEff, q.pulseEff, q.sweepEff]).toEqual([1.5, 1, 1]);
  });
});

it("the manifest's defaults are the ones the lib keys off", () => {
  const m = JSON.parse(readFileSync(new URL("../../tidalviz.json", import.meta.url), "utf8"));
  const v = m.visualizers.find((/** @type {{ id: string }} */ e) => e.id === "isobar");
  const byId = Object.fromEntries(v.params.map((/** @type {{ id: string }} */ p) => [p.id, p]));
  expect(byId.speed.default).toBe(DEFAULT_SPEED);
  expect(byId.chart.options).toEqual(CHARTS);
  expect(Object.fromEntries(v.params.map((/** @type {{ id: string, default: unknown }} */ p) => [p.id, p.default]))).toEqual(DEFAULTS);
});
