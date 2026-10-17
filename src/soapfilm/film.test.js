// @ts-check
import { describe, expect, it } from "vitest";
import { blackFront, createFilmState, hBase, hMax, membrane, thicknessAt, vnoise } from "./film.js";

describe("drainage", () => {
  it("the black front only creeps down, and covers 45% between 140 and 170 s at drainage 1", () => {
    let prev = -1;
    let crossed = -1;
    for (let t = 0; t <= 300; t += 0.5) {
      const vb = blackFront(t);
      expect(vb).toBeGreaterThanOrEqual(prev);
      if (crossed < 0 && vb > 0.45) crossed = t;
      prev = vb;
    }
    expect(blackFront(0)).toBe(0);
    expect(crossed).toBeGreaterThan(140);
    expect(crossed).toBeLessThan(170);
    expect(blackFront(1e6)).toBeLessThanOrEqual(0.55);
  });

  it("the film thins as it ages and never exceeds 1350 nm", () => {
    expect(hMax(0, 1)).toBeCloseTo(1150, 6);
    expect(hMax(600, 1)).toBeLessThan(hMax(60, 1));
    expect(hMax(0, 2)).toBe(1350);
    expect(hMax(0, 0.5)).toBeCloseTo(575, 6);
  });
});

describe("base thickness", () => {
  it("is 0 above the black front and continuous below it", () => {
    const vb = 0.2;
    const hm = 1100;
    expect(hBase(0.1, vb, hm)).toBe(0);
    expect(hBase(0.199, vb, hm)).toBe(0);
    expect(hBase(vb, vb, hm)).toBeCloseTo(90, 6);
    expect(hBase(1, vb, hm)).toBeCloseTo(hm, 6);
    let prev = hBase(vb, vb, hm);
    for (let v = vb + 0.001; v <= 1; v += 0.001) {
      const h = hBase(v, vb, hm);
      expect(h).toBeGreaterThan(prev);
      expect(h - prev).toBeLessThan(25); // no jumps
      prev = h;
    }
  });
});

describe("membrane", () => {
  it("blends mode (1,1) into mode (1,2) and stays within -1..1", () => {
    expect(membrane(0.5, 0.5, 0)).toBeCloseTo(1, 6);
    expect(membrane(0.5, 0.5, 1)).toBeCloseTo(0, 6);
    expect(membrane(0.5, 0.25, 1)).toBeCloseTo(1, 6);
    expect(membrane(0, 0.3, 0.5)).toBeCloseTo(0, 6);
    for (let u = 0; u <= 1; u += 0.05) for (let v = 0; v <= 1; v += 0.05) expect(Math.abs(membrane(u, v, 0.7))).toBeLessThanOrEqual(1);
  });

  it("scales thickness by at most +/-12% at reactivity 1", () => {
    const st = createFilmState();
    st.age = 30;
    const rest = createFilmState();
    rest.age = 30;
    st.bassAmt = 0.12; // the most bass gives at reactivity 1 (drive.test.js pins it)
    for (const m of [0, 0.5, 1]) {
      st.m = m;
      for (let u = 0.01; u < 1; u += 0.07) {
        for (let v = 0.01; v < 1; v += 0.07) {
          const h0 = thicknessAt(u, v, rest);
          if (h0 === 0) continue;
          const r = thicknessAt(u, v, st) / h0;
          expect(r).toBeGreaterThanOrEqual(0.88 - 1e-9);
          expect(r).toBeLessThanOrEqual(1.12 + 1e-9);
        }
      }
    }
  });
});

describe("thicknessAt", () => {
  it("adds plume film in microns and reads the advected source coordinate", () => {
    const st = createFilmState();
    st.age = 30;
    const h = thicknessAt(0.5, 0.6, st);
    st.p = 0.2;
    expect(thicknessAt(0.5, 0.6, st)).toBeCloseTo(h + 200, 6);
    st.p = 0;
    st.dy = -0.1; // film here came from higher up: thinner
    expect(thicknessAt(0.5, 0.6, st)).toBeLessThan(h);
  });

  it("tilts the bands so the louder side sits lower", () => {
    const st = createFilmState();
    st.age = 30;
    st.tilt = (4 * Math.PI) / 180; // left louder
    // A band (constant thickness) is reached further down on the left than on the right.
    expect(thicknessAt(0.1, 0.5, st)).toBeLessThan(thicknessAt(0.9, 0.5, st));
  });

  it("is black at the top of an aged film", () => {
    const st = createFilmState();
    st.age = 120;
    expect(thicknessAt(0.5, 0.05, st)).toBe(0);
    expect(thicknessAt(0.5, 0.9, st)).toBeGreaterThan(500);
  });
});

it("vnoise is smooth value noise in [0, 1]", () => {
  for (let i = 0; i < 200; i++) {
    const x = i * 0.137;
    const n = vnoise(x, 2.5);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(1);
    expect(Math.abs(vnoise(x + 0.001, 2.5) - n)).toBeLessThan(0.01);
  }
});
