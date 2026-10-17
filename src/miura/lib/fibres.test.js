// @ts-check
import { expect, it } from "vitest";
import { FIBRE_SIZE, writeFibres } from "./fibres.js";

it("paints grey paper between 0.92 and 1 with darker long fibres, the same every time", () => {
  const a = writeFibres(new Uint8Array(FIBRE_SIZE * FIBRE_SIZE * 4));
  const b = writeFibres(new Uint8Array(FIBRE_SIZE * FIBRE_SIZE * 4));
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  expect(diff).toBe(0);
  let dark = 0;
  let bad = 0;
  let min = 255;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== a[i + 1] || a[i] !== a[i + 2] || a[i + 3] !== 255) bad++;
    min = Math.min(min, a[i]);
    if (a[i] < 0.965 * 255) dark++;
  }
  expect(bad).toBe(0);
  expect(min).toBeGreaterThanOrEqual(Math.floor(0.92 * 255));
  const share = dark / (FIBRE_SIZE * FIBRE_SIZE);
  expect(share).toBeGreaterThan(0.02); // visible fibres
  expect(share).toBeLessThan(0.25); // but mostly plain paper
});

it("writes into and returns the array it is given", () => {
  const px = new Uint8Array(FIBRE_SIZE * FIBRE_SIZE * 4);
  expect(writeFibres(px)).toBe(px);
});
