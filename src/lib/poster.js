// @ts-check
/**
 * Packs Misregister's 12 shapes into the plate shader's `uniform vec4 uShape[36]`: per pitch
 * class three vec4s,
 *   [centre x, centre y, half width, half height]   device px, y down from the canvas top
 *   [shape type, plate, angle (rad, clockwise), mirror (±1)]
 *   [ramp low, ramp high, onset dot swell, 0]
 * A shape of swell s is scaled by 0.55 + 0.45·s about its grid-anchored corner (so the corner
 * stays on its grid lines) and its ink ramps from 30% to 0.55 + 0.45·s along its own x axis.
 * Allocates nothing.
 */
import { SHAPE_OF_PC, SLOT } from "./layout.js";
import { plateOf } from "./misregister-params.js";

export const RAMP_LO = 0.3;
/** Narrowest a mirroring shape gets at mid-flip, as a fraction of its width. */
const MIN_FLIP = 0.02;

/**
 * @param {Float32Array} layout tweened placed layout (layout.js, 12 × SLOT, cells)
 * @param {Float32Array} swell 12 swells 0–1 (swell.js)
 * @param {Float32Array} dot 12 onset dot swells
 * @param {{ x0: number, y0: number, cellW: number, cellH: number }} grid from gridOf
 * @param {Float32Array} out 144 floats
 */
export function packShapes(layout, swell, dot, grid, out) {
  const { x0, y0, cellW, cellH } = grid;
  for (let pc = 0; pc < 12; pc++) {
    const l = pc * SLOT;
    const o = pc * 12;
    const s = 0.55 + 0.45 * swell[pc];
    const ax = x0 + layout[l + 2] * cellW;
    const ay = y0 + layout[l + 3] * cellH;
    const cx = x0 + layout[l] * cellW;
    const cy = y0 + layout[l + 1] * cellH;
    const angle = (layout[l + 6] * Math.PI) / 180;
    const q = Math.abs(Math.sin(angle));
    const flip = layout[l + 7];
    out[o] = ax + (cx - ax) * s;
    out[o + 1] = ay + (cy - ay) * s;
    out[o + 2] = 0.5 * layout[l + 4] * (cellW + (cellH - cellW) * q) * s * Math.max(Math.abs(flip), MIN_FLIP);
    out[o + 3] = 0.5 * layout[l + 5] * (cellH + (cellW - cellH) * q) * s;
    out[o + 4] = SHAPE_OF_PC[pc];
    out[o + 5] = plateOf(pc);
    out[o + 6] = angle;
    out[o + 7] = flip < 0 ? -1 : 1;
    out[o + 8] = RAMP_LO;
    out[o + 9] = 0.55 + 0.45 * swell[pc];
    out[o + 10] = dot[pc];
    out[o + 11] = 0;
  }
  return out;
}
