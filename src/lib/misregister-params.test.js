// @ts-check
import { describe, expect, it } from "vitest";
import {
  cellSize,
  DEFAULT_RELAYOUT,
  DEFAULTS,
  MIN_CELL_PX,
  PALETTE_NAMES,
  PALETTES,
  PAPER_NAMES,
  PAPERS,
  plateOf,
  RELAYOUT_OPTIONS,
  resolveParams,
  tintPlateOf,
} from "./misregister-params.js";

const fresh = () => resolveParams({}, false, {
  palette: 0, paper: 0, screen: 0, misregister: 0, grain: 0, reactivity: 0,
  relayoutBars: 0, slideSeconds: 0, joltScale: 0, shimmer: 0,
});

describe("resolveParams", () => {
  it("resolves the manifest defaults", () => {
    const r = resolveParams(DEFAULTS, false, fresh());
    expect(r).toEqual({
      palette: 0, paper: 0, screen: 90, misregister: 0.5, grain: 0.4, reactivity: 1,
      relayoutBars: 8, slideSeconds: 1.5, joltScale: 1, shimmer: 1,
    });
    expect(DEFAULT_RELAYOUT).toBe("8 bars");
    expect(DEFAULTS.relayout).toBe(DEFAULT_RELAYOUT);
  });

  it("falls back to the defaults for unknown selects and non-numbers (the harness flip test)", () => {
    const r = resolveParams(
      { palette: "rings", paper: "#33ff66", relayout: "16", screen: "x", misregister: NaN, grain: true, reactivity: undefined, mode: "bars" },
      false,
      fresh(),
    );
    expect([r.palette, r.paper, r.relayoutBars, r.screen, r.misregister, r.grain, r.reactivity]).toEqual([0, 0, 8, 90, 0.5, 0.4, 1]);
  });

  it("clamps numbers into their manifest ranges", () => {
    const r = resolveParams({ screen: 15, misregister: 3, grain: -1, reactivity: 9 }, false, fresh());
    expect([r.screen, r.misregister, r.grain, r.reactivity]).toEqual([30, 1, 0, 2]);
    const s = resolveParams({ screen: 1000 }, false, fresh());
    expect(s.screen).toBe(160);
  });

  it("maps every option to its index / bar count", () => {
    for (let i = 0; i < PALETTE_NAMES.length; i++) {
      expect(resolveParams({ palette: PALETTE_NAMES[i] }, false, fresh()).palette).toBe(i);
      expect(PALETTES[i]).toHaveLength(3);
    }
    for (let i = 0; i < PAPER_NAMES.length; i++) {
      expect(resolveParams({ paper: PAPER_NAMES[i] }, false, fresh()).paper).toBe(i);
    }
    expect(PAPERS[PAPER_NAMES.indexOf("none")]).toBe("");
    expect(RELAYOUT_OPTIONS.map((o) => resolveParams({ relayout: o }, false, fresh()).relayoutBars)).toEqual([8, 16, 32, 0]);
  });

  it("calms motion under Reduce motion, the re-layout and jolt only while at their defaults", () => {
    const r = resolveParams(DEFAULTS, true, fresh());
    expect([r.relayoutBars, r.slideSeconds, r.joltScale, r.shimmer]).toEqual([32, 4, 0.5, 0]);
    const u = resolveParams({ ...DEFAULTS, relayout: "16 bars", misregister: 0.8 }, true, fresh());
    expect([u.relayoutBars, u.joltScale]).toEqual([16, 1]);
    expect(resolveParams({ ...DEFAULTS, relayout: "never" }, true, fresh()).relayoutBars).toBe(0);
  });
});

describe("cellSize", () => {
  it("is the canvas height over the screen ruling, floored at 5 device px", () => {
    expect(cellSize(1440, 90)).toBe(16);
    expect(cellSize(720, 90)).toBe(8);
    expect(cellSize(400, 160)).toBe(MIN_CELL_PX);
    expect(MIN_CELL_PX).toBe(5);
  });
});

describe("plateOf", () => {
  it("gives each plate four consecutive fifths", () => {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    /** @type {string[][]} */
    const plates = [[], [], []];
    for (let pc = 0; pc < 12; pc++) plates[plateOf(pc)].push(names[pc]);
    expect(plates.map((p) => p.sort())).toEqual([
      ["A", "C", "D", "G"],
      ["B", "C#", "E", "F#"],
      ["A#", "D#", "F", "G#"],
    ]);
  });
});

describe("tintPlateOf", () => {
  it("tints each shape with the plate of its nearest neighbouring region on the circle of fifths", () => {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    /** @type {Record<string, number>} */
    const tint = {};
    for (let pc = 0; pc < 12; pc++) tint[names[pc]] = tintPlateOf(pc);
    // Plate 0 = C G D A: C and G sit next to F (plate 2), D and A next to E (plate 1).
    expect(tint).toEqual({
      C: 2, G: 2, D: 1, A: 1,
      E: 0, B: 0, "F#": 2, "C#": 2,
      "G#": 1, "D#": 1, "A#": 0, F: 0,
    });
  });

  it("never tints a shape with its own plate, and every plate tints four shapes", () => {
    const count = [0, 0, 0];
    for (let pc = 0; pc < 12; pc++) {
      expect(tintPlateOf(pc)).not.toBe(plateOf(pc));
      count[tintPlateOf(pc)]++;
    }
    expect(count).toEqual([4, 4, 4]);
  });
});
