// @ts-check
import { describe, expect, it } from "vitest";
import { stereoBalance } from "./stereo.js";

const N = 2048;
/** @param {number} gl @param {number} gr */
function pair(gl, gr) {
  const l = new Float32Array(N);
  const r = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const s = Math.sin(i * 0.05);
    l[i] = gl * s;
    r[i] = gr * s;
  }
  return [l, r];
}

describe("stereoBalance", () => {
  it("is 0 without stereo data", () => {
    expect(stereoBalance(null, null)).toBe(0);
    expect(stereoBalance(new Float32Array(N), null)).toBe(0);
  });

  it("is exactly 0 for bit-identical channels and for silence", () => {
    const [l] = pair(0.5, 0.5);
    expect(stereoBalance(l, l.slice())).toBe(0);
    expect(stereoBalance(new Float32Array(N), new Float32Array(N))).toBe(0);
  });

  it("is positive when the right channel is louder, negative for the left, within -1..1", () => {
    const [l, r] = pair(0.2, 0.6);
    const b = stereoBalance(l, r);
    expect(b).toBeCloseTo(0.5, 5);
    expect(stereoBalance(r, l)).toBeCloseTo(-0.5, 5);
    const [ll, rr] = pair(1, 0);
    expect(stereoBalance(ll, rr)).toBe(-1);
  });
});
