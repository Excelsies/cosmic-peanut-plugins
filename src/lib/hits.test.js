// @ts-check
import { describe, expect, it } from "vitest";
import {
  A_AGE,
  A_STRONG,
  binOf,
  C_MIN,
  createHits,
  FLUX_MIN,
  FLUX_SPAN,
  HIGH_HZ,
  HIST,
  LOW_HZ,
  MID_HZ,
  REFRACTORY,
  S_HAT_DB,
  W_HI,
  W_LO,
  W_RISE,
  WEIGHT_WIN,
  Z,
  Z_FLOOR,
} from "./hits.js";

const SR = 48000;
/** Host analysis hop (s). */
const HOP = 512 / SR;
/** A gently varied floor (dB offsets), so the flux history has a small spread. */
const WOBBLE = [0, 0.3, -0.2, 0.1, -0.3, 0.2];

/**
 * @typedef {{ t: number, i: number, low: number, mid: number, high: number,
 *   onset?: boolean, strength?: number, age?: number, silent?: boolean }} Frame
 */

/** One bin per band carries the band's whole level: 10·log10(a²) = dB. @param {number} db */
const amp = (db) => Math.sqrt(10 ** (db / 10));

/** An AudioFrame-shaped object for createHits. */
function makeAudio() {
  return {
    spectrum: new Float32Array(1024),
    sampleRate: SR,
    frameIndex: -1,
    hostTime: 0,
    silent: false,
    onset: false,
    onsetStrength: 0,
    onsetAge: 10,
  };
}

/** @param {ReturnType<typeof makeAudio>} a @param {Frame} f */
function load(a, f) {
  a.spectrum.fill(0);
  a.spectrum[binOf(LOW_HZ[0], a.sampleRate)] = amp(f.low);
  a.spectrum[binOf(MID_HZ[0], a.sampleRate)] = amp(f.mid);
  a.spectrum[binOf(HIGH_HZ[0], a.sampleRate)] = amp(f.high);
  a.frameIndex = f.i;
  a.hostTime = f.t;
  a.silent = f.silent === true;
  a.onset = f.onset === true;
  a.onsetStrength = f.strength ?? 0;
  a.onsetAge = f.age ?? 10;
}

/**
 * `n` analysis frames of a wobbling floor, from frame index `i0`.
 * @param {number} n @param {{ low?: number, mid?: number, high?: number, dt?: number, i0?: number, flat?: boolean }} [o]
 * @returns {Frame[]}
 */
function floor(n, o = {}) {
  const { low = -40, mid = -40, high = -46, dt = HOP, i0 = 0, flat = false } = o;
  /** @type {Frame[]} */ const out = [];
  for (let k = 0; k < n; k++) {
    const w = flat ? 0 : WOBBLE[(i0 + k) % WOBBLE.length];
    out.push({ t: (i0 + k + 1) * dt, i: i0 + k, low: low + w, mid: mid + w, high: high + w });
  }
  return out;
}

/** Feed frames once each; returns fire times, grow times and weights. @param {Frame[]} frames */
function run(frames, hits = createHits()) {
  const a = makeAudio();
  /** @type {number[]} */ const fires = [];
  /** @type {number[]} */ const grows = [];
  /** @type {number[]} */ const weights = [];
  for (const f of frames) {
    load(a, f);
    const o = hits.step(a);
    if (o.fire) fires.push(f.t);
    if (o.grow) grows.push(f.t);
    if (o.fire || o.grow) weights.push(o.weight);
  }
  return { fires, grows, weights, out: hits.out };
}

/**
 * Feed analysis frames the way the runtime does at `fps`: each display frame decodes the newest
 * analysis frame (repeating it when none arrived) and carries an onset from any frame it skipped.
 * @param {Frame[]} frames @param {number} fps
 */
function runAt(frames, fps) {
  const hits = createHits();
  const a = makeAudio();
  /** @type {{ t: number, w: number }[]} */ const fires = [];
  let next = 0;
  let latched = false;
  let latchedStrength = 0;
  /** @type {Frame | null} */ let cur = null;
  const end = frames[frames.length - 1].t;
  for (let k = 1; k / fps <= end + 1 / fps; k++) {
    const now = k / fps;
    let fresh = false;
    while (next < frames.length && frames[next].t <= now) {
      if (frames[next].onset && !latched) {
        latched = true;
        latchedStrength = frames[next].strength ?? 0;
      }
      cur = frames[next++];
      fresh = true;
    }
    if (!cur) continue;
    load(a, cur);
    a.onset = fresh && latched;
    if (a.onset) {
      a.onsetStrength = latchedStrength;
      latched = false;
    }
    const o = hits.step(a);
    if (o.fire) fires.push({ t: cur.t, w: o.weight });
    if (o.grow) fires[fires.length - 1].w = o.weight;
  }
  return fires;
}

/** Replace frames from index `k` on with `edit(frame)`. @param {Frame[]} fr @param {number} k @param {number} n @param {Partial<Frame>} set */
function setFrames(fr, k, n, set) {
  for (let j = k; j < k + n && j < fr.length; j++) Object.assign(fr[j], set);
  return fr;
}

describe("hits constants", () => {
  it("exports the tuned constants", () => {
    expect([FLUX_SPAN, HIST, Z_FLOOR, Z, FLUX_MIN, A_STRONG, A_AGE, S_HAT_DB, C_MIN, REFRACTORY, WEIGHT_WIN, W_LO, W_HI, W_RISE]).toEqual([
      0.035, 2, 0.5, 3, 3, 6, 0.03, -3, 0.6, 0.07, 0.043, -28, -10, 4,
    ]);
  });

  it("derives the band bins from the sample rate", () => {
    const at = (/** @type {number[]} */ hz, /** @type {number} */ sr) => [binOf(hz[0], sr), binOf(hz[1], sr)];
    expect([at(LOW_HZ, 48000), at(MID_HZ, 48000), at(HIGH_HZ, 48000)]).toEqual([
      [1, 6],
      [43, 213],
      [256, 640],
    ]);
    expect([at(LOW_HZ, 44100), at(MID_HZ, 44100), at(HIGH_HZ, 44100)]).toEqual([
      [1, 7],
      [46, 232],
      [279, 697],
    ]);
  });
});

describe("createHits", () => {
  it("fires on the frame of a 12 dB low step, weighted by the low level", () => {
    for (const [level, w] of [
      [-28, 0],
      [-19, 0.5],
      [-10, 1],
      [-4, 1],
      [-36, 0],
    ]) {
      const fr = floor(200, { low: level - 12 });
      fr.push(...setFrames(floor(10, { low: level - 12, i0: 200 }), 0, 10, { low: level }));
      const { fires, weights } = run(fr);
      expect(fires).toEqual([fr[200].t]);
      expect(weights[0]).toBeCloseTo(w, 3);
    }
  });

  it("grows the weight on later frames within 43 ms of the fire, the same at 60 and 144 fps", () => {
    const fr = floor(260, { low: -34 });
    setFrames(fr, 200, 2, { low: -22 }); // w 1/3 on the fire
    setFrames(fr, 202, 3, { low: -16 }); // w 2/3, inside the window
    setFrames(fr, 205, 1, { low: -10 }); // w 1, after the window (and inside the refractory)
    const once = run(fr);
    expect(once.fires).toEqual([fr[200].t]);
    expect(once.grows).toEqual([fr[202].t]);
    expect(once.out.weight).toBeCloseTo(2 / 3, 3);
    for (const fps of [60, 144]) {
      const f = runAt(fr, fps);
      expect(f).toHaveLength(1);
      expect(f[0].w).toBeCloseTo(2 / 3, 3);
    }
  });

  it("scales the weight by how far the low band rose: a hit over a sustained bass weighs nothing", () => {
    // A snare (mid step) over a steady loud low band: the bass is heavy but did not arrive with the hit.
    const held = floor(260, { low: -12, flat: true });
    setFrames(held, 200, 3, { mid: -28, high: -32 });
    const a = run(held);
    expect(a.fires).toEqual([held[200].t]);
    expect(a.weights[0]).toBe(0);
    // The same snare with the low band 2 dB up from its floor: half of the level's weight (W_RISE 4 dB).
    for (const [from, to] of [
      [-24, -22],
      [-12, -10],
    ]) {
      const fr = floor(260, { low: from, flat: true });
      setFrames(fr, 200, 3, { low: to, mid: -28, high: -32 });
      const b = run(fr);
      expect(b.fires).toEqual([fr[200].t]);
      expect(b.weights[0]).toBeCloseTo(((to - W_LO) / (W_HI - W_LO)) * (2 / W_RISE), 6);
    }
    // A rise that lands on the frames after the fire grows the weight to the full level weight.
    const late = floor(260, { low: -24, flat: true });
    setFrames(late, 200, 1, { low: -22, mid: -28, high: -32 });
    setFrames(late, 201, 3, { low: -16 });
    const c = run(late);
    expect(c.fires).toEqual([late[200].t]);
    expect(c.grows).toEqual([late[201].t]);
    expect(c.out.weight).toBeCloseTo(2 / 3, 6);
  });

  it("evaluates a repeated frameIndex once", () => {
    const fr = floor(600, { low: -30, mid: -30 });
    for (let k = 220; k < 600; k += 37) setFrames(fr, k, 2, { low: -14 });
    for (let k = 240; k < 600; k += 53) setFrames(fr, k, 2, { mid: -15, high: -30 });
    const once = run(fr);
    expect(once.fires.length).toBeGreaterThan(10);
    const twice = run(fr.flatMap((f) => [f, f]));
    expect(twice.fires).toEqual(once.fires);
    expect(twice.weights).toEqual(once.weights);
    // Resent frames must not enter the flux history either: as extra zero-flux entries they would
    // shrink its spread until the ordinary rises of a busy low band pass the z score.
    const busy = floor(400, { mid: -30, high: -30 }).map((f, k) => ({ ...f, low: -30 + [0, 4.5, -1, 3.5, -2, 5, 0.5, -1.5][k % 8] }));
    expect(run(busy).fires).toEqual([]);
    expect(run(busy.flatMap((f) => [f, f, f])).fires).toEqual([]);
  });

  it("fires at most once per 0.07 s", () => {
    for (const [gap, n] of [
      [5, 1],
      [8, 2],
    ]) {
      const fr = floor(260, { dt: 0.01 });
      setFrames(fr, 200, 2, { low: -28 });
      setFrames(fr, 200 + gap, 2, { low: -28 });
      expect(run(fr).fires).toHaveLength(n);
    }
  });

  it("needs a host onset within 30 ms for a low rise under 6 dB", () => {
    for (const [rise, age, fires] of [
      [4, 0.02, 1],
      [4, 0.03, 1],
      [4, 0.05, 0],
      [4, 10, 0],
      [7, 10, 1],
    ]) {
      const fr = floor(260);
      setFrames(fr, 200, 3, { low: -40 + rise, age });
      expect(run(fr).fires).toHaveLength(fires);
    }
  });

  it("fires on a mid step, but not on a hat spectrum, onset or not", () => {
    const snare = floor(260);
    setFrames(snare, 200, 3, { mid: -28, high: -32 });
    expect(run(snare).fires).toEqual([snare[200].t]);
    const hat = floor(260);
    setFrames(hat, 200, 3, { mid: -28, high: -22, onset: true, strength: 0.9, age: 0.005 });
    expect(run(hat).fires).toEqual([]);
  });

  it("fires on a host onset of strength 0.6 or more on a non-hat spectrum", () => {
    for (const [s, n] of [
      [0.6, 1],
      [1.4, 1],
      [0.59, 0],
    ]) {
      const fr = floor(260, { mid: -40, high: -45 });
      setFrames(fr, 200, 1, { onset: true, strength: s, age: 0.004 });
      expect(run(fr).fires).toHaveLength(n);
    }
  });

  it("needs FLUX_MIN of rise whatever the spread, and 8 frames of history", () => {
    const small = floor(260, { flat: true });
    setFrames(small, 200, 3, { low: -40 + FLUX_MIN - 0.1, mid: -40 + FLUX_MIN - 0.1, age: 0.01 });
    expect(run(small).fires).toEqual([]);
    const early = floor(60, { flat: true });
    setFrames(early, 5, 2, { low: -20 });
    expect(run(early).fires).toEqual([]);
    const later = floor(60, { flat: true });
    setFrames(later, 12, 2, { low: -20 });
    expect(run(later).fires).toEqual([later[12].t]);
  });

  it("ignores silent frames, and survives NaN in every input", () => {
    const fr = floor(260);
    setFrames(fr, 200, 3, { low: -20, silent: true });
    expect(run(fr).fires).toEqual([]);
    const hits = createHits();
    const a = makeAudio();
    for (let k = 0; k < 300; k++) {
      const f = floor(1, { i0: k })[0];
      if (k % 50 === 20) f.low = -14;
      load(a, f);
      if (k % 7 === 0) a.spectrum[3] = NaN;
      if (k % 11 === 0) a.hostTime = NaN;
      if (k % 13 === 0) a.onsetAge = NaN;
      if (k % 17 === 0) {
        a.onset = true;
        a.onsetStrength = NaN;
      }
      const o = hits.step(a);
      expect(o.weight >= 0 && o.weight <= 1).toBe(true);
    }
  });

  it("keeps time from the summed dt when a source sends no hostTime", () => {
    // The harness's synthetic sources send no hostTime and one new frame per display frame.
    for (const fps of [60, 144]) {
      const hits = createHits();
      const a = makeAudio();
      /** @type {number[]} */ const fires = [];
      for (let k = 0; k < fps * 4; k++) {
        const t = k / fps;
        const f = floor(1, { i0: k })[0];
        if (t >= 2.5 && t < 2.52) f.low = -26; // 14 dB step
        if (t >= 2.54 && t < 2.565) f.low = -26; // again, inside the 0.07 s refractory
        if (t >= 3 && t < 3.05) f.mid = -26;
        load(a, f);
        a.hostTime = /** @type {any} */ (undefined);
        if (hits.step(a, 1 / fps).fire) fires.push(t);
      }
      expect(fires).toHaveLength(2);
      expect(fires[0]).toBeCloseTo(2.5, 1);
      expect(fires[1]).toBeCloseTo(3, 1);
    }
  });

  it("returns the same object every call", () => {
    const hits = createHits();
    const a = makeAudio();
    load(a, floor(1)[0]);
    const o = hits.step(a);
    expect(o).toBe(hits.out);
    a.frameIndex = 1;
    a.hostTime += HOP;
    expect(hits.step(a)).toBe(o);
    expect(Object.keys(o).sort()).toEqual(["fire", "grow", "weight"]);
  });
});
