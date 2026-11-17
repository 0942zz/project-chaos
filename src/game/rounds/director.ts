import { useEffect } from 'react'
import { audio } from '../../audio/engine'
import { FAST_MODE } from '../engine/session'
import { JACKPOT_THRESHOLD } from '../logic/bonus'
import { isBonus } from '../logic/segments'
import { TIMING } from '../state/machine'
import { useGame } from '../state/store'

const K = FAST_MODE ? 0.35 : 1

/**
 * Drives the round: each phase schedules exactly one exit, and the timers are
 * torn down whenever the phase changes, so phases can never overlap.
 */
export function useRoundDirector(): void {
  const phase = useGame((s) => s.phase)

  useEffect(() => {
    const g = useGame.getState()
    const timers: number[] = []
    const after = (sec: number, fn: () => void) => timers.push(window.setTimeout(fn, sec * 1000 * K))

    switch (phase) {
      case 'IDLE':
        break

      case 'BETTING': {
        const total = TIMING.betting * K
        if (g.mode !== 'mp') g.setBettingEndsAt(performance.now() + total * 1000)
        audio.setMood('calm')
        for (let s = 5; s >= 1; s--) {
          if (total - s > 0) timers.push(window.setTimeout(() => audio.beep(s === 1), (total - s) * 1000))
        }
        if (g.mode !== 'mp') timers.push(window.setTimeout(() => useGame.getState().lockNow(), total * 1000))
        break
      }

      case 'LOCKED':
        audio.lock()
        audio.setMood('tension')
        after(TIMING.locked, () => useGame.getState().startSpin())
        break

      case 'SPINNING': {
        audio.whoosh()
        const plan = g.spin
        if (plan) timers.push(window.setTimeout(() => useGame.getState().go('DECELERATING'), plan.decelAt * 1000))
        break
      }

      case 'DECELERATING': {
        const plan = g.spin
        if (plan) {
          const remaining = plan.duration * 1000 - (performance.now() - g.spinStartedAt)
          timers.push(window.setTimeout(() => useGame.getState().resolveSpin(), Math.max(0, remaining) + 350))
        }
        break
      }

      case 'RESULT': {
        const type = g.result?.type
        const bonus = type ? isBonus(type) : false
        audio.land()
        if (bonus) audio.bonus()
        else if (g.lastWin > 0) audio.win(false)
        audio.setMood(bonus ? 'bonus' : 'calm')
        after(TIMING.result, () => useGame.getState().go(bonus ? 'BONUS_INTRO' : 'ROUND_COMPLETE'))
        break
      }

      case 'BONUS_INTRO':
        audio.whoosh()
        after(TIMING.bonusIntro - 0.7, () => useGame.getState().setCurtain(true))
        after(TIMING.bonusIntro, () => useGame.getState().startBonus())
        break

      case 'BONUS_ACTIVE':
        after(0.7, () => useGame.getState().setCurtain(false))
        break

      case 'BONUS_RESULT': {
        const m = g.bonusMultiplier ?? 0
        if (m >= JACKPOT_THRESHOLD) audio.jackpot()
        else audio.win(m >= 20)
        after(TIMING.bonusResult, () => useGame.getState().go('ROUND_COMPLETE'))
        break
      }

      case 'ROUND_COMPLETE': {
        const inBonus = g.scene !== 'studio'
        audio.setMood('calm')
        if (inBonus) {
          g.setCurtain(true)
          after(0.7, () => useGame.getState().setScene('studio'))
          after(1.5, () => useGame.getState().setCurtain(false))
        }
        after(inBonus ? TIMING.roundComplete + 0.4 : TIMING.roundComplete, () => useGame.getState().nextRound())
        break
      }
    }

    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [phase])
}
