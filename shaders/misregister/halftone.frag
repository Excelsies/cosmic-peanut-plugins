#version 300 es
// Misregister halftone + composite (full resolution).
// Each plate is printed as an AM halftone at its screen angle, offset by its spring:
//   q = R(angle)·(pixel − offset)/cell + shimmer; the cell's centre is mapped back to plate space
//   to read the ink density there; a Euclidean dot of area d (round dots, a checker at 50%,
//   round paper holes on the cell corners above); clipped by the plate's crisp silhouette (decoded SDF);
//   thinned by ink starvation. Plates multiply over the paper like real overprint.
precision highp float;

out vec4 outColor;

uniform sampler2D uDensity;   // plates.frag oDensity (half res)
uniform sampler2D uDist;      // plates.frag oDist (half res)
uniform sampler2D uGrain;     // 256² RGBA8: R fibre, G speckle, B density wobble
uniform vec2 uSize;           // canvas, device px
uniform float uCell;          // halftone cell, device px
uniform float uDistScale;     // device px per unit of encoded SDF (16 × half-res px)
uniform vec2 uOffset[3];      // plate spring offsets, device px
uniform vec2 uShimmer[3];     // plate screen-phase offsets, cells
uniform vec2 uAngle[3];       // (cos, sin) of each plate's screen angle
uniform vec3 uInk[3];
uniform vec4 uPaper;          // rgb; a = 1 opaque paper, 0 none
uniform vec2 uGrainOffset;    // per-sheet tile offset, 0–1
uniform float uFibre;         // paper fibre strength
uniform float uStarve;        // ink starvation 0–1

const float PI = 3.14159265;
const float GRAIN_PX = 512.0; // device px per grain tile

void main() {
  vec2 px = gl_FragCoord.xy;
  vec3 tone = vec3(1.0);      // product over plates of (1 − cov·(1 − ink))
  float bare = 1.0;           // product over plates of (1 − cov)
  for (int i = 0; i < 3; i++) {
    vec2 p = px - uOffset[i];
    vec2 cs = uAngle[i];
    vec2 q = vec2(cs.x * p.x + cs.y * p.y, -cs.y * p.x + cs.x * p.y) / uCell + uShimmer[i];
    vec2 c = floor(q) + 0.5;
    vec2 cq = (c - uShimmer[i]) * uCell;
    vec2 cp = vec2(cs.x * cq.x - cs.y * cq.y, cs.y * cq.x + cs.x * cq.y);
    float d = texture(uDensity, cp / uSize)[i];
    vec4 gc = texture(uGrain, cp / GRAIN_PX + uGrainOffset);
    d = clamp(d * (1.0 + (gc.b - 0.5) * 0.7 * uStarve), 0.0, 1.0);
    // Euclidean dot: ink where the spot function is under a threshold. Small d gives round dots
    // at the cell centres, 50% a checker, large d round paper holes on the cell corners. The
    // threshold maps density to printed area to within 1% (fitted numerically).
    vec2 f = q - c;
    float spot = 0.5 - 0.25 * (cos(2.0 * PI * f.x) + cos(2.0 * PI * f.y));
    float dd = d * (1.0 - d);
    float thr = d + dd * (1.0 - 2.0 * d) * (0.4323 + 1.8529 * dd);
    float cov = clamp((thr - spot) / max(fwidth(spot), 1e-4) + 0.5, 0.0, 1.0);
    if (d < 0.004) cov = 0.0;
    float sd = (texture(uDist, p / uSize)[i] - 0.5) * uDistScale;
    cov *= clamp(0.5 - sd, 0.0, 1.0);
    vec4 gp = texture(uGrain, p / GRAIN_PX + uGrainOffset + vec2(0.37 * float(i), 0.61 * float(i)));
    cov *= 1.0 - clamp((gp.g - (1.0 - 0.5 * uStarve)) * 6.0, 0.0, 1.0);
    tone *= 1.0 - cov * (1.0 - uInk[i]);
    bare *= 1.0 - cov;
  }
  float fibre = (texture(uGrain, px / GRAIN_PX + uGrainOffset).r - 0.5) * uFibre;
  if (uPaper.a > 0.5) {
    outColor = vec4(clamp(uPaper.rgb * tone + fibre * bare, 0.0, 1.0), 1.0);
  } else {
    float alpha = 1.0 - bare;
    outColor = vec4(max(tone - bare, 0.0), alpha);
  }
}
