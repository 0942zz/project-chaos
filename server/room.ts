import {
  CM_PICK_SECONDS, CM_SEG_ANGLE, TS_COUNT, TS_PICK_SECONDS,
  cmBeginSpin, cmLand, cmPick, createCm, createDon, createGd, createTs,
  donFlip, donLand, gdDrop, gdLand, gdRearm, tsPick,
  type BonusState,
} from '../src/game/logic/bonus'
import { SEGMENTS, SEGMENT_ORDER, WHEEL, isBonus, type SegmentType } from '../src/game/logic/segments'
import { BOARD, GravityBoard, aimToX } from '../src/game/physics/gravityBoard'
import { planFreeSpin, planSpin, type SpinPlan } from '../src/game/physics/wheelSim'
import { createRng, type Rng } from '../src/game/probability/rng'
import { TIMING, type Phase } from '../src/game/state/machine'

export const MAX_PLAYERS = 8
export const START_BALANCE = 1000
const CHIPS = [1, 5, 10, 25, 100]
const TAU = Math.PI * 2
/** CHAOS_FAST=1 shortens the waiting phases (used by the automated test). Animations keep their real length. */
const K = process.env.CHAOS_FAST ? 0.2 : 1
const FORCE: SegmentType[] = (process.env.CHAOS_FORCE ?? '').split(',').filter((t) => t in SEGMENTS) as SegmentType[]

type Bets = Record<SegmentType, number>
const emptyBets = (): Bets => ({ '1': 0, '2': 0, '5': 0, '10': 0, DON: 0, TS: 0, GD: 0, CM: 0 })

export interface Member {
  id: number
  name: string
  hasAvatar: boolean
  connected: boolean
  bets: Bets
  log: { spot: SegmentType; amount: number }[]
}

export interface RoundRecord {
  userId: number
  room: string
  round: number
  result: SegmentType
  multiplier: number
  stake: number
  win: number
}

/**
 * One multiplayer table. The server owns every decision: bets are validated
 * against the shared wallet here, outcomes are drawn here, and clients only
 * receive state to display.
 */
export class Room {
  members = new Map<number, Member>()
  hostId: number
  started = false
  phase: Phase = 'IDLE'
  phaseAt = performance.now()
  round = 1
  balance = START_BALANCE
  history: SegmentType[] = []
  wheelAngle = 0.5 * (TAU / WHEEL.length)
  bettingEndsAt = 0
  spin: SpinPlan | null = null
  spinAt = 0
  result: { index: number; type: SegmentType } | null = null
  bonus: BonusState | null = null
  bonusSpin: SpinPlan | null = null
  bonusSpinAt = 0
  bonusMultiplier: number | null = null
  lastWin = 0
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private rng: Rng = createRng(crypto.getRandomValues(new Uint32Array(1))[0])

  constructor(
    readonly code: string,
    host: { id: number; name: string; hasAvatar: boolean },
    private onChange: (room: Room) => void,
    private record: (rows: RoundRecord[]) => void,
  ) {
    this.hostId = host.id
    this.join(host)
  }

  /* ───────── membership ───────── */

  join(user: { id: number; name: string; hasAvatar: boolean }): string | null {
    const existing = this.members.get(user.id)
    if (existing) {
      existing.connected = true
      existing.hasAvatar = user.hasAvatar
      this.onChange(this)
      return null
    }
    if (this.members.size >= MAX_PLAYERS) return `This room is full (${MAX_PLAYERS} players).`
    this.members.set(user.id, { ...user, connected: true, bets: emptyBets(), log: [] })
    this.onChange(this)
    return null
  }

  /** `gone` removes the player; otherwise they are only marked offline and may reconnect. */
  drop(userId: number, gone: boolean): void {
    const m = this.members.get(userId)
    if (!m) return
    m.connected = false
    if (gone) {
      // Stakes already placed stay in play for the team.
      if (this.phase === 'BETTING' || !this.started) this.refund(m)
      this.members.delete(userId)
    }
    if (this.hostId === userId || !this.members.get(this.hostId)?.connected) {
      const next = [...this.members.values()].find((p) => p.connected)
      if (next) this.hostId = next.id
    }
    this.onChange(this)
  }

  get empty(): boolean {
    return this.members.size === 0
  }

  get anyoneConnected(): boolean {
    return [...this.members.values()].some((m) => m.connected)
  }

  /* ───────── round lifecycle ───────── */

  private after(seconds: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t)
      fn()
    }, seconds * 1000)
    this.timers.add(t)
  }

  private setPhase(phase: Phase): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    this.phase = phase
    this.phaseAt = performance.now()
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
  }

  start(userId: number): string | null {
    if (userId !== this.hostId) return 'Only the host can start the game.'
    if (this.started) return null
    this.started = true
    this.beginBetting()
    return null
  }

  private beginBetting(): void {
    this.setPhase('BETTING')
    for (const m of this.members.values()) {
      m.bets = emptyBets()
      m.log = []
    }
    this.result = null
    this.bonus = null
    this.spin = null
    this.bonusSpin = null
    this.bonusMultiplier = null
    this.lastWin = 0
    const seconds = TIMING.betting * K
    this.bettingEndsAt = performance.now() + seconds * 1000
    this.after(seconds, () => this.lock())
    this.onChange(this)
  }

  private lock(): void {
    if (this.phase !== 'BETTING') return
    this.setPhase('LOCKED')
    this.after(TIMING.locked * K, () => this.spinWheel())
    this.onChange(this)
  }

  private spinWheel(): void {
    if (this.phase !== 'LOCKED') return
    const plan = planSpin(this.rng, this.wheelAngle % TAU, FORCE.shift() ?? null)
    this.spin = plan
    this.spinAt = performance.now()
    this.setPhase('SPINNING')
    this.after(plan.decelAt, () => {
      this.setPhase('DECELERATING')
      this.after(plan.duration - plan.decelAt + 0.35, () => this.resolve())
      this.onChange(this)
    })
    this.onChange(this)
  }

  private teamBets(): Bets {
    const total = emptyBets()
    for (const m of this.members.values()) for (const t of SEGMENT_ORDER) total[t] += m.bets[t]
    return total
  }

  private resolve(): void {
    if (this.phase !== 'DECELERATING' || !this.spin) return
    const index = this.spin.finalIndex
    const type = WHEEL[index]
    this.result = { index, type }
    this.wheelAngle = this.spin.finalAngle % TAU
    this.history = [type, ...this.history].slice(0, 14)
    this.lastWin = 0
    if (!isBonus(type)) this.pay(type, SEGMENTS[type].payout)
    this.setPhase('RESULT')
    this.after(TIMING.result * K, () => {
      if (isBonus(type)) {
        this.setPhase('BONUS_INTRO')
        this.after(TIMING.bonusIntro * K, () => this.startBonus())
      } else this.completeRound(false)
      this.onChange(this)
    })
    this.onChange(this)
  }

  /** Credits the shared wallet exactly once per round and writes each player's history row. */
  private pay(type: SegmentType, multiplier: number): void {
    const rows: RoundRecord[] = []
    let win = 0
    for (const m of this.members.values()) {
      const stake = SEGMENT_ORDER.reduce((n, t) => n + m.bets[t], 0)
      const own = m.bets[type] > 0 ? m.bets[type] * (multiplier + 1) : 0
      win += own
      if (stake > 0) rows.push({ userId: m.id, room: this.code, round: this.round, result: type, multiplier, stake, win: own })
    }
    this.balance += win
    this.lastWin = win
    if (rows.length) this.record(rows)
  }

  private completeRound(fromBonus: boolean): void {
    this.setPhase('ROUND_COMPLETE')
    this.after((TIMING.roundComplete + (fromBonus ? 0.4 : 0)) * (fromBonus ? 1 : K), () => {
      this.round += 1
      if (this.anyoneConnected) this.beginBetting()
      else {
        // Nobody is watching: go back to the lobby instead of spinning forever.
        this.started = false
        this.setPhase('IDLE')
        this.onChange(this)
      }
    })
  }

  /* ───────── bonus games ───────── */

  private startBonus(): void {
    if (this.phase !== 'BONUS_INTRO' || !this.result) return
    const type = this.result.type
    const now = performance.now()
    this.setPhase('BONUS_ACTIVE')
    if (type === 'DON') {
      this.bonus = createDon(this.rng)
      this.after(10 * K + 2, () => this.flip())
    } else if (type === 'TS') {
      this.bonus = createTs(this.rng)
      const stage = (status: 'shuffle' | 'pick') => {
        if (this.bonus?.kind !== 'TS') return
        this.bonus = { ...this.bonus, status, pickEndsAt: performance.now() + TS_PICK_SECONDS * 1000 * K }
        this.onChange(this)
      }
      this.after(4.2, () => stage('shuffle'))
      this.after(6.4, () => stage('pick'))
      this.after(6.4 + TS_PICK_SECONDS * K, () => this.pickTarget(this.rng.int(TS_COUNT)))
    } else if (type === 'GD') {
      this.bonus = createGd(this.rng)
      this.after(14 * K + 2, () => void this.dropBall(0.5))
    } else {
      this.bonus = createCm(this.rng, now + 2500)
      this.after(2.5 + CM_PICK_SECONDS * K, () => this.pickPointer(this.rng.int(3)))
    }
    this.onChange(this)
  }

  private finishBonus(multiplier: number): void {
    if (this.phase !== 'BONUS_ACTIVE' || !this.result) return
    this.bonusMultiplier = multiplier
    this.pay(this.result.type, multiplier)
    this.setPhase('BONUS_RESULT')
    this.after(TIMING.bonusResult * K, () => {
      this.completeRound(true)
      this.onChange(this)
    })
    this.onChange(this)
  }

  private flip(): void {
    if (this.phase !== 'BONUS_ACTIVE' || this.bonus?.kind !== 'DON') return
    const next = donFlip(this.bonus, this.rng)
    if (next === this.bonus) return
    this.bonus = next
    this.after(3.3, () => {
      if (this.bonus?.kind !== 'DON') return
      this.bonus = donLand(this.bonus)
      const m = this.bonus.multiplier
      this.after(2.6, () => this.finishBonus(m))
      this.onChange(this)
    })
    this.onChange(this)
  }

  private pickTarget(index: number): void {
    if (this.phase !== 'BONUS_ACTIVE' || this.bonus?.kind !== 'TS') return
    const next = tsPick(this.bonus, index)
    if (next === this.bonus) return
    this.bonus = next
    this.after(4.2, () => this.finishBonus(next.multiplier))
    this.onChange(this)
  }

  /** Runs the same rigid-body simulation the clients animate, to learn the slot and how long the fall lasts. */
  private async dropBall(aim: number): Promise<void> {
    if (this.phase !== 'BONUS_ACTIVE' || this.bonus?.kind !== 'GD' || this.bonus.status !== 'aim') return
    const armed = gdDrop({ ...this.bonus, aim: Math.max(0, Math.min(1, aim)) }, this.rng)
    this.bonus = armed
    this.onChange(this)
    const board = await GravityBoard.create()
    board.drop(aimToX(armed.aim) + armed.jitter)
    let fast = 0
    let slow = 0
    for (let i = 0; i < 240 * 60 && board.landedSlot === null; i++) {
      board.advance(1 / 240)
      if (board.y < BOARD.firstRowY + 0.5) slow += 1 / 240
      else fast += 1 / 240
    }
    const slot = board.landedSlot ?? 4
    board.free()
    // Clients play the final approach in slow motion, so the wait is stretched to match.
    const wait = fast + slow / 0.32 + 1.2
    if (this.phase !== 'BONUS_ACTIVE' || this.bonus !== armed) return
    this.after(wait, () => {
      if (this.bonus?.kind !== 'GD') return
      const next = gdLand(this.bonus, slot)
      this.bonus = next
      if (next.status === 'landed') this.after(2.4, () => this.finishBonus(next.multiplier))
      else
        this.after(2.6, () => {
          if (this.bonus?.kind !== 'GD') return
          this.bonus = gdRearm(this.bonus)
          this.after(14 * K + 2, () => void this.dropBall(0.5))
          this.onChange(this)
        })
      this.onChange(this)
    })
  }

  private pickPointer(p: number): void {
    if (this.phase !== 'BONUS_ACTIVE' || this.bonus?.kind !== 'CM') return
    const next = cmPick(this.bonus, p)
    if (next === this.bonus) return
    this.bonus = next
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    this.after(1.6, () => this.spinGrandWheel())
    this.onChange(this)
  }

  private spinGrandWheel(): void {
    if (this.phase !== 'BONUS_ACTIVE' || this.bonus?.kind !== 'CM') return
    const next = cmBeginSpin(this.bonus)
    if (next === this.bonus) return
    const plan = planFreeSpin(this.rng, this.bonus.angle, CM_SEG_ANGLE)
    this.bonus = next
    this.bonusSpin = plan
    this.bonusSpinAt = performance.now()
    this.after(plan.duration + 0.45, () => {
      if (this.bonus?.kind !== 'CM') return
      const landed = cmLand(this.bonus, plan.finalAngle)
      this.bonus = landed
      if (landed.stage === 'result') this.after(2.8, () => this.finishBonus(landed.multiplier))
      else this.after(3.6, () => this.spinGrandWheel())
      this.onChange(this)
    })
    this.onChange(this)
  }

  /* ───────── player actions (all validated here) ───────── */

  private refund(m: Member): void {
    this.balance += SEGMENT_ORDER.reduce((n, t) => n + m.bets[t], 0)
    m.bets = emptyBets()
    m.log = []
  }

  act(userId: number, msg: Record<string, unknown>): string | null {
    const m = this.members.get(userId)
    if (!m || !this.started) return null
    switch (msg.a) {
      case 'bet': {
        const spot = msg.spot as SegmentType
        const amount = Number(msg.amount)
        if (this.phase !== 'BETTING') return 'Selections are closed.'
        if (!(spot in SEGMENTS) || !CHIPS.includes(amount)) return 'Invalid selection.'
        const stake = Math.min(amount, this.balance)
        if (stake <= 0) return 'The team wallet is empty.'
        this.balance -= stake
        m.bets[spot] += stake
        m.log.push({ spot, amount: stake })
        break
      }
      case 'undo': {
        if (this.phase !== 'BETTING') return null
        const last = m.log.pop()
        if (!last) return null
        m.bets[last.spot] -= last.amount
        this.balance += last.amount
        break
      }
      case 'clear':
        if (this.phase !== 'BETTING') return null
        this.refund(m)
        break
      case 'lock':
        if (userId !== this.hostId) return 'Only the host can spin early.'
        this.lock()
        return null
      case 'topup': {
        const staked = SEGMENT_ORDER.reduce((n, t) => n + this.teamBets()[t], 0)
        if (this.phase !== 'BETTING' || this.balance + staked >= 1) return null
        this.balance = START_BALANCE
        break
      }
      case 'donFlip':
        this.flip()
        return null
      case 'tsPick':
        this.pickTarget(Math.floor(Number(msg.index)))
        return null
      case 'gdDrop':
        void this.dropBall(Number(msg.aim))
        return null
      case 'cmPick':
        this.pickPointer(Math.floor(Number(msg.index)))
        return null
      default:
        return null
    }
    this.onChange(this)
    return null
  }

  /* ───────── what a client is allowed to see ───────── */

  snapshot(userId: number) {
    const now = performance.now()
    let bonus: BonusState | null = this.bonus
    // Never send the hidden layout of the target wall before a target is chosen.
    if (bonus?.kind === 'TS' && bonus.status !== 'done') bonus = { ...bonus, values: bonus.values.map(() => 0) }
    const plan = (p: SpinPlan | null, at: number) => (p ? { startAngle: p.startAngle, omega0: p.omega0, elapsed: now - at } : null)
    return {
      t: 'state' as const,
      now,
      room: {
        code: this.code,
        hostId: this.hostId,
        started: this.started,
        players: [...this.members.values()].map((m) => ({ id: m.id, name: m.name, hasAvatar: m.hasAvatar, connected: m.connected })),
      },
      phase: this.phase,
      phaseAge: now - this.phaseAt,
      round: this.round,
      balance: this.balance,
      bets: this.teamBets(),
      myBets: this.members.get(userId)?.bets ?? emptyBets(),
      bettingLeft: this.bettingEndsAt - now,
      wheelAngle: this.wheelAngle,
      spin: plan(this.spin, this.spinAt),
      result: this.result,
      history: this.history,
      bonus,
      bonusSpin: plan(this.bonusSpin, this.bonusSpinAt),
      bonusMultiplier: this.bonusMultiplier,
      lastWin: this.lastWin,
    }
  }
}

export type Snapshot = ReturnType<Room['snapshot']>
