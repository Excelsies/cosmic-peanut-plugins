// @ts-check
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeContext } from "./lib/fake-2d.test-helper.js";
import create from "./plotter.js";

const DEFAULTS = { grid: "4x3", phrase: "4 bars", paper: "blueprint", inks: "fineliner", weight: 1, chatter: 0.5, speed: 1 };

/** Grain canvas stand-in (node has no canvas): records nothing, just supports the calls. */
class FakeOffscreen {
  width = 0;
  height = 0;
  constructor(/** @type {number} */ w, /** @type {number} */ h) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return {
      createImageData: (/** @type {number} */ w, /** @type {number} */ h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
    };
  }
}
const g = /** @type {any} */ (globalThis);
const hadOffscreen = "OffscreenCanvas" in g;
beforeAll(() => {
  if (!hadOffscreen) g.OffscreenCanvas = FakeOffscreen;
});
afterAll(() => {
  if (!hadOffscreen) delete g.OffscreenCanvas;
});

/**
 * @param {Partial<Record<keyof typeof DEFAULTS, unknown>>} [params]
 * @param {{ reduceMotion?: boolean, width?: number, height?: number }} [opts]
 */
function setup(params = {}, opts = {}) {
  const fake = fakeContext();
  const fg = /** @type {any} */ (fake.g);
  fg.lineCap = "butt";
  fg.fillRect = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h) =>
    fake.log.push({ op: "fillRect", x, y, w, h, style: fg.fillStyle, alpha: fg.globalAlpha });
  fg.createPattern = () => ({ pattern: true });
  const w = opts.width ?? 2560;
  const h = opts.height ?? 1440;
  const ctx = /** @type {import('../tidalviz').VisualizerContext} */ (
    /** @type {unknown} */ ({
      ctx2d: fake.ctx,
      params: { ...DEFAULTS, ...params },
      size: { width: w, height: h, cssWidth: w / 2, cssHeight: h / 2, dpr: 2 },
      reduceMotion: opts.reduceMotion ?? false,
      reduceFlashing: true,
    })
  );
  const viz = /** @type {import('../tidalviz').Visualizer} */ (create(ctx));
  return { ...fake, ctx, viz };
}

/** A mutable audio frame: a sounding A-major-ish chord, onsets every 15 frames. */
function audioFrame() {
  const spectrum = new Float32Array(1024).fill(1e-4);
  for (const f of [220, 277.2, 329.6]) spectrum[Math.round(f / (48000 / 2048))] = 0.4;
  return {
    bands: new Float32Array(64),
    spectrum,
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
    trebAtt: 1.5,
    onsetStrength: 0,
    onset: false,
    onsetAge: 10,
    bpm: 0,
    beatPhase: 0,
    centroid: 0.3,
    flux: 0,
    silent: false,
    frameIndex: 0,
    sampleRate: 48000,
    hostTime: 0,
  };
}

/**
 * Run `frames` frames at 60 Hz from frame `start`; `onFrame` sees each frame's log.
 * @param {ReturnType<typeof setup>} s
 * @param {number} frames
 * @param {{ silent?: boolean, start?: number, onFrame?: (log: ReturnType<typeof fakeContext>["log"], f: number) => void }} [o]
 */
function run(s, frames, o = {}) {
  const a = audioFrame();
  a.silent = o.silent ?? false;
  if (a.silent) {
    a.rms = 0;
    a.spectrum.fill(0);
  }
  const start = o.start ?? 0;
  for (let f = start; f < start + frames; f++) {
    a.onset = !a.silent && f % 15 === 7;
    a.onsetStrength = a.onset ? 0.8 : 0;
    s.log.length = 0;
    s.viz.frame(/** @type {import('../tidalviz').AudioFrame} */ (a), { now: f / 60, dt: 1 / 60, frame: f });
    o.onFrame?.(s.log, f);
  }
  return s.log;
}

/** Ink strokes: paths stroked in a plain #rrggbb ink (paper grid, marks and shadow use rgba). */
const inkStrokes = (/** @type {ReturnType<typeof fakeContext>["log"]} */ log) =>
  log.filter((e) => e.op === "stroke" && typeof e.style === "string" && e.style.startsWith("#"));

/** lineTo points of the ink paths in a log, flattened. */
function lines(/** @type {ReturnType<typeof fakeContext>["log"]} */ log) {
  /** @type {number[]} */
  const out = [];
  /** @type {number[]} */
  let path = [];
  for (const e of log) {
    if (e.op === "begin") path = [];
    else if (e.op === "line") path.push(/** @type {number} */ (e.x), /** @type {number} */ (e.y));
    else if (e.op === "stroke" && typeof e.style === "string" && e.style.startsWith("#")) out.push(...path);
  }
  return out;
}

/** Path length of a flat x,y list. */
function pathLength(/** @type {number[]} */ p) {
  let L = 0;
  for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return L;
}

const isFullFill = (/** @type {any} */ e, w = 2560, h = 1440) => e.op === "fillRect" && e.w >= w && e.h >= h;

describe("plotter", () => {
  it("paints the paper once, then only strokes ink: no clear or full-canvas fill per frame", () => {
    const s = setup();
    const first = run(s, 1);
    expect(first.some((e) => isFullFill(e) && e.style === "#183a63")).toBe(true);
    let strokes = 0;
    run(s, 300, {
      start: 1,
      onFrame: (log) => {
        expect(log.some((e) => e.op === "clear" || isFullFill(e))).toBe(false);
        strokes += inkStrokes(log).length;
      },
    });
    expect(strokes).toBeGreaterThanOrEqual(300);
  });

  it("strokes a short round-capped polyline per frame (10 steps at 60 Hz)", () => {
    const s = setup();
    run(s, 30);
    const log = run(s, 1, { start: 30 });
    expect(lines(log).length / 2).toBe(10);
    expect(inkStrokes(log).length).toBeLessThanOrEqual(2);
    const fg = /** @type {any} */ (s.g);
    expect(fg.lineCap).toBe("round");
    expect(fg.lineJoin).toBe("round");
  });

  it("presses the pen harder when the music is louder", () => {
    const quiet = setup();
    const loud = setup();
    /** @param {ReturnType<typeof setup>} s @param {number} rms */
    const width = (s, rms) => {
      const a = audioFrame();
      a.rms = rms;
      let w = 0;
      for (let f = 0; f < 20; f++) {
        s.log.length = 0;
        s.viz.frame(/** @type {import('../tidalviz').AudioFrame} */ (a), { now: f / 60, dt: 1 / 60, frame: f });
        const st = inkStrokes(s.log)[0];
        if (st) w = /** @type {number} */ (st.width);
      }
      return w;
    };
    // weight 1 × (0.6 + 1.2 loud) × 2 px per CSS px, tapering a little as the swing decays
    const q = width(quiet, 10 ** (-50 / 20));
    expect(q).toBeLessThanOrEqual(1.2);
    expect(q).toBeGreaterThan(1.1);
    expect(width(loud, 10 ** (-10 / 20)) / q).toBeCloseTo(3, 6);
  });

  it("lifts the pen while silent", () => {
    const s = setup();
    run(s, 1);
    let strokes = 0;
    run(s, 120, { silent: true, start: 1, onFrame: (log) => (strokes += inkStrokes(log).length) });
    expect(strokes).toBe(0);
  });

  it("replays the drawing after a resize: the same points to 1e-3 px, spread over frames", () => {
    const s = setup();
    /** @type {number[]} */
    const liveLines = [];
    run(s, 601, { onFrame: (log) => liveLines.push(...lines(log)) });
    // One line point per pen step: 601 frames × 10 steps (the touch-down point included).
    expect(liveLines.length / 2).toBe(6010);

    s.viz.resize?.(s.ctx.size);
    /** @type {number[]} */
    const replay = [];
    let maxPerFrame = 0;
    let fills = 0;
    run(s, 20, {
      silent: true,
      start: 601,
      onFrame: (log) => {
        const l = lines(log);
        maxPerFrame = Math.max(maxPerFrame, l.length / 2);
        replay.push(...l);
        fills += log.filter((e) => isFullFill(e)).length;
      },
    });
    expect(fills).toBeGreaterThan(0);
    expect(maxPerFrame).toBeLessThanOrEqual(6000);
    expect(replay.length).toBe(liveLines.length);
    let worst = 0;
    for (let i = 0; i < replay.length; i++) worst = Math.max(worst, Math.abs(replay[i] - liveLines[i]));
    expect(worst).toBeLessThan(1e-3);
  });

  it("replays a long sheet over several frames, at most 6000 steps each", () => {
    const s = setup({ grid: "3x2" });
    run(s, 60 * 20);
    s.viz.resize?.(s.ctx.size);
    /** @type {number[]} */
    const perFrame = [];
    run(s, 10, { silent: true, start: 1200, onFrame: (log) => perFrame.push(lines(log).length / 2) });
    expect(perFrame[0]).toBe(6000);
    expect(perFrame.reduce((a, b) => a + b, 0)).toBe(1200 * 10 - 0);
  });

  it("re-lays out the replay for a new size", () => {
    const s = setup();
    run(s, 120);
    Object.assign(s.ctx.size, { width: 1280, height: 720, cssWidth: 1280, cssHeight: 720, dpr: 1 });
    s.viz.resize?.(s.ctx.size);
    const log = run(s, 1, { silent: true, start: 120 });
    expect(log.some((e) => isFullFill(e, 1280, 720))).toBe(true);
    const pts = lines(log);
    expect(pts.length / 2).toBe(1200);
    for (let i = 0; i < pts.length; i += 2) {
      expect(pts[i]).toBeLessThan(0.06 * 1280 + (0.88 * 1280 - 3 * 0.04 * 1280) / 4 + 2);
      expect(pts[i + 1]).toBeLessThan(0.06 * 720 + (0.88 * 720 - 2 * 0.04 * 720) / 3 + 2);
    }
  });

  it("redraws paper and replays when the paper or inks change", () => {
    const s = setup();
    run(s, 120);
    /** @type {Record<string, unknown>} */ (s.ctx.params).paper = "cream";
    s.viz.params?.({ paper: "cream" });
    const log = run(s, 1, { silent: true, start: 120 });
    expect(log.some((e) => isFullFill(e) && e.style === "#f2ead8")).toBe(true);
    expect(inkStrokes(log)[0]?.style).toBe("#1f2a44");
    expect(lines(log).length / 2).toBe(1200);
  });

  it("paper 'none' keeps the canvas transparent: a clear instead of a fill", () => {
    const s = setup({ paper: "none" });
    const log = run(s, 1);
    expect(log.some((e) => e.op === "clear" && e.w === 2560 && e.h === 1440)).toBe(true);
    expect(log.some((e) => e.op === "fillRect")).toBe(false);
    run(s, 10, { start: 1 });
    expect(inkStrokes(log)[0]?.style).toBe("#f4f1e8");
  });

  it("falls back to the defaults for stale params", () => {
    const s = setup({ grid: "rings", phrase: "16", paper: "bars", inks: "32", weight: 0.25, chatter: "x", speed: -5 });
    const log = run(s, 30);
    expect(inkStrokes(log)[0]?.style).toBe("#f4f1e8");
    expect(inkStrokes(log)[0]?.width).toBeGreaterThan(0);
  });

  it("feeds a full sheet out with a rising paper band, then plots on a clean sheet", () => {
    const s = setup({ grid: "1x1" });
    let wipeFrames = 0;
    let fullFills = 0;
    let strokesAfter = 0;
    run(s, 1);
    run(s, 60 * 11, {
      start: 1,
      onFrame: (log, f) => {
        const t = f / 60;
        if (t > 8.05 && t < 9.45) {
          const band = log.filter((e) => e.op === "fillRect" && e.style === "#183a63");
          if (band.length) wipeFrames++;
          for (const b of band) expect(b.h).toBeLessThan(1440 / 10);
          expect(inkStrokes(log).length).toBe(0);
        }
        fullFills += log.filter((e) => isFullFill(e)).length;
        if (t > 10) strokesAfter += inkStrokes(log).length;
      },
    });
    expect(wipeFrames).toBeGreaterThan(70);
    expect(fullFills).toBe(0);
    expect(strokesAfter).toBeGreaterThan(30);
  });

  it("with Reduce motion, fades the sheet out over 3 s instead of wiping", () => {
    const s = setup({ grid: "1x1" }, { reduceMotion: true });
    /** @type {number[]} */
    const alphas = [];
    run(s, 1);
    run(s, 60 * 12, {
      start: 1,
      onFrame: (log) => {
        for (const e of log) if (isFullFill(e) && /** @type {number} */ (e.alpha) < 1) alphas.push(/** @type {number} */ (e.alpha));
      },
    });
    expect(alphas.length).toBeGreaterThan(170);
    expect(alphas.length).toBeLessThan(185);
    expect(alphas[0]).toBeCloseTo(0.04, 3);
  });

  it("with Reduce motion, draws at 0.6 × the default speed but honours a chosen speed", () => {
    /** @param {Partial<typeof DEFAULTS>} p @param {boolean} rm */
    const len = (p, rm) => {
      const s = setup({ chatter: 0, ...p }, { reduceMotion: rm });
      /** @type {number[]} */
      const pts = [];
      run(s, 30, { onFrame: (log) => pts.push(...lines(log)) });
      return pathLength(pts);
    };
    expect(len({}, true) / len({}, false)).toBeCloseTo(0.6, 1);
    expect(len({ speed: 1.5 }, true) / len({ speed: 1.5 }, false)).toBeCloseTo(1, 6);
  });

  it("a smaller grid keeps the cell being drawn", () => {
    const s = setup();
    run(s, 60 * 17); // third cell (index 2) in progress
    /** @type {Record<string, unknown>} */ (s.ctx.params).grid = "1x1";
    s.viz.params?.({ grid: "1x1" });
    const log = run(s, 1, { silent: true, start: 60 * 17 });
    expect(lines(log).length / 2).toBe(60 * 10 * 1 - 0);
  });
});
