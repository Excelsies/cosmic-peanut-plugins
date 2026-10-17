// @ts-check
/**
 * Agitation waves: a dark band of birds rolled to show their full wing area, travelling outward
 * from a point at constant speed. The radius depends only on audio time since the onset
 * (T0 = time.now − audio.onsetAge), so it is identical at any display rate and for onsets that
 * were carried forward to a later frame.
 */

/** Shell speed, world units per second. */
export const WAVE_SPEED = 1.6;
/** Shell width, world units. */
export const SHELL = 0.12;

/** Longest believable age of an onset seen this frame (a carried-forward onset is a few frames old). */
export const MAX_ONSET_AGE = 1;

/**
 * Audio-accurate onset time. A missing, negative, non-finite or implausibly old onsetAge (10 is
 * the contract's "no onset yet") counts as "now".
 * @param {number} now time.now @param {number} onsetAge audio.onsetAge
 */
export function onsetTime(now, onsetAge) {
  if (!(onsetAge > 0) || onsetAge >= MAX_ONSET_AGE) return now;
  return now - onsetAge;
}

/** @param {number} now @param {number} t0 */
export function waveRadius(now, t0) {
  const r = WAVE_SPEED * (now - t0);
  return r > 0 ? r : 0;
}

/** Whether a bird at distance `d` from the origin is in the shell [r − w, r]. @param {number} d @param {number} r @param {number} w */
export function inShell(d, r, w) {
  return d >= r - w && d <= r;
}

/**
 * @typedef {object} WaveSlot
 * @property {boolean} active
 * @property {number} id increments on each start (lets each bird be kicked once per wave)
 * @property {number} ox
 * @property {number} oy
 * @property {number} t0
 * @property {number} amp 0–1 strength
 * @property {number} radius current radius after `update`
 */

/**
 * Two wave slots: 0 for falcon strikes, 1 for weaker onset waves. Starting a slot replaces its
 * wave. Allocates nothing after creation.
 */
export function createWaves() {
  /** @type {WaveSlot[]} */
  const slots = [];
  for (let i = 0; i < 2; i++) slots.push({ active: false, id: 0, ox: 0, oy: 0, t0: 0, amp: 0, radius: 0 });
  return {
    slots,
    /**
     * @param {number} slot @param {number} ox @param {number} oy @param {number} t0 @param {number} amp
     */
    start(slot, ox, oy, t0, amp) {
      const s = slots[slot];
      s.active = true;
      s.id++;
      s.ox = ox;
      s.oy = oy;
      s.t0 = t0;
      s.amp = amp;
      s.radius = 0;
    },
    /**
     * Advance radii; a wave ends once its radius is past `maxRadius`.
     * @param {number} now @param {number} maxRadius
     */
    update(now, maxRadius) {
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (!s.active) continue;
        s.radius = waveRadius(now, s.t0);
        if (s.radius > maxRadius) s.active = false;
      }
    },
    reset() {
      for (let i = 0; i < slots.length; i++) slots[i].active = false;
    },
  };
}
