// @ts-check
/**
 * Isobar's chart styles, in the manifest's chart option order (isobar-params.js CHARTS).
 * `fronts` is indexed by fronts.js OCCLUDED, COLD, WARM.
 */

/**
 * @typedef {{
 *   bg: string | null, grat: string, land: string | null, coast: string, coastAlpha: number,
 *   iso: string, label: string, box: string, halo: string, low: string, high: string,
 *   fronts: readonly [string, string, string], barb: string, rain: string, tint: string,
 *   glyph: number,
 * }} ChartStyle
 */

/** @type {readonly ChartStyle[]} */
export const CHART_STYLES = [
  {
    // paper: a printed surface analysis
    bg: "#fbfbf7",
    grat: "rgba(0, 0, 0, 0.07)",
    land: "#ece8dc",
    coast: "#9a968c",
    coastAlpha: 1,
    iso: "#1b1b1b",
    label: "#1b1b1b",
    box: "#fbfbf7",
    halo: "rgba(251, 251, 247, 0.85)",
    low: "#b3202a",
    high: "#1f3a8a",
    fronts: ["#7a2bb0", "#1d4fd6", "#d6261d"],
    barb: "#1b1b1b",
    rain: "#4f9a52",
    tint: "#d6261d",
    glyph: 1,
  },
  {
    // broadcast: the evening-news map
    bg: "#10264d",
    grat: "rgba(255, 255, 255, 0.07)",
    land: "#3f6b3a",
    coast: "#a9c79f",
    coastAlpha: 1,
    iso: "#ffffff",
    label: "#ffffff",
    box: "#10264d",
    halo: "rgba(16, 38, 77, 0.85)",
    low: "#ff5a52",
    high: "#7fb2ff",
    fronts: ["#d08cff", "#4f8dff", "#ff4b3e"],
    barb: "#ffffff",
    rain: "#7cd67f",
    tint: "#ff4b3e",
    glyph: 1.5,
  },
  {
    // night: cyan isobars, amber fronts and letters
    bg: "#11161c",
    grat: "rgba(255, 255, 255, 0.07)",
    land: "#1b222b",
    coast: "#33414f",
    coastAlpha: 1,
    iso: "#6fd3e6",
    label: "#6fd3e6",
    box: "#11161c",
    halo: "rgba(17, 22, 28, 0.85)",
    low: "#f2b33d",
    high: "#f2b33d",
    fronts: ["#f2b33d", "#f2b33d", "#f2b33d"],
    barb: "#6fd3e6",
    rain: "#c9963a",
    tint: "#f2b33d",
    glyph: 1,
  },
  {
    // none: transparent, light ink, coastline only
    bg: null,
    grat: "rgba(232, 232, 232, 0.1)",
    land: null,
    coast: "#e8e8e8",
    coastAlpha: 0.5,
    iso: "#e8e8e8",
    label: "#e8e8e8",
    box: "rgba(17, 22, 28, 0.6)",
    halo: "rgba(17, 22, 28, 0.6)",
    low: "#ff5a52",
    high: "#7fb2ff",
    fronts: ["#d08cff", "#4f8dff", "#ff4b3e"],
    barb: "#e8e8e8",
    rain: "#7cd67f",
    tint: "#ff4b3e",
    glyph: 1,
  },
];
