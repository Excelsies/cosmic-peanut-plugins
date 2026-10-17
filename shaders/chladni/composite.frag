#version 300 es
// Full-resolution composite: brushed plate, sand in matte low relief lit from the upper left,
// airborne dust with a small offset shadow. Backdrop none: premultiplied sand only.
precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 o;

uniform sampler2D u_den;  // R grounded density, G airborne density (half resolution)
uniform vec2 u_texel;     // 1 / density size
uniform vec2 u_res;       // canvas size (px)
uniform vec3 u_pal[4];    // plate bottom, plate top, sand, sand on no backdrop
uniform vec4 u_look;      // brushing, sheen, haze envelope (flash-limited), backdrop none (0/1)

const vec3 LIGHT = vec3(-0.6, 0.6, 0.55);

uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

float hash2(int x, int y) {
  return float(pcg(uint(x) ^ pcg(uint(y)))) * (1.0 / 4294967296.0);
}

// Static brushed metal: one streak per pixel row, each row a slow value noise along x, plus grain.
vec3 plate(vec2 uv) {
  vec3 base = mix(u_pal[0], u_pal[1], smoothstep(0.0, 1.0, uv.y));
  vec2 px = uv * u_res;
  int row = int(px.y);
  float fx = px.x / 420.0;
  int ix = int(floor(fx));
  float t = fx - float(ix);
  t = t * t * (3.0 - 2.0 * t);
  float streak = mix(hash2(ix, row), hash2(ix + 1, row), t);
  float coarse = mix(hash2(ix, row / 6 + 7919), hash2(ix + 1, row / 6 + 7919), t);
  float fine = hash2(int(px.x), row + 104729);
  float brush = (streak - 0.5) * 0.035 + (coarse - 0.5) * 0.04 + (fine - 0.5) * 0.02;
  // Diagonal sheen from the upper left, never audio-driven.
  float aspect = u_res.x / u_res.y;
  float d = (uv.x * aspect * 0.55 + (1.0 - uv.y) * 0.85) / (aspect * 0.55 + 0.85);
  float sheen = exp(-pow((d - 0.38) / 0.16, 2.0)) * 0.16 + exp(-pow((d - 0.42) / 0.45, 2.0)) * 0.07;
  vec3 c = base * (1.0 + brush * u_look.x) + sheen * u_look.y * mix(base, vec3(1.0, 0.94, 0.82), 0.6);
  return c;
}

float cover(float r) {
  return 1.0 - exp(-1.6 * r);
}

void main() {
  vec2 uv = v_uv;
  vec4 c = texture(u_den, uv);
  vec4 e = texture(u_den, uv + vec2(u_texel.x, 0.0));
  vec4 w = texture(u_den, uv - vec2(u_texel.x, 0.0));
  vec4 n = texture(u_den, uv + vec2(0.0, u_texel.y));
  vec4 s = texture(u_den, uv - vec2(0.0, u_texel.y));

  float h = cover(c.r * 0.6 + (e.r + w.r + n.r + s.r) * 0.1);
  vec2 slope = vec2(cover(e.r) - cover(w.r), cover(n.r) - cover(s.r));
  vec3 nrm = normalize(vec3(-slope * 1.6, 1.0));
  vec3 l = normalize(LIGHT);
  float lam = max(dot(nrm, l), 0.0) / l.z;            // 1 on a flat surface
  float rim = dot(nrm.xy, normalize(l.xy)) * (1.0 - nrm.z) * 6.0; // + facing the light, - away
  float shade = clamp(0.25 + 0.75 * lam, 0.3, 1.6);

  float g = (c.g * 0.4 + (e.g + w.g + n.g + s.g) * 0.15);
  float dust = (1.0 - exp(-2.0 * g)) * mix(0.65, 1.0, u_look.z);

  if (u_look.w > 0.5) {
    // No plate: premultiplied sand over whatever is behind the window (matte, normal alpha).
    vec3 sand = u_pal[3];
    vec3 lit = min(sand * shade + clamp(rim, 0.0, 1.0) * 0.35, vec3(1.0));
    float d = dust * 0.8 * (1.0 - h);
    o = vec4(lit * h + sand * 0.85 * d, h + d);
    return;
  }

  vec3 sand = u_pal[2];
  vec3 col = plate(uv);
  // Ridges cast a thin shadow onto the plate on the side away from the light.
  col *= 1.0 - clamp(-rim, 0.0, 1.0) * 0.45;
  vec3 grain = sand * shade + clamp(rim, 0.0, 1.0) * mix(sand, vec3(1.0, 0.93, 0.8), 0.5) * 0.55;
  col = mix(col, grain, h);
  // Dust: soft, a touch lighter than the settled sand, with a small shadow down and to the right.
  vec2 so = vec2(-0.0035, 0.0055);
  float gs = 0.5 * (texture(u_den, uv + so).g + texture(u_den, uv + so * 0.6 + u_texel * 1.5).g);
  col *= 1.0 - (1.0 - exp(-2.0 * gs)) * 0.18;
  col = mix(col, mix(sand, col, 0.25), dust * 0.85);
  col = mix(col, sand, 0.06 * u_look.z);
  o = vec4(col, 1.0);
}
