import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { audio } from './audio/engine'
import { preloadBonusGames } from './components/preload'
import { BetBoard } from './components/Interface/BetBoard'
import { BonusHud } from './components/Interface/BonusHud'
import { Hud } from './components/Interface/Hud'
import { Loading } from './components/Interface/Loading'
import { useRoundDirector } from './game/rounds/director'
import { useGame } from './game/state/store'

const Experience = lazy(() => import('./components/Experience'))

export default function App() {
  const [fonts, setFonts] = useState(false)
  const [code, setCode] = useState(false)
  const [frame, setFrame] = useState(false)
  const ready = useGame((s) => s.ready)
  const curtain = useGame((s) => s.curtain)
  const scene = useGame((s) => s.scene)
  useRoundDirector()

  useEffect(() => {
    // Canvas labels need the display font before the first texture is drawn.
    Promise.all([document.fonts.load('700 64px Oswald'), document.fonts.load('500 64px Oswald')])
      .catch(() => undefined)
      .then(() => setFonts(true))
    void import('./components/Experience').then(() => setCode(true))
  }, [])

  const onFrame = useCallback(() => setFrame(true), [])
  const progress = (fonts ? 0.2 : 0) + (code ? 0.45 : 0) + (frame ? 0.35 : 0)

  const enter = () => {
    audio.unlock()
    const s = useGame.getState().settings
    audio.setVolume('music', s.music)
    audio.setVolume('sfx', s.sfx)
    audio.setVolume('ambient', s.ambient)
    audio.ui()
    useGame.getState().enter()
    preloadBonusGames()
  }

  return (
    <div className="app">
      <div className="stage">
        {fonts && (
          <Suspense fallback={null}>
            <Experience onReady={onFrame} />
          </Suspense>
        )}
      </div>
      {ready && (
        <>
          <Hud />
          {scene === 'studio' ? <BetBoard /> : <BonusHud />}
        </>
      )}
      <div className={`curtain ${curtain ? 'on' : ''}`}>
        <div className="curtain-mark">PROJECT CHAOS</div>
      </div>
      {!ready && <Loading progress={progress} onEnter={enter} />}
    </div>
  )
}
