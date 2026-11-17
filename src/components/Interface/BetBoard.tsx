import { audio } from '../../audio/engine'
import { SEGMENTS, SEGMENT_ORDER, probabilityOf } from '../../game/logic/segments'
import { CHIPS, totalOf, useGame } from '../../game/state/store'
import { useNet } from '../../net/client'
import { formatCredits } from '../../utils/math'

const CHIP_COLORS: Record<number, string> = { 1: '#9aa3b8', 5: '#e0445c', 10: '#3b7bff', 25: '#1fbf83', 100: '#e8b64a' }

export function BetBoard() {
  const phase = useGame((s) => s.phase)
  const bets = useGame((s) => s.bets)
  const lastBets = useGame((s) => s.lastBets)
  const chip = useGame((s) => s.chip)
  const balance = useGame((s) => s.balance)
  const result = useGame((s) => s.result)
  const mp = useGame((s) => s.mode === 'mp')
  const isHost = useNet((s) => s.room !== null && s.user !== null && s.room.hostId === s.user.id)
  const mine = useNet((s) => s.myBets)
  const g = useGame.getState()
  const open = phase === 'BETTING'
  const total = totalOf(bets)
  const showResult = result !== null && (phase === 'RESULT' || phase === 'BONUS_INTRO' || phase === 'ROUND_COMPLETE')
  const broke = open && balance + total < 1

  const act = (fn: () => void, sound: 'chip' | 'ui' = 'ui') => () => {
    if (!open) return
    if (sound === 'chip') audio.chip()
    else audio.ui()
    fn()
  }

  return (
    <section className={`board ${open ? '' : 'closed'}`} aria-label="Selections">
      <div className="spots">
        {SEGMENT_ORDER.map((t) => {
          const info = SEGMENTS[t]
          const stake = bets[t]
          const state = showResult ? (result.type === t ? 'hit' : 'miss') : ''
          return (
            <button
              key={t}
              className={`spot ${info.bonus ? 'bonus' : ''} ${state} ${stake > 0 ? 'staked' : ''}`}
              style={{ '--c': info.color, '--g': info.glow, '--t': info.text } as React.CSSProperties}
              disabled={!open || balance < 1}
              onClick={act(() => g.placeBet(t), 'chip')}
              aria-label={`${info.name}, ${info.bonus ? 'bonus game' : `pays ${info.payout} to 1`}, current stake ${stake}`}
            >
              <span className="spot-face">{info.bonus ? info.label : info.label}</span>
              <span className="spot-meta">
                {info.bonus ? 'Bonus' : `${info.payout}:1`} · {(probabilityOf(t) * 100).toFixed(1)}%
              </span>
              {stake > 0 && <span className="spot-stake">{formatCredits(stake)}</span>}
            </button>
          )
        })}
      </div>

      <div className="controls">
        <div className="chips" role="radiogroup" aria-label="Chip value">
          {CHIPS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={chip === c}
              className={`chip ${chip === c ? 'on' : ''}`}
              style={{ '--c': CHIP_COLORS[c] } as React.CSSProperties}
              onClick={() => { audio.ui(); g.setChip(c) }}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="actions">
          <button className="btn-ghost" disabled={!open || total === 0} onClick={act(g.undoBet)}>Undo</button>
          <button className="btn-ghost" disabled={!open || total === 0} onClick={act(g.clearBets)}>Clear</button>
          {!mp && <button className="btn-ghost" disabled={!open || total > 0 || totalOf(lastBets) === 0 || totalOf(lastBets) > balance} onClick={act(g.rebet, 'chip')}>Repeat</button>}
          {!mp && <button className="btn-ghost" disabled={!open || total === 0 || total > balance} onClick={act(g.doubleBets, 'chip')}>Double</button>}
        </div>
        <div className="stake">
          <small>{mp ? `Team stake · yours ${formatCredits(mine ? totalOf(mine) : 0)}` : 'Total stake'}</small>
          <strong>{formatCredits(total)}</strong>
        </div>
        {broke ? (
          <button className="btn-primary" onClick={() => { audio.ui(); g.topUp() }}>Refill Chaos Credits</button>
        ) : (
          <button className="btn-primary" disabled={!open || (mp && !isHost)} onClick={act(g.lockNow)}>
            {!open ? 'Selections closed' : mp && !isHost ? 'Host spins' : total > 0 ? 'Spin now' : 'Spin without stake'}
          </button>
        )}
      </div>
    </section>
  )
}
