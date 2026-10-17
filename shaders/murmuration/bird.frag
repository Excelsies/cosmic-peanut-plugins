// Soft chevron edge without MSAA: the outer edges are where the tip or notch barycentric is 0.
// Coverage is 0.5 on the edge itself (a one-pixel box filter). A bird only 2-3 px long has no
// interior pixels at full coverage, so below about 4 px coverage has a floor and it reads as a
// solid speck rather than a faint smudge.
varying vec3 vBary;
varying vec4 vColor;
varying float vPx;

void main() {
  float e = min(vBary.x, vBary.y);
  float cover = clamp(e / max(fwidth(e), 1e-4) + 0.5, 0.0, 1.0);
  cover = max(cover, 0.7 * (1.0 - smoothstep(2.5, 4.5, vPx)));
  gl_FragColor = vColor * cover;
}
