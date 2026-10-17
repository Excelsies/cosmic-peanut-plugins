# Fieldwork

Visualizers built on physical experiments rather than glowing shapes: a third-party-style
Tidalviz repo (same layout as `plugins/cosmic-peanut`). Install it with
`uv run --extra gtk tidalviz --dev plugins/fieldwork --source synthetic:demo` (hot reload) or
**Library → Add folder**.

## Kelir

Shadow-puppet theatre on a lamp-lit cotton screen. Two stylised rod puppets face each other
across a screen lit from behind by one flame, with the kayon (the tree of life) waiting in the
wings. A puppet far from the screen casts a large, soft, grey shadow; on each hit it lunges at
the screen and its shadow snaps small, sharp and black, every perforation of its lace letting
the lamp through. Bass-led hits move the left puppet, mid-led hits the right one, strong hits
both: call and response. The melody's brightness lifts the front hand on its rod, loud mids
raise the back arm, the beat sways the bodies and bobs the heads, hats and flux make the flame
flicker. Every eight bars the kayon sweeps across the screen, turning flat as it goes, and the
puppets swap sides behind it; in silence they withdraw and the kayon returns to centre stage
until the next hit. Renderer: `webgl2`.

The figures are generic stylisations in the wayang manner (a frontal torso on a narrow waist, a
profile head with the forehead running straight into a long nose and an almond eye cut out of a
solid face, a tiered crown with a backward-facing ornament, a belt, a kain with a panel between
the legs and a trailing drape, very long arms), not any particular character.

### Parameters

| id | Label | Default | Range | Effect |
| --- | --- | --- | --- | --- |
| `screen` | Screen | lamp | lamp / moon / reiniger / none | Lamp: amber hotspot fading to umber, brown-black shadows. Moon: cool blue-grey. Reiniger: a white screen with a faint dusk gradient, jet-black shadows, a tighter blur range (after Lotte Reiniger's paper cuts). None: no screen, shadows only over the desktop |
| `cast` | Cast | duet | duet / solo / kayon | Two puppets (plus the kayon for scenes and silence); one puppet at centre; the kayon alone at centre, swaying with the beat and lunging on hits |
| `reactivity` | Reactivity | 1 | 0–2 | Lunge depth (up to a full lunge at 1), body sway and the front elbow's swing |
| `flicker` | Flicker | 0.5 | 0–1 | How much hats and flux make the flame flicker (it moves the shadows and dims the screen by at most 5%) |
| `blur` | Blur | 1 | 0–1.5 | Penumbra range: how soft a far shadow gets (0 = every shadow crisp) |
| `lace` | Lace | 1 | 0.5–2 | Perforation density (lattice spacing 0.03 / lace puppet heights) |
| `scenes` | Scenes | on | on / off | The kayon's sweep and the side swap every 8 bars |

### How it works

- **Figures** (`src/kelir/lib/puppets.js`): each silhouette is a table of 2D signed-distance
  primitives (capsule, uneven capsule, vesica, triangle, disc, box, polygon), two vec4 per record,
  at most 64 records. The puppets' outlines are three polygons (the laced body, the solid face,
  the laced crown; up to 32 vertices each, four per record, iq's exact sdPolygon), plus capsules,
  discs and vesicas for the limbs, rods and ornaments. Both puppets share one figure (42 records)
  and own only their two hand rods: the table is [A's rods, figure, B's rods, kayon], 56 records.
  Primitives flagged solid (face, neck, limbs, rods) are never pierced by the lace. Cuts
  (d = max(d, −dCut)) make the eye, the crown ornament's ring and the two slits around the belt.
  The kayon is evaluated at (|x|, y), so it is mirror-symmetric, and its gate, trunk and branches
  are subtracted. The same evaluation is ported to JS for the tests.
- **Rig** (`lib/rig.js`): six bones per silhouette (body, front upper arm and forearm, back upper
  arm and forearm, head), each a 2D affine transform; the shader reads their stage → bone
  inverses (18 mat3 from one `Float32Array`), each silhouette's records indexing its six from
  its first bone. The hand rods are rewritten each frame from the
  grips straight down off the bottom of the screen.
- **Lace**: holes on a hex lattice in each primitive's bone frame (round holes, upward teardrops
  on alternate rows, radius 0.32 of the spacing), kept out of a solid border band 0.012 puppet
  heights wide. Coverage is the body's coverage times one minus the light through the nearest
  hole; a hole of radius R under a penumbra of half-width w passes 1 − exp(−2 (R/w)²) at its
  centre, so the lace dissolves smoothly as the shadow softens, and holes under ~1.5 px are
  dropped (small windows show bold shapes, not shimmer).
- **Distance and look** (`lib/stage.js`, `lib/place.js`): distance d (0 = against the screen)
  gives a penumbra half-width of (1 + 39 d) · blur · H/1440 px (1 + 11 d on the reiniger
  screen), opacity 0.96 → 0.55, and a size of 1 + 0.6 d, scaled about the lamp's point (0.5 W,
  0.42 H from the top) like a real shadow and normalised so a resting puppet (d = 0.55) is 0.78
  H tall on a baseline at 0.88 H. The kayon rests at 0.25 and stands at 0.1 in silence.
- **Lunges**: hits with onsetStrength > 0.25 start a lunge dated from the onset
  (time.now − onsetAge): a linear rise over 70 ms, then exp(−t / 0.25 s); d = rest · (1 − L).
  A hit mid-lunge continues from the current level. Analytic in time, so identical at 60 and
  120 Hz.
- **Arms and body**: smoothed centroid (0.25 s) sets the front shoulder to
  −0.3 + 1.6 · clamp(3 · centroid, 0, 1) rad; smoothed midAtt (0.3 s) swings the front elbow
  with the beat and swings the back arm forward from where it hangs behind the body (−0.45 rad,
  elbow 0.25 rad) by up to 0.6 rad; the beat clock (free at 1 beat/s without a tempo)
  sways the bodies by 0.04 rad and bobs the heads.
- **Stereo**: the balance (1 s smoothing; exactly 0 for mono or identical channels) shifts the
  pair by up to 0.08 of the width toward the louder side.
- **Scenes and silence**: every 32 beats (30 s without a tempo) the kayon crosses from −0.2 to
  1.2 of the width in 3 s, entering from alternate sides, its x-scale max(|cos 3π·progress|,
  0.08) (the flat turn); at halfway the puppets swap sides over 1 s and turn round. After 1.5 s
  of silence the puppets withdraw over 1 s and the kayon slides to centre, upright; the first
  hit sends it out to the nearer side and brings them back.
- **Lamp** (`lib/lamp.js`): f = flicker · (0.3 + 0.35 · clamp(trebAtt − 1, 0, 2) + 0.3 · flux)
  · n(t), n a 7 Hz value noise; it moves the shadows by up to 6 px · H/1440 times their distance
  (parallax) and dims the screen by 5% · |f| at most.
- **GPU**: a mask pass draws one instanced quad per visible silhouette over its bounding box
  (cut off at the bottom edge) into an R8 target (0.75 resolution, or full resolution when
  renderScale is 1 at quality 'high'), blended with MAX (`shaders/kelir/mask.frag`). Each
  pixel's distance starts at the penumbra's reach (coverage is 0 beyond it) and a polygon is
  skipped when its bounding box is no nearer than the distance so far, so most pixels pay for
  the cheap primitives only; the composite
  (`shaders/kelir/composite.frag`) lights the screen (hotspot, a 3 CSS px weave at 6% contrast,
  the flicker), sharpens the mask with 4 taps when it is below full resolution, and lays the
  shadows over it. No float targets and no extensions. `dispose()` deletes both programs, the
  mask texture and framebuffer and the vertex array.
- **Transparency**: with screen 'none' the output is premultiplied: rgb = shadow colour · mask,
  alpha = mask, so nothing dark is drawn where there is no shadow.

**Flashing.** Hits only change the sharpness and darkness of the puppets, a fraction of the
window, never the screen's brightness. The only whole-screen change is the flicker's dimming,
at most 5%, through the flash limiter (with Reduce flashing on, a new dip can start at most 3
times a second), and the flicker noise slows from 7 Hz to 3 Hz. Each screen keeps a near shadow
at 7:1 contrast or more against the lit hotspot.

**Reduce motion.** While Reactivity is at its default, lunges rise over 200 ms instead of 70 ms
and reach 70% of the way to the screen, the sway is halved and the kayon slides across without
turning; while Flicker is at its default, the flicker is cut to 30%. Move either param to get
full motion back.

`frame()` allocates nothing. Tests: `cd web && npx vitest run --maxWorkers=2 ../plugins/fieldwork`.
