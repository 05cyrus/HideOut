/** Scalar math helpers. Pure, allocation-free, no dependencies. */

export const EPSILON = 1e-6;
export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : (value - a) / (b - a);
}

export function approxEqual(a: number, b: number, epsilon = EPSILON): boolean {
  return Math.abs(a - b) <= epsilon;
}

/** Wrap an angle (radians) into the range [-PI, PI]. */
export function wrapAngle(radians: number): number {
  let a = radians % TAU;
  if (a < -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}

/** Shortest-path angular interpolation (radians). */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/**
 * Frame-rate-independent exponential smoothing.
 * `lambda` is the decay rate; larger = snappier. Stable for any `dt`.
 */
export function damp(a: number, b: number, lambda: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}
