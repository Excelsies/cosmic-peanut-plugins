// Kelir's 2D signed distances (iq's exact forms) and the lace. Mirrored in JS by
// src/kelir/lib/puppets.js (sdfRange, holeDistance, laceCoverage): keep the two in step.

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
  return length(pa - ba * h);
}

// Uneven capsule from a (radius r1) to b (radius r2).
float sdUneven(vec2 p, vec2 a, vec2 b, float r1, float r2) {
  vec2 d = b - a;
  float h = length(d);
  if (h <= abs(r1 - r2) + 1e-6) return length(p - a) - max(r1, r2);
  vec2 u = d / h;
  vec2 q = vec2(abs((p.x - a.x) * u.y - (p.y - a.y) * u.x), dot(p - a, u));
  float bb = (r1 - r2) / h;
  float aa = sqrt(1.0 - bb * bb);
  float k = dot(q, vec2(-bb, aa));
  if (k < 0.0) return length(q) - r1;
  if (k > aa * h) return length(q - vec2(0.0, h)) - r2;
  return dot(q, vec2(aa, bb)) - r1;
}

// Vesica centred at c, unit long axis u, half-width w, half-height hh (hh > w).
float sdVesica(vec2 p, vec2 c, vec2 u, float w, float hh) {
  vec2 q = abs(vec2((p.x - c.x) * u.y - (p.y - c.y) * u.x, dot(p - c, u)));
  float s = hh * hh / w;
  float r = 0.5 * (s + w);
  float d = 0.5 * (s - w);
  return (q.y - hh) * d > q.x * hh ? length(q - vec2(0.0, hh)) : length(q + vec2(d, 0.0)) - r;
}

float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}

// Polygon vertex k of the polygon whose vertices start at record r (four per record). Reads the
// u_prims table declared by the including shader.
vec2 polyVertex(int r, int k) {
  vec4 v = u_prims[2 * (r + k / 4) + (k % 4) / 2];
  return (k % 2 == 0) ? v.xy : v.zw;
}

// iq's exact signed distance to a simple polygon of n (<= 32) vertices.
float sdPolygon(vec2 p, int r, int n) {
  vec2 vj = polyVertex(r, n - 1);
  float dd = 1e18;
  float s = 1.0;
  for (int k = 0; k < 32; k++) {
    if (k >= n) break;
    vec2 vi = polyVertex(r, k);
    vec2 e = vj - vi;
    vec2 w = p - vi;
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    dd = min(dd, dot(b, b));
    bvec3 c = bvec3(p.y >= vi.y, p.y < vj.y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
    vj = vi;
  }
  return s * sqrt(dd);
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

const float HOLE = 0.32;

// Nearest lace hole on a hex lattice of spacing s: round holes on even rows, upward teardrops
// on odd rows. Negative inside a hole.
float holeDistance(vec2 p, float s) {
  float h = s * 1.7320508;
  vec2 a = p - vec2(s, h) * floor(p / vec2(s, h) + 0.5);
  vec2 b0 = p - vec2(0.5 * s, 0.5 * h);
  vec2 b = b0 - vec2(s, h) * floor(b0 / vec2(s, h) + 0.5);
  float circle = length(a) - HOLE * s;
  float drop = sdUneven(b, vec2(0.0, -0.05 * s), vec2(0.0, 0.4 * s), 0.3 * s, 0.05 * s);
  return min(circle, drop);
}

// Shadow coverage (before opacity) of a laced silhouette at distance d (bone units), lattice
// point p: the body's penumbra (half-width w px at ppu px per bone unit) times one minus the
// lamp light through the nearest hole, kept out of the border band. A blurred hole of radius R
// passes 1 - exp(-2 (R / w)^2) at its centre; holes under ~1.5 px are dropped. A SOLID nearest
// primitive (solid = true) is not pierced.
float laceCoverage(float d, vec2 p, float s, float border, float ppu, float w, bool solid) {
  float body = 1.0 - smoothstep(-w, w, d * ppu);
  if (body <= 0.0 || solid) return body;
  float r = HOLE * s * ppu;
  float contrast = (1.0 - exp(-2.0 * r * r / (w * w))) * smoothstep(1.0, 2.0, r);
  float hole = (1.0 - smoothstep(-w, w, holeDistance(p, s) * ppu)) * contrast;
  float band = 1.0 - smoothstep(-w, w, (d + border) * ppu);
  return body * (1.0 - hole * band);
}
