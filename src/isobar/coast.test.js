// @ts-check
import { describe, expect, it } from "vitest";
import { coastSegments, createCoast, LAND, landAt, landMask } from "./coast.js";

const ASPECT = 16 / 9;

describe("land", () => {
  it("is deterministic and leans toward a north-western continent with islands elsewhere", () => {
    const c = createCoast();
    expect(landAt(c, 0.3, 0.2, ASPECT)).toBe(landAt(createCoast(), 0.3, 0.2, ASPECT));
    let nw = 0;
    let se = 0;
    let all = 0;
    const N = 60;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = ((i + 0.5) / N) * ASPECT;
        const y = (j + 0.5) / N;
        const land = landAt(c, x, y, ASPECT) >= LAND ? 1 : 0;
        all += land;
        if (x < ASPECT / 3 && y < 1 / 3) nw += land;
        if (x > (2 * ASPECT) / 3 && y > 2 / 3) se += land;
      }
    }
    expect(nw / (N * N / 9)).toBeGreaterThan(0.5);
    expect(se / (N * N / 9)).toBeLessThan(0.3);
    expect(all / (N * N)).toBeGreaterThan(0.12);
    expect(all / (N * N)).toBeLessThan(0.55);
  });

  it("fills a mask grid in chart space, so the land doesn't depend on the resolution", () => {
    const c = createCoast();
    const a = new Float32Array(41 * 21);
    landMask(c, a, 41, 21, ASPECT / 40, 1 / 20, ASPECT);
    expect(a[20 * 41 + 40]).toBeCloseTo(landAt(c, ASPECT, 1, ASPECT), 6);
    expect(a[10 * 41 + 13]).toBeCloseTo(landAt(c, (13 * ASPECT) / 40, 0.5, ASPECT), 6);
  });
});

describe("coastSegments", () => {
  it("traces the coast at the land threshold", () => {
    const c = createCoast();
    const cols = 161;
    const rows = 91;
    const dx = ASPECT / (cols - 1);
    const dy = 1 / (rows - 1);
    const mask = new Float32Array(cols * rows);
    landMask(c, mask, cols, rows, dx, dy, ASPECT);
    const segs = new Float32Array(4 * 20000);
    const n = coastSegments(mask, cols, rows, 10, 10, segs);
    expect(n).toBeGreaterThan(100);
    for (let k = 0; k < n; k += 7) {
      const x = segs[4 * k] / 10;
      const y = segs[4 * k + 1] / 10;
      // bilinear value of the mask at the endpoint is the threshold
      const i = Math.min(cols - 2, Math.floor(x));
      const j = Math.min(rows - 2, Math.floor(y));
      const fx = x - i;
      const fy = y - j;
      const v =
        mask[j * cols + i] * (1 - fx) * (1 - fy) +
        mask[j * cols + i + 1] * fx * (1 - fy) +
        mask[(j + 1) * cols + i] * (1 - fx) * fy +
        mask[(j + 1) * cols + i + 1] * fx * fy;
      expect(v).toBeCloseTo(LAND, 1);
    }
  });
});
