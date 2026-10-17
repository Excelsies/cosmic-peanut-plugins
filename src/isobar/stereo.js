// @ts-check
/**
 * Stereo image of one audio frame, shared by the Fieldwork visualizers:
 *
 * - `balance` = (rmsR − rmsL) / (rmsR + rmsL), −1 (all left) … +1 (all right).
 * - `width` = 1 − corr(L, R) clamped to 0–1 (0 = mono, 1 = uncorrelated or anti-phase); 0 when
 *   either channel is silent.
 *
 * Both are exactly 0 without stereo data (`left`/`right` null), for silence, and when L and R are
 * bit-identical over the window (the app's synthetic sources and an upmixed mono source send the
 * same samples on both channels), so mono material never tilts or widens anything.
 */
export function createStereo() {
  return { balance: 0, width: 0 };
}

/**
 * Allocates nothing.
 * @param {Float32Array | null} left
 * @param {Float32Array | null} right
 * @param {ReturnType<typeof createStereo>} out
 */
export function stereoFrame(left, right, out) {
  out.balance = 0;
  out.width = 0;
  if (!left || !right) return out;
  const n = Math.min(left.length, right.length);
  let ll = 0;
  let rr = 0;
  let lr = 0;
  let differs = false;
  for (let i = 0; i < n; i++) {
    const l = left[i];
    const r = right[i];
    if (l !== r) differs = true;
    ll += l * l;
    rr += r * r;
    lr += l * r;
  }
  if (!differs || !(ll + rr > 1e-12)) return out;
  const a = Math.sqrt(ll);
  const b = Math.sqrt(rr);
  out.balance = (b - a) / (a + b);
  if (ll > 0 && rr > 0) out.width = Math.min(1, Math.max(0, 1 - lr / (a * b)));
  return out;
}

/**
 * The same balance measured on channel energies, (E_R − E_L) / (E_R + E_L): a steeper curve near
 * the centre. Exact identity: with b the RMS balance, the energy balance is 2b / (1 + b²).
 * @param {number} balance RMS balance from `stereoFrame`
 */
export function energyBalance(balance) {
  return (2 * balance) / (1 + balance * balance);
}
