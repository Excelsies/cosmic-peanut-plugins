// @ts-check
/**
 * Parse a `#rrggbb` param value into 0–1 floats (e.g. for a vec3 uniform). Anything else → white.
 * @template {Float32Array | number[]} T
 * @param {unknown} hex
 * @param {T} out length ≥ 3
 * @returns {T}
 */
export function hexToRgb(hex, out) {
  const m = typeof hex === "string" ? /^#([0-9a-f]{6})$/i.exec(hex) : null;
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  out[0] = ((n >> 16) & 255) / 255;
  out[1] = ((n >> 8) & 255) / 255;
  out[2] = (n & 255) / 255;
  return out;
}

/**
 * A colour param value if it is a valid `#rrggbb` string, else `fallback` (stale or hand-edited
 * values, the harness flip test). Call it when params change, not per frame.
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
export function hexOr(value, fallback) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}
