// @ts-check
/**
 * Parse a `#rrggbb` param value into 0–1 floats. Anything else parses `fallback` instead.
 * @param {unknown} hex
 * @param {string} fallback a valid `#rrggbb`
 * @param {Float32Array | number[]} out length ≥ 3
 * @returns {boolean} whether `hex` itself was valid
 */
export function parseHex(hex, fallback, out) {
  const ok = typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex);
  const n = parseInt((ok ? /** @type {string} */ (hex) : fallback).slice(1), 16);
  out[0] = ((n >> 16) & 255) / 255;
  out[1] = ((n >> 8) & 255) / 255;
  out[2] = (n & 255) / 255;
  return ok;
}
