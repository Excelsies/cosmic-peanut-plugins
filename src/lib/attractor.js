// @ts-check
/**
 * The point the flock is pulled toward, as a function of the musical clock `phi` (beats, from
 * meter.js). A large sweep across the frame on a 16-beat (4-bar) cycle whose turns land on the
 * downbeats of bars 2 and 4, a faster incommensurate wobble so it never quite repeats, a slow
 * vertical drift, plus the stereo balance (sideways) and spectral brightness (altitude). Pure.
 */

/** Beats per sweep cycle (4 bars of 4). */
export const PERIOD = 16;
const TAU = Math.PI * 2;

/**
 * The main sweep term alone: 0.55·hx·sin(2π·phi/16). Its turns land on beats 4 and 12.
 * @param {number} phi beats @param {number} hx frustum half-width at z = 0
 */
export function sweep(phi, hx) {
  return 0.55 * hx * Math.sin((TAU * phi) / PERIOD);
}

/**
 * Altitude offset from the smoothed spectral centroid: brighter music flies higher.
 * @param {number} centroid smoothed 0–1 @param {number} hy frustum half-height at z = 0
 */
export function altitude(centroid, hy) {
  const a = (centroid - 0.25) * 0.8 * hy;
  const lim = 0.3 * hy;
  return a < -lim ? -lim : a > lim ? lim : a;
}

/**
 * @param {number} phi beats
 * @param {number} hx frustum half-width at z = 0
 * @param {number} hy frustum half-height at z = 0
 * @param {number} amp sweep amplitude multiplier (0.5 with Reduce motion)
 * @param {number} balance stereo balance −1..1 (right positive)
 * @param {number} alt altitude offset (world units), from `altitude`
 * @param {Float64Array | Float32Array | number[]} out [x, y]
 */
export function attractor(phi, hx, hy, amp, balance, alt, out) {
  const wobble = 0.18 * hx * Math.sin((TAU * 2.3 * phi) / PERIOD + 1.1);
  let x = amp * (sweep(phi, hx) + wobble) + balance * 0.6 * hx;
  let y = amp * 0.25 * hy * Math.sin((TAU * 0.7 * phi) / PERIOD + 0.4) + alt;
  const lx = 0.62 * hx;
  const ly = 0.5 * hy;
  x = x < -lx ? -lx : x > lx ? lx : x;
  y = y < -ly ? -ly : y > ly ? ly : y;
  out[0] = x;
  out[1] = y;
}

/**
 * Flock shapes, one per 16-beat cycle. Each bird is pulled toward its own point on a curve (its
 * place along the flock, 0 tail .. 1 head) through the attractor; the curve and the tube radius
 * around it set the silhouette. In units of the flock radius R, along the flight direction:
 * [length, bend, ring radius, ring mix (0 line .. 1 closed circle), tube radius at the head,
 * tube radius at the tail]. Blob, ribbon, doughnut (birds stream around the ring), teardrop.
 */
export const SHAPES = [
  [0.3, 0, 0, 0, 1, 0.85],
  [3.0, 0.35, 0, 0, 0.3, 0.22],
  [0, 0, 1.0, 1, 0.32, 0.32],
  [1.8, 0.1, 0, 0, 0.8, 0.14],
];
export const SHAPE_LEN = 6;

/** @param {number} k */
function shapeIndex(k) {
  let h = Math.imul((k | 0) ^ 0x2c1b3c6d, 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h % SHAPES.length;
}

/** Shape of cycle k: hashed, nudged on when the raw hash repeats the previous cycle's. @param {number} k */
function shapeOf(k) {
  if (k <= 0) return 3; // open with a teardrop
  const s = shapeIndex(k);
  return s === shapeIndex(k - 1) ? (s + 1) % SHAPES.length : s;
}

/**
 * The flock's target shape at beat `phi`: changes only on the downbeat that starts a 16-beat cycle
 * and morphs (smoothstep) over its first 4 beats. Pure.
 * @param {number} phi beats
 * @param {Float64Array | number[]} out SHAPE_LEN values, see SHAPES
 */
export function shape(phi, out) {
  const k = Math.floor(phi / PERIOD);
  const into = phi - k * PERIOD;
  const cur = SHAPES[shapeOf(k)];
  const prev = SHAPES[shapeOf(k - 1)];
  let t = into / 4;
  t = t >= 1 ? 1 : t * t * (3 - 2 * t);
  for (let i = 0; i < SHAPE_LEN; i++) out[i] = t >= 1 ? cur[i] : prev[i] + (cur[i] - prev[i]) * t;
}
