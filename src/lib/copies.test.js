// @ts-check
import { expect, it } from "vitest";
import * as builtin from "../../../builtin/src/lib/flash.js";
import * as fieldwork from "./flash.js";

// Repos can't import from each other, so Fieldwork carries its own copy of the limiter.
it("Fieldwork's flash limiter is the same code as the tested built-in one", () => {
  expect(Object.keys(fieldwork)).toEqual(Object.keys(builtin));
  expect(String(fieldwork.createFlashLimiter)).toBe(String(builtin.createFlashLimiter));
});
