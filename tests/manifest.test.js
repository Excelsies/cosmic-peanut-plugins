// @ts-check
// @ts-expect-error -- a Node builtin (tests run in Node); the tsconfig has no @types/node.
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Ported from Cosmic Peanut's tests/test_builtin_manifests.py, which checked this package while it
// lived at plugins/fieldwork. Schema validation and the d.ts copy need the host: `npm run check:host`.

/**
 * @typedef {{ id: string, type: string, label?: string, default: unknown,
 *   min?: number, max?: number, step?: number, options?: string[] }} Param
 * @typedef {{ id: string, name: string, description?: string, author?: string, entry: string,
 *   renderer: string, libs?: string[], depth?: boolean, thumbnail?: string, params: Param[] }} Viz
 */

const ROOT = new URL("../", import.meta.url);
/** @type {{ apiVersion: number, visualizers: Viz[] }} */
const MANIFEST = JSON.parse(readFileSync(new URL("tidalviz.json", ROOT), "utf8"));
const THUMB_MAX = 60 * 1024;

/** @param {string} rel */
const isFile = (rel) => existsSync(new URL(rel, ROOT)) && statSync(new URL(rel, ROOT)).isFile();

/** @param {string} id */
function viz(id) {
  const found = MANIFEST.visualizers.filter((v) => v.id === id);
  expect(found).toHaveLength(1);
  return found[0];
}

/** @param {Viz} v @returns {Record<string, Param>} */
const paramsOf = (v) => Object.fromEntries(v.params.map((p) => [p.id, p]));

/** @param {Param} p */
const range = (p) => [p.min, p.max, p.default, p.step];

/** @param {string} dir @param {string[]} files */
function expectShaders(dir, files) {
  for (const f of files) expect(isFile(`shaders/${dir}/${f}`), f).toBe(true);
}

describe("the manifest as a whole", () => {
  it("lists its visualizers in order, each with author, description and thumbnail", () => {
    expect(MANIFEST.visualizers.map((v) => v.id)).toEqual([
      "chladni",
      "murmuration",
      "plotter",
      "misregister",
      "soapfilm",
      "miura",
      "isobar",
      "kelir",
    ]);
    for (const v of MANIFEST.visualizers) {
      expect(v.author, v.id).toBe("Fieldwork");
      expect(v.description, v.id).toBeTruthy();
      expect(v.thumbnail, v.id).toBeTruthy();
    }
  });

  it("has four webgl2 visualizers and only Soapfilm keeps the canvas depth buffer", () => {
    // Chladni and Kelir accept llvmpipe's 1-LSB shift without a depth buffer; Soapfilm keeps it
    // because without it the antialiased black-film edge moves by up to 14 levels on 0.06-0.17%
    // of pixels. None of them enables DEPTH_TEST on the default framebuffer.
    const webgl2 = MANIFEST.visualizers.filter((v) => v.renderer === "webgl2");
    expect(webgl2.map((v) => v.id)).toEqual(["chladni", "misregister", "soapfilm", "kelir"]);
    expect(webgl2.filter((v) => v.depth ?? true).map((v) => v.id)).toEqual(["soapfilm"]);
  });

  it.each(MANIFEST.visualizers.map((v) => [v.id, v]))("%s: entry and thumbnail exist", (_, v) => {
    expect(isFile(v.entry)).toBe(true);
    if (v.thumbnail !== undefined) {
      expect(isFile(v.thumbnail)).toBe(true);
      expect(statSync(new URL(v.thumbnail, ROOT)).size).toBeLessThanOrEqual(THUMB_MAX);
    }
  });

  it.each(MANIFEST.visualizers.map((v) => [v.id, v]))("%s: param defaults are legal", (_, v) => {
    for (const p of v.params) {
      if (p.type === "number") {
        expect(/** @type {number} */ (p.min), p.id).toBeLessThanOrEqual(/** @type {number} */ (p.default));
        expect(/** @type {number} */ (p.default), p.id).toBeLessThanOrEqual(/** @type {number} */ (p.max));
      } else if (p.type === "select") {
        expect(p.options, p.id).toContain(p.default);
      }
    }
  });
});

describe("chladni", () => {
  it("matches the manifest the visualizer expects", () => {
    const v = viz("chladni");
    expect([v.name, v.entry, v.renderer, v.thumbnail]).toEqual([
      "Chladni",
      "src/chladni.js",
      "webgl2",
      "thumbs/chladni.jpg",
    ]);
    expect(v).not.toHaveProperty("libs");
    const params = paramsOf(v);
    expect(Object.keys(params)).toEqual(["palette", "backdrop", "grains", "complexity", "reactivity", "hop"]);
    // lib/chladni-params.js indexes these options in this order (composite.frag's palettes too).
    expect(params.palette.options).toEqual(["brass", "slate", "cobalt", "mono"]);
    expect(params.palette.default).toBe("brass");
    expect(params.backdrop.options).toEqual(["plate", "none"]);
    expect(params.backdrop.default).toBe("plate");
    // Battery quality swaps 64k for 32k only while Grains is at this default.
    expect(params.grains.options).toEqual(["32k", "64k", "128k"]);
    expect(params.grains.default).toBe("64k");
    // lib/chladni-params.js DEFAULT_REACTIVITY: Reduce motion calms the plate only at this default.
    expect(params.reactivity.default).toBe(1);
    expect(range(params.complexity)).toEqual([0.5, 2, 1, 0.05]);
    expect(range(params.reactivity)).toEqual([0, 2, 1, 0.05]);
    expect(range(params.hop)).toEqual([0, 2, 1, 0.05]);
    expectShaders("chladni", [
      "update.vert",
      "update.frag",
      "deposit.vert",
      "deposit.frag",
      "fullscreen.vert",
      "composite.frag",
    ]);
  });
});

describe("murmuration", () => {
  it("matches the manifest the visualizer expects", () => {
    const v = viz("murmuration");
    expect([v.name, v.entry, v.renderer, v.libs, v.thumbnail]).toEqual([
      "Murmuration",
      "src/murmuration.js",
      "three",
      ["three"],
      "thumbs/murmuration.jpg",
    ]);
    expect(v.description).toBeTruthy();
    const params = paramsOf(v);
    expect(Object.keys(params)).toEqual(["sky", "ink", "flock", "speed", "falcon", "reactivity"]);
    // Order matches lib/murmuration-params.js SKIES (shader palette index) and FLOCKS.
    expect(params.sky.options).toEqual(["dusk", "overcast", "rose", "none"]);
    expect(params.sky.default).toBe("dusk");
    expect(params.ink).toStrictEqual({ id: "ink", type: "color", label: "Ink (sky none)", default: "#ece6da" });
    expect(params.flock.options).toEqual(["2000", "4000", "6000"]);
    expect(params.flock.default).toBe("4000");
    const speed = params.speed;
    expect([speed.min, speed.max, speed.step]).toEqual([0.2, 2, 0.05]);
    // lib/murmuration-params.js DEFAULT_SPEED: Reduce motion applies only while speed is at it.
    expect(speed.default).toBe(1);
    expect(params.falcon.default).toBe(true);
    const react = params.reactivity;
    expect([react.min, react.max, react.step, react.default]).toEqual([0, 2, 0.05, 1]);
    expectShaders("murmuration", ["sky.glsl", "sky.vert", "sky.frag", "bird.vert", "bird.frag"]);
  });
});

describe("plotter", () => {
  it("matches the manifest the visualizer expects", () => {
    const v = viz("plotter");
    expect([v.name, v.entry, v.renderer, v.thumbnail]).toEqual([
      "Plotter",
      "src/plotter.js",
      "2d",
      "thumbs/plotter.jpg",
    ]);
    expect(v).not.toHaveProperty("libs");
    const params = paramsOf(v);
    expect(Object.keys(params)).toEqual(["grid", "phrase", "paper", "inks", "weight", "chatter", "speed"]);
    // Option order matches lib/plotter-params.js (GRID_OPTIONS, PAPER_FILL, INKS, ...).
    expect(params.grid.options).toEqual(["4x3", "3x2", "6x4", "1x1"]);
    expect(params.grid.default).toBe("4x3");
    expect(params.phrase.options).toEqual(["2 bars", "4 bars", "8 bars"]);
    expect(params.phrase.default).toBe("4 bars");
    expect(params.paper.options).toEqual(["blueprint", "cream", "white", "none"]);
    expect(params.paper.default).toBe("blueprint");
    expect(params.inks.options).toEqual(["fineliner", "sepia", "mono"]);
    expect(params.inks.default).toBe("fineliner");
    // lib/plotter-params.js DEFAULT_CHATTER / DEFAULT_SPEED: Reduce motion calms them at these values.
    const ranges = Object.fromEntries(
      ["weight", "chatter", "speed"].map((k) => [k, [params[k].min, params[k].max, params[k].default]]),
    );
    expect(ranges).toEqual({ weight: [0.5, 3, 1], chatter: [0, 1, 0.5], speed: [0.25, 2, 1] });
  });
});

describe("misregister", () => {
  it("matches the manifest the visualizer expects", () => {
    const v = viz("misregister");
    expect([v.name, v.entry, v.renderer, v.thumbnail]).toEqual([
      "Misregister",
      "src/misregister.js",
      "webgl2",
      "thumbs/misregister.jpg",
    ]);
    expect(v).not.toHaveProperty("libs");
    expect(v.description).toBeTruthy();
    const params = paramsOf(v);
    expect(Object.keys(params)).toEqual([
      "palette",
      "paper",
      "screen",
      "misregister",
      "grain",
      "relayout",
      "reactivity",
    ]);
    // Option order = index order in src/lib/misregister-params.js (PALETTES, PAPERS, RELAYOUT_BARS).
    expect(params.palette.options).toEqual(["riso", "bauhaus", "sunset", "mono"]);
    expect(params.palette.default).toBe("riso");
    expect(params.paper.options).toEqual(["cream", "white", "kraft", "none"]);
    expect(params.paper.default).toBe("cream");
    expect(params.relayout.options).toEqual(["8 bars", "16 bars", "32 bars", "never"]);
    // DEFAULT_RELAYOUT and DEFAULTS.misregister: Reduce motion calms them only at these values.
    expect(params.relayout.default).toBe("8 bars");
    const got = Object.fromEntries(
      ["screen", "misregister", "grain", "reactivity"].map((k) => {
        const p = params[k];
        return [k, [p.type, p.min, p.max, p.step, p.default]];
      }),
    );
    expect(got).toEqual({
      screen: ["number", 30, 160, 1, 90],
      misregister: ["number", 0, 1, 0.01, 0.5],
      grain: ["number", 0, 1, 0.01, 0.4],
      reactivity: ["number", 0, 2, 0.05, 1],
    });
    expectShaders("misregister", ["fullscreen.vert", "plates.frag", "halftone.frag"]);
  });
});

describe("soapfilm", () => {
  it("matches the manifest the visualizer expects", () => {
    const v = viz("soapfilm");
    expect([v.name, v.entry, v.renderer, v.thumbnail]).toEqual([
      "Soapfilm",
      "src/soapfilm.js",
      "webgl2",
      "thumbs/soapfilm.jpg",
    ]);
    expect(v).not.toHaveProperty("libs");
    const params = paramsOf(v);
    expect(Object.keys(params)).toEqual([
      "backdrop",
      "light",
      "thickness",
      "swirl",
      "drainage",
      "redip",
      "reactivity",
    ]);
    // src/soapfilm/soapfilm-params.js indexes these options in this order: composite.frag's
    // u_backdrop, thinfilm.js LIGHT_KELVIN and redip.js's bar counts.
    expect(params.backdrop.options).toEqual(["velvet", "studio", "none"]);
    expect(params.backdrop.default).toBe("velvet");
    expect(params.light.options).toEqual(["softbox", "sky", "warm"]);
    expect(params.light.default).toBe("softbox");
    expect(params.redip.options).toEqual(["16 bars", "32 bars", "when black"]);
    expect(params.redip.default).toBe("16 bars");
    // soapfilm-params.js DEFAULT_SWIRL / DEFAULT_DRAINAGE / DEFAULT_REACTIVITY: Reduce motion
    // calms each of these only while it is at this default.
    expect(range(params.thickness)).toEqual([0.5, 2, 1, 0.05]);
    expect(range(params.swirl)).toEqual([0, 2, 1, 0.05]);
    expect(range(params.drainage)).toEqual([0.2, 3, 1, 0.05]);
    expect(range(params.reactivity)).toEqual([0, 2, 1, 0.05]);
    expectShaders("soapfilm", ["fullscreen.vert", "state.frag", "composite.frag"]);
  });
});

describe("miura", () => {
  it("matches the manifest the visualizer expects", () => {
    const v = viz("miura");
    expect([v.name, v.entry, v.renderer, v.libs, v.thumbnail]).toEqual([
      "Miura",
      "src/miura/miura.js",
      "three",
      ["three"],
      "thumbs/miura.jpg",
    ]);
    expect(v.author).toBe("Fieldwork");
    expect(v.description).toBeTruthy();
    const params = paramsOf(v);
    expect(Object.keys(params)).toEqual(["paper", "pleat", "sheet", "fold", "reactivity", "light", "shadows"]);
    // Option orders match PAPERS/PLEATS/SHEETS/LIGHTS in src/miura/lib/miura-params.js.
    expect(params.paper.options).toEqual(["washi", "indigo", "vermilion", "foil", "graphite"]);
    expect(params.pleat.options).toEqual(["classic", "fine", "bold"]);
    expect(params.sheet.options).toEqual(["fill", "float"]);
    expect(params.light.options).toEqual(["window", "noon", "low-sun"]);
    expect([params.paper.default, params.pleat.default, params.sheet.default]).toEqual(["washi", "classic", "fill"]);
    expect(params.light.default).toBe("window");
    expect(params.shadows.default).toBe(true);
    // Reduce motion keys off DEFAULT_FOLD and DEFAULT_REACTIVITY (lib/miura-params.js).
    const fold = params.fold;
    const react = params.reactivity;
    expect([fold.min, fold.max, fold.step, fold.default]).toEqual([0.2, 1.5, 0.05, 1]);
    expect([react.min, react.max, react.step, react.default]).toEqual([0, 2, 0.05, 1]);
  });
});

describe("isobar", () => {
  it("matches the manifest the visualizer expects", () => {
    const v = viz("isobar");
    expect([v.name, v.entry, v.renderer, v.thumbnail]).toEqual([
      "Isobar",
      "src/isobar.js",
      "2d",
      "thumbs/isobar.jpg",
    ]);
    expect(v).not.toHaveProperty("libs");
    const params = paramsOf(v);
    expect(Object.keys(params)).toEqual([
      "chart",
      "reactivity",
      "speed",
      "fronts",
      "barbs",
      "labels",
      "coastline",
      "tints",
    ]);
    // src/isobar/isobar-params.js CHARTS and chart.js CHART_STYLES are in this order.
    expect(params.chart.options).toEqual(["paper", "broadcast", "night", "none"]);
    expect(params.chart.default).toBe("paper");
    // isobar-params.js DEFAULT_SPEED: Reduce motion calms drift, kicks and the front sweep only
    // while Speed is at this default.
    expect(range(params.reactivity)).toEqual([0, 2, 1, 0.05]);
    expect(range(params.speed)).toEqual([0.2, 2, 1, 0.05]);
    for (const pid of ["fronts", "barbs", "labels", "coastline", "tints"]) {
      expect([params[pid].type, params[pid].default], pid).toEqual(["boolean", true]);
    }
  });
});

describe("kelir", () => {
  it("matches the manifest the visualizer expects", () => {
    const v = viz("kelir");
    expect([v.name, v.entry, v.renderer, v.thumbnail]).toEqual([
      "Kelir",
      "src/kelir/kelir.js",
      "webgl2",
      "thumbs/kelir.jpg",
    ]);
    expect(v).not.toHaveProperty("libs");
    expect(v.author).toBe("Fieldwork");
    const params = paramsOf(v);
    expect(Object.keys(params)).toEqual(["screen", "cast", "reactivity", "flicker", "blur", "lace", "scenes"]);
    // src/kelir/lib/kelir-params.js resolves these to their index: screens.js PALETTES follows
    // the screen order, stage.js the cast order (CAST_SOLO = 1, CAST_KAYON = 2).
    expect(params.screen.options).toEqual(["lamp", "moon", "reiniger", "none"]);
    expect(params.screen.default).toBe("lamp");
    expect(params.cast.options).toEqual(["duet", "solo", "kayon"]);
    // kelir-params.js DEFAULT_CAST.
    expect(params.cast.default).toBe("duet");
    // kelir-params.js DEFAULT_REACTIVITY / DEFAULT_FLICKER: reduce motion calms the motion and
    // the flicker only while each is at this default.
    expect(range(params.reactivity)).toEqual([0, 2, 1, 0.05]);
    expect(range(params.flicker)).toEqual([0, 1, 0.5, 0.05]);
    expect(range(params.blur)).toEqual([0, 1.5, 1, 0.05]);
    expect(range(params.lace)).toEqual([0.5, 2, 1, 0.05]);
    expect(params.scenes).toStrictEqual({ id: "scenes", type: "boolean", label: "Scenes", default: true });
    expectShaders("kelir", ["fullscreen.vert", "mask.vert", "mask.frag", "sdf.glsl", "composite.frag"]);
  });
});
