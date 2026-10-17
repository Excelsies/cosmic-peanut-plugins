// Dusk sky: vertical gradient, faint drifting cirrus (3-octave value noise stretched sideways, at
// most ~6% contrast), a thin static reedbed silhouette along the bottom 4%. Never pulses.
// (sky.glsl is prepended.)
uniform vec2 uRes;    // drawing-buffer size, px
uniform float uDrift; // cirrus offset (accumulated on the CPU)
uniform vec3 uReed;
varying vec2 vUv;

float hash11(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float vnoise1(float x) {
  float i = floor(x);
  float f = fract(x);
  return mix(hash11(i), hash11(i + 1.0), f * f * (3.0 - 2.0 * f));
}

// Reedbed coverage at (x, y) in frame-height units (x aspect-corrected), all within the bottom
// 4%: a low uneven bank, a dense layer of short grass blades and sparse tall reeds, some with a
// plume, leaning a little. `px` is one pixel in the same units (edges are 1-px soft).
float stems(vec2 p, float px, float freq, float prob, float hMin, float hMax, float plume, float seed) {
  float cover = 0.0;
  float k0 = floor(p.x * freq);
  for (int o = -1; o <= 1; o++) {
    float k = k0 + float(o);
    if (hash11(k + seed) > prob) continue;
    float h = mix(hMin, hMax, hash11(k + seed + 1.7));
    float lean = (hash11(k + seed + 3.1) - 0.5) * 0.6;
    float x0 = (k + 0.2 + 0.6 * hash11(k + seed + 5.3)) / freq;
    float t = clamp(p.y / h, 0.0, 1.0);
    float cx = x0 + lean * p.y * p.y / h; // bends more toward the top
    float w = px * (0.9 + 0.8 * hash11(k + seed + 7.9)) * (1.0 - 0.7 * t);
    if (plume > 0.0 && hash11(k + seed + 9.4) < plume) w += px * 1.3 * smoothstep(0.7, 0.8, t) * (1.0 - smoothstep(0.93, 1.0, t));
    float inside = 1.0 - smoothstep(w - px * 0.5, w + px * 0.5, abs(p.x - cx));
    cover = max(cover, inside * (1.0 - smoothstep(h - px, h, p.y)));
  }
  return cover;
}

float reeds(vec2 p, float px) {
  float bank = 0.008 + 0.005 * vnoise1(p.x * 3.0) + 0.003 * vnoise1(p.x * 13.0 + 4.0);
  float c = 1.0 - smoothstep(bank - px, bank + px, p.y);
  c = max(c, stems(p, px, 300.0, 0.85, 0.011, 0.022, 0.0, 11.0));
  c = max(c, stems(p, px, 120.0, 0.7, 0.02, 0.04, 0.45, 37.0));
  return c;
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec3 col = skyColour(vUv.y);

  vec2 q = vec2(vUv.x * aspect * 1.4 + uDrift, vUv.y * 16.0);
  float n = 0.5 * vnoise(q) + 0.25 * vnoise(q * vec2(2.1, 1.9) + 5.1) + 0.125 * vnoise(q * vec2(4.3, 3.7) + 9.7);
  n /= 0.875;
  float upper = smoothstep(0.25, 0.5, vUv.y) * (1.0 - smoothstep(0.8, 1.0, vUv.y));
  float cirrus = smoothstep(0.5, 0.85, n) * upper;
  col = mix(col, min(col * 1.05 + 0.012, vec3(1.0)), cirrus);

  if (vUv.y < 0.045) col = mix(col, uReed, reeds(vec2(vUv.x * aspect, vUv.y), 1.0 / uRes.y));

  // Dither against gradient banding (static: tied to the pixel, not time).
  col += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
