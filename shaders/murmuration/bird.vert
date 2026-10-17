// One starling (or the falcon): a chevron built in view space from the instance's position and
// heading, with flap, banking roll and the agitation wave. (sky.glsl is prepended.)
//
// position.xy = (forward, side) in bird lengths; position.z = vertex kind:
//   0 tip, 1 notch, 2 wing tip (two soft-edged wing triangles), 3 falcon (solid).
attribute vec3 iPos;
attribute vec3 iDir;
attribute float iRoll;
attribute float iFlap;

uniform float uSize;      // bird length, world units
uniform float uScale;     // 1 for birds, 3 for the falcon
uniform float uPxPerUnit; // drawing-buffer px per world unit at distance 1
uniform float uMinPx;     // minimum on-screen size, drawing-buffer px
uniform vec2 uCentre;     // flock centre
uniform float uSqueeze;   // 0..1, flash-limited
uniform vec4 uWave0;      // origin xy, radius, darkening amount
uniform vec4 uWave1;
uniform float uShell;
uniform float uTime;
uniform float uShimmer;
uniform float uAlpha;
uniform vec3 uInk;
uniform float uDepthMix;

varying vec3 vBary;
varying vec4 vColor;

float hash1(float n) {
  return fract(sin(n * 12.9898) * 43758.5453);
}

float shellAt(vec2 p, vec4 w) {
  float d = distance(p, w.xy);
  return w.w * smoothstep(w.z - uShell - 0.02, w.z - uShell, d) * (1.0 - smoothstep(w.z, w.z + 0.02, d));
}

void main() {
  float id = float(gl_InstanceID);
  vec3 p = iPos;
  // Squeeze: the silhouette contracts a little toward the flock centre.
  p.xy = uCentre + (p.xy - uCentre) * (1.0 - 0.1 * uSqueeze);
  // Shimmer: a tiny per-bird jitter with the highs.
  p.xy += (vec2(hash1(id), hash1(id + 7.1)) - 0.5) * (uShimmer * 0.008 * sin(uTime * 23.0 + id));

  float m = max(shellAt(p.xy, uWave0), shellAt(p.xy, uWave1));

  vec2 fwd = iDir.xy;
  float l = length(fwd);
  fwd = l > 1e-5 ? fwd / l : vec2(1.0, 0.0);
  vec2 side = vec2(-fwd.y, fwd.x);

  float kind = position.z;
  float flap = sin(6.2831853 * iFlap);
  // Banking narrows the wings; inside the wave birds roll to show their full wing area.
  float span = max(0.25, abs(cos(iRoll))) * (0.62 + 0.38 * flap);
  span = mix(span, 1.0, m);
  vec2 loc = position.xy;
  float wingTip = step(1.5, kind) * step(kind, 2.5);
  loc.x += wingTip * 0.12 * flap;
  loc.y *= kind > 2.5 ? 1.0 : span;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // Agitated birds show their whole wing area: a bigger, darker silhouette.
  float size = uSize * uScale * (0.8 + 0.4 * hash1(id + 3.3)) * (1.0 + 0.6 * m);
  float onScreen = size * uPxPerUnit / max(-mv.z, 1e-3);
  size *= max(1.0, uMinPx / max(onScreen, 1e-4));
  mv.xy += (fwd * loc.x + side * loc.y) * size;
  gl_Position = projectionMatrix * mv;

  // Atmospheric depth: far birds take on some of the sky colour at their height.
  float skyT = clamp(gl_Position.y / gl_Position.w * 0.5 + 0.5, 0.0, 1.0);
  float far = clamp((1.2 - iPos.z) / 2.4, 0.0, 1.0);
  vec3 col = mix(uInk, skyColour(skyT), uDepthMix * far * (1.0 - m));
  float a = mix(min(1.0, uAlpha + 0.15 * uSqueeze), 1.0, m);
  vColor = vec4(col * a, a);
  vBary = kind < 0.5 ? vec3(1.0, 0.0, 0.0) : kind < 1.5 ? vec3(0.0, 1.0, 0.0) : kind < 2.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0);
}
