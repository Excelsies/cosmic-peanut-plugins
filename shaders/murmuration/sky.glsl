// Shared by sky.frag and bird.vert: the sky gradient at height t (0 bottom edge .. 1 top).
// uSky0 top, uSky1 mid height, uSky2 low band at 15%, uSky3 bottom edge (sRGB).
uniform vec3 uSky0;
uniform vec3 uSky1;
uniform vec3 uSky2;
uniform vec3 uSky3;

vec3 skyColour(float t) {
  vec3 c = mix(uSky3, uSky2, smoothstep(0.0, 0.15, t));
  c = mix(c, uSky1, smoothstep(0.15, 0.55, t));
  return mix(c, uSky0, smoothstep(0.55, 1.0, t));
}
