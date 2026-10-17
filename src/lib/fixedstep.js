// @ts-check
/**
 * Fixed-timestep clock: turns variable frame `dt`s into a whole number of simulation steps, so a
 * simulation gives the same result at 30, 60, 120 or 144 Hz. The accumulator counts in steps
 * (not seconds), which keeps 1/60 s × 600 Hz from rounding down to 9 steps. At most `maxSteps`
 * are taken per frame; a longer backlog (a stall, a hidden tab) is dropped, not replayed.
 *
 * @param {number} rate steps per second
 * @param {number} maxSteps cap per frame
 */
export function createFixedStep(rate, maxSteps) {
  return { rate, maxSteps, acc: 0 };
}

/**
 * Steps due this frame. Allocates nothing. Set `fs.acc = 0` to forget the carried fraction.
 * @param {ReturnType<typeof createFixedStep>} fs
 * @param {number} dt seconds since the previous frame
 */
export function takeSteps(fs, dt) {
  fs.acc += dt * fs.rate;
  let n = Math.floor(fs.acc + 1e-6);
  if (n >= fs.maxSteps) {
    n = fs.maxSteps;
    fs.acc = 0;
  } else {
    fs.acc = Math.max(0, fs.acc - n);
  }
  return n;
}
