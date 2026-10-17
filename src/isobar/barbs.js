// @ts-check
/**
 * Isobar's station wind barbs: geostrophic wind from the pressure gradient, northern hemisphere
 * (low pressure to the left of downwind, so the wind turns counter-clockwise round a low with
 * north up), drawn the station-model way. The shaft points toward where the wind comes from;
 * 50-kt pennants, 10-kt feathers and a 5-kt half feather sit at its far end on the low-pressure
 * side. Below 3 kt a station shows a calm circle. Nothing here allocates after createBarbs.
 */
import { grad } from "./pressure.js";

/** Knots per hPa per chart unit: 4 hPa per 0.05 chart units is 25 kt. */
export const KT_PER_HPA = 25 / 80;
export const MAX_STATIONS = 12 * 12;
const MAX_LINES = MAX_STATIONS * 8;
const MAX_PEN = MAX_STATIONS * 3;

const g2 = new Float64Array(2);

/**
 * Wind in knots at (x, y), screen axes (y down), into out[0] (east), out[1] (south).
 * @param {import('./pressure.js').Pressure} st @param {number} x @param {number} y
 * @param {Float64Array | Float32Array} out
 */
export function windAt(st, x, y, out) {
  grad(st, x, y, g2);
  // u = -K dP/dy_north = K dP/dy_screen;  v_north = K dP/dx, so v_screen = -K dP/dx
  out[0] = KT_PER_HPA * g2[1];
  out[1] = -KT_PER_HPA * g2[0];
}

/**
 * Pennants, feathers and half feathers for `kt`, rounded to the nearest 5 kt, into out.
 * @param {number} kt @param {Int32Array} out
 * @returns {boolean} false for calm (below 3 kt)
 */
export function barbCounts(kt, out) {
  if (kt < 3) return false;
  let r = Math.max(5, Math.round(kt / 5) * 5);
  out[0] = Math.floor(r / 50);
  r -= out[0] * 50;
  out[1] = Math.floor(r / 10);
  r -= out[1] * 10;
  out[2] = r >= 5 ? 1 : 0;
  return true;
}

/**
 * Station positions in chart units: clamp(round(cssWidth / 220), 7, 12) columns, rows by
 * aspect, each at the centre of its cell. Returns the count.
 * @param {number} cssWidth @param {number} aspect @param {Float32Array} out x, y pairs
 */
export function stationGrid(cssWidth, aspect, out) {
  const cols = Math.min(12, Math.max(7, Math.round(cssWidth / 220)));
  const rows = Math.min(12, Math.max(3, Math.round(cols / aspect)));
  let n = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      out[2 * n] = ((i + 0.5) / cols) * aspect;
      out[2 * n + 1] = (j + 0.5) / rows;
      n++;
    }
  }
  return n;
}

export function createBarbs() {
  return {
    /** Shafts, feathers: x0, y0, x1, y1. */
    lines: new Float32Array(MAX_LINES * 4),
    nLines: 0,
    /** Pennants: three corners. */
    pens: new Float32Array(MAX_PEN * 6),
    nPen: 0,
    /** Calm circles: x, y, radius. */
    calm: new Float32Array(MAX_STATIONS * 3),
    nCalm: 0,
    /** Station dots: x, y, radius. */
    dots: new Float32Array(MAX_STATIONS * 3),
    nDots: 0,
    counts: new Int32Array(3),
  };
}

/** @typedef {ReturnType<typeof createBarbs>} Barbs */

/** @param {Barbs} b */
export function clearBarbs(b) {
  b.nLines = 0;
  b.nPen = 0;
  b.nCalm = 0;
  b.nDots = 0;
}

/** @param {Barbs} b @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 */
function line(b, x0, y0, x1, y1) {
  if (b.nLines >= MAX_LINES) return;
  const o = 4 * b.nLines++;
  b.lines[o] = x0;
  b.lines[o + 1] = y0;
  b.lines[o + 2] = x1;
  b.lines[o + 3] = y1;
}

/**
 * Appends one station's barb.
 * @param {Barbs} b @param {number} x @param {number} y station (px)
 * @param {number} u @param {number} v wind (kt, screen axes) @param {number} L shaft length (px)
 */
export function addBarb(b, x, y, u, v, L) {
  const kt = Math.sqrt(u * u + v * v);
  const n = b.counts;
  if (!barbCounts(kt, n)) {
    if (b.nCalm < MAX_STATIONS) {
      const o = 3 * b.nCalm++;
      b.calm[o] = x;
      b.calm[o + 1] = y;
      b.calm[o + 2] = 0.2 * L;
    }
    return;
  }
  if (b.nDots < MAX_STATIONS) {
    const o = 3 * b.nDots++;
    b.dots[o] = x;
    b.dots[o + 1] = y;
    b.dots[o + 2] = 0.12 * L;
  }
  const ux = -u / kt; // toward where the wind comes from
  const uy = -v / kt;
  const sx = v / kt; // left of downwind d = (u, v) / kt on screen: (d.y, -d.x)
  const sy = -u / kt;
  const ex = x + ux * L;
  const ey = y + uy * L;
  line(b, x, y, ex, ey);
  const f = 0.5 * L; // feather length
  const gap = 0.16 * L;
  let at = 0; // distance in from the far end
  for (let k = 0; k < n[0] && b.nPen < MAX_PEN; k++) {
    const o = 6 * b.nPen++;
    const px = ex - ux * at;
    const py = ey - uy * at;
    const w = 0.22 * L;
    b.pens[o] = px;
    b.pens[o + 1] = py;
    b.pens[o + 2] = px + sx * f;
    b.pens[o + 3] = py + sy * f;
    b.pens[o + 4] = px - ux * w;
    b.pens[o + 5] = py - uy * w;
    at += w + gap * 0.5;
  }
  for (let k = 0; k < n[1]; k++) {
    const px = ex - ux * at;
    const py = ey - uy * at;
    line(b, px, py, px + sx * f + ux * 0.35 * f, py + sy * f + uy * 0.35 * f);
    at += gap;
  }
  if (n[2]) {
    if (at === 0) at = gap; // a lone half feather sits one step in from the end
    const px = ex - ux * at;
    const py = ey - uy * at;
    line(b, px, py, px + sx * 0.5 * f + ux * 0.175 * f, py + sy * 0.5 * f + uy * 0.175 * f);
  }
}

/**
 * Appends to the current path: pass 0 the shafts, feathers and calm circles (to stroke), pass 1
 * the pennants and station dots (to fill). The caller owns beginPath and stroke/fill.
 * @param {CanvasRenderingContext2D} g @param {Barbs} b @param {0 | 1} pass
 */
export function pathBarbs(g, b, pass) {
  if (pass === 1) {
    for (let k = 0; k < b.nPen; k++) {
      const o = 6 * k;
      g.moveTo(b.pens[o], b.pens[o + 1]);
      g.lineTo(b.pens[o + 2], b.pens[o + 3]);
      g.lineTo(b.pens[o + 4], b.pens[o + 5]);
      g.closePath();
    }
    for (let k = 0; k < b.nDots; k++) {
      const o = 3 * k;
      g.moveTo(b.dots[o] + b.dots[o + 2], b.dots[o + 1]);
      g.arc(b.dots[o], b.dots[o + 1], b.dots[o + 2], 0, 2 * Math.PI);
    }
    return;
  }
  for (let k = 0; k < b.nLines; k++) {
    const o = 4 * k;
    g.moveTo(b.lines[o], b.lines[o + 1]);
    g.lineTo(b.lines[o + 2], b.lines[o + 3]);
  }
  for (let k = 0; k < b.nCalm; k++) {
    const o = 3 * k;
    g.moveTo(b.calm[o] + b.calm[o + 2], b.calm[o + 1]);
    g.arc(b.calm[o], b.calm[o + 1], b.calm[o + 2], 0, 2 * Math.PI);
  }
}
