// @ts-check
/**
 * Misregister's halftone screens: the classic plate angles and the hi-hat shimmer that creeps
 * each plate's screen phase (the dots crawl inside the shapes while the edges stay put).
 * Allocates nothing.
 */
import { hash01 } from "./hash.js";

/** Screen angle of plates 0, 1, 2, degrees (avoids the 45° moiré between the angled plates). */
export const SCREEN_ANGLES = [15, 75, 0];
/** Shimmer per unit of treble above average, in screen cells. */
export const SHIMMER_CELLS = 0.08;
/** How fast the shimmer noise wanders, lattice points per second. */
const RATE = 6;

/**
 * @param {number} trebAtt `audio.trebAtt` (1 = average)
 * @param {number} scale resolved `shimmer` (0 under Reduce motion)
 */
export function shimmerAmount(trebAtt, scale) {
  return SHIMMER_CELLS * Math.min(2, Math.max(0, trebAtt - 1)) * scale;
}

/** Smooth 1D value noise in [−1, 1]. @param {number} t @param {number} seed */
function noise(t, seed) {
  const i = Math.floor(t);
  const f = t - i;
  const s = f * f * (3 - 2 * f);
  const a = hash01(seed + i * 131) * 2 - 1;
  const b = hash01(seed + (i + 1) * 131) * 2 - 1;
  return a + (b - a) * s;
}

/**
 * Each plate's screen-phase offset, in cells: x, y per plate.
 * @param {number} t seconds (`time.now`)
 * @param {number} amount from {@link shimmerAmount}
 * @param {Float32Array} out length 6
 */
export function shimmerOffsets(t, amount, out) {
  for (let i = 0; i < 6; i++) out[i] = amount === 0 ? 0 : amount * noise(t * RATE, 977 * (i + 1));
  return out;
}
