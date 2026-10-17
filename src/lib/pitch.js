// @ts-check
/**
 * Pitch → Chladni figure. The strongest clear partial between 200 Hz and 2 kHz picks a mode table
 * index: higher notes, finer figures. A note must hold for 0.2 s of audio time before the figure
 * changes (an onset with a clear note changes it at once), and silence or atonal input holds the
 * last figure. All of it allocates nothing per frame.
 */

const F_LO = 200;
const F_HI = 2000;
/** A peak must be louder than this (linear magnitude, spectrum is 0–1)… */
const MIN_MAG = 0.08;
/** …and this many times the window's mean magnitude. */
const MIN_PROMINENCE = 3;
/** Seconds a new candidate must hold before the figure follows it. */
export const HOLD = 0.2;
/** Mode table size (pitch.js and modes.js agree on 32). */
const LAST_INDEX = 31;

/**
 * Peak finder over a fixed bin window, rebuilt only when the sample rate changes.
 */
export function createPitch() {
  let sr = 0;
  return {
    lo: 0,
    hi: -1,
    /** Rebuild the bin window for a new sample rate; 0 (unknown) keeps the current one. @param {number} sampleRate */
    setSampleRate(sampleRate) {
      if (!(sampleRate > 0) || sampleRate === sr) return;
      sr = sampleRate;
      this.lo = Math.ceil((F_LO * 2048) / sr);
      this.hi = Math.floor((F_HI * 2048) / sr);
    },
    /**
     * Midi note of the strongest clear partial in the window, refined by parabolic interpolation
     * of the log magnitude; NaN when there is none (silence, noise, no sample rate yet).
     * @param {Float32Array} spectrum 1024 bins, bin i ≈ i · sampleRate / 2048 Hz
     */
    midi(spectrum) {
      const lo = this.lo;
      const hi = Math.min(this.hi, spectrum.length - 2);
      if (sr === 0 || hi <= lo) return NaN;
      let best = -1;
      let peak = 0;
      let sum = 0;
      for (let i = lo; i <= hi; i++) {
        const v = spectrum[i];
        sum += v;
        if (v > peak) {
          peak = v;
          best = i;
        }
      }
      const mean = sum / (hi - lo + 1);
      if (best < 0 || peak <= MIN_MAG || peak <= MIN_PROMINENCE * mean) return NaN;
      const a = Math.log(Math.max(spectrum[best - 1], 1e-9));
      const b = Math.log(peak);
      const c = Math.log(Math.max(spectrum[best + 1], 1e-9));
      const den = a - 2 * b + c;
      const delta = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
      const hz = ((best + delta) * sr) / 2048;
      return 69 + 12 * Math.log2(hz / 440);
    },
  };
}

/**
 * Mode table index for a midi note: clamp(floor((midi − 55) · 0.72 · complexity), 0, 31).
 * @param {number} midi
 * @param {number} complexity
 */
export function candidateIndex(midi, complexity) {
  const i = Math.floor((midi - 55) * 0.72 * complexity);
  return i < 0 ? 0 : i > LAST_INDEX ? LAST_INDEX : i;
}

/**
 * Debounces candidates into the target mode. A candidate replaces the target once it has held for
 * HOLD seconds (summed dt, so frame-rate independent), or at once on an onset frame. NaN (no clear
 * note) holds the target and restarts the hold.
 * @param {number} start initial target index
 */
export function createModeGate(start) {
  let target = start;
  let candidate = -1;
  let held = 0;
  return {
    /**
     * @param {number} midi from createPitch().midi, NaN for none
     * @param {boolean} onset
     * @param {number} dt seconds
     * @param {number} complexity
     * @returns {number} the target mode index
     */
    step(midi, onset, dt, complexity) {
      if (Number.isNaN(midi)) {
        candidate = -1;
        held = 0;
        return target;
      }
      const c = candidateIndex(midi, complexity);
      if (c !== candidate) {
        candidate = c;
        held = 0;
      } else {
        held += dt;
      }
      if (onset || held >= HOLD - 1e-9) target = c;
      return target;
    },
  };
}
