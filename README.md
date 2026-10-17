# Fieldwork

Visualizers built on physical experiments rather than glowing shapes: a third-party-style
Tidalviz repo (same layout as `plugins/cosmic-peanut`). Install it with
`uv run --extra gtk tidalviz --dev plugins/fieldwork --source synthetic:demo` (hot reload) or
**Library → Add folder**.

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

Tests: `cd web && npx vitest run --maxWorkers=2 ../plugins/fieldwork` and
`uv run pytest tests/test_builtin_manifests.py`.
