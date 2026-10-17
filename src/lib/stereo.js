// @ts-check
/**
 * Left/right balance of one audio frame: (rmsR − rmsL) / (rmsR + rmsL), −1 (all left) .. 1 (all
 * right). Exactly 0 without stereo data (`left`/`right` null), for silence, and for bit-identical
 * channels (a mono source upmixed, e.g. `synthetic:demo`). Allocates nothing.
 *
 * @param {Float32Array | null} left
 * @param {Float32Array | null} right
 * @returns {number}
 */
export function stereoBalance(left, right) {
  if (!left || !right) return 0;
  const n = Math.min(left.length, right.length);
  let sl = 0;
  let sr = 0;
  for (let i = 0; i < n; i++) {
    sl += left[i] * left[i];
    sr += right[i] * right[i];
  }
  if (sl === sr) return 0;
  const l = Math.sqrt(sl);
  const r = Math.sqrt(sr);
  return (r - l) / (r + l);
}
