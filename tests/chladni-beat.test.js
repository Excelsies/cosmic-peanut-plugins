// @ts-check
// @ts-expect-error -- a Node builtin (tests run in Node); the tsconfig has no @types/node.
import { readFileSync } from "node:fs";
// @ts-expect-error -- a Node builtin, as above.
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { binOf, BODY_HZ, createHits, FLAT_STEP, HIGH_HZ, LOW_HZ, MID_HZ, midSplit, MID_SPLIT } from "../src/lib/hits.js";
import { createHop } from "../src/lib/sand.js";

// Chladni's hops on real host analysis: excerpts and whole tracks (-full) of synthetic tracks
// (house, edm, pop-rock, beatbox, phonk) analysed by the host's own analyzer, at the analysis rate
// (512/48000 s), gzipped. Each fixture keeps the levels hits.js reads (dB of each low bin, of each
// mid sub-band, of the high band, of the body band above the low band, of the whole spectrum, and of
// each bin its flatness reads) plus the host's onset fields, and the track's true hits inside the
// scored window; the first 2 s only warm up the flux history. The replay feeds them the way the runtime does at 60 and 144 fps: each display frame
// gets the newest analysis frame (resent when none arrived) and carries any onset it skipped.

/**
 * @typedef {{ source: string, sampleRate: number, scored: [number, number], columns: string[],
 *   events: { kick: number[], snare: number[], hatOnly: number[], offBeat: number[], offBeatNoBass: number[] }, frames: number[][],
 *   bassHits?: [number, number][] }} Fixture
 */
/** @param {string} name @returns {Fixture} */
function fixture(name) {
  const url = new URL(`./fixtures/chladni-${name}.json.gz`, import.meta.url);
  return JSON.parse(gunzipSync(readFileSync(url)).toString("utf8"));
}
const SR = 48000;
const LOW0 = binOf(LOW_HZ[0], SR);
const LOW1 = binOf(LOW_HZ[1], SR);
const SPLIT = midSplit(SR);
const HIGH0 = binOf(HIGH_HZ[0], SR);
/** The body band's bins above the low band's top bin (which it shares). */
const BODY0 = LOW1 + 1;
/** The bins hits.js's flatness reads. */
const FLAT_BINS = /** @type {number[]} */ ([]);
for (let b = binOf(MID_HZ[0], SR); b <= binOf(MID_HZ[1], SR); b += FLAT_STEP) FLAT_BINS.push(b);
/** A bin outside every band, for the rest of the whole spectrum's level. */
const REST = 800;
const COLUMNS = ["t", "frameIndex", "onset", "onsetStrength", "onsetAge", "low1", "low2", "low3", "low4", "low5", "low6"];
for (let k = 1; k <= MID_SPLIT; k++) COLUMNS.push(`mid${k}`);
COLUMNS.push("high", "body", "full");
for (let k = 1; k <= FLAT_BINS.length; k++) COLUMNS.push(`flat${k}`);

const pow = (/** @type {number} */ db) => 10 ** (db / 10);
const amp = (/** @type {number} */ db) => Math.sqrt(pow(db));

/**
 * Rebuild a spectrum from a fixture row: each low bin, the flatness bins, each mid sub-band's rest
 * in one bin that hits.js's flatness skips, the high band and the body band (above the low band) in
 * one bin each, and the whole spectrum's rest in a bin outside every band.
 * @param {Float32Array} s @param {number[]} row
 */
function spectrumOf(s, row) {
  s.fill(0);
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    s[LOW0 + i] = amp(row[5 + i]);
    sum += pow(row[5 + i]);
  }
  const flat0 = 11 + MID_SPLIT + 3;
  FLAT_BINS.forEach((b, j) => (s[b] = amp(row[flat0 + j])));
  for (let k = 0; k < MID_SPLIT; k++) {
    let inBand = 0;
    for (const b of FLAT_BINS) if (b >= SPLIT[k] && b < SPLIT[k + 1]) inBand += s[b] ** 2;
    const rest = Math.max(0, pow(row[11 + k]) - inBand);
    s[FLAT_BINS.includes(SPLIT[k]) ? SPLIT[k] + 1 : SPLIT[k]] += Math.sqrt(rest);
    sum += pow(row[11 + k]);
  }
  s[HIGH0] = amp(row[11 + MID_SPLIT]);
  s[BODY0] = amp(row[12 + MID_SPLIT]);
  sum += pow(row[11 + MID_SPLIT]) + pow(row[12 + MID_SPLIT]);
  s[REST] = Math.sqrt(Math.max(0, pow(row[13 + MID_SPLIT]) - sum));
}

/**
 * Replay a fixture through createHits → createHop at Hop 1.
 * @param {Fixture} fx @param {number} fps @param {boolean} reduceFlashing
 * @returns {{ t: number, w: number }[]} hops in the scored window: display time and final weight
 */
function replay(fx, fps, reduceFlashing) {
  expect(fx.columns).toEqual(COLUMNS);
  const hits = createHits();
  const hop = createHop();
  const sr = fx.sampleRate;
  expect(sr).toBe(SR);
  expect(LOW1 - LOW0 + 1).toBe(6);
  expect([binOf(BODY_HZ[0], SR), binOf(BODY_HZ[1], SR)]).toEqual([LOW1, 17]);
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
    const row = F[cur];
    const [t, frameIndex, , strength, age] = row;
    spectrumOf(audio.spectrum, row);
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
  /** Onset frames that are not kicks: a stray hat-plus-bass onset, then two off-beat open hats. A kick
   * whose body or click shows a frame late hops up to 40 ms after it. */
  const NOT_KICKS = [7.8933, 8.2453, 8.736];

  for (const fps of RATES) {
    for (const rf of [true, false]) {
      it(`hops on each of the 7 kicks, 0–40 ms after it, and never on the off-beat onsets (${fps} fps, reduce flashing ${rf ? "on" : "off"})`, () => {
        const hops = replay(fx, fps, rf);
        expect(fx.events.kick).toHaveLength(7);
        fx.events.kick.forEach((k) => expect(hopsNear(hops, k, 0, 0.04)).toHaveLength(1));
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

// Whole tracks: hops on hats alone (no other event within 50 ms) stay within the design's shares, a
// hop 70–120 ms after another lands on a new kick, snare or clap (not the first hit's own tail), and
// on phonk the hop size follows the bass: kicks over hats and cowbells, and with the reference bass
// weight of the bass hit it lands on (offline analysis of the same WAV).
const near = (/** @type {number} */ t, /** @type {number[]} */ ev, lo = -0.05, hi = 0.05) => ev.some((e) => t - e >= lo && t - e <= hi);

/** Spearman rank correlation. @param {number[]} a @param {number[]} b */
function spearman(a, b) {
  /** @param {number[]} x */
  const rank = (x) => {
    const idx = x.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(x.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const m = (/** @type {number[]} */ x) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = m(ra);
  const mb = m(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

for (const [name, hatShare, kickShare] of /** @type {[string, number, number][]} */ ([
  ["house124-full", 0.02, 0.95],
  ["edm128-full", 0.25, 0.75],
  ["phonk130-full", 0.05, 0.8],
])) {
  describe(`Chladni hops over the whole ${name.replace("-full", "")} track`, () => {
    const fx = fixture(name);
    const beat = [...fx.events.kick, ...fx.events.snare];
    for (const fps of RATES) {
      it(`hops on ${100 * kickShare}% of the kicks, at most ${100 * hatShare}% on hats alone, and never twice on one hit (${fps} fps)`, () => {
        const hops = replay(fx, fps, true);
        expect(fx.events.kick.filter((k) => near(k, hops.map((h) => h.t), -0.06, 0.06)).length).toBeGreaterThanOrEqual(kickShare * fx.events.kick.length);
        const onHat = hops.filter((h) => near(h.t, fx.events.hatOnly) && !near(h.t, beat));
        expect(onHat.length).toBeLessThanOrEqual(hatShare * hops.length);
        // A hop 70–120 ms after another needs a beat hit of its own: one in its window (−40..+60 ms)
        // that is not also in the first hop's.
        const doubles = hops.filter((h, i) => {
          if (i === 0 || h.t - hops[i - 1].t >= 0.12) return false;
          const own = beat.filter((e) => h.t - e >= -0.04 && h.t - e <= 0.06);
          return !own.some((e) => !(hops[i - 1].t - e >= -0.04 && hops[i - 1].t - e <= 0.06));
        });
        expect(doubles.length).toBeLessThanOrEqual(0.03 * hops.length);
      });
    }
  });
}

describe("Chladni hop size over the whole phonk130 track", () => {
  const fx = fixture("phonk130-full");
  for (const fps of RATES) {
    it(`hardly hops on hats and cowbells over the ringing 808, and follows the reference bass weight (${fps} fps)`, () => {
      const hops = replay(fx, fps, true);
      // hats and cowbells with no kick, snare, clap or 808 note within 50 ms: over the ringing 808 alone
      const off = hops.filter((h) => near(h.t, fx.events.offBeatNoBass) && !near(h.t, [...fx.events.kick, ...fx.events.snare]));
      expect(off.length).toBeLessThanOrEqual(0.05 * hops.length);
      const bass = /** @type {[number, number][]} */ (fx.bassHits);
      /** @type {number[]} */ const w = [];
      /** @type {number[]} */ const ref = [];
      for (const h of hops) {
        let best = null;
        for (const b of bass) if (Math.abs(h.t - b[0]) <= 0.06 && (!best || Math.abs(h.t - b[0]) < Math.abs(h.t - best[0]))) best = b;
        if (best) {
          w.push(h.w);
          ref.push(best[1]);
        }
      }
      expect(w.length).toBeGreaterThan(40);
      expect(spearman(w, ref)).toBeGreaterThan(0.5);
    });
  }
});
