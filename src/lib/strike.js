// @ts-check
/**
 * Musical events for Murmuration: falcon strikes (strong onsets, rate-limited), the falcon's
 * dive line, and the bass "squeeze" envelope. Pure or allocation-free after creation.
 */
import { createFlashLimiter } from "./flash.js";

export const STRIKE_COOLDOWN = 1.2;
export const STRIKE_THRESHOLD = 0.3;
/** Seconds the falcon is on screen. */
export const FALCON_DURATION = 0.6;
/** Seconds after the onset at which the falcon passes the strike point. */
const FALCON_HIT = 0.15;
/** Longest approach before the strike point (world units). */
const FALCON_APPROACH = 1.2;
export const NONE = 0;
export const WEAK = 1;
export const STRIKE = 2;

/** Decides, per onset, between a falcon strike and a weaker agitation wave. */
export function createStriker() {
  let last = -Infinity;
  let count = 0;
  return {
    /**
     * @param {boolean} onset audio.onset
     * @param {number} strength audio.onsetStrength
     * @param {number} now time.now
     * @param {boolean} falconOn the falcon param
     * @returns {number} NONE, WEAK or STRIKE
     */
    step(onset, strength, now, falconOn) {
      if (!onset) return NONE;
      if (falconOn && strength > STRIKE_THRESHOLD && now - last >= STRIKE_COOLDOWN) {
        last = now;
        count++;
        return STRIKE;
      }
      return WEAK;
    },
    /** Strikes so far (seeds the geometry hash). */
    get count() {
      return count;
    },
  };
}

/** Integer hash → [0, 1). @param {number} k @param {number} salt */
export function hash01(k, salt) {
  let h = (Math.imul(k | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/**
 * Where strike `k` happens: S = flock centre + a hashed offset (≤ 0.3 per axis), entered from a
 * hashed frame edge E (0.2 outside the frame).
 * @param {number} k strike index
 * @param {number} cx flock centre x @param {number} cy flock centre y
 * @param {number} hx @param {number} hy frustum half-extents at z = 0
 * @param {Float64Array} out [Sx, Sy, Ex, Ey]
 */
export function strikeGeometry(k, cx, cy, hx, hy, out) {
  out[0] = cx + (hash01(k, 1) * 2 - 1) * 0.3;
  out[1] = cy + (hash01(k, 2) * 2 - 1) * 0.3;
  const edge = Math.floor(hash01(k, 3) * 4);
  const along = hash01(k, 4) * 2 - 1;
  const ex = hx + 0.2;
  const ey = hy + 0.2;
  if (edge === 0) {
    out[2] = -ex;
    out[3] = along * hy;
  } else if (edge === 1) {
    out[2] = ex;
    out[3] = along * hy;
  } else if (edge === 2) {
    out[2] = along * hx;
    out[3] = ey; // from above: a stoop
  } else {
    out[2] = along * hx;
    out[3] = -ey; // up out of the reeds
  }
}

/**
 * The falcon's position `t` seconds after the onset: a straight line from the edge side through
 * S, passing S at 0.15 s at constant speed (approach ≤ 1.2 units, so it is a visible dart).
 * @param {number} t seconds since the onset
 * @param {Float64Array} g [Sx, Sy, Ex, Ey] from strikeGeometry
 * @param {Float64Array | Float32Array} out [x, y]
 */
export function falconPosition(t, g, out) {
  let dx = g[0] - g[2];
  let dy = g[1] - g[3];
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const v = Math.min(len, FALCON_APPROACH) / FALCON_HIT;
  out[0] = g[0] + dx * v * (t - FALCON_HIT);
  out[1] = g[1] + dy * v * (t - FALCON_HIT);
}

/**
 * Bass squeeze envelope: target clamp((bass − 1) / 1.5, 0, 1) × gain (bass in the 1.0 = recent
 * average scale of audio.bass/bassAtt), attack 40 ms, release
 * 300 ms, then the photosensitivity limiter (a dense dark flock on a light sky changes the mean
 * luminance).
 */
export function createSqueeze() {
  const flash = createFlashLimiter();
  let env = 0;
  return {
    /**
     * @param {number} bassAtt bass level, 1.0 = recent average @param {number} gain reactivity × level gate, 0–1+
     * @param {number} dt @param {boolean} reduceFlashing
     */
    step(bassAtt, gain, dt, reduceFlashing) {
      let target = (bassAtt - 1) / 1.5;
      target = (target < 0 || !(target === target) ? 0 : target > 1 ? 1 : target) * gain;
      if (target > 1) target = 1;
      const tau = target > env ? 0.04 : 0.3;
      if (dt > 0) env += (target - env) * (1 - Math.exp(-dt / tau));
      if (env < 1e-6) env = 0;
      return flash.step(env, dt, reduceFlashing);
    },
  };
}
