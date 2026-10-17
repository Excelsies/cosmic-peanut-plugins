// @ts-check
// @ts-expect-error -- a Node builtin (tests run in Node); the tsconfig has no @types/node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createKick } from "../src/lib/kick.js";
import { createHop } from "../src/lib/sand.js";

// Chladni's hop trigger on real host analysis: 3 s of a synthetic 124 bpm house track (kick on
// every beat, open hat plus a bass note on every off-beat, closed 8th hats), analysed by the host's
// own analyzer and cut at the analysis rate (dt = 512/48000). Before the kick rule, every generic
// onset asked for a hop; with reduce flashing the limiter then kept whichever came first, and one
// stray onset at 7.8933 s moved the whole chain onto the off-beat open hats.

/** @type {{ dt: number, columns: string[], frames: number[][] }} */
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/chladni-house124.json", import.meta.url), "utf8"));
/** The kicks the track was built from (s). */
const KICKS = [7.508063, 7.991937, 8.475812, 8.959687, 9.443542, 9.927417, 10.411292];
const HOPS = [7.52, 8.0107, 8.4907, 8.9813, 9.4613, 9.9413, 10.432];
/** Onset frames that are not kicks: the stray hat-plus-bass onset, then two off-beat open hats. */
const NOT_KICKS = [7.8933, 8.2453, 8.736];

/** Feed the fixture through createKick → createHop at Hop 1. @param {boolean} reduceFlashing */
function replay(reduceFlashing) {
  const kick = createKick();
  const hop = createHop();
  const audio = { onset: false, onsetStrength: 0, bass: 0, treb: 0, silent: false };
  /** @type {number[]} */ const kicks = [];
  /** @type {number[]} */ const hops = [];
  /** @type {Map<number, boolean>} */ const onsetKick = new Map();
  let lastOnset = -1;
  for (const [t, onset, strength, bass, treb] of FIXTURE.frames) {
    audio.onset = onset === 1;
    audio.onsetStrength = strength;
    audio.bass = bass;
    audio.treb = treb;
    if (audio.onset) {
      lastOnset = t;
      onsetKick.set(t, false);
    }
    const k = kick.step(audio, FIXTURE.dt);
    if (k) {
      kicks.push(t);
      onsetKick.set(lastOnset, true);
    }
    if (hop.step(k, kick.strength, 1, FIXTURE.dt, reduceFlashing).impulse > 0) hops.push(t);
  }
  return { kicks, hops, onsetKick };
}

describe("Chladni hops on the house124 trace", () => {
  it("has the columns the replay reads", () => {
    expect(FIXTURE.columns.slice(0, 5)).toEqual(["t", "onset", "onsetStrength", "bass", "treb"]);
    expect(FIXTURE.frames.length).toBe(281);
  });

  for (const reduceFlashing of [true, false]) {
    it(`hops on every kick, 11–22 ms after it, reduce flashing ${reduceFlashing ? "on" : "off"}`, () => {
      const { hops } = replay(reduceFlashing);
      expect(hops).toHaveLength(HOPS.length);
      hops.forEach((t, i) => {
        expect(t).toBeCloseTo(HOPS[i], 4);
        expect(t - KICKS[i]).toBeGreaterThanOrEqual(0.011);
        expect(t - KICKS[i]).toBeLessThanOrEqual(0.022);
      });
    });
  }

  it("rejects the stray onset and the open hats that used to take the hop", () => {
    const { onsetKick } = replay(true);
    for (const t of NOT_KICKS) expect(onsetKick.get(t)).toBe(false);
  });

  it("confirms kicks only right after a real kick", () => {
    const { kicks } = replay(true);
    for (const t of kicks) expect(KICKS.some((k) => t - k >= 0 && t - k <= 0.03)).toBe(true);
  });
});
