# Fieldwork

A package of visualizers that each borrow a physical instrument or process and let the music run
it. Third-party format, like `plugins/cosmic-peanut`: `tidalviz.json` at the root, entry modules in
`src/`, pure logic with its tests in `src/lib/`, thumbnails in `thumbs/`, and a byte copy of
`web/sdk/tidalviz.d.ts`. Run it from source with hot reload:

```sh
uv run --extra gtk tidalviz --dev plugins/fieldwork --source synthetic:demo   # Linux
uv run tidalviz --dev plugins/fieldwork                                       # macOS
```

or add the folder in the app with **Library → Add folder**.

Tests: `cd web && npx vitest run ../plugins/fieldwork`. `frame()` allocates nothing in any of the
visualizers.

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
- **Interval** (`interval.js`, `chroma.js`): a chroma vector from peak-picked spectrum bins
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
