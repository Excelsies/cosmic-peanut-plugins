// @ts-check
/**
 * The flock's neighbour search: a uniform 3D grid (cell = perception radius) built by a counting
 * sort of the birds into cell order, and a k-nearest search over it. The grid's arrays live on the
 * Flock (flock.js) so nothing here allocates per step.
 */

/** @typedef {import('./flock.js').Flock} Flock */

/** Neighbour search radius and grid cell size (world units). */
export const PERCEPTION = 0.12;
/** Topological neighbour count. */
export const TOPO_K = 7;

const P2 = PERCEPTION * PERCEPTION;

/**
 * Grid dimensions for the frame half-extents f.hx/f.hy. Birds stay within the soft walls (85%)
 * and mostly within the flock depth; anything outside the grid is clamped into the edge cells,
 * which keeps the search exact (cell distances use the unclamped position) while keeping the grid
 * small (cheap to clear each step). Allocates only when the grid grows.
 * @param {Flock} f
 */
export function sizeGrid(f) {
  f.gx0 = f.hx * 0.95;
  f.gy0 = f.hy * 0.95;
  f.gz0 = 0.6;
  f.gw = Math.max(1, Math.ceil((2 * f.gx0) / PERCEPTION));
  f.gh = Math.max(1, Math.ceil((2 * f.gy0) / PERCEPTION));
  f.gd = Math.max(1, Math.ceil((2 * f.gz0) / PERCEPTION));
  const cells = f.gw * f.gh * f.gd;
  if (f.cellStart.length < cells + 1) f.cellStart = new Int32Array(cells + 1);
}

/** @param {Flock} f @param {number} x */
function cellX(f, x) {
  const c = Math.floor((x + f.gx0) / PERCEPTION);
  return c < 0 ? 0 : c >= f.gw ? f.gw - 1 : c;
}

/** @param {Flock} f @param {number} y */
function cellY(f, y) {
  const c = Math.floor((y + f.gy0) / PERCEPTION);
  return c < 0 ? 0 : c >= f.gh ? f.gh - 1 : c;
}

/** @param {Flock} f @param {number} z */
function cellZ(f, z) {
  const c = Math.floor((z + f.gz0) / PERCEPTION);
  return c < 0 ? 0 : c >= f.gd ? f.gd - 1 : c;
}

/**
 * Rebuild the grid from the current positions: a counting sort of the birds by cell, so each
 * cell's birds sit next to each other in sx/sy/sz (sequential scans, no pointer chasing).
 * @param {Flock} f
 */
export function buildGrid(f) {
  const cells = f.gw * f.gh * f.gd;
  const start = f.cellStart;
  const cellOf = f.cellOf;
  start.fill(0, 0, cells + 1);
  for (let i = 0; i < f.n; i++) {
    const c = (cellZ(f, f.pz[i]) * f.gh + cellY(f, f.py[i])) * f.gw + cellX(f, f.px[i]);
    cellOf[i] = c;
    start[c + 1]++;
  }
  for (let c = 0; c < cells; c++) start[c + 1] += start[c];
  // Scatter, using start[c] as a cursor, then shift back so start[c] is the first slot again.
  const order = f.order;
  for (let i = 0; i < f.n; i++) {
    const slot = start[cellOf[i]]++;
    order[slot] = i;
    f.sx[slot] = f.px[i];
    f.sy[slot] = f.py[i];
    f.sz[slot] = f.pz[i];
  }
  for (let c = cells; c > 0; c--) start[c] = start[c - 1];
  start[0] = 0;
}

/**
 * The (up to) 7 nearest birds within the perception radius of bird i, nearest first, into
 * f.nbIdx/f.nbD2. Needs the grid of the current positions (buildGrid). Scans i's own cell first,
 * then skips any neighbouring cell that can't hold anything nearer than what was already found.
 * One flat loop with locals: this is the simulation's hot path.
 * @param {Flock} f @param {number} i
 * @returns {number} neighbour count
 */
export function findNeighbors(f, i) {
  const sxs = f.sx;
  const sys = f.sy;
  const szs = f.sz;
  const order = f.order;
  const start = f.cellStart;
  const nbIdx = f.nbIdx;
  const nbD2 = f.nbD2;
  const x = f.px[i];
  const y = f.py[i];
  const z = f.pz[i];
  let count = 0;
  let worst = P2; // squared distance a candidate must beat
  const gw = f.gw;
  const gh = f.gh;
  const gd = f.gd;
  const cx = cellX(f, x);
  const cy = cellY(f, y);
  const cz = cellZ(f, z);
  // Position inside the cell, for the distance to each neighbouring cell.
  const lx = x + f.gx0 - cx * PERCEPTION;
  const ly = y + f.gy0 - cy * PERCEPTION;
  const lz = z + f.gz0 - cz * PERCEPTION;
  // Visit order: own cell (o = 13) first, then the other 26.
  for (let o = 13, visited = 0; visited < 27; visited++, o = o === 26 ? 0 : o + 1) {
    if (visited > 0 && o === 13) o++;
    const ox = (o % 3) - 1;
    const oy = (((o / 3) | 0) % 3) - 1;
    const oz = ((o / 9) | 0) - 1;
    const nx = cx + ox;
    const ny = cy + oy;
    const nz = cz + oz;
    if (nx < 0 || nx >= gw || ny < 0 || ny >= gh || nz < 0 || nz >= gd) continue;
    if (visited > 0) {
      const ex = ox < 0 ? lx : ox > 0 ? PERCEPTION - lx : 0;
      const ey = oy < 0 ? ly : oy > 0 ? PERCEPTION - ly : 0;
      const ez = oz < 0 ? lz : oz > 0 ? PERCEPTION - lz : 0;
      const edge2 = ex * ex + ey * ey + ez * ez;
      if (edge2 >= worst) continue;
    }
    const cell = (nz * gh + ny) * gw + nx;
    const end = start[cell + 1];
    for (let q = start[cell]; q < end; q++) {
      const dx = x - sxs[q];
      const dy = y - sys[q];
      const dz = z - szs[q];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= worst) continue;
      const j = order[q];
      if (j === i) continue;
      {
        let k = count < TOPO_K ? count++ : TOPO_K - 1;
        while (k > 0 && nbD2[k - 1] > d2) {
          nbD2[k] = nbD2[k - 1];
          nbIdx[k] = nbIdx[k - 1];
          k--;
        }
        nbD2[k] = d2;
        nbIdx[k] = j;
        if (count === TOPO_K) worst = nbD2[TOPO_K - 1];
      }
    }
  }
  return count;
}
