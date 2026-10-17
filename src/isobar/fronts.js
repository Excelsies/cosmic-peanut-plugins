// @ts-check
/**
 * Isobar's weather fronts, in device pixels, into preallocated buffers.
 *
 * Every low older than 2 beats carries a cold front (a quadratic Bezier trailing south-south-west
 * that swings toward south-south-east as the low ages) and a warm front (east-south-east, bending
 * south). Between 16 and 32 beats an occluded front grows from the centre along their bisector
 * and both fronts start from its end. The fronts grow in over 2-6 beats and shrink away while the
 * low fills (32-48).
 *
 * Glyphs sit on each front's leading side, every 22 css px: triangles on the cold front (toward
 * the warm sector), semicircles on the warm front (away from it), alternating on the occluded one,
 * so the kinds differ by shape, not only by colour. Rain is a stipple of dots at hashed offsets
 * behind the cold front and ahead of the warm one, keyed to the arc length so it travels with the
 * front. Nothing here allocates after createFronts.
 */
import { hash01 } from "./hash.js";
import { LOW_LIFE, MAX_LOWS } from "./pressure.js";

export const OCCLUDED = 0;
export const COLD = 1;
export const WARM = 2;
export const FRONT_PTS = 24;
const CURVES = MAX_LOWS * 3;
const MAX_GLYPHS = 2048;
const MAX_RAIN = 16000;
const DEG = Math.PI / 180;

/** @param {number} t */
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function createFronts() {
  return {
    /** x, y per point, FRONT_PTS per curve; curve index = slot * 3 + kind. */
    pts: new Float32Array(CURVES * FRONT_PTS * 2),
    active: new Uint8Array(CURVES),
    /** Stable id per curve, for the rain hash. */
    fid: new Int32Array(CURVES),
    /** Centre of each low (px), for the warm-sector tint. */
    centre: new Float32Array(MAX_LOWS * 2),
    /** x, y, tangent angle, shape (0 triangle, 1 semicircle), kind per glyph. */
    glyphs: new Float32Array(MAX_GLYPHS * 5),
    nGlyphs: 0,
    /** x, y per rain dot. */
    rain: new Float32Array(MAX_RAIN * 2),
    nRain: 0,
  };
}

/** @typedef {ReturnType<typeof createFronts>} Fronts */

/**
 * Samples a quadratic Bezier into curve `c`.
 * @param {Fronts} f @param {number} c
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 */
function bezier(f, c, x0, y0, x1, y1, x2, y2) {
  const o = c * FRONT_PTS * 2;
  for (let k = 0; k < FRONT_PTS; k++) {
    const t = k / (FRONT_PTS - 1);
    const u = 1 - t;
    f.pts[o + 2 * k] = u * u * x0 + 2 * u * t * x1 + t * t * x2;
    f.pts[o + 2 * k + 1] = u * u * y0 + 2 * u * t * y1 + t * t * y2;
  }
  f.active[c] = 1;
}

/**
 * Lays out the fronts of every live low older than 2 beats.
 * @param {import('./pressure.js').Pressure} st
 * @param {Fronts} f
 * @param {number} scale device px per chart unit (the canvas height)
 * @param {number} sweepEff front-sweep multiplier (0.5 under Reduce motion)
 */
export function buildFronts(st, f, scale, sweepEff) {
  f.active.fill(0);
  for (let i = 0; i < MAX_LOWS; i++) {
    const age = st.ageBeats[i];
    if (!st.alive[i] || age <= 2) continue;
    const cx = st.x[i] * scale;
    const cy = st.y[i] * scale;
    f.centre[2 * i] = cx;
    f.centre[2 * i + 1] = cy;
    const R = 2.2 * st.sigma[i] * scale;
    const grow = smooth((age - 2) / 4) * (1 - smooth((age - 32) / (LOW_LIFE - 32)));
    const ac = Math.max(60, 110 - (50 / 32) * (age - 2) * sweepEff) * DEG;
    const aw = 20 * DEG;
    // Occlusion: grows over 16-22 beats, retreats over 28-32.
    let ox = cx;
    let oy = cy;
    if (age >= 16 && age < 32) {
      const len = 0.6 * R * smooth((age - 16) / 6) * (1 - smooth((age - 28) / 4));
      const ab = (ac + aw) / 2;
      ox = cx + len * Math.cos(ab);
      oy = cy + len * Math.sin(ab);
      if (len > 0.5) {
        const c = i * 3 + OCCLUDED;
        bezier(f, c, cx, cy, (cx + ox) / 2, (cy + oy) / 2, ox, oy);
        f.fid[c] = st.id[i] * 3 + OCCLUDED;
      }
    }
    const L = R * grow;
    if (L < 1) continue;
    let c = i * 3 + COLD;
    const ce = ac + 25 * DEG;
    bezier(f, c, ox, oy, ox + L * Math.cos(ac), oy + L * Math.sin(ac), ox + 2 * L * Math.cos(ce), oy + 2 * L * Math.sin(ce));
    f.fid[c] = st.id[i] * 3 + COLD;
    c = i * 3 + WARM;
    const we = aw + 15 * DEG;
    bezier(f, c, ox, oy, ox + L * Math.cos(aw), oy + L * Math.sin(aw), ox + 1.8 * L * Math.cos(we), oy + 1.8 * L * Math.sin(we));
    f.fid[c] = st.id[i] * 3 + WARM;
  }
}

/** Arc length of curve c in px. @param {Fronts} f @param {number} c */
export function curveLength(f, c) {
  const o = c * FRONT_PTS * 2;
  let len = 0;
  for (let k = 1; k < FRONT_PTS; k++) {
    len += Math.hypot(f.pts[o + 2 * k] - f.pts[o + 2 * k - 2], f.pts[o + 2 * k + 1] - f.pts[o + 2 * k - 1]);
  }
  return len;
}

/**
 * Places glyphs every 22 * s px along every active front (s = dpr x chart glyph scale).
 * @param {Fronts} f @param {number} s
 */
export function placeGlyphs(f, s) {
  const spacing = 22 * s;
  const { pts, glyphs } = f;
  let n = 0;
  for (let c = 0; c < CURVES && n < MAX_GLYPHS; c++) {
    if (!f.active[c]) continue;
    const kind = c % 3;
    const o = c * FRONT_PTS * 2;
    let next = spacing / 2; // arc length of the next glyph
    let walked = 0;
    let idx = 0;
    for (let k = 1; k < FRONT_PTS && n < MAX_GLYPHS; k++) {
      const x0 = pts[o + 2 * k - 2];
      const y0 = pts[o + 2 * k - 1];
      const dx = pts[o + 2 * k] - x0;
      const dy = pts[o + 2 * k + 1] - y0;
      const seg = Math.sqrt(dx * dx + dy * dy);
      if (seg <= 0) continue;
      const a = Math.atan2(dy, dx);
      while (next <= walked + seg && n < MAX_GLYPHS) {
        const t = (next - walked) / seg;
        const w = n * 5;
        glyphs[w] = x0 + t * dx;
        glyphs[w + 1] = y0 + t * dy;
        glyphs[w + 2] = a;
        glyphs[w + 3] = kind === COLD ? 0 : kind === WARM ? 1 : idx % 2;
        glyphs[w + 4] = kind;
        n++;
        idx++;
        next += spacing;
      }
      walked += seg;
    }
  }
  f.nGlyphs = n;
}

/**
 * Rain dots along the cold (behind it, up to 40 px) and warm (ahead of it, up to 80 px) fronts:
 * one candidate per 7 css px of arc and row (4 rows), kept when its hash is below `density`.
 * @param {Fronts} f @param {number} density 0-1 @param {number} dpr
 */
export function placeRain(f, density, dpr) {
  const step = 7 * dpr;
  const { pts, rain } = f;
  let n = 0;
  for (let c = 0; c < CURVES; c++) {
    const kind = c % 3;
    if (!f.active[c] || kind === OCCLUDED) continue;
    const o = c * FRONT_PTS * 2;
    const seed = f.fid[c] * 997;
    const depth = (kind === COLD ? -40 : 80) * dpr; // along the leading normal
    let slot = 0;
    let walked = 0;
    let next = 0;
    for (let k = 1; k < FRONT_PTS && n < MAX_RAIN; k++) {
      const x0 = pts[o + 2 * k - 2];
      const y0 = pts[o + 2 * k - 1];
      const dx = pts[o + 2 * k] - x0;
      const dy = pts[o + 2 * k + 1] - y0;
      const seg = Math.sqrt(dx * dx + dy * dy);
      if (seg <= 0) continue;
      const tx = dx / seg;
      const ty = dy / seg;
      while (next <= walked + seg && n < MAX_RAIN) {
        const t = (next - walked) / seg;
        const px = x0 + t * dx;
        const py = y0 + t * dy;
        for (let row = 0; row < 4 && n < MAX_RAIN; row++) {
          const h = seed + slot * 4 + row;
          if (hash01(h) >= density) continue;
          const off = depth * hash01(h + 0x51ed27);
          const along = step * (hash01(h + 0x2c1b3) - 0.5);
          rain[2 * n] = px + tx * along + ty * off;
          rain[2 * n + 1] = py + ty * along - tx * off;
          n++;
        }
        slot++;
        next += step;
      }
      walked += seg;
    }
  }
  f.nRain = n;
}

/**
 * Appends every active curve of `kind` to the current path (caller owns beginPath and stroke).
 * @param {CanvasRenderingContext2D} g @param {Fronts} f @param {number} kind
 */
export function pathCurves(g, f, kind) {
  for (let c = kind; c < CURVES; c += 3) {
    if (!f.active[c]) continue;
    const o = c * FRONT_PTS * 2;
    g.moveTo(f.pts[o], f.pts[o + 1]);
    for (let k = 1; k < FRONT_PTS; k++) g.lineTo(f.pts[o + 2 * k], f.pts[o + 2 * k + 1]);
  }
}

/**
 * Appends the glyphs of one front kind (caller owns beginPath and fill). Triangles: 9 px base
 * along the front, 8 px high; semicircles: radius 5 px; both times s.
 * @param {CanvasRenderingContext2D} g @param {Fronts} f @param {number} kind @param {number} s
 */
export function pathGlyphs(g, f, kind, s) {
  const { glyphs } = f;
  for (let k = 0; k < f.nGlyphs; k++) {
    const o = k * 5;
    if (glyphs[o + 4] !== kind) continue;
    const x = glyphs[o];
    const y = glyphs[o + 1];
    const a = glyphs[o + 2];
    const tx = Math.cos(a);
    const ty = Math.sin(a);
    if (glyphs[o + 3] === 0) {
      g.moveTo(x - tx * 4.5 * s, y - ty * 4.5 * s);
      g.lineTo(x + ty * 8 * s, y - tx * 8 * s); // apex on the leading side (ty, -tx)
      g.lineTo(x + tx * 4.5 * s, y + ty * 4.5 * s);
    } else {
      g.moveTo(x - tx * 5 * s, y - ty * 5 * s);
      g.arc(x, y, 5 * s, a + Math.PI, a); // clockwise through a - 90 deg: the leading side
    }
    g.closePath();
  }
}

/** Appends a size x size rect per rain dot. @param {CanvasRenderingContext2D} g @param {Fronts} f @param {number} size */
export function pathRain(g, f, size) {
  const { rain } = f;
  const h = size / 2;
  for (let k = 0; k < f.nRain; k++) g.rect(rain[2 * k] - h, rain[2 * k + 1] - h, size, size);
}

/**
 * Appends each low's warm sector: centre, then the cold front, then the warm front backwards.
 * @param {CanvasRenderingContext2D} g @param {Fronts} f
 */
export function pathTint(g, f) {
  const { pts } = f;
  for (let i = 0; i < MAX_LOWS; i++) {
    const cold = i * 3 + COLD;
    const warm = i * 3 + WARM;
    if (!f.active[cold] || !f.active[warm]) continue;
    g.moveTo(f.centre[2 * i], f.centre[2 * i + 1]);
    let o = cold * FRONT_PTS * 2;
    for (let k = 0; k < FRONT_PTS; k++) g.lineTo(pts[o + 2 * k], pts[o + 2 * k + 1]);
    o = warm * FRONT_PTS * 2;
    for (let k = FRONT_PTS - 1; k >= 0; k--) g.lineTo(pts[o + 2 * k], pts[o + 2 * k + 1]);
    g.closePath();
  }
}
