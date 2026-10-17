// @ts-check
/**
 * Plotter's sheet: the phrase clock that decides when the pen draws, lifts, moves to the next cell
 * and when a full sheet is fed out, plus the cell layout and the loudness → pen pressure map.
 *
 * Phrase clock (pure state machine, `sheetStep` once per frame):
 * - WAIT: the pen is up. The very first phrase starts on the first sounding frame; later ones
 *   start on a counted beat whose number is a multiple of 4 (a bar line), immediately when there
 *   is no tempo, or after 4 beats + 0.5 s if no bar line arrives.
 * - DRAW: one phrase = Phrase bars × 4 beats. It ends on the first bar line once that many beats
 *   have been counted (so a phrase that started off the bar line still ends on one), or after
 *   1.5 × its nominal length as a safety net. Without tempo a phrase is 8 s. Silence lifts the pen
 *   and pauses the clock; 4 s of silence ends the cell.
 * - FEED: after the last cell, the sheet is fed out for `feedDur` seconds, then cell 0 is next.
 * An ending phrase falls through to WAIT in the same step, so on a bar line the next phrase
 * starts on the very beat the last one ended.
 */

export const WAIT = 0;
export const DRAW = 1;
export const FEED = 2;

/** Event bits returned by sheetStep. */
export const EV_START = 1;
export const EV_END = 2;
export const EV_FEED = 4;
export const EV_FED = 8;

/** Phrase length without tempo (s). */
export const FREE_PHRASE = 8;
/** Seconds of silence that end the current cell. */
export const SILENCE_END = 4;
/** Slack for summed frame times (480 × 1/60 is a hair under 8). */
const EPS = 1e-6;

export function createSheet() {
  return {
    state: WAIT,
    /** Current (or next) cell index. */
    cell: 0,
    /** A phrase has started since creation (only the first one skips bar alignment). */
    started: false,
    /** Seconds the pen has been down in this phrase (paused while silent). */
    elapsed: 0,
    /** Nominal phrase length (s), fixed when the phrase starts. */
    phraseLen: FREE_PHRASE,
    /** Beats to count in this phrase; 0 = time-based (no tempo at the start). */
    beatsTarget: 0,
    beatsDone: 0,
    silence: 0,
    wait: 0,
    feedT: 0,
  };
}

/**
 * Advance one frame. Allocates nothing.
 * @param {ReturnType<typeof createSheet>} sh
 * @param {{ cells: number, phraseBars: number, feedDur: number }} cfg
 * @param {boolean} silent
 * @param {number} bpm 0 when unknown
 * @param {boolean} beat a beat was counted this frame (meter.js)
 * @param {number} beats the meter's beat count
 * @param {number} dt
 * @returns {number} EV_* bits
 */
export function sheetStep(sh, cfg, silent, bpm, beat, beats, dt) {
  let ev = 0;
  if (sh.state === FEED) {
    sh.feedT += dt;
    if (sh.feedT < cfg.feedDur - EPS) return ev;
    sh.state = WAIT;
    sh.cell = 0;
    sh.wait = 0;
    ev |= EV_FED;
  }
  if (sh.state === DRAW) {
    let end = false;
    if (silent) {
      sh.silence += dt;
      end = sh.silence >= SILENCE_END - EPS;
    } else {
      sh.silence = 0;
      sh.elapsed += dt;
      if (beat) sh.beatsDone++;
      if (sh.beatsTarget > 0 && bpm > 0) {
        end = (beat && sh.beatsDone >= sh.beatsTarget && beats % 4 === 0) || sh.elapsed >= 1.5 * sh.phraseLen - EPS;
      } else {
        end = sh.elapsed >= sh.phraseLen - EPS;
      }
    }
    if (!end) return ev;
    ev |= EV_END;
    sh.cell++;
    sh.wait = 0;
    if (sh.cell >= cfg.cells) {
      sh.state = FEED;
      sh.feedT = 0;
      return ev | EV_FEED;
    }
    sh.state = WAIT;
  }
  // WAIT
  if (silent) return ev;
  sh.wait += dt;
  const go = !sh.started || !(bpm > 0) || (beat && beats % 4 === 0) || sh.wait >= 240 / bpm + 0.5;
  if (!go) return ev;
  sh.started = true;
  sh.state = DRAW;
  sh.elapsed = 0;
  sh.silence = 0;
  sh.beatsDone = 0;
  if (bpm > 0) {
    sh.beatsTarget = cfg.phraseBars * 4;
    sh.phraseLen = (sh.beatsTarget * 60) / bpm;
  } else {
    sh.beatsTarget = 0;
    sh.phraseLen = FREE_PHRASE;
  }
  return ev | EV_START;
}

/** Sheet margins and gutters as fractions of the canvas width (x) and height (y). */
export const MARGIN = 0.06;
export const GUTTER = 0.04;

/**
 * Rectangle of cell `i` (row-major: left to right, top to bottom). Allocates nothing.
 * @param {number} i
 * @param {number} cols
 * @param {number} rows
 * @param {number} w canvas width
 * @param {number} h canvas height
 * @param {{ x: number, y: number, w: number, h: number }} out
 */
export function cellRect(i, cols, rows, w, h, out) {
  const cw = (w * (1 - 2 * MARGIN) - (cols - 1) * GUTTER * w) / cols;
  const ch = (h * (1 - 2 * MARGIN) - (rows - 1) * GUTTER * h) / rows;
  const c = i % cols;
  const r = Math.floor(i / cols);
  out.x = MARGIN * w + c * (cw + GUTTER * w);
  out.y = MARGIN * h + r * (ch + GUTTER * h);
  out.w = cw;
  out.h = ch;
  return out;
}

/**
 * Pen pressure from the hop's RMS: −50 dBFS → 0, −10 dBFS → 1, clamped.
 * @param {number} rms
 */
export function loudness(rms) {
  if (!(rms > 0)) return 0;
  const v = (20 * Math.log10(rms) + 50) / 40;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
