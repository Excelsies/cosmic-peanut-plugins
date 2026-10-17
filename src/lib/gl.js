// @ts-check
/** Small WebGL2 helpers (copied from the built-ins). Errors carry the shader log for the dev overlay. */

/**
 * @param {WebGL2RenderingContext} gl
 * @param {number} type
 * @param {string} src
 * @param {string} name for error messages
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
 * Compile and link a program, returning it with its active uniform locations by name.
 * @param {WebGL2RenderingContext} gl
 * @param {string} vs vertex source
 * @param {string} fs fragment source
 * @param {string} name label for errors, e.g. the fragment file path
 */
export function createProgram(gl, vs, fs, name) {
  const p = /** @type {WebGLProgram} */ (gl.createProgram());
  const v = compile(gl, gl.VERTEX_SHADER, vs, `${name} (vertex)`);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs, name);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
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
