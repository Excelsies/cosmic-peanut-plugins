// @ts-check
/**
 * Beat hits and how heavy they are, for Chladni's hops and plate pulse. The host's `onset` fires
 * on any transient, so this watches bands of the spectrum: low 23–141 Hz (kick, 808), body
 * 150–400 Hz (the kick's body), mid 1–5 kHz (snare, clap, stomp, beatbox "pf") and high 6–15 kHz
 * (only to recognise hats).
 *
 * Per new analysis frame (`frameIndex` changed: at 144 fps the host resends frames; time is its
 * `hostTime`, or the summed `dt` for sources that send none) a band's flux is its dB level's rise
 * over the lowest level of the last FLUX_SPAN seconds, judged as a robust z score against its own
 * last HIST seconds: (flux − median) / (1.4826·MAD + Z_FLOOR). A candidate is
 *   A  a low rise (z ≥ Z, ≥ FLUX_MIN dB) of A_STRONG dB or more, or with a host onset ≤ A_AGE s old,
 *      of a low band at A_FLOOR dB or louder (a rise out of near silence is no bass hit)
 *   K  a low rise of K_FLUX dB with a mean rise per low bin of K_RISE dB, of a low band at K_FLOOR
 *      dB or louder, whatever its z score (a kick over a busy, heavy bass line)
 *   S  a mid rise (z ≥ Z, ≥ FLUX_MIN dB) on a spectrum that is not hat-like (mid − high < S_HAT_DB)
 * and it hits (fires) only as a kick or a noise burst:
 *   kick   an A rise with the bass dominating (low − whole spectrum ≥ SHARE_DB) and the body rising
 *          BODY_DB now or up to BODY_WIN s before (a kick's pitch falls through the body into the
 *          bass), or the beater's click: a mid rise of CLICK_DB on a not hat-like spectrum whose
 *          1–5 kHz flatness is FLAT_KICK or more; or an A rise of K_HUGE dB; or a kick into a ringing
 *          808, which can dip the band: a mean rise per low bin of R_RISE dB with a body rise of
 *          R_BODY dB, a mid rise of R_MID dB on a not hat-like spectrum, the bass dominating and the
 *          low band at K_FLOOR dB or louder
 *   noise  a mid rise of FLUX_MIN dB on a not hat-like spectrum whose 1–5 kHz flatness (geometric
 *          over arithmetic mean power of every FLAT_STEP-th bin) is FLAT_MIN or more, with A, K or S,
 *          that clears the song's noise floor: NOISE_REL of the NOISE_Q quantile of the mid rises of
 *          the noise frames of the last NOISE_WIN s (none under NOISE_MIN of them), so a song's quiet
 *          clicks and breaths do not hop beside its loud snares; a host onset of C_MIN or more, or the
 *          kick body rising (now or up to BODY_WIN s before) under a dominant bass, needs no floor
 * A kick only K sees (a K rise with the bass dominating and the body or click rising now, or of
 * K_HUGE dB) waits for the next analysis frame, at most K_WAIT s on, and hits there if the low level
 * held or rose: a kick keeps filling the FFT window, a busy bass line's peak falls back.
 * Any other candidate, and a host onset of strength ≥ C_MIN on a non-hat spectrum, is a soft hit
 * (`soft`, at most one per REFRACTORY s): a vocal or synth attack, an 808 note, a sidechained bass
 * swelling back, a hat; Chladni gives it a drive pulse but no hop. Hits are at least REFRACTORY s
 * apart; within REFIRE s of the last hit a new one also needs a bigger low rise per bin than that
 * hit's (after a hit lighter than REFIRE_W only), or a broad mid rise (≥ BROAD_DB dB in at least
 * BROAD_SHARE of the MID_SPLIT mid sub-bands): a snare or clap, not a cowbell or the kick's own tail.
 * A hit's weight is how much bass arrived with it: the low level mapped from W_LO..W_HI dB to 0–1,
 * times the low band's mean rise per bin (each bin's dB over its lowest of the last FLUX_SPAN s)
 * mapped from W_RISE_LO..W_RISE_HI dB to 0–1. Per bin, a kick on a ringing 808 counts even when a
 * limiter holds the band's level. For WEIGHT_WIN s after the fire (one FFT window, while the kick's
 * low end fills it) the level and the rise are their highest so far, and a heavier result grows the
 * weight.
 *
 * Replayed on five real songs and nine synthetic tracks (60/144 fps and ±50% frame jitter), 69–86%
 * of the hops on the four drum-driven songs land on a reference kick or snare and 79–98% of their
 * reference kicks hop; synthetic hats, cowbells and rides alone take 0–5% of the hops except on
 * edm128 (17%: its pumped reese bass swelling back between kicks).
 * `step` allocates nothing.
 */

export const LOW_HZ = [23, 141];
export const MID_HZ = [1000, 5000];
export const HIGH_HZ = [6000, 15000];
/** The kick's body (its lowest bin is the low band's highest at 48 kHz). */
export const BODY_HZ = [150, 400];
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
/** Low level (dB) under which a low rise is no bass hit (a rise out of near silence). */
export const A_FLOOR = -40;
/** mid − high (dB) under this is a hat: neither S nor C fires on it. */
export const S_HAT_DB = -3;
/** Host onset strength that fires on its own. */
export const C_MIN = 0.6;
/** Seconds between hits, at least; within REFIRE s a hit needs a bigger low rise or a broad mid rise. */
export const REFRACTORY = 0.07;
export const REFIRE = 0.12;
/** A bigger low rise re-fires only after a hit lighter than this (a snare, not a kick's own swell). */
export const REFIRE_W = 0.65;
/** Seconds after a fire in which the weight may grow. */
export const WEIGHT_WIN = 0.043;
/** Low level (dB) of weight 0 and of weight 1. */
export const W_LO = -28;
export const W_HI = -10;
/** Mean rise per low bin (dB) of no weight and of the level's full weight. */
export const W_RISE_LO = 1;
export const W_RISE_HI = 3.5;
/** Mid sub-bands (log-spaced); a broad rise lifts BROAD_SHARE of them by BROAD_DB dB or more. */
export const MID_SPLIT = 8;
export const BROAD_DB = 6;
export const BROAD_SHARE = 0.5;
/** A noise burst: flatness (geometric over arithmetic mean power) of every FLAT_STEP-th mid bin. */
export const FLAT_MIN = 0.28;
export const FLAT_STEP = 2;
/**
 * A kick: low level minus the whole spectrum's (dB) at least SHARE_DB, and a body rise of BODY_DB
 * dB or the beater's click: a mid rise of CLICK_DB on a not hat-like spectrum at least FLAT_KICK flat.
 */
export const SHARE_DB = -4;
export const BODY_DB = 2;
export const FLAT_KICK = 0.15;
export const CLICK_DB = 1;
/** A bass rise with no z score: band rise K_FLUX dB, mean rise per low bin K_RISE dB, low level K_FLOOR dB or more. */
export const K_FLUX = 3;
export const K_RISE = 3;
export const K_FLOOR = -30;
/** A low rise this big (dB) is a kick on its own, body, click and share or not (a pure sine kick). */
export const K_HUGE = 20;
/** Seconds the kick body may rise before an A rise and still count (the kick's pitch falls through it). */
export const BODY_WIN = 0.04;
/** Seconds within which the next analysis frame must confirm a K-only kick (its low level holding or rising). */
export const K_WAIT = 0.035;
/** A kick into a ringing 808: mean rise per low bin R_RISE dB, body rise R_BODY dB and mid rise R_MID dB. */
export const R_RISE = 6;
export const R_BODY = 5;
export const R_MID = 2;
/**
 * A noise burst that is no kick must rise NOISE_REL of the NOISE_Q quantile of the mid rises of the
 * noise frames of the last NOISE_WIN s (at least NOISE_MIN of them; else no floor).
 */
export const NOISE_WIN = 6;
export const NOISE_Q = 0.9;
export const NOISE_REL = 0.25;
export const NOISE_MIN = 8;

/** Spectrum bin of `hz` (2048-point FFT). @param {number} hz @param {number} sampleRate */
export function binOf(hz, sampleRate) {
  return Math.round((hz * 2048) / sampleRate);
}

/**
 * First bin of each mid sub-band, and one past the last bin (MID_SPLIT + 1 entries).
 * @param {number} sampleRate @param {Int32Array} [out]
 */
export function midSplit(sampleRate, out = new Int32Array(MID_SPLIT + 1)) {
  const a = binOf(MID_HZ[0], sampleRate);
  const end = binOf(MID_HZ[1], sampleRate) + 1;
  for (let k = 0; k <= MID_SPLIT; k++) out[k] = Math.max(k > 0 ? out[k - 1] + 1 : a, Math.round(a * (end / a) ** (k / MID_SPLIT)));
  return out;
}

const EDGES = [...LOW_HZ, ...MID_HZ, ...HIGH_HZ, ...BODY_HZ]; // Hz
const RECENT = 16;
const HCAP = 256;
const MIN_HISTORY = 8;
/** Columns per frame in the per-bin history: up to LOW_CAP low bins, then the mid sub-bands. */
const LOW_CAP = 48;
const COLS = LOW_CAP + MID_SPLIT;

/** @param {unknown} v @param {number} fallback */
const num = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Level (dB) of bins a..b. @param {Float32Array} s @param {number} a @param {number} b */
function level(s, a, b) {
  let e = 0;
  for (let i = a; i <= b && i < s.length; i++) e += s[i] * s[i];
  const db = 10 * Math.log10(e + 1e-9);
  return Number.isFinite(db) ? db : -120;
}

/**
 * Spectral flatness of the power in every FLAT_STEP-th bin of a..b: 1 for even noise, near 0 for a
 * few tones. @param {Float32Array} s @param {number} a @param {number} b
 */
export function flatness(s, a, b) {
  let logSum = 0;
  let sum = 0;
  let n = 0;
  for (let i = a; i <= b && i < s.length; i += FLAT_STEP) {
    const v = s[i];
    const p = (Number.isFinite(v) ? v * v : 0) + 1e-12;
    logSum += Math.log(p);
    sum += p;
    n++;
  }
  return n > 0 ? Math.exp(logSum / n) / (sum / n) : 0;
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
    /** Whether the history is long enough to judge a rise (MIN_HISTORY frames). */
    ready: false,
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
      band.ready = m >= MIN_HISTORY;
      if (band.ready) {
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

/**
 * Rises per column (low bins, mid sub-bands) over each column's lowest of the last FLUX_SPAN s:
 * `step` sets `low` (the mean rise of the low bins, dB) and `broad` (the share of mid sub-bands up
 * BROAD_DB or more).
 */
function createRises() {
  const ring = new Float32Array(RECENT * COLS);
  const rt = new Float64Array(RECENT);
  const cur = new Float32Array(COLS);
  let rn = 0;
  let rh = 0;
  const rises = {
    low: 0,
    broad: 0,
    /** @param {number} t @param {Float32Array} s @param {number} b0 @param {number} nLow @param {Int32Array} split */
    step(t, s, b0, nLow, split) {
      if (rn > 0 && t < rt[(rh + RECENT - 1) % RECENT]) rn = 0; // host clock went back
      for (let i = 0; i < nLow; i++) cur[i] = level(s, b0 + i, b0 + i);
      for (let k = 0; k < MID_SPLIT; k++) cur[LOW_CAP + k] = level(s, split[k], split[k + 1] - 1);
      let sum = 0;
      let wide = 0;
      for (let c = 0; c < COLS; c++) {
        if (c >= nLow && c < LOW_CAP) continue;
        let lo = Infinity;
        for (let k = 0; k < rn; k++) {
          const j = (rh + RECENT - 1 - k) % RECENT;
          if (t - rt[j] <= FLUX_SPAN + 1e-9 && ring[j * COLS + c] < lo) lo = ring[j * COLS + c];
        }
        if (lo === Infinity) lo = rn > 0 ? ring[((rh + RECENT - 1) % RECENT) * COLS + c] : cur[c];
        const r = cur[c] - lo;
        if (c < nLow) sum += r > 0 ? r : 0;
        else if (r >= BROAD_DB) wide++;
      }
      rises.low = nLow > 0 ? sum / nLow : 0;
      rises.broad = wide / MID_SPLIT;
      ring.set(cur, rh * COLS);
      rt[rh] = t;
      rh = (rh + 1) % RECENT;
      if (rn < RECENT) rn++;
    },
  };
  return rises;
}

/**
 * The mid rises of the latest noise frames (the newest HCAP): `level(t)` is the NOISE_Q quantile of
 * those within NOISE_WIN s of t, or 0 under NOISE_MIN of them.
 */
function createNoiseFloor() {
  const nt = new Float64Array(HCAP);
  const nv = new Float32Array(HCAP);
  const sorted = new Float32Array(HCAP);
  let n = 0;
  let head = 0;
  return {
    /** @param {number} t */
    level(t) {
      let m = 0;
      for (let k = 0; k < n; k++) {
        const j = (head + HCAP - 1 - k) % HCAP;
        if (t - nt[j] > NOISE_WIN + 1e-9) break;
        sorted[m++] = nv[j];
      }
      n = m; // older entries drop out by age
      if (m < NOISE_MIN) return 0;
      sorted.fill(Infinity, m);
      sorted.sort();
      return sorted[Math.floor(NOISE_Q * (m - 1))];
    },
    /** @param {number} t @param {number} x */
    push(t, x) {
      nt[head] = t;
      nv[head] = x;
      head = (head + 1) % HCAP;
      if (n < HCAP) n++;
    },
    reset() {
      n = 0;
    },
  };
}

/** Clamp to 0–1. @param {number} x */
const unit = (x) => (x > 1 ? 1 : x > 0 ? x : 0);
/** Weight of low level `db` with mean rise per bin `rise`. @param {number} db @param {number} rise */
const weightOf = (db, rise) => unit((db - W_LO) / (W_HI - W_LO)) * unit((rise - W_RISE_LO) / (W_RISE_HI - W_RISE_LO));

export function createHits() {
  const low = createBand();
  const mid = createBand();
  const body = createBand();
  const rises = createRises();
  const noiseFloor = createNoiseFloor();
  const bins = new Int32Array(EDGES.length);
  const split = new Int32Array(MID_SPLIT + 1);
  let rate = NaN;
  let lastFrame = NaN;
  let lastT = -Infinity;
  let sinceNew = 0;
  let lastFire = -Infinity;
  let lastSoft = -Infinity;
  let fireT = -Infinity;
  let winLevel = -Infinity; // highest low level and rise since the fire (weight window)
  let winRise = 0;
  let bodyT = -Infinity; // last frame the kick body rose BODY_DB
  let waitT = -Infinity; // a K-only kick waiting for the next frame, and its low level
  let waitLevel = 0;
  const out = { fire: false, grow: false, soft: false, weight: 0 };
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
      out.soft = false;
      sinceNew += dt > 0 ? dt : 0; // NaN too
      if (audio.frameIndex === lastFrame) return out;
      lastFrame = audio.frameIndex;
      // No finite hostTime (the harness's synthetic sources): the previous frame's plus the time since.
      const t = Number.isFinite(audio.hostTime) ? audio.hostTime : (lastT === -Infinity ? 0 : lastT) + sinceNew;
      sinceNew = 0;
      if (audio.silent === true) return out;
      if (t < lastT) {
        lastFire = lastSoft = fireT = bodyT = waitT = -Infinity; // host clock went back
        noiseFloor.reset();
      }
      lastT = t;
      const sr = num(audio.sampleRate, 48000);
      if (sr !== rate) {
        rate = sr;
        for (let i = 0; i < EDGES.length; i++) bins[i] = binOf(EDGES[i], sr);
        midSplit(sr, split);
      }
      const s = audio.spectrum;
      const xl = level(s, bins[0], bins[1]);
      const xm = level(s, bins[2], bins[3]);
      const xh = level(s, bins[4], bins[5]);
      const xf = level(s, 1, s.length - 1);
      low.step(t, xl);
      mid.step(t, xm);
      body.step(t, level(s, bins[6], bins[7]));
      rises.step(t, s, bins[0], Math.min(LOW_CAP, Math.max(0, Math.min(bins[1], s.length - 1) - bins[0] + 1)), split);

      if (t - fireT <= WEIGHT_WIN + 1e-9) {
        if (xl > winLevel) winLevel = xl;
        if (rises.low > winRise) winRise = rises.low;
        const w = weightOf(winLevel, winRise);
        if (w > out.weight) {
          out.weight = w;
          out.grow = true;
        }
      }
      const age = num(audio.onsetAge, 10);
      const hatLike = xm - xh < S_HAT_DB;
      const a = xl >= A_FLOOR && low.z >= Z && low.flux >= FLUX_MIN && (low.flux >= A_STRONG || age <= A_AGE);
      const k = low.ready && xl >= K_FLOOR && low.flux >= K_FLUX && rises.low >= K_RISE;
      const sm = mid.z >= Z && mid.flux >= FLUX_MIN && !hatLike;
      const c = audio.onset === true && unit(num(audio.onsetStrength, 0)) >= C_MIN && !hatLike;
      // Only a kick or a noise burst hops; any other candidate is a soft hit (drive pulse, no hop).
      const flat = flatness(s, bins[2], bins[3]);
      const share = xl - xf >= SHARE_DB;
      if (body.flux >= BODY_DB) bodyT = t;
      const click = mid.flux >= CLICK_DB && flat >= FLAT_KICK && !hatLike;
      const huge = low.flux >= K_HUGE;
      const r = rises.low >= R_RISE && body.flux >= R_BODY && mid.flux >= R_MID;
      const noise = mid.flux >= FLUX_MIN && !hatLike && flat >= FLAT_MIN;
      const bodyNear = t - bodyT <= BODY_WIN + 1e-9;
      const kickA = (a && ((share && (bodyNear || click)) || huge)) || (r && !hatLike && share && xl >= K_FLOOR);
      const kickK = k && ((share && (body.flux >= BODY_DB || click)) || huge);
      let burst = noise && (a || k || sm || r);
      // A burst that is no kick clears the song's noise floor, unless a strong onset or the kick body comes with it.
      if (burst && !kickA && !c && !(share && bodyNear)) burst = mid.flux >= NOISE_REL * noiseFloor.level(t);
      if (noise) noiseFloor.push(t, mid.flux);
      const now = kickA || burst;
      // A kick only the K path sees waits a frame: it hops if the low level then holds or keeps rising.
      const confirmed = t - waitT <= K_WAIT + 1e-9 && xl >= waitLevel;
      waitT = -Infinity;
      if (kickK && !now) {
        waitT = t;
        waitLevel = xl;
      }
      const since = t - lastFire;
      const again = since >= REFIRE - 1e-9 || (rises.low > winRise && out.weight < REFIRE_W) || rises.broad >= BROAD_SHARE;
      const cand = a || k || sm;
      if (!(now || confirmed)) {
        // A soft hit, at most one per REFRACTORY s (and none inside a hop's).
        out.soft = (cand || c) && since >= REFRACTORY - 1e-9 && t - lastSoft >= REFRACTORY - 1e-9;
        if (out.soft) lastSoft = t;
      } else if (since >= REFRACTORY - 1e-9 && again) {
        lastFire = t;
        fireT = t;
        winLevel = xl;
        winRise = rises.low;
        out.fire = true;
        out.grow = false; // a fire supersedes a grow of the previous hit
        out.weight = weightOf(xl, winRise);
      }
      return out;
    },
  };
}
