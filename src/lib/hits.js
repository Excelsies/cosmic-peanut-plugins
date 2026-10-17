// @ts-check
/**
 * Beat hits and how heavy they are, for Chladni's hops and plate pulse. The host's `onset` fires
 * on any transient, so this watches three bands of the spectrum: low 23–141 Hz (kick, 808), mid
 * 1–5 kHz (snare, clap, stomp, beatbox "pf") and high 6–15 kHz (only to recognise hats).
 *
 * Per new analysis frame (`frameIndex` changed: at 144 fps the host resends frames; time is its
 * `hostTime`, or the summed `dt` for sources that send none) a band's flux is its dB level's rise
 * over the lowest level of the last FLUX_SPAN seconds, judged as a robust z score against its own
 * last HIST seconds: (flux − median) / (1.4826·MAD + Z_FLOOR). A hit, at least REFRACTORY s apart:
 *   A  a low rise (z ≥ Z, ≥ FLUX_MIN dB) of A_STRONG dB or more, or with a host onset ≤ A_AGE s old
 *   S  a mid rise (z ≥ Z, ≥ FLUX_MIN dB) on a spectrum that is not hat-like (mid − high < S_HAT_DB)
 *   C  a host onset of strength ≥ C_MIN on a spectrum that is not hat-like
 * Its weight is how much bass arrived with it: the low level mapped from W_LO..W_HI dB to 0–1,
 * times the low band's rise over the floor before the hit, full at W_RISE dB. A hat or cowbell over
 * a ringing 808 weighs about nothing; a kick that lifts the bass weighs its level. For WEIGHT_WIN s
 * after the fire (one FFT window, while the kick's low end fills it) a heavier frame grows it.
 *
 * On five real songs and nine synthetic tracks (one hop per hit): 73–100% of the reference beat
 * hits and 84–100% of the kicks fire. `step` allocates nothing.
 */

export const LOW_HZ = [23, 141];
export const MID_HZ = [1000, 5000];
export const HIGH_HZ = [6000, 15000];
/** Seconds of earlier frames a rise is measured against (3 analysis frames). */
export const FLUX_SPAN = 0.035;
/** Seconds of flux history behind the z score, and the floor (dB) on its spread. */
export const HIST = 2;
export const Z_FLOOR = 0.5;
export const Z = 3; // z score and rise (dB) a band must reach
export const FLUX_MIN = 3;
/** A low rise of this many dB needs no host onset; smaller ones need one at most A_AGE s old. */
export const A_STRONG = 6;
export const A_AGE = 0.03;
/** mid − high (dB) under this is a hat: neither S nor C fires on it. */
export const S_HAT_DB = -3;
/** Host onset strength that fires on its own. */
export const C_MIN = 0.6;
/** Seconds between hits, at least. */
export const REFRACTORY = 0.07;
/** Seconds after a fire in which the weight may grow. */
export const WEIGHT_WIN = 0.043;
/** Low level (dB) of weight 0 and of weight 1. */
export const W_LO = -28;
export const W_HI = -10;
/** Low rise (dB over the floor before the hit) that keeps the level's full weight. */
export const W_RISE = 4;

/** Spectrum bin of `hz` (2048-point FFT). @param {number} hz @param {number} sampleRate */
export function binOf(hz, sampleRate) {
  return Math.round((hz * 2048) / sampleRate);
}

const EDGES = [...LOW_HZ, ...MID_HZ, ...HIGH_HZ]; // Hz
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
      let m = 0; // live history: the newest entries within HIST s (older ones drop out by age)
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

/** Clamp to 0–1. @param {number} x */
const unit = (x) => (x > 1 ? 1 : x > 0 ? x : 0);
/** Weight of low level `db` that rose from `floor`. @param {number} db @param {number} floor */
const weightOf = (db, floor) => unit((db - W_LO) / (W_HI - W_LO)) * unit((db - floor) / W_RISE);

export function createHits() {
  const low = createBand();
  const mid = createBand();
  const bins = new Int32Array(6);
  let rate = NaN;
  let lastFrame = NaN;
  let lastT = -Infinity;
  let sinceNew = 0;
  let lastFire = -Infinity;
  let fireT = -Infinity;
  let floor = 0;
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
      // No finite hostTime (the harness's synthetic sources): the previous frame's plus the time since.
      const t = Number.isFinite(audio.hostTime) ? audio.hostTime : (lastT === -Infinity ? 0 : lastT) + sinceNew;
      sinceNew = 0;
      if (audio.silent === true) return out;
      if (t < lastT) lastFire = fireT = -Infinity; // host clock went back
      lastT = t;
      const sr = num(audio.sampleRate, 48000);
      if (sr !== rate) {
        rate = sr;
        for (let i = 0; i < 6; i++) bins[i] = binOf(EDGES[i], sr);
      }
      const s = audio.spectrum;
      const xl = level(s, bins[0], bins[1]);
      const xm = level(s, bins[2], bins[3]);
      const xh = level(s, bins[4], bins[5]);
      low.step(t, xl);
      mid.step(t, xm);

      if (t - fireT <= WEIGHT_WIN + 1e-9) {
        const w = weightOf(xl, floor);
        if (w > out.weight) {
          out.weight = w;
          out.grow = true;
        }
      }
      const age = num(audio.onsetAge, 10);
      const hatLike = xm - xh < S_HAT_DB;
      const a = low.z >= Z && low.flux >= FLUX_MIN && (low.flux >= A_STRONG || age <= A_AGE);
      const sm = mid.z >= Z && mid.flux >= FLUX_MIN && !hatLike;
      const c = audio.onset === true && unit(num(audio.onsetStrength, 0)) >= C_MIN && !hatLike;
      if ((a || sm || c) && t - lastFire >= REFRACTORY - 1e-9) {
        lastFire = t;
        fireT = t;
        floor = xl - low.flux;
        out.fire = true;
        out.grow = false; // a fire supersedes a grow of the previous hit
        out.weight = weightOf(xl, floor);
      }
      return out;
    },
  };
}
