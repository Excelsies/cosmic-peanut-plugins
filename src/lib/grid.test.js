// @ts-check
import { describe, expect, it } from "vitest";
import { createControls, createFlock, resizeFlock, seedFlock, stepFlock } from "./flock.js";
import { buildGrid, findNeighbors, PERCEPTION, TOPO_K } from "./grid.js";

const HX = 5.13;
const HY = 2.887;

/** @param {number} n */
function makeFlock(n) {
  const f = createFlock();
  resizeFlock(f, HX, HY);
  seedFlock(f, n, 1234);
  const c = createControls();
  return { f, c };
}

describe("grid", () => {
  it("finds the same 7 nearest neighbours through the grid as by brute force", () => {
    const { f, c } = makeFlock(200);
    for (let s = 0; s < 30; s++) stepFlock(f, c); // a realistic, clumpy configuration
    buildGrid(f); // findNeighbors reads the grid of the current positions
    expect(PERCEPTION).toBe(0.12);
    let checked = 0;
    for (let i = 0; i < f.n; i++) {
      const k = findNeighbors(f, i);
      const got = Array.from(f.nbIdx.slice(0, k)).sort((x, y) => x - y);
      const all = [];
      for (let j = 0; j < f.n; j++) {
        if (j === i) continue;
        const d2 = (f.px[j] - f.px[i]) ** 2 + (f.py[j] - f.py[i]) ** 2 + (f.pz[j] - f.pz[i]) ** 2;
        if (d2 < PERCEPTION * PERCEPTION) all.push([d2, j]);
      }
      all.sort((x, y) => x[0] - y[0]);
      const want = all.slice(0, TOPO_K).map((x) => x[1]).sort((x, y) => x - y);
      expect(got).toEqual(want);
      checked += k;
    }
    expect(checked).toBeGreaterThan(200); // the test saw real neighbourhoods
  });
});
