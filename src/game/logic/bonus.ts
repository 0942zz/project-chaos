import type { Rng } from '../probability/rng'

/* ───────────────────────── DOUBLE OR NOTHING ───────────────────────── */

export type CoinSide = 'SUN' | 'MOON'

export interface DonState {
  kind: 'DON'
  multiplier: number
  tosses: number
  maxTosses: number
  pick: CoinSide | null
  /** Decided by the RNG before the coin leaves the pedestal. */
  outcome: CoinSide | null
  tossId: number
  status: 'choose' | 'flipping' | 'won' | 'lost' | 'banked' | 'maxed'
}

export const DON_START = 2
export const DON_FLOOR = 1

export function createDon(): DonState {
  return { kind: 'DON', multiplier: DON_START, tosses: 0, maxTosses: 5, pick: null, outcome: null, tossId: 0, status: 'choose' }
}

export function donToss(s: DonState, pick: CoinSide, rng: Rng): DonState {
  if (s.status !== 'choose' && s.status !== 'won') return s
  const outcome: CoinSide = rng.next() < 0.5 ? 'SUN' : 'MOON'
  return { ...s, pick, outcome, tossId: s.tossId + 1, status: 'flipping' }
}

export function donLand(s: DonState): DonState {
  if (s.status !== 'flipping') return s
  if (s.outcome === s.pick) {
    const tosses = s.tosses + 1
    return { ...s, multiplier: s.multiplier * 2, tosses, status: tosses >= s.maxTosses ? 'maxed' : 'won' }
  }
  return { ...s, multiplier: DON_FLOOR, tosses: s.tosses + 1, status: 'lost' }
}

/* ───────────────────────── TREASURE STORM ───────────────────────── */

export const TS_COLS = 12
export const TS_ROWS = 5
export const TS_COUNT = TS_COLS * TS_ROWS
export const TS_PICKS = 3

const TS_TABLE: readonly [value: number, count: number][] = [
  [1, 14], [2, 14], [3, 10], [4, 7], [5, 6], [8, 4], [10, 2], [15, 1], [25, 1], [50, 1],
]

export interface TsState {
  kind: 'TS'
  /** Every vault's content is fixed when the bonus starts. */
  values: number[]
  picks: number[]
  picksLeft: number
  total: number
  status: 'pick' | 'done'
}

export function createTs(rng: Rng): TsState {
  const values: number[] = []
  for (const [v, c] of TS_TABLE) for (let i = 0; i < c; i++) values.push(v)
  return { kind: 'TS', values: rng.shuffle(values), picks: [], picksLeft: TS_PICKS, total: 0, status: 'pick' }
}

export function tsPick(s: TsState, index: number): TsState {
  if (s.status !== 'pick' || s.picks.includes(index) || index < 0 || index >= s.values.length) return s
  const picksLeft = s.picksLeft - 1
  return { ...s, picks: [...s.picks, index], picksLeft, total: s.total + s.values[index], status: picksLeft === 0 ? 'done' : 'pick' }
}

/* ───────────────────────── GRAVITY DROP ───────────────────────── */

export const GD_SLOTS = 9

export interface GdState {
  kind: 'GD'
  slots: number[]
  /** Launch position across the top of the board, 0..1. */
  aim: number
  /** Tiny RNG-drawn offset applied to the release point. */
  jitter: number
  status: 'aim' | 'dropping' | 'landed'
  slot: number | null
  multiplier: number
}

export function createGd(rng: Rng): GdState {
  return {
    kind: 'GD',
    slots: rng.shuffle([2, 3, 3, 5, 5, 8, 10, 15, 30]),
    aim: 0.5,
    jitter: 0,
    status: 'aim',
    slot: null,
    multiplier: 0,
  }
}

export function gdDrop(s: GdState, rng: Rng): GdState {
  if (s.status !== 'aim') return s
  return { ...s, jitter: rng.range(-0.04, 0.04), status: 'dropping' }
}

export function gdLand(s: GdState, slot: number): GdState {
  if (s.status !== 'dropping') return s
  const i = Math.max(0, Math.min(GD_SLOTS - 1, slot))
  return { ...s, status: 'landed', slot: i, multiplier: s.slots[i] }
}

/* ───────────────────────── CHAOS MODE ───────────────────────── */

export interface Shard {
  kind: 'mul' | 'add' | 'void'
  value: number
  label: string
}

export interface CometRun {
  /** Angle (radians) at `startedAt` while cruising. */
  startAngle: number
  startedAt: number
  /** Set once the player hits STOP. */
  stopAngle: number | null
  stoppedAt: number | null
  decel: number
  finalAngle: number | null
  finalIndex: number | null
}

export interface CmState {
  kind: 'CM'
  cores: number[]
  picked: number | null
  multiplier: number
  stage: 'select' | 'reveal' | 'surge' | 'stopping' | 'applied' | 'decide' | 'done'
  ring: Shard[]
  surges: number
  maxSurges: number
  comet: CometRun | null
  lastShard: number | null
}

export const CM_SHARDS = 8
export const CM_COMET_SPEED = 4.4
export const CM_SHARD_ANGLE = (Math.PI * 2) / CM_SHARDS
const TAU = Math.PI * 2

const mul = (v: number): Shard => ({ kind: 'mul', value: v, label: `×${v}` })
const add = (v: number): Shard => ({ kind: 'add', value: v, label: `+${v}` })
const VOID: Shard = { kind: 'void', value: 0.5, label: 'VOID' }

function buildRing(surge: number, rng: Rng): Shard[] {
  const sets: Shard[][] = [
    [mul(2), add(5), mul(1.5), add(10), mul(2), add(5), mul(3), add(15)],
    [mul(2), VOID, mul(3), add(20), mul(2), VOID, mul(4), add(10)],
    [mul(3), VOID, mul(5), VOID, mul(2), add(50), VOID, mul(3)],
  ]
  return rng.shuffle(sets[Math.min(surge, sets.length - 1)])
}

export function createCm(rng: Rng): CmState {
  return {
    kind: 'CM',
    cores: rng.shuffle([8, 12, 16, 25]),
    picked: null,
    multiplier: 0,
    stage: 'select',
    ring: buildRing(0, rng),
    surges: 0,
    maxSurges: 3,
    comet: null,
    lastShard: null,
  }
}

export function cmPick(s: CmState, i: number): CmState {
  if (s.stage !== 'select' || i < 0 || i >= s.cores.length) return s
  return { ...s, picked: i, multiplier: s.cores[i], stage: 'reveal' }
}

export function cmBeginSurge(s: CmState, now: number, rng: Rng): CmState {
  if (s.stage !== 'reveal' && s.stage !== 'decide') return s
  const ring = s.stage === 'decide' ? buildRing(s.surges, rng) : s.ring
  return {
    ...s,
    ring,
    stage: 'surge',
    lastShard: null,
    comet: { startAngle: rng.range(0, TAU), startedAt: now, stopAngle: null, stoppedAt: null, decel: 0, finalAngle: null, finalIndex: null },
  }
}

/** Angle of the comet at `now`, for both cruising and braking. Pure function of time. */
export function cometAngle(c: CometRun, now: number): number {
  if (c.stoppedAt === null || c.stopAngle === null) {
    return c.startAngle + (CM_COMET_SPEED * (now - c.startedAt)) / 1000
  }
  const tStop = CM_COMET_SPEED / c.decel
  const t = Math.min(tStop, (now - c.stoppedAt) / 1000)
  return c.stopAngle + CM_COMET_SPEED * t - 0.5 * c.decel * t * t
}

export const cometBrakeTime = (c: CometRun): number => (c.decel > 0 ? CM_COMET_SPEED / c.decel : 0)

/** Shard i spans [i, i+1) * CM_SHARD_ANGLE. */
export function shardAtAngle(angle: number): number {
  const a = ((angle % TAU) + TAU) % TAU
  return Math.min(CM_SHARDS - 1, Math.floor(a / CM_SHARD_ANGLE))
}

/** The player's timing fixes the stop angle; the RNG fixes the braking force. Together they fix the shard. */
export function cmStop(s: CmState, now: number, rng: Rng): CmState {
  if (s.stage !== 'surge' || !s.comet) return s
  const stopAngle = cometAngle(s.comet, now)
  const decel = rng.range(1.5, 2.6)
  let finalAngle = stopAngle + (CM_COMET_SPEED * CM_COMET_SPEED) / (2 * decel)
  // Never rest exactly on a divider between two shards.
  const frac = (((finalAngle % CM_SHARD_ANGLE) + CM_SHARD_ANGLE) % CM_SHARD_ANGLE) / CM_SHARD_ANGLE
  let d = decel
  if (frac < 0.06 || frac > 0.94) {
    finalAngle += CM_SHARD_ANGLE * 0.1
    d = (CM_COMET_SPEED * CM_COMET_SPEED) / (2 * (finalAngle - stopAngle))
  }
  return {
    ...s,
    stage: 'stopping',
    comet: { ...s.comet, stopAngle, stoppedAt: now, decel: d, finalAngle, finalIndex: shardAtAngle(finalAngle) },
  }
}

export function applyShard(multiplier: number, shard: Shard): number {
  if (shard.kind === 'mul') return Math.round(multiplier * shard.value)
  if (shard.kind === 'add') return multiplier + shard.value
  return Math.max(1, Math.ceil(multiplier * shard.value))
}

export function cmLand(s: CmState): CmState {
  if (s.stage !== 'stopping' || !s.comet || s.comet.finalIndex === null) return s
  const idx = s.comet.finalIndex
  const surges = s.surges + 1
  return { ...s, multiplier: applyShard(s.multiplier, s.ring[idx]), lastShard: idx, surges, stage: 'applied' }
}

export function cmAfterApply(s: CmState): CmState {
  if (s.stage !== 'applied') return s
  return { ...s, stage: s.surges >= s.maxSurges ? 'done' : 'decide' }
}

export const JACKPOT_THRESHOLD = 100

export type BonusState = DonState | TsState | GdState | CmState
