import type { Rng } from '../probability/rng'

const TAU = Math.PI * 2

function weighted<T>(rng: Rng, table: readonly (readonly [T, number])[]): T {
  const total = table.reduce((n, [, w]) => n + w, 0)
  let r = rng.next() * total
  for (const [v, w] of table) {
    r -= w
    if (r < 0) return v
  }
  return table[table.length - 1][0]
}

/* ───────────────────────── DOUBLE — coin flip ─────────────────────────
 * Each face of the coin is given its own multiplier, then the coin is tossed.
 * The face that lands up pays its multiplier. */

export type CoinSide = 'SUN' | 'MOON'

export interface DonState {
  kind: 'DON'
  sun: number
  moon: number
  /** Decided by the RNG before the coin leaves the pedestal. */
  outcome: CoinSide | null
  tossId: number
  multiplier: number
  status: 'ready' | 'flipping' | 'done'
}

const COIN_TABLE = [[2, 22], [3, 20], [4, 16], [5, 14], [8, 10], [10, 8], [15, 5], [20, 3], [25, 2], [50, 1], [100, 0.4]] as const

export function createDon(rng: Rng): DonState {
  const sun = weighted(rng, COIN_TABLE)
  let moon = weighted(rng, COIN_TABLE)
  for (let i = 0; i < 20 && moon === sun; i++) moon = weighted(rng, COIN_TABLE)
  return { kind: 'DON', sun, moon, outcome: null, tossId: 0, multiplier: 0, status: 'ready' }
}

export function donFlip(s: DonState, rng: Rng): DonState {
  if (s.status !== 'ready') return s
  return { ...s, outcome: rng.next() < 0.5 ? 'SUN' : 'MOON', tossId: s.tossId + 1, status: 'flipping' }
}

export function donLand(s: DonState): DonState {
  if (s.status !== 'flipping' || !s.outcome) return s
  return { ...s, multiplier: s.outcome === 'SUN' ? s.sun : s.moon, status: 'done' }
}

/* ───────────────────────── TREASURE — target wall ─────────────────────────
 * The wall shows its multipliers, covers them, shuffles, and the player has a
 * few seconds to choose one target. That target's multiplier is the prize. */

export const TS_COLS = 12
export const TS_ROWS = 5
export const TS_COUNT = TS_COLS * TS_ROWS
export const TS_PICK_SECONDS = 12

const TS_TABLE: readonly [value: number, count: number][] = [
  [5, 14], [7, 12], [10, 10], [15, 8], [20, 6], [25, 4], [50, 3], [75, 2], [100, 1],
]

export interface TsState {
  kind: 'TS'
  /** Layout shown before the shuffle. */
  preview: number[]
  /** Where every multiplier really is once the wall has been covered and shuffled. */
  values: number[]
  pick: number | null
  pickEndsAt: number
  multiplier: number
  status: 'preview' | 'shuffle' | 'pick' | 'done'
}

export function createTs(rng: Rng): TsState {
  const all: number[] = []
  for (const [v, c] of TS_TABLE) for (let i = 0; i < c; i++) all.push(v)
  return { kind: 'TS', preview: rng.shuffle(all), values: rng.shuffle(all), pick: null, pickEndsAt: 0, multiplier: 0, status: 'preview' }
}

export function tsPick(s: TsState, index: number): TsState {
  if (s.status !== 'pick' || index < 0 || index >= s.values.length) return s
  return { ...s, pick: index, multiplier: s.values[index], status: 'done' }
}

/* ───────────────────────── GRAVITY — pin board ─────────────────────────
 * A ball falls through the pins into a slot. Multiplier slots pay; a DOUBLE
 * slot doubles every multiplier on the board and the ball is dropped again. */

export const GD_SLOTS = 9
export const GD_DOUBLE = 0
export const GD_MAX_DOUBLES = 3

export interface GdState {
  kind: 'GD'
  /** Multiplier per slot; `GD_DOUBLE` marks a DOUBLE slot. */
  slots: number[]
  aim: number
  jitter: number
  dropId: number
  doubles: number
  status: 'aim' | 'dropping' | 'doubling' | 'landed'
  slot: number | null
  multiplier: number
}

export function createGd(rng: Rng): GdState {
  return {
    kind: 'GD',
    slots: rng.shuffle([7, 10, 15, 20, 25, 35, 50, GD_DOUBLE, GD_DOUBLE]),
    aim: 0.5, jitter: 0, dropId: 0, doubles: 0, status: 'aim', slot: null, multiplier: 0,
  }
}

export function gdDrop(s: GdState, rng: Rng): GdState {
  if (s.status !== 'aim') return s
  return { ...s, jitter: rng.range(-0.04, 0.04), dropId: s.dropId + 1, status: 'dropping' }
}

export function gdLand(s: GdState, slot: number): GdState {
  if (s.status !== 'dropping') return s
  const i = Math.max(0, Math.min(GD_SLOTS - 1, slot))
  if (s.slots[i] !== GD_DOUBLE) return { ...s, status: 'landed', slot: i, multiplier: s.slots[i] }
  const doubles = s.doubles + 1
  let slots = s.slots.map((v) => v * 2)
  // After the last allowed double the DOUBLE slots turn into the top prize.
  if (doubles >= GD_MAX_DOUBLES) {
    const top = Math.max(...slots)
    slots = slots.map((v) => (v === GD_DOUBLE ? top : v))
  }
  return { ...s, slots, doubles, slot: i, status: 'doubling' }
}

export function gdRearm(s: GdState): GdState {
  return s.status === 'doubling' ? { ...s, status: 'aim', slot: null } : s
}

/* ───────────────────────── CHAOS — grand wheel ─────────────────────────
 * The player backs one of three pointers, then the grand wheel is spun. The
 * segment under their pointer pays. DOUBLE / TRIPLE multiply the whole wheel
 * and trigger another spin. */

export const CM_SEGMENTS = 48
export const CM_SEG_ANGLE = TAU / CM_SEGMENTS
export const CM_DOUBLE = -2
export const CM_TRIPLE = -3
export const CM_MAX_BOOSTS = 3
export const CM_PICK_SECONDS = 12
/** Pointer positions, in segments counter-clockwise from the top of the wheel. */
export const CM_POINTER_OFFSETS = [6, 0, -6] as const
export const CM_POINTER_NAMES = ['Azure', 'Gold', 'Rose'] as const
export const CM_POINTER_COLORS = ['#49ecff', '#ffd75e', '#ff5cf0'] as const

export interface CmState {
  kind: 'CM'
  wheel: number[]
  pick: number | null
  pickEndsAt: number
  stage: 'pick' | 'spinning' | 'boost' | 'result'
  spinId: number
  /** Resting angle of the grand wheel (radians, clockwise). */
  angle: number
  landed: number[] | null
  boosts: number
  lastBoost: number
  multiplier: number
}

export function createCm(rng: Rng, now: number): CmState {
  const wheel: number[] = []
  const table: [number, number][] = [[10, 12], [15, 9], [20, 8], [25, 6], [50, 5], [100, 3], [CM_DOUBLE, 4], [CM_TRIPLE, 1]]
  for (const [v, c] of table) for (let i = 0; i < c; i++) wheel.push(v)
  return {
    kind: 'CM', wheel: rng.shuffle(wheel), pick: null, pickEndsAt: now + CM_PICK_SECONDS * 1000, stage: 'pick',
    spinId: 0, angle: CM_SEG_ANGLE / 2, landed: null, boosts: 0, lastBoost: 0, multiplier: 0,
  }
}

/** Which segment sits under pointer `p` when the wheel rests at `angle`. */
export function cmSegmentAt(angle: number, p: number): number {
  const a = (((angle + CM_POINTER_OFFSETS[p] * CM_SEG_ANGLE) % TAU) + TAU) % TAU
  return Math.min(CM_SEGMENTS - 1, Math.floor(a / CM_SEG_ANGLE))
}

export function cmPick(s: CmState, p: number): CmState {
  if (s.stage !== 'pick' || s.pick !== null || p < 0 || p > 2) return s
  return { ...s, pick: p }
}

export function cmBeginSpin(s: CmState): CmState {
  if (s.pick === null || (s.stage !== 'pick' && s.stage !== 'boost')) return s
  return { ...s, stage: 'spinning', spinId: s.spinId + 1, landed: null }
}

/** Resolves a finished spin from the wheel's physical resting angle. */
export function cmLand(s: CmState, finalAngle: number): CmState {
  if (s.stage !== 'spinning' || s.pick === null) return s
  const landed = [0, 1, 2].map((p) => cmSegmentAt(finalAngle, p))
  const value = s.wheel[landed[s.pick]]
  const angle = finalAngle % TAU
  if (value > 0) return { ...s, angle, landed, multiplier: value, stage: 'result' }
  const factor = -value
  const boosts = s.boosts + 1
  let wheel = s.wheel.map((v) => (v > 0 ? Math.min(v * factor, 10000) : v))
  if (boosts >= CM_MAX_BOOSTS) {
    const top = Math.max(...wheel)
    wheel = wheel.map((v) => (v > 0 ? v : top))
  }
  return { ...s, angle, landed, wheel, boosts, lastBoost: factor, stage: 'boost' }
}

export const JACKPOT_THRESHOLD = 100

export type BonusState = DonState | TsState | GdState | CmState
