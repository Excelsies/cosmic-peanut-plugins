// @ts-check
import { describe, expect, it } from "vitest";
import { stepEnvelope } from "./envelope.js";

/** @param {number} hz @param {number} seconds @param {number} target @param {number} from */
function run(hz, seconds, target, from, attack = 0.08, release = 0.6) {
  let v = from;
  for (let i = 0; i < Math.round(seconds * hz); i++) v = stepEnvelope(v, target, 1 / hz, attack, release);
  return v;
}

describe("stepEnvelope", () => {
  it("rises with the attack time constant (80 ms → 63%)", () => {
    expect(run(100, 0.08, 1, 0)).toBeCloseTo(1 - Math.exp(-1), 6);
  });

  it("falls with the release time constant (600 ms → 37%)", () => {
    expect(run(120, 0.6, 0, 1)).toBeCloseTo(Math.exp(-1), 6);
  });

  it("is frame-rate independent", () => {
    for (const [target, from] of [[1, 0], [0, 1], [0.4, 0.9]]) {
      expect(run(60, 0.5, target, from)).toBeCloseTo(run(120, 0.5, target, from), 9);
      expect(run(30, 0.5, target, from)).toBeCloseTo(run(144, 0.5, target, from), 2);
    }
  });

  it("holds for dt 0", () => {
    expect(stepEnvelope(0.3, 1, 0, 0.08, 0.6)).toBe(0.3);
  });
});
