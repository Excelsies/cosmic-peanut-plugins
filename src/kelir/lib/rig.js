// @ts-check
/**
 * Kelir's rig: one 2D affine transform per bone (6 per silhouette, see puppets.js), the stage ->
 * bone inverses the mask shader reads (column-major mat3, uploaded with uniformMatrix3fv), the
 * hand rods' endpoints, and each silhouette's stage-space bounding box (the instanced quad the
 * mask pass draws). Stage units: screen heights, origin bottom-left, y up. Allocates nothing.
 */
import {
  BONES,
  BONES_PER,
  BOX,
  CAPSULE,
  CUT,
  DISC,
  GRIP,
  MIRROR,
  RECORD_FLOATS,
  ROD_END,
  SHOULDER_B,
  SHOULDER_F,
  TRIANGLE,
  UNEVEN,
  UPPER,
  VESICA,
} from "./puppets.js";

/**
 * @typedef {object} Pose
 * @property {number} x @property {number} y stage position of the base centre
 * @property {number} s stage units per puppet unit
 * @property {number} fx x-scale: +1 faces right, -1 left, |fx| < 1 during a flat turn
 * @property {number} rot sway about the base, radians
 * @property {number} bob head offset, puppet units
 * @property {number} shF @property {number} elF front shoulder and elbow, radians (+ = forward/up)
 * @property {number} shB @property {number} elB back shoulder and elbow
 */

/** @returns {Pose} */
export function createPose() {
  return { x: 0, y: 0, s: 1, fx: 1, rot: 0, bob: 0, shF: 0, elF: 0, shB: 0, elB: 0 };
}

export function createRig() {
  return {
    /** Bone -> stage affine [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
    fwd: new Float32Array(BONES * 6),
    /** Stage -> bone, column-major mat3 per bone. */
    inv: new Float32Array(BONES * 9),
    /** Scratch for composing (a, b, c, d, e, f). */
    tmp: new Float64Array(6),
  };
}

/** @typedef {ReturnType<typeof createRig>} Rig */

/**
 * fwd[dst] = fwd[src] * T(tx, ty) * R(angle).
 * @param {Float32Array} m @param {number} src @param {number} dst
 * @param {number} tx @param {number} ty @param {number} angle
 */
function child(m, src, dst, tx, ty, angle) {
  const s = src * 6;
  const d = dst * 6;
  const a = m[s], b = m[s + 1], c = m[s + 2], dd = m[s + 3];
  const e = a * tx + c * ty + m[s + 4];
  const f = b * tx + dd * ty + m[s + 5];
  const co = Math.cos(angle);
  const si = Math.sin(angle);
  m[d] = a * co + c * si;
  m[d + 1] = b * co + dd * si;
  m[d + 2] = -a * si + c * co;
  m[d + 3] = -b * si + dd * co;
  m[d + 4] = e;
  m[d + 5] = f;
}

/** inv[bone] = inverse(fwd[bone]) as a column-major mat3. @param {Rig} rig @param {number} bone */
function invert(rig, bone) {
  const m = rig.fwd;
  const o = bone * 6;
  const a = m[o], b = m[o + 1], c = m[o + 2], d = m[o + 3], e = m[o + 4], f = m[o + 5];
  const det = a * d - b * c || 1e-9;
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  const k = bone * 9;
  const v = rig.inv;
  v[k] = ia;
  v[k + 1] = ib;
  v[k + 2] = 0;
  v[k + 3] = ic;
  v[k + 4] = id;
  v[k + 5] = 0;
  v[k + 6] = -(ia * e + ic * f);
  v[k + 7] = -(ib * e + id * f);
  v[k + 8] = 1;
}

/**
 * Pose silhouette `slot` (0 = A, 1 = B, 2 = kayon): its six bones and their inverses.
 * @param {Rig} rig @param {number} slot @param {Pose} p
 */
export function poseSilhouette(rig, slot, p) {
  const b0 = slot * BONES_PER;
  const m = rig.fwd;
  const o = b0 * 6;
  const co = Math.cos(p.rot);
  const si = Math.sin(p.rot);
  m[o] = co * p.fx * p.s;
  m[o + 1] = si * p.fx * p.s;
  m[o + 2] = -si * p.s;
  m[o + 3] = co * p.s;
  m[o + 4] = p.x;
  m[o + 5] = p.y;
  child(m, b0, b0 + 1, SHOULDER_F[0], SHOULDER_F[1], p.shF);
  child(m, b0 + 1, b0 + 2, 0, -UPPER, p.elF);
  child(m, b0, b0 + 3, SHOULDER_B[0], SHOULDER_B[1], p.shB);
  child(m, b0 + 3, b0 + 4, 0, -UPPER, p.elB);
  child(m, b0, b0 + 5, 0, p.bob, 0);
  for (let b = b0; b < b0 + BONES_PER; b++) invert(rig, b);
}

/**
 * Rewrite puppet `slot`'s two hand rods: from each hand's grip straight down to ROD_END, in body
 * (root bone) coordinates, read back from the posed bones.
 * @param {Float32Array} table @param {Int32Array} rods @param {Rig} rig @param {number} slot 0 or 1
 */
export function rewriteRods(table, rods, rig, slot) {
  const b0 = slot * BONES_PER;
  const inv = rig.inv;
  const m = rig.fwd;
  const r = b0 * 9;
  for (let k = 0; k < 2; k++) {
    const fore = (b0 + 2 + k * 2) * 6;
    // Grip in stage space, then into body space.
    const sx = m[fore + 2] * -GRIP + m[fore + 4];
    const sy = m[fore + 3] * -GRIP + m[fore + 5];
    const bx = inv[r] * sx + inv[r + 3] * sy + inv[r + 6];
    const by = inv[r + 1] * sx + inv[r + 4] * sy + inv[r + 7];
    const o = rods[slot * 2 + k] * RECORD_FLOATS;
    table[o] = bx;
    table[o + 1] = by;
    table[o + 2] = bx;
    table[o + 3] = ROD_END;
  }
}

/**
 * Stage-space bounding box of records [start, start + count) under the posed bones, grown by
 * `pad` stage units, written as (x0, y0, x1, y1) into out[o..o+3].
 * @param {Float32Array} t @param {number} start @param {number} count @param {Rig} rig
 * @param {number} pad @param {Float32Array} out @param {number} o
 */
export function silhouetteBounds(t, start, count, rig, pad, out, o) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const m = rig.fwd;
  for (let i = start; i < start + count; i++) {
    const r = i * RECORD_FLOATS;
    const type = t[r + 6] | 0;
    const base = type & 7;
    if (type & CUT) continue;
    let lx0, ly0, lx1, ly1;
    if (base === CAPSULE || base === UNEVEN) {
      const r1 = t[r + 4];
      const r2 = base === CAPSULE ? r1 : t[r + 5];
      lx0 = Math.min(t[r] - r1, t[r + 2] - r2);
      lx1 = Math.max(t[r] + r1, t[r + 2] + r2);
      ly0 = Math.min(t[r + 1] - r1, t[r + 3] - r2);
      ly1 = Math.max(t[r + 1] + r1, t[r + 3] + r2);
    } else if (base === VESICA) {
      const ux = Math.abs(t[r + 2]);
      const uy = Math.abs(t[r + 3]);
      const ex = uy * t[r + 4] + ux * t[r + 5];
      const ey = ux * t[r + 4] + uy * t[r + 5];
      lx0 = t[r] - ex;
      lx1 = t[r] + ex;
      ly0 = t[r + 1] - ey;
      ly1 = t[r + 1] + ey;
    } else if (base === TRIANGLE) {
      const n = r + RECORD_FLOATS;
      lx0 = Math.min(t[r], t[r + 2], t[n]);
      lx1 = Math.max(t[r], t[r + 2], t[n]);
      ly0 = Math.min(t[r + 1], t[r + 3], t[n + 1]);
      ly1 = Math.max(t[r + 1], t[r + 3], t[n + 1]);
      i++;
    } else if (base === DISC) {
      lx0 = t[r] - t[r + 4];
      lx1 = t[r] + t[r + 4];
      ly0 = t[r + 1] - t[r + 4];
      ly1 = t[r + 1] + t[r + 4];
    } else if (base === BOX) {
      lx0 = t[r] - t[r + 4];
      lx1 = t[r] + t[r + 4];
      ly0 = t[r + 1] - t[r + 5];
      ly1 = t[r + 1] + t[r + 5];
    } else continue;
    if (type & MIRROR) {
      const e = Math.max(Math.abs(lx0), Math.abs(lx1));
      lx0 = -e;
      lx1 = e;
    }
    const b = (t[r + 7] | 0) * 6;
    const a = m[b], bb = m[b + 1], c = m[b + 2], d = m[b + 3], e = m[b + 4], f = m[b + 5];
    // Extremes of the affine image of the local box: centre +- half-extent per axis.
    const cx = (lx0 + lx1) / 2;
    const cy = (ly0 + ly1) / 2;
    const hx = (lx1 - lx0) / 2;
    const hy = (ly1 - ly0) / 2;
    const sx = a * cx + c * cy + e;
    const sy = bb * cx + d * cy + f;
    const ex = Math.abs(a) * hx + Math.abs(c) * hy;
    const ey = Math.abs(bb) * hx + Math.abs(d) * hy;
    if (sx - ex < x0) x0 = sx - ex;
    if (sx + ex > x1) x1 = sx + ex;
    if (sy - ey < y0) y0 = sy - ey;
    if (sy + ey > y1) y1 = sy + ey;
  }
  out[o] = x0 - pad;
  out[o + 1] = y0 - pad;
  out[o + 2] = x1 + pad;
  out[o + 3] = y1 + pad;
}
