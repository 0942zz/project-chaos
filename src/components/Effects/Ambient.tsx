import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { dotTexture } from '../../utils/textures'

/** Floating glitter. Motion and twinkle are computed entirely in the vertex shader. */
export function GoldDust({
  count = 500, size = [26, 12, 16], center = [0, 6, 0], color = '#ffd98a', power = 1,
}: { count?: number; size?: [number, number, number]; center?: [number, number, number]; color?: string; power?: number }) {
  const mat = useRef<THREE.ShaderMaterial>(null!)
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3)
    const seed = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * size[0]
      pos[i * 3 + 1] = (Math.random() - 0.5) * size[1]
      pos[i * 3 + 2] = (Math.random() - 0.5) * size[2]
      seed[i] = Math.random()
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    return g
  }, [count, size[0], size[1], size[2]])
  useEffect(() => () => geo.dispose(), [geo])
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uMap: { value: dotTexture() }, uH: { value: size[1] }, uPower: { value: power } }),
    [],
  )
  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.elapsedTime
    uniforms.uPower.value = power
    uniforms.uColor.value.set(color)
  })
  return (
    <points geometry={geo} position={center} frustumCulled={false}>
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
        vertexShader={/* glsl */ `
          attribute float aSeed; uniform float uTime, uH; varying float vA;
          void main() {
            vec3 p = position;
            p.y = mod(p.y + uH * 0.5 + uTime * (0.12 + aSeed * 0.3), uH) - uH * 0.5;
            p.x += sin(uTime * 0.4 + aSeed * 40.0) * 0.4;
            p.z += cos(uTime * 0.3 + aSeed * 23.0) * 0.4;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            vA = 0.35 + 0.65 * pow(abs(sin(uTime * (1.0 + aSeed * 3.0) + aSeed * 90.0)), 6.0);
            gl_PointSize = (18.0 + aSeed * 30.0) * vA / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`}
        fragmentShader={/* glsl */ `
          uniform vec3 uColor; uniform sampler2D uMap; uniform float uPower; varying float vA;
          void main() { gl_FragColor = vec4(uColor * 1.6, texture2D(uMap, gl_PointCoord).a * vA * uPower); }`}
      />
    </points>
  )
}

const CONFETTI = 320
const PALETTE = ['#ffd75e', '#ff4a68', '#49ecff', '#2dffb0', '#ffffff', '#b86bff']

/** Tumbling paper confetti (instanced). Relaunches every time `active` turns on. */
export function Confetti({ active, origin = [0, 9, 1], spread = 12 }: { active: boolean; origin?: [number, number, number]; spread?: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null!)
  const st = useMemo(
    () => ({
      p: new Float32Array(CONFETTI * 3), v: new Float32Array(CONFETTI * 3), r: new Float32Array(CONFETTI * 3),
      w: new Float32Array(CONFETTI * 3), running: false, was: false, time: 0,
    }),
    [],
  )
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const init = (m: THREE.InstancedMesh | null) => {
    if (!m) return
    mesh.current = m
    const c = new THREE.Color()
    for (let i = 0; i < CONFETTI; i++) m.setColorAt(i, c.set(PALETTE[i % PALETTE.length]).multiplyScalar(1.3))
    m.count = 0
  }
  useFrame((_, rawDt) => {
    const m = mesh.current
    if (!m) return
    const dt = Math.min(rawDt, 0.05)
    if (active && !st.was) {
      st.running = true
      st.time = 0
      for (let i = 0; i < CONFETTI; i++) {
        const j = i * 3
        st.p[j] = origin[0] + (Math.random() - 0.5) * spread
        st.p[j + 1] = origin[1] + Math.random() * 5
        st.p[j + 2] = origin[2] + (Math.random() - 0.5) * spread * 0.5
        st.v[j] = (Math.random() - 0.5) * 2
        st.v[j + 1] = -1 - Math.random() * 2
        st.v[j + 2] = (Math.random() - 0.5) * 2
        for (let k = 0; k < 3; k++) {
          st.r[j + k] = Math.random() * 6
          st.w[j + k] = (Math.random() - 0.5) * 9
        }
      }
    }
    st.was = active
    if (!st.running) return
    st.time += dt
    if (st.time > 9) {
      st.running = false
      m.count = 0
      return
    }
    m.count = CONFETTI
    for (let i = 0; i < CONFETTI; i++) {
      const j = i * 3
      st.v[j] += Math.sin(st.time * 2 + i) * 0.6 * dt
      st.p[j] += st.v[j] * dt
      st.p[j + 1] += st.v[j + 1] * dt
      st.p[j + 2] += st.v[j + 2] * dt
      for (let k = 0; k < 3; k++) st.r[j + k] += st.w[j + k] * dt
      dummy.position.set(st.p[j], Math.max(st.p[j + 1], 0.02), st.p[j + 2])
      dummy.rotation.set(st.r[j], st.r[j + 1], st.r[j + 2])
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={init} args={[undefined, undefined, CONFETTI]} frustumCulled={false}>
      <planeGeometry args={[0.13, 0.08]} />
      <meshBasicMaterial side={THREE.DoubleSide} toneMapped={false} />
    </instancedMesh>
  )
}

/** Expanding energy ring. Fires whenever `trigger` changes to a new truthy value. */
export function Shockwave({ trigger, color = '#ffd98a', radius = 14, position = [0, 0.4, 0] as [number, number, number], vertical = false }: {
  trigger: number | boolean; color?: string; radius?: number; position?: [number, number, number]; vertical?: boolean
}) {
  const mesh = useRef<THREE.Mesh>(null!)
  const mat = useRef<THREE.MeshBasicMaterial>(null!)
  const st = useRef({ t: 99, last: trigger })
  useFrame((_, dt) => {
    if (trigger !== st.current.last) {
      st.current.last = trigger
      if (trigger) st.current.t = 0
    }
    const s = st.current
    if (s.t > 1.6) {
      mesh.current.visible = false
      return
    }
    s.t += dt
    const k = s.t / 1.6
    mesh.current.visible = true
    mesh.current.scale.setScalar(0.2 + radius * (1 - Math.pow(1 - k, 3)))
    mat.current.opacity = (1 - k) * 0.9
  })
  return (
    <mesh ref={mesh} position={position} rotation-x={vertical ? 0 : -Math.PI / 2} visible={false}>
      <ringGeometry args={[0.9, 1, 96]} />
      <meshBasicMaterial ref={mat} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  )
}
