// @ts-check
/** Test-only helper (not imported by any visualizer). */

/**
 * A 2d-context stand-in that records path, fill and stroke calls with the state at the time;
 * save/restore keep a state stack like the real thing.
 */
export function fakeContext() {
  /** @type {{ op: string, x?: number, y?: number, w?: number, h?: number, gco?: string, alpha?: number, style?: unknown, width?: number }[]} */
  const log = [];
  /** @type {any[][]} */
  const stack = [];
  const g = {
    globalCompositeOperation: "source-over",
    globalAlpha: 1,
    strokeStyle: /** @type {unknown} */ ("#000"),
    fillStyle: /** @type {unknown} */ ("#000"),
    lineWidth: 1,
    lineJoin: "miter",
    clearRect: (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h) =>
      log.push({ op: "clear", x, y, w, h }),
    save: () => {
      log.push({ op: "save" });
      stack.push([g.globalCompositeOperation, g.globalAlpha, g.strokeStyle, g.fillStyle, g.lineWidth, g.lineJoin]);
    },
    restore: () => {
      log.push({ op: "restore" });
      const s = stack.pop();
      if (s) [g.globalCompositeOperation, g.globalAlpha, g.strokeStyle, g.fillStyle, g.lineWidth, g.lineJoin] = s;
    },
    clip: () => log.push({ op: "clip" }),
    rect: (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h) =>
      log.push({ op: "rect", x, y, w, h }),
    beginPath: () => log.push({ op: "begin" }),
    closePath: () => log.push({ op: "close" }),
    moveTo: (/** @type {number} */ x, /** @type {number} */ y) => log.push({ op: "move", x, y }),
    lineTo: (/** @type {number} */ x, /** @type {number} */ y) => log.push({ op: "line", x, y }),
    fill: () => log.push({ op: "fill", gco: g.globalCompositeOperation, alpha: g.globalAlpha }),
    stroke: () =>
      log.push({ op: "stroke", gco: g.globalCompositeOperation, alpha: g.globalAlpha, style: g.strokeStyle, width: g.lineWidth }),
  };
  return { g, log, ctx: /** @type {CanvasRenderingContext2D} */ (/** @type {unknown} */ (g)) };
}
