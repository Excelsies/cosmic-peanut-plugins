// @ts-check
import { describe, expect, it } from "vitest";
import { BASS_RISE, createKick, KICK_WINDOW, TREB_LEAD } from "./kick.js";

const DT = 1 / 60;

/** @param {any} bass @param {any} treb @param {Partial<Record<string, any>>} over */
const frame = (bass, treb, over = {}) => ({ onset: false, onsetStrength: 0, bass, treb, silent: false, ...over });

/** Step a kick detector through frames, collecting its answers. @param {ReturnType<typeof createKick>} k @param {any[]} frames */
const run = (k, frames, dt = DT) => frames.map((f) => k.step(f, dt));

describe("createKick", () => {
  it("exports the rule's constants", () => {
    expect([KICK_WINDOW, BASS_RISE, TREB_LEAD]).toEqual([0.05, 1.6, 2]);
  });

  it("confirms an onset whose bass rises 1.6× on a later frame", () => {
    const k = createKick();
    expect(run(k, [frame(1, 1), frame(1, 1, { onset: true, onsetStrength: 1 }), frame(2, 1)])).toEqual([false, false, true]);
  });

  it("vetoes a hit whose treble rises more than twice as much as its bass, and stays closed", () => {
    const k = createKick();
    const got = run(k, [frame(1, 1), frame(1, 1, { onset: true }), frame(2, 5), frame(3, 1), frame(3, 1)]);
    expect(got).toEqual([false, false, false, false, false]);
  });

  it("accepts a treble rise of exactly twice the bass rise", () => {
    const k = createKick();
    expect(run(k, [frame(1, 1), frame(1, 1, { onset: true }), frame(2, 4)])).toEqual([false, false, true]);
  });

  it("ignores a bass rise under 1.6×", () => {
    const k = createKick();
    const got = run(k, [frame(1, 1), frame(1, 1, { onset: true }), frame(1.5, 1), frame(1.55, 1), frame(1.55, 1)]);
    expect(got).toEqual([false, false, false, false, false]);
  });

  it("waits up to 50 ms of summed dt after the onset, at any frame rate", () => {
    /** @param {number} at frame index (onset = 0) where the bass doubles @param {number} dt */
    const confirmsAt = (at, dt) => {
      const k = createKick();
      k.step(frame(1, 1), dt);
      let hit = false;
      for (let i = 0; i <= at; i++) hit = k.step(frame(i === at ? 2 : 1, 1, { onset: i === 0 }), dt);
      return hit;
    };
    expect(confirmsAt(3, 1 / 60)).toBe(true); // 50 ms
    expect(confirmsAt(4, 1 / 60)).toBe(false); // 66.7 ms
    expect(confirmsAt(6, 1 / 120)).toBe(true); // 50 ms
    expect(confirmsAt(7, 1 / 120)).toBe(false);
  });

  it("times the window from the onset frame with uneven frame times", () => {
    // The onset frame's own dt is time before the onset: it must not count against the window.
    /** @param {number[]} dts dt of the frame before, the onset frame, then each later frame; the last one doubles the bass */
    const confirmsLast = (dts) => {
      const k = createKick();
      k.step(frame(1, 1), dts[0]);
      let hit = false;
      for (let i = 1; i < dts.length; i++) hit = k.step(frame(i === dts.length - 1 ? 2 : 1, 1, { onset: i === 1 }), dts[i]);
      return hit;
    };
    expect(confirmsLast([1 / 60, 0.1, 1 / 60])).toBe(true); // a hitch just before the onset: 16.7 ms after it
    expect(confirmsLast([1 / 60, 0.001, 0.02, 0.02, 0.02])).toBe(false); // 60 ms after the onset
    expect(confirmsLast([1 / 60, 0.001, 0.02, 0.02, 0.01])).toBe(true); // 50 ms after the onset
  });

  it("counts a NaN or negative dt as no time", () => {
    const k = createKick();
    expect(run(k, [frame(1, 1)])).toEqual([false]);
    expect(k.step(frame(1, 1, { onset: true }), NaN)).toBe(false);
    expect(k.step(frame(1, 1), NaN)).toBe(false);
    expect(k.step(frame(1, 1), -1)).toBe(false);
    expect(k.step(frame(2, 1), DT)).toBe(true);
  });

  it("confirms on the onset frame itself when the bass has already jumped", () => {
    const k = createKick();
    expect(run(k, [frame(1, 1), frame(2, 1, { onset: true })])).toEqual([false, true]);
  });

  it("floors the pre-onset levels at 0.15, so near-silence needs a real rise", () => {
    const k = createKick();
    expect(run(k, [frame(0.01, 0.01), frame(0.01, 0.01, { onset: true }), frame(0.2, 0.01)])).toEqual([false, false, false]);
    const k2 = createKick();
    expect(run(k2, [frame(0.01, 0.01), frame(0.01, 0.01, { onset: true }), frame(0.3, 0.01)])).toEqual([false, false, true]);
  });

  it("latches the onset frame's strength, clamped to 0–1", () => {
    const k = createKick();
    run(k, [frame(1, 1), frame(1, 1, { onset: true, onsetStrength: 0.8 }), frame(2, 1, { onsetStrength: 0.3 })]);
    expect(k.strength).toBe(0.8);
    run(k, [frame(1, 1), frame(1, 1, { onset: true, onsetStrength: 1.7 }), frame(2, 1)]);
    expect(k.strength).toBe(1);
    run(k, [frame(1, 1), frame(1, 1, { onset: true, onsetStrength: -1 }), frame(2, 1)]);
    expect(k.strength).toBe(0);
  });

  it("keeps the last kick's strength through a vetoed hit", () => {
    const k = createKick();
    run(k, [frame(1, 1), frame(1, 1, { onset: true, onsetStrength: 0.8 }), frame(2, 1)]);
    run(k, [frame(1, 1), frame(1, 1, { onset: true, onsetStrength: 0.2 }), frame(2, 9)]);
    expect(k.strength).toBe(0.8);
  });

  it("reads silent frames as 0 and survives missing or non-finite levels", () => {
    const k = createKick();
    // Silent frames carry stale levels: they must not form the baseline or confirm a rise.
    expect(run(k, [frame(5, 5, { silent: true }), frame(5, 5, { silent: true, onset: true }), frame(5, 5, { silent: true })])).toEqual([
      false,
      false,
      false,
    ]);
    const k2 = createKick();
    const odd = [
      frame(NaN, NaN),
      frame(NaN, NaN, { onset: true, onsetStrength: NaN }),
      frame(Infinity, 1),
      { onset: true, onsetStrength: undefined, bass: undefined, treb: undefined, silent: undefined },
      frame(undefined, undefined),
    ];
    expect(run(k2, odd)).toEqual([false, false, false, false, false]);
    expect(Number.isFinite(k2.strength)).toBe(true);
  });

  it("re-arms on a second onset inside the window with the baseline at that frame", () => {
    const k = createKick();
    const got = run(k, [
      frame(1, 1),
      frame(1, 1, { onset: true }),
      frame(1.2, 1),
      frame(1.5, 1, { onset: true }), // new baseline 1.2: needs 1.92
      frame(1.7, 1), // would have confirmed against the old baseline 1
      frame(2, 1),
    ]);
    expect(got).toEqual([false, false, false, false, false, true]);
  });

  it("judges no onset on its first frame: there is no pre-onset level yet", () => {
    const k = createKick();
    expect(run(k, [frame(2, 1, { onset: true }), frame(3, 1), frame(3, 1)])).toEqual([false, false, false]);
    expect(run(k, [frame(1, 1), frame(1, 1, { onset: true }), frame(2, 1)])).toEqual([false, false, true]);
  });

  it("returns false without an onset however much the bass jumps", () => {
    const k = createKick();
    expect(run(k, [frame(0.2, 1), frame(3, 1), frame(0.2, 1), frame(3, 1)])).toEqual([false, false, false, false]);
  });
});
