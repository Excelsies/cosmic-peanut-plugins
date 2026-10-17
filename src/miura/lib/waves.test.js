// @ts-check
import { describe, expect, it } from "vitest";
import { createWaves, MAX_WAVES, WAVE_LIFE, waveOriginX } from "./waves.js";
import { stereoImage } from "./stereo.js";

/** A minimal audio-like record for `onset`. */
const hit = (strength = 1, age = 0, silent = false) => ({ onset: true, onsetStrength: strength, onsetAge: age, silent });

describe("createWaves", () => {
  it("ignores weak onsets, non-onsets and silence", () => {
    const w = createWaves();
    expect(w.onset(hit(0.1), 1, 1, 1, 0, 0)).toBe(false);
    expect(w.onset({ ...hit(1), onset: false }, 1, 1, 1, 0, 0)).toBe(false);
    expect(w.onset(hit(1, 0, true), 1, 1, 1, 0, 0)).toBe(false);
    expect(w.count).toBe(0);
    expect(w.onset(hit(0.5), 1, 1, 1, 0, 0)).toBe(true);
    expect(w.count).toBe(1);
  });

  it("dates a wave from the onset itself (time.now - onsetAge)", () => {
    const w = createWaves();
    w.onset(hit(1, 0.04), 3, 1, 1, 0, 0);
    expect(w.t0[0]).toBeCloseTo(2.96, 6);
  });

  it("scales the amplitude by strength, reactivity and the wave factor", () => {
    const w = createWaves();
    w.onset(hit(0.8), 1, 1.5, 0.5, 0, 0);
    expect(w.amp[0]).toBeCloseTo(0.35 * 0.8 * 1.5 * 0.5, 6);
  });

  it(`keeps ${MAX_WAVES} waves and replaces the oldest`, () => {
    const w = createWaves();
    for (let n = 0; n < MAX_WAVES; n++) w.onset(hit(1), n, 1, 1, 0, n);
    expect(w.count).toBe(MAX_WAVES);
    w.onset(hit(1), 100, 1, 1, 0, 100);
    expect(w.count).toBe(MAX_WAVES);
    expect(Array.from(w.t0)).toContain(100);
    expect(Array.from(w.t0)).not.toContain(0);
    expect(Array.from(w.t0)).toContain(1);
  });

  it("starts left-louder hits on the left, mono hits in the middle at a hashed height", () => {
    expect(waveOriginX(1)).toBeCloseTo(0.05, 6);
    expect(waveOriginX(-1)).toBeCloseTo(0.95, 6);
    expect(waveOriginX(0)).toBe(0.5);
    const w = createWaves();
    w.onset(hit(1), 1, 1, 1, 0.5, 7);
    expect(w.ox[0]).toBeLessThan(0.5);
    w.onset(hit(1), 1, 1, 1, -0.5, 8);
    expect(w.ox[1]).toBeGreaterThan(0.5);
    for (let n = 0; n < 20; n++) {
      w.onset(hit(1), 1, 1, 1, 0, n);
      const last = (w.next + MAX_WAVES - 1) % MAX_WAVES;
      expect(w.ox[last]).toBe(0.5);
      expect(w.oy[last]).toBeGreaterThanOrEqual(0.3);
      expect(w.oy[last]).toBeLessThan(0.7);
    }
  });

  it("gets a zero balance (centred origin) from null or identical channels", () => {
    expect(stereoImage(null, null).balance).toBe(0);
    const x = Float32Array.from({ length: 64 }, (_, i) => Math.sin(i));
    expect(waveOriginX(stereoImage(x, x).balance)).toBe(0.5);
  });

  it("is a Gaussian ring travelling at c and decaying over 1.2 s", () => {
    const w = createWaves();
    w.onset(hit(1), 0, 1, 1, 0, 0); // amp 0.35, origin (0.5, oy)
    const oy = w.oy[0];
    const aspect = 2;
    const now = 1;
    const speed = 1;
    w.prepare(now, speed);
    const c = 0.9 * speed;
    // A point at distance r (in sheet heights) to the right of the origin.
    for (const r of [0, 0.5, 0.85, 0.9, 0.95, 1.3]) {
      const u = 0.5 + r / aspect;
      const want = 0.35 * Math.exp(-(((r - c * now) / 0.08) ** 2)) * Math.exp(-now / 1.2);
      expect(w.at(u, oy, aspect)).toBeCloseTo(want, 6);
    }
  });

  it(`skips waves older than ${WAVE_LIFE} s and ones dated in the future`, () => {
    const w = createWaves();
    w.onset(hit(1), 0, 1, 1, 0, 0);
    w.prepare(WAVE_LIFE + 0.01, 1);
    expect(w.active).toBe(0);
    w.prepare(-0.5, 1);
    expect(w.active).toBe(0);
    w.prepare(1, 1);
    expect(w.active).toBe(1);
  });

  it("gives the same field at 60 and 120 Hz (analytic in time)", () => {
    /** @param {number} hz */
    function run(hz) {
      const w = createWaves();
      const dt = 1 / hz;
      let fired = 0;
      // Onsets at 0.3 s and 1.1 s, detected on the first frame at or after them.
      for (let f = 0; f * dt <= 1.6 + 1e-9; f++) {
        const now = f * dt;
        for (const [n, at] of [[0, 0.3], [1, 1.1]]) {
          if (fired === n && now >= at - 1e-9) {
            w.onset(hit(0.9, now - at), now, 1, 1, 0.2, n);
            fired++;
          }
        }
      }
      w.prepare(1.6, 1);
      const out = [];
      for (let u = 0; u <= 1; u += 0.1) for (let v = 0; v <= 1; v += 0.25) out.push(w.at(u, v, 1.8));
      return out;
    }
    const a = run(60);
    const b = run(120);
    expect(a.some((x) => x > 1e-3)).toBe(true);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 5);
  });
});
