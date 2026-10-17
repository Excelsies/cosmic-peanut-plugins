// @ts-check
/**
 * Misregister's paper-and-ink grain texture (built once in create, never per frame): a
 * seamlessly tiling GRAIN_SIZE² RGBA8 image from integer hashes (no Math.random), with
 *   R  paper fibre: value noise stretched 16:1 along x, plus a little fine noise
 *   G  speckle: white noise per texel (ink starvation, broken dots)
 *   B  density wobble: soft 8 × 8-cell value noise (uneven inking)
 *   A  255
 */
import { hash01 } from "./hash.js";

export const GRAIN_SIZE = 256;

/** @param {number} t */
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Periodic value noise at (x, y) texels on a lattice of `cx` × `cy` cells over the tile.
 * @param {number} x @param {number} y @param {number} cx @param {number} cy @param {number} seed
 */
function valueNoise(x, y, cx, cy, seed) {
  const fx = (x / GRAIN_SIZE) * cx;
  const fy = (y / GRAIN_SIZE) * cy;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = smooth(fx - ix);
  const ty = smooth(fy - iy);
  const at = (/** @type {number} */ i, /** @type {number} */ j) =>
    hash01(seed + ((((j % cy) + cy) % cy) * cx + (((i % cx) + cx) % cx)) * 7919);
  const a = at(ix, iy);
  const b = at(ix + 1, iy);
  const c = at(ix, iy + 1);
  const d = at(ix + 1, iy + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** @param {number} seed */
export function makeGrain(seed) {
  const n = GRAIN_SIZE;
  const px = new Uint8Array(n * n * 4);
  const s = Math.imul(seed | 0, 1000003);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      const fibre = 0.75 * valueNoise(x, y, 16, 256, s + 1) + 0.25 * valueNoise(x, y, 64, 256, s + 2);
      px[i] = Math.round(fibre * 255);
      px[i + 1] = Math.floor(hash01(s + 3 + y * n + x) * 256);
      px[i + 2] = Math.round(valueNoise(x, y, 8, 8, s + 4) * 255);
      px[i + 3] = 255;
    }
  }
  return px;
}
