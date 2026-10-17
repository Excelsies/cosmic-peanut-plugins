// @ts-check
/**
 * A continuous musical clock in beats. While the tempo is known (`bpm > 0`) it counts
 * `beatPhase` wraps, so whole numbers land on the predicted beats; while it isn't, it runs free at
 * 1 beat/s. It never runs backwards (small backwards jitter in `beatPhase` counts as no motion)
 * and stays continuous when the tempo appears or drops out. `step` allocates nothing.
 */
export function createBeatClock() {
  let beats = 0;
  let lastPhase = -1;
  return {
    /**
     * @param {number} bpm 0 while unknown
     * @param {number} beatPhase 0..1 between predicted beats
     * @param {number} dt seconds since the previous step
     * @returns {number} beats elapsed
     */
    step(bpm, beatPhase, dt) {
      if (bpm > 0 && beatPhase >= 0 && beatPhase <= 1) {
        if (lastPhase >= 0) {
          let d = beatPhase - lastPhase;
          if (d < -0.5) d += 1; // wrapped past a beat
          if (d > 0) {
            beats += d;
            lastPhase = beatPhase;
          } else if (d < -0.25) {
            lastPhase = beatPhase; // a re-sync jump backwards: follow it without moving
          }
        } else {
          lastPhase = beatPhase;
        }
      } else {
        lastPhase = -1;
        if (dt > 0) beats += dt;
      }
      return beats;
    },
    /** Beats elapsed so far. */
    get beats() {
      return beats;
    },
  };
}
