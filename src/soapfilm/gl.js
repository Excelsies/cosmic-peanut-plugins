// @ts-check
/** Small WebGL2 helpers shared by the built-ins. Errors carry the shader log for the dev overlay. */

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

/**
 * A color texture + framebuffer for offscreen passes. Uses RGBA16F when the GPU can render to it
 * (smooth feedback trails), else RGBA8.
 * @param {WebGL2RenderingContext} gl
 */
export function createTarget(gl) {
  const float = Boolean(gl.getExtension("EXT_color_buffer_float"));
  const tex = /** @type {WebGLTexture} */ (gl.createTexture());
  const fbo = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer());
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return {
    tex,
    fbo,
    width: 0,
    height: 0,
    /** (Re)allocate storage and clear to black. @param {number} w @param {number} h */
    resize(w, h) {
      this.width = w;
      this.height = h;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    dispose() {
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fbo);
    },
  };
}
