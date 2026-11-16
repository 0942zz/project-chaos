import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { audio } from '../../audio/engine'
import { CM_SHARDS, CM_SHARD_ANGLE, JACKPOT_THRESHOLD, cometAngle, cometBrakeTime, type Shard } from '../../game/logic/bonus'
import { useGame } from '../../game/state/store'
import { M } from '../../materials'
import { damp, formatMult } from '../../utils/math'
import { labelTexture } from '../../utils/textures'
import { BonusCamera, type Shot } from '../Camera/CameraRig'
import { Shockwave } from '../Effects/Ambient'
import { Burst, type BurstHandle } from '../Effects/Burst'
import { BonusStage } from './BonusStage'

const PYLONS: { x: number; z: number; color: string }[] = [
  { x: -6.9, z: 0.6, color: '#49ecff' },
  { x: -2.3, z: -0.8, color: '#ff5cf0' },
  { x: 2.3, z: -0.8, color: '#ffd75e' },
  { x: 6.9, z: 0.6, color: '#2dffb0' },
]
const RING: [number, number, number] = [0, 5.6, -3]
const RING_R = 3.5
const shardColor = (s: Shard): string => (s.kind === 'void' ? '#ff2e4d' : s.kind === 'mul' ? '#ffd75e' : '#49ecff')
/** Angle 0 is the top of the ring, increasing clockwise as seen by the player. */
const onRing = (a: number, r: number): [number, number, number] => [Math.sin(a) * r, Math.cos(a) * r, 0]

function Pylon({ index }: { index: number }) {
  const p = PYLONS[index]
  const group = useRef<THREE.Group>(null!)
  const core = useRef<THREE.Group>(null!)
  const beam = useRef<THREE.Mesh>(null!)
  const [hover, setHover] = useState(false)
  const stage = useGame((s) => (s.bonus?.kind === 'CM' ? s.bonus.stage : 'select'))
  const picked = useGame((s) => (s.bonus?.kind === 'CM' ? s.bonus.picked : null))
  const value = useGame((s) => (s.bonus?.kind === 'CM' ? s.bonus.cores[index] : 0))
  const selectable = stage === 'select'
  const mine = picked === index
  const coreMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#050505', emissive: p.color, emissiveIntensity: 1.6, flatShading: true, toneMapped: false }),
    [p.color],
  )
  const beamMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    [p.color],
  )
  useEffect(() => () => { coreMat.dispose(); beamMat.dispose() }, [coreMat, beamMat])
  const label = picked === null
    ? labelTexture('?', { width: 256, height: 256, size: 190, color: p.color, glow: p.color })
    : labelTexture(formatMult(value), { width: 320, height: 256, size: 150, color: mine ? '#ffffff' : '#8a84a6', glow: mine ? p.color : undefined })

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const t = clock.elapsedTime
    const active = hover && selectable
    // Once the surge begins the pylons sink into the arena floor to clear the stage.
    const sunk = stage !== 'select' && stage !== 'reveal'
    group.current.position.y = damp(group.current.position.y, sunk ? -9 : 0, 2.2, dt)
    group.current.visible = group.current.position.y > -8.2
    beam.current.visible = !sunk
    core.current.rotation.y = t * (active ? 3 : mine ? 4 : 0.8) + index
    core.current.rotation.x = t * 0.5
    core.current.position.y = 4.9 + Math.sin(t * 1.5 + index) * 0.15 + (mine ? 0.5 : 0)
    const s = damp(core.current.scale.x, active ? 1.35 : mine ? 1.5 : picked !== null ? 0.7 : 1, 8, dt)
    core.current.scale.setScalar(s)
    coreMat.emissiveIntensity = damp(coreMat.emissiveIntensity, active ? 4 : mine ? 5 : picked !== null ? 0.5 : 1.6 + Math.sin(t * 3 + index) * 0.4, 8, dt)
    beamMat.opacity = damp(beamMat.opacity, active || mine ? 0.4 : 0.1, 6, dt)
    beam.current.rotation.y = t * 0.6
  })

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    if (!selectable) return
    setHover(true)
    audio.hover()
    document.body.style.cursor = 'pointer'
  }
  const out = () => {
    setHover(false)
    document.body.style.cursor = ''
  }
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (!selectable) return
    audio.charge(index)
    useGame.getState().cmPick(index)
    out()
  }

  return (
    <group ref={group}>
      <group position={[p.x, 0, p.z]} onPointerOver={over} onPointerOut={out} onClick={click}>
        <mesh position-y={1.9} material={M.blackMetal} castShadow>
          <cylinderGeometry args={[0.6, 1.05, 3.8, 6]} />
        </mesh>
        <mesh position-y={0.15} material={M.gloss}>
          <cylinderGeometry args={[1.35, 1.5, 0.3, 6]} />
        </mesh>
        {[0.9, 2.2, 3.5].map((y, k) => (
          <mesh key={y} position-y={y} rotation-x={Math.PI / 2} material={M.gold}>
            <torusGeometry args={[0.98 - k * 0.15, 0.045, 8, 6]} />
          </mesh>
        ))}
        <mesh position-y={3.86}>
          <cylinderGeometry args={[0.5, 0.6, 0.12, 6]} />
          <meshStandardMaterial color="#000" emissive={p.color} emissiveIntensity={2.2} toneMapped={false} />
        </mesh>
        <mesh ref={beam} position-y={9}>
          <cylinderGeometry args={[0.42, 0.42, 10, 6, 1, true]} />
          <primitive object={beamMat} attach="material" />
        </mesh>
        <group ref={core} position-y={4.9}>
          <mesh material={coreMat} castShadow>
            <icosahedronGeometry args={[0.55, 0]} />
          </mesh>
          <mesh rotation-x={Math.PI / 2} material={M.gold}>
            <torusGeometry args={[0.85, 0.025, 8, 48]} />
          </mesh>
          <mesh rotation-y={Math.PI / 2} material={M.chrome}>
            <torusGeometry args={[0.98, 0.02, 8, 48]} />
          </mesh>
        </group>
        <mesh position={[0, 6.6, 0]}>
          <planeGeometry args={[1.9, 1.5]} />
          <meshBasicMaterial map={label} transparent toneMapped={false} depthWrite={false} />
        </mesh>
        <pointLight position-y={4.9} color={p.color} intensity={40} distance={9} />
      </group>
    </group>
  )
}

const TRAIL = 14

function SurgeRing({ burst }: { burst: React.RefObject<BurstHandle | null> }) {
  const group = useRef<THREE.Group>(null!)
  const comet = useRef<THREE.Group>(null!)
  const trail = useRef<(THREE.Mesh | null)[]>([])
  const plates = useRef<(THREE.Group | null)[]>([])
  const ring = useGame((s) => (s.bonus?.kind === 'CM' ? s.bonus.ring : null))
  const multiplier = useGame((s) => (s.bonus?.kind === 'CM' ? s.bonus.multiplier : 0))
  const landedFor = useRef<object | null>(null)
  const display = useRef<THREE.Mesh>(null!)
  const punch = useRef(0)
  const shown = useRef(multiplier)
  if (shown.current !== multiplier) {
    shown.current = multiplier
    punch.current = 1
  }
  const tmp = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const g = useGame.getState()
    const b = g.bonus?.kind === 'CM' ? g.bonus : null
    if (!b) return
    const visible = b.stage !== 'select' && b.stage !== 'reveal'
    const sc = damp(group.current.scale.x, visible ? 1 : 0.001, 3, dt)
    group.current.scale.setScalar(sc)
    group.current.visible = sc > 0.01
    const now = performance.now()
    const t = clock.elapsedTime

    const c = b.comet
    const running = c !== null && (b.stage === 'surge' || b.stage === 'stopping')
    comet.current.visible = c !== null && b.stage !== 'decide' && b.stage !== 'done'
    if (c) {
      const a = b.stage === 'applied' && c.finalAngle !== null ? c.finalAngle : cometAngle(c, now)
      comet.current.position.set(...onRing(a, RING_R))
      for (let i = 0; i < TRAIL; i++) {
        const m = trail.current[i]
        if (!m) continue
        const back = running ? cometAngle(c, now - (i + 1) * 22) : a
        m.position.set(...onRing(back, RING_R))
        m.visible = running
      }
      // The comet has physically come to rest: only now does the game apply the shard it stopped on.
      if (b.stage === 'stopping' && c.stoppedAt !== null && landedFor.current !== c && now >= c.stoppedAt + cometBrakeTime(c) * 1000) {
        landedFor.current = c
        const shard = b.ring[c.finalIndex ?? 0]
        audio.shard(shard.kind)
        tmp.set(...onRing(c.finalAngle ?? 0, RING_R)).add(new THREE.Vector3(...RING))
        burst.current?.fire(tmp, shard.kind === 'void' ? 90 : 190, shardColor(shard), 6)
        g.cmLand()
      }
    }

    for (let i = 0; i < CM_SHARDS; i++) {
      const p = plates.current[i]
      if (!p) continue
      const hit = b.stage === 'applied' && b.lastShard === i
      const s = damp(p.scale.x, hit ? 1.45 : 1 + Math.sin(t * 2 + i) * 0.03, 8, dt)
      p.scale.setScalar(s)
    }
    punch.current = damp(punch.current, 0, 4, dt)
    display.current.scale.setScalar(1 + punch.current * 0.7)
    // The DOM result banner takes over once the bonus is settled.
    display.current.visible = g.phase !== 'BONUS_RESULT'
    group.current.rotation.z = Math.sin(t * 0.4) * 0.015
  })

  const dispTex = labelTexture(formatMult(multiplier), {
    width: 512, height: 320, size: 200, color: multiplier >= JACKPOT_THRESHOLD ? '#ffd75e' : '#ffffff', glow: '#b86bff', sub: 'CHAOS MULTIPLIER',
  })

  return (
    <group ref={group} position={RING} scale={0.001}>
      <mesh material={M.gold}><torusGeometry args={[RING_R, 0.09, 14, 128]} /></mesh>
      <mesh material={M.blackMetal} position-z={-0.25}><torusGeometry args={[RING_R + 0.75, 0.32, 14, 128]} /></mesh>
      <mesh material={M.chrome}><torusGeometry args={[RING_R - 0.7, 0.03, 10, 96]} /></mesh>
      {ring?.map((s, i) => {
        const a = (i + 0.5) * CM_SHARD_ANGLE
        const edge = i * CM_SHARD_ANGLE
        const color = shardColor(s)
        return (
          <group key={`${i}-${s.label}`}>
            <mesh position={onRing(edge, RING_R)} rotation-z={-edge} material={M.chrome}>
              <boxGeometry args={[0.05, 0.7, 0.14]} />
            </mesh>
            <group ref={(g) => { plates.current[i] = g }} position={onRing(a, RING_R + 0.02)}>
              <mesh position-z={-0.06} rotation-z={Math.PI / 4}>
                <boxGeometry args={[1.12, 1.12, 0.1]} />
                <meshStandardMaterial color="#030208" metalness={0.4} roughness={0.6} emissive={color} emissiveIntensity={s.kind === 'void' ? 0.16 : 0.05} />
              </mesh>
              <mesh>
                <planeGeometry args={[1.4, 0.9]} />
                <meshBasicMaterial
                  map={labelTexture(s.label, { width: 320, height: 200, size: s.kind === 'void' ? 100 : 140, color, stroke: '#030208' })}
                  transparent toneMapped={false} depthWrite={false}
                />
              </mesh>
            </group>
          </group>
        )
      })}
      <group ref={comet}>
        <mesh>
          <sphereGeometry args={[0.2, 20, 16]} />
          <meshBasicMaterial color={[6, 5, 3]} toneMapped={false} />
        </mesh>
        <pointLight color="#ffe6a0" intensity={30} distance={6} />
      </group>
      {Array.from({ length: TRAIL }, (_, i) => (
        <mesh key={i} ref={(m) => { trail.current[i] = m }} scale={1 - i / TRAIL}>
          <sphereGeometry args={[0.17, 10, 8]} />
          <meshBasicMaterial color="#ffb347" transparent opacity={0.55 * (1 - i / TRAIL)} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      <mesh ref={display} position-z={0.1}>
        <planeGeometry args={[4.2, 2.6]} />
        <meshBasicMaterial map={dispTex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  )
}

/** Slowly turning mega-structure that surrounds the arena. */
function Gyroscope({ energy }: { energy: React.RefObject<number> }) {
  const g = useRef<THREE.Group>(null!)
  const rocks = useRef<THREE.InstancedMesh | null>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const seeds = useMemo(() => Array.from({ length: 70 }, (_, i) => ({ a: Math.PI * (1.04 + (i / 70) * 0.92), r: 15 + ((i * 7) % 9), y: 2 + ((i * 13) % 14), s: 0.25 + ((i * 5) % 7) * 0.09 })), [])
  useFrame(({ clock }, dt) => {
    const k = 0.4 + energy.current * 1.4
    g.current.children.forEach((c, i) => {
      c.rotation.x += dt * 0.07 * k * (i % 2 ? 1 : -1)
      c.rotation.y += dt * 0.05 * k * (i + 1)
    })
    const m = rocks.current
    if (!m) return
    const t = clock.elapsedTime
    seeds.forEach((s, i) => {
      const a = s.a + Math.sin(t * 0.05 * k + i) * 0.04
      dummy.position.set(Math.cos(a) * s.r, s.y + Math.sin(t * 0.5 + i) * 0.6, Math.sin(a) * s.r - 2)
      dummy.rotation.set(t * 0.2 + i, t * 0.15 + i * 2, 0)
      dummy.scale.set(s.s, s.s * 2.4, s.s)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  })
  return (
    <>
      <group ref={g} position={[0, 9, -17]}>
        <mesh material={M.gold}><torusGeometry args={[6, 0.12, 10, 160]} /></mesh>
        <mesh material={M.chrome} rotation-x={1}><torusGeometry args={[7.5, 0.09, 10, 160]} /></mesh>
        <mesh material={M.blackMetal} rotation-y={1}><torusGeometry args={[9, 0.26, 10, 160]} /></mesh>
      </group>
      <instancedMesh ref={rocks} args={[undefined, undefined, seeds.length]} frustumCulled={false}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#120b24" metalness={0.9} roughness={0.25} emissive="#7a3bff" emissiveIntensity={0.35} flatShading />
      </instancedMesh>
    </>
  )
}

export default function ChaosMode() {
  const burst = useRef<BurstHandle>(null)
  const bonus = useGame((s) => (s.bonus?.kind === 'CM' ? s.bonus : null))
  const phase = useGame((s) => s.phase)
  const energy = useRef(0.3)
  const stage = bonus?.stage ?? 'select'
  const surges = bonus?.surges ?? 0

  useEffect(() => () => { document.body.style.cursor = '' }, [])
  useEffect(() => {
    if (stage === 'surge') audio.charge(surges + 1)
    if (stage === 'reveal' && bonus && bonus.picked !== null) {
      const p = PYLONS[bonus.picked]
      window.setTimeout(() => burst.current?.fire(new THREE.Vector3(p.x, 5.4, p.z), 200, p.color, 6), 350)
    }
  }, [stage, surges])

  useFrame((_, dt) => {
    const target = stage === 'select' ? 0.3 : stage === 'reveal' ? 0.6 : 0.7 + surges * 0.35 + (stage === 'surge' || stage === 'stopping' ? 0.4 : 0)
    energy.current = damp(energy.current, target, 2, dt)
  })

  const shot = (): Shot => {
    if (phase === 'BONUS_RESULT') return { pos: [3.5, 4.2, 14], target: [1.4, 3.6, -2], fov: 44, speed: 1.6 }
    if (stage === 'select') return { pos: [0, 4.6, 18.5], target: [0, 2.6, 0], fov: 42 }
    if (stage === 'reveal' && bonus && bonus.picked !== null) {
      const p = PYLONS[bonus.picked]
      return { pos: [p.x * 0.8, 4.6, p.z + 9.5], target: [p.x, 4.2, p.z], fov: 40, speed: 2.4 }
    }
    const close = stage === 'stopping' || stage === 'applied' ? 1 : 0
    return { pos: [0, 4.4, 12.5 - close * 1.8], target: [0, 4.3, -3], fov: 44, speed: 1.8 }
  }

  const stop = () => {
    if (stage === 'surge') {
      audio.ui()
      useGame.getState().cmStop()
    }
  }

  return (
    <BonusStage a="#b86bff" b="#ffd75e" radius={12} pillars={16} presenter={[7.8, 0, 4.6]} dust="#e2c8ff" energy={0.5 + surges * 0.4}>
      <BonusCamera shot={shot} drift={0.14} />
      <Gyroscope energy={energy} />
      {PYLONS.map((_, i) => (
        <Pylon key={i} index={i} />
      ))}
      <SurgeRing burst={burst} />
      {/* invisible catcher: clicking anywhere on the ring stops the comet */}
      <mesh position={[RING[0], RING[1], RING[2] + 0.3]} onClick={stop}>
        <circleGeometry args={[RING_R + 1.4, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* central dais beneath the ring */}
      <mesh position={[0, 0.3, -3]} material={M.gloss} castShadow>
        <cylinderGeometry args={[2.6, 3.2, 0.6, 8]} />
      </mesh>
      <mesh position={[0, 0.62, -3]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[1.6, 2.4, 8]} />
        <meshStandardMaterial color="#000" emissive="#b86bff" emissiveIntensity={2} toneMapped={false} />
      </mesh>
      <Burst ref={burst} size={0.15} gravity={3.5} />
      <Shockwave trigger={stage === 'applied' ? surges : 0} color="#ffd75e" radius={8} position={[RING[0], RING[1], RING[2] + 0.2]} vertical />
      <Shockwave trigger={stage === 'reveal'} color="#b86bff" radius={18} position={[0, 0.12, 0]} />
    </BonusStage>
  )
}
