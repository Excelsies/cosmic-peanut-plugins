// @ts-check
/**
 * The film's thickness field: a vertical soap film drains under gravity, so it is thinnest at the
 * top (where it turns into "black film", too thin to reflect anything) and thickens downward.
 * composite.frag evaluates the same formulas per pixel; this module is the tested reference.
 *
 * Coordinates are u = x/W and v = y/H, both 0–1, with v = 0 at the top.
 */

/** Fraction of the height the black film covers once fully drained. */
export const BLACK_MAX = 0.55;
/** Drainage time constant of the black front, film-age seconds. */
export const BLACK_TAU = 90;
/** Thickness right under the black front, nm (first-order silver-white). */
export const H_EDGE = 90;

/** Black front (and black coverage) as a fraction of the height, for film age `a`. @param {number} a */
export function blackFront(a) {
  return BLACK_MAX * (1 - Math.exp(-a / BLACK_TAU));
}

/** Thickness at the bottom edge, nm; the film thins as it ages. @param {number} a @param {number} thickness param */
export function hMax(a, thickness) {
  return Math.min(1350, 1150 * thickness * (0.6 + 0.4 * Math.exp(-a / 180)));
}

/**
 * Base thickness at the tilted, wavering height `vp`: 0 above the black front, then H_EDGE
 * rising as s^0.65 to `hm` at the bottom.
 * @param {number} vp @param {number} vb black front @param {number} hm bottom thickness
 */
export function hBase(vp, vb, hm) {
  if (vp < vb) return 0;
  const s = Math.min(1, (vp - vb) / (1 - vb));
  return H_EDGE + (hm - H_EDGE) * s ** 0.65;
}

/**
 * The bass "membrane": the film breathing in its (1,1) mode, blending into (1,2) as the mids rise.
 * @param {number} u @param {number} v @param {number} m 0 = mode (1,1), 1 = mode (1,2)
 */
export function membrane(u, v, m) {
  const su = Math.sin(Math.PI * u);
  return su * Math.sin(Math.PI * v) * (1 - m) + su * Math.sin(2 * Math.PI * v) * m;
}

/** Integer lattice hash to [0, 1); composite.frag/state.frag `hash2` is the same uint arithmetic. */
function hash2(/** @type {number} */ ix, /** @type {number} */ iy) {
  let h = (Math.imul(ix, 0x8da6b343) ^ Math.imul(iy, 0xd8163841)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}

/** Smooth 2D value noise in [0, 1]. @param {number} x @param {number} y */
export function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const wx = fx * fx * (3 - 2 * fx);
  const wy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * wx + (c - a + (d - c - b + a) * wx) * wy;
}

/** Inputs of {@link thicknessAt}; the entry module keeps the same numbers as shader uniforms. */
export function createFilmState() {
  return {
    /** Film age, seconds since the last re-dip (scaled by drainage). */
    age: 0,
    /** Thickness param. */
    thickness: 1,
    /** Tilt of the bands, radians (+ = left side lower). */
    tilt: 0,
    /** W / H. */
    aspect: 16 / 9,
    /** Bass membrane amount (after the flash limiter), 0–0.24. */
    bassAmt: 0,
    /** Membrane mode blend, 0–1. */
    m: 0,
    /** Displacement from the state pass: the film here came from (u + dx, v + dy). */
    dx: 0,
    dy: 0,
    /** Fresh plume film, microns. */
    p: 0,
    /** Treble shimmer, nm. */
    shimmer: 0,
  };
}

/**
 * Film thickness in nm at (u, v).
 * @param {number} u @param {number} v
 * @param {ReturnType<typeof createFilmState>} st
 */
export function thicknessAt(u, v, st) {
  const qx = u + st.dx;
  const qy = v + st.dy;
  const vp = qy + Math.tan(st.tilt) * (qx - 0.5) * st.aspect + 0.012 * vnoise(3 * qx, 0.05 * st.age);
  const hb = hBase(vp, blackFront(st.age), hMax(st.age, st.thickness));
  return hb * (1 + st.bassAmt * membrane(u, v, st.m)) + 1000 * st.p + st.shimmer;
}
