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
  DON: { type: 'DON', label: 'DOUBLE', name: 'Double or Nothing', color: '#d9a21b', glow: '#ffd75e', text: '#1a1203', bonus: true, payout: 0 },
  TS: { type: 'TS', label: 'TREASURE', name: 'Treasure Storm', color: '#0a9fb8', glow: '#49ecff', text: '#04161a', bonus: true, payout: 0 },
  GD: { type: 'GD', label: 'GRAVITY', name: 'Gravity Drop', color: '#b51fa6', glow: '#ff5cf0', text: '#fff0fe', bonus: true, payout: 0 },
  CM: { type: 'CM', label: 'CHAOS', name: 'Chaos Mode', color: '#efe9dc', glow: '#ffffff', text: '#7a1dd1', bonus: true, payout: 0 },
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

/** Spreads each type as evenly as possible around the rim (rarest placed first). */
export function buildWheel(counts: Record<SegmentType, number>): SegmentType[] {
  const total = SEGMENT_ORDER.reduce((n, t) => n + counts[t], 0)
  const slots: (SegmentType | null)[] = new Array(total).fill(null)
  const order = [...SEGMENT_ORDER].sort((a, b) => counts[a] - counts[b])
  order.forEach((type, oi) => {
    const c = counts[type]
    const offset = oi * 3.37 + 0.5
    for (let k = 0; k < c; k++) {
      const ideal = Math.round(offset + (k * total) / c) % total
      for (let d = 0; d < total; d++) {
        const a = (ideal + d) % total
        const b = (ideal - d + total) % total
        if (slots[a] === null) { slots[a] = type; break }
        if (slots[b] === null) { slots[b] = type; break }
      }
    }
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
