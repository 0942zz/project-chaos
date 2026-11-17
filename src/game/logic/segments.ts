export type NumberType = '1' | '2' | '5' | '10'
export type BonusType = 'DON' | 'TS' | 'GD' | 'CM'
export type SegmentType = NumberType | BonusType

export interface SegmentInfo {
  type: SegmentType
  /** Text on the wheel. */
  label: string
  /** Full name used in the interface. */
  name: string
  color: string
  glow: string
  text: string
  bonus: boolean
  /** Number segments pay `payout`:1. Bonus segments pay the multiplier won in the bonus game. */
  payout: number
}

export const SEGMENT_ORDER: readonly SegmentType[] = ['1', '2', '5', '10', 'DON', 'TS', 'GD', 'CM']

export const SEGMENTS: Record<SegmentType, SegmentInfo> = {
  '1': { type: '1', label: '1', name: '1', color: '#15151c', glow: '#f5c867', text: '#f5c867', bonus: false, payout: 1 },
  '2': { type: '2', label: '2', name: '2', color: '#0c7a52', glow: '#2dffb0', text: '#eafff6', bonus: false, payout: 2 },
  '5': { type: '5', label: '5', name: '5', color: '#1746c9', glow: '#5c92ff', text: '#eef3ff', bonus: false, payout: 5 },
  '10': { type: '10', label: '10', name: '10', color: '#b0122c', glow: '#ff4a68', text: '#fff0f2', bonus: false, payout: 10 },
  DON: { type: 'DON', label: 'DOUBLE', name: 'Double', color: '#d9a21b', glow: '#ffd75e', text: '#1a1203', bonus: true, payout: 0 },
  TS: { type: 'TS', label: 'TREASURE', name: 'Treasure', color: '#0a9fb8', glow: '#49ecff', text: '#04161a', bonus: true, payout: 0 },
  GD: { type: 'GD', label: 'GRAVITY', name: 'Gravity', color: '#b51fa6', glow: '#ff5cf0', text: '#fff0fe', bonus: true, payout: 0 },
  CM: { type: 'CM', label: 'CHAOS', name: 'Chaos', color: '#efe9dc', glow: '#ffffff', text: '#7a1dd1', bonus: true, payout: 0 },
}

/**
 * How many pockets of each kind sit on the wheel. Probabilities derive only
 * from this table: every pocket has the same angular width, so
 * P(type) = count / total. Edit to re-balance the game.
 */
export const WHEEL_COUNTS: Record<SegmentType, number> = {
  '1': 21,
  '2': 13,
  '5': 7,
  '10': 4,
  DON: 4,
  TS: 2,
  GD: 2,
  CM: 1,
}

/**
 * Lays the pockets out around the rim. Bonus pockets go down first, evenly
 * spaced and interleaved by type, so two bonuses are never neighbours (also
 * across the seam between the last and first pocket). Numbers then fill the
 * gaps, each type spread as evenly as possible.
 */
export function buildWheel(counts: Record<SegmentType, number>): SegmentType[] {
  const total = SEGMENT_ORDER.reduce((n, t) => n + counts[t], 0)
  const slots: (SegmentType | null)[] = new Array(total).fill(null)
  const place = (type: SegmentType, ideal: number) => {
    for (let d = 0; d < total; d++) {
      const a = (((ideal + d) % total) + total) % total
      const b = (((ideal - d) % total) + total) % total
      if (slots[a] === null) { slots[a] = type; return }
      if (slots[b] === null) { slots[b] = type; return }
    }
  }

  // Interleave bonus types (most frequent first) so identical bonuses are far apart too.
  const pool = SEGMENT_ORDER.filter((t) => SEGMENTS[t].bonus).map((t) => ({ t, left: counts[t], credit: 0 }))
  const bonusTotal = pool.reduce((n, p) => n + p.left, 0)
  const sequence: SegmentType[] = []
  for (let i = 0; i < bonusTotal; i++) {
    pool.forEach((p) => (p.credit += p.left > 0 ? counts[p.t] / bonusTotal : 0))
    const next = pool.filter((p) => p.left > 0).sort((x, y) => y.credit - x.credit)[0]
    next.credit -= 1
    next.left -= 1
    sequence.push(next.t)
  }
  if (bonusTotal * 2 > total) throw new Error('Too many bonus pockets to keep them apart')
  sequence.forEach((t, i) => (slots[Math.floor((i * total) / bonusTotal)] = t))

  const numbers = SEGMENT_ORDER.filter((t) => !SEGMENTS[t].bonus).sort((x, y) => counts[x] - counts[y])
  numbers.forEach((type, oi) => {
    for (let k = 0; k < counts[type]; k++) place(type, Math.round(oi * 2.6 + 1 + (k * total) / counts[type]))
  })
  return slots as SegmentType[]
}

export const WHEEL: readonly SegmentType[] = buildWheel(WHEEL_COUNTS)
export const SEGMENT_COUNT = WHEEL.length
export const SEG_ANGLE = (Math.PI * 2) / SEGMENT_COUNT

const TAU = Math.PI * 2
export const mod = (a: number, n: number): number => ((a % n) + n) % n

/**
 * The single source of truth for results. `angle` is the wheel's clockwise
 * rotation in radians; pocket i spans [i, i+1) * SEG_ANGLE under the pointer.
 */
export function indexAtAngle(angle: number): number {
  return Math.min(SEGMENT_COUNT - 1, Math.floor(mod(angle, TAU) / SEG_ANGLE))
}

export function probabilityOf(type: SegmentType): number {
  return WHEEL_COUNTS[type] / SEGMENT_COUNT
}

export const isBonus = (t: SegmentType): t is BonusType => SEGMENTS[t].bonus
