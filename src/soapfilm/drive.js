// @ts-check
/**
 * Audio → film drive: the smoothed numbers the passes read each frame. All smoothing is
 * exponential with `1 − exp(−dt/τ)`, so it is frame-rate independent. Allocates nothing; the
 * returned object's fields are updated in place.
 *
 * - bassAtt → membrane amount `bassAmt` (attack 50 ms, release 400 ms), through the flash limiter.
 * - midAtt → `m`, blending the membrane from mode (1,1) to (1,2).
 * - rms (0.5 s against 20 s) and flux → `swirlAmp`: laminar when quiet, eddies when loud.
 * - trebAtt → `shimmerAmp` (nm) with `shimmerPhase` moving at 6 Hz, at most 3 Hz under Reduce
 *   flashing.
 * - centroid → `angle` of incidence, 5–45 degrees (hue shifts like tilting a real film).
 * - left/right → `tilt` of the bands, ±4 degrees toward the louder side; exactly 0 for mono.
 * Silence: membrane and shimmer fall to 0, swirl to its floor; the centroid angle holds.
 */
import { createFlashLimiter } from "./flash.js";
import { stereoImage } from "./stereo.js";

const TILT_MAX = (4 * Math.PI) / 180;
const PHASE_WRAP = 4096;

/** @param {number} dt @param {number} tau */
const k = (dt, tau) => 1 - Math.exp(-dt / tau);

export function createDrive() {
  const flash = createFlashLimiter();
  let bassEnv = 0;
  let midAttS = 0;
  let rmsFast = 0;
  let rmsSlow = 0;
  let rmsInit = false;
  let fluxS = 0;
  let trebAttS = 0;
  let centroidS = 0;
  let centroidInit = false;
  let balanceS = 0;
  const d = {
    bassAmt: 0,
    m: 0,
    swirlAmp: 0.01,
    shimmerAmp: 0,
    shimmerPhase: 0,
    angle: 5,
    tilt: 0,
    /** Smoothed stereo balance, +1 = left louder (plumes.js reads it). */
    balance: 0,

    /**
     * @param {{ bassAtt: number, midAtt: number, trebAtt: number, rms: number, flux: number, centroid: number, silent: boolean, left: Float32Array | null, right: Float32Array | null }} a
     * @param {number} dt seconds
     * @param {{ reactivity: number, swirlEff: number, tilt: boolean }} p resolved params
     * @param {boolean} reduceFlashing
     */
    step(a, dt, p, reduceFlashing) {
      const silent = a.silent;
      const bassT = silent ? 0 : Math.min(1.5, Math.max(0, a.bassAtt - 1)) / 1.5;
      bassEnv += (bassT - bassEnv) * k(dt, bassT > bassEnv ? 0.05 : 0.4);
      d.bassAmt = flash.step(0.12 * p.reactivity * bassEnv, dt, reduceFlashing);

      midAttS += ((silent ? 0 : a.midAtt) - midAttS) * k(dt, 0.3);
      d.m = Math.min(1, Math.max(0, midAttS - 0.5));

      if (!silent && !rmsInit && a.rms > 0) {
        rmsFast = rmsSlow = a.rms;
        rmsInit = true;
      }
      rmsFast += ((silent ? 0 : a.rms) - rmsFast) * k(dt, 0.5);
      if (!silent) rmsSlow += (a.rms - rmsSlow) * k(dt, 20);
      const loudRel = Math.min(2, rmsFast / Math.max(rmsSlow, 1e-3));
      fluxS += ((silent ? 0 : a.flux) - fluxS) * k(dt, 0.3);
      d.swirlAmp = p.swirlEff * (0.01 + 0.05 * Math.min(1.4, Math.max(0, loudRel - 0.6)) + 0.06 * fluxS);

      trebAttS += ((silent ? 0 : a.trebAtt) - trebAttS) * k(dt, 0.3);
      d.shimmerAmp = 8 * Math.min(2, Math.max(0, trebAttS - 1));
      d.shimmerPhase = (d.shimmerPhase + dt * (reduceFlashing ? 3 : 6)) % PHASE_WRAP;

      if (!silent) {
        if (!centroidInit) {
          centroidS = a.centroid;
          centroidInit = true;
        }
        centroidS += (a.centroid - centroidS) * k(dt, 1.5);
      }
      d.angle = 5 + 40 * Math.min(1, Math.max(0, centroidS * 4));

      const bal = silent ? 0 : stereoImage(a.left, a.right).balance;
      balanceS += (bal - balanceS) * k(dt, 0.5);
      d.balance = balanceS;
      d.tilt = p.tilt ? TILT_MAX * balanceS : 0;
      return d;
    },
  };
  return d;
}
