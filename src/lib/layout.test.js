// @ts-check
import { describe, expect, it } from "vitest";
import {
  createRelayoutClock,
  easeInOutCubic,
  gridOf,
  LAYOUT_COUNT,
  layoutForSheet,
  placeLayout,
  SHAPE_OF_PC,
  SLOT,
  TEMPLATES,
  tweenLayouts,
} from "./layout.js";

const ASPECTS = [0.5, 1, 1.5, 1.78, 2.4, 3.5];

/** World rect (cells) of pitch class `pc`. @param {Float32Array} s @param {number} pc */
function rect(s, pc) {
  const o = pc * SLOT;
  const quarter = Math.round(s[o + 6] / 90) % 2 !== 0;
  const w = quarter ? s[o + 5] : s[o + 4];
  const h = quarter ? s[o + 4] : s[o + 5];
  return { x: s[o] - w / 2, y: s[o + 1] - h / 2, w, h };
}

describe("templates", () => {
  it("has 6 hand-designed templates of 12 slots, each pitch class once", () => {
    expect(TEMPLATES).toHaveLength(6);
    expect(LAYOUT_COUNT).toBe(12);
    for (const t of TEMPLATES) {
      expect(t).toHaveLength(12);
      expect(t.map((slot) => slot[0]).sort((a, b) => a - b)).toEqual([...Array(12).keys()]);
    }
    expect(SHAPE_OF_PC).toHaveLength(12);
  });

  it("fits every layout (and mirror) inside the margins at every aspect, no shape under a cell", () => {
    const out = new Float32Array(12 * SLOT);
    for (const aspect of ASPECTS) {
      const g = gridOf(1000 * aspect, 1000, {});
      for (let l = 0; l < LAYOUT_COUNT; l++) {
        placeLayout(l, g.cols, g.rows, out);
        for (let pc = 0; pc < 12; pc++) {
          const r = rect(out, pc);
          const where = `aspect ${aspect} layout ${l} pc ${pc}`;
          expect(r.w, where).toBeGreaterThanOrEqual(1);
          expect(r.h, where).toBeGreaterThanOrEqual(1);
          expect(r.x, where).toBeGreaterThanOrEqual(0);
          expect(r.y, where).toBeGreaterThanOrEqual(0);
          expect(r.x + r.w, where).toBeLessThanOrEqual(g.cols);
          expect(r.y + r.h, where).toBeLessThanOrEqual(g.rows);
          // Snapped to grid lines, with the anchor on one of the rect's corners.
          for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(v), where).toBe(true);
          const ax = out[pc * SLOT + 2];
          const ay = out[pc * SLOT + 3];
          expect([r.x, r.x + r.w]).toContain(ax);
          expect([r.y, r.y + r.h]).toContain(ay);
        }
      }
    }
  });

  it("places templates on the 12 × 8 base grid exactly as written (nothing clamped)", () => {
    const out = new Float32Array(12 * SLOT);
    for (let t = 0; t < TEMPLATES.length; t++) {
      placeLayout(t * 2, 12, 8, out);
      for (const [pc, x, y, lw, lh, rot] of TEMPLATES[t]) {
        const quarter = rot % 180 !== 0;
        expect(rect(out, pc), `template ${t} pc ${pc}`).toEqual({ x, y, w: quarter ? lh : lw, h: quarter ? lw : lh });
      }
    }
  });

  it("mirrors odd layouts left to right", () => {
    const a = new Float32Array(12 * SLOT);
    const b = new Float32Array(12 * SLOT);
    placeLayout(0, 12, 8, a);
    placeLayout(1, 12, 8, b);
    for (let pc = 0; pc < 12; pc++) {
      const ra = rect(a, pc);
      const rb = rect(b, pc);
      expect(rb.x).toBe(12 - ra.x - ra.w);
      expect(rb.y).toBe(ra.y);
      expect(b[pc * SLOT + 7]).toBe(-a[pc * SLOT + 7]);
    }
  });
});

describe("gridOf", () => {
  it("has 8 rows, max(6, round(8·aspect)) columns and 5% margins", () => {
    expect(gridOf(2560, 1440, {})).toMatchObject({ rows: 8, cols: 14, margin: 72 });
    expect(gridOf(1000, 2000, {})).toMatchObject({ rows: 8, cols: 6, margin: 50 });
    const g = gridOf(2560, 1440, {});
    expect(g.x0 + g.cols * g.cellW).toBeCloseTo(2560 - 72, 6);
    expect(g.y0 + g.rows * g.cellH).toBeCloseTo(1440 - 72, 6);
  });
});

describe("sheet sequence", () => {
  it("visits all 12 layouts in 12 sheets via (k·5 + 3) mod 12, never repeating back to back", () => {
    const seen = [...Array(12).keys()].map(layoutForSheet);
    expect(new Set(seen).size).toBe(12);
    expect(seen[0]).toBe(3);
    expect(seen[1]).toBe(8);
    for (let k = 1; k < 40; k++) expect(layoutForSheet(k)).not.toBe(layoutForSheet(k - 1));
  });
});

describe("tweenLayouts", () => {
  it("lands exactly on both endpoints", () => {
    const a = new Float32Array(12 * SLOT);
    const b = new Float32Array(12 * SLOT);
    const out = new Float32Array(12 * SLOT);
    placeLayout(2, 14, 8, a);
    placeLayout(7, 14, 8, b);
    tweenLayouts(a, b, 0, out);
    expect([...out]).toEqual([...a]);
    tweenLayouts(a, b, 1, out);
    for (let i = 0; i < out.length; i++) {
      if (i % SLOT === 6) expect(((out[i] - b[i]) % 360 + 360) % 360).toBeCloseTo(0, 4);
      else expect(out[i]).toBe(b[i]);
    }
  });

  it("turns the short way round and passes a flip through zero width", () => {
    const a = new Float32Array(SLOT * 12);
    const b = new Float32Array(SLOT * 12);
    const out = new Float32Array(SLOT * 12);
    a[6] = 270;
    b[6] = 0;
    a[7] = 1;
    b[7] = -1;
    tweenLayouts(a, b, 0.5, out);
    expect(out[6]).toBeCloseTo(315, 6);
    expect(out[7]).toBeCloseTo(0, 6);
  });

  it("eases in and out (cubic)", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 9);
    expect(easeInOutCubic(0.1)).toBeCloseTo(0.004, 9);
    expect(easeInOutCubic(2)).toBe(1);
    expect(easeInOutCubic(-1)).toBe(0);
  });
});

describe("createRelayoutClock", () => {
  /** Times (s) a 60 Hz run re-lays out. @param {number} bpm @param {number} bars @param {number} seconds */
  function triggers(bpm, bars, seconds) {
    const clock = createRelayoutClock();
    const at = [];
    for (let i = 0; i < seconds * 60; i++) {
      const t = i / 60;
      const phase = bpm > 0 ? (t * bpm / 60) % 1 : 0;
      if (clock.step(bpm, phase, 1 / 60, bars)) at.push(i);
    }
    return at;
  }

  it("re-lays out on a counted downbeat every N bars", () => {
    // 120 bpm: a beat every 30 frames, 8 bars = 32 beats = 960 frames.
    expect(triggers(120, 8, 50)).toEqual([960, 1920, 2880]);
    expect(triggers(120, 16, 50)).toEqual([1920]);
    expect(triggers(120, 32, 70)).toEqual([3840]);
  });

  it("falls back to a timer while bpm is 0 (16 s at 8 bars)", () => {
    const at = triggers(0, 8, 40);
    expect(at).toHaveLength(2);
    expect(Math.abs(at[0] - 960)).toBeLessThanOrEqual(1);
    expect(Math.abs(at[1] - 1920)).toBeLessThanOrEqual(1);
  });

  it("never re-lays out when set to never", () => {
    expect(triggers(120, 0, 70)).toEqual([]);
    expect(triggers(0, 0, 70)).toEqual([]);
  });
});
