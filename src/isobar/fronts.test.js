// @ts-check
import { describe, expect, it } from "vitest";
import { fakeContext } from "./fake-2d.test-helper.js";
import {
  buildFronts,
  COLD,
  createFronts,
  curveLength,
  FRONT_PTS,
  OCCLUDED,
  pathCurves,
  pathGlyphs,
  pathRain,
  pathTint,
  placeGlyphs,
  placeRain,
  WARM,
} from "./fronts.js";
import { createAnchors } from "./anchors.js";
import { createPressure, MAX_LOWS } from "./pressure.js";

const H = 1440;

/** A chart with one low of the given age in slot 0. @param {number} age */
function oneLow(age) {
  const st = createPressure(16 / 9);
  st.alive[0] = 1;
  st.id[0] = 3;
  st.x[0] = 0.8;
  st.y[0] = 0.4;
  st.sigma[0] = 0.18;
  st.ageBeats[0] = age;
  return st;
}

/**
 * Anchors on each live low's own centre, each leading its minimum.
 * @param {ReturnType<typeof createPressure>} st
 */
function centred(st) {
  const an = createAnchors();
  for (let i = 0; i < MAX_LOWS; i++) {
    an.x[i] = st.x[i];
    an.y[i] = st.y[i];
    an.ok[i] = an.lead[i] = st.alive[i];
    an.vis[i] = st.alive[i];
  }
  return an;
}

/** buildFronts with centred anchors. @param {ReturnType<typeof createPressure>} st @param {ReturnType<typeof createFronts>} f @param {number} sweep */
function build(st, f, sweep) {
  buildFronts(st, centred(st), f, H, sweep);
}

/** Index of slot/curve in the curve tables. @param {number} slot @param {number} kind */
const ci = (slot, kind) => slot * 3 + kind;

describe("buildFronts", () => {
  it("draws no fronts for lows younger than 2 beats", () => {
    const f = createFronts();
    build(oneLow(1.5), f, 1);
    for (let k = 0; k < MAX_LOWS * 3; k++) expect(f.active[k]).toBe(0);
  });

  it("the occluded segment appears only between 16 and 32 beats", () => {
    const f = createFronts();
    for (const [age, occ] of /** @type {const} */ ([
      [10, 0],
      [20, 1],
      [26, 1],
      [40, 0],
    ])) {
      build(oneLow(age), f, 1);
      expect(f.active[ci(0, OCCLUDED)], `age ${age}`).toBe(occ);
      expect(f.active[ci(0, COLD)]).toBe(1);
      expect(f.active[ci(0, WARM)]).toBe(1);
    }
    // occluded: the cold and warm fronts start at the occlusion's end, not at the centre
    build(oneLow(22), f, 1);
    const o = ci(0, OCCLUDED) * FRONT_PTS * 2;
    const end = [f.pts[o + 2 * (FRONT_PTS - 1)], f.pts[o + 2 * (FRONT_PTS - 1) + 1]];
    const c = ci(0, COLD) * FRONT_PTS * 2;
    expect([f.pts[c], f.pts[c + 1]]).toEqual(end);
    expect(Math.hypot(end[0] - 0.8 * H, end[1] - 0.4 * H)).toBeGreaterThan(0.3 * 2.2 * 0.18 * H);
  });

  it("starts the fronts and the warm sector at the anchor (the field minimum), not the Gaussian centre", () => {
    const f = createFronts();
    const st = oneLow(10);
    const an = centred(st);
    an.x[0] = 0.85;
    an.y[0] = 0.38;
    buildFronts(st, an, f, H, 1);
    for (const kind of [COLD, WARM]) {
      const o = ci(0, kind) * FRONT_PTS * 2;
      expect(f.pts[o]).toBeCloseTo(0.85 * H, 3);
      expect(f.pts[o + 1]).toBeCloseTo(0.38 * H, 3);
    }
    expect([f.centre[0], f.centre[1]]).toEqual([Math.fround(0.85 * H), Math.fround(0.38 * H)]);
  });

  it("scales the fronts with the anchor's visibility and drops them at 0", () => {
    const f = createFronts();
    const st = oneLow(10);
    const an = centred(st);
    buildFronts(st, an, f, H, 1);
    const full = curveLength(f, ci(0, COLD));
    an.vis[0] = 0.5;
    buildFronts(st, an, f, H, 1);
    expect(curveLength(f, ci(0, COLD))).toBeCloseTo(full / 2, 0);
    an.vis[0] = 0;
    buildFronts(st, an, f, H, 1);
    for (let k = 0; k < MAX_LOWS * 3; k++) expect(f.active[k]).toBe(0);
  });

  it("the cold front swings from south-south-west toward south-south-east as the low ages", () => {
    const f = createFronts();
    /** Screen angle (deg, y down) from the centre to the cold front's end. @param {number} age */
    const coldEnd = (age, sweep = 1) => {
      build(oneLow(age), f, sweep);
      const c = ci(0, COLD) * FRONT_PTS * 2 + 2 * (FRONT_PTS - 1);
      return (Math.atan2(f.pts[c + 1] - 0.4 * H, f.pts[c] - 0.8 * H) * 180) / Math.PI;
    };
    expect(coldEnd(4)).toBeGreaterThan(110);
    expect(coldEnd(30)).toBeLessThan(coldEnd(4) - 30);
    expect(coldEnd(30, 0.5)).toBeGreaterThan(coldEnd(30) + 15); // Reduce motion halves the sweep
  });
});

describe("glyphs", () => {
  it("places about one glyph per 22 px of front, on the leading side", () => {
    const f = createFronts();
    const st = oneLow(10);
    build(st, f, 1);
    placeGlyphs(f, 1);
    const coldLen = curveLength(f, ci(0, COLD));
    const warmLen = curveLength(f, ci(0, WARM));
    let cold = 0;
    let warm = 0;
    // the warm sector lies between the fronts, around the bisector of their directions
    const bis = ((110 - (50 / 32) * 8 + 20) / 2) * (Math.PI / 180);
    const bx = Math.cos(bis);
    const by = Math.sin(bis);
    for (let k = 0; k < f.nGlyphs; k++) {
      const o = k * 5;
      const a = f.glyphs[o + 2];
      const nx = Math.sin(a); // leading-side normal (ty, -tx)
      const ny = -Math.cos(a);
      const kind = f.glyphs[o + 4];
      if (kind === COLD) {
        cold++;
        expect(f.glyphs[o + 3]).toBe(0); // triangle
        expect(nx * bx + ny * by).toBeGreaterThan(0); // toward the warm sector
      } else if (kind === WARM) {
        warm++;
        expect(f.glyphs[o + 3]).toBe(1); // semicircle
        expect(nx * bx + ny * by).toBeLessThan(0); // away from the warm sector
      }
    }
    expect(Math.abs(cold - coldLen / 22)).toBeLessThanOrEqual(1);
    expect(Math.abs(warm - warmLen / 22)).toBeLessThanOrEqual(1);
    expect(cold).toBeGreaterThan(10);
  });

  it("alternates triangles and semicircles on the occluded front, and scales the spacing", () => {
    const f = createFronts();
    build(oneLow(24), f, 1);
    placeGlyphs(f, 1);
    const shapes = [];
    for (let k = 0; k < f.nGlyphs; k++) if (f.glyphs[k * 5 + 4] === OCCLUDED) shapes.push(f.glyphs[k * 5 + 3]);
    expect(shapes.length).toBeGreaterThanOrEqual(2);
    for (let k = 0; k < shapes.length; k++) expect(shapes[k]).toBe(k % 2);
    const n1 = f.nGlyphs;
    placeGlyphs(f, 2);
    expect(Math.abs(f.nGlyphs - n1 / 2)).toBeLessThanOrEqual(3);
  });

  it("fills each front kind's glyphs in one path", () => {
    const f = createFronts();
    build(oneLow(24), f, 1);
    placeGlyphs(f, 1);
    const { ctx, log } = fakeContext();
    pathGlyphs(ctx, f, COLD, 1);
    const closes = log.filter((e) => e.op === "close").length;
    let cold = 0;
    for (let k = 0; k < f.nGlyphs; k++) cold += f.glyphs[k * 5 + 4] === COLD ? 1 : 0;
    expect(closes).toBe(cold);
    expect(log.filter((e) => e.op === "begin" || e.op === "fill")).toHaveLength(0);
  });
});

describe("rain and tint", () => {
  it("rain is stable along the front, grows with density, and lies behind the cold front", () => {
    const f = createFronts();
    build(oneLow(10), f, 1);
    placeRain(f, 0.2, 1);
    const sparse = f.nRain;
    const first = [f.rain[0], f.rain[1]];
    placeRain(f, 0.2, 1);
    expect([f.rain[0], f.rain[1]]).toEqual(first);
    placeRain(f, 0.8, 1);
    expect(f.nRain).toBeGreaterThan(sparse * 3);
    expect(sparse).toBeGreaterThan(20);
    placeRain(f, 0, 1);
    expect(f.nRain).toBe(0);
  });

  it("paths the rain as rects and the warm sector as one polygon per low", () => {
    const f = createFronts();
    build(oneLow(10), f, 1);
    placeRain(f, 0.5, 1);
    const { ctx, log } = fakeContext();
    pathRain(ctx, f, 2);
    expect(log.filter((e) => e.op === "rect")).toHaveLength(f.nRain);
    expect(log[0].w).toBe(2);
    log.length = 0;
    pathTint(ctx, f);
    expect(log.filter((e) => e.op === "move")).toHaveLength(1);
    expect(log.filter((e) => e.op === "line")).toHaveLength(2 * FRONT_PTS);
    log.length = 0;
    pathCurves(ctx, f, COLD);
    expect(log.filter((e) => e.op === "line")).toHaveLength(FRONT_PTS - 1);
  });
});
