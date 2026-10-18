// @ts-check
import { describe, expect, it } from "vitest";
import {
  A_AGE,
  A_FLOOR,
  A_STRONG,
  binOf,
  BODY_DB,
  BODY_HZ,
  BODY_WIN,
  BROAD_DB,
  BROAD_SHARE,
  C_MIN,
  CLICK_DB,
  createHits,
  FLAT_KICK,
  FLAT_MIN,
  FLAT_STEP,
  flatness,
  FLUX_MIN,
  FLUX_SPAN,
  HIGH_HZ,
  HIST,
  K_FLOOR,
  K_FLUX,
  K_HUGE,
  K_RISE,
  K_WAIT,
  LOW_HZ,
  MID_HZ,
  MID_SPLIT,
  midSplit,
  R_BODY,
  R_MID,
  R_RISE,
  REFIRE,
  REFIRE_W,
  REFRACTORY,
  S_HAT_DB,
  SHARE_DB,
  W_HI,
  W_LO,
  W_RISE_HI,
  W_RISE_LO,
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
 *   onset?: boolean, strength?: number, age?: number, silent?: boolean,
 *   lowBins?: number[], narrow?: boolean, tonal?: boolean, body?: number, lowTop?: number }} Frame
 * lowBins: per-bin levels (dB) of the low band instead of `low` spread evenly over its bins;
 * narrow: `mid` in one bin (a cowbell); tonal: `mid` in TONAL_BINS harmonics (a synth or vocal
 * note); else `mid` spread evenly over every mid bin (noise: a snare or clap);
 * body: level (dB) of the kick-body band, spread over its bins above the low band; by default `low` − 6 (a kick's body
 * follows its low end); lowTop: level (dB) of the low band's top bin, which the body band shares
 * (a swell or bass line that leaves the body band alone).
 */

/** FLAT_MIN, FLAT_STEP, SHARE_DB, BODY_DB, FLAT_KICK, CLICK_DB, K_FLUX, K_RISE, K_FLOOR as tuned on the real songs and synthetic tracks. */
const TUNED_GATE = [0.28, 2, -4, 2, 0.15, 1, 3, 3, -30];

/** Amplitude of a bin at `db`: 10·log10(a²) = dB. @param {number} db */
const amp = (db) => Math.sqrt(10 ** (db / 10));
const LOW_BINS = [binOf(LOW_HZ[0], SR), binOf(LOW_HZ[1], SR)];
const MID_BINS = [binOf(MID_HZ[0], SR), binOf(MID_HZ[1], SR)];
/** The body band's bins above the low band's (they share one bin at 48 kHz). */
const BODY_BINS = [Math.max(binOf(BODY_HZ[0], SR), LOW_BINS[1] + 1), binOf(BODY_HZ[1], SR)];
/** Harmonics of a 1 kHz note: bins of 1, 1.5, 2, 3 and 4 kHz. */
const TONAL_BINS = [1000, 1500, 2000, 3000, 4000].map((hz) => binOf(hz, SR));

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

/**
 * The band levels as a spectrum: the low band's level spread evenly over its bins (or per bin from
 * lowBins), the mid band's over the first bin of each sub-band (or all in the first, `narrow`), the
 * high band's in one bin. @param {ReturnType<typeof makeAudio>} a @param {Frame} f
 */
function load(a, f) {
  a.spectrum.fill(0);
  const nLow = LOW_BINS[1] - LOW_BINS[0] + 1;
  for (let i = 0; i < nLow; i++) a.spectrum[LOW_BINS[0] + i] = amp(f.lowBins ? f.lowBins[i] : f.low - 10 * Math.log10(nLow));
  if (f.lowTop !== undefined) a.spectrum[LOW_BINS[1]] = amp(f.lowTop);
  if (f.narrow) a.spectrum[MID_BINS[0]] = amp(f.mid);
  else if (f.tonal) for (const b of TONAL_BINS) a.spectrum[b] = amp(f.mid - 10 * Math.log10(TONAL_BINS.length));
  else {
    const nMid = MID_BINS[1] - MID_BINS[0] + 1;
    for (let i = MID_BINS[0]; i <= MID_BINS[1]; i++) a.spectrum[i] = amp(f.mid - 10 * Math.log10(nMid));
  }
  const nBody = BODY_BINS[1] - BODY_BINS[0] + 1;
  for (let i = BODY_BINS[0]; i <= BODY_BINS[1]; i++) a.spectrum[i] = amp((f.body ?? f.low - 6) - 10 * Math.log10(nBody));
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
  /** @type {number[]} */ const softs = [];
  for (const f of frames) {
    load(a, f);
    const o = hits.step(a);
    if (o.soft) softs.push(f.t);
    if (o.fire) fires.push(f.t);
    if (o.grow) grows.push(f.t);
    if (o.fire || o.grow) weights.push(o.weight);
  }
  return { fires, grows, weights, softs, out: hits.out };
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
    expect([FLUX_SPAN, HIST, Z_FLOOR, Z, FLUX_MIN, A_STRONG, A_AGE, S_HAT_DB, C_MIN, REFRACTORY, REFIRE, WEIGHT_WIN, W_LO, W_HI]).toEqual([
      0.035, 2, 0.5, 3, 3, 6, 0.03, -3, 0.6, 0.07, 0.12, 0.043, -28, -10,
    ]);
    expect([W_RISE_LO, W_RISE_HI, MID_SPLIT, BROAD_DB, BROAD_SHARE, REFIRE_W, A_FLOOR]).toEqual([1, 3.5, 8, 6, 0.5, 0.65, -40]);
    expect([FLAT_MIN, FLAT_STEP, SHARE_DB, BODY_DB, FLAT_KICK, CLICK_DB, K_FLUX, K_RISE, K_FLOOR]).toEqual(TUNED_GATE);
    expect(BODY_HZ).toEqual([150, 400]);
    expect(K_HUGE).toBe(20);
    expect([BODY_WIN, K_WAIT, R_RISE, R_BODY, R_MID]).toEqual([0.04, 0.035, 6, 5, 2]);
  });

  it("measures the flatness of every FLAT_STEP-th bin: 1 for even noise, near 0 for a few harmonics", () => {
    const s = new Float32Array(1024);
    for (let i = 43; i <= 213; i++) s[i] = 0.01;
    expect(flatness(s, 43, 213)).toBeCloseTo(1, 6);
    s.fill(0);
    for (const b of TONAL_BINS) s[b] = 0.1;
    expect(flatness(s, 43, 213)).toBeLessThan(0.01);
    s[44] = NaN;
    expect(Number.isFinite(flatness(s, 43, 213))).toBe(true);
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

  it("splits the mid band into MID_SPLIT log-spaced sub-bands", () => {
    expect([...midSplit(48000)]).toEqual([43, 53, 64, 78, 96, 117, 143, 175, 214]);
    expect([...midSplit(44100)]).toEqual([46, 56, 69, 85, 104, 127, 155, 190, 233]);
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

  it("scales the weight by the low band's mean rise per bin: a hit over a sustained bass weighs nothing", () => {
    // A snare (mid step) over a steady loud low band: the bass is heavy but did not arrive with the hit.
    const held = floor(260, { low: -12, flat: true });
    setFrames(held, 200, 3, { mid: -28, high: -32 });
    const a = run(held);
    expect(a.fires).toEqual([held[200].t]);
    expect(a.weights[0]).toBe(0);
    // Every low bin up 2.25 dB: half way from W_RISE_LO to W_RISE_HI, so half of the level's weight.
    for (const [from, to] of [
      [-24.25, -22],
      [-12.25, -10],
    ]) {
      const fr = floor(260, { low: from, flat: true });
      setFrames(fr, 200, 3, { low: to, mid: -28, high: -32 });
      const b = run(fr);
      expect(b.fires).toEqual([fr[200].t]);
      expect(b.weights[0]).toBeCloseTo(((to - W_LO) / (W_HI - W_LO)) * ((2.25 - W_RISE_LO) / (W_RISE_HI - W_RISE_LO)), 5);
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

  it("weighs a kick on a ringing 808 by the bass level, though the band level holds", () => {
    // The 808 rings in the lowest bins; the kick fills the upper low bins while a limiter keeps the
    // band level where it was (-11.5 dB). The band does not rise, its bins do: full weight at the level.
    const ring = [-14, -16, -22, -40, -40, -40];
    const kick = [-16, -18, -24, -20, -20, -20];
    const level = (/** @type {number[]} */ b) => 10 * Math.log10(b.reduce((e, x) => e + 10 ** (x / 10), 0));
    expect(level(kick)).toBeCloseTo(level(ring), 0);
    const fr = floor(260, { flat: true }).map((f) => ({ ...f, lowBins: ring }));
    setFrames(fr, 200, 3, { lowBins: kick, mid: -28, high: -32 });
    const { fires, out } = run(fr);
    expect(fires).toEqual([fr[200].t]);
    expect(out.weight).toBeCloseTo((level(kick) - W_LO) / (W_HI - W_LO), 5);
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
    const busy = floor(400, { mid: -30, high: -30 }).map((f, k) => ({ ...f, tonal: true, body: -45, lowTop: -45, low: -30 + [0, 4.5, -1, 3.5, -2, 5, 0.5, -1.5][k % 8] }));
    expect(run(busy).fires).toEqual([]);
    expect(run(busy.flatMap((f) => [f, f, f])).fires).toEqual([]);
  });

  it("fires at most once per 0.07 s, and within 0.12 s only on a bigger low rise or a broad mid rise", () => {
    /** @param {number} gap frames (10 ms) @param {Partial<Frame>} first @param {Partial<Frame>} second */
    const pair = (gap, first, second) => {
      const fr = floor(260, { dt: 0.01, flat: true });
      setFrames(fr, 200, 2, first);
      setFrames(fr, 200 + gap, 2, second);
      return run(fr).fires.length;
    };
    const kick = { low: -28 };
    expect(pair(5, kick, kick)).toBe(1); // inside the 0.07 s refractory
    expect(pair(8, kick, kick)).toBe(1); // the same low rise again 80 ms on: the kick's own tail
    expect(pair(13, kick, kick)).toBe(2); // 130 ms apart: two hits
    expect(pair(8, { mid: -28, high: -32 }, kick)).toBe(2); // snare, then a kick a 16th later
    expect(pair(8, { low: -33 }, { low: -22 })).toBe(2); // a light low hit, then a heavier one
    expect(pair(8, { low: -14 }, { low: -2 })).toBe(1); // a heavy hit (w 0.78), then more of its swell
    expect(pair(8, kick, { mid: -28, high: -32 })).toBe(2); // kick, then a snare (broad mid rise)
    expect(pair(8, kick, { mid: -28, high: -32, narrow: true })).toBe(1); // kick, then a cowbell
    expect(pair(5, kick, { mid: -28, high: -32 })).toBe(1); // nothing inside the refractory
  });

  it("does not take a low rise out of near silence (under A_FLOOR) for a bass hit", () => {
    const fr = floor(260, { low: -70, flat: true });
    setFrames(fr, 200, 3, { low: -58, age: 0.01 });
    expect(run(fr).fires).toEqual([]);
  });

  it("needs a host onset within 30 ms for a low rise under 6 dB", () => {
    for (const [rise, age, fires] of [
      [5, 0.02, 1],
      [5, 0.03, 1],
      [5, 0.05, 0],
      [5, 10, 0],
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

  it("takes a host onset of strength 0.6 or more on a non-hat spectrum for a soft hit", () => {
    for (const [s, n] of [
      [0.6, 1],
      [1.4, 1],
      [0.59, 0],
    ]) {
      const fr = floor(260, { mid: -40, high: -45 });
      setFrames(fr, 200, 1, { onset: true, strength: s, age: 0.004 });
      const r = run(fr);
      expect(r.fires).toEqual([]);
      expect(r.softs).toHaveLength(n);
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
    expect(Object.keys(o).sort()).toEqual(["fire", "grow", "soft", "weight"]);
  });
});

describe("createHits: only kicks and noise bursts hop", () => {
  it("hops on a mid rise of noise (a snare or clap), and takes the same rise of a tonal note for a soft hit", () => {
    const snare = floor(260);
    setFrames(snare, 200, 3, { mid: -28, high: -32 });
    expect(run(snare).fires).toEqual([snare[200].t]);
    const note = floor(260).map((f) => ({ ...f, tonal: true }));
    setFrames(note, 200, 3, { mid: -28, high: -32 });
    const r = run(note);
    expect(r.fires).toEqual([]);
    expect(r.softs).toEqual([note[200].t]);
  });

  it("takes a host onset with no noise or kick under it for a soft hit, not a hop", () => {
    const fr = floor(260, { mid: -40, high: -45 }).map((f) => ({ ...f, tonal: true }));
    setFrames(fr, 200, 1, { onset: true, strength: 0.9, age: 0.004 });
    const r = run(fr);
    expect(r.fires).toEqual([]);
    expect(r.softs).toEqual([fr[200].t]);
  });

  it("hops on a bass rise only with the kick body (150–400 Hz) rising and the bass dominating the spectrum", () => {
    const tonal = (/** @type {Frame} */ f) => ({ ...f, tonal: true, body: -50, lowTop: -50 });
    const kick = floor(260).map(tonal);
    setFrames(kick, 200, 3, { low: -26, body: -34, lowTop: -34 });
    expect(run(kick).fires).toEqual([kick[200].t]);
    // An 808 note or a sidechained bass swelling back: the low end rises, the body does not.
    const swell = floor(260).map(tonal);
    setFrames(swell, 200, 3, { low: -26 });
    const r = run(swell);
    expect(r.fires).toEqual([]);
    expect(r.softs).toEqual([swell[200].t]);
    // A low rise under a louder mid band (a sung or bowed note's fundamental): not a kick.
    const voice = floor(260, { mid: -20 }).map(tonal);
    setFrames(voice, 200, 3, { low: -26, body: -34, lowTop: -34 });
    expect(run(voice).fires).toEqual([]);
  });

  it("hops on a low rise of K_HUGE dB or more as a kick, with no body, click or bass share (a pure sine kick)", () => {
    const quiet = (/** @type {Frame} */ f) => ({ ...f, tonal: true, body: -50, mid: -20, low: -55 });
    const sine = floor(260).map(quiet);
    setFrames(sine, 200, 3, { low: -55 + K_HUGE + 1 });
    expect(run(sine).fires).toEqual([sine[200].t]);
    const smaller = floor(260).map(quiet);
    setFrames(smaller, 200, 3, { low: -55 + K_HUGE - 2 });
    expect(run(smaller).fires).toEqual([]);
  });

  it("hops on a kick over a constant heavy bass whose busy low band keeps the z score under Z", () => {
    // A loud bass line wobbling ±2.5 dB: its spread keeps a 4 dB kick's z score low, but the rise per
    // bin, the band rise and the body make it a kick.
    const fr = floor(400, { low: -14 }).map((f, k) => ({ ...f, tonal: true, low: -14 + [0, 2.5, -2, 1.5, -2.5, 2, 0.5, -1][k % 8], body: -45, lowTop: -45 }));
    for (let k = 300; k < 303; k++) Object.assign(fr[k], { low: -14 + K_FLUX + 1.5, body: -30, lowTop: -30 });
    const r = run(fr);
    // A rise with no z score waits one analysis frame: it hops there if the low end holds or keeps building.
    expect(r.fires).toEqual([fr[301].t]);
    expect(r.softs).toContain(fr[300].t);
  });

  it("takes a z-less bass rise that falls back on the next frame (a busy bass line's peak) for a soft hit", () => {
    const fr = floor(400, { low: -14 }).map((f, k) => ({ ...f, tonal: true, low: -14 + [0, 2.5, -2, 1.5, -2.5, 2, 0.5, -1][k % 8], body: -45, lowTop: -45 }));
    Object.assign(fr[300], { low: -14 + K_FLUX + 1.5, body: -30, lowTop: -30 });
    Object.assign(fr[301], { low: -14 + K_FLUX, body: -30, lowTop: -30 });
    const r = run(fr);
    expect(r.fires).toEqual([]);
    expect(r.softs).toContain(fr[300].t);
  });

  it("takes a kick body that rose up to BODY_WIN s before the bass (the kick's pitch falls) for a kick, at 60 and 144 fps", () => {
    const tonal = (/** @type {Frame} */ f) => ({ ...f, tonal: true, body: -50, lowTop: -50 });
    /** @param {number} bodyAt frame the body comes up (and stays) */
    const kick = (bodyAt) => {
      const fr = floor(260).map(tonal);
      setFrames(fr, bodyAt, 260 - bodyAt, { body: -34 });
      return setFrames(fr, 200, 3, { low: -26 });
    };
    // Up 3 frames (32 ms) before: by the bass's frame the body has stopped rising, but it came with the kick.
    const close = kick(197);
    expect(run(close).fires).toEqual([close[200].t]);
    for (const fps of [60, 144]) {
      const f = runAt(close, fps);
      expect(f).toHaveLength(1);
      expect(f[0].t - close[200].t).toBeGreaterThanOrEqual(0);
      expect(f[0].t - close[200].t).toBeLessThan(0.02);
    }
    // Up 7 frames (75 ms) before: a note's body, not this hit's.
    const early = kick(193);
    const r = run(early);
    expect(r.fires).toEqual([]);
    expect(r.softs).toEqual([early[200].t]);
  });

  it("hops on a kick into a ringing 808 that dips the band: its bins rise, with the body and a click", () => {
    // The top low bin is also the body band's lowest; it stays quiet so the body band is the body alone.
    const ring = [-14, -16, -22, -40, -40, -60];
    const into = [-17, -19, -25, -20, -20, -60]; // the low bins rise by 6.7 dB on average; the band dips 1 dB
    /** @param {Partial<Frame>} hit */
    const make = (hit) => {
      const fr = floor(260, { flat: true }).map((f) => ({ ...f, lowBins: ring, tonal: true, body: -50 }));
      setFrames(fr, 200, 1, { lowBins: into, ...hit });
      return setFrames(fr, 201, 59, { lowBins: ring });
    };
    const kick = make({ body: -50 + R_BODY + 1, mid: -40 + R_MID + 2 });
    expect(run(kick).fires).toEqual([kick[200].t]);
    // No click: the 808's own next note, not a kick.
    const note = make({ body: -50 + R_BODY + 1 });
    expect(run(note).fires).toEqual([]);
    // No body: a tonal attack over the 808.
    const attack = make({ mid: -40 + R_MID + 2 });
    expect(run(attack).fires).toEqual([]);
  });
});

