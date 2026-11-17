import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { audio } from '../../audio/engine'
import {
  CM_DOUBLE, CM_POINTER_COLORS, CM_POINTER_OFFSETS, CM_SEGMENTS, CM_SEG_ANGLE, CM_TRIPLE, cmSegmentAt,
} from '../../game/logic/bonus'
import { sampleSpin } from '../../game/physics/wheelSim'
import { useGame } from '../../game/state/store'
import { M, enamel } from '../../materials'
import { damp } from '../../utils/math'
import { labelTexture } from '../../utils/textures'
import { BonusCamera, type Shot } from '../Camera/CameraRig'
import { Shockwave } from '../Effects/Ambient'
import { Burst, type BurstHandle } from '../Effects/Burst'
import { BonusStage } from './BonusStage'

const CENTER: [number, number, number] = [0, 5.7, -3]
const R_OUT = 4.3
const R_IN = 1.55
const DEPTH = 0.22
const RANK_COLORS = ['#1c2c66', '#0e6b5c', '#55298c', '#8a5a14', '#a3214f', '#d9a21b']
const RANK_TEXT = ['#dfe6ff', '#e4fff8', '#f1e4ff', '#fff1d6', '#ffe6ee', '#1a1203']

/** Angle ψ is counter-clockwise from the top of the wheel, as the player sees it. */
const rim = (psi: number, r: number): [number, number, number] => [-Math.sin(psi) * r, Math.cos(psi) * r, 0]

function segmentLook(value: number, ranks: number[]): { color: string; text: string; label: string } {
  if (value === CM_DOUBLE) return { color: '#efe9dc', text: '#3a1a6e', label: 'DOUBLE' }
  if (value === CM_TRIPLE) return { color: '#49ecff', text: '#04202a', label: 'TRIPLE' }
  const rank = Math.min(RANK_COLORS.length - 1, Math.max(0, ranks.indexOf(value)))
  return { color: RANK_COLORS[rank], text: RANK_TEXT[rank], label: `${value}×` }
}

function GrandWheel({ burst }: { burst: React.RefObject<BurstHandle | null> }) {
  const spin = useRef<THREE.Group>(null!)
  const wheel = useGame((s) => (s.bonus?.kind === 'CM' ? s.bonus.wheel : null))
  const st = useRef({ boundary: 0, landedSpin: 0, wasSpinning: false })
  const geo = useMemo(() => {
    const gap = 0.006
    const a0 = Math.PI / 2 - CM_SEG_ANGLE / 2 + gap
    const a1 = Math.PI / 2 + CM_SEG_ANGLE / 2 - gap
    const shape = new THREE.Shape()
    shape.absarc(0, 0, R_OUT, a0, a1, false)
    shape.absarc(0, 0, R_IN, a1, a0, true)
    shape.closePath()
    return new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 5 })
  }, [])
  const looks = useMemo(() => {
    if (!wheel) return []
    const ranks = [...new Set(wheel.filter((v) => v > 0))].sort((a, b) => a - b)
    return wheel.map((v) => segmentLook(v, ranks))
  }, [wheel])
  const mats = useMemo(() => looks.map((l) => enamel(l.color, l.color)), [looks])
  useEffect(() => () => { geo.dispose() }, [geo])
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats])

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const g = useGame.getState()
    const b = g.bonus?.kind === 'CM' ? g.bonus : null
    if (!b) return
    const plan = g.bonusSpin
    const spinning = b.stage === 'spinning' && plan !== null
    let angle = b.angle
    let omega = 0
    if (spinning && plan) {
      const t = (performance.now() - g.bonusSpinStartedAt) / 1000
      const r = sampleSpin(plan, t)
      angle = r.angle
      omega = r.omega
      // The wheel has physically stopped: only now is the result read from its resting angle.
      if (t >= plan.duration + 0.45 && st.current.landedSpin !== b.spinId) {
        st.current.landedSpin = b.spinId
        const seg = cmSegmentAt(plan.finalAngle, b.pick ?? 1)
        const value = b.wheel[seg]
        audio.land()
        if (value < 0) audio.bonus()
        const psi = CM_POINTER_OFFSETS[b.pick ?? 1] * CM_SEG_ANGLE
        const [px, py] = rim(psi, R_OUT - 0.2)
        burst.current?.fire(new THREE.Vector3(CENTER[0] + px, CENTER[1] + py, CENTER[2] + 0.6), value < 0 ? 220 : 130, value < 0 ? '#ffffff' : '#ffd75e', 6)
        g.cmLand()
      }
    }
    spin.current.rotation.z = -angle
    const boundary = Math.floor(angle / CM_SEG_ANGLE)
    if (spinning && st.current.wasSpinning && boundary !== st.current.boundary) audio.tick(Math.abs(omega))
    st.current.boundary = boundary
    st.current.wasSpinning = spinning

    const under = [0, 1, 2].map((p) => cmSegmentAt(angle, p))
    const settled = b.stage === 'result' || b.stage === 'boost'
    const pulse = 1.2 + Math.sin(clock.elapsedTime * 9) * 0.6
    for (let i = 0; i < mats.length; i++) {
      const mine = b.pick !== null && under[b.pick] === i
      const other = under.includes(i)
      const target = mine ? (settled ? pulse : 1.1) : other ? 0.5 : settled ? 0.04 : 0.14
      mats[i].emissiveIntensity = damp(mats[i].emissiveIntensity, target, spinning ? 30 : 8, dt)
    }
  })

  return (
    <group position={CENTER}>
      <mesh position-z={-0.25} rotation-x={Math.PI / 2} material={M.blackMetal} castShadow>
        <cylinderGeometry args={[R_OUT + 0.55, R_OUT + 0.55, 0.34, 96]} />
      </mesh>
      <mesh position-z={0.02} material={M.gold}>
        <torusGeometry args={[R_OUT + 0.42, 0.15, 18, 128]} />
      </mesh>
      <mesh position={[0, -4.2, -0.7]} material={M.blackMetal} castShadow>
        <boxGeometry args={[1.1, 4, 0.7]} />
      </mesh>
      <group ref={spin}>
        <mesh position-z={-0.04} rotation-x={Math.PI / 2} material={M.goldBrushed}>
          <cylinderGeometry args={[R_OUT + 0.1, R_OUT + 0.1, 0.1, 96]} />
        </mesh>
        {looks.map((l, i) => (
          <group key={i} rotation-z={(i + 0.5) * CM_SEG_ANGLE}>
            <mesh geometry={geo} material={mats[i]} castShadow dispose={null} />
            <mesh position={[0, 3.15, DEPTH + 0.03]}>
              <planeGeometry args={[0.44, 1.76]} />
              <meshBasicMaterial
                map={labelTexture(l.label, { width: 128, height: 512, size: l.label.length > 4 ? 74 : 92, vertical: true, color: l.text })}
                transparent toneMapped={false} depthWrite={false}
              />
            </mesh>
            <mesh position={rim(-CM_SEG_ANGLE / 2, R_OUT + 0.02)} position-z={DEPTH + 0.1} rotation-x={Math.PI / 2} material={M.chrome}>
              <cylinderGeometry args={[0.035, 0.035, 0.22, 8]} />
            </mesh>
          </group>
        ))}
        <mesh position-z={DEPTH} rotation-x={Math.PI / 2} material={M.gold} castShadow>
          <cylinderGeometry args={[R_IN + 0.04, R_IN + 0.2, 0.3, 64]} />
        </mesh>
        <mesh position-z={DEPTH + 0.16}>
          <circleGeometry args={[R_IN - 0.1, 64]} />
          <meshBasicMaterial map={labelTexture('CHAOS', { width: 512, height: 512, size: 120, color: '#f5c867' })} transparent toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

function Pointer({ index }: { index: number }) {
  const g = useRef<THREE.Group>(null!)
  const [hover, setHover] = useState(false)
  const color = CM_POINTER_COLORS[index]
  const psi = CM_POINTER_OFFSETS[index] * CM_SEG_ANGLE
  const pos = rim(psi, R_OUT + 0.62)
  const pick = useGame((s) => (s.bonus?.kind === 'CM' ? s.bonus.pick : null))
  const open = useGame((s) => s.phase === 'BONUS_ACTIVE' && s.bonus?.kind === 'CM' && s.bonus.stage === 'pick' && s.bonus.pick === null)
  const mine = pick === index
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.25, emissive: color, emissiveIntensity: 0.6 }), [color])
  useEffect(() => () => mat.dispose(), [mat])
  useFrame(({ clock }, dt) => {
    const s = damp(g.current.scale.x, mine ? 1.35 : hover && open ? 1.25 : pick !== null ? 0.8 : 1 + Math.sin(clock.elapsedTime * 3 + index) * 0.04, 8, dt)
    g.current.scale.setScalar(s)
    mat.emissiveIntensity = damp(mat.emissiveIntensity, mine ? 2.6 : hover && open ? 2 : pick !== null ? 0.15 : 0.7, 8, dt)
  })
  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    if (!open) return
    setHover(true)
    document.body.style.cursor = 'pointer'
  }
  const out = () => {
    setHover(false)
    document.body.style.cursor = ''
  }
  return (
    <group position={[CENTER[0] + pos[0], CENTER[1] + pos[1], CENTER[2] + DEPTH + 0.2]} rotation-z={psi}>
      <group
        ref={g}
        onPointerOver={over}
        onPointerOut={out}
        onClick={(e) => { e.stopPropagation(); if (open) { audio.ui(); useGame.getState().cmPick(index); out() } }}
      >
        <mesh position-y={0.2} material={M.blackMetal} castShadow>
          <boxGeometry args={[0.7, 0.5, 0.3]} />
        </mesh>
        <mesh position-y={-0.3} rotation-z={Math.PI} material={mat} castShadow>
          <coneGeometry args={[0.24, 0.8, 4]} />
        </mesh>
        <mesh position={[0, 0.2, 0.16]} material={mat}>
          <circleGeometry args={[0.16, 24]} />
        </mesh>
      </group>
    </group>
  )
}

/** Slowly turning mega-structure and drifting shards behind the wheel. */
function Backdrop({ energy }: { energy: React.RefObject<number> }) {
  const g = useRef<THREE.Group>(null!)
  const rocks = useRef<THREE.InstancedMesh | null>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const seeds = useMemo(
    () => Array.from({ length: 60 }, (_, i) => ({ a: Math.PI * (1.04 + (i / 60) * 0.92), r: 15 + ((i * 7) % 9), y: 2 + ((i * 13) % 14), s: 0.25 + ((i * 5) % 7) * 0.09 })),
    [],
  )
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
      dummy.position.set(Math.cos(s.a) * s.r, s.y + Math.sin(t * 0.5 + i) * 0.6, Math.sin(s.a) * s.r - 2)
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
        <mesh material={M.gold}><torusGeometry args={[7, 0.12, 10, 160]} /></mesh>
        <mesh material={M.chrome} rotation-x={1}><torusGeometry args={[8.5, 0.09, 10, 160]} /></mesh>
        <mesh material={M.blackMetal} rotation-y={1}><torusGeometry args={[10, 0.26, 10, 160]} /></mesh>
      </group>
      <instancedMesh ref={rocks} args={[undefined, undefined, seeds.length]} frustumCulled={false}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#120b24" metalness={0.9} roughness={0.25} emissive="#7a3bff" emissiveIntensity={0.3} flatShading />
      </instancedMesh>
    </>
  )
}

export default function ChaosMode() {
  const burst = useRef<BurstHandle>(null)
  const bonus = useGame((s) => (s.bonus?.kind === 'CM' ? s.bonus : null))
  const phase = useGame((s) => s.phase)
  const energy = useRef(0.3)
  const stage = bonus?.stage ?? 'pick'
  const boosts = bonus?.boosts ?? 0

  useEffect(() => () => { document.body.style.cursor = '' }, [])
  useEffect(() => {
    if (stage === 'spinning') audio.whoosh()
  }, [stage, bonus?.spinId])

  useFrame((_, dt) => {
    energy.current = damp(energy.current, (stage === 'spinning' ? 1 : 0.4) + boosts * 0.4, 2, dt)
  })

  const shot = (): Shot => {
    const g = useGame.getState()
    const b = g.bonus?.kind === 'CM' ? g.bonus : null
    if (phase === 'BONUS_RESULT' || !b) return { pos: [0, 4.6, 17], target: [0, 4.2, -3], fov: 44, speed: 1.6 }
    const psi = CM_POINTER_OFFSETS[b.pick ?? 1] * CM_SEG_ANGLE
    const [px, py] = rim(psi, R_OUT - 0.5)
    const close: Shot = { pos: [CENTER[0] + px * 0.8, CENTER[1] + py - 1.1, 5.2], target: [CENTER[0] + px, CENTER[1] + py - 0.9, CENTER[2]], fov: 40, speed: 1.6 }
    if (b.stage === 'result' || b.stage === 'boost') return close
    if (b.stage === 'spinning' && g.bonusSpin) {
      const left = g.bonusSpin.duration - (performance.now() - g.bonusSpinStartedAt) / 1000
      if (left < 3.4) return close
      return { pos: [0, 4.8, 12], target: [0, 4.6, -3], fov: 44, speed: 1.8 }
    }
    return { pos: [0, 4.4, 17.5], target: [0, 3.9, -3], fov: 42 }
  }

  return (
    <BonusStage a="#b86bff" b="#ffd75e" radius={12} pillars={14} hostX={8.6} hostZ={1.5} dust="#e2c8ff" energy={0.5 + boosts * 0.4}>
      <BonusCamera shot={shot} drift={0.12} />
      <Backdrop energy={energy} />
      <GrandWheel burst={burst} />
      {[0, 1, 2].map((i) => (
        <Pointer key={i} index={i} />
      ))}
      <mesh position={[0, 0.3, -3.6]} material={M.gloss} castShadow>
        <cylinderGeometry args={[2.6, 3.2, 0.6, 8]} />
      </mesh>
      <Burst ref={burst} size={0.15} gravity={3.5} />
      <Shockwave trigger={stage === 'boost' ? boosts : 0} color="#ffffff" radius={10} position={[CENTER[0], CENTER[1], CENTER[2] + 0.4]} vertical />
      <Shockwave trigger={stage === 'result'} color="#ffd75e" radius={8} position={[CENTER[0], CENTER[1], CENTER[2] + 0.4]} vertical />
    </BonusStage>
  )
}
