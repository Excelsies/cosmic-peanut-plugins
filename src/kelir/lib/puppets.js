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
 * The type's flag bits: MIRROR evaluates at (|x|, y) (the kayon), CUT subtracts the primitive
 * (d = max(d, -dCut)); cuts come after every union in a range. `bone` indexes the stage -> bone
 * transforms (6 per silhouette: root/body, front upper arm, front forearm, back upper arm, back
 * forearm, head).
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
const TRI_REST = 7; // the second record of a triangle
export const MIRROR = 8;
export const CUT = 16;

/** Solid band (puppet units) inside every outline that the lace never pierces. */
export const BORDER = 0.012;
/** Lace hole radius as a fraction of the lattice spacing. */
export const HOLE = 0.32;

/** Arm rig, puppet units: shoulders on the torso, bone lengths, the hand grip on the forearm. */
export const SHOULDER_F = [0.07, 0.565];
export const SHOULDER_B = [-0.05, 0.56];
export const UPPER = 0.17;
export const FORE = 0.16;
export const GRIP = FORE + 0.03;
/** Where the rods end below the base (off the bottom of the screen). */
export const ROD_END = -0.6;

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

/** @param {Float32Array} t @param {number} i @param {number[]} p @param {number} bone */
function tri(t, i, p, bone) {
  i = put(t, i, p[0], p[1], p[2], p[3], 0, 0, TRIANGLE, bone);
  return put(t, i, p[4], p[5], 0, 0, 0, 0, TRI_REST, bone);
}

/**
 * One rod puppet: a profile figure facing +x on bones b0..b0+5. Wayang conventions: a frontal,
 * broad-shouldered torso on a narrow waist, a small profile head with a long pointed nose on a
 * long forward-leaning neck, a tall crown swept back into a curl, a kain flaring into a pointed
 * drape behind the striding legs, and very long thin arms with pointed hands.
 * @param {Float32Array} t @param {number} i first record @param {number} b0 first bone
 * @param {Int32Array} rods where to note the two hand-rod record indices
 * @param {number} r0 index into rods
 */
function puppet(t, i, b0, rods, r0) {
  const body = b0;
  const head = b0 + 5;
  // Feet in profile (long, pointed forward) and striding legs.
  i = put(t, i, 0.035, 0.012, 0.16, 0.004, 0.016, 0.003, UNEVEN, body);
  i = put(t, i, -0.13, 0.012, -0.02, 0.004, 0.015, 0.003, UNEVEN, body);
  i = put(t, i, 0.06, 0.02, 0.035, 0.21, 0.02, 0.032, UNEVEN, body);
  i = put(t, i, -0.1, 0.02, -0.035, 0.21, 0.018, 0.03, UNEVEN, body);
  // Kain: hips and thighs, and a pointed drape trailing behind.
  i = put(t, i, 0, 0.19, 0.005, 0.38, 0.07, 0.045, UNEVEN, body);
  i = tri(t, i, [-0.045, 0.37, 0.05, 0.3, -0.16, 0.07], body);
  // Narrow waist, chest, broad frontal shoulders, long forward-leaning neck.
  i = put(t, i, 0, 0.37, 0.01, 0.52, 0.038, 0.055, UNEVEN, body);
  i = put(t, i, SHOULDER_B[0], SHOULDER_B[1], SHOULDER_F[0], SHOULDER_F[1], 0.024, 0, CAPSULE, body);
  i = put(t, i, 0.012, 0.55, 0.055, 0.675, 0.017, 0, CAPSULE, body);
  // Head in profile: the back of the skull, the face sloping from forehead to a long pointed
  // nose; a tall crown tapering into a point swept back, with a roundel at its back.
  i = put(t, i, 0.055, 0.715, 0, 0, 0.034, 0, DISC, head);
  i = tri(t, i, [0.04, 0.765, 0.175, 0.685, 0.05, 0.665], head);
  i = put(t, i, 0.05, 0.75, 0.025, 0.865, 0.04, 0.03, UNEVEN, head);
  i = tri(t, i, [-0.008, 0.855, 0.052, 0.87, -0.035, 0.985], head);
  i = put(t, i, 0.004, 0.8, 0, 0, 0.03, 0, DISC, head);
  // Arms: upper arm and forearm on their own bones, hanging along -y at rest; pointed hands.
  for (const [upper, fore] of [[b0 + 1, b0 + 2], [b0 + 3, b0 + 4]]) {
    i = put(t, i, 0, 0, 0, -UPPER, 0.013, 0.009, UNEVEN, upper);
    i = put(t, i, 0, 0, 0, -FORE, 0.01, 0.008, UNEVEN, fore);
    i = put(t, i, 0, -FORE, 0.012, -FORE - 0.07, 0.011, 0.002, UNEVEN, fore);
  }
  // Main rod, then the two hand rods (endpoints rewritten every frame by the rig).
  i = put(t, i, 0, 0.1, 0, ROD_END, 0.004, 0, CAPSULE, body);
  rods[r0] = i;
  i = put(t, i, 0, 0, 0, ROD_END, 0.0035, 0, CAPSULE, body);
  rods[r0 + 1] = i;
  i = put(t, i, 0, 0, 0, ROD_END, 0.0035, 0, CAPSULE, body);
  return i;
}

/**
 * The kayon (gunungan): a mountain-shaped leaf, broad at the foot and pointed at the top, on a
 * plinth, mirror-symmetric, with a cut-out gate, trunk and branches.
 */
function kayon(/** @type {Float32Array} */ t, /** @type {number} */ i) {
  const m = MIRROR;
  const b = KAYON_BONE;
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
  let i = 0;
  for (let s = 0; s < 2; s++) {
    ranges[s * 2] = i;
    i = puppet(table, i, s * BONES_PER, rods, s * 2);
    ranges[s * 2 + 1] = i - ranges[s * 2];
  }
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

/** Axis-aligned box centred at c with half-size (hx, hy). */
export function sdBox(/** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ hx, /** @type {number} */ hy) {
  const dx = Math.abs(px - cx) - hx;
  const dy = Math.abs(py - cy) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}

/**
 * Signed distance (bone units) from stage point (x, y) to the silhouette in records
 * [start, start + count), with the bones' stage -> bone transforms `inv` (column-major mat3 each).
 * Writes the bone-local point of the nearest union primitive into q (the lace's lattice frame).
 * @param {Float32Array} t @param {number} start @param {number} count @param {Float32Array} inv
 * @param {number} x @param {number} y @param {Float64Array | Float32Array} q
 */
export function sdfRange(t, start, count, inv, x, y, q) {
  let d = 1e9;
  for (let i = start; i < start + count; i++) {
    const o = i * RECORD_FLOATS;
    const type = t[o + 6] | 0;
    const m = (t[o + 7] | 0) * 9;
    let px = inv[m] * x + inv[m + 3] * y + inv[m + 6];
    const py = inv[m + 1] * x + inv[m + 4] * y + inv[m + 7];
    if (type & MIRROR) px = Math.abs(px);
    const base = type & 7;
    let ds;
    if (base === CAPSULE) ds = sdSegment(px, py, t[o], t[o + 1], t[o + 2], t[o + 3]) - t[o + 4];
    else if (base === UNEVEN) ds = sdUneven(px, py, t[o], t[o + 1], t[o + 2], t[o + 3], t[o + 4], t[o + 5]);
    else if (base === VESICA) ds = sdVesica(px, py, t[o], t[o + 1], t[o + 2], t[o + 3], t[o + 4], t[o + 5]);
    else if (base === TRIANGLE) {
      const n = o + RECORD_FLOATS;
      ds = sdTriangle(px, py, t[o], t[o + 1], t[o + 2], t[o + 3], t[n], t[n + 1]);
      i++;
    } else if (base === DISC) ds = Math.hypot(px - t[o], py - t[o + 1]) - t[o + 4];
    else ds = sdBox(px, py, t[o], t[o + 1], t[o + 4], t[o + 5]);
    if (type & CUT) d = Math.max(d, -ds);
    else if (ds < d) {
      d = ds;
      q[0] = px;
      q[1] = py;
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
 */
export function laceCoverage(d, x, y, s, border, ppu, w) {
  const body = 1 - smoothstep(-w, w, d * ppu);
  if (body <= 0) return 0;
  const r = HOLE * s * ppu;
  const contrast = (1 - Math.exp((-2 * r * r) / (w * w))) * smoothstep(1, 2, r);
  const hole = (1 - smoothstep(-w, w, holeDistance(x, y, s) * ppu)) * contrast;
  const band = 1 - smoothstep(-w, w, (d + border) * ppu);
  return body * (1 - hole * band);
}
