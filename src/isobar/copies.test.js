// @ts-check
// @ts-expect-error -- a Node builtin (tests run in Node); the web tsconfig has no @types/node.
import { createHash } from "node:crypto";
// @ts-expect-error -- a Node builtin (tests run in Node); the web tsconfig has no @types/node.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import * as builtin from "../../../builtin/src/lib/flash.js";
import * as mine from "./flash.js";

// Repos can't import from each other, so Isobar carries its own copy of the flash limiter.
it("Isobar's flash limiter is the same code as the tested built-in one", () => {
  expect(Object.keys(mine)).toEqual(Object.keys(builtin));
  expect(String(mine.createFlashLimiter)).toBe(String(builtin.createFlashLimiter));
});

/**
 * Isobar was built beside the first Fieldwork batch, so it carries byte-for-byte copies of that
 * batch's shared helpers (branch viz/own, plugins/fieldwork/src/lib/<name>.js). The merge swaps
 * each copy for the lib file and points the imports at ../lib/; these digests (sha256 of the
 * viz/own files) keep the copies from drifting until then.
 */
const VIZ_OWN_LIB = {
  "beatclock.js": "18d0b0f8bd1137e2838f4e00436070ea1b9c5abc5ce58cc45e7b0409d59e55c4",
  "flash.js": "26ec83db834ba297bbe98b398b364d1d8bef1a1347923cb76a907ad9ab78aae6",
  "hash.js": "555ec674e6a43ed7a8602b61dc583d3b02a50d3d37e0470caf4fabc6501f3c92",
  "stereo.js": "12148e9af2feaf9108fbeecc1e789d48c2a931da9f4f3f751bee0b239d73a303",
};

it("Isobar's helper copies are byte-for-byte the first batch's lib files", () => {
  for (const [name, digest] of Object.entries(VIZ_OWN_LIB)) {
    const src = readFileSync(new URL(`./${name}`, import.meta.url));
    expect(createHash("sha256").update(src).digest("hex"), name).toBe(digest);
  }
});
