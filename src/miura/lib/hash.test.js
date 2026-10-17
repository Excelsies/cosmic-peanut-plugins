// @ts-check
import { expect, it } from "vitest";
import { hash01 } from "./hash.js";

it("hashes integers deterministically into [0, 1)", () => {
  let sum = 0;
  for (let n = 0; n < 1000; n++) {
    const h = hash01(n);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(1);
    expect(hash01(n)).toBe(h);
    sum += h;
  }
  expect(sum / 1000).toBeGreaterThan(0.4);
  expect(sum / 1000).toBeLessThan(0.6);
  expect(hash01(1)).not.toBe(hash01(2));
});
