// @ts-check
/**
 * Plotter's parameters: option tables (same order as the manifest), the paper and ink colours,
 * and `resolveParams`, which turns raw `ctx.params` into plain numbers with every unknown or stale
 * value falling back to its default.
 */

export const GRID_OPTIONS = ["4x3", "3x2", "6x4", "1x1"];
const GRID_COLS = [4, 3, 6, 1];
const GRID_ROWS = [3, 2, 4, 1];
export const PHRASE_OPTIONS = ["2 bars", "4 bars", "8 bars"];
const PHRASE_BARS = [2, 4, 8];
export const PAPER_OPTIONS = ["blueprint", "cream", "white", "none"];
export const INK_OPTIONS = ["fineliner", "sepia", "mono"];

/** Manifest defaults the reduce-motion rules key off (pinned by the test). */
export const DEFAULT_SPEED = 1;
export const DEFAULT_CHATTER = 0.5;
/** Speed used instead of the default while Reduce motion is on. */
export const REDUCED_SPEED = 0.6;

/** Paper fills; null = transparent ("none"). */
export const PAPER_FILL = ["#183a63", "#f2ead8", "#fbfbf8", null];
/** Whether the paper takes the dark ink variants. */
export const PAPER_DARK = [false, true, true, false];
/** Faint 20 px graph grid per paper. */
export const PAPER_GRID = ["rgba(255,255,255,0.05)", "rgba(46,70,110,0.08)", "rgba(46,70,110,0.07)", null];
/** Crop marks per paper. */
export const PAPER_MARKS = ["rgba(255,255,255,0.5)", "rgba(40,36,30,0.5)", "rgba(40,40,40,0.45)", "rgba(255,255,255,0.4)"];

/** INKS[set][0 = light, 1 = dark][colour by centroid quartile]. */
export const INKS = [
  [
    ["#f4f1e8", "#a9dcef", "#f1df8c", "#f3a089"],
    ["#1f2a44", "#8a3b1c", "#1f6b52", "#a3172f"],
  ],
  [
    ["#f3e6cf", "#e8d3ae", "#dcc08f", "#cfa977"],
    ["#3d2b1f", "#5a3a22", "#7b4b2a", "#9a6a3a"],
  ],
  [
    ["#f4f4f4", "#f4f4f4", "#f4f4f4", "#f4f4f4"],
    ["#1a1a1a", "#1a1a1a", "#1a1a1a", "#1a1a1a"],
  ],
];

/**
 * Stroke colour for a cell (a prebuilt string; no allocation).
 * @param {number} paper index into PAPER_OPTIONS
 * @param {number} inks index into INK_OPTIONS
 * @param {number} ink colour index 0–3
 */
export function inkStyle(paper, inks, ink) {
  return INKS[inks][PAPER_DARK[paper] ? 1 : 0][ink & 3];
}

export function createParams() {
  return { grid: 0, cols: 4, rows: 3, phraseBars: 4, paper: 0, inks: 0, weight: 1, chatter: DEFAULT_CHATTER, speed: DEFAULT_SPEED };
}

/** @param {unknown} v @param {string[]} options @param {number} fallback */
function pick(v, options, fallback) {
  const i = typeof v === "string" ? options.indexOf(v) : -1;
  return i < 0 ? fallback : i;
}

/** @param {unknown} v @param {number} min @param {number} max @param {number} fallback */
function num(v, min, max, fallback) {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return n < min ? min : n > max ? max : n;
}

/**
 * @param {Readonly<Record<string, unknown>>} raw ctx.params
 * @param {boolean} reduceMotion
 * @param {ReturnType<typeof createParams>} out
 */
export function resolveParams(raw, reduceMotion, out) {
  out.grid = pick(raw.grid, GRID_OPTIONS, 0);
  out.cols = GRID_COLS[out.grid];
  out.rows = GRID_ROWS[out.grid];
  out.phraseBars = PHRASE_BARS[pick(raw.phrase, PHRASE_OPTIONS, 1)];
  out.paper = pick(raw.paper, PAPER_OPTIONS, 0);
  out.inks = pick(raw.inks, INK_OPTIONS, 0);
  out.weight = num(raw.weight, 0.5, 3, 1);
  const chatter = num(raw.chatter, 0, 1, DEFAULT_CHATTER);
  out.chatter = reduceMotion && chatter === DEFAULT_CHATTER ? chatter * 0.5 : chatter;
  const speed = num(raw.speed, 0.25, 2, DEFAULT_SPEED);
  out.speed = reduceMotion && speed === DEFAULT_SPEED ? REDUCED_SPEED : speed;
  return out;
}
