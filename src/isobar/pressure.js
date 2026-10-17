// @ts-check
/**
 * Isobar's surface-pressure model, in chart space: x in [0, aspect], y in [0, 1] (y down, north
 * up), both in units of the canvas height.
 *
 * A fixed pool of 7 Gaussian systems (slots 0-3 lows, 4-6 highs) on a calm background:
 *
 *   P(x, y) = background(x, y) + sum over live systems of A * g(dx) * g(dy)
 *
 * where g is a Gaussian lowered and rescaled to reach exactly 0 at 3 sigma, so each system only
 * touches its 3-sigma box with no step at the box edge (a hard cut-off kinks the isobars). The background is a gentle zonal gradient (12 hPa
 * across the height, lower to the north, with a slow wave), so a silent chart keeps wide, gentle
 * isobars and westerly winds.
 *
 * Lows live 48 beats on the music's beat clock: they deepen (0-16), occlude (16-32) and fill
 * (32-48). The youngest live low takes the bass (extra depth) and the kicks (a short pulse); the
 * highs swell with the mids. Everything drifts east with the beat clock; while the source is silent
 * the clock stops and every system fills toward the calm chart with a 6 s time constant.
 *
 * All envelopes are exponential in dt and every decision happens on a frame, so the same beat
 * stream gives the same state at 60 and 120 Hz. Nothing here allocates after create.
 */
import { hash01 } from "./hash.js";
import { createMeter } from "./meter.js";
import { stereoImage } from "./stereo.js";

export const SLOTS = 7;
export const MAX_LOWS = 4;
export const LOW = 1;
export const HIGH = 2;
/** One drift cell in chart units: the nominal 160 x 90 contour grid, so drift doesn't depend on the window size. */
export const CELL = 1 / 90;
export const BASE_P = 1013;
/** Life of a low in beats, and the age at which its fronts may start. */
export const LOW_LIFE = 48;

const BG_GRAD = 12; // hPa from the top of the chart to the bottom
const BG_WAVE = 0.08; // wave amplitude in chart units
const BG_K = 2.4; // wave number, radians per chart unit
const BG_PHASE = 0.7;
const HIGH_SIGMA = 0.3;
const SPAWN_GAP = 8; // beats between onset spawns
const IDLE_SPAWN = 4; // beats without any low before one starts anyway
const SPAWN_STRENGTH = 0.4;
const BASS_DEPTH = 28; // hPa per unit of bassAtt above 1
const KICK_DEPTH = 6; // hPa per unit of onsetStrength
const T_ATTACK = 0.06;
const T_RELEASE = 0.8;
const T_KICK = 0.25;
const T_MID = 0.3;
const T_BALANCE = 1;
const T_FILL = 6; // silent: everything fills toward the calm chart
const T_RECOVER = 1.5; // sound again: the systems come back
const T_ROOM = 1; // a high gives way to a low over about a second
const ROOM_NEAR = 0.2; // chart units: a high is flat with a low this close
const ROOM_SPAN = 0.4; // ...and whole from ROOM_NEAR + ROOM_SPAN away

/** exp(-4.5): the Gaussian at 3 sigma. */
const E3 = Math.exp(-4.5);
const TAPER = 1 / (1 - E3);

/**
 * The tapered 1-D Gaussian: 1 at 0, exactly 0 from 3 sigma out. inv = 1 / (2 sigma^2).
 * @param {number} d @param {number} inv
 */
function taper(d, inv) {
  const e = Math.exp(-d * d * inv);
  return e > E3 ? (e - E3) * TAPER : 0;
}

/** @param {number} t */
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Lifecycle amplitude of a low (hPa) at `age` beats: eases -4 -> -16 over 0-16, holds to 32,
 * fills to 0 by 48.
 * @param {number} age
 */
export function lifecycleAmp(age) {
  if (age < 16) return -4 - 12 * smooth(age / 16);
  if (age < 32) return -16;
  return -16 * (1 - smooth((age - 32) / 16));
}

/** Width of a low at `age` beats. @param {number} age */
export function lowSigma(age) {
  return 0.16 + 0.06 * Math.min(age / LOW_LIFE, 1);
}

/** The calm chart (hPa) at (x, y). @param {number} x @param {number} y */
export function backgroundAt(x, y) {
  return BASE_P + BG_GRAD * (y - 0.5 + BG_WAVE * Math.sin(BG_K * x + BG_PHASE));
}

/** @param {number} aspect width / height of the chart */
export function createPressure(aspect) {
  const st = {
    aspect,
    kind: new Uint8Array(SLOTS),
    alive: new Uint8Array(SLOTS),
    id: new Int32Array(SLOTS),
    x: new Float64Array(SLOTS),
    y: new Float64Array(SLOTS),
    sigma: new Float64Array(SLOTS),
    /** Lifecycle (lows) or mid-driven (highs) amplitude, hPa. */
    amp: new Float64Array(SLOTS),
    /** Bass-driven extra depth, hPa (lows). */
    extra: new Float64Array(SLOTS),
    /** Kick pulse, hPa (lows). */
    kick: new Float64Array(SLOTS),
    /** Re-entry fade 0-1 (highs). */
    fade: new Float64Array(SLOTS),
    /** 0-1: a high gives way while a low passes close by (highs). */
    room: new Float64Array(SLOTS),
    ageBeats: new Float64Array(SLOTS),
    /** Effective amplitude used by the field: level * amp * fade + extra + kick. */
    eff: new Float64Array(SLOTS),
    /** Beat clock (stops while silent). */
    beats: 0,
    lastSpawn: -1e9,
    /** Beats without any live low; starts full so the first low comes with the first sound. */
    noLow: IDLE_SPAWN,
    nextId: 1,
    /** 1 with sound, decays to 0 while silent. */
    level: 1,
    midAttS: 0,
    balanceS: 0,
    meter: createMeter(),
    prevMeter: 0,
    // Separable Gaussian scratch for fillField.
    gx: new Float64Array(1024),
    gy: new Float64Array(1024),
    wave: new Float64Array(1024),
  };
  for (let i = 0; i < MAX_LOWS; i++) st.kind[i] = LOW;
  for (let i = MAX_LOWS; i < SLOTS; i++) {
    st.kind[i] = HIGH;
    st.alive[i] = 1;
    st.id[i] = 100 + i;
    // one high per third of the width, so they don't pile into one dome
    const third = i - MAX_LOWS;
    st.x[i] = ((third + 0.25 + 0.5 * hash01(st.id[i] * 3 + 1)) / 3) * aspect;
    st.y[i] = 0.15 + 0.7 * hash01(st.id[i] * 3 + 2);
    st.sigma[i] = HIGH_SIGMA;
    st.amp[i] = 4;
    st.fade[i] = 1;
    st.room[i] = 1;
  }
  updateEff(st);
  return st;
}

/** @typedef {ReturnType<typeof createPressure>} Pressure */

/** @param {Pressure} st @param {number} aspect */
export function setAspect(st, aspect) {
  st.aspect = aspect;
}

/** @param {Pressure} st */
function updateEff(st) {
  for (let i = 0; i < SLOTS; i++) {
    const room = st.kind[i] === HIGH ? st.room[i] : 1;
    st.eff[i] = st.alive[i] ? st.level * st.amp[i] * st.fade[i] * room + st.extra[i] + st.kick[i] : 0;
  }
}

/** Slot of the youngest live low, or -1. @param {Pressure} st */
export function youngestLow(st) {
  let best = -1;
  for (let i = 0; i < MAX_LOWS; i++) {
    if (st.alive[i] && (best < 0 || st.ageBeats[i] < st.ageBeats[best])) best = i;
  }
  return best;
}

/** @param {Pressure} st */
function spawnLow(st) {
  let slot = -1;
  for (let i = 0; i < MAX_LOWS; i++) {
    if (!st.alive[i]) {
      slot = i;
      break;
    }
  }
  if (slot < 0) return -1;
  const id = st.nextId++;
  st.alive[slot] = 1;
  st.id[slot] = id;
  st.x[slot] = (0.05 + 0.35 * hash01(id)) * st.aspect;
  const y = 0.5 - 0.25 * st.balanceS + 0.1 * (hash01(id + 7) - 0.5);
  st.y[slot] = Math.min(0.8, Math.max(0.2, y));
  st.ageBeats[slot] = 0;
  st.sigma[slot] = lowSigma(0);
  st.amp[slot] = lifecycleAmp(0);
  st.extra[slot] = 0;
  st.kick[slot] = 0;
  st.fade[slot] = 1;
  st.lastSpawn = st.beats;
  return slot;
}

/**
 * One frame.
 * @param {Pressure} st
 * @param {{ bpm: number, beatPhase: number, silent: boolean, onset: boolean, onsetStrength: number,
 *   bass: number, mid: number, bassAtt: number, midAtt: number, left: Float32Array | null, right: Float32Array | null }} a
 * @param {number} dt seconds
 * @param {{ reactivity: number, speedEff: number, pulseEff: number }} prm
 */
export function stepPressure(st, a, dt, prm) {
  const m = st.meter.step(a.bpm, a.beatPhase, dt);
  const db = a.silent ? 0 : Math.max(0, m - st.prevMeter);
  st.prevMeter = m;
  st.beats += db;

  st.balanceS += (stereoImage(a.left, a.right).balance - st.balanceS) * (1 - Math.exp(-dt / T_BALANCE));
  st.midAttS += (a.midAtt - st.midAttS) * (1 - Math.exp(-dt / T_MID));
  st.level += ((a.silent ? 0 : 1) - st.level) * (1 - Math.exp(-dt / (a.silent ? T_FILL : T_RECOVER)));

  // Lows: age, fill, drift.
  const drift = db * prm.speedEff * CELL;
  let live = 0;
  for (let i = 0; i < MAX_LOWS; i++) {
    if (!st.alive[i]) continue;
    st.ageBeats[i] += db;
    if (st.ageBeats[i] >= LOW_LIFE - 1e-6) {
      st.alive[i] = 0;
      continue;
    }
    st.amp[i] = lifecycleAmp(st.ageBeats[i]);
    st.sigma[i] = lowSigma(st.ageBeats[i]);
    st.x[i] += drift;
    live++;
  }
  st.noLow = live ? 0 : st.noLow + db;

  if (!a.silent) {
    // bass-led: the attenuated bass leads, or (since bassAtt lags a kick) the onset frame's own bass
    const bassLed = a.onset && (a.bassAtt > a.midAtt || a.bass > a.mid) && a.onsetStrength > SPAWN_STRENGTH;
    if (live < MAX_LOWS && ((bassLed && st.beats - st.lastSpawn >= SPAWN_GAP - 1e-6) || st.noLow >= IDLE_SPAWN - 1e-6)) {
      if (spawnLow(st) >= 0) st.noLow = 0;
    }
  }

  // The youngest low takes the bass and the kick; the others release.
  const young = youngestLow(st);
  const kDecay = Math.exp(-dt / T_KICK);
  for (let i = 0; i < MAX_LOWS; i++) {
    if (!st.alive[i]) continue;
    st.kick[i] *= kDecay;
    if (a.silent) {
      st.extra[i] *= Math.exp(-dt / T_FILL);
      continue;
    }
    const target = i === young ? -Math.min(1.5, Math.max(0, a.bassAtt - 1)) * BASS_DEPTH * prm.reactivity : 0;
    const tau = target < st.extra[i] ? T_ATTACK : T_RELEASE;
    st.extra[i] += (target - st.extra[i]) * (1 - Math.exp(-dt / tau));
    if (i === young && a.onset) {
      st.kick[i] = Math.min(st.kick[i], -KICK_DEPTH * a.onsetStrength * prm.pulseEff * prm.reactivity);
    }
  }

  // Highs: swell with the mids, drift at half speed, re-enter from the west, and give way to a
  // passing low (so a high never sits on a low and lifts it).
  const highAmp = 4 + (12 * Math.min(2, Math.max(0, st.midAttS))) / 2 * prm.reactivity;
  const kRoom = 1 - Math.exp(-dt / T_ROOM);
  for (let i = MAX_LOWS; i < SLOTS; i++) {
    st.amp[i] = highAmp;
    let near = 1e9;
    for (let k = 0; k < MAX_LOWS; k++) {
      if (st.alive[k]) near = Math.min(near, Math.sqrt((st.x[k] - st.x[i]) ** 2 + (st.y[k] - st.y[i]) ** 2));
    }
    st.room[i] += (smooth((near - ROOM_NEAR) / ROOM_SPAN) - st.room[i]) * kRoom;
    st.x[i] += drift * 0.5;
    st.fade[i] = Math.min(1, st.fade[i] + db / 4);
    if (st.x[i] > st.aspect + 0.4) {
      st.id[i] = st.nextId++;
      st.x[i] = -0.4;
      st.y[i] = 0.15 + 0.7 * hash01(st.id[i] * 3 + 2);
      st.fade[i] = 0;
    }
  }
  updateEff(st);
}

/** Pressure (hPa) at (x, y). @param {Pressure} st @param {number} x @param {number} y */
export function pressureAt(st, x, y) {
  let p = backgroundAt(x, y);
  for (let i = 0; i < SLOTS; i++) {
    const A = st.eff[i];
    if (A === 0) continue;
    const s = st.sigma[i];
    const dx = x - st.x[i];
    const dy = y - st.y[i];
    const inv = 1 / (2 * s * s);
    p += A * taper(dx, inv) * taper(dy, inv);
  }
  return p;
}

/**
 * Gradient of P in hPa per chart unit (screen axes, y down) at (x, y), into out[0], out[1].
 * @param {Pressure} st @param {number} x @param {number} y @param {Float64Array | Float32Array} out
 */
export function grad(st, x, y, out) {
  let gx = BG_GRAD * BG_WAVE * BG_K * Math.cos(BG_K * x + BG_PHASE);
  let gy = BG_GRAD;
  for (let i = 0; i < SLOTS; i++) {
    const A = st.eff[i];
    if (A === 0) continue;
    const s = st.sigma[i];
    const dx = x - st.x[i];
    const dy = y - st.y[i];
    const inv = 1 / (2 * s * s);
    const ex = Math.exp(-dx * dx * inv);
    const ey = Math.exp(-dy * dy * inv);
    if (ex <= E3 || ey <= E3) continue;
    // d/dx [(ex - E3) * TAPER] = -ex * dx / s^2 * TAPER
    gx -= A * ex * (dx / (s * s)) * TAPER * (ey - E3) * TAPER;
    gy -= A * ey * (dy / (s * s)) * TAPER * (ex - E3) * TAPER;
  }
  out[0] = gx;
  out[1] = gy;
}

/** Pressure at the centre of slot i (hPa). @param {Pressure} st @param {number} i */
export function centralPressure(st, i) {
  return pressureAt(st, st.x[i], st.y[i]);
}

/**
 * P at the nodes of a cols x rows grid with node (i, j) at chart (i * dx, j * dy), row-major into
 * `out`. Each system only touches the nodes inside its 3-sigma box, as a separable product.
 * @param {Pressure} st @param {Float32Array} out @param {number} cols @param {number} rows
 * @param {number} dx @param {number} dy
 */
export function fillField(st, out, cols, rows, dx, dy) {
  const { gx, gy, wave } = st;
  for (let i = 0; i < cols; i++) wave[i] = BG_GRAD * BG_WAVE * Math.sin(BG_K * i * dx + BG_PHASE);
  for (let j = 0; j < rows; j++) {
    const base = BASE_P + BG_GRAD * (j * dy - 0.5);
    const row = j * cols;
    for (let i = 0; i < cols; i++) out[row + i] = base + wave[i];
  }
  for (let k = 0; k < SLOTS; k++) {
    const A = st.eff[k];
    if (A === 0) continue;
    const s = st.sigma[k];
    const cx = st.x[k];
    const cy = st.y[k];
    const i0 = Math.max(0, Math.ceil((cx - 3 * s) / dx));
    const i1 = Math.min(cols - 1, Math.floor((cx + 3 * s) / dx));
    const j0 = Math.max(0, Math.ceil((cy - 3 * s) / dy));
    const j1 = Math.min(rows - 1, Math.floor((cy + 3 * s) / dy));
    if (i0 > i1 || j0 > j1) continue;
    const inv = 1 / (2 * s * s);
    for (let i = i0; i <= i1; i++) {
      gx[i] = taper(i * dx - cx, inv);
    }
    for (let j = j0; j <= j1; j++) {
      gy[j] = A * taper(j * dy - cy, inv);
    }
    for (let j = j0; j <= j1; j++) {
      const row = j * cols;
      const a = gy[j];
      for (let i = i0; i <= i1; i++) out[row + i] += a * gx[i];
    }
  }
}
