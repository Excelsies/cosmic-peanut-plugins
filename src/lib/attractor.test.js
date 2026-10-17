// @ts-check
import { describe, expect, it } from "vitest";
import { altitude, attractor, PERIOD, shape, SHAPES, sweep } from "./attractor.js";
import { createMeter } from "./meter.js";

const HX = 5.13;
const HY = 2.887;

describe("attractor", () => {
  it("drifts smoothly on the free clock at bpm 0", () => {
    const m = createMeter();
    const out = new Float64Array(2);
    let px = NaN;
    let py = NaN;
    let maxStep = 0;
    for (let i = 0; i < 60 * 40; i++) {
      const phi = m.step(0, 0, 1 / 60);
      attractor(phi, HX, HY, 1, 0, 0, out);
      if (i > 0) maxStep = Math.max(maxStep, Math.hypot(out[0] - px, out[1] - py));
      px = out[0];
      py = out[1];
    }
    // Peak sweep speed at 1 beat/s is about 2π·(0.55 + 0.18·2.3)·HX/16 ≈ 1.9 units/s.
    expect(maxStep).toBeLessThan(2.2 / 60);
    expect(maxStep).toBeGreaterThan(0.5 / 60);
  });

  it("turns the main sweep around on downbeats of the 16-beat cycle", () => {
    expect(PERIOD).toBe(16);
    for (const k of [0, 1, 5]) {
      for (const turn of [4, 12]) {
        const b = k * 16 + turn;
        const v = sweep(b, HX);
        expect(Math.abs(v)).toBeCloseTo(0.55 * HX, 9);
        // An extremum: both neighbours lie on the same side.
        expect(Math.sign(v - sweep(b - 0.01, HX))).toBe(Math.sign(v - sweep(b + 0.01, HX)));
      }
      expect(sweep(k * 16 + 3, HX)).toBeCloseTo(sweep(3, HX), 9);
    }
  });

  it("adds the stereo bias and altitude, and stays inside the frame", () => {
    const a = new Float64Array(2);
    const b = new Float64Array(2);
    attractor(2, HX, HY, 1, 0, 0, a);
    attractor(2, HX, HY, 1, 0.2, 0.3, b);
    expect(b[0] - a[0]).toBeCloseTo(0.2 * 0.6 * HX, 9);
    expect(b[1] - a[1]).toBeCloseTo(0.3, 9);
    for (let phi = 0; phi < 64; phi += 0.25) {
      attractor(phi, HX, HY, 1, 1, 10, a);
      expect(Math.abs(a[0])).toBeLessThanOrEqual(0.62 * HX + 1e-9);
      expect(Math.abs(a[1])).toBeLessThanOrEqual(0.5 * HY + 1e-9);
    }
  });

  it("halves the sweep with a smaller amplitude", () => {
    const a = new Float64Array(2);
    const b = new Float64Array(2);
    attractor(3, HX, HY, 1, 0, 0, a);
    attractor(3, HX, HY, 0.5, 0, 0, b);
    expect(b[0]).toBeCloseTo(a[0] / 2, 9);
  });

  it("maps brightness to altitude, clamped", () => {
    expect(altitude(0.25, HY)).toBe(0);
    expect(altitude(0.5, HY)).toBeCloseTo(0.25 * 0.8 * HY, 9);
    expect(altitude(5, HY)).toBeCloseTo(0.3 * HY, 9);
    expect(altitude(-5, HY)).toBeCloseTo(-0.3 * HY, 9);
  });
});

describe("flock shape program", () => {
  it("picks a shape per 16-beat cycle and morphs only during the first 4 beats", () => {
    const a = new Float64Array(6);
    const b = new Float64Array(6);
    for (let k = 1; k < 12; k++) {
      shape(k * 16 + 4, a);
      shape(k * 16 + 15.9, b);
      expect(Array.from(b)).toEqual(Array.from(a));
    }
  });

  it("is continuous across cycle boundaries", () => {
    const a = new Float64Array(6);
    const b = new Float64Array(6);
    for (let k = 1; k < 12; k++) {
      shape(k * 16 - 1e-6, a);
      shape(k * 16 + 1e-6, b);
      for (let i = 0; i < 6; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(1e-3);
    }
  });

  it("visits every shape (blob, ribbon, doughnut, teardrop) within a few minutes", () => {
    const o = new Float64Array(6);
    const seen = new Set();
    for (let k = 0; k < 40; k++) {
      shape(k * 16 + 8, o);
      seen.add(Array.from(o).join("/"));
      expect(o[4]).toBeGreaterThan(0.1); // a tube radius, never a line of birds
      expect(o[5]).toBeGreaterThan(0.1);
    }
    expect(seen.size).toBe(SHAPES.length);
  });
});
