// @ts-check
import { describe, expect, it } from "vitest";
import manifest from "../../tidalviz.json";
import { createParamState, DEFAULT_INK, DEFAULT_SPEED, FLOCKS, resolveParams, SKIES } from "./murmuration-params.js";

const DEFAULTS = { sky: "dusk", ink: "#ece6da", flock: "4000", speed: 1, falcon: true, reactivity: 1 };

/** @param {Record<string, unknown>} over @param {"auto"|"high"|"balanced"|"battery"} [quality] @param {boolean} [reduceMotion] */
function resolve(over = {}, quality = "high", reduceMotion = false) {
  const out = createParamState();
  resolveParams({ ...DEFAULTS, ...over }, quality, reduceMotion, out);
  return out;
}

describe("resolveParams", () => {
  it("resolves the manifest defaults", () => {
    const p = resolve();
    expect(SKIES[p.sky]).toBe("dusk");
    expect(p.flock).toBe(4000);
    expect(p.speed).toBe(1);
    expect(p.falcon).toBe(true);
    expect(p.reactivity).toBe(1);
    expect(p.flee).toBe(true);
    expect(p.attractorAmp).toBe(1);
    expect(p.cirrusDrift).toBe(1);
    expect(p.ink[0]).toBeCloseTo(0xec / 255, 6);
  });

  it("falls back to the default ink for an invalid colour", () => {
    const p = resolve({ ink: "red" });
    expect(p.ink[0]).toBeCloseTo(0xec / 255, 6);
    expect(p.ink[1]).toBeCloseTo(0xe6 / 255, 6);
    expect(resolve({ ink: "#33ff66" }).ink[1]).toBeCloseTo(1, 6);
  });

  it("falls back to the defaults for stale select values and clamps numbers", () => {
    const p = resolve({ sky: "rings", flock: "16", speed: 0.05, reactivity: 9, falcon: "yes" });
    expect(SKIES[p.sky]).toBe("dusk");
    expect(p.flock).toBe(4000);
    expect(p.speed).toBe(0.2);
    expect(p.reactivity).toBe(2);
    expect(p.falcon).toBe(true);
    expect(resolve({ speed: NaN }).speed).toBe(DEFAULT_SPEED);
    expect(SKIES[resolve({ sky: "none" }).sky]).toBe("none");
    expect(resolve({ flock: "6000" }).flock).toBe(6000);
  });

  it("uses 2000 birds on battery while the flock is at its default", () => {
    expect(resolve({}, "battery").flock).toBe(2000);
    expect(resolve({ flock: "6000" }, "battery").flock).toBe(6000);
    expect(resolve({}, "balanced").flock).toBe(4000);
  });

  it("reduce motion gentles the default speed, flee, sweep and cirrus, only while speed is at its default", () => {
    const p = resolve({}, "high", true);
    expect(p.speed).toBe(0.5);
    expect(p.flee).toBe(false);
    expect(p.attractorAmp).toBe(0.5);
    expect(p.cirrusDrift).toBeCloseTo(0.3, 6);
    const q = resolve({ speed: 1.4 }, "high", true);
    expect(q.speed).toBe(1.4);
    expect(q.flee).toBe(true);
    expect(q.attractorAmp).toBe(1);
    expect(q.cirrusDrift).toBe(1);
  });

  it("turning the falcon off also turns its flee burst off", () => {
    const p = resolve({ falcon: false });
    expect(p.falcon).toBe(false);
  });
});

describe("manifest", () => {
  it("matches the defaults and option order the code keys off", () => {
    const viz = manifest.visualizers.find((v) => v.id === "murmuration");
    const params = Object.fromEntries((viz?.params ?? []).map((p) => [p.id, p]));
    expect(params.speed.default).toBe(DEFAULT_SPEED);
    expect(params.ink.default).toBe(DEFAULT_INK);
    expect(params.sky.options).toEqual(SKIES);
    expect(params.flock.options).toEqual(FLOCKS.map(String));
  });
});
