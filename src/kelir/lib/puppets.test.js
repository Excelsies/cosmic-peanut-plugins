// @ts-check
import { describe, expect, it } from "vitest";
import {
  BONES,
  BONES_PER,
  BORDER,
  CURL,
  KAYON_BONE,
  MAX_RECORDS,
  RECORD_FLOATS,
  boneBase,
  buildCast,
  holeDistance,
  POLY,
  putPolygon,
  sdPolygon,
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
const q = new Float64Array(3);
/** @param {number} slot @param {number} x @param {number} y */
const sdf = (slot, x, y) => sdfRange(table, cast.ranges[slot * 2], cast.ranges[slot * 2 + 1], identity, boneBase(slot), x, y, q);

describe("buildCast", () => {
  it("fits every silhouette in the 64-record table", () => {
    const end = Math.max(...[0, 1, 2].map((s) => cast.ranges[s * 2] + cast.ranges[s * 2 + 1]));
    expect(end).toBeLessThanOrEqual(MAX_RECORDS);
    expect(cast.ranges[1]).toBeGreaterThanOrEqual(16);
    expect(cast.ranges[3]).toBe(cast.ranges[1]);
    // The kayon comes after both puppets.
    expect(cast.ranges[4]).toBeGreaterThanOrEqual(cast.ranges[2] + cast.ranges[3]);
  });

  it("shares one figure between A and B: their ranges differ only in the hand rods", () => {
    // A = [A's rods, figure], B = [figure, B's rods]: B starts after A's two hand rods.
    expect(cast.ranges[2]).toBe(cast.ranges[0] + 2);
    // Room for a detailed figure: at least 30 records each.
    expect(cast.ranges[1]).toBeGreaterThanOrEqual(30);
  });

  it("gives each puppet its own two hand-rod records, on its body bone, outside the other's range", () => {
    for (let s = 0; s < 2; s++) {
      const other = 1 - s;
      for (let k = 0; k < 2; k++) {
        const rec = cast.rods[s * 2 + k];
        expect(rec).toBeGreaterThanOrEqual(cast.ranges[s * 2]);
        expect(rec).toBeLessThan(cast.ranges[s * 2] + cast.ranges[s * 2 + 1]);
        const inOther = rec >= cast.ranges[other * 2] && rec < cast.ranges[other * 2] + cast.ranges[other * 2 + 1];
        expect(inOther).toBe(false);
        expect(table[rec * RECORD_FLOATS + 7]).toBe(0);
      }
    }
  });

  it("stores bone indices local to the silhouette (0..5), offset per silhouette by boneBase", () => {
    for (let i = 0; i < cast.ranges[4] + cast.ranges[5]; i++) {
      const b = table[i * RECORD_FLOATS + 7];
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(BONES_PER);
    }
    expect([0, 1, 2].map(boneBase)).toEqual([0, BONES_PER, KAYON_BONE]);
  });
});

describe("puppet silhouette (JS port of sdf.glsl)", () => {
  it("has the head, torso and skirt inside", () => {
    expect(sdf(0, 0.07, 0.71)).toBeLessThan(0);
    expect(sdf(0, 0.005, 0.48)).toBeLessThan(0);
    expect(sdf(0, 0, 0.24)).toBeLessThan(0);
    expect(sdf(0, 0.13, 0.695)).toBeLessThan(0); // the nose
    expect(sdf(0, 0.01, 0.86)).toBeLessThan(0); // the crown
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
      expect(sdfRange(table, cast.ranges[2], cast.ranges[3], identity, boneBase(1), bx, y, q)).toBeCloseTo(a, 6);
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

describe("puppet figure detail", () => {
  it("draws the face in profile: forehead, nose tip and chin inside, a notch under the nose", () => {
    expect(sdf(0, 0.075, 0.75)).toBeLessThan(0); // forehead
    expect(sdf(0, 0.155, 0.693)).toBeLessThan(0); // nose tip
    expect(sdf(0, 0.09, 0.667)).toBeLessThan(0); // chin
    expect(sdf(0, 0.128, 0.684)).toBeGreaterThan(0); // under the nose, ahead of the lips
    expect(sdf(0, 0.2, 0.7)).toBeGreaterThan(0);
  });

  it("cuts an almond eye out of the face", () => {
    expect(sdf(0, 0.098, 0.734)).toBeGreaterThan(0);
    expect(sdf(0, 0.098, 0.718)).toBeLessThan(0);
  });

  it("raises the crown to a top behind the forehead, a ring on the ornament behind", () => {
    // The highest point of the figure is behind the forehead, and nothing reaches past y = 0.99.
    let top = -1;
    let topX = 0;
    for (let i = 0; i <= 200; i++) {
      for (let j = 0; j <= 120; j++) {
        const x = -0.2 + i * 0.002;
        const y = 0.76 + j * 0.002;
        if (y > top && sdf(0, x, y) < 0) {
          top = y;
          topX = x;
        }
      }
    }
    expect(top).toBeGreaterThan(0.92);
    expect(top).toBeLessThan(0.99);
    expect(topX).toBeLessThan(0.03);
    // The ring: open at its centre, solid around it.
    expect(sdf(0, CURL[0], CURL[1])).toBeGreaterThan(0);
    expect(sdf(0, CURL[0] + 0.01, CURL[1])).toBeLessThan(0);
    expect(sdf(0, CURL[0] - 0.01, CURL[1])).toBeLessThan(0);
  });

  it("flags the face, neck and limbs solid and laces the garment", () => {
    sdf(0, 0.09, 0.715); // cheek
    expect(q[2]).toBe(1);
    sdf(0, 0.03, 0.62); // neck
    expect(q[2]).toBe(1);
    sdf(0, 0.005, 0.48); // torso
    expect(q[2]).toBe(0);
    sdf(0, 0, 0.27); // kain
    expect(q[2]).toBe(0);
    sdf(0, 0.02, 0.86); // crown
    expect(q[2]).toBe(0);
  });

  it("sets the belt off with two slits between the torso and the kain", () => {
    expect(sdf(0, 0, 0.406)).toBeGreaterThan(0);
    expect(sdf(0, 0, 0.38)).toBeGreaterThan(0);
    expect(sdf(0, 0, 0.393)).toBeLessThan(0);
  });
});

describe("polygon primitive", () => {
  // An L shape (concave), counter-clockwise.
  const L = [0, 0, 2, 0, 2, 1, 1, 1, 1, 2, 0, 2];
  const t = new Float32Array(MAX_RECORDS * RECORD_FLOATS);
  const end = putPolygon(t, 3, L, 0, 2);
  const one = new Float32Array(9).fill(0);
  one[0] = 1;
  one[4] = 1;
  one[8] = 1;
  const ids = new Float32Array(BONES * 9);
  for (let b = 0; b < BONES; b++) ids.set(one, b * 9);
  const pq = new Float64Array(3);

  it("packs a header and four vertices per record", () => {
    expect(end).toBe(3 + 1 + 2); // 6 vertices: header + 2 records
    expect(t[3 * RECORD_FLOATS + 6]).toBe(POLY);
    expect(t[3 * RECORD_FLOATS + 7]).toBe(2);
    expect(t[3 * RECORD_FLOATS + 4]).toBe(6);
    // The header's bounding box: centre and half-size.
    expect([0, 1, 2, 3].map((k) => t[3 * RECORD_FLOATS + k])).toEqual([1, 1, expect.closeTo(1, 4), expect.closeTo(1, 4)]);
  });

  it("is the exact signed distance to a concave polygon", () => {
    expect(sdPolygon(0.5, 0.5, t, 4, 6)).toBeCloseTo(-0.5, 6);
    expect(sdPolygon(1.5, 1.5, t, 4, 6)).toBeCloseTo(0.5, 6); // in the notch
    expect(sdPolygon(1.2, 1.2, t, 4, 6)).toBeCloseTo(0.2, 6);
    expect(sdPolygon(3, 0.5, t, 4, 6)).toBeCloseTo(1, 6);
    expect(sdPolygon(1.5, 0.9, t, 4, 6)).toBeCloseTo(-0.1, 6);
    expect(sdPolygon(-1, -1, t, 4, 6)).toBeCloseTo(Math.SQRT2, 6);
  });

  it("evaluates in a range like any other primitive, skipping its vertex records", () => {
    const after = putPolygon(t, end, [5, 5, 6, 5, 6, 6], 0, 0); // a triangle after the L
    expect(sdfRange(t, 3, after - 3, ids, 0, 0.5, 0.5, pq)).toBeCloseTo(-0.5, 6);
    expect(sdfRange(t, 3, after - 3, ids, 0, 5.9, 5.5, pq)).toBeLessThan(0);
    expect(sdfRange(t, 3, after - 3, ids, 0, 3.5, 3.5, pq)).toBeCloseTo(Math.hypot(1.5, 1.5), 5);
  });

  it("starts from a cutoff: exact below it, the cutoff beyond it", () => {
    const after = putPolygon(t, end, [5, 5, 6, 5, 6, 6], 0, 0);
    expect(sdfRange(t, 3, after - 3, ids, 0, 2.05, 0.5, pq, 0.1)).toBeCloseTo(0.05, 6);
    expect(sdfRange(t, 3, after - 3, ids, 0, 0.5, 0.5, pq, 0.1)).toBeCloseTo(-0.5, 6);
    expect(sdfRange(t, 3, after - 3, ids, 0, 3.5, 3.5, pq, 0.1)).toBe(0.1); // nothing nearer: the cutoff
  });

  it("rejects more vertices than a polygon may have", () => {
    expect(() => putPolygon(t, 0, new Array(2 * 33).fill(0), 0, 0)).toThrow();
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
    expect(boneBase(2) + table[k * RECORD_FLOATS + 7]).toBe(KAYON_BONE);
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
  const cov = (/** @type {number} */ d, /** @type {number} */ x, /** @type {number} */ w) => laceCoverage(d, x, 0, s, BORDER, ppu, w, 0);

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
    expect(laceCoverage(-0.1, 0, 0, s, BORDER, 80, 0.75, 0)).toBeGreaterThan(0.95); // 0.8 px holes
  });

  it("leaves solid primitives unpierced", () => {
    expect(laceCoverage(-0.1, 0, 0, s, BORDER, ppu, 0.75, 1)).toBeGreaterThan(0.99);
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
