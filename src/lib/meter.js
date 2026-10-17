// @ts-check
/**
 * Beat counter from the host's tempo tracker: one beat each time `beatPhase` wraps from near 1
 * back to near 0 while `bpm` is non-zero. Bars are counted by the caller as groups of 4 beats
 * (the host gives no downbeat, so "bar" means 4 counted beats). Allocates nothing.
 */
export function createMeter() {
  let last = -1;
  const m = {
    /** Beats counted since creation. */
    beats: 0,
    /**
     * @param {number} bpm `audio.bpm` (0 = no confident tempo)
     * @param {number} beatPhase `audio.beatPhase`, 0–1
     * @returns {boolean} true when a beat landed on this step
     */
    step(bpm, beatPhase) {
      if (!(bpm > 0)) {
        last = -1;
        return false;
      }
      const wrapped = last >= 0 && beatPhase < last - 0.5;
      last = beatPhase;
      if (wrapped) m.beats++;
      return wrapped;
    },
  };
  return m;
}
