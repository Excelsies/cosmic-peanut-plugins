// @ts-check
/**
 * Isobars by marching squares over Isobar's pressure grid, into preallocated buffers.
 *
 * Levels are 940 + 4k hPa; every 20 hPa is bold. Each cell only works on the levels between its
 * lowest and highest corner. Edge points are interpolated linearly from the edge's two nodes in a
 * fixed order, so neighbouring cells produce bit-identical endpoints and rings close; saddles are
 * resolved with the cell-centre average. Crossings of the grid's outer edge are collected for the
 * boxed numerals, skipping any within `labelGap` of the previous one on the same edge.
 * Nothing here allocates after createContours.
 */

export const MAX_SEGS = 40000;
export const MAX_LABELS = 256;
const LEVEL0 = 940;
const STEP = 4;

/** @param {number} k */
export function levelAt(k) {
  return LEVEL0 + STEP * k;
}

/** @param {number} [maxSegs] */
export function createContours(maxSegs = MAX_SEGS) {
  return {
    maxSegs,
    /** x0, y0, x1, y1 per segment, in the grid's pixel units. */
    segs: new Float32Array(4 * maxSegs),
    /** 1 where the segment's level is a multiple of 20 hPa. */
    bold: new Uint8Array(maxSegs),
    count: 0,
    /** x, y, level (hPa), side (0 top, 1 right, 2 bottom, 3 left) per edge crossing. */
    labels: new Float32Array(4 * MAX_LABELS),
    nLabels: 0,
    lastEdge: new Float64Array(4),
  };
}

/** @typedef {ReturnType<typeof createContours>} Contours */

/**
 * @param {Contours} c @param {number} side @param {number} x @param {number} y @param {number} L
 * @param {number} gap
 */
function label(c, side, x, y, L, gap) {
  const pos = side === 0 || side === 2 ? x : y;
  if (c.nLabels >= MAX_LABELS || pos - c.lastEdge[side] < gap) return;
  c.lastEdge[side] = pos;
  const o = 4 * c.nLabels++;
  c.labels[o] = x;
  c.labels[o + 1] = y;
  c.labels[o + 2] = L;
  c.labels[o + 3] = side;
}

/**
 * @param {Float32Array} nodes row-major cols x rows pressures
 * @param {number} cols @param {number} rows
 * @param {number} cellX @param {number} cellY node spacing in output units (device px)
 * @param {number} labelGap minimum distance between edge labels on one edge
 * @param {Contours} c filled in place
 */
export function contour(nodes, cols, rows, cellX, cellY, labelGap, c) {
  const { segs, bold, maxSegs } = c;
  let n = 0;
  c.nLabels = 0;
  c.lastEdge.fill(-1e9);
  const lastRow = rows - 2;
  const lastCol = cols - 2;
  for (let j = 0; j <= lastRow && n < maxSegs; j++) {
    const y0 = j * cellY;
    for (let i = 0; i <= lastCol; i++) {
      const o = j * cols + i;
      const v0 = nodes[o]; // TL
      const v1 = nodes[o + 1]; // TR
      const v3 = nodes[o + cols]; // BL
      const v2 = nodes[o + cols + 1]; // BR
      const lo = Math.min(v0, v1, v2, v3);
      const hi = Math.max(v0, v1, v2, v3);
      let k = Math.max(0, Math.floor((lo - LEVEL0) / STEP) + 1);
      const kHi = Math.floor((hi - LEVEL0) / STEP);
      const x0 = i * cellX;
      for (; k <= kHi; k++) {
        const L = LEVEL0 + STEP * k;
        const idx = (v0 >= L ? 8 : 0) | (v1 >= L ? 4 : 0) | (v2 >= L ? 2 : 0) | (v3 >= L ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        // Edge points (only the crossed ones are meaningful): top TL->TR, right TR->BR,
        // bottom BL->BR, left TL->BL.
        const tx = x0 + ((L - v0) / (v1 - v0)) * cellX;
        const ry = y0 + ((L - v1) / (v2 - v1)) * cellY;
        const bx = x0 + ((L - v3) / (v2 - v3)) * cellX;
        const ly = y0 + ((L - v0) / (v3 - v0)) * cellY;
        const x1 = (i + 1) * cellX; // the same float as the next cell's x0
        const y1 = (j + 1) * cellY;
        const isBold = L % 20 === 0 ? 1 : 0;
        // a, b: edge ids 0 top, 1 right, 2 bottom, 3 left; a second pair for saddles.
        let a = -1;
        let b = -1;
        let a2 = -1;
        let b2 = -1;
        switch (idx) {
          case 1: a = 3; b = 2; break;
          case 2: a = 2; b = 1; break;
          case 3: a = 3; b = 1; break;
          case 4: a = 0; b = 1; break;
          case 6: a = 0; b = 2; break;
          case 7: a = 0; b = 3; break;
          case 8: a = 0; b = 3; break;
          case 9: a = 0; b = 2; break;
          case 11: a = 0; b = 1; break;
          case 12: a = 3; b = 1; break;
          case 13: a = 1; b = 2; break;
          case 14: a = 3; b = 2; break;
          case 5:
          case 10: {
            // centre inside joins the inside corners
            const inside = (v0 + v1 + v2 + v3) * 0.25 >= L;
            const cutTR = idx === 10 ? inside : !inside;
            if (cutTR) { a = 0; b = 1; a2 = 3; b2 = 2; }
            else { a = 0; b = 3; a2 = 1; b2 = 2; }
            break;
          }
        }
        for (let s = 0; s < 2; s++) {
          const ea = s === 0 ? a : a2;
          const eb = s === 0 ? b : b2;
          if (ea < 0 || n >= maxSegs) break;
          const w = 4 * n;
          segs[w] = ea === 0 ? tx : ea === 1 ? x1 : ea === 2 ? bx : x0;
          segs[w + 1] = ea === 0 ? y0 : ea === 1 ? ry : ea === 2 ? y1 : ly;
          segs[w + 2] = eb === 0 ? tx : eb === 1 ? x1 : eb === 2 ? bx : x0;
          segs[w + 3] = eb === 0 ? y0 : eb === 1 ? ry : eb === 2 ? y1 : ly;
          bold[n++] = isBold;
        }
        // Crossings of the grid's outer edge.
        const topCut = (v0 >= L) !== (v1 >= L);
        const rightCut = (v1 >= L) !== (v2 >= L);
        const bottomCut = (v3 >= L) !== (v2 >= L);
        const leftCut = (v0 >= L) !== (v3 >= L);
        if (j === 0 && topCut) label(c, 0, tx, y0, L, labelGap);
        if (i === lastCol && rightCut) label(c, 1, x1, ry, L, labelGap);
        if (j === lastRow && bottomCut) label(c, 2, bx, y1, L, labelGap);
        if (i === 0 && leftCut) label(c, 3, x0, ly, L, labelGap);
      }
    }
  }
  c.count = n;
}

/**
 * Appends moveTo/lineTo for every segment whose bold flag equals `bold` to the current path; the
 * caller owns beginPath and stroke.
 * @param {CanvasRenderingContext2D} g @param {Contours} c @param {0 | 1} bold
 */
export function pathSegments(g, c, bold) {
  const { segs } = c;
  for (let k = 0; k < c.count; k++) {
    if (c.bold[k] !== bold) continue;
    const o = 4 * k;
    g.moveTo(segs[o], segs[o + 1]);
    g.lineTo(segs[o + 2], segs[o + 3]);
  }
}
