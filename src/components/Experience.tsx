import { Environment, Lightformer, PerformanceMonitor } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { Suspense, lazy, useEffect } from 'react'
import { useGame } from '../game/state/store'
import { CameraRig } from './Camera/CameraRig'
import { Studio } from './Studio/Studio'

// Each bonus arena is its own chunk, fetched only when first needed.
const DoubleOrNothing = lazy(() => import('./BonusGames/DoubleOrNothing'))
const TreasureStorm = lazy(() => import('./BonusGames/TreasureStorm'))
const GravityDrop = lazy(() => import('./BonusGames/GravityDrop'))
const ChaosMode = lazy(() => import('./BonusGames/ChaosMode'))

function StudioReflections() {
  return (
    <Environment resolution={256} frames={1}>
      <color attach="background" args={['#020106']} />
      <Lightformer form="rect" intensity={5} color="#fff3d6" position={[0, 6, 6]} scale={[14, 2, 1]} />
      <Lightformer form="rect" intensity={3} color="#ffd98a" position={[-8, 2, 2]} rotation-y={Math.PI / 2} scale={[10, 1.2, 1]} />
      <Lightformer form="rect" intensity={3} color="#e6e9f2" position={[8, 2, 2]} rotation-y={-Math.PI / 2} scale={[10, 1.2, 1]} />
      <Lightformer form="ring" intensity={4} color="#ffe2a8" position={[0, 3, -9]} scale={7} />
      <Lightformer form="circle" intensity={6} color="#ffffff" position={[3, 9, 0]} rotation-x={Math.PI / 2} scale={3} />
      <Lightformer form="rect" intensity={2} color="#c9b79a" position={[0, -4, 3]} rotation-x={-Math.PI / 2} scale={[12, 3, 1]} />
    </Environment>
  )
}

function FirstFrame({ onReady }: { onReady: () => void }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    ;(window as unknown as { __three: unknown }).__three = { gl, scene }
    const id = requestAnimationFrame(() => requestAnimationFrame(onReady))
    return () => cancelAnimationFrame(id)
  }, [gl, onReady])
  return null
}

function Scene() {
  const scene = useGame((s) => s.scene)
  if (scene === 'studio') {
    return (
      <>
        <Studio />
        <CameraRig />
      </>
    )
  }
  if (scene === 'DON') return <DoubleOrNothing />
  if (scene === 'TS') return <TreasureStorm />
  if (scene === 'GD') return <GravityDrop />
  return <ChaosMode />
}

export default function Experience({ onReady }: { onReady: () => void }) {
  const tier = useGame((s) => s.tier)
  const setTier = useGame((s) => s.setTier)
  return (
    <Canvas
      shadows
      dpr={tier === 'ultra' ? [1, 2] : tier === 'high' ? [1, 1.5] : [0.75, 1]}
      gl={{ antialias: true, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: 38, position: [-3.6, 7.6, 13.4], near: 0.1, far: 140 }}
    >
      <color attach="background" args={['#040405']} />
      <fog attach="fog" args={['#050506', 24, 75]} />
      <PerformanceMonitor onDecline={() => setTier('low')} flipflops={2} />
      <StudioReflections />
      <Suspense fallback={null}>
        <Scene />
        <FirstFrame onReady={onReady} />
      </Suspense>
      {tier !== 'low' && (
        <EffectComposer multisampling={tier === 'ultra' ? 4 : 2}>
          <Bloom mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.25} intensity={0.55} radius={0.65} />
          <Vignette offset={0.25} darkness={0.72} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </Canvas>
  )
}
