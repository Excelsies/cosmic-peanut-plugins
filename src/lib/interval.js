// @ts-check
/**
 * The musical interval between the two strongest pitch classes, as a just-intonation frequency
 * ratio (Plotter's y : x pendulum ratio). Consonant intervals give small-integer ratios and so
 * clean, closed figures; dissonant ones give large ratios and dense, precessing webs.
 */

/** Ratio per interval in semitones (0 = unison/octave … 11 = major seventh). */
export const RATIOS = Float64Array.of(2, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 16 / 9, 15 / 8);

/** Below this max/mean the chroma has no clear pitch (drums, noise): use the octave. */
export const MIN_CLARITY = 1.5;

/**
 * Allocates nothing.
 * @param {ArrayLike<number>} chroma 12 pitch-class levels (C = 0)
 * @returns {number} ratio, 2 when the chroma is flat or empty
 */
export function intervalRatio(chroma) {
  let pc1 = 0;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += chroma[i];
    if (chroma[i] > chroma[pc1]) pc1 = i;
  }
  const mean = sum / 12;
  if (!(mean > 0) || chroma[pc1] / mean < MIN_CLARITY) return RATIOS[0];
  let pc2 = pc1 === 0 ? 1 : 0;
  for (let i = 0; i < 12; i++) if (i !== pc1 && chroma[i] > chroma[pc2]) pc2 = i;
  return RATIOS[(pc2 - pc1 + 12) % 12];
}
