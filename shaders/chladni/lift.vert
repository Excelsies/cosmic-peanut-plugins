#version 300 es
// Airborne grains a second time, where they show in flight: lifted by their height (u_lift), each
// carrying the light it gave in place, read from the first deposit at its ground position (the
// composite's own blur and coverage curve), so a hop moves the dust's light instead of adding it.
// R = the dust's light (grounded-coverage units), G = its density (the plate backdrop's dust).
precision highp float;
layout(location = 0) in vec4 a_a;
layout(location = 1) in vec2 a_b;
uniform sampler2D u_den;  // first deposit: R grounded, G airborne in place
uniform vec2 u_texel;     // 1 / density size
uniform vec4 u_dep;       // as deposit.vert
uniform vec3 u_lift;      // screen offset (plate units) = u_lift.xy · height^u_lift.z (x already / aspect)
out vec2 v_w;

float cover(float r) {
  return 1.0 - exp(-1.6 * r);
}

void main() {
  if (a_b.x <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0); // grounded: clipped
    gl_PointSize = 1.0;
    v_w = vec2(0.0);
    return;
  }
  vec2 uv = a_a.xy;
  vec4 c = textureLod(u_den, uv, 0.0);
  vec4 e = textureLod(u_den, uv + vec2(u_texel.x, 0.0), 0.0);
  vec4 w = textureLod(u_den, uv - vec2(u_texel.x, 0.0), 0.0);
  vec4 n = textureLod(u_den, uv + vec2(0.0, u_texel.y), 0.0);
  vec4 s = textureLod(u_den, uv - vec2(0.0, u_texel.y), 0.0);
  float hr = c.r * 0.6 + (e.r + w.r + n.r + s.r) * 0.1;
  float g = c.g * 0.6 + (e.g + w.g + n.g + s.g) * 0.1;
  // Light per unit of dust density here: what the dust adds over the grounded sand, per density.
  float lam = (cover(hr + g) - cover(hr)) / max(g, 1e-6); // airborne grains splat like grounded ones
  vec2 p = uv + u_lift.xy * pow(a_b.x, u_lift.z);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = u_dep.w;
  v_w = vec2(u_dep.y * lam, u_dep.y);
}
