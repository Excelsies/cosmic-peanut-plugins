// @ts-check
/**
 * Fixed-timestep driver: turns variable display-frame dt into a whole number of simulation steps
 * of length `h`, so a simulation gives the same result at 60, 120 or 144 Hz. At most `maxSteps`
 * run per frame; a longer backlog (a hitch, a hidden tab) is dropped instead of spiralling.
 * `alpha` (0..1) is the leftover fraction of a step, for interpolating rendered state between the
 * previous and current step. `advance` allocates nothing.
 *
 * @param {number} h step length in seconds
 * @param {number} maxSteps most steps one frame may run
 */
export function createFixedStep(h, maxSteps) {
  // Tolerate rounding so that 2 × (1/120) counts as one 1/60 step.
  const eps = h * 1e-6;
  let acc = 0;
  const fs = {
    /** Leftover fraction of a step after the last `advance`, 0..1. */
    alpha: 0,
    /**
     * @param {number} dt seconds since the previous frame
     * @returns {number} how many steps to run now
     */
    advance(dt) {
      if (dt > 0 && dt < Infinity) acc += dt;
      let steps = 0;
      while (acc >= h - eps && steps < maxSteps) {
        acc -= h;
        steps++;
      }
      if (acc >= h) acc %= h;
      if (acc < 0) acc = 0;
      fs.alpha = acc / h;
      return steps;
    },
    /** Forget any accumulated time. */
    reset() {
      acc = 0;
      fs.alpha = 0;
    },
  };
  return fs;
}
