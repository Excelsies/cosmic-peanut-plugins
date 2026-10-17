// Soft chevron edge without MSAA: the outer edges are where the tip or notch barycentric is 0.
varying vec3 vBary;
varying vec4 vColor;

void main() {
  float e = min(vBary.x, vBary.y);
  float cover = clamp(e / max(fwidth(e), 1e-4) + 0.25, 0.0, 1.0);
  gl_FragColor = vColor * cover;
}
