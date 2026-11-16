import { MeshReflectorMaterial } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { JACKPOT_THRESHOLD } from '../../game/logic/bonus'
import { SEGMENTS, SEGMENT_ORDER, WHEEL_COUNTS, SEGMENT_COUNT, isBonus } from '../../game/logic/segments'
import { PHASE_LABEL } from '../../game/state/machine'
import { useGame, type GameStore } from '../../game/state/store'
import { M, glow } from '../../materials'
import { createBeamMaterial, createLedWallMaterial } from '../../shaders'
import { damp } from '../../utils/math'
import { DISPLAY_FONT } from '../../utils/textures'
import { Confetti, GoldDust, Shockwave } from '../Effects/Ambient'
import { Presenter } from '../Presenter/Presenter'
import { WHEEL_POS, Wheel } from '../Wheel/Wheel'

interface Mood {
  a: string
  b: string
  wall: number
  speed: number
  key: number
  beams: number
  sweep: number
}

/** The lighting cue for the current moment of the show. */
function moodFor(g: GameStore, now: number): Mood {
  switch (g.phase) {
    case 'BETTING': {
      const left = Math.max(0, (g.bettingEndsAt - now) / 1000)
      const build = 1 - Math.min(1, left / 6)
      return { a: '#5a2bd6', b: '#f5c867', wall: 0.55 + build * 0.5, speed: 0.8 + build * 1.6, key: 60 + build * 50, beams: 0.22 + build * 0.4, sweep: 0.5 + build }
    }
    case 'LOCKED':
      return { a: '#1c3fd8', b: '#ffffff', wall: 0.35, speed: 0.4, key: 45, beams: 0.15, sweep: 0.2 }
    case 'SPINNING':
      return { a: '#d81cc0', b: '#35e0ff', wall: 1.1, speed: 3.2, key: 80, beams: 0.75, sweep: 3.2 }
    case 'DECELERATING':
      return { a: '#7a1dd1', b: '#35e0ff', wall: 0.8, speed: 1.4, key: 90, beams: 0.5, sweep: 1.2 }
    case 'RESULT':
    case 'BONUS_INTRO': {
      const info = g.result ? SEGMENTS[g.result.type] : SEGMENTS['1']
      const bonus = g.result ? isBonus(g.result.type) : false
      return { a: info.glow, b: bonus ? '#ffffff' : '#f5c867', wall: bonus ? 1.7 : 1.0, speed: bonus ? 4 : 1.5, key: bonus ? 140 : 110, beams: bonus ? 1.0 : 0.5, sweep: bonus ? 4 : 1 }
    }
    default:
      return { a: '#5a2bd6', b: '#f5c867', wall: 0.6, speed: 0.8, key: 70, beams: 0.25, sweep: 0.5 }
  }
}

function LedWall({ mood }: { mood: React.RefObject<Mood> }) {
  const mat = useMemo(() => createLedWallMaterial(), [])
  const ca = useMemo(() => new THREE.Color(), [])
  useEffect(() => () => mat.dispose(), [mat])
  useFrame(({ clock }, dt) => {
    const m = mood.current
    const u = mat.uniforms
    u.uTime.value = clock.elapsedTime
    u.uA.value.lerp(ca.set(m.a), 1 - Math.exp(-4 * dt))
    u.uB.value.lerp(ca.set(m.b), 1 - Math.exp(-4 * dt))
    u.uPower.value = damp(u.uPower.value, m.wall, 4, dt)
    u.uSpeed.value = damp(u.uSpeed.value, m.speed, 2, dt)
  })
  return (
    <group>
      <mesh position={[0, 5.4, 0]} material={mat}>
        <cylinderGeometry args={[18, 18, 9.5, 120, 1, true, Math.PI - 1.75, 3.5]} />
      </mesh>
      {/* frame of the wall */}
      {[0.55, 10.25].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation-x={Math.PI / 2} rotation-z={-Math.PI / 2 - 1.75} material={M.blackMetal}>
          <torusGeometry args={[17.95, 0.16, 8, 120, 3.5]} />
        </mesh>
      ))}
    </group>
  )
}

function Architecture() {
  const pillars = useMemo(() => Array.from({ length: 9 }, (_, i) => Math.PI - 1.6 + (i / 8) * 3.2), [])
  const strip = useMemo(() => glow('#f5c867', 2.2), [])
  return (
    <group>
      {/* stage tiers */}
      <mesh position-y={0.06} material={M.blackMetal} receiveShadow>
        <cylinderGeometry args={[10.2, 10.6, 0.12, 96]} />
      </mesh>
      <mesh position-y={0.21} material={M.gloss} receiveShadow castShadow>
        <cylinderGeometry args={[8, 8.2, 0.18, 96]} />
      </mesh>
      <mesh position-y={0.3} rotation-x={Math.PI / 2} material={M.gold}>
        <torusGeometry args={[8, 0.05, 10, 128]} />
      </mesh>
      <mesh position-y={0.14} rotation-x={Math.PI / 2} material={strip}>
        <torusGeometry args={[8.22, 0.035, 8, 128]} />
      </mesh>
      <mesh position-y={0.125} rotation-x={Math.PI / 2} material={M.gold}>
        <torusGeometry args={[10.2, 0.04, 8, 128]} />
      </mesh>
      <mesh position-y={0.305} rotation-x={-Math.PI / 2} material={strip}>
        <ringGeometry args={[5.2, 5.26, 96]} />
      </mesh>
      <mesh position-y={0.305} rotation-x={-Math.PI / 2} material={strip}>
        <ringGeometry args={[6.9, 6.93, 96]} />
      </mesh>

      {/* arches framing the wheel */}
      <mesh position={[0, 0.3, -3.2]} material={M.gold} castShadow>
        <torusGeometry args={[6.4, 0.16, 14, 96, Math.PI]} />
      </mesh>
      <mesh position={[0, 0.3, -3.2]} material={strip}>
        <torusGeometry args={[6.15, 0.035, 8, 96, Math.PI]} />
      </mesh>
      <mesh position={[0, 0.3, -5.4]} material={M.blackMetal}>
        <torusGeometry args={[8.6, 0.3, 14, 96, Math.PI]} />
      </mesh>
      <mesh position={[0, 0.3, -5.1]} material={strip}>
        <torusGeometry args={[8.6, 0.04, 8, 96, Math.PI]} />
      </mesh>
      <mesh position={[0, 0.3, -8]} material={M.chrome}>
        <torusGeometry args={[11.2, 0.12, 12, 96, Math.PI]} />
      </mesh>

      {/* pillars along the LED wall */}
      {pillars.map((a, i) => (
        <group key={i} position={[Math.sin(a) * 16.8, 0, Math.cos(a) * 16.8]} rotation-y={a + Math.PI}>
          <mesh position-y={5.4} material={M.blackMetal}>
            <boxGeometry args={[0.7, 10.8, 0.5]} />
          </mesh>
          <mesh position={[0, 5.4, 0.26]} material={strip}>
            <boxGeometry args={[0.07, 10.2, 0.02]} />
          </mesh>
          <mesh position={[0, 10.6, 0.1]} material={M.gold}>
            <boxGeometry args={[0.9, 0.25, 0.7]} />
          </mesh>
        </group>
      ))}

      {/* ceiling truss */}
      <mesh position-y={11} rotation-x={Math.PI / 2} material={M.blackMetal}>
        <torusGeometry args={[8.5, 0.18, 8, 72]} />
      </mesh>
      <mesh position-y={11.4} rotation-x={Math.PI / 2} material={M.blackMetal}>
        <torusGeometry args={[5, 0.14, 8, 60]} />
      </mesh>
      <mesh position-y={10.82} rotation-x={Math.PI / 2} material={strip}>
        <torusGeometry args={[8.5, 0.03, 6, 72]} />
      </mesh>
    </group>
  )
}

const HEADS = 8

function MovingHeads({ mood }: { mood: React.RefObject<Mood> }) {
  const refs = useRef<(THREE.Group | null)[]>([])
  const cone = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.07, 1.5, 12, 28, 1, true)
    g.translate(0, -6, 0)
    return g
  }, [])
  const mats = useMemo(() => Array.from({ length: HEADS }, () => createBeamMaterial('#ffffff')), [])
  const col = useMemo(() => new THREE.Color(), [])
  const phase = useRef(0)
  useEffect(() => () => { cone.dispose(); mats.forEach((m) => m.dispose()) }, [cone, mats])
  useFrame((_, dt) => {
    const m = mood.current
    phase.current += dt * m.sweep
    const t = phase.current
    for (let i = 0; i < HEADS; i++) {
      const g = refs.current[i]
      if (!g) continue
      g.rotation.x = Math.sin(t * 0.6 + i * 1.7) * 0.45 + 0.1
      g.rotation.z = Math.cos(t * 0.5 + i * 2.3) * 0.5
      const u = mats[i].uniforms
      u.uColor.value.lerp(col.set(i % 2 ? m.a : m.b), 1 - Math.exp(-4 * dt))
      u.uPower.value = damp(u.uPower.value, m.beams, 4, dt)
    }
  })
  return (
    <>
      {Array.from({ length: HEADS }, (_, i) => {
        const a = (i / HEADS) * Math.PI * 2 + 0.4
        return (
          <group key={i} position={[Math.cos(a) * 8.5, 10.8, Math.sin(a) * 8.5]}>
            <mesh material={M.blackMetal}>
              <boxGeometry args={[0.42, 0.3, 0.42]} />
            </mesh>
            <group ref={(g) => { refs.current[i] = g }}>
              <mesh position-y={-0.3} material={M.darkPanel}>
                <cylinderGeometry args={[0.16, 0.2, 0.42, 14]} />
              </mesh>
              <mesh geometry={cone} material={mats[i]} position-y={-0.5} />
            </group>
          </group>
        )
      })}
    </>
  )
}

/** Canvas-backed LED panels showing live game information. */
function InfoScreens() {
  const left = useMemo(() => makeScreen(), [])
  const right = useMemo(() => makeScreen(), [])
  const last = useRef('')
  useEffect(() => () => { left.tex.dispose(); right.tex.dispose() }, [left, right])
  useFrame(() => {
    const g = useGame.getState()
    const cd = g.phase === 'BETTING' ? Math.max(0, Math.ceil((g.bettingEndsAt - performance.now()) / 1000)) : -1
    const key = `${g.round}|${g.phase}|${cd}|${g.history.join(',')}|${g.result?.type}`
    if (key === last.current) return
    last.current = key
    drawStatus(left, g, cd)
    drawHistory(right, g)
  })
  return (
    <>
      {([[-8.4, left, 0.55], [8.4, right, -0.55]] as const).map(([x, sc, ry]) => (
        <group key={x} position={[x, 5.6, -4.2]} rotation-y={ry}>
          <mesh position-z={-0.09} material={M.blackMetal} castShadow>
            <boxGeometry args={[5.1, 3, 0.16]} />
          </mesh>
          <mesh>
            <planeGeometry args={[4.8, 2.7]} />
            <meshBasicMaterial map={sc.tex} toneMapped={false} />
          </mesh>
          <mesh position={[0, -3.6, -0.1]} material={M.blackMetal}>
            <cylinderGeometry args={[0.1, 0.14, 4.3, 10]} />
          </mesh>
          <mesh position={[0, 0, -0.02]} material={M.gold}>
            <boxGeometry args={[4.92, 2.82, 0.02]} />
          </mesh>
        </group>
      ))}
    </>
  )
}

interface Screen { c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture }

function makeScreen(): Screen {
  const c = document.createElement('canvas')
  c.width = 768
  c.height = 432
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return { c, g: c.getContext('2d')!, tex }
}

function clearScreen({ g, c }: Screen, title: string) {
  const grad = g.createLinearGradient(0, 0, 0, c.height)
  grad.addColorStop(0, '#0d0920')
  grad.addColorStop(1, '#040308')
  g.fillStyle = grad
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#f5c867'
  g.font = `600 30px ${DISPLAY_FONT}`
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  g.fillText(title, 40, 62)
  g.fillRect(40, 78, c.width - 80, 2)
}

function drawStatus(sc: Screen, s: GameStore, cd: number) {
  const { g, c } = sc
  clearScreen(sc, `PROJECT CHAOS  ·  ROUND ${s.round}`)
  g.textAlign = 'center'
  if (cd >= 0) {
    g.fillStyle = cd <= 5 ? '#ff4a68' : '#ffffff'
    g.font = `700 210px ${DISPLAY_FONT}`
    g.fillText(String(cd), c.width / 2, 300)
  } else if (s.result && (s.phase === 'RESULT' || s.phase === 'BONUS_INTRO' || s.phase === 'ROUND_COMPLETE')) {
    const info = SEGMENTS[s.result.type]
    g.fillStyle = info.glow
    g.font = `700 ${info.bonus ? 120 : 210}px ${DISPLAY_FONT}`
    g.fillText(info.label, c.width / 2, info.bonus ? 270 : 300)
  } else {
    g.fillStyle = '#35e0ff'
    g.font = `700 110px ${DISPLAY_FONT}`
    g.fillText(s.phase === 'LOCKED' ? 'LOCKED' : 'SPINNING', c.width / 2, 270)
  }
  g.fillStyle = '#b9b3cf'
  g.font = `500 34px ${DISPLAY_FONT}`
  g.fillText(PHASE_LABEL[s.phase].toUpperCase(), c.width / 2, 390)
  sc.tex.needsUpdate = true
}

function drawHistory(sc: Screen, s: GameStore) {
  const { g, c } = sc
  clearScreen(sc, 'PREVIOUS RESULTS')
  const items = s.history.slice(0, 10)
  g.textAlign = 'center'
  items.forEach((t, i) => {
    const info = SEGMENTS[t]
    const x = 40 + (i % 5) * 140
    const y = 104 + Math.floor(i / 5) * 92
    g.fillStyle = info.color
    g.strokeStyle = info.glow
    g.lineWidth = i === 0 ? 5 : 2
    g.beginPath()
    g.roundRect(x, y, 124, 74, 12)
    g.fill()
    g.stroke()
    g.fillStyle = info.text
    g.font = `700 ${info.bonus ? 26 : 46}px ${DISPLAY_FONT}`
    g.fillText(info.label, x + 62, y + (info.bonus ? 47 : 54))
  })
  if (items.length === 0) {
    g.fillStyle = '#6f688a'
    g.font = `500 36px ${DISPLAY_FONT}`
    g.fillText('FIRST SPIN OF THE SHOW', c.width / 2, 200)
  }
  g.font = `500 22px ${DISPLAY_FONT}`
  SEGMENT_ORDER.forEach((t, i) => {
    const x = 40 + i * 88
    g.fillStyle = SEGMENTS[t].glow
    g.fillText(SEGMENTS[t].label.slice(0, 5), x + 40, 340)
    g.fillStyle = '#b9b3cf'
    g.fillText(`${WHEEL_COUNTS[t]}/${SEGMENT_COUNT}`, x + 40, 372)
  })
  g.fillStyle = '#6f688a'
  g.font = `500 18px ${DISPLAY_FONT}`
  g.fillText('POCKETS ON THE WHEEL', c.width / 2, 410)
  sc.tex.needsUpdate = true
}

function Sculpture({ position, color }: { position: [number, number, number]; color: string }) {
  const g = useRef<THREE.Group>(null!)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    g.current.children.forEach((c, i) => {
      c.rotation.x = t * (0.3 + i * 0.17)
      c.rotation.y = t * (0.2 + i * 0.11)
    })
    g.current.position.y = position[1] + Math.sin(t * 0.8 + position[0]) * 0.2
  })
  return (
    <group position={position}>
      <group ref={g}>
        <mesh material={M.gold}><torusGeometry args={[1.1, 0.045, 10, 64]} /></mesh>
        <mesh material={M.chrome}><torusGeometry args={[0.85, 0.04, 10, 64]} /></mesh>
        <mesh material={M.gold}><torusGeometry args={[0.6, 0.035, 10, 64]} /></mesh>
        <mesh>
          <icosahedronGeometry args={[0.32, 0]} />
          <meshStandardMaterial color="#000" emissive={color} emissiveIntensity={2.5} toneMapped={false} flatShading />
        </mesh>
      </group>
      <mesh position-y={-position[1] / 2 - 0.6} material={M.blackMetal}>
        <cylinderGeometry args={[0.05, 0.3, position[1] - 1.4, 10]} />
      </mesh>
    </group>
  )
}

export function Studio() {
  const tier = useGame((s) => s.tier)
  const phase = useGame((s) => s.phase)
  const result = useGame((s) => s.result)
  const lastWin = useGame((s) => s.lastWin)
  const mood = useRef<Mood>(moodFor(useGame.getState(), performance.now()))
  const key = useRef<THREE.SpotLight>(null!)
  const washA = useRef<THREE.PointLight>(null!)
  const washB = useRef<THREE.PointLight>(null!)
  const col = useMemo(() => new THREE.Color(), [])
  const target = useMemo(() => {
    const o = new THREE.Object3D()
    o.position.set(0.8, 3, -1)
    return o
  }, [])

  useFrame((_, dt) => {
    const m = (mood.current = moodFor(useGame.getState(), performance.now()))
    const k = 1 - Math.exp(-4 * dt)
    key.current.intensity = damp(key.current.intensity, m.key * 9, 4, dt)
    washA.current.color.lerp(col.set(m.a), k)
    washB.current.color.lerp(col.set(m.b), k)
    washA.current.intensity = damp(washA.current.intensity, 140 + m.wall * 260, 4, dt)
    washB.current.intensity = damp(washB.current.intensity, 100 + m.wall * 160, 4, dt)
  })

  const bonusHit = result !== null && isBonus(result.type) && (phase === 'RESULT' || phase === 'BONUS_INTRO')
  const celebrate = (phase === 'RESULT' && (lastWin > 0 || bonusHit)) || phase === 'BONUS_INTRO'
  const big = lastWin >= JACKPOT_THRESHOLD

  return (
    <group>
      <ambientLight intensity={0.22} color="#8f86c9" />
      <hemisphereLight args={['#6a5acd', '#0a0612', 0.5]} />
      <primitive object={target} />
      <spotLight
        ref={key}
        position={[5, 13, 11]}
        target={target}
        angle={0.5}
        penumbra={0.7}
        intensity={600}
        color="#fff1dc"
        castShadow={tier === 'high'}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
      />
      <spotLight position={[-7, 9, 8]} target={target} angle={0.6} penumbra={1} intensity={260} color="#9db4ff" />
      <pointLight ref={washA} position={[-9, 5, -6]} intensity={300} distance={40} color="#5a2bd6" />
      <pointLight ref={washB} position={[9, 5, -6]} intensity={200} distance={40} color="#f5c867" />
      <pointLight position={[0, 1.6, 4]} intensity={30} distance={14} color="#ffd98a" />

      {/* floor */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[42, 72]} />
        {tier === 'high' ? (
          <MeshReflectorMaterial
            blur={[320, 90]}
            resolution={1024}
            mixBlur={1}
            mixStrength={26}
            roughness={0.9}
            depthScale={1.1}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.4}
            color="#07060c"
            metalness={0.7}
            mirror={0.6}
          />
        ) : (
          <meshStandardMaterial color="#07060c" metalness={0.85} roughness={0.22} />
        )}
      </mesh>

      <LedWall mood={mood} />
      <Architecture />
      <MovingHeads mood={mood} />
      <InfoScreens />
      <Sculpture position={[-12.5, 4.2, 1.5]} color="#35e0ff" />
      <Sculpture position={[12.5, 4.2, 1.5]} color="#ff5cf0" />

      <Wheel />
      <Presenter position={[4.35, 0.3, 0.9]} rotation-y={-0.12} scale={1.5} />

      <GoldDust count={tier === 'high' ? 520 : 200} />
      <Confetti active={celebrate} origin={[0, 9, 1]} spread={big ? 16 : 11} />
      <Shockwave trigger={bonusHit} color={result ? SEGMENTS[result.type].glow : '#fff'} radius={16} position={[0, 0.45, 0]} />
      <Shockwave trigger={bonusHit} color="#ffffff" radius={7} position={[WHEEL_POS[0], WHEEL_POS[1], WHEEL_POS[2] + 0.5]} vertical />
    </group>
  )
}
