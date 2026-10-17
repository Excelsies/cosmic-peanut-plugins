// @ts-check
/**
 * Starling flock simulation, CPU, structure of arrays, one fixed 1/60 s step per call.
 *
 * Each bird steers by its 7 nearest neighbours within 0.12 units (topological, like real
 * starlings), found through grid.js's uniform 3D grid, rebuilt every step. Each bird's neighbour
 * list is refreshed every fourth step (a quarter of the flock per step), which cuts the search
 * cost to a quarter; neighbours change slowly.
 * Forces: separation Σ(pi − pj)/d² over those neighbours closer than SEP_RADIUS; alignment and
 * cohesion toward the neighbours; a spring toward the attractor beyond the flock radius; soft
 * walls beyond 85% of the frame; a flee burst from the falcon; a one-off sideways kick as each
 * agitation wave's shell passes. Speed is clamped to 0.5–1.6 × cruise. Banking roll follows the
 * smoothed lateral acceleration; wings flap from a per-bird phase.
 *
 * Positions before the step are kept in ppx/ppy/ppz so rendering can interpolate between steps.
 * After creation nothing here allocates.
 */

import { buildGrid, findNeighbors, sizeGrid, TOPO_K } from "./grid.js";

export const MAX_BIRDS = 6000;
export const STEP = 1 / 60;
export const SEP_RADIUS = 0.055;
/** Half-depth of the slab birds live in. */
export const Z_HALF = 1.2;
/** Bird length (world units). */
export const BIRD_SIZE = 0.026;

const S2 = SEP_RADIUS * SEP_RADIUS;
const W_SEP = 0.3;
const K_SPRING = 4;
const K_WALL = 12;
/** The flock keeps within this depth of the slab's middle (a thick sheet, not a column). */
const Z_FLOCK = 0.35;
const K_FLEE = 40;
const FLEE_RADIUS = 0.3;
const ROLL_GAIN = 0.35;
const ROLL_MAX = 1.25;
const ROLL_KEEP = Math.exp(-STEP / 0.15);
const CRUISE_RELAX = 1.5; // 1/s, pull toward cruise speed
/** Steps between neighbour-list refreshes of one bird. */
const REFRESH = 4;

/**
 * Seeded PRNG (mulberry32). Only for setup; frames never draw random numbers.
 * @param {number} seed
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {number} [max] */
export function createFlock(max = MAX_BIRDS) {
  const f32 = () => new Float32Array(max);
  return {
    n: 0,
    max,
    px: f32(), py: f32(), pz: f32(),
    vx: f32(), vy: f32(), vz: f32(),
    ppx: f32(), ppy: f32(), ppz: f32(),
    tvx: f32(), tvy: f32(), tvz: f32(),
    flap: f32(),
    rate: f32(), // per-bird flap-rate factor
    place: f32(), // position along the flock's shape curve, 0 tail .. 1 head
    reach: f32(), // fraction of the tube radius this bird may stray (small: the dense core)
    roll: f32(),
    kick0: new Int32Array(max),
    kick1: new Int32Array(max),
    // Grid.
    hx: 1, hy: 1,
    gx0: 1, gy0: 1, gz0: 1, gw: 1, gh: 1, gd: 1,
    cellStart: new Int32Array(2), // cell c holds sorted slots cellStart[c] .. cellStart[c + 1] - 1
    cellOf: new Int32Array(max),
    order: new Int32Array(max), // sorted slot → bird
    sx: new Float32Array(max), // positions in sorted (cell) order
    sy: new Float32Array(max),
    sz: new Float32Array(max),
    // Neighbour scratch.
    nbIdx: new Int32Array(TOPO_K),
    nbD2: new Float32Array(TOPO_K),
    // Cached neighbour lists, refreshed for a quarter of the birds each step.
    nb: new Int32Array(max * TOPO_K),
    nbN: new Uint8Array(max),
    steps: 0,
    stale: true, // refresh every bird on the next step
    // Flock centre after the last step.
    cx: 0, cy: 0,
  };
}

/** @typedef {ReturnType<typeof createFlock>} Flock */

/** Per-step inputs, written by the caller each frame. */
export function createControls() {
  return {
    ax: 0, ay: 0, // attractor
    radius: 0.55, // spring acts beyond this distance from the attractor
    // Shape curve through the attractor, in units of radius, along (axisX, axisY): see SHAPES in
    // attractor.js. Each bird is pulled toward its own point (f.place) beyond the tube radius.
    axisX: 1, axisY: 0,
    len: 0.3, bend: 0, ring: 0, ringMix: 0, tubeHead: 1, tubeTail: 0.85,
    flow: 0, // ring phase: birds stream around a closed shape
    wavePhase: 0, // a slow slither along a ribbon
    cruise: 0.9,
    align: 1.2,
    cohesion: 1,
    flapRate: 8, // Hz
    falcon: false, fx: 0, fy: 0, flee: 0,
    wave0: false, wave0x: 0, wave0y: 0, wave0r: 0, wave0id: 0, wave0kick: 0.15,
    wave1: false, wave1x: 0, wave1y: 0, wave1r: 0, wave1id: 0, wave1kick: 0.075,
    shell: 0.12,
  };
}

/** @typedef {ReturnType<typeof createControls>} Controls */

/**
 * Frame half-extents at z = 0 and grid dimensions. Allocates the grid only when it grows.
 * @param {Flock} f @param {number} hx @param {number} hy
 */
export function resizeFlock(f, hx, hy) {
  f.hx = hx;
  f.hy = hy;
  sizeGrid(f);
}

/**
 * Place `n` birds in a loose cloud left of centre, all heading roughly right.
 * @param {Flock} f @param {number} n @param {number} seed
 */
export function seedFlock(f, n, seed) {
  const rnd = mulberry32(seed);
  f.n = Math.min(n, f.max);
  const cx0 = -0.25 * f.hx;
  const cy0 = 0.1 * f.hy;
  for (let i = 0; i < f.max; i++) {
    // Uniform in a disc of radius 0.6, uniform in depth.
    const a = rnd() * Math.PI * 2;
    const r = 0.6 * Math.sqrt(rnd());
    f.px[i] = cx0 + r * Math.cos(a);
    f.py[i] = cy0 + r * Math.sin(a) * 0.7;
    f.pz[i] = (rnd() * 2 - 1) * 0.8 * Z_HALF;
    const h = 0.25 + (rnd() - 0.5) * 0.5;
    f.vx[i] = 0.9 * Math.cos(h);
    f.vy[i] = 0.9 * Math.sin(h);
    f.vz[i] = (rnd() - 0.5) * 0.2;
    f.ppx[i] = f.px[i];
    f.ppy[i] = f.py[i];
    f.ppz[i] = f.pz[i];
    f.flap[i] = rnd();
    f.rate[i] = 0.85 + 0.3 * rnd();
    f.place[i] = rnd();
    const q = rnd();
    f.reach[i] = 0.22 + 0.78 * q * q * q;
    f.roll[i] = 0;
    f.kick0[i] = 0;
    f.kick1[i] = 0;
  }
  f.cx = cx0;
  f.cy = cy0;
  f.stale = true;
}

/**
 * Change the active bird count. New birds start next to existing ones (deterministic), so the
 * flock grows in place. Nothing is reallocated.
 * @param {Flock} f @param {number} n
 */
export function setCount(f, n) {
  n = Math.max(1, Math.min(n, f.max));
  const old = Math.max(1, f.n);
  for (let i = f.n; i < n; i++) {
    const j = (i * 7919) % old;
    const jx = ((i * 0.618034) % 1) - 0.5;
    const jy = ((i * 0.754878) % 1) - 0.5;
    f.px[i] = f.px[j] + jx * 0.04;
    f.py[i] = f.py[j] + jy * 0.04;
    f.pz[i] = f.pz[j];
    f.vx[i] = f.vx[j];
    f.vy[i] = f.vy[j];
    f.vz[i] = f.vz[j];
    f.ppx[i] = f.px[i];
    f.ppy[i] = f.py[i];
    f.ppz[i] = f.pz[i];
    f.roll[i] = f.roll[j];
    f.flap[i] = f.flap[j];
    f.rate[i] = f.rate[j];
    f.place[i] = f.place[j];
    f.reach[i] = f.reach[j];
  }
  f.n = n;
  f.stale = true;
}

/**
 * Advance the flock by one fixed step.
 * @param {Flock} f @param {Controls} c
 * @returns {void}
 */
export function stepFlock(f, c) {
  const n = f.n;
  const { px, py, pz, vx, vy, vz, tvx, tvy, tvz } = f;
  for (let i = 0; i < n; i++) {
    f.ppx[i] = px[i];
    f.ppy[i] = py[i];
    f.ppz[i] = pz[i];
  }
  buildGrid(f);

  const h = STEP;
  const cruise = c.cruise;
  const vmin = 0.5 * cruise;
  const vmax = 1.6 * cruise;
  const wallX = 0.85 * f.hx;
  const wallY = 0.85 * f.hy;
  const wallZ = 0.85 * Z_HALF;
  const shell = c.shell;
  const fleeR2 = FLEE_RADIUS * FLEE_RADIUS;
  const nbIdx = f.nbIdx;
  const nb = f.nb;
  const nbN = f.nbN;
  const phase = f.steps % REFRESH;
  const all = f.stale;
  f.stale = false;
  f.steps++;

  const order = f.order;
  for (let slot = 0; slot < n; slot++) {
    const i = order[slot]; // cell order: neighbouring birds' data stays in cache
    const x = px[i];
    const y = py[i];
    const z = pz[i];
    let ux = vx[i];
    let uy = vy[i];
    let uz = vz[i];
    const base = i * TOPO_K;
    if (all || i % REFRESH === phase) {
      const found = findNeighbors(f, i);
      for (let q = 0; q < found; q++) nb[base + q] = nbIdx[q];
      nbN[i] = found;
    }
    const k = nbN[i];

    let ax = 0;
    let ay = 0;
    let az = 0;
    if (k > 0) {
      let mvx = 0, mvy = 0, mvz = 0, mpx = 0, mpy = 0, mpz = 0;
      for (let q = 0; q < k; q++) {
        const j = nb[base + q];
        const dx = x - px[j];
        const dy = y - py[j];
        const dz = z - pz[j];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < S2) {
          const inv = W_SEP / (d2 > 1e-5 ? d2 : 1e-5);
          ax += dx * inv;
          ay += dy * inv;
          az += dz * inv;
        }
        mvx += vx[j];
        mvy += vy[j];
        mvz += vz[j];
        mpx += px[j];
        mpy += py[j];
        mpz += pz[j];
      }
      const inv = 1 / k;
      ax += c.align * (mvx * inv - ux) + c.cohesion * (mpx * inv - x);
      ay += c.align * (mvy * inv - uy) + c.cohesion * (mpy * inv - y);
      az += c.align * (mvz * inv - uz) + c.cohesion * (mpz * inv - z);
    }

    // Spring toward this bird's own point on the shape curve, beyond its share of the tube radius
    // there (birds with a small reach make the dense core, the rest the thinner edges).
    const sb = f.place[i];
    const ang = 6.283185307179586 * (sb + c.flow);
    const lu = c.len * (sb - 0.5);
    const lv = c.bend * Math.sin(6.283185307179586 * sb + c.wavePhase);
    const cu = (lu + (c.ring * Math.cos(ang) - lu) * c.ringMix) * c.radius;
    const cv = (lv + (c.ring * Math.sin(ang) - lv) * c.ringMix) * c.radius;
    const tx = c.ax + cu * c.axisX - cv * c.axisY;
    const ty = c.ay + cu * c.axisY + cv * c.axisX;
    const tube = (c.tubeTail + (c.tubeHead - c.tubeTail) * sb) * c.radius * f.reach[i];
    const dxT = tx - x;
    const dyT = ty - y;
    const dT = Math.sqrt(dxT * dxT + dyT * dyT) + 1e-6;
    if (dT > tube) {
      const s = (K_SPRING * (dT - tube)) / dT;
      ax += dxT * s;
      ay += dyT * s;
    }
    if (z > Z_FLOCK) az -= K_SPRING * (z - Z_FLOCK);
    else if (z < -Z_FLOCK) az -= K_SPRING * (z + Z_FLOCK);

    // Soft walls.
    if (x > wallX) ax -= K_WALL * (x - wallX);
    else if (x < -wallX) ax -= K_WALL * (x + wallX);
    if (y > wallY) ay -= K_WALL * (y - wallY);
    else if (y < -wallY) ay -= K_WALL * (y + wallY);
    if (z > wallZ) az -= K_WALL * (z - wallZ);
    else if (z < -wallZ) az -= K_WALL * (z + wallZ);

    // Falcon: burst away from its position.
    if (c.falcon && c.flee > 0) {
      const fx = x - c.fx;
      const fy = y - c.fy;
      const d2 = fx * fx + fy * fy;
      if (d2 < fleeR2) {
        const d = Math.sqrt(d2) + 1e-4;
        const s = (K_FLEE * c.flee * (1 - d / FLEE_RADIUS)) / d;
        ax += fx * s;
        ay += fy * s;
      }
    }

    // Lateral acceleration → banking roll.
    const sp0 = Math.sqrt(ux * ux + uy * uy) + 1e-6;
    const lat = (ay * ux - ax * uy) / sp0;
    let rt = lat * ROLL_GAIN;
    rt = rt > ROLL_MAX ? ROLL_MAX : rt < -ROLL_MAX ? -ROLL_MAX : rt;
    f.roll[i] = rt + (f.roll[i] - rt) * ROLL_KEEP;

    ux += ax * h;
    uy += ay * h;
    uz += az * h;

    // Agitation waves: one sideways kick per bird per wave as the shell passes.
    if (c.wave0 && f.kick0[i] !== c.wave0id) {
      const wx = x - c.wave0x;
      const wy = y - c.wave0y;
      const d = Math.sqrt(wx * wx + wy * wy);
      if (d >= c.wave0r - shell && d <= c.wave0r) {
        f.kick0[i] = c.wave0id;
        const s = (((i + c.wave0id) & 1) * 2 - 1) * c.wave0kick / sp0;
        const tx = ux;
        ux -= uy * s;
        uy += tx * s;
      }
    }
    if (c.wave1 && f.kick1[i] !== c.wave1id) {
      const wx = x - c.wave1x;
      const wy = y - c.wave1y;
      const d = Math.sqrt(wx * wx + wy * wy);
      if (d >= c.wave1r - shell && d <= c.wave1r) {
        f.kick1[i] = c.wave1id;
        const s = (((i + c.wave1id) & 1) * 2 - 1) * c.wave1kick / sp0;
        const tx = ux;
        ux -= uy * s;
        uy += tx * s;
      }
    }

    // Relax toward cruise speed, then clamp.
    let sp = Math.sqrt(ux * ux + uy * uy + uz * uz) + 1e-9;
    const relax = 1 + (CRUISE_RELAX * h * (cruise - sp)) / sp;
    ux *= relax;
    uy *= relax;
    uz *= relax;
    sp *= relax;
    if (sp > vmax || sp < vmin) {
      const s = (sp > vmax ? vmax : vmin) / sp;
      ux *= s;
      uy *= s;
      uz *= s;
    }
    tvx[i] = ux;
    tvy[i] = uy;
    tvz[i] = uz;

    let ph = f.flap[i] + c.flapRate * f.rate[i] * h;
    if (ph >= 1) ph -= Math.floor(ph);
    f.flap[i] = ph;
  }

  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    vx[i] = tvx[i];
    vy[i] = tvy[i];
    vz[i] = tvz[i];
    px[i] += tvx[i] * h;
    py[i] += tvy[i] * h;
    pz[i] += tvz[i] * h;
    sx += px[i];
    sy += py[i];
  }
  if (n > 0) {
    f.cx = sx / n;
    f.cy = sy / n;
  }
}
