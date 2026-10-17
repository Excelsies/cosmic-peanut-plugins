# Fieldwork

A Tidalviz plugin package of visualizers that look nothing like the built-ins. Run it in place
with hot reload:

```sh
uv run --extra gtk tidalviz --dev plugins/fieldwork --source synthetic:demo   # Linux
uv run tidalviz --dev plugins/fieldwork                                       # macOS
```

or add the folder from **Library → Add folder**. Tests:
`cd web && npx vitest run ../plugins/fieldwork` and `uv run pytest tests/test_builtin_manifests.py`.

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
