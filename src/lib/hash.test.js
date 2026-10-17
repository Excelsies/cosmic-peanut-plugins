// @ts-check
import { expect, it } from "vitest";
import { hash01 } from "./hash.js";

it("hash01 is deterministic, in [0, 1) and spread out", () => {
  let sum = 0;
  for (let i = 0; i < 1000; i++) {
    const h = hash01(i);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(1);
    expect(hash01(i)).toBe(h);
    sum += h;
  }
  expect(sum / 1000).toBeGreaterThan(0.45);
  expect(sum / 1000).toBeLessThan(0.55);
  expect(hash01(1)).not.toBe(hash01(2));
});
