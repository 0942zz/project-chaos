import { useEffect, useRef, useState } from 'react'
import { audio } from '../../audio/engine'
import { DEV_MODE, SESSION_SEED } from '../../game/engine/session'
import { JACKPOT_THRESHOLD } from '../../game/logic/bonus'
import { SEGMENTS, SEGMENT_ORDER, isBonus } from '../../game/logic/segments'
import { PHASE_LABEL } from '../../game/state/machine'
import { useGame, type Quality } from '../../game/state/store'
import { formatCredits, formatMult } from '../../utils/math'

/** Re-renders on an interval while `active`; used for the countdown. */
function useTicker(active: boolean, ms = 100): void {
  const [, set] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => set((n) => n + 1), ms)
    return () => window.clearInterval(id)
  }, [active, ms])
}

export function useCountUp(value: number): number {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = () => {
      const u = Math.min(1, (performance.now() - start) / 700)
      const v = a + (value - a) * (1 - Math.pow(1 - u, 3))
      from.current = v
      setShown(v)
      if (u < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return shown
}

function Status() {
  const phase = useGame((s) => s.phase)
  const endsAt = useGame((s) => s.bettingEndsAt)
  const scene = useGame((s) => s.scene)
  const result = useGame((s) => s.result)
  useTicker(phase === 'BETTING')
  const left = phase === 'BETTING' ? Math.max(0, (endsAt - performance.now()) / 1000) : 0
  const label = scene !== 'studio' && result ? SEGMENTS[result.type].name : PHASE_LABEL[phase]
  return (
    <div className={`status ${phase === 'BETTING' && left <= 5 ? 'urgent' : ''}`}>
      {phase === 'BETTING' && (
        <div className="status-timer">
          <svg viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="17" className="track" />
            <circle cx="20" cy="20" r="17" className="arc" pathLength={100} strokeDasharray={`${Math.min(100, (left / 15) * 100)} 100`} />
          </svg>
          <span>{Math.ceil(left)}</span>
        </div>
      )}
      <span className="status-label">{label}</span>
    </div>
  )
}

function Settings({ onClose }: { onClose: () => void }) {
  const settings = useGame((s) => s.settings)
  const tier = useGame((s) => s.tier)
  const setVolume = useGame((s) => s.setVolume)
  const setQuality = useGame((s) => s.setQuality)
  const slider = (bus: 'music' | 'sfx' | 'ambient', label: string) => (
    <label className="slider">
      <span>{label}</span>
      <input
        type="range" min={0} max={1} step={0.01} value={settings[bus]}
        onChange={(e) => {
          const v = Number(e.target.value)
          setVolume(bus, v)
          audio.setVolume(bus, v)
        }}
      />
      <em>{Math.round(settings[bus] * 100)}</em>
    </label>
  )
  return (
    <div className="popover" onPointerDown={(e) => e.stopPropagation()}>
      <div className="popover-title">Sound</div>
      {slider('music', 'Music')}
      {slider('sfx', 'Effects')}
      {slider('ambient', 'Ambience')}
      <div className="popover-title">Graphics {settings.quality === 'auto' && <small>· auto → {tier}</small>}</div>
      <div className="seg">
        {(['auto', 'high', 'low'] as Quality[]).map((q) => (
          <button key={q} className={settings.quality === q ? 'on' : ''} onClick={() => setQuality(q)}>
            {q}
          </button>
        ))}
      </div>
      <button className="btn-ghost wide" onClick={onClose}>Done</button>
    </div>
  )
}

function ResultBanner() {
  const phase = useGame((s) => s.phase)
  const result = useGame((s) => s.result)
  const lastWin = useGame((s) => s.lastWin)
  const mult = useGame((s) => s.bonusMultiplier)
  const stake = useGame((s) => (s.result ? s.bets[s.result.type] : 0))
  const win = useCountUp(phase === 'RESULT' || phase === 'BONUS_RESULT' ? lastWin : 0)
  if (!result) return null
  const info = SEGMENTS[result.type]

  if (phase === 'RESULT' || phase === 'BONUS_INTRO') {
    const bonus = isBonus(result.type)
    return (
      <div className={`banner ${bonus ? 'bonus' : ''}`} style={{ '--c': info.glow } as React.CSSProperties} key={`r${phase}`}>
        <div className="banner-kicker">{bonus ? 'Bonus unlocked' : 'The wheel stops on'}</div>
        <div className="banner-main">{bonus ? info.name : info.label}</div>
        {!bonus && (
          <div className="banner-sub">{lastWin > 0 ? `You win ${formatCredits(win)} credits` : stake > 0 ? '' : 'No selection on this pocket'}</div>
        )}
        {bonus && <div className="banner-sub">{stake > 0 ? `Your stake of ${formatCredits(stake)} is in play` : 'No stake placed — play it for the show'}</div>}
      </div>
    )
  }
  if (phase === 'BONUS_RESULT' && mult !== null) {
    const jackpot = mult >= JACKPOT_THRESHOLD
    return (
      <div className={`banner bonus ${jackpot ? 'jackpot' : ''}`} style={{ '--c': jackpot ? '#ffd75e' : info.glow } as React.CSSProperties}>
        <div className="banner-kicker">{jackpot ? 'Jackpot' : info.name}</div>
        <div className="banner-main">{formatMult(mult)}</div>
        <div className="banner-sub">{lastWin > 0 ? `You win ${formatCredits(win)} credits` : 'No stake was placed on this bonus'}</div>
      </div>
    )
  }
  return null
}

function DevPanel() {
  const forced = useGame((s) => s.forced)
  const setForced = useGame((s) => s.setForced)
  return (
    <div className="dev">
      <span>next spin lands on</span>
      {SEGMENT_ORDER.map((t) => (
        <button key={t} className={forced === t ? 'on' : ''} onClick={() => setForced(forced === t ? null : t)}>
          {SEGMENTS[t].label}
        </button>
      ))}
      <span>seed {SESSION_SEED}</span>
    </div>
  )
}

export function Hud() {
  const round = useGame((s) => s.round)
  const balance = useGame((s) => s.balance)
  const history = useGame((s) => s.history)
  const [open, setOpen] = useState(false)
  const shown = useCountUp(balance)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const fullscreen = () => {
    audio.ui()
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.().catch(() => undefined)
  }

  return (
    <>
      <header className="top">
        <div className="brand">
          <div className="brand-mark">PROJECT <span>CHAOS</span></div>
          <div className="brand-round">Round {round}</div>
        </div>
        <Status />
        <div className="top-right">
          <div className="balance">
            <small>Demo credits</small>
            <strong>{formatCredits(shown)}</strong>
          </div>
          <button className="icon-btn" aria-label="Sound and graphics settings" onPointerDown={(e) => e.stopPropagation()} onClick={() => { audio.ui(); setOpen((o) => !o) }}>
            <svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
          <button className="icon-btn" aria-label="Toggle fullscreen" onClick={fullscreen}>
            <svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          {open && <Settings onClose={() => setOpen(false)} />}
        </div>
      </header>

      <aside className="history" aria-label="Previous results">
        <small>Previous</small>
        {history.slice(0, 9).map((t, i) => {
          const info = SEGMENTS[t]
          return (
            <span key={`${history.length - i}`} className={`pill ${i === 0 ? 'latest' : ''} ${info.bonus ? 'bonus' : ''}`} style={{ background: info.color, color: info.text, borderColor: info.glow }}>
              {info.bonus ? info.label.slice(0, 3) : info.label}
            </span>
          )
        })}
        {history.length === 0 && <span className="pill empty">—</span>}
      </aside>

      <ResultBanner />
      {DEV_MODE && <DevPanel />}
    </>
  )
}
