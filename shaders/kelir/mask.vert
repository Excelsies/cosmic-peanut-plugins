#version 300 es
// One instanced quad per silhouette: its stage-space bounding box (screen heights, y up).
uniform vec4 u_box[3];
uniform float u_aspect;
out vec2 v_p;
flat out int v_inst;
void main() {
  vec4 b = u_box[gl_InstanceID];
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  v_p = mix(b.xy, b.zw, c);
  v_inst = gl_InstanceID;
  gl_Position = vec4(v_p.x / u_aspect * 2.0 - 1.0, v_p.y * 2.0 - 1.0, 0.0, 1.0);
}
