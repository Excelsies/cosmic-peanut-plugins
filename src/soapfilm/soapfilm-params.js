// @ts-check
/**
 * Soapfilm's params, resolved once per change into plain numbers: selects become indices in
 * manifest order (unknown or stale values fall back to the default), numbers are clamped to the
 * manifest range (non-numbers fall back to the default), and the Reduce motion values are folded
 * in. tests/test_builtin_manifests.py::test_soapfilm_manifest pins the manifest to these.
 */

/** Backdrop options; composite.frag u_backdrop indexes them in this order. */
export const BACKDROPS = ["velvet", "studio", "none"];
/** Light options; thinfilm.js LIGHT_KELVIN is in the same order. */
export const LIGHTS = ["softbox", "sky", "warm"];
/** Re-dip options; redip.js reads the index (0 = 16 bars, 1 = 32 bars, 2 = when black). */
export const REDIPS = ["16 bars", "32 bars", "when black"];

export const DEFAULT_THICKNESS = 1;
/** Reduce motion swaps Swirl 1 for 0.5 while it is at this default. */
export const DEFAULT_SWIRL = 1;
/** Reduce motion swaps Drainage 1 for 0.6 while it is at this default. */
export const DEFAULT_DRAINAGE = 1;
/** Reduce motion slows the plumes to 0.6 while Reactivity is at this default. */
export const DEFAULT_REACTIVITY = 1;

export function createParams() {
  return {
    backdrop: 0,
    light: 0,
    thickness: DEFAULT_THICKNESS,
    swirl: DEFAULT_SWIRL,
    drainage: DEFAULT_DRAINAGE,
    redip: 0,
    reactivity: DEFAULT_REACTIVITY,
    /** Effective swirl, drainage and plume-rise multipliers after Reduce motion. */
    swirlEff: 1,
    drainEff: 1,
    riseEff: 1,
    /** Whether the stereo balance may tilt the bands (off under Reduce motion). */
    tilt: true,
  };
}

/** @param {unknown} v @param {readonly string[]} options */
function pick(v, options) {
  const i = typeof v === "string" ? options.indexOf(v) : -1;
  return i < 0 ? 0 : i;
}

/** @param {unknown} v @param {number} lo @param {number} hi @param {number} fallback */
function num(v, lo, hi, fallback) {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

/**
 * @param {Readonly<Record<string, unknown>>} raw `ctx.params`
 * @param {boolean} reduceMotion `ctx.reduceMotion`
 * @param {ReturnType<typeof createParams>} out filled in place and returned
 */
export function resolveParams(raw, reduceMotion, out) {
  out.backdrop = pick(raw.backdrop, BACKDROPS);
  out.light = pick(raw.light, LIGHTS);
  out.redip = pick(raw.redip, REDIPS);
  out.thickness = num(raw.thickness, 0.5, 2, DEFAULT_THICKNESS);
  out.swirl = num(raw.swirl, 0, 2, DEFAULT_SWIRL);
  out.drainage = num(raw.drainage, 0.2, 3, DEFAULT_DRAINAGE);
  out.reactivity = num(raw.reactivity, 0, 2, DEFAULT_REACTIVITY);
  out.swirlEff = reduceMotion && out.swirl === DEFAULT_SWIRL ? 0.5 : out.swirl;
  out.drainEff = reduceMotion && out.drainage === DEFAULT_DRAINAGE ? 0.6 : out.drainage;
  out.riseEff = reduceMotion && out.reactivity === DEFAULT_REACTIVITY ? 0.6 : out.reactivity;
  out.tilt = !reduceMotion;
  return out;
}
