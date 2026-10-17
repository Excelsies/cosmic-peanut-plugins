#version 300 es
// The cotton screen lit from behind, with the shadow mask laid over it.
precision highp float;

uniform sampler2D u_mask;
uniform vec2 u_maskTexel;  // 1 / mask size
uniform float u_sharpen;   // 4-tap unsharp amount when the mask is below full resolution
uniform vec3 u_hot;        // screen colour at the lamp's hotspot (bottom, for a vertical screen)
uniform vec3 u_edge;       // screen colour in the corners (top, for a vertical screen)
uniform vec3 u_shadow;
uniform vec2 u_hotspot;    // uv, y up
uniform float u_aspect;
uniform float u_vertical;  // 1 = a vertical dusk gradient instead of a hotspot
uniform float u_period;    // weave period, device px
uniform float u_weave;     // weave contrast
uniform float u_gain;      // lamp flicker
uniform float u_clear;     // 1 = no screen: premultiplied shadows only
in vec2 v_uv;
out vec4 o;

void main() {
  float m = texture(u_mask, v_uv).r;
  if (u_sharpen > 0.0) {
    float n = texture(u_mask, v_uv + vec2(u_maskTexel.x, 0.0)).r
            + texture(u_mask, v_uv - vec2(u_maskTexel.x, 0.0)).r
            + texture(u_mask, v_uv + vec2(0.0, u_maskTexel.y)).r
            + texture(u_mask, v_uv - vec2(0.0, u_maskTexel.y)).r;
    m = clamp(m + u_sharpen * (4.0 * m - n), 0.0, 1.0);
  }
  if (u_clear > 0.5) {
    o = vec4(u_shadow * m, m);
    return;
  }
  vec2 d = (v_uv - u_hotspot) * vec2(u_aspect, 1.0);
  float r = length(d) / length(vec2(0.5 * u_aspect, 0.6));
  float hot = mix(exp(-2.6 * r * r), 1.0 - v_uv.y, u_vertical);
  vec3 screen = mix(u_edge, u_hot, hot);
  vec2 w = gl_FragCoord.xy * (6.2831853 / u_period);
  screen *= 1.0 - u_weave * (0.5 + 0.25 * (cos(w.x) + cos(w.y)));
  screen *= u_gain;
  o = vec4(mix(screen, u_shadow, m), 1.0);
}
