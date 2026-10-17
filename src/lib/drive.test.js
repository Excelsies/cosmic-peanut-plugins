// @ts-check
import { describe, expect, it } from "vitest";
import { createDrive } from "./drive.js";
import { createControls, createFlock, resizeFlock, seedFlock, stepFlock } from "./flock.js";
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

  it("spreads the default 4000-bird flock wide enough to read as one large silhouette", () => {
    const f = createFlock();
    resizeFlock(f, HX, HY);
    seedFlock(f, 4000, 1);
    const c = createControls();
    const p = createParamState();
    resolveParams({ sky: "dusk", ink: "#ece6da", flock: "4000", speed: 1, falcon: true, reactivity: 1 }, "high", false, p);
    const d = createDrive();
    let mean = 0;
    let samples = 0;
    for (let i = 0; i < 720; i++) {
      d.step(frame({ beatPhase: (i % 30) / 30 }), i * DT, DT, p, true, f, c, HX, HY);
      stepFlock(f, c);
      if (i < 360 || i % 30 !== 0) continue;
      let sum = 0;
      for (let j = 0; j < f.n; j++) sum += Math.hypot(f.px[j] - f.cx, f.py[j] - f.cy);
      mean += sum / f.n;
      samples++;
    }
    expect(mean / samples).toBeGreaterThan(0.34); // 0.29 at the earlier R0 0.75
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

  it("keeps the strike band steady while weak onsets arrive at 7.5 Hz", () => {
    /** @param {boolean} rf */
    const run = (rf) => {
      const { f, c, p, d } = setup();
      let life = 0;
      let shown = 0;
      let toggles = 0;
      let prevOn = false;
      let lastId = 0;
      let rises = /** @type {number[]} */ ([]);
      let prev0 = 0;
      let prev1 = 0;
      for (let i = 0; i < 450; i++) {
        const onset = i % 8 === 0;
        const strong = i % 120 === 0;
        d.step(frame({ onset, onsetStrength: strong ? 0.9 : 0.2, onsetAge: 0 }), i * DT, DT, p, rf, f, c, HX, HY);
        const a0 = d.out.wave0Amp;
        const a1 = d.out.wave1Amp;
        if (a0 - prev0 > 0.02 || a1 - prev1 > 0.02) rises.push(i * DT);
        prev0 = a0;
        prev1 = a1;
        // The band's life starts the frame after its strike (the restart frame is a fall).
        if (c.wave0 && c.wave0id === lastId) {
          life++;
          const on = a0 > 0;
          if (on) shown++;
          if (on !== prevOn) toggles++;
          prevOn = on;
        } else {
          lastId = c.wave0id;
          prevOn = true;
        }
      }
      let maxIn1s = 0;
      for (let i = 0; i < rises.length; i++) {
        let k = 0;
        for (let j = i; j < rises.length && rises[j] - rises[i] < 1 - 1e-6; j++) k++;
        maxIn1s = Math.max(maxIn1s, k);
      }
      return { life, shown, toggles, maxIn1s };
    };
    const off = run(false);
    expect(off.life).toBeGreaterThan(300);
    expect(off.shown).toBe(off.life);
    expect(off.toggles).toBe(0);
    const on = run(true);
    expect(on.shown).toBeGreaterThan(on.life * 0.95);
    expect(on.toggles).toBe(0);
    expect(on.maxIn1s).toBeLessThanOrEqual(3); // both slots together
  });

  it("caps weak-band rises at 2 per second for a 10 Hz onset train with reduceFlashing, and never blinks without it", () => {
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
    // Without reduceFlashing each restart just moves the band back to its origin: no blink.
    const free = run(false);
    expect(Math.min(...free.slice(1))).toBeGreaterThan(0.4);
    const lim = rises(run(true));
    expect(lim.n).toBeGreaterThan(3);
    expect(lim.maxIn1s).toBeLessThanOrEqual(2); // weak bands; a strike may add one more
  });
});
