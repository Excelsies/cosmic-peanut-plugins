// @ts-check
/**
 * From the stage's silhouettes (width fractions, distances) to rig poses in stage units (screen
 * heights, y up). A shadow is the figure projected from the lamp onto the screen: it scales by
 * 1 + 0.6 d about the lamp's point, normalised so a puppet at rest is PUPPET_H tall on the
 * baseline, and moves with the flame by its distance (parallax). Allocates nothing.
 */
import { PUPPET_REST } from "./stage.js";

export const PUPPET_H = 0.78;
export const KAYON_H = 0.85;
/** Baseline at 0.88 of the screen height from the top; the lamp's hotspot at 0.42. */
export const BASE_Y = 1 - 0.88;
export const LAMP_Y = 1 - 0.42;
const NORM = 1 + 0.6 * PUPPET_REST;

/**
 * @param {import('./stage.js').Silhouette} s
 * @param {boolean} kayon @param {number} aspect width / height
 * @param {number} lx @param {number} ly flame offset, stage units
 * @param {import('./rig.js').Pose} pose
 */
export function placeSilhouette(s, kayon, aspect, lx, ly, pose) {
  const k = (1 + 0.6 * s.d) / NORM;
  const cx = 0.5 * aspect;
  pose.x = cx + (s.x * aspect - cx) * k + lx * s.d;
  pose.y = LAMP_Y + (BASE_Y - LAMP_Y) * k + ly * s.d;
  pose.s = (kayon ? KAYON_H : PUPPET_H) * k;
  pose.fx = s.fx;
  pose.rot = s.rot;
  pose.bob = s.bob;
  pose.shF = s.shF;
  pose.elF = s.elF;
  pose.shB = s.shB;
  pose.elB = s.elB;
  return pose;
}
