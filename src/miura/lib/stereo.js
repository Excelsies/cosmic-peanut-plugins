// @ts-check
/**
 * Stereo image of one frame: `balance` (−1 right … +1 left, by RMS) and `width` (0 mono … 1, the
 * RMS of L − R over the sum of the channel RMS). Both are exactly 0 when either channel is null,
 * when both are silent, and when L and R are bit-identical over the window (the app's synthetic
 * sources send the same samples on both channels), so a mono source never tilts anything.
 *
 * Allocates nothing; returns the same object every call.
 */
const out = { balance: 0, width: 0 };

/**
 * @param {Float32Array | null} left
 * @param {Float32Array | null} right
 * @returns {{ balance: number, width: number }}
 */
export function stereoImage(left, right) {
  out.balance = 0;
  out.width = 0;
  if (!left || !right) return out;
  const n = Math.min(left.length, right.length);
  let ll = 0;
  let rr = 0;
  let dd = 0;
  let differs = false;
  for (let i = 0; i < n; i++) {
    const l = left[i];
    const r = right[i];
    if (l !== r) differs = true;
    ll += l * l;
    rr += r * r;
    dd += (l - r) * (l - r);
  }
  if (!differs) return out;
  const lr = Math.sqrt(ll / n);
  const rrms = Math.sqrt(rr / n);
  const sum = lr + rrms;
  if (sum < 1e-9) return out;
  out.balance = (lr - rrms) / sum;
  out.width = Math.min(1, Math.sqrt(dd / n) / sum);
  return out;
}
