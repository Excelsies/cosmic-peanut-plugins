// @ts-check
/**
 * Colour of a black body at `temp` kelvin as sRGB 0-1 (Tanner Helland's curve fit, good from
 * 1000 K to 40000 K). Writes into `out` and returns it; allocates nothing.
 * @template {{ [i: number]: number }} T
 * @param {number} temp kelvin
 * @param {T} out
 * @returns {T}
 */
export function kelvin(temp, out) {
  const t = temp / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  out[0] = Math.min(1, Math.max(0, r / 255));
  out[1] = Math.min(1, Math.max(0, g / 255));
  out[2] = Math.min(1, Math.max(0, b / 255));
  return out;
}
