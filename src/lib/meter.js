// @ts-check
/**
 * Beat counter on top of the host's tempo tracker, shared by the Fieldwork visualizers. A beat is
 * counted when `beatPhase` (0–1 between predicted beats) wraps, i.e. falls by more than half a
 * beat, while `bpm` is non-zero. Two guards:
 *
 * - a wrap under 0.4 beat after the previous counted beat is ignored: tempo trackers re-anchor
 *   with small backwards wobbles, and those wraps are jitter, not beats;
 * - nothing is counted while `bpm` is 0, and the first phase after the tempo returns only arms
 *   the counter, so a tempo dropout never invents a beat.
 *
 * Bars are counted by the caller as groups of 4 beats (the host gives no downbeat). `step`
 * allocates nothing.
 */
export function createMeter() {
  let last = -1;
  let sinceBeat = Infinity;
  const m = {
    /** Beats counted since creation. */
    beats: 0,
    /**
     * @param {number} bpm `audio.bpm` (0 = no confident tempo)
     * @param {number} beatPhase `audio.beatPhase`, 0–1
     * @param {number} dt seconds since the previous step
     * @returns {boolean} true when a beat was counted on this step (`beats` is its 1-based count)
     */
    step(bpm, beatPhase, dt) {
      if (dt > 0) sinceBeat += dt;
      if (!(bpm > 0)) {
        last = -1;
        return false;
      }
      const prev = last;
      last = beatPhase;
      if (prev < 0 || prev - beatPhase <= 0.5) return false;
      if (sinceBeat < (0.4 * 60) / bpm) return false;
      m.beats++;
      sinceBeat = 0;
      return true;
    },
  };
  return m;
}
