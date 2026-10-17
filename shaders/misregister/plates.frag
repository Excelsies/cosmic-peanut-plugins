#version 300 es
// Misregister plate pass (half resolution, two render targets).
//   oDensity.rgb  ink density of plates 0, 1, 2: each shape's ramp on its plate and the flat tint
//                 uTint on its tint plate, written wherever the shape's SDF is under one screen
//                 cell (dilated, so the halftone pass finds the shape's density at edge cells
//                 whose centre falls just outside it); max over shapes.
//   oDist.rgb     signed distance to each plate's union of shapes (a shape belongs to its plate
//                 and its tint plate), 0.5 + sdf / 16 half-res px.
// Shapes are analytic SDFs in a y-down local frame (+y towards the canvas bottom).
precision highp float;

layout(location = 0) out vec4 oDensity;
layout(location = 1) out vec4 oDist;

uniform vec4 uShape[36];  // see src/lib/poster.js
uniform vec2 uFull;       // canvas size, device px
uniform vec2 uHalf;       // this target's size
uniform float uCell;      // halftone cell, device px
uniform float uTint;      // ink density of every shape's tint plate

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Annulus of outer radius r and width w around c.
float sdRing(vec2 p, vec2 c, float r, float w) {
  return abs(length(p - c) - (r - 0.5 * w)) - 0.5 * w;
}

float shapeSdf(int type, vec2 p, vec2 h) {
  if (type == 0) return sdBox(p, h);                                   // box
  if (type == 1) return length(p) - min(h.x, h.y);                     // disc
  if (type == 2) {                                                     // half-disc, flat side down
    vec2 c = vec2(0.0, h.y);
    return max(length(p - c) - min(h.x, 2.0 * h.y), p.y - h.y);
  }
  if (type == 3) {                                                     // quarter-disc, corner bottom-left
    vec2 c = vec2(-h.x, h.y);
    return max(length(p - c) - 2.0 * min(h.x, h.y), max(-h.x - p.x, p.y - h.y));
  }
  if (type == 4) {                                                     // right triangle, right angle bottom-left
    float hyp = (p.x / h.x - p.y / h.y) / length(vec2(1.0 / h.x, 1.0 / h.y));
    return max(max(-h.x - p.x, p.y - h.y), hyp);
  }
  if (type == 5) {                                                     // 180° ring arc, open side down
    vec2 c = vec2(0.0, h.y);
    float r = min(h.x, 2.0 * h.y);
    return max(sdRing(p, c, r, 0.36 * r), p.y - h.y);
  }
  if (type == 6) {                                                     // 90° ring arc, centre bottom-left
    vec2 c = vec2(-h.x, h.y);
    float r = 2.0 * min(h.x, h.y);
    return max(sdRing(p, c, r, 0.36 * r), max(-h.x - p.x, p.y - h.y));
  }
  if (type == 7) {                                                     // row of 5 dots
    float sp = 0.4 * h.x;
    float k = clamp(floor((p.x + h.x) / sp), 0.0, 4.0);
    return length(p - vec2(-h.x + sp * (k + 0.5), 0.0)) - min(0.42 * sp, h.y);
  }
  if (type == 8) {                                                     // 3 steps rising to the right
    float cw = h.x / 3.0;
    float d = 1e5;
    for (int k = 0; k < 3; k++) {
      float hh = h.y * float(k + 1) / 3.0;
      d = min(d, sdBox(p - vec2(-h.x + cw * (2.0 * float(k) + 1.0), h.y - hh), vec2(cw, hh)));
    }
    return d;
  }
  return sdBox(p, vec2(h.x, 0.35 * h.y));                              // thin bar
}

void main() {
  vec2 frag = gl_FragCoord.xy * (uFull / uHalf);
  vec2 p = vec2(frag.x, uFull.y - frag.y);
  vec3 dens = vec3(0.0);
  vec3 dist = vec3(1e5);
  for (int i = 0; i < 12; i++) {
    vec4 a = uShape[i * 3];
    vec4 b = uShape[i * 3 + 1];
    vec4 r = uShape[i * 3 + 2];
    float cs = b.y;
    float sn = b.z;
    vec2 d = p - a.xy;
    vec2 l = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);
    l.x *= b.w;
    vec2 h = max(a.zw, vec2(0.5));
    float sd = shapeSdf(int(b.x + 0.5), l, h);
    float t = clamp(0.5 + 0.5 * l.x / h.x, 0.0, 1.0);
    float ramp = min(1.0, mix(r.x, r.y, t) + r.z);
    int code = int(r.w + 0.5);               // plate + 3 × tint plate
    vec3 m0 = vec3(equal(ivec3(code % 3), ivec3(0, 1, 2)));
    vec3 m1 = vec3(equal(ivec3(code / 3), ivec3(0, 1, 2)));
    dens = max(dens, (m0 * ramp + m1 * uTint) * (sd < uCell ? 1.0 : 0.0));
    dist = min(dist, mix(vec3(1e5), vec3(sd), m0 + m1));
  }
  float halfPx = uFull.y / uHalf.y;
  oDensity = vec4(dens, 1.0);
  oDist = vec4(clamp(0.5 + dist / (16.0 * halfPx), 0.0, 1.0), 1.0);
}
