// @ts-check
import { describe, expect, it } from "vitest";
import { createDrive } from "./drive.js";
import { createParams, resolveParams } from "./soapfilm-params.js";

const defaults = { backdrop: "velvet", light: "softbox", thickness: 1, swirl: 1, drainage: 1, redip: "16 bars", reactivity: 1 };

function audio() {
  return {
    bassAtt: 1, midAtt: 1, trebAtt: 1, rms: 0.1, flux: 0, centroid: 0.1, silent: false,
    /** @type {Float32Array | null} */ left: null,
    /** @type {Float32Array | null} */ right: null,
  };
}

/** Times (s) at which a value rises by `threshold` from its last low (WCAG-style flash count). @param {number[]} v @param {number} dt @param {number} threshold */
function flashStarts(v, dt, threshold) {
  const starts = [];
  let rising = false;
  let lo = v[0];
  let hi = v[0];
  for (let i = 1; i < v.length; i++) {
    if (!rising) {
      lo = Math.min(lo, v[i]);
      if (v[i] - lo >= threshold) {
        starts.push(i * dt);
        rising = true;
        hi = v[i];
      }
    } else {
      hi = Math.max(hi, v[i]);
      if (hi - v[i] >= threshold) {
        rising = false;
        lo = v[i];
      }
    }
  }
  return starts;
}

/** @param {number[]} starts */
function maxPerSecond(starts) {
  let best = 0;
  for (let i = 0; i < starts.length; i++) {
    let n = 0;
    for (let j = i; j < starts.length && starts[j] - starts[i] < 1; j++) n++;
    best = Math.max(best, n);
  }
  return best;
}

/**
 * Run the drive over `seconds` at `hz` with `signal(t, a)` shaping the audio; sample `pick` at
 * each whole tenth of a second.
 * @param {number} hz @param {(t: number, a: ReturnType<typeof audio>) => void} signal
 * @param {(d: ReturnType<typeof createDrive>) => number} pick
 */
function sampled(hz, signal, pick, { seconds = 3, reduceFlashing = true, reduceMotion = false } = {}) {
  const d = createDrive();
  const p = resolveParams(defaults, reduceMotion, createParams());
  const a = audio();
  const out = [];
  const per = hz / 10;
  for (let n = 1; n <= seconds * hz; n++) {
    const t = n / hz;
    signal(t, a);
    d.step(a, 1 / hz, p, reduceFlashing);
    if (n % per === 0) out.push(pick(d));
  }
  return out;
}

describe("drive envelopes", () => {
  const step = (/** @type {number} */ t, /** @type {ReturnType<typeof audio>} */ a) => {
    const on = t > 0.5 && t <= 1.5;
    a.bassAtt = on ? 2.2 : 1;
    a.midAtt = on ? 1.4 : 0.8;
    a.rms = on ? 0.3 : 0.1;
    a.flux = on ? 0.5 : 0;
    a.trebAtt = on ? 2 : 1;
    a.centroid = on ? 0.3 : 0.05;
  };

  it("are identical at 60 and 120 Hz", () => {
    /** @type {((d: ReturnType<typeof createDrive>) => number)[]} */
    const picks = [(d) => d.bassAmt, (d) => d.m, (d) => d.swirlAmp, (d) => d.shimmerAmp, (d) => d.angle];
    for (const pick of picks) {
      const a = sampled(60, step, pick, { reduceFlashing: false });
      const b = sampled(120, step, pick, { reduceFlashing: false });
      for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 5);
    }
  });

  it("bass slides the membrane by at most 0.12 x reactivity, with a fast attack and slow release", () => {
    const v = sampled(60, step, (d) => d.bassAmt);
    expect(Math.max(...v)).toBeLessThanOrEqual(0.12 + 1e-9);
    expect(v[6]).toBeGreaterThan(0.05); // 0.1 s after the bass came in
    expect(v[15]).toBeGreaterThan(0.01); // still releasing 0.1 s after it stopped
    expect(v[29]).toBeLessThan(0.005);
  });

  it("caps a 10 Hz bass strobe at 3 rises per second under Reduce flashing", () => {
    const hz = 60;
    for (const rf of [true, false]) {
      const d = createDrive();
      const p = resolveParams(defaults, false, createParams());
      const a = audio();
      const v = [];
      for (let n = 1; n <= 4 * hz; n++) {
        a.bassAtt = Math.floor((n / hz) * 20) % 2 === 0 ? 2.5 : 0.5;
        d.step(a, 1 / hz, p, rf);
        v.push(d.bassAmt / 0.12);
      }
      const starts = flashStarts(v, 1 / hz, 0.1);
      if (rf) {
        expect(starts.length).toBeGreaterThan(3);
        expect(maxPerSecond(starts)).toBeLessThanOrEqual(3);
      } else {
        expect(maxPerSecond(starts)).toBeGreaterThan(3);
      }
    }
  });

  it("stirs eddies when loud relative to the last 20 s, laminar when quiet", () => {
    const loud = sampled(60, (t, a) => {
      a.rms = t < 10 ? 0.05 : 0.2;
      a.flux = t < 10 ? 0 : 0.6;
    }, (d) => d.swirlAmp, { seconds: 12 });
    expect(loud[95]).toBeLessThan(0.04);
    expect(loud[119]).toBeGreaterThan(0.08);
  });

  it("tilts the angle of incidence with the spectral centroid", () => {
    const v = sampled(60, (t, a) => {
      a.centroid = t < 5 ? 0 : 0.5;
    }, (d) => d.angle, { seconds: 15 });
    expect(v[48]).toBeCloseTo(5, 1);
    expect(v[149]).toBeCloseTo(45, 1);
  });

  it("falls calm in silence: no membrane, no shimmer, swirl at its floor", () => {
    const v = sampled(60, (t, a) => {
      a.silent = t > 1;
      a.bassAtt = t > 1 ? 0 : 2;
      a.trebAtt = t > 1 ? 0 : 2.5;
      a.rms = t > 1 ? 0 : 0.2;
      a.flux = t > 1 ? 0 : 0.5;
    }, (d) => d.bassAmt + d.shimmerAmp + (d.swirlAmp - 0.01) * 100, { seconds: 8 });
    expect(v[5]).toBeGreaterThan(0.1);
    expect(v[79]).toBeLessThan(0.01);
  });

  it("tilts with the stereo balance, exactly 0 for mono or identical channels", () => {
    const d = createDrive();
    const p = resolveParams(defaults, false, createParams());
    const a = audio();
    const l = new Float32Array(256).fill(0.3);
    for (let i = 0; i < 120; i++) d.step(a, 1 / 60, p, true);
    expect(d.tilt).toBe(0);
    a.left = l;
    a.right = l.slice();
    for (let i = 0; i < 120; i++) d.step(a, 1 / 60, p, true);
    expect(d.tilt).toBe(0);
    a.right = new Float32Array(256).fill(0.1); // left louder
    for (let i = 0; i < 120; i++) d.step(a, 1 / 60, p, true);
    expect(d.tilt).toBeGreaterThan(0);
    expect(d.tilt).toBeLessThanOrEqual((4 * Math.PI) / 180);
    const rm = resolveParams(defaults, true, createParams());
    d.step(a, 1 / 60, rm, true);
    expect(d.tilt).toBe(0);
  });

  it("moves the shimmer at 6 Hz, or at most 3 Hz under Reduce flashing", () => {
    const fast = sampled(60, () => {}, (d) => d.shimmerPhase, { seconds: 1, reduceFlashing: false });
    const slow = sampled(60, () => {}, (d) => d.shimmerPhase, { seconds: 1, reduceFlashing: true });
    expect(fast[9]).toBeCloseTo(6, 6);
    expect(slow[9]).toBeCloseTo(3, 6);
  });
});
