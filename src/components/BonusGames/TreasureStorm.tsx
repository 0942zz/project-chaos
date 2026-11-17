import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { audio } from '../../audio/engine'
import { TS_COLS, TS_COUNT } from '../../game/logic/bonus'
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

const tierColor = (v: number): string => (v >= 50 ? '#ffd75e' : v >= 20 ? '#ff8ad8' : v >= 10 ? '#49ecff' : '#d5dcf5')

function vaultTransform(i: number): { pos: THREE.Vector3; ry: number } {
  const col = i % TS_COLS
  const row = Math.floor(i / TS_COLS)
  const a = (col / (TS_COLS - 1) - 0.5) * 2 * SPAN
  return { pos: new THREE.Vector3(Math.sin(a) * WALL_R, 1.5 + row * 1.22, WALL_Z - Math.cos(a) * WALL_R), ry: -a }
}

const socketGeo = new THREE.CylinderGeometry(0.56, 0.56, 0.16, 6)
socketGeo.rotateX(Math.PI / 2)
const rimGeo = new THREE.TorusGeometry(0.56, 0.035, 6, 6)
const coverGeo = new THREE.OctahedronGeometry(0.34, 0)
const labelGeo = new THREE.PlaneGeometry(1.15, 0.72)

function Target({ index, onReveal }: { index: number; onReveal: (p: THREE.Vector3, color: string, big: boolean) => void }) {
  const tf = useMemo(() => vaultTransform(index), [index])
  const cover = useRef<THREE.Mesh>(null!)
  const label = useRef<THREE.Mesh>(null!)
  const [hover, setHover] = useState(false)
  const status = useGame((s) => (s.bonus?.kind === 'TS' ? s.bonus.status : 'preview'))
  const picked = useGame((s) => s.bonus?.kind === 'TS' && s.bonus.pick === index)
  // Before the shuffle the wall shows the preview layout; afterwards, the real one.
  const value = useGame((s) => (s.bonus?.kind === 'TS' ? (s.bonus.status === 'preview' ? s.bonus.preview[index] : s.bonus.values[index]) : 5))
  const canPick = useGame((s) => s.phase === 'BONUS_ACTIVE') && status === 'pick'
  const hue = useMemo(() => new THREE.Color().setHSL(0.5 + ((index * 0.137) % 0.1), 0.85, 0.5), [index])
  const mat = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color: hue, metalness: 0.15, roughness: 0.12, clearcoat: 1, emissive: hue, emissiveIntensity: 0.25, flatShading: true }),
    [hue],
  )
  const labelMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: labelTexture(`${value}×`, { width: 256, height: 160, size: 116, color: tierColor(value), stroke: '#04060c' }), transparent: true, toneMapped: false, depthWrite: false }),
    [value],
  )
  useEffect(() => () => { mat.dispose(); labelMat.dispose() }, [mat, labelMat])
  const revealAt = useRef<number | null>(null)
  const seed = useMemo(() => index * 1.37, [index])

  useEffect(() => {
    if (picked) onReveal(tf.pos.clone().add(new THREE.Vector3(0, 0, 0.4)), tierColor(value), value >= 20)
  }, [picked])

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const t = clock.elapsedTime
    if (status !== 'done') revealAt.current = null
    else if (!picked && revealAt.current === null) revealAt.current = t + 1.1 + (index % TS_COLS) * 0.06 + Math.floor(index / TS_COLS) * 0.05
    const open = status === 'preview' || picked || (revealAt.current !== null && t > revealAt.current)
    const active = hover && canPick
    const shuffling = status === 'shuffle'
    cover.current.rotation.y = t * (active ? 3 : shuffling ? 9 : 0.6) + seed
    cover.current.position.x = shuffling ? Math.sin(t * 14 + seed * 3) * 0.16 : damp(cover.current.position.x, 0, 10, dt)
    cover.current.position.y = shuffling ? Math.cos(t * 11 + seed * 5) * 0.16 : Math.sin(t * 1.4 + seed) * 0.04
    const sc = damp(cover.current.scale.x, open ? 0 : active ? 1.3 : 1, 12, dt)
    cover.current.scale.set(sc, sc * 1.25, sc * 0.75)
    cover.current.visible = sc > 0.02
    mat.emissiveIntensity = damp(mat.emissiveIntensity, active ? 2 : shuffling ? 0.9 : 0.25, 10, dt)
    const ls = damp(label.current.scale.x, open ? (picked ? 1.4 : 0.85) : 0, 9, dt)
    label.current.scale.setScalar(ls)
    label.current.visible = ls > 0.02
    labelMat.opacity = status === 'done' && !picked ? 0.45 : 1
  })

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    if (!canPick) return
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
    if (!canPick) return
    useGame.getState().tsPick(index)
    out()
  }

  return (
    <group position={tf.pos} rotation-y={tf.ry}>
      <mesh geometry={socketGeo} material={M.blackMetal} position-z={-0.1} onPointerOver={over} onPointerOut={out} onClick={click} dispose={null} />
      <mesh geometry={rimGeo} material={picked ? M.gold : M.chrome} rotation-z={Math.PI / 6} dispose={null} />
      <mesh ref={cover} geometry={coverGeo} material={mat} position-z={0.22} onPointerOver={over} onPointerOut={out} onClick={click} castShadow dispose={null} />
      <mesh ref={label} geometry={labelGeo} material={labelMat} position-z={0.16} scale={0} dispose={null} />
    </group>
  )
}

export default function TreasureStorm() {
  const burst = useRef<BurstHandle>(null)
  const flash = useRef<THREE.PointLight>(null!)
  const energy = useRef(0)
  const status = useGame((s) => (s.bonus?.kind === 'TS' ? s.bonus.status : 'preview'))

  useEffect(() => () => { document.body.style.cursor = '' }, [])
  useEffect(() => {
    if (status === 'shuffle') audio.whoosh()
    if (status === 'pick') audio.beep(false)
  }, [status])

  const reveal = (p: THREE.Vector3, color: string, big: boolean) => {
    burst.current?.fire(p, big ? 170 : 80, color, big ? 5.5 : 3.5)
    const b = useGame.getState().bonus
    if (b?.kind === 'TS') audio.reveal(b.multiplier)
    energy.current = 1
  }

  useFrame((_, dt) => {
    energy.current = damp(energy.current, 0, 2.5, dt)
    flash.current.intensity = 50 + energy.current * 600
  })

  const shot = (): Shot => ({ pos: [0, 3.6, 13.4], target: [0, 2.7, -3.5], fov: 44 })

  return (
    <BonusStage a="#49ecff" b="#2b6bff" radius={10} energy={status === 'pick' ? 1 : 0.5} hostX={8.2} hostZ={2.6} dust="#9ff3ff">
      <BonusCamera shot={shot} drift={0.1} />
      <pointLight ref={flash} position={[0, 9, 2]} color="#bfefff" distance={45} intensity={50} />
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
        <Target key={i} index={i} onReveal={reveal} />
      ))}
      <Burst ref={burst} size={0.13} gravity={3} />
    </BonusStage>
  )
}
