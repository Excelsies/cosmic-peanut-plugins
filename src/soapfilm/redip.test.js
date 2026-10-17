// @ts-check
import { describe, expect, it } from "vitest";
import { createBeatClock } from "../lib/beatclock.js";
import { createRedip, WIPE_SECONDS } from "./redip.js";

const DT = 1 / 60;

/**
 * Run the controller and return the times and beat counts of its re-dips.
 * @param {{ seconds: number, bpm: number, mode: number, drain?: number, age?: number }} o
 */
function run({ seconds, bpm, mode, drain = 1, age = 0 }) {
  const r = createRedip(age);
  const meter = createBeatClock();
  /** @type {{ t: number, beats: number }[]} */
  const dips = [];
  for (let n = 1; n * DT <= seconds + 1e-9; n++) {
    const t = n * DT;
    const beats = meter.step(bpm, bpm > 0 ? (t * bpm / 60) % 1 : 0, DT);
    if (r.step(DT, drain, beats, bpm, mode)) dips.push({ t, beats });
  }
  return { r, dips };
}

describe("re-dip", () => {
  it("dips every 16 bars: at beats 64 and 128", () => {
    const { dips } = run({ seconds: 70, bpm: 120, mode: 0 });
    expect(dips.length).toBe(2);
    expect(dips[0].beats).toBeCloseTo(64, 0);
    expect(dips[1].beats).toBeCloseTo(128, 0);
  });

  it("dips every 32 bars with that option", () => {
    const { dips } = run({ seconds: 70, bpm: 120, mode: 1 });
    expect(dips.map((d) => Math.round(d.beats))).toEqual([128]);
  });

  it("keeps at least 8 s between re-dips", () => {
    const { dips } = run({ seconds: 60, bpm: 960, mode: 0 }); // 16 bars every 4 s
    expect(dips.length).toBeGreaterThan(3);
    for (let i = 1; i < dips.length; i++) expect(dips[i].t - dips[i - 1].t).toBeGreaterThanOrEqual(8 - 1e-9);
  });

  it("always dips once the black film covers 45%", () => {
    const { dips } = run({ seconds: 200, bpm: 0, mode: 2 });
    expect(dips.length).toBe(1);
    expect(dips[0].t).toBeGreaterThan(140);
    expect(dips[0].t).toBeLessThan(170);
  });

  it("dips after 40 s without a tempo", () => {
    const { dips } = run({ seconds: 85, bpm: 0, mode: 0 });
    expect(dips.map((d) => Math.round(d.t))).toEqual([40, 80]);
  });

  it("ignores bars on 'when black'", () => {
    const { dips } = run({ seconds: 100, bpm: 120, mode: 2 });
    expect(dips).toEqual([]);
  });

  it("wipes the film up from the bottom over 1.2 s, then restarts the age", () => {
    const r = createRedip(50);
    r.trigger();
    expect(r.front).toBe(1);
    const fronts = [];
    for (let i = 1; i < Math.round(WIPE_SECONDS / DT); i++) {
      r.step(DT, 1, 0, 0, 2);
      fronts.push(r.front);
    }
    for (let i = 1; i < fronts.length; i++) expect(fronts[i]).toBeLessThan(fronts[i - 1]);
    expect(r.age).toBeGreaterThan(50); // the old film keeps draining above the front
    r.step(DT, 1, 0, 0, 2);
    expect(r.wiping).toBe(false);
    expect(r.front).toBe(2);
    expect(r.age).toBeLessThan(DT + 1e-9);
  });
});
