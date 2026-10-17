// @ts-check
/**
 * Miura — one sheet of Miura-ori folded paper fills the window under a low raking light.
 *
 * Geometry (lib/miura.js): the Schenk and Guest closed form, one indexed BufferGeometry whose
 * positions are rewritten in place every frame. The in-plane layout follows the global fold t0
 * (clamped so the sheet always tiles); the ridge rows' heights follow a per-vertex fold
 * t_local = t0 + fold waves + mid swell + hat rustle, so waves read as bands of steeper, darker
 * pleats. Flat-shaded MeshStandardMaterial: facets get their normals from screen derivatives.
 *
 * Drive (lib/drive.js, lib/waves.js): bass folds the sheet deeper (and it contracts in both
 * directions), flash-limited because folding darkens the window; every hit launches a ring from
 * where the sound sits in the stereo image; mids swell it, hats rustle it; every 8 bars the key
 * light eases to a new heading over 4 s and the spectral centroid warms or cools it.
 *
 * Light: one shadow-casting DirectionalLight (PCF, soft radius) at a low elevation so ridges are
 * bright and valleys shadowed, a hemisphere fill, neutral tone mapping. Foil adds a PMREM
 * RoomEnvironment for glints; graphite adds a cool rim light. 'float' drops the sheet to 72% of
 * the width over the desktop with a ShadowMaterial contact shadow behind it.
 *
 * frame() allocates nothing.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createFold, createSweep, ease, rustleAmp, rustleBucket, rustleNoise, swellAmp, swellWave } from "./lib/drive.js";
import { FIBRE_SIZE, writeFibres } from "./lib/fibres.js";
import { kelvin } from "./lib/kelvin.js";
import {
  applyLocalFold,
  buildIndex,
  fitSheet,
  foldH,
  layoutT,
  LOCAL_T_MAX,
  rowsFor,
  TILT,
  vertexCount,
  writeLayout,
} from "./lib/miura.js";
import { effectiveMotion, resolveParams } from "./lib/miura-params.js";
import { stereoImage } from "./lib/stereo.js";
import { createWaves } from "./lib/waves.js";

/** @typedef {{ color: number, rough: number, metal: number, fibres: boolean, rim: number }} Paper */
/** @type {Record<string, Paper>} */
const PAPERS = {
  washi: { color: 0xefe6d2, rough: 0.92, metal: 0, fibres: true, rim: 0 },
  indigo: { color: 0x24365e, rough: 0.85, metal: 0, fibres: false, rim: 0 },
  vermilion: { color: 0xc8402f, rough: 0.8, metal: 0, fibres: true, rim: 0 },
  foil: { color: 0xd4a64a, rough: 0.38, metal: 1, fibres: false, rim: 0 },
  graphite: { color: 0x2a2b2e, rough: 0.6, metal: 0, fibres: false, rim: 1.6 },
};

/** @typedef {{ el: number, color: number, intensity: number, hemi: number }} LightPreset */
/** @type {Record<string, LightPreset>} */
const LIGHTS = {
  window: { el: 20, color: 0xfff1dc, intensity: 2.6, hemi: 0.45 },
  noon: { el: 55, color: 0xffffff, intensity: 2.0, hemi: 0.7 },
  "low-sun": { el: 9, color: 0xffc58a, intensity: 3.0, hemi: 0.25 },
};

const DEG = Math.PI / 180;
const LIGHT_DISTANCE = 10;
const RIM_ELEVATION = 8 * DEG;
const SHADOW_FIT = 1.4;
/** Light gains over the preset intensities, so the lit facets read as the paper's colour. */
const KEY_GAIN = 1.6;
const HEMI_GAIN = 2.5;
const FLOAT_GAP = 0.4;
const COS_T = Math.cos(TILT);
const SIN_T = Math.sin(TILT);

/** @type {import('../../tidalviz').CreateVisualizer} */
export default async function create(ctx) {
  const three = /** @type {import('../../tidalviz').ThreeHandles} */ (ctx.three);
  const { renderer, scene } = three;

  // Renderer state we change, restored in dispose().
  const saved = {
    shadows: renderer.shadowMap.enabled,
    shadowType: renderer.shadowMap.type,
    toneMapping: renderer.toneMapping,
    exposure: renderer.toneMappingExposure,
  };
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const p = resolveParams(ctx.params, {});
  const motion = effectiveMotion(p, ctx.reduceMotion, {});
  const fit = fitSheet(1, rowsFor(p.pleat), p.sheet, {});

  // --- Paper ---------------------------------------------------------------------------------
  const fibreTex = new THREE.DataTexture(writeFibres(new Uint8Array(FIBRE_SIZE * FIBRE_SIZE * 4)), FIBRE_SIZE, FIBRE_SIZE);
  fibreTex.colorSpace = THREE.SRGBColorSpace;
  fibreTex.wrapS = fibreTex.wrapT = THREE.RepeatWrapping;
  fibreTex.magFilter = THREE.LinearFilter;
  fibreTex.minFilter = THREE.LinearMipmapLinearFilter;
  fibreTex.generateMipmaps = true;
  fibreTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  fibreTex.needsUpdate = true;
  // A flat white map for the plain papers keeps one shader program for every paper.
  const flatTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  flatTex.needsUpdate = true;

  const material = new THREE.MeshStandardMaterial({ flatShading: true, side: THREE.DoubleSide, map: fibreTex });

  // --- Sheet geometry (rebuilt when the grid changes) ---------------------------------------
  let cols = 0;
  let rows = 0;
  let pos = new Float32Array(0);
  let tl = new Float32Array(0);
  /** @type {THREE.BufferAttribute} */
  let posAttr = new THREE.BufferAttribute(pos, 3);
  let geometry = new THREE.BufferGeometry();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // positions change every frame

  function rebuildGeometry() {
    const n = vertexCount(cols, rows);
    pos = new Float32Array(n * 3);
    tl = new Float32Array(n);
    const uv = new Float32Array(n * 2);
    // Normals only steer the shadow normal bias (shading is flat, from derivatives): the sheet's.
    const normal = new Float32Array(n * 3);
    for (let j = 0, v = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++, v++) {
        uv[v * 2] = i / cols;
        uv[v * 2 + 1] = j / rows;
        normal[v * 3 + 2] = 1;
      }
    }
    const g = new THREE.BufferGeometry();
    posAttr = new THREE.BufferAttribute(pos, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", posAttr);
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    g.setIndex(new THREE.BufferAttribute(buildIndex(cols, rows), 1));
    geometry.dispose();
    geometry = g;
    mesh.geometry = g;
    fibreTex.repeat.set(cols / 6, rows / 6);
  }

  // Contact shadow for 'float': only the shadow is drawn, black at partial alpha, which is the
  // same premultiplied or not, so the output stays correct over the desktop.
  const shadowPlaneGeo = new THREE.PlaneGeometry(1, 1);
  const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.35 });
  const shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
  shadowPlane.receiveShadow = true;

  const sheet = new THREE.Group();
  sheet.rotation.x = -TILT;
  sheet.add(mesh, shadowPlane);
  scene.add(sheet);

  // --- Lights ----------------------------------------------------------------------------------
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 2;
  const rim = new THREE.DirectionalLight(0xa8c4ff, 0);
  const hemi = new THREE.HemisphereLight(0xc9d6ff, 0x3a3026, 0.45);
  scene.add(key, key.target, rim, rim.target, hemi);

  const presetRgb = new Float32Array(3);
  const kel = new Float32Array(3);
  const tmpColor = new THREE.Color();
  let lightPreset = LIGHTS.window;
  let paper = PAPERS.washi;

  // --- Foil environment (built the first time foil is chosen) --------------------------------
  /** @type {THREE.WebGLRenderTarget | null} */
  let envTarget = null;
  /** @param {boolean} on */
  function setEnvironment(on) {
    if (on && !envTarget) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      envTarget = pmrem.fromScene(room, 0.04);
      room.dispose();
      pmrem.dispose();
      scene.environment = envTarget.texture;
    } else if (!on && envTarget) {
      scene.environment = null;
      envTarget.dispose();
      envTarget = null;
    }
  }

  // --- State -----------------------------------------------------------------------------------
  const fold = createFold();
  const sweep = createSweep();
  const waves = createWaves();
  let balanceS = 0;
  let midAttS = 0;
  let centroidS = 0;
  let onsetCount = 0;
  let shadowSize = 0;
  let lightDist = LIGHT_DISTANCE;

  function applyPaper() {
    paper = PAPERS[p.paper] ?? PAPERS.washi;
    material.color.setHex(paper.color);
    material.roughness = paper.rough;
    material.metalness = paper.metal;
    material.map = paper.fibres ? fibreTex : flatTex;
    material.needsUpdate = true;
    rim.intensity = paper.rim;
    setEnvironment(p.paper === "foil");
  }

  function applyLight() {
    lightPreset = LIGHTS[p.light] ?? LIGHTS.window;
    tmpColor.setHex(lightPreset.color);
    tmpColor.getRGB(tmpColor, THREE.SRGBColorSpace);
    presetRgb[0] = tmpColor.r;
    presetRgb[1] = tmpColor.g;
    presetRgb[2] = tmpColor.b;
    key.intensity = lightPreset.intensity * KEY_GAIN;
    hemi.intensity = lightPreset.hemi * HEMI_GAIN;
  }

  function applyShadows() {
    renderer.shadowMap.enabled = p.shadows;
    key.castShadow = p.shadows;
    material.needsUpdate = true;
    shadowPlaneMat.needsUpdate = true;
  }

  function updateShadowSize() {
    const want = ctx.quality === "battery" || ctx.renderScale < 0.75 ? 1024 : 2048;
    if (want === shadowSize) return;
    shadowSize = want;
    key.shadow.mapSize.set(want, want);
    key.shadow.map?.dispose();
    key.shadow.map = null;
  }

  /** Size the sheet for the window and the pleat/sheet params; rebuild the grid if it changed. */
  function refit() {
    const aspect = ctx.size.width / Math.max(1, ctx.size.height);
    fitSheet(aspect, rowsFor(p.pleat), p.sheet, fit);
    if (fit.cols !== cols || fit.rows !== rows) {
      cols = fit.cols;
      rows = fit.rows;
      rebuildGeometry();
    }
    const floating = p.sheet === "float";
    shadowPlane.visible = floating;
    const relief = fit.k * foldH(LOCAL_T_MAX);
    shadowPlane.position.set(0, 0, -relief / 2 - FLOAT_GAP);
    shadowPlane.scale.set(fit.visW * 4, fit.visH * 6, 1);
    // Shadow camera: an orthographic box around the visible sheet, x1.4.
    const reach = (SHADOW_FIT * Math.hypot(fit.visW, fit.visH)) / 2 + (floating ? 1.5 : 0);
    const cam = key.shadow.camera;
    cam.left = -reach;
    cam.right = reach;
    cam.top = reach;
    cam.bottom = -reach;
    // The light sits beyond the box so no part of the sheet falls behind the shadow camera.
    lightDist = LIGHT_DISTANCE + reach;
    cam.near = lightDist - reach - 1;
    cam.far = lightDist + reach + 1;
    cam.updateProjectionMatrix();
    // The light looks at the middle of the visible sheet.
    const yMid = fit.ybot + fit.visH / 2;
    key.target.position.set(0, yMid * COS_T, -yMid * SIN_T);
    rim.target.position.copy(key.target.position);
  }

  /**
   * Point a light along the mesh-space direction (cos el cos az, cos el sin az, sin el), turned
   * with the sheet, from `dist` away.
   * @param {THREE.DirectionalLight} light @param {number} el @param {number} az @param {number} dist
   */
  function aim(light, el, az, dist) {
    const x = Math.cos(el) * Math.cos(az);
    const y = Math.cos(el) * Math.sin(az);
    const z = Math.sin(el);
    const t = light.target.position;
    light.position.set(t.x + x * dist, t.y + (y * COS_T + z * SIN_T) * dist, t.z + (-y * SIN_T + z * COS_T) * dist);
  }

  applyPaper();
  applyLight();
  applyShadows();
  updateShadowSize();
  refit();

  return {
    frame(audio, time) {
      const dt = time.dt;
      const now = time.now;
      effectiveMotion(p, ctx.reduceMotion, motion);
      updateShadowSize();

      const st = stereoImage(audio.left, audio.right);
      balanceS = ease(balanceS, st.balance, dt, 0.5);
      midAttS = ease(midAttS, audio.silent ? 0 : audio.midAtt, dt, 0.3);
      centroidS = ease(centroidS, audio.silent ? 0 : audio.centroid, dt, 3);

      const t0 = fold.step(audio.bassAtt, audio.silent, p.fold, p.reactivity, dt, ctx.reduceFlashing);

      if (audio.onset) onsetCount++;
      const glint = p.paper === "foil" && ctx.reduceFlashing ? 0.6 : 1;
      waves.onset(audio, now, p.reactivity, motion.waveEff * glint, balanceS, onsetCount);
      waves.prepare(now, motion.speedEff);

      // Sheet: uniform layout, then the ridge rows re-folded per vertex.
      const tz = Math.min(LOCAL_T_MAX, Math.max(0, t0));
      writeLayout(pos, cols, rows, layoutT(t0), fit.k, fit.yc, tz);
      const swell = audio.silent ? 0 : swellAmp(midAttS) * motion.swell;
      const rustle = audio.silent ? 0 : rustleAmp(audio.trebAtt) * motion.rustle;
      const bucket = rustleBucket(now, ctx.reduceFlashing);
      const hasWaves = waves.active > 0;
      const halfW = fit.visW / 2;
      const invW = 1 / fit.visW;
      const invH = 1 / fit.visH;
      const aspect = fit.visW / fit.visH;
      const stride = cols + 1;
      for (let j = 1; j <= rows; j += 2) {
        for (let i = 0, v = j * stride; i <= cols; i++, v++) {
          const x = pos[v * 3];
          const y = pos[v * 3 + 1];
          let t = t0;
          if (hasWaves) t += waves.at((x + halfW) * invW, (y - fit.ybot) * invH, aspect);
          if (swell > 0) t += swell * swellWave(x, y, now);
          if (rustle > 0) t += rustle * rustleNoise(v, bucket);
          tl[v] = t;
        }
      }
      applyLocalFold(pos, cols, rows, tl, fit.k, (fit.k * foldH(tz)) / 2);
      posAttr.needsUpdate = true;

      // Light: heading from the sweep, colour warmed or cooled by the centroid.
      const az = sweep.step(audio.bpm, audio.beatPhase, dt, motion.barsPerTurn) * DEG;
      aim(key, lightPreset.el * DEG, az, lightDist);
      aim(rim, RIM_ELEVATION, az + Math.PI, lightDist);
      kelvin(3000 + 4000 * Math.min(1, Math.max(0, centroidS * 4)), kel);
      key.color.setRGB(
        0.6 * presetRgb[0] + 0.4 * kel[0],
        0.6 * presetRgb[1] + 0.4 * kel[1],
        0.6 * presetRgb[2] + 0.4 * kel[2],
        THREE.SRGBColorSpace,
      );
    },

    resize() {
      refit();
    },

    params(changed) {
      resolveParams(ctx.params, p);
      if ("pleat" in changed || "sheet" in changed) refit();
      if ("paper" in changed) applyPaper();
      if ("light" in changed) applyLight();
      if ("shadows" in changed) applyShadows();
    },

    dispose() {
      scene.remove(sheet, key, key.target, rim, rim.target, hemi);
      geometry.dispose();
      shadowPlaneGeo.dispose();
      material.dispose();
      shadowPlaneMat.dispose();
      fibreTex.dispose();
      flatTex.dispose();
      setEnvironment(false);
      key.shadow.map?.dispose();
      key.shadow.map = null;
      key.dispose();
      rim.dispose();
      hemi.dispose();
      scene.environment = null;
      renderer.shadowMap.enabled = saved.shadows;
      renderer.shadowMap.type = saved.shadowType;
      renderer.toneMapping = saved.toneMapping;
      renderer.toneMappingExposure = saved.exposure;
    },
  };
}
