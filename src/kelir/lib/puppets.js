// @ts-check
/**
 * Kelir's cast as data: a table of 2D signed-distance primitives that shaders/kelir/mask.frag
 * evaluates per pixel, plus a JS port of the same evaluation (shaders/kelir/sdf.glsl) for tests.
 *
 * Puppet-local units: height 1, origin at the base centre, y up, facing +x. Each record is two
 * vec4s, (ax, ay, bx, by) and (r1, r2, type, bone):
 *   0 capsule        segment a-b, radius r1
 *   1 uneven capsule a (radius r1) to b (radius r2)
 *   2 vesica         centre a, unit long axis b, half-width r1, half-height r2 (pointed ends)
 *   3 triangle       a, b, and the third point in the next record's (ax, ay)
 *   4 disc           centre a, radius r1
 *   5 box            centre a, half-size (r1, r2), axis-aligned in bone space
 *   6 polygon        header (cx, cy, hx, hy), (n, -, type, bone): a bounding box and the
 *                    vertex count (at most MAX_POLY); the n vertices follow, four per record
 *                    (x0, y0, x1, y1), (x2, y2, x3, y3), filling ceil(n / 4) records. Any
 *                    simple polygon, concave too (iq's exact sdPolygon); skipped while its
 *                    bounding box is no nearer than the distance so far
 * The type's flag bits: MIRROR evaluates at (|x|, y) (the kayon), CUT subtracts the primitive
 * from everything before it in the range (d = max(d, -dCut)), SOLID keeps the lace out where
 * the primitive is the nearest one (faces, necks, limbs and rods: the hide is perforated, the
 * face is not). `bone` (0..5) is local to the
 * silhouette: body, front upper arm, front forearm, back upper arm, back forearm, head; the
 * silhouette's boneBase (slot * 6) is added to index the stage -> bone transforms.
 *
 * Puppets A and B share one figure: the table holds [A's two hand rods, figure, B's two hand
 * rods, kayon], A's range is the first two blocks and B's the middle two, so the rods (rewritten
 * every frame from each puppet's pose) are the only per-puppet records.
 *
 * The figures are generic stylisations, not any particular wayang character.
 */

export const MAX_RECORDS = 64;
export const RECORD_FLOATS = 8;
/** Bones per silhouette and in all (3 silhouettes: puppet A, puppet B, kayon). */
export const BONES_PER = 6;
export const BONES = 18;
export const KAYON_BONE = 12;

export const CAPSULE = 0;
export const UNEVEN = 1;
export const VESICA = 2;
export const TRIANGLE = 3;
export const DISC = 4;
export const BOX = 5;
export const POLY = 6;
const TRI_REST = 7; // the second record of a triangle
/** Most vertices in one polygon. */
export const MAX_POLY = 32;
export const MIRROR = 8;
export const CUT = 16;
export const SOLID = 32;

/** Solid band (puppet units) inside every outline that the lace never pierces. */
export const BORDER = 0.012;
/** Lace hole radius as a fraction of the lattice spacing. */
export const HOLE = 0.32;

/** Arm rig, puppet units: shoulders on the torso, bone lengths, the hand grip on the forearm. */
export const SHOULDER_F = [0.082, 0.562];
export const SHOULDER_B = [-0.058, 0.56];
export const UPPER = 0.17;
export const FORE = 0.16;
export const GRIP = FORE + 0.03;
/** Where the rods end below the base (off the bottom of the screen). */
export const ROD_END = -0.6;

/** First rig bone of silhouette `slot` (0 = A, 1 = B, 2 = kayon). @param {number} slot */
export const boneBase = (slot) => slot * BONES_PER;

/**
 * @param {Float32Array} t
 * @param {number} i record index
 * @param {number} ax @param {number} ay @param {number} bx @param {number} by
 * @param {number} r1 @param {number} r2 @param {number} type @param {number} bone
 */
function put(t, i, ax, ay, bx, by, r1, r2, type, bone) {
  if (i >= MAX_RECORDS) throw new Error(`puppets: more than ${MAX_RECORDS} records`);
  const o = i * RECORD_FLOATS;
  t[o] = ax;
  t[o + 1] = ay;
  t[o + 2] = bx;
  t[o + 3] = by;
  t[o + 4] = r1;
  t[o + 5] = r2;
  t[o + 6] = type;
  t[o + 7] = bone;
  return i + 1;
}

/**
 * Write a polygon (flat [x0, y0, x1, y1, ...]) at record i; returns the next free record.
 * @param {Float32Array} t @param {number} i @param {number[]} v @param {number} flags
 * @param {number} bone
 */
export function putPolygon(t, i, v, flags, bone) {
  const n = v.length >> 1;
  if (n < 3 || n > MAX_POLY) throw new Error(`puppets: a polygon needs 3..${MAX_POLY} vertices, not ${n}`);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < n; k++) {
    x0 = Math.min(x0, v[2 * k]);
    x1 = Math.max(x1, v[2 * k]);
    y0 = Math.min(y0, v[2 * k + 1]);
    y1 = Math.max(y1, v[2 * k + 1]);
  }
  const rec = i + 1 + Math.ceil(n / 4);
  if (rec > MAX_RECORDS) throw new Error(`puppets: more than ${MAX_RECORDS} records`);
  const pad = 1e-5;
  put(t, i, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 + pad, (y1 - y0) / 2 + pad, n, 0, POLY | flags, bone);
  const o = (i + 1) * RECORD_FLOATS;
  for (let k = 0; k < Math.ceil(n / 4) * 8; k++) t[o + k] = k < 2 * n ? v[k] : 0;
  return rec;
}

/** @param {Float32Array} t @param {number} i @param {number[]} p @param {number} bone */
function tri(t, i, p, bone) {
  i = put(t, i, p[0], p[1], p[2], p[3], 0, 0, TRIANGLE, bone);
  return put(t, i, p[4], p[5], 0, 0, 0, 0, TRI_REST, bone);
}

/**
 * The figure's outlines (puppet units, facing +x), drawn as polygons. BODY: square shoulders, a
 * chest swelling forward and tapering to the waist, the belt, a kain flaring to its hem with a
 * pointed panel hanging between the legs and a drape sweeping back to a point behind them.
 */
const BODY = [
  0.06, 0.584, 0.09, 0.578, 0.098, 0.562, 0.08, 0.54, 0.074, 0.505, 0.064, 0.462, 0.046, 0.42,
  0.054, 0.402, 0.054, 0.384, 0.074, 0.32, 0.088, 0.25, 0.094, 0.196, 0.046, 0.2, 0.038, 0.085,
  0.022, 0.2, -0.062, 0.2, -0.1, 0.15, -0.135, 0.1, -0.175, 0.045, -0.15, 0.12, -0.122, 0.205,
  -0.094, 0.29, -0.066, 0.36, -0.05, 0.384, -0.05, 0.402, -0.036, 0.42, -0.05, 0.475, -0.064, 0.53,
  -0.072, 0.562, -0.062, 0.58, 0, 0.586,
];
/** FACE: the nape and jaw, chin, lips below a notch, the long nose running straight up into the forehead, the skull. */
const FACE = [
  0.02, 0.69, 0.05, 0.674, 0.08, 0.664, 0.098, 0.668, 0.104, 0.677, 0.097, 0.682, 0.11, 0.689,
  0.104, 0.696, 0.176, 0.689, 0.13, 0.722, 0.09, 0.752, 0.08, 0.77, 0.03, 0.778, 0.004, 0.752,
  0.004, 0.716, 0.012, 0.698,
];
/**
 * CROWN (makutha): a band over the forehead, three tiers stepping back up the front to a pointed
 * top, and a backward-facing ornament (garuda mungkur) hooking out behind, with a feather below.
 */
const CROWN = [
  0.086, 0.768, 0.092, 0.786, 0.08, 0.792, 0.084, 0.818, 0.07, 0.822, 0.073, 0.85, 0.058, 0.855,
  0.06, 0.884, 0.044, 0.89, 0.038, 0.92, 0.025, 0.944, 0.008, 0.962, -0.006, 0.948, -0.014, 0.922,
  -0.018, 0.9, -0.042, 0.904, -0.07, 0.916, -0.094, 0.904, -0.082, 0.892, -0.064, 0.892, -0.046,
  0.882, -0.034, 0.866, -0.052, 0.85, -0.078, 0.84, -0.046, 0.826, -0.022, 0.81, -0.012, 0.78,
  0.02, 0.772,
];
/** Centre of the ring at the end of the garuda's hook (puppet units). */
export const CURL = [-0.092, 0.9];

/**
 * The rod puppets' shared figure on local bones 0..5, in the wayang manner: a frontal torso, a
 * small profile head with the forehead running straight into a long pointed nose and an almond
 * eye cut out of a solid face, a tiered crown, a belt, a kain over striding legs, and
 * very long thin arms with armlets and leaf-shaped hands.
 * @param {Float32Array} t @param {number} i first record
 */
function figure(t, i) {
  const S = SOLID;
  const body = 0;
  const head = 5;
  // Feet in profile (long, pointed forward) and slender striding legs.
  i = put(t, i, 0.035, 0.012, 0.16, 0.004, 0.016, 0.003, UNEVEN | S, body);
  i = put(t, i, -0.13, 0.012, -0.02, 0.004, 0.015, 0.003, UNEVEN | S, body);
  i = put(t, i, 0.06, 0.02, 0.045, 0.2, 0.013, 0.02, UNEVEN | S, body);
  i = put(t, i, -0.1, 0.02, -0.045, 0.2, 0.012, 0.019, UNEVEN | S, body);
  // Long forward-leaning neck.
  i = put(t, i, 0.016, 0.57, 0.036, 0.685, 0.014, 0, CAPSULE | S, body);
  // Arms: upper arm (with an armlet) and forearm on their own bones, hanging along -y at rest;
  // leaf-shaped hands.
  for (const [upper, fore] of [[1, 2], [3, 4]]) {
    i = put(t, i, 0, 0, 0, -UPPER, 0.014, 0.009, UNEVEN | S, upper);
    i = put(t, i, 0, -0.045, 0, 0, 0.016, 0, DISC | S, upper);
    i = put(t, i, 0, 0, 0, -FORE, 0.01, 0.007, UNEVEN | S, fore);
    i = put(t, i, 0.006, -FORE - 0.038, 0.158, -0.987, 0.011, 0.042, VESICA | S, fore);
  }
  // The main rod.
  i = put(t, i, 0, 0.1, 0, ROD_END, 0.004, 0, CAPSULE | S, body);
  // The polygons last, so the cheap primitives above have already brought the distance down
  // and most pixels skip them by their boxes: the laced body, the solid face, the laced crown;
  // then the crown's ring and the ear ornament (sumping).
  i = putPolygon(t, i, BODY, 0, body);
  i = putPolygon(t, i, FACE, S, head);
  i = putPolygon(t, i, CROWN, 0, head);
  i = put(t, i, CURL[0], CURL[1], 0, 0, 0.014, 0, DISC, head);
  i = put(t, i, -0.012, 0.736, -0.97, 0.243, 0.013, 0.038, VESICA, head);
  // Cuts (they subtract from everything above): the eye, the ring's opening, two slits that set
  // the belt off between the torso and the kain.
  i = put(t, i, 0.098, 0.734, 0.8, -0.6, 0.0045, 0.015, VESICA | CUT, head);
  i = put(t, i, CURL[0], CURL[1], 0, 0, 0.0055, 0, DISC | CUT, head);
  i = put(t, i, -0.06, 0.406, 0.07, 0.406, 0.0028, 0, CAPSULE | CUT, body);
  return put(t, i, -0.07, 0.38, 0.07, 0.38, 0.0028, 0, CAPSULE | CUT, body);
}

/**
 * One puppet's two hand rods, on its body bone (endpoints rewritten every frame by the rig).
 * @param {Float32Array} t @param {number} i @param {Int32Array} rods @param {number} r0
 */
function handRods(t, i, rods, r0) {
  rods[r0] = i;
  i = put(t, i, 0, 0, 0, ROD_END, 0.0035, 0, CAPSULE | SOLID, 0);
  rods[r0 + 1] = i;
  return put(t, i, 0, 0, 0, ROD_END, 0.0035, 0, CAPSULE | SOLID, 0);
}

/**
 * The kayon (gunungan): a mountain-shaped leaf, broad at the foot and pointed at the top, on a
 * plinth, mirror-symmetric, with a cut-out gate, trunk and branches.
 */
function kayon(/** @type {Float32Array} */ t, /** @type {number} */ i) {
  const m = MIRROR;
  const b = 0;
  i = put(t, i, 0, 0.27, 0, 0.55, 0.27, 0.16, UNEVEN | m, b);
  i = put(t, i, 0, 0.6, 0, 1, 0.19, 0.4, VESICA | m, b);
  i = put(t, i, 0, 0.04, 0, 0, 0.22, 0.04, BOX | m, b);
  i = put(t, i, 0, 0.04, 0, ROD_END, 0.005, 0, CAPSULE | m, b);
  // Cut-outs: a gate, the trunk, four branches a side.
  i = put(t, i, 0, 0.14, 0, 0, 0.055, 0.05, BOX | m | CUT, b);
  i = put(t, i, 0, 0.2, 0, 0.78, 0.02, 0, CAPSULE | m | CUT, b);
  i = put(t, i, 0, 0.26, 0.17, 0.36, 0.016, 0, CAPSULE | m | CUT, b);
  i = put(t, i, 0, 0.38, 0.16, 0.49, 0.016, 0, CAPSULE | m | CUT, b);
  i = put(t, i, 0, 0.5, 0.15, 0.63, 0.015, 0, CAPSULE | m | CUT, b);
  i = put(t, i, 0, 0.62, 0.09, 0.76, 0.014, 0, CAPSULE | m | CUT, b);
  return i;
}

/**
 * Fill the primitive table. Ranges are (start, count) for puppet A, puppet B and the kayon; rods
 * are the hand-rod record indices (A front, A back, B front, B back).
 * @param {Float32Array} table MAX_RECORDS * RECORD_FLOATS floats
 */
export function buildCast(table) {
  const ranges = new Int32Array(6);
  const rods = new Int32Array(4);
  let i = handRods(table, 0, rods, 0);
  i = figure(table, i);
  ranges[0] = 0;
  ranges[1] = i;
  ranges[2] = 2;
  i = handRods(table, i, rods, 2);
  ranges[3] = i - 2;
  ranges[4] = i;
  i = kayon(table, i);
  ranges[5] = i - ranges[4];
  return { ranges, rods };
}

// ------------------------------------------------------------------------------------------------
// JS port of shaders/kelir/sdf.glsl (keep the two in step).

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Distance to segment a-b. */
export function sdSegment(/** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ ax, /** @type {number} */ ay, /** @type {number} */ bx, /** @type {number} */ by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay || 1), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

/** Uneven capsule from a (radius r1) to b (radius r2). */
export function sdUneven(/** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ ax, /** @type {number} */ ay, /** @type {number} */ bx, /** @type {number} */ by, /** @type {number} */ r1, /** @type {number} */ r2) {
  const dx = bx - ax;
  const dy = by - ay;
  const h = Math.hypot(dx, dy);
  if (h <= Math.abs(r1 - r2) + 1e-6) return Math.hypot(px - ax, py - ay) - Math.max(r1, r2);
  const ux = dx / h;
  const uy = dy / h;
  const qx = Math.abs((px - ax) * uy - (py - ay) * ux);
  const qy = (px - ax) * ux + (py - ay) * uy;
  const b = (r1 - r2) / h;
  const a = Math.sqrt(1 - b * b);
  const k = -b * qx + a * qy;
  if (k < 0) return Math.hypot(qx, qy) - r1;
  if (k > a * h) return Math.hypot(qx, qy - h) - r2;
  return qx * a + qy * b - r1;
}

/** Vesica centred at c with unit long axis u, half-width w, half-height hh (hh > w). */
export function sdVesica(/** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ ux, /** @type {number} */ uy, /** @type {number} */ w, /** @type {number} */ hh) {
  const x = Math.abs((px - cx) * uy - (py - cy) * ux);
  const y = Math.abs((px - cx) * ux + (py - cy) * uy);
  const s = (hh * hh) / w;
  const r = (s + w) / 2;
  const d = (s - w) / 2;
  return (y - hh) * d > x * hh ? Math.hypot(x, y - hh) : Math.hypot(x + d, y) - r;
}

/** Triangle p0 p1 p2 (either winding). */
export function sdTriangle(/** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ x1, /** @type {number} */ y1, /** @type {number} */ x2, /** @type {number} */ y2) {
  const e0x = x1 - x0, e0y = y1 - y0, e1x = x2 - x1, e1y = y2 - y1, e2x = x0 - x2, e2y = y0 - y2;
  const v0x = px - x0, v0y = py - y0, v1x = px - x1, v1y = py - y1, v2x = px - x2, v2y = py - y2;
  const h0 = clamp((v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y), 0, 1);
  const h1 = clamp((v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y), 0, 1);
  const h2 = clamp((v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y), 0, 1);
  const q0 = (v0x - e0x * h0) ** 2 + (v0y - e0y * h0) ** 2;
  const q1 = (v1x - e1x * h1) ** 2 + (v1y - e1y * h1) ** 2;
  const q2 = (v2x - e2x * h2) ** 2 + (v2y - e2y * h2) ** 2;
  const s = Math.sign(e0x * e2y - e0y * e2x);
  const c0 = s * (v0x * e0y - v0y * e0x);
  const c1 = s * (v1x * e1y - v1y * e1x);
  const c2 = s * (v2x * e2y - v2y * e2x);
  const dd = Math.min(q0, q1, q2);
  const sg = Math.min(c0, c1, c2);
  return -Math.sqrt(dd) * Math.sign(sg);
}

/**
 * Polygon of n vertices stored from record `rec` on, four per record (iq's sdPolygon).
 * @param {number} px @param {number} py @param {Float32Array} t @param {number} rec
 * @param {number} n
 */
export function sdPolygon(px, py, t, rec, n) {
  const o = rec * RECORD_FLOATS;
  let jx = t[o + 2 * (n - 1)];
  let jy = t[o + 2 * (n - 1) + 1];
  let dd = 1e18;
  let s = 1;
  for (let k = 0; k < n; k++) {
    const ix = t[o + 2 * k];
    const iy = t[o + 2 * k + 1];
    const ex = jx - ix;
    const ey = jy - iy;
    const wx = px - ix;
    const wy = py - iy;
    const h = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey || 1), 0, 1);
    const bx = wx - ex * h;
    const by = wy - ey * h;
    dd = Math.min(dd, bx * bx + by * by);
    const c0 = py >= iy;
    const c1 = py < jy;
    const c2 = ex * wy > ey * wx;
    if ((c0 && c1 && c2) || (!c0 && !c1 && !c2)) s = -s;
    jx = ix;
    jy = iy;
  }
  return s * Math.sqrt(dd);
}

/** Axis-aligned box centred at c with half-size (hx, hy). */
export function sdBox(/** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ hx, /** @type {number} */ hy) {
  const dx = Math.abs(px - cx) - hx;
  const dy = Math.abs(py - cy) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}

/**
 * Signed distance (bone units) from stage point (x, y) to the silhouette in records
 * [start, start + count), with the bones' stage -> bone transforms `inv` (column-major mat3 each)
 * from bone `base` on. Writes the bone-local point of the nearest union primitive into q[0], q[1]
 * (the lace's lattice frame) and 1 into q[2] if that primitive is SOLID, else 0. The distance
 * starts at `cutoff`: nothing farther matters (the mask pass passes the penumbra's reach, beyond
 * which coverage is 0), so a polygon whose box lies beyond it is skipped, and with nothing nearer
 * the result is the cutoff.
 * @param {Float32Array} t @param {number} start @param {number} count @param {Float32Array} inv
 * @param {number} base @param {number} x @param {number} y @param {Float64Array | Float32Array} q
 * @param {number} [cutoff]
 */
export function sdfRange(t, start, count, inv, base, x, y, q, cutoff = 1e9) {
  let d = cutoff;
  for (let i = start; i < start + count; i++) {
    const o = i * RECORD_FLOATS;
    const type = t[o + 6] | 0;
    const m = (base + (t[o + 7] | 0)) * 9;
    let px = inv[m] * x + inv[m + 3] * y + inv[m + 6];
    const py = inv[m + 1] * x + inv[m + 4] * y + inv[m + 7];
    if (type & MIRROR) px = Math.abs(px);
    const kind = type & 7;
    let ds;
    if (kind === CAPSULE) ds = sdSegment(px, py, t[o], t[o + 1], t[o + 2], t[o + 3]) - t[o + 4];
    else if (kind === UNEVEN) ds = sdUneven(px, py, t[o], t[o + 1], t[o + 2], t[o + 3], t[o + 4], t[o + 5]);
    else if (kind === VESICA) ds = sdVesica(px, py, t[o], t[o + 1], t[o + 2], t[o + 3], t[o + 4], t[o + 5]);
    else if (kind === TRIANGLE) {
      const n = o + RECORD_FLOATS;
      ds = sdTriangle(px, py, t[o], t[o + 1], t[o + 2], t[o + 3], t[n], t[n + 1]);
      i++;
    } else if (kind === POLY) {
      const n = t[o + 4] | 0;
      const far = !(type & CUT) && sdBox(px, py, t[o], t[o + 1], t[o + 2], t[o + 3]) >= d;
      ds = far ? 1e9 : sdPolygon(px, py, t, i + 1, n);
      i += Math.ceil(n / 4);
    } else if (kind === DISC) ds = Math.hypot(px - t[o], py - t[o + 1]) - t[o + 4];
    else ds = sdBox(px, py, t[o], t[o + 1], t[o + 4], t[o + 5]);
    if (type & CUT) d = Math.max(d, -ds);
    else if (ds < d) {
      d = ds;
      q[0] = px;
      q[1] = py;
      q[2] = type & SOLID ? 1 : 0;
    }
  }
  return d;
}

/**
 * Distance to the nearest lace hole at lattice-frame point (x, y): a hex lattice of spacing s,
 * round holes on even rows, upward teardrops on odd rows. Negative inside a hole.
 */
export function holeDistance(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ s) {
  const h = s * Math.sqrt(3);
  const ax = x - s * Math.round(x / s);
  const ay = y - h * Math.round(y / h);
  const bx0 = x - s / 2;
  const by0 = y - h / 2;
  const bx = bx0 - s * Math.round(bx0 / s);
  const by = by0 - h * Math.round(by0 / h);
  const circle = Math.hypot(ax, ay) - HOLE * s;
  const drop = sdUneven(bx, by, 0, -0.05 * s, 0, 0.4 * s, 0.3 * s, 0.05 * s);
  return Math.min(circle, drop);
}

/** @param {number} a @param {number} b @param {number} x */
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Shadow coverage (0..1, before opacity) of a laced silhouette: the body's coverage with a
 * penumbra of half-width w px, times (1 - the lamp light through the nearest hole). Holes keep
 * out of the border band; a blurred hole of radius R passes 1 - exp(-2 (R / w)^2) of the light
 * at its centre, so the lace dissolves as the shadow softens; holes under ~1.5 px are dropped.
 * @param {number} d silhouette distance, bone units @param {number} x @param {number} y
 * lattice-frame point @param {number} s spacing @param {number} border band, bone units
 * @param {number} ppu mask px per bone unit @param {number} w penumbra half-width, px
 * @param {number} solid 1 if the nearest primitive is SOLID (no holes), else 0
 */
export function laceCoverage(d, x, y, s, border, ppu, w, solid) {
  const body = 1 - smoothstep(-w, w, d * ppu);
  if (body <= 0 || solid > 0.5) return body;
  const r = HOLE * s * ppu;
  const contrast = (1 - Math.exp((-2 * r * r) / (w * w))) * smoothstep(1, 2, r);
  const hole = (1 - smoothstep(-w, w, holeDistance(x, y, s) * ppu)) * contrast;
  const band = 1 - smoothstep(-w, w, (d + border) * ppu);
  return body * (1 - hole * band);
}
