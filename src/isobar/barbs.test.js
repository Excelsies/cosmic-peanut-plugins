// @ts-check
import { describe, expect, it } from "vitest";
import { fakeContext } from "./fake-2d.test-helper.js";
import { addBarb, barbCounts, createBarbs, pathBarbs, stationGrid, windAt, KT_PER_HPA } from "./barbs.js";
import { createPressure } from "./pressure.js";

describe("wind", () => {
  it("4 hPa per 0.05 chart units is about 25 kt", () => {
    expect(KT_PER_HPA * (4 / 0.05)).toBeCloseTo(25);
  });

  it("blows counter-clockwise round a low (north up): north on its east side, west on its north side", () => {
    const st = createPressure(16 / 9);
    for (let i = 4; i < 7; i++) st.eff[i] = 0; // no highs
    st.alive[0] = 1;
    st.x[0] = 0.8;
    st.y[0] = 0.5;
    st.sigma[0] = 0.15;
    st.eff[0] = -40;
    const w = new Float64Array(2);
    windAt(st, 0.95, 0.5, w);
    expect(w[1]).toBeLessThan(-10); // screen y up = north
    expect(Math.abs(w[0])).toBeLessThan(Math.abs(w[1]) * 0.3);
    windAt(st, 0.8, 0.35, w); // north of the centre
    expect(w[0]).toBeLessThan(-10); // blowing west
  });

  it("the calm chart blows from the west", () => {
    const st = createPressure(16 / 9);
    st.eff.fill(0);
    const w = new Float64Array(2);
    windAt(st, 0.5, 0.5, w);
    expect(w[0]).toBeGreaterThan(2);
  });
});

describe("barbCounts", () => {
  it("buckets speeds into pennants, feathers and half feathers to the nearest 5 kt", () => {
    const n = new Int32Array(3);
    /** @param {number} kt */
    const at = (kt) => (barbCounts(kt, n) ? Array.from(n) : "calm");
    expect(at(2)).toBe("calm");
    expect(at(4)).toEqual([0, 0, 1]);
    expect(at(7)).toEqual([0, 0, 1]);
    expect(at(23)).toEqual([0, 2, 1]);
    expect(at(55)).toEqual([1, 0, 1]);
    expect(at(65)).toEqual([1, 1, 1]);
    expect(at(100)).toEqual([2, 0, 0]);
  });
});

describe("addBarb", () => {
  it("points a westerly's shaft west with its feathers on the north (low-pressure) side", () => {
    const b = createBarbs();
    addBarb(b, 100, 100, 20, 0, 14);
    // segment 0: the shaft, from the station toward where the wind comes from
    expect([b.lines[0], b.lines[1]]).toEqual([100, 100]);
    expect(b.lines[2]).toBeCloseTo(86);
    expect(b.lines[3]).toBeCloseTo(100);
    expect(b.nLines).toBe(1 + 2); // 20 kt: two feathers
    for (let k = 1; k < b.nLines; k++) {
      expect(b.lines[4 * k + 1]).toBeCloseTo(100); // starts on the shaft
      expect(b.lines[4 * k + 3]).toBeLessThan(95); // ends north of it
      expect(b.lines[4 * k]).toBeLessThan(100); // at the far end
    }
  });

  it("draws a calm circle below 3 kt and a pennant from 50 kt", () => {
    const b = createBarbs();
    addBarb(b, 10, 10, 1, 1, 14);
    expect([b.nCalm, b.nLines]).toEqual([1, 0]);
    addBarb(b, 50, 50, 0, -55, 14);
    expect(b.nPen).toBe(1);
    const { ctx, log } = fakeContext();
    pathBarbs(ctx, b, 0);
    expect(log.filter((e) => e.op === "arc")).toHaveLength(1);
    log.length = 0;
    pathBarbs(ctx, b, 1);
    expect(log.filter((e) => e.op === "close")).toHaveLength(1);
    expect(log.filter((e) => e.op === "arc")).toHaveLength(1); // the barb's station dot
  });
});

describe("stationGrid", () => {
  it("uses 7 to 12 columns by width and rows by aspect, offset half a cell", () => {
    const xy = new Float32Array(400);
    const n = stationGrid(2560, 16 / 9, xy);
    expect(n).toBe(12 * 7);
    expect(xy[0]).toBeCloseTo((0.5 / 12) * (16 / 9));
    expect(xy[1]).toBeCloseTo(0.5 / 7);
    expect(stationGrid(800, 16 / 9, xy)).toBe(7 * 4);
    expect(stationGrid(1540, 16 / 9, xy)).toBe(7 * 4);
  });
});
