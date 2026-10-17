// @ts-check
// @ts-expect-error -- a Node builtin (tests run in Node); the tsconfig has no @types/node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { binOf, createHits, HIGH_HZ, LOW_HZ, MID_HZ } from "../src/lib/hits.js";
import { createHop } from "../src/lib/sand.js";

// Chladni's hops on real host analysis: excerpts of synthetic tracks (house, pop-rock, beatbox,
// phonk) analysed by the host's own analyzer, at the analysis rate (512/48000 s). Each fixture
// keeps the band levels hits.js reads (dB over its low, mid and high bins) plus the host's onset
// fields, and the track's true hits inside the scored window; the first 2 s only warm up the flux
// history. The replay feeds them the way the runtime does at 60 and 144 fps: each display frame
// gets the newest analysis frame (resent when none arrived) and carries any onset it skipped.

/**
 * @typedef {{ source: string, sampleRate: number, scored: [number, number], columns: string[],
 *   events: { kick: number[], snare: number[], hatOnly: number[] }, frames: number[][] }} Fixture
 */
/** @param {string} name @returns {Fixture} */
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/chladni-${name}.json`, import.meta.url), "utf8"));

const amp = (/** @type {number} */ db) => Math.sqrt(10 ** (db / 10));

/**
 * Replay a fixture through createHits → createHop at Hop 1.
 * @param {Fixture} fx @param {number} fps @param {boolean} reduceFlashing
 * @returns {{ t: number, w: number }[]} hops in the scored window: display time and final weight
 */
function replay(fx, fps, reduceFlashing) {
  expect(fx.columns).toEqual(["t", "frameIndex", "onset", "onsetStrength", "onsetAge", "low", "mid", "high"]);
  const hits = createHits();
  const hop = createHop();
  const sr = fx.sampleRate;
  const bins = [binOf(LOW_HZ[0], sr), binOf(MID_HZ[0], sr), binOf(HIGH_HZ[0], sr)];
  const audio = { spectrum: new Float32Array(1024), sampleRate: sr, frameIndex: -1, hostTime: 0, silent: false, onset: false, onsetStrength: 0, onsetAge: 10 };
  /** @type {{ t: number, w: number }[]} */ const hops = [];
  const F = fx.frames;
  const t0 = F[0][0];
  let next = 0;
  let latched = -1;
  let cur = -1;
  let seq = 0;
  const end = F[F.length - 1][0];
  for (let k = 1; t0 + k / fps <= end; k++) {
    const now = t0 + k / fps;
    let fresh = false;
    while (next < F.length && F[next][0] <= now) {
      if (F[next][2] === 1 && latched < 0) latched = next;
      cur = next++;
      fresh = true;
    }
    const [t, frameIndex, , strength, age, low, mid, high] = F[cur];
    audio.spectrum.fill(0);
    audio.spectrum[bins[0]] = amp(low);
    audio.spectrum[bins[1]] = amp(mid);
    audio.spectrum[bins[2]] = amp(high);
    audio.frameIndex = frameIndex;
    audio.hostTime = t;
    audio.onsetAge = age;
    audio.onsetStrength = strength;
    audio.onset = fresh && latched >= 0;
    if (audio.onset) {
      audio.onsetStrength = F[latched][3];
      latched = -1;
    }
    const h = hop.step(hits.step(audio), 1, 1 / fps, reduceFlashing);
    if (h.seq !== seq) {
      seq = h.seq;
      if (now >= fx.scored[0] && now <= fx.scored[1]) hops.push({ t: now, w: hits.out.weight });
      else hops.push({ t: -1, w: 0 });
    } else if (hits.out.grow && hops.length) hops[hops.length - 1].w = hits.out.weight;
  }
  return hops.filter((x) => x.t >= 0);
}

/** Hops with hop − t in [lo, hi] s. @template {{ t: number }} T @param {T[]} hops @param {number} t @returns {T[]} */
const hopsNear = (hops, t, lo = -0.06, hi = 0.06) => hops.filter((h) => h.t - t >= lo && h.t - t <= hi);

const RATES = [60, 144];

describe("Chladni hops on the house124 trace", () => {
  const fx = fixture("house124");
  /** Onset frames that are not kicks: a stray hat-plus-bass onset, then two off-beat open hats. */
  const NOT_KICKS = [7.8933, 8.2453, 8.736];

  for (const fps of RATES) {
    for (const rf of [true, false]) {
      it(`hops on each of the 7 kicks, 0–30 ms after it, and never on the off-beat onsets (${fps} fps, reduce flashing ${rf ? "on" : "off"})`, () => {
        const hops = replay(fx, fps, rf);
        expect(fx.events.kick).toHaveLength(7);
        fx.events.kick.forEach((k) => expect(hopsNear(hops, k, 0, 0.03)).toHaveLength(1));
        for (const t of NOT_KICKS) expect(hopsNear(hops, t, -0.03, 0.03)).toHaveLength(0);
      });
    }
  }
});

// Pop-rock kicks sit on legato bass-guitar 8ths, so some rise too little to fire: over the whole
// track 82–87% hop, and on these 30 s 76–84% depending on where the display frames fall.
for (const [name, share] of /** @type {[string, number][]} */ ([["poprock120", 0.75], ["beatbox96", 0.8]])) {
  describe(`Chladni hops on the ${name} trace`, () => {
    const fx = fixture(name);
    for (const fps of RATES) {
      it(`hops on ${100 * share}% of the kicks and every snare, and never on a hat alone (${fps} fps)`, () => {
        const hops = replay(fx, fps, true);
        const kicks = fx.events.kick.filter((k) => hopsNear(hops, k).length > 0);
        expect(kicks.length).toBeGreaterThanOrEqual(share * fx.events.kick.length);
        for (const s of fx.events.snare) expect(hopsNear(hops, s).length).toBeGreaterThan(0);
        for (const h of fx.events.hatOnly) expect(hopsNear(hops, h, -0.05, 0.05)).toHaveLength(0);
      });
    }
  });
}

describe("Chladni hop size on the poprock120 trace", () => {
  it("weighs the kicks heavier than the snares", () => {
    const fx = fixture("poprock120");
    for (const fps of RATES) {
      const hops = replay(fx, fps, true);
      /** @param {number[]} times */
      const meanW = (times) => {
        const ws = times.flatMap((t) => hopsNear(hops, t).map((h) => h.w));
        return ws.reduce((a, b) => a + b, 0) / ws.length;
      };
      expect(meanW(fx.events.kick)).toBeGreaterThan(meanW(fx.events.snare) + 0.1);
    }
  });
});

describe("Chladni hops on the phonk130 trace", () => {
  const fx = fixture("phonk130");
  for (const fps of RATES) {
    it(`hops on 85% of the kicks, and at most 15% of hops land on a hat alone (${fps} fps)`, () => {
      const hops = replay(fx, fps, true);
      const kicks = fx.events.kick.filter((k) => hopsNear(hops, k).length > 0);
      expect(kicks.length).toBeGreaterThanOrEqual(0.85 * fx.events.kick.length);
      const near = (/** @type {number} */ t, /** @type {number[]} */ ev) => ev.some((e) => Math.abs(t - e) <= 0.05);
      const onHat = hops.filter((h) => near(h.t, fx.events.hatOnly) && !near(h.t, fx.events.kick) && !near(h.t, fx.events.snare));
      expect(onHat.length).toBeLessThanOrEqual(0.15 * hops.length);
    });
  }
});
