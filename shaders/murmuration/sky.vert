// Full-screen sky: PlaneGeometry(2, 2) written straight to clip space, just in front of the far plane.
varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.999, 1.0);
}
