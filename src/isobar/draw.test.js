// @ts-check
// @ts-expect-error -- a Node builtin (tests run in Node); the web tsconfig has no @types/node.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import create from "../isobar.js";
import { fakeContext } from "./fake-2d.test-helper.js";

const DEFAULTS = {
  chart: "paper",
  reactivity: 1,
  speed: 1,
  fronts: true,
  barbs: true,
  labels: true,
  coastline: true,
  tints: true,
};

/** The base and mask canvases: node has none, so each gets a recording fake context. */
/** @type {FakeOffscreen[]} */
const offscreen = [];
class FakeOffscreen {
  width = 0;
  height = 0;
  fake = fakeContext();
  constructor(/** @type {number} */ w, /** @type {number} */ h) {
    this.width = w;
    this.height = h;
    offscreen.push(this);
  }
  getContext() {
    return this.fake.ctx;
  }
}
const gt = /** @type {any} */ (globalThis);
const had = "OffscreenCanvas" in gt;
beforeAll(() => {
  if (!had) gt.OffscreenCanvas = FakeOffscreen;
});
afterAll(() => {
  if (!had) delete gt.OffscreenCanvas;
});

/**
 * @param {Partial<Record<keyof typeof DEFAULTS, unknown>>} [params]
 * @param {{ css?: [number, number], reduceMotion?: boolean }} [opts]
 */
async function setup(params = {}, opts = {}) {
  offscreen.length = 0;
  const fake = fakeContext();
  const [cw, ch] = opts.css ?? [1280, 720];
  const ctx = /** @type {import('../../tidalviz').VisualizerContext} */ (
    /** @type {unknown} */ ({
      ctx2d: fake.ctx,
      params: { ...DEFAULTS, ...params },
      size: { width: cw * 2, height: ch * 2, cssWidth: cw, cssHeight: ch, dpr: 2 },
      renderScale: 1,
      reduceMotion: opts.reduceMotion ?? false,
      reduceFlashing: true,
    })
  );
  const viz = await create(ctx);
  return { ...fake, ctx, viz, base: offscreen[0].fake };
}

/** A mutable audio frame. */
function audioFrame() {
  return {
    bands: new Float32Array(64),
    spectrum: new Float32Array(1024),
    waveform: new Float32Array(2048),
    left: /** @type {Float32Array | null} */ (null),
    right: /** @type {Float32Array | null} */ (null),
    rms: 0.1,
    peak: 0.3,
    bass: 1,
    mid: 1,
    treb: 1,
    bassAtt: 1,
    midAtt: 1,
    trebAtt: 1.6,
    onsetStrength: 0,
    onsetAge: 10,
    bpm: 120,
    beatPhase: 0,
    centroid: 0.2,
    flux: 0.3,
    onset: false,
    silent: false,
    frameIndex: 0,
    sampleRate: 48000,
    hostTime: 0,
  };
}

/**
 * Drives `seconds` of a 120 bpm drum pattern at 60 Hz: bass-led kicks on every beat.
 * @param {import('../../tidalviz').Visualizer} viz @param {number} seconds
 */
function drive(viz, seconds, a = audioFrame(), t0 = 0) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    const t = t0 + i / 60;
    a.beatPhase = (t * 2) % 1;
    a.onset = i % 30 === 0;
    a.onsetStrength = a.onset ? 0.9 : 0;
    a.bassAtt = 1.4 + 0.5 * Math.sin(t);
    viz.frame(/** @type {any} */ (a), { now: t, dt: i === 0 && t0 === 0 ? 0 : 1 / 60, frame: i });
  }
  return a;
}

describe("Isobar draw", () => {
  it("draws in chart order with exactly two isobar strokes and measures no text per frame", async () => {
    const { viz, log } = await setup();
    drive(viz, 20);
    log.length = 0;
    drive(viz, 1 / 60, audioFrame(), 20);
    expect(log[0].op).toBe("clear");
    expect(log[1].op).toBe("image");
    const strokes = log.filter((e) => e.op === "stroke");
    const fills = log.filter((e) => e.op === "fill");
    // tint, rain, 3 glyph colours, pennants, label boxes
    expect(fills[0].alpha).toBeGreaterThan(0);
    expect(fills[0].alpha).toBeLessThanOrEqual(0.1);
    expect(fills[1].alpha).toBe(1);
    // isobars: normal then bold, before the fronts
    expect(strokes[0]).toMatchObject({ style: "#1b1b1b", width: 2 });
    expect(strokes[1]).toMatchObject({ style: "#1b1b1b", width: 4 });
    expect(strokes.slice(2, 5).map((s) => s.style)).toEqual(["#7a2bb0", "#1d4fd6", "#d6261d"]);
    expect(strokes[5]).toMatchObject({ style: "#1b1b1b", width: 2.4 }); // barbs
    expect(strokes.filter((s) => s.width === 4)).toHaveLength(1);
    // text last: numerals, then letters with their pressures
    const texts = log.filter((e) => e.op === "text").map((e) => e.text);
    expect(texts).toContain("L");
    expect(texts).toContain("H");
    expect(texts.some((t) => /^(9[4-9]\d|10[0-5]\d|1060)$/.test(String(t)))).toBe(true);
    const lastStroke = log.lastIndexOf(strokes[strokes.length - 1]);
    expect(log.findIndex((e) => e.op === "text")).toBeGreaterThan(lastStroke);
    expect(log.some((e) => e.op === "measure")).toBe(false);
  });

  it("never draws two edge-label boxes on top of each other", async () => {
    const { viz, log } = await setup();
    drive(viz, 20);
    log.length = 0;
    drive(viz, 1 / 60, audioFrame(), 20);
    const boxes = log.filter((e) => e.op === "rect");
    // the edge numerals are the label-ink texts (central pressures take the L and H colours)
    const lab = boxes.slice(-log.filter((e) => e.op === "text" && e.style === "#1b1b1b").length);
    expect(lab.length).toBeGreaterThan(2);
    for (let i = 0; i < lab.length; i++) {
      for (let j = i + 1; j < lab.length; j++) {
        const [a, b] = [lab[i], lab[j]];
        const overlap = /** @type {number} */ (a.x) < /** @type {number} */ (b.x) + /** @type {number} */ (b.w) &&
          /** @type {number} */ (b.x) < /** @type {number} */ (a.x) + /** @type {number} */ (a.w) &&
          /** @type {number} */ (a.y) < /** @type {number} */ (b.y) + /** @type {number} */ (b.h) &&
          /** @type {number} */ (b.y) < /** @type {number} */ (a.y) + /** @type {number} */ (a.h);
        expect(overlap).toBe(false);
      }
    }
  });

  it("frame() builds no strings, closures or literals", () => {
    const src = readFileSync(new URL("../isobar.js", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("    frame(audio, time) {"), src.indexOf("    resize() {"));
    expect(body.length).toBeGreaterThan(1000);
    expect(body).not.toMatch(/`|new |=>|\[\]|\{\s*\w+:|\.toFixed|String\(|\.concat\(|\.slice\(|\.map\(|\+ "/);
  });

  it("drops labels below 900 css px and barbs below 700, keeping rings, fronts and letters", async () => {
    const { viz, log } = await setup({}, { css: [640, 360] });
    drive(viz, 20);
    log.length = 0;
    drive(viz, 1 / 60, audioFrame(), 20);
    const texts = log.filter((e) => e.op === "text").map((e) => e.text);
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(["L", "H"]).toContain(t);
    expect(log.filter((e) => e.op === "stroke" && e.width === 1.2 * 2)).toHaveLength(0);
    expect(log.filter((e) => e.op === "stroke")).toHaveLength(5); // 2 isobars, 3 fronts
  });

  it("paints the paper chart opaque and the 'none' chart transparent with a faint coast", async () => {
    const paper = await setup();
    expect(paper.base.log.some((e) => e.op === "fillRect" && e.style === "#fbfbf7")).toBe(true);
    expect(paper.base.log.some((e) => e.op === "image")).toBe(true); // the land mask
    const none = await setup({ chart: "none" });
    expect(none.base.log.some((e) => e.op === "fillRect")).toBe(false);
    expect(none.base.log.some((e) => e.op === "image")).toBe(false);
    expect(none.base.log.some((e) => e.op === "stroke" && e.style === "#e8e8e8" && e.alpha === 0.5)).toBe(true);
    const bare = await setup({ coastline: false });
    expect(bare.base.log.filter((e) => e.op === "stroke")).toHaveLength(1); // graticule only
  });

  it("rebuilds the base on chart changes only, and releases it on dispose", async () => {
    const { viz, ctx, base } = await setup();
    const n = base.log.length;
    /** @type {any} */ (ctx.params).reactivity = 1.5;
    viz.params?.({ reactivity: 1.5 });
    expect(base.log.length).toBe(n);
    /** @type {any} */ (ctx.params).chart = "night";
    viz.params?.({ chart: "night" });
    expect(base.log.some((e) => e.op === "fillRect" && e.style === "#11161c")).toBe(true);
    expect(offscreen[0].width).toBe(2560);
    viz.dispose?.();
    expect(offscreen.map((c) => c.width)).toEqual([0, 0]);
  });

  it("ramps the warm-sector tint over seconds instead of flashing it", async () => {
    const { viz, log } = await setup();
    const a = audioFrame();
    a.centroid = 0;
    drive(viz, 20, a);
    a.centroid = 0.5;
    log.length = 0;
    drive(viz, 0.1, a, 20);
    const early = log.filter((e) => e.op === "fill" && e.alpha !== 1).map((e) => e.alpha ?? 0);
    log.length = 0;
    drive(viz, 6, a, 20.1);
    const late = log.filter((e) => e.op === "fill" && e.alpha !== 1).map((e) => e.alpha ?? 0);
    expect(Math.max(0, ...early)).toBeLessThan(0.2 * Math.max(...late));
    expect(Math.max(...late)).toBeCloseTo(0.1, 1);
  });

  it("keeps a calm chart while silent: rings, no lows", async () => {
    const { viz, log } = await setup();
    const a = audioFrame();
    a.silent = true;
    a.bpm = 0;
    a.trebAtt = 0;
    a.flux = 0;
    for (let i = 0; i < 120; i++) viz.frame(/** @type {any} */ (a), { now: i / 60, dt: 1 / 60, frame: i });
    const segs = log.filter((e) => e.op === "move").length;
    expect(segs).toBeGreaterThan(0);
    log.length = 0;
    viz.frame(/** @type {any} */ (a), { now: 2, dt: 1 / 60, frame: 120 });
    const texts = log.filter((e) => e.op === "text").map((e) => e.text);
    expect(texts).not.toContain("L");
  });
});
