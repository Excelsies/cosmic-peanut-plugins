// @ts-check
import { describe, expect, it } from "vitest";
import { FORE, GRIP, MAX_RECORDS, RECORD_FLOATS, ROD_END, SHOULDER_F, UPPER, boneBase, buildCast, sdfRange } from "./puppets.js";
import { createPose, createRig, poseSilhouette, rewriteRods, silhouetteBounds } from "./rig.js";
import { BACK_ELBOW, BACK_REST } from "./stage.js";

const table = new Float32Array(MAX_RECORDS * RECORD_FLOATS);
const cast = buildCast(table);

/** Apply bone b's forward transform to (x, y). @param {Float32Array} fwd @param {number} b */
function apply(fwd, b, /** @type {number} */ x, /** @type {number} */ y) {
  const o = b * 6;
  return [fwd[o] * x + fwd[o + 2] * y + fwd[o + 4], fwd[o + 1] * x + fwd[o + 3] * y + fwd[o + 5]];
}
/** Apply bone b's inverse (column-major mat3). @param {Float32Array} inv @param {number} b */
function applyInv(inv, b, /** @type {number} */ x, /** @type {number} */ y) {
  const m = b * 9;
  return [inv[m] * x + inv[m + 3] * y + inv[m + 6], inv[m + 1] * x + inv[m + 4] * y + inv[m + 7]];
}

describe("poseSilhouette", () => {
  it("places the root at the stage point at the given scale and facing", () => {
    const rig = createRig();
    const pose = createPose();
    Object.assign(pose, { x: 0.6, y: 0.1, s: 0.8, fx: 1 });
    poseSilhouette(rig, 0, pose);
    expect(apply(rig.fwd, 0, 0, 0)).toEqual([expect.closeTo(0.6, 6), expect.closeTo(0.1, 6)]);
    expect(apply(rig.fwd, 0, 0, 1)[1]).toBeCloseTo(0.9, 6);
    expect(apply(rig.fwd, 0, 0.1, 0)[0]).toBeCloseTo(0.68, 6);
    pose.fx = -1;
    poseSilhouette(rig, 1, pose);
    expect(apply(rig.fwd, 6, 0.1, 0)[0]).toBeCloseTo(0.52, 6);
  });

  it("uploads exact inverses of every bone", () => {
    const rig = createRig();
    const pose = createPose();
    Object.assign(pose, { x: 1.2, y: 0.3, s: 0.7, fx: -0.4, rot: 0.2, bob: -0.01, shF: 0.9, elF: 0.5, shB: 0.3, elB: 0.2 });
    poseSilhouette(rig, 1, pose);
    for (let b = 6; b < 12; b++) {
      const [sx, sy] = apply(rig.fwd, b, 0.03, -0.07);
      const [lx, ly] = applyInv(rig.inv, b, sx, sy);
      expect(lx).toBeCloseTo(0.03, 5);
      expect(ly).toBeCloseTo(-0.07, 5);
    }
  });

  it("chains the arm: hanging at rest, raised forward by a positive shoulder angle", () => {
    const rig = createRig();
    const pose = createPose();
    Object.assign(pose, { s: 1, fx: 1 });
    poseSilhouette(rig, 0, pose);
    const [hx, hy] = apply(rig.fwd, 2, 0, -FORE);
    expect(hx).toBeCloseTo(SHOULDER_F[0], 6);
    expect(hy).toBeCloseTo(SHOULDER_F[1] - UPPER - FORE, 6);
    pose.shF = Math.PI / 2;
    poseSilhouette(rig, 0, pose);
    const [ex, ey] = apply(rig.fwd, 2, 0, 0);
    expect(ex).toBeCloseTo(SHOULDER_F[0] + UPPER, 6);
    expect(ey).toBeCloseTo(SHOULDER_F[1], 6);
  });

  it("rests the back arm behind the body, its forearm and hand clear of the torso and legs", () => {
    const rig = createRig();
    const pose = createPose();
    Object.assign(pose, { s: 1, fx: 1, shB: BACK_REST, elB: BACK_ELBOW });
    poseSilhouette(rig, 0, pose);
    for (let k = 0; k <= 20; k++) {
      const [x, y] = apply(rig.fwd, 4, 0, (-k / 20) * (FORE + 0.08));
      expect(x).toBeLessThan(-0.1);
      expect(y).toBeGreaterThan(0.1);
    }
  });

  it("bobs only the head bone", () => {
    const rig = createRig();
    const pose = createPose();
    Object.assign(pose, { s: 1, fx: 1, bob: -0.008 });
    poseSilhouette(rig, 0, pose);
    expect(apply(rig.fwd, 5, 0, 0.7)[1]).toBeCloseTo(0.692, 6);
    expect(apply(rig.fwd, 0, 0, 0.7)[1]).toBeCloseTo(0.7, 6);
  });
});

describe("rewriteRods", () => {
  it("runs each hand rod from the grip straight down off the bottom, in body coordinates", () => {
    const rig = createRig();
    const pose = createPose();
    Object.assign(pose, { x: 0.5, y: 0.1, s: 0.8, fx: 1, shF: 1, elF: 0.4 });
    poseSilhouette(rig, 0, pose);
    rewriteRods(table, cast.rods, rig, 0);
    const o = cast.rods[0] * RECORD_FLOATS;
    // The grip in stage space is the front forearm's grip point.
    const [gx, gy] = apply(rig.fwd, 2, 0, -GRIP);
    const [bx, by] = apply(rig.fwd, 0, table[o], table[o + 1]);
    expect(bx).toBeCloseTo(gx, 5);
    expect(by).toBeCloseTo(gy, 5);
    expect(table[o + 2]).toBeCloseTo(table[o], 6);
    expect(table[o + 3]).toBeCloseTo(ROD_END, 6);
  });
});

describe("silhouetteBounds", () => {
  it("contains the whole posed figure plus the padding, rods included", () => {
    const rig = createRig();
    const pose = createPose();
    Object.assign(pose, { x: 1, y: 0.2, s: 0.7, fx: -1, rot: 0.1, shF: 1.2, elF: 0.6 });
    poseSilhouette(rig, 1, pose);
    rewriteRods(table, cast.rods, rig, 1);
    const box = new Float32Array(4);
    silhouetteBounds(table, cast.ranges[2], cast.ranges[3], rig, boneBase(1), 0.05, box, 0);
    const q = new Float64Array(3);
    let inside = 0;
    for (let i = 0; i <= 60; i++) {
      for (let j = 0; j <= 60; j++) {
        const x = -0.5 + (i / 60) * 3;
        const y = -1 + (j / 60) * 2.5;
        if (y >= 0 && sdfRange(table, cast.ranges[2], cast.ranges[3], rig.inv, boneBase(1), x, y, q) < 0.05 * 0.7) {
          inside++;
          expect(x).toBeGreaterThanOrEqual(box[0]);
          expect(y).toBeGreaterThanOrEqual(box[1]);
          expect(x).toBeLessThanOrEqual(box[2]);
          expect(y).toBeLessThanOrEqual(box[3]);
        }
      }
    }
    expect(inside).toBeGreaterThan(20);
    // The rods run off the bottom; the box stops at the screen's bottom edge (y = 0).
    expect(box[1]).toBe(0);
  });

  it("covers the kayon's mirrored half", () => {
    const rig = createRig();
    const pose = createPose();
    Object.assign(pose, { x: 0.9, y: 0.1, s: 0.6, fx: 1 });
    poseSilhouette(rig, 2, pose);
    const box = new Float32Array(4);
    silhouetteBounds(table, cast.ranges[4], cast.ranges[5], rig, boneBase(2), 0, box, 0);
    expect(box[0]).toBeCloseTo(0.9 - 0.27 * 0.6, 2);
    expect(box[2]).toBeCloseTo(0.9 + 0.27 * 0.6, 2);
    expect(box[3]).toBeCloseTo(0.1 + 0.6, 2);
  });
});
