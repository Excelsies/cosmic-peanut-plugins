# Fieldwork

Visualizers built on physical experiments and instruments rather than glowing shapes: a
third-party-style Tidalviz repo (same layout as `plugins/cosmic-peanut`). Install it with
`uv run --extra gtk tidalviz --dev plugins/fieldwork --source synthetic:demo` (hot reload) or
**Library → Add folder**.

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

### Tests

`cd web && npx vitest run --maxWorkers=2 ../plugins/fieldwork` (lifecycle, spawn rules and
spacing, silence, 60 vs 120 Hz, stereo storm track, field, gradient and Hessian, anchors on real
extrema with shared-minimum leads, hold and fade, closed rings and saddles, fronts and glyph
sides, barb buckets and the westerly feather side, coast, params, draw order, the none chart's
halo, resize debounce, helper copy digests and the per-frame allocation check) and `uv run pytest tests/test_builtin_manifests.py` (manifest, d.ts copy).
