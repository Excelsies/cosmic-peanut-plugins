// @ts-check
/**
 * Thin-film interference colours of a soap film in air, as a lookup table over film thickness
 * and angle of incidence (the Michel-Levy chart a real soap bubble shows).
 *
 * For each texel the reflectance of a single film (Airy summation of all internal reflections,
 * no absorption) is integrated over 380–780 nm in 5 nm steps, weighted by the light's spectrum
 * (a Planck blackbody) and the CIE 1931 colour-matching functions (the analytic multi-lobe fit of
 * Wyman, Sloan and Shirley 2013, so no data table is needed), converted to linear sRGB and
 * normalised so the brightest first-order white (about 105 nm) has Y = 1. Out-of-gamut colours
 * are pulled toward their own grey until no channel is negative, then clamped to 1.
 *
 * Built on the CPU in create() and whenever the Light param changes, never per frame. The bytes
 * are gamma 2.2 encoded RGBA8 so an 8-bit LINEAR texture keeps the dark purples smooth; the
 * shader decodes with pow(c, 2.2).
 */

/** Thickness texels across 0–H_MAX_NM. */
export const TABLE_W = 512;
/** Thickness of the last texel, nm. */
export const H_MAX_NM = 1400;
/** Angles of incidence of the three table rows, degrees. */
export const ANGLES = [0, 30, 50];
/** Refractive index of soapy water. */
export const N_FILM = 1.33;
/** Blackbody temperature of each Light option, in manifest order: softbox, sky, warm. */
export const LIGHT_KELVIN = [6504, 10000, 3200];

const L0 = 380;
const L1 = 780;
const DL = 5;
const NL = (L1 - L0) / DL + 1;

/** Piecewise Gaussian with separate inverse widths left and right of the mean. */
function g(/** @type {number} */ x, /** @type {number} */ mu, /** @type {number} */ s1, /** @type {number} */ s2) {
  const t = (x - mu) * (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}

/** CIE 1931 2-degree colour-matching functions, Wyman-Sloan-Shirley multi-lobe fit. @param {number} l nm */
export function cieX(l) {
  return 1.056 * g(l, 599.8, 0.0264, 0.0323) + 0.362 * g(l, 442.0, 0.0624, 0.0374) - 0.065 * g(l, 501.1, 0.049, 0.0382);
}
/** @param {number} l nm */
export function cieY(l) {
  return 0.821 * g(l, 568.8, 0.0213, 0.0247) + 0.286 * g(l, 530.9, 0.0613, 0.0322);
}
/** @param {number} l nm */
export function cieZ(l) {
  return 1.217 * g(l, 437.0, 0.0845, 0.0278) + 0.681 * g(l, 459.0, 0.0385, 0.0725);
}

/** Relative spectral radiance of a blackbody (scale irrelevant). @param {number} l nm @param {number} k kelvin */
function planck(l, k) {
  return 1 / (l ** 5 * (Math.exp(1.4388e7 / (l * k)) - 1));
}

/**
 * Reflectance of a film of index n in air: R = 2r²(1 − cos δ) / (1 + r⁴ − 2r² cos δ).
 * @param {number} h thickness, nm
 * @param {number} cosT cosine of the refraction angle inside the film
 * @param {number} l wavelength, nm
 */
export function airy(h, cosT, l) {
  const r = (N_FILM - 1) / (N_FILM + 1);
  const r2 = r * r;
  const c = Math.cos((4 * Math.PI * N_FILM * h * cosT) / l);
  return (2 * r2 * (1 - c)) / (1 + r2 * r2 - 2 * r2 * c);
}

/**
 * A table to fill with {@link buildTable}: `linear` holds RGB floats (row-major, row = angle),
 * `bytes` the gamma-encoded RGBA8 texels for texImage2D (width TABLE_W, height ANGLES.length).
 */
export function createTable() {
  return {
    linear: new Float32Array(TABLE_W * ANGLES.length * 3),
    bytes: new Uint8Array(TABLE_W * ANGLES.length * 4),
    /** Per-wavelength scratch: illuminant-weighted x̄, ȳ, z̄. */
    w: new Float64Array(NL * 3),
  };
}

/**
 * Fill `table` in place for a blackbody light of `kelvin`.
 * @param {number} kelvin
 * @param {ReturnType<typeof createTable>} table
 */
export function buildTable(kelvin, table) {
  const { linear, bytes, w } = table;
  let yNorm = 0;
  for (let j = 0; j < NL; j++) {
    const l = L0 + j * DL;
    const e = planck(l, kelvin);
    w[j * 3] = e * cieX(l);
    w[j * 3 + 1] = e * cieY(l);
    w[j * 3 + 2] = e * cieZ(l);
    yNorm += w[j * 3 + 1];
  }
  let maxY = 0;
  for (let row = 0; row < ANGLES.length; row++) {
    const sinT = Math.sin((ANGLES[row] * Math.PI) / 180) / N_FILM;
    const cosT = Math.sqrt(1 - sinT * sinT);
    for (let i = 0; i < TABLE_W; i++) {
      const h = (i / (TABLE_W - 1)) * H_MAX_NM;
      let X = 0;
      let Y = 0;
      let Z = 0;
      for (let j = 0; j < NL; j++) {
        const R = airy(h, cosT, L0 + j * DL);
        X += R * w[j * 3];
        Y += R * w[j * 3 + 1];
        Z += R * w[j * 3 + 2];
      }
      X /= yNorm;
      Y /= yNorm;
      Z /= yNorm;
      const o = (row * TABLE_W + i) * 3;
      linear[o] = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
      linear[o + 1] = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
      linear[o + 2] = 0.0557 * X - 0.204 * Y + 1.057 * Z;
      if (Y > maxY) maxY = Y;
    }
  }
  const k = maxY > 0 ? 1 / maxY : 0;
  for (let t = 0; t < TABLE_W * ANGLES.length; t++) {
    let r = linear[t * 3] * k;
    let gg = linear[t * 3 + 1] * k;
    let b = linear[t * 3 + 2] * k;
    const Y = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    const lo = Math.min(r, gg, b);
    if (lo < 0) {
      // Mix toward (Y, Y, Y) just far enough that the lowest channel reaches 0.
      const f = Y > 0 ? Math.min(1, -lo / (Y - lo)) : 1;
      r += (Y - r) * f;
      gg += (Y - gg) * f;
      b += (Y - b) * f;
    }
    r = Math.min(1, Math.max(0, r));
    gg = Math.min(1, Math.max(0, gg));
    b = Math.min(1, Math.max(0, b));
    linear[t * 3] = r;
    linear[t * 3 + 1] = gg;
    linear[t * 3 + 2] = b;
    bytes[t * 4] = Math.round(255 * r ** (1 / 2.2));
    bytes[t * 4 + 1] = Math.round(255 * gg ** (1 / 2.2));
    bytes[t * 4 + 2] = Math.round(255 * b ** (1 / 2.2));
    bytes[t * 4 + 3] = 255;
  }
  return table;
}

/**
 * Texture row coordinate (0–2, between the ANGLES rows) for an angle of incidence in degrees,
 * piecewise linear so 30 and 50 degrees land exactly on rows 1 and 2.
 * @param {number} deg
 */
export function angleRow(deg) {
  const d = Math.min(ANGLES[2], Math.max(0, deg));
  return d <= ANGLES[1] ? d / ANGLES[1] : 1 + (d - ANGLES[1]) / (ANGLES[2] - ANGLES[1]);
}
