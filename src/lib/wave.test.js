// @ts-check
import { describe, expect, it } from "vitest";
import { createWaves, inShell, onsetTime, SHELL, WAVE_SPEED, waveRadius } from "./wave.js";

describe("agitation wave", () => {
  it("grows at 1.6 units per second of audio time since the onset", () => {
    expect(WAVE_SPEED).toBe(1.6);
    expect(waveRadius(3.5, 3)).toBeCloseTo(0.8, 12);
    expect(waveRadius(2, 3)).toBe(0);
  });

  it("gives the same radius at the same audio time at 60 and 120 Hz, even for a carried-forward onset", () => {
    const onsetAt = 1.0;
    // The onset is first seen on the next display frame, whose onsetAge says how long ago it was.
    const seen60 = 1 + 1 / 60;
    const seen120 = 1 + 1 / 120;
    const carried = 1.05; // replaced audio frame: seen late, with a larger onsetAge
    const t60 = onsetTime(seen60, seen60 - onsetAt);
    const t120 = onsetTime(seen120, seen120 - onsetAt);
    const tc = onsetTime(carried, carried - onsetAt);
    for (const now of [1.2, 1.5, 3]) {
      expect(waveRadius(now, t60)).toBeCloseTo(WAVE_SPEED * (now - onsetAt), 9);
      expect(waveRadius(now, t120)).toBeCloseTo(waveRadius(now, t60), 9);
      expect(waveRadius(now, tc)).toBeCloseTo(waveRadius(now, t60), 9);
    }
  });

  it("treats a missing or implausible onsetAge as now", () => {
    expect(onsetTime(2, NaN)).toBe(2);
    expect(onsetTime(2, /** @type {any} */ (undefined))).toBe(2);
    expect(onsetTime(2, -1)).toBe(2);
    expect(onsetTime(20, 10)).toBe(20); // the contract's "no onset yet"
    expect(onsetTime(20, 0.25)).toBe(19.75);
  });

  it("selects birds in the shell [r - w, r]", () => {
    expect(SHELL).toBe(0.12);
    expect(inShell(1.0, 1.0, SHELL)).toBe(true);
    expect(inShell(0.88, 1.0, SHELL)).toBe(true);
    expect(inShell(0.87, 1.0, SHELL)).toBe(false);
    expect(inShell(1.01, 1.0, SHELL)).toBe(false);
  });

  it("runs waves in slots that end once the shell has left the frame", () => {
    const w = createWaves();
    w.start(0, 0.5, -0.2, 1, 1);
    expect(w.slots[0].active).toBe(true);
    w.update(2, 4);
    expect(w.slots[0].radius).toBeCloseTo(1.6, 9);
    expect(w.slots[0].active).toBe(true);
    w.update(1 + 4.1 / 1.6, 4);
    expect(w.slots[0].active).toBe(false);
    const id = w.slots[0].id;
    w.start(0, 0, 0, 5, 0.5);
    expect(w.slots[0].id).toBe(id + 1);
    expect(w.slots[0].amp).toBe(0.5);
  });
});
