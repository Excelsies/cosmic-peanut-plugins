// @ts-check
/**
 * Kelir's parameters: validation (the host or a stale preset may hand over anything) and the
 * reduce-motion effective values. Option lists are in manifest order and resolve to their index,
 * which the shaders and the stage use; the tests pin them and the defaults below to the manifest,
 * because reduce motion only applies while reactivity and flicker are untouched.
 */

export const SCREENS = ["lamp", "moon", "reiniger", "none"];
export const CASTS = ["duet", "solo", "kayon"];
export const DEFAULT_CAST = "duet";
export const DEFAULT_REACTIVITY = 1;
export const DEFAULT_FLICKER = 0.5;

/** Lunge attack (s) normally and under reduce motion. */
const ATTACK = 0.07;
const ATTACK_GENTLE = 0.2;

/**
 * @typedef {object} KelirParams
 * @property {number} screen index into SCREENS
 * @property {number} cast index into CASTS
 * @property {number} reactivity 0..2
 * @property {number} flicker effective flicker amount (reduce motion already applied)
 * @property {number} blur penumbra range factor, 0..1.5
 * @property {number} lace lattice density, 0.5..2
 * @property {boolean} scenes
 * @property {number} attack lunge attack, seconds
 * @property {number} lungeEff how far a lunge pushes toward the screen, 0..1
 * @property {number} swayEff body sway factor
 * @property {boolean} spin whether the kayon turns flat as it sweeps (else it slides)
 */

/** @param {unknown} v @param {string[]} options */
const index = (v, options) => Math.max(0, typeof v === "string" ? options.indexOf(v) : -1);

/** @param {unknown} v @param {number} lo @param {number} hi @param {number} fallback */
function clampNum(v, lo, hi, fallback) {
  const n = typeof v === "number" && !Number.isNaN(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * @template {object} T
 * @param {Readonly<Record<string, unknown>>} raw ctx.params
 * @param {boolean} reduceMotion ctx.reduceMotion
 * @param {T} out
 * @returns {T & KelirParams}
 */
export function resolveParams(raw, reduceMotion, out) {
  const o = /** @type {T & KelirParams} */ (out);
  o.screen = index(raw.screen, SCREENS);
  o.cast = index(raw.cast, CASTS);
  o.reactivity = clampNum(raw.reactivity, 0, 2, DEFAULT_REACTIVITY);
  const flicker = clampNum(raw.flicker, 0, 1, DEFAULT_FLICKER);
  o.blur = clampNum(raw.blur, 0, 1.5, 1);
  o.lace = clampNum(raw.lace, 0.5, 2, 1);
  o.scenes = raw.scenes !== false;
  const gentle = reduceMotion && o.reactivity === DEFAULT_REACTIVITY;
  o.flicker = reduceMotion && flicker === DEFAULT_FLICKER ? flicker * 0.3 : flicker;
  o.attack = gentle ? ATTACK_GENTLE : ATTACK;
  o.lungeEff = gentle ? 0.7 : Math.min(1, o.reactivity);
  o.swayEff = gentle ? 0.5 : o.reactivity;
  o.spin = !gentle;
  return o;
}
