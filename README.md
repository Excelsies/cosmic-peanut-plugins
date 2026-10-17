# Fieldwork

Visualizers that each borrow a physical instrument or process and let the music run it, looking
nothing like the built-ins: no glow, no centre object, no neon. A third-party-style Tidalviz
package, same layout as `plugins/cosmic-peanut`: `tidalviz.json` at the root, entry modules in
`src/`, pure logic with its tests in `src/lib/` or in the visualizer's own folder
(`src/soapfilm/`, `src/miura/`, `src/isobar/`), shaders in `shaders/<id>/`, thumbnails in `thumbs/`, and a byte copy of
`web/sdk/tidalviz.d.ts`. Run it from source with hot reload:

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
| Misregister | `webgl2` | A risograph poster printed live: chords swell shapes, kicks knock the plates out of register |
| Soapfilm | `webgl2` | A draining soap film in thin-film interference colours: bass slides the bands, hits send up plumes |
| Miura | `three` | A Miura-ori folded sheet under raking light: bass folds it deeper, hits roll fold waves across it |
| Isobar | `2d` | A live surface-pressure weather chart: bass deepens the lows, kicks snap the isobars inward |

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

## Misregister

A risograph poster on cream paper, printed live. Twelve flat, hard-edged shapes (box, disc,
half-disc, quarter-disc, right triangle, 90° and 180° ring arcs, a row of five dots, a three-step
block, a thin bar) sit off-centre on a Swiss grid, one per pitch class, each keeping its shape
across layouts. Every shape is printed as an AM halftone in one of three inks over a 22% tint of
a second ink, the way riso posters build colour from two plates: plates 0, 1 and 2 are screened
at 15°, 75° and 0°, and overlapping plates multiply like real overprint (yellow over pink gives
red, blue over pink navy). A pitch class's plate is its region of the circle of fifths (C G D A,
E B F# C#, G# D# A# F), so the key of the music sets the dominant inks; its tint plate is the
neighbouring region it sits next to (C and G tint with plate 2, D and A with plate 1, and so on).
`webgl2`, two passes.

### Parameters

| id | Label | Default | Range | Effect |
| --- | --- | --- | --- | --- |
| `palette` | Palette | riso | riso / bauhaus / sunset / mono | Inks of plates 0, 1, 2: riso #ff48b0 #0078bf #ffe800; bauhaus #e4352b #1f4e9c #f6c018; sunset #ff6c2f #ff48b0 #3d5588; mono three #1a1a1a screens |
| `paper` | Paper | cream | cream / white / kraft / none | #f2ead8, #fbfbf8, #c9a878, or no paper (transparent sheet: only the ink shows). The three papers are opaque and cover the backdrop; use `none` with Transparent background |
| `screen` | Screen ruling | 90 | 30–160 | Halftone cells per canvas height (90 at 1440p = 16 px cells), never under 5 device px |
| `misregister` | Misregister | 0.5 | 0–1 | How far kicks throw the plates out of register |
| `grain` | Grain | 0.4 | 0–1 | Paper fibre and how rough noisy passages print |
| `relayout` | Re-layout | 8 bars | 8 / 16 / 32 bars / never | How often the shapes slide to a new composition |
| `reactivity` | Reactivity | 1 | 0–2 | Gain on the chord swell |

### How it reacts

- **Chords** (`src/lib/chroma.js`, `swell.js`): the spectrum's peaks between 200 and 4000 Hz
  (parabolically refined, split between the two nearest pitch classes, the 5th-harmonic major
  third damped) give a 12-bin chroma. Each shape swells towards chroma² × reactivity with an
  80 ms attack and a 600 ms release: it grows from 55% to 100% of its slot, anchored at a grid
  corner so the composition stays aligned, and its ink ramp (30% at one end) rises from 55% to
  100% at the other. In silence every shape rests at 0.4: a quiet, legible poster.
- **Kicks** (`plates.js`): each onset throws the three plates misregister × (8 + 12 × onset
  strength) × (0.6 + 0.4 × bass above average) CSS px (4–8 px for a typical kick at the default,
  20 px at most), 120° apart with hashed jitter, on damped springs (3 Hz, ζ 0.35, exact solution
  over a fixed 1/120 s step), settling in about half a second. Because every shape is printed on
  two plates, its main ink and its tint slip apart: one edge grows a band of tint dots on bare
  paper, the opposite edge a band of main ink without its tint, and the halftone dots inside
  shift against each other. Where shapes on different plates overlap, the overprint colours
  slide too. The strongest pitch class also gets a +15% dot swell.
- **Hats** (`screen.js`): treble above average creeps each plate's screen phase (up to 0.16
  cell), so the dots shimmer inside still edges.
- **Noise** (`grain.js`): spectral flux starves the ink: speckled, broken dots and uneven density
  from a 256² hash-noise texture (fibre, speckle, wobble) built once.
- **Bars** (`layout.js`, `meter.js`): on a counted downbeat every N bars (every 2·N seconds when
  the host has no tempo) the shapes slide to the next of 12 layouts (6 hand-designed templates
  and their mirrors, visited in the full cycle (k·5 + 3) mod 12) over 1.5 s with a cubic ease;
  a shape that mirrors flips like a card. The grid is 8 rows by max(6, round(8 × aspect))
  columns inside 5% margins, and templates designed on 12 × 8 are remapped to it.

### How it draws

1. **Plates** (`shaders/misregister/plates.frag`, half resolution, two RGBA8 targets): the 12
   shapes are analytic SDFs (`uniform vec4 uShape[36]`, packed by `src/lib/poster.js` with each
   shape's rotation as cos/sin and its plate and tint plate). Target A holds each plate's ink
   density (the shape's ramp on its plate, the 22% tint on its tint plate, dilated one screen cell
   past its edge, max over shapes); target B each plate's signed distance (0.5 + sdf / 16 half-res
   px, over every shape printed on that plate).
2. **Halftone** (`halftone.frag`, full resolution, one attribute-less triangle): per plate, the
   pixel minus the plate's spring offset is rotated into screen space; the cell's centre reads
   the density, which becomes a Euclidean dot of that area (round dots that grow, merge into a
   checker of paper holes at 50% and go solid at 100%; the threshold is fitted so the printed
   area matches the density within 1%), antialiased with `fwidth`, clipped by the plate's crisp
   silhouette from B, thinned by starvation (a per-cell ALU value-noise wobble of the density
   and per-pixel speckle). The plates multiply over the paper. Seven texture fetches per pixel:
   density and distance per plate, and one grain fetch for paper fibre and all three speckles. With paper `none` the canvas is transparent:
   alpha = 1 − ∏(1 − coverage) and premultiplied rgb = tone − (1 − alpha), so over white it
   matches the white-paper print and over black only the ink shows.

### Photosensitivity and motion

- **Reduce flashing** (on by default): on opaque paper the total ink is what changes the mean
  brightness, so one global gain over every swell and dot swell goes through the flash limiter
  (`flash.js`, a copy of the built-in one): falls pass, a new rise is admitted at most every
  1/3 s. Under that cap a rise the limiter held comes back as a ramp over about 150 ms instead
  of a one-frame jump, so shapes don't stutter. The chord attack slows to 150 ms and ink
  starvation goes through its own limiter. Plate
  jolts move ink without changing its amount, and nothing inverts.
- **Reduce motion**: re-layout every 32 bars (while Re-layout is at its default) and slide over
  4 s, half-size jolts (while Misregister is at its default), no screen shimmer.

### Where it departs from its design notes

- **Halftone dot**: an area-corrected Euclidean dot (printed area within 1% of the density)
  instead of switching from dots to holes at 50%, which drew a visible line across every ramp.
- **Layout sequence**: (k·5 + 3) mod 12 is applied to the sheet counter, not the previous
  layout (which only ever visited 4 of the 12).
- **Re-layout without tempo**: 2 s per bar (16 s at 8 bars).
- **Plate springs**: the exact spring solution, not a simple integrator (which fell 9% short of
  the requested jolt).
- **Chroma third damping** (`chroma.js`): each pitch class gives up 0.3 × the weight of the pitch
  class a major third *below* it, `raw[(p + 8) % 12]`, not `(p + 4) % 12`: a note's 5th harmonic
  adds weight to the third above it, so that third is the one that should give it back.
- **Two-plate shapes**: every shape also prints as a 22% tint on a second plate, so kicks
  fringe every edge rather than only where shapes on different plates overlap.

`frame()` allocates nothing: chroma, envelopes, springs, layout tweens and uniforms all reuse
typed arrays made in `create`.

## Soapfilm

A vertical soap film fills the window edge to edge, seen by the reflected light of one large
soft source, in true thin-film interference colours. At the top it has drained to black film,
too thin to reflect anything, so the backdrop shows through above a crisp, wavering edge. Below
come a silver-white band, straw gold and bronze, then the saturated magenta, blue, green and gold
bands of the second and third orders, then paler pinks and greens fading to pastel near the
bottom. Quiet music leaves calm, laminar, slightly drooping bands; loud passages fold them into
paisley eddies that relax over a few seconds. Bass breathes the film, sliding the bands through
the colour order while the overall brightness barely changes. Every hit sends a mushroom plume of
fresh, thicker (paler) film up from the bottom edge: kicks on the left, hats on the right. Over a
phrase the black film creeps down, and every 16 bars a fresh dip wipes the film up from the bottom
over 1.2 s. A hairline wire frames the window. Renderer: `webgl2`.

### Parameters

| id | Label | Default | Range | Effect |
| --- | --- | --- | --- | --- |
| `backdrop` | Backdrop | velvet | velvet / studio / none | What shows through the black film: a warm near-black gradient with fine grain, flat studio grey, or nothing (transparent canvas: premultiplied colour with alpha = max(r, g, b), so the black film is fully see-through) |
| `light` | Light | softbox | softbox / sky / warm | The light's spectrum: blackbody 6504 K, 10000 K or 3200 K. Rebuilds the colour table |
| `thickness` | Thickness | 1 | 0.5–2 | Scales the film's thickness at the bottom (more orders, paler colours) |
| `swirl` | Swirl | 1 | 0–2 | Strength of the swirling flow (quiet floor, loudness and flux) |
| `drainage` | Drainage | 1 | 0.2–3 | How fast the film ages: the black film creeps down and the bands thin and droop |
| `redip` | Re-dip | 16 bars | 16 bars / 32 bars / when black | When a fresh film is wiped up. Every option also re-dips once the black film covers 45% of the height; with no tempo the bar options re-dip every 40 s |
| `reactivity` | Reactivity | 1 | 0–2 | Bass membrane depth (±12% thickness at 1), plume film and plume rise speed |

### How it works

- **Colour table** (`src/soapfilm/thinfilm.js`): 512 thickness texels over 0–1400 nm × 3
  angles of incidence (0, 30, 50 degrees). Each texel integrates the Airy reflectance of a film
  in air, R = 2r²(1 − cos δ) / (1 + r⁴ − 2r² cos δ) with r = (n − 1)/(n + 1), n = 1.33 and
  δ = 4πnh·cos θt / λ, over 380–780 nm in 5 nm steps. Each sample is weighted by the light's
  Planck spectrum and the CIE 1931 colour-matching functions (the analytic multi-lobe Gaussian fit
  of Wyman, Sloan and Shirley 2013). The result is divided by the light's ∫ȳ, converted to linear
  sRGB and normalised so first-order white (about 105 nm) has Y = 1. Out-of-gamut colours are
  pulled toward their own grey, then clamped. It is uploaded as gamma 2.2 `RGBA8` with `LINEAR`
  filtering (no float texture needed) and rebuilt on the CPU only when Light changes. Unit tests
  pin the reference colours (100 nm white, 150 nm gold, 200 nm purple, 400 nm magenta, 500 nm
  green, 1200 nm pastel) to ±0.08.
- **Film** (`film.js`, the same formulas in `shaders/soapfilm/composite.frag`): the film age a
  advances by dt × drainage and keeps going in silence. The black front is
  vb = 0.55·(1 − e^(−a/90)) of the height, the bottom thickness is
  Hmax = min(1350, 1150·thickness·(0.6 + 0.4·e^(−a/180))) nm, and below the front
  h = 90 + (Hmax − 90)·s^0.65 on a tilted, gently wavering height. The black edge is antialiased
  over 1.5 pixels with `fwidth`. On top of that: the bass membrane, a blend of the film's (1,1)
  and (1,2) modes; the plume film (1000 nm per micron); and a few nm of treble shimmer. The film
  starts 12 s old, so the first frame already shows black film.
- **State pass** (`state.frag`, half resolution): one `RGBA16F` ping-pong pair holds the
  displacement d (the film at a pixel came from uv + d) and the plume film p in microns. Fixed
  1/60 s steps (`fixedstep.js`, at most 4 per frame) advect both semi-Lagrangian through a
  0.004·drainage uv/s downward drift, a two-octave curl-noise swirl and each live plume's upward
  jet plus a pair of Rankine vortices (circulation ±2·rise·r, core 0.6r), which curl its head into
  a mushroom. d relaxes as e^(−t/4) and is clamped to 0.2; p fades as e^(−t/8); the re-dip region
  is cleared. Without `EXT_color_buffer_float` the pair is `RGBA8` with d stored as 0.5 + 2d and p
  as 0.5 + p/1.2: a documented degraded look in which the plumes still rise and curl but the
  slow swirl is lost to 8-bit rounding, so the bands stay straight.
- **Composite** (`composite.frag`, full resolution): bilinear d and p, the base bands evaluated
  per pixel (so fringes stay hairline-crisp even at 2560×1440), the table looked up at h with the
  angle row interpolated, one broad highlight lobe sloping across the upper third plus a 10%
  Fresnel lift at the edges, then the backdrop (opaque backdrops show through in proportion to how
  dark the film is), the 1.5 px wire frame in #2a2c30, ±0.5/255 dither and sRGB encoding.
- **Plumes** (`plumes.js`): an onset stronger than 0.12 (not while silent) spawns one of 6
  slots, recycling the oldest. Its x is the centroid of the bands that rose on that frame, mapped
  linearly (low bands left, high bands right) and shifted 0.15 toward the louder stereo side. Its
  head is analytic, y = 1.02 − rise·(now − t0) with t0 = now − onsetAge, so it stays in sync with
  the hit at any frame rate. It emits fresh film for 0.8 s and dies above the black front or after
  5 s.
- **Audio mapping** (`drive.js`): bassAtt → membrane amount 0.12·reactivity·clamp(bassAtt − 1,
  0, 1.5)/1.5 (attack 50 ms, release 400 ms, through the flash limiter); midAtt (τ 0.3 s) blends
  mode (1,1) into (1,2); loudness rms(0.5 s)/rms(20 s) and flux (τ 0.3 s) set the swirl,
  swirl·(0.01 + 0.05·clamp(loud − 0.6, 0, 1.4) + 0.06·flux) uv/s; trebAtt → 8 nm·clamp(trebAtt −
  1, 0, 2) shimmer; centroid (τ 1.5 s) → angle of incidence 5–45 degrees (hue shift); stereo
  balance (τ 0.5 s, `stereo.js`, exactly 0 for mono or bit-identical L/R) → ±4 degree tilt toward
  the louder side; bpm and beatPhase → the beat count (`meter.js`) for re-dips.
- **Re-dip** (`redip.js`): on every 16th (or 32nd) bar, whenever coverage passes 45%, or every
  40 s without a tempo, at least 8 s apart. The wipe front rises from the bottom over 1.2 s
  (ease-in-out cubic); below it the film is new, above it the old film keeps draining, and the
  front is feathered over about 2% of the height.

`frame()` allocates nothing: every uniform comes from preallocated `Float32Array`s and scalars,
there are no closures, literals or string building per frame, and no `Math.random`.

### Reduce motion and flashing

- **Reduce flashing** (on by default): the bass membrane goes through the flash limiter (at most
  3 rises per second; a unit test drives a 10 Hz bass strobe), and the shimmer moves at 3 Hz
  instead of 6. A re-dip is always a 1.2 s eased wipe, at most once per 8 s, and plumes are local.
  The membrane changes hue more than brightness.
- **Reduce motion**: while each param is at its default, Swirl acts as 0.5, Drainage as 0.6 and
  plume rise as 0.6 (Reactivity 1); the stereo tilt is off. Moving a param off its default uses
  that value.
- Silence: no plumes, no membrane and no shimmer; the swirl falls to its 0.01 floor and the film
  keeps draining, so the black film still creeps down slowly.

## Miura

One sheet of matte paper pleated into Miura-ori fills the window edge to edge, seen from slightly
above under a low raking light: every ridge is bright, every valley shadowed, the parallelogram
facets running in a zig-zag herringbone. The bass folds the pleats deeper and the whole sheet
contracts in both directions at once (Miura-ori is auxetic); every hit rolls a circular fold wave
across it from where the sound sits in the stereo image, a band of steeper, darker pleats that
relaxes behind it; mids swell the sheet gently and hats add a barely visible rustle. Every eight
bars the light eases round to a new heading over 4 s, which re-colours the whole relief, and the
music's brightness warms or cools it. Renderer: `three`.

### Parameters

| id | Label | Default | Range | Effect |
| --- | --- | --- | --- | --- |
| `paper` | Paper | washi | washi / indigo / vermilion / foil / graphite | Cream washi with faint long fibres; deep indigo; vermilion (fibres too); gold foil (metal, lit by a room environment, so the pleats glint as they move); graphite with a cool rim light from behind |
| `pleat` | Pleat | classic | classic / fine / bold | Facet rows across the window at rest: 16 / 24 / 10 (classic is about 36 columns at 16:9) |
| `sheet` | Sheet | fill | fill / float | Fill: the sheet always overfills the window, no edge ever shows. Float: a sheet at 72% of the width over the desktop with a soft contact shadow, no matte |
| `fold` | Fold | 1 | 0.2–1.5 | Scales every fold angle (rest, bass and silence) |
| `reactivity` | Reactivity | 1 | 0–2 | How far the bass folds the sheet and how strong the hit waves are |
| `light` | Light | window | window / noon / low-sun | Key light at 20° (warm white), 55° (white, more fill) or 9° (orange, deep shadows) |
| `shadows` | Shadows | on | on / off | Self-shadows (one 2048² PCF shadow map, 1024² under Battery quality or render scale < 0.75); off is a single pass |

### How it works

- **Geometry** (`src/miura/lib/miura.js`): the Schenk and Guest closed form for a Miura-ori sheet
  with sides a = b = 1 and sector angle 60°: for fold angle t, H = sin t sin γ,
  S = cos t tan γ / √(1 + cos²t tan²γ), L = √(1 − sin²t sin²γ), V = 1 / √(1 + cos²t tan²γ), and
  vertex(i, j) = (iS, jL + (i odd ? V : 0), j odd ? H : 0). The in-plane layout follows the
  global fold t0 clamped to [0.05, 1.1], so the sheet tiles cleanly while it contracts; the
  ridge rows' heights follow a per-vertex t_local = t0 + waves + swell + rustle (clamped to
  1.45). One indexed `BufferGeometry`, positions rewritten in place each frame
  (`DynamicDrawUsage`); flat-shaded `MeshStandardMaterial`, so each facet is lit by its own
  plane.
- **Coverage**: the mesh is tilted −25° about x under the SDK's default camera (fov 60, z = 5).
  The scale makes the pleat preset's rows span the window at rest; the sheet then gets enough
  rows and columns that, fully folded (where it has contracted most), it still overfills the
  trapezoidal view of the tilted plane, relief included, by 4% on every side. The view reaches
  further up than down, so the sheet is centred above the origin.
- **Bass fold** (`lib/drive.js`): target (0.35 + 0.55 · clamp(bassAtt − 1, 0, 1.2)/1.2 ·
  reactivity) · fold, 120 ms attack, 0.6 s release. Silence relaxes it to 0.3 · fold over 1.5 s.
- **Waves** (`lib/waves.js`): onsets above 0.15 push one of 8 rings (the oldest is replaced),
  dated from the onset itself (time.now − onsetAge), starting at x = 0.5 − 0.45 · balance
  (left-louder hits start on the left; mono in the middle) and a hashed height. A ring adds
  0.35 · strength · reactivity · exp(−((r − 0.9 age)/0.08)²) · exp(−age/1.2) to the fold, r in
  visible-sheet heights; rings older than 4 s are skipped. Analytic in time, so identical at 60
  and 120 Hz.
- **Swell and rustle**: smoothed mids add 0.12 · clamp(midAtt − 0.5, 0, 1) of a slow travelling
  wave plus its octave; hats add up to ±0.015 rad of hashed per-vertex noise, re-drawn 12 times a
  second.
- **Light**: one shadow-casting `DirectionalLight` (PCF, radius 2, orthographic shadow camera
  fitted to the visible sheet × 1.4) plus a hemisphere fill, `NeutralToneMapping`, exposure 1.
  The heading starts at 135° (upper left); every 8 bars (32 counted beats, or 16 s while the
  tempo is unknown) it eases over 4 s to the next heading of a fixed sequence in 70–200°. The
  key colour is 40% of a 3000–7000 K black body picked by the smoothed spectral centroid
  (`lib/kelvin.js`). Foil builds a PMREM `RoomEnvironment` the first time it is chosen and frees
  it when you switch away.
- **Transparency**: in fill mode the opaque sheet covers the canvas; in float mode only the
  sheet and a `ShadowMaterial` contact shadow 0.4 units behind it are drawn, black at partial
  alpha, so the output stays correctly premultiplied over the desktop.
- **dispose()** frees the geometry, materials, textures, environment and shadow map, removes
  the lights and meshes and restores the renderer's shadow-map and tone-mapping settings.

### Accessibility

- **Flashing**: the whole window only darkens or brightens through the bass fold, which is slow
  (120 ms / 0.6 s) and goes through the flash limiter: with Reduce flashing on, a new deepening
  fold can start at most 3 times a second. Waves are local travelling bands, the light turn is a
  4 s ease, and with foil under Reduce flashing the waves are 40% weaker and the rustle changes
  only 3 times a second, so the glints don't sparkle. Nothing is signalled by colour alone.
- **Reduce motion**: while Fold and Reactivity are at their defaults, waves are half as strong and
  travel at 60% speed, the swell and rustle are off and the light turns every 16 bars. Move either
  param to get full motion back.

`frame()` allocates nothing.

## Isobar

A live surface-pressure weather chart, printed on off-white paper. A procedural continent and
islands sit under thin black isobars every 4 hPa, bolder every 20 hPa, with boxed pressure numerals
where they leave the chart. Lows (a big red **L**) and highs (a blue **H**) carry their central
pressure. Each low trails a blue cold front with triangles and a red warm front with semicircles,
and later a purple occluded front. A pale red tint fills the warm sector between the fronts, green
rain stipple follows them, and station wind barbs show the wind. Heavy bass deepens the youngest
low and crowds its isobars, every kick snaps its rings inward, fronts sweep round as the low ages,
rain thickens with the hats, and the whole chart drifts east on the song's beat clock. In silence
the drift stops and the systems fill, leaving a calm chart of wide, gentle isobars.
Renderer: `2d`.

The default paper chart is a steady, bright off-white field; in a dark room pick **night** (or
**broadcast**), or **none** to show the shell's background through it.

### Parameters

| id | Label | Default | Range | Effect |
| --- | --- | --- | --- | --- |
| `chart` | Chart | paper | paper / broadcast / night / none | Printed chart; evening-news map (navy sea, green land, white isobars, glyphs at 1.5×); night (cyan isobars, amber fronts and letters); none (transparent canvas, coastline only at 50%, light-ink isobars, coast and barbs over a thin dark halo so they read on a light desktop too) |
| `reactivity` | Reactivity | 1 | 0–2 | Bass depth of the youngest low, kick pulse and how much the mids swell the highs |
| `speed` | Speed | 1 | 0.2–2 | Eastward drift, in grid cells per beat |
| `fronts` | Fronts | on | | Fronts, their glyphs, the rain and the warm-sector tint |
| `barbs` | Wind barbs | on | | Station wind barbs |
| `labels` | Labels | on | | Boxed edge numerals and central pressures |
| `coastline` | Coastline | on | | Land and coast |
| `tints` | Warm-sector tint | on | | The pale tint between each low's fronts |

Labels and central pressures are hidden below 900 css px of width, barbs below 700, so a small
window shows bold rings, coloured fronts and the letters.

### How it works

- **Pressure** (`src/isobar/pressure.js`): chart space is x in [0, aspect], y in [0, 1] (north
  up), in units of the canvas height. A pool of 7 systems (up to 4 lows, 3 highs) sits on a calm
  background, 1013 hPa plus a 12 hPa north-south gradient with a slow wave (so silence still shows
  wide isobars and westerly winds). Each system adds A·g(dx)·g(dy), where g is a Gaussian lowered
  and rescaled to reach exactly 0 at 3σ: it only touches its 3σ box and leaves no step at the box
  edge. A low lives 48 beats. It deepens from −4 to −16 hPa over beats 0–16, holds through 32 and
  fills to 0 by 48, with σ = 0.16 + 0.06·min(age/48, 1). A new low spawns on a strong
  (onsetStrength > 0.4) bass-led onset (bassAtt > midAtt, or the onset frame's bass > mid, since
  bassAtt lags a kick), at least 8 beats after the last, when fewer than 4 are alive. One also
  spawns when no low has lived for 4 beats. A low spawns in the western 5–40% of the chart around
  the storm track, latitude 0.5 − 0.25·balance ± 0.2 (stereo balance smoothed over 1 s: a louder
  left channel pushes the track north; mono stays centred). Of 8 hashed spots it takes the one
  farthest from the live lows, and only if that one is at least 0.4 (about 1.8σ of a full-grown
  low) from all of them; otherwise the spawn is skipped. Lows drift in step, so the spacing holds
  for life and steady kicks keep 2–3 lows, not a pile of 4. The youngest low takes the bass,
  −clamp(bassAtt − 1, 0, 1.5)·28·reactivity hPa (attack 60 ms, release 0.8 s), plus a
  −6·onsetStrength hPa kick pulse that decays over 250 ms. The highs (σ 0.3, one per third of the
  width) swell to 4 + 6·midAtt (smoothed over 0.3 s) hPa. They give way over about a second when
  a low passes within 0.2–0.6, so a high never sits on a low. Lows drift 1 cell (1/90 of the
  height) per beat, highs half that; highs leave east and re-enter from the west with a 4-beat
  fade. While silent the beat clock stops and every system fills toward the calm chart with a
  6 s time constant.
- **Anchors** (`anchors.js`): the calm chart's slope and the neighbours pull every minimum off
  its Gaussian centre, and a low on another's slope may have no minimum of its own (its rings
  merge into the other's). So each frame, from every system's centre, up to 24 damped Newton
  steps on the analytic gradient and Hessian (`derivs` in `pressure.js`; a capped gradient step
  where the Hessian is not definite the right way, every step backtracked until P falls for a low
  or rises for a high) find the extremum it drains into, converged below 0.5 hPa per chart unit.
  Systems of a kind that reach the same extremum share it with one lead: last frame's lead if it
  is still there, else the strongest. A system that leads its own extremum draws its letter,
  central pressure and fronts there. One that loses it (a kick on a deep young neighbour can
  swallow it for a few frames) keeps its marks at the remembered offset from its centre for 1 s,
  then fades them over 0.4 s; marks fade in over 0.25 s. A system that never had its own extremum
  shows nothing, so one ring system gets one letter and one set of fronts.
- **Isobars** (`contour.js`): P is evaluated on a grid of cell = max(12 px, W/160) (at most
  160 × 90 nodes), each system as a separable product over its box. Marching squares then run
  over each cell's levels 940 + 4k between its lowest and highest corner, with linear edge
  interpolation in a fixed node order (so rings close) and saddles resolved by the cell-centre
  average. All normal segments go in one path and one stroke, the bold ones in a second. Grid-edge
  crossings become the boxed numerals, at least 40 css px apart along each edge (a box that would
  overlap another, at a corner, is skipped).
- **Fronts** (`fronts.js`): for every shown low older than 2 beats, R = 2.2σ times the anchor's
  visibility. The cold front is a quadratic Bézier from the anchor with its control at R along angle ac and its end at 2R, 25°
  further round. ac starts at 110° (screen angles, 90° = south) and sweeps toward 60° by 50/32°
  per beat. The warm front leaves at 20° and bends 15° south. Between 16 and 32 beats an occluded
  front grows from the anchor along their bisector to 0.6R (retreating over 28–32), and both
  fronts start from its end. The fronts grow in over beats 2–6 and shrink away while the low
  fills. Glyphs sit every 22 css px on the leading side: cold triangles (9 px base, 8 px high)
  toward the warm sector, warm semicircles (5 px) away from it, alternating on the occluded front.
  Each colour's glyphs are filled in one path. Rain candidates sit every 7 css px of arc in 4
  rows at hashed offsets, 0–40 px behind the cold front and 0–80 px ahead of the warm front, kept
  when the hash is below density = 0.15 + 0.25·clamp(trebAtt − 1, 0, 2) + 0.2·flux (flux smoothed
  over 0.3 s, the density over 1 s). They are keyed to the arc length, so the rain travels with
  the front. The warm sector (centre, cold front, warm front back) is filled at alpha
  0.10·clamp(4·centroid, 0, 1), with the centroid smoothed over 2 s.
- **Barbs** (`barbs.js`): clamp(round(cssWidth/220), 7, 12) columns of stations, rows by aspect.
  The geostrophic wind uses the northern-hemisphere convention, low pressure to the left of
  downwind (u = K·∂P/∂y, v_north = K·∂P/∂x, from the analytic gradient), with K = 25 kt per
  4 hPa per 0.05 chart units. The shaft (14 css px) points into the wind. Pennants (50 kt),
  feathers (10 kt) and a half feather (5 kt), rounded to 5 kt, sit at its far end on the
  low-pressure side; below 3 kt a station shows a calm circle.
- **Coast** (`coast.js`): seeded 5-octave value noise from a 256² lattice, plus a 0.25 bias toward
  the north-west, land where it reaches 0.58, sampled in chart space so the continent is the same
  at every size. The land is an `ImageData` mask at a quarter resolution drawn smoothed, and the
  coastline is marching squares over the same samples. Both go with the background and the dashed
  graticule into a cached base canvas (a detached DOM canvas; an `OffscreenCanvas` only where
  there is no document), rebuilt when Chart or Coastline change and after a resize once the size
  has held for 0.15 s; during a resize drag the stale base is drawn scaled.
- **Each frame**: the base, the warm sectors, rain, normal then bold isobars, front lines then
  glyphs, barbs, edge labels (boxes in one fill and one stroke, then numerals), and finally H and
  L with their central pressures, at the anchors and at the anchors' visibility as alpha (only
  where the extremum is at least 3 hPa off the calm chart, and of two same-kind letters within two
  letter heights only the stronger). On the none chart the isobars, barbs and coast are each
  stroked first 3 px wider in rgba(0, 0, 0, 0.35).

`frame()` allocates nothing: all geometry goes into typed arrays made in create or resize. The
121 numeral strings (940–1060), the letters and the fonts are built in create or resize, and label
widths are measured once in create, because `measureText` returns a new object. There are no
closures, literals or string building per frame and no `Math.random`, so harness stills are
deterministic.

### Reduce motion and flashing

- The chart is line art on a steady background: kicks move lines and never flash. The only area
  changes, the tint and the rain, ramp over 1–2 s, and the tint also passes through the flash
  limiter (`flash.js`, at most 3 rises per second with Reduce flashing on).
- Fronts differ by glyph shape (triangles, semicircles, alternating), not only by colour, so they
  read for colour-blind viewers and on the single-colour night chart.
- **Reduce motion**: while Speed is at its default (1), drift and the kick pulse are halved and the
  cold front sweeps round at half the rate. Moving Speed off its default uses that value.
- Silence: no drift, no spawns; the lows fill and the highs relax over about 6 s.

### Performance

CPU only. Pressure, contours, fronts, rain and barbs take about 0.5 ms per frame at 2560 × 1440
in Node on one E-core of a desktop CPU, and a whole `frame()` against a no-op context takes about
0.4 ms (median); the anchors add about 0.01 ms (0.03 ms at the 99th percentile) with steady
kicks. Canvas work is one full `drawImage` plus about 15 path fills and strokes holding a few
thousand path operations. Building the base canvas (the coast mask) takes about 45 ms, on chart
changes and once per resize (after the size holds). Real canvas time, the full-size base blit in
WebKit in particular, has not been measured yet.

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
- `chroma.js`: per-frame pitch-class profile normalised to its peak, with major-third
  damping (Misregister's swells).
- `harmonic-chroma.js`: a 2 s smoothed pitch-class profile that damps the 3rd, 5th and
  6th harmonics of stronger lower peaks, so the two strongest classes are a real interval
  (Plotter's figures).

## Tests

```sh
cd web && npx vitest run --maxWorkers=2 ../plugins/fieldwork
uv run pytest tests/test_builtin_manifests.py
```

`frame()` allocates nothing in any of the visualizers.
