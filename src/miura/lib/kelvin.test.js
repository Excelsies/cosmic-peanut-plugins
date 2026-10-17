// @ts-check
import { expect, it } from "vitest";
import { kelvin } from "./kelvin.js";

it("warms to orange at 3000 K and cools to blue-white at 7000 K", () => {
  const warm = kelvin(3000, new Float32Array(3));
  const cool = kelvin(7000, new Float32Array(3));
  expect(warm[0]).toBe(1);
  expect(warm[2]).toBeLessThan(0.75);
  expect(cool[2]).toBe(1);
  expect(cool[0]).toBeLessThan(0.98);
});

it("raises blue and lowers red monotonically with temperature", () => {
  const out = new Float32Array(3);
  let r = Infinity;
  let b = -Infinity;
  for (let t = 1500; t <= 12000; t += 50) {
    kelvin(t, out);
    expect(out[0]).toBeLessThanOrEqual(r);
    expect(out[2]).toBeGreaterThanOrEqual(b);
    for (const c of out) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
    r = out[0];
    b = out[2];
  }
  expect(kelvin(12000, out)[0]).toBeLessThan(0.8);
  expect(kelvin(1500, out)[2]).toBe(0);
});

it("writes into and returns the array it is given", () => {
  const out = [0, 0, 0];
  expect(kelvin(5000, out)).toBe(out);
});
