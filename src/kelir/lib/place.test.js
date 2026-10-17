// @ts-check
import { describe, expect, it } from "vitest";
import { BASE_Y, KAYON_H, LAMP_Y, PUPPET_H, placeSilhouette } from "./place.js";
import { createPose } from "./rig.js";
import { PUPPET_REST } from "./stage.js";

const sil = (/** @type {Record<string, number>} */ o) => ({ visible: true, x: 0.3, d: PUPPET_REST, opacity: 1, fx: 1, rot: 0, bob: 0, shF: 0, elF: 0, shB: 0, elB: 0, ...o });

describe("placeSilhouette", () => {
  it("stands a resting puppet 0.78 screen heights tall on the baseline at 0.88 H", () => {
    const pose = createPose();
    placeSilhouette(sil({}), false, 16 / 9, 0, 0, pose);
    expect(pose.s).toBeCloseTo(PUPPET_H, 9);
    expect(PUPPET_H).toBe(0.78);
    expect(pose.y).toBeCloseTo(BASE_Y, 9);
    expect(BASE_Y).toBeCloseTo(1 - 0.88, 9);
    expect(pose.x).toBeCloseTo(0.3 * (16 / 9), 9);
  });

  it("shrinks a lunging puppet's shadow toward the lamp, and grows a far one", () => {
    const near = createPose();
    const far = createPose();
    const aspect = 16 / 9;
    placeSilhouette(sil({ d: 0 }), false, aspect, 0, 0, near);
    placeSilhouette(sil({ d: 1 }), false, aspect, 0, 0, far);
    expect(near.s).toBeCloseTo(PUPPET_H / (1 + 0.6 * PUPPET_REST), 9);
    expect(far.s / near.s).toBeCloseTo(1.6, 9);
    // Projected from the lamp at (0.5 W, LAMP_Y): nearer the lamp's point when near the screen.
    expect(Math.abs(near.x - 0.5 * aspect)).toBeLessThan(Math.abs(far.x - 0.5 * aspect));
    expect(near.y).toBeGreaterThan(BASE_Y);
    expect((near.y - LAMP_Y) / (BASE_Y - LAMP_Y)).toBeCloseTo(near.s / PUPPET_H, 9);
  });

  it("shifts with the flame by its distance from the screen (parallax)", () => {
    const a = createPose();
    const b = createPose();
    placeSilhouette(sil({ d: 0.5 }), false, 1.5, 0, 0, a);
    placeSilhouette(sil({ d: 0.5 }), false, 1.5, 0.01, -0.02, b);
    expect(b.x - a.x).toBeCloseTo(0.005, 9);
    expect(b.y - a.y).toBeCloseTo(-0.01, 9);
  });

  it("sizes the kayon on its own and copies the motion through", () => {
    const pose = createPose();
    placeSilhouette(sil({ fx: -0.3, rot: 0.02, bob: -0.004, shF: 1, elF: 0.5, shB: 0.4, elB: 0.3 }), true, 1, 0, 0, pose);
    expect(pose.s).toBeCloseTo(KAYON_H, 9);
    expect([pose.fx, pose.rot, pose.bob, pose.shF, pose.elF, pose.shB, pose.elB]).toEqual([-0.3, 0.02, -0.004, 1, 0.5, 0.4, 0.3]);
  });
});
