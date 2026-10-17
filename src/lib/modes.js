// @ts-check
/**
 * Chladni mode table and the crossfade between two figures.
 *
 * Plate coordinates x, y are in [0, 1]; the plate's physical aspect is a = width / height. One
 * standing-wave term is cos(nπx)·cos(mπy) with wavenumber k² = (n/a)² + m² (edges are antinodes,
 * like a plate free at its rim). Two terms with nearly equal k² ring together and superpose into
 * the familiar figures: at a = 1, cos(nπx)cos(mπy) ± cos(mπx)cos(nπy) gives the crosses (−) and
 * nested diamonds (+) of the classic square plate; at other aspects the near-degenerate pairs give
 * curved butterfly figures. A single term is a plain lattice of node lines.
 *
 * The table holds MODE_COUNT entries of MODE_STRIDE floats: (n1, m1, n2, m2, sign), sign ±1 for a
 * pair and 0 for a single term (n2, m2 then repeat n1, m1). It is sorted by k², so a higher index
 * is a finer figure with more cells. Built on resize (aspect change), never per frame; the shaders
 * evaluate the field analytically from two entries uploaded as uniforms.
 */

export const MODE_COUNT = 32;
export const MODE_STRIDE = 5;
/** Index shown before any pitch is heard, so atonal input still has a figure. */
export const START_MODE = 6;
/** Highest n or m considered. */
const MAX_NM = 12;
/** Terms whose |k1² − k2²| / k² is below this ring together. */
const DEGENERATE = 0.08;
/** The 32 entries are picked near k values spaced geometrically from K_LO to K_HI. */
const K_LO = 2.2;
const K_HI = 11.5;

/**
 * k² of table entry `i` (the mean of a pair's two terms).
 * @param {Float32Array} table
 * @param {number} i
 * @param {number} aspect
 */
export function modeK2(table, i, aspect) {
  const o = i * MODE_STRIDE;
  const k1 = (table[o] / aspect) ** 2 + table[o + 1] ** 2;
  const k2 = (table[o + 2] / aspect) ** 2 + table[o + 3] ** 2;
  return (k1 + k2) / 2;
}

/**
 * Fill `out` with the 32-entry table for `aspect` and return it. Every pair of near-degenerate
 * terms (with both signs) and every single term is a candidate; slot i takes the unused candidate
 * nearest k = K_LO·(K_HI/K_LO)^(i/31), a single term in every fifth slot and a pair elsewhere
 * (when one exists), so figures run from coarse to fine with a few lattices among them. The
 * result is sorted by k². Allocates scratch (resize only).
 *
 * @param {number} aspect width / height, > 0
 * @param {Float32Array} out length ≥ MODE_COUNT · MODE_STRIDE
 * @returns {Float32Array}
 */
export function buildModeTable(aspect, out) {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  /** @type {{ n1: number, m1: number, n2: number, m2: number, sign: number, k2: number, used: boolean }[]} */
  const singles = [];
  /** @type {typeof singles} */
  const pairs = [];
  /** @type {[number, number, number][]} */
  const terms = [];
  for (let n = 1; n <= MAX_NM; n++) for (let m = 1; m <= MAX_NM; m++) terms.push([n, m, (n / a) ** 2 + m * m]);
  for (const [n, m, k2] of terms) singles.push({ n1: n, m1: m, n2: n, m2: m, sign: 0, k2, used: false });
  for (let i = 0; i < terms.length; i++) {
    for (let j = i + 1; j < terms.length; j++) {
      const [n1, m1, ka] = terms[i];
      const [n2, m2, kb] = terms[j];
      const k2 = (ka + kb) / 2;
      if (Math.abs(ka - kb) / k2 >= DEGENERATE) continue;
      for (const sign of [1, -1]) pairs.push({ n1, m1, n2, m2, sign, k2, used: false });
    }
  }
  /** @type {typeof singles} */
  const picked = [];
  for (let i = 0; i < MODE_COUNT; i++) {
    const target = K_LO * (K_HI / K_LO) ** (i / (MODE_COUNT - 1));
    const wantSingle = i % 5 === 2;
    const preferSign = i % 2 === 0 ? 1 : -1;
    const best = nearest(wantSingle ? singles : pairs, target, preferSign) ?? nearest(wantSingle ? pairs : singles, target, preferSign);
    if (!best) throw new Error("mode table: ran out of candidates");
    best.used = true;
    picked.push(best);
  }
  picked.sort((p, q) => p.k2 - q.k2);
  for (let i = 0; i < MODE_COUNT; i++) {
    const p = picked[i];
    const o = i * MODE_STRIDE;
    out[o] = p.n1;
    out[o + 1] = p.m1;
    out[o + 2] = p.n2;
    out[o + 3] = p.m2;
    out[o + 4] = p.sign;
  }
  return out;
}

/**
 * Unused candidate whose k is nearest `target`; ties go to `preferSign`, then to the first found.
 * @template {{ sign: number, k2: number, used: boolean }} T
 * @param {T[]} list
 * @param {number} target
 * @param {number} preferSign
 * @returns {T | null}
 */
function nearest(list, target, preferSign) {
  let best = null;
  let bestD = Infinity;
  for (const c of list) {
    if (c.used) continue;
    const d = Math.abs(Math.sqrt(c.k2) - target) + (c.sign === preferSign ? 0 : 1e-6);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Crossfade length (s) between two figures; longer under reduce motion. */
export const FADE = 0.4;
export const FADE_REDUCED = 1.0;

/**
 * Which two table entries the plate shows and how far it is from A to B. A switch moves B to A,
 * sets the new B and runs `blend` 0 → 1 over FADE (FADE_REDUCED under reduce motion). The shaders
 * show u = mix(uA, uB, blend). Allocates nothing after creation.
 * @param {number} start initial index (A = B = start, blend 1)
 */
export function createCrossfade(start) {
  let duration = FADE;
  return {
    a: start,
    b: start,
    blend: 1,
    /** @param {number} index @param {boolean} reduceMotion */
    switchTo(index, reduceMotion) {
      if (index === this.b) return;
      this.a = this.b;
      this.b = index;
      this.blend = 0;
      duration = reduceMotion ? FADE_REDUCED : FADE;
    },
    /** @param {number} dt */
    step(dt) {
      if (this.blend >= 1) return;
      const b = this.blend + Math.max(0, dt) / duration;
      this.blend = b > 1 - 1e-9 ? 1 : b;
    },
  };
}
