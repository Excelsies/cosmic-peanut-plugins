/**
 * Tidalviz visualizer plugin API, version 1.
 *
 * A plugin's entry module default-exports a {@link CreateVisualizer} factory. The SDK owns the
 * canvas, the rendering context, sizing and the animation loop; the plugin only draws.
 * Prose docs: docs/plugin-api.md.
 *
 * Use from a plain JS plugin (no build step):
 *   // @ts-check
 *   /** @type {import('./tidalviz').CreateVisualizer} *\/
 *   export default function create(ctx) { ... }
 */

export type ApiVersion = 1;

/** Which context the SDK creates for the plugin. */
export type RendererKind = "2d" | "webgl2" | "webgpu" | "three";

/** User-facing quality mode. `auto` adapts render scale to hold the frame budget. */
export type QualityMode = "auto" | "high" | "balanced" | "battery";

export type ParamValue = number | string | boolean;
export type ParamValues = Readonly<Record<string, ParamValue>>;

// ---------------------------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------------------------

/**
 * One analysis frame (~94 per second at 48 kHz). Arrays are zero-copy views into the received
 * message and are only valid during the `frame` call that receives them: copy anything you keep.
 */
export interface AudioFrame {
  /** 64 smoothed band levels, 0–1, log-spaced 30 Hz – 16 kHz. */
  readonly bands: Float32Array;
  /** 1024-bin linear magnitude spectrum, normalized 0–1 (bin i ≈ i * sampleRate / 2048 Hz). */
  readonly spectrum: Float32Array;
  /** Latest 2048 samples, mono mix, −1 to 1 (overlaps between frames; read `.length`). */
  readonly waveform: Float32Array;
  /** Latest 2048 left-channel samples when the source is stereo, else null. */
  readonly left: Float32Array | null;
  /** Latest 2048 right-channel samples when the source is stereo, else null. */
  readonly right: Float32Array | null;

  /** Root-mean-square level of the latest hop, 0–1. */
  readonly rms: number;
  /** Absolute peak of the latest hop, 0–1. */
  readonly peak: number;
  /** MilkDrop convention: 1.0 = average for this band over the last few seconds, roughly 0–2. */
  readonly bass: number;
  readonly mid: number;
  readonly treb: number;
  /** Smoothed ("attenuated") versions of bass/mid/treb. Better for motion than for flashes. */
  readonly bassAtt: number;
  readonly midAtt: number;
  readonly trebAtt: number;
  /** Onset detection function, 0 = nothing, ~1 = strong transient. */
  readonly onsetStrength: number;
  /**
   * Seconds from the latest onset to this frame's newest sample, accurate to ~1 ms (frames are
   * 10.7 ms apart). Keeps growing between onsets; capped at 10, and 10 before the first onset.
   */
  readonly onsetAge: number;
  /** Tempo estimate in BPM, 0 until confident. */
  readonly bpm: number;
  /** 0–1 position between predicted beats (0 = on the beat). 0 while bpm is 0. */
  readonly beatPhase: number;
  /** Spectral centroid, normalized 0–1 of Nyquist ("brightness"). */
  readonly centroid: number;
  /** Spectral flux, normalized, ~0–1. */
  readonly flux: number;

  /**
   * True on the frame an onset (transient / beat) is detected. An onset in an audio frame that was
   * replaced before it could be drawn is carried forward, so every onset is seen by exactly one
   * `frame` call.
   */
  readonly onset: boolean;
  /** True while the source is silent (also true when capture permission is missing). */
  readonly silent: boolean;

  /** Host frame counter. */
  readonly frameIndex: number;
  /** Source sample rate in Hz. */
  readonly sampleRate: number;
  /** Host monotonic time (s) of the newest sample in this frame (host clock, not `FrameTime`). */
  readonly hostTime: number;
}

/** Render-loop timing passed with every frame. Seconds. */
export interface FrameTime {
  /** Seconds since the visualizer started (monotonic, pauses while hidden). */
  readonly now: number;
  /** Seconds since the previous rendered frame (clamped to ≤ 0.1; 0 on the first frame). */
  readonly dt: number;
  /** Rendered-frame counter, starting at 0. */
  readonly frame: number;
}

// ---------------------------------------------------------------------------------------------
// Context handed to create()
// ---------------------------------------------------------------------------------------------

export interface Size {
  /** Drawing-buffer size in device pixels (already multiplied by dpr and renderScale). */
  readonly width: number;
  readonly height: number;
  /** CSS pixel size of the canvas. */
  readonly cssWidth: number;
  readonly cssHeight: number;
  /** Effective device-pixel ratio used for the drawing buffer (dpr cap × renderScale). */
  readonly dpr: number;
}

/**
 * Repo-scoped asset loaders. Paths are relative to the repo root (where tidalviz.json lives).
 * Paths with a `..` segment, a leading `/`, a backslash or a URL scheme are rejected (`url`
 * throws; the loaders reject).
 */
export interface Assets {
  /** Absolute URL for a repo file, for use in `import()`, `<img>`, `fetch`, etc. */
  url(path: string): string;
  text(path: string): Promise<string>;
  json<T = unknown>(path: string): Promise<T>;
  /** Decoded bitmap, ready for texImage2D / drawImage. */
  image(path: string): Promise<ImageBitmap>;
  arrayBuffer(path: string): Promise<ArrayBuffer>;
}

export interface WebGPUHandles {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
}

export interface ThreeHandles {
  /** The host-pinned three.js module (same as `import * as THREE from "three"`). */
  readonly THREE: typeof import("three");
  readonly renderer: import("three").WebGLRenderer;
  /** Default scene; replace freely. */
  scene: import("three").Scene;
  /** Default PerspectiveCamera (fov 60, near 0.1, far 1000, at z = 5); replace freely. */
  camera: import("three").Camera;
  /**
   * When true (default) the SDK calls `renderer.render(scene, camera)` after each `frame`.
   * Set false when you render yourself (e.g. through an EffectComposer).
   */
  autoRender: boolean;
}

export interface VisualizerContext {
  readonly apiVersion: ApiVersion;
  /** Manifest `id` and `name` of this visualizer. */
  readonly id: string;
  readonly name: string;
  readonly renderer: RendererKind;

  /** Full-window canvas, already sized. Do not resize it yourself. */
  readonly canvas: HTMLCanvasElement;
  /** Set when renderer is "2d". */
  readonly ctx2d: CanvasRenderingContext2D | null;
  /** Set when renderer is "webgl2" (created with the host's context options). */
  readonly gl: WebGL2RenderingContext | null;
  /** Set when renderer is "webgpu". */
  readonly gpu: WebGPUHandles | null;
  /** Set when renderer is "three". */
  readonly three: ThreeHandles | null;

  /** Current parameter values (live object: always reflects the latest values). */
  readonly params: ParamValues;
  readonly assets: Assets;
  /** Current size (live object, updated before `resize` is called). */
  readonly size: Size;

  /** Current adaptive render scale, 0.5–1 (live). Handled by the SDK; read it only if useful. */
  readonly renderScale: number;
  readonly quality: QualityMode;
  /**
   * User setting, on by default (live). When true, keep full-screen brightness changes to at
   * most 3 per second (photosensitivity).
   */
  readonly reduceFlashing: boolean;
  /**
   * The OS reduce-motion setting, `prefers-reduced-motion` (live). When true, default to gentler
   * motion (e.g. stop self-orbiting cameras); users can still raise it through params.
   */
  readonly reduceMotion: boolean;

  /** Log to the host's plugin console (dev overlay). Strings only are rendered, never HTML. */
  log(...args: unknown[]): void;
}

// ---------------------------------------------------------------------------------------------
// What the plugin returns
// ---------------------------------------------------------------------------------------------

export interface Visualizer {
  /** Required. Draw one frame using the newest audio. Called on requestAnimationFrame. */
  frame(audio: AudioFrame, time: FrameTime): void;
  /** Optional. The canvas was resized; `size` equals `ctx.size`. */
  resize?(size: Size): void;
  /** Optional. Only the changed keys; `ctx.params` already holds the new values. */
  params?(changed: ParamValues): void;
  /** Optional. Release GPU resources, timers, listeners. */
  dispose?(): void;
  /**
   * Optional. Pointer input on the visual (drag to orbit, etc.). The event object is reused:
   * read it during the call. Coordinates are CSS pixels in the canvas.
   */
  pointer?(e: PointerInput): void;
}

export interface PointerInput {
  kind: "down" | "move" | "up";
  /** Position in CSS pixels from the canvas's top-left. */
  x: number;
  y: number;
  /** Movement since the previous event, CSS pixels. */
  dx: number;
  dy: number;
}

/** The entry module's default export. May be async. */
export type CreateVisualizer = (ctx: VisualizerContext) => Visualizer | Promise<Visualizer>;

// ---------------------------------------------------------------------------------------------
// Manifest (tidalviz.json) — the JSON Schema in src/tidalviz/plugins/ is authoritative
// ---------------------------------------------------------------------------------------------

export type ParamSpec =
  | { id: string; type: "number"; label: string; min: number; max: number; step?: number; default: number }
  | { id: string; type: "color"; label: string; default: string }
  | { id: string; type: "boolean"; label: string; default: boolean }
  | { id: string; type: "select"; label: string; options: string[]; default: string };

export interface VisualizerManifestEntry {
  /** ^[a-z0-9-]{1,40}$, unique within the repo. */
  id: string;
  name: string;
  description?: string;
  author?: string;
  /** Repo-relative path to the ES module. */
  entry: string;
  renderer: RendererKind;
  /** For webgpu entries: `id` of another entry in this manifest to use when WebGPU is unavailable. */
  fallback?: string;
  /** Host-provided libraries. v1: "three". */
  libs?: "three"[];
  /** Repo-relative image path. */
  thumbnail?: string;
  params?: ParamSpec[];
}

export interface Manifest {
  apiVersion: ApiVersion;
  visualizers: VisualizerManifestEntry[];
}
