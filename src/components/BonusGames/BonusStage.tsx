import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { JACKPOT_THRESHOLD } from '../../game/logic/bonus'
import { useGame } from '../../game/state/store'
import { M, glow } from '../../materials'
import { createRingFloorMaterial } from '../../shaders'
import { Confetti, GoldDust, Shockwave } from '../Effects/Ambient'
import { Presenter } from '../Presenter/Presenter'

interface Props {
  a: string
  b: string
  radius?: number
  pillars?: number
  presenter?: [number, number, number]
  dust?: string
  /** 0..1+, lets a bonus raise the energy of its arena. */
  energy?: number
  children: React.ReactNode
}

/** Common arena shell: animated floor, ring of pillars, lighting, host, and the win celebration. */
export function BonusStage({ a, b, radius = 9, pillars = 12, presenter = [5.6, 0, 2.4], dust, energy = 0.6, children }: Props) {
  const phase = useGame((s) => s.phase)
  const mult = useGame((s) => s.bonusMultiplier)
  const tier = useGame((s) => s.tier)
  const floor = useMemo(() => createRingFloorMaterial(a, b), [a, b])
  const strip = useMemo(() => glow(a, 2.4), [a])
  const wash = useRef<THREE.PointLight>(null!)
  useEffect(() => () => { floor.dispose(); strip.dispose() }, [floor, strip])

  const won = phase === 'BONUS_RESULT'
  const jackpot = won && (mult ?? 0) >= JACKPOT_THRESHOLD

  useFrame(({ clock }) => {
    floor.uniforms.uTime.value = clock.elapsedTime
    floor.uniforms.uPower.value = (won ? 1.8 : energy) * (jackpot ? 1.6 : 1)
    wash.current.intensity = jackpot ? 900 + Math.sin(clock.elapsedTime * 14) * 500 : won ? 420 : 160
  })

  return (
    <group>
      <ambientLight intensity={0.2} color="#9a8fd0" />
      <hemisphereLight args={[a, '#05030a', 0.35]} />
      <spotLight position={[4, 14, 10]} angle={0.55} penumbra={0.8} intensity={900} color="#fff3dc" castShadow={tier === 'high'} shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
      <spotLight position={[-8, 10, 6]} angle={0.7} penumbra={1} intensity={420} color={a} />
      <pointLight ref={wash} position={[0, 7, 3]} intensity={160} distance={40} color={jackpot ? '#ffd75e' : b} />

      <mesh rotation-x={-Math.PI / 2} position-y={-0.02}>
        <circleGeometry args={[60, 48]} />
        <meshStandardMaterial color="#040308" metalness={0.9} roughness={0.3} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} material={floor} receiveShadow>
        <circleGeometry args={[radius, 96]} />
      </mesh>
      <mesh rotation-x={Math.PI / 2} position-y={0.03} material={M.gold}>
        <torusGeometry args={[radius, 0.07, 10, 128]} />
      </mesh>

      {Array.from({ length: pillars }, (_, i) => {
        const ang = Math.PI * 1.08 + ((i + 0.5) / pillars) * Math.PI * 0.84
        const r = radius + 4.5
        const h = 9 + (i % 3) * 2.2
        return (
          <group key={i} position={[Math.cos(ang) * r, 0, Math.sin(ang) * r]} rotation-y={-ang - Math.PI / 2}>
            <mesh position-y={h / 2} material={M.blackMetal}>
              <boxGeometry args={[1, h, 0.7]} />
            </mesh>
            <mesh position={[0, h / 2, 0.36]} material={strip}>
              <boxGeometry args={[0.08, h - 0.6, 0.02]} />
            </mesh>
            <mesh position-y={h + 0.1} material={M.gold}>
              <boxGeometry args={[1.2, 0.2, 0.9]} />
            </mesh>
          </group>
        )
      })}

      <GoldDust count={tier === 'high' ? 420 : 160} color={dust ?? b} size={[28, 14, 22]} center={[0, 7, 0]} />
      <Presenter context="bonus" position={presenter} rotation-y={-0.5} scale={1.45} />
      <Confetti active={won} origin={[0, 11, 2]} spread={jackpot ? 20 : 14} />
      <Shockwave trigger={won} color={jackpot ? '#ffd75e' : a} radius={radius + 8} position={[0, 0.1, 0]} />
      <Shockwave trigger={jackpot} color="#ffffff" radius={radius + 14} position={[0, 0.14, 0]} />
      {children}
    </group>
  )
}
