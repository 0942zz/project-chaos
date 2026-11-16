import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { audio } from '../../audio/engine'
import { useGame } from '../../game/state/store'
import { M } from '../../materials'
import { damp } from '../../utils/math'
import { coinTexture } from '../../utils/textures'
import { BonusCamera, type Shot } from '../Camera/CameraRig'
import { Shockwave } from '../Effects/Ambient'
import { Burst, type BurstHandle } from '../Effects/Burst'
import { BonusStage } from './BonusStage'

const REST_Y = 3.6
const FLIGHT = 2.9
const APEX = 4.4
const TURNS = 7

export default function DoubleOrNothing() {
  const coin = useRef<THREE.Group>(null!)
  const burst = useRef<BurstHandle>(null)
  const bonus = useGame((s) => (s.bonus?.kind === 'DON' ? s.bonus : null))
  const sun = useMemo(() => coinTexture('SUN'), [])
  const moon = useMemo(() => coinTexture('MOON'), [])
  const anim = useRef({ tossId: 0, t: 0, flying: false, from: 0, to: 0, wobble: 0, face: 0, landed: 0 })
  const cam = useRef({ y: REST_Y, close: 0 })

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const g = useGame.getState()
    const b = g.bonus?.kind === 'DON' ? g.bonus : null
    const a = anim.current
    const c = coin.current
    const t = clock.elapsedTime

    if (b && b.status === 'flipping' && b.tossId !== a.tossId) {
      a.tossId = b.tossId
      a.t = 0
      a.flying = true
      a.from = a.face
      // The outcome was drawn by the RNG when the toss was requested; the flight simply ends on that face.
      a.to = (b.outcome === 'SUN' ? 0 : Math.PI) + TURNS * Math.PI * 2
      audio.coinToss()
    }

    if (a.flying) {
      a.t += dt
      const u = Math.min(1, a.t / FLIGHT)
      c.position.y = REST_Y + APEX * 4 * u * (1 - u)
      c.rotation.x = a.from + (a.to - a.from) * (1 - Math.pow(1 - u, 1.7))
      c.rotation.y = damp(c.rotation.y, 0, 6, dt)
      cam.current.close = damp(cam.current.close, u > 0.62 ? 1 : 0, 3, dt)
      if (u >= 1) {
        a.flying = false
        a.face = b?.outcome === 'SUN' ? 0 : Math.PI
        c.rotation.x = a.face
        a.wobble = 1
        a.landed += 1
        const win = b?.outcome === b?.pick
        audio.coinLand(win)
        burst.current?.fire(new THREE.Vector3(0, REST_Y, 0.4), win ? 160 : 40, win ? '#ffd75e' : '#8892b0', win ? 5 : 2.5)
        g.donLand()
      }
    } else {
      a.wobble = damp(a.wobble, 0, 2.2, dt)
      c.position.y = damp(c.position.y, REST_Y + Math.sin(t * 1.3) * 0.12, 5, dt)
      c.rotation.x = a.face + Math.sin(t * 17) * 0.22 * a.wobble
      c.rotation.y = damp(c.rotation.y, Math.sin(t * 0.7) * 0.45, 3, dt)
      c.rotation.z = Math.sin(t * 23) * 0.08 * a.wobble
      cam.current.close = damp(cam.current.close, a.wobble > 0.25 ? 1 : 0, 2.5, dt)
    }
    cam.current.y = damp(cam.current.y, c.position.y, 3, dt)
  })

  const shot = (): Shot => {
    const k = cam.current.close
    const y = REST_Y + (cam.current.y - REST_Y) * 0.55
    return { pos: [1.2 - k * 1.2, y - 0.4, 13.5 - k * 5.5], target: [0.6 - k * 0.6, y - 1.35 + k * 0.45, 0], fov: 40, speed: 3 }
  }

  const won = bonus?.status === 'won' || bonus?.status === 'maxed'

  return (
    <BonusStage a="#ffc93c" b="#ff8a1e" radius={8} energy={0.5 + (bonus?.tosses ?? 0) * 0.25} presenter={[5.2, 0, 2.6]}>
      <BonusCamera shot={shot} />

      {/* pedestal */}
      <mesh position-y={0.25} material={M.blackMetal} castShadow receiveShadow>
        <cylinderGeometry args={[2.1, 2.5, 0.5, 48]} />
      </mesh>
      <mesh position-y={0.75} material={M.gloss} castShadow>
        <cylinderGeometry args={[1.5, 1.9, 0.5, 48]} />
      </mesh>
      <mesh position-y={1.02} rotation-x={Math.PI / 2} material={M.gold}>
        <torusGeometry args={[1.5, 0.06, 10, 64]} />
      </mesh>
      <mesh position-y={1.02} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[1.35, 48]} />
        <meshStandardMaterial color="#000" emissive="#ffb52e" emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 1.6, 0]} intensity={60} distance={9} color="#ffb52e" />

      {/* halo rings behind the coin */}
      <group position={[0, REST_Y, -3]}>
        <mesh material={M.gold}><torusGeometry args={[4.3, 0.16, 16, 96]} /></mesh>
        <mesh material={M.blackMetal} position-z={-0.3}><torusGeometry args={[5.4, 0.4, 16, 96]} /></mesh>
        <Spokes />
      </group>

      {/* the coin */}
      <group ref={coin} position-y={REST_Y}>
        <mesh rotation-x={Math.PI / 2} material={M.gold} castShadow>
          <cylinderGeometry args={[1.35, 1.35, 0.17, 72]} />
        </mesh>
        <mesh position-z={0.07} material={M.chrome}><torusGeometry args={[1.33, 0.045, 10, 72]} /></mesh>
        <mesh position-z={-0.07} material={M.chrome}><torusGeometry args={[1.33, 0.045, 10, 72]} /></mesh>
        <mesh position-z={0.088}>
          <circleGeometry args={[1.27, 64]} />
          <meshStandardMaterial map={sun} metalness={0.85} roughness={0.32} emissive="#ffb52e" emissiveMap={sun} emissiveIntensity={0.28} />
        </mesh>
        <mesh position-z={-0.088} rotation-x={Math.PI}>
          <circleGeometry args={[1.27, 64]} />
          <meshStandardMaterial map={moon} metalness={0.85} roughness={0.3} emissive="#8fa8ff" emissiveMap={moon} emissiveIntensity={0.3} />
        </mesh>
      </group>

      <Burst ref={burst} size={0.14} />
      <Shockwave trigger={won ? (bonus?.tosses ?? 0) : 0} color="#ffd75e" radius={6} position={[0, REST_Y, 0.2]} vertical />
    </BonusStage>
  )
}

function Spokes() {
  const g = useRef<THREE.Group>(null!)
  useFrame((_, dt) => { g.current.rotation.z += dt * 0.12 })
  return (
    <group ref={g}>
      {Array.from({ length: 24 }, (_, i) => (
        <mesh key={i} rotation-z={(i / 24) * Math.PI * 2} position-z={-0.1}>
          <boxGeometry args={[0.05, 9.4, 0.04]} />
          <meshStandardMaterial color="#000" emissive="#ffb52e" emissiveIntensity={i % 2 ? 1.6 : 0.5} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}
