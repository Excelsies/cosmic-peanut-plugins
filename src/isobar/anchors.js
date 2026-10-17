// @ts-check
/**
 * Where Isobar draws each system's letter, central pressure and front origin: on the field's real
 * extremum, not on the system's Gaussian centre. The calm chart's slope and the neighbouring
 * systems pull every minimum off its centre, and two lows closer than about two sigma share one
 * minimum (one ring set), so a marker on the Gaussian centre sits mid-slope.
 *
 * From each live system's centre a few damped Newton steps (gradient steps where the Hessian is not
 * definite the right way, every step backtracked until P falls for a low or rises for a high) find
 * the extremum it drains into. A system is `ok` when it lands on one (|grad P| below 0.5 hPa per
 * chart unit). Systems of a kind that land on the same extremum form a group with one `lead`: the
 * one that led it last frame if it is still there, else the strongest (so a kick on a younger low
 * does not swap the lead back and forth).
 *
 * A system that leads its own extremum is shown there: `x`, `y`, `p` are the extremum and its
 * pressure, and its offset from the system's centre is remembered. Kick pulses on a deep young low
 * can swallow a neighbour's minimum for a few frames at a time, so a system that loses its own
 * extremum keeps its marks at that remembered offset (moving with the system) for HOLD seconds,
 * then fades them; `vis` (0-1) eases in over 0.25 s and out over 0.4 s and scales the letter's
 * alpha and the fronts' length. A system that never had its own extremum is never shown. Its
 * `letter` needs the last own extremum at least 3 hPa off the calm chart the right way.
 *
 * Bounded: 24 steps of at most 4 halvings per system. Nothing here allocates after createAnchors.
 */
import { backgroundAt, derivs, HIGH, pressureAt, SLOTS } from "./pressure.js";

const STEPS = 24;
const HALVINGS = 4;
/** Converged when |grad P| is below this (hPa per chart unit; the calm chart alone has 12). */
const G_OK = 0.5;
/** Longest step, in sigmas of the system. */
const MAX_STEP = 0.5;
/** Two systems whose extrema are this close (chart units) share one. */
const SAME = 0.01;
/** A letter needs the extremum this far off the calm chart (hPa). */
const LETTER_MIN = 3;
/** Seconds a system keeps its marks after losing its own extremum. */
const HOLD = 1;
const T_IN = 0.25;
const T_OUT = 0.4;

export function createAnchors() {
  return {
    /** Where the system's marks go (chart units): its own extremum, or the held offset. */
    x: new Float64Array(SLOTS),
    y: new Float64Array(SLOTS),
    /** P there (the central pressure to print). */
    p: new Float64Array(SLOTS),
    /** p minus the calm chart there. */
    anomaly: new Float64Array(SLOTS),
    /** 0-1: how much of the letter and fronts to show. */
    vis: new Float64Array(SLOTS),
    /** 1 when the system gets a letter (drawn at alpha vis). */
    letter: new Uint8Array(SLOTS),
    /** The extremum the system drains into this frame, and 1 when it found one. */
    ex: new Float64Array(SLOTS),
    ey: new Float64Array(SLOTS),
    ok: new Uint8Array(SLOTS),
    /** 1 for the one system of each shared extremum that owns it. */
    lead: new Uint8Array(SLOTS),
    was: new Uint8Array(SLOTS),
    offX: new Float64Array(SLOTS),
    offY: new Float64Array(SLOTS),
    /** Seconds since the system last led its own extremum. */
    since: new Float64Array(SLOTS).fill(1e9),
    /** The last own extremum was deep enough for a letter. */
    deep: new Uint8Array(SLOTS),
    /** System id the slot's memory belongs to (a reused slot starts hidden). */
    seen: new Int32Array(SLOTS).fill(-1),
    d: new Float64Array(6),
  };
}

/** @typedef {ReturnType<typeof createAnchors>} Anchors */

/**
 * Descends (a low) or climbs (a high) from slot i's centre onto the extremum it drains into.
 * @param {import('./pressure.js').Pressure} st @param {Anchors} an @param {number} i
 */
function locate(st, an, i) {
  const d = an.d;
  const sgn = st.kind[i] === HIGH ? -1 : 1; // minimise sgn * P
  const cap = MAX_STEP * st.sigma[i];
  let x = st.x[i];
  let y = st.y[i];
  derivs(st, x, y, d);
  for (let it = 0; it < STEPS; it++) {
    const gx = sgn * d[1];
    const gy = sgn * d[2];
    const gm = Math.sqrt(gx * gx + gy * gy);
    if (gm < G_OK) break;
    const a = sgn * d[3];
    const b = sgn * d[4];
    const c = sgn * d[5];
    const det = a * c - b * b;
    let sx;
    let sy;
    if (a > 0 && det > 0) {
      // Newton: solve [a b; b c] s = -g
      sx = -(c * gx - b * gy) / det;
      sy = -(a * gy - b * gx) / det;
    } else {
      sx = (-gx / gm) * cap;
      sy = (-gy / gm) * cap;
    }
    const len = Math.sqrt(sx * sx + sy * sy);
    if (len > cap) {
      sx *= cap / len;
      sy *= cap / len;
    }
    const f0 = sgn * d[0];
    let moved = false;
    for (let h = 0; h <= HALVINGS; h++) {
      if (sgn * pressureAt(st, x + sx, y + sy) < f0) {
        x += sx;
        y += sy;
        moved = true;
        break;
      }
      sx *= 0.5;
      sy *= 0.5;
    }
    if (!moved) break;
    derivs(st, x, y, d);
  }
  an.ex[i] = x;
  an.ey[i] = y;
  an.ok[i] = Math.sqrt(d[1] * d[1] + d[2] * d[2]) < G_OK ? 1 : 0;
}

/**
 * One frame: every live system's extremum, the lead of each shared one, then where and how much
 * of each system's marks to show.
 * @param {import('./pressure.js').Pressure} st @param {Anchors} an @param {number} dt seconds
 */
export function locateAnchors(st, an, dt) {
  for (let i = 0; i < SLOTS; i++) {
    an.was[i] = an.lead[i];
    an.lead[i] = 0;
    if (st.alive[i] && st.eff[i] !== 0) {
      locate(st, an, i);
    } else {
      an.ok[i] = 0;
    }
  }
  for (let i = 0; i < SLOTS; i++) {
    if (!an.ok[i]) continue;
    let lead = 1;
    for (let j = 0; j < SLOTS && lead; j++) {
      if (j === i || !an.ok[j] || st.kind[j] !== st.kind[i]) continue;
      if (Math.abs(an.ex[i] - an.ex[j]) > SAME || Math.abs(an.ey[i] - an.ey[j]) > SAME) continue;
      // j beats i: it led last frame and i didn't; or neither/both did and j is stronger
      // (ties to the lower slot)
      const ai = Math.abs(st.eff[i]);
      const aj = Math.abs(st.eff[j]);
      if (an.was[j] !== an.was[i]) lead = an.was[j] ? 0 : 1;
      else if (aj > ai || (aj === ai && j < i)) lead = 0;
    }
    an.lead[i] = lead;
  }
  const kIn = 1 - Math.exp(-dt / T_IN);
  const kOut = 1 - Math.exp(-dt / T_OUT);
  for (let i = 0; i < SLOTS; i++) {
    if (!st.alive[i] || st.id[i] !== an.seen[i]) {
      an.seen[i] = st.alive[i] ? st.id[i] : -1;
      an.since[i] = 1e9;
      an.vis[i] = 0;
      an.offX[i] = 0;
      an.offY[i] = 0;
      an.deep[i] = 0;
    }
    if (!st.alive[i]) {
      an.letter[i] = 0;
      continue;
    }
    if (an.ok[i] && an.lead[i]) {
      an.offX[i] = an.ex[i] - st.x[i];
      an.offY[i] = an.ey[i] - st.y[i];
      an.since[i] = 0;
    } else {
      an.since[i] += dt;
    }
    const x = st.x[i] + an.offX[i];
    const y = st.y[i] + an.offY[i];
    an.x[i] = x;
    an.y[i] = y;
    an.p[i] = pressureAt(st, x, y);
    an.anomaly[i] = an.p[i] - backgroundAt(x, y);
    if (an.since[i] === 0) {
      const deep = st.kind[i] === HIGH ? an.anomaly[i] >= LETTER_MIN : an.anomaly[i] <= -LETTER_MIN;
      an.deep[i] = deep ? 1 : 0;
    }
    const target = an.since[i] < HOLD ? 1 : 0;
    an.vis[i] += (target - an.vis[i]) * (target > an.vis[i] ? kIn : kOut);
    if (an.vis[i] < 1e-3) an.vis[i] = 0;
    an.letter[i] = an.deep[i] && an.vis[i] > 0 ? 1 : 0;
  }
}
