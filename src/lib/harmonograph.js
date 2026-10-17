// @ts-check
/**
 * Plotter's pen: a decaying harmonograph (two damped pendulums per axis) evaluated at a fixed
 * 600 Hz step, plus the per-cell records it is evaluated from.
 *
 *   x = R e^(−dτ) (0.6 sin(wτ + p1 + kink) + 0.4 sin(w(1+δ)τ + p2))
 *   y = R e^(−dτ) (0.6 sin(wrτ + p3) + 0.4 sin(wr(1−δ)τ + p4)) × (1 − 0.45 width)
 *   then rotated by 0.6 balance and centred in the cell, plus pen chatter.
 *
 * τ = step / 600 s. Everything audio-dependent that moves the pen inside a cell is written into
 * that cell's record as it happens — onset steps and strengths, and 30 Hz slots of pen pressure
 * and chatter — and the pen is evaluated only from the record. So live drawing and a replay after
 * a resize produce the same points, and the result does not depend on the frame rate.
 */

export const STEP_HZ = 600;
/** Steps per frame at most (covers 15 fps). */
export const MAX_STEPS = 40;
/** Steps per 30 Hz pressure / chatter slot. */
export const SLOT_STEPS = STEP_HZ / 30;
export const MAX_CELLS = 24;
export const MAX_ONSETS = 64;
export const MAX_SLOTS = 1024;
/**
 * An onset pushes p1 by KINK_GAIN × strength over KINK_STEPS steps (40 ms, smoothstep) and lets it
 * return over KINK_FALL steps (200 ms): the line takes a visible detour and then rejoins the
 * figure, so many hits don't random-walk the phase and blur the interval's rosette.
 */
export const KINK_STEPS = 24;
export const KINK_FALL = 120;
export const KINK_GAIN = 0.6;
/** Chatter offset per unit of Chatter × clamp(trebAtt − 1, 0, 2), in device px. */
export const CHATTER_PX = 1.2;
/** Largest phase gap (rad) between the two pendulums of one axis at the start of a cell. */
const PAIR_SPREAD = 0.4;
/** Base pendulum period (s) at speed 1. */
export const PERIOD = 0.35;

/** @param {number} speed */
export const angularSpeed = (speed) => ((2 * Math.PI) / PERIOD) * speed;

/**
 * Damping so the amplitude falls to about 1/8 by the end of a `phrase`-second phrase; heavy bass
 * (phrase-mean bassAtt up to 2) slows the decay to 1/8^0.8, leaving bigger figures.
 * @param {number} phrase
 * @param {number} bassAttMean
 */
export function damping(phrase, bassAttMean) {
  const b = Math.min(1, Math.max(0, bassAttMean - 1));
  return (Math.log(8) / phrase) * (1.2 - 0.4 * b);
}

/** Detuning δ between the two pendulums of an axis: brighter phrases precess faster. @param {number} centroidMean */
export function precession(centroidMean) {
  return 0.002 + 0.008 * Math.min(1, Math.max(0, centroidMean));
}

/** Integer hash → 0..1. @param {number} n */
function hash01(n) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Fixed-size records for up to MAX_CELLS cells (one sheet). */
export function createRecords() {
  const f64 = () => new Float64Array(MAX_CELLS);
  return {
    w: f64(),
    ratio: f64(),
    delta: f64(),
    d: f64(),
    p1: f64(),
    p2: f64(),
    p3: f64(),
    p4: f64(),
    width: f64(),
    balance: f64(),
    ink: new Uint8Array(MAX_CELLS),
    /** Steps drawn so far (pen time × 600). */
    steps: new Uint32Array(MAX_CELLS),
    onsets: new Uint8Array(MAX_CELLS),
    onsetStep: new Uint32Array(MAX_CELLS * MAX_ONSETS),
    onsetStr: new Float32Array(MAX_CELLS * MAX_ONSETS),
    /** Slots written so far. */
    slots: new Uint16Array(MAX_CELLS),
    /** Pen pressure (loudness 0–1) × 255 per 30 Hz slot. */
    weight: new Uint8Array(MAX_CELLS * MAX_SLOTS),
    /** clamp(trebAtt − 1, 0, 2) / 2 × 255 per slot. */
    chatter: new Uint8Array(MAX_CELLS * MAX_SLOTS),
  };
}

/** @typedef {ReturnType<typeof createRecords>} Records */

/**
 * Start cell `i` with fresh figure parameters. Allocates nothing.
 * @param {Records} rec
 * @param {number} i
 * @param {number} seed phases come from a hash of this (e.g. sheet × 24 + cell)
 * @param {number} w base angular speed (rad/s)
 * @param {number} ratio y : x frequency ratio
 * @param {number} delta precession
 * @param {number} d damping (1/s)
 * @param {number} width stereo width 0–1
 * @param {number} balance −1..1
 * @param {number} ink colour index within the ink set
 */
export function beginCell(rec, i, seed, w, ratio, delta, d, width, balance, ink) {
  rec.w[i] = w;
  rec.ratio[i] = ratio;
  rec.delta[i] = delta;
  rec.d[i] = d;
  const tau = 2 * Math.PI;
  // The two pendulums of an axis swing at almost the same rate, so their phase gap barely moves
  // within a phrase: start each pair within ±0.4 rad of each other, or a random gap near π
  // cancels them and leaves a figure a fifth of its size.
  rec.p1[i] = tau * hash01(seed * 4 + 1);
  rec.p2[i] = rec.p1[i] + PAIR_SPREAD * (2 * hash01(seed * 4 + 2) - 1);
  rec.p3[i] = tau * hash01(seed * 4 + 3);
  rec.p4[i] = rec.p3[i] + PAIR_SPREAD * (2 * hash01(seed * 4 + 4) - 1);
  rec.width[i] = width;
  rec.balance[i] = balance;
  rec.ink[i] = ink;
  rec.steps[i] = 0;
  rec.onsets[i] = 0;
  rec.slots[i] = 0;
}

/**
 * Note an onset at the cell's current step. Allocates nothing.
 * @param {Records} rec
 * @param {number} i
 * @param {number} strength 0–1
 */
export function recordOnset(rec, i, strength) {
  const n = rec.onsets[i];
  if (n >= MAX_ONSETS) return;
  rec.onsetStep[i * MAX_ONSETS + n] = rec.steps[i];
  rec.onsetStr[i * MAX_ONSETS + n] = Math.min(1, Math.max(0, strength));
  rec.onsets[i] = n + 1;
}

/**
 * Fill every not-yet-written slot that steps below `upTo` fall in. First write wins, so a slot
 * holds the audio of the frame that first drew into it. Allocates nothing.
 * @param {Records} rec
 * @param {number} i
 * @param {number} upTo step count after this frame's steps
 * @param {number} loud 0–1
 * @param {number} chatter clamp(trebAtt − 1, 0, 2)
 */
export function recordSlots(rec, i, upTo, loud, chatter) {
  const need = Math.min(MAX_SLOTS, Math.ceil(upTo / SLOT_STEPS));
  const wq = Math.round(Math.min(1, Math.max(0, loud)) * 255);
  const cq = Math.round((Math.min(2, Math.max(0, chatter)) / 2) * 255);
  for (let s = rec.slots[i]; s < need; s++) {
    rec.weight[i * MAX_SLOTS + s] = wq;
    rec.chatter[i * MAX_SLOTS + s] = cq;
  }
  if (need > rec.slots[i]) rec.slots[i] = need;
}

/**
 * Copy cell `from`'s record to `to` (e.g. when a smaller grid keeps the cell being drawn).
 * @param {Records} rec
 * @param {number} from
 * @param {number} to
 */
export function moveCell(rec, from, to) {
  if (from === to) return;
  for (const a of [rec.w, rec.ratio, rec.delta, rec.d, rec.p1, rec.p2, rec.p3, rec.p4, rec.width, rec.balance]) a[to] = a[from];
  rec.ink[to] = rec.ink[from];
  rec.steps[to] = rec.steps[from];
  rec.onsets[to] = rec.onsets[from];
  rec.slots[to] = rec.slots[from];
  rec.onsetStep.copyWithin(to * MAX_ONSETS, from * MAX_ONSETS, (from + 1) * MAX_ONSETS);
  rec.onsetStr.copyWithin(to * MAX_ONSETS, from * MAX_ONSETS, (from + 1) * MAX_ONSETS);
  rec.weight.copyWithin(to * MAX_SLOTS, from * MAX_SLOTS, (from + 1) * MAX_SLOTS);
  rec.chatter.copyWithin(to * MAX_SLOTS, from * MAX_SLOTS, (from + 1) * MAX_SLOTS);
}

/** Forget every cell (a fresh sheet). @param {Records} rec */
export function clearRecords(rec) {
  rec.steps.fill(0);
  rec.onsets.fill(0);
  rec.slots.fill(0);
}

/** Slot index of a step (clamped to the record). @param {number} step */
export const slotOf = (step) => Math.min(MAX_SLOTS - 1, Math.floor(step / SLOT_STEPS));

/** Evaluator state for one cell at a time; `out` holds up to MAX_STEPS points (x, y). */
export function createPen() {
  return {
    cell: 0,
    cx: 0,
    cy: 0,
    R: 0,
    cos: 1,
    sin: 0,
    sy: 1,
    chatter: 0,
    /** Index of the first onset whose kink is not over yet. */
    kinkDone: 0,
    lastStep: 0,
    count: 0,
    /** Envelope e^(−dτ) at the last evaluated point (for tapering the line). */
    env: 1,
    out: new Float32Array(2 * MAX_STEPS),
  };
}

/**
 * Point the pen at cell `i` laid out at (cx, cy) with radius R. Allocates nothing.
 * @param {ReturnType<typeof createPen>} pen
 * @param {Records} rec
 * @param {number} i
 * @param {number} cx
 * @param {number} cy
 * @param {number} R
 * @param {number} chatter Chatter param (× any reduce-motion factor)
 */
export function penSetup(pen, rec, i, cx, cy, R, chatter) {
  pen.cell = i;
  pen.cx = cx;
  pen.cy = cy;
  pen.R = R;
  const a = 0.6 * rec.balance[i];
  pen.cos = Math.cos(a);
  pen.sin = Math.sin(a);
  pen.sy = 1 - 0.45 * rec.width[i];
  pen.chatter = chatter;
  pen.kinkDone = 0;
  pen.lastStep = 0;
}

/**
 * Evaluate steps `from` … `from + count − 1` (count capped at MAX_STEPS) into `pen.out` as x, y
 * pairs in canvas px. Calls must move forward through a cell (or restart it from a lower step,
 * which recomputes the kinks). Allocates nothing. `pen.env` is left at e^(−dτ) of the last point.
 * @param {ReturnType<typeof createPen>} pen
 * @param {Records} rec
 * @param {number} from
 * @param {number} count
 */
export function penPoints(pen, rec, from, count) {
  const i = pen.cell;
  const n = Math.min(MAX_STEPS, Math.max(0, count));
  pen.count = n;
  if (from < pen.lastStep) pen.kinkDone = 0;
  pen.lastStep = from;
  const w = rec.w[i];
  const wr = w * rec.ratio[i];
  const dl = rec.delta[i];
  const d = rec.d[i];
  const p1 = rec.p1[i];
  const p2 = rec.p2[i];
  const p3 = rec.p3[i];
  const p4 = rec.p4[i];
  const o0 = i * MAX_ONSETS;
  const no = rec.onsets[i];
  const out = pen.out;
  const chat = (pen.chatter * CHATTER_PX * 2) / 255;
  for (let k = 0; k < n; k++) {
    const s = from + k;
    const t = s / STEP_HZ;
    // Skip kinks that are over; the ones in flight add their rise-and-return share.
    while (pen.kinkDone < no && s >= rec.onsetStep[o0 + pen.kinkDone] + KINK_STEPS + KINK_FALL) pen.kinkDone++;
    let kink = 0;
    for (let j = pen.kinkDone; j < no; j++) {
      const at = rec.onsetStep[o0 + j];
      if (at > s) break;
      const u = s - at < KINK_STEPS ? (s - at) / KINK_STEPS : 1 - (s - at - KINK_STEPS) / KINK_FALL;
      kink += KINK_GAIN * rec.onsetStr[o0 + j] * u * u * (3 - 2 * u);
    }
    const env = Math.exp(-d * t);
    pen.env = env;
    const e = pen.R * env;
    const x = e * (0.6 * Math.sin(w * t + p1 + kink) + 0.4 * Math.sin(w * (1 + dl) * t + p2));
    const y = pen.sy * e * (0.6 * Math.sin(wr * t + p3) + 0.4 * Math.sin(wr * (1 - dl) * t + p4));
    const c = chat * rec.chatter[i * MAX_SLOTS + slotOf(s)];
    out[2 * k] = pen.cx + pen.cos * x - pen.sin * y + c * (2 * hash01(s) - 1);
    out[2 * k + 1] = pen.cy + pen.sin * x + pen.cos * y + c * (2 * hash01(s + 0x5bd1e995) - 1);
  }
  return out;
}
