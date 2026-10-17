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
  laceDistance,
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

  it("leaves a solid border band and holes only deep inside", () => {
    const s = 0.03;
    // At a hole centre deep inside: a hole (positive).
    expect(laceDistance(-0.1, 0, 0, s, 1, BORDER)).toBeGreaterThan(0);
    // The same hole within the border band stays solid.
    expect(laceDistance(-BORDER * 0.4, 0, 0, s, 1, BORDER)).toBeLessThan(0);
    // Between holes deep inside: solid.
    expect(laceDistance(-0.1, s / 2, 0, s, 1, BORDER)).toBeLessThan(0);
    // Outside stays outside.
    expect(laceDistance(0.01, 0, 0, s, 1, BORDER)).toBeCloseTo(0.01, 9);
  });

  it("dissolves the holes into solid shadow as they fade out", () => {
    const s = 0.03;
    expect(laceDistance(-0.1, 0, 0, s, 0, BORDER)).toBeLessThanOrEqual(-0.32 * s * 0.99);
    // Faded out, the interior sits at least two penumbra widths deep, so a blurred shadow stays dark.
    expect(laceDistance(-0.1, 0, 0, s, 0, BORDER, 0.02)).toBeLessThanOrEqual(-0.04);
    // Halfway: smaller holes.
    const half = laceDistance(-0.1, 0.2 * s, 0, s, 0.5, BORDER);
    const full = laceDistance(-0.1, 0.2 * s, 0, s, 1, BORDER);
    expect(half).toBeLessThan(full);
  });

  it("is continuous across the border band", () => {
    const s = 0.03;
    for (const hx of [0, 0.004, 0.009]) {
      let prev = laceDistance(-0.05, hx, 0, s, 1, BORDER);
      for (let i = 1; i <= 600; i++) {
        const d = -0.05 + i * 0.0001;
        const v = laceDistance(d, hx, 0, s, 1, BORDER);
        expect(Math.abs(v - prev)).toBeLessThanOrEqual(0.0001 + 1e-9);
        prev = v;
      }
    }
  });
});
