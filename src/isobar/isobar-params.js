// @ts-check
/**
 * Isobar's params, resolved once per change into plain values: the chart select becomes an index
 * in manifest order (unknown or stale values fall back to the default), numbers are clamped to the
 * manifest range (non-numbers fall back to the default), booleans that aren't booleans fall back
 * to their default, and the Reduce motion values are folded in.
 * tests/test_builtin_manifests.py::test_isobar_manifest pins the manifest to these.
 */

/** Chart options; chart.js CHART_STYLES is in the same order. */
export const CHARTS = ["paper", "broadcast", "night", "none"];

export const DEFAULT_REACTIVITY = 1;
/** Reduce motion halves drift, kick pulses and the front sweep while Speed is at this default. */
export const DEFAULT_SPEED = 1;

export function createParams() {
  return {
    chart: 0,
    reactivity: DEFAULT_REACTIVITY,
    speed: DEFAULT_SPEED,
    fronts: true,
    barbs: true,
    labels: true,
    coastline: true,
    tints: true,
    /** Effective drift speed, kick-pulse and front-sweep multipliers after Reduce motion. */
    speedEff: 1,
    pulseEff: 1,
    sweepEff: 1,
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

/** @param {unknown} v @param {boolean} fallback */
function bool(v, fallback) {
  return typeof v === "boolean" ? v : fallback;
}

/**
 * @param {Readonly<Record<string, unknown>>} raw `ctx.params`
 * @param {boolean} reduceMotion `ctx.reduceMotion`
 * @param {ReturnType<typeof createParams>} out filled in place and returned
 */
export function resolveParams(raw, reduceMotion, out) {
  out.chart = pick(raw.chart, CHARTS);
  out.reactivity = num(raw.reactivity, 0, 2, DEFAULT_REACTIVITY);
  out.speed = num(raw.speed, 0.2, 2, DEFAULT_SPEED);
  out.fronts = bool(raw.fronts, true);
  out.barbs = bool(raw.barbs, true);
  out.labels = bool(raw.labels, true);
  out.coastline = bool(raw.coastline, true);
  out.tints = bool(raw.tints, true);
  const calm = reduceMotion && out.speed === DEFAULT_SPEED;
  out.speedEff = calm ? 0.5 : out.speed;
  out.pulseEff = calm ? 0.5 : 1;
  out.sweepEff = calm ? 0.5 : 1;
  return out;
}
