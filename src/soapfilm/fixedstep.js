// @ts-check
/**
 * Fixed-timestep accumulator: turns a variable frame `dt` into a whole number of simulation steps
 * so a simulation runs the same at 60 Hz and 120 Hz. At most `maxSteps` per frame; a longer
 * backlog (a hitch, a hidden tab) is dropped instead of being caught up, so a slow frame never
 * causes a slower one.
 *
 *   const clock = createFixedStep(1 / 120, 4);
 *   // in frame():
 *   const { steps, alpha } = clock.advance(time.dt);
 *
 * `advance` allocates nothing and returns the same object every call.
 *
 * @param {number} step seconds per simulation step
 * @param {number} maxSteps cap per frame
 */
export function createFixedStep(step, maxSteps) {
  // Tolerance so 1/60 + 1/60 … lands on exactly two 1/120 steps despite float rounding.
  const eps = step * 1e-6;
  let acc = 0;
  const out = { steps: 0, alpha: 0 };
  return {
    /** @param {number} dt seconds since the previous frame */
    advance(dt) {
      if (dt > 0) acc += dt;
      let n = 0;
      while (acc >= step - eps && n < maxSteps) {
        acc -= step;
        n++;
      }
      if (acc >= step - eps) acc = 0; // over the cap: drop the backlog
      if (acc < 0) acc = 0;
      out.steps = n;
      out.alpha = acc / step;
      return out;
    },
    /** Forget any partial step. */
    reset() {
      acc = 0;
    },
  };
}
