// @ts-check
/**
 * Murmuration's parameter resolution: manifest values (possibly stale, out of range or malformed)
 * → the numbers the simulation and shaders use. Pure; writes into a preallocated state object.
 */
import { parseHex } from "./color.js";

/** Manifest default of `speed`; Reduce motion only applies while `speed` is still at it. */
export const DEFAULT_SPEED = 1;
export const DEFAULT_INK = "#ece6da";
/** Sky options in manifest order (shader index = position). */
export const SKIES = ["dusk", "overcast", "rose", "none"];
export const SKY_NONE = 3;
export const FLOCKS = [2000, 4000, 6000];
export const DEFAULT_FLOCK = 4000;
export const BATTERY_FLOCK = 2000;

/** @param {number} hex */
function rgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/**
 * Sky gradient stops per sky (sRGB 0–1), 4 × rgb: top, mid height, low band (15%), bottom edge.
 * "none" is transparent and has no stops of its own (birds use the ink colour).
 */
export const SKY_STOPS = new Float32Array([
  ...rgb(0x2c3a5a), ...rgb(0x8d7ea6), ...rgb(0xf2b98a), ...rgb(0xe9a77f), // dusk
  ...rgb(0xc9ccd0), ...rgb(0xd8d9d9), ...rgb(0xe6e6e3), ...rgb(0xe6e6e3), // overcast
  ...rgb(0x3b2f4a), ...rgb(0xd98c9a), ...rgb(0xf6d1a0), ...rgb(0xefc496), // rose
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // none
]);
/** Bird colour per sky (sRGB 0–1); "none" uses the ink param. */
export const BIRD_COLORS = new Float32Array([
  ...rgb(0x1a1a22), // dusk
  ...rgb(0x141414), // overcast
  ...rgb(0x1a1620), // rose
  0, 0, 0,
]);

/** @returns {ParamState} */
export function createParamState() {
  return {
    sky: 0,
    ink: new Float32Array(3),
    flock: DEFAULT_FLOCK,
    speed: DEFAULT_SPEED,
    falcon: true,
    reactivity: 1,
    flee: true,
    attractorAmp: 1,
    cirrusDrift: 1,
  };
}

/**
 * @typedef {object} ParamState
 * @property {number} sky index into SKIES
 * @property {Float32Array} ink bird colour for sky "none", sRGB 0–1
 * @property {number} flock bird count
 * @property {number} speed effective speed multiplier
 * @property {boolean} falcon strikes enabled
 * @property {number} reactivity 0–2
 * @property {boolean} flee birds burst away from the falcon
 * @property {number} attractorAmp sweep amplitude multiplier
 * @property {number} cirrusDrift cloud drift multiplier
 */

/**
 * @param {number} v @param {number} lo @param {number} hi @param {number} def
 */
function clampNum(v, lo, hi, def) {
  if (typeof v !== "number" || !Number.isFinite(v)) return def;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * @param {Readonly<Record<string, unknown>>} params ctx.params
 * @param {string} quality ctx.quality
 * @param {boolean} reduceMotion ctx.reduceMotion
 * @param {ParamState} out
 * @returns {ParamState}
 */
export function resolveParams(params, quality, reduceMotion, out) {
  const sky = SKIES.indexOf(String(params.sky));
  out.sky = sky < 0 ? 0 : sky;
  parseHex(params.ink, DEFAULT_INK, out.ink);

  const flock = Number(params.flock);
  const valid = typeof params.flock === "string" && FLOCKS.indexOf(flock) >= 0;
  out.flock = valid ? flock : DEFAULT_FLOCK;
  if (quality === "battery" && out.flock === DEFAULT_FLOCK) out.flock = BATTERY_FLOCK;

  const speed = clampNum(/** @type {number} */ (params.speed), 0.2, 2, DEFAULT_SPEED);
  const gentle = reduceMotion && speed === DEFAULT_SPEED;
  out.speed = gentle ? 0.5 : speed;
  out.falcon = typeof params.falcon === "boolean" ? params.falcon : true;
  out.reactivity = clampNum(/** @type {number} */ (params.reactivity), 0, 2, 1);
  out.flee = !gentle;
  out.attractorAmp = gentle ? 0.5 : 1;
  out.cirrusDrift = gentle ? 0.3 : 1;
  return out;
}
