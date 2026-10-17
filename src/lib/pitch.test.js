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
   * @param {(i: number) => number} midiAt @param {(i: number) => boolean} onsetAt @param {number} hz @param {number} want
   */
  function switchFrame(midiAt, onsetAt, hz, want, frames = 4 * hz) {
    const g = createModeGate(6);
    for (let i = 0; i < frames; i++) if (g.step(midiAt(i), onsetAt(i), 1 / hz, 1) === want) return i;
    return -1;
  }
  const never = () => false;

  it("starts on mode 6 and holds it through silence and atonal input, onsets or not", () => {
    const g = createModeGate(6);
    for (let i = 0; i < 120; i++) expect(g.step(NaN, i % 15 === 0, 1 / 60, 1)).toBe(6);
  });

  it("switches once a candidate has held 0.2 s, at the same audio time at 60 Hz and 120 Hz", () => {
    expect(HOLD).toBe(0.2);
    expect(switchFrame(() => 69, never, 60, 10)).toBe(12);
    expect(switchFrame(() => 69, never, 120, 10)).toBe(24);
  });

  it("switches at once on an onset with a clear note, and holds the figure through NaN", () => {
    const g = createModeGate(6);
    expect(g.step(69, true, 1 / 60, 1)).toBe(10);
    expect(g.step(NaN, true, 1 / 60, 1)).toBe(10);
  });

  it("does not switch on a candidate that keeps changing without onsets", () => {
    const g = createModeGate(6);
    for (let i = 0; i < 120; i++) expect(g.step(i % 10 < 5 ? 69 : 72, false, 1 / 60, 1)).toBe(6);
  });

  it("restarts the hold when the note drops out", () => {
    const g = createModeGate(6);
    for (let i = 0; i < 11; i++) expect(g.step(69, false, 1 / 60, 1)).toBe(6);
    expect(g.step(NaN, false, 1 / 60, 1)).toBe(6);
    for (let i = 0; i < 12; i++) expect(g.step(69, false, 1 / 60, 1)).toBe(6);
    expect(g.step(69, false, 1 / 60, 1)).toBe(10);
  });

  // Plucked notes, as in the harness's melody: the pitch reads clearly for 3 frames after the
  // attack (an onset), then fades to no clear note. The figure follows each pluck on its attack.
  it("follows plucked 8th notes at 120 bpm on their attacks", () => {
    const g = createModeGate(6);
    const notes = [69, 72, 76];
    const idx = [10, 12, 15];
    for (let i = 0; i < 6 * 60; i++) {
      const n = Math.floor(i / 15);
      const j = i % 15;
      expect(g.step(j < 3 ? notes[n % 3] : NaN, j === 0, 1 / 60, 1)).toBe(idx[n % 3]);
    }
  });

  // Sustained melodies that move on every beat or every 8th: the figure follows the note that is
  // sounding, at once when the attack is an onset whose frame already reads the new pitch, and
  // HOLD after the note starts when the pitch reads after the onset (or there is none).
  // Indices cycle 10 / 12 / 15 (midi 69 / 72 / 76).
  for (const [label, noteSecs] of /** @type {const} */ ([
    ["quarter notes at 100 bpm", 0.6],
    ["quarter notes at 120 bpm", 0.5],
    ["8th notes at 90 bpm", 1 / 3],
  ])) {
    for (const [shift, onsets, when] of /** @type {const} */ ([
      [0, true, "with an onset on the attack"],
      [-2, false, "2 frames before the beat, no onset"],
      [2, true, "2 frames after the onset"],
    ])) {
      it(`follows ${label}, pitch ${when}`, () => {
        const hz = 60;
        const notes = [69, 72, 76];
        const idx = [10, 12, 15];
        const g = createModeGate(6);
        const lag = shift === 0 ? 0 : Math.round(HOLD * hz);
        let checked = 0;
        for (let i = 0; i < 6 * hz; i++) {
          const beatT = (i - 30) / hz; // half a second of no note first
          const onset = onsets && beatT >= 0 && Math.abs(beatT / noteSecs - Math.round(beatT / noteSecs)) * noteSecs * hz < 0.5;
          const t = (i - 30 - shift) / hz;
          if (t < 0) {
            expect(g.step(NaN, onset, 1 / hz, 1)).toBe(6);
            continue;
          }
          const n = Math.floor(t / noteSecs + 1e-9);
          const start = Math.round(n * noteSecs * hz) + 30 + shift;
          const got = g.step(notes[n % 3], onset, 1 / hz, 1);
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
