// @ts-check
import { describe, expect, it } from "vitest";
import { candidateIndex, createModeGate, createPitch, HOLD } from "./pitch.js";

/** A spectrum with one Gaussian partial at `hz` over a low floor. @param {number} hz @param {number} sr */
function tone(hz, sr, amp = 0.5) {
  const s = new Float32Array(1024).fill(1e-4);
  const c = (hz * 2048) / sr;
  for (let i = 0; i < 1024; i++) s[i] += amp * Math.exp(-((i - c) ** 2) / (2 * 1.3 ** 2));
  return s;
}

describe("createPitch", () => {
  it("finds a 440 Hz partial as midi 69 at 44.1 kHz and 48 kHz", () => {
    for (const sr of [44100, 48000]) {
      const p = createPitch();
      p.setSampleRate(sr);
      expect(p.midi(tone(440, sr))).toBeCloseTo(69, 1);
    }
  });

  it("covers 200 Hz – 2 kHz: bins ceil(200·2048/sr) … floor(2000·2048/sr)", () => {
    const p = createPitch();
    p.setSampleRate(48000);
    expect([p.lo, p.hi]).toEqual([9, 85]);
    p.setSampleRate(0); // unknown rate: keep the table
    expect([p.lo, p.hi]).toEqual([9, 85]);
    p.setSampleRate(44100);
    expect([p.lo, p.hi]).toEqual([10, 92]);
    expect(Number.isNaN(p.midi(tone(150, 44100)))).toBe(true); // below the window
  });

  it("rejects quiet, flat and silent spectra", () => {
    const p = createPitch();
    p.setSampleRate(48000);
    expect(Number.isNaN(p.midi(new Float32Array(1024)))).toBe(true);
    expect(Number.isNaN(p.midi(tone(440, 48000, 0.05)))).toBe(true); // magnitude ≤ 0.08
    const flat = new Float32Array(1024).fill(0.2);
    flat[40] = 0.5; // peak / mean < 3
    expect(Number.isNaN(p.midi(flat))).toBe(true);
  });

  it("returns NaN until it knows the sample rate", () => {
    expect(Number.isNaN(createPitch().midi(tone(440, 48000)))).toBe(true);
  });
});

describe("candidateIndex", () => {
  it("maps midi to clamp(floor((midi − 55) · 0.72 · complexity), 0, 31)", () => {
    expect(candidateIndex(69, 1)).toBe(10);
    expect(candidateIndex(69, 2)).toBe(20);
    expect(candidateIndex(40, 1)).toBe(0);
    expect(candidateIndex(120, 1)).toBe(31);
  });
});

describe("createModeGate", () => {
  /**
   * First frame on which the gate reports `want`, or -1.
   * @param {(i: number) => number} midiAt @param {number} hz @param {number} want
   */
  function switchFrame(midiAt, hz, want, frames = 4 * hz) {
    const g = createModeGate(6);
    for (let i = 0; i < frames; i++) if (g.step(midiAt(i), 1 / hz, 1) === want) return i;
    return -1;
  }

  it("starts on mode 6 and holds it through silence and atonal input", () => {
    const g = createModeGate(6);
    for (let i = 0; i < 120; i++) expect(g.step(NaN, 1 / 60, 1)).toBe(6);
  });

  it("switches once a candidate has held 0.2 s, at the same audio time at 60 Hz and 120 Hz", () => {
    expect(HOLD).toBe(0.2);
    expect(switchFrame(() => 69, 60, 10)).toBe(12);
    expect(switchFrame(() => 69, 120, 10)).toBe(24);
  });

  it("does not switch on a candidate that keeps changing", () => {
    const g = createModeGate(6);
    for (let i = 0; i < 120; i++) expect(g.step(i % 10 < 5 ? 69 : 72, 1 / 60, 1)).toBe(6);
  });

  it("restarts the hold when the note drops out", () => {
    const g = createModeGate(6);
    for (let i = 0; i < 11; i++) expect(g.step(69, 1 / 60, 1)).toBe(6);
    expect(g.step(NaN, 1 / 60, 1)).toBe(6);
    for (let i = 0; i < 12; i++) expect(g.step(69, 1 / 60, 1)).toBe(6);
    expect(g.step(69, 1 / 60, 1)).toBe(10);
    expect(g.step(NaN, 1 / 60, 1)).toBe(10);
  });

  // Melodies that move on every beat or every 8th: the figure must follow the note that is
  // sounding, HOLD after it starts, whether the pitch reads a couple of frames before or after
  // the beat. Indices alternate 10 / 12 / 15 (midi 69 / 72 / 76).
  for (const [label, noteSecs] of /** @type {const} */ ([
    ["quarter notes at 100 bpm", 0.6],
    ["quarter notes at 120 bpm", 0.5],
    ["8th notes at 90 bpm", 1 / 3],
  ])) {
    for (const shift of [-2, 2]) {
      it(`follows ${label} with the pitch ${Math.abs(shift)} frames ${shift < 0 ? "before" : "after"} the beat`, () => {
        const hz = 60;
        const notes = [69, 72, 76];
        const idx = [10, 12, 15];
        const g = createModeGate(6);
        const lag = Math.round(HOLD * hz);
        let checked = 0;
        for (let i = 0; i < 6 * hz; i++) {
          const t = (i - 30 - shift) / hz; // half a second of no note first
          if (t < 0) {
            expect(g.step(NaN, 1 / hz, 1)).toBe(6);
            continue;
          }
          const n = Math.floor(t / noteSecs + 1e-9);
          const start = Math.round(n * noteSecs * hz) + 30 + shift;
          const got = g.step(notes[n % 3], 1 / hz, 1);
          if (i >= start + lag) {
            expect(got).toBe(idx[n % 3]);
            checked++;
          } else if (n > 0) {
            expect(got).toBe(idx[(n - 1) % 3]);
          }
        }
        expect(checked).toBeGreaterThan(2 * hz);
      });
    }
  }
});
