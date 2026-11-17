import { useGLTF, useTexture } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { JACKPOT_THRESHOLD } from '../../game/logic/bonus'
import { isBonus } from '../../game/logic/segments'
import { useGame, type GameStore } from '../../game/state/store'
import { M, glow } from '../../materials'
import { damp } from '../../utils/math'

export type HostId = 'delux' | 'salsetta'
export type PresenterMode =
  | 'idle' | 'welcome' | 'explain' | 'introduce' | 'anticipate' | 'watch' | 'celebrate' | 'present' | 'bonus' | 'jackpot'

const BASE = import.meta.env.BASE_URL
const modelUrl = (id: HostId): string => `${BASE}models/${id}.glb`
const textureUrls = (id: HostId): string[] => ['diffuse', 'normal', 'roughness'].map((k) => `${BASE}models/${id}_${k}.jpg`)

/**
 * The supplied scans are static busts (no skeleton, no clips), so the hosts are
 * animated procedurally as whole bodies: turn, lean, nod, hop. `toWheel` is the
 * yaw that makes this host look at the centre of the stage.
 */
interface Pose { ry: number; rx: number; rz: number; y: number; squash: number }
const s = Math.sin

const CLIPS: Record<PresenterMode, (t: number, toWheel: number) => Pose> = {
  idle: (t) => ({ ry: s(t * 0.5) * 0.28, rx: s(t * 0.8) * 0.03, rz: s(t * 0.6) * 0.02, y: 0, squash: 0 }),
  welcome: (t) => ({ ry: s(t * 0.9) * 0.2, rx: 0.07 + s(t * 4.5) * 0.07, rz: s(t * 2.2) * 0.05, y: 0, squash: 0 }),
  explain: (t) => ({ ry: s(t * 0.8) * 0.4, rx: s(t * 2.3) * 0.05, rz: s(t * 1.3) * 0.06, y: 0, squash: 0 }),
  introduce: (t, w) => ({ ry: w * 0.75 + s(t * 1.4) * 0.12, rx: -0.04, rz: w * 0.07, y: 0, squash: 0 }),
  anticipate: (t, w) => ({ ry: w * 0.45, rx: 0.13, rz: s(t * 13) * 0.012, y: 0, squash: s(t * 9) * 0.012 }),
  watch: (t, w) => ({ ry: w, rx: -0.14, rz: s(t * 2) * 0.03, y: Math.abs(s(t * 4.5)) * 0.03, squash: 0 }),
  celebrate: (t) => ({ ry: s(t * 3.2) * 0.3, rx: -0.1, rz: s(t * 6.5) * 0.12, y: Math.abs(s(t * 6.5)) * 0.2, squash: s(t * 13) * 0.03 }),
  present: (t, w) => ({ ry: w * 0.6 + s(t * 1.2) * 0.15, rx: 0, rz: w * 0.05, y: 0, squash: 0 }),
  bonus: (t) => ({ ry: s(t * 2.4) * 0.7, rx: -0.08, rz: s(t * 5) * 0.09, y: Math.abs(s(t * 5.5)) * 0.14, squash: s(t * 11) * 0.025 }),
  jackpot: (t) => ({ ry: t * 5.2, rx: -0.12, rz: s(t * 8) * 0.14, y: Math.abs(s(t * 7.5)) * 0.34, squash: s(t * 15) * 0.04 }),
}

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
  if (b.kind === 'DON') return b.status === 'flipping' ? 'watch' : b.status === 'done' ? 'celebrate' : 'explain'
  if (b.kind === 'TS') return b.status === 'done' ? 'celebrate' : b.status === 'pick' ? 'anticipate' : 'explain'
  if (b.kind === 'GD') return b.status === 'dropping' ? 'watch' : b.status === 'landed' ? 'celebrate' : 'introduce'
  return b.stage === 'spinning' ? 'watch' : b.stage === 'result' || b.stage === 'boost' ? 'celebrate' : 'explain'
}

function Bust({ id }: { id: HostId }) {
  const gltf = useGLTF(modelUrl(id))
  const [map, normalMap, roughnessMap] = useTexture(textureUrls(id))
  const material = useMemo(() => {
    for (const t of [map, normalMap, roughnessMap]) {
      t.flipY = false
      t.needsUpdate = true
    }
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = 8
    return new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, roughness: 1, metalness: 0 })
  }, [map, normalMap, roughnessMap])
  const geometry = useMemo(() => {
    let g: THREE.BufferGeometry | null = null
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) g = (o as THREE.Mesh).geometry
    })
    return g as THREE.BufferGeometry | null
  }, [gltf])
  useEffect(() => () => material.dispose(), [material])
  if (!geometry) return null
  return <mesh geometry={geometry} material={material} castShadow dispose={null} />
}

/** If a model fails to load the show goes on with an empty plinth instead of crashing. */
class ModelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.warn('[chaos] presenter model failed to load', error)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

const PLINTH = 1.35

export function Presenter({
  who, context = 'studio', side = 1, height = 2.1, ...props
}: { who: HostId; context?: 'studio' | 'bonus'; side?: 1 | -1; height?: number } & React.ComponentProps<'group'>) {
  const body = useRef<THREE.Group>(null!)
  const pose = useRef<Pose>({ ry: 0, rx: 0, rz: 0, y: 0, squash: 0 })
  const strip = useMemo(() => glow('#f5c867', 2), [])
  useEffect(() => () => strip.dispose(), [strip])

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const t = clock.elapsedTime + (side === 1 ? 0 : 1.7)
    const g = useGame.getState()
    const mode = context === 'studio' ? studioMode(g, performance.now()) : bonusMode(g)
    const target = CLIPS[mode](t, -side * 0.95)
    const p = pose.current
    // A continuous spin (jackpot) is followed directly; everything else is eased.
    p.ry = mode === 'jackpot' ? target.ry : damp(p.ry % (Math.PI * 2), target.ry, 5, dt)
    p.rx = damp(p.rx, target.rx, 6, dt)
    p.rz = damp(p.rz, target.rz, 6, dt)
    p.y = damp(p.y, target.y, 14, dt)
    p.squash = damp(p.squash, target.squash, 10, dt)
    const breathe = s(t * 1.5) * 0.006
    body.current.rotation.set(p.rx, p.ry, p.rz)
    body.current.position.y = PLINTH + p.y
    body.current.scale.set(height * (1 - p.squash * 0.5), height * (1 + p.squash + breathe), height * (1 - p.squash * 0.5))
  })

  return (
    <group {...props}>
      <mesh position-y={0.09} material={M.gloss} castShadow receiveShadow>
        <cylinderGeometry args={[0.72, 0.82, 0.18, 8]} />
      </mesh>
      <mesh position-y={PLINTH / 2 + 0.05} material={M.blackMetal} castShadow>
        <cylinderGeometry args={[0.4, 0.56, PLINTH - 0.25, 8]} />
      </mesh>
      {[0.3, PLINTH - 0.22].map((y, i) => (
        <mesh key={y} position-y={y} rotation-x={Math.PI / 2} material={M.gold}>
          <torusGeometry args={[i ? 0.44 : 0.56, 0.03, 8, 8]} />
        </mesh>
      ))}
      <mesh position-y={PLINTH - 0.06} material={M.gold} castShadow>
        <cylinderGeometry args={[0.62, 0.46, 0.12, 8]} />
      </mesh>
      <mesh position-y={PLINTH + 0.005} rotation-x={-Math.PI / 2} material={strip}>
        <ringGeometry args={[0.5, 0.56, 8]} />
      </mesh>
      <group ref={body} position-y={PLINTH}>
        <ModelBoundary>
          <Suspense fallback={null}>
            <Bust id={who} />
          </Suspense>
        </ModelBoundary>
      </group>
    </group>
  )
}

/** Both hosts, mirrored around the centre of a stage. */
export function Hosts({ x, z, y = 0, context, height }: { x: number; z: number; y?: number; context: 'studio' | 'bonus'; height?: number }) {
  return (
    <>
      <Presenter who="delux" side={-1} context={context} height={height} position={[-x, y, z]} />
      <Presenter who="salsetta" side={1} context={context} height={height} position={[x, y, z]} />
    </>
  )
}

useGLTF.preload(modelUrl('delux'))
useGLTF.preload(modelUrl('salsetta'))
