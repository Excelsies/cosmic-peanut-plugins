// @ts-check
import { describe, expect, it } from "vitest";
import { createMeter } from "./meter.js";
import { cellRect, createSheet, DRAW, EV_END, EV_FED, EV_FEED, EV_START, FEED, loudness, sheetStep, WAIT } from "./sheet.js";

const DT = 1 / 60;

/**
 * Drive a sheet with a clean beat clock. `silentAt(t)` marks silent frames. Returns the events
 * with their times and the beat count at the time.
 */
function drive(
  /** @type {{ bpm?: number, seconds: number, cells?: number, bars?: number, silentAt?: (t: number) => boolean, offset?: number }} */ o,
) {
  const sh = createSheet();
  const m = createMeter();
  const cfg = { cells: o.cells ?? 12, phraseBars: o.bars ?? 4, feedDur: 1.5 };
  const bpm = o.bpm ?? 120;
  /** @type {{ t: number, ev: number, cell: number, beats: number, state: number }[]} */
  const log = [];
  for (let f = 0; f < Math.round(o.seconds * 60); f++) {
    const t = f * DT;
    const silent = o.silentAt?.(t) ?? false;
    const phase = bpm > 0 ? (((t + (o.offset ?? 0)) * bpm) / 60) % 1 : 0;
    const beat = !silent && m.step(bpm, phase, DT);
    const ev = sheetStep(sh, cfg, silent, bpm, beat, m.beats, DT);
    if (ev) log.push({ t, ev, cell: sh.cell, beats: m.beats, state: sh.state });
  }
  return { sh, log };
}

describe("sheet clock", () => {
  it("starts the first phrase at once, then every later phrase on a multiple of 4 beats", () => {
    // Offset so the first beat lands 0.1 s in: the first phrase starts off the bar line.
    const { log } = drive({ seconds: 40, offset: 0.4 });
    const starts = log.filter((e) => e.ev & EV_START);
    expect(starts[0].t).toBe(0);
    expect(starts.length).toBeGreaterThanOrEqual(4);
    for (const s of starts.slice(1)) expect(s.beats % 4).toBe(0);
    // 4 bars at 120 BPM = 16 beats = 8 s between aligned starts.
    expect(starts[2].t - starts[1].t).toBeCloseTo(8, 1);
    expect(starts[3].beats - starts[2].beats).toBe(16);
  });

  it("an ending phrase hands straight over to the next one on the same beat", () => {
    const { log } = drive({ seconds: 30 });
    const ends = log.filter((e) => e.ev & EV_END);
    expect(ends.length).toBeGreaterThan(1);
    for (const e of ends.slice(1)) expect(e.ev & EV_START).toBeTruthy();
  });

  it("uses Phrase bars × 4 beats", () => {
    const { log } = drive({ seconds: 40, bars: 2 });
    const starts = log.filter((e) => e.ev & EV_START);
    expect(starts[3].beats - starts[2].beats).toBe(8);
  });

  it("makes 8 s phrases when there is no tempo", () => {
    const { log } = drive({ bpm: 0, seconds: 30 });
    const starts = log.filter((e) => e.ev & EV_START).map((e) => e.t);
    expect(starts.slice(0, 4).map((t) => Math.round(t * 60))).toEqual([0, 480, 960, 1440]);
  });

  it("pauses the phrase clock while silent", () => {
    // 2 s of silence inside the first phrase pushes its end back by 2 s.
    const { log } = drive({ bpm: 0, seconds: 20, silentAt: (t) => t >= 3 && t < 5 });
    const ends = log.filter((e) => e.ev & EV_END);
    expect(ends[0].t).toBeCloseTo(10, 1);
  });

  it("ends the cell after 4 s of silence and waits for sound to start the next", () => {
    const { log, sh } = drive({ bpm: 0, seconds: 12, silentAt: (t) => t >= 2 });
    const ends = log.filter((e) => e.ev & EV_END);
    expect(ends.length).toBe(1);
    expect(ends[0].t).toBeCloseTo(6, 1);
    expect(sh.state).toBe(WAIT);
    expect(sh.cell).toBe(1);
  });

  it("fills cells in order and feeds a full sheet, then starts over at cell 0", () => {
    const { log, sh } = drive({ bpm: 0, seconds: 8 * 6 + 2, cells: 6 });
    const cells = log.filter((e) => e.ev & EV_START).map((e) => e.cell);
    expect(cells).toEqual([0, 1, 2, 3, 4, 5, 0]);
    const feed = log.find((e) => e.ev & EV_FEED);
    const fed = log.find((e) => e.ev & EV_FED);
    expect(feed?.t).toBeCloseTo(48, 1);
    expect((fed?.t ?? 0) - (feed?.t ?? 0)).toBeCloseTo(1.5, 1);
    expect(sh.state).toBe(DRAW);
  });

  it("reports the state while feeding", () => {
    const sh = createSheet();
    const cfg = { cells: 1, phraseBars: 4, feedDur: 1.5 };
    sheetStep(sh, cfg, false, 0, false, 0, DT);
    for (let f = 0; f < 480; f++) sheetStep(sh, cfg, false, 0, false, 0, DT);
    expect(sh.state).toBe(FEED);
    expect(sh.feedT).toBeGreaterThanOrEqual(0);
  });

  it("waits through silence before the first phrase", () => {
    const sh = createSheet();
    const cfg = { cells: 12, phraseBars: 4, feedDur: 1.5 };
    expect(sheetStep(sh, cfg, true, 0, false, 0, DT)).toBe(0);
    expect(sh.state).toBe(WAIT);
    expect(sheetStep(sh, cfg, false, 0, false, 0, DT)).toBe(EV_START);
  });
});

describe("layout", () => {
  it("places cells left to right, top to bottom inside 6 % margins with 4 % gutters", () => {
    const r = { x: 0, y: 0, w: 0, h: 0 };
    cellRect(0, 4, 3, 1000, 500, r);
    expect(r.x).toBeCloseTo(60);
    expect(r.y).toBeCloseTo(30);
    expect(r.w).toBeCloseTo((880 - 3 * 40) / 4);
    expect(r.h).toBeCloseTo((440 - 2 * 20) / 3);
    const first = { ...r };
    cellRect(1, 4, 3, 1000, 500, r);
    expect(r.x).toBeCloseTo(first.x + first.w + 40);
    expect(r.y).toBe(first.y);
    cellRect(4, 4, 3, 1000, 500, r);
    expect(r.x).toBe(first.x);
    expect(r.y).toBeCloseTo(first.y + first.h + 20);
    cellRect(11, 4, 3, 1000, 500, r);
    expect(r.x + r.w).toBeCloseTo(940);
    expect(r.y + r.h).toBeCloseTo(470);
  });
});

describe("loudness", () => {
  it("maps -50…-10 dBFS RMS onto 0…1", () => {
    expect(loudness(0)).toBe(0);
    expect(loudness(10 ** (-50 / 20))).toBeCloseTo(0, 6);
    expect(loudness(10 ** (-30 / 20))).toBeCloseTo(0.5, 6);
    expect(loudness(0.5)).toBe(1);
  });
});
