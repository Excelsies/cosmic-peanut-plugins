# Fieldwork

Visualizers that each borrow a physical instrument or process and let the music run it, looking
nothing like the built-ins: no glow, no centre object, no neon. A third-party-style Tidalviz
package, same layout as `plugins/cosmic-peanut`: `tidalviz.json` at the root, entry modules in
`src/`, pure logic with its tests in `src/lib/`, shaders in `shaders/<id>/`, thumbnails in
`thumbs/`, and a byte copy of `web/sdk/tidalviz.d.ts`. Run it from source with hot reload:

```sh
uv run --extra gtk tidalviz --dev plugins/fieldwork --source synthetic:demo   # Linux
uv run tidalviz --dev plugins/fieldwork                                       # macOS
```

or add the folder in the app with **Library → Add folder**.

| Visualizer | Renderer | What it is |
| --- | --- | --- |
| Chladni | `webgl2` | Sand on a ringing brass plate gathers into each note's standing-wave figure |
| Murmuration | `three` | Thousands of starlings wheel as one silhouette over a dusk sky |
| Plotter | `2d` | A pen plotter draws one decaying harmonograph per phrase on blueprint paper |

## Chladni

Sand on a ringing brass plate. The window is the plate, edge to edge: warm brushed brass with a
static diagonal sheen, and dark iron filings that gather into the standing-wave figure of the note
you hear (lattices, crosses, nested diamonds, curved butterflies). Higher notes give finer figures
with more cells. When the note changes the two figures crossfade over 0.4 s and the sand visibly
streams from the old lines to the new ones. A kick makes every grain hop: for about 150 ms the
figure dissolves into airborne dust with a small offset shadow, then lands and re-sharpens. Hats
add a fine fizz, bass and stereo balance tilt the plate slightly, and silence freezes the last
figure where it lies. Renderer: `webgl2`.

### Parameters

| id | Label | Default | Range | Effect |
| --- | --- | --- | --- | --- |
| `palette` | Palette | brass | brass / slate / cobalt / mono | Plate and sand colours: brass plate + iron filings; dark slate + pale sand; white enamel + cobalt sand; grey + white sand |
| `backdrop` | Backdrop | plate | plate / none | None draws no plate, only sand in each palette's light grain colour (premultiplied, normal alpha) |
| `grains` | Grains | 64k | 32k / 64k / 128k | Grain count; changing it reseeds the plate. Battery quality uses 32k while this is at its default |
| `complexity` | Complexity | 1 | 0.5–2 | Scales how far up the mode table a note reaches (finer figures) |
| `reactivity` | Reactivity | 1 | 0–2 | Plate drive (pull into the node lines, shake off the antinodes) and stereo tilt |
| `hop` | Hop | 1 | 0–2 | Height of the kick hop and the lateral scatter; 0 turns hops off |

### How it works

- **Figures** (`src/lib/modes.js`): one plate term is cos(nπx)·cos(mπy) with k² = (n/a)² + m²
  for aspect a = W/H. On resize the visualizer enumerates n, m in 1–12, pairs terms whose k² lie
  within 8% (both signs: at a = 1 these are the classic cos(nπx)cos(mπy) ± cos(mπx)cos(nπy)
  figures), adds plain single-term lattices, picks 32 entries spread from k ≈ 2.2 to 11.5 and sorts
  them by k² into a preallocated `Float32Array(64·5)`. The shaders evaluate the field analytically
  from two entries (no field texture): u = mix(uA, uB, blend).
- **Pitch** (`pitch.js`): the strongest bin between 200 Hz and 2 kHz with magnitude > 0.08 and
  more than 3× the window mean, refined by parabolic interpolation of the log magnitude, gives a
  midi note; index = clamp(floor((midi − 55)·0.72·complexity), 0, 31). A new index must hold for
  0.2 s of summed `dt` (an onset switches at once); silence and atonal input hold the figure. It
  starts on index 6, so drums alone still draw a figure. The bin window is rebuilt only when the
  sample rate changes.
- **Audio mapping** (`sand.js` `createPlateDrive`, `createHop`): drive = clamp(0.5·min(midAtt, 2)
  + 4·rms, 0, 2.5)·reactivity (τ 0.1 s, 0 within 0.3 s of silence); fizz = clamp(trebAtt − 1, 0,
  2)·0.5 + flux·0.5; bass tilt 0.15·clamp(bassAtt − 1, −1, 1) (τ 0.3 s); stereo tilt
  0.6·balance·reactivity (τ 0.5 s, `stereo.js`, exactly 0 for mono or bit-identical L/R, as with
  the app's synthetic sources); hop vz0 = g·0.075·hop·(0.4 + 0.6·onsetStrength), a 0.15 s flight
  at full strength, with hashed lateral scatter 0.25·strength·hop.
- **Grains** (`shaders/chladni/update.vert`): 24 bytes each, (x, y, vx, vy) + (z, vz), in two
  buffers ping-ponged with transform feedback (interleaved, rasterizer discard). Fixed 1/120 s
  steps (`fixedstep.js`, at most 4 per frame), one `drawArrays(POINTS)` each. Grounded grains:
  v += (−K_DRIFT·drive·∇(u²) + tilt·G_TILT)·dt + ξ·(K_SHAKE·drive·(|u| + U_FLOOR) +
  K_FIZZ·fizz)·√dt, then v *= exp(−8·dt). ∇(u²) pulls sand into the node lines, the shake throws
  it off the antinodes, and U_FLOOR (grain size) keeps lines a few pixels wide. Airborne grains fly
  ballistically with air drag only. Edges reflect with restitution 0.3. Noise is a PCG hash of
  (vertex id, step), initial positions are hash-uniform: runs are deterministic, no `Math.random`.
- **Deposit**: one additive POINTS pass into a half-resolution `RGBA16F` density target (R
  grounded, 1 px; G airborne, 2 px), weights scaled by target area and grain count. Without
  `EXT_color_buffer_float` it falls back to `RGBA8` at 4/255 per grain, which saturates sooner.
- **Composite** (`composite.frag`): one full-resolution pass. Coverage h = 1 − exp(−1.6·R) from 5
  taps, a normal from the central-difference slope, Lambert light from the upper left plus a rim
  term, so ridges get a thin highlight and cast a thin shadow on the plate. Dust is drawn a touch
  lighter and softer with a small offset shadow. The plate (gradient, anisotropic hash brushing,
  sheen) never reacts to audio.

### Flashing and motion

- **Reduce flashing** (on by default): every hop asks the photosensitivity limiter
  (`lib/flash.js`, a copy of the built-in one) for a rise of the dust-haze envelope; only an
  admitted rise launches the grains, so there are at most 3 hops per second and further onsets
  only add fizz. The faint global haze is that limited envelope. Figure changes are always
  crossfades of 0.4 s or longer, never cuts.
- **Reduce motion**: crossfades take 1 s; while Reactivity is at its default, the plate runs at
  reactivity 0.5, hops at half height and the bass tilt is off.

### Performance

Per frame: the pitch scan (~80 bins), 1–4 transform-feedback steps over 64k grains, one POINTS
pass at half resolution and one full-resolution composite with 7 texture taps. `frame()` allocates
nothing: uniforms come from preallocated `Float32Array`s (mode entries via `uniform4fv` with a
source offset), and every lib returns reused objects. `dispose()` deletes 2 buffers, 2 transform
feedback objects, 3 VAOs, 3 programs and the density texture and framebuffer.

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
- **Sweep and shapes** (`attractor.js`, `beatclock.js`): the flock chases a point that follows the
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

`frame()` allocates nothing.

## Plotter

A pen plotter drawing on a sheet of blueprint paper. The sheet is divided into a grid of cells; in
the current cell a thin ink line traces a decaying harmonograph in real time, two damped pendulums
per axis, so the pen spirals inward through looping, lacy Lissajous rosettes. Each phrase of the
music is one drawing: when the phrase ends the pen lifts and moves to the next cell (left to right,
top to bottom), and when the sheet is full a band of fresh paper rises from the bottom over 1.5 s
and plotting starts again. In a large window each figure is crisp line art; in a small one the
sheet reads as twelve small drawings. Built-in-style `2d` visualizer.

What you see in the music:

- **Harmony → figure.** The two strongest pitch classes when the phrase starts set the y : x
  pendulum ratio as a just interval: a fifth draws 3:2, a fourth 4:3, a major third 5:4, a
  semitone 16:15, a tritone 45:32. Consonant intervals give clean, closed rosettes; dissonant
  ones give dense, slowly precessing moiré webs. Drums or noise with no clear pitch draw the
  octave, 2:1.
- **Brightness → precession** and **ink.** A brighter phrase detunes the pendulum pairs more, so
  the figure turns faster, and picks a later ink of the set (by its rank among recent phrases).
- **Bass → size.** Heavy bass slows the decay, leaving a bigger figure.
- **Stereo → shape.** Wide stereo squashes the figure vertically, and a lopsided mix tilts it.
  Mono sources (or identical channels) draw round, upright figures.
- **Loudness → pressure.** Loud passages press the pen harder: bolder bands within the figure.
  The line also thins as the swing decays, so the centre stays lacy.
- **Hits → kinks.** Every onset pushes the pen off its path for 40 ms and lets it rejoin over
  200 ms: a visible kink that doesn't blur the figure.
- **Hats → chatter.** Treble above its recent average makes the pen tremble by a pixel or two.

### Parameters

| id | Label | Default | Range | Effect |
| --- | --- | --- | --- | --- |
| `grid` | Grid | 4x3 | 4x3 / 3x2 / 6x4 / 1x1 | Cells per sheet. A smaller grid keeps the drawing in progress as its first cell |
| `phrase` | Phrase | 4 bars | 2 / 4 / 8 bars | One drawing per phrase (bars of 4 beats; 8 s when there is no tempo) |
| `paper` | Paper | blueprint | blueprint / cream / white / none | Prussian blue with light inks, cream or white with dark inks, or none (transparent, light inks) |
| `inks` | Inks | fineliner | fineliner / sepia / mono | Ink set; each has a light and a dark variant chosen by the paper |
| `weight` | Line weight | 1 | 0.5–3 | Multiplies the pen width (0.6–1.8 CSS px by loudness) |
| `chatter` | Pen chatter | 0.5 | 0–1 | How much the hats shake the pen |
| `speed` | Speed | 1 | 0.25–2 | Pendulum rate (period 0.35 s at 1); applies from the next cell |

Paper, inks and grid changes, and window resizes, repaint the paper and replay the sheet from its
records, spread over a few frames.

### How it works

- **Pen** (`src/lib/harmonograph.js`): x = R e^(−dτ)(0.6 sin(wτ + p1 + kink) + 0.4 sin(w(1+δ)τ + p2)),
  y likewise with w·ratio and (1 − δ), y scaled by 1 − 0.45·width, rotated by 0.6·balance. Pen
  time τ advances in fixed 1/600 s steps (`fixedstep.js`, at most 40 per frame, so 15–144 fps all
  draw the same line). d makes the amplitude fall to about 1/8 by the end of the phrase. Each
  axis's two pendulums start within ±0.4 rad of each other so the figure starts at full swing.
- **Records**: everything that moves the pen inside a cell is written into that cell's record as it
  happens (figure parameters, up to 64 onset steps and strengths, and 30 Hz slots of pressure and
  chatter), in typed arrays sized for 24 cells. The pen is drawn only from the records, so a replay
  after a resize reproduces the live line exactly (tested to 1e-3 px) and is bounded to 6000 pen
  steps per frame (a full sheet is ~115k steps).
- **Interval** (`interval.js`, `harmonic-chroma.js`): a chroma vector from peak-picked spectrum bins
  200 Hz – 4 kHz (log-parabolic peak interpolation, split between the nearest pitch classes,
  3rd/5th/6th harmonics of a stronger lower peak damped to 20 %), averaged with a 2 s time
  constant. Fallback 2:1 when max/mean < 1.5.
- **Stereo** (`stereo.js`): width = 1 − corr(L, R), balance from the channel energies.
- **Phrases** (`sheet.js`, `meter.js`): beats are counted from `beatPhase` wraps (wraps under
  0.4 beat after a counted beat are tempo-tracker jitter and ignored). The first phrase starts on
  the first sounding frame; every later one starts on a bar line (beat count a multiple of 4).
  Silence lifts the pen and pauses the phrase clock; 4 s of silence ends the cell. A new cell takes
  its brightness, bass and stereo means from the phrase that just ended.
- **Canvas** (`src/plotter.js`): the visible canvas is drawn on incrementally and never cleared per
  frame. Paper (colour, a 256² hash-noise grain pattern built once, a 20 px grid at 5 %) and crop
  marks are painted once per sheet; each frame strokes one short round-capped polyline of the new
  pen steps (two when it crosses a 30 Hz pressure slot); the paper feed paints only the band it
  uncovers.

### Accessibility

- **Reduce flashing**: there is no whole-screen brightness envelope, so there is nothing to limit
  (and no limiter is wired). Ink only accumulates between sheet changes: on blueprint the mean
  luma (Rec. 709 weights on sRGB, as the harness measures it) climbs from 0.22 to 0.28 over a
  whole ~96 s sheet, about 1e-5 per frame. The sheet change is one fall of ~0.055 spread over a
  1.5 s wipe (3 s fade with Reduce motion), once per sheet: far below 3 flashes per second, and
  below the 10 % WCAG flash threshold even taken as a single step.
- **Reduce motion** (macOS Reduce motion / GTK animations off): Speed acts as 0.6 and Pen chatter
  is halved while they are at their defaults, and the paper feed becomes a 3 s fade instead of a
  rising band.

### Performance

Per frame: ~10 pen steps at 60 Hz (each 4 sines and an exponential), one `lineTo` per step and one
or two `stroke` calls, a 2048-sample stereo correlation and a ~170-bin chroma pass. Measured in
Node with a no-op context (JS cost only, desktop CPU): 0.002 ms p50, 0.005 ms p99 per frame; a
6000-step replay frame 0.3 ms before rasterization. Only the newly inked pixels are rasterized.
The paper is repainted only on a resize, a paper / ink / grid change or a new sheet.

## Shared helpers (`src/lib/`)

General-purpose helpers, one copy each:

- `flash.js` and `gl.js`: copies of the built-ins' photosensitivity limiter and WebGL2
  helpers (repos can't import from each other); `copies.test.js` keeps them identical.
- `fixedstep.js`: the fixed-timestep clock every simulation runs on, so 60 Hz and 120 Hz
  displays give the same result.
- `stereo.js`: RMS balance (+1 = right) and width (1 − correlation), exactly 0 for mono or
  bit-identical channels such as `synthetic:demo`.
- `color.js`: `#rrggbb` param parsing with a fallback.
- `meter.js`: a beat counter on the host's `beatPhase` that ignores tempo-tracker jitter
  (Plotter's phrases, Misregister's re-layouts).
- `beatclock.js`: a continuous clock in beats that runs free at 1 beat/s without a tempo
  (Murmuration's sweep).
- `harmonic-chroma.js`: a 2 s smoothed pitch-class profile that damps the 3rd, 5th and
  6th harmonics of stronger lower peaks, so the two strongest classes are a real interval
  (Plotter's figures).

## Tests

```sh
cd web && npx vitest run --maxWorkers=2 ../plugins/fieldwork
uv run pytest tests/test_builtin_manifests.py
```

`frame()` allocates nothing in any of the visualizers.
