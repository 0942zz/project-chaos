import { create } from 'zustand'
import { rng } from '../engine/session'
import {
  CM_PICK_SECONDS, CM_SEG_ANGLE, TS_COUNT, TS_PICK_SECONDS,
  cmBeginSpin, cmLand, cmPick, createCm, createDon, createGd, createTs,
  donFlip, donLand, gdDrop, gdLand, gdRearm, tsPick,
  type BonusState,
} from '../logic/bonus'
import { SEGMENTS, SEGMENT_ORDER, WHEEL, isBonus, type BonusType, type SegmentType } from '../logic/segments'
import { planFreeSpin, planSpin, type SpinPlan } from '../physics/wheelSim'
import { canTransition, type Phase } from './machine'

export type Bets = Record<SegmentType, number>
export type Quality = 'auto' | 'ultra' | 'high' | 'performance'
export type Tier = 'ultra' | 'high' | 'low'
const tierOf = (q: Exclude<Quality, 'auto'>): Tier => (q === 'performance' ? 'low' : q)
export type SceneId = 'studio' | BonusType

const emptyBets = (): Bets => ({ '1': 0, '2': 0, '5': 0, '10': 0, DON: 0, TS: 0, GD: 0, CM: 0 })
export const totalOf = (b: Bets): number => SEGMENT_ORDER.reduce((n, t) => n + b[t], 0)

export const CHIPS = [1, 5, 10, 25, 100] as const
export const START_BALANCE = 1000

export interface RoundResult {
  index: number
  type: SegmentType
}

export interface GameStore {
  phase: Phase
  phaseStartedAt: number
  round: number
  balance: number
  bets: Bets
  lastBets: Bets
  betLog: { spot: SegmentType; amount: number }[]
  chip: number
  bettingEndsAt: number
  spin: SpinPlan | null
  spinStartedAt: number
  /** Resting angle of the wheel between spins (radians, clockwise). */
  wheelAngle: number
  result: RoundResult | null
  history: SegmentType[]
  bonus: BonusState | null
  bonusMultiplier: number | null
  /** Credits returned to the player this round (stake included). */
  lastWin: number
  scene: SceneId
  curtain: boolean
  ready: boolean
  forced: SegmentType | null
  settings: { music: number; sfx: number; ambient: number; quality: Quality }
  tier: Tier
  /** Physics plan of the grand wheel in the CHAOS bonus. */
  bonusSpin: SpinPlan | null
  bonusSpinStartedAt: number
  /** 'mp' = a LAN table: the server owns the state and this store only mirrors it. */
  mode: 'sp' | 'mp'
  send: ((action: Record<string, unknown>) => void) | null

  go: (to: Phase) => boolean
  enter: () => void
  placeBet: (spot: SegmentType) => void
  undoBet: () => void
  clearBets: () => void
  rebet: () => void
  doubleBets: () => void
  setChip: (c: number) => void
  setBettingEndsAt: (t: number) => void
  lockNow: () => void
  startSpin: () => void
  resolveSpin: () => void
  startBonus: () => void
  finishBonus: (multiplier: number) => void
  nextRound: () => void
  topUp: () => void
  setScene: (s: SceneId) => void
  setCurtain: (c: boolean) => void
  setForced: (t: SegmentType | null) => void
  setVolume: (bus: 'music' | 'sfx' | 'ambient', v: number) => void
  setQuality: (q: Quality) => void
  setTier: (t: Tier) => void

  donFlip: () => void
  donLand: () => void
  tsPick: (i: number) => void
  gdAim: (aim: number) => void
  gdDrop: () => void
  gdLand: (slot: number) => void
  cmPick: (i: number) => void
  cmSpin: () => void
  cmLand: () => void
}

const later = (ms: number, fn: () => void) => window.setTimeout(fn, ms)

export const useGame = create<GameStore>()((set, get) => {
  /** Runs `fn` only if the same bonus instance is still being played. */
  const bonusLater = (ms: number, fn: () => void) => {
    const round = get().round
    later(ms, () => {
      const s = get()
      if (s.round === round && s.phase === 'BONUS_ACTIVE') fn()
    })
  }

  return {
    phase: 'IDLE',
    phaseStartedAt: performance.now(),
    round: 1,
    balance: START_BALANCE,
    bets: emptyBets(),
    lastBets: emptyBets(),
    betLog: [],
    chip: 10,
    bettingEndsAt: 0,
    spin: null,
    spinStartedAt: 0,
    wheelAngle: 0.5 * ((Math.PI * 2) / WHEEL.length),
    result: null,
    history: [],
    bonus: null,
    bonusMultiplier: null,
    lastWin: 0,
    scene: 'studio',
    curtain: false,
    ready: false,
    forced: null,
    settings: { music: 0.55, sfx: 0.8, ambient: 0.5, quality: 'auto' },
    tier: 'high',
    bonusSpin: null,
    bonusSpinStartedAt: 0,
    mode: 'sp',
    send: null,

    go: (to) => {
      if (get().mode === 'mp') return false
      const from = get().phase
      if (!canTransition(from, to)) {
        console.warn(`[chaos] rejected transition ${from} → ${to}`)
        return false
      }
      set({ phase: to, phaseStartedAt: performance.now() })
      return true
    },

    enter: () => {
      if (get().phase !== 'IDLE') return
      set({ ready: true })
      get().go('BETTING')
    },

    placeBet: (spot) => {
      const s = get()
      if (s.mode === 'mp') return void s.send?.({ a: 'bet', spot, amount: s.chip })
      if (s.phase !== 'BETTING') return
      const amount = Math.min(s.chip, s.balance)
      if (amount <= 0) return
      set({
        balance: s.balance - amount,
        bets: { ...s.bets, [spot]: s.bets[spot] + amount },
        betLog: [...s.betLog, { spot, amount }],
      })
    },

    undoBet: () => {
      const s = get()
      if (s.mode === 'mp') return void s.send?.({ a: 'undo' })
      if (s.phase !== 'BETTING' || s.betLog.length === 0) return
      const last = s.betLog[s.betLog.length - 1]
      set({
        balance: s.balance + last.amount,
        bets: { ...s.bets, [last.spot]: s.bets[last.spot] - last.amount },
        betLog: s.betLog.slice(0, -1),
      })
    },

    clearBets: () => {
      const s = get()
      if (s.mode === 'mp') return void s.send?.({ a: 'clear' })
      if (s.phase !== 'BETTING') return
      set({ balance: s.balance + totalOf(s.bets), bets: emptyBets(), betLog: [] })
    },

    rebet: () => {
      const s = get()
      if (s.mode === 'mp') return
      if (s.phase !== 'BETTING' || totalOf(s.bets) > 0) return
      const need = totalOf(s.lastBets)
      if (need === 0 || need > s.balance) return
      set({
        balance: s.balance - need,
        bets: { ...s.lastBets },
        betLog: SEGMENT_ORDER.filter((t) => s.lastBets[t] > 0).map((t) => ({ spot: t, amount: s.lastBets[t] })),
      })
    },

    doubleBets: () => {
      const s = get()
      if (s.mode === 'mp') return
      const need = totalOf(s.bets)
      if (s.phase !== 'BETTING' || need === 0 || need > s.balance) return
      const bets = { ...s.bets }
      const log = [...s.betLog]
      for (const t of SEGMENT_ORDER) {
        if (s.bets[t] > 0) {
          bets[t] = s.bets[t] * 2
          log.push({ spot: t, amount: s.bets[t] })
        }
      }
      set({ balance: s.balance - need, bets, betLog: log })
    },

    setChip: (c) => set({ chip: c }),
    setBettingEndsAt: (t) => set({ bettingEndsAt: t }),

    lockNow: () => {
      const s = get()
      if (s.mode === 'mp') s.send?.({ a: 'lock' })
      else if (s.phase === 'BETTING') s.go('LOCKED')
    },

    startSpin: () => {
      const s = get()
      if (s.mode === 'mp') return
      // A spin can only ever begin from LOCKED, so two spins cannot overlap.
      if (s.phase !== 'LOCKED') return
      const start = s.wheelAngle % (Math.PI * 2)
      const plan = planSpin(rng, start, s.forced)
      set({ spin: plan, spinStartedAt: performance.now(), forced: null, result: null, lastWin: 0, bonusMultiplier: null })
      get().go('SPINNING')
    },

    resolveSpin: () => {
      const s = get()
      if (s.mode === 'mp') return
      if (s.phase !== 'DECELERATING' || !s.spin) return
      const index = s.spin.finalIndex
      const type = WHEEL[index]
      let balance = s.balance
      let lastWin = 0
      if (!isBonus(type) && s.bets[type] > 0) {
        lastWin = s.bets[type] * (SEGMENTS[type].payout + 1)
        balance += lastWin
      }
      set({
        result: { index, type },
        wheelAngle: s.spin.finalAngle % (Math.PI * 2),
        history: [type, ...s.history].slice(0, 14),
        balance,
        lastWin,
      })
      get().go('RESULT')
    },

    startBonus: () => {
      const s = get()
      if (s.mode === 'mp') return
      if (s.phase !== 'BONUS_INTRO' || !s.result || !isBonus(s.result.type)) return
      const type = s.result.type
      const bonus: BonusState =
        type === 'DON' ? createDon(rng) : type === 'TS' ? createTs(rng) : type === 'GD' ? createGd(rng) : createCm(rng, performance.now() + 2500)
      set({ bonus, scene: type, bonusSpin: null })
      get().go('BONUS_ACTIVE')
      if (bonus.kind === 'TS') {
        // show the wall, then cover and shuffle it, then a timed pick (auto-pick if the clock runs out)
        const stage = (status: 'shuffle' | 'pick') => {
          const b = get().bonus
          if (b?.kind === 'TS') set({ bonus: { ...b, status, pickEndsAt: performance.now() + TS_PICK_SECONDS * 1000 } })
        }
        bonusLater(4200, () => stage('shuffle'))
        bonusLater(6400, () => stage('pick'))
        bonusLater(6400 + TS_PICK_SECONDS * 1000, () => get().tsPick(rng.int(TS_COUNT)))
      }
      if (bonus.kind === 'CM') {
        bonusLater(2500 + CM_PICK_SECONDS * 1000, () => {
          const b = get().bonus
          if (b?.kind === 'CM' && b.stage === 'pick' && b.pick === null) get().cmPick(rng.int(3))
        })
      }
    },

    finishBonus: (multiplier) => {
      const s = get()
      if (s.mode === 'mp') return
      if (s.phase !== 'BONUS_ACTIVE' || !s.result) return
      const stake = s.bets[s.result.type]
      const lastWin = stake > 0 ? stake * (multiplier + 1) : 0
      set({ bonusMultiplier: multiplier, lastWin, balance: s.balance + lastWin })
      get().go('BONUS_RESULT')
    },

    nextRound: () => {
      const s = get()
      if (s.mode === 'mp') return
      if (s.phase !== 'ROUND_COMPLETE') return
      const had = totalOf(s.bets) > 0
      set({
        round: s.round + 1,
        lastBets: had ? { ...s.bets } : s.lastBets,
        bets: emptyBets(),
        betLog: [],
        bonus: null,
        spin: null,
      })
      get().go('BETTING')
    },

    topUp: () => {
      const s = get()
      if (s.mode === 'mp') return void s.send?.({ a: 'topup' })
      if (s.balance + totalOf(s.bets) < 1) set({ balance: START_BALANCE })
    },

    setScene: (scene) => set({ scene }),
    setCurtain: (curtain) => set({ curtain }),
    setForced: (forced) => set({ forced }),
    setVolume: (bus, v) => set((s) => ({ settings: { ...s.settings, [bus]: v } })),
    setQuality: (quality) =>
      set((s) => ({ settings: { ...s.settings, quality }, tier: quality === 'auto' ? 'high' : tierOf(quality) })),
    setTier: (tier) => {
      if (get().settings.quality === 'auto') set({ tier })
    },

    /* ── DOUBLE ── */
    donFlip: () => {
      const s = get()
      if (s.mode === 'mp') return void s.send?.({ a: 'donFlip' })
      if (s.phase !== 'BONUS_ACTIVE' || s.bonus?.kind !== 'DON') return
      set({ bonus: donFlip(s.bonus, rng) })
    },
    donLand: () => {
      const s = get()
      if (s.mode === 'mp') return
      if (s.phase !== 'BONUS_ACTIVE' || s.bonus?.kind !== 'DON') return
      const next = donLand(s.bonus)
      if (next === s.bonus) return
      set({ bonus: next })
      bonusLater(2600, () => get().finishBonus(next.multiplier))
    },

    /* ── TREASURE ── */
    tsPick: (i) => {
      const s = get()
      if (s.mode === 'mp') return void s.send?.({ a: 'tsPick', index: i })
      if (s.phase !== 'BONUS_ACTIVE' || s.bonus?.kind !== 'TS') return
      const next = tsPick(s.bonus, i)
      if (next === s.bonus) return
      set({ bonus: next })
      bonusLater(4200, () => get().finishBonus(next.multiplier))
    },

    /* ── GRAVITY ── */
    gdAim: (aim) => {
      const s = get()
      if (s.phase !== 'BONUS_ACTIVE' || s.bonus?.kind !== 'GD' || s.bonus.status !== 'aim') return
      set({ bonus: { ...s.bonus, aim: Math.max(0, Math.min(1, aim)) } })
    },
    gdDrop: () => {
      const s = get()
      if (s.mode === 'mp') return void s.send?.({ a: 'gdDrop', aim: s.bonus?.kind === 'GD' ? s.bonus.aim : 0.5 })
      if (s.phase !== 'BONUS_ACTIVE' || s.bonus?.kind !== 'GD') return
      set({ bonus: gdDrop(s.bonus, rng) })
    },
    gdLand: (slot) => {
      const s = get()
      if (s.mode === 'mp') return
      if (s.phase !== 'BONUS_ACTIVE' || s.bonus?.kind !== 'GD') return
      const next = gdLand(s.bonus, slot)
      if (next === s.bonus) return
      set({ bonus: next })
      if (next.status === 'landed') bonusLater(2400, () => get().finishBonus(next.multiplier))
      else
        bonusLater(2600, () => {
          const b = get().bonus
          if (b?.kind === 'GD') set({ bonus: gdRearm(b) })
        })
    },

    /* ── CHAOS ── */
    cmPick: (i) => {
      const s = get()
      if (s.mode === 'mp') return void s.send?.({ a: 'cmPick', index: i })
      if (s.phase !== 'BONUS_ACTIVE' || s.bonus?.kind !== 'CM') return
      const next = cmPick(s.bonus, i)
      if (next === s.bonus) return
      set({ bonus: next })
      bonusLater(1600, () => get().cmSpin())
    },
    cmSpin: () => {
      const s = get()
      if (s.mode === 'mp') return
      if (s.phase !== 'BONUS_ACTIVE' || s.bonus?.kind !== 'CM') return
      const next = cmBeginSpin(s.bonus)
      if (next === s.bonus) return
      set({ bonus: next, bonusSpin: planFreeSpin(rng, s.bonus.angle, CM_SEG_ANGLE), bonusSpinStartedAt: performance.now() })
    },
    cmLand: () => {
      const s = get()
      if (s.mode === 'mp') return
      if (s.phase !== 'BONUS_ACTIVE' || s.bonus?.kind !== 'CM' || !s.bonusSpin) return
      const next = cmLand(s.bonus, s.bonusSpin.finalAngle)
      if (next === s.bonus) return
      set({ bonus: next })
      if (next.stage === 'result') bonusLater(2800, () => get().finishBonus(next.multiplier))
      else bonusLater(3600, () => get().cmSpin())
    },
  }
})

if (typeof window !== 'undefined') {
  ;(window as unknown as { __chaos: unknown }).__chaos = { store: useGame }
}
