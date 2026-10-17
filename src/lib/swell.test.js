// @ts-check
import { describe, expect, it } from "vitest";
import { hash01 } from "./hash.js";
import { ATTACK, ATTACK_REDUCED, createSwell, DOT_BOOST, RELEASE, SILENT_SWELL } from "./swell.js";

const DT = 1 / 60;

/** Flash times (rise ≥ threshold after a fall ≥ threshold), as in builtin flash.test.js. @param {number[]} values @param {number} threshold */
function flashStarts(values, threshold) {
  /** @type {number[]} */
  const starts = [];
  let rising = false;
  let lo = values[0];
  let hi = values[0];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (!rising) {
      if (v < lo) lo = v;
      if (v - lo >= threshold) {
        starts.push(i * DT);
        rising = true;
        hi = v;
      }
    } else {
      hi = Math.max(hi, v);
      if (hi - v >= threshold) {
        rising = false;
        lo = v;
      }
    }
  }
  return starts;
}

/** Most flashes in any 1 s window. @param {number[]} starts */
function maxPerSecond(starts) {
  let best = 0;
  for (let i = 0; i < starts.length; i++) {
    let n = 0;
    for (let j = i; j < starts.length && starts[j] - starts[i] < 1; j++) n++;
    best = Math.max(best, n);
  }
  return best;
}

const C_MAJOR = new Float32Array([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]);
const NONE = new Float32Array(12);

/** Total ink proxy: what the swell does to the poster's mean coverage. @param {ReturnType<typeof createSwell>} s */
function ink(s) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += s.swell[i] + s.dot[i];
  return sum / 12;
}

/** A 10 Hz chord-stab train (50 ms on, 50 ms off) with an onset on each stab. @param {boolean} reduce */
function stabs(reduce) {
  const s = createSwell();
  const out = [];
  for (let i = 0; i < 4 * 60; i++) {
    const t = i * DT;
    const on = Math.floor(t * 20) % 2 === 0;
    const onset = on && Math.floor((t - DT) * 20) % 2 !== 0;
    s.step(on ? C_MAJOR : NONE, false, onset, DT, 2, reduce);
    out.push(ink(s));
  }
  return out;
}


/** Pitch classes of a I–IV–V–vi progression in C. */
const PROGRESSION = [[0, 4, 7], [5, 9, 0], [7, 11, 2], [9, 0, 4]];

/**
 * Chord changes every 0.5 s with flickering note weights, a little leakage and jittery frame
 * times (60 Hz ± 30%), for 20 s. Returns the largest one-frame change in any shape's scale
 * (0.55 + 0.45 × swell, as poster.js draws it) and the largest one-frame rise of the gain.
 * @param {boolean} reduce
 */
function largestScaleStep(reduce) {
  const s = createSwell();
  const c = new Float32Array(12);
  const prev = new Float32Array(12).fill(0.55);
  let t = 0;
  let worst = 0;
  let gainRise = 0;
  let gain = 1;
  for (let f = 0; f < 20 * 60; f++) {
    const dt = (1 + 0.6 * (hash01(f * 7 + 1) - 0.5)) / 60;
    t += dt;
    const k = Math.floor(t / 0.5);
    const chord = PROGRESSION[k % 4];
    // Real chroma flickers frame to frame: leakage and the chord's weaker notes jitter.
    for (let i = 0; i < 12; i++) c[i] = 0.08 * hash01(f * 31 + i);
    chord.forEach((pc, j) => { c[pc] = j === 0 ? 1 : 0.6 + 0.3 * hash01(f * 13 + j); });
    s.step(c, false, k !== Math.floor((t - dt) / 0.5), dt, 1, reduce);
    for (let i = 0; i < 12; i++) {
      const scale = 0.55 + 0.45 * s.swell[i];
      if (f > 0) worst = Math.max(worst, Math.abs(scale - prev[i]));
      prev[i] = scale;
    }
    gainRise = Math.max(gainRise, s.gain - gain);
    gain = s.gain;
  }
  return { worst, gainRise };
}

describe("createSwell", () => {
  it("swells a pitch class towards chroma² × reactivity with 80 ms attack and 600 ms release", () => {
    const s = createSwell();
    const half = new Float32Array(12);
    half[2] = 0.5;
    for (let i = 0; i < 8; i++) s.step(half, false, false, 0.01, 1, false);
    expect(s.swell[2]).toBeCloseTo(0.25 * (1 - Math.exp(-1)), 4);
    for (let i = 0; i < 300; i++) s.step(half, false, false, 0.01, 1, false);
    expect(s.swell[2]).toBeCloseTo(0.25, 4);
    for (let i = 0; i < 60; i++) s.step(NONE, false, false, 0.01, 1, false);
    expect(s.swell[2]).toBeCloseTo(0.25 * Math.exp(-1), 4);
    expect([ATTACK, ATTACK_REDUCED, RELEASE]).toEqual([0.08, 0.15, 0.6]);
  });

  it("caps the swell at 1 however high the reactivity", () => {
    const s = createSwell();
    for (let i = 0; i < 300; i++) s.step(C_MAJOR, false, false, DT, 2, false);
    expect(s.swell[0]).toBeCloseTo(1, 4);
    expect(s.swell[1]).toBe(0);
  });

  it("settles every shape at 0.4 in silence (a quiet, legible poster)", () => {
    const s = createSwell();
    for (let i = 0; i < 600; i++) s.step(C_MAJOR, true, true, DT, 1, true);
    for (let i = 0; i < 12; i++) expect(s.swell[i]).toBeCloseTo(SILENT_SWELL, 3);
    expect(s.dot.every((v) => v === 0)).toBe(true);
  });

  it("gives the strongest pitch class a +15% dot swell on an onset", () => {
    const s = createSwell();
    const c = new Float32Array(12);
    c[7] = 1;
    c[0] = 0.5;
    s.step(c, false, true, DT, 1, false);
    expect(s.dot[7]).toBeCloseTo(DOT_BOOST, 6);
    expect(s.dot[0]).toBe(0);
  });

  it("is frame-rate independent", () => {
    const a = createSwell();
    const b = createSwell();
    for (let i = 0; i < 30; i++) a.step(C_MAJOR, false, false, 1 / 60, 1, false);
    for (let i = 0; i < 60; i++) b.step(C_MAJOR, false, false, 1 / 120, 1, false);
    for (let i = 0; i < 12; i++) expect(a.swell[i]).toBeCloseTo(b.swell[i], 6);
  });

  it("with Reduce flashing, a 10 Hz chord-stab train makes at most 3 ink rises per second", () => {
    const off = stabs(false);
    const on = stabs(true);
    expect(maxPerSecond(flashStarts(off, 0.01))).toBeGreaterThan(3);
    expect(maxPerSecond(flashStarts(on, 0.01))).toBeLessThanOrEqual(3);
    expect(Math.max(...on)).toBeGreaterThan(0.1); // still reacts
  });

  it("with Reduce flashing, moves shapes no more abruptly than without it (held rises ramp in)", () => {
    const off = largestScaleStep(false);
    const on = largestScaleStep(true);
    // The 150 ms attack alone (limiter bypassed) moves a shape at most 5.6% of its slot in one
    // frame of this run; with the limiter's held rises released in one frame it was 8.1%.
    expect(on.worst).toBeLessThan(0.065);
    expect(on.worst).toBeLessThan(off.worst);
    // A held rise comes back over ≥ ~150 ms, never in one frame.
    expect(on.gainRise).toBeLessThan(0.15);
    expect(off.gainRise).toBe(0);
  });

  it("allocates nothing: the same arrays every step", () => {
    const s = createSwell();
    const { swell, dot } = s;
    s.step(C_MAJOR, false, true, DT, 1, true);
    expect(s.swell).toBe(swell);
    expect(s.dot).toBe(dot);
  });
});
