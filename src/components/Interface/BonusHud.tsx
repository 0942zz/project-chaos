import { audio } from '../../audio/engine'
import { DON_FLOOR, type CmState, type DonState, type GdState, type TsState } from '../../game/logic/bonus'
import { SEGMENTS } from '../../game/logic/segments'
import { useGame } from '../../game/state/store'
import { formatCredits, formatMult } from '../../utils/math'

function Don({ b }: { b: DonState }) {
  const g = useGame.getState()
  const canToss = b.status === 'choose' || b.status === 'won'
  const text =
    b.status === 'flipping' ? `You called ${b.pick}. The coin is in the air…`
    : b.status === 'lost' ? `It landed ${b.outcome}. You drop to the ${formatMult(DON_FLOOR)} safety net.`
    : b.status === 'maxed' ? `${b.outcome}! Five in a row — the ladder is complete.`
    : b.status === 'banked' ? 'Banked.'
    : b.status === 'won' ? `${b.outcome}! Risk it again for ${formatMult(b.multiplier * 2)}, or bank it.`
    : `Call the toss. A correct call doubles ${formatMult(b.multiplier)} to ${formatMult(b.multiplier * 2)}.`
  return (
    <>
      <div className="bh-row">
        <div className="bh-value"><small>At stake</small><strong>{formatMult(b.multiplier)}</strong></div>
        <div className="ladder">
          {Array.from({ length: b.maxTosses }, (_, i) => (
            <i key={i} className={i < b.tosses && b.status !== 'lost' ? 'on' : ''}>{formatMult(4 * 2 ** i)}</i>
          ))}
        </div>
      </div>
      <p className="bh-text">{text}</p>
      <div className="bh-actions">
        <button className="btn-coin sun" disabled={!canToss} onClick={() => { audio.ui(); g.donToss('SUN') }}>Call Sun</button>
        <button className="btn-coin moon" disabled={!canToss} onClick={() => { audio.ui(); g.donToss('MOON') }}>Call Moon</button>
        <button className="btn-primary" disabled={b.status !== 'won'} onClick={() => { audio.ui(); g.donBank() }}>Bank {formatMult(b.multiplier)}</button>
      </div>
    </>
  )
}

function Ts({ b }: { b: TsState }) {
  return (
    <>
      <div className="bh-row">
        <div className="bh-value"><small>Collected</small><strong>{formatMult(b.total)}</strong></div>
        <div className="picks">
          {Array.from({ length: 3 }, (_, i) => (
            <i key={i} className={i < b.picks.length ? 'on' : ''}>{i < b.picks.length ? formatMult(b.values[b.picks[i]]) : '?'}</i>
          ))}
        </div>
      </div>
      <p className="bh-text">
        {b.status === 'pick'
          ? `Choose ${b.picksLeft} more vault${b.picksLeft === 1 ? '' : 's'}. Every vault's prize was sealed before you arrived.`
          : 'All three opened. Here is what the other vaults were hiding…'}
      </p>
    </>
  )
}

function Gd({ b }: { b: GdState }) {
  const g = useGame.getState()
  const aiming = b.status === 'aim'
  return (
    <>
      <p className="bh-text">
        {aiming ? 'Slide to choose your release point (or point at the board), then drop the ball.'
          : b.status === 'dropping' ? 'Real physics — the slot the ball falls into is your multiplier.'
          : `It settles in the ${formatMult(b.multiplier)} slot.`}
      </p>
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
  const text: Record<CmState['stage'], string> = {
    select: 'Four reactor cores, four hidden multipliers. Choose one to power the arena.',
    reveal: `Your core holds ${formatMult(b.multiplier)}. Charging the surge ring…`,
    surge: 'Stop the comet. Wherever it comes to rest is applied to your multiplier.',
    stopping: 'Braking…',
    applied: b.lastShard !== null ? `${b.ring[b.lastShard].kind === 'void' ? 'The void halves it' : b.ring[b.lastShard].label + ' applied'} — now ${formatMult(b.multiplier)}.` : '',
    decide: `Surge ${b.surges} of ${b.maxSurges} done. The next ring is richer — and holds more voids.`,
    done: `Locked in at ${formatMult(b.multiplier)}.`,
  }
  return (
    <>
      <div className="bh-row">
        <div className="bh-value"><small>Chaos multiplier</small><strong>{b.multiplier > 0 ? formatMult(b.multiplier) : '—'}</strong></div>
        <div className="picks">
          {Array.from({ length: b.maxSurges }, (_, i) => (
            <i key={i} className={i < b.surges ? 'on' : ''}>S{i + 1}</i>
          ))}
        </div>
      </div>
      <p className="bh-text">{text[b.stage]}</p>
      <div className="bh-actions">
        {(b.stage === 'surge' || b.stage === 'stopping') && (
          <button className="btn-primary big" disabled={b.stage !== 'surge'} onClick={() => { audio.ui(); g.cmStop() }}>Stop</button>
        )}
        {b.stage === 'decide' && (
          <>
            <button className="btn-coin sun" onClick={() => { audio.ui(); g.cmBeginSurge() }}>Surge again</button>
            <button className="btn-primary" onClick={() => { audio.ui(); g.cmBank() }}>Bank {formatMult(b.multiplier)}</button>
          </>
        )}
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
