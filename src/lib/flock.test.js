// @ts-check
import { describe, expect, it } from "vitest";
import { createFixedStep } from "./fixedstep.js";
import {
  buildGrid,
  createControls,
  createFlock,
  findNeighbors,
  MAX_BIRDS,
  mulberry32,
  PERCEPTION,
  resizeFlock,
  seedFlock,
  setCount,
  STEP,
  stepFlock,
  TOPO_K,
  Z_HALF,
} from "./flock.js";

const HX = 5.13;
const HY = 2.887;

/** @param {number} n */
function makeFlock(n) {
  const f = createFlock();
  resizeFlock(f, HX, HY);
  seedFlock(f, n, 1234);
  const c = createControls();
  return { f, c };
}

describe("flock", () => {
  it("preallocates arrays for 6000 birds", () => {
    const f = createFlock();
    expect(MAX_BIRDS).toBe(6000);
    for (const a of [f.px, f.py, f.pz, f.vx, f.vy, f.vz, f.ppx, f.ppy, f.ppz, f.flap, f.roll]) {
      expect(a).toBeInstanceOf(Float32Array);
      expect(a.length).toBe(6000);
    }
  });

  it("seeds deterministically from a fixed-seed PRNG", () => {
    const a = makeFlock(300).f;
    const b = makeFlock(300).f;
    expect(Array.from(a.px.slice(0, 300))).toEqual(Array.from(b.px.slice(0, 300)));
    const r = mulberry32(1);
    const v = r();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
    expect(mulberry32(1)()).toBe(v);
  });

  it("keeps 500 birds inside the bounds with speeds within the clamp for 600 steps", () => {
    const { f, c } = makeFlock(500);
    c.cruise = 0.9;
    let maxSpeed = 0;
    let minSpeed = Infinity;
    let maxX = 0;
    let maxY = 0;
    let maxZ = 0;
    for (let s = 0; s < 600; s++) {
      // A wandering attractor that pushes toward the edges.
      c.ax = Math.sin(s * 0.02) * HX * 0.62;
      c.ay = Math.cos(s * 0.013) * HY * 0.5;
      stepFlock(f, c);
      for (let i = 0; i < f.n; i++) {
        maxX = Math.max(maxX, Math.abs(f.px[i]));
        maxY = Math.max(maxY, Math.abs(f.py[i]));
        maxZ = Math.max(maxZ, Math.abs(f.pz[i]));
        const sp = Math.hypot(f.vx[i], f.vy[i], f.vz[i]);
        maxSpeed = Math.max(maxSpeed, sp);
        minSpeed = Math.min(minSpeed, sp);
      }
    }
    expect(maxX).toBeLessThan(HX);
    expect(maxY).toBeLessThan(HY);
    expect(maxZ).toBeLessThan(Z_HALF);
    expect(maxSpeed).toBeLessThanOrEqual(1.6 * 0.9 * 1.0001);
    expect(minSpeed).toBeGreaterThanOrEqual(0.5 * 0.9 * 0.9999);
  });

  it("reaches the same state after 1 s fed as 60 Hz and as 120 Hz display frames", () => {
    /** @param {number} hz */
    const run = (hz) => {
      const { f, c } = makeFlock(400);
      const fs = createFixedStep(STEP, 2);
      for (let i = 0; i < hz; i++) {
        const steps = fs.advance(1 / hz);
        for (let s = 0; s < steps; s++) stepFlock(f, c);
      }
      return f;
    };
    const a = run(60);
    const b = run(120);
    expect(Array.from(b.px.slice(0, 400))).toEqual(Array.from(a.px.slice(0, 400)));
    expect(Array.from(b.vy.slice(0, 400))).toEqual(Array.from(a.vy.slice(0, 400)));
  });

  it("finds the same 7 nearest neighbours through the grid as by brute force", () => {
    const { f, c } = makeFlock(200);
    for (let s = 0; s < 30; s++) stepFlock(f, c); // a realistic, clumpy configuration
    buildGrid(f); // findNeighbors reads the grid of the current positions
    expect(PERCEPTION).toBe(0.12);
    let checked = 0;
    for (let i = 0; i < f.n; i++) {
      const k = findNeighbors(f, i);
      const got = Array.from(f.nbIdx.slice(0, k)).sort((x, y) => x - y);
      const all = [];
      for (let j = 0; j < f.n; j++) {
        if (j === i) continue;
        const d2 = (f.px[j] - f.px[i]) ** 2 + (f.py[j] - f.py[i]) ** 2 + (f.pz[j] - f.pz[i]) ** 2;
        if (d2 < PERCEPTION * PERCEPTION) all.push([d2, j]);
      }
      all.sort((x, y) => x[0] - y[0]);
      const want = all.slice(0, TOPO_K).map((x) => x[1]).sort((x, y) => x - y);
      expect(got).toEqual(want);
      checked += k;
    }
    expect(checked).toBeGreaterThan(200); // the test saw real neighbourhoods
  });

  it("step returns nothing and reuses its arrays", () => {
    const { f, c } = makeFlock(100);
    const arrays = [f.px, f.vx, f.ppx, f.flap, f.roll, f.cellStart, f.order, f.sx, f.nbIdx, f.nbD2];
    expect(stepFlock(f, c)).toBeUndefined();
    const after = [f.px, f.vx, f.ppx, f.flap, f.roll, f.cellStart, f.order, f.sx, f.nbIdx, f.nbD2];
    for (let i = 0; i < arrays.length; i++) expect(after[i]).toBe(arrays[i]);
  });

  it("keeps the previous positions for interpolation", () => {
    const { f, c } = makeFlock(50);
    const x0 = f.px[3];
    stepFlock(f, c);
    expect(f.ppx[3]).toBe(x0);
    expect(f.px[3]).not.toBe(x0);
  });

  it("holds the flock around the attractor, tighter when squeezed", () => {
    /** @param {number} radius */
    const spread = (radius) => {
      const { f, c } = makeFlock(800);
      c.ax = 1;
      c.ay = 0.5;
      c.radius = radius;
      let mx = 0;
      let my = 0;
      let mean = 0;
      for (let s = 0; s < 900; s++) {
        stepFlock(f, c);
        if (s < 300) continue;
        mx += f.cx / 600;
        my += f.cy / 600;
        let sum = 0;
        for (let i = 0; i < f.n; i++) sum += Math.hypot(f.px[i] - f.cx, f.py[i] - f.cy);
        mean += sum / f.n / 600;
      }
      return { mean, cx: mx, cy: my };
    };
    const loose = spread(0.85);
    const tight = spread(0.85 * 0.65);
    expect(Math.hypot(loose.cx - 1, loose.cy - 0.5)).toBeLessThan(0.3);
    expect(loose.mean).toBeLessThan(0.85);
    expect(tight.mean).toBeLessThan(loose.mean * 0.85);
  });

  it("forms a ring for the doughnut shape", () => {
    const { f, c } = makeFlock(800);
    Object.assign(c, { radius: 0.85, len: 0, bend: 0, ring: 1, ringMix: 1, tubeHead: 0.3, tubeTail: 0.3 });
    for (let s = 0; s < 600; s++) stepFlock(f, c);
    let inner = 0;
    for (let i = 0; i < f.n; i++) if (Math.hypot(f.px[i] - c.ax, f.py[i] - c.ay) < 0.3) inner++;
    expect(inner).toBeLessThan(f.n * 0.1); // the hole stays mostly clear (a few birds cut across)
  });

  it("birds burst away from the falcon", () => {
    const { f, c } = makeFlock(800);
    for (let s = 0; s < 240; s++) stepFlock(f, c);
    c.falcon = true;
    c.fx = f.cx;
    c.fy = f.cy;
    c.flee = 1;
    /** @param {typeof f} fl */
    const nearCount = (fl) => {
      let n = 0;
      for (let i = 0; i < fl.n; i++) if (Math.hypot(fl.px[i] - c.fx, fl.py[i] - c.fy) < 0.12) n++;
      return n;
    };
    const before = nearCount(f);
    for (let s = 0; s < 20; s++) stepFlock(f, c);
    expect(before).toBeGreaterThan(10);
    expect(nearCount(f)).toBeLessThan(before * 0.5);
  });

  it("kicks each bird sideways once as a wave shell passes", () => {
    const { f, c } = makeFlock(300);
    for (let s = 0; s < 120; s++) stepFlock(f, c);
    c.wave0 = true;
    c.wave0x = f.cx;
    c.wave0y = f.cy;
    c.wave0id = 1;
    c.wave0kick = 0.15;
    let kicked = 0;
    for (let s = 0; s < 60; s++) {
      c.wave0r = 1.6 * s * STEP;
      stepFlock(f, c);
    }
    for (let i = 0; i < f.n; i++) if (f.kick0[i] === 1) kicked++;
    expect(kicked).toBeGreaterThan(f.n * 0.9);
  });

  it("grows and shrinks the active count without reallocating", () => {
    const { f } = makeFlock(2000);
    const px = f.px;
    setCount(f, 6000);
    expect(f.n).toBe(6000);
    expect(Number.isFinite(f.px[5999])).toBe(true);
    expect(Math.abs(f.px[5999])).toBeLessThan(HX);
    setCount(f, 2000);
    expect(f.n).toBe(2000);
    expect(f.px).toBe(px);
  });
});
