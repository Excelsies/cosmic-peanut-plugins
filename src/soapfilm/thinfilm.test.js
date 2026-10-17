// @ts-check
import { describe, expect, it } from "vitest";
import { ANGLES, buildTable, createTable, H_MAX_NM, LIGHT_KELVIN, TABLE_W } from "./thinfilm.js";

const table = createTable();
buildTable(LIGHT_KELVIN[0], table);

/** Linear RGB at thickness `h` nm on angle row `row` (nearest texel). @param {number} h @param {number} [row] */
function at(h, row = 0) {
  const i = (row * TABLE_W + Math.round((h / H_MAX_NM) * (TABLE_W - 1))) * 3;
  return [table.linear[i], table.linear[i + 1], table.linear[i + 2]];
}

/** @param {number[]} got @param {number[]} want */
function near(got, want, tol = 0.08) {
  for (let c = 0; c < 3; c++) expect(Math.abs(got[c] - want[c]), `channel ${c}: ${got} vs ${want}`).toBeLessThanOrEqual(tol);
}

const lum = (/** @type {number[]} */ c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe("thin-film interference table", () => {
  it("has 512 thickness texels over 0-1400 nm at 0, 30 and 50 degrees", () => {
    expect(TABLE_W).toBe(512);
    expect(H_MAX_NM).toBe(1400);
    expect(ANGLES).toEqual([0, 30, 50]);
    expect(table.linear.length).toBe(TABLE_W * 3 * 3);
    expect(table.bytes.length).toBe(TABLE_W * 3 * 4);
  });

  it("is black at 0 nm: the black film reflects nothing", () => {
    near(at(0), [0, 0, 0], 1e-6);
    expect(table.bytes[0]).toBe(0);
    expect(table.bytes[3]).toBe(255);
  });

  it("matches the reference Michel-Levy colours at normal incidence (6504 K)", () => {
    near(at(100), [0.99, 1.0, 0.96]); // first-order white
    near(at(150), [0.94, 0.57, 0.1]); // gold
    near(at(200), [0.26, 0, 0.36]); // deep magenta / purple
    expect(lum(at(200))).toBeLessThan(0.12);
    const blue = at(250);
    expect(blue[2]).toBeGreaterThan(0.9);
    expect(blue[0]).toBeLessThan(0.1);
    const yg = at(300); // yellow-green
    expect(yg[1]).toBeGreaterThan(yg[2] + 0.3);
    expect(yg[0]).toBeGreaterThan(yg[2]);
    near(at(400), [0.76, 0.01, 0.86]); // magenta
    near(at(500), [0.13, 0.96, 0.13]); // green
    const mag = at(600);
    expect(mag[1]).toBeLessThan(Math.min(mag[0], mag[2]));
    near(at(1200), [0.62, 0.49, 0.5]); // pastel
  });

  it("is normalised so the brightest first-order white has Y = 1, and stays in gamut", () => {
    let maxY = 0;
    for (let i = 0; i < TABLE_W * 3; i++) {
      const c = [table.linear[i * 3], table.linear[i * 3 + 1], table.linear[i * 3 + 2]];
      for (const v of c) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      maxY = Math.max(maxY, lum(c));
    }
    expect(maxY).toBeGreaterThan(0.97);
    expect(maxY).toBeLessThanOrEqual(1.0001);
  });

  it("shifts the hue toward thinner film at oblique incidence, like tilting a real film", () => {
    // At 50 degrees the optical path is shorter, so the 200 nm purple moves up in thickness.
    const row2 = at(200, 2);
    expect(lum(row2)).toBeGreaterThan(lum(at(200, 0)));
  });

  it("encodes gamma 2.2 bytes and rebuilds in place for another light", () => {
    const linear = table.linear;
    const bytes = table.bytes;
    const i = Math.round((150 / H_MAX_NM) * (TABLE_W - 1));
    expect(bytes[i * 4]).toBe(Math.round(255 * linear[i * 3] ** (1 / 2.2)));
    const before = linear[i * 3 + 2];
    buildTable(LIGHT_KELVIN[2], table); // warm 3200 K: less blue
    expect(table.linear).toBe(linear);
    expect(table.bytes).toBe(bytes);
    expect(linear[i * 3 + 2]).toBeLessThan(before);
    buildTable(LIGHT_KELVIN[0], table);
  });

  it("lights are softbox 6504 K, sky 10000 K, warm 3200 K", () => {
    expect(LIGHT_KELVIN).toEqual([6504, 10000, 3200]);
  });
});
