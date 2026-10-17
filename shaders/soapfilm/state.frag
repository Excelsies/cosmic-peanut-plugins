#version 300 es
// Soapfilm state pass (half resolution, one fixed 1/60 s step): advects the film's displacement
// map d (the film here came from uv + d) and the fresh plume film p (microns) through the flow,
// semi-Lagrangian: state(x) = state(x - vel(x) dt). The flow is a slow downward drainage drift,
// a curl-noise swirl (laminar when quiet, eddies when loud) and each live plume's upward jet with
// a vortex pair that curls its head into a mushroom. d relaxes back toward 0 over ~4 s and p
// fades over ~8 s. Below the re-dip wipe front everything is cleared to fresh film.
// Coordinates: uv with v = 0 at the top; distances in units of the height (aspect-corrected).
// RGBA16F stores (d.x, d.y, p, 1); the RGBA8 fallback stores (0.5 + 2d, 0.5 + p / 1.2, 1).
precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 o;

uniform sampler2D u_state;
uniform float u_dt;
uniform float u_time;
uniform float u_aspect;   // W / H
uniform float u_drift;    // downward drainage drift, uv/s
uniform float u_swirl;    // curl-noise swirl amplitude, uv/s
uniform float u_relaxD;   // exp(-dt / 4)
uniform float u_relaxP;   // exp(-dt / 8)
uniform float u_front;    // re-dip wipe front (v), 2 when idle
uniform int u_encoded;    // 1 = RGBA8 fallback encoding
uniform vec4 u_plume[6];  // x, y (head), r, rise; r = 0 when dead
uniform float u_src[6];   // fresh film emitted, microns/s

const float PI = 3.14159265;

// Same uint hash and value noise as lib film.js (hash2, vnoise).
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

// Stream function of the swirl (p in height units).
float psi(vec2 p) {
  return vnoise(vec2(3.0 * p.x, 3.0 * p.y + 0.02 * u_time)) + 0.5 * vnoise(vec2(7.0 * p.x, 7.0 * p.y - 0.03 * u_time));
}

// Rankine vortex of circulation g and core radius rc at offset rel from its centre.
vec2 vortex(vec2 rel, float g, float rc) {
  return g / (2.0 * PI * max(dot(rel, rel), rc * rc)) * vec2(-rel.y, rel.x);
}

vec4 readState(vec2 uv) {
  vec4 s = texture(u_state, vec2(uv.x, 1.0 - uv.y));
  if (u_encoded == 1) return vec4((s.xy - 0.5) * 0.5, max(0.0, (s.z - 0.5) * 1.2), 1.0);
  return s;
}

void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 p = vec2(uv.x * u_aspect, uv.y);

  // Curl of psi by central differences, scaled by the base frequency so |curl| is about 1.
  const float E = 0.01;
  float dpdy = psi(p + vec2(0.0, E)) - psi(p - vec2(0.0, E));
  float dpdx = psi(p + vec2(E, 0.0)) - psi(p - vec2(E, 0.0));
  vec2 vel = u_swirl * vec2(dpdy, -dpdx) / (2.0 * E * 3.0);
  vel.y += u_drift;

  float src = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 pl = u_plume[i];
    float r = pl.z;
    if (r <= 0.0) continue;
    vec2 c = vec2(pl.x * u_aspect, pl.y);
    vec2 rel = p - c;
    float d2 = dot(rel, rel);
    float rise = pl.w;
    vel.y -= rise * exp(-d2 / (2.25 * r * r));
    float g = 2.0 * rise * r;
    vel += vortex(rel + vec2(0.8 * r, 0.0), -g, 0.6 * r);
    vel += vortex(rel - vec2(0.8 * r, 0.0), g, 0.6 * r);
    src += u_src[i] * exp(-d2 / (r * r));
  }

  vec2 step = vec2(vel.x / u_aspect, vel.y) * u_dt;
  vec4 s = readState(uv - step);
  vec2 d = (s.xy - step) * u_relaxD;
  float len = length(d);
  if (len > 0.2) d *= 0.2 / len;
  float film = s.z * u_relaxP + src * u_dt;
  if (uv.y > u_front) {
    d = vec2(0.0);
    film = 0.0;
  }
  o = u_encoded == 1 ? vec4(0.5 + 2.0 * d, 0.5 + film / 1.2, 1.0) : vec4(d, film, 1.0);
}
