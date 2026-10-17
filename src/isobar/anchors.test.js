// @ts-check
import { describe, expect, it } from "vitest";
import { createAnchors, locateAnchors } from "./anchors.js";
import { backgroundAt, createPressure, derivs, grad, HIGH, LOW, MAX_LOWS, pressureAt, SLOTS } from "./pressure.js";

const DT = 1 / 60;

/**
 * A chart with only the given systems alive (no highs unless asked for).
 * @param {Array<{ slot: number, x: number, y: number, sigma: number, eff: number }>} systems
 */
function chart(systems) {
  const st = createPressure(16 / 9);
  for (let i = 0; i < SLOTS; i++) {
    st.alive[i] = 0;
    st.eff[i] = 0;
  }
  for (const s of systems) {
    st.alive[s.slot] = 1;
    st.x[s.slot] = s.x;
    st.y[s.slot] = s.y;
    st.sigma[s.slot] = s.sigma;
    st.eff[s.slot] = s.eff;
  }
  return st;
}

const g2 = new Float64Array(2);
/** |grad P| at (x, y). @param {ReturnType<typeof createPressure>} st @param {number} x @param {number} y */
function gradMag(st, x, y) {
  grad(st, x, y, g2);
  return Math.hypot(g2[0], g2[1]);
}

/**
 * True when P at (x, y) is at most (sign 1) or at least (sign -1) P on a ring of radius r around it.
 * @param {ReturnType<typeof createPressure>} st @param {number} x @param {number} y @param {number} sign
 */
function isExtremum(st, x, y, sign, r = 0.01) {
  const p = pressureAt(st, x, y);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * 2 * Math.PI;
    if (sign * (pressureAt(st, x + r * Math.cos(a), y + r * Math.sin(a)) - p) < 0) return false;
  }
  return true;
}

describe("derivs", () => {
  it("returns P, the gradient and the Hessian, matching pressureAt, grad and finite differences", () => {
    const st = chart([
      { slot: 0, x: 0.8, y: 0.5, sigma: 0.18, eff: -20 },
      { slot: 1, x: 0.95, y: 0.6, sigma: 0.16, eff: -8 },
      { slot: 4, x: 1.2, y: 0.4, sigma: 0.3, eff: 9 },
    ]);
    const d = new Float64Array(6);
    const h = 1e-4;
    for (const [x, y] of [
      [0.85, 0.52],
      [1.0, 0.45],
      [0.25, 0.2], // only the calm chart (the 3-sigma box edges, where the gradient steps, are avoided)
    ]) {
      derivs(st, x, y, d);
      expect(d[0]).toBeCloseTo(pressureAt(st, x, y), 9);
      grad(st, x, y, g2);
      expect(d[1]).toBeCloseTo(g2[0], 9);
      expect(d[2]).toBeCloseTo(g2[1], 9);
      grad(st, x + h, y, g2);
      const gxp = g2[0];
      const gyp = g2[1];
      grad(st, x - h, y, g2);
      expect(d[3]).toBeCloseTo((gxp - g2[0]) / (2 * h), 2); // Pxx
      expect(d[4]).toBeCloseTo((gyp - g2[1]) / (2 * h), 2); // Pxy
      grad(st, x, y + h, g2);
      const gyq = g2[1];
      grad(st, x, y - h, g2);
      expect(d[5]).toBeCloseTo((gyq - g2[1]) / (2 * h), 2); // Pyy
    }
  });
});

describe("locateAnchors", () => {
  it("puts an isolated low's anchor on the field minimum, off its Gaussian centre", () => {
    const st = chart([{ slot: 0, x: 0.8, y: 0.5, sigma: 0.18, eff: -16 }]);
    const an = createAnchors();
    locateAnchors(st, an, 1);
    expect(an.ok[0]).toBe(1);
    expect(an.lead[0]).toBe(1);
    expect(an.letter[0]).toBe(1);
    expect(gradMag(st, an.x[0], an.y[0])).toBeLessThan(1);
    expect(isExtremum(st, an.x[0], an.y[0], 1)).toBe(true);
    // the calm chart's north-south gradient pulls the minimum north of the Gaussian centre
    expect(an.y[0]).toBeLessThan(0.5 - 0.005);
    expect(an.p[0]).toBeCloseTo(pressureAt(st, an.x[0], an.y[0]), 9);
    expect(an.anomaly[0]).toBeCloseTo(an.p[0] - backgroundAt(an.x[0], an.y[0]), 9);
    expect(an.anomaly[0]).toBeLessThan(-10);
  });

  it("two lows less than a sigma apart share one minimum, and only the deeper leads it", () => {
    const st = chart([
      { slot: 0, x: 0.8, y: 0.5, sigma: 0.18, eff: -16 },
      { slot: 1, x: 0.9, y: 0.52, sigma: 0.16, eff: -10 },
    ]);
    const an = createAnchors();
    locateAnchors(st, an, 1);
    expect(an.ok[0]).toBe(1);
    expect(an.ok[1]).toBe(1);
    expect(Math.hypot(an.ex[0] - an.ex[1], an.ey[0] - an.ey[1])).toBeLessThan(1e-3);
    expect(isExtremum(st, an.ex[0], an.ey[0], 1)).toBe(true);
    expect([an.x[0], an.y[0]]).toEqual([an.ex[0], an.ey[0]]); // the lead's marks sit on it
    expect([an.lead[0], an.lead[1]]).toEqual([1, 0]);
    expect([an.letter[0], an.letter[1]]).toEqual([1, 0]);
  });

  it("keeps the lead of a shared minimum while the other low only draws level (no flicker on kicks)", () => {
    const st = chart([
      { slot: 0, x: 0.8, y: 0.5, sigma: 0.18, eff: -16 },
      { slot: 1, x: 0.9, y: 0.52, sigma: 0.16, eff: -10 },
    ]);
    const an = createAnchors();
    locateAnchors(st, an, 1);
    st.eff[1] = -17; // a kick on the younger low
    locateAnchors(st, an, 1);
    expect([an.lead[0], an.lead[1]]).toEqual([1, 0]);
    // apart again, each leads its own minimum
    st.x[1] = 1.4;
    locateAnchors(st, an, 1);
    expect([an.lead[0], an.lead[1]]).toEqual([1, 1]);
    expect(Math.hypot(an.x[0] - an.x[1], an.y[0] - an.y[1])).toBeGreaterThan(0.4);
  });

  it("holds a low's marks for a second after a neighbour swallows its minimum, then fades them", () => {
    const st = chart([
      { slot: 0, x: 0.8, y: 0.5, sigma: 0.18, eff: -16 },
      { slot: 1, x: 1.2, y: 0.5, sigma: 0.16, eff: -16 },
    ]);
    st.id[0] = 1;
    st.id[1] = 2;
    const an = createAnchors();
    for (let k = 0; k < 60; k++) locateAnchors(st, an, DT);
    expect(an.vis[1]).toBeGreaterThan(0.95);
    const off = [an.x[1] - st.x[1], an.y[1] - st.y[1]];
    // a kick deepens slot 0 until slot 1's minimum drains into it
    st.eff[0] = -40;
    locateAnchors(st, an, DT);
    expect(an.lead[1]).toBe(0);
    expect(an.ok[1] && Math.hypot(an.ex[1] - an.ex[0], an.ey[1] - an.ey[0]) < 0.01).toBe(true);
    // still shown, at its remembered offset from its own centre
    expect(an.x[1] - st.x[1]).toBeCloseTo(off[0], 12);
    expect(an.y[1] - st.y[1]).toBeCloseTo(off[1], 12);
    expect(an.x[1]).toBeGreaterThan(1.1);
    expect(an.letter[1]).toBe(1);
    for (let k = 0; k < 50; k++) locateAnchors(st, an, DT); // under HOLD
    expect(an.vis[1]).toBeGreaterThan(0.95);
    // the kick passes: its own minimum is back and it never faded
    st.eff[0] = -16;
    locateAnchors(st, an, DT);
    expect(an.lead[1]).toBe(1);
    // swallowed for good: fades out after HOLD
    st.eff[0] = -40;
    for (let k = 0; k < 60 + 90; k++) locateAnchors(st, an, DT);
    expect(an.vis[1]).toBeLessThan(0.05);
    for (let k = 0; k < 120; k++) locateAnchors(st, an, DT);
    expect(an.vis[1]).toBe(0);
    expect(an.letter[1]).toBe(0);
  });

  it("starts a reused slot hidden, easing its marks in over a fraction of a second", () => {
    const st = chart([{ slot: 0, x: 0.8, y: 0.5, sigma: 0.18, eff: -16 }]);
    st.id[0] = 1;
    const an = createAnchors();
    for (let k = 0; k < 120; k++) locateAnchors(st, an, DT);
    expect(an.vis[0]).toBeGreaterThan(0.99);
    st.id[0] = 9; // a new low in the same slot
    locateAnchors(st, an, DT);
    expect(an.vis[0]).toBeLessThan(0.1);
    for (let k = 0; k < 30; k++) locateAnchors(st, an, DT);
    expect(an.vis[0]).toBeGreaterThan(0.8);
  });

  it("finds a strong high's maximum, and no anchor where a weak high leaves no closed maximum", () => {
    const st = chart([{ slot: 4, x: 1.0, y: 0.5, sigma: 0.3, eff: 16 }]);
    st.kind[4] = HIGH;
    const an = createAnchors();
    locateAnchors(st, an, 1);
    expect(an.ok[4]).toBe(1);
    expect(an.letter[4]).toBe(1);
    expect(gradMag(st, an.x[4], an.y[4])).toBeLessThan(1);
    expect(isExtremum(st, an.x[4], an.y[4], -1)).toBe(true);
    st.eff[4] = 4; // its slope never beats the calm chart's 12 hPa per unit
    const fresh = createAnchors();
    locateAnchors(st, fresh, 1);
    expect(fresh.ok[4]).toBe(0);
    expect(fresh.lead[4]).toBe(0);
    expect(fresh.letter[4]).toBe(0);
  });

  it("gives no letter to a nearly filled low, and skips dead slots", () => {
    const st = chart([{ slot: 2, x: 0.8, y: 0.5, sigma: 0.2, eff: -2 }]);
    expect(st.kind[2]).toBe(LOW);
    const an = createAnchors();
    locateAnchors(st, an, 1);
    expect(an.letter[2]).toBe(0);
    for (let i = 0; i < SLOTS; i++) if (i !== 2) expect([an.ok[i], an.lead[i], an.letter[i]]).toEqual([0, 0, 0]);
  });

  it("lands every low of a busy chart on a real minimum or reports it has none", () => {
    // four lows in a row, some merging, plus the three seeded highs
    const st = createPressure(16 / 9);
    const xs = [0.5, 0.62, 0.95, 1.3];
    for (let i = 0; i < MAX_LOWS; i++) {
      st.alive[i] = 1;
      st.x[i] = xs[i];
      st.y[i] = 0.45 + 0.05 * i;
      st.sigma[i] = 0.18;
      st.eff[i] = -6 - 10 * i;
    }
    const an = createAnchors();
    locateAnchors(st, an, 1);
    for (let i = 0; i < MAX_LOWS; i++) {
      if (!an.ok[i]) continue;
      expect(gradMag(st, an.ex[i], an.ey[i]), `low ${i}`).toBeLessThan(1);
      expect(isExtremum(st, an.ex[i], an.ey[i], 1), `low ${i}`).toBe(true);
    }
    // here every low drains into the deepest one's minimum: one ring system, one lead
    let leads = 0;
    for (let i = 0; i < MAX_LOWS; i++) {
      expect(an.ok[i]).toBe(1);
      expect(Math.hypot(an.ex[i] - an.ex[3], an.ey[i] - an.ey[3])).toBeLessThan(0.01);
      leads += an.lead[i];
    }
    expect(leads).toBe(1);
    expect(an.lead[3]).toBe(1);
  });
});
