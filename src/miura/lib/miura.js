// @ts-check
/**
 * Miura-ori geometry (Schenk and Guest 2013, "Geometry of Miura-folded metamaterials"), pure.
 *
 * A sheet of parallelogram facets with sides a = b = 1 and sector angle gamma = 60 degrees, folded
 * by one angle t (0 = flat). Closed form for the unit-cell dimensions:
 *
 *   H = a sin t sin g                                 (pleat height)
 *   S = b cos t tan g / sqrt(1 + cos^2 t tan^2 g)     (column pitch)
 *   L = a sqrt(1 - sin^2 t sin^2 g)                   (row pitch)
 *   V = b / sqrt(1 + cos^2 t tan^2 g)                 (zig-zag offset)
 *
 * vertex(i, j) = (i S, j L + (i odd ? V : 0), j odd ? H : 0). Every facet stays a planar
 * parallelogram and every crease keeps its length at any uniform t; S and L both shrink as t
 * grows, so the sheet contracts in both directions at once (it is auxetic).
 *
 * Nothing here allocates except `buildIndex`, which runs only when the grid changes.
 */

const GAMMA = Math.PI / 3;
const SIN_G = Math.sin(GAMMA);
const TAN_G = Math.tan(GAMMA);

/** Mesh tilt about x (radians): the sheet is seen from slightly above, its top receding. */
export const TILT = (25 * Math.PI) / 180;
/** The in-plane layout uses the global fold clamped to this range, so the sheet always tiles. */
export const LAYOUT_T_MIN = 0.05;
export const LAYOUT_T_MAX = 1.1;
/** Per-vertex fold angles (waves, swell, rustle) are clamped to [0, LOCAL_T_MAX]. */
export const LOCAL_T_MAX = 1.45;
/** Most facet columns the sheet may have. */
export const MAX_COLS = 80;
/** Rest fold for the floating sheet's size. */
const FLOAT_T = 0.35;
/** Coverage margin: 4% beyond the window on every side, after the relief. */
const MARGIN = 1.08;
/** The default three camera: fov 60 at z = 5. */
const CAM_Z = 5;
const TAN_HALF_FOV = Math.tan(Math.PI / 6);

/** @param {number} t */
export const foldH = (t) => Math.sin(t) * SIN_G;
/** @param {number} t */
export const foldS = (t) => {
  const c = Math.cos(t) * TAN_G;
  return c / Math.sqrt(1 + c * c);
};
/** @param {number} t */
export const foldL = (t) => {
  const s = Math.sin(t) * SIN_G;
  return Math.sqrt(1 - s * s);
};
/** @param {number} t */
export const foldV = (t) => {
  const c = Math.cos(t) * TAN_G;
  return 1 / Math.sqrt(1 + c * c);
};

/** @param {number} t0 global fold @returns {number} the fold the in-plane layout uses */
export const layoutT = (t0) => Math.min(LAYOUT_T_MAX, Math.max(LAYOUT_T_MIN, t0));

/** @type {Record<string, number>} */
const ROWS = { classic: 20, fine: 30, bold: 12 };

/** Facet rows for a 'pleat' preset (unknown presets get classic). @param {string} pleat */
export const rowsFor = (pleat) => ROWS[pleat] ?? ROWS.classic;

/** @param {number} cols @param {number} rows */
export const vertexCount = (cols, rows) => (cols + 1) * (rows + 1);

/**
 * Write every vertex at a uniform fold: in-plane from `tPlane`, heights from `tZ`, scaled by `k`
 * and centred on (0, yc, 0).
 * @param {Float32Array} pos (cols + 1) * (rows + 1) * 3 floats, row-major (j outer, i inner)
 * @param {number} cols @param {number} rows
 * @param {number} tPlane fold for S, L, V (callers pass layoutT(t0))
 * @param {number} k scale
 * @param {number} yc vertical offset of the centre
 * @param {number} tZ fold for the pleat height
 * @returns {Float32Array} pos
 */
export function writeLayout(pos, cols, rows, tPlane, k, yc, tZ) {
  const S = foldS(tPlane);
  const L = foldL(tPlane);
  const V = foldV(tPlane);
  const H = foldH(tZ);
  const halfW = (cols * S) / 2;
  const halfH = (rows * L + V) / 2;
  let o = 0;
  for (let j = 0; j <= rows; j++) {
    const yRow = j * L - halfH;
    const z = k * ((j & 1 ? H : 0) - H / 2);
    for (let i = 0; i <= cols; i++) {
      pos[o] = k * (i * S - halfW);
      pos[o + 1] = k * (yRow + (i & 1 ? V : 0)) + yc;
      pos[o + 2] = z;
      o += 3;
    }
  }
  return pos;
}

/**
 * Re-fold the ridge rows (odd j) from per-vertex fold angles; valley rows (even j) stay at -zc.
 * @param {Float32Array} pos as written by writeLayout
 * @param {number} cols @param {number} rows
 * @param {Float32Array} tl per-vertex fold angle, clamped to [0, LOCAL_T_MAX]
 * @param {number} k scale
 * @param {number} zc the depth offset writeLayout used, k * H(tZ) / 2
 * @returns {Float32Array} pos
 */
export function applyLocalFold(pos, cols, rows, tl, k, zc) {
  const stride = cols + 1;
  for (let j = 1; j <= rows; j += 2) {
    for (let i = 0; i <= cols; i++) {
      const v = j * stride + i;
      const t = Math.min(LOCAL_T_MAX, Math.max(0, tl[v]));
      pos[v * 3 + 2] = k * Math.sin(t) * SIN_G - zc;
    }
  }
  return pos;
}

/**
 * Triangle index for the grid, two per facet (allocates: call only when the grid changes).
 * @param {number} cols @param {number} rows
 * @returns {Uint16Array | Uint32Array}
 */
export function buildIndex(cols, rows) {
  const n = cols * rows * 6;
  const idx = vertexCount(cols, rows) > 65535 ? new Uint32Array(n) : new Uint16Array(n);
  const stride = cols + 1;
  let o = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const d = a + stride;
      const c = d + 1;
      idx[o++] = a;
      idx[o++] = b;
      idx[o++] = c;
      idx[o++] = a;
      idx[o++] = c;
      idx[o++] = d;
    }
  }
  return idx;
}

/**
 * Mesh-space y where the camera ray through NDC row `sy` meets the tilted plane z = zMesh, and
 * the half-width of the view there (for NDC column 1).
 * @param {number} sy @param {number} zMesh @param {number} aspect
 * @param {{ y: number, hw: number }} out
 */
function viewHit(sy, zMesh, aspect, out) {
  const ct = Math.cos(TILT);
  const st = Math.sin(TILT);
  const T = TAN_HALF_FOV;
  out.y = (sy * T * (CAM_Z - zMesh * ct) - zMesh * st) / (ct - sy * T * st);
  out.hw = (CAM_Z + out.y * st - zMesh * ct) * T * aspect;
  return out;
}

const hitTmp = { y: 0, hw: 0 };

/**
 * @typedef {object} SheetFit
 * @property {number} cols facet columns
 * @property {number} k scale applied to the unit sheet
 * @property {number} yc mesh-space y of the sheet's centre
 * @property {number} visW width of the visible (or floating) sheet, mesh units
 * @property {number} visH height of it
 * @property {number} ybot mesh-space y of its bottom edge
 */

/**
 * Size the sheet for the window. 'fill': at the most folded layout (t0 = 1.1) the fully covered
 * rectangle overfills the view of the tilted sheet, relief included, by 4% on every side (the
 * view of a tilted plane is a trapezoid reaching further up than down, so the sheet is offset by
 * `yc`); rows are fixed by the pleat, so k comes from the height and cols from the width.
 * 'float': the sheet spans 72% of the window width at t0 = 0.35, roughly window-shaped.
 * @template {object} T
 * @param {number} aspect width / height
 * @param {number} rows
 * @param {string} mode 'fill' | 'float'
 * @param {T} out
 * @returns {T & SheetFit}
 */
export function fitSheet(aspect, rows, mode, out) {
  const o = /** @type {T & SheetFit} */ (out);
  if (mode === "float") {
    const S = foldS(FLOAT_T);
    const L = foldL(FLOAT_T);
    const hx = CAM_Z * TAN_HALF_FOV * aspect;
    o.cols = Math.min(MAX_COLS, Math.max(4, Math.round((rows * L * aspect) / S)));
    o.k = (0.72 * 2 * hx) / (o.cols * S);
    o.yc = 0;
    o.visW = 0.72 * 2 * hx;
    o.visH = o.k * rows * L;
    o.ybot = -o.visH / 2;
    return o;
  }
  const S = foldS(LAYOUT_T_MAX);
  const L = foldL(LAYOUT_T_MAX);
  const V = foldV(LAYOUT_T_MAX);
  const covered = rows * L - V;
  const reliefT = foldH(LOCAL_T_MAX);
  let relief = 0;
  let top = 0;
  let bot = 0;
  let hw = 0;
  for (let pass = 0; pass < 4; pass++) {
    top = -Infinity;
    bot = Infinity;
    hw = 0;
    for (let s = -1; s <= 1; s += 2) {
      const z = s * relief;
      viewHit(1, z, aspect, hitTmp);
      top = Math.max(top, hitTmp.y);
      hw = Math.max(hw, hitTmp.hw);
      viewHit(-1, z, aspect, hitTmp);
      bot = Math.min(bot, hitTmp.y);
      hw = Math.max(hw, hitTmp.hw);
    }
    o.k = (MARGIN * (top - bot)) / covered;
    relief = o.k * reliefT;
  }
  o.yc = (top + bot) / 2;
  o.cols = Math.min(MAX_COLS, Math.ceil((MARGIN * 2 * hw) / (o.k * S)));
  viewHit(1, 0, aspect, hitTmp);
  const top0 = hitTmp.y;
  o.visW = 2 * hitTmp.hw;
  viewHit(-1, 0, aspect, hitTmp);
  o.ybot = hitTmp.y;
  o.visH = top0 - hitTmp.y;
  return o;
}
