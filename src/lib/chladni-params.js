// @ts-check
/**
 * Chladni params: clamping, stale-value fallback, Reduce motion and Battery rules, and palettes.
 * Call `resolveParams` when params, quality or reduce motion change (it allocates nothing).
 */
import { hexToRgb } from "./color.js";

/** Manifest default of Reactivity (tests/test_builtin_manifests.py pins it). */
export const DEFAULT_REACTIVITY = 1;
/** Select options in manifest order; the composite shader indexes palettes the same way. */
export const PALETTES = ["brass", "slate", "cobalt", "mono"];
export const BACKDROPS = ["plate", "none"];
export const GRAIN_OPTIONS = ["32k", "64k", "128k"];
const GRAIN_COUNTS = [32768, 65536, 131072];
const DEFAULT_GRAINS = 1;
/** Under Reduce motion, with Reactivity at its default. */
const REDUCED_REACTIVITY = 0.5;
const REDUCED_HOP = 0.5;

/** number params: [min, max, default] as in tidalviz.json. */
const RANGES = { complexity: [0.5, 2, 1], reactivity: [0, 2, DEFAULT_REACTIVITY], hop: [0, 2, 1] };

export function createResolved() {
  return { palette: 0, backdrop: 0, grains: GRAIN_COUNTS[DEFAULT_GRAINS], complexity: 1, reactivity: 1, hop: 1, bassTilt: true, reduceMotion: false };
}

/** @param {unknown} v @param {readonly string[]} options @param {number} fallback */
function optionIndex(v, options, fallback) {
  const i = typeof v === "string" ? options.indexOf(v) : -1;
  return i < 0 ? fallback : i;
}

/** @param {unknown} v @param {number[]} range */
function number(v, range) {
  if (typeof v !== "number" || !Number.isFinite(v)) return range[2];
  return v < range[0] ? range[0] : v > range[1] ? range[1] : v;
}

/**
 * @param {Readonly<Record<string, unknown>>} params ctx.params
 * @param {string} quality ctx.quality
 * @param {boolean} reduceMotion ctx.reduceMotion
 * @param {ReturnType<typeof createResolved>} out
 */
export function resolveParams(params, quality, reduceMotion, out) {
  out.palette = optionIndex(params.palette, PALETTES, 0);
  out.backdrop = optionIndex(params.backdrop, BACKDROPS, 0);
  const g = optionIndex(params.grains, GRAIN_OPTIONS, DEFAULT_GRAINS);
  out.grains = GRAIN_COUNTS[quality === "battery" && g === DEFAULT_GRAINS ? 0 : g];
  out.complexity = number(params.complexity, RANGES.complexity);
  const react = number(params.reactivity, RANGES.reactivity);
  const hop = number(params.hop, RANGES.hop);
  const calm = reduceMotion && react === DEFAULT_REACTIVITY;
  out.reactivity = calm ? REDUCED_REACTIVITY : react;
  out.hop = calm ? hop * REDUCED_HOP : hop;
  out.bassTilt = !calm;
  out.reduceMotion = reduceMotion;
  return out;
}

/** Per palette: plate bottom, plate top, grains on the plate, grains with backdrop none. */
const PALETTE_HEX = [
  ["#6b4a1f", "#a8823f", "#1d1712", "#d9b56a"], // brass: brushed brass, iron filings
  ["#222a34", "#2b3440", "#e9dcc0", "#e9dcc0"], // slate: dark stone, pale sand
  ["#dde2e9", "#eef1f5", "#1f3fa0", "#8fb0ff"], // cobalt: white enamel, cobalt sand
  ["#2c2c2c", "#3a3a3a", "#ffffff", "#f2f2f2"], // mono: grey plate, white sand
];
/** Per palette: brushing strength and sheen strength of the plate (static, never audio-driven). */
export const PLATE_FINISH = new Float32Array([1, 1, 0.35, 0.4, 0.15, 0.7, 0.5, 0.5]);

/**
 * Write palette `index`'s four colours (12 floats, 0–1 sRGB) into `out`.
 * @param {number} index
 * @param {Float32Array} out length ≥ 12
 */
export function paletteColors(index, out) {
  const p = PALETTE_HEX[index] ?? PALETTE_HEX[0];
  for (let i = 0; i < 4; i++) {
    const c = hexToRgb(p[i], [0, 0, 0]);
    out[i * 3] = c[0];
    out[i * 3 + 1] = c[1];
    out[i * 3 + 2] = c[2];
  }
  return out;
}
