#version 300 es
// Splat each grain into the half-resolution density target: R = grounded sand, G = airborne dust
// (drawn a little larger). Additive ONE, ONE.
precision highp float;
layout(location = 0) in vec4 a_a;
layout(location = 1) in vec2 a_b;
uniform vec4 u_dep; // weight grounded, weight airborne, point size grounded, point size airborne
out vec2 v_w;
void main() {
  bool air = a_b.x > 0.0;
  gl_Position = vec4(a_a.xy * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = air ? u_dep.w : u_dep.z;
  v_w = air ? vec2(0.0, u_dep.y) : vec2(u_dep.x, 0.0);
}
