// @ts-check
/**
 * Transform-feedback program: like gl.js createProgram, but declares the captured varyings
 * (interleaved) before linking. Errors carry the shader log for the dev overlay and are skipped
 * once the context is lost (the SDK then disposes and re-creates the visualizer).
 */

/**
 * @param {WebGL2RenderingContext} gl
 * @param {number} type
 * @param {string} src
 * @param {string} name
 */
function compile(gl, type, src, name) {
  const s = /** @type {WebGLShader} */ (gl.createShader(type));
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`${name}: ${log}`);
  }
  return s;
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {string} vs vertex source
 * @param {string} fs fragment source (never rasterized)
 * @param {string} name label for errors, e.g. the vertex file path
 * @param {string[]} varyings captured outputs, interleaved in this order
 */
export function createFeedbackProgram(gl, vs, fs, name, varyings) {
  const p = /** @type {WebGLProgram} */ (gl.createProgram());
  const v = compile(gl, gl.VERTEX_SHADER, vs, name);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs, `${name} (fragment)`);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.transformFeedbackVaryings(p, varyings, gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`${name}: link failed: ${gl.getProgramInfoLog(p)}`);
  }
  /** @type {Record<string, WebGLUniformLocation | null>} */
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    if (info) u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
  }
  return { program: p, u };
}
