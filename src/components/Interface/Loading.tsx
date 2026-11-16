import { SESSION_SEED } from '../../game/engine/session'

export function Loading({ progress, onEnter }: { progress: number; onEnter: () => void }) {
  const done = progress >= 0.999
  return (
    <div className="loading">
      <div className="loading-inner">
        <div className="loading-kicker">A live 3D game show</div>
        <h1 className="wordmark">
          PROJECT <span>CHAOS</span>
        </h1>
        <div className="loading-bar" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ transform: `scaleX(${progress})` }} />
        </div>
        <div className="loading-status">
          {done ? 'The studio is ready' : progress < 0.2 ? 'Loading typefaces' : progress < 0.65 ? 'Building the studio' : 'Lighting the stage'}
          <span>{Math.round(progress * 100)}%</span>
        </div>
        <button className="btn-primary enter" disabled={!done} onClick={onEnter}>
          Enter the studio
        </button>
        <p className="loading-note">
          Demo credits only — no real money, deposits or withdrawals. Sound starts when you enter.
          <br />
          Session seed {SESSION_SEED}
        </p>
      </div>
    </div>
  )
}
