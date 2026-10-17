// @ts-check
import { describe, expect, it } from "vitest";
import {
  BONES,
  BORDER,
  KAYON_BONE,
  MAX_RECORDS,
  RECORD_FLOATS,
  buildCast,
  holeDistance,
  laceCoverage,
  sdfRange,
} from "./puppets.js";

const table = new Float32Array(MAX_RECORDS * RECORD_FLOATS);
const cast = buildCast(table);
/** Identity stage -> bone transforms for every bone (column-major mat3). */
const identity = new Float32Array(BONES * 9);
for (let b = 0; b < BONES; b++) {
  identity[b * 9] = 1;
  identity[b * 9 + 4] = 1;
  identity[b * 9 + 8] = 1;
}
const q = new Float64Array(2);
/** @param {number} slot @param {number} x @param {number} y */
const sdf = (slot, x, y) => sdfRange(table, cast.ranges[slot * 2], cast.ranges[slot * 2 + 1], identity, x, y, q);

describe("buildCast", () => {
  it("fits every silhouette in the 64-record table", () => {
    const end = Math.max(...[0, 1, 2].map((s) => cast.ranges[s * 2] + cast.ranges[s * 2 + 1]));
    expect(end).toBeLessThanOrEqual(MAX_RECORDS);
    expect(cast.ranges[1]).toBeGreaterThanOrEqual(16);
    // The ranges don't overlap: A, then B, then the kayon.
    expect(cast.ranges[2]).toBe(cast.ranges[0] + cast.ranges[1]);
    expect(cast.ranges[4]).toBe(cast.ranges[2] + cast.ranges[3]);
  });

  it("gives each puppet its own two hand-rod records, on its own body bone", () => {
    for (let s = 0; s < 2; s++) {
      for (let k = 0; k < 2; k++) {
        const rec = cast.rods[s * 2 + k];
        expect(rec).toBeGreaterThanOrEqual(cast.ranges[s * 2]);
        expect(rec).toBeLessThan(cast.ranges[s * 2] + cast.ranges[s * 2 + 1]);
        expect(table[rec * RECORD_FLOATS + 7]).toBe(s * 6);
      }
    }
  });
});

describe("puppet silhouette (JS port of sdf.glsl)", () => {
  it("has the head, torso and skirt inside", () => {
    expect(sdf(0, 0.07, 0.71)).toBeLessThan(0);
    expect(sdf(0, 0.005, 0.48)).toBeLessThan(0);
    expect(sdf(0, 0, 0.2)).toBeLessThan(0);
    expect(sdf(0, 0.13, 0.695)).toBeLessThan(0); // the nose
    expect(sdf(0, 0.005, 0.9)).toBeLessThan(0); // the headdress
  });

  it("is outside away from the figure", () => {
    expect(sdf(0, 0.5, 0.5)).toBeGreaterThan(0);
    expect(sdf(0, -0.4, 0.3)).toBeGreaterThan(0);
    expect(sdf(0, 0, 1.1)).toBeGreaterThan(0);
  });

  it("runs its main rod off below the base", () => {
    expect(sdf(0, 0, -0.3)).toBeLessThan(0);
    expect(sdf(0, 0.02, -0.3)).toBeGreaterThan(0);
  });

  it("is the same figure for B (B is mirrored by its bones, not its data)", () => {
    for (const [x, y] of [[0.07, 0.71], [0.5, 0.5], [0, 0.2], [0.13, 0.695]]) {
      const a = sdf(0, x, y);
      const bx = x;
      expect(sdfRange(table, cast.ranges[2], cast.ranges[3], identity, bx, y, q)).toBeCloseTo(a, 6);
    }
  });

  it("is a distance: changes by at most the step between neighbouring points", () => {
    let prev = sdf(0, -0.5, 0.5);
    for (let i = 1; i <= 400; i++) {
      const x = -0.5 + i * 0.0025;
      const d = sdf(0, x, 0.5);
      expect(Math.abs(d - prev)).toBeLessThanOrEqual(0.0025 * 1.001 + 1e-6);
      prev = d;
    }
  });
});

describe("kayon", () => {
  it("is mirror-symmetric", () => {
    for (let i = 0; i < 50; i++) {
      const x = ((i * 37) % 50) / 100;
      const y = ((i * 53) % 110) / 100 - 0.05;
      expect(sdf(2, x, y)).toBeCloseTo(sdf(2, -x, y), 6);
    }
  });

  it("has its leaf body inside and the trunk cut out", () => {
    expect(sdf(2, 0.12, 0.7)).toBeLessThan(0);
    expect(sdf(2, 0.2, 0.25)).toBeLessThan(0);
    expect(sdf(2, 0, 0.3)).toBeGreaterThan(0);
    expect(sdf(2, 0, 0.5)).toBeGreaterThan(0);
    expect(sdf(2, 0, 0.04)).toBeLessThan(0); // the base
    expect(sdf(2, 0, 1.05)).toBeGreaterThan(0); // above the pointed top
    expect(sdf(2, 0.4, 0.5)).toBeGreaterThan(0);
  });

  it("uses its own bone", () => {
    const k = cast.ranges[4];
    expect(table[k * RECORD_FLOATS + 7]).toBe(KAYON_BONE);
  });
});

describe("lace", () => {
  it("punches round holes on the hex lattice", () => {
    const s = 0.03;
    expect(holeDistance(0, 0, s)).toBeLessThan(0);
    expect(holeDistance(s, 0, s)).toBeLessThan(0);
    expect(holeDistance(s / 2, 0, s)).toBeGreaterThan(0);
    expect(holeDistance(0, 0, s)).toBeCloseTo(-0.32 * s, 6);
  });

  // Coverage at a lattice point with the silhouette distance d (bone units), mask px per bone
  // unit ppu and penumbra half-width w px. Spacing 0.03 at 1000 px per unit: hole radius 9.6 px.
  const s = 0.03;
  const ppu = 1000;
  const cov = (/** @type {number} */ d, /** @type {number} */ x, /** @type {number} */ w) => laceCoverage(d, x, 0, s, BORDER, ppu, w);

  it("leaves a solid border band and lets the lamp through holes deep inside", () => {
    expect(cov(-0.1, 0, 0.75)).toBeLessThan(0.05); // a hole centre deep inside
    expect(cov(-BORDER * 0.4, 0, 0.75)).toBeGreaterThan(0.95); // the same hole in the border band
    expect(cov(-0.1, s / 2, 0.75)).toBeGreaterThan(0.95); // between holes
    expect(cov(0.005, 0, 0.75)).toBe(0); // outside
    expect(cov(-0.002, s / 2, 0.75)).toBeGreaterThan(0.95);
  });

  it("dissolves the holes gradually as the penumbra widens", () => {
    // A blurred hole lets through 1 - exp(-2 (R / w)^2) of the lamp at its centre.
    const sharp = cov(-0.1, 0, 0.75);
    const even = cov(-0.1, 0, 9.6);
    const twice = cov(-0.1, 0, 19.2);
    const soft = cov(-0.1, 0, 40);
    expect(even).toBeGreaterThan(sharp + 0.05);
    expect(even).toBeLessThan(0.5);
    expect(twice).toBeGreaterThan(0.5);
    expect(twice).toBeLessThan(0.85);
    expect(soft).toBeGreaterThan(0.9);
  });

  it("drops holes too small to draw without shimmering", () => {
    expect(laceCoverage(-0.1, 0, 0, s, BORDER, 80, 0.75)).toBeGreaterThan(0.95); // 0.8 px holes
  });

  it("is continuous across the border band", () => {
    for (const hx of [0, 0.004, 0.009]) {
      let prev = cov(-0.05, hx, 0.75);
      for (let i = 1; i <= 600; i++) {
        const v = cov(-0.05 + i * 0.0001, hx, 0.75);
        // A step of 0.1 px can move coverage by at most about its share of the 1.5 px edge.
        expect(Math.abs(v - prev)).toBeLessThanOrEqual(0.15);
        prev = v;
      }
    }
  });
});
