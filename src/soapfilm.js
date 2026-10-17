// @ts-check
/**
 * Soapfilm — a draining soap film in true thin-film interference colours, for the `webgl2`
 * renderer.
 *
 * A vertical film fills the window: thinnest at the top, where it has drained to black film (too
 * thin to reflect, so the backdrop shows through), then silver, gold, and the saturated second-
 * and third-order magentas, blues and greens, fading to pastel near the bottom. Its colours come
 * from a CPU-built interference table (soapfilm/thinfilm.js: Airy reflectance × CIE 1931 × a
 * blackbody light), looked up per pixel by thickness (soapfilm/film.js, also in composite.frag).
 *
 * Two passes: a half-resolution state pass (shaders/soapfilm/state.frag) advects the film's
 * displacement and the fresh plume film through a drainage drift, a curl-noise swirl and the
 * plumes' jets and vortex pairs; a full-resolution composite (composite.frag) evaluates the base
 * thickness per pixel, so the fringes stay hairline-crisp, and colours, lights and frames it.
 *
 * The music (soapfilm/drive.js): bass breathes the film's membrane, sliding the bands through the
 * colour order (flash-limited); mids change the membrane's mode; loudness against the last 20 s
 * and spectral flux stir the swirl from laminar into eddies; treble shimmers; the spectral
 * centroid tilts the angle of incidence (hue); stereo balance tilts the bands. Each hit sends a
 * plume of fresh film up from the bottom where its energy sits in the spectrum (soapfilm/
 * plumes.js). The film drains through a phrase and is re-dipped every 16 bars
 * (soapfilm/redip.js). frame() allocates nothing.
 */
import { createDrive } from "./soapfilm/drive.js";
import { blackFront } from "./soapfilm/film.js";
import { createFixedStep } from "./soapfilm/fixedstep.js";
import { createProgram, createTarget } from "./soapfilm/gl.js";
import { createMeter } from "./soapfilm/meter.js";
import { createPlumes } from "./soapfilm/plumes.js";
import { createRedip } from "./soapfilm/redip.js";
import { createParams, resolveParams } from "./soapfilm/soapfilm-params.js";
import { ANGLES, angleRow, buildTable, createTable, LIGHT_KELVIN, TABLE_W } from "./soapfilm/thinfilm.js";

/** The state pass runs at this fraction of the canvas resolution (its content is smooth). */
const STATE_SCALE = 0.5;
/** Film age at start, so the first frames already show some black film and a full band set. */
const INITIAL_AGE = 12;
/** Downward drainage drift at drainage 1, uv/s. */
const DRIFT = 0.004;

/** @type {import('../tidalviz').CreateVisualizer} */
export default async function create(ctx) {
  const gl = /** @type {WebGL2RenderingContext} */ (ctx.gl);
  const dir = "shaders/soapfilm/";
  const [vs, sfs, cfs] = await Promise.all(
    ["fullscreen.vert", "state.frag", "composite.frag"].map((f) => ctx.assets.text(dir + f)),
  );
  const statePass = createProgram(gl, vs, sfs, dir + "state.frag");
  const comp = createProgram(gl, vs, cfs, dir + "composite.frag");
  const su = statePass.u;
  const cu = comp.u;
  const vao = gl.createVertexArray();
  // createTarget picks RGBA16F when renderable, else RGBA8: then the state is stored offset-encoded.
  const encoded = gl.getExtension("EXT_color_buffer_float") ? 0 : 1;
  const targets = [createTarget(gl), createTarget(gl)];
  let cur = 0;

  function resize() {
    const w = Math.max(1, Math.round(ctx.size.width * STATE_SCALE));
    const h = Math.max(1, Math.round(ctx.size.height * STATE_SCALE));
    for (const t of targets) {
      t.resize(w, h);
      if (encoded) {
        // The fallback encodes d = 0, p = 0 as 0.5.
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
        gl.clearColor(0.5, 0.5, 0.5, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  resize();

  const p = resolveParams(ctx.params, ctx.reduceMotion, createParams());
  let reduceMotion = ctx.reduceMotion;
  const table = createTable();
  const tableTex = gl.createTexture();
  function uploadTable() {
    buildTable(LIGHT_KELVIN[p.light], table);
    gl.bindTexture(gl.TEXTURE_2D, tableTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TABLE_W, ANGLES.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, table.bytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  let light = p.light;
  uploadTable();

  const drive = createDrive();
  const plumes = createPlumes();
  const redip = createRedip(INITIAL_AGE);
  const meter = createMeter();
  const clock = createFixedStep(1 / 60, 4);
  const STEP = 1 / 60;
  const relaxD = Math.exp(-STEP / 4);
  const relaxP = Math.exp(-STEP / 8);
  let swirlClock = 0;

  return {
    frame(audio, time) {
      const dt = time.dt;
      if (ctx.reduceMotion !== reduceMotion) {
        reduceMotion = ctx.reduceMotion;
        resolveParams(ctx.params, reduceMotion, p);
      }
      drive.step(audio, dt, p, ctx.reduceFlashing);
      const beats = meter.step(audio.bpm, audio.beatPhase, dt);
      redip.step(dt, p.drainEff, beats, audio.bpm, p.redip);
      plumes.step(audio, time.now, drive.balance);
      plumes.update(time.now, blackFront(redip.age), p.riseEff, p.reactivity);
      const { steps } = clock.advance(dt);

      const { width: w, height: h } = ctx.size;
      const aspect = w / h;
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);

      // 1. State: fixed 1/60 s steps at half resolution, ping-ponging the two targets.
      if (steps > 0) {
        gl.useProgram(statePass.program);
        gl.uniform1i(su.u_state, 0);
        gl.uniform1f(su.u_dt, STEP);
        gl.uniform1f(su.u_aspect, aspect);
        gl.uniform1f(su.u_drift, DRIFT * p.drainEff);
        gl.uniform1f(su.u_swirl, drive.swirlAmp);
        gl.uniform1f(su.u_relaxD, relaxD);
        gl.uniform1f(su.u_relaxP, relaxP);
        gl.uniform1f(su.u_front, redip.front);
        gl.uniform1i(su.u_encoded, encoded);
        gl.uniform4fv(su.u_plume, plumes.uniforms);
        gl.uniform1fv(su.u_src, plumes.src);
        for (let i = 0; i < steps; i++) {
          swirlClock += STEP;
          const src = targets[cur];
          const dst = targets[1 - cur];
          gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
          gl.viewport(0, 0, dst.width, dst.height);
          gl.bindTexture(gl.TEXTURE_2D, src.tex);
          gl.uniform1f(su.u_time, swirlClock);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          cur = 1 - cur;
        }
      }

      // 2. Composite at full resolution onto the transparent canvas.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(comp.program);
      gl.bindTexture(gl.TEXTURE_2D, targets[cur].tex);
      gl.uniform1i(cu.u_state, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tableTex);
      gl.uniform1i(cu.u_table, 1);
      gl.uniform2f(cu.u_res, w, h);
      gl.uniform1f(cu.u_aspect, aspect);
      gl.uniform1f(cu.u_dpr, ctx.size.dpr);
      gl.uniform1f(cu.u_age, redip.age);
      gl.uniform1f(cu.u_front, redip.front);
      gl.uniform1f(cu.u_thickness, p.thickness);
      gl.uniform1f(cu.u_tanTilt, Math.tan(drive.tilt));
      gl.uniform1f(cu.u_bass, drive.bassAmt);
      gl.uniform1f(cu.u_m, drive.m);
      gl.uniform1f(cu.u_shimmerAmp, drive.shimmerAmp);
      gl.uniform1f(cu.u_shimmerPhase, drive.shimmerPhase);
      gl.uniform1f(cu.u_row, (angleRow(drive.angle) + 0.5) / ANGLES.length);
      gl.uniform1i(cu.u_backdrop, p.backdrop);
      gl.uniform1i(cu.u_encoded, encoded);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    },

    resize,

    params() {
      resolveParams(ctx.params, ctx.reduceMotion, p);
      reduceMotion = ctx.reduceMotion;
      if (p.light !== light) {
        light = p.light;
        uploadTable();
      }
    },

    dispose() {
      for (const t of targets) t.dispose();
      gl.deleteTexture(tableTex);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(statePass.program);
      gl.deleteProgram(comp.program);
    },
  };
}
