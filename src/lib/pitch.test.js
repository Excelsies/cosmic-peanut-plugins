// @ts-check
import { describe, expect, it } from "vitest";
import { candidateIndex, createModeGate, createPitch } from "./pitch.js";

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
  it("starts on mode 6 and holds it through silence and atonal input", () => {
    const g = createModeGate(6);
    for (let i = 0; i < 120; i++) expect(g.step(NaN, i % 30 === 0, 1 / 60, 1)).toBe(6);
  });

  it("switches after a candidate has held 0.2 s, at the same audio time at 60 Hz and 120 Hz", () => {
    for (const hz of [60, 120]) {
      const g = createModeGate(6);
      let t = 0;
      let switchedAt = -1;
      for (let i = 0; i < hz; i++) {
        if (g.step(69, false, 1 / hz, 1) === 10 && switchedAt < 0) switchedAt = t;
        t += 1 / hz;
      }
      expect(switchedAt).toBeCloseTo(0.2, 6);
    }
  });

  it("does not switch on a candidate that keeps changing", () => {
    const g = createModeGate(6);
    for (let i = 0; i < 60; i++) expect(g.step(i % 10 < 5 ? 69 : 72, false, 1 / 60, 1)).toBe(6);
  });

  it("switches at once on an onset with a valid candidate", () => {
    const g = createModeGate(6);
    expect(g.step(69, true, 1 / 60, 1)).toBe(10);
    expect(g.step(NaN, true, 1 / 60, 1)).toBe(10);
  });
});
