// @ts-check
/**
 * Plumes of fresh film: each hit sends a mushroom of thicker (paler) film rising from the bottom
 * edge, at an x set by which part of the spectrum rose (kicks on the left, hats on the right) and
 * nudged by the stereo balance. Six slots as structure-of-arrays Float32Arrays; the oldest is
 * recycled when all are alive.
 *
 * The head's height is analytic, y = 1.02 − rise·(now − t0), with t0 the hit's own time
 * (now − onsetAge), so it stays in sync with the hit and is frame-rate independent. `update` packs
 * the live plumes into `uniforms` (vec4[6]: x, y, r, rise; zeros when dead) and `src` (film
 * emission, microns per second, during the first 0.8 s). Nothing here allocates after create.
 */
import { hash01 } from "../lib/hash.js";

export const MAX_PLUMES = 6;
/** Onsets weaker than this send no plume. */
export const MIN_STRENGTH = 0.12;
/** Seconds a plume emits fresh film after its hit. */
export const EMIT_SECONDS = 0.8;
/** Seconds a plume lives at most. */
export const MAX_AGE = 5;
/**
 * On the onset frame `onsetAge` is at most a frame or two; larger values (the harness synths
 * leave it at 10) would put the hit in the past, so they are capped here.
 */
const MAX_ONSET_AGE = 0.1;

/** Spread (full width) of the hashed x jitter, so repeated hits rise as a cluster, not one column. */
const JITTER = 0.07;
/** Half-widths (bands) of the window that finds the strongest rise, and of the centroid around it. */
const PEAK_HALF = 3;
const SPAN_HALF = 8;

/**
 * Where in the spectrum a hit landed, 0 (lowest band) – 1 (highest): the centroid of the band
 * rises around the strongest group of rising bands, so a kick that coincides with hats still
 * counts as a kick (a plain centroid would put every mixed hit in the middle).
 * @param {Float32Array} rise positive band deltas, length 64
 */
function dominantCentroid(rise) {
  let best = 0;
  let bestSum = -1;
  for (let k = 0; k < 64; k++) {
    let s = 0;
    for (let i = Math.max(0, k - PEAK_HALF); i <= Math.min(63, k + PEAK_HALF); i++) s += rise[i];
    if (s > bestSum) {
      bestSum = s;
      best = k;
    }
  }
  let sum = 0;
  let moment = 0;
  for (let i = Math.max(0, best - SPAN_HALF); i <= Math.min(63, best + SPAN_HALF); i++) {
    sum += rise[i];
    moment += i * rise[i];
  }
  return moment / sum / 63;
}

export function createPlumes() {
  const x = new Float32Array(MAX_PLUMES);
  const t0 = new Float64Array(MAX_PLUMES);
  const strength = new Float32Array(MAX_PLUMES);
  const alive = new Uint8Array(MAX_PLUMES);
  const prev = new Float32Array(64);
  const delta = new Float32Array(64);
  const uniforms = new Float32Array(MAX_PLUMES * 4);
  const src = new Float32Array(MAX_PLUMES);
  let onsets = 0;

  return {
    x,
    t0,
    strength,
    alive,
    uniforms,
    src,

    /**
     * Call every frame (it tracks the band deltas). Returns the slot of a new plume, or −1.
     * @param {{ onset: boolean, onsetStrength: number, onsetAge: number, bands: Float32Array, silent: boolean }} audio
     * @param {number} now `time.now`
     * @param {number} balance smoothed stereo balance, +1 = left louder
     */
    step(audio, now, balance) {
      const bands = audio.bands;
      const n = Math.min(64, bands.length);
      let sum = 0;
      for (let i = 0; i < 64; i++) {
        const d = i < n ? bands[i] - prev[i] : 0;
        delta[i] = d > 0 ? d : 0;
        sum += delta[i];
      }
      if (bands.length === 64) prev.set(bands);
      if (!audio.onset || audio.silent || !(audio.onsetStrength > MIN_STRENGTH)) return -1;
      onsets++;
      const c = sum < 1e-6 ? 0.5 + 0.3 * (hash01(onsets) - 0.5) : dominantCentroid(delta);
      let slot = 0;
      for (let i = 0; i < MAX_PLUMES; i++) {
        if (!alive[i]) {
          slot = i;
          break;
        }
        if (t0[i] < t0[slot]) slot = i;
      }
      const jitter = JITTER * (hash01(onsets + 0x51f7) - 0.5);
      x[slot] = Math.min(0.95, Math.max(0.05, 0.08 + 0.84 * c + jitter - 0.15 * balance));
      t0[slot] = now - Math.min(MAX_ONSET_AGE, Math.max(0, audio.onsetAge));
      strength[slot] = Math.min(1, Math.max(0.15, audio.onsetStrength));
      alive[slot] = 1;
      return slot;
    },

    /**
     * Move the heads, retire finished plumes and pack the uniforms.
     * @param {number} now @param {number} vb black front @param {number} riseEff rise speed multiplier
     * @param {number} reactivity film emission multiplier
     */
    update(now, vb, riseEff, reactivity) {
      for (let i = 0; i < MAX_PLUMES; i++) {
        const o = i * 4;
        if (alive[i]) {
          const s = strength[i];
          const age = now - t0[i];
          const rise = 0.22 * (0.6 + 0.4 * s) * riseEff;
          const y = 1.02 - rise * age;
          if (y < vb - 0.05 || age > MAX_AGE) alive[i] = 0;
          else {
            uniforms[o] = x[i];
            uniforms[o + 1] = y;
            uniforms[o + 2] = 0.035 + 0.045 * s;
            uniforms[o + 3] = rise;
            src[i] = age < EMIT_SECONDS ? 0.5 * s * reactivity : 0;
            continue;
          }
        }
        uniforms[o] = 0;
        uniforms[o + 1] = 0;
        uniforms[o + 2] = 0;
        uniforms[o + 3] = 0;
        src[i] = 0;
      }
    },

    /** Forget every plume. */
    reset() {
      alive.fill(0);
      prev.fill(0);
    },
  };
}
