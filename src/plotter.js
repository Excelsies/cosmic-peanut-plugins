// @ts-check
/**
 * Plotter — a pen plotter drawing one decaying harmonograph per musical phrase.
 *
 * The canvas is a sheet of paper (blueprint by default) divided into a grid of cells. In the
 * current cell a thin ink line traces two damped pendulums per axis in real time, spiralling
 * inward over the phrase. The harmony picks the y : x frequency ratio (clean rosettes for
 * consonant intervals, dense moiré webs for dissonant ones), loudness presses the pen harder,
 * every hit kinks the line and hats make the pen chatter. At the end of the phrase the pen lifts
 * and moves to the next cell; a full sheet is fed out by a rising band of fresh paper.
 *
 * The canvas is drawn on incrementally and never cleared per frame: paper and crop marks are
 * painted once per sheet, then each frame strokes only the new few pen steps. Everything that
 * moves the pen is recorded per cell (lib/harmonograph.js), so a resize or a paper / ink / grid
 * change repaints the paper and replays the sheet from the records, at most 6000 pen steps per
 * frame. Nothing is allocated per frame.
 */
import { createHarmonicChroma, harmonicChromaUpdate } from "./lib/harmonic-chroma.js";
import { createFixedStep } from "./lib/fixedstep.js";
import {
  angularSpeed,
  beginCell,
  clearRecords,
  createPen,
  createRecords,
  damping,
  MAX_SLOTS,
  MAX_STEPS,
  moveCell,
  penPoints,
  penSetup,
  precession,
  recordOnset,
  recordSlots,
  SLOT_STEPS,
  slotOf,
  STEP_HZ,
} from "./lib/harmonograph.js";
import { intervalRatio } from "./lib/interval.js";
import { createMeter } from "./lib/meter.js";
import { createParams, inkStyle, PAPER_FILL, PAPER_GRID, PAPER_MARKS, resolveParams } from "./lib/plotter-params.js";
import { cellRect, createSheet, DRAW, EV_FED, EV_FEED, EV_START, FEED, loudness, sheetStep } from "./lib/sheet.js";
import { createStereo, energyBalance, stereoFrame } from "./lib/stereo.js";

/** Pen steps a replay may draw per frame (~2 ms on an M1-class CPU). */
const REPLAY_BUDGET = 6000;
/** Paper-feed wipe and the reduce-motion fade (s). */
const FEED_WIPE = 1.5;
const FEED_FADE = 3;
/** Graph grid pitch in CSS px. */
const GRID_CSS = 20;
/** Phrase-mean centroids remembered for picking a cell's ink by quartile. */
const HISTORY = 16;
const GRAIN = 256;
/** Figure radius as a share of the cell's shorter side (the full swing is rarely reached). */
const FIGURE = 0.48;
/** Line width at the end of the decay, as a share of the full-swing width. */
const TAPER = 0.4;

/** @type {import('../tidalviz').CreateVisualizer} */
export default function create(ctx) {
  const g = /** @type {CanvasRenderingContext2D} */ (ctx.ctx2d);
  const P = createParams();
  let reduceMotion = ctx.reduceMotion;
  resolveParams(ctx.params, reduceMotion, P);

  const sheet = createSheet();
  const sheetCfg = { cells: P.cols * P.rows, phraseBars: P.phraseBars, feedDur: FEED_WIPE };
  const meter = createMeter();
  const chroma = createHarmonicChroma();
  const stereo = createStereo();
  const rec = createRecords();
  const pen = createPen();
  const clock = createFixedStep(1 / STEP_HZ, MAX_STEPS);
  let sheetNo = 0;

  // Audio means over the current phrase window; a new cell takes the previous phrase's.
  let accN = 0;
  let accCentroid = 0;
  let accBass = 0;
  let accWidth = 0;
  let accBalance = 0;
  const centroidHistory = new Float64Array(HISTORY);
  let historyN = 0;
  let historyAt = 0;

  // Drawer: the next pen step to put on the canvas, and the last point drawn.
  const dr = { cell: 0, step: 0, x: 0, y: 0, penCell: -1 };
  const box = { x: 0, y: 0, w: 0, h: 0 };

  let W = 0;
  let H = 0;
  let pxScale = 1;
  let needRepaint = true;
  /** Wipe: lowest y already covered by fresh paper (H = nothing yet). */
  let feedTop = 0;
  let feedFade = false;
  let feedDone = false;
  const grain = makeGrain();

  function relayout() {
    const s = ctx.size;
    W = s.width;
    H = s.height;
    pxScale = s.cssWidth > 0 ? s.width / s.cssWidth : s.dpr || 1;
    dr.penCell = -1;
  }
  relayout();

  /** A 256² tile of faint hash noise (built once), used as paper grain. */
  function makeGrain() {
    try {
      /** @type {HTMLCanvasElement | OffscreenCanvas} */
      const c = typeof document !== "undefined" ? document.createElement("canvas") : new OffscreenCanvas(GRAIN, GRAIN);
      c.width = GRAIN;
      c.height = GRAIN;
      const gc = /** @type {CanvasRenderingContext2D | null} */ (c.getContext("2d"));
      if (!gc) return null;
      const img = gc.createImageData(GRAIN, GRAIN);
      const d = img.data;
      for (let i = 0; i < GRAIN * GRAIN; i++) {
        let x = Math.imul(i ^ 0x27d4eb2d, 0x165667b1);
        x ^= x >>> 15;
        x = Math.imul(x, 0x85ebca77);
        x ^= x >>> 13;
        const v = (x >>> 0) / 4294967296;
        const light = v > 0.5;
        d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = light ? 255 : 0;
        d[4 * i + 3] = Math.round(Math.abs(v - 0.5) * 2 * 16);
      }
      gc.putImageData(img, 0, 0);
      return g.createPattern(/** @type {CanvasImageSource} */ (c), "repeat");
    } catch {
      return null; // paper without grain
    }
  }

  /** Fresh paper over rows y0…y1 (clipped to the band so grid lines don't spill). */
  function paintPaper(/** @type {number} */ y0, /** @type {number} */ y1) {
    if (y1 <= y0) return;
    const fill = PAPER_FILL[P.paper];
    if (!fill) {
      g.clearRect(0, y0, W, y1 - y0);
      return;
    }
    g.save();
    g.beginPath();
    g.rect(0, y0, W, y1 - y0);
    g.clip();
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.fillStyle = fill;
    g.fillRect(0, y0, W, y1 - y0);
    if (grain) {
      g.fillStyle = grain;
      g.fillRect(0, y0, W, y1 - y0);
    }
    const grid = PAPER_GRID[P.paper];
    if (grid) {
      const step = GRID_CSS * pxScale;
      g.strokeStyle = grid;
      g.lineWidth = Math.max(1, pxScale * 0.5);
      g.beginPath();
      for (let x = step; x < W; x += step) {
        g.moveTo(x, y0);
        g.lineTo(x, y1);
      }
      for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
        g.moveTo(0, y);
        g.lineTo(W, y);
      }
      g.stroke();
    }
    g.restore();
  }

  /** Small L-shaped crop marks just outside the corners of the cell area. */
  function cropMarks() {
    const mx = 0.06 * W;
    const my = 0.06 * H;
    const len = 10 * pxScale;
    const gap = 4 * pxScale;
    g.strokeStyle = PAPER_MARKS[P.paper];
    g.lineWidth = Math.max(1, 0.6 * pxScale);
    g.lineCap = "butt";
    g.beginPath();
    for (let c = 0; c < 4; c++) {
      const x = c & 1 ? W - mx : mx;
      const y = c & 2 ? H - my : my;
      const sx = c & 1 ? 1 : -1;
      const sy = c & 2 ? 1 : -1;
      g.moveTo(x + sx * gap, y);
      g.lineTo(x + sx * (gap + len), y);
      g.moveTo(x, y + sy * gap);
      g.lineTo(x, y + sy * (gap + len));
    }
    g.stroke();
  }

  /** Whole fresh sheet; restart the drawer so the records replay. */
  function repaint() {
    needRepaint = false;
    paintPaper(0, H);
    cropMarks();
    dr.cell = 0;
    dr.step = 0;
    dr.penCell = -1;
    if (sheet.state === FEED) feedDone = true;
  }

  function startCell(/** @type {number} */ i, /** @type {import('../tidalviz').AudioFrame} */ audio) {
    const n = accN;
    const c = n ? accCentroid / n : audio.centroid || 0;
    const bass = n ? accBass / n : 1;
    const width = n ? accWidth / n : 0;
    const balance = n ? accBalance / n : 0;
    let below = 0;
    for (let k = 0; k < historyN; k++) if (centroidHistory[k] < c) below++;
    const ink = historyN ? Math.min(3, Math.floor((4 * below) / historyN)) : 0;
    centroidHistory[historyAt] = c;
    historyAt = (historyAt + 1) % HISTORY;
    if (historyN < HISTORY) historyN++;
    beginCell(
      rec,
      i,
      sheetNo * 24 + i,
      angularSpeed(P.speed),
      intervalRatio(chroma.pcs),
      precession(c),
      damping(sheet.phraseLen, bass),
      width,
      balance,
      ink,
    );
    accN = accCentroid = accBass = accWidth = accBalance = 0;
    clock.reset();
  }

  function freshSheet() {
    clearRecords(rec);
    sheetNo++;
    dr.cell = 0;
    dr.step = 0;
    dr.penCell = -1;
  }

  /** Put pen steps on the canvas up to (cell, step), at most REPLAY_BUDGET of them. */
  function drawTo(/** @type {number} */ cell, /** @type {number} */ target) {
    let budget = REPLAY_BUDGET;
    while (budget > 0 && dr.cell <= cell) {
      const end = dr.cell < cell ? rec.steps[dr.cell] : target;
      if (dr.step >= end) {
        if (dr.cell >= cell) break;
        dr.cell++;
        dr.step = 0;
        continue;
      }
      if (dr.penCell !== dr.cell) {
        cellRect(dr.cell, P.cols, P.rows, W, H, box);
        penSetup(pen, rec, dr.cell, box.x + box.w / 2, box.y + box.h / 2, FIGURE * Math.min(box.w, box.h), P.chatter);
        dr.penCell = dr.cell;
      }
      pen.chatter = P.chatter;
      if (dr.step === 0) {
        // Touch down: the first segment starts (and ends) on point 0, leaving a dot.
        const p = penPoints(pen, rec, 0, 1);
        dr.x = p[0];
        dr.y = p[1];
      }
      const slot = slotOf(dr.step);
      let n = Math.min(end, (slot + 1) * SLOT_STEPS) - dr.step;
      if (slot === MAX_SLOTS - 1) n = end - dr.step;
      n = Math.min(n, budget, MAX_STEPS);
      const pts = penPoints(pen, rec, dr.step, n);
      g.strokeStyle = inkStyle(P.paper, P.inks, rec.ink[dr.cell]);
      // Pressure from loudness; the line also thins as the swing decays, so the centre stays lacy.
      const press = 0.6 + (1.2 * rec.weight[dr.cell * MAX_SLOTS + slot]) / 255;
      g.lineWidth = P.weight * press * pxScale * (TAPER + (1 - TAPER) * pen.env);
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      g.moveTo(dr.x, dr.y);
      for (let k = 0; k < n; k++) g.lineTo(pts[2 * k], pts[2 * k + 1]);
      g.stroke();
      dr.x = pts[2 * n - 2];
      dr.y = pts[2 * n - 1];
      dr.step += n;
      budget -= n;
    }
  }

  function advanceFeed(/** @type {number} */ dt) {
    if (feedDone) return;
    if (feedFade) {
      const fill = PAPER_FILL[P.paper];
      g.globalAlpha = 1 - Math.pow(0.96, dt * 60);
      if (fill) {
        g.fillStyle = fill;
        g.fillRect(0, 0, W, H);
      } else {
        g.globalCompositeOperation = "destination-out";
        g.fillStyle = "#000";
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = "source-over";
      }
      g.globalAlpha = 1;
      return;
    }
    // Wipe: a band of fresh paper rises from the bottom; a faint shadow marks its edge.
    const top = Math.max(0, Math.round(H * (1 - sheet.feedT / FEED_WIPE)));
    const shadow = 3 * pxScale;
    if (top < feedTop) {
      paintPaper(top, Math.min(H, feedTop + shadow + 1));
      feedTop = top;
      if (top > 0 && PAPER_FILL[P.paper]) {
        g.strokeStyle = "rgba(0,0,0,0.12)";
        g.lineWidth = shadow;
        g.lineCap = "butt";
        g.beginPath();
        g.moveTo(0, top + shadow / 2);
        g.lineTo(W, top + shadow / 2);
        g.stroke();
      }
    }
  }

  function endFeed() {
    if (!feedDone) {
      if (feedFade) paintPaper(0, H);
      else paintPaper(0, Math.min(H, feedTop + 3 * pxScale + 1));
      cropMarks();
    }
    freshSheet();
  }

  /** A smaller grid that no longer holds the current cell keeps just that cell, as cell 0. */
  function fitGrid() {
    const cells = P.cols * P.rows;
    sheetCfg.cells = cells;
    if (sheet.cell < cells || sheet.state === FEED) return;
    if (sheet.state === DRAW) moveCell(rec, sheet.cell, 0);
    const keep = sheet.state === DRAW ? rec.steps[0] : 0;
    const kept = rec.onsets[0];
    const slots = rec.slots[0];
    clearRecords(rec);
    rec.steps[0] = keep;
    rec.onsets[0] = keep ? kept : 0;
    rec.slots[0] = keep ? slots : 0;
    sheet.cell = 0;
  }

  return {
    frame(audio, time) {
      const dt = time.dt;
      if (ctx.reduceMotion !== reduceMotion) {
        reduceMotion = ctx.reduceMotion;
        resolveParams(ctx.params, reduceMotion, P);
      }
      if (needRepaint) repaint();
      const silent = audio.silent;
      if (!silent) {
        harmonicChromaUpdate(chroma, audio.spectrum, audio.sampleRate, dt);
        stereoFrame(audio.left, audio.right, stereo);
        accCentroid += audio.centroid || 0;
        accBass += audio.bassAtt || 1;
        accWidth += stereo.width;
        accBalance += energyBalance(stereo.balance);
        accN++;
      }
      const beat = !silent && meter.step(audio.bpm || 0, audio.beatPhase || 0, dt);
      sheetCfg.phraseBars = P.phraseBars;
      if (sheet.state !== FEED) sheetCfg.feedDur = reduceMotion ? FEED_FADE : FEED_WIPE;
      const ev = sheetStep(sheet, sheetCfg, silent, audio.bpm || 0, beat, meter.beats, dt);
      if (ev & EV_FEED) {
        feedFade = reduceMotion;
        feedTop = H;
        feedDone = false;
      }
      if (ev & EV_FED) endFeed();
      if (ev & EV_START) startCell(sheet.cell, audio);

      if (sheet.state === DRAW && !silent) {
        const i = sheet.cell;
        if (audio.onset) recordOnset(rec, i, audio.onsetStrength);
        const n = clock.advance(dt);
        const upTo = Math.min(rec.steps[i] + n, MAX_SLOTS * SLOT_STEPS);
        recordSlots(rec, i, upTo, loudness(audio.rms), (audio.trebAtt || 1) - 1);
        rec.steps[i] = upTo;
      } else {
        clock.reset();
      }

      if (sheet.state === FEED) advanceFeed(dt);
      else drawTo(sheet.cell, rec.steps[sheet.cell]);
    },

    resize() {
      relayout();
      needRepaint = true;
    },

    params(changed) {
      resolveParams(ctx.params, reduceMotion, P);
      if ("grid" in changed) fitGrid();
      if ("grid" in changed || "paper" in changed || "inks" in changed) needRepaint = true;
    },

    dispose() {},
  };
}
