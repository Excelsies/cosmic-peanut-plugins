# Fieldwork

Visualizers built on physical experiments rather than glowing shapes: a third-party-style
Tidalviz repo (same layout as `plugins/cosmic-peanut`). Install it with
`uv run --extra gtk tidalviz --dev plugins/fieldwork --source synthetic:demo` (hot reload) or
**Library → Add folder**.

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

### Tests

`cd web && npx vitest run --maxWorkers=2 ../plugins/fieldwork` (table colours, film formulas,
plumes, re-dips, envelopes at 60 and 120 Hz, the flash cap, params) and
`uv run pytest tests/test_builtin_manifests.py` (manifest, shader files, d.ts copy).
