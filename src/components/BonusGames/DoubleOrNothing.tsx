import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { audio } from '../../audio/engine'
import { useGame } from '../../game/state/store'
import { M } from '../../materials'
import { damp, formatMult } from '../../utils/math'
import { coinTexture, labelTexture } from '../../utils/textures'
import { BonusCamera, type Shot } from '../Camera/CameraRig'
import { Shockwave } from '../Effects/Ambient'
import { Burst, type BurstHandle } from '../Effects/Burst'
import { BonusStage } from './BonusStage'

const REST_Y = 3.6
const FLIGHT = 3.1
const APEX = 4.4
const TURNS = 7
const SUN = '#ffd75e'
const MOON = '#9fb4ff'

/** One side's multiplier, on a standing display beside the coin. */
function SideBoard({ side, value, x }: { side: 'SUN' | 'MOON'; value: number; x: number }) {
  const g = useRef<THREE.Group>(null!)
  const color = side === 'SUN' ? SUN : MOON
  const tex = labelTexture(formatMult(value), { width: 512, height: 384, size: 190, color, sub: side })
  useFrame(({ clock }, dt) => {
    const b = useGame.getState().bonus
    const won = b?.kind === 'DON' && b.status === 'done' && b.outcome === side
    const lost = b?.kind === 'DON' && b.status === 'done' && b.outcome !== side
    const s = damp(g.current.scale.x, won ? 1.25 + Math.sin(clock.elapsedTime * 8) * 0.05 : lost ? 0.8 : 1, 6, dt)
    g.current.scale.setScalar(s)
  })
  return (
    <group position={[x, 3.5, -0.6]} rotation-y={-x * 0.09}>
      <group ref={g}>
        <mesh position-z={-0.08} material={M.blackMetal} castShadow>
          <boxGeometry args={[2.9, 2.2, 0.14]} />
        </mesh>
        <mesh position-z={-0.02} material={M.gold}>
          <boxGeometry args={[2.72, 2.02, 0.04]} />
        </mesh>
        <mesh position-z={0.005}>
          <planeGeometry args={[2.6, 1.9]} />
          <meshBasicMaterial color="#07060b" />
        </mesh>
        <mesh position-z={0.012}>
          <planeGeometry args={[2.5, 1.875]} />
          <meshBasicMaterial map={tex} transparent toneMapped={false} />
        </mesh>
      </group>
      <mesh position-y={-2.3} material={M.blackMetal}>
        <cylinderGeometry args={[0.07, 0.12, 2.4, 10]} />
      </mesh>
    </group>
  )
}

export default function DoubleOrNothing() {
  const coin = useRef<THREE.Group>(null!)
  const burst = useRef<BurstHandle>(null)
  const bonus = useGame((s) => (s.bonus?.kind === 'DON' ? s.bonus : null))
  const sun = useMemo(() => coinTexture('SUN'), [])
  const moon = useMemo(() => coinTexture('MOON'), [])
  const anim = useRef({ tossId: 0, t: 0, flying: false, from: 0, to: 0, wobble: 0, face: 0 })
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
      // The outcome was drawn when the flip was requested; the flight simply ends on that face.
      a.to = (b.outcome === 'SUN' ? 0 : Math.PI) + TURNS * Math.PI * 2
      audio.coinToss()
    }

    if (a.flying) {
      a.t += dt
      const u = Math.min(1, a.t / FLIGHT)
      c.position.y = REST_Y + APEX * 4 * u * (1 - u)
      c.rotation.x = a.from + (a.to - a.from) * (1 - Math.pow(1 - u, 1.7))
      c.rotation.y = damp(c.rotation.y % (Math.PI * 2), 0, 6, dt)
      cam.current.close = damp(cam.current.close, u > 0.62 ? 1 : 0, 3, dt)
      if (u >= 1) {
        a.flying = false
        a.face = b?.outcome === 'SUN' ? 0 : Math.PI
        c.rotation.x = a.face
        a.wobble = 1
        audio.coinLand(true)
        burst.current?.fire(new THREE.Vector3(0, REST_Y, 0.4), 170, b?.outcome === 'SUN' ? SUN : MOON, 5)
        g.donLand()
      }
    } else {
      a.wobble = damp(a.wobble, 0, 2.2, dt)
      c.position.y = damp(c.position.y, REST_Y + Math.sin(t * 1.3) * 0.12, 5, dt)
      c.rotation.x = a.face + Math.sin(t * 17) * 0.22 * a.wobble
      // Before the flip the coin turns slowly so both faces can be seen.
      c.rotation.y = b?.status === 'ready' ? c.rotation.y + dt * 1.1 : damp(c.rotation.y % (Math.PI * 2), 0, 4, dt)
      c.rotation.z = Math.sin(t * 23) * 0.08 * a.wobble
      cam.current.close = damp(cam.current.close, a.wobble > 0.35 ? 1 : 0, 2.5, dt)
    }
    cam.current.y = damp(cam.current.y, c.position.y, 3, dt)
  })

  const shot = (): Shot => {
    const k = cam.current.close
    const y = REST_Y + (cam.current.y - REST_Y) * 0.55
    return { pos: [0, y - 0.3, 14.5 - k * 5.5], target: [0, y - 1.2 + k * 0.4, 0], fov: 40, speed: 3 }
  }

  return (
    <BonusStage a="#ffc93c" b="#ff8a1e" radius={8} energy={bonus?.status === 'ready' ? 0.5 : 1.1} hostX={6.6} hostZ={2.2}>
      <BonusCamera shot={shot} />

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
        <meshStandardMaterial color="#000" emissive="#ffb52e" emissiveIntensity={1.2} toneMapped={false} />
      </mesh>

      <group position={[0, REST_Y, -3]}>
        <mesh material={M.gold}><torusGeometry args={[4.3, 0.14, 16, 96]} /></mesh>
        <mesh material={M.blackMetal} position-z={-0.3}><torusGeometry args={[5.2, 0.34, 16, 96]} /></mesh>
      </group>

      {bonus && <SideBoard side="SUN" value={bonus.sun} x={-3.6} />}
      {bonus && <SideBoard side="MOON" value={bonus.moon} x={3.6} />}

      <group ref={coin} position-y={REST_Y}>
        <mesh rotation-x={Math.PI / 2} material={M.gold} castShadow>
          <cylinderGeometry args={[1.35, 1.35, 0.17, 72]} />
        </mesh>
        <mesh position-z={0.07} material={M.chrome}><torusGeometry args={[1.33, 0.045, 10, 72]} /></mesh>
        <mesh position-z={-0.07} material={M.chrome}><torusGeometry args={[1.33, 0.045, 10, 72]} /></mesh>
        <mesh position-z={0.088}>
          <circleGeometry args={[1.27, 64]} />
          <meshStandardMaterial map={sun} metalness={0.85} roughness={0.32} emissive="#ffb52e" emissiveMap={sun} emissiveIntensity={0.25} />
        </mesh>
        <mesh position-z={-0.088} rotation-x={Math.PI}>
          <circleGeometry args={[1.27, 64]} />
          <meshStandardMaterial map={moon} metalness={0.85} roughness={0.3} emissive="#8fa8ff" emissiveMap={moon} emissiveIntensity={0.28} />
        </mesh>
      </group>

      <Burst ref={burst} size={0.14} />
      <Shockwave trigger={bonus?.status === 'done'} color={bonus?.outcome === 'MOON' ? MOON : SUN} radius={6} position={[0, REST_Y, 0.2]} vertical />
    </BonusStage>
  )
}
