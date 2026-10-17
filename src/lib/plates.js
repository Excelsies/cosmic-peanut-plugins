// @ts-check
/**
 * The three printing plates of Misregister as 2D damped springs pulling each plate's offset (in
 * device px) back to register. A kick throws the plates apart: each gets a velocity along its
 * own direction (90° + 120°·i plus a hashed ±30°), sized so its first swing peaks at the kick's
 * magnitude. Advanced by the exact solution of the spring over a fixed 1/120 s step (frame-rate
 * independent: identical state at 60 and 120 Hz). Allocates nothing after creation.
 */
import { createFixedStep } from "./fixedstep.js";
import { hash01 } from "./hash.js";

export const PLATE_OMEGA = 2 * Math.PI * 3;
export const PLATE_ZETA = 0.35;
export const PLATE_STEP = 1 / 120;
export const PLATE_MAX_STEPS = 8;

/**
 * Peak displacement of an underdamped spring released from rest position with velocity v0 is
 * v0/ω · PEAK (analytic, first maximum of e^(−ζωt)·sin(ω_d t)/√(1−ζ²)).
 */
const WD = Math.sqrt(1 - PLATE_ZETA * PLATE_ZETA);
const T_PEAK = Math.atan(WD / PLATE_ZETA);
const PEAK = Math.exp((-PLATE_ZETA * T_PEAK) / WD) * Math.sin(T_PEAK) / WD;

/**
 * How far a kick throws the plates, device px: misregister × (8 + 12 × onset strength) ×
 * (0.6 + 0.4 × bass above average) CSS px, so a typical kick at the default 0.5 is 4–8 px and the
 * hardest at full misregister 20 px.
 * @param {number} misregister param 0–1
 * @param {number} onsetStrength `audio.onsetStrength`
 * @param {number} bassAtt `audio.bassAtt` (1 = average)
 * @param {number} pxScale device px per CSS px
 */
export function joltMagnitude(misregister, onsetStrength, bassAtt, pxScale) {
  const s = Math.min(1, Math.max(0, onsetStrength));
  const b = Math.min(1, Math.max(0, bassAtt - 1));
  return misregister * (8 + 12 * s) * (0.6 + 0.4 * b) * pxScale;
}

/**
 * Direction plate `i` is thrown on the `onsetCount`-th kick, radians.
 * @param {number} i plate 0–2
 * @param {number} onsetCount
 */
export function joltAngle(i, onsetCount) {
  const jitter = (hash01(onsetCount * 3 + i) * 2 - 1) * 30;
  return ((90 + 120 * i + jitter) * Math.PI) / 180;
}

export function createPlates() {
  /** x, y per plate, device px. */
  const offset = new Float32Array(6);
  const vel = new Float32Array(6);
  const clock = createFixedStep(PLATE_STEP, PLATE_MAX_STEPS);
  // Exact one-step transition [x, v] → [x', v'] of x'' = −ω²x − 2ζωx' over PLATE_STEP.
  const wd = PLATE_OMEGA * WD;
  const e = Math.exp(-PLATE_ZETA * PLATE_OMEGA * PLATE_STEP);
  const cs = Math.cos(wd * PLATE_STEP);
  const sn = Math.sin(wd * PLATE_STEP);
  const zr = (PLATE_ZETA * PLATE_OMEGA) / wd;
  const xx = e * (cs + zr * sn);
  const xv = (e * sn) / wd;
  const vx = (-e * PLATE_OMEGA * PLATE_OMEGA * sn) / wd;
  const vv = e * (cs - zr * sn);

  return {
    offset,
    /**
     * @param {number} magnitude device px (see {@link joltMagnitude})
     * @param {number} onsetCount picks the jitter
     */
    kick(magnitude, onsetCount) {
      if (!(magnitude > 0)) return;
      const v0 = (magnitude * PLATE_OMEGA) / PEAK;
      for (let i = 0; i < 3; i++) {
        const a = joltAngle(i, onsetCount);
        vel[i * 2] += Math.cos(a) * v0;
        vel[i * 2 + 1] += Math.sin(a) * v0;
      }
    },
    /** @param {number} dt seconds since the previous frame */
    step(dt) {
      const n = clock.advance(dt);
      for (let s = 0; s < n; s++) {
        for (let j = 0; j < 6; j++) {
          const x = offset[j];
          const v = vel[j];
          offset[j] = xx * x + xv * v;
          vel[j] = vx * x + vv * v;
        }
      }
    },
    reset() {
      offset.fill(0);
      vel.fill(0);
      clock.reset();
    },
  };
}
