// @ts-check
/**
 * Miura's parameters: validation (the host or a stale preset may hand over anything) and the
 * reduce-motion effective values. Option lists are in manifest order; the manifest defaults of
 * fold and reactivity are pinned to DEFAULT_FOLD / DEFAULT_REACTIVITY by the tests, because
 * reduce motion only applies while both are untouched.
 */

export const PAPERS = ["washi", "indigo", "vermilion", "foil", "graphite"];
export const PLEATS = ["classic", "fine", "bold"];
export const SHEETS = ["fill", "float"];
export const LIGHTS = ["window", "noon", "low-sun"];
export const DEFAULT_FOLD = 1;
export const DEFAULT_REACTIVITY = 1;

/**
 * @typedef {object} MiuraParams
 * @property {string} paper @property {string} pleat @property {string} sheet
 * @property {number} fold @property {number} reactivity
 * @property {string} light @property {boolean} shadows
 */

/** @param {unknown} v @param {string[]} options */
const pick = (v, options) => (typeof v === "string" && options.includes(v) ? v : options[0]);

/** @param {unknown} v @param {number} lo @param {number} hi @param {number} fallback */
function clampNum(v, lo, hi, fallback) {
  const n = typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/**
 * @template {object} T
 * @param {Readonly<Record<string, unknown>>} raw ctx.params
 * @param {T} out
 * @returns {T & MiuraParams}
 */
export function resolveParams(raw, out) {
  const o = /** @type {T & MiuraParams} */ (out);
  o.paper = pick(raw.paper, PAPERS);
  o.pleat = pick(raw.pleat, PLEATS);
  o.sheet = pick(raw.sheet, SHEETS);
  o.fold = clampNum(raw.fold, 0.2, 1.5, DEFAULT_FOLD);
  o.reactivity = clampNum(raw.reactivity, 0, 2, DEFAULT_REACTIVITY);
  o.light = pick(raw.light, LIGHTS);
  o.shadows = raw.shadows !== false;
  return o;
}

/**
 * @typedef {object} Motion
 * @property {number} waveEff wave amplitude factor
 * @property {number} speedEff wave travel speed factor
 * @property {number} swell 1 = mids swell the sheet, 0 = off
 * @property {number} rustle 1 = hats rustle the facets, 0 = off
 * @property {number} barsPerTurn bars between light changes
 */

/**
 * Gentler motion under the OS reduce-motion setting, while fold and reactivity are untouched.
 * @template {object} T
 * @param {{ fold: number, reactivity: number }} p resolved params
 * @param {boolean} reduceMotion ctx.reduceMotion
 * @param {T} out
 * @returns {T & Motion}
 */
export function effectiveMotion(p, reduceMotion, out) {
  const o = /** @type {T & Motion} */ (out);
  const gentle = reduceMotion && p.fold === DEFAULT_FOLD && p.reactivity === DEFAULT_REACTIVITY;
  o.waveEff = gentle ? 0.5 : 1;
  o.speedEff = gentle ? 0.6 : 1;
  o.swell = gentle ? 0 : 1;
  o.rustle = gentle ? 0 : 1;
  o.barsPerTurn = gentle ? 16 : 8;
  return o;
}
