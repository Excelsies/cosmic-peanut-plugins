// @ts-check
/**
 * Stereo image of one audio frame: `width` = 1 − corr(L, R) clamped to 0–1 (0 = mono, 1 =
 * uncorrelated or anti-phase) and `balance` = (E_R − E_L) / (E_R + E_L) in −1..1 (positive =
 * right heavy). A mono source (null channels), bit-identical channels and silence all give
 * width 0 and balance 0, so mono material takes the honest centred path.
 */
export function createStereo() {
  return { width: 0, balance: 0 };
}

/**
 * Allocates nothing.
 * @param {Float32Array | null} left
 * @param {Float32Array | null} right
 * @param {ReturnType<typeof createStereo>} out
 */
export function stereoFrame(left, right, out) {
  out.width = 0;
  out.balance = 0;
  if (!left || !right) return out;
  const n = Math.min(left.length, right.length);
  let ll = 0;
  let rr = 0;
  let lr = 0;
  for (let i = 0; i < n; i++) {
    const l = left[i];
    const r = right[i];
    ll += l * l;
    rr += r * r;
    lr += l * r;
  }
  const e = ll + rr;
  if (!(e > 1e-12)) return out;
  out.balance = (rr - ll) / e;
  if (ll > 0 && rr > 0) {
    const corr = lr / Math.sqrt(ll * rr);
    out.width = Math.min(1, Math.max(0, 1 - corr));
  }
  return out;
}
