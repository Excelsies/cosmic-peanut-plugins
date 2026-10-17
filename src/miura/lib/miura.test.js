// @ts-check
import { describe, expect, it } from "vitest";
import {
  applyLocalFold,
  buildIndex,
  fitSheet,
  foldH,
  foldL,
  foldS,
  foldV,
  LAYOUT_T_MAX,
  layoutT,
  rowsFor,
  TILT,
  vertexCount,
  writeLayout,
} from "./miura.js";

const COLS = 9;
const ROWS = 8;

/** @param {Float32Array} p @param {number} a @param {number} b */
function dist(p, a, b) {
  return Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
}

/** Vertex index of grid point (i, j). @param {number} i @param {number} j */
const at = (i, j) => j * (COLS + 1) + i;

describe("Miura-ori layout (Schenk and Guest)", () => {
  for (const t of [0, 0.3, 0.7, 1.1, 1.4]) {
    it(`keeps every crease length and every facet planar at t = ${t}`, () => {
      const pos = new Float32Array(vertexCount(COLS, ROWS) * 3);
      writeLayout(pos, COLS, ROWS, t, 1, 0, t);
      for (let j = 0; j <= ROWS; j++) {
        for (let i = 0; i < COLS; i++) expect(dist(pos, at(i, j), at(i + 1, j))).toBeCloseTo(1, 6); // b
      }
      for (let j = 0; j < ROWS; j++) {
        for (let i = 0; i <= COLS; i++) expect(dist(pos, at(i, j), at(i, j + 1))).toBeCloseTo(1, 6); // a
      }
      for (let j = 0; j < ROWS; j++) {
        for (let i = 0; i < COLS; i++) {
          const o = at(i, j) * 3;
          const e = [at(i + 1, j) * 3, at(i, j + 1) * 3, at(i + 1, j + 1) * 3].map((q) => [
            pos[q] - pos[o],
            pos[q + 1] - pos[o + 1],
            pos[q + 2] - pos[o + 2],
          ]);
          const [u, v, w] = e;
          const triple =
            u[0] * (v[1] * w[2] - v[2] * w[1]) - u[1] * (v[0] * w[2] - v[2] * w[0]) + u[2] * (v[0] * w[1] - v[1] * w[0]);
          expect(Math.abs(triple)).toBeLessThan(1e-5);
        }
      }
    });
  }

  it("is flat at t = 0", () => {
    const pos = new Float32Array(vertexCount(COLS, ROWS) * 3);
    writeLayout(pos, COLS, ROWS, 0, 1, 0, 0);
    for (let v = 0; v < pos.length / 3; v++) expect(pos[v * 3 + 2]).toBe(0);
  });

  it("matches the closed form at t = 0 (S = b sin g, L = a, V = b cos g)", () => {
    expect(foldS(0)).toBeCloseTo(Math.sin(Math.PI / 3), 9);
    expect(foldL(0)).toBeCloseTo(1, 9);
    expect(foldV(0)).toBeCloseTo(0.5, 9);
    expect(foldH(0)).toBe(0);
  });

  it("contracts in both directions as it folds (S and L fall, H rises)", () => {
    for (let t = 0; t < 1.5; t += 0.05) {
      expect(foldS(t + 0.05)).toBeLessThan(foldS(t));
      expect(foldL(t + 0.05)).toBeLessThan(foldL(t));
      expect(foldH(t + 0.05)).toBeGreaterThan(foldH(t));
    }
  });

  it("centres the sheet on the origin plus the offset", () => {
    const pos = new Float32Array(vertexCount(COLS, ROWS) * 3);
    writeLayout(pos, COLS, ROWS, 0.8, 2, 0.5, 0.8);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let v = 0; v < pos.length / 3; v++) {
      x0 = Math.min(x0, pos[v * 3]);
      x1 = Math.max(x1, pos[v * 3]);
      y0 = Math.min(y0, pos[v * 3 + 1]);
      y1 = Math.max(y1, pos[v * 3 + 1]);
      z0 = Math.min(z0, pos[v * 3 + 2]);
      z1 = Math.max(z1, pos[v * 3 + 2]);
    }
    expect((x0 + x1) / 2).toBeCloseTo(0, 5);
    expect((y0 + y1) / 2).toBeCloseTo(0.5, 5);
    expect((z0 + z1) / 2).toBeCloseTo(0, 5);
    expect(x1 - x0).toBeCloseTo(2 * COLS * foldS(0.8), 5);
  });

  it("clamps the in-plane t to [0.05, 1.1] and t_local to [0, 1.45]", () => {
    expect([layoutT(-1), layoutT(0.5), layoutT(5)]).toEqual([0.05, 0.5, LAYOUT_T_MAX]);
    expect(LAYOUT_T_MAX).toBe(1.1);
    const a = new Float32Array(vertexCount(COLS, ROWS) * 3);
    const tl = new Float32Array(vertexCount(COLS, ROWS)).fill(0.6);
    tl[at(3, 1)] = 1.3;
    tl[at(4, 1)] = 9;
    tl[at(5, 1)] = -2;
    writeLayout(a, COLS, ROWS, 0.6, 1, 0, 0.6);
    const zc = foldH(0.6) / 2;
    applyLocalFold(a, COLS, ROWS, tl, 1, zc);
    expect(a[at(3, 1) * 3 + 2]).toBeCloseTo(foldH(1.3) - zc, 6);
    expect(a[at(4, 1) * 3 + 2]).toBeCloseTo(foldH(1.45) - zc, 6);
    expect(a[at(5, 1) * 3 + 2]).toBeCloseTo(-zc, 6);
    expect(a[at(2, 1) * 3 + 2]).toBeCloseTo(foldH(0.6) - zc, 6);
    expect(a[at(3, 2) * 3 + 2]).toBeCloseTo(-zc, 6); // even rows stay in the valley plane
  });

  it("writes into the array it is given and returns it", () => {
    const pos = new Float32Array(vertexCount(COLS, ROWS) * 3);
    expect(writeLayout(pos, COLS, ROWS, 0.5, 1, 0, 0.5)).toBe(pos);
    const tl = new Float32Array(vertexCount(COLS, ROWS)).fill(0.5);
    expect(applyLocalFold(pos, COLS, ROWS, tl, 1, 0)).toBe(pos);
  });

  it("indexes two triangles per facet", () => {
    const idx = buildIndex(COLS, ROWS);
    expect(idx.length).toBe(COLS * ROWS * 6);
    expect(Math.max(...idx)).toBe(vertexCount(COLS, ROWS) - 1);
  });

  it("picks the row count from the pleat preset", () => {
    expect([rowsFor("classic"), rowsFor("fine"), rowsFor("bold")]).toEqual([20, 30, 12]);
  });
});

describe("fitSheet", () => {
  const T = Math.tan(Math.PI / 6);
  const ct = Math.cos(TILT);
  const st = Math.sin(TILT);

  /**
   * Where the camera ray through NDC (sx, sy) meets the tilted sheet's plane z = zMesh (mesh
   * space): the default three camera at z = 5, fov 60, mesh rotated -TILT about x.
   * @param {number} sx @param {number} sy @param {number} aspect @param {number} zMesh
   */
  function hit(sx, sy, aspect, zMesh) {
    // world = (x, y ct + z st, -y st + z ct); ray = (0, 0, 5) + s (sx T aspect, sy T, -1)
    // y: s sy T = y ct + z st; z: 5 - s = -y st + z ct  =>  s = 5 + y st - z ct
    const y = (sy * T * (5 - zMesh * ct) - zMesh * st) / (ct - sy * T * st);
    const s = 5 + y * st - zMesh * ct;
    return [s * sx * T * aspect, y];
  }

  for (const [name, aspect] of [["16:9", 16 / 9], ["4:3", 4 / 3], ["21:9", 21 / 9], ["9:16", 9 / 16], ["1:1", 1]]) {
    for (const pleat of ["classic", "fine", "bold"]) {
      it(`overfills the ${name} window with margin at t0 = ${LAYOUT_T_MAX} (${pleat})`, () => {
        const rows = rowsFor(pleat);
        const fit = fitSheet(aspect, rows, "fill", {});
        expect(fit.cols).toBeLessThanOrEqual(80);
        const S = foldS(LAYOUT_T_MAX), L = foldL(LAYOUT_T_MAX), V = foldV(LAYOUT_T_MAX);
        // The fully covered rectangle (the zig-zag rows leave a V-high fringe at both ends).
        const hw = (fit.k * fit.cols * S) / 2;
        const top = fit.yc + (fit.k * (rows * L - V)) / 2;
        const bot = fit.yc - (fit.k * (rows * L - V)) / 2;
        const relief = fit.k * foldH(1.45);
        for (const z of [-relief, relief]) {
          for (let e = 0; e <= 20; e++) {
            const u = -1 + e / 10;
            for (const [sx, sy] of [[u, 1], [u, -1], [1, u], [-1, u]]) {
              const [x, y] = hit(sx, sy, aspect, z);
              expect(Math.abs(x)).toBeLessThan(hw * 0.97);
              expect(y).toBeLessThan(top - 0.03 * (top - bot));
              expect(y).toBeGreaterThan(bot + 0.03 * (top - bot));
            }
          }
        }
      });
    }
  }

  it("gives about 36 facet columns at 16:9 with the classic pleat", () => {
    const fit = fitSheet(16 / 9, 20, "fill", {});
    expect(fit.cols).toBeGreaterThanOrEqual(32);
    expect(fit.cols).toBeLessThanOrEqual(42);
  });

  it("floats the sheet at 72% of the window width at t0 = 0.35", () => {
    const aspect = 16 / 9;
    const fit = fitSheet(aspect, 20, "float", {});
    const hx = 5 * T * aspect;
    expect(fit.k * fit.cols * foldS(0.35)).toBeCloseTo(0.72 * 2 * hx, 5);
    expect(fit.yc).toBe(0);
  });

  it("describes the visible part of the sheet for the waves", () => {
    const fit = fitSheet(16 / 9, 20, "fill", {});
    expect(fit.visH).toBeGreaterThan(5);
    expect(fit.visW / fit.visH).toBeGreaterThan(16 / 9);
    expect(fit.ybot).toBeLessThan(0);
    expect(fit.ybot + fit.visH).toBeGreaterThan(0);
  });

  it("fills and returns the object it is given", () => {
    const out = {};
    expect(fitSheet(1.5, 20, "fill", out)).toBe(out);
  });
});
