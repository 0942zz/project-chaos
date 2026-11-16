import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { audio } from '../../audio/engine'
import { TS_COLS, TS_COUNT, TS_ROWS } from '../../game/logic/bonus'
import { useGame } from '../../game/state/store'
import { M } from '../../materials'
import { damp } from '../../utils/math'
import { labelTexture } from '../../utils/textures'
import { BonusCamera, type Shot } from '../Camera/CameraRig'
import { Burst, type BurstHandle } from '../Effects/Burst'
import { BonusStage } from './BonusStage'

const WALL_R = 12
const WALL_Z = 8.5
const SPAN = 0.6

const tierColor = (v: number): string => (v >= 25 ? '#ffd75e' : v >= 8 ? '#ff5cf0' : v >= 4 ? '#49ecff' : '#c9d6ff')

function vaultTransform(i: number): { pos: THREE.Vector3; ry: number } {
  const col = i % TS_COLS
  const row = Math.floor(i / TS_COLS)
  const a = (col / (TS_COLS - 1) - 0.5) * 2 * SPAN
  return { pos: new THREE.Vector3(Math.sin(a) * WALL_R, 1.5 + row * 1.22, WALL_Z - Math.cos(a) * WALL_R), ry: -a }
}

const socketGeo = new THREE.CylinderGeometry(0.56, 0.56, 0.16, 6)
socketGeo.rotateX(Math.PI / 2)
const rimGeo = new THREE.TorusGeometry(0.56, 0.035, 6, 6)
const gemGeo = new THREE.OctahedronGeometry(0.34, 0)
const labelGeo = new THREE.PlaneGeometry(1.15, 0.72)

function Vault({ index, onExplode }: { index: number; onExplode: (p: THREE.Vector3, color: string, big: boolean) => void }) {
  const tf = useMemo(() => vaultTransform(index), [index])
  const gem = useRef<THREE.Mesh>(null!)
  const label = useRef<THREE.Mesh>(null!)
  const [hover, setHover] = useState(false)
  const picked = useGame((s) => s.bonus?.kind === 'TS' && s.bonus.picks.includes(index))
  const done = useGame((s) => s.bonus?.kind === 'TS' && s.bonus.status === 'done')
  const value = useGame((s) => (s.bonus?.kind === 'TS' ? s.bonus.values[index] : 1))
  const canPick = useGame((s) => s.phase === 'BONUS_ACTIVE' && s.bonus?.kind === 'TS' && s.bonus.status === 'pick')
  const hue = useMemo(() => new THREE.Color().setHSL(0.5 + ((index * 0.137) % 0.12), 0.9, 0.55), [index])
  const mat = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color: hue, metalness: 0.1, roughness: 0.04, clearcoat: 1, emissive: hue, emissiveIntensity: 0.35, flatShading: true }),
    [hue],
  )
  const labelMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: labelTexture(`${value}×`, { width: 256, height: 160, size: 120, color: tierColor(value), glow: tierColor(value) }), transparent: true, toneMapped: false, depthWrite: false }),
    [value],
  )
  useEffect(() => () => { mat.dispose(); labelMat.dispose() }, [mat, labelMat])
  const revealAt = useRef<number | null>(null)
  const seed = useMemo(() => index * 1.37, [index])

  useEffect(() => {
    if (picked) onExplode(tf.pos.clone().add(new THREE.Vector3(0, 0, 0.4)), tierColor(value), value >= 8)
  }, [picked])

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const t = clock.elapsedTime
    // Unpicked vaults open one by one once the last pick is made.
    if (done && !picked && revealAt.current === null) revealAt.current = t + 1 + (index % TS_COLS) * 0.07 + Math.floor(index / TS_COLS) * 0.05
    const open = picked || (revealAt.current !== null && t > revealAt.current)
    const active = hover && canPick && !open
    gem.current.rotation.y = t * (active ? 3 : 0.6) + seed
    gem.current.position.y = Math.sin(t * 1.4 + seed) * 0.04
    const s = damp(gem.current.scale.x, open ? 0 : active ? 1.3 : 1, 12, dt)
    gem.current.scale.set(s, s * 1.25, s * 0.75)
    gem.current.visible = s > 0.02
    mat.emissiveIntensity = damp(mat.emissiveIntensity, active ? 2.4 : 0.35 + 0.2 * Math.sin(t * 2 + seed), 10, dt)
    const ls = damp(label.current.scale.x, open ? (picked ? 1.25 : 0.8) : 0, 9, dt)
    label.current.scale.setScalar(ls)
    label.current.visible = ls > 0.02
    labelMat.opacity = picked ? 1 : 0.5
  })

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    if (!canPick || picked) return
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
    if (!canPick || picked) return
    useGame.getState().tsPick(index)
    out()
  }

  return (
    <group position={tf.pos} rotation-y={tf.ry}>
      <mesh geometry={socketGeo} material={M.blackMetal} position-z={-0.1} onPointerOver={over} onPointerOut={out} onClick={click} />
      <mesh geometry={rimGeo} material={picked ? M.gold : M.chrome} rotation-z={Math.PI / 6} />
      <mesh ref={gem} geometry={gemGeo} material={mat} position-z={0.22} onPointerOver={over} onPointerOut={out} onClick={click} castShadow />
      <mesh ref={label} geometry={labelGeo} material={labelMat} position-z={0.16} scale={0} />
    </group>
  )
}

export default function TreasureStorm() {
  const burst = useRef<BurstHandle>(null)
  const flash = useRef<THREE.PointLight>(null!)
  const energy = useRef(0)
  const picks = useGame((s) => (s.bonus?.kind === 'TS' ? s.bonus.picks.length : 0))

  useEffect(() => () => { document.body.style.cursor = '' }, [])

  const explode = (p: THREE.Vector3, color: string, big: boolean) => {
    burst.current?.fire(p, big ? 150 : 70, color, big ? 5.5 : 3.5)
    burst.current?.fire(p, 30, '#ffffff', 2)
    const b = useGame.getState().bonus
    if (b?.kind === 'TS') audio.reveal(b.values[b.picks[b.picks.length - 1]])
    energy.current = 1
  }

  useFrame(({ clock }, dt) => {
    energy.current = damp(energy.current, 0, 2.5, dt)
    const t = clock.elapsedTime
    // distant lightning
    const strike = Math.sin(t * 0.9) > 0.985 || Math.sin(t * 2.3 + 1) > 0.995 ? 1 : 0
    flash.current.intensity = 50 + strike * 380 + energy.current * 700
  })

  const shot = (): Shot => ({ pos: [0, 3.6, 13.4], target: [0, 2.7, -3.5], fov: 44 })

  return (
    <BonusStage a="#49ecff" b="#2b6bff" radius={10} energy={0.5 + picks * 0.3} presenter={[7.4, 0, 3.4]} dust="#9ff3ff">
      <BonusCamera shot={shot} drift={0.1} />
      <pointLight ref={flash} position={[0, 9, 2]} color="#bfefff" distance={45} intensity={60} />
      {/* curved vault wall */}
      <mesh position={[0, 4, WALL_Z]}>
        <cylinderGeometry args={[WALL_R + 0.25, WALL_R + 0.25, 7.6, 64, 1, true, Math.PI - SPAN - 0.1, SPAN * 2 + 0.2]} />
        <meshStandardMaterial color="#0d1420" metalness={0.8} roughness={0.42} side={THREE.BackSide} />
      </mesh>
      {[0.25, 7.75].map((y) => (
        <mesh key={y} position={[0, y, WALL_Z]} rotation-x={Math.PI / 2} rotation-z={-Math.PI / 2 - SPAN - 0.1} material={M.gold}>
          <torusGeometry args={[WALL_R + 0.2, 0.09, 8, 64, SPAN * 2 + 0.2]} />
        </mesh>
      ))}
      {Array.from({ length: TS_COUNT }, (_, i) => (
        <Vault key={i} index={i} onExplode={explode} />
      ))}
      <Burst ref={burst} size={0.13} gravity={3} />
    </BonusStage>
  )
}
