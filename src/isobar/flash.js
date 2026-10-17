// @ts-check
/**
 * Photosensitivity guard for full-screen brightness.
 *
 * A flash is a rise in brightness followed by a fall. The limiter lets its output fall freely but
 * only lets a *new* rise start once every `1 / maxPerSecond` seconds; a rise already underway
 * continues. So a 10 Hz strobe becomes at most 3 flashes per second, an isolated beat flash passes
 * through with no latency, and slow swells are untouched.
 *
 * Feed it the brightness (or flash envelope) you would have drawn, once per frame:
 *
 *   const flash = createFlashLimiter();
 *   // in frame():
 *   const b = flash.step(targetBrightness, time.dt, ctx.reduceFlashing);
 *
 * `step` allocates nothing.
 *
 * @param {number} [maxPerSecond=3]
 */
export function createFlashLimiter(maxPerSecond = 3) {
  const minInterval = 1 / maxPerSecond;
  let value = 0;
  let rising = false;
  let sinceRise = Infinity;

  return {
    /**
     * @param {number} target brightness you want to show
     * @param {number} dt seconds since the previous step
     * @param {boolean} enabled usually `ctx.reduceFlashing`; when false the target passes through
     * @returns {number} brightness to draw
     */
    step(target, dt, enabled) {
      sinceRise += dt;
      if (!enabled) {
        rising = false;
        value = target;
        return value;
      }
      if (target > value) {
        if (!rising && sinceRise >= minInterval) {
          rising = true;
          sinceRise = 0;
        }
        if (rising) value = target;
      } else if (target < value) {
        rising = false;
        value = target;
      }
      return value;
    },

    /** Forget the history (e.g. after a visualizer reload). */
    reset() {
      value = 0;
      rising = false;
      sinceRise = Infinity;
    },
  };
}
