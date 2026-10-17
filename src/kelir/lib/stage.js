// @ts-check
/**
 * Kelir's choreography: where each silhouette stands, how far it is from the screen, how its
 * arms and body move. Pure and frame-rate independent: lunges are analytic in the time since the
 * onset, smoothing is exponential in dt, slides are eased functions of elapsed time.
 *
 *   - Hits (onsetStrength > 0.25): bass-led -> puppet A lunges at the screen, mid-led -> B, both
 *     above 0.6; the kayon in cast 'kayon'. A lunge drops the distance d toward 0 (sharp black
 *     lace) over the attack, then drifts back with a 0.25 s time constant.
 *   - Melody brightness lifts the front hand, loud mids the back arm, the beat sways the bodies.
 *   - Stereo balance drifts the pair toward the louder side.
 *   - Scenes: every 8 bars (30 s without a tempo) the kayon sweeps across, turning flat, and the
 *     puppets swap sides at its halfway point.
 *   - Silence held 1.5 s: the puppets withdraw and the kayon stands at centre until a hit.
 * Distances: 0 = against the screen, 1 = far. Positions: fractions of the screen width.
 */
import { createMeter } from "./meter.js";
import { stereoImage } from "./stereo.js";

export const PUPPET_REST = 0.55;
export const KAYON_REST = 0.25;
/** Kayon distance at centre stage in silence (crisp). */
const KAYON_CENTRE = 0.1;
/** The kayon's lunge target. */
const KAYON_LUNGE = 0.05;
export const SILENCE_HOLD = 1.5;
/** The largest onsetAge believed on an onset frame (frames are ~11 ms apart). */
const MAX_ONSET_AGE = 0.1;
const DECAY = 0.25;
const WITHDRAW_S = 1;
const SWEEP_S = 3;
const CENTRE_S = 1.5;
const SWAP_S = 1;
const TURN_S = 0.4;
const OFF_LEFT = -0.2;
const OFF_RIGHT = 1.2;
const MIN_FLAT = 0.08;

const CAST_SOLO = 1;
const CAST_KAYON = 2;

const OFF = 0;
const SWEEP = 1;
const CENTRE = 2;
const EXIT = 3;

/**
 * Lunge envelope at `t` seconds after the onset: linear rise over `attack`, then exp decay.
 * @param {number} t @param {number} attack
 */
export function lungeEnvelope(t, attack) {
  if (!(t >= 0)) return 0;
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / DECAY);
}

/**
 * Look of a silhouette at distance d: penumbra half-width w (device px), size factor, opacity.
 * @param {number} d @param {number} blur param @param {number} pxScale screen height / 1440
 * @param {boolean} reiniger the paper-cut screen keeps edges crisper
 * @param {{ w: number, scale: number, opacity: number }} out
 */
export function penumbra(d, blur, pxScale, reiniger, out) {
  out.w = (1 + ((reiniger ? 12 : 40) - 1) * d) * blur * pxScale;
  out.scale = 1 + 0.6 * d;
  out.opacity = 0.96 + (0.55 - 0.96) * d;
  return out;
}

/** Exponential smoothing factor for a step of dt with time constant tau. @param {number} dt @param {number} tau */
const smooth = (dt, tau) => 1 - Math.exp(-dt / tau);
/** @param {number} t 0..1 */
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** @param {number} v */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** @param {number} v */
const finite = (v) => (Number.isFinite(v) ? v : 0);

function createSilhouette() {
  return { visible: false, x: 0.5, d: PUPPET_REST, opacity: 0, fx: 1, rot: 0, bob: 0, shF: 0, elF: 0, shB: 0, elB: 0 };
}

/** @typedef {ReturnType<typeof createSilhouette>} Silhouette */

/**
 * @typedef {object} StageParams
 * @property {number} cast @property {boolean} scenes @property {number} reactivity
 * @property {number} attack @property {number} lungeEff @property {number} swayEff
 * @property {boolean} spin
 */

export function createStage() {
  const meter = createMeter();
  const sil = [createSilhouette(), createSilhouette(), createSilhouette()];
  // Lunge starts (s, on the frame clock), adjusted so a retrigger continues from the current level.
  const lungeAt = [-1e9, -1e9, -1e9];
  let centroidS = 0;
  let midAttS = 1;
  let balanceS = 0;
  let beats = 0;
  let sceneClock = 0;
  let silentFor = 0;
  let withdraw = 0;
  // Puppet sides: slide from `from` to the current targets since `swapAt`.
  let swapAt = -1e9;
  const fromX = [0.3, 0.7];
  const facing = [1, -1];
  // Kayon.
  let mode = OFF;
  let kStart = 0;
  let kFrom = 0;
  let kTo = 0;
  let kDur = 1;
  let kRest = KAYON_REST;
  let sweepDir = 1;
  let swapDone = true;
  let exitSide = 1;

  const stage = {
    sil,
    /** Smoothed stereo balance, +1 = left louder. */
    balance: 0,
    withdrawn: false,
    swapped: false,

    /**
     * @param {import('../../../tidalviz').AudioFrame} audio
     * @param {number} now time.now @param {number} dt time.dt
     * @param {StageParams} p resolved params
     */
    step(audio, now, dt, p) {
      const prevBeats = beats;
      beats = meter.step(finite(audio.bpm), finite(audio.beatPhase), dt);
      centroidS += (clamp01(finite(audio.centroid)) - centroidS) * smooth(dt, 0.25);
      midAttS += (finite(audio.midAtt) - midAttS) * smooth(dt, 0.3);
      const st = stereoImage(audio.left, audio.right);
      balanceS += (st.balance - balanceS) * smooth(dt, 1);
      if (Math.abs(balanceS) < 1e-12) balanceS = 0;
      stage.balance = balanceS;

      const kayonCast = p.cast === CAST_KAYON;
      const solo = p.cast === CAST_SOLO;

      // Silence: withdraw after SILENCE_HOLD s; the first onset afterwards brings everyone back.
      silentFor = audio.silent ? silentFor + dt : 0;
      if (!stage.withdrawn && silentFor >= SILENCE_HOLD - 1e-9) stage.withdrawn = true;
      else if (stage.withdrawn && audio.onset) {
        stage.withdrawn = false;
        silentFor = 0;
      }
      withdraw = clamp01(withdraw + ((stage.withdrawn ? 1 : -1) * dt) / WITHDRAW_S);

      // Hits.
      if (audio.onset && audio.onsetStrength > 0.25) {
        // onsetAge is ~ms on the onset's frame; a larger one (a source that never sets it) means now.
        const age = finite(audio.onsetAge);
        const t0 = now - (age > 0 && age <= MAX_ONSET_AGE ? age : 0);
        if (kayonCast) trigger(2, t0, p.attack);
        else if (solo) trigger(0, t0, p.attack);
        else if (audio.onsetStrength > 0.6) {
          trigger(0, t0, p.attack);
          trigger(1, t0, p.attack);
        } else trigger(audio.bassAtt >= audio.midAtt ? 0 : 1, t0, p.attack);
      }

      // Scenes: every 32 beats, or every 30 s while the tempo is unknown.
      const before = Math.floor(sceneClock);
      sceneClock += audio.bpm > 0 ? Math.max(0, beats - prevBeats) / 32 : dt / 30;
      const due = Math.floor(sceneClock) > before;
      if (due && p.scenes && !kayonCast && !stage.withdrawn && mode === OFF) {
        mode = SWEEP;
        kStart = now;
        kFrom = sweepDir > 0 ? OFF_LEFT : OFF_RIGHT;
        kTo = sweepDir > 0 ? OFF_RIGHT : OFF_LEFT;
        kDur = SWEEP_S;
        sweepDir = -sweepDir;
        swapDone = false;
      }

      // Kayon placement.
      const wantCentre = kayonCast || stage.withdrawn;
      const kx = kayonX(now);
      if (wantCentre && mode !== CENTRE) {
        const from = mode === OFF ? (exitSide > 0 ? OFF_RIGHT : OFF_LEFT) : kx;
        slide(CENTRE, now, from, 0.5, CENTRE_S);
      } else if (!wantCentre && mode === CENTRE) {
        const side = kx > 0.5 + 1e-6 ? 1 : kx < 0.5 - 1e-6 ? -1 : (exitSide = -exitSide);
        slide(EXIT, now, kx, side > 0 ? OFF_RIGHT : OFF_LEFT, CENTRE_S);
      }
      const kp = (now - kStart) / kDur;
      if (mode === SWEEP && !swapDone && kp >= 0.5) {
        swapDone = true;
        swapSides(now, solo);
      }
      if ((mode === SWEEP || mode === EXIT) && kp >= 1) mode = OFF;
      kRest += ((mode === CENTRE && !(kayonCast && !stage.withdrawn) ? KAYON_CENTRE : KAYON_REST) - kRest) * smooth(dt, 0.4);

      // Body motion shared by the cast.
      const sway = 0.04 * p.swayEff * Math.sin(Math.PI * beats);
      const bob = -0.008 * Math.exp(-6 * (beats - Math.floor(beats)));
      const shF = -0.3 + 1.6 * clamp01(centroidS * 3);
      const lift = 0.5 * Math.sin(Math.PI * beats) * clamp01(midAttS - 0.5) * p.reactivity;
      const shB = 0.2 + 0.6 * clamp01(midAttS - 1);

      // Puppets.
      const swapT = ease((now - swapAt) / SWAP_S);
      const turn = dt / TURN_S;
      for (let i = 0; i < 2; i++) {
        const s = sil[i];
        const base = solo ? 0.5 : stage.swapped === (i === 0) ? 0.7 : 0.3;
        s.x = fromX[i] + (base - fromX[i]) * swapT - 0.08 * balanceS;
        const want = (i === 0) !== stage.swapped ? 1 : -1;
        facing[i] = want > facing[i] ? Math.min(want, facing[i] + 2 * turn) : Math.max(want, facing[i] - 2 * turn);
        s.fx = Math.sign(facing[i] || want) * Math.max(MIN_FLAT, Math.abs(facing[i]));
        const rest = PUPPET_REST + (1 - PUPPET_REST) * withdraw;
        const L = lungeEnvelope(now - lungeAt[i], p.attack);
        s.d = Math.max(0, rest * (1 - L * p.lungeEff));
        s.opacity = (0.96 + (0.55 - 0.96) * s.d) * (1 - withdraw);
        s.visible = !kayonCast && !(solo && i === 1) && s.opacity > 0.002;
        s.rot = sway;
        s.bob = bob;
        s.shF = shF;
        s.elF = 0.4 + (i === 0 ? lift : -lift);
        s.shB = shB;
        s.elB = 0.3;
      }

      // Kayon.
      const kk = sil[2];
      kk.visible = mode !== OFF;
      kk.x = kayonX(now);
      const L = lungeEnvelope(now - lungeAt[2], p.attack);
      kk.d = Math.max(0, kRest - (kRest - KAYON_LUNGE) * L * p.lungeEff);
      kk.opacity = 0.96 + (0.55 - 0.96) * kk.d;
      const upright = mode === CENTRE && stage.withdrawn;
      kk.rot = upright ? 0 : sway;
      kk.fx = mode === SWEEP && p.spin ? Math.max(MIN_FLAT, Math.abs(Math.cos(3 * Math.PI * clamp01(kp)))) : 1;
      kk.bob = 0;
      return stage;
    },
  };

  /** @param {number} i @param {number} t0 @param {number} attack */
  function trigger(i, t0, attack) {
    const current = lungeEnvelope(t0 - lungeAt[i], attack);
    lungeAt[i] = t0 - current * attack;
  }

  /** @param {number} m @param {number} now @param {number} from @param {number} to @param {number} dur */
  function slide(m, now, from, to, dur) {
    mode = m;
    kStart = now;
    kFrom = from;
    kTo = to;
    kDur = dur;
  }

  /** @param {number} now */
  function kayonX(now) {
    const t = clamp01((now - kStart) / kDur);
    return kFrom + (kTo - kFrom) * (mode === SWEEP ? t : ease(t));
  }

  /** @param {number} now @param {boolean} solo */
  function swapSides(now, solo) {
    for (let i = 0; i < 2; i++) {
      const base = solo ? 0.5 : stage.swapped === (i === 0) ? 0.7 : 0.3;
      const t = ease((now - swapAt) / SWAP_S);
      fromX[i] = fromX[i] + (base - fromX[i]) * t;
    }
    stage.swapped = !stage.swapped;
    swapAt = now;
  }

  return stage;
}
