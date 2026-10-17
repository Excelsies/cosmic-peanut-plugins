# Fieldwork

Visualizers drawn from things you can watch outdoors. A third-party-style Tidalviz repo: run it
with `uv run tidalviz --dev plugins/fieldwork` (Linux: `uv run --extra gtk tidalviz --dev
plugins/fieldwork --source synthetic:demo`) or **Library → Add folder**.

## Murmuration

Thousands of starlings wheel as one silhouette over a dusk sky. The flock is never drawn as a
shape: it is 4,000 tiny charcoal chevrons, each flapping on its own phase and narrowing its wings
as it banks, at alpha 0.85, so overlaps read dark and thin regions read as grey lace. Every 4 bars
the flock takes a new form (blob, ribbon, doughnut, teardrop), landing on the downbeat, while it
sweeps across the sky. Kicks squeeze it dark and dense, and it loosens into a veil over about
300 ms. A strong hit sends a falcon diving through: birds near its path burst away, leaving a hole
that heals, and a dark band of birds rolled to show their full wings travels outward from the
strike. A `three` visualizer.

### Parameters

| id | Label | Default | Range | Effect |
| --- | --- | --- | --- | --- |
| `sky` | Sky | dusk | dusk / overcast / rose / none | Backdrop gradient. `none` is transparent and draws the birds in Ink |
| `ink` | Ink (sky none) | `#ece6da` | colour | Bird colour with sky `none` (invalid values fall back to the default) |
| `flock` | Flock size | 4000 | 2000 / 4000 / 6000 | Birds simulated. Battery quality uses 2000 while this is at its default |
| `speed` | Speed | 1 | 0.2–2 | Cruise speed multiplier |
| `falcon` | Falcon | on | on / off | Strong onsets send the falcon through. Off: onsets only start agitation waves |
| `reactivity` | Reactivity | 1 | 0–2 | Scales the squeeze, the waves, the falcon's flee burst and the shimmer |

### How it works

- **Sky** (`shaders/murmuration/sky.frag`): slate blue → dusty lavender → an apricot band at 15%
  height → a deeper apricot at the bottom edge; faint cirrus from 3-octave value noise stretched
  sideways (at most ~6% contrast, drifting slowly); a static reedbed silhouette in the bottom 4%
  (grass blades and taller reeds, some with plumes, from 1D hashes). No sun, and the sky never
  pulses. A full-screen quad behind everything, hidden for `none`.
- **Flock** (`src/lib/flock.js`): a CPU simulation in fixed 1/60 s steps (`fixedstep.js`, at most
  2 per frame), structure of arrays sized for 6,000 birds. Each bird follows its 7 nearest
  neighbours within 0.12 units (topological, like real starlings), found through a uniform 3D
  grid (`grid.js`) rebuilt each step by a counting sort into cell order; each bird's list is
  refreshed every fourth step. Forces: separation Σ(pi − pj)/d² below 0.055, alignment, cohesion, a spring toward
  the bird's own place on the flock's shape curve beyond its share of the tube radius there
  (birds with a small share make the dense core), soft walls at 85% of the frame, the falcon
  flee and a one-off sideways kick as a wave passes. Speed is clamped to 0.5–1.6 × cruise; roll
  follows the smoothed lateral acceleration. Rendered positions are interpolated between steps,
  so 120 Hz displays stay smooth.
- **Sweep and shapes** (`attractor.js`, `meter.js`): the flock chases a point that follows the
  attractor A(φ) no faster than the birds can fly, φ in beats (beatPhase wraps; a free clock at
  1 beat/s while the tempo is unknown). A sweeps 0.55 of the half-width on a 16-beat cycle with
  an incommensurate wobble, a slow vertical drift, altitude from the spectral centroid and a
  sideways bias from the stereo balance. The shape program picks one of four curves per 16-beat
  cycle and morphs over its first 4 beats; in the doughnut, birds stream around the ring.
- **Audio** (`drive.js`): bass (the larger of `bass` and `bassAtt`) → squeeze (attack 40 ms,
  release 300 ms): a 35% smaller flock radius plus a slight contraction and darkening of the
  silhouette. `midAtt` → alignment and cruise. `centroid` → altitude (2 s). Strong onsets
  (`onsetStrength` > 0.3, ≥ 1.2 s apart) → a falcon strike from a hashed edge through the flock
  centre; other onsets start a weaker wave. Waves grow at 1.6 units per second of *audio* time
  (T0 = now − `onsetAge`), so they match at any frame rate. `trebAtt` → flap rate (8–16 Hz);
  `flux` → a tiny render-only shimmer. `rms` gates the drive; `silent` → a wide, slow, calm glide.
- **Birds** (`shaders/murmuration/bird.vert`): one instanced chevron (4 vertices, 6 indices) from
  an interleaved `Float32Array(6000 × 8)` uploaded whole each frame (`needsUpdate`, never
  `addUpdateRange`, which allocates). The vertex shader builds the chevron in view space from
  position and heading, applies flap, roll and the wave, enforces a 1.5 CSS px minimum size from
  clip w and mixes far birds 25% toward the sky colour at their height; the fragment shader
  softens the edges from a barycentric varying (no MSAA), with a coverage floor for birds under
  about 4 px so they stay solid specks. The falcon is a second, solid crescent
  mesh three times the size.
- **Transparency**: the sky is opaque; birds are premultiplied (`premultipliedAlpha`, normal
  blending), so with sky `none` they float over the desktop. Renderer state is left alone.

### Accessibility

- **Reduce flashing** (on by default): a dense dark flock on a light sky changes the mean
  luminance, so the squeeze envelope and the wave darkening go through the shared flash
  limiter: the squeeze rises at most 3 times per second; each wave slot has its own limiter, a
  restarted band counting as a fall and a rise, so weak bands start at most twice per second and
  strikes (at least 1.2 s apart) add at most one more. The sky never pulses.
- **Reduce motion** (while Speed is at its default): speed 0.5, no falcon and no flee burst (the
  wave still runs), half the sweep, cirrus drift × 0.3.

`frame()` allocates nothing. Tests: `cd web && npx vitest run --maxWorkers=2 ../plugins/fieldwork`.
