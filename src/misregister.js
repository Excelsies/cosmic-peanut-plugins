// @ts-check
/**
 * Misregister — a risograph poster printed live by the music, for `webgl2`.
 *
 * Twelve flat, hard-edged shapes sit on a Swiss grid over cream paper, one per pitch class, each
 * printed as an AM halftone in one of three inks (plate = the pitch class's region of the circle
 * of fifths). Chords swell their notes' shapes from a grid-anchored corner and push their ink
 * ramps darker; kicks knock the three plates out of register on damped springs, so colour fringes
 * and paper slivers flash along every edge; hats make the screens shimmer; noisy passages print
 * rough; every few bars the shapes slide to a new layout.
 *
 * Two passes per frame: plates.frag at half resolution writes each plate's ink density and
 * signed distance (MRT, RGBA8), halftone.frag at full resolution screens and overprints them.
 * The audio side (lib/) is pure and allocation-free: chroma.js → swell.js (flash-limited global
 * gain) → poster.js packs the uniforms; plates.js runs the springs; layout.js the grid.
 */
import { createChroma } from "./lib/chroma.js";
import { hexToRgb } from "./lib/color.js";
import { createProgram } from "./lib/gl.js";
import { GRAIN_SIZE, makeGrain } from "./lib/grain.js";
import { hash01 } from "./lib/hash.js";
import {
  createRelayoutClock,
  easeInOutCubic,
  gridOf,
  layoutForSheet,
  placeLayout,
  SLOT,
  tweenLayouts,
} from "./lib/layout.js";
import { cellSize, PALETTES, PAPERS, resolveParams } from "./lib/misregister-params.js";
import { createPlates, joltMagnitude } from "./lib/plates.js";
import { packShapes } from "./lib/poster.js";
import { SCREEN_ANGLES, shimmerAmount, shimmerOffsets } from "./lib/screen.js";
import { createSwell } from "./lib/swell.js";
import { stepEnvelope } from "./lib/envelope.js";
import { createFlashLimiter } from "./lib/flash.js";

/** rms under this counts as silence (the poster rests at swell 0.4). */
const SILENCE_RMS = 0.004;
/** Paper fibre at grain 1. */
const FIBRE = 0.06;

/** @type {import('../tidalviz').CreateVisualizer} */
export default async function create(ctx) {
  const gl = /** @type {WebGL2RenderingContext} */ (ctx.gl);
  const dir = "shaders/misregister/";
  const [vs, platesFs, halftoneFs] = await Promise.all(
    ["fullscreen.vert", "plates.frag", "halftone.frag"].map((f) => ctx.assets.text(dir + f)),
  );
  const platesProg = createProgram(gl, vs, platesFs, dir + "plates.frag");
  const halftoneProg = createProgram(gl, vs, halftoneFs, dir + "halftone.frag");
  const vao = gl.createVertexArray();

  /** @param {number} filter */
  function texture(filter) {
    const t = /** @type {WebGLTexture} */ (gl.createTexture());
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // Half-resolution plate targets: density and signed distance, one framebuffer (MRT).
  const densityTex = texture(gl.LINEAR);
  const distTex = texture(gl.LINEAR);
  const fbo = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer());
  const drawBuffers = [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1];
  let halfW = 0;
  let halfH = 0;

  // Paper and ink grain, built once.
  const grainTex = texture(gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, GRAIN_SIZE, GRAIN_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, makeGrain(0x7269736f));

  const res = resolveParams(ctx.params, ctx.reduceMotion, {
    palette: 0, paper: 0, screen: 90, misregister: 0.5, grain: 0.4, reactivity: 1,
    relayoutBars: 8, slideSeconds: 1.5, joltScale: 1, shimmer: 1,
  });
  const grid = gridOf(Math.max(1, ctx.size.width), Math.max(1, ctx.size.height), {
    rows: 8, cols: 12, margin: 0, x0: 0, y0: 0, cellW: 1, cellH: 1,
  });
  const chroma = createChroma();
  const swell = createSwell();
  const plates = createPlates();
  const clock = createRelayoutClock();
  const starveLimiter = createFlashLimiter();
  const from = new Float32Array(12 * SLOT);
  const to = new Float32Array(12 * SLOT);
  const cur = new Float32Array(12 * SLOT);
  const shapes = new Float32Array(36 * 4);
  const shimmer = new Float32Array(6);
  const angles = new Float32Array(6);
  const inks = new Float32Array(9);
  const paper = new Float32Array(4);
  const grainOffset = new Float32Array(2);
  for (let i = 0; i < 3; i++) {
    const a = (SCREEN_ANGLES[i] * Math.PI) / 180;
    angles[i * 2] = Math.cos(a);
    angles[i * 2 + 1] = Math.sin(a);
  }
  let sheet = 0;
  let tween = 1;
  let onsets = 0;
  let starveEnv = 0;

  function applyColours() {
    const pal = PALETTES[res.palette];
    for (let i = 0; i < 3; i++) hexToRgb(pal[i], inks.subarray(i * 3, i * 3 + 3));
    const hex = PAPERS[res.paper];
    if (hex) {
      hexToRgb(hex, paper);
      paper[3] = 1;
    } else paper.fill(0);
  }

  /** Re-place the current tween's endpoints on the current grid (after a resize). */
  function placeSheets() {
    placeLayout(layoutForSheet(Math.max(0, sheet - 1)), grid.cols, grid.rows, from);
    placeLayout(layoutForSheet(sheet), grid.cols, grid.rows, to);
    if (sheet === 0) from.set(to);
  }

  function setGrainOffset() {
    grainOffset[0] = hash01(sheet * 2 + 11);
    grainOffset[1] = hash01(sheet * 2 + 12);
  }

  function resize() {
    const w = Math.max(1, ctx.size.width);
    const h = Math.max(1, ctx.size.height);
    gridOf(w, h, grid);
    placeSheets();
    const hw = Math.max(1, Math.ceil(w / 2));
    const hh = Math.max(1, Math.ceil(h / 2));
    if (hw === halfW && hh === halfH) return;
    halfW = hw;
    halfH = hh;
    for (const t of [densityTex, distTex]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, hw, hh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, densityTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, distTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  applyColours();
  setGrainOffset();
  resize();

  return {
    frame(audio, time) {
      const dt = time.dt;
      resolveParams(ctx.params, ctx.reduceMotion, res);
      const w = ctx.size.width;
      const h = ctx.size.height;
      const cell = cellSize(h, res.screen);

      // Audio → swell per pitch class (flash-limited global gain).
      const quiet = audio.silent || audio.rms < SILENCE_RMS;
      const c = chroma.update(audio.spectrum, audio.sampleRate, audio.silent);
      swell.step(c, quiet, audio.onset, dt, res.reactivity, ctx.reduceFlashing);

      // Kicks throw the plates out of register.
      if (audio.onset && !quiet) {
        onsets++;
        const m = joltMagnitude(res.misregister, audio.onsetStrength, audio.bassAtt, ctx.size.dpr);
        plates.kick(m * res.joltScale, onsets);
      }
      plates.step(dt);

      // Hats shimmer the screens; noisy passages starve the ink.
      shimmerOffsets(time.now, shimmerAmount(audio.trebAtt, res.shimmer), shimmer);
      const flux = quiet ? 0 : Math.min(1, Math.max(0, audio.flux * 1.5));
      starveEnv = stepEnvelope(starveEnv, flux, dt, 0.05, 0.4);
      const starve = starveLimiter.step(res.grain * (0.2 + 0.8 * starveEnv), dt, ctx.reduceFlashing);

      // Every N bars, slide to the next layout.
      if (clock.step(audio.bpm, audio.beatPhase, dt, res.relayoutBars)) {
        from.set(cur);
        sheet++;
        placeLayout(layoutForSheet(sheet), grid.cols, grid.rows, to);
        setGrainOffset();
        tween = 0;
      }
      if (tween < 1) tween = Math.min(1, tween + dt / res.slideSeconds);
      tweenLayouts(from, to, easeInOutCubic(tween), cur);
      packShapes(cur, swell.swell, swell.dot, grid, shapes);

      gl.bindVertexArray(vao);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);

      // Pass 1: plates at half resolution.
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.drawBuffers(drawBuffers);
      gl.viewport(0, 0, halfW, halfH);
      gl.useProgram(platesProg.program);
      const pu = platesProg.u;
      gl.uniform4fv(pu.uShape, shapes);
      gl.uniform2f(pu.uFull, w, h);
      gl.uniform2f(pu.uHalf, halfW, halfH);
      gl.uniform1f(pu.uCell, cell);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Pass 2: halftone and overprint to the canvas.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(halftoneProg.program);
      const hu = halftoneProg.u;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, densityTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, distTex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, grainTex);
      gl.uniform1i(hu.uDensity, 0);
      gl.uniform1i(hu.uDist, 1);
      gl.uniform1i(hu.uGrain, 2);
      gl.uniform2f(hu.uSize, w, h);
      gl.uniform1f(hu.uCell, cell);
      gl.uniform1f(hu.uDistScale, (16 * h) / halfH);
      gl.uniform2fv(hu.uOffset, plates.offset);
      gl.uniform2fv(hu.uShimmer, shimmer);
      gl.uniform2fv(hu.uAngle, angles);
      gl.uniform3fv(hu.uInk, inks);
      gl.uniform4fv(hu.uPaper, paper);
      gl.uniform2fv(hu.uGrainOffset, grainOffset);
      gl.uniform1f(hu.uFibre, FIBRE * res.grain);
      gl.uniform1f(hu.uStarve, starve);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },

    resize,

    params() {
      resolveParams(ctx.params, ctx.reduceMotion, res);
      applyColours();
    },

    dispose() {
      gl.deleteProgram(platesProg.program);
      gl.deleteProgram(halftoneProg.program);
      gl.deleteTexture(densityTex);
      gl.deleteTexture(distTex);
      gl.deleteTexture(grainTex);
      gl.deleteFramebuffer(fbo);
      gl.deleteVertexArray(vao);
    },
  };
}
