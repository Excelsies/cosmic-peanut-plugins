// @ts-check
import { describe, expect, it } from "vitest";
import { contour, createContours, levelAt, pathSegments } from "./contour.js";
import { fakeContext } from "./fake-2d.test-helper.js";

const COLS = 61;
const ROWS = 51;
const CELL = 10;
const SIGMA = 8 * CELL;
const DEPTH = 30;
const CX = 30 * CELL + 3.3;
const CY = 25 * CELL - 2.1;

/** P of one analytic Gaussian low on 1013 hPa. @param {number} x @param {number} y */
const lowP = (x, y) => 1013 - DEPTH * Math.exp(-((x - CX) ** 2 + (y - CY) ** 2) / (2 * SIGMA * SIGMA));

function lowGrid() {
  const nodes = new Float32Array(COLS * ROWS);
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) nodes[j * COLS + i] = lowP(i * CELL, j * CELL);
  return nodes;
}

describe("contour", () => {
  it("levels are 940 + 4k", () => {
    expect([levelAt(0), levelAt(10), levelAt(15)]).toEqual([940, 980, 1000]);
  });

  it("a Gaussian low gives closed rings, each within half a cell of its true radius", () => {
    const c = createContours();
    contour(lowGrid(), COLS, ROWS, CELL, CELL, 40, c);
    expect(c.count).toBeGreaterThan(100);
    /** @type {Map<string, number>} */
    const ends = new Map();
    /** @type {Set<number>} */
    const levels = new Set();
    for (let k = 0; k < c.count; k++) {
      for (let e = 0; e < 2; e++) {
        const x = c.segs[4 * k + 2 * e];
        const y = c.segs[4 * k + 2 * e + 1];
        const key = `${x.toFixed(3)},${y.toFixed(3)}`;
        ends.set(key, (ends.get(key) ?? 0) + 1);
        const rho = Math.hypot(x - CX, y - CY);
        const L = 940 + 4 * Math.round((lowP(x, y) - 940) / 4);
        levels.add(L);
        const r = SIGMA * Math.sqrt(2 * Math.log(DEPTH / (1013 - L)));
        expect(Math.abs(rho - r)).toBeLessThan(0.5 * CELL);
      }
    }
    for (const n of ends.values()) expect(n).toBe(2); // every ring closes
    expect([...levels].sort((p, q) => p - q)).toEqual([984, 988, 992, 996, 1000, 1004, 1008, 1012]);
    expect(c.nLabels).toBe(0); // nothing leaves the chart
  });

  it("flags the levels at multiples of 20 hPa as bold", () => {
    const c = createContours();
    contour(lowGrid(), COLS, ROWS, CELL, CELL, 40, c);
    for (let k = 0; k < c.count; k++) {
      const L = 940 + 4 * Math.round((lowP(c.segs[4 * k], c.segs[4 * k + 1]) - 940) / 4);
      expect(c.bold[k]).toBe(L % 20 === 0 ? 1 : 0);
    }
  });

  it("resolves saddles with the cell-centre average", () => {
    const c = createContours();
    // High TL and BR, low TR and BL: a centre at or above the level joins the high corners, so
    // the segments cut off the low corners TR and BL; below it they cut off TL and BR.
    const at = (/** @type {number[]} */ v) => {
      contour(Float32Array.from(v), 2, 2, 10, 10, 40, c);
      const cut = [];
      for (let k = 0; k < c.count; k++) {
        const mx = (c.segs[4 * k] + c.segs[4 * k + 2]) / 2;
        const my = (c.segs[4 * k + 1] + c.segs[4 * k + 3]) / 2;
        cut.push(`${mx > 5 ? "R" : "L"}${my > 5 ? "B" : "T"}`);
      }
      return cut.sort();
    };
    // nodes are row-major (TL, TR, BL, BR); only the 1004 level crosses
    expect(at([1007, 1001, 1001, 1007])).toEqual(["LB", "RT"]); // centre 1004 >= 1004: inside
    expect(at([1007, 1001, 1001, 1005.4])).toEqual(["LT", "RB"]); // centre 1003.6 < 1004: outside
  });

  it("never writes past its segment cap", () => {
    const c = createContours(50);
    const nodes = new Float32Array(COLS * ROWS);
    for (let i = 0; i < nodes.length; i++) nodes[i] = 960 + ((i * 7919) % 97);
    contour(nodes, COLS, ROWS, CELL, CELL, 40, c);
    expect(c.count).toBe(50);
    expect(c.segs.length).toBe(200);
  });

  it("collects edge crossings, skipping any within the gap of the previous one on that edge", () => {
    const c = createContours();
    const nodes = new Float32Array(COLS * ROWS);
    // isobars running north-south: P rises 1 hPa per column, so 4 columns apart
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) nodes[j * COLS + i] = 990 + i;
    contour(nodes, COLS, ROWS, CELL, CELL, 0, c);
    const top = [];
    for (let k = 0; k < c.nLabels; k++) if (c.labels[4 * k + 3] === 0) top.push(c.labels[4 * k]);
    expect(top.length).toBe(15); // 992 ... 1048
    contour(nodes, COLS, ROWS, CELL, CELL, 75, c);
    const spaced = [];
    for (let k = 0; k < c.nLabels; k++) {
      if (c.labels[4 * k + 3] === 0) {
        spaced.push(c.labels[4 * k]);
        expect(c.labels[4 * k + 1]).toBe(0);
        expect(c.labels[4 * k + 2] % 4).toBe(0); // the level in hPa
      }
    }
    expect(spaced.length).toBe(8); // every other one
    for (let k = 1; k < spaced.length; k++) expect(spaced[k] - spaced[k - 1]).toBeGreaterThanOrEqual(75);
  });

  it("strokes normal and bold segments as separate single paths", () => {
    const c = createContours();
    contour(lowGrid(), COLS, ROWS, CELL, CELL, 40, c);
    const { ctx, log } = fakeContext();
    pathSegments(ctx, c, 0);
    const moves = log.filter((e) => e.op === "move").length;
    let normal = 0;
    for (let k = 0; k < c.count; k++) normal += c.bold[k] ? 0 : 1;
    expect(moves).toBe(normal);
    expect(log.filter((e) => e.op === "begin")).toHaveLength(0); // the caller owns begin/stroke
  });
});
