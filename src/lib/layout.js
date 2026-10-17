// @ts-check
/**
 * Misregister's poster layouts on a Swiss grid.
 *
 * The grid has 8 rows and max(6, round(8·aspect)) columns inside 5% margins (of the short side).
 * Six hand-designed templates on a 12 × 8 base grid, each with an x-mirrored twin, give 12
 * layouts. A template lists 12 slots, one per pitch class: the shape's rectangle (top-left cell,
 * local width × height in cells, rotation in multiples of 90°) and the corner it is anchored to
 * (the corner it swells from, so it stays on its grid lines). The shape type belongs to the pitch
 * class, never to the slot: a note keeps its character across layouts.
 *
 * Placed layouts are Float32Arrays of 12 × SLOT values indexed by pitch class:
 *   [cx, cy, ax, ay, lw, lh, angle, flip] — centre and anchor corner (cells from the grid's
 *   top-left, y down), local size before rotation (cells), rotation (degrees, clockwise on
 *   screen) and mirror (±1; tweens pass it through 0, a card flip).
 */
import { createMeter } from "./meter.js";

/** Shape types, as the plate shader numbers them. */
export const SHAPE = {
  BOX: 0,
  DISC: 1,
  HALF_DISC: 2,
  QUARTER_DISC: 3,
  TRIANGLE: 4,
  ARC_180: 5,
  ARC_90: 6,
  DOT_ROW: 7,
  STEPS: 8,
  BAR: 9,
};

const S = SHAPE;
/** Each pitch class's shape (C, C#, D … B). */
export const SHAPE_OF_PC = [
  S.DISC, S.DOT_ROW, S.QUARTER_DISC, S.BAR, S.HALF_DISC, S.BOX,
  S.ARC_90, S.TRIANGLE, S.STEPS, S.ARC_180, S.DISC, S.BOX,
];

export const BASE_COLS = 12;
export const BASE_ROWS = 8;
export const GRID_ROWS = 8;
export const MARGIN = 0.05;
export const SLOT = 8;
export const LAYOUT_COUNT = 12;

// Anchor corners.
const TL = 0;
const TR = 1;
const BR = 2;
const BL = 3;

/**
 * [pitch class, x, y, local w, local h, rotation°, anchor]; x, y = top-left cell of the rotated
 * rectangle on the 12 × 8 base grid.
 * @type {number[][][]}
 */
export const TEMPLATES = [
  // Corner weight: a big C disc top left, the rest stepping down to the right.
  [
    [0, 1, 1, 4, 4, 0, TL],
    [1, 6, 1, 5, 1, 0, TL],
    [2, 8, 4, 3, 3, 180, BR],
    [3, 1, 6, 8, 1, 0, BL],
    [4, 5, 3, 4, 2, 0, BL],
    [5, 10, 0, 2, 3, 0, TR],
    [6, 3, 3, 4, 4, 90, TL],
    [7, 0, 4, 3, 4, 0, BL],
    [8, 7, 5, 3, 3, 0, BR],
    [9, 4, 0, 6, 3, 180, TL],
    [10, 10, 6, 2, 2, 0, BR],
    [11, 8, 2, 2, 4, 0, TR],
  ],
  // Diagonal stair from top left to bottom right.
  [
    [0, 0, 0, 3, 3, 0, TL],
    [1, 0, 7, 5, 1, 0, BL],
    [2, 2, 2, 4, 4, 0, TL],
    [3, 5, 1, 7, 1, 0, TR],
    [4, 6, 5, 6, 3, 180, BR],
    [5, 3, 0, 3, 2, 0, TL],
    [6, 9, 2, 3, 3, 270, TR],
    [7, 5, 3, 4, 3, 90, TL],
    [8, 0, 4, 3, 3, 0, BL],
    [9, 7, 0, 4, 2, 0, TR],
    [10, 3, 6, 2, 2, 0, BL],
    [11, 11, 4, 1, 4, 0, BR],
  ],
  // A big central C disc under a half ring.
  [
    [0, 4, 1, 5, 5, 0, TL],
    [1, 0, 1, 5, 1, 0, TL],
    [2, 9, 0, 3, 3, 90, TR],
    [3, 2, 6, 8, 1, 0, BL],
    [4, 0, 3, 4, 2, 0, BL],
    [5, 2, 4, 2, 2, 0, TL],
    [6, 8, 4, 4, 4, 180, BR],
    [7, 0, 6, 4, 2, 0, BL],
    [8, 5, 6, 3, 2, 0, BR],
    [9, 3, 0, 6, 3, 0, TL],
    [10, 10, 3, 2, 2, 0, TR],
    [11, 3, 1, 1, 3, 0, TL],
  ],
  // Columns: tall rotated forms.
  [
    [0, 0, 5, 3, 3, 0, BL],
    [1, 3, 1, 5, 1, 90, TL],
    [2, 0, 0, 4, 4, 0, TL],
    [3, 11, 0, 8, 1, 90, TR],
    [4, 5, 0, 6, 3, 90, TL],
    [5, 9, 3, 2, 5, 0, BR],
    [6, 4, 5, 3, 3, 0, BL],
    [7, 6, 5, 3, 4, 270, BR],
    [8, 8, 0, 3, 3, 90, TR],
    [9, 1, 3, 4, 2, 0, BL],
    [10, 6, 2, 2, 2, 0, TL],
    [11, 1, 1, 2, 2, 0, TL],
  ],
  // Horizontal bands.
  [
    [0, 7, 2, 4, 4, 0, TR],
    [1, 1, 0, 5, 1, 0, TL],
    [2, 1, 4, 3, 3, 270, BL],
    [3, 0, 2, 8, 1, 0, TL],
    [4, 2, 5, 6, 3, 0, BL],
    [5, 8, 7, 4, 1, 0, BR],
    [6, 9, 0, 3, 3, 90, TR],
    [7, 4, 3, 4, 2, 180, TL],
    [8, 0, 6, 3, 2, 0, BL],
    [9, 6, 0, 4, 2, 0, TL],
    [10, 10, 4, 2, 2, 0, BR],
    [11, 2, 3, 2, 3, 0, TL],
  ],
  // Scatter.
  [
    [0, 9, 2, 3, 3, 0, TR],
    [1, 6, 0, 5, 1, 0, TR],
    [2, 0, 4, 4, 4, 270, BL],
    [3, 3, 3, 6, 1, 0, TL],
    [4, 1, 0, 4, 2, 180, TL],
    [5, 4, 5, 3, 2, 0, BL],
    [6, 4, 1, 3, 3, 0, TL],
    [7, 7, 1, 3, 4, 0, TL],
    [8, 0, 1, 3, 3, 270, TL],
    [9, 6, 5, 6, 3, 0, BR],
    [10, 2, 6, 2, 2, 0, BL],
    [11, 10, 5, 1, 3, 0, BR],
  ],
];

/**
 * The grid for a canvas: 8 rows, max(6, round(8·aspect)) columns, 5% margins of the short side.
 * @template {Record<string, number>} T
 * @param {number} width device px
 * @param {number} height device px
 * @param {T} out
 */
export function gridOf(width, height, out) {
  const o = /** @type {Record<string, number>} */ (out);
  const margin = MARGIN * Math.min(width, height);
  o.rows = GRID_ROWS;
  o.cols = Math.max(6, Math.round((GRID_ROWS * width) / height));
  o.margin = margin;
  o.x0 = margin;
  o.y0 = margin;
  o.cellW = (width - 2 * margin) / o.cols;
  o.cellH = (height - 2 * margin) / o.rows;
  return /** @type {T & { rows: number, cols: number, margin: number, x0: number, y0: number, cellW: number, cellH: number }} */ (out);
}

/** Layout shown on the k-th sheet (k = 0 first): (k·5 + 3) mod 12, a full cycle. @param {number} k */
export function layoutForSheet(k) {
  return (((k * 5 + 3) % LAYOUT_COUNT) + LAYOUT_COUNT) % LAYOUT_COUNT;
}

const MIRROR_ANCHOR = [TR, TL, BL, BR];

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Place layout `l` (template l >> 1, mirrored when l is odd) on a cols × rows grid. Positions
 * follow the anchor corner (scaled per axis), sizes scale uniformly by the smaller axis factor,
 * and everything is clamped onto the grid. Allocates nothing.
 * @param {number} l 0–11
 * @param {number} cols
 * @param {number} rows
 * @param {Float32Array} out 12 × SLOT
 */
export function placeLayout(l, cols, rows, out) {
  const t = TEMPLATES[(l >> 1) % TEMPLATES.length];
  const mirror = (l & 1) === 1;
  const sx = cols / BASE_COLS;
  const sy = rows / BASE_ROWS;
  const s = Math.min(sx, sy);
  for (let i = 0; i < t.length; i++) {
    const [pc, bx, by, lw0, lh0, rot0, anchor0] = t[i];
    const quarter = rot0 % 180 !== 0;
    const bw = quarter ? lh0 : lw0;
    const bh = quarter ? lw0 : lh0;
    const x0 = mirror ? BASE_COLS - bx - bw : bx;
    const anchor = mirror ? MIRROR_ANCHOR[anchor0] : anchor0;
    const rot = mirror ? (360 - rot0) % 360 : rot0;
    const left = anchor === TL || anchor === BL;
    const top = anchor === TL || anchor === TR;
    const w = clamp(Math.round(bw * s), 1, cols);
    const h = clamp(Math.round(bh * s), 1, rows);
    const ax = Math.round((left ? x0 : x0 + bw) * sx);
    const ay = Math.round((top ? by : by + bh) * sy);
    const x = clamp(left ? ax : ax - w, 0, cols - w);
    const y = clamp(top ? ay : ay - h, 0, rows - h);
    const o = pc * SLOT;
    out[o] = x + w / 2;
    out[o + 1] = y + h / 2;
    out[o + 2] = left ? x : x + w;
    out[o + 3] = top ? y : y + h;
    out[o + 4] = quarter ? h : w;
    out[o + 5] = quarter ? w : h;
    out[o + 6] = rot;
    out[o + 7] = mirror ? -1 : 1;
  }
  return out;
}

/** @param {number} t */
export function easeInOutCubic(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Interpolate two placed layouts at eased progress e (0 = from, 1 = to): linear in every field,
 * rotation the short way round. Allocates nothing.
 * @param {Float32Array} from
 * @param {Float32Array} to
 * @param {number} e
 * @param {Float32Array} out
 */
export function tweenLayouts(from, to, e, out) {
  for (let i = 0; i < out.length; i++) {
    if (e <= 0) out[i] = from[i];
    else if (e >= 1) out[i] = to[i];
    else if (i % SLOT === 6) {
      const d = ((((to[i] - from[i]) % 360) + 540) % 360) - 180;
      out[i] = from[i] + d * e;
    } else out[i] = from[i] + (to[i] - from[i]) * e;
  }
  return out;
}

/** Seconds per bar for the re-layout timer when the host has no tempo (16 s per 8 bars). */
export const SECONDS_PER_BAR_FALLBACK = 2;

/**
 * Decides when to re-lay out: on a counted downbeat (beat count a multiple of 4·bars) while the
 * host has a tempo, else every 2·bars seconds; never when bars is 0. Allocates nothing.
 */
export function createRelayoutClock() {
  const meter = createMeter();
  let seconds = 0;
  return {
    meter,
    /**
     * @param {number} bpm
     * @param {number} beatPhase
     * @param {number} dt
     * @param {number} bars resolved `relayoutBars` (0 = never)
     * @returns {boolean} true when the poster should re-lay out now
     */
    step(bpm, beatPhase, dt, bars) {
      const beat = meter.step(bpm, beatPhase);
      if (!(bars > 0)) {
        seconds = 0;
        return false;
      }
      if (bpm > 0) {
        seconds = 0;
        return beat && meter.beats % (4 * bars) === 0;
      }
      seconds += dt;
      if (seconds >= SECONDS_PER_BAR_FALLBACK * bars - 1e-9) {
        seconds = 0;
        return true;
      }
      return false;
    },
  };
}
