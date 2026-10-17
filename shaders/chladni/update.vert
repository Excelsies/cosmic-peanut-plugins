#version 300 es
// Grain update, run through transform feedback (one POINTS draw per 1/120 s step).
// State: a = (x, y, vx, vy) with x, y in plate coordinates 0-1 and v physical (plate height 1);
// b = (z, vz), the hop's height. Constants come from src/lib/sand.js.
precision highp float;
precision highp int;

layout(location = 0) in vec4 a_a;
layout(location = 1) in vec2 a_b;
out vec4 o_a;
out vec2 o_b;

uniform vec4 u_modeA;  // figure A: n1, m1, n2, m2
uniform vec4 u_modeB;  // figure B
uniform vec4 u_field;  // signA, signB, blend A->B, aspect (width / height)
uniform vec4 u_drive;  // drive, fizz, dt, U_FLOOR
uniform vec4 u_tilt;   // tiltX, tiltY, hop vz0 (first step after a hop, else 0), hop scatter
uniform vec4 u_k;      // K_DRIFT, K_SHAKE, K_FIZZ, G_TILT
uniform vec4 u_k2;     // DAMPING, AIR_DRAG, RESTITUTION, GRAVITY
uniform uint u_step;   // global step counter (noise seed)
uniform uint u_seq;    // hop counter (scatter seed)

const float PI = 3.14159265;

uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

float unit(uint h) {
  return float(h) * (1.0 / 4294967296.0);
}

// u and its plate-coordinate gradient for one figure: cos(n1 pi x)cos(m1 pi y) + s cos(n2 pi x)cos(m2 pi y).
vec3 figure(vec4 nm, float s, vec2 p) {
  vec2 a1 = PI * nm.xy * p;
  vec2 a2 = PI * nm.zw * p;
  vec2 c1 = cos(a1), s1 = sin(a1), c2 = cos(a2), s2 = sin(a2);
  float u = c1.x * c1.y + s * c2.x * c2.y;
  float dx = -PI * (nm.x * s1.x * c1.y + s * nm.z * s2.x * c2.y);
  float dy = -PI * (nm.y * c1.x * s1.y + s * nm.w * c2.x * s2.y);
  return vec3(u, dx, dy);
}

void main() {
  vec2 p = a_a.xy;
  vec2 v = a_a.zw;
  float z = a_b.x;
  float vz = a_b.y;
  float dt = u_drive.z;
  float aspect = u_field.w;
  uint id = uint(gl_VertexID);
  bool airborne = z > 0.0 || vz > 0.0;

  if (u_tilt.z > 0.0 && !airborne) {
    // Kick: every grounded grain hops, each a little differently.
    uint h = pcg(id ^ pcg(u_seq * 2654435769u + 1u));
    uint h1 = pcg(h);
    uint h2 = pcg(h1);
    vz = u_tilt.z * (0.8 + 0.4 * unit(h));
    v += (vec2(unit(h1), unit(h2)) * 2.0 - 1.0) * u_tilt.w;
    airborne = true;
  }

  if (airborne) {
    v *= exp(-u_k2.y * dt);
    z += vz * dt;
    vz -= u_k2.w * dt;
    if (z <= 0.0) {
      z = 0.0;
      vz = 0.0;
      v *= 0.3;
    }
  } else {
    vec3 f = mix(figure(u_modeA, u_field.x, p), figure(u_modeB, u_field.y, p), u_field.z);
    vec2 grad = vec2(f.y / aspect, f.z);
    // -grad(u^2) pulls sand into the node lines; the tilt slides it toward the louder side.
    vec2 force = -u_k.x * u_drive.x * 2.0 * f.x * grad + vec2(-u_tilt.x, u_tilt.y) * u_k.w;
    uint h = pcg(id ^ pcg(u_step));
    vec2 xi = (vec2(unit(h), unit(pcg(h))) - 0.5) * 3.4641016; // unit variance per axis
    float shake = u_k.y * u_drive.x * (abs(f.x) + u_drive.w) + u_k.z * u_drive.y;
    v += force * dt + xi * shake * sqrt(dt);
    v *= exp(-u_k2.x * dt);
  }

  p += v * dt * vec2(1.0 / aspect, 1.0);
  float r = u_k2.z;
  if (p.x < 0.0) { p.x = -p.x; v.x = -v.x * r; }
  else if (p.x > 1.0) { p.x = 2.0 - p.x; v.x = -v.x * r; }
  if (p.y < 0.0) { p.y = -p.y; v.y = -v.y * r; }
  else if (p.y > 1.0) { p.y = 2.0 - p.y; v.y = -v.y * r; }
  o_a = vec4(clamp(p, 0.0, 1.0), v);
  o_b = vec2(z, vz);
}
