// @ts-check
/**
 * Miura's audio drive, pure: how the bass folds the sheet, how mids swell it and hats rustle it,
 * and when the light swings round. Everything is exponential or analytic in time, so it is the
 * same at 60 and 120 Hz, and nothing allocates after the create calls.
 */
import { createFlashLimiter } from "../../lib/flash.js";
import { hash01 } from "../../lib/hash.js";
import { createBeatClock } from "../../lib/beatclock.js";

/**
 * One step of an exponential follower with time constant `tau` (s), frame-rate independent.
 * @param {number} current @param {number} target @param {number} dt @param {number} tau
 */
export const ease = (current, target, dt, tau) => current + (target - current) * (1 - Math.exp(-dt / tau));

const ATTACK = 0.12;
const RELEASE = 0.6;
const SILENT_RELEASE = 1.5;

/**
 * The global fold angle t0. Bass folds the pleats deeper: target (0.35 + 0.55 b reactivity) fold,
 * b = clamp(bassAtt - 1, 0, 1.2) / 1.2, followed with a 120 ms attack and a 0.6 s release. A
 * deeper fold darkens the whole window, so the excursion above the rest fold goes through the
 * flash limiter (at most 3 new rises a second while reduceFlashing). Silence relaxes the sheet
 * to 0.3 fold over 1.5 s.
 */
export function createFold() {
  const flash = createFlashLimiter();
  let smooth = -1;
  return {
    /**
     * @param {number} bassAtt @param {boolean} silent
     * @param {number} fold the 'fold' param @param {number} reactivity
     * @param {number} dt @param {boolean} reduceFlashing
     * @returns {number} t0
     */
    step(bassAtt, silent, fold, reactivity, dt, reduceFlashing) {
      const base = 0.35 * fold;
      const b = Math.min(1.2, Math.max(0, bassAtt - 1)) / 1.2;
      const target = silent ? 0.3 * fold : (0.35 + 0.55 * b * reactivity) * fold;
      if (smooth < 0) smooth = base;
      const tau = target > smooth ? ATTACK : silent ? SILENT_RELEASE : RELEASE;
      smooth = ease(smooth, target, dt, tau);
      return base + flash.step(smooth - base, dt, reduceFlashing);
    },
  };
}

/** Swell amplitude (rad) from the smoothed mids. @param {number} midAttS */
export const swellAmp = (midAttS) => 0.12 * Math.min(1, Math.max(0, midAttS - 0.5));

const TAU = 2 * Math.PI;

/**
 * The swell's shape at a sheet point (mesh units) and time: a slow travelling wave plus its
 * octave at half amplitude, in -1.5..1.5.
 * @param {number} x @param {number} y @param {number} t
 */
export function swellWave(x, y, t) {
  const ph = TAU * (0.15 * x + 0.1 * y - 0.08 * t);
  return Math.sin(ph) + 0.5 * Math.sin(2 * ph);
}

/** Rustle amplitude (rad) from the hats. @param {number} trebAtt */
export const rustleAmp = (trebAtt) => (0.03 * Math.min(2, Math.max(0, trebAtt - 1))) / 2;

/**
 * The rustle's random pattern changes 12 times a second, 3 under reduce flashing.
 * @param {number} now @param {boolean} reduceFlashing
 */
export const rustleBucket = (now, reduceFlashing) => Math.floor(now * (reduceFlashing ? 3 : 12));

/** Per-vertex rustle, -0.5..0.5. @param {number} vertex @param {number} bucket */
export const rustleNoise = (vertex, bucket) => hash01((vertex + Math.imul(bucket, 0x9e3779b1)) | 0) - 0.5;

/** The light's first heading (degrees, upper left). */
export const START_HEADING = 135;
const TURN_SECONDS = 4;

/** Heading of the k-th light change, degrees (k >= 1). @param {number} k */
export const headingFor = (k) => 70 + 130 * hash01(k);

/**
 * The light's heading. Every `barsPerTurn` bars (4 beats each, from the tempo tracker; 2 s per
 * bar while the tempo is unknown) it eases to the next heading of a fixed sequence over 4 s.
 */
export function createSweep() {
  const meter = createBeatClock();
  let lastBeats = 0;
  let phrase = 0;
  let turn = 0;
  let from = START_HEADING;
  let to = START_HEADING;
  let easeT = TURN_SECONDS;
  const s = {
    az: START_HEADING,
    /**
     * @param {number} bpm @param {number} beatPhase @param {number} dt
     * @param {number} barsPerTurn 8, or 16 under reduce motion
     * @returns {number} heading in degrees
     */
    step(bpm, beatPhase, dt, barsPerTurn) {
      const beats = meter.step(bpm, beatPhase, dt);
      const d = beats - lastBeats;
      lastBeats = beats;
      phrase += bpm > 0 ? d / (4 * barsPerTurn) : dt / (2 * barsPerTurn);
      const k = Math.floor(phrase);
      if (k > turn) {
        turn = k;
        from = s.az;
        to = headingFor(k);
        easeT = 0;
      }
      if (easeT < TURN_SECONDS) {
        easeT = Math.min(TURN_SECONDS, easeT + dt);
        const u = easeT / TURN_SECONDS;
        s.az = from + (to - from) * u * u * (3 - 2 * u);
      }
      return s.az;
    },
  };
  return s;
}
