// @ts-check
/**
 * Re-dipping the frame: every 16 (or 32) bars, or whenever the black film has drained over 45% of
 * the height, a fresh film is wiped up from the bottom over 1.2 s (an eased wipe, never a cut) and
 * the film age starts again. With no tempo, a re-dip comes every 40 s instead of on bars. Re-dips
 * are at least 8 s apart. Allocates nothing.
 *
 * During the wipe `front` (F, as a fraction of the height) rises from 1 to 0: below it (v > F) the
 * film is new (age 0) and the state pass clears its swirl and plume film; above it the old film
 * keeps draining. `front` is 2 when no wipe is running.
 */
import { blackFront } from "./film.js";

export const WIPE_SECONDS = 1.2;
/** Seconds between re-dips at least. */
export const MIN_INTERVAL = 8;
/** Seconds between re-dips while there is no tempo (bar modes only). */
export const FREE_INTERVAL = 40;
/** Black coverage that always triggers a re-dip. */
export const MAX_COVERAGE = 0.45;
/** Bars per re-dip for each Re-dip option index (0 for "when black"). */
const BARS = [16, 32, 0];

/** @param {number} t 0–1 */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** @param {number} initialAge film age to start from, seconds */
export function createRedip(initialAge) {
  let since = 0;
  let wipeT = 0;
  let lastBlock = -1;
  let lastBars = 0;
  const r = {
    /** Film age of the old film (everywhere when no wipe is running). */
    age: initialAge,
    /** Wipe front, 1 (bottom) → 0 (top); 2 when idle. */
    front: 2,
    wiping: false,

    /** Start a re-dip now (ignores the minimum interval). */
    trigger() {
      r.wiping = true;
      wipeT = 0;
      r.front = 1;
      since = 0;
    },

    /**
     * @param {number} dt seconds
     * @param {number} drainEff effective drainage (film ages at dt × drainEff)
     * @param {number} beats continuous beat count (meter.js)
     * @param {number} bpm 0 = no tempo
     * @param {number} mode Re-dip option index: 0 = 16 bars, 1 = 32 bars, 2 = when black
     * @returns {boolean} true when a re-dip started on this step
     */
    step(dt, drainEff, beats, bpm, mode) {
      since += dt;
      r.age += dt * drainEff;
      if (r.wiping) {
        wipeT += dt;
        if (wipeT >= WIPE_SECONDS - 1e-9) {
          r.wiping = false;
          r.front = 2;
          r.age = 0;
        } else {
          r.front = 1 - easeInOutCubic(wipeT / WIPE_SECONDS);
        }
      }
      const bars = BARS[mode] ?? BARS[0];
      let due = false;
      if (bars > 0 && bpm > 0) {
        const block = Math.floor(beats / (4 * bars));
        if (lastBlock >= 0 && bars === lastBars && block > lastBlock) due = true;
        lastBlock = block;
        lastBars = bars;
      } else {
        lastBlock = -1;
        if (bars > 0 && since >= FREE_INTERVAL - 1e-9) due = true;
      }
      if (!r.wiping && blackFront(r.age) > MAX_COVERAGE) due = true;
      if (due && !r.wiping && since >= MIN_INTERVAL - 1e-9) {
        r.trigger();
        return true;
      }
      return false;
    },
  };
  return r;
}
