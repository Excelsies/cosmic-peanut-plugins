// @ts-check
import { describe, expect, it } from "vitest";
import { gridOf, placeLayout, SHAPE_OF_PC, SLOT } from "./layout.js";
import { plateOf, tintPlateOf } from "./misregister-params.js";
import { packShapes, RAMP_LO, TINT } from "./poster.js";

const grid = gridOf(2560, 1440, {});
const layout = placeLayout(0, grid.cols, grid.rows, new Float32Array(12 * SLOT));

/** Corner of pitch class pc's packed (unrotated) rectangle nearest its anchor. @param {Float32Array} u @param {number} pc */
function anchorCorner(u, pc) {
  const o = pc * 12;
  const cx = u[o];
  const cy = u[o + 1];
  const hx = u[o + 2];
  const hy = u[o + 3];
  const ax = grid.x0 + layout[pc * SLOT + 2] * grid.cellW;
  const ay = grid.y0 + layout[pc * SLOT + 3] * grid.cellH;
  let best = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    // Rotated rect: world half extents swap at 90°/270°.
    const quarter = Math.abs(u[o + 6]) > 0.5; // sin of the rotation: 90° or 270°
    const wx = quarter ? hy : hx;
    const wy = quarter ? hx : hy;
    best = Math.min(best, Math.hypot(cx + sx * wx - ax, cy + sy * wy - ay));
  }
  return best;
}

describe("packShapes", () => {
  it("packs 12 shapes × 3 vec4: centre/half size, type/cos/sin/mirror, ramp/dot/plates", () => {
    const u = new Float32Array(144);
    const swell = new Float32Array(12).fill(1);
    packShapes(layout, swell, new Float32Array(12), grid, u);
    for (let pc = 0; pc < 12; pc++) {
      const o = pc * 12;
      expect(u[o + 4]).toBe(SHAPE_OF_PC[pc]);
      const angle = (layout[pc * SLOT + 6] * Math.PI) / 180;
      expect(u[o + 5]).toBeCloseTo(Math.cos(angle), 6);
      expect(u[o + 6]).toBeCloseTo(Math.sin(angle), 6);
      expect(Math.abs(u[o + 7])).toBe(1);
      // Primary plate + 3 × tint plate, decoded in plates.frag.
      expect(u[o + 11] % 3).toBe(plateOf(pc));
      expect(Math.floor(u[o + 11] / 3)).toBe(tintPlateOf(pc));
      expect(u[o + 8]).toBeCloseTo(RAMP_LO, 6);
      expect(u[o + 9]).toBeCloseTo(1, 6);
      // Full swell fills the slot's cells exactly.
      const lw = layout[pc * SLOT + 4];
      const quarter = layout[pc * SLOT + 6] % 180 !== 0;
      expect(u[o + 2] * 2).toBeCloseTo(lw * (quarter ? grid.cellH : grid.cellW), 3);
    }
    expect(RAMP_LO).toBe(0.3);
    expect(TINT).toBe(0.22);
  });

  it("swells each shape from its grid-anchored corner: 55% at rest, 100% at full swell", () => {
    const u0 = new Float32Array(144);
    const u1 = new Float32Array(144);
    packShapes(layout, new Float32Array(12), new Float32Array(12), grid, u0);
    packShapes(layout, new Float32Array(12).fill(1), new Float32Array(12), grid, u1);
    for (let pc = 0; pc < 12; pc++) {
      expect(u0[pc * 12 + 2] / u1[pc * 12 + 2]).toBeCloseTo(0.55, 5);
      expect(u0[pc * 12 + 9]).toBeCloseTo(0.55, 6);
      expect(anchorCorner(u0, pc)).toBeLessThan(1e-3);
      expect(anchorCorner(u1, pc)).toBeLessThan(1e-3);
    }
  });

  it("adds the onset dot swell to the ramp", () => {
    const u = new Float32Array(144);
    const dot = new Float32Array(12);
    dot[4] = 0.15;
    packShapes(layout, new Float32Array(12), dot, grid, u);
    expect(u[4 * 12 + 10]).toBeCloseTo(0.15, 6);
    expect(u[0 * 12 + 10]).toBe(0);
  });

  it("squeezes a mirroring shape to a sliver at mid-flip instead of popping", () => {
    const mid = layout.slice();
    mid[7] = 0;
    const u = new Float32Array(144);
    packShapes(mid, new Float32Array(12).fill(1), new Float32Array(12), grid, u);
    expect(u[2]).toBeGreaterThan(0);
    expect(u[2]).toBeLessThan(0.05 * layout[4] * grid.cellW);
  });
});
