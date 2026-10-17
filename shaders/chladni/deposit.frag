#version 300 es
precision mediump float;
in vec2 v_w;
out vec4 o;
void main() {
  o = vec4(v_w, 0.0, 0.0);
}
