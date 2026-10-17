// @ts-check
/**
 * Chladni — sand on a ringing brass plate, for the `webgl2` renderer.
 *
 * The window is a resonance plate. The strongest clear note (lib/pitch.js) picks a standing-wave
 * figure from a table of plate modes (lib/modes.js); sand grains, simulated on the GPU with
 * transform feedback (shaders/chladni/update.vert, constants in lib/sand.js), are shaken off the
 * antinodes and drift into the node lines, so the figure draws itself and re-forms whenever the
 * note changes. Kicks make every grain hop (flash-limited), hats add fizz, bass and stereo
 * balance tilt the plate, silence freezes the sand where it lies.
 *
 * Per frame: 1–4 feedback steps (1/120 s each), one additive POINTS pass into a half-resolution
 * density target, one full-resolution composite (brushed plate, relief-lit sand, dust). Every
 * uniform comes from a preallocated array or a scalar, so frame() allocates nothing.
 */
import { createFixedStep } from "./lib/fixedstep.js";
import { createFeedbackProgram } from "./lib/feedback.js";
import { createProgram, createTarget } from "./lib/gl.js";
import { createResolved, paletteColors, PLATE_FINISH, resolveParams } from "./lib/chladni-params.js";
import { buildModeTable, createCrossfade, MODE_STRIDE, START_MODE } from "./lib/modes.js";
import { createModeGate, createPitch } from "./lib/pitch.js";
import {
  AIR_DRAG,
  createHop,
  createPlateDrive,
  DAMPING,
  G_TILT,
  GRAIN_FLOATS,
  GRAVITY,
  K_DRIFT,
  K_FIZZ,
  K_SHAKE,
  MAX_STEPS,
  RESTITUTION,
  seedGrains,
  SIM_STEP,
  U_FLOOR,
} from "./lib/sand.js";
import { createStereo, stereoFrame } from "./lib/stereo.js";

/** Density target resolution relative to the canvas: sand is soft at this scale once lit. */
const DENSITY_SCALE = 0.5;
/** Density weights per grain at the reference (1280×720 density, 64k grains) on a float target. */
const W_GROUND = 0.4;
const W_AIR = 0.25;
/** On an RGBA8 target (no EXT_color_buffer_float) a fixed 4/255 per grain: saturates sooner. */
const W_BYTE = 4 / 255;
const REF_TEXELS = 1280 * 720;
const REF_GRAINS = 65536;

/** @type {import('../tidalviz').CreateVisualizer} */
export default async function create(ctx) {
  const gl = /** @type {WebGL2RenderingContext} */ (ctx.gl);
  const dir = "shaders/chladni/";
  const [uvs, ufs, dvs, dfs, cvs, cfs] = await Promise.all(
    ["update.vert", "update.frag", "deposit.vert", "deposit.frag", "fullscreen.vert", "composite.frag"].map((f) =>
      ctx.assets.text(dir + f),
    ),
  );
  const update = createFeedbackProgram(gl, uvs, ufs, dir + "update.vert", ["o_a", "o_b"]);
  const deposit = createProgram(gl, dvs, dfs, dir + "deposit.frag");
  const composite = createProgram(gl, cvs, cfs, dir + "composite.frag");
  const floatTarget = Boolean(gl.getExtension("EXT_color_buffer_float"));
  const density = createTarget(gl);

  // Two grain buffers ping-ponged through two feedback objects; one VAO per buffer serves both the
  // update and the deposit pass (same attribute locations), plus an empty one for the composite.
  const buffers = [/** @type {WebGLBuffer} */ (gl.createBuffer()), /** @type {WebGLBuffer} */ (gl.createBuffer())];
  const feedback = [
    /** @type {WebGLTransformFeedback} */ (gl.createTransformFeedback()),
    /** @type {WebGLTransformFeedback} */ (gl.createTransformFeedback()),
  ];
  const vaos = [/** @type {WebGLVertexArrayObject} */ (gl.createVertexArray()), /** @type {WebGLVertexArrayObject} */ (gl.createVertexArray())];
  const emptyVao = gl.createVertexArray();
  const stride = GRAIN_FLOATS * 4;
  for (let i = 0; i < 2; i++) {
    gl.bindVertexArray(vaos[i]);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[i]);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 16);
  }
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  const res = createResolved();
  let count = 0;
  let cur = 0;
  /** (Re)allocate and reseed both grain buffers. @param {number} n */
  function allocate(n) {
    const data = seedGrains(new Float32Array(n * GRAIN_FLOATS), n);
    for (let i = 0; i < 2; i++) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers[i]);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_COPY);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    for (let i = 0; i < 2; i++) {
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback[i]);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buffers[i]);
    }
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
    count = n;
    cur = 0;
  }

  const palette = new Float32Array(12);
  const look = new Float32Array(4);
  let lastReduceMotion = ctx.reduceMotion;
  let lastQuality = ctx.quality;
  function applyParams() {
    resolveParams(ctx.params, ctx.quality, ctx.reduceMotion, res);
    lastReduceMotion = ctx.reduceMotion;
    lastQuality = ctx.quality;
    if (res.grains !== count) allocate(res.grains);
    paletteColors(res.palette, palette);
    look[0] = PLATE_FINISH[res.palette * 2];
    look[1] = PLATE_FINISH[res.palette * 2 + 1];
    look[3] = res.backdrop;
  }
  applyParams();

  const table = new Float32Array(64 * MODE_STRIDE);
  let aspect = 1;
  const dep = new Float32Array(4);
  function resize() {
    const w = Math.max(1, ctx.size.width);
    const h = Math.max(1, ctx.size.height);
    aspect = w / h;
    buildModeTable(aspect, table);
    density.resize(Math.max(1, Math.round(w * DENSITY_SCALE)), Math.max(1, Math.round(h * DENSITY_SCALE)));
  }
  resize();

  const pitch = createPitch();
  const gate = createModeGate(START_MODE);
  const fade = createCrossfade(START_MODE);
  const plateDrive = createPlateDrive();
  const hop = createHop();
  const clock = createFixedStep(SIM_STEP, MAX_STEPS);
  const stereo = createStereo();
  const field = new Float32Array(4);
  const drive = new Float32Array(4);
  const tilt = new Float32Array(4);
  const k = new Float32Array([K_DRIFT, K_SHAKE, K_FIZZ, G_TILT]);
  const k2 = new Float32Array([DAMPING, AIR_DRAG, RESTITUTION, GRAVITY]);
  let stepCount = 0;
  let pendingVz = 0;
  let pendingScatter = 0;
  let seq = 0;

  return {
    frame(audio, time) {
      const dt = time.dt;
      if (ctx.reduceMotion !== lastReduceMotion || ctx.quality !== lastQuality) applyParams();

      // Audio → figure, drive, tilt, hop.
      pitch.setSampleRate(audio.sampleRate);
      const midi = audio.silent ? NaN : pitch.midi(audio.spectrum);
      fade.switchTo(gate.step(midi, audio.onset, dt, res.complexity), res.reduceMotion);
      fade.step(dt);
      // sand.js takes +1 = left heavy; stereo.js gives +1 = right heavy.
      const balance = -stereoFrame(audio.left, audio.right, stereo).balance;
      const pd = plateDrive.step(audio, balance, res.reactivity, res.bassTilt, dt);
      const hp = hop.step(audio.onset, audio.onsetStrength, res.hop, dt, ctx.reduceFlashing);
      if (hp.impulse > 0) {
        pendingVz = hp.impulse;
        pendingScatter = hp.scatter;
        seq = hp.seq;
      }

      // 1. Update: 0–4 fixed steps through transform feedback.
      const steps = clock.advance(dt);
      if (steps > 0) {
        const oa = fade.a * MODE_STRIDE;
        const ob = fade.b * MODE_STRIDE;
        field[0] = table[oa + 4];
        field[1] = table[ob + 4];
        field[2] = fade.blend;
        field[3] = aspect;
        drive[0] = pd.drive;
        drive[1] = pd.fizz;
        drive[2] = SIM_STEP;
        drive[3] = U_FLOOR;
        tilt[0] = pd.tiltX;
        tilt[1] = pd.tiltY;
        gl.useProgram(update.program);
        const u = update.u;
        gl.uniform4fv(u.u_modeA, table, oa, 4);
        gl.uniform4fv(u.u_modeB, table, ob, 4);
        gl.uniform4fv(u.u_field, field);
        gl.uniform4fv(u.u_drive, drive);
        gl.uniform4fv(u.u_k, k);
        gl.uniform4fv(u.u_k2, k2);
        gl.uniform1ui(u.u_seq, seq);
        gl.enable(gl.RASTERIZER_DISCARD);
        for (let s = 0; s < steps; s++) {
          tilt[2] = pendingVz;
          tilt[3] = pendingScatter;
          pendingVz = 0;
          pendingScatter = 0;
          gl.uniform4fv(u.u_tilt, tilt);
          gl.uniform1ui(u.u_step, stepCount++ >>> 0);
          const next = 1 - cur;
          gl.bindVertexArray(vaos[cur]);
          gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback[next]);
          gl.beginTransformFeedback(gl.POINTS);
          gl.drawArrays(gl.POINTS, 0, count);
          gl.endTransformFeedback();
          gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
          cur = next;
        }
        gl.disable(gl.RASTERIZER_DISCARD);
      }

      // 2. Deposit grains into the half-resolution density target (additive).
      const texels = density.width * density.height;
      const scale = (texels / REF_TEXELS) ** 0.75 * Math.sqrt(REF_GRAINS / count);
      dep[0] = floatTarget ? W_GROUND * scale : W_BYTE;
      dep[1] = floatTarget ? W_AIR * scale : W_BYTE;
      dep[2] = 1;
      dep[3] = 2;
      gl.bindFramebuffer(gl.FRAMEBUFFER, density.fbo);
      gl.viewport(0, 0, density.width, density.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(deposit.program);
      gl.uniform4fv(deposit.u.u_dep, dep);
      gl.bindVertexArray(vaos[cur]);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.disable(gl.BLEND);

      // 3. Composite onto the canvas.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, ctx.size.width, ctx.size.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(composite.program);
      gl.bindVertexArray(emptyVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, density.tex);
      const cu = composite.u;
      gl.uniform1i(cu.u_den, 0);
      gl.uniform2f(cu.u_texel, 1 / density.width, 1 / density.height);
      gl.uniform2f(cu.u_res, ctx.size.width, ctx.size.height);
      gl.uniform3fv(cu.u_pal, palette);
      look[2] = hp.haze;
      gl.uniform4fv(cu.u_look, look);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    },

    resize,

    params() {
      applyParams();
    },

    dispose() {
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      for (let i = 0; i < 2; i++) {
        gl.deleteBuffer(buffers[i]);
        gl.deleteTransformFeedback(feedback[i]);
        gl.deleteVertexArray(vaos[i]);
      }
      gl.deleteVertexArray(emptyVao);
      gl.deleteProgram(update.program);
      gl.deleteProgram(deposit.program);
      gl.deleteProgram(composite.program);
      density.dispose();
    },
  };
}
