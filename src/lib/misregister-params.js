// @ts-check
/**
 * Misregister's parameters: palettes, papers, the param resolver (unknown or stale values fall
 * back to the manifest defaults, numbers are clamped to the manifest ranges) and the Reduce
 * motion rules. tests/test_builtin_manifests.py pins the manifest to these values.
 */

/** Manifest options, in manifest (= index) order. */
export const PALETTE_NAMES = ["riso", "bauhaus", "sunset", "mono"];
/** Inks of plates 0, 1, 2 per palette (same order as PALETTE_NAMES). */
export const PALETTES = [
  ["#ff48b0", "#0078bf", "#ffe800"],
  ["#e4352b", "#1f4e9c", "#f6c018"],
  ["#ff6c2f", "#ff48b0", "#3d5588"],
  ["#1a1a1a", "#1a1a1a", "#1a1a1a"],
];
export const PAPER_NAMES = ["cream", "white", "kraft", "none"];
/** Paper colour per PAPER_NAMES entry; "" = no paper (transparent sheet). */
export const PAPERS = ["#f2ead8", "#fbfbf8", "#c9a878", ""];
export const RELAYOUT_OPTIONS = ["8 bars", "16 bars", "32 bars", "never"];
/** Bars between re-layouts per RELAYOUT_OPTIONS entry; 0 = never. */
export const RELAYOUT_BARS = [8, 16, 32, 0];
export const DEFAULT_RELAYOUT = "8 bars";

export const DEFAULTS = {
  palette: "riso",
  paper: "cream",
  screen: 90,
  misregister: 0.5,
  grain: 0.4,
  relayout: DEFAULT_RELAYOUT,
  reactivity: 1,
};

/** Number param ranges, as in the manifest. */
const RANGES = {
  screen: [30, 160],
  misregister: [0, 1],
  grain: [0, 1],
  reactivity: [0, 2],
};

/** Smallest halftone cell, device px (finer screens alias into mush). */
export const MIN_CELL_PX = 5;
/** Re-layout slide, seconds (normal / Reduce motion). */
export const SLIDE_SECONDS = 1.5;
export const SLIDE_SECONDS_REDUCED = 4;
/** Bars between re-layouts under Reduce motion while Re-layout is at its default. */
export const RELAYOUT_BARS_REDUCED = 32;

/**
 * @typedef {object} Resolved
 * @property {number} palette index into PALETTES
 * @property {number} paper index into PAPERS
 * @property {number} screen screen ruling: cells per canvas height
 * @property {number} misregister 0–1
 * @property {number} grain 0–1
 * @property {number} reactivity 0–2
 * @property {number} relayoutBars bars between re-layouts, 0 = never
 * @property {number} slideSeconds duration of a re-layout slide
 * @property {number} joltScale multiplier on kick jolts
 * @property {number} shimmer multiplier on the hi-hat screen shimmer (0 = off)
 */

/** @param {unknown} v @param {string[]} options @param {string} fallback */
function indexOf(v, options, fallback) {
  const i = typeof v === "string" ? options.indexOf(v) : -1;
  return i >= 0 ? i : options.indexOf(fallback);
}

/** @param {unknown} v @param {keyof typeof RANGES} key */
function num(v, key) {
  const [lo, hi] = RANGES[key];
  const x = typeof v === "number" && Number.isFinite(v) ? v : DEFAULTS[key];
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Turn raw param values into what the renderer uses. Allocates nothing.
 * @param {Readonly<Record<string, unknown>>} params usually `ctx.params`
 * @param {boolean} reduceMotion `ctx.reduceMotion`
 * @param {Resolved} out
 * @returns {Resolved}
 */
export function resolveParams(params, reduceMotion, out) {
  out.palette = indexOf(params.palette, PALETTE_NAMES, DEFAULTS.palette);
  out.paper = indexOf(params.paper, PAPER_NAMES, DEFAULTS.paper);
  out.screen = num(params.screen, "screen");
  out.misregister = num(params.misregister, "misregister");
  out.grain = num(params.grain, "grain");
  out.reactivity = num(params.reactivity, "reactivity");
  const r = indexOf(params.relayout, RELAYOUT_OPTIONS, DEFAULT_RELAYOUT);
  out.relayoutBars = RELAYOUT_BARS[r];
  out.slideSeconds = SLIDE_SECONDS;
  out.joltScale = 1;
  out.shimmer = 1;
  if (reduceMotion) {
    if (RELAYOUT_OPTIONS[r] === DEFAULT_RELAYOUT) out.relayoutBars = RELAYOUT_BARS_REDUCED;
    if (out.misregister === DEFAULTS.misregister) out.joltScale = 0.5;
    out.slideSeconds = SLIDE_SECONDS_REDUCED;
    out.shimmer = 0;
  }
  return out;
}

/**
 * Halftone cell size in device px: `screen` cells per canvas height, at least MIN_CELL_PX.
 * @param {number} height drawing-buffer height
 * @param {number} screen resolved screen ruling
 */
export function cellSize(height, screen) {
  return Math.max(MIN_CELL_PX, height / screen);
}

/**
 * Plate (ink) of a pitch class: walking the circle of fifths, four consecutive fifths per plate
 * (C G D A → 0, E B F# C# → 1, G# D# A# F → 2), so a key's region of the circle sets the inks.
 * @param {number} pc 0–11
 */
export function plateOf(pc) {
  return Math.floor(((pc * 7) % 12) / 4);
}
