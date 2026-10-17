#version 300 es
// Shadow coverage of one silhouette: the min over its primitives (src/kelir/lib/puppets.js) of
// the signed distance in each primitive's bone space, pierced by the lace, softened by the
// penumbra. Blended with MAX into an R8 mask.
precision highp float;
precision highp int;

uniform vec4 u_prims[128]; // 64 records of 2 vec4: (ax, ay, bx, by), (r1, r2, type, bone)
uniform mat3 u_bones[18];  // stage -> bone
uniform ivec2 u_range[3];  // (start, count) per instance
uniform vec3 u_look[3];    // (mask px per bone unit, penumbra half-width px, opacity)
uniform float u_spacing[3]; // lace lattice spacing, bone units
in vec2 v_p;
flat in int v_inst;
out vec4 o;

// #include sdf

const float BORDER = 0.012;

void main() {
  ivec2 r = u_range[v_inst];
  vec3 look = u_look[v_inst];
  float d = 1e9;
  vec2 q = vec2(0.0);
  for (int i = r.x; i < r.x + r.y; i++) {
    vec4 a = u_prims[2 * i];
    vec4 m = u_prims[2 * i + 1];
    int type = int(m.z + 0.5);
    vec2 p = (u_bones[int(m.w + 0.5)] * vec3(v_p, 1.0)).xy;
    if ((type & 8) != 0) p.x = abs(p.x);
    int base = type & 7;
    float ds;
    if (base == 0) ds = sdSegment(p, a.xy, a.zw) - m.x;
    else if (base == 1) ds = sdUneven(p, a.xy, a.zw, m.x, m.y);
    else if (base == 2) ds = sdVesica(p, a.xy, a.zw, m.x, m.y);
    else if (base == 3) {
      ds = sdTriangle(p, a.xy, a.zw, u_prims[2 * i + 2].xy);
      i++;
    } else if (base == 4) ds = length(p - a.xy) - m.x;
    else ds = sdBox(p - a.xy, m.xy);
    if ((type & 16) != 0) d = max(d, -ds);
    else if (ds < d) {
      d = ds;
      q = p;
    }
  }
  float cov = laceCoverage(d, q, u_spacing[v_inst], BORDER, look.x, look.y) * look.z;
  o = vec4(cov, 0.0, 0.0, 1.0);
}
