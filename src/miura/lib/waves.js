// @ts-check
/**
 * Fold waves: each hit launches a ring that travels out across the sheet from where the sound
 * sits, steepening the pleats it passes. A ring buffer of MAX_WAVES waves; a new one replaces
 * the oldest. Coordinates are normalised to the visible sheet (u right, v up, both 0-1) and
 * distances are measured in visible-sheet heights, so the look does not depend on the window.
 *
 * The field is analytic in time: a wave is dated from the onset itself (time.now - onsetAge)
 * (or now, when the onset carries no usable age)
 * and evaluated at the frame's time, so it is identical at 60 and 120 Hz.
 *
 * contribution(r, age) = amp * exp(-((r - c age) / WIDTH)^2) * exp(-age / DECAY), c = 0.9 speed
 *
 * Nothing allocates after createWaves.
 */
import { hash01 } from "./hash.js";

export const MAX_WAVES = 8;
/** Waves older than this (s) are skipped. */
export const WAVE_LIFE = 4;
/**
 * An onset frame's onsetAge is about a frame; more than this means the source gave no usable age
 * (the API caps it at 10 s, which some sources report on every frame), so the wave starts now.
 */
export const MAX_ONSET_AGE = 0.5;
/** Weakest onset that launches a wave. */
export const MIN_STRENGTH = 0.15;
const WIDTH = 0.08;
const DECAY = 1.2;
const SPEED = 0.9;
/** Skip a ring's Gaussian beyond this many widths (exp(-16) is ~1e-7). */
const CUTOFF = 4;

/**
 * Where a hit starts across the sheet: left-louder hits (balance > 0) start on the left.
 * @param {number} balance stereo balance, +1 = left louder
 */
export const waveOriginX = (balance) => 0.5 - 0.45 * balance;

export function createWaves() {
  const ox = new Float32Array(MAX_WAVES);
  const oy = new Float32Array(MAX_WAVES);
  const t0 = new Float64Array(MAX_WAVES);
  const amp = new Float32Array(MAX_WAVES);
  // Per-frame, compacted: only the live waves.
  const px = new Float32Array(MAX_WAVES);
  const py = new Float32Array(MAX_WAVES);
  const pr = new Float32Array(MAX_WAVES);
  const pa = new Float32Array(MAX_WAVES);

  const w = {
    ox,
    oy,
    t0,
    amp,
    /** Waves stored (up to MAX_WAVES). */
    count: 0,
    /** Slot the next wave goes into (the oldest once full). */
    next: 0,
    /** Live waves after the last `prepare`. */
    active: 0,

    /**
     * Launch a wave if this frame carries a strong enough onset.
     * @param {{ onset: boolean, onsetStrength: number, onsetAge: number, silent: boolean }} a
     * @param {number} now time.now
     * @param {number} reactivity
     * @param {number} waveEff wave amplitude factor (reduce motion, foil under reduce flashing)
     * @param {number} balance smoothed stereo balance, +1 = left louder
     * @param {number} onsetCount onsets seen so far (hashes the start height)
     * @returns {boolean} whether a wave was launched
     */
    onset(a, now, reactivity, waveEff, balance, onsetCount) {
      if (!a.onset || a.silent || !(a.onsetStrength > MIN_STRENGTH)) return false;
      const s = w.next;
      t0[s] = a.onsetAge <= MAX_ONSET_AGE ? now - a.onsetAge : now;
      amp[s] = 0.35 * a.onsetStrength * reactivity * waveEff;
      ox[s] = waveOriginX(balance);
      oy[s] = 0.3 + 0.4 * hash01(onsetCount);
      w.next = (s + 1) % MAX_WAVES;
      if (w.count < MAX_WAVES) w.count++;
      return true;
    },

    /**
     * Evaluate each wave's ring radius and amplitude for this frame.
     * @param {number} now time.now
     * @param {number} speed speed factor (reduce motion)
     */
    prepare(now, speed) {
      let n = 0;
      const c = SPEED * speed;
      for (let s = 0; s < w.count; s++) {
        const age = now - t0[s];
        if (age < 0 || age > WAVE_LIFE || amp[s] === 0) continue;
        px[n] = ox[s];
        py[n] = oy[s];
        pr[n] = c * age;
        pa[n] = amp[s] * Math.exp(-age / DECAY);
        n++;
      }
      w.active = n;
    },

    /**
     * Summed fold offset at a point of the visible sheet (after `prepare`).
     * @param {number} u 0-1 across @param {number} v 0-1 up
     * @param {number} aspect visible width / height
     */
    at(u, v, aspect) {
      let sum = 0;
      for (let n = 0; n < w.active; n++) {
        const dx = (u - px[n]) * aspect;
        const dy = v - py[n];
        const g = (Math.sqrt(dx * dx + dy * dy) - pr[n]) / WIDTH;
        if (g > CUTOFF || g < -CUTOFF) continue;
        sum += pa[n] * Math.exp(-g * g);
      }
      return sum;
    },

    /** Forget every wave. */
    clear() {
      w.count = 0;
      w.next = 0;
      w.active = 0;
    },
  };
  return w;
}
