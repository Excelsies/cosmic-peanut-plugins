// @ts-check
import { expect, it } from "vitest";
import * as builtin from "../../../builtin/src/lib/flash.js";
import * as gl from "../../../builtin/src/lib/gl.js";
import * as mine from "./flash.js";
import * as myGl from "./gl.js";

// Repos can't import from each other, so Fieldwork carries its own copies of the shared helpers.
it("Fieldwork's flash limiter is the same code as the tested built-in one", () => {
  expect(Object.keys(mine)).toEqual(Object.keys(builtin));
  expect(String(mine.createFlashLimiter)).toBe(String(builtin.createFlashLimiter));
});

it("Fieldwork's GL helpers are the same code as the built-in ones", () => {
  expect(Object.keys(myGl)).toEqual(Object.keys(gl));
  expect(String(myGl.createProgram)).toBe(String(gl.createProgram));
  expect(String(myGl.createTarget)).toBe(String(gl.createTarget));
});
