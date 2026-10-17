#version 300 es
// Soapfilm composite (full resolution): the film's thickness per pixel (lib film.js), coloured
// through the thin-film interference table (lib thinfilm.js), lit by one large soft source, over
// the backdrop, with a hairline wire frame at the window edges. The base bands are evaluated per
// pixel here, so they stay hairline-crisp; only the smooth displacement and plume film come from
// the half-resolution state.
// Output: premultiplied sRGB for the transparent canvas (alpha 1 on opaque backdrops; on 'none'
// alpha = max(rgb), so the black film is fully transparent).
precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 o;

uniform sampler2D u_state;
uniform sampler2D u_table;   // 512 x 3, gamma 2.2 RGBA8: thickness 0-1400 nm x incidence 0/30/50 deg
uniform vec2 u_res;          // canvas pixels
uniform float u_aspect;
uniform float u_dpr;
uniform float u_age;         // film age above the wipe front
uniform float u_front;       // re-dip wipe front (v), 2 when idle; below it the film is new (age 0)
uniform float u_thickness;
uniform float u_tanTilt;
uniform float u_bass;        // membrane amount
uniform float u_m;           // membrane mode blend
uniform float u_shimmerAmp;  // nm
uniform float u_shimmerPhase;
uniform float u_row;         // table row coordinate for the angle of incidence
uniform int u_backdrop;      // 0 velvet, 1 studio, 2 none
uniform int u_encoded;

const float PI = 3.14159265;

float hash2(ivec2 p) {
  uint h = (uint(p.x) * 0x8da6b343u) ^ (uint(p.y) * 0xd8163841u);
  h ^= h >> 13u;
  h *= 0x5bd1e995u;
  h ^= h >> 15u;
  return float(h) * (1.0 / 4294967296.0);
}
float vnoise(vec2 x) {
  vec2 i = floor(x);
  vec2 f = x - i;
  vec2 w = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  float a = hash2(c);
  float b = hash2(c + ivec2(1, 0));
  float d = hash2(c + ivec2(0, 1));
  float e = hash2(c + ivec2(1, 1));
  return mix(mix(a, b, w.x), mix(d, e, w.x), w.y);
}

vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// film.js blackFront, hMax and hBase, with the black edge antialiased over 1.5 pixels.
float thickness(vec2 q, float age, float aa) {
  float vb = 0.55 * (1.0 - exp(-age / 90.0));
  float hm = min(1350.0, 1150.0 * u_thickness * (0.6 + 0.4 * exp(-age / 180.0)));
  float vp = q.y + u_tanTilt * (q.x - 0.5) * u_aspect + 0.012 * vnoise(vec2(3.0 * q.x, 0.05 * age));
  float s = clamp((vp - vb) / (1.0 - vb), 0.0, 1.0);
  return (90.0 + (hm - 90.0) * pow(s, 0.65)) * smoothstep(0.0, aa, vp - vb);
}

void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec4 s = texture(u_state, v_uv);
  vec2 d = s.xy;
  float film = s.z;
  if (u_encoded == 1) {
    d = (s.xy - 0.5) * 0.5;
    film = max(0.0, (s.z - 0.5) * 1.2);
  }
  vec2 q = uv + d;
  float aa = max(1.5 * fwidth(q.y), 1e-5);
  float hb = thickness(q, u_age, aa);
  if (u_front < 1.5) {
    float hNew = thickness(uv, 0.0, aa);
    hb = mix(hb, hNew, smoothstep(u_front - 0.012, u_front + 0.012, uv.y));
  }
  float su = sin(PI * uv.x);
  float mode = su * sin(PI * uv.y) * (1.0 - u_m) + su * sin(2.0 * PI * uv.y) * u_m;
  float shimmer = u_shimmerAmp * (2.0 * vnoise(vec2(60.0 * uv.x * u_aspect, 60.0 * uv.y + u_shimmerPhase)) - 1.0);
  float h = max(0.0, hb * (1.0 + u_bass * mode) + 1000.0 * film + shimmer);

  vec3 refl = pow(texture(u_table, vec2((min(h, 1400.0) / 1400.0 * 511.0 + 0.5) / 512.0, u_row)).rgb, vec3(2.2));
  float lobe = (uv.y - 0.28 + 0.25 * (uv.x - 0.5)) / 0.16;
  float light = 0.78 + 0.32 * exp(-lobe * lobe);
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  light *= 1.0 + 0.1 * (1.0 - smoothstep(0.0, 0.04, edge));
  refl *= light;

  vec3 rgb;
  float alpha = 1.0;
  ivec2 px = ivec2(gl_FragCoord.xy);
  if (u_backdrop == 2) {
    rgb = toSrgb(refl);
  } else {
    vec3 back = u_backdrop == 0
      ? toLinear(mix(vec3(26.0, 24.0, 32.0), vec3(18.0, 17.0, 23.0), uv.y) / 255.0) * (1.0 + 0.04 * (hash2(px + ivec2(7919, 104729)) - 0.5))
      : toLinear(vec3(58.0, 58.0, 62.0) / 255.0);
    rgb = toSrgb(refl + back * (1.0 - clamp(max(refl.r, max(refl.g, refl.b)), 0.0, 1.0)));
  }

  // Hairline wire at the four window edges.
  vec2 fc = gl_FragCoord.xy;
  float de = min(min(fc.x, u_res.x - fc.x), min(fc.y, u_res.y - fc.y));
  float wire = clamp(1.5 * u_dpr + 0.5 - de, 0.0, 1.0);
  vec3 wireCol = vec3(42.0, 44.0, 48.0) / 255.0;

  rgb += (hash2(px) - 0.5) / 255.0;
  rgb = clamp(rgb, 0.0, 1.0);
  if (u_backdrop == 2) alpha = max(rgb.r, max(rgb.g, rgb.b));
  o = vec4(mix(rgb, wireCol, wire), mix(alpha, 1.0, wire));
}
