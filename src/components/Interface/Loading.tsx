import { useState } from 'react'
import { SESSION_SEED } from '../../game/engine/session'
import { SEGMENTS, SEGMENT_ORDER, WHEEL_COUNTS, SEGMENT_COUNT } from '../../game/logic/segments'
import { useNet } from '../../net/client'
import { Settings } from './Hud'
import { MultiplayerPanel } from './Multiplayer'

type View = 'home' | 'mp' | 'how' | 'settings'

const BONUS_RULES: Record<string, string> = {
  DON: 'Each face of a coin gets its own multiplier. The face that lands up pays.',
  TS: 'A wall of 60 targets shows its multipliers, covers and shuffles them. Pick one before the clock runs out.',
  GD: 'Drop a ball through the pin board. DOUBLE slots double every multiplier and you drop again.',
  CM: 'Back one of three pointers on the grand wheel. DOUBLE and TRIPLE multiply the wheel and it spins again.',
}

function HowToPlay() {
  return (
    <div className="menu-panel">
      <h2>How to play</h2>
      <ol className="steps">
        <li>Choose a chip and place it on any pockets you like while the countdown runs.</li>
        <li>The wheel spins. The pocket under the pointer when it stops is the result.</li>
        <li>Numbers pay their value to one. Bonus pockets open a bonus game that pays its multiplier.</li>
      </ol>
      <table className="odds">
        <thead>
          <tr><th>Pocket</th><th>On the wheel</th><th>Pays</th></tr>
        </thead>
        <tbody>
          {SEGMENT_ORDER.map((t) => {
            const info = SEGMENTS[t]
            return (
              <tr key={t}>
                <td><i style={{ background: info.color, borderColor: info.glow }} />{info.name}</td>
                <td>{WHEEL_COUNTS[t]} of {SEGMENT_COUNT}</td>
                <td>{info.bonus ? BONUS_RULES[t] : `${info.payout} to 1`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="menu-note">A bonus only pays if you placed a stake on it; otherwise it is played for show.</p>
    </div>
  )
}

/** Title screen: loading progress, then the main menu over the live studio. */
export function Loading({ progress, onEnter, onGesture }: { progress: number; onEnter: () => void; onGesture: () => void }) {
  const inRoom = useNet((s) => s.room !== null)
  const [picked, setView] = useState<View>('home')
  // A player who is already seated at a table (e.g. after a reload) lands in the lobby.
  const view: View = inRoom ? 'mp' : picked
  const done = progress >= 0.999
  return (
    <div className="menu">
      <div className="menu-col">
        <div className="menu-kicker">A live 3D game show</div>
        <h1 className="wordmark">
          PROJECT <span>CHAOS</span>
        </h1>
        {!done ? (
          <>
            <div className="loading-bar" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ transform: `scaleX(${progress})` }} />
            </div>
            <div className="loading-status">
              {progress < 0.2 ? 'Loading typefaces' : progress < 0.65 ? 'Building the studio' : 'Lighting the stage'}
              <span>{Math.round(progress * 100)}%</span>
            </div>
          </>
        ) : (
          <nav className="menu-nav" aria-label="Main menu">
            <button className="menu-item primary" onClick={onEnter} disabled={inRoom}>Single player</button>
            <button className={`menu-item ${view === 'mp' ? 'on' : ''}`} onClick={() => setView(view === 'mp' ? 'home' : 'mp')}>Multiplayer</button>
            <button className={`menu-item ${view === 'how' ? 'on' : ''}`} onClick={() => setView(view === 'how' ? 'home' : 'how')}>How to play</button>
            <button className={`menu-item ${view === 'settings' ? 'on' : ''}`} onClick={() => setView(view === 'settings' ? 'home' : 'settings')}>Settings</button>
          </nav>
        )}
        <p className="menu-note">
          Chaos Credits are fictional — no real money, deposits or withdrawals.
          <br />
          Session seed {SESSION_SEED}
        </p>
      </div>
      {done && view === 'mp' && <MultiplayerPanel onGesture={onGesture} />}
      {done && view === 'how' && <HowToPlay />}
      {done && view === 'settings' && (
        <div className="menu-panel narrow">
          <h2>Settings</h2>
          <Settings inline onClose={() => setView('home')} />
        </div>
      )}
    </div>
  )
}
