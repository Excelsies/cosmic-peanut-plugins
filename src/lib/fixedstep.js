// @ts-check
/**
 * Fixed-timestep clock, shared by the Fieldwork visualizers: turns variable frame `dt`s into a
 * whole number of simulation steps of `step` seconds, so a simulation gives the same result at 30,
 * 60, 120 or 144 Hz. At most `maxSteps` run per frame; a longer backlog (a hitch, a hidden tab) is
 * dropped instead of being caught up, so a slow frame never causes a slower one.
 *
 *   const clock = createFixedStep(1 / 120, 4);
 *   // in frame():
 *   const steps = clock.advance(time.dt); // then clock.alpha for interpolation
 *
 * `advance` allocates nothing.
 *
 * @param {number} step seconds per simulation step, e.g. 1 / 120
 * @param {number} maxSteps cap on steps per frame
 */
export function createFixedStep(step, maxSteps) {
  let acc = 0;
  const fs = {
    step,
    /** Leftover fraction of a step after the last `advance`, 0–1 (for interpolating). */
    alpha: 0,
    /**
     * @param {number} dt seconds since the previous frame (zero, negative or non-finite: ignored)
     * @returns {number} how many fixed steps to run now
     */
    advance(dt) {
      if (dt > 0 && dt < Infinity) acc += dt;
      // The epsilon keeps 1/60 = 2 × 1/120 (or 10 × 1/600) from flooring one short through rounding.
      let n = Math.floor(acc / step + 1e-6);
      if (n > maxSteps) {
        n = maxSteps;
        acc = 0;
      } else {
        acc = Math.max(0, acc - n * step);
      }
      fs.alpha = acc / step;
      return n;
    },
    /** Forget any partial step. */
    reset() {
      acc = 0;
      fs.alpha = 0;
    },
  };
  return fs;
}
