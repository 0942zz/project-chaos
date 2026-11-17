import { useEffect, useState } from 'react'
import { audio } from '../../audio/engine'
import {
  CM_MAX_BOOSTS, CM_POINTER_COLORS, CM_POINTER_NAMES, GD_DOUBLE, GD_MAX_DOUBLES,
  type CmState, type DonState, type GdState, type TsState,
} from '../../game/logic/bonus'
import { SEGMENTS } from '../../game/logic/segments'
import { useGame } from '../../game/state/store'
import { formatCredits, formatMult } from '../../utils/math'

/** Seconds left until `endsAt`, re-rendered a few times a second. */
function useSecondsLeft(endsAt: number, active: boolean): number {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => tick((n) => n + 1), 200)
    return () => window.clearInterval(id)
  }, [active])
  return active ? Math.max(0, Math.ceil((endsAt - performance.now()) / 1000)) : 0
}

function Don({ b }: { b: DonState }) {
  const g = useGame.getState()
  const text =
    b.status === 'ready' ? 'Each face of the coin carries its own multiplier. Flip it — the face that lands up is your prize.'
    : b.status === 'flipping' ? 'The coin is in the air…'
    : `It lands on ${b.outcome} — ${formatMult(b.multiplier)}.`
  return (
    <>
      <div className="bh-row">
        <div className={`side sun ${b.status === 'done' && b.outcome === 'SUN' ? 'won' : ''}`}><small>Sun</small><strong>{formatMult(b.sun)}</strong></div>
        <div className={`side moon ${b.status === 'done' && b.outcome === 'MOON' ? 'won' : ''}`}><small>Moon</small><strong>{formatMult(b.moon)}</strong></div>
      </div>
      <p className="bh-text">{text}</p>
      <div className="bh-actions">
        <button className="btn-primary big" disabled={b.status !== 'ready'} onClick={() => { audio.ui(); g.donFlip() }}>Flip the coin</button>
      </div>
    </>
  )
}

function Ts({ b }: { b: TsState }) {
  const left = useSecondsLeft(b.pickEndsAt, b.status === 'pick')
  const text =
    b.status === 'preview' ? 'These are the multipliers on the wall. Remember where the big ones are…'
    : b.status === 'shuffle' ? 'Covered — and shuffled.'
    : b.status === 'pick' ? 'Choose one target before the clock runs out. If you wait, one is chosen for you.'
    : `Your target hid ${formatMult(b.multiplier)}. Here is the rest of the wall.`
  return (
    <>
      <div className="bh-row">
        {b.status === 'pick' && <div className="bh-value"><small>Time left</small><strong>{left}</strong></div>}
        {b.status === 'done' && <div className="bh-value"><small>Your target</small><strong>{formatMult(b.multiplier)}</strong></div>}
      </div>
      <p className="bh-text">{text}</p>
    </>
  )
}

function Gd({ b }: { b: GdState }) {
  const g = useGame.getState()
  const aiming = b.status === 'aim'
  const text =
    aiming ? (b.doubles > 0 ? 'Every multiplier has doubled. Choose a release point and drop again.' : 'Choose your release point, then drop the ball. A DOUBLE slot doubles the whole board and you drop again.')
    : b.status === 'dropping' ? 'Real physics — the slot the ball falls into decides the prize.'
    : b.status === 'doubling' ? 'DOUBLE! Every multiplier on the board is doubled.'
    : `It settles in the ${formatMult(b.multiplier)} slot.`
  return (
    <>
      <div className="bh-row">
        <div className="picks">
          {Array.from({ length: GD_MAX_DOUBLES }, (_, i) => (
            <i key={i} className={i < b.doubles ? 'on' : ''}>×2</i>
          ))}
        </div>
        {b.slots.includes(GD_DOUBLE) ? null : <small className="bh-note">No DOUBLE slots left</small>}
      </div>
      <p className="bh-text">{text}</p>
      <div className="bh-actions">
        <input
          className="aim" type="range" min={0} max={1} step={0.005} value={b.aim} disabled={!aiming}
          aria-label="Release position" onChange={(e) => g.gdAim(Number(e.target.value))}
        />
        <button className="btn-primary" disabled={!aiming} onClick={() => { audio.ui(); g.gdDrop() }}>Drop</button>
      </div>
    </>
  )
}

function Cm({ b }: { b: CmState }) {
  const g = useGame.getState()
  const choosing = b.stage === 'pick' && b.pick === null
  const left = useSecondsLeft(b.pickEndsAt, choosing)
  const name = b.pick !== null ? CM_POINTER_NAMES[b.pick] : ''
  const text =
    choosing ? 'Three pointers, one grand wheel. Back a pointer — the segment it stops on is your prize.'
    : b.stage === 'pick' ? `You are on ${name}. Spinning the grand wheel…`
    : b.stage === 'spinning' ? `Watch the ${name} pointer.`
    : b.stage === 'boost' ? `${b.lastBoost === 3 ? 'TRIPLE' : 'DOUBLE'}! Every multiplier on the wheel is ×${b.lastBoost}. Spinning again…`
    : `${name} stops on ${formatMult(b.multiplier)}.`
  return (
    <>
      <div className="bh-row">
        {choosing && <div className="bh-value"><small>Time left</small><strong>{left}</strong></div>}
        <div className="picks">
          {Array.from({ length: CM_MAX_BOOSTS }, (_, i) => (
            <i key={i} className={i < b.boosts ? 'on' : ''}>boost</i>
          ))}
        </div>
      </div>
      <p className="bh-text">{text}</p>
      <div className="bh-actions">
        {CM_POINTER_NAMES.map((n, i) => (
          <button
            key={n}
            className={`btn-pointer ${b.pick === i ? 'on' : ''}`}
            style={{ '--p': CM_POINTER_COLORS[i] } as React.CSSProperties}
            disabled={!choosing}
            onClick={() => { audio.ui(); g.cmPick(i) }}
          >
            {n}
          </button>
        ))}
      </div>
    </>
  )
}

export function BonusHud() {
  const bonus = useGame((s) => s.bonus)
  const phase = useGame((s) => s.phase)
  const stake = useGame((s) => (s.result ? s.bets[s.result.type] : 0))
  if (!bonus || phase !== 'BONUS_ACTIVE') return null
  const info = SEGMENTS[bonus.kind]
  return (
    <section className="bonus-hud" style={{ '--c': info.glow } as React.CSSProperties}>
      <div className="bh-title">
        <span>{info.name}</span>
        <small>{stake > 0 ? `Stake in play · ${formatCredits(stake)}` : 'No stake · exhibition round'}</small>
      </div>
      {bonus.kind === 'DON' && <Don b={bonus} />}
      {bonus.kind === 'TS' && <Ts b={bonus} />}
      {bonus.kind === 'GD' && <Gd b={bonus} />}
      {bonus.kind === 'CM' && <Cm b={bonus} />}
    </section>
  )
}
