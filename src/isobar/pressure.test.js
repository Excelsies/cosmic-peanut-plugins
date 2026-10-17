// @ts-check
import { describe, expect, it } from "vitest";
import { hash01 } from "./hash.js";
import {
  backgroundAt,
  BASE_P,
  CELL,
  centralPressure,
  createPressure,
  fillField,
  grad,
  HIGH,
  LOW,
  lifecycleAmp,
  pressureAt,
  SLOTS,
  stepPressure,
  youngestLow,
} from "./pressure.js";

/** A plain audio frame with the fields the model reads. */
function frame(over = {}) {
  return {
    bpm: 120,
    beatPhase: 0,
    silent: false,
    onset: false,
    onsetStrength: 0,
    bass: 1,
    mid: 1,
    bassAtt: 1,
    midAtt: 1,
    left: /** @type {Float32Array | null} */ (null),
    right: /** @type {Float32Array | null} */ (null),
    ...over,
  };
}
const PRM = { reactivity: 1, speedEff: 1, pulseEff: 1 };

/**
 * Runs `seconds` at `hz` with a 120 bpm beat stream; `f(t, a)` may edit the frame.
 * @param {ReturnType<typeof createPressure>} st @param {number} seconds @param {number} hz
 */
function run(st, seconds, hz, f = (/** @type {number} */ _t, /** @type {any} */ _a) => {}, t0 = 0) {
  const a = frame();
  if (t0 === 0) {
    f(0, a);
    stepPressure(st, a, 0, PRM); // the clock starts on a beat at t = 0
  }
  const n = Math.round(seconds * hz);
  for (let i = 1; i <= n; i++) {
    const t = t0 + i / hz;
    a.beatPhase = (t * 2) % 1;
    a.onset = false;
    f(t, a);
    stepPressure(st, a, 1 / hz, PRM);
  }
  return a;
}

/** Live lows. @param {ReturnType<typeof createPressure>} st */
function lows(st) {
  const out = [];
  for (let i = 0; i < SLOTS; i++) if (st.alive[i] && st.kind[i] === LOW) out.push(i);
  return out;
}

describe("lifecycleAmp", () => {
  it("deepens from -4 to -16 by 16 beats, holds to 32, fills to 0 by 48", () => {
    expect(lifecycleAmp(0)).toBeCloseTo(-4);
    expect(lifecycleAmp(8)).toBeLessThan(-4);
    expect(lifecycleAmp(8)).toBeGreaterThan(-16);
    expect(lifecycleAmp(16)).toBeCloseTo(-16);
    expect(lifecycleAmp(24)).toBeCloseTo(-16);
    expect(lifecycleAmp(32)).toBeCloseTo(-16);
    expect(lifecycleAmp(40)).toBeGreaterThan(-16);
    expect(lifecycleAmp(48)).toBeCloseTo(0);
  });
});

describe("stepPressure", () => {
  it("seeds three highs and spawns a first low as soon as there is sound", () => {
    const st = createPressure(16 / 9);
    let highs = 0;
    for (let i = 0; i < SLOTS; i++) if (st.alive[i] && st.kind[i] === HIGH) highs++;
    expect(highs).toBe(3);
    expect(lows(st)).toHaveLength(0);
    run(st, 1 / 60, 60);
    expect(lows(st)).toHaveLength(1);
  });

  it("ages a low by the beat clock, frees it after 48 beats, and starts another 4 beats later", () => {
    const st = createPressure(16 / 9);
    run(st, 1 / 60, 60);
    const [i] = lows(st);
    const calm = (/** @type {number} */ _t, /** @type {any} */ a) => (a.bassAtt = 0.5); // bass below mid: no spawns
    run(st, 8, 60, calm, 1 / 60); // 16 beats
    expect(st.ageBeats[i]).toBeCloseTo(16, 1);
    expect(st.amp[i]).toBeCloseTo(-16, 1);
    run(st, 16.25, 60, calm, 8 + 1 / 60); // 48.5 beats old
    expect(lows(st)).toHaveLength(0);
    run(st, 2, 60, calm, 24.25 + 1 / 60);
    expect(lows(st)).toHaveLength(1);
    expect(st.ageBeats[lows(st)[0]]).toBeLessThan(1);
  });

  it("spawns on a bass-led strong onset, at least 8 beats apart, at most 4 at a time", () => {
    const st = createPressure(16 / 9);
    run(st, 1 / 60, 60); // first low
    const kick = (/** @type {number} */ t, /** @type {any} */ a) => {
      // a strong bass-led kick on every beat
      if (Math.abs(t * 2 - Math.round(t * 2)) < 1e-6) {
        a.onset = true;
        a.onsetStrength = 0.9;
      }
      a.bassAtt = 1.6;
      a.midAtt = 1;
    };
    run(st, 3.5, 60, kick, 1 / 60); // 7 beats: still too soon
    expect(lows(st)).toHaveLength(1);
    run(st, 0.6, 60, kick, 3.5 + 1 / 60); // past 8 beats
    expect(lows(st)).toHaveLength(2);
    run(st, 40, 60, kick, 4.1 + 1 / 60);
    expect(lows(st).length).toBeLessThanOrEqual(4);
    expect(lows(st).length).toBeGreaterThanOrEqual(3);
  });

  it("counts an onset whose instantaneous bass leads as bass-led even while bassAtt lags", () => {
    const st = createPressure(16 / 9);
    run(st, 1 / 60, 60);
    run(
      st,
      4.5,
      60,
      (t, a) => {
        if (Math.abs(t * 2 - Math.round(t * 2)) < 1e-6) {
          a.onset = true;
          a.onsetStrength = 0.9;
          a.bass = 2; // the kick's first frame
        }
        a.bassAtt = 0.7; // still catching up
      },
      1 / 60,
    );
    expect(lows(st)).toHaveLength(2);
  });

  it("spawns a new low away from the live ones", () => {
    const st = createPressure(16 / 9);
    run(st, 1 / 60, 60);
    const kick = (/** @type {number} */ t, /** @type {any} */ a) => {
      if (Math.abs(t * 2 - Math.round(t * 2)) < 1e-6) {
        a.onset = true;
        a.onsetStrength = 0.9;
      }
      a.bassAtt = a.bass = 1.6;
    };
    run(st, 12.5, 60, kick, 1 / 60); // spawns at 4, 8 and 12 s
    const l = lows(st);
    expect(l).toHaveLength(4);
    for (const a of l) {
      for (const b of l) if (a !== b) expect(Math.hypot(st.x[a] - st.x[b], st.y[a] - st.y[b])).toBeGreaterThan(0.08);
    }
  });

  it("does not spawn on mid-led or weak onsets", () => {
    const st = createPressure(16 / 9);
    run(st, 1 / 60, 60);
    run(
      st,
      6,
      60,
      (t, a) => {
        if (Math.abs(t * 2 - Math.round(t * 2)) < 1e-6) {
          a.onset = true;
          a.onsetStrength = t < 3 ? 0.9 : 0.3; // strong but mid-led, then bass-led but weak
        }
        a.bassAtt = a.bass = t < 3 ? 0.8 : 1.6;
        a.midAtt = a.mid = 1;
      },
      1 / 60,
    );
    expect(lows(st)).toHaveLength(1);
  });

  it("the youngest low takes the bass: deeper with more bass, and the kick snaps it in", () => {
    const st = createPressure(16 / 9);
    run(st, 2, 60, (_t, a) => (a.bassAtt = 2.5));
    const i = youngestLow(st);
    expect(st.extra[i]).toBeCloseTo(-1.5 * 28, 0);
    run(st, 3, 60, (_t, a) => (a.bassAtt = 1), 2);
    expect(st.extra[i]).toBeGreaterThan(-1.5 * 28 * 0.05); // released over 0.8 s
    const before = st.kick[i];
    run(st, 1 / 60, 60, (_t, a) => {
      a.onset = true;
      a.onsetStrength = 0.5;
      a.bassAtt = 0.5; // not a spawn
    }, 5);
    expect(before).toBeCloseTo(0);
    expect(st.kick[i]).toBeCloseTo(-3);
    run(st, 0.25, 60, () => {}, 5 + 1 / 60);
    expect(st.kick[i]).toBeCloseTo(-3 / Math.E, 1);
  });

  it("drifts lows east one cell per beat, highs half that; nothing drifts while silent", () => {
    const st = createPressure(16 / 9);
    run(st, 1 / 60, 60);
    const i = youngestLow(st);
    const h = 4;
    expect(st.kind[h]).toBe(HIGH);
    const [x0, hx0] = [st.x[i], st.x[h]];
    run(st, 2, 60, () => {}, 1 / 60); // 4 beats
    expect(st.x[i] - x0).toBeCloseTo(4 * CELL, 3);
    expect(st.x[h] - hx0).toBeCloseTo(2 * CELL, 3);
    const [x1, age1] = [st.x[i], st.ageBeats[i]];
    run(st, 3, 60, (_t, a) => (a.silent = true), 2 + 1 / 60);
    expect(st.x[i]).toBe(x1);
    expect(st.ageBeats[i]).toBe(age1);
  });

  it("a high gives way while a low passes close by", () => {
    const st = createPressure(16 / 9);
    run(st, 1 / 60, 60);
    const i = youngestLow(st);
    const h = 4;
    expect(st.room[h]).toBeGreaterThan(0.9);
    st.x[h] = st.x[i] + 0.05;
    st.y[h] = st.y[i];
    run(st, 3, 60, () => {}, 1 / 60);
    expect(st.room[h]).toBeLessThan(0.1);
    expect(st.eff[h]).toBeCloseTo(st.level * st.amp[h] * st.fade[h] * st.room[h]);
    st.x[h] = st.x[i] + 1.2;
    run(st, 4, 60, () => {}, 3 + 1 / 60);
    expect(st.room[h]).toBeGreaterThan(0.9);
  });

  it("fills everything toward the calm chart with a 6 s time constant while silent", () => {
    const st = createPressure(16 / 9);
    run(st, 10, 60, (_t, a) => (a.bassAtt = 2));
    const i = youngestLow(st);
    const deep = centralPressure(st, i) - backgroundAt(st.x[i], st.y[i]);
    run(st, 6, 60, (_t, a) => (a.silent = true), 10);
    const after = centralPressure(st, i) - backgroundAt(st.x[i], st.y[i]);
    expect(after / deep).toBeCloseTo(Math.exp(-1), 1);
    run(st, 60, 60, (_t, a) => (a.silent = true), 16);
    expect(Math.abs(centralPressure(st, i) - backgroundAt(st.x[i], st.y[i]))).toBeLessThan(0.1);
  });

  it("is the same state at 60 and 120 Hz for the same beat stream", () => {
    const stream = (/** @type {number} */ t, /** @type {any} */ a) => {
      const beat = t * 2;
      if (Math.abs(beat - Math.round(beat)) < 1e-6 && Math.round(beat) % 3 === 0) {
        a.onset = true;
        a.onsetStrength = 0.8;
      }
      a.bassAtt = 1.3 + 0.6 * Math.sin(t * 0.9);
      a.midAtt = 1 + 0.4 * Math.sin(t * 0.37);
    };
    const a = createPressure(16 / 9);
    const b = createPressure(16 / 9);
    run(a, 30, 60, stream);
    run(b, 30, 120, stream);
    expect(a.beats).toBeCloseTo(b.beats, 4);
    for (let i = 0; i < SLOTS; i++) {
      expect(a.alive[i]).toBe(b.alive[i]);
      for (const k of /** @type {const} */ (["x", "y", "ageBeats"])) {
        expect(a[k][i], `${k}[${i}]`).toBeCloseTo(b[k][i], 3);
      }
      // A frame's input holds over the frame before it, so smooth inputs agree to a few thousandths.
      for (const k of /** @type {const} */ (["amp", "extra", "kick"])) {
        expect(a[k][i], `${k}[${i}]`).toBeCloseTo(b[k][i], 2);
      }
    }
  });

  it("a louder left channel moves the storm track north; mono or null leaves it centred", () => {
    const N = 512;
    const loud = Float32Array.from({ length: N }, (_, i) => 0.5 * Math.sin(i * 0.1));
    const quiet = Float32Array.from(loud, (v) => v * 0.05);
    const spawnY = (/** @type {Float32Array | null} */ l, /** @type {Float32Array | null} */ r) => {
      const st = createPressure(16 / 9);
      run(st, 5, 60, (_t, a) => {
        a.silent = true;
        a.left = l;
        a.right = r;
      });
      run(st, 1 / 60, 60, (_t, a) => {
        a.left = l;
        a.right = r;
      }, 5);
      return st.y[youngestLow(st)];
    };
    const mono = spawnY(null, null);
    expect(mono).toBeCloseTo(0.5 + 0.4 * (hash01(1 + 7) - 0.5), 5);
    expect(spawnY(loud, loud)).toBeCloseTo(mono, 6);
    const left = spawnY(loud, quiet);
    expect(mono - left).toBeGreaterThan(0.2);
    expect(spawnY(quiet, loud)).toBeGreaterThan(mono + 0.15);
  });
});

describe("field", () => {
  it("fillField matches pressureAt at the nodes and grad matches finite differences", () => {
    const st = createPressure(16 / 9);
    run(st, 12, 60, (t, a) => {
      a.bassAtt = 1.7;
      if (Math.abs(t * 2 - Math.round(t * 2)) < 1e-6) {
        a.onset = true;
        a.onsetStrength = 0.9;
      }
    });
    const cols = 33;
    const rows = 19;
    const dx = 16 / 9 / (cols - 1);
    const dy = 1 / (rows - 1);
    const out = new Float32Array(cols * rows);
    fillField(st, out, cols, rows, dx, dy);
    for (const [i, j] of [
      [0, 0],
      [10, 5],
      [20, 12],
      [32, 18],
    ]) {
      expect(out[j * cols + i]).toBeCloseTo(pressureAt(st, i * dx, j * dy), 2);
    }
    const g = new Float64Array(2);
    const i = youngestLow(st);
    const x = st.x[i] + 0.07;
    const y = st.y[i] - 0.05;
    grad(st, x, y, g);
    const h = 1e-5;
    expect(g[0]).toBeCloseTo((pressureAt(st, x + h, y) - pressureAt(st, x - h, y)) / (2 * h), 1);
    expect(g[1]).toBeCloseTo((pressureAt(st, x, y + h) - pressureAt(st, x, y - h)) / (2 * h), 1);
  });

  it("the calm chart is a gentle field around the base pressure", () => {
    for (let k = 0; k < 20; k++) {
      const p = backgroundAt((k / 19) * (16 / 9), k / 19);
      expect(Math.abs(p - BASE_P)).toBeLessThan(8);
    }
  });
});
