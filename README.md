# Fieldwork

Visualizers built on physical experiments rather than glowing shapes: a third-party-style
Tidalviz repo (same layout as `plugins/cosmic-peanut`). Install it with
`uv run --extra gtk tidalviz --dev plugins/fieldwork --source synthetic:demo` (hot reload) or
**Library → Add folder**.

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

**Flashing.** The whole window only darkens or brightens through the bass fold, which is slow
(120 ms / 0.6 s) and goes through the flash limiter: with Reduce flashing on, a new deepening
fold can start at most 3 times a second. Waves are local travelling bands, the light turn is a
4 s ease, and with foil under Reduce flashing the waves are 40% weaker and the rustle changes
only 3 times a second, so the glints don't sparkle. Nothing is signalled by colour alone.

**Reduce motion.** While Fold and Reactivity are at their defaults, waves are half as strong and
travel at 60% speed, the swell and rustle are off and the light turns every 16 bars. Move either
param to get full motion back.

`frame()` allocates nothing. Tests: `cd web && npx vitest run --maxWorkers=2 ../plugins/fieldwork`.
