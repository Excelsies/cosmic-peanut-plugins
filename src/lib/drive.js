// @ts-check
/**
 * Murmuration's audio mapping: one frame of audio → the flock's controls (flock.js) and the
 * renderer's per-frame values. Called once per display frame before the fixed simulation steps.
 *
 *   bass/bassAtt → squeeze from the larger of the two (attack 40 ms, release 300 ms, flash-limited):
 *                  a tighter flock radius and a darker, slightly contracted silhouette
 *   midAtt       → alignment and cruise speed (smoothed 0.2 s)
 *   centroid     → altitude (smoothed 2 s)
 *   bpm/phase    → the attractor's sweep through meter.js (free clock at bpm 0)
 *   onset        → a falcon strike (strong onsets, ≥ 1.2 s apart) or a weaker agitation wave
 *   trebAtt/flux → flap rate and a render-only shimmer
 *   left/right   → sideways bias (stereo balance)
 *   rms          → gates the drive; silent → a wide, calm glide
 *
 * Allocates nothing after creation.
 */
import { altitude, attractor, shape, SHAPE_LEN } from "./attractor.js";
import { createFlashLimiter } from "./flash.js";
import { createMeter } from "./meter.js";
import { stereoBalance } from "./stereo.js";
import { createSqueeze, createStriker, FALCON_DURATION, falconPosition, hash01, STRIKE, strikeGeometry, WEAK } from "./strike.js";
import { createWaves, onsetTime } from "./wave.js";

/** Flock radius (world units). */
const R0 = 1.0;
/** Chase speed of the pulled-toward point, × cruise. */
const CHASE = 1.1;
const COHESION = 0.3;
const STRIKE_KICK = 0.15;
const WEAK_STRENGTH = 0.5;
/** New weak bands allowed per second with reduceFlashing (strikes add at most one more). */
const WEAK_PER_SECOND = 2;
/** Seconds over which a wave's darkening fades (it has crossed the flock by then). */
const WAVE_FADE = 2.5;

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** One-pole smoothing factor for time constant `tau`. @param {number} dt @param {number} tau */
function follow(dt, tau) {
  return dt > 0 ? 1 - Math.exp(-dt / tau) : 0;
}

export function createDrive() {
  const meter = createMeter();
  const squeezeEnv = createSqueeze();
  const striker = createStriker();
  const waves = createWaves();
  const wave0Flash = createFlashLimiter(3);
  const wave1Flash = createFlashLimiter(WEAK_PER_SECOND);
  const A = new Float64Array(2);
  const G = new Float64Array(4); // strike geometry
  const F = new Float64Array(2); // falcon position
  const F2 = new Float64Array(2);
  let midAttS = 1;
  let centroidS = 0.25;
  let balanceS = 0;
  let silentS = 0;
  let shimmerS = 0;
  let falconT0 = -Infinity;
  let falconStrength = 0;
  let weakCount = 0;
  let qx = 0;
  let qy = 0;
  let started = false;
  let axX = 1;
  let axY = 0;
  const SH = new Float64Array(SHAPE_LEN);
  let flow = 0;
  let wave = 0;

  const out = {
    /** Flash-limited squeeze, 0–1. */
    squeeze: 0,
    /** Flash-limited darkening of each wave slot, 0–1. */
    wave0Amp: 0,
    wave1Amp: 0,
    falconVisible: false,
    falconX: 0,
    falconY: 0,
    falconDirX: 1,
    falconDirY: 0,
    /** Render-only jitter, 0–1. */
    shimmer: 0,
    /** Smoothed stereo balance, −1..1. */
    balance: 0,
    /** Beats elapsed. */
    phi: 0,
  };

  return {
    out,
    waves,
    /**
     * @param {import('../../tidalviz').AudioFrame} audio
     * @param {number} now time.now
     * @param {number} dt time.dt
     * @param {import('./murmuration-params.js').ParamState} p resolved params
     * @param {boolean} reduceFlashing ctx.reduceFlashing
     * @param {import('./flock.js').Flock} flock
     * @param {import('./flock.js').Controls} c written
     * @param {number} hx @param {number} hy frustum half-extents at z = 0
     */
    step(audio, now, dt, p, reduceFlashing, flock, c, hx, hy) {
      const silent = audio.silent === true;
      const rms = audio.rms > 0 ? audio.rms : 0;
      const gate = silent ? 0 : clamp((rms - 0.002) / 0.013, 0, 1);
      const react = p.reactivity;

      silentS += ((silent ? 1 : 0) - silentS) * follow(dt, 1.5);
      midAttS += (clamp(audio.midAtt || 0, 0, 2) - midAttS) * follow(dt, 0.2);
      centroidS += (clamp(audio.centroid || 0, 0, 1) - centroidS) * follow(dt, 2);
      balanceS += (stereoBalance(audio.left, audio.right) - balanceS) * follow(dt, 0.8);
      if (Math.abs(balanceS) < 1e-6) balanceS = 0;
      out.balance = balanceS;

      // Attractor sweep on the musical clock.
      out.phi = meter.step(audio.bpm || 0, audio.beatPhase || 0, dt);
      attractor(out.phi, hx, hy, p.attractorAmp, balanceS, altitude(centroidS, hy), A);
      // The flock chases a point that follows A no faster than the birds can fly; pulling every
      // bird straight at a far-off A would focus the whole flock into a clump.
      const maxChase = CHASE * c.cruise * dt;
      if (!started) {
        qx = A[0];
        qy = A[1];
        started = true;
      } else {
        const dx = A[0] - qx;
        const dy = A[1] - qy;
        const d = Math.hypot(dx, dy);
        const k = d > maxChase ? maxChase / d : 1;
        qx += dx * k;
        qy += dy * k;
      }
      // Shape program: stretch along the direction the chase point travels (smoothed).
      const mx = qx - c.ax;
      const my = qy - c.ay;
      const ml = Math.hypot(mx, my);
      if (ml > 1e-6 && dt > 0) {
        const k = follow(dt, 0.6);
        axX += (mx / ml - axX) * k;
        axY += (my / ml - axY) * k;
      }
      const al = Math.hypot(axX, axY) || 1;
      c.axisX = axX / al;
      c.axisY = axY / al;
      shape(out.phi, SH);
      c.len = SH[0];
      c.bend = SH[1];
      c.ring = SH[2];
      c.ringMix = SH[3];
      c.tubeHead = SH[4];
      c.tubeTail = SH[5];
      // Birds stream around a ring at about cruise speed; a ribbon slithers slowly.
      if (dt > 0) {
        flow += (dt * c.cruise * 0.8) / (6.283 * Math.max(0.2, c.ring * c.radius));
        if (flow > 1) flow -= 1;
        wave += dt * 0.7;
        if (wave > 6.283185307179586) wave -= 6.283185307179586;
      }
      c.flow = flow;
      c.wavePhase = wave;
      c.ax = qx;
      c.ay = qy;

      // Squeeze.
      // bassAtt alone barely moves on a kick (it's the smoothed level); the instantaneous bass does.
      const bass = Math.max(audio.bassAtt || 0, audio.bass || 0);
      out.squeeze = squeezeEnv.step(bass, react * gate, dt, reduceFlashing);
      c.radius = R0 * (1 + 0.4 * silentS) * (1 - 0.35 * out.squeeze);
      c.cruise = 0.9 * (0.8 + 0.2 * midAttS) * p.speed * (1 - 0.45 * silentS);
      c.align = 1.2 * (0.6 + 0.4 * midAttS);
      c.cohesion = COHESION * (1 - 0.5 * silentS);
      c.flapRate = 8 * (1 + 0.5 * clamp((audio.trebAtt || 0) - 1, 0, 2));
      shimmerS += (clamp((audio.flux || 0) * 2, 0, 1) * gate * react - shimmerS) * follow(dt, 0.1);
      if (shimmerS < 1e-4) shimmerS = 0;
      out.shimmer = shimmerS;

      // Onsets: strikes and weak waves.
      const ev = silent ? 0 : striker.step(audio.onset === true, audio.onsetStrength || 0, now, p.falcon);
      if (ev === STRIKE) {
        const t0 = onsetTime(now, audio.onsetAge);
        strikeGeometry(striker.count, flock.cx, flock.cy, hx, hy, G);
        waves.start(0, G[0], G[1], t0, 1);
        falconT0 = t0;
        falconStrength = clamp(audio.onsetStrength, 0, 1);
      } else if (ev === WEAK) {
        weakCount++;
        const t0 = onsetTime(now, audio.onsetAge);
        const ox = flock.cx + (hash01(weakCount, 11) * 2 - 1) * 0.3;
        const oy = flock.cy + (hash01(weakCount, 12) * 2 - 1) * 0.3;
        waves.start(1, ox, oy, t0, WEAK_STRENGTH);
      }
      waves.update(now, 2 * Math.hypot(hx, hy));

      const s0 = waves.slots[0];
      const s1 = waves.slots[1];
      c.shell = 0.12;
      c.wave0 = s0.active;
      c.wave0x = s0.ox;
      c.wave0y = s0.oy;
      c.wave0r = s0.radius;
      c.wave0id = s0.id;
      c.wave0kick = STRIKE_KICK;
      c.wave1 = s1.active;
      c.wave1x = s1.ox;
      c.wave1y = s1.oy;
      c.wave1r = s1.radius;
      c.wave1id = s1.id;
      c.wave1kick = STRIKE_KICK * WEAK_STRENGTH;

      // Darkening: each wave fades as it ages, through its own flash limiter. Restarting a slot
      // replaces its shell: with reduceFlashing that counts as a fall to 0 and a rise on the next
      // frame, for that slot only. Strikes are ≥ 1.2 s apart and weak bands ≤ 2 per second, so
      // both together start at most 3 new bands in any second.
      let a0 = s0.active ? s0.amp * Math.exp(-(now - s0.t0) / WAVE_FADE) * react : 0;
      let a1 = s1.active ? s1.amp * Math.exp(-(now - s1.t0) / WAVE_FADE) * react : 0;
      if (reduceFlashing && ev === STRIKE) a0 = 0;
      if (reduceFlashing && ev === WEAK) a1 = 0;
      out.wave0Amp = wave0Flash.step(a0 > 1 ? 1 : a0, dt, reduceFlashing);
      out.wave1Amp = wave1Flash.step(a1 > 1 ? 1 : a1, dt, reduceFlashing);

      // Falcon.
      const tF = now - falconT0;
      out.falconVisible = p.flee && tF >= 0 && tF <= FALCON_DURATION;
      c.falcon = out.falconVisible;
      if (out.falconVisible) {
        falconPosition(tF, G, F);
        falconPosition(tF + 0.01, G, F2);
        out.falconX = F[0];
        out.falconY = F[1];
        const dx = F2[0] - F[0];
        const dy = F2[1] - F[1];
        const len = Math.hypot(dx, dy) || 1;
        out.falconDirX = dx / len;
        out.falconDirY = dy / len;
        c.fx = F[0];
        c.fy = F[1];
        c.flee = falconStrength * clamp(react, 0, 1.5);
      } else {
        c.flee = 0;
      }
    },
  };
}
