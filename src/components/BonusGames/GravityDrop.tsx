import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { audio } from '../../audio/engine'
import { GD_DOUBLE, GD_SLOTS } from '../../game/logic/bonus'
import { BOARD, GravityBoard, aimToX, pinPositions, slotCenterX } from '../../game/physics/gravityBoard'
import { useGame } from '../../game/state/store'
import { M, glow } from '../../materials'
import { damp } from '../../utils/math'
import { labelTexture } from '../../utils/textures'
import { BonusCamera, type Shot } from '../Camera/CameraRig'
import { Burst, type BurstHandle } from '../Effects/Burst'
import { BonusStage } from './BonusStage'

const BOARD_Y = 0.9
const slotColor = (v: number): string => (v === GD_DOUBLE ? '#ffffff' : v >= 50 ? '#ffd75e' : v >= 25 ? '#ff5cf0' : v >= 15 ? '#49ecff' : '#9aa7ff')
const slotLabel = (v: number): string => (v === GD_DOUBLE ? 'DOUBLE' : `${v}×`)

function Pins({ heat }: { heat: Float32Array }) {
  const pins = useMemo(() => pinPositions(), [])
  const mesh = useRef<THREE.InstancedMesh | null>(null)
  const col = useMemo(() => new THREE.Color(), [])
  const base = useMemo(() => new THREE.Color('#dfe4f2'), [])
  const hot = useMemo(() => new THREE.Color('#ff5cf0').multiplyScalar(6), [])
  const init = (m: THREE.InstancedMesh | null) => {
    if (!m) return
    mesh.current = m
    const mat = new THREE.Matrix4()
    pins.forEach(([x, y], i) => {
      mat.makeTranslation(x, y, 0.22)
      m.setMatrixAt(i, mat)
      m.setColorAt(i, base)
    })
    m.instanceMatrix.needsUpdate = true
  }
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(BOARD.pinR, BOARD.pinR * 1.25, 0.5, 12)
    g.rotateX(Math.PI / 2)
    return g
  }, [])
  useEffect(() => () => geo.dispose(), [geo])
  useFrame((_, dt) => {
    const m = mesh.current
    if (!m) return
    for (let i = 0; i < pins.length; i++) {
      if (heat[i] <= 0.001) continue
      heat[i] = Math.max(0, heat[i] - dt * 2.2)
      m.setColorAt(i, col.copy(base).lerp(hot, heat[i]))
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })
  return (
    <instancedMesh ref={init} args={[geo, undefined, pins.length]} castShadow>
      <meshStandardMaterial metalness={1} roughness={0.12} emissive="#7d5cc4" emissiveIntensity={0.55} />
    </instancedMesh>
  )
}

export default function GravityDrop() {
  const [board, setBoard] = useState<GravityBoard | null>(null)
  const bonus = useGame((s) => (s.bonus?.kind === 'GD' ? s.bonus : null))
  const ball = useRef<THREE.Mesh>(null!)
  const ghost = useRef<THREE.Group>(null!)
  const burst = useRef<BurstHandle>(null)
  const pins = useMemo(() => pinPositions(), [])
  const heat = useMemo(() => new Float32Array(pins.length), [pins])
  const edge = useMemo(() => glow('#ff5cf0', 2.6), [])
  const view = useRef({ slow: 0, landed: false })

  useEffect(() => {
    let alive = true
    let made: GravityBoard | null = null
    void GravityBoard.create().then((b) => {
      made = b
      if (alive) setBoard(b)
      else b.free()
    })
    return () => {
      alive = false
      made?.free()
      edge.dispose()
      document.body.style.cursor = ''
    }
  }, [edge])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const g = useGame.getState()
    const b = g.bonus?.kind === 'GD' ? g.bonus : null
    if (!b || !board) return
    const v = view.current

    // After a DOUBLE the board is re-armed for another drop.
    if (b.status === 'aim' && board.dropped) {
      board.reset()
      v.landed = false
    }
    if (b.status === 'dropping' && !board.dropped) board.drop(aimToX(b.aim) + b.jitter)

    // Slow motion for the final approach into the prize slots.
    const nearSlots = board.dropped && board.landedSlot === null && board.y < BOARD.firstRowY + 0.5
    v.slow = damp(v.slow, nearSlots ? 1 : 0, 6, dt)
    board.advance(dt * (1 - 0.68 * v.slow))

    if (board.dropped) {
      ball.current.visible = true
      ball.current.position.set(board.x, board.y, 0.22)
      ball.current.rotation.z -= board.x * 0.02
      if (board.impact > 1.6 && board.landedSlot === null) {
        audio.pin(board.impact)
        let best = -1
        let bestD = 0.5
        for (let i = 0; i < pins.length; i++) {
          const d = Math.hypot(pins[i][0] - board.x, pins[i][1] - board.y)
          if (d < bestD) { bestD = d; best = i }
        }
        if (best >= 0) heat[best] = 1
        burst.current?.fire(new THREE.Vector3(board.x, board.y + BOARD_Y, 0.4), 5, '#ffc0fb', 1.6)
      }
      if (board.landedSlot !== null && !v.landed && board.speed < 2.5) {
        v.landed = true
        if (b.slots[board.landedSlot] === GD_DOUBLE) audio.bonus()
        else audio.slot()
        burst.current?.fire(new THREE.Vector3(slotCenterX(board.landedSlot), BOARD_Y + 0.7, 0.5), 140, slotColor(b.slots[board.landedSlot]), 5)
        g.gdLand(board.landedSlot)
      }
    } else {
      ball.current.visible = false
    }
    ghost.current.visible = b.status === 'aim'
    ghost.current.position.x = damp(ghost.current.position.x, aimToX(b.aim), 14, dt)
  })

  const aimFromEvent = (e: ThreeEvent<PointerEvent>) => {
    const local = e.object.worldToLocal(e.point.clone())
    useGame.getState().gdAim(0.5 + local.x / (2 * (BOARD.halfW - 0.55)))
  }

  const shot = (): Shot => {
    const st = bonus?.status ?? 'aim'
    if (!board || st === 'aim') return { pos: [0, 5.4, 23], target: [0, 4.3, 0], fov: 40 }
    if ((st === 'landed' || st === 'doubling') && bonus?.slot != null) {
      const x = slotCenterX(bonus.slot)
      return { pos: [x * 0.7, 2.2, 8.5], target: [x, 0.5, 0], fov: 40, speed: 2.5 }
    }
    const k = view.current.slow
    return {
      pos: [board.x * 0.45, board.y + BOARD_Y + 0.8 - k * 0.4, 10.5 - k * 4],
      target: [board.x * 0.75, board.y + BOARD_Y - 1.7 + k * 0.5, 0],
      fov: 42,
      speed: 3.5,
    }
  }

  const W = BOARD.halfW * 2
  const H = BOARD.top + 0.9

  return (
    <BonusStage a="#ff5cf0" b="#7a3bff" radius={9} hostX={7.4} hostZ={2.6} dust="#ffb8fa" energy={bonus?.status === 'dropping' ? 1.2 : 0.6}>
      <BonusCamera shot={shot} drift={0.05} />
      <group position-y={BOARD_Y}>
        {/* back plate */}
        <mesh position={[0, H / 2 - 0.2, -0.2]} material={M.gloss} receiveShadow
          onPointerMove={aimFromEvent}
          onPointerOver={() => { if (bonus?.status === 'aim') document.body.style.cursor = 'pointer' }}
          onPointerOut={() => { document.body.style.cursor = '' }}
          onClick={(e) => { aimFromEvent(e as unknown as ThreeEvent<PointerEvent>); useGame.getState().gdDrop() }}
        >
          <boxGeometry args={[W + 0.5, H + 0.3, 0.3]} />
        </mesh>
        {/* illuminated frame */}
        {[-1, 1].map((sd) => (
          <group key={sd} position-x={sd * (BOARD.halfW + 0.3)}>
            <mesh position={[0, H / 2 - 0.2, 0.15]} material={M.blackMetal} castShadow>
              <boxGeometry args={[0.5, H + 0.5, 0.9]} />
            </mesh>
            <mesh position={[-sd * 0.26, H / 2 - 0.2, 0.3]} material={edge}>
              <boxGeometry args={[0.04, H, 0.06]} />
            </mesh>
            <mesh position={[0, H / 2 - 0.2, 0.61]} material={M.gold}>
              <boxGeometry args={[0.12, H + 0.3, 0.03]} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, H + 0.05, 0.15]} material={M.blackMetal} castShadow>
          <boxGeometry args={[W + 1.1, 0.5, 0.9]} />
        </mesh>
        <mesh position={[0, H - 0.22, 0.3]} material={edge}>
          <boxGeometry args={[W, 0.04, 0.06]} />
        </mesh>
        <mesh position={[0, -0.35, 0.15]} material={M.blackMetal} castShadow>
          <boxGeometry args={[W + 1.1, 0.5, 0.9]} />
        </mesh>

        <Pins heat={heat} />

        {/* prize slots */}
        {Array.from({ length: GD_SLOTS + 1 }, (_, k) => (
          <mesh key={k} position={[-BOARD.halfW + k * BOARD.slotW, BOARD.slotH / 2, 0.22]} material={M.gold} castShadow>
            <boxGeometry args={[0.07, BOARD.slotH, 0.5]} />
          </mesh>
        ))}
        {bonus?.slots.map((v, i) => {
          const hit = bonus.slot === i
          return (
            <group key={i} position={[slotCenterX(i), 0, 0]}>
              <mesh position={[0, 0.04, 0.22]}>
                <boxGeometry args={[BOARD.slotW - 0.1, 0.06, 0.48]} />
                <meshStandardMaterial color="#000" emissive={slotColor(v)} emissiveIntensity={hit ? 5 : 1.3} toneMapped={false} />
              </mesh>
              <mesh position={[0, 0.58, -0.03]}>
                <planeGeometry args={[BOARD.slotW - 0.12, 0.62]} />
                <meshBasicMaterial
                  map={labelTexture(slotLabel(v), { width: 256, height: 180, size: v === GD_DOUBLE ? 48 : v >= 100 ? 88 : 112, color: slotColor(v), stroke: '#05040a' })}
                  transparent toneMapped={false} depthWrite={false}
                />
              </mesh>
            </group>
          )
        })}

        {/* ball + aiming ghost */}
        <mesh ref={ball} visible={false} castShadow>
          <sphereGeometry args={[BOARD.ballR, 28, 20]} />
          <meshStandardMaterial color="#ffd98a" metalness={1} roughness={0.12} emissive="#ff9a2e" emissiveIntensity={0.5} />
        </mesh>
        <group ref={ghost} position={[0, BOARD.top, 0.22]}>
          <mesh>
            <sphereGeometry args={[BOARD.ballR, 24, 16]} />
            <meshStandardMaterial color="#ffd98a" metalness={1} roughness={0.15} emissive="#ff9a2e" emissiveIntensity={0.8} transparent opacity={0.85} />
          </mesh>
          <mesh position-y={-1.2}>
            <boxGeometry args={[0.025, 2, 0.02]} />
            <meshBasicMaterial color="#ffd98a" transparent opacity={0.5} toneMapped={false} />
          </mesh>
          <mesh position-y={0.45} rotation-z={Math.PI} material={M.gold}>
            <coneGeometry args={[0.16, 0.32, 4]} />
          </mesh>
        </group>
      </group>
      <Burst ref={burst} size={0.1} gravity={6} />
    </BonusStage>
  )
}
