// @ts-check
/**
 * Beat hits and how heavy they are, from the spectrum the host sends (Chladni's hops and plate
 * pulse). The host's `onset` fires on any transient and its `beatPhase` drifts on real songs, so
 * this watches three bands of the auto-gained spectrum itself:
 *
 *   low  23–141 Hz   kick and 808 body
 *   mid  1–5 kHz     snare, clap, stomp, beatbox "pf"
 *   high 6–15 kHz    hats (only to recognise them)
 *
 * Per new analysis frame (`frameIndex` changed; at 144 fps the host resends frames; time is its
 * `hostTime`, or the summed `dt` for sources that send none), each band's
 * level in dB gives a flux: the rise over the lowest level of the frames seen in the last
 * FLUX_SPAN seconds. The flux is judged against its own last HIST seconds as a robust z score,
 * (flux − median) / (1.4826·MAD + Z_FLOOR), so a loud song and a quiet one fire alike. A hit is:
 *
 *   A  a low rise (z ≥ Z, ≥ FLUX_MIN dB) of A_STRONG dB or more, or with a host onset ≤ A_AGE s old
 *   S  a mid rise (z ≥ Z, ≥ FLUX_MIN dB) on a spectrum that is not hat-like
 *   C  a host onset of strength ≥ C_MIN on a spectrum that is not hat-like
 *
 * where hat-like is mid − high < S_HAT_DB. Hits are at least REFRACTORY seconds apart. A hit's
 * weight is the low level mapped from W_LO..W_HI dB to 0–1; for WEIGHT_WIN seconds after the fire
 * (one FFT window, while the kick's low end fills it) a higher level grows it (`grow`).
 *
 * Measured on five real songs and nine synthetic tracks: 73–98% of reference beat hits fire, and
 * the weight follows the reference bass weight (Spearman 0.58–0.93). `step` allocates nothing.
 */

export const LOW_HZ = [23, 141];
export const MID_HZ = [1000, 5000];
export const HIGH_HZ = [6000, 15000];
/** Seconds of earlier frames a rise is measured against (3 analysis frames). */
export const FLUX_SPAN = 0.035;
/** Seconds of flux history behind the z score, and the floor (dB) on its spread. */
export const HIST = 2;
export const Z_FLOOR = 0.5;
/** z score and rise (dB) a band must reach. */
export const Z = 3;
export const FLUX_MIN = 3;
/** A low rise of this many dB needs no host onset; smaller ones need one at most A_AGE s old. */
export const A_STRONG = 6;
export const A_AGE = 0.03;
/** mid − high (dB) under this is a hat: neither S nor C fires on it. */
export const S_HAT_DB = -3;
/** Host onset strength that fires on its own. */
export const C_MIN = 0.6;
/** Seconds between hits, at least. */
export const REFRACTORY = 0.1;
/** Seconds after a fire in which the weight may grow. */
export const WEIGHT_WIN = 0.043;
/** Low level (dB) of weight 0 and of weight 1. */
export const W_LO = -28;
export const W_HI = -10;

/** Spectrum bin of `hz` (2048-point FFT). @param {number} hz @param {number} sampleRate */
export function binOf(hz, sampleRate) {
  return Math.round((hz * 2048) / sampleRate);
}

const RECENT = 16;
const HCAP = 256;
const MIN_HISTORY = 8;

/** @param {unknown} v @param {number} fallback */
const num = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Level (dB) of bins a..b. @param {Float32Array} s @param {number} a @param {number} b */
function level(s, a, b) {
  let e = 0;
  for (let i = a; i <= b && i < s.length; i++) e += s[i] * s[i];
  const db = 10 * Math.log10(e + 1e-9);
  return Number.isFinite(db) ? db : -120;
}

/** Median of the first n entries, after padding the rest with +Infinity and sorting. @param {Float32Array} a @param {number} n */
function median(a, n) {
  a.fill(Infinity, n);
  a.sort();
  return a[n >> 1];
}

/** One band's flux and z score over the frames it has seen. */
function createBand() {
  const rt = new Float64Array(RECENT);
  const rv = new Float32Array(RECENT);
  let rn = 0;
  let rh = 0;
  const ht = new Float64Array(HCAP);
  const hv = new Float32Array(HCAP);
  let hn = 0;
  let hh = 0;
  const sorted = new Float32Array(HCAP);
  const dev = new Float32Array(HCAP);
  const band = {
    flux: 0,
    z: 0,
    /** @param {number} t @param {number} x */
    step(t, x) {
      if (rn > 0 && t < rt[(rh + RECENT - 1) % RECENT]) rn = hn = 0; // host clock went back
      let lo = Infinity;
      for (let k = 0; k < rn; k++) {
        const j = (rh + RECENT - 1 - k) % RECENT;
        if (t - rt[j] <= FLUX_SPAN + 1e-9 && rv[j] < lo) lo = rv[j];
      }
      if (lo === Infinity && rn > 0) lo = rv[(rh + RECENT - 1) % RECENT];
      band.flux = lo === Infinity ? 0 : Math.max(0, x - lo);
      rt[rh] = t;
      rv[rh] = x;
      rh = (rh + 1) % RECENT;
      if (rn < RECENT) rn++;
      // Live history: the newest entries within HIST s (older ones are dropped by age).
      let m = 0;
      for (let k = 0; k < hn; k++) {
        const j = (hh + HCAP - 1 - k) % HCAP;
        if (t - ht[j] > HIST) break;
        sorted[m++] = hv[j];
      }
      hn = m;
      band.z = 0;
      if (m >= MIN_HISTORY) {
        const med = median(sorted, m);
        for (let k = 0; k < m; k++) dev[k] = Math.abs(sorted[k] - med);
        band.z = (band.flux - med) / (1.4826 * median(dev, m) + Z_FLOOR);
      }
      ht[hh] = t;
      hv[hh] = band.flux;
      hh = (hh + 1) % HCAP;
      if (hn < HCAP) hn++;
    },
  };
  return band;
}

/** @param {number} db */
const weightOf = (db) => {
  const w = (db - W_LO) / (W_HI - W_LO);
  return w > 1 ? 1 : w > 0 ? w : 0;
};

export function createHits() {
  const low = createBand();
  const mid = createBand();
  const bins = new Int32Array(6);
  let rate = NaN;
  let lastFrame = NaN;
  let lastT = -Infinity;
  let sinceNew = 0;
  let lastFire = -Infinity;
  let fireT = NaN;
  const out = { fire: false, grow: false, weight: 0 };
  return {
    out,
    /**
     * @param {{ spectrum: Float32Array, sampleRate: number, frameIndex: number, hostTime: number,
     *   silent: boolean, onset: boolean, onsetStrength: number, onsetAge: number }} audio
     * @param {number} [dt] seconds since the previous call: the clock for sources without hostTime
     */
    step(audio, dt = 0) {
      out.fire = false;
      out.grow = false;
      sinceNew += dt > 0 ? dt : 0; // NaN too
      if (audio.frameIndex === lastFrame) return out;
      lastFrame = audio.frameIndex;
      // Without a finite hostTime (the harness's synthetic sources send none), a frame is as old as
      // the previous one plus the time that has passed since it.
      const t = Number.isFinite(audio.hostTime) ? audio.hostTime : (lastT === -Infinity ? 0 : lastT) + sinceNew;
      sinceNew = 0;
      if (audio.silent === true) return out;
      if (t < lastT) {
        lastFire = -Infinity; // host clock went back
        fireT = NaN;
      }
      lastT = t;
      const sr = num(audio.sampleRate, 48000);
      if (sr !== rate) {
        rate = sr;
        const hz = [LOW_HZ, MID_HZ, HIGH_HZ];
        for (let b = 0; b < 3; b++) {
          bins[2 * b] = binOf(hz[b][0], sr);
          bins[2 * b + 1] = binOf(hz[b][1], sr);
        }
      }
      const s = audio.spectrum;
      const xl = level(s, bins[0], bins[1]);
      const xm = level(s, bins[2], bins[3]);
      const xh = level(s, bins[4], bins[5]);
      low.step(t, xl);
      mid.step(t, xm);

      if (t - fireT <= WEIGHT_WIN + 1e-9) {
        const w = weightOf(xl);
        if (w > out.weight) {
          out.weight = w;
          out.grow = true;
        }
      }
      const age = num(audio.onsetAge, 10);
      const hatLike = xm - xh < S_HAT_DB;
      const a = low.z >= Z && low.flux >= FLUX_MIN && (low.flux >= A_STRONG || age <= A_AGE);
      const sm = mid.z >= Z && mid.flux >= FLUX_MIN && !hatLike;
      const strength = num(audio.onsetStrength, 0);
      const c = audio.onset === true && (strength > 1 ? 1 : strength) >= C_MIN && !hatLike;
      if ((a || sm || c) && t - lastFire >= REFRACTORY - 1e-9) {
        lastFire = t;
        fireT = t;
        out.fire = true;
        out.grow = false;
        out.weight = weightOf(xl);
      }
      return out;
    },
  };
}
