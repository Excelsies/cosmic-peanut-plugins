// @ts-check
/**
 * Kelir — shadow-puppet theatre on a lamp-lit cotton screen, for the `webgl2` renderer.
 *
 * Two stylised rod puppets and the kayon (the tree of life) stand between an oil lamp and a
 * cotton screen. Each silhouette is a table of 2D signed-distance primitives on six bones
 * (lib/puppets.js, lib/rig.js) pierced with lace (a hex lattice of holes inside a solid border).
 * Its distance d from the screen sets the shadow's look (lib/stage.js penumbra): near, it is
 * small, black and crisp with every hole sharp; far, larger, greyer, with a soft penumbra that
 * dissolves the holes.
 *
 * The music (lib/stage.js): each hit makes a puppet lunge at the screen (bass-led A, mid-led B,
 * both on strong hits), the melody's brightness lifts the front hand on its rod, loud mids the
 * back arm, the beat sways the bodies, stereo balance drifts the pair, hats and flux make the
 * flame flicker (lib/lamp.js). Every 8 bars the kayon sweeps across and the puppets swap sides; in
 * silence the puppets withdraw and the kayon returns to centre stage.
 *
 * GPU: a mask pass draws one instanced quad per silhouette over its bounding box into an R8
 * target (0.75 resolution unless renderScale is 1 at quality 'high'), blended with MAX
 * (shaders/kelir/mask.frag); a full-screen composite lays it over the lit screen
 * (shaders/kelir/composite.frag). frame() allocates nothing.
 */
import { createProgram } from "./lib/gl.js";
import { resolveParams } from "./lib/kelir-params.js";
import { createLamp } from "./lib/lamp.js";
import { placeSilhouette } from "./lib/place.js";
import { MAX_RECORDS, RECORD_FLOATS, buildCast } from "./lib/puppets.js";
import { createPose, createRig, poseSilhouette, rewriteRods, silhouetteBounds } from "./lib/rig.js";
import { PALETTES, screenColours } from "./lib/screens.js";
import { createStage, penumbra } from "./lib/stage.js";

/** Mask resolution unless the canvas is at full render scale with quality 'high'. */
const MASK_SCALE = 0.75;
/** Lace lattice spacing at lace 1, puppet units. */
const SPACING = 0.03;
/** Weave: period in CSS px and contrast. */
const WEAVE_CSS_PX = 3;
const WEAVE = 0.06;

/** @param {number} a @param {number} b @param {number} x */
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** @type {import('../../tidalviz').CreateVisualizer} */
export default async function create(ctx) {
  const gl = /** @type {WebGL2RenderingContext} */ (ctx.gl);
  const dir = "shaders/kelir/";
  const [fullVs, maskVs, maskFs, sdf, compFs] = await Promise.all(
    ["fullscreen.vert", "mask.vert", "mask.frag", "sdf.glsl", "composite.frag"].map((f) => ctx.assets.text(dir + f)),
  );
  const maskProg = createProgram(gl, maskVs, maskFs.replace("// #include sdf", sdf), dir + "mask.frag");
  const compProg = createProgram(gl, fullVs, compFs, dir + "composite.frag");
  const mu = maskProg.u;
  const cu = compProg.u;
  const vao = gl.createVertexArray();

  // The shadow mask: R8, reallocated when the canvas or the mask scale changes.
  const maskTex = gl.createTexture();
  const maskFbo = gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  let maskW = 0;
  let maskH = 0;
  let maskScale = 1;

  function ensureMask() {
    const s = ctx.renderScale >= 1 && ctx.quality === "high" ? 1 : MASK_SCALE;
    const w = Math.max(1, Math.round(ctx.size.width * s));
    const h = Math.max(1, Math.round(ctx.size.height * s));
    if (w === maskW && h === maskH && s === maskScale) return;
    maskW = w;
    maskH = h;
    maskScale = s;
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, maskFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, maskTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  ensureMask();

  const table = new Float32Array(MAX_RECORDS * RECORD_FLOATS);
  const cast = buildCast(table);
  const rig = createRig();
  const pose = createPose();
  const stage = createStage();
  const lamp = createLamp();
  const look = { w: 0, scale: 0, opacity: 0 };
  const p = resolveParams(ctx.params, ctx.reduceMotion, {});
  // Per-instance uniforms (up to 3 visible silhouettes, packed in draw order).
  const boxes = new Float32Array(12);
  const ranges = new Int32Array(6);
  const looks = new Float32Array(9);
  const spacing = new Float32Array(3);
  const colours = new Float32Array(9);

  return {
    frame(audio, time) {
      const dt = time.dt;
      resolveParams(ctx.params, ctx.reduceMotion, p);
      ensureMask();
      const W = ctx.size.width;
      const H = ctx.size.height;
      const aspect = W / H;
      const pxScale = H / 1440;
      const pal = PALETTES[p.screen];

      stage.step(audio, time.now, dt, p);
      lamp.step(audio.trebAtt, audio.flux, dt, p.flicker, ctx.reduceFlashing, pxScale);
      const lx = lamp.ox / H;
      const ly = lamp.oy / H;

      let n = 0;
      for (let i = 0; i < 3; i++) {
        const s = stage.sil[i];
        if (!s.visible) continue;
        penumbra(s.d, p.blur, pxScale, pal.reiniger, look);
        placeSilhouette(s, i === 2, aspect, lx, ly, pose);
        poseSilhouette(rig, i, pose);
        if (i < 2) rewriteRods(table, cast.rods, rig, i);
        const w = Math.max(0.75, look.w * maskScale);
        const pxPerUnit = pose.s * maskH * Math.min(1, Math.abs(pose.fx));
        silhouetteBounds(table, cast.ranges[i * 2], cast.ranges[i * 2 + 1], rig, (w * 1.05 + 1) / maskH, boxes, n * 4);
        ranges[n * 2] = cast.ranges[i * 2];
        ranges[n * 2 + 1] = cast.ranges[i * 2 + 1];
        looks[n * 3] = pxPerUnit;
        looks[n * 3 + 1] = w;
        looks[n * 3 + 2] = s.opacity;
        spacing[n] = SPACING / p.lace;
        n++;
      }

      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, maskFbo);
      gl.viewport(0, 0, maskW, maskH);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (n > 0) {
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.MAX);
        gl.useProgram(maskProg.program);
        gl.uniform4fv(mu.u_box, boxes);
        gl.uniform1f(mu.u_aspect, aspect);
        gl.uniform4fv(mu.u_prims, table);
        gl.uniformMatrix3fv(mu.u_bones, false, rig.inv);
        gl.uniform2iv(mu.u_range, ranges);
        gl.uniform3fv(mu.u_look, looks);
        gl.uniform1fv(mu.u_spacing, spacing);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
        gl.blendEquation(gl.FUNC_ADD);
        gl.disable(gl.BLEND);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(compProg.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.uniform1i(cu.u_mask, 0);
      gl.uniform2f(cu.u_maskTexel, 1 / maskW, 1 / maskH);
      gl.uniform1f(cu.u_sharpen, maskScale < 1 ? 0.25 : 0);
      screenColours(p.screen, colours);
      gl.uniform3f(cu.u_hot, colours[0], colours[1], colours[2]);
      gl.uniform3f(cu.u_edge, colours[3], colours[4], colours[5]);
      gl.uniform3f(cu.u_shadow, colours[6], colours[7], colours[8]);
      gl.uniform2f(cu.u_hotspot, 0.5 + (0.5 * lamp.ox) / W, 1 - 0.42 + (0.5 * lamp.oy) / H);
      gl.uniform1f(cu.u_aspect, aspect);
      gl.uniform1f(cu.u_vertical, pal.vertical ? 1 : 0);
      const period = WEAVE_CSS_PX * (W / Math.max(1, ctx.size.cssWidth));
      gl.uniform1f(cu.u_period, period);
      gl.uniform1f(cu.u_weave, (pal.reiniger ? WEAVE / 2 : WEAVE) * smoothstep(2, 3, period));
      gl.uniform1f(cu.u_gain, lamp.gain);
      gl.uniform1f(cu.u_clear, pal.clear ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },

    resize() {
      ensureMask();
    },

    dispose() {
      gl.deleteProgram(maskProg.program);
      gl.deleteProgram(compProg.program);
      gl.deleteTexture(maskTex);
      gl.deleteFramebuffer(maskFbo);
      gl.deleteVertexArray(vao);
    },
  };
}
