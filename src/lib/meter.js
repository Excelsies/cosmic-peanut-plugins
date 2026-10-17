// @ts-check
/**
 * Beat counter on top of the host's `beatPhase` (0–1 between predicted beats). A beat is counted
 * when the phase wraps (falls by more than half a beat), unless the previous counted beat was
 * under 0.4 beat ago: tempo trackers re-anchor with small backwards wobbles, and those wraps are
 * jitter, not beats. Nothing is counted while `bpm` is 0.
 */
export function createMeter() {
  return { beats: 0, lastPhase: 0, sinceBeat: Infinity };
}

/**
 * Advance one frame. Allocates nothing.
 * @param {ReturnType<typeof createMeter>} m
 * @param {number} beatPhase
 * @param {number} bpm
 * @param {number} dt
 * @returns {boolean} true when a beat was counted this frame (`m.beats` is its 1-based count)
 */
export function meterStep(m, beatPhase, bpm, dt) {
  m.sinceBeat += dt;
  const prev = m.lastPhase;
  m.lastPhase = beatPhase;
  if (!(bpm > 0)) return false;
  if (prev - beatPhase <= 0.5) return false;
  if (m.sinceBeat < (0.4 * 60) / bpm) return false;
  m.beats++;
  m.sinceBeat = 0;
  return true;
}
