// @ts-check
/**
 * Fixed-timestep accumulator for frame-rate independent simulations: feed it each frame's `dt`
 * and run the simulation `advance(dt)` times with the fixed `step`. After a stall (more than
 * `maxSteps` steps due) it runs `maxSteps` and drops the backlog instead of spiralling.
 * Allocates nothing after creation.
 *
 * @param {number} step seconds per simulation step, e.g. 1 / 120
 * @param {number} maxSteps cap on steps per frame
 */
export function createFixedStep(step, maxSteps) {
  let acc = 0;
  return {
    step,
    /**
     * @param {number} dt seconds since the previous frame
     * @returns {number} how many fixed steps to run now
     */
    advance(dt) {
      acc += dt > 0 ? dt : 0;
      // The epsilon keeps 1/60 = 2 × 1/120 from flooring to 1 through rounding.
      let n = Math.floor(acc / step + 1e-6);
      if (n > maxSteps) {
        n = maxSteps;
        acc = 0;
      } else {
        acc = Math.max(0, acc - n * step);
      }
      return n;
    },
    /** Fraction of a step left over in the accumulator, 0–1. */
    get alpha() {
      return acc / step;
    },
    reset() {
      acc = 0;
    },
  };
}
