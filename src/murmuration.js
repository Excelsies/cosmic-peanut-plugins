// @ts-check
/**
 * Murmuration — a flock of starlings over a dusk sky for the `three` renderer.
 *
 * The flock (src/lib/flock.js) is a CPU boids simulation in fixed 1/60 s steps: each bird follows
 * its 7 nearest neighbours, a spring pulls the flock toward an attractor that sweeps the sky on a
 * 4-bar cycle (attractor.js, beatclock.js), and the music drives it through drive.js: kicks squeeze
 * it dark and dense, strong onsets send a falcon diving through, leaving a hole and an agitation
 * wave of birds rolled to show their full wings.
 *
 * Rendering: one instanced chevron per bird (4 vertices, 6 indices) from an interleaved
 * Float32Array(6000 × 8) uploaded whole each frame (no addUpdateRange: it allocates); positions
 * are interpolated between simulation steps so 120 Hz displays stay smooth. The sky is a
 * full-screen quad behind everything, hidden for sky "none" (transparent canvas, ink birds).
 * Renderer state is left alone; autoRender stays on. frame() allocates nothing.
 */
import * as THREE from "three";
import { createDrive } from "./lib/drive.js";
import { createFixedStep } from "./lib/fixedstep.js";
import { BIRD_SIZE, createControls, createFlock, MAX_BIRDS, resizeFlock, seedFlock, setCount, STEP, stepFlock } from "./lib/flock.js";
import { BIRD_COLORS, createParamState, resolveParams, SKY_NONE, SKY_STOPS } from "./lib/murmuration-params.js";

const STRIDE = 8; // x, y, z, dirX, dirY, dirZ, roll, flapPhase
const SEED = 0x5eed;
const REED = [0x1c / 255, 0x1a / 255, 0x22 / 255];

/** Chevron: tip, notch, two wing tips (position.z = vertex kind, see bird.vert). */
const BIRD_VERTS = new Float32Array([0.5, 0, 0, -0.18, 0, 1, -0.5, 0.5, 2, -0.5, -0.5, 2]);
const BIRD_INDEX = [0, 2, 1, 0, 1, 3];
/** Falcon crescent: head, swept wings, tail; drawn solid (kind 3). */
const FALCON_VERTS = new Float32Array([
  0.55, 0, 3, 0.1, 0.13, 3, -0.42, 0.62, 3, -0.08, 0.12, 3, -0.45, 0, 3, 0.1, -0.13, 3, -0.42, -0.62, 3, -0.08, -0.12, 3,
]);
const FALCON_INDEX = [0, 1, 3, 1, 2, 3, 0, 3, 4, 0, 4, 7, 0, 7, 5, 5, 7, 6];

/** @type {import('../tidalviz').CreateVisualizer} */
export default async function create(ctx) {
  const three = /** @type {import('../tidalviz').ThreeHandles} */ (ctx.three);
  const { scene } = three;

  const dir = "shaders/murmuration/";
  const [skyGlsl, skyVert, skyFrag, birdVert, birdFrag] = await Promise.all(
    ["sky.glsl", "sky.vert", "sky.frag", "bird.vert", "bird.frag"].map((f) => ctx.assets.text(dir + f)),
  );

  // --- State ---------------------------------------------------------------------------------
  const p = createParamState();
  let lastQuality = "";
  let lastReduceMotion = false;
  const flock = createFlock(MAX_BIRDS);
  const controls = createControls();
  const drive = createDrive();
  const stepper = createFixedStep(STEP, 2);
  let hx = 1;
  let hy = 1;
  let drift = 0;

  // --- Sky -----------------------------------------------------------------------------------
  const skyUniforms = {
    uSky0: { value: new THREE.Vector3() },
    uSky1: { value: new THREE.Vector3() },
    uSky2: { value: new THREE.Vector3() },
    uSky3: { value: new THREE.Vector3() },
    uRes: { value: new THREE.Vector2(1, 1) },
    uDrift: { value: 0 },
    uReed: { value: new THREE.Vector3(REED[0], REED[1], REED[2]) },
  };
  const skyGeo = new THREE.PlaneGeometry(2, 2);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: skyVert,
    fragmentShader: skyGlsl + "\n" + skyFrag,
    depthTest: false,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  // --- Birds ---------------------------------------------------------------------------------
  const data = new Float32Array(MAX_BIRDS * STRIDE);
  const ibuf = new THREE.InstancedInterleavedBuffer(data, STRIDE, 1);
  ibuf.setUsage(THREE.DynamicDrawUsage);
  const birdGeo = new THREE.InstancedBufferGeometry();
  birdGeo.setAttribute("position", new THREE.BufferAttribute(BIRD_VERTS, 3));
  birdGeo.setIndex(BIRD_INDEX);
  birdGeo.setAttribute("iPos", new THREE.InterleavedBufferAttribute(ibuf, 3, 0));
  birdGeo.setAttribute("iDir", new THREE.InterleavedBufferAttribute(ibuf, 3, 3));
  birdGeo.setAttribute("iRoll", new THREE.InterleavedBufferAttribute(ibuf, 1, 6));
  birdGeo.setAttribute("iFlap", new THREE.InterleavedBufferAttribute(ibuf, 1, 7));

  /** @param {number} scale */
  const birdUniforms = (scale) => ({
    uSky0: skyUniforms.uSky0,
    uSky1: skyUniforms.uSky1,
    uSky2: skyUniforms.uSky2,
    uSky3: skyUniforms.uSky3,
    uSize: { value: BIRD_SIZE },
    uScale: { value: scale },
    uPxPerUnit: { value: 1 },
    uMinPx: { value: 1.5 },
    uCentre: { value: new THREE.Vector2() },
    uSqueeze: { value: 0 },
    uWave0: { value: new THREE.Vector4() },
    uWave1: { value: new THREE.Vector4() },
    uShell: { value: 0.12 },
    uTime: { value: 0 },
    uShimmer: { value: 0 },
    uAlpha: { value: 0.85 },
    uInk: { value: new THREE.Vector3() },
    uDepthMix: { value: 0.25 },
  });
  /** @param {ReturnType<typeof birdUniforms>} uniforms */
  const birdMaterial = (uniforms) =>
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: skyGlsl + "\n" + birdVert,
      fragmentShader: birdFrag,
      transparent: true,
      premultipliedAlpha: true,
      blending: THREE.NormalBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  const bu = birdUniforms(1);
  const birdMat = birdMaterial(bu);
  const birds = new THREE.Mesh(birdGeo, birdMat);
  birds.frustumCulled = false;
  scene.add(birds);

  // --- Falcon: one instance of a crescent, same material family ------------------------------
  const fdata = new Float32Array(STRIDE);
  const fbuf = new THREE.InstancedInterleavedBuffer(fdata, STRIDE, 1);
  fbuf.setUsage(THREE.DynamicDrawUsage);
  const falconGeo = new THREE.InstancedBufferGeometry();
  falconGeo.setAttribute("position", new THREE.BufferAttribute(FALCON_VERTS, 3));
  falconGeo.setIndex(FALCON_INDEX);
  falconGeo.setAttribute("iPos", new THREE.InterleavedBufferAttribute(fbuf, 3, 0));
  falconGeo.setAttribute("iDir", new THREE.InterleavedBufferAttribute(fbuf, 3, 3));
  falconGeo.setAttribute("iRoll", new THREE.InterleavedBufferAttribute(fbuf, 1, 6));
  falconGeo.setAttribute("iFlap", new THREE.InterleavedBufferAttribute(fbuf, 1, 7));
  falconGeo.instanceCount = 1;
  const fu = birdUniforms(3);
  fu.uCentre = bu.uCentre;
  fu.uInk = bu.uInk;
  fu.uDepthMix.value = 0;
  fu.uAlpha.value = 1;
  const falconMat = birdMaterial(fu);
  const falcon = new THREE.Mesh(falconGeo, falconMat);
  falcon.frustumCulled = false;
  falcon.renderOrder = 1;
  falcon.visible = false;
  scene.add(falcon);

  // --- Params, size --------------------------------------------------------------------------
  function applyParams() {
    lastQuality = ctx.quality;
    lastReduceMotion = ctx.reduceMotion;
    const before = p.flock;
    resolveParams(ctx.params, ctx.quality, ctx.reduceMotion, p);
    if (flock.n === 0) seedFlock(flock, p.flock, SEED);
    else if (p.flock !== before || flock.n !== p.flock) setCount(flock, p.flock);
    birdGeo.instanceCount = flock.n;

    const s = p.sky * 12;
    skyUniforms.uSky0.value.set(SKY_STOPS[s], SKY_STOPS[s + 1], SKY_STOPS[s + 2]);
    skyUniforms.uSky1.value.set(SKY_STOPS[s + 3], SKY_STOPS[s + 4], SKY_STOPS[s + 5]);
    skyUniforms.uSky2.value.set(SKY_STOPS[s + 6], SKY_STOPS[s + 7], SKY_STOPS[s + 8]);
    skyUniforms.uSky3.value.set(SKY_STOPS[s + 9], SKY_STOPS[s + 10], SKY_STOPS[s + 11]);
    const none = p.sky === SKY_NONE;
    sky.visible = !none;
    const c = p.sky * 3;
    if (none) bu.uInk.value.set(p.ink[0], p.ink[1], p.ink[2]);
    else bu.uInk.value.set(BIRD_COLORS[c], BIRD_COLORS[c + 1], BIRD_COLORS[c + 2]);
    bu.uDepthMix.value = none ? 0 : 0.25;
  }

  function resize() {
    const { width, height, cssHeight } = ctx.size;
    hy = 5 * Math.tan(Math.PI / 6);
    hx = (hy * width) / height;
    resizeFlock(flock, hx, hy);
    skyUniforms.uRes.value.set(width, height);
    // Camera: the SDK's default PerspectiveCamera (fov 60, z = 5) is kept; projection[1][1] = 1/tan(30°).
    const pxPerUnit = height / 2 / Math.tan(Math.PI / 6);
    const minPx = 1.5 * (cssHeight > 0 ? height / cssHeight : 1);
    bu.uPxPerUnit.value = pxPerUnit;
    fu.uPxPerUnit.value = pxPerUnit;
    bu.uMinPx.value = minPx;
    fu.uMinPx.value = minPx;
  }

  applyParams();
  resize();

  return {
    frame(audio, time) {
      if (ctx.quality !== lastQuality || ctx.reduceMotion !== lastReduceMotion) applyParams();
      const dt = time.dt;
      drive.step(audio, time.now, dt, p, ctx.reduceFlashing, flock, controls, hx, hy);
      const steps = stepper.advance(dt);
      for (let s = 0; s < steps; s++) stepFlock(flock, controls);

      // Interpolated instance data.
      const a = stepper.alpha;
      const b = 1 - a;
      const n = flock.n;
      const { px, py, pz, ppx, ppy, ppz, vx, vy, vz, roll, flap, rate } = flock;
      const back = (1 - a) * controls.flapRate * STEP;
      for (let i = 0, o = 0; i < n; i++, o += STRIDE) {
        data[o] = ppx[i] * b + px[i] * a;
        data[o + 1] = ppy[i] * b + py[i] * a;
        data[o + 2] = ppz[i] * b + pz[i] * a;
        data[o + 3] = vx[i];
        data[o + 4] = vy[i];
        data[o + 5] = vz[i];
        data[o + 6] = roll[i];
        let ph = flap[i] - back * rate[i];
        if (ph < 0) ph += 1;
        data[o + 7] = ph;
      }
      ibuf.needsUpdate = true;

      const out = drive.out;
      bu.uCentre.value.set(flock.cx, flock.cy);
      bu.uSqueeze.value = out.squeeze;
      const w0 = drive.waves.slots[0];
      const w1 = drive.waves.slots[1];
      bu.uWave0.value.set(w0.ox, w0.oy, w0.radius, w0.active ? out.wave0Amp : 0);
      bu.uWave1.value.set(w1.ox, w1.oy, w1.radius, w1.active ? out.wave1Amp : 0);
      bu.uTime.value = time.now;
      bu.uShimmer.value = out.shimmer;

      falcon.visible = out.falconVisible;
      if (out.falconVisible) {
        fdata[0] = out.falconX;
        fdata[1] = out.falconY;
        fdata[2] = 0.3;
        fdata[3] = out.falconDirX;
        fdata[4] = out.falconDirY;
        fdata[5] = 0;
        fdata[6] = 0;
        fdata[7] = 0.25; // wings held: full span, no flap
        fbuf.needsUpdate = true;
      }

      drift += dt * 0.004 * p.cirrusDrift;
      skyUniforms.uDrift.value = drift;
    },

    resize,

    params() {
      applyParams();
    },

    dispose() {
      scene.remove(sky, birds, falcon);
      skyGeo.dispose();
      skyMat.dispose();
      birdGeo.dispose();
      birdMat.dispose();
      falconGeo.dispose();
      falconMat.dispose();
    },
  };
}
