// @ts-check
/**
 * Isobar — a live surface-pressure weather chart.
 *
 * Lows and highs are Gaussian pressure systems on a calm background (isobar/pressure.js): heavy
 * bass deepens the youngest low and crowds its isobars, kicks snap its rings inward, the mids swell
 * the highs, and everything drifts east on the song's beat clock. A low lives 48 beats: it deepens,
 * occludes and fills, its fronts sweeping round as it ages (isobar/fronts.js). The isobars are
 * marching squares over a grid of at most 160 x 90 nodes (isobar/contour.js); station barbs show
 * the geostrophic wind (isobar/barbs.js); the land is fractal noise (isobar/coast.js), drawn once
 * into a cached base canvas with the background and graticule. Letters, central pressures and
 * fronts sit on the field's real extrema (isobar/anchors.js), one set per ring system.
 *
 * Kicks move lines and never flash; the only area changes (the warm-sector tint and the rain)
 * ramp over 1-2 s, and the tint also passes through the flash limiter. Every string is built in
 * create or resize, label widths are measured once in create, and frame() allocates nothing.
 */
import { createAnchors, locateAnchors } from "./isobar/anchors.js";
import { addBarb, clearBarbs, createBarbs, MAX_STATIONS, pathBarbs, stationGrid, windAt } from "./isobar/barbs.js";
import { CHART_STYLES } from "./isobar/chart.js";
import { coastSegments, createCoast, LAND, landAt } from "./isobar/coast.js";
import { contour, createContours, pathSegments } from "./isobar/contour.js";
import { createFlashLimiter } from "./lib/flash.js";
import {
  buildFronts,
  createFronts,
  pathCurves,
  pathGlyphs,
  pathRain,
  pathTint,
  placeGlyphs,
  placeRain,
} from "./isobar/fronts.js";
import { createParams, resolveParams } from "./isobar/isobar-params.js";
import { createPressure, fillField, HIGH, setAspect, SLOTS, stepPressure } from "./isobar/pressure.js";

const FAMILY = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';
const P_MIN = 940;
const P_MAX = 1060;
/** The empty dash array (solid lines). */
const SOLID = /** @type {number[]} */ ([]);
const T_FLUX = 0.3;
const T_CENTROID = 2;
const T_RAIN = 1;
/** Below these css widths the labels and central pressures, then the barbs, are hidden. */
const LABELS_MIN_CSS = 900;
const BARBS_MIN_CSS = 700;
/** During a resize drag the stale base is drawn scaled; it is rebuilt once the size holds this long (s). */
const REBUILD_HOLD = 0.15;

/**
 * A detached DOM canvas in the plugin's document (the same kind of surface as the visible one),
 * or an OffscreenCanvas where there is no document.
 * @param {number} w @param {number} h
 */
function makeCanvas(w, h) {
  if (typeof document === "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** @param {HTMLCanvasElement | OffscreenCanvas} c */
const ctx2dOf = (c) => /** @type {CanvasRenderingContext2D} */ (/** @type {unknown} */ (c.getContext("2d")));

/** @type {import('../tidalviz').CreateVisualizer} */
export default async function create(ctx) {
  const g = /** @type {CanvasRenderingContext2D} */ (ctx.ctx2d);
  const prm = resolveParams(ctx.params, ctx.reduceMotion, createParams());
  let reduceMotion = ctx.reduceMotion;
  let style = CHART_STYLES[prm.chart];

  const pressure = createPressure(ctx.size.width / Math.max(1, ctx.size.height));
  const contours = createContours();
  const fronts = createFronts();
  const barbs = createBarbs();
  const coast = createCoast();
  const flash = createFlashLimiter();
  const anchors = createAnchors();
  const stations = new Float32Array(2 * MAX_STATIONS);
  const wind = new Float64Array(2);
  const coastSegs = new Float32Array(4 * 60000);

  // Every string frame() draws, built once: numerals 940-1060 and the two letters.
  /** @type {string[]} */
  const NUMS = [];
  for (let p = P_MIN; p <= P_MAX; p++) NUMS.push(String(p));
  const LOW_TEXT = "L";
  const HIGH_TEXT = "H";
  // measureText allocates a TextMetrics, so widths are measured once, per px of font size.
  const numW = new Float32Array(NUMS.length);
  g.font = `600 100px ${FAMILY}`;
  for (let k = 0; k < NUMS.length; k++) numW[k] = g.measureText(NUMS[k]).width / 100;

  // Layout, rebuilt in resize.
  let W = 0;
  let H = 0;
  let dpr = 1;
  let cols = 0;
  let rows = 0;
  let cellX = 1;
  let cellY = 1;
  let nodes = new Float32Array(0);
  let nStations = 0;
  let showLabels = true;
  let showBarbs = true;
  let labelPx = 10;
  let letterPx = 40;
  let cpPx = 12;
  let labelFont = "";
  let letterFont = "";
  let cpFont = "";
  /** @type {number[]} */
  let gratDash = [];
  /** Edge label boxes: x, y, w, h, numeral index. */
  const boxes = new Float32Array(5 * 256);
  /** 1 for each pressure slot that gets a letter this frame. */
  const mark = new Uint8Array(SLOTS);
  /** The base is from an older size: drawn scaled until the size has held REBUILD_HOLD seconds. */
  let baseStale = false;
  let sinceResize = 0;

  const base = makeCanvas(1, 1);
  const bg = ctx2dOf(base);
  let mask = makeCanvas(1, 1);

  // Smoothed audio.
  let fluxS = 0;
  let centroidS = 0;
  let rainS = 0.15;

  function layout() {
    const s = ctx.size;
    W = Math.max(1, s.width);
    H = Math.max(1, s.height);
    dpr = s.dpr > 0 ? s.dpr : 1;
    setAspect(pressure, W / H);
    const cell = Math.max(12, W / 160);
    cols = Math.ceil(W / cell) + 1;
    rows = Math.ceil(H / cell) + 1;
    cellX = W / (cols - 1);
    cellY = H / (rows - 1);
    if (nodes.length < cols * rows) nodes = new Float32Array(cols * rows);
    nStations = stationGrid(s.cssWidth, W / H, stations);
    showLabels = s.cssWidth >= LABELS_MIN_CSS;
    showBarbs = s.cssWidth >= BARBS_MIN_CSS;
    labelPx = 10.5 * dpr;
    letterPx = (showLabels ? 40 : 30) * dpr;
    cpPx = 12.5 * dpr;
    labelFont = `600 ${labelPx}px ${FAMILY}`;
    letterFont = `700 ${letterPx}px ${FAMILY}`;
    cpFont = `600 ${cpPx}px ${FAMILY}`;
    gratDash = [3 * dpr, 5 * dpr];
  }

  /** Background, graticule, land and coast into the cached base canvas. */
  function rebuildBase() {
    baseStale = false;
    if (base.width !== W || base.height !== H) {
      base.width = W;
      base.height = H;
    }
    bg.setLineDash(SOLID);
    bg.globalAlpha = 1;
    bg.clearRect(0, 0, W, H);
    if (style.bg) {
      bg.fillStyle = style.bg;
      bg.fillRect(0, 0, W, H);
    }
    if (prm.coastline) drawLand();
    // Dashed graticule every 10% of the height.
    const step = 0.1 * H;
    bg.strokeStyle = style.grat;
    bg.lineWidth = dpr;
    bg.setLineDash(gratDash);
    bg.beginPath();
    for (let y = step; y < H - 1; y += step) {
      bg.moveTo(0, y);
      bg.lineTo(W, y);
    }
    for (let x = step; x < W - 1; x += step) {
      bg.moveTo(x, 0);
      bg.lineTo(x, H);
    }
    bg.stroke();
    bg.setLineDash(SOLID);
  }

  /** Land mask at a quarter of the resolution, drawn smoothed, then the coastline over it. */
  function drawLand() {
    const mw = Math.max(2, Math.ceil(W / 4));
    const mh = Math.max(2, Math.ceil(H / 4));
    const sx = W / mw; // device px per mask pixel
    const sy = H / mh;
    const values = new Float32Array(mw * mh);
    for (let j = 0; j < mh; j++) {
      for (let i = 0; i < mw; i++) values[j * mw + i] = landAt(coast, ((i + 0.5) * sx) / H, ((j + 0.5) * sy) / H, W / H);
    }
    if (style.land) {
      if (mask.width !== mw || mask.height !== mh) {
        mask.width = mw;
        mask.height = mh;
      }
      const mg = ctx2dOf(mask);
      const img = mg.createImageData(mw, mh);
      const r = parseInt(style.land.slice(1, 3), 16);
      const gg = parseInt(style.land.slice(3, 5), 16);
      const b = parseInt(style.land.slice(5, 7), 16);
      for (let k = 0; k < mw * mh; k++) {
        if (values[k] < LAND) continue;
        img.data[4 * k] = r;
        img.data[4 * k + 1] = gg;
        img.data[4 * k + 2] = b;
        img.data[4 * k + 3] = 255;
      }
      mg.putImageData(img, 0, 0);
      bg.imageSmoothingEnabled = true;
      bg.drawImage(mask, 0, 0, mw, mh, 0, 0, W, H);
    }
    const n = coastSegments(values, mw, mh, sx, sy, coastSegs);
    bg.globalAlpha = style.coastAlpha;
    bg.lineCap = "round";
    bg.beginPath();
    for (let k = 0; k < n; k++) {
      const o = 4 * k;
      // mask samples sit at pixel centres
      bg.moveTo(coastSegs[o] + sx / 2, coastSegs[o + 1] + sy / 2);
      bg.lineTo(coastSegs[o + 2] + sx / 2, coastSegs[o + 3] + sy / 2);
    }
    if (style.halo2) {
      bg.strokeStyle = style.halo2;
      bg.lineWidth = (1.2 + 3) * dpr;
      bg.stroke();
    }
    bg.strokeStyle = style.coast;
    bg.lineWidth = 1.2 * dpr;
    bg.stroke();
    bg.globalAlpha = 1;
  }

  layout();
  rebuildBase();

  /** @param {number} p */
  const numeralIndex = (p) => Math.min(P_MAX, Math.max(P_MIN, Math.round(p))) - P_MIN;

  return {
    frame(audio, time) {
      const dt = time.dt;
      if (ctx.reduceMotion !== reduceMotion) {
        reduceMotion = ctx.reduceMotion;
        resolveParams(ctx.params, reduceMotion, prm);
      }
      stepPressure(pressure, audio, dt, prm);
      locateAnchors(pressure, anchors, dt);
      if (baseStale) {
        sinceResize += dt;
        if (sinceResize >= REBUILD_HOLD) rebuildBase();
      }

      fluxS += (audio.flux - fluxS) * (1 - Math.exp(-dt / T_FLUX));
      centroidS += (audio.centroid - centroidS) * (1 - Math.exp(-dt / T_CENTROID));
      const rainTarget = 0.15 + (0.5 * Math.min(2, Math.max(0, audio.trebAtt - 1))) / 2 + 0.2 * fluxS;
      rainS += (rainTarget - rainS) * (1 - Math.exp(-dt / T_RAIN));
      const tint = flash.step(Math.min(1, Math.max(0, centroidS * 4)), dt, ctx.reduceFlashing);

      fillField(pressure, nodes, cols, rows, cellX / H, cellY / H);
      contour(nodes, cols, rows, cellX, cellY, 40 * dpr, contours);
      const gs = dpr * style.glyph;
      if (prm.fronts) {
        buildFronts(pressure, anchors, fronts, H, prm.sweepEff);
        placeGlyphs(fronts, gs);
        placeRain(fronts, rainS, dpr);
      }

      // 1. base
      g.clearRect(0, 0, W, H);
      if (base.width === W && base.height === H) g.drawImage(base, 0, 0);
      else g.drawImage(base, 0, 0, W, H);
      g.lineCap = "round";
      g.lineJoin = "round";

      if (prm.fronts) {
        // 2. warm sectors, 3. rain
        if (prm.tints && tint > 0.002) {
          g.globalAlpha = 0.1 * tint;
          g.fillStyle = style.tint;
          g.beginPath();
          pathTint(g, fronts);
          g.fill();
          g.globalAlpha = 1;
        }
        g.fillStyle = style.rain;
        g.beginPath();
        pathRain(g, fronts, 2 * dpr);
        g.fill();
      }

      // 4. isobars: all normal segments in one stroke, all bold ones in another (each over a dark
      // halo on the light-ink 'none' chart, so they read on a light desktop too)
      for (let bold = 0; bold < 2; bold++) {
        g.beginPath();
        pathSegments(g, contours, /** @type {0 | 1} */ (bold));
        if (style.halo2) {
          g.strokeStyle = style.halo2;
          g.lineWidth = (bold + 1 + 3) * dpr;
          g.stroke();
        }
        g.strokeStyle = style.iso;
        g.lineWidth = (bold + 1) * dpr;
        g.stroke();
      }

      // 5. fronts, then their glyphs
      if (prm.fronts) {
        g.lineWidth = 2.5 * dpr * (style.glyph > 1 ? 1.4 : 1);
        for (let kind = 0; kind < 3; kind++) {
          g.strokeStyle = style.fronts[kind];
          g.beginPath();
          pathCurves(g, fronts, kind);
          g.stroke();
        }
        for (let kind = 0; kind < 3; kind++) {
          g.fillStyle = style.fronts[kind];
          g.beginPath();
          pathGlyphs(g, fronts, kind, gs);
          g.fill();
        }
      }

      // 6. barbs
      if (prm.barbs && showBarbs) {
        clearBarbs(barbs);
        for (let k = 0; k < nStations; k++) {
          const x = stations[2 * k];
          const y = stations[2 * k + 1];
          windAt(pressure, x, y, wind);
          addBarb(barbs, x * H, y * H, wind[0], wind[1], 14 * dpr);
        }
        g.beginPath();
        pathBarbs(g, barbs, 0);
        if (style.halo2) {
          g.strokeStyle = style.halo2;
          g.lineWidth = (1.2 + 3) * dpr;
          g.stroke();
        }
        g.strokeStyle = style.barb;
        g.fillStyle = style.barb;
        g.lineWidth = 1.2 * dpr;
        g.stroke();
        g.beginPath();
        pathBarbs(g, barbs, 1);
        g.fill();
      }

      const text = prm.labels && showLabels;
      // 7. edge labels: boxes in one fill and one stroke, then the numerals
      if (text && contours.nLabels > 0) {
        const pad = 3 * dpr;
        const bh = labelPx + 2 * pad;
        let nb = 0;
        for (let k = 0; k < contours.nLabels; k++) {
          const o = 4 * k;
          const idx = numeralIndex(contours.labels[o + 2]);
          const bw = numW[idx] * labelPx + 2 * pad;
          const side = contours.labels[o + 3];
          let bx = contours.labels[o] - bw / 2;
          let by = contours.labels[o + 1] - bh / 2;
          if (side === 0) by = dpr;
          else if (side === 2) by = H - bh - dpr;
          else if (side === 3) bx = dpr;
          else bx = W - bw - dpr;
          bx = Math.min(W - bw - dpr, Math.max(dpr, bx));
          by = Math.min(H - bh - dpr, Math.max(dpr, by));
          // skip one that would overlap a box already placed (corners, where two edges meet)
          let clash = false;
          for (let q = 0; q < nb && !clash; q++) {
            const o2 = 5 * q;
            clash = bx < boxes[o2] + boxes[o2 + 2] + pad && boxes[o2] < bx + bw + pad && by < boxes[o2 + 1] + bh + pad && boxes[o2 + 1] < by + bh + pad;
          }
          if (clash) continue;
          const w = 5 * nb++;
          boxes[w] = bx;
          boxes[w + 1] = by;
          boxes[w + 2] = bw;
          boxes[w + 3] = bh;
          boxes[w + 4] = idx;
        }
        g.beginPath();
        for (let k = 0; k < nb; k++) g.rect(boxes[5 * k], boxes[5 * k + 1], boxes[5 * k + 2], boxes[5 * k + 3]);
        g.fillStyle = style.box;
        g.fill();
        g.lineWidth = dpr;
        g.strokeStyle = style.iso;
        g.stroke();
        g.font = labelFont;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = style.label;
        for (let k = 0; k < nb; k++) {
          const o = 5 * k;
          g.fillText(NUMS[boxes[o + 4]], boxes[o] + boxes[o + 2] / 2, boxes[o + 1] + boxes[o + 3] / 2 + 0.5 * dpr);
        }
      }

      // 8. H and L, with their central pressure, on each extremum (anchors.js: one letter per
      // ring system, only where it is at least 3 hPa off the calm chart the right way), and of two
      // same-kind letters that would overlap only the stronger.
      for (let i = 0; i < SLOTS; i++) mark[i] = anchors.letter[i];
      for (let i = 0; i < SLOTS; i++) {
        for (let j = 0; j < SLOTS; j++) {
          if (i === j || !mark[i] || !mark[j] || pressure.kind[i] !== pressure.kind[j]) continue;
          const dx = (anchors.x[i] - anchors.x[j]) * H;
          const dy = (anchors.y[i] - anchors.y[j]) * H;
          const ai = Math.abs(anchors.anomaly[i]);
          const aj = Math.abs(anchors.anomaly[j]);
          if (dx * dx + dy * dy < 4 * letterPx * letterPx && (ai < aj || (ai === aj && j < i))) mark[i] = 0;
        }
      }
      g.font = letterFont;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 4 * dpr;
      g.strokeStyle = style.halo;
      for (let i = 0; i < SLOTS; i++) {
        const high = pressure.kind[i] === HIGH;
        if (!mark[i]) continue;
        const x = anchors.x[i] * H;
        const y = anchors.y[i] * H;
        if (x < -letterPx || x > W + letterPx) continue;
        g.globalAlpha = anchors.vis[i];
        g.fillStyle = high ? style.high : style.low;
        g.strokeText(high ? HIGH_TEXT : LOW_TEXT, x, y);
        g.fillText(high ? HIGH_TEXT : LOW_TEXT, x, y);
      }
      g.globalAlpha = 1;
      if (text) {
        g.font = cpFont;
        g.lineWidth = 3 * dpr;
        for (let i = 0; i < SLOTS; i++) {
          const high = pressure.kind[i] === HIGH;
          if (!mark[i]) continue;
          const x = anchors.x[i] * H;
          const y = anchors.y[i] * H + 0.62 * letterPx + 0.5 * cpPx;
          if (x < -letterPx || x > W + letterPx) continue;
          const s = NUMS[numeralIndex(anchors.p[i])];
          g.globalAlpha = anchors.vis[i];
          g.fillStyle = high ? style.high : style.low;
          g.strokeText(s, x, y);
          g.fillText(s, x, y);
        }
        g.globalAlpha = 1;
      }
    },

    resize() {
      layout();
      // a resize drag: draw the old base scaled, rebuild once the size holds (frame())
      baseStale = true;
      sinceResize = 0;
    },

    params(changed) {
      const chart = prm.chart;
      const coastline = prm.coastline;
      resolveParams(ctx.params, ctx.reduceMotion, prm);
      reduceMotion = ctx.reduceMotion;
      style = CHART_STYLES[prm.chart];
      if (prm.chart !== chart || prm.coastline !== coastline || "chart" in changed) rebuildBase();
    },

    dispose() {
      base.width = 0;
      base.height = 0;
      mask.width = 0;
      mask.height = 0;
    },
  };
}
