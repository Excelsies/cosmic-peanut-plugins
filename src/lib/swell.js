// @ts-check
/**
 * How swollen each pitch class's shape is (Misregister).
 *
 * Each pitch class follows chroma² × reactivity (capped at 1) with an 80 ms attack (150 ms under
 * Reduce flashing) and a 600 ms release; in silence every shape settles at 0.4, a quiet, legible
 * poster. An onset gives the strongest pitch class a +15% dot swell that fades over ~250 ms.
 *
 * On opaque paper the total ink on the sheet is the mean-luminance risk, so one global gain
 * multiplies every swell and dot swell: the flash limiter (flash.js) lets that total fall freely
 * but admits a new rise at most every 1/3 s while Reduce flashing is on. The limiter is the hard
 * cap; under it the drawn total may climb by at most total × dt / RECOVER per step, so a rise the
 * limiter held is released as a ~150 ms ramp instead of a one-frame jump. The drawn total never
 * exceeds the limiter's and only starts to rise when the limiter admits a rise, so the flash
 * count is unchanged (a natural 150 ms attack climbs slower than the ramp and is untouched).
 *
 * `step` allocates nothing; `swell` and `dot` are the same arrays every frame.
 */
import { stepEnvelope } from "./envelope.js";
import { createFlashLimiter } from "./flash.js";

export const ATTACK = 0.08;
export const ATTACK_REDUCED = 0.15;
export const RELEASE = 0.6;
export const SILENT_SWELL = 0.4;
export const DOT_BOOST = 0.15;
export const DOT_RELEASE = 0.25;
/** Seconds for a held rise of the global gain to come back from 0 to 1 under Reduce flashing. */
export const RECOVER = 0.15;

export function createSwell() {
  const env = new Float32Array(12);
  const dotEnv = new Float32Array(12);
  const swell = new Float32Array(12);
  const dot = new Float32Array(12);
  const flash = createFlashLimiter();
  /** Total ink drawn on the previous step (after the limiter and the recovery ramp). */
  let drawn = 0;

  const s = {
    /** Gained swell per pitch class, 0–1. */
    swell,
    /** Gained onset dot swell per pitch class (added to the ink density). */
    dot,
    /** The flash-limited global gain applied this step, 0–1. */
    gain: 1,
    /**
     * @param {Float32Array} chroma 12 values 0–1 (chroma.js)
     * @param {boolean} quiet silent source or rms under the silence threshold
     * @param {boolean} onset `audio.onset`
     * @param {number} dt seconds
     * @param {number} reactivity resolved param, 0–2
     * @param {boolean} reduceFlashing `ctx.reduceFlashing`
     */
    step(chroma, quiet, onset, dt, reactivity, reduceFlashing) {
      const attack = reduceFlashing ? ATTACK_REDUCED : ATTACK;
      let top = -1;
      let topV = 0;
      let sum = 0;
      const fade = dt > 0 ? Math.exp(-dt / DOT_RELEASE) : 1;
      for (let i = 0; i < 12; i++) {
        const c = chroma[i];
        const target = quiet ? SILENT_SWELL : Math.min(1, c * c * reactivity);
        env[i] = stepEnvelope(env[i], target, dt, attack, RELEASE);
        dotEnv[i] *= fade;
        if (c > topV) {
          topV = c;
          top = i;
        }
      }
      if (quiet) dotEnv.fill(0);
      else if (onset && top >= 0) dotEnv[top] = DOT_BOOST;
      for (let i = 0; i < 12; i++) sum += env[i] + dotEnv[i];
      const total = sum / 12;
      const limited = flash.step(total, dt, reduceFlashing);
      drawn = reduceFlashing ? Math.min(limited, drawn + (total * Math.max(0, dt)) / RECOVER) : total;
      s.gain = total > 1e-6 ? Math.min(1, drawn / total) : 1;
      for (let i = 0; i < 12; i++) {
        swell[i] = env[i] * s.gain;
        dot[i] = dotEnv[i] * s.gain;
      }
    },
  };
  return s;
}
