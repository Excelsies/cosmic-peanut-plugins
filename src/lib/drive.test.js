// @ts-check
import { describe, expect, it } from "vitest";
import { createDrive } from "./drive.js";
import { createControls, createFlock, resizeFlock, seedFlock } from "./flock.js";
import { createParamState, resolveParams } from "./murmuration-params.js";

const HX = 5.13;
const HY = 2.887;
const DT = 1 / 60;

/** @param {Partial<Record<string, any>>} [over] */
function frame(over = {}) {
  return {
    bands: new Float32Array(64), spectrum: new Float32Array(1024), waveform: new Float32Array(2048),
    left: null, right: null, rms: 0.2, peak: 0.5, bass: 1, mid: 1, treb: 1, bassAtt: 1, midAtt: 1,
    trebAtt: 1, onsetStrength: 0, onset: false, onsetAge: 10, bpm: 120, beatPhase: 0, centroid: 0.3,
    flux: 0, silent: false, frameIndex: 0, sampleRate: 48000, hostTime: 0, ...over,
  };
}

/** @param {Record<string, unknown>} [params] @param {boolean} [reduceMotion] */
function setup(params = {}, reduceMotion = false) {
  const f = createFlock();
  resizeFlock(f, HX, HY);
  seedFlock(f, 500, 1);
  const c = createControls();
  const p = createParamState();
  resolveParams({ sky: "dusk", ink: "#ece6da", flock: "4000", speed: 1, falcon: true, reactivity: 1, ...params }, "high", reduceMotion, p);
  const d = createDrive();
  return { f, c, p, d };
}

describe("createDrive", () => {
  it("handles a silent all-zero frame without NaN, gliding wide and calm", () => {
    const { f, c, p, d } = setup();
    const loud = setup();
    const silent = frame({ rms: 0, peak: 0, bass: 0, mid: 0, treb: 0, bassAtt: 0, midAtt: 0, trebAtt: 0, bpm: 0, centroid: 0, silent: true, onsetAge: 10 });
    for (let i = 0; i < 300; i++) {
      d.step(silent, i * DT, DT, p, true, f, c, HX, HY);
      loud.d.step(frame(), i * DT, DT, loud.p, true, loud.f, loud.c, HX, HY);
    }
    for (const v of Object.values(c)) if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
    expect(c.cruise).toBeLessThan(loud.c.cruise * 0.7);
    expect(c.radius).toBeGreaterThan(loud.c.radius * 1.3);
    expect(c.cohesion).toBeCloseTo(loud.c.cohesion * 0.5, 1);
    expect(d.out.squeeze).toBe(0);
    expect(d.out.shimmer).toBe(0);
  });

  it("starts a falcon strike on a strong onset, with an audio-accurate wave origin time", () => {
    const { f, c, p, d } = setup();
    d.step(frame(), 0, DT, p, true, f, c, HX, HY);
    d.step(frame({ onset: true, onsetStrength: 0.9, onsetAge: 0.01 }), 1, DT, p, true, f, c, HX, HY);
    expect(c.wave0).toBe(true);
    expect(c.wave0r).toBeCloseTo(1.6 * 0.01, 9);
    expect(d.out.falconVisible).toBe(true);
    expect(c.falcon).toBe(true);
    d.step(frame(), 1.5, DT, p, true, f, c, HX, HY);
    expect(c.wave0r).toBeCloseTo(1.6 * 0.51, 9);
    d.step(frame(), 1.7, DT, p, true, f, c, HX, HY);
    expect(d.out.falconVisible).toBe(false);
    expect(c.falcon).toBe(false);
  });

  it("starts a weaker wave for onsets that don't strike", () => {
    const { f, c, p, d } = setup({ falcon: false });
    d.step(frame({ onset: true, onsetStrength: 0.9, onsetAge: 0 }), 1, DT, p, true, f, c, HX, HY);
    expect(c.wave0).toBe(false);
    expect(c.wave1).toBe(true);
    expect(c.wave1kick).toBeCloseTo(0.075, 9);
    expect(d.out.wave1Amp).toBe(0); // shows from the next frame
    d.step(frame(), 1 + DT, DT, p, true, f, c, HX, HY);
    expect(d.out.wave1Amp).toBeCloseTo(0.5, 2);
    expect(d.out.falconVisible).toBe(false);
  });

  it("with Reduce motion keeps the wave but drops the falcon's flee burst", () => {
    const { f, c, p, d } = setup({}, true);
    d.step(frame({ onset: true, onsetStrength: 0.9, onsetAge: 0 }), 1, DT, p, true, f, c, HX, HY);
    expect(c.wave0).toBe(true);
    expect(c.falcon).toBe(false);
    expect(d.out.falconVisible).toBe(false);
  });

  it("biases the flock sideways by the stereo balance, and not at all for identical channels", () => {
    const l = new Float32Array(2048);
    const r = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) {
      l[i] = 0.2 * Math.sin(i * 0.1);
      r[i] = 0.6 * Math.sin(i * 0.1);
    }
    const a = setup();
    const b = setup();
    for (let i = 0; i < 240; i++) {
      a.d.step(frame({ left: l, right: r }), i * DT, DT, a.p, true, a.f, a.c, HX, HY);
      b.d.step(frame({ left: l, right: l }), i * DT, DT, b.p, true, b.f, b.c, HX, HY);
    }
    expect(a.c.ax - b.c.ax).toBeGreaterThan(0.25 * 0.6 * HX);
    expect(b.d.out.balance).toBe(0);
  });

  it("caps wave darkening rises at 3 per second for a 10 Hz onset train with reduceFlashing", () => {
    /** @param {boolean} rf */
    const run = (rf) => {
      const { f, c, p, d } = setup({ falcon: false });
      const out = [];
      for (let i = 0; i < 240; i++) {
        const onset = i % 6 === 0;
        d.step(frame({ onset, onsetStrength: 0.9, onsetAge: 0 }), i * DT, DT, p, rf, f, c, HX, HY);
        out.push(d.out.wave1Amp);
      }
      return out;
    };
    /** @param {number[]} v */
    const rises = (v) => {
      let n = 0;
      let lo = v[0];
      let maxIn1s = 0;
      /** @type {number[]} */
      const at = [];
      for (let i = 1; i < v.length; i++) {
        lo = Math.min(lo, v[i - 1]);
        if (v[i] - v[i - 1] > 0.05) {
          at.push(i * DT);
          n++;
          lo = v[i];
        }
      }
      for (let i = 0; i < at.length; i++) {
        let k = 0;
        for (let j = i; j < at.length && at[j] - at[i] < 1 - 1e-6; j++) k++; // rises ≥ 1/3 s apart: 3 in any open 1 s window
        maxIn1s = Math.max(maxIn1s, k);
      }
      return { n, maxIn1s };
    };
    expect(rises(run(false)).maxIn1s).toBeGreaterThan(3);
    const lim = rises(run(true));
    expect(lim.n).toBeGreaterThan(3);
    expect(lim.maxIn1s).toBeLessThanOrEqual(3);
  });
});
