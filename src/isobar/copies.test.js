// @ts-check
import { expect, it } from "vitest";
import * as builtin from "../../../builtin/src/lib/flash.js";
import * as mine from "./flash.js";

// Repos can't import from each other, so Isobar carries its own copy of the flash limiter.
it("Isobar's flash limiter is the same code as the tested built-in one", () => {
  expect(Object.keys(mine)).toEqual(Object.keys(builtin));
  expect(String(mine.createFlashLimiter)).toBe(String(builtin.createFlashLimiter));
});
