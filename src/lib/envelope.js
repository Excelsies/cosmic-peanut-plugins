// @ts-check
/**
 * One step of an exponential attack/release follower, frame-rate independent: the value covers
 * 1 − e^(−dt/τ) of the way to the target, with τ = `attack` while rising and `release` while
 * falling (so after τ seconds of a constant target it has covered 63%).
 *
 * @param {number} value current value
 * @param {number} target value to approach
 * @param {number} dt seconds
 * @param {number} attack rising time constant, seconds
 * @param {number} release falling time constant, seconds
 */
export function stepEnvelope(value, target, dt, attack, release) {
  if (!(dt > 0)) return value;
  const tau = target > value ? attack : release;
  return target + (value - target) * Math.exp(-dt / tau);
}
