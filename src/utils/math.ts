/** Frame-rate independent exponential smoothing. */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-lambda * dt))

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const smooth = (t: number): number => {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}
export const formatCredits = (n: number): string => Math.round(n).toLocaleString('en-US')
export const formatMult = (n: number): string => `${Number.isInteger(n) ? n : n.toFixed(1)}×`
