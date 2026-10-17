// @ts-check
/**
 * Kelir's screens, in SCREENS order: the colour at the lamp's hotspot, in the corners, and of the
 * shadows (sRGB 0..1), plus how the composite treats them. `none` draws premultiplied shadows only.
 */

/** @param {string} hex '#rrggbb' */
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

export const PALETTES = [
  { id: "lamp", hot: rgb("#ffd79a"), edge: rgb("#6b3f1c"), shadow: rgb("#1a0f08"), vertical: false, reiniger: false, clear: false },
  { id: "moon", hot: rgb("#dfe8f2"), edge: rgb("#8a98aa"), shadow: rgb("#0e141c"), vertical: false, reiniger: false, clear: false },
  // Lotte Reiniger's paper cuts: a white screen with a faint dusk gradient (light at the bottom).
  { id: "reiniger", hot: rgb("#f6efe6"), edge: rgb("#e9d9e6"), shadow: rgb("#050505"), vertical: true, reiniger: true, clear: false },
  { id: "none", hot: rgb("#000000"), edge: rgb("#000000"), shadow: rgb("#1a0f08"), vertical: false, reiniger: false, clear: true },
];

/**
 * Write hot, edge and shadow colours (9 floats) of screen `i`.
 * @param {number} i @param {Float32Array} out
 */
export function screenColours(i, out) {
  const p = PALETTES[i] ?? PALETTES[0];
  for (let k = 0; k < 3; k++) {
    out[k] = p.hot[k];
    out[3 + k] = p.edge[k];
    out[6 + k] = p.shadow[k];
  }
  return out;
}

/** WCAG relative luminance of an sRGB colour. @param {number[]} c */
function luminance(c) {
  const lin = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio of two sRGB colours. @param {number[]} a @param {number[]} b */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
