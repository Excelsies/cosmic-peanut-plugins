// @ts-check
/**
 * Washi paper fibres: a tileable FIBRE_SIZE x FIBRE_SIZE grey RGBA texture, luminance 0.92-1,
 * plain paper with a faint grain and about a hundred long, gently curving darker fibres (hashed,
 * so it is the same every time). Built once at create.
 */
import { hash01 } from "../../lib/hash.js";

export const FIBRE_SIZE = 256;
const FIBRES = 90;

/**
 * @param {Uint8Array} px FIBRE_SIZE * FIBRE_SIZE * 4 bytes
 * @returns {Uint8Array} px
 */
export function writeFibres(px) {
  const n = FIBRE_SIZE;
  const lum = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) lum[i] = 0.975 + 0.025 * hash01(i + 7);
  for (let f = 0; f < FIBRES; f++) {
    const h = f * 6 + 100003;
    let x = hash01(h) * n;
    let y = hash01(h + 1) * n;
    let a = hash01(h + 2) * Math.PI * 2;
    const bend = (hash01(h + 3) - 0.5) * 0.03;
    const len = 50 + 170 * hash01(h + 4);
    const tone = 0.935 + 0.03 * hash01(h + 5);
    for (let s = 0; s < len; s++) {
      const i = ((Math.floor(y) % n) + n) % n;
      const j = ((Math.floor(x) % n) + n) % n;
      const k = i * n + j;
      lum[k] = Math.min(lum[k], tone);
      x += Math.cos(a);
      y += Math.sin(a);
      a += bend;
    }
  }
  for (let i = 0; i < n * n; i++) {
    const v = Math.round(Math.min(1, Math.max(0.92, lum[i])) * 255);
    px[i * 4] = v;
    px[i * 4 + 1] = v;
    px[i * 4 + 2] = v;
    px[i * 4 + 3] = 255;
  }
  return px;
}
