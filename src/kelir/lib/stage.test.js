// @ts-check
import { describe, expect, it } from "vitest";
import { resolveParams } from "./kelir-params.js";
import { KAYON_REST, PUPPET_REST, SILENCE_HOLD, createStage, lungeEnvelope, penumbra } from "./stage.js";

const DEFAULTS = { screen: "lamp", cast: "duet", reactivity: 1, flicker: 0.5, blur: 1, lace: 1, scenes: true };
/** @param {Record<string, unknown>} [over] @param {boolean} [reduce] */
const params = (over = {}, reduce = false) => resolveParams({ ...DEFAULTS, ...over }, reduce, {});

/** A quiet, non-silent audio frame; override fields per call. */
function audio(/** @type {Record<string, unknown>} */ over = {}) {
  return /** @type {import('../../../tidalviz').AudioFrame} */ (
    /** @type {unknown} */ ({
      bands: new Float32Array(64),
      spectrum: new Float32Array(1024),
      waveform: new Float32Array(2048),
      left: null,
      right: null,
      rms: 0.1,
      peak: 0.2,
      bass: 1,
      mid: 1,
      treb: 1,
      bassAtt: 1,
      midAtt: 0.8,
      trebAtt: 1,
      onsetStrength: 0,
      onsetAge: 10,
      bpm: 0,
      beatPhase: 0,
      centroid: 0.1,
      flux: 0,
      onset: false,
      silent: false,
      frameIndex: 0,
      sampleRate: 48000,
      hostTime: 0,
      ...over,
    })
  );
}

/**
 * Drive a stage at `hz` for `seconds` from `t0`; `at(t)` returns overrides for the frame at t.
 * @param {ReturnType<typeof createStage>} stage
 * @param {{ hz?: number, seconds: number, t0?: number, p?: any, at?: (t: number, i: number) => Record<string, unknown> }} o
 */
function drive(stage, { hz = 60, seconds, t0 = 0, p = params(), at = () => ({}) }) {
  const dt = 1 / hz;
  const n = Math.round(seconds * hz);
  let t = t0;
  for (let i = 0; i < n; i++) {
    t = t0 + (i + 1) * dt;
    stage.step(audio(at(t, i)), t, dt, p);
  }
  return t;
}

const A = 0;
const B = 1;
const K = 2;

describe("lungeEnvelope", () => {
  it("rises linearly over the attack, then decays with a 0.25 s time constant", () => {
    expect(lungeEnvelope(-0.01, 0.07)).toBe(0);
    expect(lungeEnvelope(0.035, 0.07)).toBeCloseTo(0.5, 9);
    expect(lungeEnvelope(0.07, 0.07)).toBeCloseTo(1, 9);
    expect(lungeEnvelope(0.32, 0.07)).toBeCloseTo(Math.exp(-1), 9);
  });
});

describe("penumbra", () => {
  it("widens from 1 to 40 px (1440p) with distance, 12 px on the reiniger screen", () => {
    const out = { w: 0, scale: 0, opacity: 0 };
    penumbra(0, 1, 1, false, out);
    expect(out).toEqual({ w: 1, scale: 1, opacity: 0.96 });
    penumbra(1, 1, 0.5, false, out);
    expect(out.w).toBeCloseTo(20, 9);
    expect(out.scale).toBeCloseTo(1.6, 9);
    expect(out.opacity).toBeCloseTo(0.55, 9);
    penumbra(1, 1, 1, true, out);
    expect(out.w).toBeCloseTo(12, 9);
  });
});

describe("lunges", () => {
  it("snaps a puppet to the screen within the attack and lets it drift back by 1.2 s", () => {
    const stage = createStage();
    const p = params();
    drive(stage, { seconds: 1, p });
    expect(stage.sil[A].d).toBeCloseTo(PUPPET_REST, 6);
    // An onset 3 ms before this frame's newest sample.
    stage.step(audio({ onset: true, onsetStrength: 0.5, onsetAge: 0.003, bassAtt: 1.5, midAtt: 1 }), 1.003, 0.003, p);
    const t0 = 1.0;
    stage.step(audio({ onsetAge: 0.07 }), t0 + 0.07, 0.067, p);
    expect(stage.sil[A].d).toBeLessThanOrEqual(0.02);
    expect(stage.sil[B].d).toBeCloseTo(PUPPET_REST, 6);
    stage.step(audio({ onsetAge: 1.2 }), t0 + 1.2, 1.13, p);
    expect(Math.abs(stage.sil[A].d - PUPPET_REST)).toBeLessThan(0.05);
  });

  it("gives the same depth at 60 and 120 Hz for one onset", () => {
    const run = (/** @type {number} */ hz) => {
      const stage = createStage();
      const out = [];
      const dt = 1 / hz;
      for (let i = 1; i <= 2 * hz; i++) {
        const t = i * dt;
        // One onset at t = 0.5 s, seen on the first frame at or after it.
        const onset = t >= 0.5 && t - dt < 0.5;
        stage.step(audio({ onset, onsetStrength: 0.5, onsetAge: onset ? t - 0.5 : 10, bassAtt: 1.4 }), t, dt, params());
        if (i % (hz / 20) === 0) out.push(stage.sil[A].d);
      }
      return out;
    };
    const a = run(60);
    const b = run(120);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 9);
  });

  it("answers call and response: bass leads A, mids lead B, a strong hit moves both", () => {
    const hit = (/** @type {Record<string, unknown>} */ over) => {
      const stage = createStage();
      drive(stage, { seconds: 0.5 });
      stage.step(audio({ onset: true, onsetAge: 0, ...over }), 0.5 + 1 / 60, 1 / 60, params());
      drive(stage, { seconds: 0.05, t0: 0.5 + 1 / 60 });
      return [stage.sil[A].d < 0.3, stage.sil[B].d < 0.3];
    };
    expect(hit({ onsetStrength: 0.4, bassAtt: 1.5, midAtt: 1 })).toEqual([true, false]);
    expect(hit({ onsetStrength: 0.4, bassAtt: 1, midAtt: 1.5 })).toEqual([false, true]);
    expect(hit({ onsetStrength: 0.7, bassAtt: 1, midAtt: 1.5 })).toEqual([true, true]);
    expect(hit({ onsetStrength: 0.2, bassAtt: 1.5, midAtt: 1 })).toEqual([false, false]);
  });

  it("starts the lunge now when an onset frame carries no usable age", () => {
    const stage = createStage();
    const p = params();
    drive(stage, { seconds: 1, p });
    // A source that never updates onsetAge (stays at its 10 s cap) still lunges on the hit.
    stage.step(audio({ onset: true, onsetStrength: 0.5, onsetAge: 10, bassAtt: 2 }), 1.01, 0.01, p);
    stage.step(audio({ onsetAge: 10 }), 1.08, 0.07, p);
    expect(stage.sil[A].d).toBeLessThanOrEqual(0.02);
  });

  it("continues a lunge from where it is when a new hit lands mid-lunge (no pop)", () => {
    const stage = createStage();
    const p = params();
    drive(stage, { seconds: 0.5, p });
    stage.step(audio({ onset: true, onsetStrength: 0.4, onsetAge: 0, bassAtt: 2 }), 0.5, 0.01, p);
    drive(stage, { seconds: 0.2, t0: 0.5, p });
    const before = stage.sil[A].d;
    stage.step(audio({ onset: true, onsetStrength: 0.4, onsetAge: 0, bassAtt: 2 }), 0.7 + 1 / 60, 1 / 60, p);
    expect(Math.abs(stage.sil[A].d - before)).toBeLessThan(0.1);
  });

  it("lunges more gently under reduce motion", () => {
    const stage = createStage();
    const p = params({}, true);
    drive(stage, { seconds: 0.5, p });
    stage.step(audio({ onset: true, onsetStrength: 0.4, onsetAge: 0, bassAtt: 2 }), 0.5, 0.01, p);
    stage.step(audio(), 0.57, 0.07, p);
    expect(stage.sil[A].d).toBeGreaterThan(0.3); // 200 ms attack: not there yet at 70 ms
    stage.step(audio(), 0.7, 0.13, p);
    expect(stage.sil[A].d).toBeCloseTo(PUPPET_REST * 0.3, 6);
  });
});

describe("silence", () => {
  const silent = () => ({ silent: true, rms: 0, peak: 0 });

  it("withdraws the puppets after 1.5 s of silence, not 1.4 s, and an onset brings them back", () => {
    const stage = createStage();
    let t = drive(stage, { seconds: 1, at: () => ({}) });
    t = drive(stage, { seconds: 1.4, t0: t, at: silent });
    expect(stage.withdrawn).toBe(false);
    t = drive(stage, { seconds: 0.1, t0: t, at: silent });
    expect(stage.withdrawn).toBe(true);
    expect(SILENCE_HOLD).toBe(1.5);
    t = drive(stage, { seconds: 2, t0: t, at: silent });
    expect(stage.sil[A].opacity).toBe(0);
    expect(stage.sil[A].visible).toBe(false);
    expect(stage.sil[K].visible).toBe(true);
    expect(stage.sil[K].x).toBeCloseTo(0.5, 6);
    expect(stage.sil[K].d).toBeCloseTo(0.1, 2);
    expect(stage.sil[K].fx).toBe(1);
    expect(stage.sil[K].rot).toBe(0);
    stage.step(audio({ onset: true, onsetStrength: 0.3, onsetAge: 0 }), t + 0.01, 0.01, params());
    expect(stage.withdrawn).toBe(false);
    drive(stage, { seconds: 1.6, t0: t + 0.01 });
    expect(stage.sil[A].visible).toBe(true);
    expect(stage.sil[A].opacity).toBeGreaterThan(0.5);
    expect(stage.sil[K].visible).toBe(false);
  });

  it("resets the silence timer when sound returns", () => {
    const stage = createStage();
    let t = drive(stage, { seconds: 1, at: silent });
    t = drive(stage, { seconds: 0.1, t0: t });
    drive(stage, { seconds: 1, t0: t, at: silent });
    expect(stage.withdrawn).toBe(false);
  });
});

describe("scenes", () => {
  /** Beat clock at 120 bpm. @param {number} t */
  const beat = (t) => ({ bpm: 120, beatPhase: (t * 2) % 1 });

  it("sweeps the kayon across every 32 beats and swaps the puppets at the halfway point", () => {
    const stage = createStage();
    const p = params();
    // 32 beats at 120 bpm = 16 s.
    let t = drive(stage, { seconds: 15.9, at: beat, p });
    expect(stage.sil[K].visible).toBe(false);
    expect(stage.sil[A].x).toBeLessThan(0.5);
    t = drive(stage, { seconds: 0.2, t0: t, at: beat, p });
    expect(stage.sil[K].visible).toBe(true);
    expect(stage.sil[K].x).toBeLessThan(0);
    // The sweep began at beat 32 (t ~= 16.02 s): progress just under 0.5, not swapped yet.
    t = drive(stage, { seconds: 1.35, t0: t, at: beat, p });
    expect(stage.swapped).toBe(false);
    t = drive(stage, { seconds: 0.15, t0: t, at: beat, p });
    expect(stage.swapped).toBe(true);
    expect(stage.sil[K].x).toBeCloseTo(0.5, 1);
    // The puppets slide over 1 s and turn round.
    t = drive(stage, { seconds: 1.2, t0: t, at: beat, p });
    expect(stage.sil[A].x).toBeCloseTo(0.7, 2);
    expect(stage.sil[B].x).toBeCloseTo(0.3, 2);
    expect(stage.sil[A].fx).toBeCloseTo(-1, 6);
    expect(stage.sil[B].fx).toBeCloseTo(1, 6);
    t = drive(stage, { seconds: 1, t0: t, at: beat, p });
    expect(stage.sil[K].visible).toBe(false);
    // The next scene at beat 64, entering from the other side.
    t = drive(stage, { seconds: 32 - t - 0.1, t0: t, at: beat, p });
    expect(stage.sil[K].visible).toBe(false);
    drive(stage, { seconds: 0.3, t0: t, at: beat, p });
    expect(stage.sil[K].visible).toBe(true);
    expect(stage.sil[K].x).toBeGreaterThan(1);
  });

  it("turns the kayon flat as it sweeps, and slides it without turning under reduce motion", () => {
    const run = (/** @type {boolean} */ reduce) => {
      const stage = createStage();
      const p = params({}, reduce);
      let t = drive(stage, { seconds: 16.05, at: beat, p });
      let minFx = 1;
      for (let i = 0; i < 150; i++) t = drive(stage, { seconds: 1 / 60, t0: t, at: beat, p }), (minFx = Math.min(minFx, stage.sil[K].fx));
      return minFx;
    };
    const spun = run(false);
    expect(spun).toBeLessThan(0.2);
    expect(spun).toBeGreaterThanOrEqual(0.08);
    expect(run(true)).toBe(1);
  });

  it("runs every 30 s while the tempo is unknown, and not at all with scenes off", () => {
    const stage = createStage();
    let t = drive(stage, { seconds: 29.9 });
    expect(stage.sil[K].visible).toBe(false);
    drive(stage, { seconds: 0.2, t0: t });
    expect(stage.sil[K].visible).toBe(true);
    const off = createStage();
    drive(off, { seconds: 70, p: params({ scenes: false }) });
    expect(off.sil[K].visible).toBe(false);
  });
});

describe("stage placement", () => {
  it("has no stereo drift for mono or identical channels", () => {
    const stage = createStage();
    const same = new Float32Array(2048).map((_, i) => Math.sin(i * 0.1));
    drive(stage, { seconds: 3, at: () => ({ left: same, right: same }) });
    expect(stage.balance).toBe(0);
    drive(stage, { seconds: 3, at: () => ({ left: null, right: null }) });
    expect(stage.balance).toBe(0);
    expect(stage.sil[A].x).toBeCloseTo(0.3, 9);
    expect(stage.sil[B].x).toBeCloseTo(0.7, 9);
  });

  it("drifts the puppets toward the louder side", () => {
    const stage = createStage();
    const loud = new Float32Array(2048).map((_, i) => Math.sin(i * 0.1));
    const quiet = loud.map((v) => v * 0.2);
    drive(stage, { seconds: 5, at: () => ({ left: loud, right: quiet }) });
    expect(stage.sil[A].x).toBeLessThan(0.3);
    expect(stage.sil[A].x).toBeGreaterThan(0.3 - 0.08);
  });

  it("raises the front hand with a brighter melody and the back arm with loud mids", () => {
    const stage = createStage();
    drive(stage, { seconds: 2, at: () => ({ centroid: 0.02, midAtt: 0.5 }) });
    const low = stage.sil[A].shF;
    const back = stage.sil[A].shB;
    drive(stage, { seconds: 2, t0: 2, at: () => ({ centroid: 0.4, midAtt: 2 }) });
    expect(stage.sil[A].shF).toBeGreaterThan(low + 1);
    expect(stage.sil[A].shF).toBeCloseTo(1.3, 3);
    expect(stage.sil[A].shB).toBeCloseTo(back + 0.6, 2);
  });

  it("casts a soloist at centre stage", () => {
    const stage = createStage();
    drive(stage, { seconds: 1, p: params({ cast: "solo" }) });
    expect(stage.sil[A].x).toBeCloseTo(0.5, 9);
    expect(stage.sil[B].visible).toBe(false);
  });

  it("casts the kayon alone at centre, lunging on hits", () => {
    const stage = createStage();
    const p = params({ cast: "kayon" });
    drive(stage, { seconds: 3, p });
    expect([stage.sil[A].visible, stage.sil[B].visible, stage.sil[K].visible]).toEqual([false, false, true]);
    expect(stage.sil[K].x).toBeCloseTo(0.5, 6);
    expect(stage.sil[K].d).toBeCloseTo(KAYON_REST, 2);
    stage.step(audio({ onset: true, onsetStrength: 0.4, onsetAge: 0 }), 3.01, 0.01, p);
    stage.step(audio(), 3.08, 0.07, p);
    expect(stage.sil[K].d).toBeCloseTo(0.05, 2);
  });

  it("reuses its output objects", () => {
    const stage = createStage();
    const a = stage.sil[A];
    drive(stage, { seconds: 1 });
    expect(stage.sil[A]).toBe(a);
  });
});
