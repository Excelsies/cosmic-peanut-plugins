// @ts-check
/**
 * The oil lamp (blencong) behind the screen. Hats and spectral flux make the flame flicker: a
 * 1D value noise at 7 Hz (3 Hz while ctx.reduceFlashing) scaled by
 *   f = flicker * (0.3 + 0.35 * clamp(trebAtt - 1, 0, 2) + 0.3 * fluxS) * n(t).
 * The flame moves (`ox`, `oy`, device px; the shadows shift with it by their distance from the
 * screen) and dims the whole screen by at most MAX_DIP, through the flash limiter.
 * `step` allocates nothing.
 */
import { createFlashLimiter } from "./flash.js";
import { hash01 } from "./hash.js";

/** The screen never dims by more than this (a 5% wobble). */
export const MAX_DIP = 0.05;
/** How far the flame moves at |f| = 1, device px at 1440p. */
const SWAY_PX = 6;
const FREQ = 7;
const FREQ_CALM = 3;
const FLUX_TAU = 0.15;

/**
 * Smooth 1D value noise in [-1, 1]: hashed lattice values, smoothstep-interpolated.
 * @param {number} t @param {number} seed
 */
export function valueNoise(t, seed) {
  const i = Math.floor(t);
  const u = t - i;
  const k = u * u * (3 - 2 * u);
  const a = hash01(i * 131 + seed * 7919) * 2 - 1;
  const b = hash01((i + 1) * 131 + seed * 7919) * 2 - 1;
  return a + (b - a) * k;
}

export function createLamp() {
  const flash = createFlashLimiter();
  let phase = 0;
  let fluxS = 0;
  return {
    /** Signed flicker amount, about -1.3..1.3. */
    f: 0,
    /** Flame offset, device px. */
    ox: 0,
    oy: 0,
    /** Screen brightness factor, 1 - MAX_DIP..1. */
    gain: 1,
    /**
     * @param {number} trebAtt @param {number} flux @param {number} dt
     * @param {number} flicker effective flicker param
     * @param {boolean} reduceFlashing @param {number} pxScale screen height / 1440
     */
    step(trebAtt, flux, dt, flicker, reduceFlashing, pxScale) {
      phase = (phase + (reduceFlashing ? FREQ_CALM : FREQ) * dt) % 1e6;
      fluxS += ((Number.isFinite(flux) ? flux : 0) - fluxS) * (1 - Math.exp(-dt / FLUX_TAU));
      const treb = Number.isFinite(trebAtt) ? Math.min(2, Math.max(0, trebAtt - 1)) : 0;
      const amp = flicker * (0.3 + 0.35 * treb + 0.3 * Math.min(1, Math.max(0, fluxS)));
      this.f = amp * valueNoise(phase, 1);
      const sway = SWAY_PX * pxScale * this.f;
      this.ox = sway * valueNoise(phase * 0.7, 2);
      this.oy = sway * valueNoise(phase * 0.7, 3);
      this.gain = 1 - flash.step(MAX_DIP * Math.min(1, Math.abs(this.f)), dt, reduceFlashing);
      return this;
    },
  };
}
