import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { audio } from '../../audio/engine'
import { SEGMENTS, SEGMENT_COUNT, SEG_ANGLE, WHEEL, indexAtAngle, type SegmentType } from '../../game/logic/segments'
import { sampleSpin } from '../../game/physics/wheelSim'
import { useGame } from '../../game/state/store'
import { M, enamel } from '../../materials'
import { damp } from '../../utils/math'
import { labelTexture } from '../../utils/textures'
import { Burst, type BurstHandle } from '../Effects/Burst'

export const WHEEL_POS: [number, number, number] = [0, 3.85, -1.4]
export const WHEEL_RADIUS = 2.6
const R_OUT = 2.46
const R_IN = 0.86
const DEPTH = 0.2
const BULBS = 44

function useSegmentGeometry(): THREE.ExtrudeGeometry {
  return useMemo(() => {
    const gap = 0.007
    const a0 = Math.PI / 2 - SEG_ANGLE / 2 + gap
    const a1 = Math.PI / 2 + SEG_ANGLE / 2 - gap
    const shape = new THREE.Shape()
    shape.absarc(0, 0, R_OUT, a0, a1, false)
    shape.absarc(0, 0, R_IN, a1, a0, true)
    shape.closePath()
    return new THREE.ExtrudeGeometry(shape, {
      depth: DEPTH,
      bevelEnabled: true,
      bevelSize: 0.014,
      bevelThickness: 0.02,
      bevelSegments: 2,
      curveSegments: 5,
    })
  }, [])
}

function Segments({ mats }: { mats: THREE.MeshPhysicalMaterial[] }) {
  const geo = useSegmentGeometry()
  const labelMats = useMemo(() => {
    const out = {} as Record<SegmentType, THREE.MeshBasicMaterial>
    for (const info of Object.values(SEGMENTS)) {
      const map = info.bonus
        ? labelTexture(info.label, { width: 128, height: 512, size: 84, vertical: true, color: info.text })
        : labelTexture(info.label, { width: 256, height: 256, size: info.label.length > 1 ? 150 : 190, color: info.text })
      out[info.type] = new THREE.MeshBasicMaterial({ map, transparent: true, toneMapped: false, depthWrite: false })
    }
    return out
  }, [])
  return (
    <>
      {WHEEL.map((type, i) => {
        const bonus = SEGMENTS[type].bonus
        return (
          <group key={i} rotation-z={(i + 0.5) * SEG_ANGLE}>
            <mesh geometry={geo} material={mats[i]} castShadow />
            {bonus ? (
              <mesh position={[0, 1.66, DEPTH + 0.03]} material={labelMats[type]}>
                <planeGeometry args={[0.21, 1.25]} />
              </mesh>
            ) : (
              <mesh position={[0, 2.08, DEPTH + 0.03]} material={labelMats[type]}>
                <planeGeometry args={[0.36, 0.36]} />
              </mesh>
            )}
            {!bonus && (
              <mesh position={[0, 1.18, DEPTH + 0.02]} material={M.gold}>
                <circleGeometry args={[0.03, 12]} />
              </mesh>
            )}
          </group>
        )
      })}
    </>
  )
}

function Pegs() {
  const ref = useRef<THREE.InstancedMesh>(null!)
  const geo = useMemo(() => new THREE.CylinderGeometry(0.028, 0.028, 0.2, 10), [])
  useMemo(() => geo.rotateX(Math.PI / 2), [geo])
  const set = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    ref.current = mesh
    const m = new THREE.Matrix4()
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const a = Math.PI / 2 + i * SEG_ANGLE
      m.makeTranslation(Math.cos(a) * 2.5, Math.sin(a) * 2.5, DEPTH + 0.12)
      mesh.setMatrixAt(i, m)
    }
    mesh.instanceMatrix.needsUpdate = true
  }
  return <instancedMesh ref={set} args={[geo, M.chrome, SEGMENT_COUNT]} castShadow />
}

function Hub() {
  const lathe = useMemo(() => {
    const pts = [[0.001, 0.36], [0.2, 0.36], [0.3, 0.3], [0.5, 0.27], [0.62, 0.2], [0.8, 0.17], [0.92, 0.06], [0.96, 0]].map(
      ([x, y]) => new THREE.Vector2(x, y),
    )
    const g = new THREE.LatheGeometry(pts, 64)
    g.rotateX(Math.PI / 2)
    return g
  }, [])
  const emblem = useMemo(() => labelTexture('C', { size: 190, color: '#1a1203', glow: '#fff1b8' }), [])
  return (
    <group position-z={DEPTH}>
      <mesh geometry={lathe} material={M.gold} castShadow />
      <mesh position-z={0.365} material={M.chrome}>
        <torusGeometry args={[0.2, 0.03, 12, 48]} />
      </mesh>
      <mesh position-z={0.362}>
        <circleGeometry args={[0.19, 40]} />
        <meshBasicMaterial map={emblem} color="#ffe6a0" toneMapped={false} />
      </mesh>
      {Array.from({ length: 9 }, (_, i) => {
        const a = (i / 9) * Math.PI * 2
        return (
          <mesh key={i} position={[Math.cos(a) * 0.7, Math.sin(a) * 0.7, 0.19]}>
            <sphereGeometry args={[0.035, 12, 12]} />
            <meshStandardMaterial color="#000" emissive={i % 3 === 0 ? '#ff4a68' : '#ffe6a0'} emissiveIntensity={2.4} toneMapped={false} />
          </mesh>
        )
      })}
    </group>
  )
}

function Pointer({ flapRef }: { flapRef: React.RefObject<THREE.Group | null> }) {
  const geo = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(-0.13, 0.06)
    s.quadraticCurveTo(0, 0.14, 0.13, 0.06)
    s.lineTo(0.02, -0.5)
    s.quadraticCurveTo(0, -0.54, -0.02, -0.5)
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 })
    g.translate(0, 0, -0.035)
    return g
  }, [])
  return (
    <group position={[0, WHEEL_RADIUS + 0.38, DEPTH + 0.14]}>
      <mesh position={[0, 0.16, -0.16]} material={M.blackMetal} castShadow>
        <boxGeometry args={[0.7, 0.46, 0.3]} />
      </mesh>
      <mesh position={[0, 0.16, -0.005]} material={M.gold}>
        <boxGeometry args={[0.56, 0.32, 0.03]} />
      </mesh>
      <group ref={flapRef}>
        <mesh geometry={geo} material={M.chrome} castShadow />
        <mesh position-z={0.05} rotation-x={Math.PI / 2} material={M.gold}>
          <cylinderGeometry args={[0.075, 0.075, 0.05, 24]} />
        </mesh>
        <mesh position-z={0.08}>
          <sphereGeometry args={[0.045, 16, 16]} />
          <meshStandardMaterial color="#300" emissive="#ff2244" emissiveIntensity={3} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

function Bulbs() {
  const ref = useRef<THREE.InstancedMesh>(null!)
  const color = useMemo(() => new THREE.Color(), [])
  const init = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    ref.current = mesh
    const m = new THREE.Matrix4()
    for (let i = 0; i < BULBS; i++) {
      const a = Math.PI / 2 - (i / BULBS) * Math.PI * 2
      m.makeTranslation(Math.cos(a) * 2.88, Math.sin(a) * 2.88, 0.12)
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, color.set('#ffd98a'))
    }
    mesh.instanceMatrix.needsUpdate = true
  }
  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const s = useGame.getState()
    const t = clock.elapsedTime
    for (let i = 0; i < BULBS; i++) {
      let v: number
      let hue = '#ffd98a'
      if (s.phase === 'SPINNING' || s.phase === 'DECELERATING') v = (i + Math.floor(t * 18)) % 4 === 0 ? 3 : 0.35
      else if (s.phase === 'RESULT' || s.phase === 'BONUS_INTRO') {
        v = Math.floor(t * 6) % 2 === i % 2 ? 3.2 : 0.3
        if (s.result) hue = SEGMENTS[s.result.type].glow
      } else if (s.phase === 'LOCKED') v = 0.4 + 2.6 * Math.abs(Math.sin(t * 6))
      else v = 1 + 0.9 * Math.sin(t * 2 - i * 0.45)
      mesh.setColorAt(i, color.set(hue).multiplyScalar(v))
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })
  return (
    <instancedMesh ref={init} args={[undefined, undefined, BULBS]}>
      <sphereGeometry args={[0.055, 10, 10]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  )
}

export function Wheel() {
  const spinGroup = useRef<THREE.Group>(null!)
  const body = useRef<THREE.Group>(null!)
  const flap = useRef<THREE.Group>(null)
  const burst = useRef<BurstHandle>(null)
  const mats = useMemo(() => WHEEL.map((t) => enamel(SEGMENTS[t].color, SEGMENTS[t].glow)), [])
  const sim = useRef({ flap: 0, flapVel: 0, boundary: 0, wasSpinning: false })

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const s = useGame.getState()
    const spinning = s.spin !== null && (s.phase === 'SPINNING' || s.phase === 'DECELERATING')
    let angle = s.wheelAngle
    let omega = 0
    if (spinning && s.spin) {
      const r = sampleSpin(s.spin, (performance.now() - s.spinStartedAt) / 1000)
      angle = r.angle
      omega = r.omega
    }
    spinGroup.current.rotation.z = -angle

    const st = sim.current
    const boundary = Math.floor(angle / SEG_ANGLE)
    if (spinning && st.wasSpinning && boundary !== st.boundary) {
      const dir = Math.sign(boundary - st.boundary)
      st.flapVel += dir * Math.min(3 + Math.abs(omega) * 1.8, 16)
      audio.tick(Math.abs(omega))
    }
    if (st.wasSpinning && !spinning) {
      burst.current?.fire(new THREE.Vector3(0, WHEEL_RADIUS - 0.1, DEPTH + 0.3), 70, '#ffd98a', 2.6)
    }
    st.boundary = boundary
    st.wasSpinning = spinning

    // Spring-loaded flapper.
    const steps = 4
    for (let i = 0; i < steps; i++) {
      const h = dt / steps
      st.flapVel += (-520 * st.flap - 20 * st.flapVel) * h
      st.flap += st.flapVel * h
    }
    st.flap = THREE.MathUtils.clamp(st.flap, -0.55, 0.55)
    if (flap.current) flap.current.rotation.z = st.flap

    const shake = Math.min(1, Math.abs(omega) / 7)
    body.current.position.x = Math.sin(clock.elapsedTime * 97) * 0.003 * shake
    body.current.position.y = Math.cos(clock.elapsedTime * 83) * 0.003 * shake

    const current = indexAtAngle(angle)
    const showing = s.phase === 'RESULT' || s.phase === 'BONUS_INTRO'
    const pulse = 1.3 + Math.sin(clock.elapsedTime * 9) * 0.7
    for (let i = 0; i < mats.length; i++) {
      const target = i === current ? (spinning ? 1.5 : showing ? pulse : 0.45) : showing ? 0.03 : 0.12
      mats[i].emissiveIntensity = damp(mats[i].emissiveIntensity, target, spinning ? 30 : 8, dt)
    }
  })

  return (
    <group position={WHEEL_POS}>
      {/* Stand */}
      <mesh position={[0, -1.9, -0.55]} material={M.blackMetal} castShadow>
        <boxGeometry args={[0.7, 3.9, 0.5]} />
      </mesh>
      <mesh position={[0, -1.9, -0.29]} material={M.gold}>
        <boxGeometry args={[0.12, 3.8, 0.03]} />
      </mesh>
      <mesh position={[0, -3.45, -0.4]} material={M.gloss} castShadow receiveShadow>
        <cylinderGeometry args={[1.5, 1.9, 0.22, 48]} />
      </mesh>
      <mesh position={[0, -3.33, -0.4]} rotation-x={Math.PI / 2} material={M.gold}>
        <torusGeometry args={[1.5, 0.035, 10, 64]} />
      </mesh>

      <group ref={body}>
        {/* Static housing */}
        <mesh position-z={-0.2} rotation-x={Math.PI / 2} material={M.blackMetal} castShadow>
          <cylinderGeometry args={[2.95, 2.95, 0.3, 72]} />
        </mesh>
        <mesh position-z={0.02} material={M.gold}>
          <torusGeometry args={[2.88, 0.13, 20, 96]} />
        </mesh>
        <mesh position-z={0.06} material={M.blackMetal}>
          <torusGeometry args={[2.88, 0.09, 14, 96]} />
        </mesh>
        <mesh position-z={-0.05} material={M.chrome}>
          <torusGeometry args={[3.03, 0.035, 10, 96]} />
        </mesh>
        <Bulbs />
        <Pointer flapRef={flap} />

        {/* Rotating wheel */}
        <group ref={spinGroup}>
          <mesh position-z={-0.03} rotation-x={Math.PI / 2} material={M.goldBrushed}>
            <cylinderGeometry args={[2.58, 2.58, 0.1, 72]} />
          </mesh>
          <Segments mats={mats} />
          <mesh position-z={DEPTH - 0.02} material={M.gold} castShadow>
            <torusGeometry args={[2.53, 0.07, 14, 96]} />
          </mesh>
          <mesh position-z={DEPTH + 0.02} material={M.chrome}>
            <torusGeometry args={[R_IN + 0.02, 0.03, 10, 64]} />
          </mesh>
          <Pegs />
          <Hub />
        </group>
        <Burst ref={burst} />
      </group>
    </group>
  )
}
