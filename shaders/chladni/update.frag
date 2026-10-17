#version 300 es
// Never runs (the update pass draws with RASTERIZER_DISCARD); a program needs a fragment stage.
precision mediump float;
out vec4 o;
void main() {
  o = vec4(0.0);
}
