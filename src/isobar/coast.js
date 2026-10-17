// @ts-check
/**
 * Isobar's procedural geography: seeded fractal value noise (5 octaves) plus a 0.25 bias toward
 * the north-west corner, land where it reaches 0.58. Sampled in chart space, so the continent is
 * the same at every window size. Used only when the base canvas is rebuilt (resize, chart change).
 */
import { hash01 } from "../lib/hash.js";

export const LAND = 0.58;
const TABLE = 256;
const FREQ = 2.2; // lattice cells per chart unit at the first octave
const OCTAVES = 5;

/** A lattice of seeded values, so sampling is table lookups. */
export function createCoast(seed = 1234) {
  const lattice = new Float32Array(TABLE * TABLE);
  for (let i = 0; i < lattice.length; i++) lattice[i] = hash01(seed * 7919 + i);
  return { lattice };
}

/** @typedef {ReturnType<typeof createCoast>} Coast */

/** @param {number} t */
const fade = (t) => t * t * (3 - 2 * t);

/** Value noise in [0, 1). @param {Float32Array} lat @param {number} x @param {number} y */
function noise(lat, x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = fade(x - xi);
  const fy = fade(y - yi);
  const x0 = xi & (TABLE - 1);
  const y0 = yi & (TABLE - 1);
  const x1 = (x0 + 1) & (TABLE - 1);
  const y1 = (y0 + 1) & (TABLE - 1);
  const a = lat[y0 * TABLE + x0];
  const b = lat[y0 * TABLE + x1];
  const c = lat[y1 * TABLE + x0];
  const d = lat[y1 * TABLE + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * Land value at chart (x, y); land where it is >= LAND.
 * @param {Coast} c @param {number} x @param {number} y @param {number} aspect
 */
export function landAt(c, x, y, aspect) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = FREQ;
  for (let o = 0; o < OCTAVES; o++) {
    sum += amp * noise(c.lattice, x * f + o * 17.3, y * f + o * 31.7);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm + 0.25 * (1 - 0.5 * (x / aspect + y));
}

/**
 * Land values at the nodes of a cols x rows grid with node (i, j) at chart (i * dx, j * dy).
 * @param {Coast} c @param {Float32Array} out @param {number} cols @param {number} rows
 * @param {number} dx @param {number} dy @param {number} aspect
 */
export function landMask(c, out, cols, rows, dx, dy, aspect) {
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) out[j * cols + i] = landAt(c, i * dx, j * dy, aspect);
  }
}

/**
 * The coastline (the LAND isoline) by marching squares, as x0, y0, x1, y1 segments in units of
 * the cell size. Returns the segment count (capped by the buffer).
 * @param {Float32Array} m @param {number} cols @param {number} rows
 * @param {number} cellX @param {number} cellY @param {Float32Array} segs
 */
export function coastSegments(m, cols, rows, cellX, cellY, segs) {
  const max = segs.length >> 2;
  let n = 0;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1 && n < max; i++) {
      const o = j * cols + i;
      const v0 = m[o];
      const v1 = m[o + 1];
      const v3 = m[o + cols];
      const v2 = m[o + cols + 1];
      const idx = (v0 >= LAND ? 8 : 0) | (v1 >= LAND ? 4 : 0) | (v2 >= LAND ? 2 : 0) | (v3 >= LAND ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const x0 = i * cellX;
      const y0 = j * cellY;
      const x1 = (i + 1) * cellX;
      const y1 = (j + 1) * cellY;
      // crossing points on the four edges (top, right, bottom, left)
      const tx = x0 + ((LAND - v0) / (v1 - v0)) * cellX;
      const ry = y0 + ((LAND - v1) / (v2 - v1)) * cellY;
      const bx = x0 + ((LAND - v3) / (v2 - v3)) * cellX;
      const ly = y0 + ((LAND - v0) / (v3 - v0)) * cellY;
      const top = (v0 >= LAND) !== (v1 >= LAND);
      const right = (v1 >= LAND) !== (v2 >= LAND);
      const bottom = (v3 >= LAND) !== (v2 >= LAND);
      const left = (v0 >= LAND) !== (v3 >= LAND);
      if (top && right && bottom && left) {
        // saddle: pair by the cell-centre value
        const joinTLBR = (v0 + v1 + v2 + v3) * 0.25 >= LAND === v0 >= LAND;
        if (joinTLBR) {
          n = seg(segs, n, tx, y0, x1, ry); // cut off TR
          if (n < max) n = seg(segs, n, x0, ly, bx, y1); // cut off BL
        } else {
          n = seg(segs, n, tx, y0, x0, ly); // cut off TL
          if (n < max) n = seg(segs, n, x1, ry, bx, y1); // cut off BR
        }
        continue;
      }
      // exactly two crossed edges: join them
      let ax = 0;
      let ay = 0;
      let first = true;
      for (let e = 0; e < 4; e++) {
        const crossed = e === 0 ? top : e === 1 ? right : e === 2 ? bottom : left;
        if (!crossed) continue;
        const px = e === 0 ? tx : e === 1 ? x1 : e === 2 ? bx : x0;
        const py = e === 0 ? y0 : e === 1 ? ry : e === 2 ? y1 : ly;
        if (first) {
          ax = px;
          ay = py;
          first = false;
        } else {
          n = seg(segs, n, ax, ay, px, py);
        }
      }
    }
  }
  return n;
}

/** @param {Float32Array} segs @param {number} n @param {number} a @param {number} b @param {number} c @param {number} d */
function seg(segs, n, a, b, c, d) {
  const o = 4 * n;
  segs[o] = a;
  segs[o + 1] = b;
  segs[o + 2] = c;
  segs[o + 3] = d;
  return n + 1;
}
