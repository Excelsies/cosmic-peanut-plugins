// @ts-check
import { describe, expect, it } from "vitest";
import { createFixedStep, takeSteps } from "./fixedstep.js";
import {
  angularSpeed,
  beginCell,
  clearRecords,
  createPen,
  createRecords,
  damping,
  KINK_FALL,
  KINK_STEPS,
  MAX_ONSETS,
  MAX_SLOTS,
  moveCell,
  MAX_STEPS,
  penPoints,
  penSetup,
  precession,
  recordOnset,
  recordSlots,
  SLOT_STEPS,
  STEP_HZ,
} from "./harmonograph.js";

const R = 200;

/** A records table with cell 0 begun on a 3:2 figure for an 8 s phrase. */
function setup({ ratio = 1.5, width = 0, balance = 0, phrase = 8 } = {}) {
  const rec = createRecords();
  beginCell(rec, 0, 7, angularSpeed(1), ratio, precession(0.3), damping(phrase, 1), width, balance, 0);
  const pen = createPen();
  penSetup(pen, rec, 0, 500, 400, R, 2);
  return { rec, pen };
}

/**
 * Live loop at `hz` for `seconds`: record (loudness, chatter) slots and an onset at t = 1 s, take
 * fixed steps, and collect every pen point.
 */
function live(/** @type {number} */ hz, /** @type {number} */ seconds) {
  const { rec, pen } = setup();
  const fs = createFixedStep(STEP_HZ, MAX_STEPS);
  /** @type {number[]} */
  const pts = [];
  for (let f = 0; f < Math.round(seconds * hz); f++) {
    if (f === hz) recordOnset(rec, 0, 0.9);
    const n = takeSteps(fs, 1 / hz);
    recordSlots(rec, 0, rec.steps[0] + n, 0.5, 0.3);
    const out = penPoints(pen, rec, rec.steps[0], n);
    for (let i = 0; i < 2 * n; i++) pts.push(out[i]);
    rec.steps[0] += n;
  }
  return pts;
}

/** Largest distance between consecutive points. */
function maxTravel(/** @type {number[]} */ pts) {
  let m = 0;
  for (let i = 2; i < pts.length; i += 2) m = Math.max(m, Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
  return m;
}

describe("harmonograph pen", () => {
  it("draws identical points at 30, 60 and 120 Hz frame rates", () => {
    const a = live(60, 2);
    expect(a.length).toBe(2 * 1200);
    expect(live(30, 2)).toEqual(a);
    expect(live(120, 2)).toEqual(a);
  });

  it("writes at most 40 points per call into one reused array", () => {
    const { rec, pen } = setup();
    const fs = createFixedStep(STEP_HZ, MAX_STEPS);
    const n = takeSteps(fs, 0.1);
    expect(n).toBe(40);
    const out = penPoints(pen, rec, 0, 100);
    expect(out).toBe(pen.out);
    expect(out.length).toBe(80);
    expect(pen.count).toBe(40);
    expect(penPoints(pen, rec, 40, 10)).toBe(out);
  });

  it("spirals in to 1/8 of its radius or less by the end of the phrase", () => {
    const { rec, pen } = setup({ phrase: 8 });
    let maxEarly = 0;
    let maxLate = 0;
    for (let s = 0; s < 8 * STEP_HZ; s += 40) {
      const out = penPoints(pen, rec, s, 40);
      for (let i = 0; i < 40; i++) {
        // Largest per-axis swing (each axis is bounded by R; together they can reach √2 R).
        const r = Math.max(Math.abs(out[2 * i] - 500), Math.abs(out[2 * i + 1] - 400));
        if (s < STEP_HZ) maxEarly = Math.max(maxEarly, r);
        if (s >= 8 * STEP_HZ - 40) maxLate = Math.max(maxLate, r);
      }
    }
    expect(maxEarly).toBeGreaterThan(0.8 * R);
    expect(maxEarly).toBeLessThanOrEqual(R + 1e-9);
    expect(maxLate).toBeLessThanOrEqual(R / 8);
  });

  it("starts every cell's figure near its full swing (pendulum pairs start nearly in phase)", () => {
    for (let seed = 0; seed < 60; seed++) {
      const rec = createRecords();
      beginCell(rec, 0, seed, angularSpeed(1), 1.5, precession(0.3), damping(8, 1), 0, 0, 0);
      const pen = createPen();
      penSetup(pen, rec, 0, 0, 0, R, 0);
      let mx = 0;
      let my = 0;
      for (let s = 0; s < STEP_HZ / 2; s += 40) {
        const out = penPoints(pen, rec, s, 40);
        for (let i = 0; i < 40; i++) {
          mx = Math.max(mx, Math.abs(out[2 * i]));
          my = Math.max(my, Math.abs(out[2 * i + 1]));
        }
      }
      expect(mx).toBeGreaterThan(0.85 * R);
      expect(my).toBeGreaterThan(0.85 * R);
    }
  });

  it("kinks on an onset with a 40 ms ramp and a 200 ms return, never a jump", () => {
    const base = setup();
    const kinked = setup();
    // Onsets at step 0 of the second second, strength 1.
    kinked.rec.steps[0] = STEP_HZ;
    recordOnset(kinked.rec, 0, 1);
    /** @param {ReturnType<typeof setup>} s */
    const pts = (s) => {
      const out = [];
      for (let st = STEP_HZ - 40; st < STEP_HZ + 2 * KINK_STEPS; st += 8) {
        const o = penPoints(s.pen, s.rec, st, 8);
        for (let i = 0; i < 16; i++) out.push(o[i]);
      }
      return out;
    };
    const a = pts(base);
    const b = pts(kinked);
    // Compare with the unkinked pen's fastest step over a whole second.
    const ref = setup();
    /** @type {number[]} */
    const second = [];
    for (let st = 0; st < STEP_HZ; st += 40) second.push(...penPoints(ref.pen, ref.rec, st, 40));
    expect(maxTravel(b)).toBeLessThan(1.6 * maxTravel(second));
    // ...but the figure did change after the ramp.
    const L = a.length;
    expect(Math.hypot(a[L - 2] - b[L - 2], a[L - 1] - b[L - 1])).toBeGreaterThan(10);
    // Before the onset nothing differs.
    expect(b.slice(0, 80)).toEqual(a.slice(0, 80));
    // ...and once the kink has returned, the pen is back on the unkinked figure.
    const after = STEP_HZ + KINK_STEPS + KINK_FALL;
    expect(Array.from(penPoints(kinked.pen, kinked.rec, after, 10))).toEqual(Array.from(penPoints(base.pen, base.rec, after, 10)));
  });

  it("keeps at most 64 onsets per cell", () => {
    const { rec } = setup();
    for (let i = 0; i < 80; i++) {
      rec.steps[0] = i * 10;
      recordOnset(rec, 0, 0.5);
    }
    expect(rec.onsets[0]).toBe(MAX_ONSETS);
  });

  it("chatters only when the hats rise above their average, by Chatter × 1.2 px at most per unit", () => {
    const quiet = setup();
    recordSlots(quiet.rec, 0, 400, 0.5, 0);
    const busy = setup();
    recordSlots(busy.rec, 0, 400, 0.5, 2);
    const a = penPoints(quiet.pen, quiet.rec, 0, 40);
    const qa = Array.from(a);
    const b = Array.from(penPoints(busy.pen, busy.rec, 0, 40));
    let maxd = 0;
    for (let i = 0; i < 80; i++) maxd = Math.max(maxd, Math.abs(qa[i] - b[i]));
    expect(maxd).toBeGreaterThan(0.5);
    // penSetup chatter 2 (device px per unit) × 1.2 × clamp(2) = 4.8
    expect(maxd).toBeLessThanOrEqual(2 * 1.2 * 2 + 1e-9);
  });

  it("records each 30 Hz slot once, first write wins", () => {
    const { rec } = setup();
    recordSlots(rec, 0, 30, 1, 0);
    expect(rec.slots[0]).toBe(2);
    recordSlots(rec, 0, 41, 0, 1);
    expect(rec.slots[0]).toBe(3);
    expect(Array.from(rec.weight.subarray(0, 3))).toEqual([255, 255, 0]);
    expect(SLOT_STEPS).toBe(20);
  });

  it("squashes y with stereo width and tilts the figure 0.6 rad per unit of balance", () => {
    /** @param {number} width @param {number} balance */
    const points = (width, balance) => {
      const { rec, pen } = setup({ width, balance, ratio: 1 });
      /** @type {number[]} */
      const pts = [];
      for (let s = 0; s < STEP_HZ; s += 40) pts.push(...penPoints(pen, rec, s, 40));
      return pts;
    };
    const maxY = (/** @type {number[]} */ p) => Math.max(...p.filter((_, i) => i % 2).map((y) => Math.abs(y - 400)));
    expect(maxY(points(1, 0))).toBeCloseTo(0.55 * maxY(points(0, 0)), 3);
    const flat = points(1, 0);
    const tilted = points(1, 1);
    const c = Math.cos(0.6);
    const sn = Math.sin(0.6);
    for (let i = 0; i < flat.length; i += 2) {
      const x = flat[i] - 500;
      const y = flat[i + 1] - 400;
      expect(tilted[i]).toBeCloseTo(500 + c * x - sn * y, 3);
      expect(tilted[i + 1]).toBeCloseTo(400 + sn * x + c * y, 3);
    }
  });
});

describe("records", () => {
  it("moves a cell's record to another index and clears the whole sheet", () => {
    const rec = createRecords();
    beginCell(rec, 5, 3, 10, 1.25, 0.004, 0.3, 0.2, -0.5, 2);
    rec.steps[5] = 700;
    recordOnset(rec, 5, 0.7);
    recordSlots(rec, 5, 700, 0.4, 1);
    moveCell(rec, 5, 0);
    expect([rec.w[0], rec.ratio[0], rec.width[0], rec.balance[0], rec.ink[0], rec.steps[0]]).toEqual([10, 1.25, 0.2, -0.5, 2, 700]);
    expect(rec.p1[0]).toBe(rec.p1[5]);
    expect([rec.onsets[0], rec.onsetStep[0], rec.slots[0]]).toEqual([1, 700, 35]);
    expect(rec.weight[34]).toBe(rec.weight[5 * MAX_SLOTS + 34]);
    clearRecords(rec);
    expect(Math.max(...rec.steps, ...rec.onsets, ...rec.slots)).toBe(0);
  });
});

describe("figure terms", () => {
  it("base pendulum period is 0.35 s at speed 1", () => {
    expect(angularSpeed(1)).toBeCloseTo((2 * Math.PI) / 0.35);
    expect(angularSpeed(0.5)).toBeCloseTo(Math.PI / 0.35);
  });

  it("decays to about 1/8 over the phrase, slower under heavy bass (bigger figures)", () => {
    expect(Math.exp(-damping(8, 2) * 8)).toBeCloseTo(1 / 8 ** 0.8, 6);
    expect(Math.exp(-damping(8, 1) * 8)).toBeCloseTo(1 / 8 ** 1.2, 6);
    expect(damping(8, 5)).toBe(damping(8, 2));
  });

  it("precesses faster for brighter phrases", () => {
    expect(precession(0)).toBe(0.002);
    expect(precession(1)).toBeCloseTo(0.01);
    expect(precession(7)).toBeCloseTo(0.01);
  });
});
