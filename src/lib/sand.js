// @ts-check
/**
 * Chladni sand: the constants the grain shader runs on (chladni.js uploads them) and the CPU side
 * of the audio mapping. Allocates nothing per frame.
 *
 * Grain state is 6 floats (24 bytes) interleaved: a = (x, y, vx, vy), b = (z, vz). Positions are
 * plate coordinates 0–1; velocities are physical (plate height = 1), so the shader scales x by
 * the aspect. Grounded grains (z ≤ 0) feel, per 1/120 s step:
 *
 *   v += (−K_DRIFT·drive·∇(u²) + tilt·G_TILT)·dt + ξ·(K_SHAKE·drive·(|u| + U_FLOOR) + K_FIZZ·fizz)·√dt
 *   v *= exp(−DAMPING·dt);  x += v·dt
 *
 * where u is the standing-wave field and ξ a hashed unit-variance direction. ∇(u²) pulls sand
 * down into the node lines (u = 0); the shake is strongest on antinodes, so grains there jitter
 * off them, and vanishes on the nodes, so lines stay crisp. A beat hit (lib/hits.js) of weight w
 * launches F_MIN + (1 − F_MIN)·w of the grounded grains with vz0 = GRAVITY·0.075·hop·(0.4 + 0.6·w)
 * (a 0.15 s flight at full weight) and a hashed lateral scatter; airborne grains fly ballistically
 * with only AIR_DRAG and land with z = 0.
 * Edges reflect with RESTITUTION.
 */
import { createFlashLimiter } from "./flash.js";
import { WEIGHT_WIN } from "./hits.js";

export const GRAIN_FLOATS = 6;
export const SIM_STEP = 1 / 120;
export const MAX_STEPS = 4;
export const K_DRIFT = 0.15;
export const K_SHAKE = 0.6;
export const K_FIZZ = 0.05;
/**
 * Grain size, as a floor on |u| in the shake term: without it the shake vanishes exactly on the
 * nodes and a line collapses to sub-pixel width; with it lines settle a few pixels wide, enough
 * for the relief lighting to read.
 */
export const U_FLOOR = 0.12;
export const G_TILT = 0.25;
export const DAMPING = 8;
export const AIR_DRAG = 2;
export const RESTITUTION = 0.3;
/** Plate units / s² for the hop's z axis (only the flight time and the dust's offset depend on it). */
export const GRAVITY = 4;
/** Drive's time constant once the source is silent: down to ~2% in 0.3 s. */
const SILENT_TAU = 0.075;
/** The hop's dust haze decays with this time constant (s). */
const HAZE_TAU = 0.15;
/** Share of the grounded grains a hop of weight 0 launches (all of them at weight 1). */
export const F_MIN = 0.3;
/** Lateral scatter speed at weight 1 and Hop 1 (it grows with weight²). */
export const SCATTER = 0.12;
/** Hits heavier than this carry a haze; a bright hit the flash limiter refuses hops at this weight. */
export const W_HAZE = 0.7;
/** Haze at weight 1. */
export const HAZE_PEAK = 0.25;
/** Drive pulse per hit: up by K_PULSE·(PULSE_BASE + (1 − PULSE_BASE)·weight), decaying with τ PULSE_TAU s. */
export const K_PULSE = 1;
export const PULSE_TAU = 0.12;
export const PULSE_BASE = 0.4;
/** The pulsed drive stays at or under DRIVE_PEAK·reactivity. */
export const DRIVE_PEAK = 3;

/** @param {unknown} v @param {number} fallback */
const num = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Launch speed for a hop. @param {number} hop the Hop param (already reduced for reduce motion)
 * @param {number} weight the hit's weight, clamped to 0–1
 */
export function hopVz0(hop, weight) {
  const w = weight > 1 ? 1 : weight > 0 ? weight : 0;
  return hop > 0 ? GRAVITY * 0.075 * hop * (0.4 + 0.6 * w) : 0;
}

/** Seconds from launch to landing. @param {number} vz0 */
export function flightTime(vz0) {
  return (2 * vz0) / GRAVITY;
}

/**
 * Hit → hop. Every hit (lib/hits.js) launches F_MIN + (1 − F_MIN)·w of the grounded grains at
 * hopVz0(hop, w) with lateral scatter SCATTER·hop·w²; a grow re-sends the bigger hop under the
 * same `seq`, so the shader launches only the extra grains. Hits over W_HAZE also raise the dust
 * haze to HAZE_PEAK·(w − W_HAZE)/(1 − W_HAZE), held through the weight window and then decaying
 * with τ HAZE_TAU, through the photosensitivity limiter (at most 3 rises per second under reduce
 * flashing). A bright hit the limiter refuses still hops, at weight W_HAZE and with no haze rise.
 * `step` returns the same object every call: `impulse` (vz0, non-zero only on hop frames),
 * `scatter`, `fraction`, `seq` (hop counter, seeds the launch hash) and `haze` (0–1).
 */
export function createHop() {
  const limiter = createFlashLimiter();
  let env = 0;
  let hold = 0;
  let since = Infinity;
  const out = { impulse: 0, scatter: 0, fraction: 0, seq: 0, haze: 0 };
  return {
    /**
     * @param {{ fire: boolean, grow: boolean, weight: number }} hit createHits().out
     * @param {number} hop effective Hop param
     * @param {number} dt
     * @param {boolean} reduceFlashing
     */
    step(hit, hop, dt, reduceFlashing) {
      const d = dt > 0 ? dt : 0; // NaN too
      since += d;
      const on = hop > 0 && (hit.fire === true || hit.grow === true);
      let w = clamp(num(hit.weight, 0), 0, 1);
      if (on && hit.fire === true) {
        out.seq++;
        since = 0;
        hold = 0;
      }
      const hazeT = on && w > W_HAZE ? (HAZE_PEAK * (w - W_HAZE)) / (1 - W_HAZE) : 0;
      if (since > WEIGHT_WIN + 1e-9) hold = 0;
      if (hazeT > hold) hold = hazeT;
      // Held through the window, so a grow continues the same rise instead of starting a new one.
      env = limiter.step(Math.max(hold, env * Math.exp(-d / HAZE_TAU)), d, reduceFlashing);
      if (hazeT > 0 && env < hazeT - 1e-12) {
        w = W_HAZE; // refused: hop anyway, as a hit that carries no haze
        hold = 0;
      }
      out.impulse = on ? hopVz0(hop, w) : 0;
      out.fraction = on ? F_MIN + (1 - F_MIN) * w : 0;
      out.scatter = on ? SCATTER * hop * w * w : 0;
      out.haze = hop > 0 ? env : 0;
      return out;
    },
  };
}

/**
 * Smoothed plate excitation from one audio frame. `step` returns the same object every call:
 * - drive: base·(1 + K_PULSE·pulseGain·pulse), at most DRIVE_PEAK·reactivity, where base =
 *   silent ? 0 : clamp(0.5·min(midAtt, 2) + 4·rms, 0, 2.5)·reactivity, τ 0.1 s (pull toward the
 *   nodes and shake on the antinodes); on silence τ 0.075 s, so the sand damps and freezes
 *   within 0.3 s;
 * - pulse: on a hit, max(pulse, PULSE_BASE + (1 − PULSE_BASE)·weight), else decaying with
 *   τ PULSE_TAU; 0 on silence (the plate shakes harder on each hit, without any brightness);
 * - fizz: clamp(trebAtt − 1, 0, 2)·0.5 + flux·0.5, unsmoothed (hats: per-grain jitter);
 * - tiltX: 0.6·balance·reactivity, τ 0.5 s (sand leans toward the louder channel; exactly 0 for
 *   mono and L = R sources);
 * - tiltY: 0.15·clamp(bassAtt − 1, −1, 1) when bass tilt is on, τ 0.3 s.
 */
export function createPlateDrive() {
  const out = { drive: 0, fizz: 0, tiltX: 0, tiltY: 0, pulse: 0 };
  let base = 0;
  return {
    /**
     * @param {{ midAtt: any, rms: any, silent: any, trebAtt: any, flux: any, bassAtt: any }} audio
     * @param {number} balance stereo balance −1…1, +1 = left heavy (0 for mono)
     * @param {number} reactivity effective Reactivity
     * @param {boolean} bassTilt false under reduce motion
     * @param {number} pulseGain 0 under reduce motion's calm rule, else 1
     * @param {{ fire: boolean, grow: boolean, weight: number }} hit createHits().out
     * @param {number} dt
     */
    step(audio, balance, reactivity, bassTilt, pulseGain, hit, dt) {
      const silent = audio.silent === true;
      const d = dt > 0 ? dt : 0;
      const target = silent ? 0 : clamp(0.5 * Math.min(num(audio.midAtt, 1), 2) + 4 * num(audio.rms, 0), 0, 2.5) * reactivity;
      base += (target - base) * (1 - Math.exp(-d / (silent ? SILENT_TAU : 0.1)));
      if (silent) out.pulse = 0;
      else {
        out.pulse *= Math.exp(-d / PULSE_TAU);
        if (hit.fire === true || hit.grow === true) {
          const p = PULSE_BASE + (1 - PULSE_BASE) * clamp(num(hit.weight, 0), 0, 1);
          if (p > out.pulse) out.pulse = p;
        }
      }
      out.drive = Math.min(base * (1 + K_PULSE * pulseGain * out.pulse), DRIVE_PEAK * reactivity);
      out.fizz = silent ? 0 : clamp(num(audio.trebAtt, 1) - 1, 0, 2) * 0.5 + clamp(num(audio.flux, 0), 0, 2) * 0.5;
      const tx = 0.6 * balance * reactivity;
      out.tiltX += (tx - out.tiltX) * (1 - Math.exp(-d / 0.5));
      const ty = bassTilt ? 0.15 * clamp(num(audio.bassAtt, 1) - 1, -1, 1) : 0;
      out.tiltY += (ty - out.tiltY) * (1 - Math.exp(-d / 0.3));
      return out;
    },
  };
}

/**
 * Fill `out` with `n` grains at hash-uniform positions, at rest (deterministic: the same plate
 * every time). Call on create and when Grains changes. @param {Float32Array} out @param {number} n
 */
export function seedGrains(out, n) {
  for (let i = 0; i < n; i++) {
    const o = i * GRAIN_FLOATS;
    out[o] = 0.002 + 0.996 * (pcg(2 * i + 1) / 4294967296);
    out[o + 1] = 0.002 + 0.996 * (pcg(2 * i + 2) / 4294967296);
    out[o + 2] = 0;
    out[o + 3] = 0;
    out[o + 4] = 0;
    out[o + 5] = 0;
  }
  return out;
}

/** PCG-RXS-M-XS 32-bit hash (same as the shader's). @param {number} v */
function pcg(v) {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}
