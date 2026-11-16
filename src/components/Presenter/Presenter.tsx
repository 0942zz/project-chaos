import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { JACKPOT_THRESHOLD } from '../../game/logic/bonus'
import { isBonus } from '../../game/logic/segments'
import { useGame, type GameStore } from '../../game/state/store'
import { M } from '../../materials'
import { damp } from '../../utils/math'

export type PresenterMode =
  | 'idle' | 'welcome' | 'explain' | 'introduce' | 'anticipate' | 'watch' | 'celebrate' | 'present' | 'bonus' | 'jackpot'

/** Joint targets. Arm "a" is on the wheel side (−x), arm "b" holds the microphone. */
interface Pose {
  rootY: number; rootRy: number; spineRx: number; spineRz: number; headRx: number; headRy: number
  aSx: number; aSz: number; aE: number; bSx: number; bSz: number; bE: number; talk: number
}

const REST: Pose = {
  rootY: 0, rootRy: 0, spineRx: 0, spineRz: 0, headRx: 0, headRy: 0,
  aSx: 0, aSz: -0.14, aE: -0.3, bSx: -0.45, bSz: 0.18, bE: -1.95, talk: 0,
}

const s = Math.sin

/** Each mode is a small procedural animation clip: joint targets as a function of time. */
const CLIPS: Record<PresenterMode, (t: number) => Partial<Pose>> = {
  idle: (t) => ({ spineRz: s(t * 0.7) * 0.03, headRy: s(t * 0.5) * 0.25, headRx: s(t * 0.9) * 0.04, aSz: -0.14 + s(t * 0.8) * 0.03 }),
  welcome: (t) => ({
    aSz: -2.45 + s(t * 7) * 0.28, aSx: -0.15, aE: -0.5, spineRz: -0.06 + s(t * 3.5) * 0.03, headRy: s(t * 1.2) * 0.2,
    rootY: Math.abs(s(t * 3.5)) * 0.03, talk: 1,
  }),
  explain: (t) => ({
    aSx: -0.95 + s(t * 2.3) * 0.25, aSz: -0.45 + s(t * 1.4) * 0.3, aE: -1.05 + s(t * 3.1) * 0.35,
    bSx: -0.6 + s(t * 1.9) * 0.08, headRy: s(t * 0.9) * 0.3, headRx: s(t * 2.1) * 0.06, spineRz: s(t * 1.1) * 0.05,
    rootRy: s(t * 0.6) * 0.15, talk: 1,
  }),
  introduce: (t) => ({
    aSz: -1.8 + s(t * 2.5) * 0.08, aSx: -0.25, aE: -0.15, rootRy: -0.35, headRy: -0.35 + s(t * 1.5) * 0.3, spineRz: 0.07, talk: 1,
  }),
  anticipate: (t) => ({
    spineRx: 0.14, aSx: -1.0, aSz: -0.05, aE: -1.9 + s(t * 11) * 0.08, bSx: -0.8, rootY: -0.03 + Math.abs(s(t * 5)) * 0.03,
    headRy: -0.3, headRx: -0.05, rootRy: -0.25,
  }),
  watch: (t) => ({
    rootRy: -0.75, headRy: -0.25, headRx: -0.22, spineRx: 0.06, aSx: -1.25, aSz: -0.2, aE: -1.9 + s(t * 9) * 0.25,
    rootY: Math.abs(s(t * 4.5)) * 0.025,
  }),
  celebrate: (t) => ({
    aSz: -2.75 + s(t * 9) * 0.18, bSz: 2.5 + s(t * 9 + 1) * 0.18, bSx: 0, bE: -0.4, aE: -0.35, rootY: Math.abs(s(t * 6.5)) * 0.14,
    spineRz: s(t * 6.5) * 0.08, headRx: -0.18, talk: 1,
  }),
  present: (t) => ({
    aSz: -1.45, aSx: -0.3, aE: -0.3 + s(t * 2) * 0.1, rootRy: -0.3, headRy: s(t * 1.3) * 0.25, spineRz: 0.05, talk: 1,
  }),
  bonus: (t) => ({
    aSz: -2.0 + s(t * 4) * 0.25, bSz: 1.9 + s(t * 4 + 2) * 0.25, bSx: -0.1, bE: -0.5, aE: -0.25, rootY: Math.abs(s(t * 5)) * 0.09,
    rootRy: s(t * 2) * 0.35, headRx: -0.12, spineRx: -0.06, talk: 1,
  }),
  jackpot: (t) => ({
    aSz: -2.85 + s(t * 12) * 0.2, bSz: 2.7 + s(t * 12 + 1) * 0.2, bSx: 0, bE: -0.3, aE: -0.2, rootY: Math.abs(s(t * 7.5)) * 0.24,
    rootRy: s(t * 3) * 0.9, spineRz: s(t * 7.5) * 0.12, headRx: -0.3, talk: 1,
  }),
}

/** Maps game state to what the host should be doing in the studio. */
function studioMode(g: GameStore, now: number): PresenterMode {
  const age = (now - g.phaseStartedAt) / 1000
  switch (g.phase) {
    case 'IDLE': return 'welcome'
    case 'BETTING': {
      const left = (g.bettingEndsAt - now) / 1000
      if (left < 5) return 'anticipate'
      if (age < 2.5 && g.round === 1) return 'welcome'
      return Math.floor(age / 4) % 2 === 0 ? 'introduce' : 'explain'
    }
    case 'LOCKED': return 'anticipate'
    case 'SPINNING':
    case 'DECELERATING': return 'watch'
    case 'RESULT': return g.result && isBonus(g.result.type) ? 'bonus' : g.lastWin > 0 ? 'celebrate' : 'present'
    case 'BONUS_INTRO': return 'bonus'
    default: return 'idle'
  }
}

function bonusMode(g: GameStore): PresenterMode {
  if (g.phase === 'BONUS_RESULT') return (g.bonusMultiplier ?? 0) >= JACKPOT_THRESHOLD ? 'jackpot' : 'celebrate'
  const b = g.bonus
  if (!b) return 'idle'
  if (b.kind === 'DON') return b.status === 'flipping' ? 'watch' : b.status === 'won' || b.status === 'maxed' ? 'celebrate' : 'explain'
  if (b.kind === 'TS') return b.picks.length > 0 && b.status === 'done' ? 'celebrate' : 'explain'
  if (b.kind === 'GD') return b.status === 'dropping' ? 'watch' : b.status === 'landed' ? 'celebrate' : 'introduce'
  return b.stage === 'stopping' || b.stage === 'surge' ? 'watch' : b.stage === 'applied' ? 'celebrate' : 'explain'
}

const jacket = new THREE.MeshPhysicalMaterial({ color: '#34106b', roughness: 0.55, metalness: 0.15, sheen: 1, sheenColor: new THREE.Color('#b98cff'), sheenRoughness: 0.35 })
const trousers = new THREE.MeshStandardMaterial({ color: '#0c0b14', roughness: 0.6 })
const skin = new THREE.MeshStandardMaterial({ color: '#c88a62', roughness: 0.55 })
const hair = new THREE.MeshStandardMaterial({ color: '#eceaf5', roughness: 0.35, metalness: 0.3 })
const white = new THREE.MeshStandardMaterial({ color: '#f6f4ef', roughness: 0.5 })
const dark = new THREE.MeshStandardMaterial({ color: '#16090a', roughness: 0.4 })
const lip = new THREE.MeshStandardMaterial({ color: '#7a2a2a', roughness: 0.4 })

function Arm({ side, shoulder, elbow, mic }: { side: 1 | -1; shoulder: React.RefObject<THREE.Group | null>; elbow: React.RefObject<THREE.Group | null>; mic?: boolean }) {
  return (
    <group ref={shoulder} position={[side * 0.235, 0.5, 0]}>
      <mesh material={jacket} castShadow>
        <sphereGeometry args={[0.078, 16, 14]} />
      </mesh>
      <mesh position-y={-0.15} material={jacket} castShadow>
        <capsuleGeometry args={[0.056, 0.2, 6, 14]} />
      </mesh>
      <group ref={elbow} position-y={-0.3}>
        <mesh position-y={-0.12} material={jacket} castShadow>
          <capsuleGeometry args={[0.05, 0.18, 6, 14]} />
        </mesh>
        <mesh position-y={-0.245} material={white}>
          <cylinderGeometry args={[0.052, 0.052, 0.035, 14]} />
        </mesh>
        <mesh position-y={-0.262} material={M.gold}>
          <torusGeometry args={[0.052, 0.008, 6, 16]} />
        </mesh>
        <mesh position-y={-0.31} scale={[1, 1.2, 0.8]} material={skin} castShadow>
          <sphereGeometry args={[0.05, 14, 12]} />
        </mesh>
        {mic && (
          <group position={[0, -0.33, 0.03]} rotation-x={0.5}>
            <mesh material={M.blackMetal}>
              <cylinderGeometry args={[0.017, 0.014, 0.17, 10]} />
            </mesh>
            <mesh position-y={-0.115} material={M.chrome}>
              <sphereGeometry args={[0.036, 14, 12]} />
            </mesh>
            <mesh position-y={-0.085} material={M.gold}>
              <cylinderGeometry args={[0.022, 0.022, 0.012, 12]} />
            </mesh>
          </group>
        )}
      </group>
    </group>
  )
}

function Leg({ side }: { side: 1 | -1 }) {
  return (
    <group position={[side * 0.1, 0.95, 0]}>
      <mesh position-y={-0.23} material={trousers} castShadow>
        <capsuleGeometry args={[0.078, 0.34, 6, 14]} />
      </mesh>
      <mesh position-y={-0.66} material={trousers} castShadow>
        <capsuleGeometry args={[0.06, 0.38, 6, 14]} />
      </mesh>
      <mesh position={[0, -0.915, 0.05]} scale={[0.07, 0.042, 0.15]} material={M.gloss} castShadow>
        <sphereGeometry args={[1, 16, 12]} />
      </mesh>
      <mesh position={[0, -0.33, 0.079]} material={M.gold}>
        <boxGeometry args={[0.012, 0.9, 0.004]} />
      </mesh>
    </group>
  )
}

export function Presenter({ context = 'studio', ...props }: { context?: 'studio' | 'bonus' } & React.ComponentProps<'group'>) {
  const root = useRef<THREE.Group>(null!)
  const spine = useRef<THREE.Group>(null!)
  const head = useRef<THREE.Group>(null!)
  const aS = useRef<THREE.Group>(null)
  const aE = useRef<THREE.Group>(null)
  const bS = useRef<THREE.Group>(null)
  const bE = useRef<THREE.Group>(null)
  const mouth = useRef<THREE.Mesh>(null!)
  const eyes = useRef<THREE.Group>(null!)
  const pose = useRef<Pose>({ ...REST })

  const torso = useMemo(() => {
    const pts = [[0.215, -0.1], [0.19, 0.0], [0.158, 0.17], [0.172, 0.3], [0.2, 0.43], [0.2, 0.5], [0.15, 0.56], [0.06, 0.6], [0.001, 0.6]].map(
      ([x, y]) => new THREE.Vector2(x, y),
    )
    return new THREE.LatheGeometry(pts, 28)
  }, [])

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const t = clock.elapsedTime
    const g = useGame.getState()
    const mode = context === 'studio' ? studioMode(g, performance.now()) : bonusMode(g)
    const target: Pose = { ...REST, ...CLIPS[mode](t) }
    const p = pose.current
    for (const k of Object.keys(p) as (keyof Pose)[]) p[k] = damp(p[k], target[k], 7, dt)

    const breathe = s(t * 1.6) * 0.008
    root.current.position.y = p.rootY
    root.current.rotation.y = p.rootRy
    spine.current.rotation.set(p.spineRx, 0, p.spineRz)
    spine.current.scale.set(1, 1 + breathe, 1)
    head.current.rotation.set(p.headRx, p.headRy, s(t * 0.8) * 0.03)
    aS.current?.rotation.set(p.aSx, 0, p.aSz)
    aE.current?.rotation.set(p.aE, 0, 0)
    bS.current?.rotation.set(p.bSx, 0, p.bSz)
    bE.current?.rotation.set(p.bE, 0, 0)
    const open = p.talk * (0.35 + 0.65 * Math.abs(s(t * 11) * s(t * 3.7)))
    mouth.current.scale.set(1 + p.talk * 0.25, 0.25 + open * 1.3, 1)
    const blink = (t % 3.7) < 0.12 ? 0.1 : 1
    eyes.current.scale.y = blink
  })

  return (
    <group {...props}>
      <group ref={root}>
        <Leg side={1} />
        <Leg side={-1} />
        <group ref={spine} position-y={0.95}>
          <mesh geometry={torso} scale={[1, 1, 0.66]} material={jacket} castShadow />
          {/* coat tails */}
          {[1, -1].map((sd) => (
            <mesh key={sd} position={[sd * 0.085, -0.25, -0.115]} rotation={[0.16, 0, sd * 0.06]} material={jacket} castShadow>
              <boxGeometry args={[0.14, 0.36, 0.02]} />
            </mesh>
          ))}
          {/* shirt, lapels, bow tie, buttons */}
          <mesh position={[0, 0.4, 0.068]} scale={[0.07, 0.18, 0.07]} material={white}>
            <sphereGeometry args={[1, 16, 14]} />
          </mesh>
          {[1, -1].map((sd) => (
            <mesh key={sd} position={[sd * 0.062, 0.4, 0.126]} rotation={[0.1, 0, sd * 0.3]} material={M.gold}>
              <boxGeometry args={[0.022, 0.3, 0.012]} />
            </mesh>
          ))}
          {[1, -1].map((sd) => (
            <mesh key={sd} position={[sd * 0.036, 0.565, 0.1]} rotation-z={sd * Math.PI / 2} material={M.gold}>
              <coneGeometry args={[0.028, 0.065, 4]} />
            </mesh>
          ))}
          {[0.2, 0.1].map((y) => (
            <mesh key={y} position={[0, y, 0.108]} material={M.gold}>
              <sphereGeometry args={[0.014, 10, 8]} />
            </mesh>
          ))}
          <mesh position={[0.105, 0.42, 0.116]} rotation-z={-0.2} material={M.gold}>
            <octahedronGeometry args={[0.022]} />
          </mesh>

          <Arm side={-1} shoulder={aS} elbow={aE} />
          <Arm side={1} shoulder={bS} elbow={bE} mic />

          <mesh position-y={0.63} material={skin}>
            <cylinderGeometry args={[0.042, 0.048, 0.1, 12]} />
          </mesh>
          <group ref={head} position-y={0.68}>
            <mesh position-y={0.1} scale={[1, 1.16, 1.03]} material={skin} castShadow>
              <sphereGeometry args={[0.105, 24, 20]} />
            </mesh>
            {/* swept-back platinum pompadour */}
            <mesh position={[0, 0.16, -0.022]} scale={[1.05, 0.95, 1.08]} material={hair} castShadow>
              <sphereGeometry args={[0.108, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
            </mesh>
            <mesh position={[0, 0.235, 0.045]} rotation-x={-0.5} scale={[0.95, 0.62, 1.25]} material={hair} castShadow>
              <sphereGeometry args={[0.085, 16, 14]} />
            </mesh>
            <mesh position={[0, 0.262, -0.03]} rotation-x={-0.2} scale={[0.7, 0.5, 1.2]} material={hair}>
              <sphereGeometry args={[0.08, 14, 12]} />
            </mesh>
            {[1, -1].map((sd) => (
              <mesh key={sd} position={[sd * 0.106, 0.1, -0.005]} scale={[0.5, 1, 0.8]} material={skin}>
                <sphereGeometry args={[0.024, 10, 8]} />
              </mesh>
            ))}
            <group ref={eyes} position-y={0.118}>
              {[1, -1].map((sd) => (
                <group key={sd} position={[sd * 0.038, 0, 0.089]}>
                  <mesh material={white}>
                    <sphereGeometry args={[0.018, 12, 10]} />
                  </mesh>
                  <mesh position-z={0.012} material={dark}>
                    <sphereGeometry args={[0.0095, 10, 8]} />
                  </mesh>
                </group>
              ))}
            </group>
            {[1, -1].map((sd) => (
              <mesh key={sd} position={[sd * 0.04, 0.152, 0.094]} rotation-z={sd * -0.18} material={hair}>
                <boxGeometry args={[0.04, 0.008, 0.012]} />
              </mesh>
            ))}
            <mesh position={[0, 0.088, 0.108]} rotation-x={Math.PI / 2 - 0.35} material={skin}>
              <coneGeometry args={[0.014, 0.045, 8]} />
            </mesh>
            <mesh ref={mouth} position={[0, 0.042, 0.097]} material={lip}>
              <sphereGeometry args={[0.022, 12, 8]} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  )
}
