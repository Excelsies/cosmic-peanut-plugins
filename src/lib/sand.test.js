// @ts-check
import { describe, expect, it } from "vitest";
import { createHop, createHopQueue, createPlateDrive, DRIVE_CEIL, DRIVE_KNEE, DRIVE_PEAK, F_MIN, flightTime, GRAIN_FLOATS, GRAVITY, HAZE_PEAK, hopVz0, K_PULSE, PULSE_BASE, PULSE_TAU, SCATTER, seedGrains, W_HAZE } from "./sand.js";

const DT = 1 / 60;

/** Flash onsets in an envelope (rise ≥ threshold from the last low): builtin flash.test.js's helper. @param {number[]} values @param {number} dt */
function flashStarts(values, dt, threshold = 0.1) {
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
        starts.push(i * dt);
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

/** Most events in any 1-second window. @param {number[]} times */
function maxPerSecond(times) {
  let best = 0;
  for (let i = 0; i < times.length; i++) {
    let n = 0;
    for (let j = i; j < times.length && times[j] - times[i] < 1; j++) n++;
    best = Math.max(best, n);
  }
  return best;
}

/** A hit as createHits().out gives it. @param {boolean} fire @param {number} weight @param {boolean} [grow] */
const hit = (fire, weight, grow = false) => ({ fire, grow, weight });
const NONE = hit(false, 0);

/**
 * Run createHop on a train of hits of weight `w`, one every `period` s on whole frames.
 * @param {number} period @param {boolean} reduce @param {number} dt
 */
function hitTrain(period, reduce, dt = DT, seconds = 4, w = 1) {
  const hop = createHop();
  /** @type {number[]} */ const hops = [];
  /** @type {number[]} */ const sizes = [];
  /** @type {number[]} */ const haze = [];
  const every = Math.round(period / dt);
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    const h = hop.step(i % every === 0 ? hit(true, w) : NONE, 1, dt, reduce);
    if (h.impulse > 0) {
      hops.push(i * dt);
      sizes.push(h.fraction);
    }
    haze.push(h.haze);
  }
  return { hops, sizes, haze };
}

describe("hop", () => {
  it("exports the hop constants", () => {
    expect([F_MIN, SCATTER, W_HAZE, HAZE_PEAK]).toEqual([0.3, 0.12, 0.7, 0.25]);
  });

  it("launches grains for a 0.15 s flight at Hop 1 and full weight", () => {
    expect(flightTime(hopVz0(1, 1))).toBeCloseTo(0.15, 6);
    expect(flightTime(hopVz0(1, 0))).toBeCloseTo(0.06, 6);
    expect(hopVz0(0, 1)).toBe(0);
  });

  it("grades the share of grains, the launch speed and the scatter by weight, scaled by Hop", () => {
    for (const hopParam of [0, 1, 2]) {
      for (const w of [0, 0.5, 1]) {
        const h = createHop().step(hit(true, w), hopParam, DT, false);
        if (hopParam === 0) {
          expect([h.impulse, h.scatter, h.fraction, h.seq, h.haze]).toEqual([0, 0, 0, 0, 0]);
          continue;
        }
        expect(h.impulse).toBeCloseTo(GRAVITY * 0.075 * hopParam * (0.4 + 0.6 * w), 9);
        expect(h.fraction).toBeCloseTo(0.3 + 0.7 * w, 9);
        expect(h.scatter).toBeCloseTo(0.12 * hopParam * w * w, 9);
      }
    }
  });

  it("counts a new hop only on a fire; a grow re-sends a bigger hop under the same seq", () => {
    const hop = createHop();
    const a = hop.step(hit(true, 0.3), 1, DT, true);
    expect([a.seq, a.fraction, a.launched]).toEqual([1, expect.closeTo(0.51, 9), 0]);
    const b = hop.step(hit(false, 0.6, true), 1, DT, true);
    expect(b).toBe(a);
    expect(b.seq).toBe(1);
    expect(b.fraction).toBeCloseTo(0.72, 9);
    expect(b.impulse).toBeCloseTo(hopVz0(1, 0.6), 9);
    // The grow names the share already launched, so only the grains between the two shares go up
    // (a short flight may have landed already: they must not hop twice).
    expect(b.launched).toBeCloseTo(0.51, 9);
    expect(hop.step(hit(false, 0.9, true), 1, DT, true).launched).toBeCloseTo(0.72, 9);
    const c = hop.step(NONE, 1, DT, true);
    expect([c.impulse, c.scatter, c.fraction, c.seq, c.launched]).toEqual([0, 0, 0, 1, 0]);
    for (let i = 0; i < 20; i++) hop.step(NONE, 1, DT, true);
    expect(hop.step(hit(true, 0.1), 1, DT, true).seq).toBe(2);
  });

  it("hazes only hits over weight 0.7, holds it through the weight window, then decays it with τ 0.15 s", () => {
    for (const w of [0, 0.5, 0.7]) {
      const hop = createHop();
      expect(hop.step(hit(true, w), 1, DT, true).haze).toBe(0);
    }
    for (const w of [0.85, 1]) {
      const peak = (0.25 * (w - 0.7)) / 0.3;
      const hop = createHop();
      expect(hop.step(hit(true, w), 1, DT, true).haze).toBeCloseTo(peak, 9);
      // 1/60 and 2/60 s are inside the 43 ms window: held.
      expect(hop.step(NONE, 1, DT, true).haze).toBeCloseTo(peak, 9);
      expect(hop.step(NONE, 1, DT, true).haze).toBeCloseTo(peak, 9);
      expect(hop.step(NONE, 1, DT, true).haze).toBeCloseTo(peak * Math.exp(-DT / 0.15), 9);
    }
    // A grow inside the window raises the held haze as part of the same rise.
    const hop = createHop();
    hop.step(hit(true, 0.8), 1, DT, true);
    expect(hop.step(hit(false, 1, true), 1, DT, true).haze).toBeCloseTo(0.25, 9);
  });

  it("downgrades a bright hit the limiter refuses to weight 0.7, never drops it", () => {
    const hop = createHop();
    hop.step(hit(true, 1), 1, DT, true);
    for (let i = 0; i < 11; i++) hop.step(NONE, 1, DT, true); // 0.2 s later, haze falling
    const before = hop.step(NONE, 1, DT, true).haze;
    const h = hop.step(hit(true, 1), 1, DT, true);
    expect(h.seq).toBe(2);
    expect(h.fraction).toBeCloseTo(0.3 + 0.7 * 0.7, 9);
    expect(h.impulse).toBeCloseTo(hopVz0(1, 0.7), 9);
    expect(h.scatter).toBeCloseTo(0.12 * 0.49, 9);
    expect(h.haze).toBeLessThanOrEqual(before);
    // Reduce flashing off: the same hit is not downgraded.
    const free = createHop();
    free.step(hit(true, 1), 1, DT, false);
    for (let i = 0; i < 12; i++) free.step(NONE, 1, DT, false);
    const f = free.step(hit(true, 1), 1, DT, false);
    expect(f.fraction).toBe(1);
    expect(f.haze).toBeCloseTo(0.25, 9);
  });

  it("hops on every hit of a 10 Hz train of full-weight hits, with at most 3 haze rises per second", () => {
    for (const dt of [1 / 60, 1 / 144]) {
      const { hops, sizes, haze } = hitTrain(0.1, true, dt);
      expect(hops.length).toBe(Math.ceil(Math.round(4 / dt) / Math.round(0.1 / dt)));
      expect(sizes.every((f) => f >= 0.79 - 1e-9)).toBe(true);
      expect(maxPerSecond(flashStarts(haze, dt, 0.05))).toBeLessThanOrEqual(3);
    }
  });

  it("never raises the haze without a hit", () => {
    const hop = createHop();
    hop.step(hit(true, 1), 1, DT, true);
    let last = hop.step(NONE, 1, DT, true).haze;
    for (let i = 0; i < 300; i++) {
      const h = hop.step(hit(false, i % 3 / 2), 1, DT, i % 2 === 0).haze;
      expect(h).toBeLessThanOrEqual(last);
      last = h;
    }
  });

  it("treats a NaN or negative dt as 0 and keeps hopping afterwards", () => {
    const hop = createHop();
    expect(hop.step(hit(true, 1), 1, DT, false).seq).toBe(1);
    hop.step(NONE, 1, NaN, false);
    hop.step(NONE, 1, -1, false);
    for (let i = 0; i < 30; i++) hop.step(NONE, 1, DT, false);
    const h = hop.step(hit(true, NaN), 1, NaN, false);
    expect(h.seq).toBe(2);
    expect(h.fraction).toBeCloseTo(0.3, 9);
    expect(Number.isFinite(h.haze)).toBe(true);
  });

  it("does nothing at Hop 0", () => {
    const hop = createHop();
    for (let i = 0; i < 60; i++) {
      const h = hop.step(hit(i % 30 === 0, 1), 0, DT, false);
      expect([h.impulse, h.fraction, h.haze, h.seq]).toEqual([0, 0, 0, 0]);
    }
  });
});

/** @param {Partial<Record<string, any>>} over */
const audio = (over = {}) => ({ midAtt: 1, rms: 0.1, silent: false, trebAtt: 1, flux: 0, bassAtt: 1, ...over });

describe("createHopQueue", () => {
  /** @param {number} impulse @param {number} fraction @param {number} launched @param {number} seq */
  const hp = (impulse, fraction, launched, seq) => ({ impulse, scatter: impulse / 10, fraction, launched, seq, haze: 0 });

  it("holds a hop until the next simulation step, merging a grow of the same hit by max", () => {
    const q = createHopQueue();
    const u = new Float32Array(4);
    q.add(hp(0.15, 0.5, 0, 1));
    q.add(hp(0, 0, 0, 1)); // a frame with no hop changes nothing
    q.add(hp(0.25, 0.8, 0.5, 1)); // its grow, before any step ran
    expect(q.take(u)).toBe(1);
    expect([...u].map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0.25, 0.025, 0.8, 0]);
    expect(q.take(u)).toBe(1); // the next step launches nothing, under the same seq
    expect([...u]).toEqual([0, 0, 0, 0]);
  });

  it("starts over when a new hit arrives before a step: a light hit does not inherit the last one's size", () => {
    const q = createHopQueue();
    const u = new Float32Array(4);
    q.add(hp(0.3, 1, 0.6, 4)); // a grow of hit 4 still pending
    q.add(hp(0.12, 0.5, 0, 5)); // hit 5, light
    expect(q.take(u)).toBe(5);
    expect([...u].map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0.12, 0.012, 0.5, 0]);
  });
});

describe("createPlateDrive", () => {
  it("drives clamp(0.5·min(midAtt, 2) + 4·rms, 0, 2.5) · reactivity, frame-rate independent", () => {
    for (const hz of [60, 120]) {
      const d = createPlateDrive();
      let s = d.step(audio({ midAtt: 3, rms: 0.2 }), 0, 1, true, 0, NONE, 1 / hz);
      for (let i = 1; i < hz; i++) s = d.step(audio({ midAtt: 3, rms: 0.2 }), 0, 1, true, 0, NONE, 1 / hz);
      expect(s.drive).toBeCloseTo(1.8, 3);
    }
    const d = createPlateDrive();
    let s = d.step(audio({ midAtt: 2, rms: 1 }), 0, 0.5, true, 0, NONE, 1);
    expect(s.drive).toBeCloseTo(1.25, 3);
    s = d.step(audio({ midAtt: 2, rms: 1 }), 0, 0.5, true, 0, NONE, 0.0001);
    expect(s.drive).toBeCloseTo(1.25, 3);
  });

  it("falls to rest within 0.3 s of silence, fizz and all", () => {
    const d = createPlateDrive();
    for (let i = 0; i < 60; i++) d.step(audio({ midAtt: 2, rms: 0.3, trebAtt: 2, flux: 1 }), 0, 1, true, 0, NONE, DT);
    let s = d.step(audio({ silent: true }), 0, 1, true, 0, NONE, DT);
    expect(s.fizz).toBe(0);
    for (let i = 1; i < 18; i++) s = d.step(audio({ silent: true, rms: 0 }), 0, 1, true, 0, NONE, DT);
    expect(s.drive).toBeLessThan(0.1);
  });

  it("fizz = clamp(trebAtt − 1, 0, 2) · 0.5 + flux · 0.5", () => {
    const d = createPlateDrive();
    expect(d.step(audio({ trebAtt: 4, flux: 0.4 }), 0, 1, true, 0, NONE, DT).fizz).toBeCloseTo(1.2);
    expect(d.step(audio({ trebAtt: 0.5, flux: 0 }), 0, 1, true, 0, NONE, DT).fizz).toBe(0);
  });

  it("tilts with balance and bass, and stays exactly level for mono sources", () => {
    const d = createPlateDrive();
    let s = d.step(audio(), 0, 1, true, 0, NONE, DT);
    for (let i = 0; i < 300; i++) s = d.step(audio({ bassAtt: 1 }), 0, 1, true, 0, NONE, DT);
    expect([s.tiltX, s.tiltY]).toEqual([0, 0]);
    for (let i = 0; i < 600; i++) s = d.step(audio({ bassAtt: 3 }), 1, 1, true, 0, NONE, DT);
    expect(s.tiltX).toBeCloseTo(0.6, 3);
    expect(s.tiltY).toBeCloseTo(0.15, 3);
    for (let i = 0; i < 600; i++) s = d.step(audio({ bassAtt: 3 }), 1, 1, false, 0, NONE, DT);
    expect(s.tiltY).toBeCloseTo(0, 3);
  });

  it("treats missing fields as neutral", () => {
    const d = createPlateDrive();
    const s = d.step({ midAtt: NaN, rms: undefined, silent: false, trebAtt: undefined, flux: NaN, bassAtt: undefined }, 0, 1, true, 0, NONE, DT);
    expect(Number.isFinite(s.drive) && Number.isFinite(s.fizz) && Number.isFinite(s.tiltY)).toBe(true);
  });

  it("exports the pulse constants", () => {
    expect([K_PULSE, PULSE_TAU, PULSE_BASE, DRIVE_PEAK, DRIVE_KNEE, DRIVE_CEIL]).toEqual([1.5, 0.12, 0.4, 3, 1.25, 2]);
  });

  it("pulses the drive on a hit by 0.4 + 0.6·weight, decaying with τ 0.12 s, and to 0 on silence", () => {
    const steady = audio({ midAtt: 1, rms: 0.1 }); // drive 0.9
    // The pulse fills the headroom to the 3·reactivity cap smoothly.
    const pulsed = (/** @type {number} */ p) => 0.9 + 2.1 * Math.tanh((1.5 * p * 0.9) / 2.1);
    for (const w of [0, 0.5, 1]) {
      const d = createPlateDrive();
      for (let i = 0; i < 240; i++) d.step(steady, 0, 1, true, 1, NONE, DT);
      const p = 0.4 + 0.6 * w;
      let s = d.step(steady, 0, 1, true, 1, hit(true, w), DT);
      expect(s.pulse).toBeCloseTo(p, 9);
      expect(s.drive).toBeCloseTo(pulsed(p), 6);
      s = d.step(steady, 0, 1, true, 1, NONE, DT);
      expect(s.pulse).toBeCloseTo(p * Math.exp(-DT / 0.12), 9);
      expect(s.drive).toBeCloseTo(pulsed(s.pulse), 6);
      // a grow lifts it, a lighter hit doesn't lower it
      s = d.step(steady, 0, 1, true, 1, hit(false, 1, true), DT);
      expect(s.pulse).toBeCloseTo(1, 9);
      s = d.step(steady, 0, 1, true, 1, hit(true, 0), DT);
      expect(s.pulse).toBeCloseTo(Math.exp(-DT / 0.12), 9);
      s = d.step(audio({ silent: true }), 0, 1, true, 1, hit(true, 1), DT);
      expect(s.pulse).toBe(0);
    }
  });

  it("never drops below the unpulsed drive: the base kneels above 1.25·reactivity toward 2, and a hit fills the rest up to 3·reactivity", () => {
    for (const react of [0.5, 2]) {
      /** @param {number} rms */
      const settle = (rms) => {
        const d = createPlateDrive();
        const au = audio({ midAtt: 2, rms }); // base 1 + 4·rms (·reactivity), up to 2.5
        let s = d.step(au, 0, react, true, 1, NONE, DT);
        for (let i = 0; i < 240; i++) s = d.step(au, 0, react, true, 1, NONE, DT);
        const quiet = s.drive;
        return { quiet, light: d.step(au, 0, react, true, 1, hit(true, 0), DT).drive, full: d.step(au, 0, react, true, 1, hit(true, 1), DT).drive };
      };
      let last = 0;
      for (const rms of [0, 0.05, 0.125, 0.25, 0.375]) {
        const { quiet, light, full } = settle(rms);
        const base = Math.min(1 + 4 * rms, 2.5);
        if (base <= 1.25) expect(quiet).toBeCloseTo(base * react, 6); // untouched up to the knee
        else expect(quiet).toBeLessThan(Math.min(base, 2) * react);
        expect(quiet).toBeGreaterThan(last); // still louder for a louder song
        last = quiet;
        const kb = quiet;
        const head = 3 * react - kb;
        expect(full).toBeCloseTo(kb + head * Math.tanh((1.5 * kb) / head), 6);
        expect(light).toBeGreaterThan(kb); // a weightless hit shakes it too
        expect(full).toBeGreaterThanOrEqual(base * react - 1e-9); // a full hit at least the unkneed base (bbec764's drive)
        expect(full).toBeLessThanOrEqual(3 * react + 1e-9);
      }
    }
  });

  it("does not kneel the base with pulse gain 0", () => {
    const d = createPlateDrive();
    const loud = audio({ midAtt: 2, rms: 1 });
    let s = d.step(loud, 0, 2, true, 0, NONE, DT);
    for (let i = 0; i < 240; i++) s = d.step(loud, 0, 2, true, 0, hit(i % 20 === 0, 1), DT);
    expect(s.drive).toBeCloseTo(5, 6);
  });

  it("reproduces the unpulsed drive exactly with pulse gain 0", () => {
    const a = createPlateDrive();
    const b = createPlateDrive();
    for (let i = 0; i < 300; i++) {
      const au = audio({ midAtt: 1 + (i % 7) / 3, rms: (i % 5) / 10, silent: i % 97 > 90 });
      const sa = a.step(au, 0, 2, true, 0, i % 13 === 0 ? hit(true, 1) : NONE, DT).drive;
      expect(b.step(au, 0, 2, true, 0, NONE, DT).drive).toBe(sa);
    }
  });

  it("pulses the same at 60 and 144 fps", () => {
    /** @param {number} hz */
    const at = (hz) => {
      const d = createPlateDrive();
      /** @type {number[]} */ const samples = [];
      for (let i = 1; i <= hz; i++) {
        const s = d.step(audio(), 0, 1, true, 1, i === hz / 2 ? hit(true, 0.5) : NONE, 1 / hz);
        if (i === hz / 2 || i === (hz * 3) / 4 || i === hz) samples.push(s.pulse);
      }
      return samples;
    };
    const a = at(60);
    const b = at(144);
    for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(a[k], 9);
    expect(a[1]).toBeCloseTo(0.7 * Math.exp(-0.25 / 0.12), 9);
  });
});

describe("seedGrains", () => {
  it("scatters grains uniformly on the plate, at rest, deterministically", () => {
    const n = 4096;
    const a = seedGrains(new Float32Array(n * GRAIN_FLOATS), n);
    const b = seedGrains(new Float32Array(n * GRAIN_FLOATS), n);
    expect(a).toEqual(b);
    let sx = 0;
    for (let i = 0; i < n; i++) {
      const o = i * GRAIN_FLOATS;
      expect(a[o] > 0 && a[o] < 1 && a[o + 1] > 0 && a[o + 1] < 1).toBe(true);
      expect([a[o + 2], a[o + 3], a[o + 4], a[o + 5]]).toEqual([0, 0, 0, 0]);
      sx += a[o];
    }
    expect(sx / n).toBeCloseTo(0.5, 1);
  });
});
