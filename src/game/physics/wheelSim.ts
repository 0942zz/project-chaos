import type { Rng } from '../probability/rng'
import { SEG_ANGLE, WHEEL, indexAtAngle, type SegmentType } from '../logic/segments'

/**
 * Wheel dynamics, integrated up front at 480 Hz and recorded at 120 Hz.
 *
 *   motor phase : the drive ramps the wheel up to omega0
 *   free phase  : d(omega)/dt = -sign(omega)*DRY - VISCOUS*omega + peg(angle)
 *
 * Pegs sit on pocket boundaries. Near a peg the pointer's flapper pushes the
 * wheel away from the boundary, so a slow wheel can be bounced back into the
 * pocket it was leaving and can never rest on a boundary. The result of a
 * spin is read from the final simulated angle — nothing else decides it — and
 * the renderer plays back this exact trajectory.
 */
const DRY = 0.25
const VISCOUS = 0.22
const PEG_HALF_WIDTH = 0.012
const PEG_PUSH = 1.2
const RAMP_TIME = 1.4
const STEP = 1 / 480
const RECORD_EVERY = 4

export interface SpinPlan {
  /** Wheel angle (radians, clockwise) every `dt` seconds. */
  samples: Float32Array
  dt: number
  duration: number
  startAngle: number
  finalAngle: number
  finalIndex: number
  finalType: SegmentType
  omega0: number
  /** Time at which the wheel has clearly started slowing (drives the DECELERATING state). */
  decelAt: number
}

function pegForce(angle: number): number {
  const nearest = Math.round(angle / SEG_ANGLE) * SEG_ANGLE
  const d = angle - nearest
  if (Math.abs(d) >= PEG_HALF_WIDTH) return 0
  return d >= 0 ? PEG_PUSH : -PEG_PUSH
}

export function simulateSpin(startAngle: number, omega0: number): SpinPlan {
  const out: number[] = []
  let angle = startAngle
  let omega = 0
  let t = 0
  let step = 0
  let decelAt = -1
  const maxSteps = 60 / STEP
  while (step < maxSteps) {
    if (step % RECORD_EVERY === 0) out.push(angle)
    if (t < RAMP_TIME) {
      const u = (t + STEP) / RAMP_TIME
      omega = omega0 * u * u * (3 - 2 * u)
    } else {
      const peg = pegForce(angle)
      const drag = (omega === 0 ? 0 : Math.sign(omega) * DRY) + VISCOUS * omega
      const next = omega + (peg - drag) * STEP
      // Dry friction cannot reverse the direction of travel by itself: stick instead.
      if (peg === 0 && (omega === 0 || Math.sign(next) !== Math.sign(omega) || Math.abs(next) < 1e-4)) {
        omega = 0
        break
      }
      omega = next
      if (decelAt < 0 && omega < omega0 * 0.5) decelAt = t
    }
    angle += omega * STEP
    t += STEP
    step++
  }
  out.push(angle)
  const samples = Float32Array.from(out)
  const dt = STEP * RECORD_EVERY
  const finalIndex = indexAtAngle(angle)
  return {
    samples,
    dt,
    duration: (samples.length - 1) * dt,
    startAngle,
    finalAngle: angle,
    finalIndex,
    finalType: WHEEL[finalIndex],
    omega0,
    decelAt: decelAt < 0 ? RAMP_TIME + 1 : decelAt,
  }
}

/**
 * Chooses a launch speed and simulates it. `want` (dev/testing only) keeps
 * drawing launch speeds until the simulated wheel stops on that type, so even
 * a forced result is still a physically consistent spin.
 */
export function planSpin(rng: Rng, startAngle: number, want?: SegmentType | null): SpinPlan {
  let plan = simulateSpin(startAngle, rng.range(9, 12.5))
  if (want) {
    for (let i = 0; i < 2000 && plan.finalType !== want; i++) {
      plan = simulateSpin(startAngle, rng.range(9, 12.5))
    }
  }
  return plan
}

export function sampleSpin(plan: SpinPlan, time: number): { angle: number; omega: number } {
  const last = plan.samples.length - 1
  const f = Math.max(0, Math.min(last, time / plan.dt))
  const i = Math.min(last - 1, Math.floor(f))
  const a = plan.samples[i]
  const b = plan.samples[i + 1]
  if (time >= plan.duration) return { angle: plan.finalAngle, omega: 0 }
  return { angle: a + (b - a) * (f - i), omega: (b - a) / plan.dt }
}
